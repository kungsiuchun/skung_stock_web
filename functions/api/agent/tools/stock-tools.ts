/**
 * Agent Framework — Stock Tools
 * Mirrors the Python blueprint's data_tools.py and analysis_tools.py.
 *
 * Tools:
 *   1. get_realtime_quote  — Fetch latest stock data from Yahoo Finance
 *   2. calculate_ma        — Compute moving averages from price history
 */

import type { ToolDefinition } from "../types";

// ── Yahoo Session Manager ──────────────────────────────────────────

class YahooSessionManager {
  private static cookie: string | null = null;
  private static crumb: string | null = null;
  private static lastFetch: number = 0;
  private static CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  static async getSession() {
    const now = Date.now();
    if (this.cookie && this.crumb && (now - this.lastFetch < this.CACHE_TTL)) {
      return { cookie: this.cookie, crumb: this.crumb };
    }

    console.log("[YahooSessionManager] Fetching new session...");
    
    // 1. Get Cookie from a standard page
    const fcRes = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
    });
    
    // In Workers, headers.get('set-cookie') returns all cookies separated by commas
    const setCookie = fcRes.headers.get("set-cookie");
    if (!setCookie) throw new Error("Failed to get Set-Cookie from Yahoo");
    
    this.cookie = setCookie;

    // 2. Get Crumb
    const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Cookie": this.cookie
      }
    });

    if (!crumbRes.ok) throw new Error(`Failed to get crumb: ${crumbRes.status} ${await crumbRes.text()}`);
    this.crumb = (await crumbRes.text()).trim();
    this.lastFetch = now;

    return { cookie: this.cookie, crumb: this.crumb };
  }
}

// ── Tool 1: get_realtime_quote ─────────────────────────────────────

async function handleGetRealtimeQuote(args: Record<string, any>): Promise<Record<string, any>> {
  const symbol = (args.stock_code as string || "").toUpperCase();
  if (!symbol) {
    return { error: "No stock_code provided" };
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
  console.log(`[Tool:get_realtime_quote] Fetching ${url}`);

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (!res.ok) {
    return { error: `Yahoo Finance API returned ${res.status}` };
  }

  const data = await res.json();
  const result = data.chart?.result?.[0];
  if (!result) {
    return { error: `No data found for ${symbol}` };
  }

  const meta = result.meta || {};
  const quote = result.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const volumes = quote.volume || [];

  const latestClose = closes[closes.length - 1];
  const prevClose = meta.chartPreviousClose || meta.previousClose;
  const changePct = prevClose ? (((latestClose - prevClose) / prevClose) * 100).toFixed(2) : "N/A";

  return {
    symbol,
    name: meta.longName || meta.shortName || symbol,
    currency: meta.currency || "USD",
    price: typeof latestClose === "number" ? latestClose : null,
    previous_close: typeof prevClose === "number" ? prevClose : null,
    change_pct: typeof changePct === "string" ? parseFloat(changePct) : 0,
    volume: typeof volumes[volumes.length - 1] === "number" ? volumes[volumes.length - 1] : 0,
    exchange: meta.exchangeName || "N/A",
    market_state: meta.marketState || "N/A",
  };
}

const getRealtimeQuoteTool: ToolDefinition = {
  name: "get_realtime_quote",
  description:
    "Get real-time stock quote including current price, change percentage, volume, and market state. Use this to check the latest price of any stock.",
  parameters: [
    {
      name: "stock_code",
      type: "string",
      description: "Stock ticker symbol, e.g. 'AAPL', 'NVDA', 'TSLA', '0005.HK'",
    },
  ],
  handler: handleGetRealtimeQuote,
  category: "data",
};

// ── Tool 2: get_daily_history ──────────────────────────────────────

async function handleGetDailyHistory(args: Record<string, any>): Promise<Record<string, any>> {
  const symbol = (args.stock_code as string || "").toUpperCase();
  const days = (args.days as number) || 20;

  if (!symbol) {
    return { error: "No stock_code provided" };
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${days}d`;
  console.log(`[Tool:get_daily_history] Fetching ${url}`);

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (!res.ok) {
    return { error: `Yahoo Finance API returned ${res.status}` };
  }

  const data = await res.json();
  const result = data.chart?.result?.[0];
  if (!result) {
    return { error: `No history data for ${symbol}` };
  }

  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const volumes = quote.volume || [];

  const rows = [];
  for (let i = 0; i < timestamps.length; i++) {
    rows.push({
      date: new Date(timestamps[i] * 1000).toISOString().split("T")[0],
      open: typeof opens[i] === "number" ? opens[i] : 0,
      high: typeof highs[i] === "number" ? highs[i] : 0,
      low: typeof lows[i] === "number" ? lows[i] : 0,
      close: typeof closes[i] === "number" ? closes[i] : 0,
      volume: typeof volumes[i] === "number" ? volumes[i] : 0,
    });
  }

  return {
    symbol,
    period: `${days}d`,
    data_points: rows.length,
    history: rows,
  };
}

const getDailyHistoryTool: ToolDefinition = {
  name: "get_daily_history",
  description:
    "Get historical daily OHLCV (Open/High/Low/Close/Volume) candlestick data for a stock. Returns an array of daily records. Use this for technical analysis.",
  parameters: [
    {
      name: "stock_code",
      type: "string",
      description: "Stock ticker symbol, e.g. 'AAPL', 'NVDA'",
    },
    {
      name: "days",
      type: "integer",
      description: "Number of days of history to fetch (default 20)",
      required: false,
      default: 20,
    },
  ],
  handler: handleGetDailyHistory,
  category: "data",
};

// ── Tool 3: calculate_ma ───────────────────────────────────────────

async function handleCalculateMA(args: Record<string, any>): Promise<Record<string, any>> {
  const symbol = (args.stock_code as string || "").toUpperCase();
  const periods = (args.periods as number[]) || [5, 10, 20];

  if (!symbol) {
    return { error: "No stock_code provided" };
  }

  // Fetch enough data
  const maxPeriod = Math.max(...periods);
  const fetchDays = maxPeriod + 10; // extra buffer
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${fetchDays}d`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (!res.ok) {
    return { error: `Yahoo Finance API returned ${res.status}` };
  }

  const data = await res.json();
  const result = data.chart?.result?.[0];
  if (!result) {
    return { error: `No data for ${symbol}` };
  }

  const closes: number[] = (result.indicators?.quote?.[0]?.close || []).filter(
    (c: any) => c !== null
  );

  if (closes.length === 0) {
    return { error: "No closing prices available" };
  }

  // Calculate MAs
  const maResults: Record<string, any> = {};
  for (const period of periods) {
    if (closes.length >= period) {
      const slice = closes.slice(closes.length - period);
      const avg = slice.reduce((a, b) => a + b, 0) / period;
      maResults[`MA${period}`] = Number(avg.toFixed(2));
    } else {
      maResults[`MA${period}`] = null;
    }
  }

  const currentPrice = closes[closes.length - 1];

  // Determine MA arrangement
  const maValues = periods
    .filter((p) => closes.length >= p)
    .map((p) => {
      const slice = closes.slice(closes.length - p);
      return slice.reduce((a, b) => a + b, 0) / p;
    });

  let arrangement = "mixed";
  if (maValues.length >= 2) {
    const allAscending = maValues.every((v, i) => i === 0 || v <= maValues[i - 1]);
    const allDescending = maValues.every((v, i) => i === 0 || v >= maValues[i - 1]);
    if (allAscending) arrangement = "bullish (短期均線在上)";
    if (allDescending) arrangement = "bearish (短期均線在下)";
  }

  return {
    symbol,
    current_price: currentPrice.toFixed(2),
    moving_averages: maResults,
    ma_arrangement: arrangement,
    data_points_used: closes.length,
  };
}

const calculateMATool: ToolDefinition = {
  name: "calculate_ma",
  description:
    "Calculate moving averages (MA) for a stock. Returns MA values for the specified periods and determines bullish/bearish arrangement. Use this to evaluate trend direction.",
  parameters: [
    {
      name: "stock_code",
      type: "string",
      description: "Stock ticker symbol, e.g. 'AAPL'",
    },
    {
      name: "periods",
      type: "array",
      description: "Array of MA periods to calculate, e.g. [5, 10, 20]",
      required: false,
      default: [5, 10, 20],
    },
  ],
  handler: handleCalculateMA,
  category: "analysis",
};

// ── Tool 4: get_options_chain ──────────────────────────────────────

async function handleGetOptionsChain(args: Record<string, any>): Promise<Record<string, any>> {
  const symbol = (args.stock_code as string || "").toUpperCase();
  const expiration = args.expiration as number; // Optional Unix timestamp

  if (!symbol) return { error: "No stock_code provided" };

  let url = `https://query1.finance.yahoo.com/v7/finance/options/${symbol}`;
  
  try {
    const { cookie, crumb } = await YahooSessionManager.getSession();
    url += `?crumb=${crumb}`;
    if (expiration) url += `&date=${expiration}`;

    console.log(`[Tool:get_options_chain] Fetching ${url}`);

    const res = await fetch(url, { 
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Cookie": cookie
      } 
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      return { error: `Yahoo Finance API (Options) returned ${res.status}: ${errorText}` };
    }

    const data = await res.json();
    const result = data.optionChain?.result?.[0];
    if (!result) return { error: `No options data for ${symbol}` };

  const options = result.options?.[0] || {};
  return {
    symbol,
    underlying_price: result.quote?.regularMarketPrice,
    expiration_dates: result.expirationDates,
    current_expiration: options.expirationDate,
    calls: (options.calls || []).slice(0, 10).map((c: any) => ({
      strike: c.strike,
      last_price: c.lastPrice,
      bid: c.bid,
      ask: c.ask,
      volume: c.volume,
      open_interest: c.openInterest,
      implied_volatility: (c.impliedVolatility * 100).toFixed(2) + "%"
    })),
    puts: (options.puts || []).slice(0, 10).map((p: any) => ({
      strike: p.strike,
      last_price: p.lastPrice,
      bid: p.bid,
      ask: p.ask,
      volume: p.volume,
      open_interest: p.openInterest,
      implied_volatility: (p.impliedVolatility * 100).toFixed(2) + "%"
    })),
  };
  } catch (err: any) {
    console.error("[Tool:get_options_chain] Session error:", err);
    return { error: `Failed to acquire Yahoo session: ${err.message}` };
  }
}

const getOptionsChainTool: ToolDefinition = {
  name: "get_options_chain",
  description: "Fetch the options chain (calls and puts) for a stock. Returns a list of strikes, prices, and open interest. Use this to analyze market sentiment or hedge positions.",
  parameters: [
    {
      name: "stock_code",
      type: "string",
      description: "Stock ticker symbol, e.g. 'AAPL'",
    },
    {
      name: "expiration",
      type: "integer",
      description: "Optional: Unix timestamp for a specific expiration date. If not provided, returns the nearest expiration.",
      required: false,
    },
  ],
  handler: handleGetOptionsChain,
  category: "data",
};

// ── Tool 5: get_financial_summary ──────────────────────────────────

async function handleGetFinancialSummary(args: Record<string, any>): Promise<Record<string, any>> {
  const symbol = (args.stock_code as string || "").toUpperCase();
  if (!symbol) return { error: "No stock_code provided" };

  const modules = "financialData,defaultKeyStatistics,incomeStatementHistory";
  let url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=${modules}`;

  try {
    const { cookie, crumb } = await YahooSessionManager.getSession();
    url += `&crumb=${crumb}`;

    console.log(`[Tool:get_financial_summary] Fetching ${url}`);

    const res = await fetch(url, { 
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Cookie": cookie
      } 
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      return { error: `Yahoo Finance API (Financials) returned ${res.status}: ${errorText}` };
    }

    const data = await res.json();
    const summary = data.quoteSummary?.result?.[0];
    if (!summary) return { error: `No financial summary for ${symbol}` };

  const fin = summary.financialData || {};
  const stats = summary.defaultKeyStatistics || {};
  const income = summary.incomeStatementHistory?.incomeStatementHistory?.[0] || {};

  return {
    symbol,
    financial_metrics: {
      current_price: fin.currentPrice?.raw,
      target_mean_price: fin.targetMeanPrice?.raw,
      recommendation: fin.recommendationKey,
      total_cash: fin.totalCash?.fmt,
      total_debt: fin.totalDebt?.fmt,
      revenue_growth: fin.revenueGrowth?.fmt,
      profit_margins: fin.profitMargins?.fmt,
    },
    valuation: {
      forward_pe: stats.forwardPE?.fmt,
      trailing_pe: stats.trailingPE?.fmt,
      peg_ratio: stats.pegRatio?.fmt,
      price_to_book: stats.priceToBook?.fmt,
      beta: stats.beta?.fmt,
    },
    recent_income_statement: {
      total_revenue: income.totalRevenue?.fmt,
      gross_profit: income.grossProfit?.fmt,
      net_income: income.netIncome?.fmt,
      operating_income: income.operatingIncome?.fmt,
    }
  };
  } catch (err: any) {
    console.error("[Tool:get_financial_summary] Session error:", err);
    return { error: `Failed to acquire Yahoo session: ${err.message}` };
  }
}

const getFinancialSummaryTool: ToolDefinition = {
  name: "get_financial_summary",
  description: "Get a comprehensive financial summary of a company, including key valuation metrics (P/E, PEG), balance sheet health (Cash, Debt), and recent income statement figures. Use this for fundamental analysis.",
  parameters: [
    {
      name: "stock_code",
      type: "string",
      description: "Stock ticker symbol, e.g. 'TSLA'",
    },
  ],
  handler: handleGetFinancialSummary,
  category: "data",
};

// ── Export All Tools ────────────────────────────────────────────────

export const ALL_STOCK_TOOLS: ToolDefinition[] = [
  getRealtimeQuoteTool,
  getDailyHistoryTool,
  calculateMATool,
  getOptionsChainTool,
  getFinancialSummaryTool,
];
