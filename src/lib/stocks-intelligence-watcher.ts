import { STOCKS_WATCHER_SYMBOLS, normalizeStocksWatcherSymbol } from "./stocks-native-yahoo";
import type { StocksNativeToolResult, StocksNativeToolSummary } from "./stocks-native-yahoo";
import { STOCKS_WATCHER_UNIVERSE } from "./stocks-watcher-universe";
import type { StocksWatcherUniverseStock } from "./stocks-watcher-universe";
import type { MarketCacheMetadata } from "./market-data-cache";
import type { WatcherCoverageStatus, WatcherFinancialQuarter, WatcherValuationBands } from "./stocks-watcher-valuation-data";

export type StocksWatcherChartMode = "oi" | "volume" | "gex";

export interface StocksWatcherQuote {
  symbol: string;
  companyName: string;
  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  change: number;
  changePercent: number;
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
  openInterest: number;
  primaryStrike: number;
  strike: number;
  volume: number;
  dominantType: "C" | "P";
  type: "C" | "P";
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
  putCallOpenInterest: number;
  putCallVolume: number;
  sweeps: number;
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
  source: "native_yahoo" | "demo_fallback";
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
  change: number;
  changePercent: number;
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

const parseOptionRows = (text: string, spot: number): StocksWatcherExpiryRow[] => {
  const rows: StocksWatcherExpiryRow[] = [];

  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = parseTableCells(line);
    const expiry = cells.map(parseDateLike).find(Boolean);
    const typeCell = cells.find((cell) => /\b(call|put|c|p)\b/i.test(cell));
    const type = /put|\bp\b/i.test(typeCell || "") ? "P" : "C";
    const numbers = cells.map(parseNumber).filter((value): value is number => value !== null);
    const strike = numbers.find((value) => value > spot * 0.55 && value < spot * 1.45) || round(spot / 5) * 5;
    const largeNumbers = numbers.filter((value) => value >= 10);

    if (!expiry || largeNumbers.length < 2) continue;

    rows.push({
      expiry,
      openInterest: Math.max(...largeNumbers),
      primaryStrike: strike,
      strike,
      volume: largeNumbers[largeNumbers.length - 1],
      dominantType: type,
      type,
    });
  }

  return rows.slice(0, 24);
};

const parseGexRows = (text: string, spot: number): Partial<StocksWatcherStrikeRow>[] => {
  const rows: Partial<StocksWatcherStrikeRow>[] = [];

  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = parseTableCells(line);
    const numbers = cells.map(parseNumber).filter((value): value is number => value !== null);
    const strike = numbers.find((value) => value > spot * 0.55 && value < spot * 1.45);
    if (!strike || numbers.length < 2) continue;

    const gexNumbers = numbers.filter((value) => value !== strike).filter((value) => Math.abs(value) > 1_000 || Math.abs(value) < 200);
    const callGex = Math.abs(gexNumbers.find((value) => value > 0) || 0);
    const putGex = -Math.abs([...gexNumbers].reverse().find((value) => value < 0) || 0);

    rows.push({
      strike,
      callGex,
      putGex,
      netGex: callGex + putGex,
    });
  }

  return rows.slice(0, 80);
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

const seeded = (symbol: string) =>
  Array.from(symbol.toUpperCase()).reduce((sum, char) => sum + char.charCodeAt(0), 0);

const buildSyntheticStrikes = (symbol: string, spot: number): StocksWatcherStrikeRow[] => {
  const seed = seeded(symbol);
  const step = spot > 800 ? 10 : spot > 150 ? 2.5 : 1;
  const atm = Math.round(spot / step) * step;

  return Array.from({ length: 25 }, (_, index) => {
    const distance = index - 12;
    const strike = round(atm + distance * step, 2);
    const intensity = Math.max(0.12, 1 - Math.abs(distance) / 15);
    const callOpenInterest = Math.round((seed % 9 + 3) * 900 * intensity + Math.max(0, distance) * 280);
    const putOpenInterest = Math.round((seed % 7 + 3) * 760 * intensity + Math.max(0, -distance) * 320);
    const callVolume = Math.round(callOpenInterest * (0.22 + (index % 4) * 0.08));
    const putVolume = Math.round(putOpenInterest * (0.2 + (index % 5) * 0.06));
    const callGex = Math.round(callOpenInterest * intensity * 550);
    const putGex = -Math.round(putOpenInterest * (1 - intensity * 0.35) * 460);

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
  });
};

const buildSyntheticExpiries = (symbol: string, strikes: StocksWatcherStrikeRow[]): StocksWatcherExpiryRow[] => {
  const today = new Date("2026-05-28T20:00:00Z");
  const seed = seeded(symbol);

  return Array.from({ length: 22 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + 1 + index * (index < 6 ? 2 : 14));
    const strikeRow = strikes[(index * 3 + seed) % strikes.length];
    const type = index % 3 === 1 ? "P" : "C";

    return {
      expiry: date.toISOString().slice(0, 10),
      openInterest: type === "C" ? strikeRow.callOpenInterest * (index + 2) : strikeRow.putOpenInterest * (index + 2),
      primaryStrike: strikeRow.strike,
      strike: strikeRow.strike,
      volume: type === "C" ? strikeRow.callVolume : strikeRow.putVolume,
      dominantType: type,
      type,
    };
  });
};

const buildExpirySummaryRows = (
  availableExpiries: string[],
  optionRows: StocksWatcherExpiryRow[],
  fallbackRows: StocksWatcherExpiryRow[],
): StocksWatcherExpiryRow[] => {
  const byExpiry = new Map<string, StocksWatcherExpiryRow[]>();
  for (const row of optionRows) {
    const normalized = parseDateLike(row.expiry) || row.expiry;
    byExpiry.set(normalized, [...(byExpiry.get(normalized) || []), { ...row, expiry: normalized }]);
  }

  const fallbackByExpiry = new Map(fallbackRows.map((row) => [parseDateLike(row.expiry) || row.expiry, row]));
  const sourceExpiries = availableExpiries.length > 0 ? availableExpiries : Array.from(byExpiry.keys());
  const summaries = sourceExpiries.map((expiry) => {
    const normalized = parseDateLike(expiry) || expiry;
    const rows = byExpiry.get(normalized) || [];
    const fallback = fallbackByExpiry.get(normalized) || fallbackRows[0];
    if (rows.length === 0) {
      const fallbackType: "C" | "P" = fallback?.dominantType ?? fallback?.type ?? "C";
      return {
        ...fallback,
        expiry: normalized,
        primaryStrike: fallback?.primaryStrike ?? fallback?.strike ?? 0,
        strike: fallback?.primaryStrike ?? fallback?.strike ?? 0,
        dominantType: fallbackType,
        type: fallbackType,
      };
    }

    const callInterest = rows.filter((row) => row.type === "C").reduce((sum, row) => sum + row.openInterest, 0);
    const putInterest = rows.filter((row) => row.type === "P").reduce((sum, row) => sum + row.openInterest, 0);
    const dominant: "C" | "P" = callInterest >= putInterest ? "C" : "P";
    const primary = rows.reduce((best, row) => (row.openInterest + row.volume) > (best.openInterest + best.volume) ? row : best);

    return {
      expiry: normalized,
      openInterest: rows.reduce((sum, row) => sum + row.openInterest, 0),
      primaryStrike: primary.primaryStrike || primary.strike,
      strike: primary.primaryStrike || primary.strike,
      volume: rows.reduce((sum, row) => sum + row.volume, 0),
      dominantType: dominant,
      type: dominant,
    };
  });

  return summaries.slice(0, 32);
};

const buildSyntheticHistory = (symbol: string, spot: number): StocksWatcherHistoryPoint[] => {
  const seed = seeded(symbol);
  return Array.from({ length: 18 }, (_, index) => {
    const drift = (index - 9) * 0.0025;
    const wave = Math.sin(index * 0.8 + seed) * 0.012;
    return {
      label: `${9 + Math.floor(index / 3)}:${String((index % 3) * 20).padStart(2, "0")}`,
      price: round(spot * (1 + drift + wave), 2),
    };
  });
};

const completeRows = (symbol: string, spot: number, partialRows: Partial<StocksWatcherStrikeRow>[]) => {
  const fallback = buildSyntheticStrikes(symbol, spot);
  const byStrike = new Map(fallback.map((row) => [row.strike, row]));

  for (const row of partialRows) {
    if (typeof row.strike !== "number") continue;
    const fallbackRow = byStrike.get(row.strike) || fallback.reduce((best, item) => Math.abs(item.strike - row.strike!) < Math.abs(best.strike - row.strike!) ? item : best);
    byStrike.set(row.strike, {
      ...fallbackRow,
      ...row,
      callOpenInterest: row.callOpenInterest ?? fallbackRow.callOpenInterest,
      putOpenInterest: row.putOpenInterest ?? fallbackRow.putOpenInterest,
      callVolume: row.callVolume ?? fallbackRow.callVolume,
      putVolume: row.putVolume ?? fallbackRow.putVolume,
      callGex: row.callGex ?? fallbackRow.callGex,
      putGex: row.putGex ?? fallbackRow.putGex,
      netGex: row.netGex ?? (row.callGex ?? fallbackRow.callGex) + (row.putGex ?? fallbackRow.putGex),
    });
  }

  return Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike).slice(0, 60);
};

const summariseTool = (name: string, text: string) => {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 220)}...` : compact || `${name} returned an empty response.`;
};

export const buildDemoStocksWatcherSnapshot = (symbol: string, warning: string): StocksWatcherSnapshot => {
  const upperSymbol = normalizeStocksWatcherSymbol(symbol);
  const universeStock = STOCKS_WATCHER_UNIVERSE.find((stock) => stock.symbol === upperSymbol);
  const demoPrices: Record<string, number> = {
    NVDA: 181.8,
    IREN: 64.05,
    QQQI: 50.42,
    FEPI: 55.18,
    NTSX: 45.76,
    UNH: 297.34,
  };
  const demoChanges: Record<string, number> = {
    NVDA: 2.14,
    IREN: -3.79,
    QQQI: 0.18,
    FEPI: -0.22,
    NTSX: 0.11,
    UNH: 1.37,
  };
  const base = universeStock?.fallbackPrice ?? demoPrices[upperSymbol] ?? 180 + seeded(upperSymbol) % 260;
  const change = universeStock?.fallbackChange ?? demoChanges[upperSymbol] ?? round(((seeded(upperSymbol) % 31) - 15) / 10, 2);
  const strikes = buildSyntheticStrikes(upperSymbol, base);
  const callOi = strikes.reduce((sum, row) => sum + row.callOpenInterest, 0);
  const putOi = strikes.reduce((sum, row) => sum + row.putOpenInterest, 0);
  const callVol = strikes.reduce((sum, row) => sum + row.callVolume, 0);
  const putVol = strikes.reduce((sum, row) => sum + row.putVolume, 0);
  const syntheticExpiries = buildSyntheticExpiries(upperSymbol, strikes);
  const syntheticExpiryRows = buildExpirySummaryRows(
    Array.from(new Set(syntheticExpiries.map((row) => row.expiry))).slice(0, 12),
    syntheticExpiries,
    syntheticExpiries,
  );

  return {
    generatedAt: new Date().toISOString(),
    symbol: upperSymbol,
    quote: {
      symbol: upperSymbol,
      companyName: universeStock?.companyName || `${upperSymbol} demo asset`,
      price: base,
      open: round(base - change * 0.55),
      high: round(base * 1.012),
      low: round(base * 0.986),
      previousClose: round(base - change),
      change,
      changePercent: universeStock?.fallbackChangePercent ?? round((change / base) * 100, 2),
      marketState: null,
      asOf: "05/28, 04:00 PM",
    },
    spot: base,
    atm: round(base / 2.5) * 2.5,
    selectedTimeLabel: "4:50PM",
    gexRegime: "Pinning",
    putCallOpenInterest: round(putOi / Math.max(1, callOi), 2),
    putCallVolume: round(putVol / Math.max(1, callVol), 2),
    sweeps: seeded(upperSymbol) % 4,
    availableExpiries: syntheticExpiryRows.map((row) => row.expiry),
    selectedExpiry: syntheticExpiryRows[0]?.expiry || null,
    expiryRows: syntheticExpiryRows,
    expiries: syntheticExpiryRows,
    strikes,
    history: buildSyntheticHistory(upperSymbol, base),
    recentNews: [],
    earnings: emptyEarningsSnapshot("Demo fallback has no Yahoo earningsHistory."),
    valuation: null,
    financials: null,
    marketContext: {
      breadth: "Demo breadth context. Live mode uses native Yahoo data.",
      relativeStrength: `Demo relative strength for ${upperSymbol} versus ${DEFAULT_WATCHLIST.filter((item) => item !== upperSymbol).join(", ")}.`,
    },
    availableTools: [],
    toolRuns: [{ name: "demo_fallback", status: "ok", detail: warning }],
    warnings: [warning],
    source: "demo_fallback",
  };
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
      const rowQuote: StocksWatcherRowQuote = {
        symbol,
        price,
        previousClose: numberFromUnknown(quote.previousClose) ?? null,
        change: numberFromUnknown(quote.change) ?? 0,
        changePercent: numberFromUnknown(quote.changePercent) ?? 0,
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
    priceMove: priceMove
      ? {
        eventTradingDate: typeof priceMove.eventTradingDate === "string" ? priceMove.eventTradingDate : "",
        previousClose: numberFromUnknown(priceMove.previousClose) ?? 0,
        close: numberFromUnknown(priceMove.close) ?? 0,
        changePercent: numberFromUnknown(priceMove.changePercent) ?? 0,
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
  const normalizeLeg = (leg: unknown, type: "C" | "P") => {
    const record = recordFromUnknown(leg);
    if (!record || !selectedExpiry) return null;
    const strike = typeof record.strike === "number" ? record.strike : 0;
    return {
      expiry: selectedExpiry,
      openInterest: typeof record.openInterest === "number" ? record.openInterest : 0,
      primaryStrike: strike,
      strike,
      volume: typeof record.volume === "number" ? record.volume : 0,
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
  const demoBase = buildDemoStocksWatcherSnapshot(upperSymbol, "Live quote parser fallback.");
  const price = partialQuote.price || demoBase.quote.price;

  const optionsResult = await callToolStructuredWithVariants(client, "get_options", [
    { ticker: upperSymbol, strikesAroundAtm: 25 },
  ], toolRuns);
  const rawOptions = rowsFromRawOptionChain(optionsResult.raw);
  const optionsText = optionsResult.text;
  const expiries = rawOptions.expiries.length > 0 ? rawOptions.expiries : extractAvailableExpiries(optionsText);
  const frontExpiry = expiries[0];
  const gexText = frontExpiry ? await callToolWithVariants(client, "get_options_gex", [
    { ticker: upperSymbol, expiry: frontExpiry, topRows: 20 },
  ], toolRuns) : "";
  const zeroDteText = await callToolWithVariants(client, "get_options_0dte", [
    { ticker: upperSymbol },
  ], toolRuns);
  const intradayResult = await callToolStructuredWithVariants(client, "get_intraday", [
    { ticker: upperSymbol },
  ], toolRuns);
  const historyResult = await callToolStructuredWithVariants(client, "get_stock_history", [
    { ticker: upperSymbol },
  ], toolRuns);
  const intradayText = intradayResult.text;
  const historyText = historyResult.text;
  const breadthText = await callToolWithVariants(client, "market_breadth", [
    {},
    { market: "US" },
  ], toolRuns);
  const relativeStrengthText = await callToolWithVariants(client, "basket_relative_strength", [
    {},
  ], toolRuns);
  const newsResult = await callToolStructuredWithVariants(client, "pre_event_brief", [
    { ticker: upperSymbol, intent: "overview news" },
  ], toolRuns);
  const earningsResult = await callToolStructuredWithVariants(client, "earnings_vol_crush", [
    { ticker: upperSymbol },
  ], toolRuns);

  const parsedExpiries = parseOptionRows(optionsText, price);
  const expiryRows = buildExpirySummaryRows(expiries, [...rawOptions.rows, ...parsedExpiries], demoBase.expiryRows);
  const strikes = completeRows(upperSymbol, price, parseGexRows(`${gexText}\n${zeroDteText}`, price));
  const rawIntradayHistory = historyFromRawResult(intradayResult.raw);
  const rawDailyHistory = historyFromRawResult(historyResult.raw);
  const history = rawIntradayHistory.length > 3
    ? rawIntradayHistory
    : rawDailyHistory.length > 3
      ? rawDailyHistory
    : parseHistory(intradayText).length > 3
      ? parseHistory(intradayText)
      : parseHistory(historyText);
  const callOi = strikes.reduce((sum, row) => sum + row.callOpenInterest, 0);
  const putOi = strikes.reduce((sum, row) => sum + row.putOpenInterest, 0);
  const callVol = strikes.reduce((sum, row) => sum + row.callVolume, 0);
  const putVol = strikes.reduce((sum, row) => sum + row.putVolume, 0);
  const netGex = strikes.reduce((sum, row) => sum + row.netGex, 0);

  return {
    generatedAt: new Date().toISOString(),
    symbol: upperSymbol,
    quote: {
      symbol: upperSymbol,
      companyName: partialQuote.companyName || demoBase.quote.companyName,
      price,
      change: partialQuote.change ?? demoBase.quote.change,
      changePercent: partialQuote.changePercent ?? demoBase.quote.changePercent,
      open: partialQuote.open ?? demoBase.quote.open,
      high: partialQuote.high ?? demoBase.quote.high,
      low: partialQuote.low ?? demoBase.quote.low,
      previousClose: partialQuote.previousClose ?? demoBase.quote.previousClose,
      marketState: partialQuote.marketState ?? demoBase.quote.marketState,
      asOf: partialQuote.asOf || demoBase.quote.asOf,
    },
    spot: price,
    atm: round(price / 2.5) * 2.5,
    selectedTimeLabel: "live",
    gexRegime: netGex >= 0 ? "Pinning" : "Amplifying",
    putCallOpenInterest: round(putOi / Math.max(1, callOi), 2),
    putCallVolume: round(putVol / Math.max(1, callVol), 2),
    sweeps: zeroDteText.match(/\bsweep/i) ? 1 : 0,
    availableExpiries: expiryRows.map((row) => row.expiry),
    selectedExpiry: rawOptions.selectedExpiry || expiryRows[0]?.expiry || frontExpiry || null,
    expiryRows,
    expiries: expiryRows,
    strikes,
    history: history.length > 3 ? history : demoBase.history,
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
    source: "native_yahoo",
  };
};
