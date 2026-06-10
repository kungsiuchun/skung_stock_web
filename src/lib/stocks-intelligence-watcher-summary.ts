import type { StocksWatcherExpiryRow, StocksWatcherSnapshot, StocksWatcherStrikeRow } from "./stocks-intelligence-watcher";

export interface StocksWatcherAiSummaryPayload {
  symbol: string;
  quote: {
    price: number;
    change: number;
    changePercent: number;
    asOf: string | null;
  };
  selectedExpiry: string | null;
  source: StocksWatcherSnapshot["source"];
  generatedAt: string;
  gexRegime: string;
  putCallOpenInterest: number;
  putCallVolume: number;
  sweeps: number;
  dominantExpiryRow: StocksWatcherExpiryRow | null;
  netGexTotal: number;
  callOpenInterestTotal: number;
  putOpenInterestTotal: number;
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

const finiteNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const trimText = (value: unknown, fallback: string) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, STOCKS_WATCHER_AI_SUMMARY_LIMITS.text);
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
  const callOpenInterestTotal = strikeRows.reduce((sum, row) => sum + finiteNumber(row.callOpenInterest), 0);
  const putOpenInterestTotal = strikeRows.reduce((sum, row) => sum + finiteNumber(row.putOpenInterest), 0);
  const netGexTotal = strikeRows.reduce((sum, row) => sum + finiteNumber(row.netGex), 0);
  const topAbsGexStrikes = [...strikeRows]
    .sort((a, b) => Math.abs(finiteNumber(b.netGex)) - Math.abs(finiteNumber(a.netGex)))
    .slice(0, STOCKS_WATCHER_AI_SUMMARY_LIMITS.strikes)
    .map((row) => ({
      strike: finiteNumber(row.strike),
      netGex: finiteNumber(row.netGex),
      callOpenInterest: finiteNumber(row.callOpenInterest),
      putOpenInterest: finiteNumber(row.putOpenInterest),
    }));

  return {
    symbol: snapshot.symbol,
    quote: {
      price: finiteNumber(snapshot.quote.price),
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
    marketBreadth: trimText(options.marketBreadth || snapshot.marketContext.breadth, "Market breadth unavailable."),
  };
};

export const getStocksWatcherAiSummaryCacheKey = (payload: StocksWatcherAiSummaryPayload) =>
  [
    payload.symbol,
    payload.selectedExpiry || "front",
    payload.generatedAt,
    payload.source,
    Math.round(payload.netGexTotal),
    Math.round(payload.putCallOpenInterest * 100),
  ].join(":");

export const buildStocksWatcherDeterministicSummary = (
  payload: StocksWatcherAiSummaryPayload,
): StocksWatcherAiSummaryResponse => {
  const negativeGamma = payload.netGexTotal < 0 || /ampl/i.test(payload.gexRegime);
  const dominantType = payload.dominantExpiryRow?.dominantType === "P" ? "put" : "call";
  const largestStrike = payload.topAbsGexStrikes[0];
  const topStrikeText = payload.topAbsGexStrikes.slice(0, 3).map((row) => row.strike).join(", ");
  const sweepText = payload.sweeps > 0 ? `${payload.sweeps} sweep alert${payload.sweeps === 1 ? "" : "s"}` : "no sweep alerts";
  const sourceTime = payload.quote.asOf || payload.generatedAt;

  return {
    headline: `${payload.symbol} options tape shows ${negativeGamma ? "amplifying" : "pinning"} pressure around ${payload.selectedExpiry || "the front expiry"}.`,
    whatItTellsUs: [
      `Net GEX is ${payload.netGexTotal >= 0 ? "positive" : "negative"} across the visible strikes, so dealer hedging pressure is ${negativeGamma ? "less stabilizing" : "more stabilizing"}.`,
      `P/C open interest is ${payload.putCallOpenInterest.toFixed(2)} and P/C volume is ${payload.putCallVolume.toFixed(2)}, with ${dominantType} interest leading the selected expiry row.`,
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
