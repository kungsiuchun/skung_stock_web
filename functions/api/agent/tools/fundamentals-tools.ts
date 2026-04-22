/**
 * Agent Framework — Fundamentals Tools
 * Provides access to Alpha Vantage fundamental data (Overview, Income, Balance, Cashflow).
 * Includes simple memory caching / rate limit protection for the Free Tier (5 req/min).
 */

import type { ToolDefinition } from "../types";

// ── Rate Limiter & Cache ─────────────────────────────────────

class AlphaVantageClient {
  private static cache = new Map<string, { data: any; timestamp: number }>();
  private static CACHE_TTL = 60 * 60 * 1000; // 1 hr cache
  
  // Rate limiting state
  private static requestQueue: Array<() => void> = [];
  private static isProcessing = false;
  private static lastRequestTime = 0;
  private static MIN_DELAY_MS = 12000; // 12 seconds between requests (5/min)

  private static enqueueRequest(): Promise<void> {
    return new Promise((resolve) => {
      this.requestQueue.push(resolve);
      this.processQueue();
    });
  }

  private static async processQueue() {
    if (this.isProcessing || this.requestQueue.length === 0) return;
    this.isProcessing = true;

    while (this.requestQueue.length > 0) {
      const now = Date.now();
      const timeSinceLast = now - this.lastRequestTime;
      
      if (timeSinceLast < this.MIN_DELAY_MS) {
        await new Promise(r => setTimeout(r, this.MIN_DELAY_MS - timeSinceLast));
      }

      const resolve = this.requestQueue.shift();
      this.lastRequestTime = Date.now();
      if (resolve) resolve();
    }
    
    this.isProcessing = false;
  }

  static async fetch(func: string, symbol: string, apiKey: string) {
    const cacheKey = `${func}_${symbol}`;
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
      console.log(`[AlphaVantage] Cache hit for ${cacheKey}`);
      return cached.data;
    }

    console.log(`[AlphaVantage] Waiting in queue for ${cacheKey}...`);
    await this.enqueueRequest();

    const url = `https://www.alphavantage.co/query?function=${func}&symbol=${symbol}&apikey=${apiKey}`;
    console.log(`[AlphaVantage] Fetching ${func} for ${symbol}`);
    
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`API returned ${res.status}`);
    }

    const data = await res.json() as any;
    
    // Alpha Vantage returns "Information" if rate limited
    if (data.Information && typeof data.Information === 'string' && data.Information.includes("rate limit")) {
      throw new Error("AlphaVantage Rate Limit Exceeded (5 req/min). Please try again later.");
    }
    if (data.Note && typeof data.Note === 'string' && data.Note.includes("API call frequency")) {
      throw new Error("AlphaVantage Rate Limit Exceeded. Please try again later.");
    }

    this.cache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  }
}

function getApiKey(env?: any): string {
  // Using user provided key as fallback
  return env?.ALPHA_VANTAGE_API_KEY || "DVN3696NDAQ7B417";
}

// ── Tool 1: get_company_overview ─────────────────────────────

async function handleGetCompanyOverview(args: Record<string, any>, env?: any): Promise<Record<string, any>> {
  const symbol = (args.stock_code as string || "").toUpperCase();
  if (!symbol) return { error: "No stock_code provided" };

  try {
    const data = await AlphaVantageClient.fetch("OVERVIEW", symbol, getApiKey(env));
    if (!data.Symbol) return { error: `No overview data found for ${symbol}` };

    return {
      symbol: data.Symbol,
      name: data.Name,
      description: data.Description,
      sector: data.Sector,
      industry: data.Industry,
      market_cap: data.MarketCapitalization,
      pe_ratio: data.PERatio,
      peg_ratio: data.PEGRatio,
      book_value: data.BookValue,
      dividend_yield: data.DividendYield,
      eps: data.EPS,
      profit_margin: data.ProfitMargin,
      operating_margin: data.OperatingMarginTTM,
      return_on_equity: data.ReturnOnEquityTTM,
      analyst_target_price: data.AnalystTargetPrice,
      week52_high: data["52WeekHigh"],
      week52_low: data["52WeekLow"],
    };
  } catch (err: any) {
    return { error: err.message };
  }
}

// ── Tool 2: get_income_statement ─────────────────────────────

async function handleGetIncomeStatement(args: Record<string, any>, env?: any): Promise<Record<string, any>> {
  const symbol = (args.stock_code as string || "").toUpperCase();
  if (!symbol) return { error: "No stock_code provided" };

  try {
    const data = await AlphaVantageClient.fetch("INCOME_STATEMENT", symbol, getApiKey(env));
    if (!data.annualReports || data.annualReports.length === 0) return { error: `No income statement found for ${symbol}` };

    const recent = data.annualReports.slice(0, 3).map((r: any) => ({
      fiscalDateEnding: r.fiscalDateEnding,
      totalRevenue: r.totalRevenue,
      grossProfit: r.grossProfit,
      operatingIncome: r.operatingIncome,
      netIncome: r.netIncome,
      researchAndDevelopment: r.researchAndDevelopment,
    }));

    return { symbol: data.symbol, annual_reports: recent };
  } catch (err: any) {
    return { error: err.message };
  }
}

// ── Tool 3: get_balance_sheet ────────────────────────────────

async function handleGetBalanceSheet(args: Record<string, any>, env?: any): Promise<Record<string, any>> {
  const symbol = (args.stock_code as string || "").toUpperCase();
  if (!symbol) return { error: "No stock_code provided" };

  try {
    const data = await AlphaVantageClient.fetch("BALANCE_SHEET", symbol, getApiKey(env));
    if (!data.annualReports || data.annualReports.length === 0) return { error: `No balance sheet found for ${symbol}` };

    const recent = data.annualReports.slice(0, 3).map((r: any) => ({
      fiscalDateEnding: r.fiscalDateEnding,
      totalAssets: r.totalAssets,
      totalLiabilities: r.totalLiabilities,
      totalShareholderEquity: r.totalShareholderEquity,
      cashAndCashEquivalentsAtCarryingValue: r.cashAndCashEquivalentsAtCarryingValue,
      shortTermDebt: r.shortTermDebt,
      longTermDebt: r.longTermDebt,
    }));

    return { symbol: data.symbol, annual_reports: recent };
  } catch (err: any) {
    return { error: err.message };
  }
}

// ── Export Tools ─────────────────────────────────────────────

export const ALL_FUNDAMENTALS_TOOLS: ToolDefinition[] = [
  {
    name: "get_company_overview",
    description: "Fetch comprehensive company profile and fundamental valuation metrics (P/E, EPS, Margin, etc.).",
    parameters: [{ name: "stock_code", type: "string", description: "Stock ticker symbol (e.g., AAPL)" }],
    handler: handleGetCompanyOverview,
    category: "fundamentals",
  },
  {
    name: "get_income_statement",
    description: "Fetch annual income statements for the last 3 years to track revenue and net income.",
    parameters: [{ name: "stock_code", type: "string", description: "Stock ticker symbol (e.g., AAPL)" }],
    handler: handleGetIncomeStatement,
    category: "fundamentals",
  },
  {
    name: "get_balance_sheet",
    description: "Fetch annual balance sheets for the last 3 years to analyze assets and debt.",
    parameters: [{ name: "stock_code", type: "string", description: "Stock ticker symbol (e.g., AAPL)" }],
    handler: handleGetBalanceSheet,
    category: "fundamentals",
  }
];
