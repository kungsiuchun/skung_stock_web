import {
  buildCandlestickPatternData,
  CANDLESTICK_INTERVALS,
  CandlestickDataError,
  type CandlestickInterval,
} from "../../src/lib/candlestick-patterns";
import { resolveMarketCache } from "../../src/lib/market-data-cache";
import type { D1DatabaseLike } from "../../src/lib/spx-recap-d1";

interface Env {
  MARKET_CACHE_DB?: D1DatabaseLike;
}

const INTERVAL_RANGE: Record<CandlestickInterval, string> = {
  "1d": "1y",
  "1wk": "5y",
  "1mo": "10y",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  },
});

const validSymbol = (value: unknown) => {
  const symbol = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9.^-]{1,16}$/.test(symbol)) throw new Error("Invalid stock symbol.");
  return symbol;
};

const validInterval = (value: unknown): CandlestickInterval => {
  const interval = String(value || "1d") as CandlestickInterval;
  if (!CANDLESTICK_INTERVALS.includes(interval)) throw new Error("Invalid interval. Use 1d, 1wk, or 1mo.");
  return interval;
};

const errorStatus = (error: unknown) => {
  if (!(error instanceof CandlestickDataError)) return 502;
  if (error.code === "INSUFFICIENT_BARS") return 422;
  return 502;
};

export async function onRequestGet(context: { request: Request; env: Env }) {
  const startedAt = Date.now();
  const url = new URL(context.request.url);
  let symbol: string;
  let interval: CandlestickInterval;
  try {
    symbol = validSymbol(url.searchParams.get("symbol"));
    interval = validInterval(url.searchParams.get("interval"));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }

  try {
    const resolved = await resolveMarketCache({
      db: context.env.MARKET_CACHE_DB,
      scope: "candlestick-patterns-v2",
      symbol,
      params: { interval },
      sourceAsOf: (value) => value.sourceAsOf,
      load: async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort("Yahoo Finance chart request exceeded 8 seconds."), 8_000);
        try {
          const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${INTERVAL_RANGE[interval]}&events=history`;
          const response = await fetch(yahooUrl, {
            headers: { "User-Agent": "Mozilla/5.0" },
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`Yahoo Finance chart request returned HTTP ${response.status}.`);
          let payload: unknown;
          try {
            payload = await response.json();
          } catch {
            throw new CandlestickDataError("MALFORMED_PAYLOAD", "Yahoo Finance chart response was not valid JSON.");
          }
          return buildCandlestickPatternData({ symbol, interval, payload });
        } finally {
          clearTimeout(timeout);
        }
      },
    });

    console.log(JSON.stringify({
      event: "candlestick_pattern_analysis",
      symbol,
      interval,
      status: "success",
      cacheStatus: resolved.cache.status,
      sourceAsOf: resolved.value.sourceAsOf,
      barCount: resolved.value.bars.length,
      rejectedBarCount: resolved.value.rejectedBarCount,
      partialBarExcluded: resolved.value.partialBarExcluded,
      latestPatternIds: resolved.value.analysis.latestMatches.map((match) => match.id),
      patternBias: resolved.value.analysis.patternBias,
      trendContext: resolved.value.analysis.trendContext,
      supportResistanceZoneCount: resolved.value.analysis.supportResistance.zones.length,
      durationMs: Date.now() - startedAt,
    }));
    return json({ data: resolved.value, cache: resolved.cache }, resolved.cache.status === "stale" ? 206 : 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({
      event: "candlestick_pattern_analysis",
      symbol,
      interval,
      status: "failed",
      errorClass: error instanceof Error ? error.name : "unknown",
      durationMs: Date.now() - startedAt,
    }));
    return json({ error: message }, errorStatus(error));
  }
}
