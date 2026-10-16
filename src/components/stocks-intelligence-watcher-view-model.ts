import type { StocksWatcherChartMode, StocksWatcherExpiryRow, StocksWatcherSnapshot, StocksWatcherStrikeRow } from "@/lib/stocks-intelligence-watcher";
import type { StocksWatcherPriceRange } from "@/lib/stocks-intelligence-watcher-session";
import type { StocksWatcherUniverseStock } from "@/lib/stocks-watcher-universe";
import { normalizeOptionsVisualModel } from "@/lib/stocks-watcher-options-visual";
import type { FearGreedSnapshot } from "@/lib/fear-greed";
import type { MarketCacheMetadata } from "@/lib/market-data-cache";
import type { WatcherFinancialQuarter, WatcherFinancialSource, WatcherFinancialStatements, WatcherValuationMetric } from "@/lib/stocks-watcher-valuation-data";

type ToolStatus = "ok" | "failed" | "running";
const CUSTOM_STOCKS_STORAGE_KEY = "stocks-intelligence-custom-stocks";
const FAVORITES_MEMORY_KEY = "stocks-intelligence-favorites";
const MARKET_INDEX_DEFINITIONS: MarketIndexDefinition[] = [
  { symbol: "SPX", yahooSymbol: "^GSPC", label: "S&P 500" },
  { symbol: "NDX", yahooSymbol: "^NDX", label: "NASDAQ 100" },
  { symbol: "DJI", yahooSymbol: "^DJI", label: "DOW JONES" },
];
export const VALUATION_METRIC_LABEL: Record<WatcherValuationMetric, string> = {
  pe: "P/E",
  fcf: "P/FCF",
  ps: "P/S",
};

export interface NativeToolResult {
  tool: string;
  params: Record<string, unknown>;
  text: string;
  raw: unknown;
  error?: string;
}

export interface ToolRunLogEntry {
  id: string;
  name: string;
  params: Record<string, unknown>;
  status: ToolStatus;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  payload?: unknown;
  error?: string;
}

export interface TabCacheEntry {
  data: Record<string, NativeToolResult>;
  fetchedAt: number;
}

export interface AsyncPanelState {
  loading: boolean;
  error: string | null;
  data: Record<string, NativeToolResult> | null;
}

export interface FearGreedPanelState {
  loading: boolean;
  error: string | null;
  data: FearGreedSnapshot | null;
  cache: MarketCacheMetadata | null;
}

export interface ChartGexAggregateRow {
  strike: number;
  netGex: number;
  contributors: number;
}

export interface SharedPriceAxisRange {
  min: number;
  max: number;
}

/**
 * Strike coordinates are relative to the price card, never the browser
 * viewport. This makes a chart/profile pair stable while its parent scrolls.
 */
export interface SharedPriceAxisCoordinates {
  [strike: string]: number;
}

export interface YahooExpiryPreloadState {
  runId: number;
  total: number;
  loaded: number;
  failed: number;
  complete: boolean;
}

export interface StrikeDrawerState {
  open: boolean;
  strike: number | null;
  expiry: string | null;
  loading?: boolean;
  error?: string | null;
  data?: Record<string, NativeToolResult> | null;
}

export type ModalState =
  | { type: null; data?: null }
  | { type: "runTool"; data: { toolName: string; paramsText: string; result?: NativeToolResult; loading?: boolean; error?: string | null } };

export interface MarketIndexDefinition {
  symbol: string;
  yahooSymbol: string;
  label: string;
}

export interface MarketIndexCard {
  symbol: string;
  sourceSymbol: string;
  label: string;
  status: "ok" | "unavailable";
  value: number;
  change: number;
  changePercent: number;
  historyPointCount: number;
  error?: string;
  history: RawHistoryPoint[];
}

export interface MarketContextState {
  loading: boolean;
  error: string | null;
  regime: NativeToolResult | null;
  breadth: NativeToolResult | null;
  sectorStats: NativeToolResult | null;
  sectorTopHoldings: NativeToolResult | null;
  indices: MarketIndexCard[];
}

export interface ApprovedUniverseRegime {
  regime: "risk_on" | "risk_off" | "mixed";
  advancers: number;
  avgChange: number;
  universeCount: number;
}

export interface ApprovedUniverseHolding {
  symbol: string;
  sector: string;
  price: number;
  changePercent: number;
  volume: number;
}

export interface RawOptionLeg {
  strike?: number;
  bid?: number;
  ask?: number;
  lastPrice?: number;
  mark?: number;
  volume?: number;
  openInterest?: number;
  impliedVolatility?: number;
  contractSymbol?: string;
}

export interface RawOptionChain {
  spot?: number;
  selectedExpiry?: string | null;
  expiries?: string[];
  calls?: RawOptionLeg[];
  puts?: RawOptionLeg[];
}

export interface ExpirySelectorRow {
  expiry: string;
  loaded: boolean;
  openInterest?: number;
  primaryStrike?: number;
  volume?: number;
  dominantType?: "C" | "P";
  netGex?: number;
  netDex?: number;
}

export interface RawOptionExposure {
  strike?: number;
  callGex?: number;
  putGex?: number;
  netGex?: number;
  callDex?: number;
  putDex?: number;
  netDex?: number;
  avgIv?: number;
  callIv?: number;
  putIv?: number;
  callOpenInterest?: number;
  putOpenInterest?: number;
  callVolume?: number;
  putVolume?: number;
  callEffectiveOpenInterest?: number;
  putEffectiveOpenInterest?: number;
  openInterestSource?: string;
  call?: RawOptionLeg;
  put?: RawOptionLeg;
}

export interface RawHistoryPoint {
  date?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
}

export interface SparklinePoint {
  label: string;
  dateTimeLabel?: string;
  rangeLabel?: string;
  granularityLabel?: string;
  value: number;
  source?: string;
}

export interface SparklineTooltipPosition {
  left: number;
  top: number;
  alignRight: boolean;
}

export interface RawQuoteRow {
  symbol?: string;
  name?: string;
  price?: number;
  change?: number;
  changePercent?: number;
  volume?: number;
}

export const formatNumber = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
};

export const formatOptionalSignedExposure = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
};

export const currency = (value: number) =>
  `$${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

export const quoteDirection = (change: number | null | undefined, changePercent: number | null | undefined) => {
  if (typeof change === "number" && Number.isFinite(change) && change !== 0) return change > 0 ? 1 : -1;
  if (typeof changePercent === "number" && Number.isFinite(changePercent) && changePercent !== 0) return changePercent > 0 ? 1 : -1;
  return 0;
};

export const signedNumberText = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
export const directionArrow = (direction: number) => direction > 0 ? "▲" : direction < 0 ? "▼" : "";

export const formatOptionalPrice = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })
    : "N/A";

export const formatSignedPercent = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
    : "N/A";

export const formatOptionalNumber = (value: number | null | undefined, digits = 2) =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "N/A";

/** Regular US equities session only. The exchange timezone handles DST correctly. */
export const getUsEquitiesMarketStatus = (timestamp: number) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value || "";
  const weekday = part("weekday");
  const minutesSinceMidnight = Number(part("hour")) * 60 + Number(part("minute"));
  const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
  const isOpen = isWeekday && minutesSinceMidnight >= 9 * 60 + 30 && minutesSinceMidnight < 16 * 60;
  return { label: isOpen ? "Open" : "Closed", isOpen };
};

export const formatNewsTimestamp = (value: string | null | undefined) => {
  if (!value) return "Yahoo";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date(parsed));
};

export const formatIndexValue = (value: number) =>
  value > 0 ? value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : "--";

export const formatSparklineDateTime = (value: string | undefined, fallback: string, mode: "date" | "dateTime" = "date") => {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  const options: Intl.DateTimeFormatOptions = mode === "dateTime"
    ? { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }
    : { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" };
  return `${new Intl.DateTimeFormat("en-US", options).format(new Date(parsed))}${mode === "dateTime" ? " ET" : ""}`;
};

export const dateFromAsOfAndSessionLabel = (asOf: string | null | undefined, label: string | undefined) => {
  if (!asOf || !label) return null;
  const baseDate = Date.parse(asOf);
  if (!Number.isFinite(baseDate)) return null;
  const timeMatch = label.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!timeMatch) return new Date(baseDate).toISOString();
  let hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2] || 0);
  const suffix = timeMatch[3]?.toUpperCase();
  if (suffix === "PM" && hours < 12) hours += 12;
  if (suffix === "AM" && hours === 12) hours = 0;
  const date = new Date(baseDate);
  date.setUTCHours(hours + 4, minutes, 0, 0);
  return date.toISOString();
};

export const formatQuoteAsOf = (asOf: string | null | undefined) => {
  if (!asOf) return "loading";
  const parsed = Date.parse(asOf);
  if (!Number.isFinite(parsed)) return asOf;
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date(parsed));
};

export const normalizeExpiryDate = (expiry: string | null | undefined) => {
  if (!expiry) return "";
  if (/^\d{2}-\d{2}-\d{2}$/.test(expiry)) return `20${expiry}`;
  return expiry;
};

export const formatExpiryDate = (expiry: string | null | undefined, style: "compact" | "short" | "long" = "short") => {
  const normalized = normalizeExpiryDate(expiry);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized || "--";
  if (style === "compact") return normalized.slice(2);
  const date = new Date(`${normalized}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", style === "long"
    ? { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }
    : { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
};

export const toYahooExpiry = (expiry: string | null | undefined) => {
  if (!expiry) return undefined;
  if (/^\d{2}-\d{2}-\d{2}$/.test(expiry)) return `20${expiry}`;
  return expiry;
};

export const modeLabel: Record<StocksWatcherChartMode, string> = {
  oi: "Open Interest",
  volume: "Options Volume",
  gex: "Option GEX",
};

export const priceRangeLabel: Record<StocksWatcherPriceRange, string> = {
  "1mo": "1M",
  "3mo": "3M",
  "1y": "1Y",
};

export const getMaxForMode = (rows: StocksWatcherStrikeRow[], mode: StocksWatcherChartMode) =>
  Math.max(
    1,
    ...rows.flatMap((row) => {
      if (mode === "oi") return [row.callOpenInterest, row.putOpenInterest];
      if (mode === "volume") return [row.callVolume, row.putVolume];
      return [Math.abs(row.callGex), Math.abs(row.putGex)];
    }),
  );

export const getCallValue = (row: StocksWatcherStrikeRow, mode: StocksWatcherChartMode) => {
  if (mode === "oi") return row.callOpenInterest;
  if (mode === "volume") return row.callVolume;
  return row.callGex;
};

export const getPutValue = (row: StocksWatcherStrikeRow, mode: StocksWatcherChartMode) => {
  if (mode === "oi") return row.putOpenInterest;
  if (mode === "volume") return row.putVolume;
  return row.putGex;
};

export const chartMetricLabel: Record<StocksWatcherChartMode, string> = {
  oi: "Open Interest",
  volume: "Volume",
  gex: "Gamma Exposure",
};

export interface ChartTooltipState {
  strike: number;
  callValue: number;
  putValue: number;
  netGex: number;
  x: number;
  y: number;
}

export const normalizeSymbol = (symbol: string) => symbol.trim().toUpperCase();
export const sanitizeSymbols = (symbols: string[]) =>
  Array.from(new Set(symbols.map(normalizeSymbol).filter((symbol) => /^[A-Z0-9.^-]{1,12}$/.test(symbol))));

export const readStoredSymbols = (key: string, fallback: string[]) => {
  if (typeof window === "undefined") return fallback;

  try {
    const saved = window.localStorage.getItem(key);
    return saved ? JSON.parse(saved) as string[] : fallback;
  } catch {
    return fallback;
  }
};

export const uniqueStocks = (stocks: StocksWatcherUniverseStock[]) => {
  const bySymbol = new Map<string, StocksWatcherUniverseStock>();
  for (const stock of stocks) {
    const symbol = normalizeSymbol(stock.symbol);
    if (!symbol || bySymbol.has(symbol)) continue;
    bySymbol.set(symbol, { ...stock, symbol });
  }
  return Array.from(bySymbol.values());
};

export const stockFromRecord = (record: Record<string, unknown>, fallback?: StocksWatcherUniverseStock) => {
  const symbol = typeof record.symbol === "string" ? normalizeSymbol(record.symbol) : fallback?.symbol || "";
  if (!symbol || !/^[A-Z0-9.^-]{1,12}$/.test(symbol)) return null;
  return {
    symbol,
    companyName: typeof record.companyName === "string" ? record.companyName : fallback?.companyName || `${symbol} custom stock`,
    sector: typeof record.sector === "string" ? record.sector : fallback?.sector || "Custom",
    type: record.type === "ETF" || record.type === "ADR" || record.type === "Stock" ? record.type : fallback?.type || "Stock",
    fallbackPrice: typeof record.fallbackPrice === "number" ? record.fallbackPrice : fallback?.fallbackPrice ?? Number.NaN,
    fallbackChange: typeof record.fallbackChange === "number" ? record.fallbackChange : fallback?.fallbackChange ?? Number.NaN,
    fallbackChangePercent: typeof record.fallbackChangePercent === "number" ? record.fallbackChangePercent : fallback?.fallbackChangePercent ?? Number.NaN,
  } satisfies StocksWatcherUniverseStock;
};

export const readStoredCustomStocks = () => {
  if (typeof window === "undefined") return [];
  try {
    const saved = window.localStorage.getItem(CUSTOM_STOCKS_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => item && typeof item === "object" && !Array.isArray(item) ? stockFromRecord(item as Record<string, unknown>) : null)
      .filter((stock): stock is StocksWatcherUniverseStock => Boolean(stock));
  } catch {
    return [];
  }
};

export const stringifyPayload = (payload: unknown) => {
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
};

export const chunkSymbols = (symbols: string[], size: number) => {
  const chunks: string[][] = [];
  for (let index = 0; index < symbols.length; index += size) {
    chunks.push(symbols.slice(index, index + size));
  }
  return chunks;
};

export const parseWatchlistStocks = (result: NativeToolResult): StocksWatcherUniverseStock[] => {
  const raw = result.raw && typeof result.raw === "object" && !Array.isArray(result.raw)
    ? result.raw as Record<string, unknown>
    : {};
  const stocks = Array.isArray(raw.stocks) ? raw.stocks : [];
  const parsedStocks = stocks
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const symbol = typeof record.symbol === "string" ? normalizeSymbol(record.symbol) : "";
      if (!symbol) return null;
      return stockFromRecord(record);
    })
    .filter((stock): stock is StocksWatcherUniverseStock => Boolean(stock));

  if (parsedStocks.length > 0) return parsedStocks;

  return [];
};

export const resultLooksHtml = (result: NativeToolResult | undefined) =>
  Boolean(result?.tool.startsWith("chart_") || /<html|<body|<div|<svg|<!doctype/i.test(result?.text || ""));

export const htmlSrcDoc = (result: NativeToolResult) => {
  if (/<html|<body|<!doctype/i.test(result.text)) return result.text;
  return `<!doctype html><html><body style="margin:0;background:#020617;color:#e2e8f0;font-family:Inter,system-ui,sans-serif"><pre style="white-space:pre-wrap;padding:16px">${result.text.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char] || char)}</pre></body></html>`;
};

export const rawRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export const rawNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%]/g, "").replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

export const rawNullableNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,%]/g, "").replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const rawNullableString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export const financialStatementsFromResult = (result: NativeToolResult | undefined): WatcherFinancialStatements | null => {
  const body = rawRecord(result?.raw);
  const financialSourceRaw = rawRecord(body?.financialSource);
  const rawQuarters = Array.isArray(body?.quarters) ? body.quarters : null;
  const source = rawNullableString(financialSourceRaw?.source);
  const sourceType = rawNullableString(financialSourceRaw?.sourceType);
  const fetchedAt = rawNullableString(financialSourceRaw?.fetchedAt);
  const sourceDataAsOf = rawNullableString(financialSourceRaw?.dataAsOf);
  const generatedAt = rawNullableString(body?.generatedAt);
  const dataAsOf = rawNullableString(body?.dataAsOf);
  const symbol = rawNullableString(body?.symbol);
  if (!body || body.schemaVersion !== "1.0" || !rawQuarters || rawQuarters.length < 1 || rawQuarters.length > 12 || !source || !sourceType || !fetchedAt || !sourceDataAsOf || !generatedAt || !dataAsOf || !symbol) return null;

  const quarters = rawQuarters.map((value): WatcherFinancialQuarter | null => {
    const row = rawRecord(value);
    const date = rawNullableString(row?.date);
    if (!row || !date) return null;
    const number = (field: string) => rawNullableNumber(row[field]);
    return {
      date,
      filingDate: rawNullableString(row.filingDate),
      fiscalYear: rawNullableString(row.fiscalYear),
      period: rawNullableString(row.period),
      currency: rawNullableString(row.currency),
      revenue: number("revenue"),
      netIncome: number("netIncome"),
      eps: number("eps"),
      operatingCashFlow: number("operatingCashFlow"),
      freeCashFlow: number("freeCashFlow"),
      revenue_qoq: number("revenue_qoq"),
      revenue_yoy: number("revenue_yoy"),
      netIncome_qoq: number("netIncome_qoq"),
      netIncome_yoy: number("netIncome_yoy"),
      eps_qoq: number("eps_qoq"),
      eps_yoy: number("eps_yoy"),
      operatingCashFlow_qoq: number("operatingCashFlow_qoq"),
      operatingCashFlow_yoy: number("operatingCashFlow_yoy"),
    };
  });
  if (!quarters.length || quarters.some((quarter) => !quarter)) return null;

  const financialSource: WatcherFinancialSource = {
    source,
    sourceType,
    sourceUrl: rawNullableString(financialSourceRaw?.sourceUrl),
    fetchedAt,
    dataAsOf: sourceDataAsOf,
    filingDate: rawNullableString(financialSourceRaw?.filingDate),
  };
  return {
    schemaVersion: rawNullableString(body.schemaVersion) || "unknown",
    source: rawNullableString(body.source) || "ValuationCalculation",
    symbol,
    generatedAt,
    dataAsOf,
    financialSource,
    quarters: quarters as WatcherFinancialQuarter[],
  };
};

export const formatFinancialAmount = (value: number | null, currencyCode: string | null) => {
  if (value === null) return "N/A";
  if (!currencyCode || !/^[A-Z]{3}$/.test(currencyCode)) return formatNumber(value);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return formatNumber(value);
  }
};

export const formatProvenanceTimestamp = (value: string) => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(timestamp));
};

export const historyFromResult = (result: NativeToolResult | undefined): RawHistoryPoint[] => {
  const raw = rawRecord(result?.raw);
  const history = raw?.history || raw?.historyTail;
  if (!Array.isArray(history)) return [];
  return history
    .map((item) => rawRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      date: typeof item.date === "string" ? item.date : typeof item.label === "string" ? item.label : "",
      open: rawNumber(item.open ?? item.price ?? item.close),
      high: rawNumber(item.high ?? item.price ?? item.close),
      low: rawNumber(item.low ?? item.price ?? item.close),
      close: rawNumber(item.close ?? item.price),
      volume: rawNumber(item.volume),
    }))
    .filter((row) => row.close && row.high && row.low);
};

export const unavailableMarketIndexCard = (definition: MarketIndexDefinition, error?: string): MarketIndexCard => ({
  symbol: definition.symbol,
  sourceSymbol: definition.yahooSymbol,
  label: definition.label,
  status: "unavailable",
  value: 0,
  change: 0,
  changePercent: 0,
  historyPointCount: 0,
  error,
  history: [],
});

export const emptyMarketIndexCards = (): MarketIndexCard[] =>
  MARKET_INDEX_DEFINITIONS.map((definition) => unavailableMarketIndexCard(definition));

export const parseMarketIndexCard = (definition: MarketIndexDefinition, result: NativeToolResult): MarketIndexCard => {
  const history = historyFromResult(result)
    .filter((row): row is RawHistoryPoint & { date: string; close: number } =>
      typeof row.date === "string" && typeof row.close === "number" && Number.isFinite(row.close) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-45);
  if (history.length < 10) {
    throw new Error(`${definition.label} Yahoo history returned ${history.length} valid points`);
  }
  const latest = history[history.length - 1]?.close || 0;
  const previous = history[Math.max(0, history.length - 2)]?.close || latest;
  if (latest <= 0 || previous <= 0) {
    throw new Error(`${definition.label} Yahoo history returned invalid close values`);
  }
  const change = latest - previous;
  const changePercent = previous > 0 ? (change / previous) * 100 : 0;
  return {
    symbol: definition.symbol,
    sourceSymbol: definition.yahooSymbol,
    label: definition.label,
    status: "ok",
    value: latest,
    change,
    changePercent,
    historyPointCount: history.length,
    history,
  };
};

export const quotesFromResult = (result: NativeToolResult | undefined): RawQuoteRow[] => {
  const raw = rawRecord(result?.raw);
  const quotes = raw?.quotes;
  if (!Array.isArray(quotes)) return [];
  return quotes
    .map((item) => rawRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      symbol: typeof item.symbol === "string" ? item.symbol : "",
      name: typeof item.name === "string" ? item.name : "",
      price: rawNumber(item.price),
      change: rawNumber(item.change),
      changePercent: rawNumber(item.changePercent),
      volume: rawNumber(item.volume),
    }))
    .filter((quote) => quote.symbol);
};

export const compactDateLabel = (value: string | undefined) => {
  if (!value) return "--";
  if (value.includes("T")) {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
  }
  return value.length > 10 ? value.slice(5, 16) : value.slice(5) || value;
};

export const optionChainFromResult = (result: NativeToolResult | undefined): RawOptionChain | null => {
  const raw = rawRecord(result?.raw);
  const chain = rawRecord(raw?.chain);
  if (chain) return chain as unknown as RawOptionChain;
  return raw && (Array.isArray(raw.calls) || Array.isArray(raw.puts))
    ? raw as unknown as RawOptionChain
    : null;
};

export const optionExposuresFromResult = (result: NativeToolResult | undefined): RawOptionExposure[] => {
  const raw = rawRecord(result?.raw);
  const exposures = raw?.exposures || raw?.rows;
  return Array.isArray(exposures) ? exposures as RawOptionExposure[] : [];
};

export const optionLegNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%]/g, "").replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

export const optionLegDisplayNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,%]/g, "").replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const formatOptionIv = (value: unknown) => {
  const parsed = optionLegDisplayNumber(value);
  if (parsed === null) return "n/a";
  return `${(parsed > 0 && parsed <= 3 ? parsed * 100 : parsed).toFixed(1)}%`;
};

export const effectiveLegOpenInterest = (leg: RawOptionLeg | undefined, explicit?: unknown) => {
  if (explicit !== undefined && explicit !== null) return Math.max(0, optionLegNumber(explicit));
  const openInterest = optionLegNumber(leg?.openInterest);
  return Math.max(0, openInterest);
};

export const effectiveExposureIv = (row: RawOptionExposure) => {
  const values = [
    optionLegNumber(row.callIv) || optionLegNumber(row.call?.impliedVolatility),
    optionLegNumber(row.putIv) || optionLegNumber(row.put?.impliedVolatility),
  ].filter((value) => value > 0);
  if (values.length > 0) return values.reduce((sum, value) => sum + value, 0) / values.length;
  return optionLegNumber(row.avgIv);
};

export const buildStrikeRowsFromOptionRaw = (
  chain: RawOptionChain | null,
  exposures: RawOptionExposure[],
) => {
  if (!chain) return [];
  const spot = optionLegNumber(chain.spot);
  const strikes = Array.from(new Set([
    ...(chain.calls || []).map((leg) => optionLegNumber(leg.strike)),
    ...(chain.puts || []).map((leg) => optionLegNumber(leg.strike)),
    ...exposures.map((row) => optionLegNumber(row.strike)),
  ])).filter((strike) => strike > 0)
    .sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))
    .slice(0, 80)
    .sort((a, b) => a - b);

  return strikes.map((strike) => {
    const call = (chain.calls || []).find((leg) => optionLegNumber(leg.strike) === strike);
    const put = (chain.puts || []).find((leg) => optionLegNumber(leg.strike) === strike);
    const exposure = exposures.find((row) => optionLegNumber(row.strike) === strike);
    const callOpenInterest = effectiveLegOpenInterest(call, exposure?.callEffectiveOpenInterest ?? exposure?.callOpenInterest);
    const putOpenInterest = effectiveLegOpenInterest(put, exposure?.putEffectiveOpenInterest ?? exposure?.putOpenInterest);
    const callVolume = optionLegNumber(call?.volume);
    const putVolume = optionLegNumber(put?.volume);
    const callGex = optionLegNumber(exposure?.callGex);
    const putGex = optionLegNumber(exposure?.putGex);
    return {
      strike,
      callOpenInterest,
      putOpenInterest,
      callVolume,
      putVolume,
      callGex,
      putGex,
      netGex: optionLegNumber(exposure?.netGex) || callGex + putGex,
    };
  });
};

export const buildExpiryRowsForSelector = (snapshot: StocksWatcherSnapshot | null): ExpirySelectorRow[] => {
  if (!snapshot) return [];
  const existing = snapshot.expiryRows?.length ? snapshot.expiryRows : snapshot.expiries || [];
  const byExpiry = new Map<string, StocksWatcherExpiryRow[]>();

  for (const row of existing) {
    const expiry = normalizeExpiryDate(row.expiry);
    byExpiry.set(expiry, [...(byExpiry.get(expiry) || []), { ...row, expiry }]);
  }

  const expiries = snapshot.availableExpiries?.length
    ? snapshot.availableExpiries.map(normalizeExpiryDate)
    : Array.from(byExpiry.keys());

  return expiries.map((expiry) => {
    const rows = byExpiry.get(expiry) || [];
    if (rows.length === 0) {
      return { expiry, loaded: false };
    }

    const callOi = rows.filter((row) => row.type === "C").reduce((sum, row) => sum + row.openInterest, 0);
    const putOi = rows.filter((row) => row.type === "P").reduce((sum, row) => sum + row.openInterest, 0);
    const dominantType = callOi >= putOi ? "C" : "P";
    const primary = rows.reduce((best, row) => (row.openInterest + row.volume) > (best.openInterest + best.volume) ? row : best);

    return {
      expiry,
      loaded: true,
      openInterest: rows.reduce((sum, row) => sum + row.openInterest, 0),
      primaryStrike: primary.primaryStrike || primary.strike,
      volume: rows.reduce((sum, row) => sum + row.volume, 0),
      dominantType,
      netGex: rows.length > 0 && rows.every((row) => typeof row.netGex === "number" && Number.isFinite(row.netGex))
        ? rows.reduce((sum, row) => sum + (row.netGex || 0), 0)
        : undefined,
      netDex: rows.length > 0 && rows.every((row) => typeof row.netDex === "number" && Number.isFinite(row.netDex))
        ? rows.reduce((sum, row) => sum + (row.netDex || 0), 0)
        : undefined,
    };
  });
};

export const exposureToneClassName = (value: number | undefined, available: boolean) => {
  if (!available || typeof value !== "number" || !Number.isFinite(value)) return "siw-unavailable";
  return value < 0 ? "siw-down" : "siw-up";
};

export const chartGexRowsFromResult = (data: Record<string, NativeToolResult> | null): StocksWatcherStrikeRow[] => {
  if (!data) return [];
  const visual = normalizeOptionsVisualModel({
    chainRaw: data.get_options?.raw,
    exposureRaw: data.get_options_gex?.raw,
  });
  if (!visual.capabilities.gex) return [];
  const exposureStrikes = new Set(
    (visual.strikeRows as unknown as RawOptionExposure[])
      .filter((row) => [row.netGex, row.callGex, row.putGex].some((value) => typeof value === "number" && Number.isFinite(value)))
      .map((row) => optionLegNumber(row.strike)),
  );
  return buildStrikeRowsFromOptionRaw(
    visual.chain as unknown as RawOptionChain | null,
    visual.strikeRows as unknown as RawOptionExposure[],
  ).filter((row) => exposureStrikes.has(row.strike) && Number.isFinite(row.netGex));
};

export const aggregateChartGexRows = (
  expiries: string[],
  rowsByExpiry: Record<string, AsyncPanelState>,
): ChartGexAggregateRow[] => {
  const aggregates = new Map<number, { total: number; contributors: number }>();
  for (const expiry of expiries) {
    for (const row of chartGexRowsFromResult(rowsByExpiry[expiry]?.data || null)) {
      const current = aggregates.get(row.strike) || { total: 0, contributors: 0 };
      aggregates.set(row.strike, {
        total: current.total + row.netGex,
        contributors: current.contributors + 1,
      });
    }
  }
  return [...aggregates.entries()]
    .map(([strike, aggregate]) => ({
      strike,
      netGex: aggregate.total / aggregate.contributors,
      contributors: aggregate.contributors,
    }))
    .sort((a, b) => b.strike - a.strike);
};

export const summaryFromLoadedOptionChain = (
  chain: RawOptionChain | null,
  exposures: RawOptionExposure[] = [],
): ExpirySelectorRow | null => {
  if (!chain?.selectedExpiry) return null;
  const legs = [
    ...(chain.calls || []).map((leg) => ({ ...leg, type: "C" as const })),
    ...(chain.puts || []).map((leg) => ({ ...leg, type: "P" as const })),
  ];
  if (legs.length === 0) return null;
  const total = (key: "openInterest" | "volume", type?: "C" | "P") => legs
    .filter((leg) => !type || leg.type === type)
    .reduce((sum, leg) => sum + optionLegNumber(leg[key]), 0);
  const callOi = total("openInterest", "C");
  const putOi = total("openInterest", "P");
  const primary = legs.reduce((best, leg) => optionLegNumber(leg.openInterest) + optionLegNumber(leg.volume) > optionLegNumber(best.openInterest) + optionLegNumber(best.volume) ? leg : best);
  const sumFiniteExposure = (key: "netGex" | "netDex") => {
    const values = exposures
      .map((row) => row[key])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : undefined;
  };
  return {
    expiry: normalizeExpiryDate(chain.selectedExpiry),
    loaded: true,
    openInterest: total("openInterest"),
    primaryStrike: optionLegNumber(primary.strike),
    volume: total("volume"),
    dominantType: callOi >= putOi ? "C" : "P",
    netGex: sumFiniteExposure("netGex"),
    netDex: sumFiniteExposure("netDex"),
  };
};

export const yahooExpiryExposureCacheKey = (symbol: string, expiry: string) =>
  `${normalizeSymbol(symbol)}:${normalizeExpiryDate(expiry)}:YahooOptionsExposure`;

export const getRunColor = (status: ToolStatus) => {
  if (status === "ok") return "border-emerald-400/40 bg-emerald-500/15 text-emerald-200";
  if (status === "running") return "border-yellow-400/40 bg-yellow-500/15 text-yellow-100";
  return "border-red-400/40 bg-red-500/15 text-red-100";
};

export const getToolCategory = (name: string) => {
  if (/option|greek|dex|flow|iv|pcr|sweep|0dte|mispricing/i.test(name)) return "Options";
  if (/intraday|indicator|beta|stats|signal|stock|earnings|history/i.test(name)) return "Technicals";
  if (/macro|breadth|sector|holders|briefing|event/i.test(name)) return "Macro";
  if (/memory|memories|share/i.test(name)) return "Memory";
  return "Other";
};

export const getToolInputDraft = (name: string, symbol: string, expiry?: string, strike?: number) => {
  const params: Record<string, unknown> = {};
  if (!/market_breadth|get_macro_regime|get_watchlist|list_memories/i.test(name)) {
    params.ticker = symbol;
  }
  if (/greeks|iv|mispricing|dex|chain|options|sweeps|0dte|pcr/i.test(name) && expiry) {
    params.expiry = toYahooExpiry(expiry);
  }
  if (/greeks|iv|mispricing/i.test(name) && typeof strike === "number") {
    params.strike = strike;
  }
  if (name === "list_memories") params.key = FAVORITES_MEMORY_KEY;
  if (name === "save_memory") {
    params.key = FAVORITES_MEMORY_KEY;
    params.value = JSON.stringify({ symbols: [symbol] });
  }
  return JSON.stringify(params, null, 2);
};
