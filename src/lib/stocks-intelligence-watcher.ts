import { STOCKS_WATCHER_SYMBOLS, normalizeStocksWatcherSymbol, completeTotal } from "./stocks-native-yahoo";
import type { StocksNativeToolResult, StocksNativeToolSummary } from "./stocks-native-yahoo";
import { STOCKS_WATCHER_UNIVERSE } from "./stocks-watcher-universe";
import type { StocksWatcherUniverseStock } from "./stocks-watcher-universe";
import type { MarketCacheMetadata } from "./market-data-cache";
import type { WatcherCoverageStatus, WatcherFinancialQuarter, WatcherValuationBands } from "./stocks-watcher-valuation-data";
import {
  assertRobinhoodSpotCompatible,
  toRobinhoodOptionsView,
  type RobinhoodOptionsPublishedSnapshot,
} from "./stocks-watcher-robinhood-options";

export type StocksWatcherChartMode = "oi" | "volume" | "gex";

export interface StocksWatcherQuote {
  symbol: string;
  companyName: string;
  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  marketState: string | null;
  asOf: string | null;
}

export type StocksWatcherMarketSessionTone = "open" | "extended" | "closed" | "unknown";

export interface StocksWatcherMarketSession {
  label: "Open" | "Pre-market" | "After-hours" | "Closed" | "Unavailable";
  tone: StocksWatcherMarketSessionTone;
}

/** Maps Yahoo's quoted session state directly to a display state; it never infers the session from local time. */
export const getStocksWatcherMarketSession = (marketState: string | null | undefined): StocksWatcherMarketSession => {
  switch (marketState?.trim().toUpperCase()) {
    case "REGULAR":
      return { label: "Open", tone: "open" };
    case "PRE":
    case "PREPRE":
      return { label: "Pre-market", tone: "extended" };
    case "POST":
    case "POSTPOST":
      return { label: "After-hours", tone: "extended" };
    case "CLOSED":
      return { label: "Closed", tone: "closed" };
    default:
      return { label: "Unavailable", tone: "unknown" };
  }
};

/** Formats a known elapsed refresh age without implying that stale data is live. */
export const formatStocksWatcherRelativeAge = (seconds: number | null): string => {
  if (seconds === null || !Number.isFinite(seconds)) return "--";
  const elapsed = Math.max(0, Math.floor(seconds));
  if (elapsed < 60) return `${elapsed} sec ago`;
  const minutes = Math.floor(elapsed / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

export interface StocksWatcherNewsItem {
  title: string;
  publisher: string;
  link: string;
  publishedAt: string | null;
}

export interface StocksWatcherEarningsSnapshot {
  source: string;
  nextEarningsDate: string | null;
  nextEpsEstimate: number | null;
  nextRevenueEstimate: string | null;
  lastEarningsDate: string | null;
  lastReportedQuarter: string | null;
  epsActual: number | null;
  epsEstimate: number | null;
  epsDifference: number | null;
  surprisePercent: number | null;
  result: "beat" | "miss" | null;
  priceMove: {
    eventTradingDate: string;
    previousClose: number;
    close: number;
    changePercent: number;
    basis: string;
  } | null;
}

export interface StocksWatcherExpiryRow {
  expiry: string;
  openInterest: number | null;
  primaryStrike: number;
  strike: number;
  volume: number | null;
  dominantType: "C" | "P" | null;
  type: "C" | "P" | null;
  /** Only populated when the source supplied auditable gamma inputs. */
  netGex?: number;
  /** Only populated when the source supplied auditable delta inputs. */
  netDex?: number;
}

export interface StocksWatcherStrikeRow {
  strike: number;
  callOpenInterest: number;
  putOpenInterest: number;
  callVolume: number;
  putVolume: number;
  callGex: number;
  putGex: number;
  netGex: number;
}

export interface StocksWatcherHistoryPoint {
  label: string;
  date?: string;
  price: number;
}

export interface StocksWatcherToolRun {
  name: string;
  status: "ok" | "failed" | "skipped";
  detail: string;
}

export interface StocksWatcherSnapshot {
  generatedAt: string;
  symbol: string;
  cache?: MarketCacheMetadata;
  quote: StocksWatcherQuote;
  spot: number;
  atm: number;
  selectedTimeLabel: string;
  gexRegime: string;
  putCallOpenInterest: number | null;
  putCallVolume: number | null;
  sweeps: number | null;
  availableExpiries: string[];
  selectedExpiry: string | null;
  expiryRows: StocksWatcherExpiryRow[];
  expiries: StocksWatcherExpiryRow[];
  strikes: StocksWatcherStrikeRow[];
  history: StocksWatcherHistoryPoint[];
  recentNews: StocksWatcherNewsItem[];
  earnings: StocksWatcherEarningsSnapshot;
  valuation: WatcherValuationBands | null;
  financials: WatcherFinancialQuarter | null;
  valuationCoverage?: WatcherCoverageStatus;
  marketContext: {
    breadth: string;
    relativeStrength: string;
  };
  availableTools: { name: string; description: string; inputKeys: string[] }[];
  toolRuns: StocksWatcherToolRun[];
  warnings: string[];
  /** Present only for curated symbols with a validated private EOD options release. */
  optionsSnapshot?: {
    provider: "robinhood_mcp";
    methodology: "OI-signed GEX proxy";
    runId: string;
    capturedAt: string;
    expectedSymbols: number;
    completedSymbols: number;
  };
  optionsUnavailable?: string;
  /** The snapshot is always backed by the native Yahoo adapter. */
  source: "native_yahoo";
}

export interface StocksWatcherPublishedOptionsInput {
  snapshot?: RobinhoodOptionsPublishedSnapshot;
  unavailableReason?: string;
}

export interface StocksWatcherToolClient {
  listTools: () => Promise<StocksNativeToolSummary[]>;
  callToolText: (name: string, args: Record<string, unknown>) => Promise<string>;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<StocksNativeToolResult>;
}

const DEFAULT_WATCHLIST = [...STOCKS_WATCHER_SYMBOLS];
export const STOCKS_WATCHER_CACHE_TTL_MS = 60_000;

export interface StocksWatcherSnapshotCacheEntry {
  snapshot: StocksWatcherSnapshot;
  fetchedAt: number;
}

export interface StocksWatcherRowQuote {
  symbol: string;
  companyName?: string;
  price: number;
  previousClose?: number | null;
  change: number | null;
  changePercent: number | null;
  changeAvailable: boolean;
  marketState: string | null;
  asOf: string | null;
  fetchedAt: number;
  source: "yahoo_quote";
}

export interface StocksWatcherRefreshBatchResult<T> {
  symbol: string;
  status: "fulfilled" | "rejected";
  value?: T;
  reason?: unknown;
}

export interface StocksWatcherRemovalState {
  favorites: string[];
  hiddenSymbols: string[];
  selectedSymbol: string;
  defaultSymbols: string[];
}

export interface StocksWatcherVisibleSymbolsOptions {
  favorites: string[];
  hiddenSymbols: string[];
  selectedSymbol: string;
  defaultSymbols: string[];
  limit?: number;
  query?: string;
  sector?: string;
  type?: string;
  universe?: readonly StocksWatcherUniverseStock[];
  includeSelected?: boolean;
  includeDefaultSymbols?: boolean;
  restrictToDefaultSymbols?: boolean;
}

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const getNearestSpotStrike = (rows: StocksWatcherStrikeRow[], spot: number) => {
  if (rows.length === 0 || !Number.isFinite(spot)) return null;

  return rows.reduce((nearest, row) => {
    const currentDistance = Math.abs(row.strike - spot);
    const nearestDistance = Math.abs(nearest.strike - spot);
    if (currentDistance < nearestDistance) return row;
    if (currentDistance === nearestDistance && row.strike > nearest.strike) return row;
    return nearest;
  });
};

export const getGammaFlipLevel = (rows: StocksWatcherStrikeRow[], spot: number) => {
  if (rows.length < 2 || !Number.isFinite(spot)) return null;
  const sortedRows = [...rows]
    .filter((row) => Number.isFinite(row.strike) && Number.isFinite(row.netGex))
    .sort((a, b) => a.strike - b.strike);
  const candidates: number[] = [];

  for (let index = 1; index < sortedRows.length; index += 1) {
    const previous = sortedRows[index - 1];
    const current = sortedRows[index];
    if (!previous || !current) continue;
    if (previous.netGex === 0) {
      candidates.push(previous.strike);
      continue;
    }
    if (current.netGex === 0) {
      candidates.push(current.strike);
      continue;
    }
    if (Math.sign(previous.netGex) === Math.sign(current.netGex)) continue;

    const denominator = Math.abs(previous.netGex) + Math.abs(current.netGex);
    const weight = denominator > 0 ? Math.abs(previous.netGex) / denominator : 0.5;
    candidates.push(round(previous.strike + (current.strike - previous.strike) * weight));
  }

  if (candidates.length === 0) return null;
  return candidates.reduce((nearest, candidate) =>
    Math.abs(candidate - spot) < Math.abs(nearest - spot) ? candidate : nearest,
  );
};

const normalizeSymbol = (symbol: string) => symbol.trim().toUpperCase();
const SEARCH_SYMBOL_PATTERN = /^[A-Z0-9.^-]{1,12}$/;

const uniqueSymbols = (symbols: string[]) =>
  Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));

export const resolveStocksWatcherSearchSymbol = (
  query: string,
  universe: StocksWatcherUniverseStock[] = STOCKS_WATCHER_UNIVERSE,
) => {
  const rawQuery = query.trim();
  if (!rawQuery) return null;

  const searchUniverse = [...universe, ...STOCKS_WATCHER_UNIVERSE];
  const normalizedQuery = normalizeStocksWatcherSymbol(rawQuery, "");
  const bySymbol = new Map(searchUniverse.map((stock) => [normalizeSymbol(stock.symbol), stock.symbol]));
  const exactSymbol = bySymbol.get(normalizedQuery);
  if (exactSymbol) return exactSymbol;

  const companyNeedle = rawQuery.toLowerCase();
  const companyMatch = searchUniverse.find((stock) => stock.companyName.toLowerCase().includes(companyNeedle));
  if (companyMatch) return normalizeSymbol(companyMatch.symbol);

  const tickerCandidate = rawQuery.toUpperCase();
  if (SEARCH_SYMBOL_PATTERN.test(tickerCandidate)) return normalizeStocksWatcherSymbol(tickerCandidate, "");

  return null;
};

export const getStocksWatcherVisibleSymbols = (options: StocksWatcherVisibleSymbolsOptions) => {
  const hidden = new Set(options.hiddenSymbols.map(normalizeSymbol));
  const universe = options.universe || STOCKS_WATCHER_UNIVERSE;
  const bySymbol = new Map(universe.map((stock) => [normalizeSymbol(stock.symbol), stock]));
  const allowed = new Set(options.defaultSymbols.map(normalizeSymbol));
  const restrictToDefaultSymbols = options.restrictToDefaultSymbols ?? true;
  const defaultSymbols = options.includeDefaultSymbols === false ? [] : options.defaultSymbols;
  const baseSymbols = options.includeSelected === false
    ? uniqueSymbols([...options.favorites, ...defaultSymbols])
    : uniqueSymbols([...options.favorites, options.selectedSymbol, ...defaultSymbols]);
  const query = (options.query || "").trim().toLowerCase();
  const sector = options.sector || "All Sectors";
  const type = options.type || "All Types";

  return baseSymbols
    .filter((symbol) => (!restrictToDefaultSymbols || allowed.has(symbol)) && !hidden.has(symbol))
    .filter((symbol) => {
      const stock = bySymbol.get(symbol);
      if (!stock) return !query && sector === "All Sectors" && type === "All Types";
      const matchesQuery = !query || stock.symbol.toLowerCase().includes(query) || stock.companyName.toLowerCase().includes(query);
      const matchesSector = sector === "All Sectors" || stock.sector === sector;
      const matchesType = type === "All Types" || stock.type === type;
      return matchesQuery && matchesSector && matchesType;
    })
    .slice(0, options.limit ?? 50);
};

export const applyStocksWatcherSymbolRemoval = (
  state: StocksWatcherRemovalState,
  symbolToRemove: string,
) => {
  const removed = normalizeSymbol(symbolToRemove);
  const defaultSet = new Set(state.defaultSymbols.map(normalizeSymbol));
  const favorites = uniqueSymbols(state.favorites).filter((symbol) => symbol !== removed);
  const hiddenSymbols = uniqueSymbols(defaultSet.has(removed) ? [...state.hiddenSymbols, removed] : state.hiddenSymbols);
  const visible = getStocksWatcherVisibleSymbols({
    favorites,
    hiddenSymbols,
    selectedSymbol: state.selectedSymbol === removed ? "" : state.selectedSymbol,
    defaultSymbols: state.defaultSymbols,
  });

  return {
    favorites,
    hiddenSymbols,
    nextSelectedSymbol: normalizeSymbol(state.selectedSymbol) === removed ? visible[0] || DEFAULT_WATCHLIST[0] : normalizeSymbol(state.selectedSymbol),
  };
};

export const getFreshStocksWatcherCacheEntry = (
  cache: Map<string, StocksWatcherSnapshotCacheEntry>,
  symbol: string,
  now = Date.now(),
  ttlMs = STOCKS_WATCHER_CACHE_TTL_MS,
) => {
  const entry = cache.get(normalizeSymbol(symbol));
  if (!entry) return null;
  return now - entry.fetchedAt <= ttlMs ? entry : null;
};

export const refreshStocksWatcherSymbolsBatch = async <T>(
  symbols: string[],
  refreshSymbol: (symbol: string) => Promise<T>,
  options: { concurrency?: number } = {},
): Promise<StocksWatcherRefreshBatchResult<T>[]> => {
  const queue = uniqueSymbols(symbols);
  const concurrency = Math.max(1, Math.min(options.concurrency || 4, queue.length || 1));
  const results: StocksWatcherRefreshBatchResult<T>[] = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < queue.length) {
      const symbol = queue[cursor];
      cursor += 1;
      if (!symbol) continue;
      try {
        const value = await refreshSymbol(symbol);
        results.push({ symbol, status: "fulfilled", value });
      } catch (reason) {
        results.push({ symbol, status: "rejected", reason });
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
};

const parseTableCells = (line: string) =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.replace(/\*\*/g, "").trim());

const parseNumber = (value: string) => {
  const clean = value.replace(/[$,%]/g, "").replace(/,/g, "").trim();
  const match = clean.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const base = Number(match[0]);
  const suffix = clean.match(/([KMB])$/i)?.[1]?.toUpperCase();
  const multiplier = suffix === "B" ? 1_000_000_000 : suffix === "M" ? 1_000_000 : suffix === "K" ? 1_000 : 1;
  return base * multiplier;
};

const parseDateLike = (value: string) => {
  const match = value.match(/\b(\d{2,4}[-/]\d{1,2}[-/]\d{1,2})(?:[ T](\d{1,2}:\d{2})(?::\d{2})?)?\b/);
  if (!match) return null;
  const [first, second, third] = match[1].split(/[-/]/);
  const date = first.length === 2
    ? `20${first}-${second.padStart(2, "0")}-${third.padStart(2, "0")}`
    : `${first}-${second.padStart(2, "0")}-${third.padStart(2, "0")}`;
  return match[2] ? `${date} ${match[2]}` : date;
};

const parseQuoteText = (symbol: string, text: string): Partial<StocksWatcherQuote> => {
  const row = text.split("\n").find((line) => line.toUpperCase().includes(`| ${symbol.toUpperCase()} `) || line.toUpperCase().includes(`|${symbol.toUpperCase()}|`));
  const priceMatch = text.match(/\$?\b(\d{1,5}(?:,\d{3})*(?:\.\d+)?)\b/);

  if (!row) {
    return {
      price: priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : undefined,
    };
  }

  const cells = parseTableCells(row);
  const numbers = cells.map(parseNumber).filter((value): value is number => value !== null);
  const priceCellIndex = cells.findIndex((cell) => cell.includes("$"));
  const price = priceCellIndex >= 0 ? parseNumber(cells[priceCellIndex]) ?? undefined : numbers[0];
  const change = priceCellIndex >= 0 ? parseNumber(cells[priceCellIndex + 1] || "") ?? undefined : numbers[1];
  const percentCell = cells.find((cell) => cell.includes("%"));

  return {
    symbol,
    companyName: cells[1] && !cells[1].includes("$") ? cells[1] : cells.find((cell) => /inc|corp|ltd|nvidia|unitedhealth|neos|rex|wisdomtree/i.test(cell)) || symbol,
    price,
    change,
    changePercent: percentCell ? parseNumber(percentCell) ?? undefined : numbers[2],
  };
};

const extractAvailableExpiries = (text: string) => {
  const explicit = text.match(/\*\*Available expiries:\*\*\s*([^\n]+)/i)?.[1];
  if (explicit) {
    return explicit.split(/\s*,\s*/).map((item) => parseDateLike(item) || item.trim()).filter(Boolean);
  }

  return Array.from(new Set(text.split("\n").map(parseDateLike).filter((date): date is string => Boolean(date)))).slice(0, 24);
};

const parseOptionRows = (text: string): StocksWatcherExpiryRow[] => {
  const rows: StocksWatcherExpiryRow[] = [];
  let headers: string[] = [];

  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = parseTableCells(line);
    if (cells.some(cell => /^exp(iry)?$/i.test(cell)) && cells.some(cell => /^str(ike)?$/i.test(cell))) { headers = cells.map(cell => cell.toLowerCase().replace(/^exp$/, "expiry").replace(/^str$/, "strike")); continue; }
    const cell = (name: string) => cells[headers.indexOf(name)] || "";
    const expiry = parseDateLike(cell("expiry"));
    const typeCell = cell("type");
    if (!/^(call|put|c|p)$/i.test(typeCell)) continue;
    const type = /put|\bp\b/i.test(typeCell || "") ? "P" : "C";
    const strike = parseNumber(cell("strike"));
    if (!expiry || strike === null || strike <= 0) continue;

    rows.push({
      expiry,
      openInterest: parseNumber(cell("oi")),
      primaryStrike: strike,
      strike,
      volume: parseNumber(cell("volume")),
      dominantType: type,
      type,
    });
  }

  return rows.slice(0, 24);
};

const parseHistory = (text: string): StocksWatcherHistoryPoint[] => {
  const points: StocksWatcherHistoryPoint[] = [];
  let headerCells: string[] = [];

  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = parseTableCells(line);
    if (cells.some((cell) => /date|time/i.test(cell)) && cells.some((cell) => /close|price|last/i.test(cell))) {
      headerCells = cells.map((cell) => cell.toLowerCase());
      continue;
    }
    if (cells.every((cell) => /^-+$/.test(cell.replace(/:/g, "").trim()))) continue;
    const date = cells.map(parseDateLike).find(Boolean);
    if (!date) continue;
    const closeIndex = headerCells.findIndex((cell) => /close|price|last/.test(cell));
    const close = closeIndex >= 0 ? parseNumber(cells[closeIndex] || "") : null;
    const numbers = cells.map(parseNumber).filter((value): value is number => value !== null);
    const price = close ?? numbers[numbers.length - 1];
    if (typeof price !== "number" || !Number.isFinite(price)) continue;
    points.push({ date, label: date.slice(5), price });
  }

  return points.slice(-40);
};

const observedStrikeRows = (raw: unknown): StocksWatcherStrikeRow[] => {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  const rows = Array.isArray(record?.exposures) ? record.exposures : [];
  const fields = ["strike", "callOpenInterest", "putOpenInterest", "callVolume", "putVolume", "callGex", "putGex", "netGex"] as const;
  return rows.flatMap(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    if (fields.some(field => typeof row[field] !== "number" || !Number.isFinite(row[field])) || (row.strike as number) <= 0
      || ["callOpenInterest", "putOpenInterest", "callVolume", "putVolume"].some(field => (row[field] as number) < 0)) return [];
    return [Object.fromEntries(fields.map(field => [field, row[field]])) as unknown as StocksWatcherStrikeRow];
  }).sort((a, b) => a.strike - b.strike).slice(0, 60);
};

const historyFromRawResult = (raw: unknown): StocksWatcherHistoryPoint[] => {
  const rawRecord = recordFromUnknown(raw);
  const history = Array.isArray(rawRecord?.history) ? rawRecord.history : [];
  return history
    .map(recordFromUnknown)
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .map((row): StocksWatcherHistoryPoint | null => {
      const date = typeof row.date === "string" ? row.date : "";
      const close = numberFromUnknown(row.close);
      return date && typeof close === "number"
        ? { date, label: date.includes("T") ? date.slice(11, 16) : date.slice(5), price: close }
        : null;
    })
    .filter((row): row is StocksWatcherHistoryPoint => Boolean(row))
    .slice(-40);
};

const buildExpirySummaryRows = (
  availableExpiries: string[],
  optionRows: StocksWatcherExpiryRow[],
): StocksWatcherExpiryRow[] => {
  const byExpiry = new Map<string, StocksWatcherExpiryRow[]>();
  for (const row of optionRows) {
    const normalized = parseDateLike(row.expiry) || row.expiry;
    byExpiry.set(normalized, [...(byExpiry.get(normalized) || []), { ...row, expiry: normalized }]);
  }

  const sourceExpiries = availableExpiries.length > 0 ? availableExpiries : Array.from(byExpiry.keys());
  const summaries = sourceExpiries.map((expiry): StocksWatcherExpiryRow | null => {
    const normalized = parseDateLike(expiry) || expiry;
    const rows = byExpiry.get(normalized) || [];
    // An expiry advertised by a tool without any option rows is unavailable;
    // never manufacture an OI/volume/strike row for it.
    if (rows.length === 0) return null;

    const callInterest = completeTotal(rows.filter(row => row.type === "C").map(row => row.openInterest));
    const putInterest = completeTotal(rows.filter(row => row.type === "P").map(row => row.openInterest));
    const dominant = callInterest !== null && putInterest !== null ? callInterest >= putInterest ? "C" : "P" : null;
    const score = (row: StocksWatcherExpiryRow) => (row.openInterest ?? -1) + (row.volume ?? -1);
    const primary = rows.reduce((best, row) => score(row) > score(best) ? row : best);

    return {
      expiry: normalized,
      openInterest: completeTotal(rows.map(row => row.openInterest)),
      primaryStrike: primary.primaryStrike || primary.strike,
      strike: primary.primaryStrike || primary.strike,
      volume: completeTotal(rows.map(row => row.volume)),
      dominantType: dominant,
      type: dominant,
    };
  });

  return summaries.filter((row): row is StocksWatcherExpiryRow => Boolean(row)).slice(0, 32);
};

const summariseTool = (name: string, text: string) => {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 220)}...` : compact || `${name} returned an empty response.`;
};

const callToolWithVariants = async (
  client: StocksWatcherToolClient,
  name: string,
  variants: Record<string, unknown>[],
  toolRuns: StocksWatcherToolRun[],
) => {
  let lastError = "";

  for (const args of variants) {
    try {
      const text = await client.callToolText(name, args);
      toolRuns.push({ name, status: "ok", detail: Object.keys(args).join(", ") || "no args" });
      return text;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  toolRuns.push({ name, status: "failed", detail: lastError || "No argument variant succeeded." });
  return "";
};

const callToolStructuredWithVariants = async (
  client: StocksWatcherToolClient,
  name: string,
  variants: Record<string, unknown>[],
  toolRuns: StocksWatcherToolRun[],
) => {
  if (!client.callTool) {
    const text = await callToolWithVariants(client, name, variants, toolRuns);
    return { text, raw: null };
  }

  let lastError = "";
  for (const args of variants) {
    try {
      const result = await client.callTool(name, args);
      toolRuns.push({ name, status: "ok", detail: Object.keys(args).join(", ") || "no args" });
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  toolRuns.push({ name, status: "failed", detail: lastError || "No argument variant succeeded." });
  return { text: "", raw: null };
};

const recordFromUnknown = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const numberFromUnknown = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const getStocksWatcherRowQuotesFromRawResult = (raw: unknown, fetchedAt = Date.now()): StocksWatcherRowQuote[] => {
  const rawRecord = recordFromUnknown(raw);
  const quotes = Array.isArray(rawRecord?.quotes) ? rawRecord.quotes : [];
  return quotes
    .map(recordFromUnknown)
    .filter((quote): quote is Record<string, unknown> => Boolean(quote))
    .map((quote) => {
      const symbol = typeof quote.symbol === "string" ? normalizeStocksWatcherSymbol(quote.symbol) : "";
      const price = numberFromUnknown(quote.price);
      if (!symbol || typeof price !== "number") return null;
      const change = numberFromUnknown(quote.change);
      const changePercent = numberFromUnknown(quote.changePercent);
      const rowQuote: StocksWatcherRowQuote = {
        symbol,
        price,
        previousClose: numberFromUnknown(quote.previousClose) ?? null,
        change: change ?? null,
        changePercent: changePercent ?? null,
        changeAvailable: quote.changeAvailable !== false && change !== undefined && changePercent !== undefined,
        marketState: typeof quote.marketState === "string" ? quote.marketState : null,
        asOf: typeof quote.asOf === "string" ? quote.asOf : null,
        fetchedAt,
        source: "yahoo_quote" as const,
      };
      if (typeof quote.name === "string") rowQuote.companyName = quote.name;
      return rowQuote;
    })
    .filter((quote): quote is StocksWatcherRowQuote => Boolean(quote));
};

export const mergeStocksWatcherRowQuoteMap = (
  current: Record<string, StocksWatcherRowQuote>,
  quotes: StocksWatcherRowQuote[],
) => {
  const next = { ...current };
  for (const quote of quotes) {
    next[quote.symbol] = quote;
  }
  return next;
};

const quoteFromRawResult = (symbol: string, raw: unknown): Partial<StocksWatcherQuote> => {
  const rawRecord = recordFromUnknown(raw);
  const quotes = Array.isArray(rawRecord?.quotes) ? rawRecord.quotes : [];
  const quote = quotes
    .map(recordFromUnknown)
    .find((row) => String(row?.symbol || "").toUpperCase() === symbol.toUpperCase()) || null;
  if (!quote) return {};

  return {
    symbol,
    companyName: typeof quote.name === "string" ? quote.name : undefined,
    price: numberFromUnknown(quote.price),
    open: numberFromUnknown(quote.open) ?? null,
    high: numberFromUnknown(quote.high) ?? null,
    low: numberFromUnknown(quote.low) ?? null,
    previousClose: numberFromUnknown(quote.previousClose) ?? null,
    change: numberFromUnknown(quote.change),
    changePercent: numberFromUnknown(quote.changePercent),
    marketState: typeof quote.marketState === "string" ? quote.marketState : undefined,
    asOf: typeof quote.asOf === "string" ? quote.asOf : undefined,
  };
};

const emptyEarningsSnapshot = (source = "Yahoo earnings data unavailable"): StocksWatcherEarningsSnapshot => ({
  source,
  nextEarningsDate: null,
  nextEpsEstimate: null,
  nextRevenueEstimate: null,
  lastEarningsDate: null,
  lastReportedQuarter: null,
  epsActual: null,
  epsEstimate: null,
  epsDifference: null,
  surprisePercent: null,
  result: null,
  priceMove: null,
});

const newsFromRawResult = (raw: unknown): StocksWatcherNewsItem[] => {
  const rawRecord = recordFromUnknown(raw);
  const news = Array.isArray(rawRecord?.news) ? rawRecord.news : [];
  return news
    .map(recordFromUnknown)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      title: typeof item.title === "string" ? item.title.trim() : "",
      publisher: typeof item.publisher === "string" ? item.publisher.trim() : "Yahoo Finance",
      link: typeof item.link === "string" ? item.link.trim() : "",
      publishedAt: typeof item.publishedAt === "string" ? item.publishedAt : null,
    }))
    .filter((item) => item.title)
    .slice(0, 3);
};

const earningsFromRawResult = (raw: unknown): StocksWatcherEarningsSnapshot => {
  const rawRecord = recordFromUnknown(raw);
  const earnings = recordFromUnknown(rawRecord?.earnings);
  if (!earnings) return emptyEarningsSnapshot();
  const priceMove = recordFromUnknown(earnings.priceMove);
  return {
    source: typeof earnings.source === "string" ? earnings.source : "Yahoo quoteSummary calendarEvents + earningsHistory",
    nextEarningsDate: typeof earnings.nextEarningsDate === "string" ? earnings.nextEarningsDate : null,
    nextEpsEstimate: numberFromUnknown(earnings.nextEpsEstimate) ?? null,
    nextRevenueEstimate: typeof earnings.nextRevenueEstimate === "string" ? earnings.nextRevenueEstimate : null,
    lastEarningsDate: typeof earnings.lastEarningsDate === "string" ? earnings.lastEarningsDate : null,
    lastReportedQuarter: typeof earnings.lastReportedQuarter === "string" ? earnings.lastReportedQuarter : null,
    epsActual: numberFromUnknown(earnings.epsActual) ?? null,
    epsEstimate: numberFromUnknown(earnings.epsEstimate) ?? null,
    epsDifference: numberFromUnknown(earnings.epsDifference) ?? null,
    surprisePercent: numberFromUnknown(earnings.surprisePercent) ?? null,
    result: earnings.result === "beat" || earnings.result === "miss" ? earnings.result : null,
    priceMove: priceMove && typeof priceMove.eventTradingDate === "string" && numberFromUnknown(priceMove.previousClose) !== undefined && numberFromUnknown(priceMove.close) !== undefined && numberFromUnknown(priceMove.changePercent) !== undefined
      ? {
        eventTradingDate: typeof priceMove.eventTradingDate === "string" ? priceMove.eventTradingDate : "",
        previousClose: priceMove.previousClose as number,
        close: priceMove.close as number,
        changePercent: priceMove.changePercent as number,
        basis: typeof priceMove.basis === "string" ? priceMove.basis : "close_to_close",
      }
      : null,
  };
};

const rowsFromRawOptionChain = (raw: unknown): {
  expiries: string[];
  selectedExpiry: string | null;
  rows: StocksWatcherExpiryRow[];
} => {
  const rawRecord = recordFromUnknown(raw);
  const chain = recordFromUnknown(rawRecord?.chain);
  if (!chain) return { expiries: [], selectedExpiry: null, rows: [] };

  const selectedExpiry = typeof chain.selectedExpiry === "string" ? parseDateLike(chain.selectedExpiry) || chain.selectedExpiry : null;
  const expiries = Array.isArray(chain.expiries)
    ? chain.expiries.map((item) => typeof item === "string" ? parseDateLike(item) || item : "").filter(Boolean)
    : [];
  const normalizeLeg = (leg: unknown, type: "C" | "P"): StocksWatcherExpiryRow | null => {
    const record = recordFromUnknown(leg);
    if (!record || !selectedExpiry) return null;
    const strike = numberFromUnknown(record.strike);
    if (strike === undefined || strike <= 0) return null;
    return {
      expiry: selectedExpiry,
      openInterest: numberFromUnknown(record.openInterest) ?? null,
      primaryStrike: strike,
      strike,
      volume: numberFromUnknown(record.volume) ?? null,
      dominantType: type,
      type,
    };
  };
  const calls = Array.isArray(chain.calls) ? chain.calls.map((leg) => normalizeLeg(leg, "C")).filter((row): row is StocksWatcherExpiryRow => Boolean(row)) : [];
  const puts = Array.isArray(chain.puts) ? chain.puts.map((leg) => normalizeLeg(leg, "P")).filter((row): row is StocksWatcherExpiryRow => Boolean(row)) : [];

  return { expiries, selectedExpiry, rows: [...calls, ...puts] };
};

export const buildStocksWatcherSnapshotFromNative = async (
  symbol: string,
  client: StocksWatcherToolClient,
  publishedOptions?: StocksWatcherPublishedOptionsInput,
  options: { surface?: "options" } = {},
): Promise<StocksWatcherSnapshot> => {
  const upperSymbol = normalizeStocksWatcherSymbol(symbol);
  const warnings: string[] = [];
  const toolRuns: StocksWatcherToolRun[] = [];
  let availableTools: StocksWatcherSnapshot["availableTools"] = [];

  try {
    const tools = await client.listTools();
    availableTools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description || "",
      inputKeys: Object.keys(tool.inputSchema?.properties || {}),
    }));
    toolRuns.push({ name: "tools/list", status: "ok", detail: `${tools.length} tools available` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`tools/list failed: ${message}`);
    toolRuns.push({ name: "tools/list", status: "failed", detail: message });
  }

  const quoteResult = await callToolStructuredWithVariants(client, "get_quotes", [
    { tickers: upperSymbol },
  ], toolRuns);
  const partialQuote = {
    ...parseQuoteText(upperSymbol, quoteResult.text),
    ...quoteFromRawResult(upperSymbol, quoteResult.raw),
  };
  const price = partialQuote.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    throw new Error(`Native Yahoo quote missing a finite positive price for ${upperSymbol}.`);
  }

  const quoteChange = typeof partialQuote.change === "number" && Number.isFinite(partialQuote.change)
    ? partialQuote.change
    : null;
  const quoteChangePercent = typeof partialQuote.changePercent === "number" && Number.isFinite(partialQuote.changePercent)
    ? partialQuote.changePercent
    : null;
  if (partialQuote.change === undefined || partialQuote.changePercent === undefined) {
    warnings.push(`Native Yahoo quote change fields unavailable for ${upperSymbol}.`);
  }

  let rawOptions = { expiries: [] as string[], selectedExpiry: null as string | null, rows: [] as StocksWatcherExpiryRow[] };
  let optionsText = "";
  let gexRows: StocksWatcherStrikeRow[] = [];
  let robinhoodView: ReturnType<typeof toRobinhoodOptionsView> | null = null;
  if (publishedOptions?.snapshot) {
    assertRobinhoodSpotCompatible(publishedOptions.snapshot.spot, price);
    robinhoodView = toRobinhoodOptionsView(publishedOptions.snapshot);
    toolRuns.push({ name: "robinhood_options_snapshot", status: "ok", detail: `validated EOD release ${publishedOptions.snapshot.releaseId}` });
  } else {
    if (publishedOptions?.unavailableReason) {
      warnings.push(`Robinhood EOD options unavailable; using Yahoo fallback: ${publishedOptions.unavailableReason}`);
      toolRuns.push({ name: "robinhood_options_snapshot", status: "failed", detail: publishedOptions.unavailableReason });
    }
    const optionsResult = await callToolStructuredWithVariants(client, "get_options", [
      { ticker: upperSymbol, strikesAroundAtm: 25 },
    ], toolRuns);
    rawOptions = rowsFromRawOptionChain(optionsResult.raw);
    gexRows = observedStrikeRows(optionsResult.raw);
    optionsText = optionsResult.text;
    const frontExpiry = rawOptions.expiries.length > 0 ? rawOptions.expiries[0] : extractAvailableExpiries(optionsText)[0];
    if (!gexRows.length && frontExpiry) {
      const result = await callToolStructuredWithVariants(client, "get_options_gex", [{ ticker: upperSymbol, expiry: frontExpiry, topRows: 20 }], toolRuns);
      gexRows = observedStrikeRows(result.raw);
    }
    if (options.surface !== "options") await callToolWithVariants(client, "get_options_0dte", [
      { ticker: upperSymbol },
    ], toolRuns);
  }
  const deferred = { text: "", raw: null };
  const intradayResult = options.surface === "options" ? deferred : await callToolStructuredWithVariants(client, "get_intraday", [
    { ticker: upperSymbol },
  ], toolRuns);
  const historyResult = options.surface === "options" ? deferred : await callToolStructuredWithVariants(client, "get_stock_history", [
    { ticker: upperSymbol },
  ], toolRuns);
  const intradayText = intradayResult.text;
  const historyText = historyResult.text;
  const breadthText = options.surface === "options" ? "" : await callToolWithVariants(client, "market_breadth", [
    {},
    { market: "US" },
  ], toolRuns);
  const relativeStrengthText = options.surface === "options" ? "" : await callToolWithVariants(client, "basket_relative_strength", [
    {},
  ], toolRuns);
  const newsResult = options.surface === "options" ? deferred : await callToolStructuredWithVariants(client, "pre_event_brief", [
    { ticker: upperSymbol, intent: "overview news" },
  ], toolRuns);
  const earningsResult = options.surface === "options" ? deferred : await callToolStructuredWithVariants(client, "earnings_vol_crush", [
    { ticker: upperSymbol },
  ], toolRuns);

  const parsedExpiries = rawOptions.rows.length ? [] : parseOptionRows(optionsText);
  const expiries = robinhoodView?.availableExpiries || (rawOptions.expiries.length > 0 ? rawOptions.expiries : extractAvailableExpiries(optionsText));
  const expiryRows = robinhoodView?.expiryRows || buildExpirySummaryRows(expiries, [...rawOptions.rows, ...parsedExpiries]);
  const strikes = robinhoodView?.strikes || gexRows;
  const rawIntradayHistory = historyFromRawResult(intradayResult.raw);
  const rawDailyHistory = historyFromRawResult(historyResult.raw);
  const parsedIntradayHistory = parseHistory(intradayText);
  const parsedDailyHistory = parseHistory(historyText);
  const history = rawIntradayHistory.length > 0
    ? rawIntradayHistory
    : rawDailyHistory.length > 0
      ? rawDailyHistory
      : parsedIntradayHistory.length > 0
        ? parsedIntradayHistory
        : parsedDailyHistory;
  if (expiryRows.length === 0) warnings.push("Options expiry data unavailable.");
  if (strikes.length === 0) warnings.push("GEX strike data unavailable; no synthetic rows were generated.");
  if (history.length === 0 && options.surface !== "options") warnings.push("Price history unavailable.");
  const callOi = completeTotal(robinhoodView ? strikes.map(row => row.callOpenInterest) : rawOptions.rows.filter(row => row.type === "C").map(row => row.openInterest));
  const putOi = completeTotal(robinhoodView ? strikes.map(row => row.putOpenInterest) : rawOptions.rows.filter(row => row.type === "P").map(row => row.openInterest));
  const callVol = completeTotal(robinhoodView ? strikes.map(row => row.callVolume) : rawOptions.rows.filter(row => row.type === "C").map(row => row.volume));
  const putVol = completeTotal(robinhoodView ? strikes.map(row => row.putVolume) : rawOptions.rows.filter(row => row.type === "P").map(row => row.volume));
  const netGex = strikes.reduce((sum, row) => sum + row.netGex, 0);

  return {
    generatedAt: new Date().toISOString(),
    symbol: upperSymbol,
    quote: {
      symbol: upperSymbol,
      companyName: partialQuote.companyName || upperSymbol,
      price,
      change: quoteChange,
      changePercent: quoteChangePercent,
      open: partialQuote.open ?? null,
      high: partialQuote.high ?? null,
      low: partialQuote.low ?? null,
      previousClose: partialQuote.previousClose ?? null,
      marketState: partialQuote.marketState ?? null,
      asOf: partialQuote.asOf || null,
    },
    spot: price,
    atm: round(price / 2.5) * 2.5,
    selectedTimeLabel: "live",
    gexRegime: strikes.length === 0 ? "Unavailable" : netGex >= 0 ? "Pinning" : "Amplifying",
    putCallOpenInterest: callOi !== null && callOi > 0 && putOi !== null ? round(putOi / callOi, 2) : null,
    putCallVolume: callVol !== null && callVol > 0 && putVol !== null ? round(putVol / callVol, 2) : null,
    sweeps: null,
    // Keep the provider-advertised expiry list, but expose rows only when the
    // provider returned actual option data for that expiry.
    availableExpiries: expiries,
    selectedExpiry: expiryRows.length > 0
      ? robinhoodView?.selectedExpiry || rawOptions.selectedExpiry || expiryRows[0]?.expiry || null
      : null,
    expiryRows,
    expiries: expiryRows,
    strikes,
    history,
    recentNews: newsFromRawResult(newsResult.raw),
    earnings: earningsFromRawResult(earningsResult.raw),
    valuation: null,
    financials: null,
    marketContext: {
      breadth: summariseTool("market_breadth", breadthText),
      relativeStrength: summariseTool("basket_relative_strength", relativeStrengthText),
    },
    availableTools,
    toolRuns,
    warnings,
    ...(publishedOptions?.snapshot ? {
      optionsSnapshot: {
        provider: "robinhood_mcp" as const,
        methodology: "OI-signed GEX proxy" as const,
        runId: publishedOptions.snapshot.runId,
        capturedAt: publishedOptions.snapshot.capturedAt,
        expectedSymbols: publishedOptions.snapshot.manifest.expectedSymbols,
        completedSymbols: publishedOptions.snapshot.manifest.completedSymbols,
      },
    } : {}),
    ...(publishedOptions?.unavailableReason ? { optionsUnavailable: publishedOptions.unavailableReason } : {}),
    source: "native_yahoo",
  };
};
