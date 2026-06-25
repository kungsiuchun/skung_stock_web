import { writeFile } from "node:fs/promises";
import { NativeSpxGexYahooClient } from "../src/lib/stocks-native-yahoo";
import type { SpxGexOptionChain, SpxGexOptionLeg } from "../src/lib/spx-gex-heatmap";

const CBOE_URL = "https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

type NullableNumber = number | null;

interface NormalizedLeg extends SpxGexOptionLeg {
  expiry: string;
  side: "C" | "P";
}

interface ProbeAttempt {
  source: "cboe" | "yahoo";
  ok: boolean;
  status?: number;
  latencyMs: number;
  bytes?: number;
  contentType?: string | null;
  error?: string;
  summary?: Record<string, unknown>;
}

const nowIso = () => new Date().toISOString();

const toNumber = (value: unknown): NullableNumber => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const pct = (part: number, total: number) => total > 0 ? round((part / total) * 100, 2) : 0;

const parseCboeOptionSymbol = (symbol: string) => {
  const match = symbol.match(/^([A-Z0-9]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!match) return null;
  const [, root, yy, mm, dd, side, strikeRaw] = match;
  const year = 2000 + Number(yy);
  const expiry = `${year}-${mm}-${dd}`;
  const strike = Number(strikeRaw) / 1000;
  if (!Number.isFinite(strike)) return null;
  return { root, expiry, side: side as "C" | "P", strike };
};

const normalizeCboeLeg = (row: Record<string, unknown>): NormalizedLeg | null => {
  const option = String(row.option || "");
  const parsed = parseCboeOptionSymbol(option);
  if (!parsed) return null;
  return {
    contractSymbol: option,
    expiry: parsed.expiry,
    side: parsed.side,
    strike: parsed.strike,
    lastPrice: toNumber(row.last_trade_price),
    bid: toNumber(row.bid),
    ask: toNumber(row.ask),
    volume: toNumber(row.volume),
    openInterest: toNumber(row.open_interest),
    impliedVolatility: toNumber(row.iv),
  };
};

const fieldCompleteness = (legs: SpxGexOptionLeg[]) => {
  const count = legs.length;
  const fields = ["openInterest", "volume", "impliedVolatility", "bid", "ask", "lastPrice"] as const;
  return Object.fromEntries(fields.map((field) => {
    const present = legs.filter((leg) => typeof leg[field] === "number" && Number.isFinite(leg[field])).length;
    const zero = legs.filter((leg) => leg[field] === 0).length;
    return [field, { present, missing: count - present, presentPct: pct(present, count), reportedZero: zero }];
  }));
};

const chainCompleteness = (chains: SpxGexOptionChain[]) => {
  const legs = chains.flatMap((chain) => [...chain.calls, ...chain.puts]);
  const expiries = Array.from(new Set(chains.map((chain) => chain.selectedExpiry).filter(Boolean) as string[])).sort();
  const strikes = Array.from(new Set(legs.map((leg) => leg.strike))).sort((a, b) => a - b);
  return {
    chains: chains.length,
    expiries: expiries.length,
    firstExpiries: expiries.slice(0, 10),
    strikes: strikes.length,
    minStrike: strikes[0] ?? null,
    maxStrike: strikes[strikes.length - 1] ?? null,
    legs: legs.length,
    calls: chains.reduce((sum, chain) => sum + chain.calls.length, 0),
    puts: chains.reduce((sum, chain) => sum + chain.puts.length, 0),
    fields: fieldCompleteness(legs),
  };
};

const summarizeCboePayload = (payload: Record<string, any>) => {
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  const rawOptions = Array.isArray(data.options) ? data.options as Record<string, unknown>[] : [];
  const legs = rawOptions.map(normalizeCboeLeg).filter((leg): leg is NormalizedLeg => Boolean(leg));
  const expiries = Array.from(new Set(legs.map((leg) => leg.expiry))).sort();
  const chains = expiries.map((expiry): SpxGexOptionChain => {
    const expiryLegs = legs.filter((leg) => leg.expiry === expiry);
    return {
      symbol: "SPX",
      spot: toNumber(data.current_price) ?? toNumber(data.price) ?? 0,
      expiries,
      selectedExpiry: expiry,
      calls: expiryLegs.filter((leg) => leg.side === "C"),
      puts: expiryLegs.filter((leg) => leg.side === "P"),
    };
  });
  const sample = rawOptions[0] || {};
  return {
    timestamp: payload.timestamp ?? null,
    dataKeys: Object.keys(data).sort(),
    rawOptionCount: rawOptions.length,
    parsedLegCount: legs.length,
    sampleKeys: Object.keys(sample).sort(),
    chainCompleteness: chainCompleteness(chains),
  };
};

const fetchCboeOnce = async (): Promise<ProbeAttempt> => {
  const start = performance.now();
  try {
    const response = await fetch(CBOE_URL, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    const text = await response.text();
    const latencyMs = Math.round(performance.now() - start);
    if (!response.ok) {
      return { source: "cboe", ok: false, status: response.status, latencyMs, bytes: text.length, contentType: response.headers.get("content-type"), error: text.slice(0, 240) };
    }
    const payload = JSON.parse(text) as Record<string, any>;
    return {
      source: "cboe",
      ok: true,
      status: response.status,
      latencyMs,
      bytes: text.length,
      contentType: response.headers.get("content-type"),
      summary: summarizeCboePayload(payload),
    };
  } catch (error) {
    return { source: "cboe", ok: false, latencyMs: Math.round(performance.now() - start), error: error instanceof Error ? error.message : String(error) };
  }
};

const fetchYahoo = async (): Promise<ProbeAttempt> => {
  const start = performance.now();
  try {
    const client = new NativeSpxGexYahooClient();
    const front = await client.getOptionsChain();
    const selectedExpiries = (front.expiries || []).slice(0, 5);
    const chains = await Promise.all(selectedExpiries.map((expiry) => client.getOptionsChain(expiry)));
    return {
      source: "yahoo",
      ok: true,
      latencyMs: Math.round(performance.now() - start),
      summary: {
        frontExpiry: front.selectedExpiry,
        spot: front.spot,
        chainCompleteness: chainCompleteness(chains),
      },
    };
  } catch (error) {
    return { source: "yahoo", ok: false, latencyMs: Math.round(performance.now() - start), error: error instanceof Error ? error.message : String(error) };
  }
};

const asCompleteness = (attempt: ProbeAttempt) => attempt.summary?.chainCompleteness as ReturnType<typeof chainCompleteness> | undefined;

const buildMarkdown = (attempts: ProbeAttempt[]) => {
  const cboeAttempts = attempts.filter((attempt) => attempt.source === "cboe");
  const yahooAttempts = attempts.filter((attempt) => attempt.source === "yahoo");
  const latestCboe = [...cboeAttempts].reverse().find((attempt) => attempt.ok);
  const latestYahoo = [...yahooAttempts].reverse().find((attempt) => attempt.ok);
  const cboe = latestCboe ? asCompleteness(latestCboe) : undefined;
  const yahoo = latestYahoo ? asCompleteness(latestYahoo) : undefined;
  const lines = [
    "# SPX GEX Source Probe",
    "",
    `Generated: ${nowIso()}`,
    "",
    "| Source | Attempts | Success | Avg latency ms | Payload bytes | Expiries | Legs | Strikes | OI present | IV present |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const source of ["cboe", "yahoo"] as const) {
    const group = attempts.filter((attempt) => attempt.source === source);
    const successful = group.filter((attempt) => attempt.ok);
    const latest = [...successful].reverse()[0];
    const completeness = latest ? asCompleteness(latest) : undefined;
    const fields = completeness?.fields as Record<string, { presentPct: number }> | undefined;
    lines.push([
      source,
      group.length,
      successful.length,
      group.length ? Math.round(group.reduce((sum, attempt) => sum + attempt.latencyMs, 0) / group.length) : 0,
      latest?.bytes ?? "n/a",
      completeness?.expiries ?? "n/a",
      completeness?.legs ?? "n/a",
      completeness?.strikes ?? "n/a",
      fields?.openInterest?.presentPct ?? "n/a",
      fields?.impliedVolatility?.presentPct ?? "n/a",
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  lines.push("");
  lines.push("## Current Decision");
  if (!latestCboe) {
    lines.push("- Decision: `do not integrate Cboe yet` because Cboe did not return a successful probe.");
  } else if (!latestYahoo) {
    lines.push("- Decision: `Cboe primary + Yahoo fallback` is plausible, but Yahoo comparison failed in this run so product integration still needs caution.");
  } else if (cboe && yahoo && cboe.expiries >= yahoo.expiries && cboe.legs > yahoo.legs && cboe.fields.openInterest.presentPct >= yahoo.fields.openInterest.presentPct) {
    lines.push("- Decision: `Cboe primary + Yahoo fallback` is supported by this probe. Cboe has broader delayed chain coverage and comparable OI completeness.");
  } else {
    lines.push("- Decision: `Yahoo primary + Cboe fallback` or `do not integrate Cboe yet`; Cboe did not clearly beat Yahoo on coverage/completeness.");
  }
  return lines.join("\n");
};

const main = async () => {
  const attempts: ProbeAttempt[] = [];
  for (let index = 0; index < 3; index += 1) {
    attempts.push(await fetchCboeOnce());
  }
  attempts.push(await fetchYahoo());

  const artifact = {
    generatedAt: nowIso(),
    cboeUrl: CBOE_URL,
    attempts,
  };
  await writeFile(".tmp/spx-gex-source-comparison.json", `${JSON.stringify(artifact, null, 2)}\n`);
  await writeFile(".tmp/spx-gex-source-comparison.md", `${buildMarkdown(attempts)}\n`);
  console.log(JSON.stringify(artifact, null, 2));
};

await main();
