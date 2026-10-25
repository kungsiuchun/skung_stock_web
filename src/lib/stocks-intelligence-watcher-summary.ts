import type { StocksWatcherExpiryRow, StocksWatcherSnapshot, StocksWatcherStrikeRow } from "./stocks-intelligence-watcher";

export interface StocksWatcherAiSummaryPayload {
  symbol: string;
  quote: {
    price: number;
    change: number | null;
    changePercent: number | null;
    asOf: string | null;
  };
  selectedExpiry: string | null;
  source: StocksWatcherSnapshot["source"];
  generatedAt: string;
  gexRegime: string;
  putCallOpenInterest: number | null;
  putCallVolume: number | null;
  sweeps: number | null;
  dominantExpiryRow: StocksWatcherExpiryRow | null;
  netGexTotal: number | null;
  callOpenInterestTotal: number | null;
  putOpenInterestTotal: number | null;
  topAbsGexStrikes: {
    strike: number;
    netGex: number;
    callOpenInterest: number;
    putOpenInterest: number;
  }[];
  marketBreadth: string;
}

export interface StocksWatcherAiSummaryResponse {
  headline: string;
  whatItTellsUs: string[];
  whyItMatters: string[];
  howToAct: string[];
  caveats: string[];
  model: string;
  generatedAt: string;
}

export const STOCKS_WATCHER_AI_SUMMARY_LIMITS = {
  bullets: 4,
  text: 220,
  strikes: 5,
};

const finiteNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const trimText = (value: unknown, fallback: string) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, STOCKS_WATCHER_AI_SUMMARY_LIMITS.text);
};

const normalizeMarketBreadthText = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) return "Market breadth unavailable.";

  // Tool output can be Markdown tables. The summary is a bullet list, so a raw table
  // becomes unreadable there and must not be passed through as prose.
  if (raw.split(/\r?\n/).some((line) => line.includes("|"))) {
    return "Market breadth data is available from the selected snapshot; use it as secondary confirmation.";
  }

  return trimText(raw.replace(/^#{1,6}\s*/gm, ""), "Market breadth unavailable.");
};

export const buildStocksWatcherAiSummaryPayload = (
  snapshot: StocksWatcherSnapshot,
  options: {
    selectedExpiry?: string | null;
    strikeRows?: StocksWatcherStrikeRow[];
    marketBreadth?: string | null;
  } = {},
): StocksWatcherAiSummaryPayload => {
  const selectedExpiry = options.selectedExpiry || snapshot.selectedExpiry || snapshot.availableExpiries?.[0] || null;
  const strikeRows = options.strikeRows?.length ? options.strikeRows : snapshot.strikes;
  const dominantExpiryRow = snapshot.expiryRows.find((row) => row.expiry === selectedExpiry) || snapshot.expiryRows[0] || null;
  const total = (key: "callOpenInterest" | "putOpenInterest" | "netGex") => strikeRows.length && strikeRows.every(row => finiteNumber(row[key]) !== null) ? strikeRows.reduce((sum, row) => sum + row[key], 0) : null;
  const callOpenInterestTotal = total("callOpenInterest");
  const putOpenInterestTotal = total("putOpenInterest");
  const netGexTotal = total("netGex");
  const topAbsGexStrikes = [...strikeRows]
    .filter(row => [row.strike, row.netGex, row.callOpenInterest, row.putOpenInterest].every(value => finiteNumber(value) !== null))
    .sort((a, b) => Math.abs(b.netGex) - Math.abs(a.netGex))
    .slice(0, STOCKS_WATCHER_AI_SUMMARY_LIMITS.strikes)
    .map((row) => ({
      strike: row.strike,
      netGex: row.netGex,
      callOpenInterest: row.callOpenInterest,
      putOpenInterest: row.putOpenInterest,
    }));

  return {
    symbol: snapshot.symbol,
    quote: {
      price: snapshot.quote.price,
      change: finiteNumber(snapshot.quote.change),
      changePercent: finiteNumber(snapshot.quote.changePercent),
      asOf: snapshot.quote.asOf || null,
    },
    selectedExpiry,
    source: snapshot.source,
    generatedAt: snapshot.generatedAt,
    gexRegime: snapshot.gexRegime,
    putCallOpenInterest: finiteNumber(snapshot.putCallOpenInterest),
    putCallVolume: finiteNumber(snapshot.putCallVolume),
    sweeps: finiteNumber(snapshot.sweeps),
    dominantExpiryRow,
    netGexTotal,
    callOpenInterestTotal,
    putOpenInterestTotal,
    topAbsGexStrikes,
    marketBreadth: normalizeMarketBreadthText(options.marketBreadth || snapshot.marketContext.breadth),
  };
};

export const getStocksWatcherAiSummaryCacheKey = (payload: StocksWatcherAiSummaryPayload) =>
  [
    payload.symbol,
    payload.selectedExpiry || "front",
    payload.generatedAt,
    payload.source,
    payload.netGexTotal === null ? "unavailable" : Math.round(payload.netGexTotal),
    payload.putCallOpenInterest === null ? "unavailable" : Math.round(payload.putCallOpenInterest * 100),
  ].join(":");

export const buildStocksWatcherDeterministicSummary = (
  payload: StocksWatcherAiSummaryPayload,
): StocksWatcherAiSummaryResponse => {
  if (payload.netGexTotal === null) return {
    headline: `${payload.symbol} options evidence is unavailable.`,
    whatItTellsUs: ["The source did not provide complete GEX inputs; positioning and pinning cannot be concluded."],
    whyItMatters: ["Missing option metrics cannot be treated as zero exposure."],
    howToAct: ["Check the available price and option-chain evidence; this is not a standalone buy or sell trigger."],
    caveats: ["Sweep detection is unavailable from this snapshot."],
    model: "deterministic-rules", generatedAt: payload.quote.asOf || payload.generatedAt,
  };
  const negativeGamma = payload.netGexTotal < 0 || /ampl/i.test(payload.gexRegime);
  const dominantType = payload.dominantExpiryRow?.dominantType === "P" ? "put" : payload.dominantExpiryRow?.dominantType === "C" ? "call" : "unavailable";
  const largestStrike = payload.topAbsGexStrikes[0];
  const topStrikeText = payload.topAbsGexStrikes.slice(0, 3).map((row) => row.strike).join(", ");
  const sweepText = payload.sweeps === null ? "sweep detection unavailable" : payload.sweeps > 0 ? `${payload.sweeps} sweep alert${payload.sweeps === 1 ? "" : "s"}` : "no sweep alerts";
  const sourceTime = payload.quote.asOf || payload.generatedAt;

  return {
    headline: `${payload.symbol} options tape shows ${negativeGamma ? "amplifying" : "pinning"} pressure around ${payload.selectedExpiry || "the front expiry"}.`,
    whatItTellsUs: [
      `Net GEX is ${payload.netGexTotal >= 0 ? "positive" : "negative"} across the visible strikes, so dealer hedging pressure is ${negativeGamma ? "less stabilizing" : "more stabilizing"}.`,
      `P/C open interest is ${payload.putCallOpenInterest?.toFixed(2) ?? "unavailable"} and P/C volume is ${payload.putCallVolume?.toFixed(2) ?? "unavailable"}; dominant interest in the selected expiry is ${dominantType}.`,
      largestStrike ? `The largest visible GEX concentration is near ${largestStrike.strike}; top watched strikes are ${topStrikeText}.` : "No strike concentration is available in the compact payload.",
      `Current options tape shows ${sweepText}.`,
    ],
    whyItMatters: [
      "GEX concentration marks where hedging can dampen or accelerate intraday moves.",
      "P/C ratios and expiry concentration show whether downside or upside positioning dominates the visible option chain.",
      `Market context: ${payload.marketBreadth}`,
    ],
    howToAct: [
      "Watch whether spot moves toward the largest GEX strike before treating the signal as useful.",
      "Compare the options signal with price action and market breadth before changing exposure.",
      "Use this as a risk map, not a standalone buy or sell trigger.",
    ],
    caveats: [
      `Source is ${payload.source}; delayed or fallback data can weaken interpretation.`,
      "Yahoo option-chain data does not include full tape-level options flow.",
    ],
    model: "deterministic-rules",
    generatedAt: sourceTime,
  };
};
