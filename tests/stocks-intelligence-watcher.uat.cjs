const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const puppeteer = require("puppeteer");

const rootDir = path.resolve(__dirname, "..");
const port = 5174;
const baseUrl = `http://127.0.0.1:${port}`;
const screenshotsDir = path.join(rootDir, "uat_screenshots", "stocks-watcher-replica");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stopProcessTree = (processToStop) => new Promise((resolve) => {
  if (!processToStop || processToStop.killed) {
    resolve();
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(processToStop.pid), "/T", "/F"], { stdio: "ignore" });
    killer.on("close", () => resolve());
    killer.on("error", () => resolve());
    return;
  }

  processToStop.kill();
  resolve();
});

const waitForServer = async () => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      await wait(250);
    }
  }
  throw new Error(`Vite did not start on ${baseUrl}`);
};

const expiries = ["2026-07-08", "2026-07-10", "2026-07-13", "2026-07-17", "2026-07-24", "2026-07-31", "2026-08-07", "2026-08-14"];
const uatStocks = [
  ["NVDA", "NVIDIA Corporation", "Semiconductors", "Stock", 204.12, 4.03, 2.01],
  ["GOOG", "Alphabet Inc.", "Communication Services", "Stock", 376.43, -9.69, -2.51],
  ["GOOGL", "Alphabet Inc.", "Communication Services", "Stock", 380.34, -9.79, -2.51],
  ["AAPL", "Apple Inc.", "Technology", "Stock", 312.06, -0.45, -0.14],
  ["MSFT", "Microsoft Corporation", "Technology", "Stock", 450.24, 23.25, 5.45],
  ["AMZN", "Amazon.com Inc.", "Consumer Discretionary", "Stock", 270.64, -3.36, -1.23],
  ["AVGO", "Broadcom Inc.", "Semiconductors", "Stock", 446.77, 20.19, 4.73],
  ["TSLA", "Tesla Inc.", "Consumer Discretionary", "Stock", 435.79, -6.31, -1.43],
  ["META", "Meta Platforms Inc.", "Communication Services", "Stock", 632.51, -2.78, -0.44],
  ["QQQI", "NEOS Nasdaq-100 High Income ETF", "Income ETFs", "ETF", 50.42, 0.18, 0.36],
];

const stockRecords = uatStocks.map(([symbol, companyName, sector, type, fallbackPrice, fallbackChange, fallbackChangePercent]) => ({
  symbol,
  companyName,
  sector,
  type,
  fallbackPrice,
  fallbackChange,
  fallbackChangePercent,
}));

const fmtDate = (date) => date.replaceAll("-", "").slice(2);

const buildSnapshot = (symbol, overrides = {}) => {
  const stock = stockRecords.find((item) => item.symbol === symbol) || {
    symbol,
    companyName: `${symbol} custom stock`,
    sector: "Custom",
    type: "Stock",
    fallbackPrice: 88.42,
    fallbackChange: 1.18,
    fallbackChangePercent: 1.35,
  };
  const quoteBase = symbol === "TSLA"
    ? { price: 406.55, previousClose: 394.06, change: 12.49, changePercent: 3.17 }
    : { price: stock.fallbackPrice, previousClose: 200.09, change: stock.fallbackChange, changePercent: stock.fallbackChangePercent };
  const price = (typeof overrides.price === "number" ? overrides.price : quoteBase.price) + (overrides.priceOffset || 0);
  const previousClose = typeof overrides.previousClose === "number" ? overrides.previousClose : quoteBase.previousClose;
  const change = (typeof overrides.change === "number" ? overrides.change : quoteBase.change) + (overrides.changeOffset || 0);
  const changePercent = (typeof overrides.changePercent === "number" ? overrides.changePercent : quoteBase.changePercent) + (overrides.changePercentOffset || 0);
  const isRobinhoodOptions = symbol === "NVDA";
  const strikes = Array.from({ length: 29 }, (_, index) => {
    const strike = 170 + index * 2.5;
    const callVolume = Math.max(50, Math.round(2400 - Math.abs(strike - price) * 28));
    const putVolume = Math.max(45, Math.round(1800 - Math.abs(strike - price) * 21));
    return {
      strike,
      callOpenInterest: callVolume * 6,
      putOpenInterest: putVolume * 5,
      callVolume,
      putVolume,
      callGex: Math.round(callVolume * strike * 500),
      putGex: -Math.round(putVolume * strike * 430),
      netGex: Math.round(callVolume * strike * 500 - putVolume * strike * 430),
    };
  });

  return {
    generatedAt: "2026-07-08T21:33:00.000Z",
    symbol,
    quote: {
      symbol,
      companyName: stock.companyName,
      price,
      open: 195.18,
      high: 205.15,
      low: 195.11,
      previousClose,
      change,
      changePercent,
      asOf: "2026-07-08T20:00:00.000Z",
    },
    spot: price,
    atm: Math.round(price / 5) * 5,
    selectedTimeLabel: "live",
    gexRegime: "Pinning",
    putCallOpenInterest: 0.82,
    putCallVolume: 0.78,
    sweeps: 0,
    availableExpiries: expiries,
    selectedExpiry: expiries[0],
    expiryRows: expiries.slice(0, isRobinhoodOptions ? expiries.length : 1).map((expiry, index) => ({
      expiry,
      openInterest: index === 0 ? 331_000 : 7_400,
      primaryStrike: index === 0 ? 200 : 235,
      strike: index === 0 ? 200 : 235,
      volume: index === 0 ? 2_800_000 : 1_400,
      dominantType: "C",
      type: "C",
      netGex: index % 2 === 0 ? 24_000_000 + index * 1_000_000 : -(8_000_000 + index * 1_000_000),
      netDex: index % 2 === 0 ? 96_000_000 + index * 2_000_000 : -(34_000_000 + index * 2_000_000),
    })),
    expiries: expiries.slice(0, isRobinhoodOptions ? expiries.length : 1).map((expiry, index) => ({
      expiry,
      openInterest: index === 0 ? 331_000 : 7_400,
      primaryStrike: index === 0 ? 200 : 235,
      strike: index === 0 ? 200 : 235,
      volume: index === 0 ? 2_800_000 : 1_400,
      dominantType: "C",
      type: "C",
      netGex: index % 2 === 0 ? 24_000_000 + index * 1_000_000 : -(8_000_000 + index * 1_000_000),
      netDex: index % 2 === 0 ? 96_000_000 + index * 2_000_000 : -(34_000_000 + index * 2_000_000),
    })),
    strikes,
    history: [
      { date: "2026-07-09T13:30:00.000Z", label: "9:30", price: price - 4.03 },
      { date: "2026-07-09T14:30:00.000Z", label: "10:30", price: price - 2.1 },
      { date: "2026-07-09T15:30:00.000Z", label: "11:30", price: price - 3.2 },
      { date: "2026-07-09T16:30:00.000Z", label: "12:30", price: price + 0.4 },
      { date: "2026-07-09T17:00:00.000Z", label: "1:00", price },
    ],
    recentNews: [
      { title: "NVDA Stock Ready For A Comeback", publisher: "Stocktwits", link: "https://finance.yahoo.com/nvda-1", publishedAt: "2026-07-09T03:56:47.000Z" },
      { title: "Dow Jones Futures Put Nvidia In Focus", publisher: "Investor's Business Daily", link: "https://finance.yahoo.com/nvda-2", publishedAt: "2026-07-09T05:19:03.000Z" },
      { title: "Analysts lift NVIDIA targets", publisher: "Yahoo Finance", link: "https://finance.yahoo.com/nvda-3", publishedAt: "2026-07-09T02:30:00.000Z" },
    ],
    earnings: {
      source: "Yahoo quoteSummary calendarEvents + earningsHistory",
      nextEarningsDate: "2026-08-26",
      nextEpsEstimate: 2.08,
      nextRevenueEstimate: "91.73B",
      lastEarningsDate: "2026-05-20",
      lastReportedQuarter: "2026-04-30",
      epsActual: 1.87,
      epsEstimate: 1.77,
      epsDifference: 0.1,
      surprisePercent: 5.54,
      result: "beat",
      priceMove: {
        eventTradingDate: "2026-05-20",
        previousClose: 220.61,
        close: 223.47,
        changePercent: 1.3,
        basis: "close_to_close",
      },
    },
    valuation: {
      schemaVersion: "1.0",
      source: "ValuationCalculation hybrid valuation model",
      symbol,
      generatedAt: "2026-07-09T21:33:00.000Z",
      dataAsOf: "2026-07-09",
      metric: "pe",
      window: "3Y",
      latest: { date: "2026-07-09", price, bands: { mean: price - 15, up1: price + 20, up2: price + 40, down1: price - 35, down2: price - 55 } },
      points: [],
    },
    financials: {
      date: "2026-06-30", filingDate: "2026-07-16", fiscalYear: "2026", period: "Q2", currency: "USD",
      revenue: 100_000_000, netIncome: 20_000_000, eps: 2, operatingCashFlow: 30_000_000, freeCashFlow: 15_000_000,
      revenue_qoq: 1, revenue_yoy: 10, netIncome_qoq: 2, netIncome_yoy: 11, eps_qoq: 2, eps_yoy: 11, operatingCashFlow_qoq: 3, operatingCashFlow_yoy: 12,
    },
    marketContext: {
      breadth: "Watcher breadth mock response.",
      relativeStrength: "Relative strength mock response.",
    },
    availableTools: [
      { name: "quoteSummary", description: "Yahoo quote summary", inputKeys: ["ticker"] },
      { name: "financialData", description: "Yahoo financial data", inputKeys: ["ticker"] },
      { name: "get_intraday", description: "Yahoo intraday chart", inputKeys: ["ticker"] },
      { name: "get_options", description: "Yahoo options chain", inputKeys: ["ticker", "expiry"] },
      { name: "get_options_gex", description: "Local GEX proxy", inputKeys: ["ticker", "expiry"] },
      { name: "get_options_greeks", description: "Local Greek approximation", inputKeys: ["ticker", "expiry", "strike"] },
      { name: "get_options_iv_intraday", description: "IV snapshot", inputKeys: ["ticker", "expiry"] },
      { name: "get_options_mispricing", description: "Mispricing scan", inputKeys: ["ticker", "expiry"] },
      { name: "get_valuation_bands", description: "Published valuation bands", inputKeys: ["symbol", "metric", "window"] },
      { name: "get_financial_statements", description: "Published financial statements", inputKeys: ["symbol", "periods"] },
    ],
    toolRuns: [
      { name: "get_quotes", status: "ok", detail: "mocked" },
      { name: "get_options", status: "ok", detail: "mocked" },
    ],
    warnings: [],
    ...(isRobinhoodOptions ? {
      optionsSnapshot: {
        provider: "robinhood_mcp",
        methodology: "OI-signed GEX proxy",
        runId: "rh-eod-uat",
        capturedAt: "2026-07-09T20:59:27.540Z",
        expectedSymbols: 50,
        completedSymbols: 50,
      },
    } : {}),
    source: "native_yahoo",
  };
};

const optionRows = (price = 204.12) => {
  return Array.from({ length: 13 }, (_, index) => {
    const strike = 190 + index * 2.5;
    const callVolume = Math.max(100, Math.round(3400 - Math.abs(strike - price) * 60));
    const putVolume = Math.max(80, Math.round(2800 - Math.abs(strike - price) * 54));
    const netGex = Math.round((callVolume - putVolume) * strike * 620);
    return {
      strike,
      callOpenInterest: callVolume * 6,
      putOpenInterest: putVolume * 5,
      callVolume,
      putVolume,
      callEffectiveOpenInterest: callVolume * 6,
      putEffectiveOpenInterest: putVolume * 5,
      callGex: Math.round(callVolume * strike * 640),
      putGex: -Math.round(putVolume * strike * 610),
      netGex,
      callDex: Math.round(callVolume * 43),
      putDex: -Math.round(putVolume * 39),
      netDex: Math.round(callVolume * 43 - putVolume * 39),
      callIv: 24 + index * 0.9,
      putIv: 25 + index * 0.8,
      avgIv: 25 + index * 0.85,
      call: { strike, bid: 10 + index, ask: 10.35 + index, volume: callVolume, openInterest: callVolume * 6, impliedVolatility: 24 + index * 0.9 },
      put: { strike, bid: 8 + index, ask: 8.35 + index, volume: putVolume, openInterest: putVolume * 5, impliedVolatility: 25 + index * 0.8 },
    };
  });
};

const historyRows = () => Array.from({ length: 90 }, (_, index) => ({
  date: `2026-07-${String(1 + Math.floor(index / 12)).padStart(2, "0")}T${String(9 + (index % 12)).padStart(2, "0")}:30:00.000Z`,
  open: 195 + Math.sin(index / 5) * 3 + index * 0.08,
  high: 196 + Math.sin(index / 5) * 3 + index * 0.08,
  low: 194 + Math.sin(index / 5) * 3 + index * 0.08,
  close: 195.5 + Math.sin(index / 5) * 3 + index * 0.08,
  volume: 1_000_000 + index * 12_000,
}));

let refreshAllMode = false;
let delayedSnapshotSymbol = null;

const buildToolResponse = (tool, params = {}) => {
  if (tool === "get_watchlist") {
    return { ok: true, tool, params, text: "watchlist", raw: { stocks: stockRecords }, calledAt: "2026-07-08T21:33:01.000Z" };
  }

  if (tool === "save_memory") {
    return { ok: true, tool, params, text: "saved", raw: { saved: true }, calledAt: "2026-07-08T21:33:02.000Z" };
  }

  if (tool === "get_quotes") {
    const symbols = String(params.tickers || "NVDA").split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);
    const quotes = symbols.map((symbol) => {
      const stock = stockRecords.find((item) => item.symbol === symbol) || {
        symbol,
        companyName: `${symbol} custom stock`,
        fallbackPrice: 88.42,
        fallbackChange: 1.18,
        fallbackChangePercent: 1.35,
      };
      const shouldMove = refreshAllMode && ["GOOG", "AAPL", "MSFT"].includes(symbol);
      const quoteBase = symbol === "TSLA"
        ? { price: 406.55, previousClose: 394.06, change: 12.49, changePercent: 3.17 }
        : symbol === "META"
          ? { price: stock.fallbackPrice, previousClose: stock.fallbackPrice, change: 0, changePercent: 0 }
        : { price: stock.fallbackPrice, previousClose: null, change: stock.fallbackChange, changePercent: stock.fallbackChangePercent };
      const quote = {
        symbol,
        name: stock.companyName,
        price: quoteBase.price + (shouldMove ? 7.77 : 0),
        previousClose: quoteBase.previousClose,
        change: quoteBase.change + (shouldMove ? 7.77 : 0),
        changePercent: quoteBase.changePercent + (shouldMove ? 1.11 : 0),
        asOf: "2026-07-09T20:00:00.000Z",
      };
      if (symbol === "QQQI") {
        delete quote.change;
        delete quote.changePercent;
      }
      return quote;
    });
    return { ok: true, tool, params, text: "quotes", raw: { quotes }, calledAt: "2026-07-09T20:00:00.000Z" };
  }

  if (tool === "get_macro_regime") {
    return { ok: true, tool, params, text: "macro regime", raw: { regime: "risk_on", advancers: 4, avgChange: 1.27, universeCount: 5 }, calledAt: "2026-07-09T20:00:00.000Z" };
  }

  if (tool === "market_breadth") {
    return { ok: true, tool, params, text: "market breadth", raw: { quotes: [
      { symbol: "AAA", name: "Alpha", price: 100, change: 2.1, changePercent: 2.1, volume: 1000 },
      { symbol: "BBB", name: "Beta", price: 100, change: 1.5, changePercent: 1.5, volume: 1000 },
      { symbol: "CCC", name: "Gamma", price: 100, change: 1.1, changePercent: 1.1, volume: 1000 },
      { symbol: "DDD", name: "Delta", price: 100, change: 0.7, changePercent: 0.7, volume: 1000 },
      { symbol: "EEE", name: "Epsilon", price: 100, change: -0.4, changePercent: -0.4, volume: 1000 },
    ] }, calledAt: "2026-07-09T20:00:00.000Z" };
  }

  if (tool === "get_sector_stats") {
    const sectorStats = refreshAllMode
      ? [
          { sector: "Technology", count: 3, avgChangePercent: 2.75, dollarVolume: 9000000 },
          { sector: "Consumer Discretionary", count: 2, avgChangePercent: -1.25, dollarVolume: 3000000 },
        ]
      : [{ sector: "Stale cache sector", count: 99, avgChangePercent: -9.99, dollarVolume: 1 }];
    return { ok: true, tool, params, text: "sector stats", raw: { sectorStats }, calledAt: "2026-07-09T20:00:00.000Z" };
  }

  if (tool === "get_sector_top_holdings") {
    return { ok: true, tool, params, text: "sector top holdings", raw: { holdings: [
      { symbol: "LEAD", sector: "Technology", price: 100, changePercent: 4.2, volume: 1000 },
      { symbol: "GAIN", sector: "Technology", price: 100, changePercent: 2.5, volume: 1000 },
      { symbol: "UP", sector: "Technology", price: 100, changePercent: 0.8, volume: 1000 },
      { symbol: "DOWN", sector: "Consumer Discretionary", price: 100, changePercent: -0.4, volume: 1000 },
      { symbol: "LOSS", sector: "Consumer Discretionary", price: 100, changePercent: -2.7, volume: 1000 },
    ] }, calledAt: "2026-07-09T20:00:00.000Z" };
  }

  if (tool === "get_intraday" || tool === "get_stock_history") {
    return { ok: true, tool, params, text: "history", raw: { history: historyRows() }, calledAt: "2026-07-08T21:33:03.000Z" };
  }

  const rows = optionRows();
  if (tool === "get_options") {
    const zeroOi = params.ticker === "TSLA";
    const robinhood = params.ticker === "NVDA";
    const rhLeg = (row, side) => ({
      strike: row.strike,
      volume: row[side].volume,
      openInterest: row[side].openInterest,
      impliedVolatility: row[side].impliedVolatility / 100,
      gamma: side === "call" ? 0.02 : 0.018,
      delta: side === "call" ? 0.52 : -0.48,
      mark: row[side].bid + 0.1,
      lastPrice: row[side].bid + 0.1,
      multiplier: 100,
      quoteUpdatedAt: "2026-07-09T20:59:27.540Z",
    });
    const chain = {
      symbol: params.ticker || "NVDA",
      spot: 204.12,
      expiries,
      selectedExpiry: params.expiry || expiries[0],
      calls: rows.map((row) => robinhood ? rhLeg(row, "call") : ({ ...row.call, openInterest: zeroOi ? 0 : row.call.openInterest })),
      puts: rows.map((row) => robinhood ? rhLeg(row, "put") : ({ ...row.put, openInterest: zeroOi ? 0 : row.put.openInterest })),
    };
    const provenance = params.ticker === "NVDA"
      ? { provider: "robinhood_mcp", runId: "rh-eod-uat", capturedAt: "2026-07-09T20:59:27.540Z", methodology: "OI-signed GEX proxy" }
      : { provider: "native_yahoo", capturedAt: "2026-07-09T20:59:27.540Z", methodology: "Yahoo option chain" };
    return { ok: true, tool, params, text: `${provenance.provider} options chain`, raw: { source: provenance.provider, chain, provenance }, calledAt: "2026-07-09T21:00:00.000Z" };
  }

  if (tool === "get_stock_stats") {
    return {
      ok: true,
      tool,
      params,
      text: "native Yahoo stats",
      raw: {
        quote: { exchange: "NMS", marketState: "REGULAR" },
        summary: {
          assetProfile: {
            sector: "Technology",
            industry: "Semiconductors",
            longBusinessSummary: "NVIDIA designs accelerated computing platforms for data centers, professional visualization, and gaming. Its products combine accelerated compute, networking, and software for enterprise AI workloads, with platforms used across research, cloud infrastructure, autonomous systems, and advanced graphics workflows worldwide.",
          },
          defaultKeyStatistics: { forwardPE: { raw: 18.5 }, enterpriseValue: { raw: 4500000000000 }, beta: { raw: 2.2 } },
          summaryDetail: { marketCap: { raw: 4400000000000 }, dividendYield: { raw: 0.001 } },
          financialData: { targetMeanPrice: { raw: 300 }, operatingCashflow: { raw: 125000000000 }, freeCashflow: { raw: 46000000000 } },
        },
      },
      calledAt: "2026-07-08T21:33:05.000Z",
    };
  }

  if (params.ticker === "NVDA" && /options|greeks|dex|iv|pcr|sweeps|mispricing/i.test(tool)) {
    const provenance = { provider: "robinhood_mcp", runId: "rh-eod-uat", capturedAt: "2026-07-09T20:59:27.540Z", methodology: "OI-signed GEX proxy" };
    const chain = {
      symbol: "NVDA",
      spot: 204.12,
      expiries,
      selectedExpiry: params.expiry || expiries[0],
      calls: rows.map((row) => ({ strike: row.strike, volume: row.call.volume, openInterest: row.call.openInterest, impliedVolatility: row.call.impliedVolatility / 100, gamma: 0.02, delta: 0.52, mark: row.call.bid + 0.1, lastPrice: row.call.bid + 0.1, multiplier: 100, quoteUpdatedAt: provenance.capturedAt })),
      puts: rows.map((row) => ({ strike: row.strike, volume: row.put.volume, openInterest: row.put.openInterest, impliedVolatility: row.put.impliedVolatility / 100, gamma: 0.018, delta: -0.48, mark: row.put.bid + 0.1, lastPrice: row.put.bid + 0.1, multiplier: 100, quoteUpdatedAt: provenance.capturedAt })),
    };
    if (["get_options_flow_universe", "get_options_sweeps", "get_options_mispricing", "get_options_0dte"].includes(tool)) {
      const unavailableReason = tool === "get_options_flow_universe"
        ? "Robinhood EOD snapshots do not contain tape-level options flow."
        : tool === "get_options_sweeps"
          ? "Robinhood EOD snapshots do not support verified sweep detection."
          : tool === "get_options_0dte"
            ? "The selected Robinhood EOD expiry is not a same-day expiry."
            : "Robinhood EOD snapshots do not contain bid/ask fields required for a mispricing scan.";
      return { ok: true, tool, params, text: unavailableReason, raw: { source: "robinhood_mcp", supported: false, unavailableReason, provenance }, calledAt: "2026-07-09T21:00:00.000Z" };
    }
    if (tool === "get_options_pcr") return { ok: true, tool, params, text: "Robinhood EOD put/call ratios", raw: { source: "robinhood_mcp", supported: true, putCallOpenInterest: 0.82, putCallVolume: 0.78, provenance }, calledAt: "2026-07-09T21:00:00.000Z" };
    return { ok: true, tool, params, text: `${tool} Robinhood EOD rows`, raw: { source: "robinhood_mcp", supported: true, chain, rows, exposures: rows, metric: tool === "get_options_iv_intraday" ? "eod_iv_smile" : undefined, timeSeries: tool === "get_options_iv_intraday" ? false : undefined, provenance }, calledAt: "2026-07-09T21:00:00.000Z" };
  }

  if (/options|greeks|dex|iv|pcr|sweeps|mispricing/i.test(tool)) {
    const raw = tool === "get_options_pcr"
      ? { putCallOpenInterest: 0.82, putCallVolume: 0.78 }
      : { rows, exposures: rows };
    return { ok: true, tool, params, text: `${tool} rows`, raw, calledAt: "2026-07-08T21:33:05.000Z" };
  }

  return { ok: true, tool, params, text: `${tool} native mocked response`, raw: { ok: true }, calledAt: "2026-07-08T21:33:06.000Z" };
};

const clickText = async (page, text, exact = false) => {
  const clicked = await page.evaluate(({ text, exact }) => {
    const buttons = [...document.querySelectorAll("[data-watcher-replica] button, [data-close-strike-detail]")];
    const button = buttons.find((item) => {
      const value = (item.textContent || "").trim();
      return exact ? value === text : value.includes(text);
    });
    if (!button) return false;
    button.click();
    return true;
  }, { text, exact });
  assert.equal(clicked, true, `button "${text}" should be clickable`);
};

const visibleText = (page) => page.$eval("[data-watcher-replica]", (node) => node.innerText);

(async () => {
  let server;
  let browser;
  const apiCalls = [];
  const consoleErrors = [];

  try {
    fs.mkdirSync(screenshotsDir, { recursive: true });
    const serverCommand = process.platform === "win32" ? "cmd.exe" : "npx";
    const serverArgs = process.platform === "win32"
      ? ["/c", "npx", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"]
      : ["vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"];
    server = spawn(serverCommand, serverArgs, { cwd: rootDir, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", (data) => process.stdout.write(data));
    server.stderr.on("data", (data) => process.stderr.write(data));
    await waitForServer();

    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.setRequestInterception(true);
    page.on("request", async (request) => {
      const url = new URL(request.url());
      if (!url.pathname.includes("/api/stocks-intelligence-watcher")) {
        request.continue();
        return;
      }

      if (request.method() === "POST") {
        const body = JSON.parse(request.postData() || "{}");
        apiCalls.push(body);
        request.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(buildToolResponse(body.tool, body.params || {})),
        });
        return;
      }

      const symbol = (url.searchParams.get("symbol") || "NVDA").toUpperCase();
      apiCalls.push({ method: "GET", symbol });
      const refreshedRowOverrides = refreshAllMode && ["GOOG", "AAPL", "MSFT"].includes(symbol)
        ? { priceOffset: 7.77, changeOffset: 7.77, changePercentOffset: 1.11 }
        : {};
      if (symbol === delayedSnapshotSymbol) {
        await wait(220);
      }
      await request.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildSnapshot(symbol, refreshedRowOverrides)),
      });
    });

    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
    await page.goto(`${baseUrl}/#/work/stocks-intelligence-watcher`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-watcher-replica]");
    await wait(1000);
    await page.screenshot({ path: path.join(screenshotsDir, "uat-desktop-overview.png") });
    await page.screenshot({ path: path.join(screenshotsDir, "01-entry-shell-desktop.png") });

    assert.equal(await page.$eval("body", (body) => body.innerText.includes("MARKET LAB")), false, "Watcher must hide portfolio navbar");
    assert.match(await visibleText(page), /Market Overview/i);
    assert.match(await page.$eval(".siw-main-tabs .is-active", (node) => node.textContent), /Overview/);
    assert.deepEqual(
      await page.$$eval("[data-market-index-label]", (nodes) => nodes.map((node) => node.textContent?.trim())),
      ["S&P 500", "NASDAQ 100", "DOW JONES"],
      "overview must render real market index cards",
    );
    const heroSparklineBox = await page.$eval("[data-hero-sparkline='true']", (node) => {
      const rect = node.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        preserveAspectRatio: node.getAttribute("preserveAspectRatio"),
        title: node.querySelector("title")?.textContent || "",
      };
    });
    assert.ok(heroSparklineBox.width >= 320, `hero price sparkline should keep usable width without forcing title overlap; got ${JSON.stringify(heroSparklineBox)}`);
    assert.ok(heroSparklineBox.height >= 64 && heroSparklineBox.height <= 84, `hero price sparkline should be readable but not crowd the header; got ${JSON.stringify(heroSparklineBox)}`);
    assert.equal(heroSparklineBox.preserveAspectRatio, "none", "hero sparkline must stretch to its assigned chart box");
    assert.match(heroSparklineBox.title, /NVDA price sparkline/i, "hero sparkline should expose a tooltip title");
    const refreshAllButtonBox = await page.$eval(".siw-search-row [aria-label='Refresh all watcher tickers']", (node) => {
      const rect = node.getBoundingClientRect();
      const icon = node.querySelector("svg")?.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        iconWidth: icon?.width || 0,
        iconHeight: icon?.height || 0,
      };
    });
    assert.ok(
      refreshAllButtonBox.width >= 38 &&
      refreshAllButtonBox.height >= 38 &&
      refreshAllButtonBox.iconWidth >= 15 &&
      refreshAllButtonBox.iconHeight >= 15,
      `left nav refresh-all button should have a normal aligned icon; got ${JSON.stringify(refreshAllButtonBox)}`,
    );
    await page.waitForFunction(() => document.querySelector("[data-watchlist-breadth]")?.getAttribute("data-watchlist-coverage") === "9/10", { timeout: 5000 });
    assert.equal(await page.$eval("[data-watchlist-breadth]", (node) => node.getAttribute("data-watchlist-coverage")), "9/10", "entering the Watcher must automatically refresh the visible Yahoo quote rows");
    assert.ok(await page.$$("[data-watchlist-sector]").then((nodes) => nodes.length) > 0, "automatic refresh must also populate the source-backed sector panel");
    assert.equal(await page.$eval("[data-watchlist-row='GOOG']", (node) => node.getAttribute("data-row-source")), "yahoo_quote", "automatic refresh must expose Yahoo row provenance");
    for (const tool of ["get_macro_regime", "market_breadth", "get_sector_stats", "get_sector_top_holdings"]) {
      assert.equal(apiCalls.filter((call) => call.tool === tool).length, 2, `React Strict Mode invokes the mount-owned ${tool} request twice; auto row refresh must not add another request`);
    }
    const overviewMetricValues = await page.$$eval("[data-overview-tertiary-panel='metrics'] .siw-metric-tile strong", (nodes) => nodes.map((node) => node.textContent?.trim()));
    assert.ok(overviewMetricValues.slice(1).every((value) => value && value !== "n/a"), `validated Robinhood overview metrics must not wait for the Options tab; got ${JSON.stringify(overviewMetricValues)}`);
    const watchedRowsBeforeRefresh = await page.$$eval("[data-watchlist-row]", (rows) =>
      Object.fromEntries(rows.slice(0, 8).map((row) => [
        row.getAttribute("data-watchlist-row"),
        {
          price: row.getAttribute("data-row-price"),
          change: row.getAttribute("data-row-change"),
          source: row.getAttribute("data-row-source"),
          asOf: row.getAttribute("data-row-asof"),
        },
      ])),
    );
    const callsBeforeRefreshAll = apiCalls.length;
    refreshAllMode = true;
    await page.click(".siw-search-row [aria-label='Refresh all watcher tickers']");
    await page.waitForFunction(() => {
      const rows = ["GOOG", "AAPL", "MSFT"].map((symbol) => document.querySelector(`[data-watchlist-row='${symbol}']`)?.getAttribute("data-row-price"));
      return rows.every((value) => value && !["376.43", "312.06", "450.24"].includes(value));
    }, { timeout: 5000 });
    await wait(150);
    refreshAllMode = false;
    const watchedRowsAfterRefresh = await page.$$eval("[data-watchlist-row]", (rows) =>
      Object.fromEntries(rows.slice(0, 8).map((row) => [
        row.getAttribute("data-watchlist-row"),
        {
          price: row.getAttribute("data-row-price"),
          change: row.getAttribute("data-row-change"),
          source: row.getAttribute("data-row-source"),
          asOf: row.getAttribute("data-row-asof"),
        },
      ])),
    );
    const refreshAllCalls = apiCalls.slice(callsBeforeRefreshAll);
    const refreshQuoteCall = refreshAllCalls.find((call) => call.tool === "get_quotes");
    assert.ok(refreshQuoteCall, `refresh-all should use get_quotes for row data; got ${JSON.stringify(refreshAllCalls)}`);
    assert.match(refreshQuoteCall.params?.tickers || "", /NVDA/);
    assert.match(refreshQuoteCall.params?.tickers || "", /GOOG/);
    assert.match(refreshQuoteCall.params?.tickers || "", /AAPL/);
    assert.equal(refreshAllCalls.some((call) => call.method === "GET" && call.symbol !== "NVDA"), false, `refresh-all should not spam full snapshots for non-selected rows; got ${JSON.stringify(refreshAllCalls)}`);
    assert.notEqual(watchedRowsBeforeRefresh.GOOG?.price, watchedRowsAfterRefresh.GOOG?.price, "GOOG row price should visibly change after refresh-all");
    assert.notEqual(watchedRowsBeforeRefresh.AAPL?.price, watchedRowsAfterRefresh.AAPL?.price, "AAPL row price should visibly change after refresh-all");
    assert.notEqual(watchedRowsBeforeRefresh.MSFT?.price, watchedRowsAfterRefresh.MSFT?.price, "MSFT row price should visibly change after refresh-all");
    assert.equal(watchedRowsAfterRefresh.GOOG?.source, "yahoo_quote", "GOOG row should show Yahoo quote as source after refresh-all");
    assert.equal(watchedRowsAfterRefresh.AAPL?.source, "yahoo_quote", "AAPL row should show Yahoo quote as source after refresh-all");
    assert.equal(watchedRowsAfterRefresh.MSFT?.source, "yahoo_quote", "MSFT row should show Yahoo quote as source after refresh-all");
    assert.match(watchedRowsAfterRefresh.GOOG?.asOf || "", /2026-07-09T20:00:00/);
    assert.match(await page.$eval(".siw-hero-identity h1", (node) => node.textContent || ""), /NVDA/, "refresh-all should not change the selected hero ticker");
    for (const tool of ["get_macro_regime", "market_breadth", "get_sector_stats", "get_sector_top_holdings"]) {
      assert.ok(refreshAllCalls.some((call) => call.tool === tool), `refresh-all should refresh approved-universe ${tool}`);
    }
    await page.waitForFunction(() => document.querySelector("[data-approved-universe-market-context]")?.innerText.includes("Risk-on"), { timeout: 5000 });
    const approvedUniverseContext = await page.$eval("[data-approved-universe-market-context]", (node) => node.innerText);
    assert.match(approvedUniverseContext, /BREADTH\s*4\/5 · 80%/);
    assert.match(approvedUniverseContext, /AVERAGE DAY MOVE\s*\+1\.27%/);
    assert.match(approvedUniverseContext, /COVERAGE\s*5 Yahoo symbols/);
    assert.match(await visibleText(page), /Technology · 2\/2/);
    assert.doesNotMatch(await visibleText(page), /Stale cache sector/);
    assert.match(await visibleText(page), /LEAD \+4\.20%/);
    assert.match(await visibleText(page), /LOSS -2\.70%/);
    assert.match(await visibleText(page), /Watchlist Market Breadth \(Yahoo live quotes\)/i);
    assert.equal(await page.$eval("[data-watchlist-breadth]", (node) => node.getAttribute("data-watchlist-coverage")), "9/10", "breadth coverage must exclude a Yahoo row whose change fields are unavailable");
    assert.equal(await page.$eval("[data-watchlist-row='QQQI']", (node) => node.getAttribute("data-row-change")), "", "missing Yahoo change fields must remain unavailable instead of becoming a fake unchanged quote");
    assert.equal(await page.$eval("[data-watchlist-row='QQQI']", (node) => node.getAttribute("data-row-change-available")), "false", "missing Yahoo change evidence must remain observable in the row contract");
    assert.match(await page.$eval("[data-watchlist-row='QQQI'] .siw-row-change", (node) => node.textContent || ""), /--/, "missing Yahoo change fields must render explicitly unavailable");
    assert.match(await visibleText(page), /Change coverage 9\/10 · 1 unavailable/i, "breadth header must disclose unavailable change evidence");
    assert.match(await page.$eval(".siw-breadth-counts", (node) => node.textContent || ""), /Unchanged\s*1\s*·\s*META/i, "a genuine zero-change Yahoo quote must remain unchanged and identify its ticker");
    assert.equal(await page.$eval("[data-watchlist-sector='Technology']", (node) => node.getAttribute("data-watchlist-sector-coverage")), "2/2", "sector coverage should derive from visible Yahoo quote rows");
    await page.select("select[aria-label='Sector filter']", "Technology");
    await page.waitForFunction(() => document.querySelector("[data-watchlist-breadth]")?.getAttribute("data-watchlist-coverage") === "2/2", { timeout: 5000 });
    assert.equal(await page.$$("[data-watchlist-sector]").then((nodes) => nodes.length), 1, "sector filter should limit the watchlist sector panel to visible rows");
    assert.equal(await page.$eval("[data-watchlist-sector]", (node) => node.getAttribute("data-watchlist-sector")), "Technology");
    await page.select("select[aria-label='Sector filter']", "All Sectors");
    const sectorEmptyLayout = await page.evaluate(() => {
      const list = document.querySelector(".siw-sector-list");
      const empty = document.createElement("div");
      empty.className = "siw-data-empty";
      empty.innerHTML = "<strong>Needs checking</strong><span>No live Yahoo quotes for this watchlist.</span>";
      list.appendChild(empty);
      const style = getComputedStyle(empty);
      const span = empty.querySelector("span").getBoundingClientRect();
      const result = { display: style.display, spanWidth: span.width, emptyWidth: empty.getBoundingClientRect().width };
      empty.remove();
      return result;
    });
    assert.equal(sectorEmptyLayout.display, "flex", `sector unavailable state must not inherit the three-column sector-row grid; got ${JSON.stringify(sectorEmptyLayout)}`);
    assert.ok(sectorEmptyLayout.spanWidth >= sectorEmptyLayout.emptyWidth * 0.75, `sector unavailable copy must retain readable line width; got ${JSON.stringify(sectorEmptyLayout)}`);
    await page.setViewport({ width: 1508, height: 1471, deviceScaleFactor: 1 });
    await wait(300);
    const bottomPanelRects = await page.$$eval("[data-bottom-panels] > .siw-panel", (panels) => panels.map((panel) => {
      const rect = panel.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    }));
    assert.equal(bottomPanelRects.length, 3, "the bottom audit area must contain three columns");
    assert.ok(Math.max(...bottomPanelRects.map((rect) => rect.top)) - Math.min(...bottomPanelRects.map((rect) => rect.top)) <= 1, `bottom column tops must align; got ${JSON.stringify(bottomPanelRects)}`);
    assert.ok(Math.max(...bottomPanelRects.map((rect) => rect.bottom)) - Math.min(...bottomPanelRects.map((rect) => rect.bottom)) <= 1, `bottom column bottoms must align; got ${JSON.stringify(bottomPanelRects)}`);
    const auditPanelInsets = await page.evaluate(() => [
      [".siw-tool-runs", ".siw-run-table"],
      [".siw-market-context", ".siw-context-cards"],
      [".siw-tool-catalog", ".siw-tool-catalog label"],
    ].map(([panelSelector, bodySelector]) => {
      const panel = document.querySelector(panelSelector)?.getBoundingClientRect();
      const bodyNode = document.querySelector(bodySelector);
      const body = bodyNode?.getBoundingClientRect();
      const style = bodyNode ? getComputedStyle(bodyNode) : null;
      const usesPadding = bodySelector !== ".siw-tool-catalog label";
      return {
        panelSelector,
        left: usesPadding ? Number.parseFloat(style?.paddingLeft || "-1") : body && panel ? body.left - panel.left : -1,
        right: usesPadding ? Number.parseFloat(style?.paddingRight || "-1") : body && panel ? panel.right - body.right : -1,
      };
    }));
    assert.equal(
      auditPanelInsets.every(({ left, right }) => left >= 15 && right >= 15),
      true,
      `bottom audit content must keep at least a 16px visual gutter from panel borders; got ${JSON.stringify(auditPanelInsets)}`,
    );
    const auditInnerInsets = await page.evaluate(() => {
      const runRow = document.querySelector(".siw-run-row");
      const runIndex = runRow?.querySelector("span");
      const toolTitle = document.querySelector(".siw-tool-group-title");
      const rowRect = runRow?.getBoundingClientRect();
      const indexRect = runIndex?.getBoundingClientRect();
      const titleStyle = toolTitle ? getComputedStyle(toolTitle) : null;
      return {
        runIndexLeft: rowRect && indexRect ? indexRect.left - rowRect.left : -1,
        toolTitlePaddingLeft: Number.parseFloat(titleStyle?.paddingLeft || "-1"),
      };
    });
    assert.ok(auditInnerInsets.runIndexLeft >= 9, `tool-run row content must not touch its divider edge; got ${JSON.stringify(auditInnerInsets)}`);
    assert.ok(auditInnerInsets.toolTitlePaddingLeft >= 9, `tool-catalog section headings must not touch their divider edge; got ${JSON.stringify(auditInnerInsets)}`);
    const overviewAndAuditColumns = await page.evaluate(() => {
      const uniqueColumns = (selector) => {
        const columns = [];
        for (const node of document.querySelectorAll(selector)) {
          const rect = node.getBoundingClientRect();
          if (!columns.some((column) => Math.abs(column.left - rect.left) <= 1)) columns.push({ left: rect.left, right: rect.right });
        }
        return columns.sort((a, b) => a.left - b.left);
      };
      return {
        overview: uniqueColumns("[data-overview-tertiary] > .siw-panel"),
        audit: uniqueColumns("[data-bottom-panels] > .siw-panel"),
      };
    });
    assert.equal(overviewAndAuditColumns.overview.length, 3, `overview tertiary area must have three columns; got ${JSON.stringify(overviewAndAuditColumns)}`);
    assert.equal(overviewAndAuditColumns.audit.length, 3, `bottom audit area must have three columns; got ${JSON.stringify(overviewAndAuditColumns)}`);
    assert.equal(overviewAndAuditColumns.audit.every((column, index) =>
      Math.abs(column.left - overviewAndAuditColumns.overview[index].left) <= 1 &&
      Math.abs(column.right - overviewAndAuditColumns.overview[index].right) <= 1
    ), true, `overview and bottom column boundaries must align; got ${JSON.stringify(overviewAndAuditColumns)}`);
    const heroTitleAndPriceRects = await page.evaluate(() => {
      const title = document.querySelector(".siw-hero-identity h1");
      const price = document.querySelector(".siw-hero-price strong");
      const titleRect = title.getBoundingClientRect();
      const priceRect = price.getBoundingClientRect();
      return {
        title: { left: titleRect.left, right: titleRect.right, top: titleRect.top, bottom: titleRect.bottom },
        price: { left: priceRect.left, right: priceRect.right, top: priceRect.top, bottom: priceRect.bottom },
      };
    });
    const noHeroOverlap =
      heroTitleAndPriceRects.title.right <= heroTitleAndPriceRects.price.left ||
      heroTitleAndPriceRects.price.right <= heroTitleAndPriceRects.title.left ||
      heroTitleAndPriceRects.title.bottom <= heroTitleAndPriceRects.price.top ||
      heroTitleAndPriceRects.price.bottom <= heroTitleAndPriceRects.title.top;
    assert.ok(noHeroOverlap, `hero title and price must not overlap at 1508px viewport; got ${JSON.stringify(heroTitleAndPriceRects)}`);
    await page.evaluate(() => document.querySelector("[data-bottom-panels]")?.scrollIntoView({ block: "start" }));
    await wait(200);
    await page.screenshot({ path: path.join(screenshotsDir, "02b-audit-columns-premium-spacing-desktop.png") });
    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
    await wait(300);
    const logoBox = await page.$eval("[data-ticker-logo='NVDA']", (node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    assert.ok(Math.abs(logoBox.width - logoBox.height) <= 1, `ticker logo should be square; got ${logoBox.width}x${logoBox.height}`);
    const tertiaryBoxes = await page.$$eval("[data-overview-tertiary-panel]", (nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { panel: node.getAttribute("data-overview-tertiary-panel"), left: rect.left, top: rect.top, width: rect.width };
      }),
    );
    assert.equal(tertiaryBoxes.length, 6, "overview must render news, earnings, valuation, financials, owner coverage, and key metrics panels");
    const tertiaryByPanel = Object.fromEntries(tertiaryBoxes.map((box) => [box.panel, box]));
    assert.ok(
      ["news", "earnings", "metrics"].every((panel) => Math.abs(tertiaryByPanel[panel].top - tertiaryByPanel.news.top) <= 2),
      `news, earnings, and key metrics must remain aligned in the first overview tertiary row; got ${JSON.stringify(tertiaryBoxes)}`,
    );
    assert.ok(
      tertiaryByPanel.news.left < tertiaryByPanel.earnings.left && tertiaryByPanel.earnings.left < tertiaryByPanel.metrics.left,
      "key metrics must swap into valuation's prior top-right position",
    );
    assert.ok(tertiaryByPanel.financials.top > tertiaryByPanel.news.top && tertiaryByPanel.valuation.top > tertiaryByPanel.news.top, "valuation must swap below with key metrics");
    assert.ok(tertiaryByPanel.financials.left < tertiaryByPanel.valuation.left && tertiaryByPanel.valuation.left < tertiaryByPanel['admin-coverage'].left, "valuation must swap with coverage request in the second tertiary row");
    const overviewText = await visibleText(page);
    assert.match(overviewText, /High\s+205\.15/i, "hero high must come from quote OHLC, not copied price fallback");
    assert.match(overviewText, /Low\s+195\.11/i, "hero low must come from quote OHLC, not copied price fallback");
    assert.match(overviewText, /Open\s+195\.18/i, "hero open must come from quote OHLC, not copied price fallback");
    assert.match(overviewText, /Prev Close\s+200\.09/i, "hero previous close must come from quote previousClose");
    assert.equal(
      await page.$$eval(".siw-news-list a", (nodes) => nodes.length),
      3,
      "overview must render three inline Yahoo native news items",
    );
    assert.match(overviewText, /Next earnings\s+2026-08-26/i);
    assert.match(overviewText, /Last earnings\s+2026-05-20/i);
    assert.match(overviewText, /EPS 1\.87 vs 1\.77/i);
    assert.match(overviewText, /Earnings-date move\s+\+1\.30%/i);
    assert.match(overviewText, /Coverage request/i, "overview must expose the owner-only coverage request panel");
    const indexSparklineBoxes = await page.$$eval("[data-market-index-card]", (cards) =>
      cards.map((card) => {
        const cardRect = card.getBoundingClientRect();
        const svg = card.querySelector("[data-index-sparkline='true']");
        const svgRect = svg.getBoundingClientRect();
        return {
          symbol: card.getAttribute("data-market-index-card"),
          status: card.getAttribute("data-market-index-status"),
          source: card.getAttribute("data-market-index-source"),
          historyPoints: Number(card.getAttribute("data-market-index-history-points")),
          leftDelta: Math.abs(svgRect.left - cardRect.left),
          cardHeight: cardRect.height,
          height: svgRect.height,
          preserveAspectRatio: svg.getAttribute("preserveAspectRatio"),
          title: svg.querySelector("title")?.textContent || "",
          text: card.textContent || "",
        };
      }),
    );
    assert.equal(indexSparklineBoxes.length, 3, "overview must render three market index sparkline boxes");
    assert.ok(
      indexSparklineBoxes.every((box) =>
        box.height >= 56 &&
        box.height <= 78 &&
        box.cardHeight < 180 &&
        box.leftDelta >= 14 &&
        box.leftDelta <= 24 &&
        box.preserveAspectRatio === "none"),
      `market index cards should match the compact reference layout; got ${JSON.stringify(indexSparklineBoxes)}`,
    );
    const dowSparkline = indexSparklineBoxes.find((box) => box.symbol === "DJI");
    assert.ok(dowSparkline, "DOW JONES card should render as DJI");
    assert.equal(dowSparkline.status, "ok", `DOW JONES must use valid Yahoo history, not unavailable fallback; got ${JSON.stringify(dowSparkline)}`);
    assert.equal(dowSparkline.source, "^DJI");
    assert.ok(dowSparkline.historyPoints >= 10, `DOW JONES chart needs real history points; got ${JSON.stringify(dowSparkline)}`);
    assert.match(dowSparkline.title, /DOW JONES\s+·\s+Jul\s+\d{1,2},\s+2026\s+·\s+3M daily/i, "DOW chart should expose the same date/range title format as the custom tooltip");
    assert.match(dowSparkline.title, /Yahoo \^DJI/i, "DOW chart title should expose source symbol");
    const ndxSparkline = indexSparklineBoxes.find((box) => box.symbol === "NDX");
    assert.ok(ndxSparkline, "NASDAQ 100 card should render as NDX");
    assert.match(ndxSparkline.title, /NASDAQ 100\s+·\s+Jul\s+\d{1,2},\s+2026\s+·\s+3M daily/i, "NDX chart title should match the top ticker tooltip style");
    assert.match(ndxSparkline.title, /Yahoo \^NDX/i, "NDX chart title should expose source symbol");
    await page.hover(".siw-hero-chart .siw-sparkline-frame");
    await wait(150);
    const heroTooltipText = await page.$eval("[data-sparkline-tooltip]", (node) => node.textContent || "");
    assert.match(heroTooltipText, /NVDA/i, "hero tooltip should include ticker source");
    assert.match(heroTooltipText, /Jul\s+9,\s+2026/i, "hero tooltip should include the session date");
    assert.match(heroTooltipText, /\d{1,2}:\d{2}\s*(AM|PM)\s*ET/i, "hero tooltip should include the intraday timestamp");
    assert.match(heroTooltipText, /Intraday/i, "hero tooltip should label hero chart as intraday");
    assert.match(heroTooltipText, /\$/i, "hero tooltip should include a formatted numeric value");
    assert.match(heroTooltipText, /%/i, "hero tooltip should include point-over-point percent change");
    assert.match(heroTooltipText, /\d+\/\d+ pts/i, "hero tooltip should include point count");
    const heroTooltipRect = await page.$eval("[data-sparkline-tooltip]", (node) => {
      const rect = node.getBoundingClientRect();
      const hero = document.querySelector(".siw-hero")?.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        heroBottom: hero?.bottom || 0,
        placement: node.getAttribute("data-sparkline-tooltip-placement"),
      };
    });
    assert.equal(heroTooltipRect.placement, "bottom", `hero tooltip should open below the chart; got ${JSON.stringify(heroTooltipRect)}`);
    assert.ok(
      heroTooltipRect.top >= 0 &&
      heroTooltipRect.left >= 0 &&
      heroTooltipRect.right <= heroTooltipRect.viewportWidth &&
      heroTooltipRect.bottom <= heroTooltipRect.viewportHeight,
      `hero tooltip should be inside the viewport and not clipped by the header; got ${JSON.stringify(heroTooltipRect)}`,
    );
    for (const [symbol, source] of [["SPX", "^GSPC"], ["NDX", "^NDX"], ["DJI", "^DJI"]]) {
      await page.hover(`[data-market-index-card='${symbol}'] .siw-sparkline-frame`);
      await wait(150);
      const tooltipText = await page.$eval("[data-sparkline-tooltip]", (node) => node.textContent || "");
      assert.match(tooltipText, new RegExp(source.replace("^", "\\^")), `${symbol} tooltip should include source ${source}`);
      assert.match(tooltipText, /Jul\s+\d{1,2},\s+2026/i, `${symbol} tooltip should include full Yahoo history date`);
      assert.match(tooltipText, /3M\s+daily/i, `${symbol} tooltip should label the index history as 3M daily`);
      assert.match(tooltipText, /%/, `${symbol} tooltip should include point-over-point percent change`);
      const indexTooltipRect = await page.$eval("[data-sparkline-tooltip]", (node) => {
        const rect = node.getBoundingClientRect();
        return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
      });
      assert.ok(
        indexTooltipRect.top >= 0 &&
        indexTooltipRect.left >= 0 &&
        indexTooltipRect.right <= indexTooltipRect.viewportWidth &&
        indexTooltipRect.bottom <= indexTooltipRect.viewportHeight,
        `${symbol} custom tooltip should be visible inside viewport; got ${JSON.stringify(indexTooltipRect)}`,
      );
      assert.ok(
        await page.$eval(`[data-market-index-card='${symbol}'] [data-sparkline-active-dot]`, () => true),
        `${symbol} hover should show active point dot`,
      );
      assert.ok(
        await page.$eval(`[data-market-index-card='${symbol}'] [data-sparkline-crosshair]`, () => true),
        `${symbol} hover should show crosshair`,
      );
    }
    await page.mouse.move(5, 5);
    await wait(150);
    assert.equal(await page.$("[data-sparkline-tooltip]"), null, "sparkline tooltip should hide after pointer leaves");
    const loadButtonHtml = await page.$eval(".siw-load-button", (button) => button.innerHTML);
    assert.equal(loadButtonHtml.includes("⌁"), false, "LOAD button should not render the tiny glyph icon");
    assert.ok(
      await page.$$eval(".siw-tab-svg", (nodes) => nodes.every((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width >= 16 && rect.height >= 16;
      })),
      "tab icons should use consistent readable SVG sizing",
    );

    await page.type('input[name="stock-search"]', "EOSE");
    await clickText(page, "LOAD");
    await wait(600);
    assert.match(await visibleText(page), /EOSE/);
    assert.equal(await page.$eval('input[name="stock-search"]', (input) => input.value), "");
    const rowsAfterCustomLoad = await page.$$eval("[data-watcher-replica] [data-watchlist-row]", (rows) =>
      rows.map((row) => row.getAttribute("data-watchlist-row")),
    );
    assert.ok(rowsAfterCustomLoad.includes("EOSE"), "custom ticker load should add the ticker row");
    assert.ok(rowsAfterCustomLoad.length > 1, "custom ticker load must keep the rest of the watchlist visible");

    await page.type('input[name="stock-search"]', "TSLA");
    await clickText(page, "LOAD");
    await wait(600);
    assert.match(await visibleText(page), /TSLA/);
    const tslaHeroQuote = await page.$eval(".siw-hero-price", (node) => node.textContent || "");
    assert.match(tslaHeroQuote, /406\.55/);
    assert.match(tslaHeroQuote, /\+12\.49\s+\+3\.17%\s+\u25B2/, `TSLA hero quote should use positive Yahoo quote change; got ${tslaHeroQuote}`);
    assert.doesNotMatch(tslaHeroQuote, /-18\.75|-4\.41%|\u25BC/);
    assert.equal(
      await page.$eval(".siw-hero-price", (node) => /-\d[\d,.]*\s+-?\d[\d,.]*\.\d+%\s*\u25B2|\+\d[\d,.]*\s+\+\d[\d,.]*\.\d+%\s*\u25BC/.test(node.textContent || "")),
      false,
      "hero quote direction must not mix negative values with an up arrow or positive values with a down arrow",
    );

    await page.click('input[name="stock-search"]');
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.waitForFunction(() => document.querySelector('input[name="stock-search"]')?.value === "");
    await page.select("select[aria-label='Sector filter']", "Technology");
    await page.select("select[aria-label='Type filter']", "Stock");
    await wait(150);
    assert.match(await visibleText(page), /MSFT|AAPL/);

    await page.select("select[aria-label='Sector filter']", "All Sectors");
    await page.select("select[aria-label='Type filter']", "All Types");
    await wait(150);
    await clickText(page, "All Stocks");
    await page.waitForFunction(() => document.querySelectorAll("[data-watcher-replica] [data-watchlist-row]").length > 0);
    const watchlistTabLayout = await page.$$eval(".siw-watchlist-tabs button", (buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, clipped: button.scrollWidth > button.clientWidth };
    }));
    assert.equal(watchlistTabLayout.length, 2, "All Stocks and FAV must remain two distinct tabs");
    assert.ok(watchlistTabLayout.every((tab) => tab.width > 0 && !tab.clipped) && watchlistTabLayout[0].right <= watchlistTabLayout[1].left + 1, `watchlist tabs must not overlap or clip: ${JSON.stringify(watchlistTabLayout)}`);

    await clickText(page, "⌯", true);
    assert.equal(await page.$("[data-filter-panel]") !== null, true, "filter icon should reveal filter panel");

    await page.click("[data-watcher-replica] button[aria-label='Collapse watchlist']");
    await wait(150);
    assert.equal(await page.$eval("[data-watcher-replica]", (node) => node.classList.contains("is-rail-collapsed")), true);
    await page.click("[data-watcher-replica] button[aria-label='Expand watchlist']");
    await page.waitForFunction(() => !document.querySelector("[data-watcher-replica]")?.classList.contains("is-rail-collapsed"));
    await page.waitForFunction(() => document.querySelectorAll("[data-watcher-replica] [data-watchlist-row]").length > 0);

    const favoriteSymbol = await page.$eval("[data-watchlist-scope] [data-watchlist-row]", (row) => row.getAttribute("data-watchlist-row"));
    await page.click(`[data-watchlist-scope] input[aria-label='Favorite ${favoriteSymbol}']`);
    await wait(150);
    assert.ok(apiCalls.some((call) => call.tool === "save_memory"), "favorite should persist through save_memory");
    await clickText(page, "FAV");
    await wait(150);
    assert.match(await visibleText(page), new RegExp(`\\b${favoriteSymbol}\\b`));
    await clickText(page, "All Stocks");

    const removableSymbol = await page.$$eval("[data-watcher-replica] [data-watchlist-row]", (rows) => {
      return rows.map((row) => row.getAttribute("data-watchlist-row")).find((symbol) => Boolean(symbol));
    });
    await page.click(`[data-watcher-replica] [data-watchlist-row="${removableSymbol}"]`);
    await wait(450);
    assert.match(await visibleText(page), new RegExp(`\\b${removableSymbol}\\b`));
    await page.click(`[data-watcher-replica] button[aria-label="Remove ${removableSymbol}"]`);
    await wait(150);
    assert.equal(await page.$(`[data-watcher-replica] [data-watchlist-row="${removableSymbol}"]`) === null, true, "remove should hide ticker row");

    await clickText(page, "Add ticker");
    assert.equal(await page.$eval('input[name="stock-search"]', (input) => input.value), "SOFI");
    await page.click('input[name="stock-search"]');
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.waitForFunction(() => document.querySelector('input[name="stock-search"]')?.value === "");
    await page.waitForFunction(() => document.querySelectorAll("[data-watcher-replica] [data-watchlist-row]").length > 0);
    await page.click("button[aria-label='Settings']");
    assert.equal(await page.$("[data-settings-panel]") !== null, true, "settings should open panel");
    await clickText(page, "Retry / refresh");
    await page.click("button[aria-label='Settings']");
    await wait(150);
    assert.equal(await page.$("[data-settings-panel]") === null, true, "settings should close before visual captures");

    await clickText(page, "Chart");
    await wait(700);
    assert.equal(await page.$("[data-price-chart-surface]") !== null, true, "chart tab should render chart surface");
    assert.deepEqual(
      await page.$$eval("[data-primary-tab-panel='Chart'] [data-price-chart-range] button", (nodes) => Array.from(new Set(
        nodes
          .filter((node) => {
            const style = window.getComputedStyle(node);
            return style.display !== "none" && style.visibility !== "hidden" && node.getBoundingClientRect().width > 0;
          })
          .map((node) => node.textContent?.trim())
          .filter((text) => ["1M", "3M", "1Y"].includes(text)),
      ))),
      ["1M", "3M", "1Y"],
      "chart must expose only source-backed 1M, 3M and 1Y Daily ranges",
    );
    for (const [label, range] of [["1M", "1mo"], ["3M", "3mo"], ["1Y", "1y"]]) {
      await clickText(page, label, true);
      await wait(220);
      assert.equal(await page.$eval("[data-price-chart-range]", (node) => node.getAttribute("data-price-chart-range")), range, `${label} must become the active source range`);
      assert.ok(apiCalls.some((call) => call.tool === "get_stock_history" && call.params?.range === range && call.params?.interval === "1d"), `${label} must request Yahoo Daily ${range} data`);
    }
    await page.screenshot({ path: path.join(screenshotsDir, "03-chart-tab-ohlc-volume-desktop.png") });

    await clickText(page, "Stats");
    await wait(700);
    assert.match(await visibleText(page), /Native Yahoo Stats/i);
    assert.match(await visibleText(page), /NMS/);
    assert.match(await visibleText(page), /Semiconductors/);
    assert.match(await page.$eval("[data-primary-tab-panel='Stats'] [data-company-description]", (node) => node.textContent || ""), /NVIDIA designs accelerated computing/i, "Stats must show the Yahoo company description instead of an empty earnings card");
    assert.equal(await page.$eval("[data-primary-tab-panel='Stats'] .siw-description-toggle", (node) => node.textContent), "Read more", "long company descriptions must start collapsed");
    await page.click("[data-primary-tab-panel='Stats'] .siw-description-toggle");
    assert.equal(await page.$eval("[data-primary-tab-panel='Stats'] .siw-description-toggle", (node) => node.textContent), "Show less", "company description toggle must expand the hidden text");
    const statsHeaderAlignment = await page.evaluate(() => [
      [document.querySelector(".siw-stats-left .siw-panel-title span"), document.querySelector(".siw-stats-left .siw-stat-table")],
      [document.querySelector(".siw-financial-summary .siw-panel-title span"), document.querySelector(".siw-financial-summary .siw-stat-table")],
      [document.querySelector(".siw-cashflow-panel .siw-panel-title span"), document.querySelector(".siw-cashflow-panel .siw-stat-table")],
    ].map(([title, table]) => ({ titleLeft: title?.getBoundingClientRect().left, tableLeft: table?.getBoundingClientRect().left })));
    assert.equal(statsHeaderAlignment.every(({ titleLeft, tableLeft }) => Math.abs(titleLeft - tableLeft) <= 1), true, `Stats panel titles must align with their tables; got ${JSON.stringify(statsHeaderAlignment)}`);
    const statsSectionSpacing = await page.evaluate(() => {
      const panelHeader = document.querySelector(".siw-stats-left .siw-panel-title")?.getBoundingClientRect();
      return Array.from(document.querySelectorAll(".siw-stat-columns h3")).map((heading) => ({
        label: heading.textContent,
        topInset: panelHeader ? heading.getBoundingClientRect().top - panelHeader.bottom : -1,
      }));
    });
    assert.equal(statsSectionSpacing.every(({ topInset }) => topInset >= 15), true, `Stats subsection headings must keep a 16px gap below the panel divider; got ${JSON.stringify(statsSectionSpacing)}`);
    assert.equal(await page.$eval(".siw-financial-summary .siw-stat-table thead th:nth-child(2)", (node) => getComputedStyle(node).textAlign), "center", "Financial Summary value header must be centered");
    assert.equal(await page.$eval(".siw-financial-summary .siw-stat-table thead th:nth-child(3)", (node) => getComputedStyle(node).textAlign), "center", "Financial Summary context header must be centered");
    assert.doesNotMatch(await page.$eval("[data-primary-tab-panel='Stats']", (node) => node.textContent || ""), /Needs checking/i, "Stats must render Yahoo values or n\/a, never a placeholder");
    await page.screenshot({ path: path.join(screenshotsDir, "04-stats-fundamentals-earnings-desktop.png") });

    await clickText(page, "Fundamentals");
    await wait(500);
    assert.equal(await page.$("[data-fundamentals-metrics]") !== null, true, "Fundamentals must use the readable native metrics grid");
    assert.match(await page.$eval("[data-primary-tab-panel='Fundamentals'] [data-company-description]", (node) => node.textContent || ""), /NVIDIA designs accelerated computing/i, "Fundamentals must include the Yahoo company description");
    assert.equal(await page.$$eval("[data-fundamentals-metrics] dd", (nodes) => nodes.every((node) => node.scrollWidth <= node.clientWidth)), true, "Fundamentals metric values must not be clipped");

    for (const [topTab, expectedTool] of [["Earnings", "earnings_vol_crush"], ["Short Vol", "signal_scan"], ["News", "morning_briefing"], ["Holders", "get_sector_top_holdings"]]) {
      await clickText(page, topTab, true);
      await wait(350);
      const panelText = await page.$eval(`[data-primary-tab-panel='${topTab}']`, (node) => node.textContent || "");
      assert.match(panelText, new RegExp(expectedTool), `${topTab} must render its source-backed tool result instead of a dead placeholder`);
      assert.ok(apiCalls.some((call) => call.tool === expectedTool), `${topTab} must execute its declared native tool plan`);
    }

    await page.type('input[name="stock-search"]', "NVDA");
    await clickText(page, "LOAD");
    await page.waitForFunction(() => document.querySelector(".siw-hero-identity h1")?.textContent === "NVDA", { timeout: 5000 });
    await wait(450);
    await clickText(page, "Options");
    await wait(900);
    await page.setViewport({ width: 1248, height: 986, deviceScaleFactor: 1 });
    await wait(300);
    const watcherLayout = await page.evaluate(() => {
      const rect = (selector) => {
        const node = document.querySelector(selector);
        const { top, bottom, height } = node.getBoundingClientRect();
        return { top, bottom, height };
      };
      const actions = rect(".siw-sidebar-actions");
      const sidebar = rect(".siw-sidebar");
      const rail = rect(".siw-expiry-rail");
      const list = rect(".siw-expiry-list");
      const head = rect(".siw-expiry-head");
      const viewAll = rect(".siw-view-all");
      const preloadNode = document.querySelector("[data-yahoo-expiry-preload]");
      const preloadStyle = preloadNode ? getComputedStyle(preloadNode) : null;
      const preload = preloadNode
        ? {
            ...rect("[data-yahoo-expiry-preload]"),
            marginTop: Number.parseFloat(preloadStyle.marginTop) || 0,
            marginBottom: Number.parseFloat(preloadStyle.marginBottom) || 0,
          }
        : { height: 0, marginTop: 0, marginBottom: 0 };
      return { actions, sidebar, rail, list, head, preload, viewAll };
    });
    assert.ok(watcherLayout.actions.bottom <= watcherLayout.sidebar.bottom + 1, `add-ticker and settings actions must stay fully inside the sidebar; got ${JSON.stringify(watcherLayout)}`);
    const expiryRailFixedHeight = watcherLayout.head.height
      + watcherLayout.preload.height
      + watcherLayout.preload.marginTop
      + watcherLayout.preload.marginBottom
      + watcherLayout.viewAll.height
      + 28;
    assert.ok(watcherLayout.list.height >= watcherLayout.rail.height - expiryRailFixedHeight, `expiry list must use the available rail height after fixed controls; got ${JSON.stringify(watcherLayout)}`);
    assert.equal(await page.$("[data-yahoo-expiry-preload]"), null, "Robinhood-backed options must not show Yahoo preload status");
    assert.match(await page.$eval("[data-options-robinhood-provenance]", (node) => node.textContent || ""), /Robinhood MCP EOD[\s\S]*OI-signed proxy, not dealer GEX/i, "Options must expose Robinhood source and methodology");
    assert.doesNotMatch(await page.$eval("[data-options-robinhood-provenance]", (node) => node.textContent || ""), /\d{1,2}:\d{2}:\d{2}/, "source timestamps must stop at hour precision");
    const provenancePosition = await page.$eval("[data-options-robinhood-provenance]", (node) => {
      const panel = node.closest("[data-primary-tab-panel='Options']")?.getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      return { top: rect.top, panelBottom: panel?.bottom || 0 };
    });
    assert.ok(provenancePosition.top > 0 && provenancePosition.top < provenancePosition.panelBottom, `Options provenance must render inside the options panel footer; got ${JSON.stringify(provenancePosition)}`);
    assert.deepEqual(
      await page.$$eval(".siw-expiry-list [data-expiry-row]", (nodes) => nodes.map((node) => node.getAttribute("data-expiry-row"))),
      expiries,
      "Robinhood options must render all eight published expiries",
    );
    const watchlistScroll = await page.$eval("[data-watchlist-scope]", (node) => ({
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      childWidths: [...node.children].slice(0, 3).map((child) => ({ clientWidth: child.clientWidth, scrollWidth: child.scrollWidth })),
    }));
    assert.equal(watchlistScroll.scrollWidth <= watchlistScroll.clientWidth, true, `desktop watchlist must not show a horizontal scrollbar: ${JSON.stringify(watchlistScroll)}`);
    assert.equal(await page.$eval(".siw-expiry-list", (node) => node.scrollWidth <= node.clientWidth), true, "desktop expiry rail must not show a horizontal scrollbar");
    assert.equal(await page.$("[data-options-summary]") === null, true, "obsolete options KPI strip must be removed");
    assert.equal(await page.$("[data-options-chart-controls]") !== null, true, "Options chart header controls must remain available");
    assert.equal(await page.$("input[aria-label='Strike zoom']") !== null, true, "Strike zoom must be in the Options chart header");
    assert.equal(await page.$("[data-options-sweeps-control]"), null, "unsupported Sweeps control must not be exposed");
    assert.equal(await page.$(".siw-market-pill") === null, true, "the redundant hero market refresh button must be removed");
    const publishedExpiryText = await page.$eval("[data-expiry-row='2026-07-10']", (node) => node.textContent || "");
    assert.doesNotMatch(publishedExpiryText, /Load\s*on select|Retry/, "published Robinhood expiry must expose its loaded summary");
    assert.match(publishedExpiryText, /\d/, "published Robinhood expiry must expose source-backed OI, volume, or strike values");
    assert.doesNotMatch(publishedExpiryText, /n\/a/i, "fresh Robinhood expiry rows with finite snapshot aggregates must not be rendered as n/a");
    const primaryModeButtons = await page.$$eval(".siw-options-subtabs button", (nodes) => nodes.slice(0, 3).map((node) => ({ text: node.textContent?.trim(), disabled: node.disabled })));
    assert.deepEqual(primaryModeButtons, [
      { text: "OI", disabled: false },
      { text: "Vol", disabled: false },
      { text: "GEX", disabled: false },
    ], "Robinhood OI, Vol and GEX modes must all be clickable");
    const aiSummaryText = await page.$eval("[data-ai-summary-panel]", (node) => node.textContent || "");
    assert.doesNotMatch(aiSummaryText, /\|\s*[-:]+\s*\|/, "AI summary must not expose Markdown table structure");
    await clickText(page, "GEX", true);
    await wait(500);
    assert.equal(await page.$$eval("[data-watcher-replica] [data-chart-bar]", (items) => items.length > 5), true);
    await page.screenshot({ path: path.join(screenshotsDir, "02-options-overview-gex-desktop.png") });
    await page.hover("[data-watcher-replica] [data-chart-bar]");
    await wait(150);
    assert.match(await visibleText(page), /Strike|Call|Put/);
    await page.click("[data-watcher-replica] [data-chart-bar]");
    await wait(700);
    assert.match(await page.$eval("body", (body) => body.innerText), /Strike Detail/i);
    await page.screenshot({ path: path.join(screenshotsDir, "06-strike-detail-drawer-desktop.png") });
    await page.click("[data-close-strike-detail]");
    await wait(150);

    const visibleOptionsTabs = await page.$$eval(".siw-options-subtabs button", (nodes) => [...new Set(nodes.map((node) => node.textContent?.trim()).filter(Boolean))]);
    for (const unsupportedTab of ["Flow", "Mis$", "Sweeps", "0DTE"]) {
      assert.equal(visibleOptionsTabs.includes(unsupportedTab), false, `${unsupportedTab} must not be exposed when the active source cannot support it`);
    }

    for (const subTab of ["OI", "Vol", "Greeks", "DEX", "IV", "P/C", "Chain"]) {
      await clickText(page, subTab, true);
      await wait(250);
      assert.match(await page.$eval(".siw-options-subtabs .is-active", (node) => node.textContent), new RegExp(subTab.replace("$", "\\$")));
      if (subTab === "OI" || subTab === "Vol") {
        assert.equal(await page.$$eval("[data-watcher-replica] [data-chart-bar]", (items) => items.length > 5), true, `${subTab} must render source-backed strike bars`);
      }
      if (subTab === "DEX") {
        assert.equal(await page.$$eval("[data-options-dex-bar]", (items) => items.length > 5), true, "DEX must render a source-backed diverging strike chart");
      }
      if (subTab === "IV") {
        assert.equal(await page.$$eval("[data-options-iv-bar]", (items) => items.length > 5), true, "IV must render the source-backed EOD smile, not an intraday time series");
      }
      if (subTab === "Greeks") {
        assert.equal(await page.$eval(".siw-greeks-board", (node) => node.scrollWidth <= node.clientWidth), true, "Greeks board must not overflow its options panel");
        assert.equal(await page.$eval(".siw-iv-bars em", (node) => getComputedStyle(node).writingMode), "horizontal-tb", "IV strike labels must remain horizontal so they do not overlap the bars");
        await page.screenshot({ path: path.join(screenshotsDir, "05-options-greeks-chain-desktop.png") });
      }
      if (subTab === "Chain") {
        const chainText = await page.$eval("[data-primary-tab-panel='Options']", (node) => node.textContent || "");
        assert.match(chainText, /Mark[\s\S]*n\/a/i, "Robinhood chain must show mark and explicit n/a for absent bid/ask, never fake 0.00 quotes");
        assert.doesNotMatch(chainText, /20\.0%/, "Robinhood chain must not synthesize a 20% IV fallback");
      }
      if (["Greeks", "DEX", "IV", "P/C", "Chain"].includes(subTab)) {
        assert.match(await page.$eval("[data-options-result-provenance]", (node) => node.textContent || ""), /Robinhood MCP EOD[\s\S]*2026[\s\S]*(proxy|chain)/i, `${subTab} must expose source, capture time and methodology`);
      }
    }

    await clickText(page, "GEX", true);
    await wait(300);
    const callsBeforeExpirySelection = apiCalls.length;
    const eighthExpiry = expiries[7];
    await page.click(`[data-expiry-row='${eighthExpiry}']`);
    await wait(250);
    const expirySelectionCalls = apiCalls.slice(callsBeforeExpirySelection);
    assert.ok(expirySelectionCalls.some((call) => call.params?.expiry === eighthExpiry), "eighth expiry click should request selected expiry detail");
    assert.equal(
      expirySelectionCalls.some((call) => call.tool === "get_options" && call.params?.expiry === eighthExpiry),
      true,
      "Robinhood eighth-expiry click must request the selected published chain",
    );
    assert.doesNotMatch(await visibleText(page), /No native Yahoo data for this expiry/i, "Robinhood data must never fall into a Yahoo-only empty state");

    await clickText(page, "Chart", true);
    await wait(600);
    assert.equal(await page.$("[data-chart-gex-by-strike]") !== null, true, "chart tab must include the Net GEX-by-strike panel");
    assert.equal(await page.$$eval("[data-chart-gex-bar]", (nodes) => nodes.length > 5), true, "chart GEX panel must render source-backed strike bars");
    assert.match(await page.$eval("[data-chart-gex-provenance]", (node) => node.textContent || ""), /Robinhood MCP EOD[\s\S]*OI-signed proxy, not dealer GEX/i, "chart GEX panel must expose the Robinhood proxy methodology");
    await page.evaluate(() => document.querySelector(".siw-main-scroll")?.scrollTo({ top: 0 }));
    await wait(150);
    await page.screenshot({ path: path.join(screenshotsDir, "03b-chart-gex-proxy-desktop.png") });
    assert.equal(await page.$("select[aria-label='Chart GEX expiry']"), null, "Chart GEX expiry control must be a custom checkbox selector, not a Ctrl-dependent native multi-select");
    const chartExpiryCallsBefore = apiCalls.length;
    await page.click("[data-chart-gex-expiry-trigger]");
    assert.equal(await page.$$eval("[data-chart-gex-expiry]:checked", (nodes) => nodes.length), 1, "Chart defaults to the current primary expiry only");
    await page.click(`[data-chart-gex-expiry='${expiries[1]}']`);
    await page.click(`[data-chart-gex-expiry='${expiries[2]}']`);
    await wait(500);
    assert.equal(await page.$$eval("[data-chart-gex-expiry]:checked", (nodes) => nodes.length), 3, "Chart GEX selector must support three independently checked expiries");
    assert.match(await page.$eval("[data-chart-gex-by-strike]", (node) => node.textContent || ""), /Average Net GEX by Strike[\s\S]*3 selected expiries/i, "multiple selected expiries must render the average GEX surface");
    assert.ok(apiCalls.slice(chartExpiryCallsBefore).filter((call) => call.tool === "get_options_gex" && [expiries[1], expiries[2]].includes(call.params?.expiry)).length >= 2, "each added expiry must request its own GEX data instead of reusing the primary expiry");
    const descendingGexStrikes = await page.$$eval("[data-chart-gex-bar]", (nodes) => nodes.map((node) => Number(node.getAttribute("data-chart-gex-strike"))));
    assert.equal(descendingGexStrikes.every((strike, index) => index === 0 || descendingGexStrikes[index - 1] > strike), true, "Chart GEX strikes must descend from top to bottom so the lowest strike is at the bottom");
    assert.equal(await page.$$eval("[data-chart-gex-contributors]", (nodes) => nodes.some((node) => node.getAttribute("data-chart-gex-contributors") === "3/3")), true, "GEX bars must disclose their expiry contributor count");
    await page.click("[data-chart-gex-expiry-trigger]");
    await clickText(page, "Options", true);
    await wait(220);
    const resetExpiry = expiries[3];
    await page.click(`[data-expiry-row='${resetExpiry}']`);
    await wait(250);
    await clickText(page, "Chart", true);
    await wait(350);
    await page.click("[data-chart-gex-expiry-trigger]");
    assert.deepEqual(await page.$$eval("[data-chart-gex-expiry]:checked", (nodes) => nodes.map((node) => node.getAttribute("data-chart-gex-expiry"))), [resetExpiry], "Options expiry selection must reset Chart aggregation to the same single primary expiry");
    await page.click(`[data-chart-gex-expiry='${resetExpiry}']`);
    assert.equal(await page.$$eval("[data-chart-gex-expiry]:checked", (nodes) => nodes.length), 1, "removing the final selected expiry must be blocked");
    await page.click("[data-chart-gex-expiry-trigger]");
    assert.equal(await page.$$eval("[data-chart-gex-spot='true']", (nodes) => nodes.length), 1, "chart GEX panel must mark the spot-nearest strike");
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await wait(180);
    assert.equal(await page.$eval("[data-chart-gex-by-strike]", (node) => node.scrollWidth <= node.clientWidth), true, "mobile chart GEX panel must not overflow horizontally");
    await page.setViewport({ width: 1248, height: 986, deviceScaleFactor: 1 });
    await clickText(page, "Options", true);
    await wait(180);

    delayedSnapshotSymbol = "QQQI";
    await page.click("[data-watcher-replica] [data-watchlist-row='AAPL']");
    await page.click("[data-watcher-replica] [data-watchlist-row='MSFT']");
    await page.click("[data-watcher-replica] [data-watchlist-row='QQQI']");
    await page.waitForFunction(() => document.querySelector("[data-ticker-loading]")?.textContent?.includes("QQQI"), { timeout: 5000 });
    assert.equal(await page.$eval(".siw-hero", (node) => node.getAttribute("data-selected-symbol")), "QQQI", "latest ticker must become active before its Yahoo response completes");
    assert.equal(await page.$eval(".siw-hero-identity h1", (node) => node.textContent), "QQQI", "hero identity must not retain the prior ticker while loading");
    assert.match(await page.$eval("[data-ticker-loading]", (node) => node.textContent || ""), /Previous ticker data is intentionally hidden/i);
    await page.waitForFunction(() => document.querySelector("[data-ticker-loading]") === null, { timeout: 5000 });
    delayedSnapshotSymbol = null;

    await page.click("[data-watcher-replica] [data-watchlist-row='TSLA']");
    await page.waitForFunction(() => document.querySelector(".siw-hero-identity h1")?.textContent === "TSLA", { timeout: 5000 });
    await wait(450);
    assert.equal(await page.$("[data-options-oi-unavailable]") !== null, true, "Yahoo zero OI must show an explicit unavailable state");
    assert.match(await page.$eval("[data-options-chart-controls]", (node) => node.textContent || ""), /GEX Pinning\s+Unavailable[\s\S]*P\/C OI\s+Unavailable/i, "zero OI must leave GEX and P\/C controls unavailable");
    assert.equal(await page.$eval(".siw-options-subtabs button", (node) => node.disabled), true, "OI must be disabled when Yahoo returns zero OI");
    await page.evaluate(() => {
      const detail = document.querySelector("[data-detail-stack]");
      detail?.scrollIntoView({ block: "start" });
    });
    await wait(250);
    await page.screenshot({ path: path.join(screenshotsDir, "07-ai-summary-audit-panels-desktop.png") });
    await page.evaluate(() => {
      const scroller = document.querySelector(".siw-main-scroll");
      scroller?.scrollTo({ top: 0 });
    });
    await wait(150);

    await clickText(page, "Overview");
    assert.equal(await page.$$eval(".siw-news-list a", (nodes) => nodes.length), 3);
    assert.match(await visibleText(page), /Yahoo quoteSummary calendarEvents \+ earningsHistory|Next earnings/i);

    for (const symbol of ["TSM", "NVDA", "AMZN"]) {
      await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
      await page.goto(`${baseUrl}/#/work/stocks-intelligence-watcher?symbol=${symbol}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-watcher-replica]");
      await wait(350);
      const cardText = await page.$$eval("[data-overview-tertiary-panel='valuation'], [data-overview-tertiary-panel='financials']", (nodes) => nodes.map((node) => node.textContent || "").join("\n"));
      assert.match(cardText, /Valuation|Current vs mean/i, `${symbol} must render its valuation card`);
      assert.match(cardText, /Financials|Revenue/i, `${symbol} must render its financials card`);
    }

    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
    await page.goto(`${baseUrl}/#/work/stocks-intelligence-watcher?symbol=NVDA`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-watcher-replica]");
    for (const topTab of ["Overview", "Chart", "Fundamentals", "Stats", "Earnings", "Options", "Short Vol", "News", "Holders"]) {
      await clickText(page, topTab, true);
      await wait(topTab === "Options" ? 900 : 450);
      const tabLayout = await page.evaluate((tab) => {
        const panel = document.querySelector(`[data-primary-tab-panel='${tab}']`);
        const genericBody = panel?.querySelector(".siw-generic-content");
        const panelRect = panel?.getBoundingClientRect();
        const bodyRect = genericBody?.getBoundingClientRect();
        const bodyStyle = genericBody ? getComputedStyle(genericBody) : null;
        const resultCards = panel ? Array.from(panel.querySelectorAll(".siw-tool-result-card")) : [];
        const singleCardRect = resultCards.length === 1 ? resultCards[0].getBoundingClientRect() : null;
        return {
          overflow: panel ? panel.scrollWidth - panel.clientWidth : 999,
          leftInset: panelRect && bodyRect ? Number.parseFloat(bodyStyle?.paddingLeft || "0") : null,
          rightInset: panelRect && bodyRect ? Number.parseFloat(bodyStyle?.paddingRight || "0") : null,
          singleCardFill: singleCardRect && bodyRect
            ? singleCardRect.width / Math.max(1, bodyRect.width - Number.parseFloat(bodyStyle?.paddingLeft || "0") - Number.parseFloat(bodyStyle?.paddingRight || "0"))
            : null,
          activeLabel: document.querySelector(".siw-main-tabs [aria-current='page']")?.textContent?.trim() || "",
        };
      }, topTab);
      assert.ok(tabLayout.overflow <= 1, `${topTab} must not create horizontal overflow; got ${JSON.stringify(tabLayout)}`);
      if (tabLayout.leftInset !== null && tabLayout.rightInset !== null) {
        assert.ok(tabLayout.leftInset >= 15 && tabLayout.rightInset >= 15, `${topTab} generic content must keep a 16px panel gutter; got ${JSON.stringify(tabLayout)}`);
      }
      if (tabLayout.singleCardFill !== null) {
        assert.ok(tabLayout.singleCardFill >= 0.98, `${topTab} single-result surface must use the available content width; got ${JSON.stringify(tabLayout)}`);
      }
      assert.match(tabLayout.activeLabel, new RegExp(topTab.replace(" ", "\\s*"), "i"), `${topTab} must expose its active navigation state`);
      await page.evaluate(() => document.querySelector("[data-primary-tab-panel]")?.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: path.join(screenshotsDir, `tab-${topTab.toLowerCase().replace(/\s+/g, "-")}-desktop.png`) });
    }

    await page.setViewport({ width: 1180, height: 820, deviceScaleFactor: 1 });
    await wait(300);
    await page.screenshot({ path: path.join(screenshotsDir, "uat-tablet.png") });
    await page.screenshot({ path: path.join(screenshotsDir, "08-responsive-tablet.png") });
    await page.setViewport({ width: 390, height: 900, deviceScaleFactor: 1 });
    await page.goto("about:blank");
    await page.goto(`${baseUrl}/#/work/stocks-intelligence-watcher?symbol=NVDA`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-watcher-replica]");
    await page.waitForFunction(() => document.querySelector(".siw-hero-identity h1")?.textContent === "NVDA", { timeout: 5000 });
    await clickText(page, "Options");
    await wait(300);
    assert.match(await page.$eval("[data-options-robinhood-provenance]", (node) => node.textContent || ""), /Robinhood MCP EOD/i, "mobile proof must use the Robinhood-backed NVDA snapshot");
    await page.screenshot({ path: path.join(screenshotsDir, "uat-mobile.png"), fullPage: true });
    await page.screenshot({ path: path.join(screenshotsDir, "08-responsive-mobile.png"), fullPage: true });
    for (const topTab of ["Overview", "Chart", "Fundamentals", "Stats", "Earnings", "Options", "Short Vol", "News", "Holders"]) {
      await clickText(page, topTab, true);
      await wait(topTab === "Options" ? 500 : 250);
      const mobileOverflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        root: document.querySelector("[data-watcher-replica]")?.scrollWidth - document.querySelector("[data-watcher-replica]")?.clientWidth,
      }));
      assert.ok(mobileOverflow.document <= 1 && mobileOverflow.root <= 1, `${topTab} mobile layout must not create horizontal page overflow; got ${JSON.stringify(mobileOverflow)}`);
    }
    await clickText(page, "Home");
    assert.match(await page.$eval(".siw-mobile-nav .is-active", (node) => node.textContent), /Home/);
    await clickText(page, "Watcher");
    assert.match(await page.$eval(".siw-mobile-nav .is-active", (node) => node.textContent), /Watcher/);

    assert.equal(consoleErrors.length, 0, `console errors: ${consoleErrors.join("; ")}`);
    console.log(`Stocks watcher replica UAT passed. Screenshots: ${screenshotsDir}`);
  } finally {
    if (browser) await browser.close();
    await stopProcessTree(server);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
