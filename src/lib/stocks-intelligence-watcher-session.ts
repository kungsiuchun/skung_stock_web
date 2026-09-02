import type {
  StocksWatcherSnapshot,
  StocksWatcherSnapshotCacheEntry,
} from "./stocks-intelligence-watcher";
import type { StocksWatcherUniverseStock } from "./stocks-watcher-universe";

export type StocksWatcherTopTab =
  | "Overview"
  | "Chart"
  | "Fundamentals"
  | "Stats"
  | "Earnings"
  | "Options"
  | "Short Vol"
  | "News"
  | "Holders";

export type StocksWatcherOptionsSubTab =
  | "Overview"
  | "Greeks"
  | "DEX"
  | "Flow"
  | "IV"
  | "Mis$"
  | "P/C"
  | "Chain"
  | "Sweeps"
  | "0DTE";

export const STOCKS_WATCHER_PRICE_RANGES = ["1mo", "3mo", "1y"] as const;
export type StocksWatcherPriceRange = (typeof STOCKS_WATCHER_PRICE_RANGES)[number];

export interface StocksWatcherToolCallPlan {
  name: string;
  params: Record<string, unknown>;
}

export interface StocksWatcherSnapshotLoadDecision {
  symbol: string;
  skip: boolean;
  cached: StocksWatcherSnapshotCacheEntry | null;
  backgroundRefresh: boolean;
}

const normalizeSessionSymbol = (symbol: string) => symbol.trim().toUpperCase();

export const STOCKS_WATCHER_YAHOO_EXPIRY_PRELOAD_LIMIT = 8;

export const normalizeWatcherExpiryForYahoo = (expiry: string | null | undefined) => {
  if (!expiry) return undefined;
  if (/^\d{2}-\d{2}-\d{2}$/.test(expiry)) return `20${expiry}`;
  return expiry;
};

export const getStocksWatcherTopTabCacheKey = (
  symbol: string,
  tab: StocksWatcherTopTab,
  priceRange?: StocksWatcherPriceRange,
) => `${normalizeSessionSymbol(symbol)}:${tab}${tab === "Chart" ? `:${priceRange || "3mo"}` : ""}`;

export const getStocksWatcherOptionsSubTabCacheKey = (
  symbol: string,
  expiry: string | null | undefined,
  subTab: StocksWatcherOptionsSubTab,
) => `${normalizeSessionSymbol(symbol)}:${normalizeWatcherExpiryForYahoo(expiry) || "front"}:${subTab}`;

export const getStocksWatcherYahooExpiryChainCacheKey = (
  symbol: string,
  expiry: string | null | undefined,
) => `${normalizeSessionSymbol(symbol)}:${normalizeWatcherExpiryForYahoo(expiry) || "front"}:YahooOptionsChain`;

export const getStocksWatcherYahooExpiryPreloadTargets = (
  availableExpiries: readonly string[] | null | undefined,
  limit = STOCKS_WATCHER_YAHOO_EXPIRY_PRELOAD_LIMIT,
) => Array.from(new Set(
  (availableExpiries || [])
    .map(normalizeWatcherExpiryForYahoo)
    .filter((expiry): expiry is string => Boolean(expiry && /^\d{4}-\d{2}-\d{2}$/.test(expiry))),
)).sort().slice(0, Math.max(0, limit));

export const getStocksWatcherTopTabToolPlan = (
  tab: StocksWatcherTopTab,
  symbol: string,
  priceRange: StocksWatcherPriceRange = "3mo",
): StocksWatcherToolCallPlan[] => {
  const ticker = normalizeSessionSymbol(symbol);
  if (tab === "Overview") return [];
  if (tab === "Chart") return [{ name: "get_stock_history", params: { ticker, range: priceRange, interval: "1d" } }];
  if (tab === "Fundamentals") return [{ name: "get_stock_stats", params: { ticker } }];
  if (tab === "Stats") return [
    { name: "get_stock_stats", params: { ticker } },
    { name: "get_beta", params: { ticker } },
  ];
  if (tab === "Earnings") return [
    { name: "earnings_vol_crush", params: { ticker } },
    { name: "historical_context", params: { ticker, event: "earnings" } },
  ];
  if (tab === "Short Vol") return [
    { name: "get_options_pcr", params: { ticker } },
    { name: "signal_scan", params: { ticker } },
  ];
  if (tab === "News") return [
    { name: "morning_briefing", params: { ticker } },
    { name: "pre_event_brief", params: { ticker } },
  ];
  if (tab === "Holders") return [{ name: "get_sector_top_holdings", params: { ticker } }];
  return [];
};

export const getStocksWatcherOptionsSubTabToolPlan = (
  subTab: StocksWatcherOptionsSubTab,
  symbol: string,
  expiry?: string | null,
): StocksWatcherToolCallPlan[] => {
  const ticker = normalizeSessionSymbol(symbol);
  const expiryArg = normalizeWatcherExpiryForYahoo(expiry);
  if (subTab === "Greeks") return [
    { name: "get_options_greeks", params: { ticker, expiry: expiryArg } },
    { name: "chart_greeks", params: { ticker, expiry: expiryArg } },
  ];
  if (subTab === "DEX") return [
    { name: "get_options_dex", params: { ticker, expiry: expiryArg } },
    { name: "chart_dex", params: { ticker, expiry: expiryArg } },
  ];
  if (subTab === "Flow") return [{ name: "get_options_flow_universe", params: { ticker } }];
  if (subTab === "IV") return [{ name: "get_options_iv_intraday", params: { ticker, expiry: expiryArg } }];
  if (subTab === "Mis$") return [{ name: "get_options_mispricing", params: { ticker, expiry: expiryArg } }];
  if (subTab === "P/C") return [{ name: "get_options_pcr", params: { ticker, expiry: expiryArg } }];
  if (subTab === "Chain") return [{ name: "get_options", params: { ticker, expiry: expiryArg, strikesAroundAtm: 40 } }];
  if (subTab === "Sweeps") return [{ name: "get_options_sweeps", params: { ticker } }];
  if (subTab === "0DTE") return [{ name: "get_options_0dte", params: { ticker } }];
  return [];
};

export const getStocksWatcherExpiryOverviewToolPlan = (
  symbol: string,
  expiry: string | null | undefined,
): StocksWatcherToolCallPlan[] => {
  const ticker = normalizeSessionSymbol(symbol);
  const expiryArg = normalizeWatcherExpiryForYahoo(expiry);
  return [
    { name: "get_options", params: { ticker, expiry: expiryArg, strikesAroundAtm: 40 } },
    { name: "get_options_gex", params: { ticker, expiry: expiryArg, topRows: 24 } },
    { name: "get_options_pcr", params: { ticker, expiry: expiryArg } },
  ];
};

export const getStocksWatcherYahooExpirySummaryToolPlan = (
  symbol: string,
  expiry: string | null | undefined,
): StocksWatcherToolCallPlan => {
  const ticker = normalizeSessionSymbol(symbol);
  return {
    name: "get_options",
    params: { ticker, expiry: normalizeWatcherExpiryForYahoo(expiry), strikesAroundAtm: 40 },
  };
};

export const getStocksWatcherStrikeDetailToolPlan = (
  symbol: string,
  expiry: string | null | undefined,
  strike: number,
): StocksWatcherToolCallPlan[] => {
  const ticker = normalizeSessionSymbol(symbol);
  const expiryArg = normalizeWatcherExpiryForYahoo(expiry);
  return [
    { name: "get_options_greeks", params: { ticker, expiry: expiryArg, strike } },
    { name: "get_options_iv_intraday", params: { ticker, expiry: expiryArg, strike } },
    { name: "get_options_mispricing", params: { ticker, expiry: expiryArg, strike } },
  ];
};

export const getStocksWatcherSnapshotExpiry = (snapshot: StocksWatcherSnapshot) =>
  snapshot.selectedExpiry || snapshot.availableExpiries?.[0] || snapshot.expiries?.[0]?.expiry || null;

export const getStocksWatcherSnapshotLoadDecision = (input: {
  requestedSymbol: string;
  selectedSymbol: string;
  loadingSymbol: string | null;
  cached: StocksWatcherSnapshotCacheEntry | null;
  force?: boolean;
}): StocksWatcherSnapshotLoadDecision => {
  const symbol = normalizeSessionSymbol(input.requestedSymbol);
  const isCurrentLoad = input.loadingSymbol === symbol && normalizeSessionSymbol(input.selectedSymbol) === symbol;
  if (!symbol || isCurrentLoad) {
    return { symbol, skip: true, cached: null, backgroundRefresh: false };
  }

  const cached = input.force ? null : input.cached;
  if (!cached) return { symbol, skip: false, cached: null, backgroundRefresh: false };

  return {
    symbol,
    skip: false,
    cached,
    backgroundRefresh: normalizeSessionSymbol(cached.snapshot.symbol) !== normalizeSessionSymbol(input.selectedSymbol),
  };
};

export const getStocksWatcherCustomStockFromSnapshot = (
  snapshot: StocksWatcherSnapshot,
  curatedStock: StocksWatcherUniverseStock | null | undefined,
): StocksWatcherUniverseStock | null => {
  if (curatedStock) return null;
  return {
    symbol: snapshot.symbol,
    companyName: snapshot.quote.companyName || `${snapshot.symbol} custom stock`,
    sector: "Custom",
    type: "Stock",
    fallbackPrice: snapshot.quote.price,
    fallbackChange: snapshot.quote.change,
    fallbackChangePercent: snapshot.quote.changePercent,
  };
};
