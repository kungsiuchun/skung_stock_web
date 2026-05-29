import type { StocksMcpToolSummary } from "./stocks-mcp-sse-client";

export type StocksWatcherChartMode = "oi" | "volume" | "gex";

export interface StocksWatcherQuote {
  symbol: string;
  companyName: string;
  price: number;
  change: number;
  changePercent: number;
  asOf: string | null;
}

export interface StocksWatcherExpiryRow {
  expiry: string;
  openInterest: number;
  strike: number;
  volume: number;
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
  quote: StocksWatcherQuote;
  spot: number;
  atm: number;
  selectedTimeLabel: string;
  gexRegime: string;
  putCallOpenInterest: number;
  putCallVolume: number;
  sweeps: number;
  expiries: StocksWatcherExpiryRow[];
  strikes: StocksWatcherStrikeRow[];
  history: StocksWatcherHistoryPoint[];
  marketContext: {
    breadth: string;
    relativeStrength: string;
  };
  availableTools: { name: string; description: string; inputKeys: string[] }[];
  toolRuns: StocksWatcherToolRun[];
  warnings: string[];
  source: "stocks_intelligence_mcp" | "demo_fallback";
}

export interface StocksWatcherMcpClient {
  listTools: () => Promise<StocksMcpToolSummary[]>;
  callToolText: (name: string, args: Record<string, unknown>) => Promise<string>;
}

const DEFAULT_WATCHLIST = ["TSLA", "MU", "IREN", "NVDA", "AAPL"];
export const STOCKS_WATCHER_CACHE_TTL_MS = 60_000;

export interface StocksWatcherSnapshotCacheEntry {
  snapshot: StocksWatcherSnapshot;
  fetchedAt: number;
}

export interface StocksWatcherRemovalState {
  favorites: string[];
  hiddenSymbols: string[];
  selectedSymbol: string;
  defaultSymbols: string[];
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

const normalizeSymbol = (symbol: string) => symbol.trim().toUpperCase();

const uniqueSymbols = (symbols: string[]) =>
  Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));

export const getStocksWatcherVisibleSymbols = (options: {
  favorites: string[];
  hiddenSymbols: string[];
  selectedSymbol: string;
  defaultSymbols: string[];
  limit?: number;
}) => {
  const hidden = new Set(options.hiddenSymbols.map(normalizeSymbol));
  const merged = uniqueSymbols([...options.favorites, options.selectedSymbol, ...options.defaultSymbols]);
  return merged.filter((symbol) => !hidden.has(symbol)).slice(0, options.limit ?? 8);
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
    nextSelectedSymbol: normalizeSymbol(state.selectedSymbol) === removed ? visible[0] || "TSLA" : normalizeSymbol(state.selectedSymbol),
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
  const match = value.match(/\b(\d{2,4}[-/]\d{1,2}[-/]\d{1,2})\b/);
  if (!match) return null;
  const [first, second, third] = match[1].split(/[-/]/);
  if (first.length === 2) return `20${first}-${second.padStart(2, "0")}-${third.padStart(2, "0")}`;
  return `${first}-${second.padStart(2, "0")}-${third.padStart(2, "0")}`;
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
  const percentCell = cells.find((cell) => cell.includes("%"));

  return {
    symbol,
    companyName: cells.find((cell) => /inc|corp|ltd|tesla|nvidia|apple|micro/i.test(cell)) || symbol,
    price: numbers[0],
    change: numbers[1],
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
      strike,
      volume: largeNumbers[largeNumbers.length - 1],
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

    const gexNumbers = numbers.filter((value) => Math.abs(value) > 1_000 || Math.abs(value) < 200);
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

  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = parseTableCells(line);
    const date = cells.map(parseDateLike).find(Boolean);
    const numbers = cells.map(parseNumber).filter((value): value is number => value !== null);
    if (!date || numbers.length === 0) continue;
    points.push({ label: date.slice(5), price: numbers[numbers.length - 1] });
  }

  return points.slice(-40);
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
      expiry: date.toISOString().slice(2, 10),
      openInterest: type === "C" ? strikeRow.callOpenInterest * (index + 2) : strikeRow.putOpenInterest * (index + 2),
      strike: strikeRow.strike,
      volume: type === "C" ? strikeRow.callVolume : strikeRow.putVolume,
      type,
    };
  });
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
  const upperSymbol = symbol.trim().toUpperCase() || "TSLA";
  const base = upperSymbol === "TSLA" ? 442.1 : upperSymbol === "MU" ? 123.52 : upperSymbol === "IREN" ? 64.05 : 180 + seeded(upperSymbol) % 260;
  const change = upperSymbol === "TSLA" ? 1.74 : upperSymbol === "MU" ? -4.89 : upperSymbol === "IREN" ? -3.79 : round(((seeded(upperSymbol) % 31) - 15) / 10, 2);
  const strikes = buildSyntheticStrikes(upperSymbol, base);
  const callOi = strikes.reduce((sum, row) => sum + row.callOpenInterest, 0);
  const putOi = strikes.reduce((sum, row) => sum + row.putOpenInterest, 0);
  const callVol = strikes.reduce((sum, row) => sum + row.callVolume, 0);
  const putVol = strikes.reduce((sum, row) => sum + row.putVolume, 0);

  return {
    generatedAt: new Date().toISOString(),
    symbol: upperSymbol,
    quote: {
      symbol: upperSymbol,
      companyName: upperSymbol === "TSLA" ? "Tesla, Inc." : `${upperSymbol} demo equity`,
      price: base,
      change,
      changePercent: round((change / base) * 100, 2),
      asOf: "05/28, 04:00 PM",
    },
    spot: base,
    atm: round(base / 2.5) * 2.5,
    selectedTimeLabel: "4:50PM",
    gexRegime: "Pinning",
    putCallOpenInterest: round(putOi / Math.max(1, callOi), 2),
    putCallVolume: round(putVol / Math.max(1, callVol), 2),
    sweeps: seeded(upperSymbol) % 4,
    expiries: buildSyntheticExpiries(upperSymbol, strikes),
    strikes,
    history: buildSyntheticHistory(upperSymbol, base),
    marketContext: {
      breadth: "Demo breadth context. Live mode uses market_breadth when the MCP token is available.",
      relativeStrength: `Demo relative strength for ${upperSymbol} versus ${DEFAULT_WATCHLIST.filter((item) => item !== upperSymbol).join(", ")}.`,
    },
    availableTools: [],
    toolRuns: [{ name: "demo_fallback", status: "ok", detail: warning }],
    warnings: [warning],
    source: "demo_fallback",
  };
};

const callToolWithVariants = async (
  client: StocksWatcherMcpClient,
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

export const buildStocksWatcherSnapshotFromMcp = async (
  symbol: string,
  client: StocksWatcherMcpClient,
): Promise<StocksWatcherSnapshot> => {
  const upperSymbol = symbol.trim().toUpperCase() || "TSLA";
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

  const quoteText = await callToolWithVariants(client, "get_quotes", [
    { tickers: upperSymbol },
  ], toolRuns);
  const partialQuote = parseQuoteText(upperSymbol, quoteText);
  const demoBase = buildDemoStocksWatcherSnapshot(upperSymbol, "Live quote parser fallback.");
  const price = partialQuote.price || demoBase.quote.price;

  const optionsText = await callToolWithVariants(client, "get_options", [
    { ticker: upperSymbol, strikesAroundAtm: 25 },
  ], toolRuns);
  const expiries = extractAvailableExpiries(optionsText);
  const frontExpiry = expiries[0];
  const gexText = frontExpiry ? await callToolWithVariants(client, "get_options_gex", [
    { ticker: upperSymbol, expiry: frontExpiry, topRows: 20 },
  ], toolRuns) : "";
  const zeroDteText = await callToolWithVariants(client, "get_options_0dte", [
    { ticker: upperSymbol },
  ], toolRuns);
  const intradayText = await callToolWithVariants(client, "get_intraday", [
    { ticker: upperSymbol },
  ], toolRuns);
  const historyText = await callToolWithVariants(client, "get_stock_history", [
    { ticker: upperSymbol },
  ], toolRuns);
  const breadthText = await callToolWithVariants(client, "market_breadth", [
    {},
    { market: "US" },
  ], toolRuns);
  const relativeStrengthText = await callToolWithVariants(client, "basket_relative_strength", [
    {},
  ], toolRuns);

  const parsedExpiries = parseOptionRows(optionsText, price);
  const strikes = completeRows(upperSymbol, price, parseGexRows(`${gexText}\n${zeroDteText}`, price));
  const history = parseHistory(intradayText).length > 3 ? parseHistory(intradayText) : parseHistory(historyText);
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
      asOf: partialQuote.asOf || demoBase.quote.asOf,
    },
    spot: price,
    atm: round(price / 2.5) * 2.5,
    selectedTimeLabel: "live",
    gexRegime: netGex >= 0 ? "Pinning" : "Amplifying",
    putCallOpenInterest: round(putOi / Math.max(1, callOi), 2),
    putCallVolume: round(putVol / Math.max(1, callVol), 2),
    sweeps: zeroDteText.match(/\bsweep/i) ? 1 : 0,
    expiries: parsedExpiries.length > 0 ? parsedExpiries : demoBase.expiries,
    strikes,
    history: history.length > 3 ? history : demoBase.history,
    marketContext: {
      breadth: summariseTool("market_breadth", breadthText),
      relativeStrength: summariseTool("basket_relative_strength", relativeStrengthText),
    },
    availableTools,
    toolRuns,
    warnings,
    source: "stocks_intelligence_mcp",
  };
};
