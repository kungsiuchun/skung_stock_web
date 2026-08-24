import type { SpxGexDataClient, SpxGexMarketContext, SpxGexOptionChain } from "./spx-gex-heatmap";
import {
  STOCKS_WATCHER_QUOTE_SYMBOLS,
  STOCKS_WATCHER_SYMBOLS,
  STOCKS_WATCHER_UNIVERSE,
} from "./stocks-watcher-universe";

export { STOCKS_WATCHER_SYMBOLS, STOCKS_WATCHER_UNIVERSE } from "./stocks-watcher-universe";
export type StocksWatcherSupportedSymbol = string;

export interface StocksNativeToolSummary {
  name: string;
  description?: string;
  inputSchema?: {
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface StocksNativeToolResult {
  text: string;
  raw: unknown;
}

interface YahooSession {
  cookie: string;
  crumb: string;
  fetchedAt: number;
}

export interface QuoteRow {
  symbol: string;
  name: string;
  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  change: number;
  changePercent: number;
  volume: number;
  currency: string;
  exchange: string;
  marketState: string;
  asOf: string | null;
  warning?: string;
}

export interface NativeYahooHistoryRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface OptionLeg {
  contractSymbol: string;
  strike: number;
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
}

interface OptionChain {
  symbol: string;
  spot: number;
  expiries: string[];
  selectedExpiry: string | null;
  calls: OptionLeg[];
  puts: OptionLeg[];
  source?: SpxGexOptionChain["source"];
}

const SUPPORTED_SYMBOLS = new Set<string>(STOCKS_WATCHER_SYMBOLS);
const DEFAULT_SYMBOL: StocksWatcherSupportedSymbol = "NVDA";
const YAHOO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const SESSION_TTL_MS = 10 * 60 * 1000;
let yahooSession: YahooSession | null = null;
const YAHOO_SYMBOL_ALIASES: Record<string, string> = {
  SPX: "^SPX",
};
const DISPLAY_SYMBOL_ALIASES: Record<string, string> = {
  "^SPX": "SPX",
};

const round = (value: number, digits = 2) => {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const toNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const toOptionalNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const roundOptional = (value: unknown, digits = 2) => {
  const number = toOptionalNumber(value);
  return number === null ? null : round(number, digits);
};

const roundOptionalInteger = (value: unknown) => {
  const number = toOptionalNumber(value);
  return number === null ? null : Math.round(number);
};

const fmtMoney = (value: number) => `$${value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
const fmtPct = (value: number) => `${value >= 0 ? "+" : ""}${round(value, 2).toFixed(2)}%`;
const fmtSigned = (value: number) => `${value >= 0 ? "+" : ""}${round(value, 2).toFixed(2)}`;

const compact = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${round(value / 1_000_000_000, 2)}B`;
  if (abs >= 1_000_000) return `${round(value / 1_000_000, 2)}M`;
  if (abs >= 1_000) return `${round(value / 1_000, 2)}K`;
  if (abs > 0 && abs < 1) return value < 0 ? ">-1" : "<1";
  return String(round(value, 2));
};

const displayNumber = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? String(value) : "n/a";

const numberOrZero = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const rawNumberFromYahoo = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "raw" in value) {
    const raw = (value as { raw?: unknown }).raw;
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  }
  return null;
};

const fmtFromYahoo = (value: unknown) => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as { fmt?: unknown; raw?: unknown };
    if (typeof record.fmt === "string") return record.fmt;
    if (typeof record.raw === "number") return String(record.raw);
  }
  return null;
};

const dateFromYahoo = (value: unknown) => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (value && typeof value === "object") {
    const record = value as { fmt?: unknown; raw?: unknown };
    if (typeof record.fmt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.fmt)) return record.fmt;
    if (typeof record.raw === "number" && Number.isFinite(record.raw)) return dateFromSeconds(record.raw);
  }
  return null;
};

const sumPresent = (values: Array<number | null | undefined>) => {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : null;
};

const dateFromSeconds = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);
const secondsFromDate = (date: string) => Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);

export const isSupportedStocksWatcherSymbol = (symbol: string) =>
  SUPPORTED_SYMBOLS.has(normalizeStocksWatcherSymbol(symbol));

export const normalizeStocksWatcherSymbol = (value: string | null | undefined, fallback = DEFAULT_SYMBOL) => {
  const symbol = String(value || fallback).trim().toUpperCase().replace(/[^A-Z0-9.^-]/g, "").slice(0, 12);
  return DISPLAY_SYMBOL_ALIASES[symbol] || symbol || fallback;
};

export const resolveStocksWatcherYahooSymbol = (value: string | null | undefined, fallback = DEFAULT_SYMBOL) => {
  const displaySymbol = normalizeStocksWatcherSymbol(value, fallback);
  return {
    displaySymbol,
    yahooSymbol: YAHOO_SYMBOL_ALIASES[displaySymbol] || displaySymbol,
  };
};

const normalizeToolTicker = (params: Record<string, unknown>, fallback = DEFAULT_SYMBOL) =>
  normalizeStocksWatcherSymbol(
    String(params.ticker || params.tickers || params.stock_code || fallback).split(",")[0],
    fallback,
  );

const yahooJson = async <T>(url: string, options: RequestInit = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      "User-Agent": YAHOO_UA,
      Accept: "application/json,text/plain,*/*",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Yahoo request failed ${response.status}: ${text.slice(0, 180)}`);
  }
  return JSON.parse(text) as T;
};

const getYahooSession = async () => {
  const now = Date.now();
  if (yahooSession && now - yahooSession.fetchedAt < SESSION_TTL_MS) return yahooSession;

  const cookieResponse = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": YAHOO_UA },
  });
  const cookie = cookieResponse.headers.get("set-cookie") || "";
  const crumbResponse = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: {
      "User-Agent": YAHOO_UA,
      Cookie: cookie,
    },
  });
  if (!crumbResponse.ok) {
    throw new Error(`Yahoo crumb request failed ${crumbResponse.status}`);
  }

  yahooSession = {
    cookie,
    crumb: (await crumbResponse.text()).trim(),
    fetchedAt: now,
  };
  return yahooSession;
};

const yahooAuthedJson = async <T>(url: string) => {
  const session = await getYahooSession();
  const separator = url.includes("?") ? "&" : "?";
  return yahooJson<T>(`${url}${separator}crumb=${encodeURIComponent(session.crumb)}`, {
    headers: { Cookie: session.cookie },
  });
};

const fetchChart = async (symbol: string, range = "1y", interval = "1d") => {
  const { yahooSymbol } = resolveStocksWatcherYahooSymbol(symbol);
  const encoded = encodeURIComponent(yahooSymbol);
  const data = await yahooJson<Record<string, any>>(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplits`,
  );
  const result = data.chart?.result?.[0];
  if (!result) throw new Error(`No Yahoo chart data for ${normalizeStocksWatcherSymbol(symbol)}`);
  return result as Record<string, any>;
};

export const quoteRowFromYahooChartResult = (symbol: string, chart: Record<string, any>): QuoteRow => {
  const { displaySymbol } = resolveStocksWatcherYahooSymbol(symbol);
  const meta = chart.meta || {};
  const timestamps: number[] = chart.timestamp || [];
  const quote = chart.indicators?.quote?.[0] || {};
  const closes: Array<number | null> = quote.close || [];
  const opens: Array<number | null> = quote.open || [];
  const highs: Array<number | null> = quote.high || [];
  const lows: Array<number | null> = quote.low || [];
  const volumes: Array<number | null> = quote.volume || [];
  let lastIndex = closes.length - 1;
  while (lastIndex > 0 && typeof closes[lastIndex] !== "number") lastIndex -= 1;

  const price = toNumber(meta.regularMarketPrice, toNumber(closes[lastIndex], toNumber(meta.previousClose, 0)));
  const explicitPreviousClose = toOptionalNumber(meta.regularMarketPreviousClose ?? meta.previousClose);
  const explicitChange = toOptionalNumber(meta.regularMarketChange);
  const explicitChangePercent = toOptionalNumber(meta.regularMarketChangePercent);
  const previousCloseFallback = toOptionalNumber(closes[Math.max(0, lastIndex - 1)])
    ?? toOptionalNumber(meta.chartPreviousClose)
    ?? price;
  const previousClose = explicitPreviousClose
    ?? (explicitChange !== null ? price - explicitChange : previousCloseFallback);
  const fallbackChange = price - previousClose;
  const changeConflict = explicitChange !== null && Math.abs(explicitChange - fallbackChange) > Math.max(0.2, Math.abs(price) * 0.01);
  const change = explicitChange ?? fallbackChange;
  const changePercent = explicitChangePercent ?? (previousClose ? (change / previousClose) * 100 : 0);

  return {
    symbol: displaySymbol,
    name: String(meta.longName || meta.shortName || meta.instrumentType || symbol),
    price: round(price, 2),
    open: roundOptional(meta.regularMarketOpen ?? opens[lastIndex]),
    high: roundOptional(meta.regularMarketDayHigh ?? highs[lastIndex]),
    low: roundOptional(meta.regularMarketDayLow ?? lows[lastIndex]),
    previousClose: round(previousClose, 2),
    change: round(change, 2),
    changePercent: round(changePercent, 2),
    volume: toNumber(meta.regularMarketVolume, toNumber(volumes[lastIndex], 0)),
    currency: String(meta.currency || "USD"),
    exchange: String(meta.exchangeName || meta.fullExchangeName || "Yahoo"),
    marketState: String(meta.marketState || "UNKNOWN"),
    asOf: typeof meta.regularMarketTime === "number"
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : typeof timestamps[lastIndex] === "number"
        ? new Date(timestamps[lastIndex] * 1000).toISOString()
        : null,
    ...(changeConflict ? { warning: "Yahoo explicit quote change differs from derived price-minus-previous-close; explicit quote change used." } : {}),
  };
};

const fetchQuote = async (symbol: string): Promise<QuoteRow> => {
  const chart = await fetchChart(symbol, "5d", "1d");
  return quoteRowFromYahooChartResult(symbol, chart);
};

const fetchHistory = async (symbol: string, range = "1y", interval = "1d"): Promise<NativeYahooHistoryRow[]> => {
  const chart = await fetchChart(symbol, range, interval);
  const timestamps: number[] = chart.timestamp || [];
  const quote = chart.indicators?.quote?.[0] || {};
  const opens: Array<number | null> = quote.open || [];
  const highs: Array<number | null> = quote.high || [];
  const lows: Array<number | null> = quote.low || [];
  const closes: Array<number | null> = quote.close || [];
  const volumes: Array<number | null> = quote.volume || [];

  return timestamps
    .map((timestamp, index) => ({
      date: interval.includes("m") ? new Date(timestamp * 1000).toISOString() : dateFromSeconds(timestamp),
      open: round(toNumber(opens[index])),
      high: round(toNumber(highs[index])),
      low: round(toNumber(lows[index])),
      close: round(toNumber(closes[index])),
      volume: Math.round(toNumber(volumes[index])),
    }))
    .filter((row) => row.close > 0);
};

export const fetchNativeYahooHistory = (symbol: string, range = "1y", interval = "1d") =>
  fetchHistory(symbol, range, interval);

const fetchQuoteSummary = async (symbol: string) => {
  const { yahooSymbol } = resolveStocksWatcherYahooSymbol(symbol);
  const modules = [
    "price",
    "summaryDetail",
    "defaultKeyStatistics",
    "financialData",
    "incomeStatementHistory",
    "balanceSheetHistory",
    "cashflowStatementHistory",
    "calendarEvents",
    "earningsHistory",
    "earningsTrend",
    "assetProfile",
  ].join(",");
  const data = await yahooAuthedJson<Record<string, any>>(
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooSymbol)}?modules=${modules}`,
  );
  return data.quoteSummary?.result?.[0] || {};
};

const fetchNews = async (symbol: string, relevanceKeywords: string[] = []) => {
  const { yahooSymbol } = resolveStocksWatcherYahooSymbol(symbol);
  const data = await yahooJson<Record<string, any>>(
    `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(yahooSymbol)}&newsCount=12&quotesCount=1`,
  );
  const keywords = Array.from(new Set([
    normalizeStocksWatcherSymbol(symbol).toLowerCase(),
    yahooSymbol.toLowerCase().replace(/^\^/, ""),
    ...relevanceKeywords.map((keyword) => keyword.toLowerCase()).filter((keyword) => keyword.length >= 3),
  ]));
  const rows: Array<{ title: string; publisher: string; link: string; publishedAt: string | null }> = (data.news || []).map((item: Record<string, any>) => ({
    title: String(item.title || ""),
    publisher: String(item.publisher || "Yahoo Finance"),
    link: String(item.link || ""),
    publishedAt: typeof item.providerPublishTime === "number" ? new Date(item.providerPublishTime * 1000).toISOString() : null,
  }));
  const score = (item: { title: string }) => {
    const title = item.title.toLowerCase();
    return keywords.some((keyword) => title.includes(keyword)) ? 1 : 0;
  };
  return rows.sort((a, b) => score(b) - score(a));
};

const fetchOptions = async (symbol: string, expiry?: string): Promise<OptionChain> => {
  const { displaySymbol, yahooSymbol } = resolveStocksWatcherYahooSymbol(symbol);
  const base = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(yahooSymbol)}`;
  const url = expiry ? `${base}?date=${secondsFromDate(expiry)}` : base;
  const data = await yahooAuthedJson<Record<string, any>>(url);
  const result = data.optionChain?.result?.[0];
  if (!result) throw new Error(`No Yahoo options data for ${displaySymbol}`);
  const expiries = (result.expirationDates || []).map((value: number) => dateFromSeconds(value));
  const selected = result.options?.[0] || {};
  const quote = result.quote || {};

  return {
    symbol: displaySymbol,
    spot: round(toNumber(quote.regularMarketPrice, toNumber(quote.bid, 0))),
    expiries,
    selectedExpiry: typeof selected.expirationDate === "number" ? dateFromSeconds(selected.expirationDate) : expiries[0] || null,
    calls: (selected.calls || []).map(normalizeOptionLeg),
    puts: (selected.puts || []).map(normalizeOptionLeg),
    source: {
      provider: "yahoo",
      label: "Yahoo delayed",
    },
  };
};

const normalizeOptionLeg = (leg: Record<string, any>): OptionLeg => ({
  contractSymbol: String(leg.contractSymbol || ""),
  strike: round(toNumber(leg.strike)),
  lastPrice: roundOptional(leg.lastPrice),
  bid: roundOptional(leg.bid),
  ask: roundOptional(leg.ask),
  volume: roundOptionalInteger(leg.volume),
  openInterest: roundOptionalInteger(leg.openInterest),
  impliedVolatility: toOptionalNumber(leg.impliedVolatility) === null ? null : round(toNumber(leg.impliedVolatility) * 100, 2),
});

const effectiveOpenInterest = (leg: OptionLeg | undefined) => {
  if (!leg) return null;
  return typeof leg.openInterest === "number" && Number.isFinite(leg.openInterest) && leg.openInterest >= 0
    ? leg.openInterest
    : null;
};

const effectiveIv = (leg: OptionLeg | undefined) => {
  if (!leg) return null;
  return typeof leg.impliedVolatility === "number" && Number.isFinite(leg.impliedVolatility) && leg.impliedVolatility > 0
    ? leg.impliedVolatility
    : null;
};

const optionRowsNearSpot = (chain: OptionChain, topRows = 12) => {
  const spot = chain.spot || (chain.calls[0]?.strike ?? chain.puts[0]?.strike ?? 0);
  const strikes = Array.from(new Set([...chain.calls, ...chain.puts].map((leg) => leg.strike)))
    .filter((strike) => strike > 0)
    .sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))
    .slice(0, topRows)
    .sort((a, b) => a - b);

  return strikes.map((strike) => {
    const call = chain.calls.find((leg) => leg.strike === strike);
    const put = chain.puts.find((leg) => leg.strike === strike);
    const callOpenInterest = call?.openInterest ?? null;
    const putOpenInterest = put?.openInterest ?? null;
    const callEffectiveOpenInterest = effectiveOpenInterest(call);
    const putEffectiveOpenInterest = effectiveOpenInterest(put);
    const callIvPercent = effectiveIv(call);
    const putIvPercent = effectiveIv(put);
    const validIvValues = [callIvPercent, putIvPercent].filter((value): value is number => typeof value === "number" && value > 0);
    const callIv = callIvPercent === null ? null : callIvPercent / 100;
    const putIv = putIvPercent === null ? null : putIvPercent / 100;
    const moneyness = spot > 0 ? (spot - strike) / spot : 0;
    const callDelta = Math.max(0.05, Math.min(0.95, 0.5 + moneyness * 5));
    const putDelta = callDelta - 1;
    const callGex = callEffectiveOpenInterest === null || callIv === null ? null : Math.round(callEffectiveOpenInterest * spot * Math.max(0.05, callIv) * 8);
    const putGex = putEffectiveOpenInterest === null || putIv === null ? null : -Math.round(putEffectiveOpenInterest * spot * Math.max(0.05, putIv) * 8);
    const callDex = callEffectiveOpenInterest === null ? null : Math.round(callEffectiveOpenInterest * 100 * callDelta);
    const putDex = putEffectiveOpenInterest === null ? null : Math.round(putEffectiveOpenInterest * 100 * putDelta);
    const netGex = callGex === null || putGex === null ? null : callGex + putGex;
    const netDex = callDex === null || putDex === null ? null : callDex + putDex;
    const openInterestSource = callOpenInterest !== null || putOpenInterest !== null ? "open_interest" : "missing";

    return {
      strike,
      call,
      put,
      callOpenInterest,
      putOpenInterest,
      callVolume: call?.volume ?? null,
      putVolume: put?.volume ?? null,
      callEffectiveOpenInterest,
      putEffectiveOpenInterest,
      openInterestSource,
      callGex,
      putGex,
      netGex,
      callDex,
      putDex,
      netDex,
      callIv: callIvPercent,
      putIv: putIvPercent,
      avgIv: validIvValues.length > 0 ? round(validIvValues.reduce((sum, value) => sum + value, 0) / validIvValues.length, 2) : null,
    };
  });
};

export interface NativeOptionExposureLevelRow {
  strike: number;
  callGex: number | null;
  putGex: number | null;
  netGex: number | null;
}

const strongestBy = (
  rows: NativeOptionExposureLevelRow[],
  valueSelector: (row: NativeOptionExposureLevelRow) => number | null,
  compare: (candidate: number, best: number) => boolean,
) => rows.reduce<NativeOptionExposureLevelRow | null>((best, row) => {
  const candidateValue = valueSelector(row);
  if (typeof candidateValue !== "number" || !Number.isFinite(candidateValue)) return best;
  const bestValue = best ? valueSelector(best) : null;
  if (!best || typeof bestValue !== "number" || compare(candidateValue, bestValue)) return row;
  return best;
}, null);

const gammaFlipFromRows = (rows: NativeOptionExposureLevelRow[], spot: number) => {
  const sortedRows = [...rows]
    .filter((row): row is NativeOptionExposureLevelRow & { netGex: number } =>
      Number.isFinite(row.strike) && typeof row.netGex === "number" && Number.isFinite(row.netGex),
    )
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

export const deriveNativeOptionExposureLevels = <T extends NativeOptionExposureLevelRow>(rows: T[], spot: number) => {
  const pin = rows.reduce<T | null>((best, row) => {
    if (typeof row.netGex !== "number" || !Number.isFinite(row.netGex)) return best;
    if (!best || typeof best.netGex !== "number" || Math.abs(row.netGex) > Math.abs(best.netGex)) return row;
    return best;
  }, null);
  const callWall = strongestBy(rows, (row) => row.callGex, (candidate, best) => candidate > best);
  const putWall = strongestBy(rows, (row) => row.putGex, (candidate, best) => candidate < best);
  const gammaFlip = gammaFlipFromRows(rows, spot);

  return {
    pin,
    callWall,
    putWall,
    gammaFlip,
  };
};

const markdownQuoteTable = (quotes: QuoteRow[]) => [
  "| Ticker | Name | Last | Change | Change % | Volume |",
  "| --- | --- | ---: | ---: | ---: | ---: |",
  ...quotes.map((quote) => `| ${quote.symbol} | ${quote.name} | ${fmtMoney(quote.price)} | ${fmtSigned(quote.change)} | ${fmtPct(quote.changePercent)} | ${compact(quote.volume)} |`),
].join("\n");

const markdownHistory = (rows: NativeYahooHistoryRow[], limit = 60) => [
  "| Date | Open | High | Low | Close | Volume |",
  "| --- | ---: | ---: | ---: | ---: | ---: |",
  ...rows.slice(-limit).map((row) => `| ${row.date} | ${row.open} | ${row.high} | ${row.low} | ${row.close} | ${row.volume} |`),
].join("\n");

const markdownOptionChain = (chain: OptionChain, strikesAroundAtm = 12) => {
  const rows = optionRowsNearSpot(chain, Math.max(5, Math.min(80, strikesAroundAtm * 2 || 24)));
  return [
    `**Available expiries:** ${chain.expiries.join(", ") || "none"}`,
    `**Selected expiry:** ${chain.selectedExpiry || "none"} **Spot:** ${fmtMoney(chain.spot)}`,
    "| Exp | OI | Str | Volume | Type | Bid | Ask | IV |",
    "| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |",
    ...rows.flatMap((row) => {
      const lines: string[] = [];
      if (row.call) lines.push(`| ${chain.selectedExpiry || ""} | ${displayNumber(row.callEffectiveOpenInterest)} | ${row.strike} | ${displayNumber(row.call.volume)} | C | ${displayNumber(row.call.bid)} | ${displayNumber(row.call.ask)} | ${row.callIv === null ? "n/a" : `${row.callIv}%`} |`);
      if (row.put) lines.push(`| ${chain.selectedExpiry || ""} | ${displayNumber(row.putEffectiveOpenInterest)} | ${row.strike} | ${displayNumber(row.put.volume)} | P | ${displayNumber(row.put.bid)} | ${displayNumber(row.put.ask)} | ${row.putIv === null ? "n/a" : `${row.putIv}%`} |`);
      return lines;
    }),
  ].join("\n");
};

const markdownExposure = (chain: OptionChain, greek: "gex" | "dex", topRows = 12) => {
  const rows = optionRowsNearSpot(chain, Math.max(5, Math.min(96, topRows)));
  if (greek === "dex") {
    return [
      `**Snapshot:** ${new Date().toISOString()} **Spot:** ${fmtMoney(chain.spot)}`,
      "| Strike | Call DEX | Put DEX | Net DEX |",
      "| ---: | ---: | ---: | ---: |",
      ...rows.map((row) => `| ${fmtMoney(row.strike)} | ${compact(row.callDex)} | ${compact(row.putDex)} | **${compact(row.netDex)}** |`),
    ].join("\n");
  }
  return [
    `**Snapshot:** ${new Date().toISOString()} **Spot:** ${fmtMoney(chain.spot)}`,
    "| Strike | Call GEX | Put GEX | Net GEX |",
    "| ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${fmtMoney(row.strike)} | ${compact(row.callGex)} | ${compact(row.putGex)} | **${compact(row.netGex)}** |`),
  ].join("\n");
};

const latestQuoteSummaryText = async (ticker: string) => {
  const quote = await fetchQuote(ticker);
  const summary = await fetchQuoteSummary(ticker).catch(() => null);
  const stats = summary?.defaultKeyStatistics || {};
  const financial = summary?.financialData || {};
  const profile = summary?.assetProfile || {};
  const beta = toNumber(stats.beta?.raw, 0);
  const forwardPe = stats.forwardPE?.fmt || "n/a";
  const trailingPe = stats.trailingPE?.fmt || "n/a";
  const target = financial.targetMeanPrice?.fmt || "n/a";

  return {
    text: [
      `# ${ticker} native Yahoo stats`,
      `- Price: ${fmtMoney(quote.price)} (${fmtPct(quote.changePercent)})`,
      `- Exchange: ${quote.exchange}; market state: ${quote.marketState}`,
      `- Forward P/E: ${forwardPe}; trailing P/E: ${trailingPe}; beta: ${beta || "n/a"}`,
      `- Mean target: ${target}; sector: ${profile.sector || "n/a"}; industry: ${profile.industry || "n/a"}`,
    ].join("\n"),
    raw: { quote, summary },
  };
};

const toolResult = (text: string, raw: unknown): StocksNativeToolResult => ({
  text,
  raw: { source: "native_yahoo", ...((raw && typeof raw === "object" && !Array.isArray(raw)) ? raw as Record<string, unknown> : { value: raw }) },
});

const htmlChart = (ticker: string, rows: NativeYahooHistoryRow[]) => {
  const points = rows.slice(-90);
  const labels = points.map((row) => row.date);
  const values = points.map((row) => row.close);
  return `<!doctype html><html><body style="margin:0;background:#020617;color:#e2e8f0;font-family:Inter,system-ui,sans-serif"><canvas id="c" width="900" height="360"></canvas><script src="https://cdn.jsdelivr.net/npm/chart.js"></script><script>const labels=${JSON.stringify(labels)};const values=${JSON.stringify(values)};new Chart(document.getElementById('c'),{type:'line',data:{labels,datasets:[{label:${JSON.stringify(ticker)},data:values,borderColor:'#60a5fa',backgroundColor:'rgba(96,165,250,.15)',fill:true,tension:.25}]},options:{responsive:true,plugins:{legend:{labels:{color:'#e2e8f0'}}},scales:{x:{ticks:{color:'#94a3b8'},grid:{color:'rgba(148,163,184,.15)'}},y:{ticks:{color:'#94a3b8'},grid:{color:'rgba(148,163,184,.15)'}}}}});</script></body></html>`;
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);

const htmlExposureChart = (ticker: string, rows: ReturnType<typeof optionRowsNearSpot>, metric: "dex" | "greeks") => {
  const labels = rows.map((row) => String(row.strike));
  const values = rows.map((row) => metric === "dex" ? row.netDex : row.avgIv);
  const title = metric === "dex" ? `${ticker} Net DEX by strike` : `${ticker} IV / Greeks by strike`;
  const color = metric === "dex" ? "#38bdf8" : "#a78bfa";
  return `<!doctype html><html><body style="margin:0;background:#020617;color:#e2e8f0;font-family:Inter,system-ui,sans-serif"><div style="position:relative;height:360px;padding:14px"><h3 style="margin:0 0 10px;font-size:14px">${escapeHtml(title)}</h3><canvas id="c"></canvas></div><script src="https://cdn.jsdelivr.net/npm/chart.js"></script><script>const labels=${JSON.stringify(labels)};const values=${JSON.stringify(values)};new Chart(document.getElementById('c'),{type:'bar',data:{labels,datasets:[{label:${JSON.stringify(metric === "dex" ? "Net DEX" : "Avg IV %")},data:values,backgroundColor:${JSON.stringify(color)},borderColor:${JSON.stringify(color)},borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#e2e8f0'}}},scales:{x:{ticks:{color:'#94a3b8'},grid:{color:'rgba(148,163,184,.12)'}},y:{ticks:{color:'#94a3b8'},grid:{color:'rgba(148,163,184,.14)'}}}}});</script></body></html>`;
};

const fetchUniverseQuotes = () => Promise.all(STOCKS_WATCHER_QUOTE_SYMBOLS.map((symbol) => fetchQuote(symbol)));

const quoteBySymbolMap = () => new Map(STOCKS_WATCHER_UNIVERSE.map((stock) => [stock.symbol, stock]));

const sectorForQuote = (quote: QuoteRow) => quoteBySymbolMap().get(quote.symbol)?.sector || "Other";

interface NativeToolContext {
  params: Record<string, unknown>;
  ticker: string;
  expiry?: string;
  topRows: number;
}

interface NativeToolDefinition extends StocksNativeToolSummary {
  handler: (context: NativeToolContext) => Promise<StocksNativeToolResult>;
}

const tool = (
  summary: StocksNativeToolSummary,
  handler: NativeToolDefinition["handler"],
): NativeToolDefinition => ({ ...summary, handler });

const canonicalNativeToolName = (name: string) =>
  name === "chart_indicators"
    ? "chart_indicator"
    : name === "pre_event_briefing"
      ? "pre_event_brief"
      : name;

const nativeToolContext = (params: Record<string, unknown>): NativeToolContext => ({
  params,
  ticker: normalizeToolTicker(params),
  expiry: typeof params.expiry === "string" ? params.expiry : undefined,
  topRows: typeof params.topRows === "number" ? params.topRows : 12,
});

const NATIVE_TOOL_REGISTRY: NativeToolDefinition[] = [
  tool(
    { name: "get_watchlist", description: "Return the curated top-50 stock watcher universe.", inputSchema: { properties: {} } },
    async () => {
      const text = JSON.stringify({ symbols: STOCKS_WATCHER_SYMBOLS, stocks: STOCKS_WATCHER_UNIVERSE }, null, 2);
      return toolResult(text, { symbols: STOCKS_WATCHER_SYMBOLS, stocks: STOCKS_WATCHER_UNIVERSE });
    },
  ),
  tool(
    { name: "list_memories", description: "Repo-native replacement: returns the approved symbol set; no server-side memory storage.", inputSchema: { properties: {} } },
    async () => {
      const text = [
        "# Native memory status",
        "- Server-side memories: unsupported in this repo-native backend.",
        "- Browser-local state: favorites and hidden symbols stay in React localStorage.",
        "- Approved symbols remain available through get_watchlist, not list_memories.",
      ].join("\n");
      return toolResult(text, { memories: [], supported: false, storage: "browser_local_storage" });
    },
  ),
  tool(
    { name: "save_memory", description: "Repo-native replacement: server-side memory is unsupported; UI state remains local.", inputSchema: { properties: { key: { type: "string" }, value: { type: "string" } } } },
    async ({ params }) => toolResult("Server-side memories are deprecated. The React UI keeps favorites in local browser storage.", { accepted: false, params }),
  ),
  tool(
    { name: "share_html", description: "Repo-native replacement: public hosted sharing is unsupported in the native backend.", inputSchema: { properties: { html: { type: "string" }, title: { type: "string" } } } },
    async () => toolResult("Public share links are disabled in the native backend. Export locally instead.", { accepted: false }),
  ),
  tool(
    { name: "get_quotes", description: "Get delayed native Yahoo quotes for the approved asset universe.", inputSchema: { properties: { tickers: { type: "string" } } } },
    async ({ params }) => {
      const rawTickers = String(params.tickers || "").trim();
      const requested = rawTickers ? rawTickers.split(",").map((item) => normalizeStocksWatcherSymbol(item)).filter(Boolean) : [];
      const symbols = Array.from(new Set(requested.length > 0 ? requested : STOCKS_WATCHER_QUOTE_SYMBOLS));
      const quotes = await Promise.all(symbols.map((symbol) => fetchQuote(symbol)));
      return toolResult(markdownQuoteTable(quotes), { quotes });
    },
  ),
  tool(
    {
      name: "get_stock_history",
      description: "Get OHLCV history from Yahoo chart API.",
      inputSchema: {
        properties: {
          ticker: { type: "string" },
          range: { type: "string" },
          interval: { type: "string" },
        },
        required: ["ticker"],
      },
    },
    async ({ ticker, params }) => {
      const requestedRange = typeof params.range === "string" ? params.range.trim() : "5y";
      const requestedInterval = typeof params.interval === "string" ? params.interval.trim() : "1d";
      const range = /^(\d+(d|mo|y)|ytd|max)$/.test(requestedRange) ? requestedRange : "5y";
      const interval = /^(1d|1wk|1mo)$/.test(requestedInterval) ? requestedInterval : "1d";
      const history = (await fetchHistory(ticker, range, interval)).slice(-120);
      return toolResult(markdownHistory(history, 120), { ticker, range, interval, history });
    },
  ),
  tool(
    { name: "get_intraday", description: "Get 5-day 5-minute OHLCV data from Yahoo chart API.", inputSchema: { properties: { ticker: { type: "string" } }, required: ["ticker"] } },
    async ({ ticker }) => {
      const history = await fetchHistory(ticker, "5d", "5m");
      return toolResult(markdownHistory(history, 120), { ticker, history });
    },
  ),
  tool(
    { name: "get_stock_stats", description: "Get quote, valuation, financial, and profile stats.", inputSchema: { properties: { ticker: { type: "string" } }, required: ["ticker"] } },
    async ({ ticker }) => {
      const result = await latestQuoteSummaryText(ticker);
      return toolResult(result.text, result.raw);
    },
  ),
  tool(
    { name: "get_beta", description: "Get beta from Yahoo quoteSummary.", inputSchema: { properties: { ticker: { type: "string" } }, required: ["ticker"] } },
    async ({ ticker }) => {
      const result = await latestQuoteSummaryText(ticker);
      const quote = (result.raw as { quote?: QuoteRow }).quote;
      const summary = (result.raw as { summary?: Record<string, any> }).summary;
      const beta = toNumber(summary?.defaultKeyStatistics?.beta?.raw, 0);
      const text = [
        `# ${ticker} beta`,
        `- Beta: ${beta || "n/a"}`,
        `- Last price: ${quote ? fmtMoney(quote.price) : "n/a"}`,
        "- Source: Yahoo quoteSummary.defaultKeyStatistics.beta",
      ].join("\n");
      return toolResult(text, { ticker, beta: beta || null, quote });
    },
  ),
  tool(
    { name: "get_options", description: "Get option chain with calls and puts around spot.", inputSchema: { properties: { ticker: { type: "string" }, expiry: { type: "string" }, strikesAroundAtm: { type: "integer" } }, required: ["ticker"] } },
    async ({ ticker, expiry, params }) => {
      const chain = await fetchOptions(ticker, expiry);
      return toolResult(markdownOptionChain(chain, toNumber(params.strikesAroundAtm, 12)), { chain });
    },
  ),
  tool(
    { name: "get_options_gex", description: "Approximate per-strike gamma exposure from Yahoo option open interest.", inputSchema: { properties: { ticker: { type: "string" }, expiry: { type: "string" }, topRows: { type: "integer" } }, required: ["ticker"] } },
    async ({ ticker, expiry, topRows }) => {
      const chain = await fetchOptions(ticker, expiry);
      return toolResult(markdownExposure(chain, "gex", topRows), { chain, exposures: optionRowsNearSpot(chain, topRows) });
    },
  ),
  tool(
    { name: "chart_gex", description: "Markdown gamma exposure chart data for compatibility aliases.", inputSchema: { properties: { ticker: { type: "string" }, expiry: { type: "string" }, topRows: { type: "integer" } }, required: ["ticker"] } },
    async (context) => NATIVE_TOOL_BY_NAME.get("get_options_gex")!.handler(context),
  ),
  tool(
    { name: "get_options_dex", description: "Approximate per-strike delta exposure from Yahoo option open interest.", inputSchema: { properties: { ticker: { type: "string" }, expiry: { type: "string" }, topRows: { type: "integer" } }, required: ["ticker"] } },
    async ({ ticker, expiry, topRows }) => {
      const chain = await fetchOptions(ticker, expiry);
      return toolResult(markdownExposure(chain, "dex", topRows), { chain, exposures: optionRowsNearSpot(chain, topRows) });
    },
  ),
  tool(
    { name: "chart_dex", description: "HTML chart wrapper for native DEX.", inputSchema: { properties: { ticker: { type: "string" }, expiry: { type: "string" }, topRows: { type: "integer" } }, required: ["ticker"] } },
    async ({ ticker, expiry, topRows }) => {
      const chain = await fetchOptions(ticker, expiry);
      const rows = optionRowsNearSpot(chain, topRows);
      return toolResult(htmlExposureChart(ticker, rows, "dex"), { chain, exposures: rows, chart: "net_dex_by_strike" });
    },
  ),
  tool(
    { name: "get_options_0dte", description: "Get nearest-expiry option exposure summary.", inputSchema: { properties: { ticker: { type: "string" }, expiry: { type: "string" } }, required: ["ticker"] } },
    async ({ ticker, expiry }) => {
      const chain = await fetchOptions(ticker, expiry);
      const rows = optionRowsNearSpot(chain, 96);
      const netGex = sumPresent(rows.map((row) => row.netGex));
      const netDex = sumPresent(rows.map((row) => row.netDex));
      const levels = deriveNativeOptionExposureLevels(rows, chain.spot);
      const pinStrike = levels.pin?.strike ?? chain.spot;
      const text = [
        `**Snapshot:** ${new Date().toISOString()} **Session phase:** \`native_yahoo\` **Now (ET):** ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`,
        `**Expiry:** ${chain.selectedExpiry || "none"}`,
        `**Pin level:** ${fmtMoney(pinStrike)} (${chain.spot ? fmtPct(((pinStrike - chain.spot) / chain.spot) * 100) : "0.00%"})`,
        `Flip level: ${levels.gammaFlip === null ? "n/a" : fmtMoney(levels.gammaFlip)}`,
        "| Metric | Value |",
        "| --- | ---: |",
        `| Net GEX | **${compact(netGex)}** |`,
        `| Net DEX | **${compact(netDex)}** |`,
        `| Top call wall | ${levels.callWall ? fmtMoney(levels.callWall.strike) : "n/a"} |`,
        `| Top put wall | ${levels.putWall ? fmtMoney(levels.putWall.strike) : "n/a"} |`,
        "| Charm regime | `native_yahoo_approx` |",
        markdownExposure(chain, "gex", 96),
      ].join("\n");
      return toolResult(text, { chain, rows, netGex, netDex, ...levels });
    },
  ),
  tool(
    { name: "get_options_greeks", description: "Return IV and estimated delta/gamma exposure by strike.", inputSchema: { properties: { ticker: { type: "string" }, expiry: { type: "string" }, greek: { type: "string" }, topRows: { type: "integer" } }, required: ["ticker"] } },
    async ({ ticker, expiry, topRows }) => {
      const chain = await fetchOptions(ticker, expiry);
      const rows = optionRowsNearSpot(chain, topRows);
      const text = [
        "| Strike | Avg IV | Call OI | Put OI | Net GEX | Net DEX |",
        "| ---: | ---: | ---: | ---: | ---: | ---: |",
        ...rows.map((row) => `| ${row.strike} | ${row.avgIv === null ? "n/a" : `${row.avgIv}%`} | ${displayNumber(row.callEffectiveOpenInterest)} | ${displayNumber(row.putEffectiveOpenInterest)} | ${compact(row.netGex)} | ${compact(row.netDex)} |`),
      ].join("\n");
      return toolResult(text, { chain, rows });
    },
  ),
  tool(
    { name: "chart_greeks", description: "HTML chart wrapper for native Greek exposure.", inputSchema: { properties: { ticker: { type: "string" }, expiry: { type: "string" }, topRows: { type: "integer" } }, required: ["ticker"] } },
    async ({ ticker, expiry, topRows }) => {
      const chain = await fetchOptions(ticker, expiry);
      const rows = optionRowsNearSpot(chain, topRows);
      return toolResult(htmlExposureChart(ticker, rows, "greeks"), { chain, rows, chart: "avg_iv_by_strike" });
    },
  ),
  tool(
    { name: "get_options_iv_intraday", description: "Current option-chain IV snapshot.", inputSchema: { properties: { ticker: { type: "string" }, expiry: { type: "string" }, topRows: { type: "integer" } }, required: ["ticker"] } },
    async ({ ticker, expiry, topRows }) => {
      const chain = await fetchOptions(ticker, expiry);
      const rows = optionRowsNearSpot(chain, topRows);
      const text = [
        `# ${ticker} current option-chain IV snapshot`,
        `- Expiry: ${chain.selectedExpiry || "none"}`,
        `- Spot: ${fmtMoney(chain.spot)}`,
        "| Strike | Call IV | Put IV | Avg IV | IV source |",
        "| ---: | ---: | ---: | ---: | --- |",
        ...rows.map((row) => `| ${row.strike} | ${row.callIv === null ? "n/a" : `${row.callIv}%`} | ${row.putIv === null ? "n/a" : `${row.putIv}%`} | ${row.avgIv === null ? "n/a" : `${row.avgIv}%`} | Yahoo option chain |`),
      ].join("\n");
      return toolResult(text, { chain, rows, metric: "current_iv" });
    },
  ),
  tool(
    { name: "get_options_pcr", description: "Put/call ratio from Yahoo option volume and open interest.", inputSchema: { properties: { ticker: { type: "string" }, expiry: { type: "string" } }, required: ["ticker"] } },
    async ({ ticker, expiry }) => {
      const chain = await fetchOptions(ticker, expiry);
      const callOi = chain.calls.reduce((sum, leg) => sum + numberOrZero(leg.openInterest), 0);
      const putOi = chain.puts.reduce((sum, leg) => sum + numberOrZero(leg.openInterest), 0);
      const callVol = chain.calls.reduce((sum, leg) => sum + numberOrZero(leg.volume), 0);
      const putVol = chain.puts.reduce((sum, leg) => sum + numberOrZero(leg.volume), 0);
      const raw = { ticker, expiry: chain.selectedExpiry, putCallOpenInterest: round(putOi / Math.max(1, callOi), 2), putCallVolume: round(putVol / Math.max(1, callVol), 2), callOi, putOi, callVol, putVol };
      return toolResult(`| Metric | Value |\n| --- | ---: |\n| P/C open interest | ${raw.putCallOpenInterest} |\n| P/C volume | ${raw.putCallVolume} |`, raw);
    },
  ),
  tool(
    { name: "get_options_sweeps", description: "Native placeholder for unusual options rows ranked by volume.", inputSchema: { properties: { ticker: { type: "string" }, expiry: { type: "string" }, topN: { type: "integer" } }, required: ["ticker"] } },
    async ({ ticker, expiry }) => {
      const chain = await fetchOptions(ticker, expiry);
      const legs = [...chain.calls.map((leg) => ({ ...leg, type: "C" })), ...chain.puts.map((leg) => ({ ...leg, type: "P" }))].sort((a, b) => numberOrZero(b.volume) - numberOrZero(a.volume)).slice(0, 12);
      const text = `# ${ticker} unusual options volume proxy\n| Type | Strike | Volume | OI | Vol/OI | Bid | Ask | IV |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${legs.map((leg) => `| ${leg.type} | ${leg.strike} | ${displayNumber(leg.volume)} | ${displayNumber(leg.openInterest)} | ${round(numberOrZero(leg.volume) / Math.max(1, numberOrZero(leg.openInterest)), 2)} | ${displayNumber(leg.bid)} | ${displayNumber(leg.ask)} | ${leg.impliedVolatility === null ? "n/a" : `${leg.impliedVolatility}%`} |`).join("\n")}`;
      return toolResult(text, { chain, legs });
    },
  ),
  tool(
    { name: "get_options_mispricing", description: "Simple bid/ask and IV sanity scan.", inputSchema: { properties: { ticker: { type: "string" }, expiry: { type: "string" } }, required: ["ticker"] } },
    async ({ ticker, expiry }) => {
      const chain = await fetchOptions(ticker, expiry);
      const legs = [...chain.calls.map((leg) => ({ ...leg, type: "C" })), ...chain.puts.map((leg) => ({ ...leg, type: "P" }))]
        .map((leg) => {
          const ask = numberOrZero(leg.ask);
          const bid = numberOrZero(leg.bid);
          const reference = Math.max(0.01, numberOrZero(leg.lastPrice) || ask || 0.01);
          return { ...leg, spread: round(ask - bid), spreadPct: round(((ask - bid) / reference) * 100, 2) };
        })
        .sort((a, b) => b.spreadPct - a.spreadPct)
        .slice(0, 12);
      const text = `# ${ticker} option bid/ask and IV sanity scan\n| Type | Strike | Last | Bid | Ask | Spread | Spread % | IV |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${legs.map((leg) => `| ${leg.type} | ${leg.strike} | ${displayNumber(leg.lastPrice)} | ${displayNumber(leg.bid)} | ${displayNumber(leg.ask)} | ${leg.spread} | ${leg.spreadPct}% | ${leg.impliedVolatility === null ? "n/a" : `${leg.impliedVolatility}%`} |`).join("\n")}`;
      return toolResult(text, { chain, legs, metric: "spread_pct" });
    },
  ),
  tool(
    { name: "get_options_flow_universe", description: "Approved-universe options flow overview.", inputSchema: { properties: { topTickers: { type: "integer" } } } },
    async () => {
      const quotes = await fetchUniverseQuotes();
      const flowRows = [...quotes]
        .map((quote) => ({
          symbol: quote.symbol,
          dollarVolume: quote.price * quote.volume,
          changePercent: quote.changePercent,
          proxyFlow: quote.price * quote.volume * (quote.changePercent / 100),
        }))
        .sort((a, b) => Math.abs(b.proxyFlow) - Math.abs(a.proxyFlow));
      const text = [
        "# Approved-universe options flow proxy",
        "Yahoo native mode has no tape-level options flow; this ranks price-volume pressure as a proxy.",
        "| Ticker | Dollar volume | Change % | Proxy flow |",
        "| --- | ---: | ---: | ---: |",
        ...flowRows.map((row) => `| ${row.symbol} | ${compact(row.dollarVolume)} | ${fmtPct(row.changePercent)} | ${compact(row.proxyFlow)} |`),
      ].join("\n");
      return toolResult(text, { flowRows, universe: STOCKS_WATCHER_SYMBOLS });
    },
  ),
  tool(
    { name: "market_breadth", description: "Breadth across the approved watchlist.", inputSchema: { properties: { market: { type: "string" } } } },
    async () => {
      const quotes = await fetchUniverseQuotes();
      const sorted = [...quotes].sort((a, b) => b.changePercent - a.changePercent);
      const advancers = quotes.filter((quote) => quote.changePercent >= 0).length;
      const text = [
        "# Market breadth",
        `- Advancers: ${advancers}/${quotes.length}`,
        `- Decliners: ${quotes.length - advancers}/${quotes.length}`,
        markdownQuoteTable(sorted),
        `Leadership: ${sorted[0]?.symbol || "n/a"}; laggard: ${sorted[sorted.length - 1]?.symbol || "n/a"}.`,
      ].join("\n\n");
      return toolResult(text, { quotes: sorted, advancers, universe: STOCKS_WATCHER_SYMBOLS });
    },
  ),
  tool(
    { name: "basket_relative_strength", description: "Relative strength ranking for the approved watchlist.", inputSchema: { properties: {} } },
    async () => {
      const quotes = await fetchUniverseQuotes();
      const ranked = [...quotes].sort((a, b) => b.changePercent - a.changePercent);
      const text = [
        "# Basket relative strength",
        "| Rank | Ticker | Last | Change % | Volume |",
        "| ---: | --- | ---: | ---: | ---: |",
        ...ranked.map((quote, index) => `| ${index + 1} | ${quote.symbol} | ${fmtMoney(quote.price)} | ${fmtPct(quote.changePercent)} | ${compact(quote.volume)} |`),
      ].join("\n");
      return toolResult(text, { ranked, benchmark: ranked[0]?.symbol || null });
    },
  ),
  tool(
    { name: "signal_scan", description: "Native signal scan over approved tickers.", inputSchema: { properties: { tickers: { type: "array", items: { type: "string" } }, ticker: { type: "string" }, intent: { type: "string" } } } },
    async ({ params, ticker }) => {
      const requested = Array.isArray(params.tickers) ? params.tickers.map((item) => normalizeStocksWatcherSymbol(String(item))).filter(Boolean) : [ticker];
      const quotes = await Promise.all(Array.from(new Set(requested)).map((symbol) => fetchQuote(symbol)));
      const signals = quotes.map((quote) => ({
        symbol: quote.symbol,
        signal: quote.changePercent > 1 ? "positive_momentum" : quote.changePercent < -1 ? "negative_momentum" : "neutral",
        changePercent: quote.changePercent,
        volume: quote.volume,
      }));
      const text = [
        "# Native signal scan",
        "| Ticker | Signal | Change % | Volume |",
        "| --- | --- | ---: | ---: |",
        ...signals.map((row) => `| ${row.symbol} | ${row.signal} | ${fmtPct(row.changePercent)} | ${compact(row.volume)} |`),
      ].join("\n");
      return toolResult(text, { signals });
    },
  ),
  tool(
    { name: "morning_briefing", description: "Native briefing for the approved asset universe.", inputSchema: { properties: { tickers: { type: "array", items: { type: "string" } }, focus: { type: "string" } } } },
    async ({ params }) => {
      const requested = Array.isArray(params.tickers) && params.tickers.length > 0
        ? params.tickers.map((item) => normalizeStocksWatcherSymbol(String(item))).filter(Boolean)
        : STOCKS_WATCHER_QUOTE_SYMBOLS;
      const quotes = await Promise.all(Array.from(new Set(requested)).map((symbol) => fetchQuote(symbol)));
      const sorted = [...quotes].sort((a, b) => b.changePercent - a.changePercent);
      const text = [
        "# Native morning briefing",
        `- Focus: ${String(params.focus || "market watch")}`,
        `- Best: ${sorted[0]?.symbol || "n/a"} ${sorted[0] ? fmtPct(sorted[0].changePercent) : ""}`,
        `- Worst: ${sorted[sorted.length - 1]?.symbol || "n/a"} ${sorted[sorted.length - 1] ? fmtPct(sorted[sorted.length - 1].changePercent) : ""}`,
        markdownQuoteTable(sorted),
      ].join("\n\n");
      return toolResult(text, { briefingQuotes: sorted, focus: params.focus || "market watch" });
    },
  ),
  tool(
    { name: "get_sector_stats", description: "Approved-universe sector/asset-class grouping.", inputSchema: { properties: { sector: { type: "string" } } } },
    async () => {
      const quotes = await fetchUniverseQuotes();
      const sectorStats = new Map<string, { sector: string; count: number; avgChangePercent: number; dollarVolume: number }>();
      for (const quote of quotes) {
        const sector = sectorForQuote(quote);
        const current = sectorStats.get(sector) || { sector, count: 0, avgChangePercent: 0, dollarVolume: 0 };
        current.count += 1;
        current.avgChangePercent += quote.changePercent;
        current.dollarVolume += quote.price * quote.volume;
        sectorStats.set(sector, current);
      }
      const rows = Array.from(sectorStats.values()).map((row) => ({ ...row, avgChangePercent: round(row.avgChangePercent / Math.max(1, row.count), 2) })).sort((a, b) => b.avgChangePercent - a.avgChangePercent);
      const text = [
        "# Sector stats",
        "| Sector | Count | Avg change % | Dollar volume |",
        "| --- | ---: | ---: | ---: |",
        ...rows.map((row) => `| ${row.sector} | ${row.count} | ${fmtPct(row.avgChangePercent)} | ${compact(row.dollarVolume)} |`),
      ].join("\n");
      return toolResult(text, { sectorStats: rows });
    },
  ),
  tool(
    { name: "get_sector_top_holdings", description: "Top and bottom movers in the approved universe.", inputSchema: { properties: { sector: { type: "string" } } } },
    async ({ params }) => {
      const requestedSector = String(params.sector || "").trim();
      const quotes = await fetchUniverseQuotes();
      const rows = quotes
        .map((quote) => ({ ...quote, sector: sectorForQuote(quote) }))
        .filter((quote) => !requestedSector || quote.sector.toLowerCase().includes(requestedSector.toLowerCase()))
        .sort((a, b) => b.changePercent - a.changePercent);
      const text = [
        `# Sector top holdings${requestedSector ? `: ${requestedSector}` : ""}`,
        "| Ticker | Sector | Last | Change % | Volume |",
        "| --- | --- | ---: | ---: | ---: |",
        ...rows.map((quote) => `| ${quote.symbol} | ${quote.sector} | ${fmtMoney(quote.price)} | ${fmtPct(quote.changePercent)} | ${compact(quote.volume)} |`),
      ].join("\n");
      return toolResult(text, { holdings: rows, sector: requestedSector || "all" });
    },
  ),
  tool(
    { name: "get_macro_regime", description: "Lightweight native regime read from approved-universe breadth.", inputSchema: { properties: {} } },
    async () => {
      const quotes = await fetchUniverseQuotes();
      const advancers = quotes.filter((quote) => quote.changePercent >= 0).length;
      const avgChange = round(quotes.reduce((sum, quote) => sum + quote.changePercent, 0) / Math.max(1, quotes.length), 2);
      const regime = advancers / Math.max(1, quotes.length) >= 0.6 ? "risk_on" : advancers / Math.max(1, quotes.length) <= 0.4 ? "risk_off" : "mixed";
      const text = [
        "# Macro regime",
        `- Regime: ${regime}`,
        `- Breadth: ${advancers}/${quotes.length} positive`,
        `- Average approved-universe change: ${fmtPct(avgChange)}`,
      ].join("\n");
      return toolResult(text, { regime, advancers, avgChange, universeCount: quotes.length });
    },
  ),
  tool(
    { name: "earnings_vol_crush", description: "Earnings date and IV/RV vol-crush context.", inputSchema: { properties: { ticker: { type: "string" } }, required: ["ticker"] } },
    async ({ ticker }) => buildEventContextToolResult("earnings_vol_crush", ticker, {}),
  ),
  tool(
    { name: "historical_context", description: "Recent return context around the requested condition.", inputSchema: { properties: { ticker: { type: "string" }, condition: { type: "string" }, event: { type: "string" } }, required: ["ticker"] } },
    async ({ ticker, params }) => buildEventContextToolResult("historical_context", ticker, params),
  ),
  tool(
    { name: "pre_event_brief", description: "Native pre-event synthesis from quote, stats, options, and news.", inputSchema: { properties: { ticker: { type: "string" }, intent: { type: "string" } }, required: ["ticker"] } },
    async ({ ticker, params }) => buildEventContextToolResult("pre_event_brief", ticker, params),
  ),
  tool(
    { name: "chart_indicator", description: "Render a native Yahoo price chart.", inputSchema: { properties: { ticker: { type: "string" }, indicator: { type: "string" } }, required: ["ticker"] } },
    async ({ ticker }) => {
      const history = await fetchHistory(ticker, "1y", "1d");
      return toolResult(htmlChart(ticker, history), { ticker, history: history.slice(-90) });
    },
  ),
];

const NATIVE_TOOL_BY_NAME = new Map(NATIVE_TOOL_REGISTRY.map((definition) => [definition.name, definition]));

export const getNativeStocksToolCacheParams = (
  name: string,
  params: Record<string, unknown> = {},
) => {
  const canonicalName = canonicalNativeToolName(name);
  const definition = NATIVE_TOOL_BY_NAME.get(canonicalName);
  if (!definition) throw new Error(`Native Yahoo tool '${name}' is not implemented.`);
  const context = nativeToolContext(params);
  const expiry = context.expiry || null;
  const topRows = Number.isFinite(context.topRows) ? Math.trunc(context.topRows) : 12;
  if (canonicalName === "get_stock_history") {
    const range = typeof params.range === "string" && /^(\d+(d|mo|y)|ytd|max)$/.test(params.range.trim()) ? params.range.trim() : "5y";
    const interval = typeof params.interval === "string" && /^(1d|1wk|1mo)$/.test(params.interval.trim()) ? params.interval.trim() : "1d";
    return { tool: canonicalName, ticker: context.ticker, range, interval };
  }
  if (["get_options", "get_options_gex", "chart_gex", "get_options_dex", "chart_dex", "get_options_0dte", "get_options_greeks", "chart_greeks", "get_options_iv_intraday", "get_options_pcr", "get_options_sweeps", "get_options_mispricing"].includes(canonicalName)) {
    const base = { tool: canonicalName, ticker: context.ticker, expiry };
    return ["get_options_gex", "chart_gex", "get_options_dex", "chart_dex", "get_options_greeks", "chart_greeks", "get_options_iv_intraday"].includes(canonicalName)
      ? { ...base, topRows }
      : canonicalName === "get_options"
        ? { ...base, strikesAroundAtm: toNumber(params.strikesAroundAtm, 12) }
        : base;
  }
  if (["market_breadth", "get_sector_stats", "get_macro_regime", "basket_relative_strength", "get_options_flow_universe"].includes(canonicalName)) return { tool: canonicalName };
  if (canonicalName === "get_quotes") {
    const requested = String(params.tickers || "").trim()
      .split(",")
      .map((item) => normalizeStocksWatcherSymbol(item))
      .filter(Boolean);
    return { tool: canonicalName, tickers: Array.from(new Set(requested.length > 0 ? requested : STOCKS_WATCHER_QUOTE_SYMBOLS)) };
  }
  const properties = definition.inputSchema?.properties || {};
  return {
    tool: canonicalName,
    ...Object.fromEntries(
      Object.keys(properties)
        .filter((key) => Object.prototype.hasOwnProperty.call(params, key))
        .map((key) => [key, params[key]]),
    ),
  };
};

const latestEarningsHistoryRow = (summary: Record<string, any>) => {
  const history = Array.isArray(summary.earningsHistory?.history) ? summary.earningsHistory.history : [];
  return history.length > 0 ? history[history.length - 1] as Record<string, any> : null;
};

const findCloseToCloseMove = (history: NativeYahooHistoryRow[], eventDate: string | null) => {
  if (!eventDate) return null;
  const eventIndex = history.findIndex((row) => row.date.slice(0, 10) >= eventDate);
  if (eventIndex <= 0) return null;
  const eventRow = history[eventIndex];
  const previousRow = history[eventIndex - 1];
  if (!eventRow || !previousRow?.close) return null;
  return {
    eventTradingDate: eventRow.date.slice(0, 10),
    previousClose: round(previousRow.close, 2),
    close: round(eventRow.close, 2),
    changePercent: round(((eventRow.close - previousRow.close) / previousRow.close) * 100, 2),
    basis: "close_to_close",
  };
};

export const buildNativeYahooEarningsSnapshot = (summary: Record<string, any>, history: NativeYahooHistoryRow[]) => {
  const calendar = summary.calendarEvents || {};
  const earnings = calendar.earnings || {};
  const latestHistory = latestEarningsHistoryRow(summary);
  const nextEarningsDate = dateFromYahoo(earnings.earningsDate?.[0]);
  const lastEarningsDate = dateFromYahoo(latestHistory?.quarter) || dateFromYahoo(earnings.earningsCallDate?.[0]);
  const epsActual = rawNumberFromYahoo(latestHistory?.epsActual);
  const epsEstimate = rawNumberFromYahoo(latestHistory?.epsEstimate);
  const surpriseRaw = rawNumberFromYahoo(latestHistory?.surprisePercent);
  const surprisePercent = typeof surpriseRaw === "number"
    ? round(Math.abs(surpriseRaw) <= 1 ? surpriseRaw * 100 : surpriseRaw, 2)
    : null;
  const revenueEstimate = fmtFromYahoo(earnings.revenueAverage);

  return {
    source: "Yahoo quoteSummary calendarEvents + earningsHistory",
    nextEarningsDate,
    nextEpsEstimate: rawNumberFromYahoo(earnings.earningsAverage),
    nextRevenueEstimate: revenueEstimate,
    lastEarningsDate,
    lastReportedQuarter: dateFromYahoo(latestHistory?.quarter),
    epsActual,
    epsEstimate,
    epsDifference: rawNumberFromYahoo(latestHistory?.epsDifference),
    surprisePercent,
    result: typeof epsActual === "number" && typeof epsEstimate === "number"
      ? epsActual >= epsEstimate ? "beat" : "miss"
      : null,
    priceMove: findCloseToCloseMove(history, lastEarningsDate),
  };
};

const buildEventContextToolResult = async (
  canonicalName: "earnings_vol_crush" | "historical_context" | "pre_event_brief",
  ticker: string,
  params: Record<string, unknown>,
) => {
  const [stats, history] = await Promise.all([
    latestQuoteSummaryText(ticker),
    fetchHistory(ticker, "1y", "1d"),
  ]);
  const quoteName = (stats.raw as { quote?: { name?: unknown } }).quote?.name;
  const news = await fetchNews(ticker, [
    typeof quoteName === "string" ? quoteName : "",
    typeof quoteName === "string" ? quoteName.split(/\s+/)[0] : "",
  ]).catch(() => []);
  const latest = history[history.length - 1];
  const prior = history[Math.max(0, history.length - 21)];
  const oneMonthReturn = prior?.close ? ((latest.close - prior.close) / prior.close) * 100 : 0;

  if (canonicalName === "earnings_vol_crush") {
    const calendar = (stats.raw as { summary?: Record<string, any> }).summary?.calendarEvents || {};
    const earningsDate = calendar.earnings?.earningsDate?.[0]?.fmt || "n/a";
    const earnings = buildNativeYahooEarningsSnapshot((stats.raw as { summary?: Record<string, any> }).summary || {}, history);
    const text = [
      `# ${ticker} earnings vol-crush context`,
      `- Earnings date: ${earningsDate}`,
      earnings.lastEarningsDate ? `- Last earnings: ${earnings.lastEarningsDate}; EPS ${earnings.epsActual ?? "n/a"} vs ${earnings.epsEstimate ?? "n/a"} (${earnings.result || "Needs checking"})` : "- Last earnings: Needs checking from Yahoo earningsHistory.",
      earnings.priceMove ? `- Earnings-date close move: ${fmtPct(earnings.priceMove.changePercent)} (${earnings.priceMove.basis})` : "- Earnings-date price move: Needs checking from Yahoo chart history.",
      `- 1M price context: ${fmtPct(oneMonthReturn)}`,
      "- Native Yahoo mode uses quoteSummary earningsHistory and chart close-to-close history.",
    ].join("\n");
    return toolResult(text, { stats: stats.raw, historyTail: history.slice(-30), news, oneMonthReturn, earningsDate, earnings });
  }

  if (canonicalName === "historical_context") {
    const high = Math.max(...history.slice(-30).map((row) => row.close));
    const low = Math.min(...history.slice(-30).map((row) => row.close));
    const text = [
      `# ${ticker} historical context`,
      `- Condition: ${String(params.condition || params.event || "recent trend")}`,
      `- 1M return: ${fmtPct(oneMonthReturn)}`,
      `- 30-session close range: ${fmtMoney(low)} - ${fmtMoney(high)}`,
    ].join("\n");
    return toolResult(text, { historyTail: history.slice(-30), oneMonthReturn, range: { high, low } });
  }

  const text = [
    `# ${ticker} pre-event brief`,
    stats.text,
    `- Intent: ${String(params.intent || "event prep")}`,
    `- 1M price context: ${fmtPct(oneMonthReturn)}`,
    news.length > 0 ? `- Latest news: ${news[0].title} (${news[0].publisher})` : "- Latest news: unavailable from Yahoo search.",
  ].join("\n");
  return toolResult(text, { stats: stats.raw, historyTail: history.slice(-30), news, oneMonthReturn, intent: params.intent || "event prep" });
};

export const listNativeStocksTools = (): StocksNativeToolSummary[] =>
  NATIVE_TOOL_REGISTRY
    .filter((definition) => definition.name !== "chart_gex")
    .map(({ handler: _handler, ...summary }) => summary);

export const callNativeStocksTool = async (name: string, params: Record<string, unknown> = {}): Promise<StocksNativeToolResult> => {
  const canonicalName = canonicalNativeToolName(name);
  const definition = NATIVE_TOOL_BY_NAME.get(canonicalName);
  if (!definition) throw new Error(`Native Yahoo tool '${name}' is not implemented.`);
  return definition.handler(nativeToolContext(params));
};

export class NativeStocksYahooClient {
  async listTools() {
    return listNativeStocksTools();
  }

  async callTool(name: string, args: Record<string, unknown> = {}) {
    return callNativeStocksTool(name, args);
  }

  async callToolText(name: string, args: Record<string, unknown> = {}) {
    const result = await this.callTool(name, args);
    return result.text;
  }
}

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === "object" ? value as Record<string, any> : {};

const fulfilledRaw = (
  results: Array<{ label: string; result: PromiseSettledResult<StocksNativeToolResult> }>,
  label: string,
) => {
  const match = results.find((item) => item.label === label);
  return asRecord(match?.result.status === "fulfilled" ? match.result.value.raw : null);
};

const extractSpxGexMarketContext = (
  results: Array<{ label: string; result: PromiseSettledResult<StocksNativeToolResult> }>,
): SpxGexMarketContext => {
  const warnings = results
    .filter((item) => item.result.status === "rejected")
    .map((item) => `${item.label} failed: ${item.result.status === "rejected" && item.result.reason instanceof Error ? item.result.reason.message : String(item.result)}`);
  const macroRaw = fulfilledRaw(results, "get_macro_regime");
  const breadthRaw = fulfilledRaw(results, "market_breadth");
  const flowRaw = fulfilledRaw(results, "get_options_flow_universe");
  const briefRaw = fulfilledRaw(results, "pre_event_brief");
  const flowRows = Array.isArray(flowRaw.flowRows) ? flowRaw.flowRows : [];
  const topFlow = asRecord(flowRows[0]);
  const news = Array.isArray(briefRaw.news) ? briefRaw.news : [];
  const latestNews = asRecord(news[0]);
  const universeCount = Number(macroRaw.universeCount || breadthRaw.universe?.length || 0);
  const advancers = Number(macroRaw.advancers ?? breadthRaw.advancers ?? 0);

  return {
    macroRegime: typeof macroRaw.regime === "string" ? macroRaw.regime : null,
    breadth: universeCount > 0
      ? {
          advancers,
          universeCount,
          avgChange: typeof macroRaw.avgChange === "number" ? macroRaw.avgChange : null,
        }
      : null,
    flow: typeof topFlow.symbol === "string" && typeof topFlow.proxyFlow === "number"
      ? {
          topTicker: topFlow.symbol,
          proxyFlow: topFlow.proxyFlow,
          changePercent: typeof topFlow.changePercent === "number" ? topFlow.changePercent : 0,
        }
      : null,
    latestHeadline: typeof latestNews.title === "string" ? latestNews.title : null,
    warnings,
  };
};

export class NativeSpxGexYahooClient implements SpxGexDataClient {
  async getQuotes() {
    const quote = await fetchQuote("^SPX");
    return markdownQuoteTable([{ ...quote, symbol: "SPX" }]);
  }

  async getOptions() {
    const chain = await fetchOptions("^SPX");
    return markdownOptionChain(chain, 25);
  }

  async getOptionsChain(expiry?: string): Promise<SpxGexOptionChain> {
    return fetchOptions("^SPX", expiry);
  }

  async getOptions0Dte() {
    const result = await callNativeStocksTool("get_options_0dte", { ticker: "^SPX" });
    return result.text;
  }

  async getOptionsGex(expiry: string) {
    const result = await callNativeStocksTool("get_options_gex", { ticker: "^SPX", expiry, topRows: 96 });
    return result.text;
  }

  async getMarketContext() {
    const calls = [
      { label: "get_macro_regime", promise: callNativeStocksTool("get_macro_regime", {}) },
      { label: "market_breadth", promise: callNativeStocksTool("market_breadth", { market: "US" }) },
      { label: "get_options_flow_universe", promise: callNativeStocksTool("get_options_flow_universe", { topTickers: 5 }) },
      { label: "pre_event_brief", promise: callNativeStocksTool("pre_event_brief", { ticker: "^SPX", intent: "premarket gamma map" }) },
    ];
    const settled = await Promise.allSettled(calls.map((call) => call.promise));

    return extractSpxGexMarketContext(calls.map((call, index) => ({ label: call.label, result: settled[index] })));
  }
}
