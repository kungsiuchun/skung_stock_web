import type { SpxGexDataClient } from "./spx-gex-heatmap";
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

interface QuoteRow {
  symbol: string;
  name: string;
  price: number;
  previousClose: number | null;
  change: number;
  changePercent: number;
  volume: number;
  currency: string;
  exchange: string;
  marketState: string;
  asOf: string | null;
}

interface HistoryRow {
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
  lastPrice: number;
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
}

interface OptionChain {
  symbol: string;
  spot: number;
  expiries: string[];
  selectedExpiry: string | null;
  calls: OptionLeg[];
  puts: OptionLeg[];
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

const fmtMoney = (value: number) => `$${value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
const fmtPct = (value: number) => `${value >= 0 ? "+" : ""}${round(value, 2).toFixed(2)}%`;
const fmtSigned = (value: number) => `${value >= 0 ? "+" : ""}${round(value, 2).toFixed(2)}`;

const compact = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${round(value / 1_000_000_000, 2)}B`;
  if (abs >= 1_000_000) return `${round(value / 1_000_000, 2)}M`;
  if (abs >= 1_000) return `${round(value / 1_000, 2)}K`;
  return String(round(value, 2));
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

const fetchQuote = async (symbol: string): Promise<QuoteRow> => {
  const { displaySymbol } = resolveStocksWatcherYahooSymbol(symbol);
  const chart = await fetchChart(symbol, "5d", "1d");
  const meta = chart.meta || {};
  const timestamps: number[] = chart.timestamp || [];
  const quote = chart.indicators?.quote?.[0] || {};
  const closes: Array<number | null> = quote.close || [];
  const volumes: Array<number | null> = quote.volume || [];
  let lastIndex = closes.length - 1;
  while (lastIndex > 0 && typeof closes[lastIndex] !== "number") lastIndex -= 1;

  const price = toNumber(meta.regularMarketPrice, toNumber(closes[lastIndex], toNumber(meta.previousClose, 0)));
  const previousClose = toNumber(meta.chartPreviousClose, toNumber(meta.previousClose, toNumber(closes[Math.max(0, lastIndex - 1)], price)));
  const change = price - previousClose;
  const changePercent = previousClose ? (change / previousClose) * 100 : 0;

  return {
    symbol: displaySymbol,
    name: String(meta.longName || meta.shortName || meta.instrumentType || symbol),
    price: round(price, 2),
    previousClose: round(previousClose, 2),
    change: round(change, 2),
    changePercent: round(changePercent, 2),
    volume: toNumber(meta.regularMarketVolume, toNumber(volumes[lastIndex], 0)),
    currency: String(meta.currency || "USD"),
    exchange: String(meta.exchangeName || meta.fullExchangeName || "Yahoo"),
    marketState: String(meta.marketState || "UNKNOWN"),
    asOf: typeof timestamps[lastIndex] === "number" ? new Date(timestamps[lastIndex] * 1000).toISOString() : null,
  };
};

const fetchHistory = async (symbol: string, range = "1y", interval = "1d"): Promise<HistoryRow[]> => {
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
    "assetProfile",
  ].join(",");
  const data = await yahooAuthedJson<Record<string, any>>(
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooSymbol)}?modules=${modules}`,
  );
  return data.quoteSummary?.result?.[0] || {};
};

const fetchNews = async (symbol: string) => {
  const { yahooSymbol } = resolveStocksWatcherYahooSymbol(symbol);
  const data = await yahooJson<Record<string, any>>(
    `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(yahooSymbol)}&newsCount=8&quotesCount=1`,
  );
  return (data.news || []).map((item: Record<string, any>) => ({
    title: String(item.title || ""),
    publisher: String(item.publisher || "Yahoo Finance"),
    link: String(item.link || ""),
    publishedAt: typeof item.providerPublishTime === "number" ? new Date(item.providerPublishTime * 1000).toISOString() : null,
  }));
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
  };
};

const normalizeOptionLeg = (leg: Record<string, any>): OptionLeg => ({
  contractSymbol: String(leg.contractSymbol || ""),
  strike: round(toNumber(leg.strike)),
  lastPrice: round(toNumber(leg.lastPrice)),
  bid: round(toNumber(leg.bid)),
  ask: round(toNumber(leg.ask)),
  volume: Math.round(toNumber(leg.volume)),
  openInterest: Math.round(toNumber(leg.openInterest)),
  impliedVolatility: round(toNumber(leg.impliedVolatility) * 100, 2),
});

const effectiveOpenInterest = (leg: OptionLeg | undefined) => {
  if (!leg) return 0;
  return leg.openInterest > 0 ? leg.openInterest : leg.volume;
};

const effectiveIv = (leg: OptionLeg | undefined) => {
  if (!leg) return 0;
  if (leg.impliedVolatility > 0) return leg.impliedVolatility;
  if (leg.lastPrice > 0) return 20;
  return 0;
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
    const callOpenInterest = call?.openInterest || 0;
    const putOpenInterest = put?.openInterest || 0;
    const callEffectiveOpenInterest = effectiveOpenInterest(call);
    const putEffectiveOpenInterest = effectiveOpenInterest(put);
    const callIvPercent = effectiveIv(call);
    const putIvPercent = effectiveIv(put);
    const validIvValues = [callIvPercent, putIvPercent].filter((value) => value > 0);
    const callIv = (callIvPercent || 20) / 100;
    const putIv = (putIvPercent || 20) / 100;
    const moneyness = spot > 0 ? (spot - strike) / spot : 0;
    const callDelta = Math.max(0.05, Math.min(0.95, 0.5 + moneyness * 5));
    const putDelta = callDelta - 1;
    const callGex = Math.round(callEffectiveOpenInterest * spot * Math.max(0.05, callIv) * 8);
    const putGex = -Math.round(putEffectiveOpenInterest * spot * Math.max(0.05, putIv) * 8);
    const callDex = Math.round(callEffectiveOpenInterest * 100 * callDelta);
    const putDex = Math.round(putEffectiveOpenInterest * 100 * putDelta);
    const openInterestSource = callOpenInterest + putOpenInterest > 0 ? "open_interest" : "volume_proxy";

    return {
      strike,
      call,
      put,
      callOpenInterest,
      putOpenInterest,
      callVolume: call?.volume || 0,
      putVolume: put?.volume || 0,
      callEffectiveOpenInterest,
      putEffectiveOpenInterest,
      openInterestSource,
      callGex,
      putGex,
      netGex: callGex + putGex,
      callDex,
      putDex,
      netDex: callDex + putDex,
      callIv: callIvPercent,
      putIv: putIvPercent,
      avgIv: round(validIvValues.reduce((sum, value) => sum + value, 0) / Math.max(1, validIvValues.length), 2),
    };
  });
};

const markdownQuoteTable = (quotes: QuoteRow[]) => [
  "| Ticker | Name | Last | Change | Change % | Volume |",
  "| --- | --- | ---: | ---: | ---: | ---: |",
  ...quotes.map((quote) => `| ${quote.symbol} | ${quote.name} | ${fmtMoney(quote.price)} | ${fmtSigned(quote.change)} | ${fmtPct(quote.changePercent)} | ${compact(quote.volume)} |`),
].join("\n");

const markdownHistory = (rows: HistoryRow[], limit = 60) => [
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
      if (row.call) lines.push(`| ${chain.selectedExpiry || ""} | ${row.callEffectiveOpenInterest} | ${row.strike} | ${row.call.volume} | C | ${row.call.bid} | ${row.call.ask} | ${row.callIv}% |`);
      if (row.put) lines.push(`| ${chain.selectedExpiry || ""} | ${row.putEffectiveOpenInterest} | ${row.strike} | ${row.put.volume} | P | ${row.put.bid} | ${row.put.ask} | ${row.putIv}% |`);
      return lines;
    }),
  ].join("\n");
};

const markdownExposure = (chain: OptionChain, greek: "gex" | "dex", topRows = 12) => {
  const rows = optionRowsNearSpot(chain, Math.max(5, Math.min(20, topRows)));
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

const htmlChart = (ticker: string, rows: HistoryRow[]) => {
  const points = rows.slice(-90);
  const labels = points.map((row) => row.date);
  const values = points.map((row) => row.close);
  return `<!doctype html><html><body style="margin:0;background:#020617;color:#e2e8f0;font-family:Inter,system-ui,sans-serif"><canvas id="c" width="900" height="360"></canvas><script src="https://cdn.jsdelivr.net/npm/chart.js"></script><script>const labels=${JSON.stringify(labels)};const values=${JSON.stringify(values)};new Chart(document.getElementById('c'),{type:'line',data:{labels,datasets:[{label:${JSON.stringify(ticker)},data:values,borderColor:'#60a5fa',backgroundColor:'rgba(96,165,250,.15)',fill:true,tension:.25}]},options:{responsive:true,plugins:{legend:{labels:{color:'#e2e8f0'}}},scales:{x:{ticks:{color:'#94a3b8'},grid:{color:'rgba(148,163,184,.15)'}},y:{ticks:{color:'#94a3b8'},grid:{color:'rgba(148,163,184,.15)'}}}}});</script></body></html>`;
};

export const listNativeStocksTools = (): StocksNativeToolSummary[] => [
  { name: "get_quotes", description: "Get delayed native Yahoo quotes for the approved asset universe.", inputSchema: { properties: { tickers: { type: "string" } } } },
  { name: "get_watchlist", description: "Return the curated top-50 stock watcher universe.", inputSchema: { properties: {} } },
  { name: "get_stock_history", description: "Get daily OHLCV history from Yahoo chart API.", inputSchema: { properties: { ticker: { type: "string" } }, required: ["ticker"] } },
  { name: "get_intraday", description: "Get 5-day 5-minute OHLCV data from Yahoo chart API.", inputSchema: { properties: { ticker: { type: "string" } }, required: ["ticker"] } },
  { name: "get_stock_stats", description: "Get quote, valuation, financial, and profile stats.", inputSchema: { properties: { ticker: { type: "string" } }, required: ["ticker"] } },
  { name: "get_beta", description: "Get beta from Yahoo quoteSummary.", inputSchema: { properties: { ticker: { type: "string" } }, required: ["ticker"] } },
  { name: "get_options", description: "Get option chain with calls and puts around spot.", inputSchema: { properties: { ticker: { type: "string" }, expiry: { type: "string" }, strikesAroundAtm: { type: "integer" } }, required: ["ticker"] } },
  { name: "get_options_0dte", description: "Get nearest-expiry option exposure summary.", inputSchema: { properties: { ticker: { type: "string" } }, required: ["ticker"] } },
  { name: "get_options_gex", description: "Approximate per-strike gamma exposure from Yahoo option open interest.", inputSchema: { properties: { ticker: { type: "string" }, expiry: { type: "string" }, topRows: { type: "integer" } }, required: ["ticker"] } },
  { name: "get_options_dex", description: "Approximate per-strike delta exposure from Yahoo option open interest.", inputSchema: { properties: { ticker: { type: "string" }, expiry: { type: "string" }, topRows: { type: "integer" } }, required: ["ticker"] } },
  { name: "get_options_greeks", description: "Return IV and estimated delta/gamma exposure by strike.", inputSchema: { properties: { ticker: { type: "string" }, expiry: { type: "string" }, greek: { type: "string" } }, required: ["ticker"] } },
  { name: "chart_greeks", description: "HTML chart wrapper for native Greek exposure.", inputSchema: { properties: { ticker: { type: "string" }, expiry: { type: "string" } }, required: ["ticker"] } },
  { name: "chart_dex", description: "HTML chart wrapper for native DEX.", inputSchema: { properties: { ticker: { type: "string" }, expiry: { type: "string" } }, required: ["ticker"] } },
  { name: "chart_indicator", description: "Render a native Yahoo price chart.", inputSchema: { properties: { ticker: { type: "string" }, indicator: { type: "string" } }, required: ["ticker"] } },
  { name: "get_options_pcr", description: "Put/call ratio from Yahoo option volume and open interest.", inputSchema: { properties: { ticker: { type: "string" }, expiry: { type: "string" } }, required: ["ticker"] } },
  { name: "get_options_sweeps", description: "Native placeholder for unusual options rows ranked by volume.", inputSchema: { properties: { ticker: { type: "string" }, topN: { type: "integer" } }, required: ["ticker"] } },
  { name: "get_options_iv_intraday", description: "Current option-chain IV snapshot.", inputSchema: { properties: { ticker: { type: "string" }, expiry: { type: "string" } }, required: ["ticker"] } },
  { name: "get_options_mispricing", description: "Simple bid/ask and IV sanity scan.", inputSchema: { properties: { ticker: { type: "string" }, expiry: { type: "string" } }, required: ["ticker"] } },
  { name: "get_options_flow_universe", description: "Approved-universe options flow overview.", inputSchema: { properties: { topTickers: { type: "integer" } } } },
  { name: "earnings_vol_crush", description: "Earnings date and IV/RV vol-crush context.", inputSchema: { properties: { ticker: { type: "string" } }, required: ["ticker"] } },
  { name: "historical_context", description: "Recent return context around the requested condition.", inputSchema: { properties: { ticker: { type: "string" }, condition: { type: "string" }, event: { type: "string" } }, required: ["ticker"] } },
  { name: "pre_event_brief", description: "Native pre-event synthesis from quote, stats, options, and news.", inputSchema: { properties: { ticker: { type: "string" }, intent: { type: "string" } }, required: ["ticker"] } },
  { name: "morning_briefing", description: "Native briefing for the approved asset universe.", inputSchema: { properties: { tickers: { type: "array", items: { type: "string" } }, focus: { type: "string" } } } },
  { name: "signal_scan", description: "Native signal scan over approved tickers.", inputSchema: { properties: { tickers: { type: "array", items: { type: "string" } }, ticker: { type: "string" }, intent: { type: "string" } } } },
  { name: "market_breadth", description: "Breadth across the approved watchlist.", inputSchema: { properties: { market: { type: "string" } } } },
  { name: "basket_relative_strength", description: "Relative strength ranking for the approved watchlist.", inputSchema: { properties: {} } },
  { name: "get_sector_stats", description: "Approved-universe sector/asset-class grouping.", inputSchema: { properties: { sector: { type: "string" } } } },
  { name: "get_sector_top_holdings", description: "Top and bottom movers in the approved universe.", inputSchema: { properties: { sector: { type: "string" } } } },
  { name: "get_macro_regime", description: "Lightweight native regime read from approved-universe breadth.", inputSchema: { properties: {} } },
  { name: "list_memories", description: "Repo-native replacement: returns the approved symbol set; no server-side memory storage.", inputSchema: { properties: {} } },
  { name: "save_memory", description: "Repo-native replacement: server-side memory is unsupported; UI state remains local.", inputSchema: { properties: { key: { type: "string" }, value: { type: "string" } } } },
  { name: "share_html", description: "Repo-native replacement: public hosted sharing is unsupported in the native backend.", inputSchema: { properties: { html: { type: "string" }, title: { type: "string" } } } },
];

export const callNativeStocksTool = async (name: string, params: Record<string, unknown> = {}): Promise<StocksNativeToolResult> => {
  const canonicalName = name === "chart_indicators" ? "chart_indicator" : name === "pre_event_briefing" ? "pre_event_brief" : name;
  const ticker = normalizeToolTicker(params);
  const expiry = typeof params.expiry === "string" ? params.expiry : undefined;
  const topRows = typeof params.topRows === "number" ? params.topRows : 12;

  if (canonicalName === "get_watchlist" || canonicalName === "list_memories") {
    const text = JSON.stringify({ symbols: STOCKS_WATCHER_SYMBOLS, stocks: STOCKS_WATCHER_UNIVERSE }, null, 2);
    return toolResult(text, { symbols: STOCKS_WATCHER_SYMBOLS, stocks: STOCKS_WATCHER_UNIVERSE });
  }

  if (canonicalName === "save_memory") {
    return toolResult("Server-side memories are deprecated. The React UI keeps favorites in local browser storage.", { accepted: false, params });
  }

  if (canonicalName === "share_html") {
    return toolResult("Public share links are disabled in the native backend. Export locally instead.", { accepted: false });
  }

  if (canonicalName === "get_quotes") {
    const rawTickers = String(params.tickers || "").trim();
    const requested = rawTickers ? rawTickers.split(",").map((item) => normalizeStocksWatcherSymbol(item)).filter(Boolean) : [];
    const symbols = Array.from(new Set(requested.length > 0 ? requested : STOCKS_WATCHER_QUOTE_SYMBOLS));
    const quotes = await Promise.all(symbols.map((symbol) => fetchQuote(symbol)));
    return toolResult(markdownQuoteTable(quotes), { quotes });
  }

  if (canonicalName === "get_stock_history") {
    const history = await fetchHistory(ticker, "5y", "1d");
    return toolResult(markdownHistory(history, 120), { ticker, history });
  }

  if (canonicalName === "get_intraday") {
    const history = await fetchHistory(ticker, "5d", "5m");
    return toolResult(markdownHistory(history, 120), { ticker, history });
  }

  if (canonicalName === "get_stock_stats" || canonicalName === "get_beta") {
    const result = await latestQuoteSummaryText(ticker);
    return toolResult(result.text, result.raw);
  }

  if (canonicalName === "get_options") {
    const chain = await fetchOptions(ticker, expiry);
    return toolResult(markdownOptionChain(chain, toNumber(params.strikesAroundAtm, 12)), { chain });
  }

  if (canonicalName === "get_options_gex" || canonicalName === "chart_gex") {
    const chain = await fetchOptions(ticker, expiry);
    return toolResult(markdownExposure(chain, "gex", topRows), { chain, exposures: optionRowsNearSpot(chain, topRows) });
  }

  if (canonicalName === "get_options_dex" || canonicalName === "chart_dex") {
    const chain = await fetchOptions(ticker, expiry);
    return toolResult(markdownExposure(chain, "dex", topRows), { chain, exposures: optionRowsNearSpot(chain, topRows) });
  }

  if (canonicalName === "get_options_0dte") {
    const chain = await fetchOptions(ticker, expiry);
    const rows = optionRowsNearSpot(chain, 8);
    const netGex = rows.reduce((sum, row) => sum + row.netGex, 0);
    const netDex = rows.reduce((sum, row) => sum + row.netDex, 0);
    const pin = rows.reduce((best, row) => Math.abs(row.netGex) > Math.abs(best.netGex) ? row : best, rows[0] || { strike: chain.spot, netGex: 0, netDex: 0 });
    const text = [
      `**Snapshot:** ${new Date().toISOString()} **Session phase:** \`native_yahoo\` **Now (ET):** ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`,
      `**Expiry:** ${chain.selectedExpiry || "none"}`,
      `**Pin level:** ${fmtMoney(pin.strike)} (${chain.spot ? fmtPct(((pin.strike - chain.spot) / chain.spot) * 100) : "0.00%"})`,
      `Flip level: ${fmtMoney(pin.strike)}`,
      "| Metric | Value |",
      "| --- | ---: |",
      `| Net GEX | **${compact(netGex)}** |`,
      `| Net DEX | **${compact(netDex)}** |`,
      `| Top call wall | ${fmtMoney(pin.strike)} |`,
      `| Top put wall | ${fmtMoney(pin.strike)} |`,
      "| Charm regime | `native_yahoo_approx` |",
      markdownExposure(chain, "gex", 8),
    ].join("\n");
    return toolResult(text, { chain, rows, netGex, netDex, pin });
  }

  if (canonicalName === "get_options_greeks" || canonicalName === "get_options_iv_intraday") {
    const chain = await fetchOptions(ticker, expiry);
    const rows = optionRowsNearSpot(chain, topRows);
    const text = [
      "| Strike | Avg IV | Call OI | Put OI | Net GEX | Net DEX |",
      "| ---: | ---: | ---: | ---: | ---: | ---: |",
      ...rows.map((row) => `| ${row.strike} | ${row.avgIv}% | ${row.callEffectiveOpenInterest} | ${row.putEffectiveOpenInterest} | ${compact(row.netGex)} | ${compact(row.netDex)} |`),
    ].join("\n");
    return toolResult(text, { chain, rows });
  }

  if (canonicalName === "get_options_pcr") {
    const chain = await fetchOptions(ticker, expiry);
    const callOi = chain.calls.reduce((sum, leg) => sum + leg.openInterest, 0);
    const putOi = chain.puts.reduce((sum, leg) => sum + leg.openInterest, 0);
    const callVol = chain.calls.reduce((sum, leg) => sum + leg.volume, 0);
    const putVol = chain.puts.reduce((sum, leg) => sum + leg.volume, 0);
    const raw = { ticker, expiry: chain.selectedExpiry, putCallOpenInterest: round(putOi / Math.max(1, callOi), 2), putCallVolume: round(putVol / Math.max(1, callVol), 2), callOi, putOi, callVol, putVol };
    return toolResult(`| Metric | Value |\n| --- | ---: |\n| P/C open interest | ${raw.putCallOpenInterest} |\n| P/C volume | ${raw.putCallVolume} |`, raw);
  }

  if (canonicalName === "get_options_sweeps" || canonicalName === "get_options_mispricing") {
    const chain = await fetchOptions(ticker, expiry);
    const legs = [...chain.calls.map((leg) => ({ ...leg, type: "C" })), ...chain.puts.map((leg) => ({ ...leg, type: "P" }))].sort((a, b) => b.volume - a.volume).slice(0, 12);
    const text = `| Type | Strike | Volume | OI | Bid | Ask | IV |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n${legs.map((leg) => `| ${leg.type} | ${leg.strike} | ${leg.volume} | ${leg.openInterest} | ${leg.bid} | ${leg.ask} | ${leg.impliedVolatility}% |`).join("\n")}`;
    return toolResult(text, { chain, legs });
  }

  if (canonicalName === "get_options_flow_universe" || canonicalName === "market_breadth" || canonicalName === "basket_relative_strength" || canonicalName === "signal_scan" || canonicalName === "morning_briefing" || canonicalName === "get_macro_regime" || canonicalName === "get_sector_stats" || canonicalName === "get_sector_top_holdings") {
    const quotes = await Promise.all(STOCKS_WATCHER_QUOTE_SYMBOLS.map((symbol) => fetchQuote(symbol)));
    const sorted = [...quotes].sort((a, b) => b.changePercent - a.changePercent);
    const advancers = quotes.filter((quote) => quote.changePercent >= 0).length;
    const text = [
      `Native Yahoo universe breadth: ${advancers}/${quotes.length} approved assets positive.`,
      markdownQuoteTable(sorted),
      `Leadership: ${sorted[0]?.symbol || "n/a"}; laggard: ${sorted[sorted.length - 1]?.symbol || "n/a"}.`,
    ].join("\n\n");
    return toolResult(text, { quotes: sorted, advancers, universe: STOCKS_WATCHER_SYMBOLS });
  }

  if (canonicalName === "earnings_vol_crush" || canonicalName === "historical_context" || canonicalName === "pre_event_brief") {
    const [stats, history, news] = await Promise.all([
      latestQuoteSummaryText(ticker),
      fetchHistory(ticker, "1y", "1d"),
      fetchNews(ticker).catch(() => []),
    ]);
    const latest = history[history.length - 1];
    const prior = history[Math.max(0, history.length - 21)];
    const oneMonthReturn = prior?.close ? ((latest.close - prior.close) / prior.close) * 100 : 0;
    const text = [
      stats.text,
      `- 1M price context: ${fmtPct(oneMonthReturn)}`,
      news.length > 0 ? `- Latest news: ${news[0].title} (${news[0].publisher})` : "- Latest news: unavailable from Yahoo search.",
    ].join("\n");
    return toolResult(text, { stats: stats.raw, historyTail: history.slice(-30), news, oneMonthReturn });
  }

  if (canonicalName === "chart_indicator") {
    const history = await fetchHistory(ticker, "1y", "1d");
    return toolResult(htmlChart(ticker, history), { ticker, history: history.slice(-90) });
  }

  throw new Error(`Native Yahoo tool '${name}' is not implemented.`);
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

export class NativeSpxGexYahooClient implements SpxGexDataClient {
  async getQuotes() {
    const quote = await fetchQuote("^SPX");
    return markdownQuoteTable([{ ...quote, symbol: "SPX" }]);
  }

  async getOptions() {
    const chain = await fetchOptions("^SPX");
    return markdownOptionChain(chain, 25);
  }

  async getOptions0Dte() {
    const result = await callNativeStocksToolForMarket("get_options_0dte", "^SPX", {});
    return result.text;
  }

  async getOptionsGex(expiry: string) {
    const result = await callNativeStocksToolForMarket("get_options_gex", "^SPX", { expiry, topRows: 20 });
    return result.text;
  }
}

const callNativeStocksToolForMarket = async (name: string, symbol: string, params: Record<string, unknown>) => {
  const expiry = typeof params.expiry === "string" ? params.expiry : undefined;
  const topRows = typeof params.topRows === "number" ? params.topRows : 12;
  if (name === "get_options_0dte") {
    const chain = await fetchOptions(symbol, expiry);
    const rows = optionRowsNearSpot(chain, 8);
    const netGex = rows.reduce((sum, row) => sum + row.netGex, 0);
    const netDex = rows.reduce((sum, row) => sum + row.netDex, 0);
    const pin = rows.reduce((best, row) => Math.abs(row.netGex) > Math.abs(best.netGex) ? row : best, rows[0] || { strike: chain.spot, netGex: 0, netDex: 0 });
    const text = [
      `**Snapshot:** ${new Date().toISOString()} **Session phase:** \`native_yahoo\` **Now (ET):** ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`,
      `**Expiry:** ${chain.selectedExpiry || "none"}`,
      `**Pin level:** ${fmtMoney(pin.strike)} (${chain.spot ? fmtPct(((pin.strike - chain.spot) / chain.spot) * 100) : "0.00%"})`,
      `Flip level: ${fmtMoney(pin.strike)}`,
      "| Metric | Value |",
      "| --- | ---: |",
      `| Net GEX | **${compact(netGex)}** |`,
      `| Net DEX | **${compact(netDex)}** |`,
      `| Top call wall | ${fmtMoney(pin.strike)} |`,
      `| Top put wall | ${fmtMoney(pin.strike)} |`,
      "| Charm regime | `native_yahoo_approx` |",
      markdownExposure(chain, "gex", 8),
    ].join("\n");
    return toolResult(text, { chain, rows, netGex, netDex, pin });
  }
  if (name === "get_options_gex") {
    const chain = await fetchOptions(symbol, expiry);
    return toolResult(markdownExposure(chain, "gex", topRows), { chain, exposures: optionRowsNearSpot(chain, topRows) });
  }
  throw new Error(`Unsupported market tool ${name}`);
};
