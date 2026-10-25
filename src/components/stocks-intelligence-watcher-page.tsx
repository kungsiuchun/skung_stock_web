import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Building2,
  CalendarDays,
  ChevronDown,
  Globe2,
  LineChart,
  Loader2,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import "./stocks-intelligence-watcher-page.css";
import type {
  StocksWatcherChartMode,
  StocksWatcherRowQuote,
  StocksWatcherSnapshotCacheEntry,
  StocksWatcherSnapshot,
  StocksWatcherStrikeRow,
} from "@/lib/stocks-intelligence-watcher";
import {
  applyStocksWatcherSymbolRemoval,
  getFreshStocksWatcherCacheEntry,
  getGammaFlipLevel,
  getNearestSpotStrike,
  formatStocksWatcherRelativeAge,
  getStocksWatcherRowQuotesFromRawResult,
  getStocksWatcherVisibleSymbols,
  mergeStocksWatcherRowQuoteMap,
  resolveStocksWatcherSearchSymbol,
} from "@/lib/stocks-intelligence-watcher";
import {
  buildStocksWatcherAiSummaryPayload,
  buildStocksWatcherDeterministicSummary,
  type StocksWatcherAiSummaryResponse,
} from "@/lib/stocks-intelligence-watcher-summary";
import {
  getStocksWatcherExpiryOverviewToolPlan,
  getStocksWatcherYahooExpiryChainCacheKey,
  getStocksWatcherYahooExpiryPreloadTargets,
  getStocksWatcherYahooExpirySummaryToolPlan,
  getStocksWatcherCustomStockFromSnapshot,
  getStocksWatcherOptionsSubTabCacheKey,
  getStocksWatcherOptionsSubTabToolPlan,
  getStocksWatcherSnapshotExpiry,
  getStocksWatcherSnapshotLoadDecision,
  getStocksWatcherStrikeDetailToolPlan,
  getStocksWatcherTopTabCacheKey,
  getStocksWatcherTopTabToolPlan,
} from "@/lib/stocks-intelligence-watcher-session";
import type { StocksWatcherPriceRange } from "@/lib/stocks-intelligence-watcher-session";
import {
  getStocksWatcherUniverseStock,
} from "@/lib/stocks-watcher-universe";
import type { StocksWatcherUniverseStock } from "@/lib/stocks-watcher-universe";
import { getStocksWatcherInitialSymbolFromHash, STOCKS_WATCHER_DEFAULT_SYMBOL } from "@/lib/stocks-intelligence-watcher-route";
import { normalizeOptionsVisualModel, optionsExpiryMatchesRequest } from "@/lib/stocks-watcher-options-visual";
import type { FearGreedSnapshot } from "@/lib/fear-greed";
import type { MarketCacheMetadata } from "@/lib/market-data-cache";
import type { WatcherValuationBands, WatcherValuationMetric } from "@/lib/stocks-watcher-valuation-data";
import { StocksWatcherFearGreedPanel } from "./stocks-watcher-fear-greed-panel";
import { StocksWatcherFixedIncomePanel } from "./stocks-watcher-fixed-income-panel";
import { StocksWatcherMacroPanel } from "./stocks-watcher-macro-panel";
import { StocksWatcherNewsPanel } from "./stocks-watcher-news-panel";
import type { NewsToolLoader, NewsToolValue } from "./stocks-watcher-news-panel";
import { MarketBreadthPanel } from "./market-breadth-page";
import { parseJsonResponse } from "@/lib/safe-json-response";

const HIDDEN_SYMBOLS_STORAGE_KEY = "stocks-intelligence-hidden-symbols";
const FAVORITES_STORAGE_KEY = "stocks-intelligence-favorites";
const ROW_QUOTE_REFRESH_CHUNK_SIZE = 20;
const VALUATION_METRICS: readonly WatcherValuationMetric[] = ["pe", "fcf", "ps"];

const TOP_TABS = [
  "Overview",
  "Chart",
  "Fundamentals",
  "Fixed Income",
  "Earnings",
  "Options",
  "F/G Index",
  "News",
  "Macro",
] as const;

const OPTIONS_SUB_TABS = [
  "Overview",
  "Greeks",
  "DEX",
  "IV",
  "P/C",
  "Chain",
] as const;

const BASE_SECTOR_OPTIONS = ["All Sectors"];
const BASE_TYPE_OPTIONS = ["All Types"];

type TopTab = (typeof TOP_TABS)[number];
type OptionsSubTab = (typeof OPTIONS_SUB_TABS)[number];

const TOP_TAB_ICONS: Record<TopTab, typeof Sparkles> = {
  Overview: Sparkles,
  Chart: LineChart,
  Fundamentals: Building2,
  "Fixed Income": BarChart3,
  Earnings: CalendarDays,
  Options: Activity,
  "F/G Index": Activity,
  News: Newspaper,
  Macro: Globe2,
};

import {
  NativeToolResult,
  ToolRunLogEntry,
  ToolStatus,
  TabCacheEntry,
  AsyncPanelState,
  FearGreedPanelState,
  ChartGexAggregateRow,
  SharedPriceAxisCoordinates,
  YahooExpiryPreloadState,
  StrikeDrawerState,
  ModalState,
  CUSTOM_STOCKS_STORAGE_KEY,
  FAVORITES_MEMORY_KEY,
  MARKET_INDEX_DEFINITIONS,
  MarketIndexDefinition,
  MarketContextState,
  RawOptionLeg,
  RawOptionChain,
  ExpirySelectorRow,
  RawOptionExposure,
  RawHistoryPoint,
  SparklinePoint,
  formatNumber,
  formatOptionalSignedExposure,
  currency,
  quoteDirection,
  signedNumberText,
  directionArrow,
  formatOptionalPrice,
  formatSignedPercent,
  formatOptionalNumber,
  getUsEquitiesMarketStatus,
  formatNewsTimestamp,
  formatIndexValue,
  formatSparklineDateTime,
  dateFromAsOfAndSessionLabel,
  normalizeExpiryDate,
  formatExpiryDate,
  toYahooExpiry,
  modeLabel,
  getMaxForMode,
  getCallValue,
  getPutValue,
  chartMetricLabel,
  ChartTooltipState,
  normalizeSymbol,
  sanitizeSymbols,
  readStoredSymbols,
  uniqueStocks,
  readStoredCustomStocks,
  stringifyPayload,
  chunkSymbols,
  parseWatchlistStocks,
  resultLooksHtml,
  rawRecord,
  rawNumber,
  rawNullableNumber,
  rawNullableString,
  financialStatementsFromResult,
  formatFinancialAmount,
  formatProvenanceTimestamp,
  unavailableMarketIndexCard,
  emptyMarketIndexCards,
  parseMarketIndexCard,
  optionChainFromResult,
  optionExposuresFromResult,
  optionLegNumber,
  optionLegDisplayNumber,
  formatOptionIv,
  effectiveLegOpenInterest,
  effectiveExposureIv,
  buildStrikeRowsFromOptionRaw,
  buildExpiryRowsForSelector,
  exposureToneClassName,
  chartGexRowsFromResult,
  aggregateChartGexRows,
  summaryFromLoadedOptionChain,
  yahooExpiryExposureCacheKey,
  getToolCategory,
  getToolInputDraft,
  VALUATION_METRIC_LABEL,
} from "./stocks-intelligence-watcher-view-model";
import {
  SkeletonBlock,
  MetricTile,
  ValuationRainbowChart,
  ErrorBanner,
  OptionsEmptyState,
  OptionsUnsupportedState,
  PutCallRatioChart,
  OptionsResultProvenance,
  formatOptionsSourceTime,
  ExpandableDescription,
  getSharedPriceAxisRange,
  OhlcVolumeChart,
  ToolResultBlock,
  BrandMark,
  TickerLogo,
  approvedUniverseRegimeFromResult,
  approvedUniverseHoldingsFromResult,
  MiniSparkline,
} from "./stocks-intelligence-watcher-leaf-components";
export function StocksIntelligenceWatcherPage({ embeddedSymbol, embedded = false, embeddedExpiry, onEmbeddedExpiryChange, embeddedTool, embeddedSnapshot, embeddedRange, onEmbeddedRangeChange }: {
  embeddedSymbol?: string; embedded?: boolean; embeddedExpiry?: string | null; onEmbeddedExpiryChange?: (expiry: string) => void;
  embeddedTool?: (tool: string, params: Record<string, unknown>) => Promise<{ raw: unknown; text: string }>;
  embeddedSnapshot?: (symbol: string, signal?: AbortSignal) => Promise<StocksWatcherSnapshot>;
  embeddedRange?: StocksWatcherPriceRange; onEmbeddedRangeChange?: (range: StocksWatcherPriceRange) => void;
} = {}) {
  const [selectedSymbol, setSelectedSymbol] = useState(() =>
    embeddedSymbol || (typeof window === "undefined"
      ? STOCKS_WATCHER_DEFAULT_SYMBOL
      : getStocksWatcherInitialSymbolFromHash(window.location.hash)),
  );
  const selectedSymbolRef = useRef(selectedSymbol);
  const [query, setQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [mode, setMode] = useState<StocksWatcherChartMode>("volume");
  const [strikeZoom, setStrikeZoom] = useState(3);
  const [watchlistCollapsed, setWatchlistCollapsed] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"home" | "markets" | "watcher" | "portfolio" | "more">("watcher");
  const [snapshot, setSnapshot] = useState<StocksWatcherSnapshot | null>(null);
  const [loading, setLoading] = useState(embedded);
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
  const [nativeWatchlist, setNativeWatchlist] = useState<StocksWatcherUniverseStock[]>([]);
  const [valuationTicker, setValuationTicker] = useState(selectedSymbol);
  const [valuationMetric, setValuationMetric] = useState<WatcherValuationMetric>("pe");
  const [valuationPanel, setValuationPanel] = useState<{ loading: boolean; error: string | null; data: WatcherValuationBands | null }>({
    loading: false,
    error: null,
    data: null,
  });
  const [customStocks, setCustomStocks] = useState<StocksWatcherUniverseStock[]>(() => readStoredCustomStocks());
  const [rowQuotesBySymbol, setRowQuotesBySymbol] = useState<Record<string, StocksWatcherRowQuote>>({});
  const [watchlistRefreshing, setWatchlistRefreshing] = useState(false);
  const didAutoRefreshWatchlistRef = useRef(false);
  const [refreshingSymbols, setRefreshingSymbols] = useState<string[]>([]);
  const [cacheVersion, setCacheVersion] = useState(0);
  const [sectorFilter, setSectorFilter] = useState("All Sectors");
  const [typeFilter, setTypeFilter] = useState("All Types");
  const [activeTab, setActiveTab] = useState<TopTab>(embedded ? "Options" : "Overview");
  const [earningsQuarterLimit, setEarningsQuarterLimit] = useState<4 | 8 | 12>(8);
  const [activeSubTab, setActiveSubTab] = useState<OptionsSubTab>("Overview");
  const tabDataCache = useRef<Map<string, TabCacheEntry>>(new Map());
  const newsRequests = useRef<Map<string, Promise<NewsToolValue>>>(new Map());
  const [tabPanelState, setTabPanelState] = useState<AsyncPanelState>({ loading: false, error: null, data: null });
  const [fearGreedState, setFearGreedState] = useState<FearGreedPanelState>({ loading: false, error: null, data: null, cache: null });
  const fearGreedLoadedRef = useRef(false);
  const [subTabPanelState, setSubTabPanelState] = useState<AsyncPanelState>({ loading: false, error: null, data: null });
  const [selectedExpiry, setSelectedExpiry] = useState<string | null>(embeddedExpiry || null);
  const [priceRange, setPriceRange] = useState<StocksWatcherPriceRange>(embeddedRange || "3mo");
  const [expiryOverviewState, setExpiryOverviewState] = useState<AsyncPanelState>({ loading: false, error: null, data: null });
  const expiryOverviewRequestRef = useRef(0);
  const [chartSelectedExpiries, setChartSelectedExpiries] = useState<string[]>([]);
  const [chartGexByExpiry, setChartGexByExpiry] = useState<Record<string, AsyncPanelState>>({});
  const [chartExpiryMenuOpen, setChartExpiryMenuOpen] = useState(false);
  const [priceAxisCoordinates, setPriceAxisCoordinates] = useState<SharedPriceAxisCoordinates | null>(null);
  const [pricePanelElement, setPricePanelElement] = useState<HTMLElement | null>(null);
  const [gexPanelElement, setGexPanelElement] = useState<HTMLElement | null>(null);
  const [chartPanelsAreSideBySide, setChartPanelsAreSideBySide] = useState(false);
  const chartGexCacheRef = useRef<Map<string, Record<string, NativeToolResult>>>(new Map());
  const chartGexInflightRef = useRef<Map<string, Promise<Record<string, NativeToolResult>>>>(new Map());
  const yahooExpiryChainCacheRef = useRef<Map<string, NativeToolResult>>(new Map());
  const yahooExpiryChainInflightRef = useRef<Map<string, Promise<NativeToolResult>>>(new Map());
  const yahooExpiryChainFailuresRef = useRef<Map<string, string>>(new Map());
  const yahooExpiryExposureCacheRef = useRef<Map<string, NativeToolResult>>(new Map());
  const yahooExpiryExposureInflightRef = useRef<Map<string, Promise<NativeToolResult>>>(new Map());
  const yahooExpiryExposureFailuresRef = useRef<Map<string, string>>(new Map());
  const yahooExpiryPreloadRunRef = useRef(0);
  const [, setYahooExpiryCacheVersion] = useState(0);
  const [yahooExpiryPreload, setYahooExpiryPreload] = useState<YahooExpiryPreloadState>({
    runId: 0,
    total: 0,
    loaded: 0,
    failed: 0,
    complete: true,
  });
  const [strikeDrawer, setStrikeDrawer] = useState<StrikeDrawerState>({ open: false, strike: null, expiry: null, data: null });
  const strikeDrawerRequestRef = useRef(0);
  const [toolRunLog, setToolRunLog] = useState<ToolRunLogEntry[]>([]);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [modalState, setModalState] = useState<ModalState>({ type: null });
  const [marketContext, setMarketContext] = useState<MarketContextState>({
    loading: false,
    error: null,
    regime: null,
    breadth: null,
    sectorStats: null,
    sectorTopHoldings: null,
    indices: emptyMarketIndexCards(),
  });
  const [toolSearch, setToolSearch] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    selectedSymbolRef.current = selectedSymbol;
  }, [selectedSymbol]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!embedded && typeof window !== "undefined") {
      window.localStorage.setItem(HIDDEN_SYMBOLS_STORAGE_KEY, JSON.stringify(hiddenSymbols));
    }
  }, [embedded, hiddenSymbols]);

  useEffect(() => {
    if (!embedded && typeof window !== "undefined") {
      window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
    }
  }, [embedded, favorites]);

  useEffect(() => {
    if (!embedded && typeof window !== "undefined") {
      window.localStorage.setItem(CUSTOM_STOCKS_STORAGE_KEY, JSON.stringify(customStocks));
    }
  }, [embedded, customStocks]);

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
      const response = embeddedTool ? null : await fetch("/api/stocks-intelligence-watcher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: name, params }),
      });
      const payload: { ok?: boolean; tool?: string; text?: string; raw?: unknown; error?: string } = embeddedTool ? await embeddedTool(name, params) : await parseJsonResponse(response!, "/api/stocks-intelligence-watcher");
      if (payload.ok === false) {
        throw new Error(payload.error || `native Yahoo tool ${name} failed with HTTP ${response?.status}`);
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
  }, [embeddedTool]);

  const fetchSnapshotData = async (symbol: string, options: { signal?: AbortSignal } = {}) => {
    const nextSymbol = normalizeSymbol(symbol);
    const response = embeddedSnapshot ? null : await fetch(`/api/stocks-intelligence-watcher?symbol=${encodeURIComponent(nextSymbol)}`, {
      signal: options.signal,
    });
    const body: StocksWatcherSnapshot & { error?: string } = embeddedSnapshot ? await embeddedSnapshot(nextSymbol, options.signal) : await parseJsonResponse(response!, `/api/stocks-intelligence-watcher?symbol=${encodeURIComponent(nextSymbol)}`, { allowHttpError: true });
    if ((response && response.status !== 200 && response.status !== 206) || !body.symbol || !body.quote) {
      throw new Error(body.error || `Stocks Watcher request failed with HTTP ${response?.status}.`);
    }
    const fetchedAt = Date.now();
    snapshotCacheRef.current.set(body.symbol, { snapshot: body, fetchedAt });
    const customStock = getStocksWatcherCustomStockFromSnapshot(body, getStocksWatcherUniverseStock(body.symbol));
    if (customStock) {
      setCustomStocks((current) => uniqueStocks([...current, customStock]));
    }
    setCacheVersion((version) => version + 1);
    return { snapshot: body, fetchedAt };
  };

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
      const result = await fetchSnapshotData(nextSymbol, { signal: controller.signal });
      setSnapshot(result.snapshot);
      setSelectedSymbol(result.snapshot.symbol);
      const nextExpiry = embeddedExpiry || getStocksWatcherSnapshotExpiry(result.snapshot);
      setSelectedExpiry(nextExpiry);
      setChartSelectedExpiries(nextExpiry ? [nextExpiry] : []);
      setChartGexByExpiry({});
      chartGexCacheRef.current.clear();
      chartGexInflightRef.current.clear();
      setExpiryOverviewState({ loading: false, error: null, data: null });
      setLastUpdatedAt(result.fetchedAt);
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
      const nextExpiry = getStocksWatcherSnapshotExpiry(decision.cached.snapshot);
      setSelectedExpiry(nextExpiry);
      setChartSelectedExpiries(nextExpiry ? [nextExpiry] : []);
      setChartGexByExpiry({});
      chartGexCacheRef.current.clear();
      chartGexInflightRef.current.clear();
      setExpiryOverviewState({ loading: false, error: null, data: null });
      setLastUpdatedAt(decision.cached.fetchedAt);
      if (decision.backgroundRefresh) {
        void fetchSnapshotData(decision.symbol).then((result) => {
          if (result.snapshot.symbol === decision.symbol) {
            setSnapshot(result.snapshot);
            const nextExpiry = getStocksWatcherSnapshotExpiry(result.snapshot);
            setSelectedExpiry(nextExpiry);
            setChartSelectedExpiries(nextExpiry ? [nextExpiry] : []);
            setChartGexByExpiry({});
            chartGexCacheRef.current.clear();
            chartGexInflightRef.current.clear();
            setLastUpdatedAt(result.fetchedAt);
          }
        }).catch(() => undefined);
      }
      return;
    }

    await fetchSnapshot(decision.symbol);
  };

  const selectWatchlistSymbol = (symbol: string) => {
    const nextSymbol = normalizeSymbol(symbol);
    if (nextSymbol !== selectedSymbol) {
      // Change the selected row immediately and clear the previous ticker's detail.
      // The request below remains abortable, so an old response cannot repaint it.
      setSelectedSymbol(nextSymbol);
      setSnapshot(null);
      setSelectedExpiry(null);
      setChartSelectedExpiries([]);
      setChartGexByExpiry({});
      chartGexCacheRef.current.clear();
      chartGexInflightRef.current.clear();
      setExpiryOverviewState({ loading: false, error: null, data: null });
      setTabPanelState({ loading: false, error: null, data: null });
      setSubTabPanelState({ loading: false, error: null, data: null });
      setChartTooltip(null);
    }
    void loadSnapshot(nextSymbol);
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
      if (parsed.length === 0) throw new Error("Curated Watchlist returned no active tracked assets.");
      setNativeWatchlist(parsed);
    } catch (requestError) {
      setNativeWatchlist([]);
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }, [callNativeTool]);

  useEffect(() => {
    if (embedded) return;
    loadFavoritesFromLocal();
    void loadNativeWatchlist();
  }, [embedded, loadFavoritesFromLocal, loadNativeWatchlist]);

  const curatedValuationTickers = useMemo(
    () => nativeWatchlist,
    [nativeWatchlist],
  );

  useEffect(() => {
    if (nativeWatchlist.length === 0) return;
    if (!curatedValuationTickers.some((stock) => stock.symbol === valuationTicker)) {
      setValuationTicker(curatedValuationTickers[0].symbol);
      return;
    }
    if (snapshot?.valuation && snapshot.valuation.symbol === valuationTicker && snapshot.valuation.metric === valuationMetric) {
      setValuationPanel({ loading: false, error: null, data: snapshot.valuation });
      return;
    }

    let cancelled = false;
    setValuationPanel({ loading: true, error: null, data: null });
    void callNativeTool("get_valuation_bands", { symbol: valuationTicker, metric: valuationMetric, window: "3Y" })
      .then((result) => {
        const raw = rawRecord(result.raw);
        if (!raw || raw.symbol !== valuationTicker || raw.metric !== valuationMetric || !raw.latest || !Array.isArray(raw.points)) {
          throw new Error("Published valuation response does not match the requested curated ticker and metric.");
        }
        if (!cancelled) setValuationPanel({ loading: false, error: null, data: raw as unknown as WatcherValuationBands });
      })
      .catch((requestError) => {
        if (!cancelled) setValuationPanel({
          loading: false,
          error: requestError instanceof Error ? requestError.message : String(requestError),
          data: null,
        });
      });
    return () => { cancelled = true; };
  }, [callNativeTool, curatedValuationTickers, nativeWatchlist.length, snapshot?.valuation, valuationMetric, valuationTicker]);

  const runToolBundle = useCallback(async (
    tools: { name: string; params: Record<string, unknown> }[],
    options: { allowPartial?: boolean } = {},
  ) => {
    const entries = await Promise.all(
      tools.map(async (tool) => {
        try {
          return [tool.name, await callNativeTool(tool.name, tool.params)] as const;
        } catch (requestError) {
          if (!options.allowPartial) throw requestError;
          return [tool.name, {
            tool: tool.name,
            params: tool.params,
            text: "",
            raw: null,
            error: requestError instanceof Error ? requestError.message : String(requestError),
          }] as const;
        }
      }),
    );
    return Object.fromEntries(entries);
  }, [callNativeTool]);

  const loadYahooExpiryChain = useCallback(async (symbol: string, expiry: string) => {
    const cacheKey = getStocksWatcherYahooExpiryChainCacheKey(symbol, expiry);
    const cached = yahooExpiryChainCacheRef.current.get(cacheKey);
    if (cached) return cached;

    const inflight = yahooExpiryChainInflightRef.current.get(cacheKey);
    if (inflight) return inflight;

    const plan = getStocksWatcherYahooExpirySummaryToolPlan(symbol, expiry);
    const request = callNativeTool(plan.name, plan.params)
      .then((result) => {
        yahooExpiryChainCacheRef.current.set(cacheKey, result);
        yahooExpiryChainFailuresRef.current.delete(cacheKey);
        setYahooExpiryCacheVersion((version) => version + 1);
        return result;
      })
      .catch((requestError) => {
        const message = requestError instanceof Error ? requestError.message : String(requestError);
        yahooExpiryChainFailuresRef.current.set(cacheKey, message);
        setYahooExpiryCacheVersion((version) => version + 1);
        throw requestError;
      })
      .finally(() => {
        yahooExpiryChainInflightRef.current.delete(cacheKey);
      });
    yahooExpiryChainInflightRef.current.set(cacheKey, request);
    return request;
  }, [callNativeTool]);

  const loadYahooExpiryExposure = useCallback(async (symbol: string, expiry: string) => {
    const cacheKey = yahooExpiryExposureCacheKey(symbol, expiry);
    const cached = yahooExpiryExposureCacheRef.current.get(cacheKey);
    if (cached) return cached;

    const inflight = yahooExpiryExposureInflightRef.current.get(cacheKey);
    if (inflight) return inflight;

    const request = loadYahooExpiryChain(symbol, expiry)
      .then(async (chainResult) => {
        if (optionExposuresFromResult(chainResult).length > 0) {
          return { ...chainResult, tool: "get_options_gex" };
        }
        const plan = getStocksWatcherExpiryOverviewToolPlan(symbol, expiry)[1];
        return callNativeTool(plan.name, plan.params);
      })
      .then((result) => {
        yahooExpiryExposureCacheRef.current.set(cacheKey, result);
        yahooExpiryExposureFailuresRef.current.delete(cacheKey);
        setYahooExpiryCacheVersion((version) => version + 1);
        return result;
      })
      .catch((requestError) => {
        const message = requestError instanceof Error ? requestError.message : String(requestError);
        yahooExpiryExposureFailuresRef.current.set(cacheKey, message);
        setYahooExpiryCacheVersion((version) => version + 1);
        throw requestError;
      })
      .finally(() => {
        yahooExpiryExposureInflightRef.current.delete(cacheKey);
      });
    yahooExpiryExposureInflightRef.current.set(cacheKey, request);
    return request;
  }, [callNativeTool, loadYahooExpiryChain]);

  const loadNewsTool = useCallback<NewsToolLoader>(async (tool, symbol, force = false) => {
    const cacheKey = `${getStocksWatcherTopTabCacheKey(symbol, "News")}:${tool}`;
    const pending = newsRequests.current.get(cacheKey);
    if (pending) return pending;
    const cached = force ? null : tabDataCache.current.get(cacheKey);
    if (cached) return { result: cached.data[tool], fetchedAt: cached.fetchedAt };
    const request = callNativeTool(tool, { ticker: symbol }).then(result => {
      if (result.tool !== tool) throw new Error("News response does not match the requested tool. Retry news.");
      const quoteSymbol = rawRecord(rawRecord(rawRecord(result.raw)?.stats)?.quote)?.symbol;
      if (typeof quoteSymbol === "string" && normalizeSymbol(quoteSymbol) !== normalizeSymbol(symbol)) {
        throw new Error("News context belongs to a different ticker. Retry news.");
      }
      const fetchedAt = Date.now();
      tabDataCache.current.set(cacheKey, { data: { [tool]: result }, fetchedAt });
      return { result, fetchedAt };
    }).finally(() => { newsRequests.current.delete(cacheKey); });
    newsRequests.current.set(cacheKey, request);
    return request;
  }, [callNativeTool]);

  const loadTopTab = useCallback(async (tab: TopTab, force = false) => {
    if (tab === "Options" || tab === "Overview" || tab === "F/G Index" || tab === "News") return;
    const symbol = normalizeSymbol(selectedSymbol);
    const cacheKey = getStocksWatcherTopTabCacheKey(symbol, tab, priceRange);
    const cached = force ? null : tabDataCache.current.get(cacheKey);
    if (cached) {
      setTabPanelState({ loading: false, error: null, data: cached.data });
      return;
    }

    setTabPanelState({ loading: true, error: null, data: null });
    try {
      const data = await runToolBundle(
        getStocksWatcherTopTabToolPlan(tab, symbol, priceRange),
        { allowPartial: tab === "Earnings" },
      );
      tabDataCache.current.set(cacheKey, { data, fetchedAt: Date.now() });
      setTabPanelState({ loading: false, error: null, data });
    } catch (requestError) {
      setTabPanelState({
        loading: false,
        error: requestError instanceof Error ? requestError.message : String(requestError),
        data: null,
      });
    }
  }, [priceRange, runToolBundle, selectedSymbol]);

  const loadFearGreed = useCallback(async (force = false) => {
    if (fearGreedLoadedRef.current && !force) return;
    setFearGreedState((current) => ({ ...current, loading: true, error: null }));
    try {
      const response = await fetch("/api/fear-greed", { headers: { Accept: "application/json" } });
      const payload = await parseJsonResponse<{ data?: FearGreedSnapshot; cache?: MarketCacheMetadata; error?: string }>(response, "/api/fear-greed", { allowHttpError: true });
      if ((response.status !== 200 && response.status !== 206) || !payload.data || !payload.cache) {
        throw new Error(payload.error || `Fear & Greed request failed with HTTP ${response.status}.`);
      }
      fearGreedLoadedRef.current = true;
      setFearGreedState({ loading: false, error: null, data: payload.data, cache: payload.cache });
    } catch (requestError) {
      setFearGreedState((current) => ({ ...current, loading: false, error: requestError instanceof Error ? requestError.message : String(requestError) }));
    }
  }, []);

  const currentExpiry = selectedExpiry || snapshot?.selectedExpiry || snapshot?.availableExpiries?.[0] || snapshot?.expiries[0]?.expiry;
  const usesNativeYahooOptions = Boolean(snapshot?.source === "native_yahoo" && !snapshot.optionsSnapshot);
  const isYahooOptionsFallback = Boolean(usesNativeYahooOptions && snapshot?.optionsUnavailable);
  const updatePriceAxisCoordinates = useCallback((coordinates: SharedPriceAxisCoordinates | null) => {
    setPriceAxisCoordinates((current) => {
      if (!coordinates && !current) return current;
      if (!coordinates || !current) return coordinates;
      const nextEntries = Object.entries(coordinates);
      if (
        nextEntries.length === Object.keys(current).length
        && nextEntries.every(([strike, coordinate]) => Math.abs((current[strike] ?? Number.NaN) - coordinate) < 1)
      ) {
        return current;
      }
      return coordinates;
    });
  }, []);
  const gexPanelRef = useCallback((element: HTMLElement | null) => {
    setGexPanelElement(element);
  }, []);
  const pricePanelRef = useCallback((element: HTMLElement | null) => {
    setPricePanelElement(element);
  }, []);
  const updateChartPanelsLayout = useCallback(() => {
    if (!pricePanelElement || !gexPanelElement) {
      setChartPanelsAreSideBySide(false);
      return;
    }
    const pricePanelBounds = pricePanelElement.getBoundingClientRect();
    const gexPanelBounds = gexPanelElement.getBoundingClientRect();
    setChartPanelsAreSideBySide(
      Math.abs(pricePanelBounds.top - gexPanelBounds.top) < 1
      && pricePanelBounds.right <= gexPanelBounds.left + 1,
    );
  }, [gexPanelElement, pricePanelElement]);
  useEffect(() => {
    if (!pricePanelElement || !gexPanelElement) {
      setChartPanelsAreSideBySide(false);
      return undefined;
    }
    const observer = new ResizeObserver(updateChartPanelsLayout);
    observer.observe(pricePanelElement);
    observer.observe(gexPanelElement);
    window.addEventListener("resize", updateChartPanelsLayout);
    updateChartPanelsLayout();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateChartPanelsLayout);
    };
  }, [gexPanelElement, pricePanelElement, updateChartPanelsLayout]);

  const loadExpiryOverview = useCallback(async (expiry: string | null | undefined, force = false) => {
    if (!expiry) return;
    const requestId = expiryOverviewRequestRef.current + 1;
    expiryOverviewRequestRef.current = requestId;
    const symbol = normalizeSymbol(selectedSymbol);
    const expiryArg = toYahooExpiry(expiry);
    const cacheKey = `${symbol}:${expiryArg || "front"}:Overview`;
    const cached = force ? null : tabDataCache.current.get(cacheKey);
    if (cached) {
      if (requestId === expiryOverviewRequestRef.current) {
        setExpiryOverviewState({ loading: false, error: null, data: cached.data });
      }
      return;
    }

    setExpiryOverviewState({ loading: true, error: null, data: null });
    try {
      const plan = getStocksWatcherExpiryOverviewToolPlan(symbol, expiry);
      const data = usesNativeYahooOptions
        ? Object.fromEntries(await Promise.all([
            loadYahooExpiryChain(symbol, expiry).then((result) => ["get_options", result] as const),
            loadYahooExpiryExposure(symbol, expiry).then((result) => ["get_options_gex", result] as const),
            callNativeTool(plan[2].name, plan[2].params).then((result) => ["get_options_pcr", result] as const),
          ]))
        : await runToolBundle(plan);
      if (!optionsExpiryMatchesRequest(data.get_options?.raw, expiry)) {
        const returnedExpiry = normalizeOptionsVisualModel({ chainRaw: data.get_options?.raw, exposureRaw: null }).expiry || "missing";
        throw new Error(`OPTIONS_EXPIRY_MISMATCH: requested ${normalizeExpiryDate(expiry)}, received ${returnedExpiry}`);
      }
      tabDataCache.current.set(cacheKey, { data, fetchedAt: Date.now() });
      const chartCacheKey = `${symbol}:${normalizeExpiryDate(expiry)}`;
      chartGexCacheRef.current.set(chartCacheKey, data);
      setChartGexByExpiry((current) => ({
        ...current,
        [normalizeExpiryDate(expiry)]: { loading: false, error: null, data },
      }));
      if (requestId === expiryOverviewRequestRef.current) {
        setExpiryOverviewState({ loading: false, error: null, data });
      }
    } catch (requestError) {
      if (requestId === expiryOverviewRequestRef.current) {
        setExpiryOverviewState({
          loading: false,
          error: requestError instanceof Error ? requestError.message : String(requestError),
          data: null,
        });
      }
    }
  }, [callNativeTool, loadYahooExpiryChain, loadYahooExpiryExposure, runToolBundle, selectedSymbol, usesNativeYahooOptions]);

  const loadChartGexExpiry = useCallback(async (expiry: string | null | undefined, force = false) => {
    const normalizedExpiry = normalizeExpiryDate(expiry);
    if (!normalizedExpiry || (snapshot?.optionsSnapshot?.provider !== "robinhood_mcp" && !usesNativeYahooOptions)) return;
    const symbol = normalizeSymbol(selectedSymbol);
    const cacheKey = `${symbol}:${normalizedExpiry}`;
    const cached = force ? null : chartGexCacheRef.current.get(cacheKey);
    if (cached) {
      setChartGexByExpiry((current) => ({
        ...current,
        [normalizedExpiry]: { loading: false, error: null, data: cached },
      }));
      return;
    }
    const inflight = chartGexInflightRef.current.get(cacheKey);
    if (inflight) {
      await inflight;
      return;
    }

    setChartGexByExpiry((current) => ({
      ...current,
      [normalizedExpiry]: { loading: true, error: null, data: current[normalizedExpiry]?.data || null },
    }));
    const request: Promise<Record<string, NativeToolResult>> = usesNativeYahooOptions
      ? Promise.all([
          loadYahooExpiryChain(symbol, normalizedExpiry),
          loadYahooExpiryExposure(symbol, normalizedExpiry),
        ]).then(([chainResult, exposureResult]) => ({
          get_options: chainResult,
          get_options_gex: exposureResult,
        }))
      : runToolBundle(getStocksWatcherExpiryOverviewToolPlan(symbol, normalizedExpiry));
    chartGexInflightRef.current.set(cacheKey, request);
    try {
      const data = await request;
      if (!optionsExpiryMatchesRequest(data.get_options?.raw, normalizedExpiry)) {
        const returnedExpiry = normalizeOptionsVisualModel({ chainRaw: data.get_options?.raw, exposureRaw: null }).expiry || "missing";
        throw new Error(`OPTIONS_EXPIRY_MISMATCH: requested ${normalizedExpiry}, received ${returnedExpiry}`);
      }
      chartGexCacheRef.current.set(cacheKey, data);
      setChartGexByExpiry((current) => ({
        ...current,
        [normalizedExpiry]: { loading: false, error: null, data },
      }));
    } catch (requestError) {
      setChartGexByExpiry((current) => ({
        ...current,
        [normalizedExpiry]: {
          loading: false,
          error: requestError instanceof Error ? requestError.message : String(requestError),
          data: null,
        },
      }));
    } finally {
      chartGexInflightRef.current.delete(cacheKey);
    }
  }, [loadYahooExpiryChain, loadYahooExpiryExposure, runToolBundle, selectedSymbol, snapshot?.optionsSnapshot?.provider, usesNativeYahooOptions]);

  const selectOptionsExpiry = useCallback((expiry: string | null | undefined) => {
    const normalizedExpiry = normalizeExpiryDate(expiry);
    if (!normalizedExpiry) return;
    setSelectedExpiry(normalizedExpiry);
    onEmbeddedExpiryChange?.(normalizedExpiry);
    setChartSelectedExpiries([normalizedExpiry]);
    setChartExpiryMenuOpen(false);
    setChartTooltip(null);
    if (activeSubTab === "Overview") {
      void loadExpiryOverview(normalizedExpiry);
    } else {
      setSubTabPanelState({ loading: true, error: null, data: null });
    }
  }, [activeSubTab, loadExpiryOverview, onEmbeddedExpiryChange]);

  useEffect(() => {
    if (embeddedExpiry) {
      setSelectedExpiry(embeddedExpiry);
      setChartSelectedExpiries([embeddedExpiry]);
    }
  }, [embeddedExpiry]);
  useEffect(() => { if (embeddedRange) setPriceRange(embeddedRange); }, [embeddedRange]);

  const preloadYahooExpirySummaries = useCallback(async () => {
    if (!snapshot || !usesNativeYahooOptions) return;
    const symbol = normalizeSymbol(snapshot.symbol);
    const expiries = getStocksWatcherYahooExpiryPreloadTargets(snapshot.availableExpiries);
    if (expiries.length === 0) return;

    const runId = yahooExpiryPreloadRunRef.current + 1;
    yahooExpiryPreloadRunRef.current = runId;
    setYahooExpiryPreload({ runId, total: expiries.length, loaded: 0, failed: 0, complete: false });

    let cursor = 0;
    const loadNext = async () => {
      while (cursor < expiries.length) {
        const expiry = expiries[cursor];
        cursor += 1;
        try {
          const [chainResult, exposureResult] = await Promise.all([
            loadYahooExpiryChain(symbol, expiry),
            loadYahooExpiryExposure(symbol, expiry),
          ]);
          const data = { get_options: chainResult, get_options_gex: exposureResult };
          const normalizedExpiry = normalizeExpiryDate(expiry);
          chartGexCacheRef.current.set(`${symbol}:${normalizedExpiry}`, data);
          setChartGexByExpiry((current) => ({
            ...current,
            [normalizedExpiry]: { loading: false, error: null, data },
          }));
          setYahooExpiryPreload((current) => current.runId === runId
            ? { ...current, loaded: current.loaded + 1 }
            : current);
        } catch {
          setYahooExpiryPreload((current) => current.runId === runId
            ? { ...current, failed: current.failed + 1 }
            : current);
        }
      }
    };

    await Promise.all([loadNext(), loadNext()]);
    setYahooExpiryPreload((current) => current.runId === runId ? { ...current, complete: true } : current);
  }, [loadYahooExpiryChain, loadYahooExpiryExposure, snapshot, usesNativeYahooOptions]);

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
    if (activeTab === "F/G Index") void loadFearGreed();
    else if (activeTab !== "Options" && activeTab !== "Overview" && activeTab !== "Fixed Income" && activeTab !== "Macro" && activeTab !== "News") void loadTopTab(activeTab);
  }, [activeTab, loadFearGreed, loadTopTab]);

  useEffect(() => {
    if (activeTab === "Options" && activeSubTab !== "Overview") void loadOptionsSubTab(activeSubTab);
  }, [activeSubTab, activeTab, loadOptionsSubTab]);

  useEffect(() => {
    if ((activeTab === "Options" && activeSubTab === "Overview") || activeTab === "Chart") {
      if (currentExpiry) void loadExpiryOverview(currentExpiry);
    }
  }, [activeSubTab, activeTab, currentExpiry, loadExpiryOverview]);

  useEffect(() => {
    if (activeTab !== "Chart" || (snapshot?.optionsSnapshot?.provider !== "robinhood_mcp" && !usesNativeYahooOptions)) return;
    const normalized = chartSelectedExpiries
      .map((expiry) => normalizeExpiryDate(expiry))
      .filter((expiry): expiry is string => Boolean(expiry));
    const expiries = normalized.length > 0
      ? [...new Set(normalized)]
      : currentExpiry ? [normalizeExpiryDate(currentExpiry)].filter((expiry): expiry is string => Boolean(expiry)) : [];
    if (normalized.length === 0 && expiries.length > 0) setChartSelectedExpiries(expiries);
    for (const expiry of expiries) void loadChartGexExpiry(expiry);
  }, [activeTab, chartSelectedExpiries, currentExpiry, loadChartGexExpiry, snapshot?.optionsSnapshot?.provider, usesNativeYahooOptions]);

  useEffect(() => {
    if (activeTab === "Options" && activeSubTab === "Overview") void preloadYahooExpirySummaries();
  }, [activeSubTab, activeTab, preloadYahooExpirySummaries]);

  const loadMarketContext = useCallback(async () => {
    setMarketContext((current) => ({ ...current, loading: true, error: null }));
    try {
      const loadIndexCard = async (definition: MarketIndexDefinition) => {
        try {
          const result = await callNativeTool("get_stock_history", {
            ticker: definition.yahooSymbol,
            range: "3mo",
            interval: "1d",
          });
          return parseMarketIndexCard(definition, result);
        } catch (indexError) {
          return unavailableMarketIndexCard(
            definition,
            indexError instanceof Error ? indexError.message : String(indexError),
          );
        }
      };
      const [regime, breadth, sectorStats, sectorTopHoldings, indices] = await Promise.all([
        callNativeTool("get_macro_regime", {}),
        callNativeTool("market_breadth", { market: "US" }),
        callNativeTool("get_sector_stats", {}),
        callNativeTool("get_sector_top_holdings", {}),
        Promise.all(MARKET_INDEX_DEFINITIONS.map(loadIndexCard)),
      ]);
      setMarketContext({ loading: false, error: null, regime, breadth, sectorStats, sectorTopHoldings, indices });
    } catch (requestError) {
      setMarketContext({
        loading: false,
        error: requestError instanceof Error ? requestError.message : String(requestError),
        regime: null,
        breadth: null,
        sectorStats: null,
        sectorTopHoldings: null,
        indices: emptyMarketIndexCards(),
      });
    }
  }, [callNativeTool]);

  useEffect(() => {
    if (!embedded) void loadMarketContext();
  }, [embedded, loadMarketContext]);

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
      query: searchError ? "" : query,
      sector: sectorFilter,
      type: typeFilter,
      universe: allStocks,
      includeSelected: true,
      includeDefaultSymbols: false,
      restrictToDefaultSymbols: false,
    });
    const bySymbol = new Map(allStocks.map((stock) => [stock.symbol, stock]));
    return visibleSymbols
      .map((symbol) => bySymbol.get(symbol))
      .filter((stock): stock is StocksWatcherUniverseStock => Boolean(stock));
  }, [allStocks, favorites, hiddenSymbols, query, searchError, sectorFilter, selectedSymbol, typeFilter, watchlistSource]);

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
    const searchTerm = query.trim();
    const nextSymbol = resolveStocksWatcherSearchSymbol(searchTerm, allStocks);
    if (!nextSymbol) {
      setSearchError(`No ticker matched "${searchTerm || "blank search"}". Try MSFT, TSLA, or a company name.`);
      return;
    }

    setSearchError(null);
    setQuery("");
    setSectorFilter("All Sectors");
    setTypeFilter("All Types");
    setWatchlistSource("all");
    setHiddenSymbols((current) => current.filter((symbol) => normalizeSymbol(symbol) !== nextSymbol));
    void loadSnapshot(nextSymbol);
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
        defaultSymbols: nativeWatchlist.map((stock) => stock.symbol),
      },
      symbol,
    );

    setFavorites(result.favorites);
    setHiddenSymbols(result.hiddenSymbols);
    if (!nativeWatchlist.some((stock) => stock.symbol === normalizeSymbol(symbol))) {
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

  const refreshAllWatchers = async ({
    refreshMarketContext = true,
    symbols,
  }: {
    refreshMarketContext?: boolean;
    symbols?: string[];
  } = {}) => {
    const symbolsToRefresh = symbols?.length
      ? Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)))
      : watchlist.map((stock) => stock.symbol);
    if (symbolsToRefresh.length === 0) return;
    setWatchlistRefreshing(true);
    setRefreshingSymbols(symbolsToRefresh);
    try {
      const contextPromise = refreshMarketContext ? loadMarketContext() : Promise.resolve();
      const quoteResults = await Promise.allSettled(
        chunkSymbols(symbolsToRefresh, ROW_QUOTE_REFRESH_CHUNK_SIZE).map(async (chunk) => {
          const result = await callNativeTool("get_quotes", { tickers: chunk.join(",") });
          return getStocksWatcherRowQuotesFromRawResult(result.raw);
        }),
      );
      await contextPromise;
      const quotes = quoteResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
      if (quotes.length > 0) {
        setRowQuotesBySymbol((current) => mergeStocksWatcherRowQuoteMap(current, quotes));
        const selectedQuote = quotes.find((quote) => quote.symbol === selectedSymbolRef.current);
        if (selectedQuote) {
          setSnapshot((current) => current && current.symbol === selectedQuote.symbol
            ? {
                ...current,
                quote: {
                  ...current.quote,
                  companyName: selectedQuote.companyName || current.quote.companyName,
                  price: selectedQuote.price,
                  previousClose: selectedQuote.previousClose ?? current.quote.previousClose,
                  change: selectedQuote.change,
                  changePercent: selectedQuote.changePercent,
                  marketState: selectedQuote.marketState ?? current.quote.marketState,
                  asOf: selectedQuote.asOf || current.quote.asOf,
                },
                spot: selectedQuote.price,
              }
            : current);
          setLastUpdatedAt(selectedQuote.fetchedAt);
        }
      }
    } finally {
      setRefreshingSymbols([]);
      setWatchlistRefreshing(false);
    }
  };

  // A blank watchlist on entry is not actionable. Refresh exactly once after
  // the curated universe resolves; subsequent refreshes remain user-driven.
  useEffect(() => {
    if (didAutoRefreshWatchlistRef.current || nativeWatchlist.length === 0) return;
    didAutoRefreshWatchlistRef.current = true;
    void refreshAllWatchers({
      refreshMarketContext: false,
      symbols: nativeWatchlist.map((stock) => stock.symbol),
    });
  }, [nativeWatchlist]);

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

  const heroDirection = snapshot ? quoteDirection(snapshot.quote.change, snapshot.quote.changePercent) : 0;
  const isPositive = heroDirection >= 0;
  const heroArrow = directionArrow(heroDirection);
  const optionsVisualModel = normalizeOptionsVisualModel({
    chainRaw: expiryOverviewState.data?.get_options?.raw,
    exposureRaw: expiryOverviewState.data?.get_options_gex?.raw,
    now,
  });
  const optionsSourceAt = optionsVisualModel.capturedAt || snapshot?.optionsSnapshot?.capturedAt || null;
  const selectedChain = optionsVisualModel.chain as unknown as RawOptionChain | null;
  const selectedExposures = optionsVisualModel.strikeRows as unknown as RawOptionExposure[];
  const rows = buildStrikeRowsFromOptionRaw(selectedChain, selectedExposures);
  const expiryRows = buildExpiryRowsForSelector(snapshot);
  const loadedExpirySummary = summaryFromLoadedOptionChain(selectedChain);
  const yahooExpiryPreloadTargets = usesNativeYahooOptions
    ? getStocksWatcherYahooExpiryPreloadTargets(snapshot?.availableExpiries)
    : [];
  const selectorExpiryRows = expiryRows.map((row) => {
    const preloaded = usesNativeYahooOptions
      ? summaryFromLoadedOptionChain(
          optionChainFromResult(
            yahooExpiryChainCacheRef.current.get(getStocksWatcherYahooExpiryChainCacheKey(snapshot?.symbol || selectedSymbol, row.expiry)),
          ),
          optionExposuresFromResult(
            yahooExpiryExposureCacheRef.current.get(yahooExpiryExposureCacheKey(snapshot?.symbol || selectedSymbol, row.expiry)),
          ),
        )
      : null;
    if (preloaded) return preloaded;
    return !row.loaded && loadedExpirySummary && row.expiry === loadedExpirySummary.expiry ? loadedExpirySummary : row;
  });
  const getExpirySelectorLoadState = (row: ExpirySelectorRow) => {
    if (row.loaded || !usesNativeYahooOptions) return "unloaded";
    const symbol = snapshot?.symbol || selectedSymbol;
    const chainCacheKey = getStocksWatcherYahooExpiryChainCacheKey(symbol, row.expiry);
    const exposureCacheKey = yahooExpiryExposureCacheKey(symbol, row.expiry);
    if (yahooExpiryChainInflightRef.current.has(chainCacheKey) || yahooExpiryExposureInflightRef.current.has(exposureCacheKey)) return "loading";
    if (yahooExpiryChainFailuresRef.current.has(chainCacheKey) || yahooExpiryExposureFailuresRef.current.has(exposureCacheKey)) return "retry";
    return yahooExpiryPreloadTargets.includes(toYahooExpiry(row.expiry) || "") && !yahooExpiryPreload.complete
      ? "loading"
      : "unloaded";
  };
  const yahooExpiryPreloadLabel = usesNativeYahooOptions && yahooExpiryPreload.total > 0
    ? `Yahoo next ${yahooExpiryPreload.total}: ${yahooExpiryPreload.loaded}/${yahooExpiryPreload.total}${yahooExpiryPreload.failed ? ` · ${yahooExpiryPreload.failed} retry` : ""}`
    : null;
  const hasOptionsOpenInterest = optionsVisualModel.capabilities.openInterest;
  const hasOptionsGex = hasOptionsOpenInterest && optionsVisualModel.capabilities.gex;
  const optionsSourceLabel = snapshot?.optionsSnapshot
    ? `Robinhood MCP EOD · ${formatOptionsSourceTime(snapshot.optionsSnapshot.capturedAt)}`
    : isYahooOptionsFallback
      ? "Yahoo fallback · Robinhood EOD unavailable · locally estimated GEX/DEX proxy"
      : snapshot?.source === "native_yahoo"
        ? "Native Yahoo · locally estimated GEX/DEX proxy"
        : "Source unavailable";
  const modeAvailable = mode === "volume" ? optionsVisualModel.capabilities.volume : mode === "oi" ? hasOptionsOpenInterest : hasOptionsGex;
  const chartRows = rows.sort((a, b) => a.strike - b.strike);
  // Overview renders before the Options tab's on-demand chain request. The
  // validated snapshot already contains the selected Robinhood expiry rows,
  // so use them for summary metrics instead of falsely showing n/a.
  const overviewMetricRows = chartRows.length > 0 ? chartRows : snapshot?.strikes || [];
  const hasOverviewOptionsOpenInterest = overviewMetricRows.some((row) => row.callOpenInterest > 0 || row.putOpenInterest > 0);
  const hasOverviewOptionsGex = hasOverviewOptionsOpenInterest && overviewMetricRows.some((row) => Number.isFinite(row.callGex) || Number.isFinite(row.putGex));
  const overviewCallOi = overviewMetricRows.reduce((sum, row) => sum + row.callOpenInterest, 0);
  const overviewPutOi = overviewMetricRows.reduce((sum, row) => sum + row.putOpenInterest, 0);
  const focusedRows = (() => {
    if (!snapshot || strikeZoom <= 1 || chartRows.length <= 7) return chartRows;
    const closestIndex = chartRows.reduce((bestIndex, row, index) => (
      Math.abs(row.strike - snapshot.spot) < Math.abs(chartRows[bestIndex].strike - snapshot.spot) ? index : bestIndex
    ), 0);
    const targetCount = Math.max(7, Math.ceil(chartRows.length / strikeZoom));
    const start = Math.max(0, Math.min(chartRows.length - targetCount, closestIndex - Math.floor(targetCount / 2)));
    return chartRows.slice(start, start + targetCount);
  })();
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
  const marketStatus = getUsEquitiesMarketStatus(now);
  const visibleRows = focusedRows.length > 0 ? focusedRows : chartRows;
  const latestPrice = snapshot?.quote.price || 0;
  const heroSparklinePoints: SparklinePoint[] = (snapshot?.history || [])
    .map((point, index) => {
      const pointDate = point.date || dateFromAsOfAndSessionLabel(snapshot?.quote.asOf, point.label);
      return {
        label: snapshot?.symbol || selectedSymbol,
        dateTimeLabel: formatSparklineDateTime(pointDate || undefined, point.label ? `${point.label} ET` : `Session point ${index + 1}`, "dateTime"),
        rangeLabel: "Intraday",
        value: point.price,
        source: `${snapshot?.symbol || selectedSymbol} intraday`,
      };
    })
    .filter((point) => Number.isFinite(point.value) && (!latestPrice || (point.value > latestPrice * 0.25 && point.value < latestPrice * 4)));
  const previousClose = snapshot?.quote.previousClose ?? null;
  const sessionOpen = snapshot?.quote.open ?? null;
  const sessionHigh = snapshot?.quote.high ?? null;
  const sessionLow = snapshot?.quote.low ?? null;
  const overviewTotalCallGex = overviewMetricRows.reduce((sum, row) => sum + Math.max(0, row.callGex), 0);
  const overviewTotalPutGex = overviewMetricRows.reduce((sum, row) => sum + Math.min(0, row.putGex), 0);
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
  const selectedCallVolume = chartRows.reduce((sum, row) => sum + row.callVolume, 0);
  const selectedPutVolume = chartRows.reduce((sum, row) => sum + row.putVolume, 0);
  const selectedPutCallVolume = selectedCallVolume > 0 ? selectedPutVolume / selectedCallVolume : null;
  const selectedCallOpenInterest = chartRows.reduce((sum, row) => sum + row.callOpenInterest, 0);
  const selectedPutOpenInterest = chartRows.reduce((sum, row) => sum + row.putOpenInterest, 0);
  const selectedPutCallOpenInterest = selectedCallOpenInterest > 0
    ? selectedPutOpenInterest / selectedCallOpenInterest
    : null;
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
      { title: "Caveats", items: aiSummary.caveats.length > 0 ? aiSummary.caveats : ["Yahoo delayed (15-20 min)", "No tape-level flow", "Not financial advice"] },
    ];

    return (
      <section data-ai-summary-panel className="siw-panel siw-ai-panel">
        <div className="siw-ai-head">
          <div className="siw-ai-title">
            <Sparkles className="h-5 w-5" />
            <span>AI Summary (deterministic-rules)</span>
            <b>No OpenRouter call</b>
            <b className="siw-yellow-tag">Yahoo delayed</b>
          </div>
          <div className="siw-ai-meta">
            {generatedAt && <span>Generated: {generatedAt} ET</span>}
            <span>Model: {aiSummary.model}</span>
            <span>Confidence: High</span>
          </div>
        </div>
        <div className="siw-ai-grid">
          {sections.map((section) => (
            <div key={section.title} className="siw-ai-column">
              <p>{section.title}</p>
              <ul>
                {section.items.slice(0, 4).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    );
  };

  const renderChartPanel = () => {
    const priceResult = tabPanelState.data?.get_stock_history;
    const isRobinhoodGex = snapshot?.optionsSnapshot?.provider === "robinhood_mcp";
    const isYahooProxyGex = usesNativeYahooOptions;
    const supportsProxyGex = isRobinhoodGex || isYahooProxyGex;
    const normalizedSelectedExpiries = chartSelectedExpiries
      .map((expiry) => normalizeExpiryDate(expiry))
      .filter((expiry): expiry is string => Boolean(expiry));
    const gexExpiries = normalizedSelectedExpiries.length > 0
      ? [...new Set(normalizedSelectedExpiries)]
      : currentExpiry ? [normalizeExpiryDate(currentExpiry)].filter((expiry): expiry is string => Boolean(expiry)) : [];
    const gexRows = supportsProxyGex ? aggregateChartGexRows(gexExpiries, chartGexByExpiry) : [];
    const hasChartGex = gexRows.length > 0;
    // A shared-axis profile cannot safely scroll internally: rows outside its
    // fixed viewport were both clipped and visually undiscoverable. Give each
    // strike enough vertical room while preserving its true chart coordinate.
    const chartGexExpandedMinHeight = Math.max(544, 156 + gexRows.length * 22);
    const sharedPriceAxisRange = priceResult && hasChartGex ? getSharedPriceAxisRange(priceResult, gexRows) : null;
    const gexAxisCoordinates = priceAxisCoordinates;
    // `priceToCoordinate` is supplied by the actual lightweight-charts price
    // scale, not an inferred range. This is the only reliable way to align
    // strike rows with the visible y-axis after zooming or resizing.
    const hasSharedGexAxis = Boolean(
      sharedPriceAxisRange
      && gexAxisCoordinates
      && chartPanelsAreSideBySide
      && gexRows.every((row) => (gexAxisCoordinates[String(row.strike)] ?? -1) >= 0),
    );
    const maxGex = Math.max(1, ...gexRows.map((row) => Math.abs(row.netGex)));
    const spotRow = snapshot && gexRows.length > 0
      ? gexRows.reduce((nearest, row) => Math.abs(row.strike - snapshot.spot) < Math.abs(nearest.strike - snapshot.spot) ? row : nearest)
      : null;
    const largestPositiveGexStrike = gexRows.reduce<ChartGexAggregateRow | null>((largest, row) => (
      row.netGex > 0 && (!largest || row.netGex > largest.netGex) ? row : largest
    ), null)?.strike ?? null;
    const largestNegativeGexStrike = gexRows.reduce<ChartGexAggregateRow | null>((largest, row) => (
      row.netGex < 0 && (!largest || row.netGex < largest.netGex) ? row : largest
    ), null)?.strike ?? null;
    const loadingGexExpiryCount = gexExpiries.filter((expiry) => chartGexByExpiry[expiry]?.loading).length;
    const unavailableGexExpiries = gexExpiries.filter((expiry) => {
      const state = chartGexByExpiry[expiry];
      return Boolean(state?.error) || (!state?.loading && chartGexRowsFromResult(state?.data || null).length === 0);
    });
    const primaryGexResult = chartGexByExpiry[normalizeExpiryDate(currentExpiry)]?.data?.get_options_gex
      || expiryOverviewState.data?.get_options_gex;
    const toggleChartGexExpiry = (expiry: string) => {
      const normalizedExpiry = normalizeExpiryDate(expiry);
      if (!normalizedExpiry) return;
      const selected = gexExpiries.includes(normalizedExpiry);
      if (selected) {
        if (gexExpiries.length === 1) return;
        const remaining = gexExpiries.filter((value) => value !== normalizedExpiry);
        setChartSelectedExpiries(remaining);
        if (normalizeExpiryDate(currentExpiry) === normalizedExpiry) {
          const nextPrimary = remaining[0];
          setSelectedExpiry(nextPrimary);
          setChartTooltip(null);
          void loadExpiryOverview(nextPrimary);
        }
      } else {
        setChartSelectedExpiries([...gexExpiries, normalizedExpiry]);
        void loadChartGexExpiry(normalizedExpiry);
      }
    };

    return (
      <section className="siw-panel siw-primary-panel siw-chart-panel" data-primary-tab-panel="Chart">
        <div className="siw-chart-expiry-toolbar" data-chart-gex-controls>
          <div className="siw-chart-expiry-selector">
            <span>GEX Expiry</span>
            <button
              type="button"
              aria-label="Chart GEX expiry"
              aria-haspopup="dialog"
              aria-expanded={chartExpiryMenuOpen}
              data-chart-gex-expiry-trigger
              onClick={() => setChartExpiryMenuOpen((open) => !open)}
            >
              {gexExpiries.length > 1
                ? `${gexExpiries.length} expiries selected`
                : formatExpiryDate(gexExpiries[0] || currentExpiry, "short")}
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {chartExpiryMenuOpen && (
              <div className="siw-chart-expiry-menu" role="dialog" aria-label="Chart GEX expiry choices" data-chart-gex-expiry-menu>
                <strong>Select one or more expiries</strong>
                <span>Average uses only expiries that report each strike.</span>
                {selectorExpiryRows.map((row) => {
                  const expiry = normalizeExpiryDate(row.expiry);
                  const checked = Boolean(expiry && gexExpiries.includes(expiry));
                  return (
                    <label key={expiry} className="siw-chart-expiry-choice">
                      <input
                        type="checkbox"
                        name={`chart-expiry-${expiry}`}
                        data-chart-gex-expiry={expiry}
                        checked={checked}
                        onChange={() => expiry && toggleChartGexExpiry(expiry)}
                      />
                      <span>{formatExpiryDate(expiry, "short")}</span>
                      {expiry === normalizeExpiryDate(currentExpiry) && <b>Primary</b>}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <span className="siw-chart-gex-source" data-chart-gex-provenance>
            {isRobinhoodGex
              ? "Robinhood MCP EOD · OI-signed proxy, not dealer GEX"
              : isYahooProxyGex
                ? "Yahoo delayed · locally estimated OI/IV proxy · not dealer GEX"
                : "Option exposure source unavailable"}
          </span>
        </div>

        {tabPanelState.loading && (
          <div className="space-y-3"><SkeletonBlock className="h-10 w-56" /><SkeletonBlock className="h-[34rem] w-full" /></div>
        )}
        {tabPanelState.error && <ErrorBanner message={tabPanelState.error} onRetry={() => void loadTopTab("Chart", true)} />}
        {!tabPanelState.loading && !tabPanelState.error && !priceResult && (
          <div className="siw-data-empty"><strong>Price history unavailable</strong><span>The selected Yahoo Daily range returned no chart payload.</span></div>
        )}
        {priceResult && (
          <div
            className="siw-chart-options-layout"
            data-chart-gex-expanded={hasChartGex ? "true" : undefined}
            style={{ "--siw-chart-gex-min-height": `${chartGexExpandedMinHeight}px` } as CSSProperties}
          >
            <div ref={pricePanelRef} className="siw-chart-price-panel">
              <OhlcVolumeChart
                result={priceResult}
                priceRange={priceRange}
                onPriceRangeChange={range => { setPriceRange(range); onEmbeddedRangeChange?.(range); }}
                sharedPriceAxisRange={sharedPriceAxisRange}
                sharedAxisStrikes={gexRows.map((row) => row.strike)}
                onPriceAxisCoordinatesChange={updatePriceAxisCoordinates}
              />
            </div>
            <aside ref={gexPanelRef} className={`siw-chart-gex-panel ${hasSharedGexAxis ? "is-axis-aligned" : ""}`} data-chart-gex-by-strike data-chart-gex-profile={hasSharedGexAxis ? "aligned" : "stacked"}>
              <div className="siw-chart-gex-head">
                <div>
                  <strong>{gexExpiries.length > 1
                    ? isYahooProxyGex ? "Average Net GEX Proxy by Strike" : "Average Net GEX by Strike"
                    : isYahooProxyGex ? "Net GEX Proxy by Strike" : "Net GEX by Strike"}</strong>
                  <span>{gexExpiries.length > 1 ? `${gexExpiries.length} selected expiries` : formatExpiryDate(currentExpiry, "short")}</span>
                </div>
                <div className="siw-chart-gex-meta">
                  {snapshot && <b>Spot {currency(snapshot.spot)}</b>}
                  {hasChartGex && <span data-chart-gex-scale>Scale ±{formatOptionalSignedExposure(maxGex).replace(/^[-+]/, "")}</span>}
                </div>
              </div>
              {loadingGexExpiryCount > 0 && !hasChartGex && <SkeletonBlock className="h-64 w-full" />}
              {unavailableGexExpiries.length > 0 && (
                <div className="siw-chart-gex-unavailable" data-chart-gex-unavailable>
                  Unavailable: {unavailableGexExpiries.map((expiry) => formatExpiryDate(expiry, "short")).join(", ")}. Not included in the average.
                </div>
              )}
              {!loadingGexExpiryCount && (!supportsProxyGex || !hasChartGex) && (
                <div className="siw-data-empty">
                  <strong>Net GEX proxy unavailable</strong>
                  <span>{isYahooProxyGex ? "Yahoo did not return enough open-interest and implied-volatility inputs to estimate this expiry." : "The active source does not provide auditable exposure inputs for this expiry."}</span>
                </div>
              )}
              {hasChartGex && (
                <div
                  className={`siw-chart-gex-list ${hasSharedGexAxis ? "is-axis-aligned" : ""}`}
                  role="list"
                  aria-label={isYahooProxyGex ? "Net GEX proxy by strike" : "Net GEX by strike"}
                  data-chart-gex-axis={hasSharedGexAxis ? "shared" : "stacked"}
                  data-chart-gex-axis-range={sharedPriceAxisRange ? `${sharedPriceAxisRange.min}:${sharedPriceAxisRange.max}` : undefined}
                  data-chart-gex-axis-coordinate-count={gexAxisCoordinates ? Object.keys(gexAxisCoordinates).length : 0}
                  style={hasSharedGexAxis ? { top: 0, bottom: 0 } : undefined}
                >
                  {gexRows.map((row) => {
                    const positive = row.netGex >= 0;
                    // The strongest signed level reaches the edge of its half-axis.
                    // Do not normalize each row independently: that would misrepresent exposure.
                    const width = Math.max(row.netGex === 0 ? 0 : 1.5, Math.abs(row.netGex) / maxGex * 50);
                    const isSpot = spotRow?.strike === row.strike;
                    const isKeyLevel = isSpot || row.strike === largestPositiveGexStrike || row.strike === largestNegativeGexStrike;
                    const axisPosition = sharedPriceAxisRange
                      ? (sharedPriceAxisRange.max - row.strike) / (sharedPriceAxisRange.max - sharedPriceAxisRange.min) * 100
                      : null;
                    return (
                      <button
                        key={`chart-gex-${row.strike}`}
                        type="button"
                        data-chart-gex-bar
                        data-chart-gex-strike={row.strike}
                        data-chart-gex-spot={isSpot ? "true" : "false"}
                        data-chart-gex-key-level={isKeyLevel ? "true" : "false"}
                        data-chart-gex-contributors={`${row.contributors}/${gexExpiries.length}`}
                        data-chart-gex-width={width.toFixed(4)}
                        data-chart-gex-axis-position={axisPosition === null ? undefined : axisPosition.toFixed(4)}
                        className={`siw-chart-gex-row ${isSpot ? "is-spot" : ""} ${isKeyLevel ? "is-key-level" : ""}`}
                        aria-label={`Strike ${row.strike}: ${formatOptionalSignedExposure(row.netGex)}. ${row.contributors} of ${gexExpiries.length} selected expiries.`}
                        title={`Strike ${row.strike}: ${formatOptionalSignedExposure(row.netGex)} · ${row.contributors}/${gexExpiries.length} expiries`}
                        onClick={() => void openStrikeDrawer(row.strike, currentExpiry)}
                        style={hasSharedGexAxis && gexAxisCoordinates
                          ? { top: `${gexAxisCoordinates[String(row.strike)]}px` }
                          : axisPosition === null ? undefined : { top: `${axisPosition}%` }}
                      >
                        <span className="siw-chart-gex-strike-label">{row.strike}</span>
                        <i className="siw-chart-gex-track"><i className="siw-chart-gex-zero" /><i className={positive ? "siw-chart-gex-fill is-positive" : "siw-chart-gex-fill is-negative"} style={{ width: `${width}%` }} /></i>
                        <b className={`siw-chart-gex-value ${positive ? "siw-up" : "siw-down"}`}>{formatOptionalSignedExposure(row.netGex)} <small>{row.contributors}/{gexExpiries.length}</small></b>
                      </button>
                    );
                  })}
                </div>
              )}
              {hasSharedGexAxis && spotRow && gexAxisCoordinates?.[String(spotRow.strike)] !== undefined && (
                <div className="siw-chart-gex-spot-guide" style={{ top: `${gexAxisCoordinates[String(spotRow.strike)]}px` }} aria-hidden="true">
                  <span>SPOT {spotRow.strike}</span>
                </div>
              )}
              {primaryGexResult && <div className="siw-chart-gex-provenance"><OptionsResultProvenance result={primaryGexResult} /></div>}
            </aside>
          </div>
        )}
      </section>
    );
  };

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
            Data as of {optionsSourceAt ? formatOptionsSourceTime(optionsSourceAt) : "source time unavailable"}
          </span>
          {snapshot?.cache && (
            <span className={`rounded-md border px-3 py-1.5 ${snapshot.cache.status === "stale" ? "border-amber-800 bg-amber-950/40 text-amber-200" : "border-slate-700 bg-slate-900 text-slate-300"}`}>
              {snapshot.cache.status === "stale" ? `Stale cache ${snapshot.cache.ageSeconds}s` : snapshot.cache.status === "hit" ? `Cache hit ${snapshot.cache.ageSeconds}s` : snapshot.cache.status === "bypassed" ? "Cache bypassed" : "Cache refreshed"}
            </span>
          )}
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs font-black">
        <span className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-blue-100">Exp {formatExpiryDate(currentExpiry, "compact")}</span>
        <span className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-yellow-300">Spot {snapshot ? currency(snapshot.spot) : "--"}</span>
        {hasOptionsOpenInterest && (
          <span className={`rounded border border-slate-700 bg-slate-900 px-2 py-1 ${dominantSide === "Calls" ? "text-emerald-300" : "text-red-300"}`}>
            Dom {dominantSide}{dominantRow ? ` @ ${dominantRow.strike}` : ""}
          </span>
        )}
        <span
          className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-300"
          data-options-pc-volume
          title="Selected expiry: total put volume divided by total call volume."
        >
          P/C volume {selectedPutCallVolume === null ? "Unavailable" : selectedPutCallVolume.toFixed(2)}
        </span>
        {hasOptionsGex && (
          <>
            <span className={`rounded border border-slate-700 bg-slate-900 px-2 py-1 ${netGex >= 0 ? "text-emerald-300" : "text-red-300"}`}>
              {mode === "gex" ? "Net GEX" : "GEX regime"} {mode === "gex" ? formatNumber(netGex) : snapshot?.gexRegime || "--"}
            </span>
            <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-cyan-300">Flip {gammaFlipLevel === null ? "--" : currency(gammaFlipLevel)}</span>
            <span className="rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 text-yellow-300">C Wall {maxCallWall ? currency(maxCallWall.strike) : "--"}</span>
            <span className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-red-300">P Wall {maxPutWall ? currency(maxPutWall.strike) : "--"}</span>
          </>
        )}
      </div>

      {!hasOptionsOpenInterest && selectedChain && (
        <p className="mb-3 rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100" data-options-oi-unavailable>
          The active options source returned no positive open interest for this expiry. OI, P/C OI, GEX, walls and flip levels are unavailable; volume remains source data.
        </p>
      )}

      {error && <ErrorBanner message={error} onRetry={refreshCurrent} />}
      {snapshot?.warnings.map((warning) => (
        <p key={warning} className="mb-3 rounded-md border border-yellow-400/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-100">
          {warning}
        </p>
      ))}

      {expiryOverviewState.loading && <SkeletonBlock className="mb-4 h-8 w-64" />}
      {expiryOverviewState.error && <ErrorBanner message={expiryOverviewState.error} onRetry={() => void loadExpiryOverview(currentExpiry, true)} />}
      {!expiryOverviewState.loading && (!modeAvailable || chartRows.length === 0) && (
        <OptionsEmptyState expiry={currentExpiry} onRetry={() => void loadExpiryOverview(currentExpiry, true)} />
      )}

      {chartRows.length > 0 && (
        <>
          <div data-options-chart-controls className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-xs font-black">
              <span className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-400">
                GEX Pinning <b className="ml-1 text-slate-100">{!hasOptionsGex ? "Unavailable" : gammaFlipLevel !== null ? currency(gammaFlipLevel) : "No flip in range"}</b>
              </span>
              <span className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-400">
                P/C OI <b className="ml-1 text-slate-100">{hasOptionsOpenInterest && selectedPutCallOpenInterest !== null ? selectedPutCallOpenInterest.toFixed(2) : "Unavailable"}</b>
              </span>
            </div>
            <label className="flex items-center gap-2 text-xs font-black text-slate-400">
              Strike Zoom
              <input
                aria-label="Strike zoom"
                name="strike-zoom"
                type="range"
                min="1"
                max="3"
                step="0.25"
                value={strikeZoom}
                onChange={(event) => setStrikeZoom(Number(event.target.value))}
                className="h-1 w-24 accent-blue-400"
              />
              <b className="min-w-8 text-right text-blue-200">x{strikeZoom.toFixed(2)}</b>
            </label>
          </div>
          {modeAvailable && (
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
                                className="w-3 rounded-t-[2px] bg-gradient-to-t from-emerald-600/75 to-emerald-300 shadow-[0_0_16px_rgba(16,185,129,0.2)] transition-[width,background-color] group-hover:w-4 group-hover:from-emerald-500 group-hover:to-emerald-200 sm:w-4 sm:group-hover:w-5"
                        style={{ height: `${netGammaHeight}%` }}
                        title={`Net GEX ${formatNumber(netGamma)}`}
                      />
                      )}
                    </div>
                    <div className="relative flex h-1/2 items-start justify-center">
                      {netGamma < 0 && (
                      <div
                                className="w-3 rounded-b-[2px] bg-gradient-to-b from-red-400 to-red-700/75 shadow-[0_0_16px_rgba(248,113,113,0.18)] transition-[width,background-color] group-hover:w-4 group-hover:from-red-300 group-hover:to-red-500 sm:w-4 sm:group-hover:w-5"
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

      <div className="siw-options-source-footer">
        <span>{optionsSourceLabel}</span>
        {snapshot?.optionsSnapshot && (
          <span data-options-robinhood-provenance>
            Robinhood MCP EOD · {formatOptionsSourceTime(snapshot.optionsSnapshot.capturedAt)} · {snapshot.optionsSnapshot.completedSymbols}/{snapshot.optionsSnapshot.expectedSymbols} · OI-signed proxy, not dealer GEX
          </span>
        )}
        {usesNativeYahooOptions && (
          <span data-options-yahoo-proxy-provenance>
            Yahoo delayed · GEX/DEX locally estimated from near-spot chain OI, IV and delta · not dealer positioning
          </span>
        )}
      </div>
      </>
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
                <th className="px-3 py-2 text-right">Mark</th>
                <th className="px-3 py-2 text-right">Vol</th>
                <th className="px-3 py-2 text-right">OI</th>
                <th className="px-3 py-2 text-right">IV</th>
              </tr>
            </thead>
            <tbody>
              {legs.map((leg) => (
                <tr key={`${side}-${leg.contractSymbol || leg.strike}`} className="border-t border-slate-800 text-slate-200">
                  <td className="px-3 py-2 font-black text-white">{optionLegNumber(leg.strike)}</td>
                  <td className="px-3 py-2 text-right">{optionLegDisplayNumber(leg.bid)?.toFixed(2) ?? "n/a"}</td>
                  <td className="px-3 py-2 text-right">{optionLegDisplayNumber(leg.ask)?.toFixed(2) ?? "n/a"}</td>
                  <td className="px-3 py-2 text-right">{optionLegDisplayNumber(leg.mark ?? leg.lastPrice)?.toFixed(2) ?? "n/a"}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(optionLegNumber(leg.volume))}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(effectiveLegOpenInterest(leg))}</td>
                  <td className="px-3 py-2 text-right">{formatOptionIv(leg.impliedVolatility)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );

    return (
      <div className="space-y-4">
        <OptionsResultProvenance result={result} />
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
    if (raw?.supported === false) {
      const provenance = rawRecord(raw.provenance);
      return (
        <OptionsUnsupportedState
          title={`${result.tool} is not supported by this source`}
          reason={typeof raw.unavailableReason === "string" ? raw.unavailableReason : "The active source does not provide the fields required for this panel."}
          source={typeof provenance?.provider === "string" ? provenance.provider : null}
        />
      );
    }
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
                    <td className="px-3 py-2 text-right">{optionLegDisplayNumber(leg.bid)?.toFixed(2) ?? "n/a"}</td>
                    <td className="px-3 py-2 text-right">{optionLegDisplayNumber(leg.ask)?.toFixed(2) ?? "n/a"}</td>
                    <td className="px-3 py-2 text-right">{formatOptionIv(leg.impliedVolatility)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }
    if (exposures.length > 0) {
      if (result.tool === "get_options_dex" || result.tool === "chart_dex") {
        const plotted = exposures.slice(0, 28).map((row) => ({
          strike: optionLegNumber(row.strike),
          value: optionLegNumber(row.netDex),
        }));
        const maxAbs = Math.max(1, ...plotted.map((row) => Math.abs(row.value)));
        return (
          <div className="space-y-1" data-options-dex-chart>
            <p className="mb-3 text-xs text-slate-400">Net DEX by strike · zero-centred OI-weighted delta exposure proxy · not dealer positioning.</p>
            {plotted.map((row) => (
              <div key={`dex-${result.tool}-${row.strike}`} className="grid grid-cols-[3.5rem_minmax(0,1fr)_5rem] items-center gap-2 text-[0.68rem]">
                <span className="text-right font-bold text-slate-300">{row.strike}</span>
                <span className="relative h-4 overflow-hidden rounded bg-slate-900" data-options-dex-bar title={`Strike ${row.strike}: ${formatNumber(row.value)}`}>
                  <i className="absolute inset-y-0 left-1/2 w-px bg-slate-500" />
                  <i
                    className={`absolute inset-y-1 ${row.value >= 0 ? "left-1/2 bg-emerald-400" : "right-1/2 bg-red-400"}`}
                    style={{ width: `${Math.max(row.value === 0 ? 0 : 1.5, Math.abs(row.value) / maxAbs * 48)}%` }}
                  />
                </span>
                <span className={`text-right font-mono ${row.value >= 0 ? "text-emerald-300" : "text-red-300"}`}>{formatNumber(row.value)}</span>
              </div>
            ))}
          </div>
        );
      }
      if (result.tool === "get_options_iv_intraday") {
        const plotted = exposures.slice(0, 28).map((row) => ({
          strike: optionLegNumber(row.strike),
          iv: effectiveExposureIv(row),
        })).filter((row) => row.iv > 0);
        if (plotted.length === 0) {
          return <OptionsUnsupportedState title="IV smile is unavailable" reason="The active source did not provide traceable implied-volatility values for this expiry." source={String(raw?.source || "")} />;
        }
        const maxIv = Math.max(...plotted.map((row) => row.iv));
        return (
          <div data-options-iv-chart>
            <p className="mb-3 text-xs text-slate-400">EOD implied-volatility smile by strike · snapshot bars, not intraday history.</p>
            <div className="flex h-64 items-end gap-1 overflow-x-auto border-b border-l border-slate-700 px-2 pt-6">
              {plotted.map((row) => (
                <span key={`iv-${row.strike}`} className="flex h-full min-w-8 flex-1 flex-col justify-end text-center" title={`Strike ${row.strike}: ${row.iv.toFixed(1)}%`}>
                  <em className="mb-1 text-[0.62rem] not-italic text-blue-200">{row.iv.toFixed(1)}%</em>
                  <i className="min-h-1 rounded-t bg-blue-400/80" data-options-iv-bar style={{ height: `${Math.max(3, row.iv / maxIv * 82)}%` }} />
                  <b className="mt-1 text-[0.6rem] text-slate-400">{row.strike}</b>
                </span>
              ))}
            </div>
          </div>
        );
      }
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
      return <PutCallRatioChart raw={raw} hasOpenInterest={hasOptionsOpenInterest} />;
    }
    if (chain) return renderChainPanel(result);
    return <ToolResultBlock result={result} />;
  };

  const renderEarningsPanel = () => {
    const earningsResult = tabPanelState.data?.earnings_vol_crush;
    const historicalResult = tabPanelState.data?.historical_context;
    const financialsResult = tabPanelState.data?.get_financial_statements;
    const earnings = rawRecord(rawRecord(earningsResult?.raw)?.earnings);
    const financials = financialStatementsFromResult(financialsResult);
    const financialsError = financialsResult?.error
      || (financialsResult && !financials ? "Published financial response does not match the ValuationCalculation contract." : null);
    const eventError = earningsResult?.error
      || (earningsResult && !earnings ? "Yahoo earnings response does not contain a structured event record." : null);
    const quarterRows = financials?.quarters.slice(0, earningsQuarterLimit) || [];
    const chronologicalRows = [...quarterRows].reverse();
    const revenueMax = Math.max(0, ...chronologicalRows.map((row) => Math.abs(row.revenue || 0)));
    const epsPoints = chronologicalRows
      .filter((row) => row.eps !== null)
      .map((row) => ({ label: row.date, value: row.eps as number, source: financials?.source }));
    const currencyCode = quarterRows.find((row) => row.currency)?.currency || null;
    const eventValue = (key: string) => earnings ? earnings[key] : null;
    const eventDate = (key: string) => rawNullableString(eventValue(key)) || "N/A";
    const eventNumber = (key: string) => rawNullableNumber(eventValue(key));
    const eventText = (key: string) => rawNullableString(eventValue(key)) || "N/A";
    const priceMove = rawRecord(eventValue("priceMove"));
    const priceMovePercent = rawNullableNumber(priceMove?.changePercent);
    const historicalLines = historicalResult?.text
      ? historicalResult.text.split(/\r?\n/).map((line) => line.replace(/^\s*[-#]\s*/, "").trim()).filter(Boolean)
      : [];

    return (
      <section className="siw-panel siw-primary-panel siw-earnings-workspace" data-primary-tab-panel="Earnings" data-earnings-report>
        <header className="siw-earnings-workspace-head">
          <div>
            <p>EVENT + REPORTED RESULTS</p>
            <h2>Earnings intelligence</h2>
            <span>Yahoo event estimates stay separate from published company financials.</span>
          </div>
          <button type="button" onClick={() => void loadTopTab("Earnings", true)} disabled={tabPanelState.loading}>
            <RefreshCw className={tabPanelState.loading ? "animate-spin" : ""} />
            {tabPanelState.loading ? "Refreshing" : "Refresh"}
          </button>
        </header>

        {tabPanelState.loading && (
          <div className="siw-earnings-loading">
            <SkeletonBlock className="h-28 w-full" />
            <SkeletonBlock className="h-72 w-full" />
          </div>
        )}
        {!tabPanelState.loading && tabPanelState.error && <div className="siw-earnings-loading"><ErrorBanner message={tabPanelState.error} onRetry={() => void loadTopTab("Earnings", true)} /></div>}
        {!tabPanelState.loading && !tabPanelState.error && (
          <div className="siw-earnings-body">
            <section className="siw-earnings-event-section" data-earnings-yahoo-event>
              <div className="siw-earnings-section-head">
                <div><p>Yahoo Finance</p><h3>Event pulse</h3></div>
                <span>{eventText("source")}</span>
              </div>
              {eventError ? (
                <div className="siw-data-empty siw-earnings-unavailable">
                  <strong>Yahoo earnings event unavailable</strong>
                  <span>{eventError}</span>
                </div>
              ) : (
                <div className="siw-earnings-event-grid">
                  <article>
                    <span>Next earnings</span>
                    <strong>{eventDate("nextEarningsDate")}</strong>
                    <em>EPS est. {formatOptionalNumber(eventNumber("nextEpsEstimate"))} · Revenue est. {eventText("nextRevenueEstimate")}</em>
                  </article>
                  <article>
                    <span>Latest EPS result</span>
                    <strong>{formatOptionalNumber(eventNumber("epsActual"))} <small>vs {formatOptionalNumber(eventNumber("epsEstimate"))}</small></strong>
                    <em className={eventText("result").toLowerCase() === "beat" ? "siw-up" : eventText("result").toLowerCase() === "miss" ? "siw-down" : ""}>{eventText("result")} · surprise {formatSignedPercent(eventNumber("surprisePercent"))}</em>
                  </article>
                  <article>
                    <span>Latest price reaction</span>
                    <strong className={priceMovePercent !== null && priceMovePercent < 0 ? "siw-down" : "siw-up"}>{formatSignedPercent(priceMovePercent)}</strong>
                    <em>{eventDate("lastEarningsDate")} · {rawNullableString(priceMove?.basis) || "N/A"}</em>
                  </article>
                </div>
              )}
            </section>

            <section className="siw-earnings-financial-section" data-earnings-financials>
              <div className="siw-earnings-section-head">
                <div><p>ValuationCalculation</p><h3>Reported quarterly results</h3></div>
                {financials && <div className="siw-earnings-period-controls" aria-label="Reported quarter range">
                  {([4, 8, 12] as const).map((limit) => (
                    <button key={limit} type="button" aria-pressed={earningsQuarterLimit === limit} onClick={() => setEarningsQuarterLimit(limit)}>{limit} quarters</button>
                  ))}
                </div>}
              </div>
              {financialsError || !financials ? (
                <div className="siw-data-empty siw-earnings-unavailable">
                  <strong>Published quarterly report unavailable</strong>
                  <span>{financialsError || "No published ValuationCalculation quarterly report was returned for this ticker."}</span>
                </div>
              ) : (
                <>
                  <div className="siw-earnings-source-strip" data-earnings-source>
                    <div><span>Financial source</span><strong>{financials.financialSource.source}</strong><em>{financials.financialSource.sourceType}</em></div>
                    <div><span>Financial data as of</span><strong>{financials.financialSource.dataAsOf}</strong><em>Latest filing {financials.financialSource.filingDate || "N/A"}</em></div>
                    <div><span>Fetched / published</span><strong>{formatProvenanceTimestamp(financials.financialSource.fetchedAt)}</strong><em>Release {formatProvenanceTimestamp(financials.generatedAt)}</em></div>
                    {financials.financialSource.sourceUrl && /^https?:\/\//i.test(financials.financialSource.sourceUrl) && <a href={financials.financialSource.sourceUrl} target="_blank" rel="noreferrer">Open source</a>}
                  </div>

                  <div className="siw-earnings-trend-grid" data-earnings-trend>
                    <section>
                      <div className="siw-earnings-chart-head"><span>Revenue by reported quarter</span><b>{currencyCode || "reported currency"}</b></div>
                      <div className="siw-earnings-revenue-bars" aria-label="Reported quarterly revenue chart">
                        {chronologicalRows.map((row) => {
                          const revenue = row.revenue;
                          const barHeight = revenue === null || revenueMax === 0 ? 0 : Math.max(6, Math.round((Math.abs(revenue) / revenueMax) * 100));
                          return <div key={row.date} data-earnings-revenue-bar title={`${row.date}: ${formatFinancialAmount(revenue, row.currency)}`}>
                            <i className={revenue !== null && revenue < 0 ? "is-negative" : ""} style={{ height: `${barHeight}%` }} />
                            <span>{row.date.slice(2)}</span>
                          </div>;
                        })}
                      </div>
                    </section>
                    <section className="siw-earnings-eps-trend" data-earnings-eps-trend>
                      <div className="siw-earnings-chart-head"><span>EPS trend</span><b>reported</b></div>
                      {epsPoints.length >= 2
                        ? <MiniSparkline points={epsPoints} positive={(epsPoints[epsPoints.length - 1]?.value || 0) >= epsPoints[0].value} className="siw-earnings-eps-sparkline" sourceLabel={financials.source} valueFormatter={(value) => formatOptionalNumber(value)} />
                        : <p>EPS trend unavailable: fewer than two reported values.</p>}
                    </section>
                  </div>

                  <div className="siw-earnings-table-scroll">
                    <table className="siw-earnings-table">
                      <thead><tr><th>Quarter</th><th>Filed</th><th>Revenue</th><th>QoQ</th><th>YoY</th><th>EPS</th><th>EPS YoY</th><th>Net income</th><th>Free cash flow</th></tr></thead>
                      <tbody>
                        {quarterRows.map((row) => (
                          <tr key={`${row.date}-${row.period || "quarter"}`} data-earnings-quarter-row>
                            <th>{[row.fiscalYear, row.period].filter(Boolean).join(" ") || row.date}</th>
                            <td>{row.filingDate || "N/A"}</td>
                            <td>{formatFinancialAmount(row.revenue, row.currency)}</td>
                            <td className={row.revenue_qoq !== null && row.revenue_qoq < 0 ? "siw-down" : "siw-up"}>{formatSignedPercent(row.revenue_qoq)}</td>
                            <td className={row.revenue_yoy !== null && row.revenue_yoy < 0 ? "siw-down" : "siw-up"}>{formatSignedPercent(row.revenue_yoy)}</td>
                            <td>{formatOptionalNumber(row.eps)}</td>
                            <td className={row.eps_yoy !== null && row.eps_yoy < 0 ? "siw-down" : "siw-up"}>{formatSignedPercent(row.eps_yoy)}</td>
                            <td>{formatFinancialAmount(row.netIncome, row.currency)}</td>
                            <td>{formatFinancialAmount(row.freeCashFlow, row.currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>

            {historicalResult?.error ? (
              <div className="siw-data-empty siw-earnings-context"><strong>Yahoo market context unavailable</strong><span>{historicalResult.error}</span></div>
            ) : historicalLines.length > 0 ? (
              <section className="siw-earnings-context" data-earnings-market-context>
                <div><p>Yahoo Finance</p><h3>Market context</h3></div>
                <ul>{historicalLines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul>
              </section>
            ) : null}
          </div>
        )}
      </section>
    );
  };

  const renderStatsReferencePanel = () => {
    const statsRaw = rawRecord(tabPanelState.data?.get_stock_stats?.raw) || {};
    const betaRaw = rawRecord(tabPanelState.data?.get_beta?.raw) || {};
    const yahooQuote = rawRecord(statsRaw.quote) || {};
    const yahooSummary = rawRecord(statsRaw.summary) || {};
    const yahooProfile = rawRecord(yahooSummary.assetProfile) || {};
    const yahooStats = rawRecord(yahooSummary.defaultKeyStatistics) || {};
    const yahooFinancial = rawRecord(yahooSummary.financialData) || {};
    const yahooDetail = rawRecord(yahooSummary.summaryDetail) || {};
    const fromRaw = (keys: string[]) => {
      for (const key of keys) {
        for (const source of [statsRaw, betaRaw, yahooQuote, yahooProfile, yahooStats, yahooFinancial, yahooDetail]) {
          const value = source[key];
          const nestedValue = rawRecord(value)?.raw ?? value;
          if (typeof nestedValue === "string" && nestedValue.trim()) return nestedValue;
          if (typeof nestedValue === "number" && Number.isFinite(nestedValue)) return nestedValue;
        }
      }
      return null;
    };
    const display = (keys: string[], fallback = "n/a", mode: "plain" | "money" | "percent" = "plain") => {
      const value = fromRaw(keys);
      if (typeof value === "string") return value;
      if (typeof value === "number") {
        if (mode === "money") return `$${formatNumber(value)}`;
        if (mode === "percent") return `${value.toFixed(2)}%`;
        return Math.abs(value) >= 1000 ? formatNumber(value) : value.toFixed(2).replace(/\.00$/, "");
      }
      return fallback;
    };
    const quote = snapshot?.quote;
    const beta = display(["beta", "beta3Year", "fiveYearAvgBeta"]);
    const targetMean = display(["targetMeanPrice", "meanTargetPrice"], "n/a", "money");
    const marketCap = display(["marketCap"], "n/a", "money");
    const enterpriseValue = display(["enterpriseValue"], "n/a", "money");
    const companyDescription = String(fromRaw(["longBusinessSummary"]) || "").trim();
    const sector = String(fromRaw(["sector", "sectorDisp"]) || getStocksWatcherUniverseStock(selectedSymbol)?.sector || "n/a");
    const industry = String(fromRaw(["industry", "industryDisp"]) || "n/a");
    const rows = [
      ["Exchange", String(fromRaw(["exchange", "fullExchangeName"]) || "n/a")],
      ["Market State", String(fromRaw(["marketState"]) || quote?.marketState || "n/a")],
      ["Sector", sector],
      ["Industry", industry],
      ["Market Cap", marketCap],
      ["Enterprise Value", enterpriseValue],
      ["Forward P/E", display(["forwardPE", "forwardPe"])],
      ["Trailing P/E", display(["trailingPE", "trailingPe"])],
      ["Dividend Yield", display(["dividendYield"], "n/a", "percent")],
      ["Target Mean", targetMean],
    ];
    const financialRows = [
      ["Price", quote ? currency(quote.price) : "n/a", quote ? `${quote.changePercent.toFixed(2)}%` : "n/a"],
      ["Forward P/E", display(["forwardPE", "forwardPe"]), "Yahoo"],
      ["Trailing P/E", display(["trailingPE", "trailingPe"]), "Yahoo"],
      ["Beta", beta, "5Y proxy"],
      ["52W High", display(["fiftyTwoWeekHigh"], "n/a", "money"), "Yahoo"],
      ["52W Low", display(["fiftyTwoWeekLow"], "n/a", "money"), "Yahoo"],
    ];

    return (
      <section className="siw-stats-board" data-primary-tab-panel="Fundamentals" data-fundamentals-metrics>
        <div className="siw-stats-left siw-panel">
          <div className="siw-panel-title">
            <span>Fundamentals</span>
            <b>{tabPanelState.loading ? "Loading" : "Yahoo"}</b>
          </div>
          <div className="siw-stat-columns">
            <div>
              <h3>Profile</h3>
              <table className="siw-stat-table">
                <tbody>
                  {rows.slice(0, 6).map(([label, value]) => (
                    <tr key={label}>
                      <th>{label}</th>
                      <td>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3>Valuation Summary</h3>
              <table className="siw-stat-table">
                <tbody>
                  {rows.slice(6).map(([label, value]) => (
                    <tr key={label}>
                      <th>{label}</th>
                      <td>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p>Source: Yahoo native tools. Missing fields stay as n/a, not backfilled.</p>
        </div>

        <div className="siw-stats-side">
          <div className="siw-panel siw-stat-card">
            <span>Beta and Volatility</span>
            <strong>{beta}</strong>
            <em>vs benchmark proxy</em>
            <div className="siw-meter"><i style={{ width: `${Math.min(95, Math.max(8, rawNumber(fromRaw(["beta", "beta3Year"])) * 42))}%` }} /></div>
          </div>
          <div className="siw-panel siw-stat-card">
            <span>Mean Target and Analysts</span>
            <strong>{targetMean}</strong>
            <em>Yahoo analyst target</em>
          </div>
          <div className="siw-panel siw-stat-card siw-description-card" data-company-description>
            <span>Company Description</span>
            <ExpandableDescription description={companyDescription || ""} />
          </div>
        </div>

        <div className="siw-panel siw-financial-summary">
          <div className="siw-panel-title">
            <span>Financial Summary</span>
            <b>TTM / latest available</b>
          </div>
          <table className="siw-stat-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Value</th>
                <th>Context</th>
              </tr>
            </thead>
            <tbody>
              {financialRows.map(([label, value, context]) => (
                <tr key={label}>
                  <th>{label}</th>
                  <td>{value}</td>
                  <td>{context}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="siw-panel siw-cashflow-panel">
          <div className="siw-panel-title">
            <span>Cash Flow Highlights</span>
            <b>Yahoo</b>
          </div>
          <table className="siw-stat-table">
            <tbody>
              {[
                ["Operating Cash Flow", display(["operatingCashflow"], "n/a", "money")],
                ["Free Cash Flow", display(["freeCashflow"], "n/a", "money")],
                ["Debt to Equity", display(["debtToEquity"])],
                ["Gross Margins", display(["grossMargins"], "n/a", "percent")],
              ].map(([label, value]) => (
                <tr key={label}>
                  <th>{label}</th>
                  <td>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  const renderGreeksReferencePanel = (data: Record<string, NativeToolResult>) => {
    const greekResult = data.get_options_greeks || Object.values(data).find((result) => optionExposuresFromResult(result).length > 0);
    const rawGreekRows = optionExposuresFromResult(greekResult);
    if (rawGreekRows.length === 0) {
      return (
        <OptionsUnsupportedState
          title="Greeks are unavailable for this expiry"
          reason="The active source did not provide traceable delta, gamma, implied-volatility and open-interest inputs. No synthetic DEX or IV values were generated."
          source={optionsVisualModel.provider}
        />
      );
    }
    const greekRows: RawOptionExposure[] = rawGreekRows.slice(0, 12);
    const callOiTotal = greekRows.reduce((sum, row) => sum + effectiveLegOpenInterest(row.call, row.callEffectiveOpenInterest ?? row.callOpenInterest), 0);
    const putOiTotal = greekRows.reduce((sum, row) => sum + effectiveLegOpenInterest(row.put, row.putEffectiveOpenInterest ?? row.putOpenInterest), 0);
    const callVolTotal = greekRows.reduce((sum, row) => sum + optionLegNumber(row.callVolume ?? row.call?.volume), 0);
    const putVolTotal = greekRows.reduce((sum, row) => sum + optionLegNumber(row.putVolume ?? row.put?.volume), 0);
    const pcOi = callOiTotal ? putOiTotal / callOiTotal : 0;
    const pcVol = callVolTotal ? putVolTotal / callVolTotal : 0;
    const avgIv = greekRows.length
      ? greekRows.reduce((sum, row) => sum + effectiveExposureIv(row), 0) / greekRows.length
      : 0;

    return (
      <div className="siw-greeks-board">
        <div className="siw-panel siw-greek-table-panel">
          <div className="siw-panel-title">
            <span>Greeks by Strike</span>
            <b>{formatExpiryDate(currentExpiry, "short")}</b>
          </div>
          <table className="siw-greek-table">
            <thead>
              <tr>
                <th>Strike</th>
                <th>Call OI</th>
                <th>Put OI</th>
                <th>Net GEX</th>
                <th>Net DEX</th>
                <th>Avg IV</th>
              </tr>
            </thead>
            <tbody>
              {greekRows.map((row) => {
                const strike = optionLegNumber(row.strike);
                const netGexValue = optionLegNumber(row.netGex);
                const netDexValue = optionLegNumber(row.netDex);
                return (
                  <tr key={`greek-${strike}`}>
                    <th>{strike}</th>
                    <td className="siw-up">{formatNumber(effectiveLegOpenInterest(row.call, row.callEffectiveOpenInterest ?? row.callOpenInterest))}</td>
                    <td className="siw-down">{formatNumber(effectiveLegOpenInterest(row.put, row.putEffectiveOpenInterest ?? row.putOpenInterest))}</td>
                    <td className={netGexValue >= 0 ? "siw-up" : "siw-down"}>{formatNumber(netGexValue)}</td>
                    <td className={netDexValue >= 0 ? "siw-up" : "siw-down"}>{formatNumber(netDexValue)}</td>
                    <td>{effectiveExposureIv(row).toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="siw-panel siw-iv-panel">
          <div className="siw-panel-title">
            <span>Average IV by Strike (%)</span>
            <b>bar</b>
          </div>
          <div className="siw-iv-bars">
            {greekRows.map((row) => {
              const iv = effectiveExposureIv(row);
              return (
                <span key={`iv-${row.strike}`} title={`${row.strike}: ${iv.toFixed(1)}%`}>
                  <i style={{ height: `${Math.max(8, Math.min(96, iv * 1.4))}%` }} />
                  <em>{optionLegNumber(row.strike)}</em>
                </span>
              );
            })}
          </div>
          <div className="siw-chart-controls">
            <button type="button">Chart Type: Bar</button>
            <button type="button">View: Avg IV</button>
          </div>
        </div>

        <div className="siw-panel siw-chain-preview">
          <div className="siw-panel-title">
            <span>Option Chain Preview</span>
            <b>Calls / Puts</b>
          </div>
          <table className="siw-greek-table">
            <thead>
              <tr>
                <th>Call OI</th>
                <th>Call Vol</th>
                <th>Strike</th>
                <th>Put Vol</th>
                <th>Put OI</th>
              </tr>
            </thead>
            <tbody>
              {greekRows.slice(0, 6).map((row) => (
                <tr key={`chain-${row.strike}`}>
                  <td className="siw-up">{formatNumber(effectiveLegOpenInterest(row.call, row.callEffectiveOpenInterest ?? row.callOpenInterest))}</td>
                  <td>{formatNumber(optionLegNumber(row.callVolume ?? row.call?.volume))}</td>
                  <th>{optionLegNumber(row.strike)}</th>
                  <td>{formatNumber(optionLegNumber(row.putVolume ?? row.put?.volume))}</td>
                  <td className="siw-down">{formatNumber(effectiveLegOpenInterest(row.put, row.putEffectiveOpenInterest ?? row.putOpenInterest))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="siw-panel siw-pc-metrics">
          <div className="siw-panel-title">
            <span>Put / Call Metrics</span>
            <b>derived</b>
          </div>
          <MetricTile label="P/C OI" value={pcOi.toFixed(2)} tone={pcOi > 1 ? "negative" : "positive"} />
          <MetricTile label="P/C Volume" value={pcVol.toFixed(2)} tone={pcVol > 1 ? "negative" : "positive"} />
          <MetricTile label="Avg IV" value={`${avgIv.toFixed(1)}%`} tone="blue" />
          <MetricTile label="Rows" value={`${greekRows.length}`} tone="blue" />
        </div>
        <div className="siw-greeks-provenance">
          <OptionsResultProvenance result={greekResult} />
        </div>
      </div>
    );
  };

  const renderOptionsSubTab = () => {
    if (activeSubTab === "Overview") return renderOptionsOverview();
    return (
      <div className="siw-options-subtab-content">
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
          activeSubTab === "Greeks"
            ? renderGreeksReferencePanel(subTabPanelState.data)
            : activeSubTab === "Chain" && subTabPanelState.data.get_options
            ? renderChainPanel(subTabPanelState.data.get_options)
            : (
              <div className="siw-tool-result-grid">
                {Object.values(subTabPanelState.data).map((result) => (
                  <div key={result.tool} className="siw-tool-result-card">
                    <div className="siw-tool-result-head"><strong>{result.tool}</strong></div>
                    {renderOptionResultPanel(result)}
                    <OptionsResultProvenance result={result} />
                  </div>
                ))}
              </div>
            )
        )}
      </div>
    );
  };

  const renderApprovedUniverseMarketContext = () => (
    <div className="siw-panel siw-market-context" data-overview-tertiary-panel="market-context">
      <div className="siw-panel-title">
        <Building2 className="h-4 w-4" />
        <span>Approved Universe Market Context</span>
        <button type="button" onClick={() => void loadMarketContext()} disabled={marketContext.loading}>{marketContext.loading ? "Refreshing" : "Refresh"}</button>
      </div>
      {(() => {
        const context = approvedUniverseRegimeFromResult(marketContext.regime);
        const holdings = approvedUniverseHoldingsFromResult(marketContext.sectorTopHoldings);
        const positiveRate = context ? Math.round((context.advancers / Math.max(1, context.universeCount)) * 100) : 0;
        const posture = context?.regime === "risk_on" ? "Risk-on" : context?.regime === "risk_off" ? "Risk-off" : context?.regime === "mixed" ? "Mixed" : "Needs checking";
        const postureTone = context?.regime === "risk_on" ? "positive" : context?.regime === "risk_off" ? "negative" : "blue";
        const leaders = holdings.slice(0, 3);
        const laggards = holdings.slice(-3).reverse();
        return <>
          <div className="siw-context-cards" data-approved-universe-market-context>
            <MetricTile label="Market posture" value={posture} tone={postureTone} />
            <MetricTile label="Breadth" value={context ? `${context.advancers}/${context.universeCount} · ${positiveRate}%` : "Needs checking"} tone="blue" />
            <MetricTile label="Average day move" value={context ? formatSignedPercent(context.avgChange) : "Needs checking"} tone={context && context.avgChange < 0 ? "negative" : "positive"} />
            <MetricTile label="Coverage" value={context ? `${context.universeCount} Yahoo symbols` : "Needs checking"} tone="blue" />
          </div>
          <div className="siw-breadth-bar" aria-label={context ? `${context.advancers} of ${context.universeCount} Yahoo approved-universe symbols are positive` : "Yahoo approved-universe breadth unavailable"}>
            <span style={{ width: `${positiveRate}%` }} />
            <em style={{ width: `${100 - positiveRate}%` }} />
          </div>
          <div className="siw-leader-laggard">
            <div><b>Top Leaders</b>{leaders.length ? leaders.map((holding) => <span key={holding.symbol}>{holding.symbol} {formatSignedPercent(holding.changePercent)}</span>) : <span>Needs checking</span>}</div>
            <div><b>Top Laggards</b>{laggards.length ? laggards.map((holding) => <span key={holding.symbol}>{holding.symbol} {formatSignedPercent(holding.changePercent)}</span>) : <span>Needs checking</span>}</div>
          </div>
        </>;
      })()}
      <p className="siw-context-source">Yahoo approved universe · {marketContext.error ? `Refresh failed: ${marketContext.error}` : "Daily change uses Yahoo quote changePercent."}</p>
    </div>
  );

  const renderToolRunsPanel = () => (
    <div className="siw-panel siw-tool-runs">
      <div className="siw-panel-title">
        <BarChart3 className="h-4 w-4" />
        <span>Native Yahoo Tool Runs</span>
        <b>{toolRunLog.length || snapshot?.toolRuns.length || 0}</b>
      </div>
      <div className="siw-run-table">
        {(toolRunLog.length > 0 ? toolRunLog : (snapshot?.toolRuns || []).map((run, index) => ({
          id: `${run.name}-${index}`, name: run.name, params: {}, status: run.status === "ok" ? "ok" as ToolStatus : "failed" as ToolStatus,
          startedAt: Date.now(), durationMs: undefined, payload: run.detail,
        }))).slice(0, 8).map((run, index) => (
          <button key={run.id} type="button" onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)} className={`siw-run-row ${run.status}`}>
            <span>{index + 1}</span><strong>{run.name}</strong><b>{run.status}</b><em>{run.durationMs ? `${run.durationMs}ms` : "--"}</em>
          </button>
        ))}
      </div>
      {expandedRunId && <pre>{stringifyPayload(toolRunLog.find((run) => run.id === expandedRunId))}</pre>}
    </div>
  );

  const renderToolCatalogPanel = () => (
    <div className="siw-panel siw-tool-catalog">
      <div className="siw-panel-title"><span>Tool Catalog (Yahoo Native)</span><b>local proxy</b></div>
      <label>
        <Search className="h-4 w-4" />
        <input value={toolSearch} onChange={(event) => setToolSearch(event.target.value)} aria-label="Search native Yahoo tools" name="native-yahoo-tool-search" placeholder="Search tools..." />
      </label>
      <div className="siw-tool-groups">
        {Object.entries(groupedTools).map(([category, tools]) => (
          <div key={category}><button type="button" className="siw-tool-group-title">{category}</button><div>
            {tools.slice(0, 8).map((tool) => <button key={tool.name} type="button" title={tool.description || tool.name} onClick={() => openRunToolModal(tool.name)}>{tool.name}</button>)}
          </div></div>
        ))}
        {availableTools.length === 0 && <span>Tool list unavailable in fallback mode.</span>}
      </div>
    </div>
  );

  const renderOverviewPanel = () => {
    const visibleWatchlistCount = watchlist.length;
    const visibleWatchlistSectorTotals = watchlist.reduce<Map<string, number>>((totals, stock) => {
      totals.set(stock.sector, (totals.get(stock.sector) || 0) + 1);
      return totals;
    }, new Map());
    const liveWatchlistQuotes = watchlist.flatMap((stock) => {
      const quote = rowQuotesBySymbol[stock.symbol];
      return quote?.source === "yahoo_quote" && quote.changeAvailable ? [{ stock, quote }] : [];
    });
    const watchlistCoverage = liveWatchlistQuotes.length;
    const sectorRows = Array.from(
      liveWatchlistQuotes.reduce<Map<string, { sector: string; totalChangePercent: number; covered: number }>>((groups, { stock, quote }) => {
        const current = groups.get(stock.sector) || { sector: stock.sector, totalChangePercent: 0, covered: 0 };
        current.totalChangePercent += quote.changePercent;
        current.covered += 1;
        groups.set(stock.sector, current);
        return groups;
      }, new Map()).values(),
    )
      .map((row) => ({ ...row, total: visibleWatchlistSectorTotals.get(row.sector) || row.covered, avgChangePercent: row.totalChangePercent / row.covered }))
      .sort((a, b) => b.avgChangePercent - a.avgChangePercent);
    const advancers = liveWatchlistQuotes.filter(({ quote }) => quote.changePercent > 0).length;
    const decliners = liveWatchlistQuotes.filter(({ quote }) => quote.changePercent < 0).length;
    const unchangedSymbols = liveWatchlistQuotes
      .filter(({ quote }) => quote.changePercent === 0)
      .map(({ stock }) => stock.symbol);
    const unchanged = unchangedSymbols.length;
    const unavailableChanges = Math.max(0, visibleWatchlistCount - watchlistCoverage);
    const breadthTotal = Math.max(1, watchlistCoverage);
    const latestWatchlistQuoteAt = liveWatchlistQuotes.reduce<number | null>((latest, { quote }) =>
      latest === null || quote.fetchedAt > latest ? quote.fetchedAt : latest, null);
    const marketIndexCards = marketContext.indices.length === MARKET_INDEX_DEFINITIONS.length
      ? marketContext.indices
      : emptyMarketIndexCards();
    const recentNews = snapshot?.recentNews?.slice(0, 3) || [];
    const earnings = snapshot?.earnings || null;
    const earningsMove = earnings?.priceMove;
    const valuation = valuationPanel.data;
    const valuationBands = valuation?.latest.bands;
    const valuationPrice = valuation?.latest.price ?? null;
    const valuationBandsComplete = valuationBands
      ? [valuationBands.down2, valuationBands.down1]
        .every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)
        && [valuationBands.mean, valuationBands.up1, valuationBands.up2]
          .every((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
      : false;
    const valuationGap = valuationBands?.mean && valuationPrice !== null
      ? ((valuationPrice - valuationBands.mean) / valuationBands.mean) * 100
      : null;
    const financials = snapshot?.financials || null;
    const valuationCoverage = snapshot?.valuationCoverage || "unavailable";

    return (
      <section className="siw-overview-grid" data-primary-tab-panel="Overview">
        <div className="siw-panel siw-market-overview">
          <div className="siw-overview-head">
            <h2>Market Overview</h2>
            <span>US equities</span>
          </div>
          <div className="siw-index-cards">
            {marketIndexCards.map((card) => {
              const points: SparklinePoint[] = card.status === "ok" ? card.history
                .filter((point): point is RawHistoryPoint & { close: number } =>
                  typeof point.close === "number" && Number.isFinite(point.close) && point.close > 0)
                .map((point, index) => ({
                  label: card.label,
                  dateTimeLabel: formatSparklineDateTime(point.date, `Daily point ${index + 1}`, "date"),
                  rangeLabel: "3M",
                  granularityLabel: "daily",
                  value: point.close,
                  source: `Yahoo ${card.sourceSymbol}`,
                })) : [];
              const positive = card.change >= 0;
              const latestPoint = points[points.length - 1];
              const indexTooltip = card.status === "ok"
                ? `${card.label} · ${latestPoint?.dateTimeLabel || "Latest"} · 3M daily: ${formatIndexValue(card.value)}, ${positive ? "+" : ""}${card.change.toFixed(2)} (${positive ? "+" : ""}${card.changePercent.toFixed(2)}%). Yahoo ${card.sourceSymbol} · ${card.historyPointCount} pts`
                : `${card.label} (${card.sourceSymbol}) unavailable: ${card.error || "Needs checking from Yahoo chart history"}`;
              return (
                <div
                  key={card.symbol}
                  data-market-index-card={card.symbol}
                  data-market-index-status={card.status}
                  data-market-index-source={card.sourceSymbol}
                  data-market-index-history-points={card.historyPointCount}
                >
                  <div className="siw-index-copy">
                    <span data-market-index-label>{card.label}</span>
                    <strong>{formatIndexValue(card.value)}</strong>
                    <em className={positive ? "siw-up" : "siw-down"}>
                      {card.status === "ok" ? `${positive ? "+" : ""}${card.change.toFixed(2)}  ${positive ? "+" : ""}${card.changePercent.toFixed(2)}%` : "Needs checking"}
                    </em>
                  </div>
                  <MiniSparkline
                    points={points}
                    positive={positive}
                    dataRole="index"
                    tooltip={indexTooltip}
                    sourceLabel={`Yahoo ${card.sourceSymbol}`}
                    valueFormatter={formatIndexValue}
                  />
                </div>
              );
            })}
          </div>
          <div className="siw-market-breadth">
            <div>
              <span>Watchlist Market Breadth (Yahoo live quotes)</span>
              <em>{watchlistCoverage > 0 ? `Change coverage ${watchlistCoverage}/${visibleWatchlistCount}${unavailableChanges > 0 ? ` · ${unavailableChanges} unavailable` : ""} · ${new Date(latestWatchlistQuoteAt || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ET` : `Change coverage 0/${visibleWatchlistCount} · Refresh to load`}</em>
            </div>
            <div className="siw-breadth-rail" data-watchlist-breadth data-watchlist-coverage={`${watchlistCoverage}/${visibleWatchlistCount}`}>
              <b style={{ width: `${(advancers / breadthTotal) * 100}%` }} />
              <i style={{ width: `${(unchanged / breadthTotal) * 100}%` }} />
              <strong style={{ width: `${(decliners / breadthTotal) * 100}%` }} />
            </div>
            <div className="siw-breadth-counts">
              <span className="siw-up">Advancers <b>{advancers}</b></span>
              <span title={unchangedSymbols.length > 0 ? `Unchanged: ${unchangedSymbols.join(", ")}` : undefined}>
                Unchanged <b>{unchanged}</b>{unchangedSymbols.length > 0 ? ` · ${unchangedSymbols.join(", ")}` : ""}
              </span>
              <span className="siw-down">Decliners <b>{decliners}</b></span>
            </div>
            {watchlistCoverage === 0 && <div className="siw-data-empty"><strong>Needs checking</strong><span>No live Yahoo quotes for the currently visible watchlist. Refresh all to try again.</span></div>}
          </div>
        </div>

        <div className="siw-panel siw-sector-panel">
          <div className="siw-overview-head">
            <h2>Watchlist Sector Performance</h2>
            <span>Yahoo live quotes · {watchlistCoverage}/{visibleWatchlistCount} covered</span>
          </div>
          <div className="siw-sector-list">
            {sectorRows.length > 0 ? sectorRows.map((row) => (
              <div key={row.sector} data-watchlist-sector={row.sector} data-watchlist-sector-coverage={`${row.covered}/${row.total}`}>
                <span>{row.sector} · {row.covered}/{row.total}</span>
                <b>
                  <i style={{ width: `${Math.min(100, Math.max(8, Math.abs(row.avgChangePercent) * 18))}%` }} className={row.avgChangePercent >= 0 ? "siw-sector-up" : "siw-sector-down"} />
                </b>
                <em className={row.avgChangePercent >= 0 ? "siw-up" : "siw-down"}>{formatSignedPercent(row.avgChangePercent)}</em>
              </div>
            )) : <div className="siw-data-empty"><strong>Needs checking</strong><span>No live Yahoo quotes for the currently visible watchlist. Refresh all to try again.</span></div>}
          </div>
        </div>

        <div className="siw-overview-tertiary" data-overview-tertiary>
          <div className="siw-panel siw-news-panel" data-overview-tertiary-panel="news">
            <div className="siw-overview-head">
              <h2>Recent News</h2>
              <span>Yahoo native</span>
            </div>
            <div className="siw-news-list">
              {recentNews.length > 0 ? recentNews.map((item) => (
                <a key={`${item.title}-${item.publishedAt || item.publisher}`} href={item.link || undefined} target="_blank" rel="noreferrer">
                  <strong>{item.title}</strong>
                  <span>{item.publisher} · {formatNewsTimestamp(item.publishedAt)}</span>
                </a>
              )) : (
                <div className="siw-data-empty">
                  <strong>Needs checking</strong>
                  <span>Yahoo native news returned no recent headlines for {snapshot?.quote.companyName || selectedSymbol}.</span>
                </div>
              )}
            </div>
          </div>

          <div className="siw-panel siw-earnings-panel" data-overview-tertiary-panel="earnings">
            <div className="siw-overview-head">
              <h2>Earnings Calendar</h2>
              <span>{earnings?.source ? "Yahoo" : "Needs checking"}</span>
            </div>
            <div className="siw-earnings-summary">
              <div>
                <span>Next earnings</span>
                <strong>{earnings?.nextEarningsDate || "Needs checking"}</strong>
                <em>EPS est {formatOptionalNumber(earnings?.nextEpsEstimate)} · Revenue est {earnings?.nextRevenueEstimate || "N/A"}</em>
              </div>
              <div>
                <span>Last earnings</span>
                <strong>{earnings?.lastEarningsDate || earnings?.lastReportedQuarter || "Needs checking"}</strong>
                <em>
                  EPS {formatOptionalNumber(earnings?.epsActual)} vs {formatOptionalNumber(earnings?.epsEstimate)}
                  {earnings?.result ? ` · ${earnings.result.toUpperCase()} ${formatSignedPercent(earnings.surprisePercent)}` : " · N/A"}
                </em>
              </div>
              <div>
                <span>Earnings-date move</span>
                <strong className={(earningsMove?.changePercent || 0) >= 0 ? "siw-up" : "siw-down"}>
                  {formatSignedPercent(earningsMove?.changePercent)}
                </strong>
                <em>{earningsMove ? `${earningsMove.eventTradingDate} close-to-close` : "Needs checking from Yahoo chart history"}</em>
              </div>
            </div>
          </div>

          <div className="siw-panel siw-valuation-panel" data-overview-tertiary-panel="valuation">
            <div className="siw-overview-head">
              <h2>Valuation</h2>
              <span>{valuation ? `${VALUATION_METRIC_LABEL[valuation.metric]} ${valuation.window} · ${valuation.dataAsOf}` : "Needs checking"}</span>
            </div>
            <div className="siw-valuation-controls">
              <label>Ticker
                <select
                  name="valuation-ticker"
                  aria-label="Curated valuation ticker"
                  value={valuationTicker}
                  onChange={(event) => setValuationTicker(event.target.value)}
                  disabled={curatedValuationTickers.length === 0}
                >
                  {curatedValuationTickers.map((stock) => <option key={stock.symbol} value={stock.symbol}>{stock.symbol}</option>)}
                </select>
              </label>
              <label>Metric
                <select name="valuation-metric" aria-label="Valuation metric" value={valuationMetric} onChange={(event) => setValuationMetric(event.target.value as WatcherValuationMetric)}>
                  {VALUATION_METRICS.map((metric) => <option key={metric} value={metric}>{VALUATION_METRIC_LABEL[metric]}</option>)}
                </select>
              </label>
            </div>
            {valuationPanel.loading ? <div className="siw-data-empty"><strong>Loading valuation</strong><span>Reading published ValuationCalculation bands.</span></div> : valuation && valuationBands && valuationPrice !== null && valuationBandsComplete ? (
              <div className="siw-earnings-summary">
                <div>
                  <span>Current vs mean</span>
                  <strong className={(valuationGap || 0) <= 0 ? "siw-up" : "siw-down"}>{formatSignedPercent(valuationGap)}</strong>
                  <em>Price {currency(valuationPrice)} · Mean {currency(valuationBands.mean!)}</em>
                </div>
                <ValuationRainbowChart valuation={valuation} />
                <div>
                  <span>Upside band</span>
                  <strong>{currency(valuationBands.up1!)}</strong>
                  <em>+2σ {currency(valuationBands.up2!)}</em>
                </div>
                <div>
                  <span>Downside band</span>
                  <strong>{currency(valuationBands.down1!)}</strong>
                  <em>-2σ {currency(valuationBands.down2!)} · {valuation.source}</em>
                </div>
              </div>
            ) : <div className="siw-data-empty"><strong>{valuationPanel.error || (valuationCoverage === "queued" ? "Coverage queued" : valuation ? `${VALUATION_METRIC_LABEL[valuationMetric]} band unavailable` : "Needs checking")}</strong><span>{valuationCoverage === "queued" ? "This ticker is queued for the next daily ValuationCalculation batch. Yahoo data is not used as a substitute." : valuation ? "The selected metric does not have a complete positive valuation band. Choose another metric." : "Published ValuationCalculation data is unavailable, invalid, or stale. Yahoo data is not used as a substitute."}</span></div>}
          </div>

          <div className="siw-panel siw-financials-panel" data-overview-tertiary-panel="financials">
            <div className="siw-overview-head">
              <h2>Financials</h2>
              <span>{financials?.filingDate || financials?.date || "Needs checking"}</span>
            </div>
            {financials ? (
              <div className="siw-earnings-summary">
                <div>
                  <span>Revenue</span>
                  <strong>{formatNumber(financials.revenue || 0)}</strong>
                  <em>QoQ {formatSignedPercent(financials.revenue_qoq)} · YoY {formatSignedPercent(financials.revenue_yoy)}</em>
                </div>
                <div>
                  <span>EPS / Net income</span>
                  <strong>{formatOptionalNumber(financials.eps)}</strong>
                  <em>Net income {formatNumber(financials.netIncome || 0)} · {financials.currency || "N/A"}</em>
                </div>
                <div>
                  <span>Free cash flow</span>
                  <strong>{formatNumber(financials.freeCashFlow || 0)}</strong>
                  <em>OCF {formatNumber(financials.operatingCashFlow || 0)} · {financials.fiscalYear || ""} {financials.period || ""}</em>
                </div>
              </div>
            ) : <div className="siw-data-empty"><strong>{valuationCoverage === "queued" ? "Coverage queued" : "Needs checking"}</strong><span>{valuationCoverage === "queued" ? "Financial statements will be published with the next daily valuation batch." : "Published quarterly financial statements are unavailable, invalid, or stale."}</span></div>}
          </div>

          {renderApprovedUniverseMarketContext()}

          <div className="siw-panel siw-key-metrics-panel" data-overview-tertiary-panel="metrics">
            <div className="siw-overview-head">
              <h2>Key Metrics</h2>
            </div>
            <div className="siw-key-grid">
              <MetricTile label="Spot" value={latestPrice ? currency(latestPrice) : "--"} tone="blue" />
              <MetricTile label="Call GEX" value={hasOverviewOptionsGex ? formatNumber(overviewTotalCallGex) : "n/a"} tone="positive" />
              <MetricTile label="Put GEX" value={hasOverviewOptionsGex ? formatNumber(overviewTotalPutGex) : "n/a"} tone="negative" />
              <MetricTile label="P/C OI" value={hasOverviewOptionsOpenInterest ? (overviewPutOi / Math.max(1, overviewCallOi)).toFixed(2) : "n/a"} tone="neutral" />
            </div>
          </div>
        </div>

        <div className="siw-spx-market-breadth-panel" data-overview-bottom-panel="spx-market-breadth">
          <MarketBreadthPanel variant="embedded" />
        </div>
      </section>
    );
  };

  const renderPrimaryPanel = () => {
    if (activeTab === "Overview") return renderOverviewPanel();
    if (activeTab === "Chart") return renderChartPanel();
    if (activeTab === "News") return <StocksWatcherNewsPanel key={selectedSymbol} symbol={selectedSymbol} loadTool={loadNewsTool} />;

    if (activeTab === "F/G Index") {
      return (
        <section className="siw-panel siw-primary-panel siw-fear-greed-panel" data-primary-tab-panel="F/G Index">
          {fearGreedState.loading && <div className="siw-generic-content"><SkeletonBlock className="h-64 w-full" /></div>}
          {fearGreedState.error && <div className="siw-generic-content"><ErrorBanner message={fearGreedState.error} onRetry={() => void loadFearGreed(true)} /></div>}
          {!fearGreedState.loading && !fearGreedState.error && fearGreedState.data && (
            <StocksWatcherFearGreedPanel snapshot={fearGreedState.data} cache={fearGreedState.cache} onRefresh={() => void loadFearGreed(true)} />
          )}
        </section>
      );
    }

    if (activeTab === "Fundamentals") return renderStatsReferencePanel();
    if (activeTab === "Earnings") return renderEarningsPanel();
    if (activeTab === "Fixed Income") return <section className="siw-panel siw-primary-panel siw-fixed-income-panel" data-primary-tab-panel="Fixed Income"><StocksWatcherFixedIncomePanel /></section>;
    if (activeTab === "Macro") return <section className="siw-panel siw-primary-panel siw-macro-panel" data-primary-tab-panel="Macro"><StocksWatcherMacroPanel /></section>;

    return (
      <section className="siw-options-stage" data-primary-tab-panel="Options">
        <aside className="siw-expiry-rail" data-options-expiry-selector>
          <div className="siw-expiry-head">
            <span>Expiry</span>
            <span>OI</span>
            <span title={usesNativeYahooOptions ? "Yahoo delayed · locally estimated from near-spot open interest and implied volatility" : undefined}>
              {usesNativeYahooOptions ? "Proxy GEX" : "Net GEX"}
            </span>
            <span title={usesNativeYahooOptions ? "Yahoo delayed · locally estimated from near-spot open interest and delta" : undefined}>
              {usesNativeYahooOptions ? "Proxy DEX" : "Net DEX"}
            </span>
          </div>
          <div className="siw-expiry-list">
            {selectorExpiryRows.map((row) => {
              const normalizedExpiry = normalizeExpiryDate(row.expiry);
              const active = normalizeExpiryDate(currentExpiry) === normalizedExpiry;
              const loadState = getExpirySelectorLoadState(row);
              return (
                <button
                  key={normalizedExpiry}
                  type="button"
                  data-expiry-row={normalizedExpiry}
                  className={`siw-expiry-row ${active ? "is-active" : ""}`}
                  onClick={() => selectOptionsExpiry(normalizedExpiry)}
                >
                  <span>{formatExpiryDate(row.expiry, "compact")}</span>
                  <span>{row.loaded ? formatNumber(row.openInterest || 0) : loadState === "loading" ? "Loading" : loadState === "retry" ? "Retry" : "Load"}</span>
                  <span className={exposureToneClassName(row.netGex, row.loaded)} title={usesNativeYahooOptions ? "Locally estimated Yahoo proxy; not dealer positioning" : undefined}>{row.loaded ? formatOptionalSignedExposure(row.netGex) : "n/a"}</span>
                  <span className={exposureToneClassName(row.netDex, row.loaded)} title={usesNativeYahooOptions ? "Locally estimated Yahoo proxy; not dealer positioning" : undefined}>{row.loaded ? formatOptionalSignedExposure(row.netDex) : "n/a"}</span>
                </button>
              );
            })}
          </div>
          {yahooExpiryPreloadLabel && <div className="siw-yahoo-expiry-preload" data-yahoo-expiry-preload>{yahooExpiryPreloadLabel}</div>}
          <button type="button" className="siw-view-all" onClick={() => selectOptionsExpiry(snapshot?.availableExpiries?.[0] || currentExpiry || null)}>
            Nearest expiry
          </button>
        </aside>

        <div className="siw-options-main">
          <div className="siw-options-subtabs">
            {(["oi", "volume", "gex"] as StocksWatcherChartMode[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  if ((item === "oi" && !hasOptionsOpenInterest) || (item === "gex" && !hasOptionsGex)) return;
                  setMode(item);
                  setActiveSubTab("Overview");
                }}
                disabled={(item === "oi" && !hasOptionsOpenInterest) || (item === "gex" && !hasOptionsGex)}
                title={(item === "oi" && !hasOptionsOpenInterest) || (item === "gex" && !hasOptionsGex) ? "The active source did not return the required options fields for this expiry" : undefined}
                className={activeSubTab === "Overview" && mode === item ? "is-active" : ""}
                aria-pressed={activeSubTab === "Overview" && mode === item}
              >
                {item === "oi" ? "OI" : item === "volume" ? "Vol" : "GEX"}
              </button>
            ))}
            {OPTIONS_SUB_TABS.filter((item) => item !== "Overview").map((item) => {
              const disabled = !hasOptionsOpenInterest && ["Greeks", "DEX", "P/C"].includes(item);
              return (
                <button
                  key={item}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (!disabled) setActiveSubTab(item);
                  }}
                  className={activeSubTab === item ? "is-active" : ""}
                  aria-pressed={activeSubTab === item}
                >
                  {item}
                </button>
              );
            })}
          </div>
          <div className="siw-options-content">
            {renderOptionsSubTab()}
          </div>
        </div>
      </section>
    );
  };

  return (
    <section className="siw-app min-h-dvh w-full overflow-visible text-slate-100 lg:h-full lg:min-h-full lg:overflow-hidden" data-stocks-watcher-root>
      <div className={`siw-replica-shell ${watchlistCollapsed ? "is-rail-collapsed" : ""}`} data-watcher-replica>
        <aside className="siw-sidebar">
          <div className="siw-sidebar-head">
            <a href="#/market-lab" className="siw-back-button" aria-label="Back to work">
              <ArrowLeft className="h-4 w-4" />
            </a>
            <div className="siw-brand">
              <BrandMark />
              <div>
                <span>Stocks Intelligence</span>
                <strong>Watcher</strong>
              </div>
            </div>
            <button
              type="button"
              className="siw-icon-button"
              onClick={() => setWatchlistCollapsed((value) => !value)}
              aria-label={watchlistCollapsed ? "Expand watchlist" : "Collapse watchlist"}
            >
              {watchlistCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </div>

          {!watchlistCollapsed && (
            <>
              <div className="siw-search-row">
                <label>
                  <Search className="h-4 w-4" />
                  <input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      if (searchError) setSearchError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submitSearch();
                    }}
                    name="stock-search"
                    autoComplete="off"
                    aria-label="Search stocks"
                    placeholder="Search ticker or name…"
                  />
                </label>
                <button type="button" onClick={submitSearch} className="siw-load-button">
                  LOAD
                </button>
                <button
                  type="button"
                  onClick={() => void refreshAllWatchers()}
                  className="siw-refresh-all-button"
                  aria-label="Refresh all watcher tickers"
                  title="Refresh all watcher tickers"
                  disabled={watchlistRefreshing}
                >
                  <RefreshCw className={watchlistRefreshing ? "animate-spin" : ""} />
                </button>
              </div>
              {searchError && <p className="siw-search-error" role="alert">{searchError}</p>}
              <span className="sr-only" role="status" aria-live="polite">{watchlistRefreshing ? "Refreshing watcher tickers" : loadingSymbol ? `Loading ${loadingSymbol}` : ""}</span>

              <div className={`siw-filter-row ${filtersOpen ? "is-open" : ""}`}>
                <label>
                  <select name="watcher-sector-filter" aria-label="Sector filter" value={sectorFilter} onChange={(event) => setSectorFilter(event.target.value)}>
                    {sectorOptions.map((sector) => <option key={sector}>{sector}</option>)}
                  </select>
                  <ChevronDown className="h-4 w-4" />
                </label>
                <label>
                  <select name="watcher-type-filter" aria-label="Type filter" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                    {typeOptions.map((type) => <option key={type}>{type}</option>)}
                  </select>
                  <ChevronDown className="h-4 w-4" />
                </label>
                <button type="button" className="siw-icon-button" onClick={() => setFiltersOpen((value) => !value)} aria-label="Toggle filters">
                  <span className="siw-filter-glyph">⌯</span>
                </button>
              </div>
              {filtersOpen && (
                <div className="siw-filter-state" data-filter-panel>
                  <span>{sectorFilter}</span>
                  <span>{typeFilter}</span>
                  <button type="button" onClick={() => {
                    setSectorFilter("All Sectors");
                    setTypeFilter("All Types");
                  }}>
                    Reset
                  </button>
                </div>
              )}

              <div className="siw-watchlist-tabs">
                <button type="button" onClick={() => {
                  setWatchlistSource("all");
                  void loadNativeWatchlist();
                }} className={watchlistSource === "all" ? "is-active" : ""}>
                  All Stocks
                </button>
                <button type="button" onClick={() => {
                  setWatchlistSource("favorites");
                  loadFavoritesFromLocal();
                }} className={watchlistSource === "favorites" ? "is-active" : ""}>
                  <Star className="h-3.5 w-3.5" />
                  FAV
                </button>
              </div>

              <div className="siw-watchlist-head">
                <span>Ticker</span>
                <span>Price</span>
                <span>Change</span>
              </div>

              <p className="siw-watchlist-hint">Swipe horizontally for more tickers. Each card is keyboard selectable.</p>
              <div className="siw-watchlist" data-watchlist-scope data-cache-version={cacheVersion} role="region" aria-label="Horizontally scrollable stock watchlist" tabIndex={0}>
                {watchlist.map((stock) => {
                  const symbol = stock.symbol;
                  const selected = symbol === selectedSymbol;
                  const yahooRowQuote = rowQuotesBySymbol[symbol] ?? null;
                  const selectedSnapshotQuote = selected && snapshot?.symbol === symbol ? snapshot.quote : null;
                  const rowQuote = yahooRowQuote || selectedSnapshotQuote;
                  const hasRowQuote = Boolean(rowQuote && Number.isFinite(rowQuote.price) && rowQuote.price > 0);
                  const hasChangeData = hasRowQuote && (yahooRowQuote ? yahooRowQuote.changeAvailable : true);
                  const change = hasChangeData ? rowQuote!.change : null;
                  const rowPositive = change !== null && change >= 0;
                  const isRowLoading = loadingSymbol === symbol || refreshingSymbols.includes(symbol);
                  const isFavorite = favorites.includes(symbol);
                  const price = hasRowQuote ? rowQuote!.price : null;
                  const pct = hasChangeData ? rowQuote!.changePercent : null;
                  const rowSource = yahooRowQuote ? "yahoo_quote" : selectedSnapshotQuote ? "selected_snapshot" : "unavailable";
                  const rowAsOf = yahooRowQuote?.asOf || selectedSnapshotQuote?.asOf || "";

                  return (
                    <div
                      key={symbol}
                      data-watchlist-row={symbol}
                      data-row-price={price === null ? "" : price.toFixed(2)}
                      data-row-change={change === null ? "" : change.toFixed(2)}
                      data-row-change-available={hasChangeData ? "true" : "false"}
                      data-row-source={rowSource}
                      data-row-asof={rowAsOf}
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
                      className={`siw-watch-row ${selected ? "is-selected" : ""}`}
                    >
                      <input
                        type="checkbox"
                        name={`favorite-${symbol}`}
                        aria-label={`Favorite ${symbol}`}
                        checked={isFavorite}
                        onChange={() => toggleFavorite(symbol)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      />
                      <TickerLogo symbol={symbol} />
                      <div className="siw-row-name">
                        <strong>{symbol}{isRowLoading ? " …" : ""}</strong>
                        <span>{stock.companyName}</span>
                      </div>
                      <div className="siw-row-price">
                        <strong>{price === null ? "Unavailable" : currency(price)}</strong>
                        <span>USD</span>
                      </div>
                      <div className={`siw-row-change ${change === null ? "" : rowPositive ? "siw-up" : "siw-down"}`}>
                        <strong>{change === null ? "--" : `${rowPositive ? "+" : ""}${change.toFixed(2)}`}</strong>
                        <span>{pct === null ? "--" : `${rowPositive ? "+" : ""}${pct.toFixed(2)}%`}</span>
                      </div>
                      <button
                        type="button"
                        title="Remove ticker"
                        aria-label={`Remove ${symbol}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeSymbol(symbol);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
                {watchlist.length === 0 && (
                  <div className="siw-empty-list">
                    No stocks match this search/filter.
                  </div>
                )}
              </div>

              <div className="siw-sidebar-actions">
                <button
                  type="button"
                  className="siw-add-button"
                  onClick={() => {
                    setQuery((value) => value || "SOFI");
                    setSettingsOpen(false);
                  }}
                >
                  + Add ticker
                </button>
                <button type="button" className="siw-icon-button" onClick={() => setSettingsOpen((value) => !value)} aria-label="Settings">
                  <span>⚙</span>
                </button>
              </div>
            </>
          )}

          {watchlistCollapsed && (
            <div className="siw-mini-rail">
              {watchlist.slice(0, 8).map((stock) => (
                <button key={stock.symbol} type="button" onClick={() => selectWatchlistSymbol(stock.symbol)} className={stock.symbol === selectedSymbol ? "is-selected" : ""}>
                  <TickerLogo symbol={stock.symbol} />
                </button>
              ))}
            </div>
          )}
        </aside>

        <main ref={detailPanelRef} className="siw-main">
          <header className={`siw-hero ${loading ? "is-loading" : ""}`} data-selected-symbol={selectedSymbol}>
            <div className="siw-hero-identity">
              <div className="siw-logo-card">
                <TickerLogo symbol={snapshot?.symbol || selectedSymbol} large />
                <button type="button" onClick={() => toggleFavorite(selectedSymbol)} aria-label={`Favorite ${selectedSymbol}`}>
                  <Star className={favorites.includes(selectedSymbol) ? "h-4 w-4 fill-blue-400 text-blue-400" : "h-4 w-4"} />
                </button>
              </div>
              <div>
                <h1>{snapshot?.symbol || selectedSymbol}</h1>
                <p>{snapshot?.quote.companyName || getStocksWatcherUniverseStock(selectedSymbol)?.companyName || "Stocks Intelligence"}</p>
              </div>
            </div>

            <div className="siw-hero-price">
              <strong>{latestPrice ? latestPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "--"}</strong>
              <span>USD</span>
              {snapshot && (
                <em className={isPositive ? "siw-up" : "siw-down"}>
                  {signedNumberText(snapshot.quote.change)}
                  {" "}
                  {signedNumberText(snapshot.quote.changePercent)}%
                  {heroArrow ? ` ${heroArrow}` : ""}
                </em>
              )}
            </div>

            <div className="siw-hero-stats">
              <span>High <b>{formatOptionalPrice(sessionHigh)}</b></span>
              <span>Low <b>{formatOptionalPrice(sessionLow)}</b></span>
              <span>Open <b>{formatOptionalPrice(sessionOpen)}</b></span>
              <span>Prev Close <b>{formatOptionalPrice(previousClose)}</b></span>
            </div>

            <div className="siw-hero-chart">
              <MiniSparkline
                points={heroSparklinePoints}
                positive={isPositive}
                className="siw-hero-sparkline"
                dataRole="hero"
                tooltip={`${snapshot?.symbol || selectedSymbol} price sparkline: ${heroSparklinePoints.length} points, latest ${latestPrice ? currency(latestPrice) : "N/A"}, ${snapshot ? `${signedNumberText(snapshot.quote.changePercent)}%` : "change N/A"}`}
                sourceLabel={`${snapshot?.symbol || selectedSymbol} intraday`}
                valueFormatter={currency}
                placement="bottom"
              />
              <span>Updated {formatStocksWatcherRelativeAge(updatedSecondsAgo)}</span>
            </div>

          </header>

          <nav className="siw-main-tabs" aria-label="Stocks watcher sections">
            {(embedded ? TOP_TABS.filter(item => item === "Chart" || item === "Options") : TOP_TABS).map((item) => {
              const TabIcon = TOP_TAB_ICONS[item];
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setActiveTab(item)}
                  className={item === activeTab ? "is-active" : ""}
                  aria-current={item === activeTab ? "page" : undefined}
                >
                  <span className="siw-tab-icon">
                    <TabIcon className="siw-tab-svg" aria-hidden="true" />
                  </span>
                  {item}
                </button>
              );
            })}
          </nav>

          <label className="siw-mobile-section-selector">
            <span>Watcher section</span>
            <select name="watcher-section" value={activeTab} onChange={(event) => setActiveTab(event.target.value as TopTab)}>
              {(embedded ? TOP_TABS.filter(item => item === "Chart" || item === "Options") : TOP_TABS).map((item) => <option key={item} value={item}>{item === "Chart" && embedded ? "Price + GEX" : item}</option>)}
            </select>
          </label>

          <div className="siw-main-scroll">
            {error && <ErrorBanner message={error} onRetry={refreshCurrent} />}
            {loading && loadingSymbol === selectedSymbol && (
              <section className="siw-ticker-transition" data-ticker-loading aria-live="polite">
                <div>
                  <span>Loading {selectedSymbol} from Yahoo</span>
                  <em>Previous ticker data is intentionally hidden.</em>
                </div>
                <div className="siw-ticker-transition-skeletons" aria-hidden="true">
                  <SkeletonBlock className="h-5 w-40" />
                  <SkeletonBlock className="h-20 w-full" />
                  <SkeletonBlock className="h-44 w-full" />
                </div>
              </section>
            )}
            {settingsOpen && (
              <section className="siw-settings-panel" data-settings-panel>
                <div className="siw-settings-head">
                  <div>
                    <strong>Watcher diagnostics</strong>
                    <span>Source: {snapshot?.source === "native_yahoo" ? "Yahoo Finance native" : "Unavailable"}</span>
                  </div>
                  <button type="button" onClick={refreshCurrent}>Retry / refresh</button>
                </div>
                <div className="siw-help-tools-grid">
                  {renderToolRunsPanel()}
                  {renderToolCatalogPanel()}
                </div>
              </section>
            )}

            {embedded && ((loading && !snapshot) || (activeTab === "Options" && activeSubTab === "Overview" && expiryOverviewState.loading && !expiryOverviewState.data))
              ? <p className="p-5 text-sm text-slate-400" role="status">Loading options data…</p>
              : renderPrimaryPanel()}

            <div className="siw-detail-stack" data-detail-stack>
              {!embedded && renderAiSummaryPanel()}
            </div>
          </div>

          <footer className="siw-status-bar">
            {activeTab === "Macro" ? <>
              <span>Data: Federal Reserve Economic Data (FRED)</span>
              <span>Series: EIA · Federal Reserve · IMF · BEA · Dallas Fed</span>
            </> : <>
              <span data-market-status={marketStatus.isOpen ? "open" : "closed"}><b /> Market: {marketStatus.label}</span>
              <span>Data: Yahoo Finance <em>(Delayed 15-20 min)</em></span>
              <span>Source: {snapshot?.optionsSnapshot ? "Robinhood MCP EOD · OI-signed GEX proxy" : isYahooOptionsFallback ? "Yahoo fallback · Robinhood EOD unavailable" : snapshot?.source === "native_yahoo" ? "Yahoo options chain + local Greek approximation" : "Unavailable"}</span>
            </>}
            <span>Not financial advice</span>
            <button type="button" onClick={() => setSettingsOpen((value) => !value)}>Help</button>
          </footer>

          <nav className="siw-mobile-nav" aria-label="Mobile watcher navigation">
            {(["home", "markets", "watcher", "portfolio", "more"] as const).map((item) => (
              <button key={item} type="button" onClick={() => setMobilePanel(item)} className={mobilePanel === item ? "is-active" : ""}>
                <span>{item === "watcher" ? "⌘" : item.slice(0, 1).toUpperCase()}</span>
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </nav>
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
                    <h3 className="mb-2 text-sm font-black text-blue-100">{({ get_options_greeks: "Strike exposures", get_options_iv_intraday: "Implied volatility by strike", get_options_mispricing: "Contract quote checks" } as Record<string, string>)[result.tool] || "Option evidence"}</h3>
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
