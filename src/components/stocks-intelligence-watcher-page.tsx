import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  ArrowLeft,
  BarChart3,
  Building2,
  ChevronDown,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { AreaSeries, BarSeries, CandlestickSeries, ColorType, HistogramSeries, LineSeries, createChart } from "lightweight-charts";
import type {
  StocksWatcherChartMode,
  StocksWatcherExpiryRow,
  StocksWatcherSnapshotCacheEntry,
  StocksWatcherSnapshot,
  StocksWatcherStrikeRow,
} from "@/lib/stocks-intelligence-watcher";
import {
  applyStocksWatcherSymbolRemoval,
  getFreshStocksWatcherCacheEntry,
  getGammaFlipLevel,
  getNearestSpotStrike,
  getStocksWatcherVisibleSymbols,
} from "@/lib/stocks-intelligence-watcher";
import {
  buildStocksWatcherAiSummaryPayload,
  buildStocksWatcherDeterministicSummary,
  type StocksWatcherAiSummaryResponse,
} from "@/lib/stocks-intelligence-watcher-summary";
import {
  getStocksWatcherExpiryOverviewToolPlan,
  getStocksWatcherCustomStockFromSnapshot,
  getStocksWatcherOptionsSubTabCacheKey,
  getStocksWatcherOptionsSubTabToolPlan,
  getStocksWatcherSnapshotExpiry,
  getStocksWatcherSnapshotLoadDecision,
  getStocksWatcherStrikeDetailToolPlan,
  getStocksWatcherTopTabCacheKey,
  getStocksWatcherTopTabToolPlan,
} from "@/lib/stocks-intelligence-watcher-session";
import {
  STOCKS_WATCHER_SYMBOLS,
  STOCKS_WATCHER_UNIVERSE,
  getStocksWatcherUniverseSectors,
  getStocksWatcherUniverseStock,
  getStocksWatcherUniverseTypes,
} from "@/lib/stocks-watcher-universe";
import type { StocksWatcherUniverseStock } from "@/lib/stocks-watcher-universe";
import { getStocksWatcherInitialSymbolFromHash, STOCKS_WATCHER_DEFAULT_SYMBOL } from "@/lib/stocks-intelligence-watcher-route";

interface StocksIntelligenceWatcherPageProps {
  onBackToWork: () => void;
}

const DEFAULT_WATCHLIST = STOCKS_WATCHER_SYMBOLS;
const HIDDEN_SYMBOLS_STORAGE_KEY = "stocks-intelligence-hidden-symbols";
const FAVORITES_STORAGE_KEY = "stocks-intelligence-favorites";
const FAVORITES_MEMORY_KEY = "stocks-intelligence-favorites";
const CUSTOM_STOCKS_STORAGE_KEY = "stocks-intelligence-custom-stocks";

const TOP_TABS = [
  "Chart",
  "Fundamentals",
  "Stats",
  "Earnings",
  "Options",
  "Short Vol",
  "News",
  "Holders",
] as const;

const OPTIONS_SUB_TABS = [
  "Overview",
  "Greeks",
  "DEX",
  "Flow",
  "IV",
  "Mis$",
  "P/C",
  "Chain",
  "Sweeps",
  "0DTE",
] as const;

const BASE_SECTOR_OPTIONS = ["All Sectors", ...getStocksWatcherUniverseSectors()];
const BASE_TYPE_OPTIONS = ["All Types", ...getStocksWatcherUniverseTypes()];

type TopTab = (typeof TOP_TABS)[number];
type OptionsSubTab = (typeof OPTIONS_SUB_TABS)[number];
type ToolStatus = "ok" | "failed" | "running";

interface NativeToolResult {
  tool: string;
  params: Record<string, unknown>;
  text: string;
  raw: unknown;
}

interface ToolRunLogEntry {
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

interface TabCacheEntry {
  data: Record<string, NativeToolResult>;
  fetchedAt: number;
}

interface AsyncPanelState {
  loading: boolean;
  error: string | null;
  data: Record<string, NativeToolResult> | null;
}

interface StrikeDrawerState {
  open: boolean;
  strike: number | null;
  expiry: string | null;
  loading?: boolean;
  error?: string | null;
  data?: Record<string, NativeToolResult> | null;
}

type ModalState =
  | { type: null; data?: null }
  | { type: "runTool"; data: { toolName: string; paramsText: string; result?: NativeToolResult; loading?: boolean; error?: string | null } };

interface MarketContextState {
  loading: boolean;
  error: string | null;
  regime: NativeToolResult | null;
  breadth: NativeToolResult | null;
}

interface RawOptionLeg {
  strike?: number;
  bid?: number;
  ask?: number;
  lastPrice?: number;
  volume?: number;
  openInterest?: number;
  impliedVolatility?: number;
  contractSymbol?: string;
}

interface RawOptionChain {
  spot?: number;
  selectedExpiry?: string | null;
  expiries?: string[];
  calls?: RawOptionLeg[];
  puts?: RawOptionLeg[];
}

interface RawOptionExposure {
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

interface RawHistoryPoint {
  date?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
}

interface RawQuoteRow {
  symbol?: string;
  name?: string;
  price?: number;
  change?: number;
  changePercent?: number;
  volume?: number;
}

const formatNumber = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
};

const currency = (value: number) =>
  `$${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

const formatQuoteAsOf = (asOf: string | null | undefined) => {
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

const normalizeExpiryDate = (expiry: string | null | undefined) => {
  if (!expiry) return "";
  if (/^\d{2}-\d{2}-\d{2}$/.test(expiry)) return `20${expiry}`;
  return expiry;
};

const formatExpiryDate = (expiry: string | null | undefined, style: "compact" | "short" | "long" = "short") => {
  const normalized = normalizeExpiryDate(expiry);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized || "--";
  if (style === "compact") return normalized.slice(2);
  const date = new Date(`${normalized}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", style === "long"
    ? { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }
    : { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
};

const toYahooExpiry = (expiry: string | null | undefined) => {
  if (!expiry) return undefined;
  if (/^\d{2}-\d{2}-\d{2}$/.test(expiry)) return `20${expiry}`;
  return expiry;
};

const modeLabel: Record<StocksWatcherChartMode, string> = {
  oi: "Open Interest",
  volume: "Options Volume",
  gex: "Option GEX",
};

const getMaxForMode = (rows: StocksWatcherStrikeRow[], mode: StocksWatcherChartMode) =>
  Math.max(
    1,
    ...rows.flatMap((row) => {
      if (mode === "oi") return [row.callOpenInterest, row.putOpenInterest];
      if (mode === "volume") return [row.callVolume, row.putVolume];
      return [Math.abs(row.callGex), Math.abs(row.putGex)];
    }),
  );

const getCallValue = (row: StocksWatcherStrikeRow, mode: StocksWatcherChartMode) => {
  if (mode === "oi") return row.callOpenInterest;
  if (mode === "volume") return row.callVolume;
  return row.callGex;
};

const getPutValue = (row: StocksWatcherStrikeRow, mode: StocksWatcherChartMode) => {
  if (mode === "oi") return row.putOpenInterest;
  if (mode === "volume") return row.putVolume;
  return row.putGex;
};

const chartMetricLabel: Record<StocksWatcherChartMode, string> = {
  oi: "Open Interest",
  volume: "Volume",
  gex: "Gamma Exposure",
};

interface ChartTooltipState {
  strike: number;
  callValue: number;
  putValue: number;
  netGex: number;
  x: number;
  y: number;
}

const normalizeSymbol = (symbol: string) => symbol.trim().toUpperCase();
const sanitizeSymbols = (symbols: string[]) =>
  Array.from(new Set(symbols.map(normalizeSymbol).filter((symbol) => /^[A-Z0-9.^-]{1,12}$/.test(symbol))));

const readStoredSymbols = (key: string, fallback: string[]) => {
  if (typeof window === "undefined") return fallback;

  try {
    const saved = window.localStorage.getItem(key);
    return saved ? JSON.parse(saved) as string[] : fallback;
  } catch {
    return fallback;
  }
};

const uniqueStocks = (stocks: StocksWatcherUniverseStock[]) => {
  const bySymbol = new Map<string, StocksWatcherUniverseStock>();
  for (const stock of stocks) {
    const symbol = normalizeSymbol(stock.symbol);
    if (!symbol || bySymbol.has(symbol)) continue;
    bySymbol.set(symbol, { ...stock, symbol });
  }
  return Array.from(bySymbol.values());
};

const stockFromRecord = (record: Record<string, unknown>, fallback?: StocksWatcherUniverseStock) => {
  const symbol = typeof record.symbol === "string" ? normalizeSymbol(record.symbol) : fallback?.symbol || "";
  if (!symbol || !/^[A-Z0-9.^-]{1,12}$/.test(symbol)) return null;
  return {
    symbol,
    companyName: typeof record.companyName === "string" ? record.companyName : fallback?.companyName || `${symbol} custom stock`,
    sector: typeof record.sector === "string" ? record.sector : fallback?.sector || "Custom",
    type: record.type === "ETF" || record.type === "ADR" || record.type === "Stock" ? record.type : fallback?.type || "Stock",
    fallbackPrice: typeof record.fallbackPrice === "number" ? record.fallbackPrice : fallback?.fallbackPrice || 0,
    fallbackChange: typeof record.fallbackChange === "number" ? record.fallbackChange : fallback?.fallbackChange || 0,
    fallbackChangePercent: typeof record.fallbackChangePercent === "number" ? record.fallbackChangePercent : fallback?.fallbackChangePercent || 0,
  } satisfies StocksWatcherUniverseStock;
};

const readStoredCustomStocks = () => {
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

const stringifyPayload = (payload: unknown) => {
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
};

const parseSymbolsFromText = (text: string) => {
  const symbols = Array.from(text.toUpperCase().matchAll(/\b[A-Z][A-Z0-9.]{0,5}\b/g)).map((match) => match[0]);
  return sanitizeSymbols(symbols.filter((symbol) => !["HTTP", "JSON", "NATIVE", "NYSE", "NASDAQ", "THE"].includes(symbol))).slice(0, 50);
};

const parseWatchlistStocks = (result: NativeToolResult): StocksWatcherUniverseStock[] => {
  const raw = result.raw && typeof result.raw === "object" && !Array.isArray(result.raw)
    ? result.raw as Record<string, unknown>
    : {};
  const stocks = Array.isArray(raw.stocks) ? raw.stocks : [];
  const parsedStocks = stocks
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const symbol = typeof record.symbol === "string" ? normalizeSymbol(record.symbol) : "";
      const fallback = getStocksWatcherUniverseStock(symbol);
      if (!symbol) return null;
      return stockFromRecord(record, fallback);
    })
    .filter((stock): stock is StocksWatcherUniverseStock => Boolean(stock));

  if (parsedStocks.length > 0) return parsedStocks;

  return parseSymbolsFromText(result.text)
    .map((symbol) => getStocksWatcherUniverseStock(symbol))
    .filter((stock): stock is StocksWatcherUniverseStock => Boolean(stock));
};

const resultLooksHtml = (result: NativeToolResult | undefined) =>
  Boolean(result?.tool.startsWith("chart_") || /<html|<body|<div|<svg|<!doctype/i.test(result?.text || ""));

const htmlSrcDoc = (result: NativeToolResult) => {
  if (/<html|<body|<!doctype/i.test(result.text)) return result.text;
  return `<!doctype html><html><body style="margin:0;background:#020617;color:#e2e8f0;font-family:Inter,system-ui,sans-serif"><pre style="white-space:pre-wrap;padding:16px">${result.text.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char] || char)}</pre></body></html>`;
};

const rawRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const rawNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%]/g, "").replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const historyFromResult = (result: NativeToolResult | undefined): RawHistoryPoint[] => {
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

const quotesFromResult = (result: NativeToolResult | undefined): RawQuoteRow[] => {
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

const compactDateLabel = (value: string | undefined) => {
  if (!value) return "--";
  if (value.includes("T")) {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
  }
  return value.length > 10 ? value.slice(5, 16) : value.slice(5) || value;
};

const optionChainFromResult = (result: NativeToolResult | undefined): RawOptionChain | null => {
  const raw = rawRecord(result?.raw);
  const chain = rawRecord(raw?.chain);
  return chain ? chain as unknown as RawOptionChain : null;
};

const optionExposuresFromResult = (result: NativeToolResult | undefined): RawOptionExposure[] => {
  const raw = rawRecord(result?.raw);
  const exposures = raw?.exposures || raw?.rows;
  return Array.isArray(exposures) ? exposures as RawOptionExposure[] : [];
};

const optionLegNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%]/g, "").replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const effectiveLegOpenInterest = (leg: RawOptionLeg | undefined, explicit?: unknown) => {
  const explicitValue = optionLegNumber(explicit);
  if (explicitValue > 0) return explicitValue;
  const openInterest = optionLegNumber(leg?.openInterest);
  if (openInterest > 0) return openInterest;
  return optionLegNumber(leg?.volume);
};

const effectiveExposureIv = (row: RawOptionExposure) => {
  const values = [
    optionLegNumber(row.callIv) || optionLegNumber(row.call?.impliedVolatility),
    optionLegNumber(row.putIv) || optionLegNumber(row.put?.impliedVolatility),
  ].filter((value) => value > 0);
  if (values.length > 0) return values.reduce((sum, value) => sum + value, 0) / values.length;
  return optionLegNumber(row.avgIv);
};

const buildStrikeRowsFromOptionRaw = (
  chain: RawOptionChain | null,
  exposures: RawOptionExposure[],
  fallbackRows: StocksWatcherStrikeRow[],
) => {
  if (!chain) return fallbackRows;
  const spot = optionLegNumber(chain.spot) || fallbackRows[Math.floor(fallbackRows.length / 2)]?.strike || 0;
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
    const callGex = optionLegNumber(exposure?.callGex) || Math.round(callOpenInterest * Math.max(spot, 1) * 4);
    const putGex = optionLegNumber(exposure?.putGex) || -Math.round(putOpenInterest * Math.max(spot, 1) * 4);
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

const buildExpiryRowsForSelector = (snapshot: StocksWatcherSnapshot | null): StocksWatcherExpiryRow[] => {
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
      return {
        expiry,
        openInterest: 0,
        primaryStrike: snapshot.atm,
        strike: snapshot.atm,
        volume: 0,
        dominantType: "C",
        type: "C",
      };
    }

    const callOi = rows.filter((row) => row.type === "C").reduce((sum, row) => sum + row.openInterest, 0);
    const putOi = rows.filter((row) => row.type === "P").reduce((sum, row) => sum + row.openInterest, 0);
    const dominantType = callOi >= putOi ? "C" : "P";
    const primary = rows.reduce((best, row) => (row.openInterest + row.volume) > (best.openInterest + best.volume) ? row : best);

    return {
      expiry,
      openInterest: rows.reduce((sum, row) => sum + row.openInterest, 0),
      primaryStrike: primary.primaryStrike || primary.strike,
      strike: primary.primaryStrike || primary.strike,
      volume: rows.reduce((sum, row) => sum + row.volume, 0),
      dominantType,
      type: dominantType,
    };
  });
};

const getRunColor = (status: ToolStatus) => {
  if (status === "ok") return "border-emerald-400/40 bg-emerald-500/15 text-emerald-200";
  if (status === "running") return "border-yellow-400/40 bg-yellow-500/15 text-yellow-100";
  return "border-red-400/40 bg-red-500/15 text-red-100";
};

const getToolCategory = (name: string) => {
  if (/option|greek|dex|flow|iv|pcr|sweep|0dte|mispricing/i.test(name)) return "Options";
  if (/intraday|indicator|beta|stats|signal|stock|earnings|history/i.test(name)) return "Technicals";
  if (/macro|breadth|sector|holders|briefing|event/i.test(name)) return "Macro";
  if (/memory|memories|share/i.test(name)) return "Memory";
  return "Other";
};

const getToolInputDraft = (name: string, symbol: string, expiry?: string, strike?: number) => {
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

const SkeletonBlock = ({ className = "" }: { className?: string }) => (
  <div className={`animate-pulse rounded-md bg-slate-800/70 ${className}`} />
);

const ErrorBanner = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
    <span>{message}</span>
    {onRetry && (
      <button type="button" onClick={onRetry} className="rounded border border-red-300/40 px-2 py-1 text-xs font-bold hover:bg-red-400/10">
        Retry
      </button>
    )}
  </div>
);

const OptionsEmptyState = ({ expiry, onRetry }: { expiry?: string | null; onRetry?: () => void }) => (
  <div className="flex min-h-[18rem] flex-col items-center justify-center rounded-md border border-slate-800 bg-slate-950/50 p-6 text-center">
    <p className="text-sm font-black text-blue-100">No native Yahoo data for this expiry</p>
    <p className="mt-2 max-w-md text-xs leading-5 text-slate-500">
      {formatExpiryDate(expiry, "long")} has no structured option payload for this panel.
    </p>
    {onRetry && (
      <button type="button" onClick={onRetry} className="mt-4 rounded-md border border-blue-400/40 px-3 py-2 text-xs font-bold text-blue-100 hover:bg-blue-500/10">
        Retry
      </button>
    )}
  </div>
);

type PriceChartStyle = "line" | "mountain" | "candle" | "ohlc";
type PriceChartRange = "1D" | "5D" | "ALL";

interface PriceChartRow extends RawHistoryPoint {
  time: number;
}

interface PriceChartTooltip {
  x: number;
  y: number;
  point: PriceChartRow;
}

const chartRangeLimits: Record<PriceChartRange, number> = {
  "1D": 96,
  "5D": 390,
  ALL: Number.POSITIVE_INFINITY,
};

const toChartRows = (points: RawHistoryPoint[], range: PriceChartRange): PriceChartRow[] => {
  let previousTime = 0;
  return points
    .slice(-chartRangeLimits[range])
    .map((point, index) => {
      const parsed = point.date ? Date.parse(point.date) : Number.NaN;
      const fallback = 1_700_000_000 + index * 86_400;
      let time = Number.isFinite(parsed) ? Math.floor(parsed / 1000) : fallback;
      if (time <= previousTime) time = previousTime + 60;
      previousTime = time;
      const close = point.close || point.open || point.high || point.low || 0;
      const open = point.open || close;
      const high = point.high || Math.max(open, close);
      const low = point.low || Math.min(open, close);
      return { ...point, time, open, high, low, close, volume: point.volume || 0 };
    })
    .filter((point) => point.close && point.high && point.low);
};

const OhlcVolumeChart = ({ result }: { result: NativeToolResult }) => {
  const allPoints = useMemo(() => historyFromResult(result), [result]);
  const [chartStyle, setChartStyle] = useState<PriceChartStyle>("ohlc");
  const [chartRange, setChartRange] = useState<PriceChartRange>("ALL");
  const [tooltip, setTooltip] = useState<PriceChartTooltip | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);

  const points = useMemo(() => toChartRows(allPoints, chartRange), [allPoints, chartRange]);
  const latest = points[points.length - 1];
  const activePoint = tooltip?.point || latest;
  const priorPoint = points[Math.max(0, points.length - 2)];
  const isUp = (activePoint?.close || 0) >= (activePoint?.open || priorPoint?.close || 0);
  const firstLabel = compactDateLabel(points[0]?.date);
  const latestLabel = compactDateLabel(latest?.date);

  useEffect(() => {
    if (!containerRef.current || points.length < 2) return undefined;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }
    setTooltip(null);

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#05080d" },
        textColor: "#8aa0bc",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.10)" },
        horzLines: { color: "rgba(148,163,184,0.12)" },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.05, bottom: 0.22 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: chartStyle === "line" || chartStyle === "mountain" ? 5 : 7,
      },
      crosshair: {
        horzLine: { color: "rgba(96,165,250,0.55)", labelBackgroundColor: "#1d4ed8" },
        vertLine: { color: "rgba(96,165,250,0.55)", labelBackgroundColor: "#1d4ed8" },
      },
      handleScroll: true,
      handleScale: true,
    });

    chartRef.current = chart;

    const candleData = points.map((point) => ({
      time: point.time as any,
      open: point.open || point.close || 0,
      high: point.high || point.close || 0,
      low: point.low || point.close || 0,
      close: point.close || point.open || 0,
    }));
    const closeData = points.map((point) => ({ time: point.time as any, value: point.close || 0 }));
    const volumeData = points.map((point) => ({
      time: point.time as any,
      value: point.volume || 0,
      color: (point.close || 0) >= (point.open || 0) ? "rgba(16,185,129,0.58)" : "rgba(248,113,113,0.58)",
    }));

    const priceSeries = chartStyle === "line"
      ? chart.addSeries(LineSeries, {
          color: "#60a5fa",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
        })
      : chartStyle === "mountain"
        ? chart.addSeries(AreaSeries, {
            lineColor: "#60a5fa",
            topColor: "rgba(37,99,235,0.38)",
            bottomColor: "rgba(37,99,235,0.02)",
            lineWidth: 2,
            priceLineVisible: false,
          })
        : chartStyle === "candle"
          ? chart.addSeries(CandlestickSeries, {
              upColor: "#10b981",
              downColor: "#f43f5e",
              borderUpColor: "#34d399",
              borderDownColor: "#fb7185",
              wickUpColor: "#34d399",
              wickDownColor: "#fb7185",
            })
          : chart.addSeries(BarSeries, {
              upColor: "#10b981",
              downColor: "#f43f5e",
              thinBars: false,
            });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
    });

    priceSeries.setData(chartStyle === "line" || chartStyle === "mountain" ? closeData : candleData);
    volumeSeries.setData(volumeData);
    chart.timeScale().fitContent();

    const pointByTime = new Map(points.map((point) => [String(point.time), point]));
    chart.subscribeCrosshairMove((param: any) => {
      if (!param?.time || !param?.point) {
        return;
      }
      const point = pointByTime.get(String(param.time));
      if (!point) {
        return;
      }
      setTooltip((current) => {
        if (
          current?.point.time === point.time &&
          Math.abs(current.x - param.point.x) < 1 &&
          Math.abs(current.y - param.point.y) < 1
        ) {
          return current;
        }
        return { x: param.point.x, y: param.point.y, point };
      });
    });

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [chartStyle, points]);

  if (points.length < 2) return <ToolTextSummary result={result} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-slate-800 bg-[#05080d]" data-chart-style={chartStyle}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {(["line", "mountain", "candle", "ohlc"] as PriceChartStyle[]).map((style) => (
            <button
              key={style}
              type="button"
              onClick={() => setChartStyle(style)}
              className={`rounded border px-3 py-1.5 text-xs font-black uppercase tracking-normal transition ${
                chartStyle === style
                  ? "border-blue-400/60 bg-blue-500/20 text-blue-200"
                  : "border-slate-700 bg-slate-950 text-slate-300 hover:border-blue-400/50 hover:text-blue-100"
              }`}
            >
              {style}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["1D", "5D", "ALL"] as PriceChartRange[]).map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => setChartRange(range)}
              className={`rounded border px-3 py-1.5 text-xs font-black transition ${
                chartRange === range
                  ? "border-blue-400/60 bg-blue-500/20 text-blue-100"
                  : "border-slate-700 bg-slate-950 text-slate-300 hover:border-blue-400/50"
              }`}
            >
              {range}
            </button>
          ))}
          <span className="rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-bold text-slate-400">
            Updated {latestLabel}
          </span>
        </div>
      </div>
      <div className="px-3 pt-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className={`rounded-full px-3 py-1.5 font-black ${isUp ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
            {tooltip ? compactDateLabel(activePoint.date) : "Last"} {currency(activePoint.close || 0)}
          </span>
          <span className="rounded-full bg-slate-800 px-3 py-1.5 font-bold text-slate-300">O {currency(activePoint.open || 0)}</span>
          <span className="rounded-full bg-slate-800 px-3 py-1.5 font-bold text-emerald-200">H {currency(activePoint.high || 0)}</span>
          <span className="rounded-full bg-slate-800 px-3 py-1.5 font-bold text-red-200">L {currency(activePoint.low || 0)}</span>
          <span className="rounded-full bg-slate-800 px-3 py-1.5 font-bold text-slate-300">Vol {formatNumber(activePoint.volume || 0)}</span>
        </div>
      </div>
      <div
        className="relative min-h-[28rem] flex-1 px-3 pb-3 pt-2"
        onMouseLeave={() => setTooltip(null)}
      >
        <div ref={containerRef} className="h-full w-full" data-price-chart-surface />
        {tooltip && (
          <div
            className="pointer-events-none absolute z-20 w-56 rounded-md border border-blue-400/50 bg-slate-950/95 px-3 py-2 text-xs shadow-2xl shadow-blue-950/50"
            data-price-chart-tooltip
            style={{
              left: tooltip.x > 280 ? tooltip.x - 226 : tooltip.x + 26,
              top: Math.max(58, tooltip.y - 36),
            }}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-black text-blue-100">{compactDateLabel(tooltip.point.date)}</span>
              <span className={`font-black ${(tooltip.point.close || 0) >= (tooltip.point.open || 0) ? "text-emerald-300" : "text-red-300"}`}>
                {(tooltip.point.close || 0) >= (tooltip.point.open || 0) ? "UP" : "DOWN"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums text-slate-300">
              <span>Open</span><span className="text-right text-slate-100">{currency(tooltip.point.open || 0)}</span>
              <span>High</span><span className="text-right text-emerald-200">{currency(tooltip.point.high || 0)}</span>
              <span>Low</span><span className="text-right text-red-200">{currency(tooltip.point.low || 0)}</span>
              <span>Close</span><span className="text-right text-blue-100">{currency(tooltip.point.close || 0)}</span>
              <span>Volume</span><span className="text-right text-slate-100">{formatNumber(tooltip.point.volume || 0)}</span>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-slate-800 px-3 py-2 text-xs text-slate-500">
        <span>{firstLabel} - {latestLabel}</span>
        <span>{points.length} bars | {result.tool}</span>
      </div>
    </div>
  );
};

const QuoteBreadthPanel = ({ result }: { result: NativeToolResult }) => {
  const quotes = quotesFromResult(result);
  if (quotes.length === 0) return <ToolTextSummary result={result} />;
  const advancers = quotes.filter((quote) => (quote.changePercent || 0) >= 0).length;
  const breadthPct = Math.round((advancers / quotes.length) * 100);
  const leaders = quotes.slice(0, 3);
  const laggards = quotes.slice(-3).reverse();

  return (
    <div className="space-y-4 rounded-md border border-slate-800 bg-[#05080d] p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Universe Breadth</p>
          <p className="mt-1 text-3xl font-black tabular-nums text-white">{advancers}/{quotes.length}</p>
        </div>
        <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-black text-emerald-300">{breadthPct}% positive</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-emerald-400" style={{ width: `${breadthPct}%` }} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <QuoteMiniList title="Leaders" quotes={leaders} tone="up" />
        <QuoteMiniList title="Laggards" quotes={laggards} tone="down" />
      </div>
    </div>
  );
};

const QuoteMiniList = ({ title, quotes, tone }: { title: string; quotes: RawQuoteRow[]; tone: "up" | "down" }) => (
  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
    <p className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-slate-500">{title}</p>
    <div className="space-y-2">
      {quotes.map((quote) => (
        <div key={quote.symbol} className="grid grid-cols-[4rem_1fr_auto] items-center gap-2 text-xs">
          <span className="font-black text-blue-100">{quote.symbol}</span>
          <span className="min-w-0 truncate text-slate-400">{quote.name}</span>
          <span className={`font-black tabular-nums ${tone === "up" ? "text-emerald-300" : "text-red-300"}`}>
            {(quote.changePercent || 0) >= 0 ? "+" : ""}{(quote.changePercent || 0).toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  </div>
);

const StatsPanel = ({ result }: { result: NativeToolResult }) => {
  const raw = rawRecord(result.raw);
  const quote = rawRecord(raw?.quote);
  const summary = rawRecord(raw?.summary);
  const stats = rawRecord(summary?.defaultKeyStatistics);
  const financial = rawRecord(summary?.financialData);
  const profile = rawRecord(summary?.assetProfile);
  const fmt = (value: unknown) => {
    const record = rawRecord(value);
    if (typeof record?.fmt === "string") return record.fmt;
    if (typeof value === "string") return value;
    const numeric = rawNumber(record?.raw ?? value);
    return numeric ? formatNumber(numeric) : "n/a";
  };
  const metrics = [
    ["Price", currency(rawNumber(quote?.price))],
    ["Change", `${rawNumber(quote?.changePercent).toFixed(2)}%`],
    ["Forward P/E", fmt(stats?.forwardPE)],
    ["Trailing P/E", fmt(stats?.trailingPE)],
    ["Beta", fmt(stats?.beta)],
    ["Target Mean", fmt(financial?.targetMeanPrice)],
    ["Sector", typeof profile?.sector === "string" ? profile.sector : "n/a"],
    ["Industry", typeof profile?.industry === "string" ? profile.industry : "n/a"],
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(([label, value]) => (
        <div key={label} className="rounded-md border border-slate-800 bg-[#05080d] p-4">
          <p className="text-[0.65rem] font-black uppercase tracking-[0.12em] text-slate-500">{label}</p>
          <p className="mt-2 min-w-0 truncate text-lg font-black tabular-nums text-blue-100">{value}</p>
        </div>
      ))}
    </div>
  );
};

const ToolTextSummary = ({ result }: { result: NativeToolResult }) => (
  <div className="max-h-[28rem] overflow-auto rounded-md border border-slate-800 bg-slate-950 p-3 text-xs leading-5 text-slate-300">
    {(result.text || "No formatted summary was returned for this tool.").split("\n").filter(Boolean).slice(0, 8).map((line) => (
      <p key={line} className="break-words">{line.replace(/^#+\s*/, "").replace(/\*\*/g, "")}</p>
    ))}
  </div>
);

const ToolResultBlock = ({ result }: { result: NativeToolResult }) => {
  if (["get_intraday", "get_stock_history", "chart_indicator"].includes(result.tool) && historyFromResult(result).length > 1) {
    return <OhlcVolumeChart result={result} />;
  }

  if (["market_breadth", "basket_relative_strength", "morning_briefing", "signal_scan", "get_sector_stats", "get_sector_top_holdings"].includes(result.tool) && quotesFromResult(result).length > 0) {
    return <QuoteBreadthPanel result={result} />;
  }

  if (["get_stock_stats", "get_beta"].includes(result.tool)) {
    return <StatsPanel result={result} />;
  }

  if (resultLooksHtml(result)) {
    return (
      <iframe
        title={`${result.tool} result`}
        srcDoc={htmlSrcDoc(result)}
        className="h-[28rem] w-full rounded-md border border-slate-800 bg-slate-950"
        sandbox="allow-scripts allow-same-origin"
      />
    );
  }

  return <ToolTextSummary result={result} />;
};

export function StocksIntelligenceWatcherPage({ onBackToWork }: StocksIntelligenceWatcherPageProps) {
  const [selectedSymbol, setSelectedSymbol] = useState(() =>
    typeof window === "undefined"
      ? STOCKS_WATCHER_DEFAULT_SYMBOL
      : getStocksWatcherInitialSymbolFromHash(window.location.hash),
  );
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<StocksWatcherChartMode>("volume");
  const [strikeWindowSize, setStrikeWindowSize] = useState(29);
  const [watchlistCollapsed, setWatchlistCollapsed] = useState(false);
  const [snapshot, setSnapshot] = useState<StocksWatcherSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSymbol, setLoadingSymbol] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const snapshotCacheRef = useRef<Map<string, StocksWatcherSnapshotCacheEntry>>(new Map());
  const chartViewportRef = useRef<HTMLDivElement | null>(null);
  const detailPanelRef = useRef<HTMLElement | null>(null);
  const [chartTooltip, setChartTooltip] = useState<ChartTooltipState | null>(null);
  const [favorites, setFavorites] = useState<string[]>(() => {
    return sanitizeSymbols(readStoredSymbols(FAVORITES_STORAGE_KEY, []));
  });
  const [hiddenSymbols, setHiddenSymbols] = useState<string[]>(() => {
    return readStoredSymbols(HIDDEN_SYMBOLS_STORAGE_KEY, []);
  });
  const [watchlistSource, setWatchlistSource] = useState<"all" | "favorites">("all");
  const [nativeWatchlist, setNativeWatchlist] = useState<StocksWatcherUniverseStock[]>(STOCKS_WATCHER_UNIVERSE);
  const [customStocks, setCustomStocks] = useState<StocksWatcherUniverseStock[]>(() => readStoredCustomStocks());
  const [sectorFilter, setSectorFilter] = useState("All Sectors");
  const [typeFilter, setTypeFilter] = useState("All Types");
  const [sectorState, setSectorState] = useState<AsyncPanelState>({ loading: false, error: null, data: null });
  const [activeTab, setActiveTab] = useState<TopTab>("Options");
  const [activeSubTab, setActiveSubTab] = useState<OptionsSubTab>("Overview");
  const tabDataCache = useRef<Map<string, TabCacheEntry>>(new Map());
  const [tabPanelState, setTabPanelState] = useState<AsyncPanelState>({ loading: false, error: null, data: null });
  const [subTabPanelState, setSubTabPanelState] = useState<AsyncPanelState>({ loading: false, error: null, data: null });
  const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null);
  const [expiryOverviewState, setExpiryOverviewState] = useState<AsyncPanelState>({ loading: false, error: null, data: null });
  const [strikeDrawer, setStrikeDrawer] = useState<StrikeDrawerState>({ open: false, strike: null, expiry: null, data: null });
  const strikeDrawerRequestRef = useRef(0);
  const [toolRunLog, setToolRunLog] = useState<ToolRunLogEntry[]>([]);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [modalState, setModalState] = useState<ModalState>({ type: null });
  const [marketContext, setMarketContext] = useState<MarketContextState>({ loading: false, error: null, regime: null, breadth: null });
  const [toolSearch, setToolSearch] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(HIDDEN_SYMBOLS_STORAGE_KEY, JSON.stringify(hiddenSymbols));
    }
  }, [hiddenSymbols]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
    }
  }, [favorites]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CUSTOM_STOCKS_STORAGE_KEY, JSON.stringify(customStocks));
    }
  }, [customStocks]);

  useEffect(() => {
    const closeFromNativeClick = (event: globalThis.MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest("[data-close-strike-detail]")) return;
      event.preventDefault();
      event.stopPropagation();
      strikeDrawerRequestRef.current += 1;
      setStrikeDrawer({ open: false, strike: null, expiry: null, data: null });
    };

    document.addEventListener("click", closeFromNativeClick, true);
    return () => document.removeEventListener("click", closeFromNativeClick, true);
  }, []);

  const callNativeTool = useCallback(async (name: string, params: Record<string, unknown> = {}): Promise<NativeToolResult> => {
    const runId = `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const startedAt = Date.now();
    setToolRunLog((current) => [
      { id: runId, name, params, status: "running", startedAt },
      ...current.slice(0, 59),
    ]);

    try {
      const response = await fetch("/api/stocks-intelligence-watcher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: name, params }),
      });
      const payload = await response.json() as { ok?: boolean; tool?: string; text?: string; raw?: unknown; error?: string };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `native Yahoo tool ${name} failed with HTTP ${response.status}`);
      }

      const endedAt = Date.now();
      const result: NativeToolResult = {
        tool: payload.tool || name,
        params,
        text: payload.text || "",
        raw: payload.raw ?? payload,
      };
      setToolRunLog((current) =>
        current.map((run) =>
          run.id === runId
            ? { ...run, status: "ok", endedAt, durationMs: endedAt - startedAt, payload: result }
            : run,
        ),
      );
      return result;
    } catch (requestError) {
      const endedAt = Date.now();
      const message = requestError instanceof Error ? requestError.message : String(requestError);
      setToolRunLog((current) =>
        current.map((run) =>
          run.id === runId
            ? { ...run, status: "failed", endedAt, durationMs: endedAt - startedAt, error: message, payload: { params } }
            : run,
        ),
      );
      throw requestError;
    }
  }, []);

  const fetchSnapshot = async (symbol: string, options: { background?: boolean } = {}) => {
    const nextSymbol = normalizeSymbol(symbol);
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    if (!options.background) {
      setLoading(true);
    }
    setLoadingSymbol(nextSymbol);
    setError(null);

    try {
      const response = await fetch(`/api/stocks-intelligence-watcher?symbol=${encodeURIComponent(nextSymbol)}`, {
        signal: controller.signal,
      });
      const body = await response.json() as StocksWatcherSnapshot;
      snapshotCacheRef.current.set(body.symbol, { snapshot: body, fetchedAt: Date.now() });
      const customStock = getStocksWatcherCustomStockFromSnapshot(body, getStocksWatcherUniverseStock(body.symbol));
      if (customStock) {
        setCustomStocks((current) => uniqueStocks([...current, customStock]));
      }
      setSnapshot(body);
      setSelectedSymbol(body.symbol);
      setSelectedExpiry(getStocksWatcherSnapshotExpiry(body));
      setExpiryOverviewState({ loading: false, error: null, data: null });
      setLastUpdatedAt(Date.now());
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") {
        return;
      }
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setLoading(false);
        setLoadingSymbol(null);
      }
    }
  };

  const loadSnapshot = async (symbol: string, options: { force?: boolean } = {}) => {
    const nextSymbol = normalizeSymbol(symbol);
    const decision = getStocksWatcherSnapshotLoadDecision({
      requestedSymbol: nextSymbol,
      selectedSymbol,
      loadingSymbol,
      force: options.force,
      cached: getFreshStocksWatcherCacheEntry(snapshotCacheRef.current, nextSymbol),
    });
    if (decision.skip) return;

    if (decision.cached) {
      setSnapshot(decision.cached.snapshot);
      setSelectedSymbol(decision.cached.snapshot.symbol);
      setSelectedExpiry(getStocksWatcherSnapshotExpiry(decision.cached.snapshot));
      setExpiryOverviewState({ loading: false, error: null, data: null });
      setLastUpdatedAt(decision.cached.fetchedAt);
      if (decision.backgroundRefresh) {
        void fetchSnapshot(decision.symbol, { background: true });
      }
      return;
    }

    await fetchSnapshot(decision.symbol);
  };

  const selectWatchlistSymbol = (symbol: string) => {
    void loadSnapshot(symbol);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      window.setTimeout(() => {
        detailPanelRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
      }, 80);
    }
  };

  useEffect(() => {
    void loadSnapshot(selectedSymbol);
  }, []);

  const loadFavoritesFromLocal = useCallback(() => {
    setFavorites(sanitizeSymbols(readStoredSymbols(FAVORITES_STORAGE_KEY, [])));
  }, []);

  const loadNativeWatchlist = useCallback(async () => {
    try {
      const result = await callNativeTool("get_watchlist", {});
      const parsed = parseWatchlistStocks(result);
      setNativeWatchlist(parsed.length > 0 ? parsed : STOCKS_WATCHER_UNIVERSE);
    } catch {
      setNativeWatchlist(STOCKS_WATCHER_UNIVERSE);
    }
  }, [callNativeTool]);

  useEffect(() => {
    loadFavoritesFromLocal();
    void loadNativeWatchlist();
  }, [loadFavoritesFromLocal, loadNativeWatchlist]);

  const runToolBundle = useCallback(async (
    tools: { name: string; params: Record<string, unknown> }[],
  ) => {
    const entries = await Promise.all(
      tools.map(async (tool) => [tool.name, await callNativeTool(tool.name, tool.params)] as const),
    );
    return Object.fromEntries(entries);
  }, [callNativeTool]);

  const loadTopTab = useCallback(async (tab: TopTab, force = false) => {
    if (tab === "Options") return;
    const symbol = normalizeSymbol(selectedSymbol);
    const cacheKey = getStocksWatcherTopTabCacheKey(symbol, tab);
    const cached = force ? null : tabDataCache.current.get(cacheKey);
    if (cached) {
      setTabPanelState({ loading: false, error: null, data: cached.data });
      return;
    }

    setTabPanelState({ loading: true, error: null, data: null });
    try {
      const data = await runToolBundle(getStocksWatcherTopTabToolPlan(tab, symbol));
      tabDataCache.current.set(cacheKey, { data, fetchedAt: Date.now() });
      setTabPanelState({ loading: false, error: null, data });
    } catch (requestError) {
      setTabPanelState({
        loading: false,
        error: requestError instanceof Error ? requestError.message : String(requestError),
        data: null,
      });
    }
  }, [runToolBundle, selectedSymbol]);

  const currentExpiry = selectedExpiry || snapshot?.selectedExpiry || snapshot?.availableExpiries?.[0] || snapshot?.expiries[0]?.expiry;

  const loadExpiryOverview = useCallback(async (expiry: string | null | undefined, force = false) => {
    if (!expiry) return;
    const symbol = normalizeSymbol(selectedSymbol);
    const expiryArg = toYahooExpiry(expiry);
    const cacheKey = `${symbol}:${expiryArg || "front"}:Overview`;
    const cached = force ? null : tabDataCache.current.get(cacheKey);
    if (cached) {
      setExpiryOverviewState({ loading: false, error: null, data: cached.data });
      return;
    }

    setExpiryOverviewState({ loading: true, error: null, data: null });
    try {
      const data = await runToolBundle(getStocksWatcherExpiryOverviewToolPlan(symbol, expiry));
      tabDataCache.current.set(cacheKey, { data, fetchedAt: Date.now() });
      setExpiryOverviewState({ loading: false, error: null, data });
    } catch (requestError) {
      setExpiryOverviewState({
        loading: false,
        error: requestError instanceof Error ? requestError.message : String(requestError),
        data: null,
      });
    }
  }, [runToolBundle, selectedSymbol]);

  const loadOptionsSubTab = useCallback(async (subTab: OptionsSubTab, force = false) => {
    if (subTab === "Overview") return;
    const symbol = normalizeSymbol(selectedSymbol);
    const cacheKey = getStocksWatcherOptionsSubTabCacheKey(symbol, currentExpiry, subTab);
    const cached = force ? null : tabDataCache.current.get(cacheKey);
    if (cached) {
      setSubTabPanelState({ loading: false, error: null, data: cached.data });
      return;
    }

    setSubTabPanelState({ loading: true, error: null, data: null });
    try {
      const data = await runToolBundle(getStocksWatcherOptionsSubTabToolPlan(subTab, symbol, currentExpiry));
      tabDataCache.current.set(cacheKey, { data, fetchedAt: Date.now() });
      setSubTabPanelState({ loading: false, error: null, data });
    } catch (requestError) {
      setSubTabPanelState({
        loading: false,
        error: requestError instanceof Error ? requestError.message : String(requestError),
        data: null,
      });
    }
  }, [currentExpiry, runToolBundle, selectedSymbol]);

  useEffect(() => {
    if (activeTab !== "Options") void loadTopTab(activeTab);
  }, [activeTab, loadTopTab]);

  useEffect(() => {
    if (activeTab === "Options" && activeSubTab !== "Overview") void loadOptionsSubTab(activeSubTab);
  }, [activeSubTab, activeTab, loadOptionsSubTab]);

  useEffect(() => {
    if (activeTab === "Options" && activeSubTab === "Overview" && currentExpiry) void loadExpiryOverview(currentExpiry);
  }, [activeSubTab, activeTab, currentExpiry, loadExpiryOverview]);

  const loadMarketContext = useCallback(async () => {
    setMarketContext((current) => ({ ...current, loading: true, error: null }));
    try {
      const [regime, breadth] = await Promise.all([
        callNativeTool("get_macro_regime", {}),
        callNativeTool("market_breadth", { market: "US" }),
      ]);
      setMarketContext({ loading: false, error: null, regime, breadth });
    } catch (requestError) {
      setMarketContext({
        loading: false,
        error: requestError instanceof Error ? requestError.message : String(requestError),
        regime: null,
        breadth: null,
      });
    }
  }, [callNativeTool]);

  useEffect(() => {
    void loadMarketContext();
  }, [loadMarketContext]);

  const allStocks = useMemo(() => uniqueStocks([...nativeWatchlist, ...customStocks]), [customStocks, nativeWatchlist]);

  const sectorOptions = useMemo(
    () => Array.from(new Set([...BASE_SECTOR_OPTIONS, ...allStocks.map((stock) => stock.sector)])).sort((a, b) => a === "All Sectors" ? -1 : b === "All Sectors" ? 1 : a.localeCompare(b)),
    [allStocks],
  );

  const typeOptions = useMemo(
    () => Array.from(new Set([...BASE_TYPE_OPTIONS, ...allStocks.map((stock) => stock.type)])).sort((a, b) => a === "All Types" ? -1 : b === "All Types" ? 1 : a.localeCompare(b)),
    [allStocks],
  );

  const watchlist = useMemo(() => {
    const nativeSymbols = allStocks.map((stock) => stock.symbol);
    const baseSymbols = watchlistSource === "favorites" ? favorites : nativeSymbols;
    const visibleSymbols = getStocksWatcherVisibleSymbols({
      favorites: baseSymbols,
      hiddenSymbols,
      selectedSymbol,
      defaultSymbols: nativeSymbols,
      limit: 60,
      query,
      sector: sectorFilter,
      type: typeFilter,
      universe: allStocks,
      includeSelected: false,
      includeDefaultSymbols: false,
      restrictToDefaultSymbols: false,
    });
    const bySymbol = new Map(allStocks.map((stock) => [stock.symbol, stock]));
    return visibleSymbols
      .map((symbol) => bySymbol.get(symbol) || getStocksWatcherUniverseStock(symbol))
      .filter((stock): stock is StocksWatcherUniverseStock => Boolean(stock));
  }, [allStocks, favorites, hiddenSymbols, query, sectorFilter, selectedSymbol, typeFilter, watchlistSource]);

  const favoriteCount = useMemo(() => {
    const hidden = new Set(hiddenSymbols.map(normalizeSymbol));
    return Array.from(new Set(favorites.map(normalizeSymbol))).filter((symbol) => symbol && !hidden.has(symbol)).length;
  }, [favorites, hiddenSymbols]);

  const availableTools = snapshot?.availableTools || [];
  const filteredTools = useMemo(() => {
    const needle = toolSearch.trim().toLowerCase();
    return availableTools.filter((tool) => !needle || `${tool.name} ${tool.description}`.toLowerCase().includes(needle));
  }, [availableTools, toolSearch]);

  const groupedTools = useMemo(() => {
    return filteredTools.reduce<Record<string, typeof filteredTools>>((groups, tool) => {
      const category = getToolCategory(tool.name);
      groups[category] ||= [];
      groups[category].push(tool);
      return groups;
    }, {});
  }, [filteredTools]);

  const submitSearch = () => {
    const requestedSymbol = normalizeSymbol(query);
    const exact = allStocks.find((stock) => stock.symbol === requestedSymbol);
    const looksLikeTicker = /^[A-Z0-9.^-]{1,12}$/.test(requestedSymbol);
    const nextSymbol = exact?.symbol || (looksLikeTicker ? requestedSymbol : watchlist[0]?.symbol);
    if (nextSymbol) void loadSnapshot(nextSymbol);
  };

  const toggleFavorite = (symbol: string) => {
    const normalized = normalizeSymbol(symbol);
    const nextFavorites = favorites.includes(normalized)
      ? favorites.filter((item) => item !== normalized)
      : [normalized, ...favorites];
    setFavorites(nextFavorites);
    void callNativeTool("save_memory", {
      key: FAVORITES_MEMORY_KEY,
      value: JSON.stringify({ symbols: nextFavorites }),
      symbols: nextFavorites,
    });
  };

  const removeSymbol = (symbol: string) => {
    const result = applyStocksWatcherSymbolRemoval(
      {
        favorites,
        hiddenSymbols,
        selectedSymbol,
        defaultSymbols: DEFAULT_WATCHLIST,
      },
      symbol,
    );

    setFavorites(result.favorites);
    setHiddenSymbols(result.hiddenSymbols);
    if (!DEFAULT_WATCHLIST.includes(normalizeSymbol(symbol))) {
      setCustomStocks((current) => current.filter((stock) => stock.symbol !== normalizeSymbol(symbol)));
    }
    void callNativeTool("save_memory", {
      key: FAVORITES_MEMORY_KEY,
      value: JSON.stringify({ symbols: result.favorites }),
      symbols: result.favorites,
    });

    if (result.nextSelectedSymbol !== selectedSymbol) {
      void loadSnapshot(result.nextSelectedSymbol);
    }
  };

  const refreshCurrent = () => {
    if (snapshot) void loadSnapshot(snapshot.symbol, { force: true });
  };

  const openStrikeDrawer = async (strike: number, expiry?: string | null) => {
    const nextExpiry = toYahooExpiry(expiry || currentExpiry || snapshot?.expiries[0]?.expiry) || "";
    const requestId = strikeDrawerRequestRef.current + 1;
    strikeDrawerRequestRef.current = requestId;
    setStrikeDrawer({ open: true, strike, expiry: nextExpiry, loading: true, error: null, data: null });
    try {
      const data = await runToolBundle(getStocksWatcherStrikeDetailToolPlan(selectedSymbol, nextExpiry, strike));
      if (strikeDrawerRequestRef.current !== requestId) return;
      setStrikeDrawer({ open: true, strike, expiry: nextExpiry, loading: false, error: null, data });
    } catch (requestError) {
      if (strikeDrawerRequestRef.current !== requestId) return;
      setStrikeDrawer({
        open: true,
        strike,
        expiry: nextExpiry,
        loading: false,
        error: requestError instanceof Error ? requestError.message : String(requestError),
        data: null,
      });
    }
  };

  const closeStrikeDrawer = () => {
    strikeDrawerRequestRef.current += 1;
    setStrikeDrawer({ open: false, strike: null, expiry: null, data: null });
  };

  const runSectorFilter = (sector: string) => {
    setSectorFilter(sector);
    setSectorState({ loading: false, error: null, data: null });
  };

  const openRunToolModal = (toolName: string) => {
    setModalState({
      type: "runTool",
      data: {
        toolName,
        paramsText: getToolInputDraft(toolName, selectedSymbol, currentExpiry, spotStrike?.strike),
        loading: false,
        error: null,
      },
    });
  };

  const submitRunToolModal = async () => {
    if (modalState.type !== "runTool") return;
    let params: Record<string, unknown>;
    try {
      params = JSON.parse(modalState.data.paramsText || "{}") as Record<string, unknown>;
    } catch {
      setModalState({ type: "runTool", data: { ...modalState.data, error: "JSON params æ ¼å¼éŒ¯èª¤ã€‚", loading: false } });
      return;
    }

    setModalState({ type: "runTool", data: { ...modalState.data, loading: true, error: null } });
    try {
      const result = await callNativeTool(modalState.data.toolName, params);
      setModalState({ type: "runTool", data: { ...modalState.data, result, loading: false, error: null } });
    } catch (requestError) {
      setModalState({
        type: "runTool",
        data: { ...modalState.data, loading: false, error: requestError instanceof Error ? requestError.message : String(requestError) },
      });
    }
  };

  const setChartTooltipForPoint = (row: StocksWatcherStrikeRow, x: number, y: number) => {
    setChartTooltip({
      strike: row.strike,
      callValue: Math.abs(getCallValue(row, mode)),
      putValue: Math.abs(getPutValue(row, mode)),
      netGex: row.netGex,
      x,
      y,
    });
  };

  const showChartTooltip = (
    row: StocksWatcherStrikeRow,
    event: ReactMouseEvent<HTMLDivElement>,
  ) => {
    const bounds = chartViewportRef.current?.getBoundingClientRect();
    setChartTooltipForPoint(
      row,
      bounds ? event.clientX - bounds.left + 14 : 20,
      bounds ? event.clientY - bounds.top - 18 : 20,
    );
  };

  const isPositive = (snapshot?.quote.change || 0) >= 0;
  const selectedChain = optionChainFromResult(expiryOverviewState.data?.get_options);
  const selectedExposures = optionExposuresFromResult(expiryOverviewState.data?.get_options_gex);
  const rows = buildStrikeRowsFromOptionRaw(selectedChain, selectedExposures, snapshot?.strikes || []);
  const expiryRows = buildExpiryRowsForSelector(snapshot);
  const optionsSectionMinHeightRem = Math.max(52, 3 + expiryRows.length * 2.35);
  const chartRows = rows.length > 0 ? rows : expiryRows
    .map((row, index) => {
      const strike = row.primaryStrike || row.strike || snapshot?.atm || index + 1;
      const callDominant = row.dominantType === "C" || row.type === "C";
      const callOpenInterest = callDominant ? row.openInterest : Math.round(row.openInterest * 0.35);
      const putOpenInterest = callDominant ? Math.round(row.openInterest * 0.35) : row.openInterest;
      const callVolume = callDominant ? row.volume : Math.round(row.volume * 0.35);
      const putVolume = callDominant ? Math.round(row.volume * 0.35) : row.volume;
      const callGex = Math.round(callOpenInterest * Math.max(strike, 1) * 4);
      const putGex = -Math.round(putOpenInterest * Math.max(strike, 1) * 4);
      return {
        strike,
        callOpenInterest,
        putOpenInterest,
        callVolume,
        putVolume,
        callGex,
        putGex,
        netGex: callGex + putGex,
      };
    })
    .sort((a, b) => a.strike - b.strike);
  const spotRowIndex = snapshot
    ? chartRows.reduce((bestIndex, row, index) => {
      const bestDistance = Math.abs(chartRows[bestIndex]?.strike - snapshot.spot);
      const currentDistance = Math.abs(row.strike - snapshot.spot);
      return currentDistance < bestDistance ? index : bestIndex;
    }, Math.max(0, Math.floor(chartRows.length / 2)))
    : Math.max(0, Math.floor(chartRows.length / 2));
  const focusedStart = Math.max(0, Math.min(chartRows.length, spotRowIndex - Math.floor(strikeWindowSize / 2)));
  const focusedEnd = Math.min(chartRows.length, focusedStart + strikeWindowSize);
  const focusedRows = chartRows.slice(Math.max(0, focusedEnd - strikeWindowSize), focusedEnd);
  const maxValue = mode === "gex"
    ? Math.max(1, ...(focusedRows.length > 0 ? focusedRows : chartRows).map((row) => Math.abs(row.netGex)))
    : getMaxForMode(focusedRows.length > 0 ? focusedRows : chartRows, mode);
  const spotStrike = snapshot ? getNearestSpotStrike(focusedRows, snapshot.spot) : null;
  const netGex = chartRows.reduce((sum, row) => sum + row.netGex, 0);
  const maxCallWall = chartRows.reduce<StocksWatcherStrikeRow | null>((best, row) => !best || row.callOpenInterest > best.callOpenInterest ? row : best, null);
  const maxPutWall = chartRows.reduce<StocksWatcherStrikeRow | null>((best, row) => !best || row.putOpenInterest > best.putOpenInterest ? row : best, null);
  const gammaFlipLevel = snapshot ? getGammaFlipLevel(chartRows, snapshot.spot) : null;
  const flipStrike = gammaFlipLevel === null ? null : getNearestSpotStrike(chartRows, gammaFlipLevel);
  const updatedSecondsAgo = lastUpdatedAt ? Math.max(0, Math.floor((now - lastUpdatedAt) / 1_000)) : null;
  const visibleRows = focusedRows.length > 0 ? focusedRows : chartRows;
  const axisTicks = mode === "gex"
    ? [
        { value: maxValue, position: 0 },
        { value: maxValue / 2, position: 25 },
        { value: 0, position: 50 },
        { value: -maxValue / 2, position: 75 },
        { value: -maxValue, position: 100 },
      ]
    : [
        { value: maxValue, position: 0 },
        { value: maxValue * 0.75, position: 25 },
        { value: maxValue * 0.5, position: 50 },
        { value: maxValue * 0.25, position: 75 },
        { value: 0, position: 100 },
      ];
  const callTotal = visibleRows.reduce((sum, row) => sum + Math.abs(getCallValue(row, mode)), 0);
  const putTotal = visibleRows.reduce((sum, row) => sum + Math.abs(getPutValue(row, mode)), 0);
  const dominantSide = callTotal >= putTotal ? "Calls" : "Puts";
  const dominantRow = visibleRows.reduce<StocksWatcherStrikeRow | null>((best, row) => {
    const rowScore = Math.abs(getCallValue(row, mode)) + Math.abs(getPutValue(row, mode));
    const bestScore = best ? Math.abs(getCallValue(best, mode)) + Math.abs(getPutValue(best, mode)) : -1;
    return rowScore > bestScore ? row : best;
  }, null);
  const aiSummaryPayload = useMemo(
    () => snapshot
      ? buildStocksWatcherAiSummaryPayload(snapshot, {
          selectedExpiry: currentExpiry,
          strikeRows: chartRows.length ? chartRows : snapshot.strikes,
          marketBreadth: marketContext.breadth?.text || snapshot.marketContext.breadth,
        })
      : null,
    [snapshot, currentExpiry, marketContext.breadth?.text, chartRows],
  );
  const aiSummary = useMemo<StocksWatcherAiSummaryResponse | null>(
    () => aiSummaryPayload ? buildStocksWatcherDeterministicSummary(aiSummaryPayload) : null,
    [aiSummaryPayload],
  );

  const renderAiSummaryPanel = () => {
    if (activeTab !== "Options") return null;
    if (!aiSummary) return null;
    const generatedAt = aiSummary.generatedAt
      ? new Date(aiSummary.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : null;
    const sections = [
      { title: "What it tells us", items: aiSummary.whatItTellsUs },
      { title: "Why it matters", items: aiSummary.whyItMatters },
      { title: "How to act", items: aiSummary.howToAct },
    ];

    return (
      <section data-ai-summary-panel className="rounded-md border border-blue-400/25 bg-[#08111d] p-4 shadow-[inset_0_1px_0_rgba(96,165,250,0.12)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-black text-blue-100">
              <Sparkles className="h-4 w-4 text-blue-300" />
              AI Summary
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Deterministic rules readout from the visible watcher payload. No OpenRouter call, no outside market data, no buy/sell call.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
            <span className="rounded border border-blue-400/25 bg-blue-400/10 px-2 py-1 text-blue-100">{aiSummary.model}</span>
            {generatedAt && <span className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-400">snapshot {generatedAt}</span>}
          </div>
        </div>

        <p className="mt-4 text-xl font-black text-white">{aiSummary.headline}</p>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {sections.map((section) => (
            <div key={section.title} className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-blue-300">{section.title}</p>
              <ul className="mt-3 space-y-2 text-xs leading-5 text-slate-300">
                {section.items.map((item) => (
                  <li key={item} className="border-l border-slate-700 pl-3">{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {aiSummary.caveats.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {aiSummary.caveats.map((caveat) => (
              <span key={caveat} className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[0.68rem] font-bold text-slate-400">
                {caveat}
              </span>
            ))}
          </div>
        )}
      </section>
    );
  };

  const renderGenericPanel = (state: AsyncPanelState, retry: () => void) => (
    <div className="flex min-h-[22rem] flex-1 flex-col p-3 sm:min-h-[30rem] sm:p-4">
      {state.loading && (
        <div className="space-y-3">
          <SkeletonBlock className="h-8 w-48" />
          <SkeletonBlock className="h-64 w-full" />
          <SkeletonBlock className="h-24 w-full" />
        </div>
      )}
      {state.error && <ErrorBanner message={state.error} onRetry={retry} />}
      {state.data && (
          <div className={`grid min-w-0 gap-4 ${activeTab === "Chart" ? "min-h-0 flex-1 auto-rows-fr grid-cols-1" : "xl:grid-cols-2"}`}>
            {Object.values(state.data).map((result) => (
            <div key={result.tool} className={`min-w-0 overflow-hidden rounded-md border border-slate-800 bg-slate-950/50 p-3 ${activeTab === "Chart" ? "flex min-h-0 flex-col" : ""}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-black text-blue-100">{result.tool}</h3>
                <span className="rounded border border-slate-700 px-2 py-1 text-[0.65rem] uppercase text-slate-400">Native</span>
              </div>
              <ToolResultBlock result={result} />
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderOptionsOverview = () => (
    <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-black text-blue-100">
            {modeLabel[mode]} by Strike
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {formatExpiryDate(currentExpiry, "long")} - calls are green, puts are red, spot/flip/walls are marked directly on the strike tape.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2 text-xs font-black">
          <span className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-300">
            {snapshot?.source === "native_yahoo" ? "Native Yahoo" : "Demo fallback"}
          </span>
          <span className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-300">
            Updated {snapshot ? new Date(snapshot.generatedAt).toLocaleString() : "--"}
          </span>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs font-black">
        <span className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-blue-100">Exp {formatExpiryDate(currentExpiry, "compact")}</span>
        <span className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-yellow-300">Spot {snapshot ? currency(snapshot.spot) : "--"}</span>
        <span className={`rounded border border-slate-700 bg-slate-900 px-2 py-1 ${dominantSide === "Calls" ? "text-emerald-300" : "text-red-300"}`}>
          Dom {dominantSide}{dominantRow ? ` @ ${dominantRow.strike}` : ""}
        </span>
        <span className={`rounded border border-slate-700 bg-slate-900 px-2 py-1 ${netGex >= 0 ? "text-emerald-300" : "text-red-300"}`}>
          {mode === "gex" ? "Net" : "Regime"} {mode === "gex" ? formatNumber(netGex) : snapshot?.gexRegime || "--"}
        </span>
        <span className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-300">P/C {snapshot?.putCallVolume.toFixed(2) || "--"}</span>
        <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-cyan-300">Flip {gammaFlipLevel === null ? "--" : currency(gammaFlipLevel)}</span>
        <span className="rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 text-yellow-300">C Wall {maxCallWall ? currency(maxCallWall.strike) : "--"}</span>
        <span className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-red-300">P Wall {maxPutWall ? currency(maxPutWall.strike) : "--"}</span>
        <div className="ml-auto flex min-w-[16rem] items-center gap-3">
          <label htmlFor="strike-window-slider" className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">
            Strike Zoom
          </label>
          <input
            id="strike-window-slider"
            aria-label="Strike zoom"
            type="range"
            min={9}
            max={Math.max(9, Math.min(80, chartRows.length || 29))}
            step={2}
            value={Math.min(strikeWindowSize, Math.max(9, Math.min(80, chartRows.length || 29)))}
            onChange={(event) => setStrikeWindowSize(Number(event.target.value))}
            className="h-2 min-w-24 flex-1 cursor-pointer accent-blue-400"
          />
          <span className="w-16 text-right text-xs font-bold text-blue-100">
            {visibleRows.length || 0}
          </span>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={refreshCurrent} />}
      {snapshot?.warnings.map((warning) => (
        <p key={warning} className="mb-3 rounded-md border border-yellow-400/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-100">
          {warning}
        </p>
      ))}

      {expiryOverviewState.loading && <SkeletonBlock className="mb-4 h-8 w-64" />}
      {expiryOverviewState.error && <ErrorBanner message={expiryOverviewState.error} onRetry={() => void loadExpiryOverview(currentExpiry, true)} />}
      {!expiryOverviewState.loading && chartRows.length === 0 && (
        <OptionsEmptyState expiry={currentExpiry} onRetry={() => void loadExpiryOverview(currentExpiry, true)} />
      )}

      {chartRows.length > 0 && (
      <div
        ref={chartViewportRef}
        data-options-chart-viewport
        className="relative mt-2 min-h-[22rem] flex-1 overflow-x-hidden overflow-y-hidden rounded-md border border-slate-800 bg-[#07111d] shadow-[inset_0_1px_0_rgba(148,163,184,0.08)]"
        onMouseLeave={() => setChartTooltip(null)}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(59,130,246,0.12),transparent_34%),linear-gradient(180deg,rgba(148,163,184,0.045)_0,rgba(148,163,184,0)_42%)]" />
        {mode === "gex" && (
          <div className="pointer-events-none absolute bottom-12 left-0 right-0 top-10 min-w-0">
            <div className="absolute inset-x-0 top-0 h-1/2 border-b border-blue-300/25 bg-emerald-400/[0.035]" />
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-red-400/[0.035]" />
            <span className="sticky left-4 top-14 rounded border border-emerald-400/20 bg-[#07111d]/85 px-2 py-1 text-[0.65rem] font-black uppercase tracking-[0.12em] text-emerald-200/75">
              Positive gamma
            </span>
            <span className="sticky left-4 top-[calc(50%+2.75rem)] rounded border border-red-400/20 bg-[#07111d]/85 px-2 py-1 text-[0.65rem] font-black uppercase tracking-[0.12em] text-red-200/75">
              Negative gamma
            </span>
          </div>
        )}
        <div className="sticky left-0 top-0 z-10 flex h-10 items-center justify-between border-b border-slate-800 bg-[#07111d]/95 px-4 text-xs font-black text-slate-300 backdrop-blur">
          <div className="flex items-center gap-3">
            <span>{chartMetricLabel[mode]} surface</span>
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]" />
            <span className="text-slate-500">{mode === "gex" ? "+GEX" : "Calls"}</span>
            <span className="h-2 w-2 rounded-full bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.45)]" />
            <span className="text-slate-500">{mode === "gex" ? "-GEX" : "Puts"}</span>
          </div>
          <span className="text-slate-500">Click strike for drilldown</span>
        </div>
        <div className="pointer-events-none absolute bottom-12 left-0 right-0 top-10 z-0 min-w-0">
          {axisTicks.map((tick) => (
            <div
              key={`${mode}-axis-${tick.value}`}
              className={`absolute left-0 right-0 border-t ${mode === "gex" && tick.value === 0 ? "border-blue-200/45" : "border-slate-800/80"}`}
              style={{ top: `${tick.position}%` }}
            >
              <span className={`sticky left-0 ml-3 -translate-y-1/2 rounded bg-[#07111d]/95 px-1.5 text-[0.65rem] font-bold ${mode === "gex" && tick.value === 0 ? "text-blue-200" : "text-slate-500"}`}>
                {formatNumber(tick.value)}
              </span>
            </div>
          ))}
        </div>
        {chartTooltip && (
          <div
            className="pointer-events-none absolute z-30 min-w-44 rounded-md border border-slate-600 bg-slate-950/95 px-3 py-2 text-xs text-slate-100 shadow-2xl"
            style={{
              left: chartTooltip.x,
              top: Math.max(48, chartTooltip.y),
            }}
          >
            <p className="font-black text-blue-100">Strike {chartTooltip.strike}</p>
            <p className="mt-2 text-emerald-300">Call {formatNumber(chartTooltip.callValue)}</p>
            <p className="text-red-300">Put {formatNumber(chartTooltip.putValue)}</p>
            <p className={chartTooltip.netGex >= 0 ? "text-emerald-300" : "text-red-300"}>Net GEX {formatNumber(chartTooltip.netGex)}</p>
          </div>
        )}
        <div className="absolute bottom-12 left-0 right-0 top-10 flex min-w-0 items-stretch gap-1 px-4 pt-5 sm:gap-1.5 sm:px-6">
          {visibleRows.map((row) => {
            const callValue = Math.abs(getCallValue(row, mode));
            const putValue = Math.abs(getPutValue(row, mode));
            const netGamma = row.netGex;
            const netGammaHeight = Math.max(2, (Math.abs(netGamma) / maxValue) * 92);
            const callHeight = Math.max(2, (callValue / maxValue) * 88);
            const putHeight = Math.max(2, (putValue / maxValue) * 88);
            const isSpotStrike = row.strike === spotStrike?.strike;
            const isFlipStrike = mode === "gex" && row.strike === flipStrike?.strike;
            const isCallWall = row.strike === maxCallWall?.strike;
            const isPutWall = row.strike === maxPutWall?.strike;

            return (
              <div
                key={row.strike}
                data-chart-bar
                className="group relative flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-end outline-none"
                onClick={() => void openStrikeDrawer(row.strike, currentExpiry)}
                onMouseEnter={(event) => showChartTooltip(row, event)}
                onMouseMove={(event) => showChartTooltip(row, event)}
                onFocus={(event) => {
                  const bounds = chartViewportRef.current?.getBoundingClientRect();
                  const target = event.currentTarget.getBoundingClientRect();
                  setChartTooltipForPoint(
                    row,
                    bounds ? target.left - bounds.left + target.width / 2 + 14 : 20,
                    bounds ? target.top - bounds.top - 18 : 20,
                  );
                }}
                onBlur={() => setChartTooltip(null)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void openStrikeDrawer(row.strike, currentExpiry);
                  }
                }}
                tabIndex={0}
              >
                {isSpotStrike && (
                  <div className="absolute bottom-0 top-0 z-20 border-l border-yellow-300/80">
                    <span className="absolute -top-6 -translate-x-1/2 whitespace-nowrap rounded border border-yellow-300/60 bg-[#0b111a] px-1.5 py-0.5 text-[0.62rem] font-black text-yellow-200 shadow-[0_0_18px_rgba(250,204,21,0.2)]">
                      Spot {snapshot ? currency(snapshot.spot) : "--"}
                    </span>
                  </div>
                )}
                {isFlipStrike && (
                  <div className="absolute bottom-0 top-8 z-10 border-l border-cyan-300/80">
                    <span className="absolute -top-5 -translate-x-1/2 whitespace-nowrap rounded bg-cyan-400/15 px-1.5 py-0.5 text-[0.65rem] font-black text-cyan-200">
                      Flip {gammaFlipLevel === null ? "" : currency(gammaFlipLevel)}
                    </span>
                  </div>
                )}
                {mode === "gex" ? (
                  <div className="relative flex h-full w-full flex-col justify-center">
                    <div className="pointer-events-none absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-slate-700/25" />
                    {(isCallWall || isPutWall) && (
                      <span className={`absolute left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded border px-1.5 py-0.5 text-[0.58rem] font-black ${
                        isCallWall
                          ? "top-3 border-yellow-300/40 bg-yellow-300/10 text-yellow-200"
                          : "bottom-3 border-red-300/40 bg-red-400/10 text-red-200"
                      }`}>
                        {isCallWall ? "C Wall" : "P Wall"}
                      </span>
                    )}
                    <div className="relative flex h-1/2 items-end justify-center border-b border-blue-300/30">
                      {netGamma >= 0 && (
                      <div
                        className="w-3 rounded-t-[2px] bg-gradient-to-t from-emerald-600/75 to-emerald-300 shadow-[0_0_16px_rgba(16,185,129,0.2)] transition-all group-hover:w-4 group-hover:from-emerald-500 group-hover:to-emerald-200 sm:w-4 sm:group-hover:w-5"
                        style={{ height: `${netGammaHeight}%` }}
                        title={`Net GEX ${formatNumber(netGamma)}`}
                      />
                      )}
                    </div>
                    <div className="relative flex h-1/2 items-start justify-center">
                      {netGamma < 0 && (
                      <div
                        className="w-3 rounded-b-[2px] bg-gradient-to-b from-red-400 to-red-700/75 shadow-[0_0_16px_rgba(248,113,113,0.18)] transition-all group-hover:w-4 group-hover:from-red-300 group-hover:to-red-500 sm:w-4 sm:group-hover:w-5"
                        style={{ height: `${netGammaHeight}%` }}
                        title={`Net GEX ${formatNumber(netGamma)}`}
                      />
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full w-full items-end justify-center gap-1 sm:gap-1.5">
                    <div
                      className={`w-2.5 rounded-t-sm bg-emerald-500/85 shadow-[0_0_12px_rgba(16,185,129,0.18)] transition-colors group-hover:bg-emerald-300 sm:w-3 ${isCallWall ? "ring-1 ring-yellow-300" : ""}`}
                      style={{ height: `${callHeight}%` }}
                      title={`Call ${formatNumber(callValue)}`}
                    />
                    <div
                      className={`w-2.5 rounded-t-sm bg-red-500/80 shadow-[0_0_12px_rgba(239,68,68,0.16)] transition-colors group-hover:bg-red-300 sm:w-3 ${isPutWall ? "ring-1 ring-red-200" : ""}`}
                      style={{ height: `${putHeight}%` }}
                      title={`Put ${formatNumber(putValue)}`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="absolute bottom-0 left-0 right-0 flex h-12 min-w-0 items-start gap-1 border-t border-slate-800/90 bg-[#07111d] px-4 pt-2 sm:gap-1.5 sm:px-6">
          {visibleRows.map((row) => {
            const isSpotStrike = row.strike === spotStrike?.strike;
            return (
              <button
                key={`axis-${row.strike}`}
                type="button"
                className={`min-w-0 flex-1 text-center text-[0.56rem] font-semibold leading-none outline-none transition-colors hover:text-blue-200 focus-visible:text-blue-200 sm:text-[0.62rem] ${isSpotStrike ? "text-yellow-300" : "text-slate-500"}`}
                onClick={() => void openStrikeDrawer(row.strike, currentExpiry)}
              >
                {isSpotStrike ? (
                  <span className="inline-flex -translate-y-1 flex-col items-center gap-1">
                    <span>{row.strike}</span>
                    <span className="rounded bg-yellow-300 px-1.5 py-0.5 text-[0.58rem] font-black text-slate-950">Spot</span>
                  </span>
                ) : (
                  <span className="inline-block origin-top -rotate-45 whitespace-nowrap">{row.strike}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      )}
    </div>
  );

  const renderChainPanel = (result: NativeToolResult) => {
    const chain = optionChainFromResult(result);
    if (!chain) return <ToolResultBlock result={result} />;
    const calls = [...(chain.calls || [])].sort((a, b) => optionLegNumber(a.strike) - optionLegNumber(b.strike)).slice(0, 36);
    const puts = [...(chain.puts || [])].sort((a, b) => optionLegNumber(a.strike) - optionLegNumber(b.strike)).slice(0, 36);
    const renderLegTable = (legs: RawOptionLeg[], side: "C" | "P") => (
      <div className="overflow-hidden rounded-md border border-slate-800">
        <div className={`border-b border-slate-800 px-3 py-2 text-sm font-black ${side === "C" ? "text-emerald-200" : "text-red-200"}`}>
          {side === "C" ? "Calls" : "Puts"} - {formatExpiryDate(chain.selectedExpiry, "long")}
        </div>
        <div className="max-h-[30rem] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[#0b111a] text-blue-200">
              <tr>
                <th className="px-3 py-2">Strike</th>
                <th className="px-3 py-2 text-right">Bid</th>
                <th className="px-3 py-2 text-right">Ask</th>
                <th className="px-3 py-2 text-right">Vol</th>
                <th className="px-3 py-2 text-right">OI/Vol</th>
                <th className="px-3 py-2 text-right">IV</th>
              </tr>
            </thead>
            <tbody>
              {legs.map((leg) => (
                <tr key={`${side}-${leg.contractSymbol || leg.strike}`} className="border-t border-slate-800 text-slate-200">
                  <td className="px-3 py-2 font-black text-white">{optionLegNumber(leg.strike)}</td>
                  <td className="px-3 py-2 text-right">{optionLegNumber(leg.bid).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{optionLegNumber(leg.ask).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(optionLegNumber(leg.volume))}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(effectiveLegOpenInterest(leg))}</td>
                  <td className="px-3 py-2 text-right">{(optionLegNumber(leg.impliedVolatility) || (optionLegNumber(leg.lastPrice) > 0 ? 20 : 0)).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );

    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
            <p className="text-xs uppercase text-slate-500">Selected Expiry</p>
            <p className="mt-1 text-lg font-black text-blue-100">{formatExpiryDate(chain.selectedExpiry, "long")}</p>
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
            <p className="text-xs uppercase text-slate-500">Spot</p>
            <p className="mt-1 text-lg font-black text-yellow-300">{currency(optionLegNumber(chain.spot))}</p>
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
            <p className="text-xs uppercase text-slate-500">Contracts Loaded</p>
            <p className="mt-1 text-lg font-black text-white">{(chain.calls || []).length + (chain.puts || []).length}</p>
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {renderLegTable(calls, "C")}
          {renderLegTable(puts, "P")}
        </div>
      </div>
    );
  };

  const renderOptionResultPanel = (result: NativeToolResult) => {
    const chain = optionChainFromResult(result);
    const exposures = optionExposuresFromResult(result);
    const raw = rawRecord(result.raw);
    const flowRows = Array.isArray(raw?.flowRows)
      ? raw.flowRows.map(rawRecord).filter((row): row is Record<string, unknown> => Boolean(row))
      : [];
    const legs = Array.isArray(raw?.legs)
      ? raw.legs.map(rawRecord).filter((row): row is Record<string, unknown> => Boolean(row))
      : [];
    if (resultLooksHtml(result)) return <ToolResultBlock result={result} />;
    if (result.tool === "get_options") return renderChainPanel(result);
    if (flowRows.length > 0) {
      return (
        <div className="overflow-hidden rounded-md border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#0b111a] text-blue-200">
              <tr>
                <th className="px-3 py-2">Ticker</th>
                <th className="px-3 py-2 text-right">Dollar Vol</th>
                <th className="px-3 py-2 text-right">Change %</th>
                <th className="px-3 py-2 text-right">Proxy Flow</th>
              </tr>
            </thead>
            <tbody>
              {flowRows.slice(0, 28).map((row) => {
                const symbol = String(row.symbol || "--");
                const changePercent = optionLegNumber(row.changePercent);
                const proxyFlow = optionLegNumber(row.proxyFlow);
                return (
                  <tr key={`${result.tool}-${symbol}`} className="border-t border-slate-800 text-slate-200">
                    <td className="px-3 py-2 font-black text-white">{symbol}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(optionLegNumber(row.dollarVolume))}</td>
                    <td className={`px-3 py-2 text-right ${changePercent >= 0 ? "text-emerald-300" : "text-red-300"}`}>{changePercent.toFixed(2)}%</td>
                    <td className={`px-3 py-2 text-right ${proxyFlow >= 0 ? "text-emerald-300" : "text-red-300"}`}>{formatNumber(proxyFlow)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }
    if (legs.length > 0) {
      return (
        <div className="overflow-hidden rounded-md border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#0b111a] text-blue-200">
              <tr>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Strike</th>
                <th className="px-3 py-2 text-right">Volume</th>
                <th className="px-3 py-2 text-right">OI</th>
                <th className="px-3 py-2 text-right">Bid</th>
                <th className="px-3 py-2 text-right">Ask</th>
                <th className="px-3 py-2 text-right">IV</th>
              </tr>
            </thead>
            <tbody>
              {legs.slice(0, 28).map((leg, index) => {
                const type = String(leg.type || "--");
                return (
                  <tr key={`${result.tool}-${type}-${leg.contractSymbol || index}`} className="border-t border-slate-800 text-slate-200">
                    <td className={`px-3 py-2 font-black ${type === "C" ? "text-emerald-300" : "text-red-300"}`}>{type}</td>
                    <td className="px-3 py-2 text-right font-black text-white">{optionLegNumber(leg.strike)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(optionLegNumber(leg.volume))}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(optionLegNumber(leg.openInterest))}</td>
                    <td className="px-3 py-2 text-right">{optionLegNumber(leg.bid).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{optionLegNumber(leg.ask).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{optionLegNumber(leg.impliedVolatility).toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }
    if (exposures.length > 0) {
      return (
        <div className="overflow-hidden rounded-md border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#0b111a] text-blue-200">
              <tr>
                <th className="px-3 py-2">Strike</th>
                <th className="px-3 py-2 text-right">Call OI/Vol</th>
                <th className="px-3 py-2 text-right">Put OI/Vol</th>
                <th className="px-3 py-2 text-right">Net GEX</th>
                <th className="px-3 py-2 text-right">Net DEX</th>
                <th className="px-3 py-2 text-right">Avg IV</th>
              </tr>
            </thead>
            <tbody>
              {exposures.slice(0, 28).map((row) => {
                const callOi = effectiveLegOpenInterest(row.call, row.callEffectiveOpenInterest ?? row.callOpenInterest);
                const putOi = effectiveLegOpenInterest(row.put, row.putEffectiveOpenInterest ?? row.putOpenInterest);
                const netGexValue = optionLegNumber(row.netGex);
                const netDexValue = optionLegNumber(row.netDex);
                return (
                  <tr key={`${result.tool}-${row.strike}`} className="border-t border-slate-800 text-slate-200">
                    <td className="px-3 py-2 font-black text-white">{optionLegNumber(row.strike)}</td>
                    <td className="px-3 py-2 text-right text-emerald-300">{formatNumber(callOi)}</td>
                    <td className="px-3 py-2 text-right text-red-300">{formatNumber(putOi)}</td>
                    <td className={`px-3 py-2 text-right ${netGexValue >= 0 ? "text-emerald-300" : "text-red-300"}`}>{formatNumber(netGexValue)}</td>
                    <td className={`px-3 py-2 text-right ${netDexValue >= 0 ? "text-emerald-300" : "text-red-300"}`}>{formatNumber(netDexValue)}</td>
                    <td className="px-3 py-2 text-right">{effectiveExposureIv(row).toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }
    if (raw && ("putCallOpenInterest" in raw || "putCallVolume" in raw)) {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-slate-800 bg-slate-950/60 p-4">
            <p className="text-xs uppercase text-slate-500">P/C Open Interest</p>
            <p className="mt-1 text-2xl font-black text-emerald-200">{optionLegNumber(raw.putCallOpenInterest).toFixed(2)}</p>
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-950/60 p-4">
            <p className="text-xs uppercase text-slate-500">P/C Volume</p>
            <p className="mt-1 text-2xl font-black text-blue-200">{optionLegNumber(raw.putCallVolume).toFixed(2)}</p>
          </div>
        </div>
      );
    }
    if (chain) return renderChainPanel(result);
    return <ToolResultBlock result={result} />;
  };

  const renderOptionsSubTab = () => {
    if (activeSubTab === "Overview") return renderOptionsOverview();
    return (
      <div className="min-h-[22rem] overflow-hidden p-3 sm:min-h-[30rem] sm:p-4">
        {subTabPanelState.loading && (
          <div className="space-y-3">
            <SkeletonBlock className="h-8 w-56" />
            <SkeletonBlock className="h-72 w-full" />
          </div>
        )}
        {subTabPanelState.error && <ErrorBanner message={subTabPanelState.error} onRetry={() => void loadOptionsSubTab(activeSubTab, true)} />}
        {!subTabPanelState.loading && !subTabPanelState.error && !subTabPanelState.data && (
          <OptionsEmptyState expiry={currentExpiry} onRetry={() => void loadOptionsSubTab(activeSubTab, true)} />
        )}
        {subTabPanelState.data && (
          activeSubTab === "Chain" && subTabPanelState.data.get_options
            ? renderChainPanel(subTabPanelState.data.get_options)
            : (
              <div className="grid min-w-0 gap-4 xl:grid-cols-2">
                {Object.values(subTabPanelState.data).map((result) => (
                  <div key={result.tool} className="min-w-0 overflow-hidden rounded-md border border-slate-800 bg-slate-950/50 p-3">
                    <div className="mb-2 text-sm font-black text-blue-100">{result.tool}</div>
                    {renderOptionResultPanel(result)}
                  </div>
                ))}
              </div>
            )
        )}
      </div>
    );
  };

  return (
    <section className="h-full min-h-full w-full overflow-x-hidden overflow-y-auto bg-[#080d14] text-slate-100 lg:overflow-hidden">
      <div className={`grid min-h-full grid-cols-1 pt-2 lg:h-full ${watchlistCollapsed ? "lg:grid-cols-[4.5rem_minmax(0,1fr)]" : "lg:grid-cols-[28rem_minmax(0,1fr)]"}`}>
        <aside className={`border-r border-slate-700/50 bg-[#070b11] pb-5 pt-4 lg:h-full ${watchlistCollapsed ? "px-2" : "px-4 sm:px-5"}`}>
          {watchlistCollapsed ? (
            <div className="flex h-full flex-col items-center gap-3">
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setWatchlistCollapsed(false);
                }}
                className="flex h-10 w-10 items-center justify-center rounded-md border border-blue-400/50 bg-blue-500/15 text-blue-100 transition-colors hover:bg-blue-500/25"
                title="Expand watchlist"
                aria-label="Expand watchlist"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={refreshCurrent}
                className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-slate-300 transition-colors hover:border-blue-400 hover:text-blue-300"
                title="Refresh"
                aria-label="Refresh"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </button>
              <div className="mt-2 flex min-h-28 w-10 items-center justify-center rounded-md border border-slate-800 bg-slate-950/70 text-xs font-black tracking-[0.18em] text-blue-100 [writing-mode:vertical-rl]">
                {selectedSymbol}
              </div>
              <div className="h-px w-8 bg-slate-800" />
              <div className="flex flex-col gap-2">
                {watchlist.slice(0, 8).map((stock) => (
                  <button
                    key={stock.symbol}
                    type="button"
                    onClick={() => selectWatchlistSymbol(stock.symbol)}
                    className={`flex h-9 w-10 items-center justify-center rounded-md border text-[0.65rem] font-black transition-colors ${
                      stock.symbol === selectedSymbol
                        ? "border-blue-400/60 bg-blue-500/20 text-blue-100"
                        : "border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-600 hover:text-white"
                    }`}
                    title={stock.symbol}
                  >
                    {stock.symbol.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
          <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onBackToWork}
              className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-400 transition-colors hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Work Gallery
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={refreshCurrent}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-slate-300 transition-colors hover:border-blue-400 hover:text-blue-300"
                title="Refresh"
                aria-label="Refresh watchlist"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setWatchlistCollapsed(true);
                }}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-slate-300 transition-colors hover:border-blue-400 hover:text-blue-300"
                title="Collapse watchlist"
                aria-label="Collapse watchlist"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <label className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitSearch();
                }}
                className="h-10 w-full rounded-md border border-slate-700 bg-[#0b111a] pl-9 pr-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-blue-400"
                name="stock-search"
                autoComplete="off"
                placeholder="Search ticker or company…"
              />
            </label>
            <button
              type="button"
              onClick={submitSearch}
              className="rounded-md border border-blue-400/50 bg-blue-500/15 px-4 text-xs font-bold uppercase tracking-[0.14em] text-blue-100 transition-colors hover:bg-blue-500/25"
            >
              Load
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="relative flex-1">
              <select
                aria-label="Sector filter"
                value={sectorFilter}
                onChange={(event) => runSectorFilter(event.target.value)}
                className="h-9 w-full appearance-none rounded-md border border-slate-700 bg-[#0b111a] px-3 pr-8 text-sm text-white outline-none"
              >
                {sectorOptions.map((sector) => <option key={sector}>{sector}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            </label>
            <label className="relative flex-1">
              <select
                aria-label="Type filter"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
                className="h-9 w-full appearance-none rounded-md border border-slate-700 bg-[#0b111a] px-3 pr-8 text-sm text-white outline-none"
              >
                {typeOptions.map((type) => <option key={type}>{type}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            </label>
          </div>
          {sectorState.loading && <SkeletonBlock className="mt-2 h-7 w-full" />}
          {sectorState.error && <p className="mt-2 rounded border border-red-400/30 bg-red-500/10 px-2 py-1 text-xs text-red-100">{sectorState.error}</p>}

          <div className="mt-3 flex items-center gap-2 border-b border-slate-800 pb-3">
            <button
              type="button"
              onClick={() => {
                setWatchlistSource("all");
                void loadNativeWatchlist();
              }}
              className={`rounded-full border px-4 py-1.5 text-sm ${watchlistSource === "all" ? "border-blue-400/60 bg-blue-500/20 text-blue-100" : "border-slate-700 text-slate-200"}`}
            >
              All Stocks
            </button>
            <button
              type="button"
              onClick={() => {
                setWatchlistSource("favorites");
                loadFavoritesFromLocal();
              }}
              className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${watchlistSource === "favorites" ? "border-blue-400/60 bg-blue-500/20 text-blue-100" : "border-slate-700 text-slate-200"}`}
            >
              FAV ({favoriteCount})
            </button>
            <button
              type="button"
              onClick={() => toggleFavorite(selectedSymbol)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 text-slate-300 hover:border-blue-400 hover:text-blue-200"
              title="Toggle favorite"
            >
              <Star className={`h-4 w-4 ${favorites.includes(selectedSymbol) ? "fill-blue-300 text-blue-300" : ""}`} />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-[2rem_1fr_5rem_5rem_5rem_2rem] items-center border-b border-slate-800 pb-2 text-xs font-bold text-slate-400">
            <span />
            <span>Ticker</span>
            <span>Price</span>
            <span>Chg</span>
            <span>Chg%</span>
            <span />
          </div>

          <div className="max-h-[20rem] overflow-y-auto lg:max-h-[calc(100vh-22rem)]">
            {watchlist.map((stock) => {
              const symbol = stock.symbol;
              const selected = symbol === selectedSymbol;
              const cachedRowQuote = getFreshStocksWatcherCacheEntry(snapshotCacheRef.current, symbol)?.snapshot.quote ?? null;
              const rowQuote = selected && snapshot?.symbol === symbol ? snapshot.quote : cachedRowQuote;
              const change = rowQuote?.change ?? stock.fallbackChange;
              const rowPositive = change >= 0;
              const isRowLoading = loadingSymbol === symbol;
              const isFavorite = favorites.includes(symbol);

              return (
                <div
                  key={symbol}
                  data-watchlist-row={symbol}
                  data-stock-sector={stock.sector}
                  data-stock-type={stock.type}
                  role="button"
                  tabIndex={0}
                  title={`${stock.symbol} - ${stock.companyName}`}
                  onClick={() => selectWatchlistSymbol(symbol)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectWatchlistSymbol(symbol);
                    }
                  }}
                  className={`grid w-full cursor-pointer grid-cols-[2rem_minmax(3.5rem,1fr)_4.5rem_4rem_4rem_2rem] items-center border-b border-slate-800 py-3 text-left text-xs transition-colors hover:bg-slate-900 sm:grid-cols-[2rem_1fr_5rem_5rem_5rem_2rem] sm:text-sm ${selected ? "border-b-blue-400 bg-blue-500/5" : ""}`}
                >
                  <input
                    type="checkbox"
                    aria-label={`Favorite ${symbol}`}
                    checked={isFavorite}
                    onChange={() => toggleFavorite(symbol)}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    className="h-4 w-4 cursor-pointer accent-blue-400"
                  />
                  <span className="min-w-0 truncate font-black text-white">{symbol}{isRowLoading ? " …" : ""}</span>
                  <span>{rowQuote ? currency(rowQuote.price) : currency(stock.fallbackPrice)}</span>
                  <span className={rowPositive ? "text-emerald-400" : "text-red-400"}>{rowPositive ? "+" : ""}{change.toFixed(2)}</span>
                  <span className={rowPositive ? "text-emerald-400" : "text-red-400"}>
                    {rowPositive ? "+" : ""}{(rowQuote?.changePercent ?? stock.fallbackChangePercent).toFixed(2)}%
                  </span>
                  <button
                    type="button"
                    title="Remove ticker"
                    aria-label={`Remove ${symbol}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeSymbol(symbol);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        removeSymbol(symbol);
                      }
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-800 hover:text-red-300"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
            {watchlist.length === 0 && (
              <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-6 text-center text-sm text-slate-400">
                No stocks match this search/filter.
              </div>
            )}
          </div>
          </>
          )}
        </aside>

        <main ref={detailPanelRef} className="flex min-w-0 flex-col overflow-y-visible px-4 pb-6 pt-4 sm:px-6 lg:overflow-y-auto">
          <header className="flex flex-col gap-4 border-b border-slate-800 pb-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="flex flex-wrap items-baseline gap-2">
                <h1 className="text-3xl font-black tracking-normal text-white">{snapshot?.symbol || selectedSymbol}</h1>
                <span className="text-2xl font-black">{snapshot ? currency(snapshot.quote.price) : "--"}</span>
                {snapshot && (
                  <span className={`font-bold ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
                    {isPositive ? "+" : ""}{snapshot.quote.change.toFixed(2)} ({isPositive ? "+" : ""}{snapshot.quote.changePercent.toFixed(2)}%)
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-blue-200/70">
                {snapshot?.quote.companyName || "Stocks Intelligence watcher"} - {formatQuoteAsOf(snapshot?.quote.asOf)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {updatedSecondsAgo === null ? "updated --" : `updated ${updatedSecondsAgo}s ago`}
              </p>
            </div>

            <nav className="flex flex-wrap items-center gap-1">
              {TOP_TABS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setActiveTab(item)}
                  className={`h-10 border px-4 text-xs font-bold uppercase tracking-[0.08em] transition-colors ${
                    item === activeTab
                      ? "border-blue-400/50 bg-blue-500/15 text-blue-200"
                      : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  {item}
                </button>
              ))}
            </nav>
          </header>

          <section
            data-primary-tab-panel={activeTab}
            style={activeTab === "Options" ? { minHeight: `${optionsSectionMinHeightRem}rem` } : undefined}
            className={`mt-4 grid grid-cols-1 gap-4 ${
              activeTab === "Chart"
                ? "min-h-[32rem] sm:min-h-[52rem]"
                : activeTab === "Options"
                  ? "min-h-[52rem] xl:grid-cols-[22rem_minmax(0,1fr)]"
                  : "min-h-[30rem] sm:min-h-[42rem]"
            }`}
          >
            {activeTab === "Options" && (
              <div data-options-expiry-selector className="h-full overflow-hidden rounded-md border border-slate-800 bg-[#0b111a]">
                <div className="grid grid-cols-[minmax(5rem,1fr)_3.8rem_3.8rem_4.6rem_2.4rem] border-b border-slate-800 px-3 py-3 text-xs font-black text-blue-200">
                  <span>Expiry</span>
                  <span>OI</span>
                  <span>Str</span>
                  <span>Volume</span>
                  <span>Type</span>
                </div>
                <div className="px-3">
                  {expiryRows.map((row) => {
                    const normalizedExpiry = normalizeExpiryDate(row.expiry);
                    const active = normalizeExpiryDate(currentExpiry) === normalizedExpiry;
                    return (
                      <button
                        key={normalizedExpiry}
                        type="button"
                        data-expiry-row={normalizedExpiry}
                        onClick={() => {
                          setSelectedExpiry(normalizedExpiry);
                          setChartTooltip(null);
                          if (activeSubTab === "Overview") {
                            void loadExpiryOverview(normalizedExpiry);
                          } else {
                            setSubTabPanelState({ loading: true, error: null, data: null });
                          }
                        }}
                        className={`grid w-full cursor-pointer grid-cols-[minmax(5rem,1fr)_3.8rem_3.8rem_4.6rem_2.4rem] border-b py-2 text-left text-sm font-bold transition-colors hover:bg-slate-900 focus-visible:ring-2 focus-visible:ring-blue-400/40 ${active ? "border-b-blue-400 bg-blue-500/10 text-blue-100 shadow-[inset_3px_0_0_rgba(96,165,250,0.85)]" : "border-slate-800 text-slate-200"}`}
                      >
                        <span>{formatExpiryDate(row.expiry, "compact")}</span>
                        <span>{formatNumber(row.openInterest)}</span>
                        <span>{row.primaryStrike || row.strike}</span>
                        <span>{formatNumber(row.volume)}</span>
                        <span className={row.dominantType === "C" ? "text-emerald-400" : "text-red-400"}>{row.dominantType}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex h-full min-h-[52rem] min-w-0 flex-col overflow-hidden rounded-md border border-slate-800 bg-[#0b111a]">
              {activeTab === "Options" && (
                <div data-options-summary className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-4 py-3">
                  <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-black text-emerald-300">GEX: {snapshot?.gexRegime || "--"}</span>
                  <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-black text-emerald-300">P/C: {snapshot?.putCallOpenInterest.toFixed(2) || "--"}</span>
                  <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-bold text-slate-400">{snapshot?.sweeps || 0} sweeps</span>
                </div>
              )}

              {activeTab === "Options" && (
                <>
                  <div className="flex flex-wrap items-center gap-1 border-b border-slate-800 px-4">
                    {(["oi", "volume", "gex"] as StocksWatcherChartMode[]).map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => {
                          setMode(item);
                          setActiveSubTab("Overview");
                        }}
                        className={`border-b-2 px-3 py-3 text-sm font-semibold ${activeSubTab === "Overview" && mode === item ? "border-blue-400 text-blue-300" : "border-transparent text-slate-300 hover:text-white"}`}
                      >
                        {item === "oi" ? "OI" : item === "volume" ? "Vol" : "GEX"}
                      </button>
                    ))}
                    {OPTIONS_SUB_TABS.filter((item) => item !== "Overview").map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setActiveSubTab(item)}
                        className={`border-b-2 px-3 py-3 text-sm font-semibold ${activeSubTab === item ? "border-blue-400 text-blue-300" : "border-transparent text-slate-300 hover:text-white"}`}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                  {renderOptionsSubTab()}
                </>
              )}
              {activeTab !== "Options" && renderGenericPanel(tabPanelState, () => void loadTopTab(activeTab, true))}
            </div>
          </section>

          <div data-detail-stack className="mt-[clamp(0.75rem,1.2vw,1rem)] space-y-[clamp(0.75rem,1.2vw,1rem)]">
            {renderAiSummaryPanel()}

            <section data-bottom-panels className="grid min-w-0 gap-3 xl:grid-cols-3">
            <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-bold text-blue-100">
                <BarChart3 className="h-4 w-4" />
                Native Yahoo Tool Runs - {toolRunLog.length || snapshot?.toolRuns.length || 0}
              </div>
              <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto pr-1">
                {toolRunLog.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
                    className={`rounded-full border px-2 py-1 text-[0.68rem] font-bold ${getRunColor(run.status)}`}
                  >
                    {run.status === "running" && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
                    {run.name} {run.durationMs ? `${run.durationMs}ms` : ""}
                  </button>
                ))}
                {toolRunLog.length === 0 && (snapshot?.toolRuns || []).map((run) => (
                  <span key={`${run.name}-${run.detail}`} className={`rounded-full border px-2 py-1 text-[0.68rem] font-bold ${run.status === "ok" ? getRunColor("ok") : getRunColor("failed")}`}>
                    {run.name}: {run.status}
                  </span>
                ))}
              </div>
              {expandedRunId && (
                <pre className="mt-3 max-h-48 overflow-auto rounded border border-slate-800 bg-[#05080d] p-2 text-[0.68rem] text-slate-300">
                  {stringifyPayload(toolRunLog.find((run) => run.id === expandedRunId))}
                </pre>
              )}
            </div>

            <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-bold text-blue-100">
                  <Building2 className="h-4 w-4" />
                  Market Context
                </div>
                <button type="button" onClick={() => void loadMarketContext()} className="text-xs font-bold text-slate-400 hover:text-blue-200">Refresh</button>
              </div>
              {marketContext.loading && <SkeletonBlock className="h-24 w-full" />}
              {marketContext.error && <ErrorBanner message={marketContext.error} onRetry={() => void loadMarketContext()} />}
              {!marketContext.loading && !marketContext.error && (
                marketContext.breadth
                  ? <QuoteBreadthPanel result={marketContext.breadth} />
                  : <p className="text-xs leading-5 text-slate-400">{snapshot?.marketContext.breadth || "Market context unavailable."}</p>
              )}
            </div>

            <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
              <div className="mb-2 text-sm font-bold text-blue-100">Tool Catalog</div>
              <label className="relative mb-3 block">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  value={toolSearch}
                  onChange={(event) => setToolSearch(event.target.value)}
                  aria-label="Search native Yahoo tools"
                  name="native-yahoo-tool-search"
                  className="h-8 w-full rounded-md border border-slate-800 bg-[#05080d] pl-8 pr-2 text-xs outline-none focus-visible:border-blue-400 focus-visible:ring-2 focus-visible:ring-blue-400/30"
                  placeholder="Search native Yahoo tools…"
                />
              </label>
              <div className="max-h-52 space-y-3 overflow-y-auto pr-1">
                {Object.entries(groupedTools).map(([category, tools]) => (
                  <div key={category}>
                    <div className="mb-1 text-[0.65rem] font-black uppercase tracking-[0.14em] text-slate-500">{category}</div>
                    <div className="flex flex-wrap gap-2">
                      {tools.map((tool) => (
                        <button
                          key={tool.name}
                          type="button"
                          title={tool.description || tool.name}
                          onClick={() => openRunToolModal(tool.name)}
                          className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[0.68rem] font-semibold text-slate-300 hover:border-blue-400 hover:text-blue-100"
                        >
                          {tool.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {availableTools.length === 0 && (
                  <span className="text-xs text-slate-500">Tool list unavailable in fallback mode.</span>
                )}
              </div>
            </div>
            </section>
          </div>
        </main>
      </div>

      {strikeDrawer.open && (
        <div className="fixed inset-0 z-[200] flex justify-end bg-slate-950/60 backdrop-blur-sm">
          <aside className="h-full w-full max-w-xl translate-x-0 overflow-y-auto border-l border-slate-700 bg-[#080d14] p-5 shadow-2xl transition-transform">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-300">Strike Detail</p>
                <h2 className="mt-1 text-2xl font-black text-white">{selectedSymbol} {strikeDrawer.strike} - {formatExpiryDate(strikeDrawer.expiry, "long")}</h2>
              </div>
              <button
                type="button"
                aria-label="Close strike detail"
                data-close-strike-detail
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  closeStrikeDrawer();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  closeStrikeDrawer();
                }}
                className="rounded-md border border-slate-700 p-2 hover:border-blue-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {strikeDrawer.loading && (
              <div className="space-y-3">
                <SkeletonBlock className="h-10 w-full" />
                <SkeletonBlock className="h-48 w-full" />
                <SkeletonBlock className="h-48 w-full" />
              </div>
            )}
            {strikeDrawer.error && (
              <ErrorBanner
                message={strikeDrawer.error}
                onRetry={() => strikeDrawer.strike && void openStrikeDrawer(strikeDrawer.strike, strikeDrawer.expiry)}
              />
            )}
            {strikeDrawer.data && (
              <div className="space-y-4">
                {Object.values(strikeDrawer.data).map((result) => (
                  <div key={result.tool} className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                    <h3 className="mb-2 text-sm font-black text-blue-100">{result.tool}</h3>
                    {renderOptionResultPanel(result)}
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      )}

      {modalState.type && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="max-h-[86vh] w-full max-w-3xl overflow-y-auto rounded-md border border-slate-700 bg-[#080d14] p-5 shadow-2xl transition-transform">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-xl font-black text-white">
                Run Tool - {modalState.data.toolName}
              </h2>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setModalState({ type: null })}
                className="rounded-md border border-slate-700 p-2 hover:border-blue-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {modalState.type === "runTool" && (
              <div className="space-y-3">
                <textarea
                  value={modalState.data.paramsText}
                  onChange={(event) => setModalState({ type: "runTool", data: { ...modalState.data, paramsText: event.target.value } })}
                  className="h-40 w-full rounded-md border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 outline-none focus:border-blue-400"
                />
                {modalState.data.error && <ErrorBanner message={modalState.data.error} />}
                <button
                  type="button"
                  onClick={() => void submitRunToolModal()}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-blue-400/60 bg-blue-500/15 px-4 text-sm font-bold text-blue-100 hover:bg-blue-500/25"
                >
                  {modalState.data.loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Run Native Yahoo Tool
                </button>
                {modalState.data.result && <ToolResultBlock result={modalState.data.result} />}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
