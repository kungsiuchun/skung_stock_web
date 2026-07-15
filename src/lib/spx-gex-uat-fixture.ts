import {
  buildSpxGexHeatmapFromOptionChains,
  type SpxGexOptionChain,
} from "./spx-gex-heatmap";

const UAT_GENERATED_AT = "2026-07-13T18:45:00.000Z";
const UAT_SPOT = 7523.96;
const UAT_EXPIRIES = ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-17", "2026-07-20"];
const UAT_STRIKES = Array.from({ length: 96 }, (_, index) => 7290 + index * 5);

const buildChain = (expiry: string, expiryIndex: number): SpxGexOptionChain => ({
  symbol: "SPX",
  spot: UAT_SPOT,
  expiries: UAT_EXPIRIES,
  selectedExpiry: expiry,
  source: {
    provider: "cboe",
    label: "Cboe delayed normalized UAT fixture",
    timestamp: "2026-07-13 14:45:00 ET",
  },
  calls: UAT_STRIKES.map((strike, strikeIndex) => ({
    contractSymbol: `SPX${expiry.slice(2).replace(/-/g, "")}C${String(strike * 1000).padStart(8, "0")}`,
    strike,
    lastPrice: Math.max(0.5, UAT_SPOT - strike + 12),
    bid: Math.max(0.25, UAT_SPOT - strike + 11.5),
    ask: Math.max(0.75, UAT_SPOT - strike + 12.5),
    volume: 700 + strikeIndex * 7 + expiryIndex * 40,
    openInterest: 2_500 + ((strikeIndex * 137 + expiryIndex * 503) % 18_000),
    impliedVolatility: 12.5 + expiryIndex * 0.8 + Math.abs(strike - UAT_SPOT) / 180,
  })),
  puts: UAT_STRIKES.map((strike, strikeIndex) => ({
    contractSymbol: `SPX${expiry.slice(2).replace(/-/g, "")}P${String(strike * 1000).padStart(8, "0")}`,
    strike,
    lastPrice: Math.max(0.5, strike - UAT_SPOT + 12),
    bid: Math.max(0.25, strike - UAT_SPOT + 11.5),
    ask: Math.max(0.75, strike - UAT_SPOT + 12.5),
    volume: 760 + strikeIndex * 5 + expiryIndex * 35,
    openInterest: 3_000 + (((95 - strikeIndex) * 149 + expiryIndex * 457) % 19_000),
    impliedVolatility: 14 + expiryIndex * 0.9 + Math.abs(strike - UAT_SPOT) / 165,
  })),
});

export const buildSpxGexUatFixture = () => buildSpxGexHeatmapFromOptionChains({
  generatedAt: UAT_GENERATED_AT,
  quoteText: "| Ticker | Last | Change | Change % |\n| SPX | $7,523.96 | -8.12 | -0.11% |",
  chains: UAT_EXPIRIES.map(buildChain),
  selectedExpiries: UAT_EXPIRIES,
  maxStrikes: UAT_STRIKES.length,
});
