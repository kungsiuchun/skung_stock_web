const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer");
const { startVite, stopProcessTree, wait, waitForServer } = require("./helpers/browser-uat.cjs");

const rootDir = path.resolve(__dirname, "..");
const port = 5174;
const baseUrl = `http://127.0.0.1:${port}`;
const screenshotsDir = path.join(rootDir, "uat_screenshots", "stocks-watcher-replica");

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
  ["TSM", "Taiwan Semiconductor Manufacturing Company", "Semiconductors", "ADR", 418.45, -6.41, -1.51],
  ["MU", "Micron Technology Inc.", "Semiconductors", "Stock", 971, 47.48, 5.14],
  ["BRK-B", "Berkshire Hathaway Inc.", "Financials", "Stock", 474.48, -2.94, -0.62],
  ["LLY", "Eli Lilly and Company", "Health Care", "Stock", 1105, -21.8, -1.93],
  ["WMT", "Walmart Inc.", "Consumer Staples", "Stock", 115.75, -3.15, -2.65],
  ["AMD", "Advanced Micro Devices Inc.", "Semiconductors", "Stock", 516.1, -1.99, -0.38],
  ["JPM", "JPMorgan Chase & Co.", "Financials", "Stock", 299.31, 2.58, 0.87],
  ["V", "Visa Inc.", "Financials", "Stock", 326.36, 1.41, 0.43],
  ["XOM", "Exxon Mobil Corporation", "Energy", "Stock", 145.26, -1.7, -1.16],
  ["ORCL", "Oracle Corporation", "Technology", "Stock", 225.78, 22.08, 10.84],
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

const fearGreedFixture = () => ({
  data: {
    schemaVersion: "1.0",
    source: "CNN Fear & Greed Index",
    sourceUrl: "https://www.cnn.com/markets/fear-and-greed",
    asOf: "2026-09-09T20:00:00.000Z",
    score: 38.9,
    rating: "fear",
    comparisons: { previousClose: 40.2, previousWeek: 45.2, previousMonth: 60.1, previousYear: 76.4 },
    history: Array.from({ length: 60 }, (_, index) => ({
      at: new Date(Date.UTC(2026, 6, 1 + index)).toISOString(),
      score: 25 + ((index * 7) % 50),
      rating: index < 20 ? "fear" : index < 42 ? "neutral" : "greed",
    })),
  },
  cache: { status: "refreshed", dataset: "news", cachedAt: "2026-09-09T20:00:00.000Z", expiresAt: "2026-09-09T20:15:00.000Z", ageSeconds: 0, ttlMs: 900000, ageRatio: 0, guard: "fresh", rowRead: true, rowWritten: true },
});

const treasuryYieldCurveFixture = () => ({
  asOfDate: "2026-09-08",
  sourceUrl: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/all?_format=csv&page=&type=daily_treasury_yield_curve",
  curves: [
    { key: "latest", label: "Latest published", date: "2026-09-08", points: [{ label: "1M", years: 1 / 12, yield: 4.2 }, { label: "2Y", years: 2, yield: 3.9 }, { label: "10Y", years: 10, yield: 4.1 }, { label: "30Y", years: 30, yield: 4.5 }] },
    { key: "oneWeek", label: "1 week ago", date: "2026-09-01", points: [{ label: "1M", years: 1 / 12, yield: 4.18 }, { label: "2Y", years: 2, yield: 3.86 }, { label: "10Y", years: 10, yield: 4.05 }, { label: "30Y", years: 30, yield: 4.46 }] },
    { key: "oneMonth", label: "1 month ago", date: "2026-08-08", points: [{ label: "1M", years: 1 / 12, yield: 4.11 }, { label: "2Y", years: 2, yield: 3.8 }, { label: "10Y", years: 10, yield: 4.02 }, { label: "30Y", years: 30, yield: 4.43 }] },
    { key: "startOfYear", label: "Start of year", date: "2026-01-02", points: [{ label: "1M", years: 1 / 12, yield: 4.3 }, { label: "2Y", years: 2, yield: 4.02 }, { label: "10Y", years: 10, yield: 4.2 }, { label: "30Y", years: 30, yield: 4.62 }] },
  ],
  yieldRows: [{ maturity: "1M", yield: 4.2, oneDayBps: 2.1, oneWeekBps: 2, oneMonthBps: 9, yearToDateBps: -10 }, { maturity: "2Y", yield: 3.9, oneDayBps: 1.5, oneWeekBps: 4, oneMonthBps: 10, yearToDateBps: -12 }, { maturity: "10Y", yield: 4.1, oneDayBps: 2.5, oneWeekBps: 5, oneMonthBps: 8, yearToDateBps: -10 }, { maturity: "30Y", yield: 4.5, oneDayBps: 4, oneWeekBps: 4, oneMonthBps: 7, yearToDateBps: -12 }],
  spreadRows: [{ label: "10Y - 2Y", valueBps: 20, oneDayBps: 1, oneWeekBps: 1, oneMonthBps: -2, yearToDateBps: 2 }],
  source: { provider: "U.S. Department of the Treasury", label: "Daily Treasury Par Yield Curve Rates", url: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/all?_format=csv&page=&type=daily_treasury_yield_curve", fetchedAt: "2026-09-09T20:00:00.000Z" },
});

const fomcRateProbabilityFixture = () => ({
  meeting: {
    eventSlug: "fed-decision-in-september",
    title: "September Fed meeting",
    date: "2026-09-16",
    closesAt: "2026-09-16T17:59:00Z",
    observedAt: "2026-09-14T18:02:00Z",
    rawProbabilityTotal: 1.03,
    outcomes: [
      { key: "cut", label: "Cut", probability: 10.7 },
      { key: "hold", label: "Hold", probability: 59.2 },
      { key: "hike", label: "Hike", probability: 30.1 },
    ],
    noHikeProbability: 69.9,
    volume: 12345,
  },
  source: {
    provider: "Polymarket",
    label: "Fed decision prediction markets",
    type: "prediction-market implied",
    url: "https://polymarket.com/event/fed-decision-in-september",
    fetchedAt: "2026-09-14T18:03:00Z",
  },
});

const macroFixture = () => {
  const months = ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];
  const marketRows = [
    ["wti", "WTI Crude Oil", "DCOILWTICO", "daily", "USD / bbl", 91.4],
    ["brent", "Brent Crude Oil", "DCOILBRENTEU", "daily", "USD / bbl", 94.8],
    ["natural-gas", "Natural Gas · Henry Hub", "DHHNGSP", "daily", "USD / MMBtu", 3.42],
    ["copper", "Copper · Global", "PCOPPUSDM", "monthly", "USD / metric ton", 10342],
    ["uranium", "Uranium · Global", "PURANUSDM", "monthly", "USD / lb", 82.1],
    ["usd", "U.S. Dollar · Broad Index", "DTWEXBGS", "daily", "Index 2006=100", 119.2],
    ["all-commodities", "All Commodities", "PALLFNFINDEXM", "monthly", "Index 2016=100", 126.4],
    ["energy-index", "Energy Basket", "PNRGINDEXM", "monthly", "Index 2016=100", 138.6],
    ["metals-index", "Metals Basket", "PMETAINDEXM", "monthly", "Index 2016=100", 121.7],
  ].map(([id, label, seriesId, frequency, unit, value], index) => ({
    id, label, seriesId, frequency, unit, value, asOf: frequency === "daily" ? "2026-09-09" : "2026-07-01",
    changes: { oneDay: frequency === "daily" ? 0.4 + index / 10 : null, oneWeek: frequency === "daily" ? 1.2 - index / 10 : null, oneMonth: 2.1 + index / 10, threeMonth: -1.4 + index / 5, yearToDate: 8.2 - index / 3 },
  }));
  const inflationRows = [
    ["headline-pce", "Headline PCE", "YoY %", ["PCEPI"], 2.7],
    ["core-pce", "Core PCE · ex food & energy", "YoY %", ["PCEPILFE"], 2.9],
    ["trimmed-pce-1m", "Trimmed Mean PCE · 1M annualized", "Ann. %", ["PCETRIM1M158SFRBDAL"], 2.2],
    ["trimmed-pce-6m", "Trimmed Mean PCE · 6M annualized", "Ann. %", ["PCETRIM6M680SFRBDAL"], 2.35],
    ["trimmed-pce-12m", "Trimmed Mean PCE · 12M", "YoY %", ["PCETRIM12M159SFRBDAL"], 2.28],
    ["personal-income", "Personal Income", "MoM %", ["PI"], 0.43],
    ["personal-spending", "Personal Spending", "MoM %", ["PCE"], 0.16],
  ].map(([id, label, unit, seriesIds, base], rowIndex) => ({ id, label, unit, seriesIds, values: months.map((_, index) => Number((base + Math.sin(index + rowIndex) * 0.35).toFixed(2))) }));
  return {
    data: {
      generatedAt: "2026-09-10T20:00:00.000Z", asOf: "2026-09-09",
      markets: { asOf: "2026-09-09", rows: marketRows },
      inflation: { asOf: "2026-07-01", months, rows: inflationRows },
      source: { provider: "Federal Reserve Economic Data (FRED)", url: "https://fred.stlouisfed.org/", termsUrl: "https://fred.stlouisfed.org/docs/api/terms_of_use.html", series: [], note: "Daily EIA/Federal Reserve and monthly IMF/BEA/Dallas Fed series retrieved through FRED. Values may be revised." },
    },
    cache: { status: "refreshed", dataset: "history", cachedAt: "2026-09-10T20:00:00.000Z", expiresAt: "2026-09-10T21:00:00.000Z", ageSeconds: 0, ttlMs: 3600000, ageRatio: 0, guard: "fresh", rowRead: true, rowWritten: true },
  };
};

const marketBreadthSectors = [
  ["Communication Services", "XLC"], ["Consumer Discretionary", "XLY"], ["Consumer Staples", "XLP"], ["Energy", "XLE"], ["Financials", "XLF"], ["Health Care", "XLV"], ["Industrials", "XLI"], ["Information Technology", "XLK"], ["Materials", "XLB"], ["Real Estate", "XLRE"], ["Utilities", "XLU"],
];

const marketBreadthSnapshotId = (snapshot) => {
  const content = { ...snapshot };
  delete content.snapshotId;
  delete content.generatedAt;
  const serialized = JSON.stringify(content);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `market-breadth-v1-${snapshot.priceAsOf}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const marketBreadthFixture = (stale = false) => {
  const snapshot = {
    schemaVersion: 1,
    generatedAt: "2026-09-10T23:30:00.000Z",
    holdingsAsOf: "2026-09-10",
    priceAsOf: "2026-09-10",
    universeCount: 504,
    sectorPerformance: {
      benchmark: { symbol: "SPY", oneDay: 0.86, oneWeek: 1.4, oneMonth: 3.2, threeMonths: 7.6, yearToDate: 14.8 },
      rows: marketBreadthSectors.map(([sector, etf], index) => ({ sector, etf, weightPct: 36 - index * 2.1, contribution1dPctPoints: Number((0.28 - index * 0.04).toFixed(3)), oneDay: Number((1.1 - index * 0.17).toFixed(2)), oneWeek: Number((2.8 - index * 0.22).toFixed(2)), oneMonth: Number((4.7 - index * 0.31).toFixed(2)), threeMonths: Number((8.5 - index * 0.46).toFixed(2)), yearToDate: Number((17.2 - index * 0.7).toFixed(2)) })),
      proxyContribution1dPctPoints: 0.81,
      reconciliationGapPctPoints: 0.05,
    },
    breadth: {
      rows: marketBreadthSectors.map(([sector], index) => {
        const total = 32 + index;
        const cell = (periodOffset) => {
          const eligible = total - 1;
          const above = Math.max(0, Math.min(eligible, 25 - index + periodOffset));
          return { above, eligible, total, pct: Number(((above / eligible) * 100).toFixed(1)) };
        };
        return { sector, holdingCount: total, windows: { sma5: cell(3), sma20: cell(2), sma50: cell(1), sma100: cell(0), sma200: cell(-1) } };
      }),
    },
    sma200Slope: {
      rows: marketBreadthSectors.map(([sector, etf], index) => ({ sector, etf, windows: { session5: Number((0.8 - index * 0.1).toFixed(2)), session20: Number((2.4 - index * 0.2).toFixed(2)), session50: Number((5.7 - index * 0.35).toFixed(2)), session100: Number((11.4 - index * 0.5).toFixed(2)), session200: Number((22.5 - index * 0.8).toFixed(2)) } })),
    },
    coverage: { currentPriceCount: 504, constituent200DayCount: 503, constituent200DayPct: 99.8, totalConstituents: 504, sectorEtf400DayCount: 11, totalSectorEtfs: 11 },
    sources: [
      { id: "state-street", provider: "State Street Global Advisors", label: "SPY holdings", url: "https://www.ssga.com/", role: "Universe" },
      { id: "massive", provider: "Massive", label: "Adjusted U.S. stock daily aggregates", url: "https://massive.com/", role: "Prices" },
    ],
    warnings: [],
  };
  return { ...snapshot, snapshotId: marketBreadthSnapshotId(snapshot), status: "READY", freshness: stale ? { status: "STALE", reason: "LATEST_REFRESH_FAILED", failedAt: "2026-09-11T00:10:00.000Z", errorClass: "PROVIDER_UNAVAILABLE" } : { status: "FRESH", reason: "CURRENT" } };
};

let refreshAllMode = false;
let delayedSnapshotSymbol = null;
let marketBreadthApiMode = "READY";
let macroApiMode = "FRESH";

const buildToolResponse = (tool, params = {}) => {
  if (tool === "get_watchlist") {
    return { ok: true, tool, params, text: "watchlist", raw: { stocks: stockRecords }, calledAt: "2026-07-08T21:33:01.000Z" };
  }

  if (tool === "get_valuation_bands") {
    const symbol = String(params.symbol || "NVDA").toUpperCase();
    const metric = String(params.metric || "pe").toLowerCase();
    const valuation = buildSnapshot(symbol).valuation;
    return { ok: true, tool, params, text: "valuation bands", raw: { ...valuation, symbol, metric }, calledAt: "2026-07-09T20:00:00.000Z" };
  }

  if (tool === "get_financial_statements") {
    const symbol = String(params.symbol || "NVDA").toUpperCase();
    const dates = ["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30", "2025-03-31", "2024-12-31", "2024-09-30", "2024-06-30", "2024-03-31", "2023-12-31", "2023-09-30"];
    const quarters = dates.map((date, index) => ({
      date,
      filingDate: date,
      fiscalYear: index < 2 ? "2027" : index < 6 ? "2026" : index < 10 ? "2025" : "2024",
      period: `Q${((3 - index) % 4 + 4) % 4 + 1}`,
      currency: "USD",
      revenue: 96_000_000_000 - index * 3_500_000_000,
      netIncome: 52_000_000_000 - index * 2_100_000_000,
      eps: 1.22 - index * 0.045,
      operatingCashFlow: 57_000_000_000 - index * 2_300_000_000,
      freeCashFlow: 49_000_000_000 - index * 2_000_000_000,
      revenue_qoq: 4.8 - index * 0.18,
      revenue_yoy: 55.2 - index * 1.3,
      netIncome_qoq: 3.9 - index * 0.14,
      netIncome_yoy: 58.7 - index * 1.4,
      eps_qoq: 4.1 - index * 0.16,
      eps_yoy: 57.9 - index * 1.35,
      operatingCashFlow_qoq: 3.4 - index * 0.11,
      operatingCashFlow_yoy: 49.6 - index * 1.2,
    }));
    return {
      ok: true,
      tool,
      params,
      text: `${symbol} financial statements through 2026-06-30.`,
      raw: {
        schemaVersion: "1.0",
        source: "ValuationCalculation financial statements export",
        symbol,
        generatedAt: "2026-07-09T20:00:00.000Z",
        dataAsOf: "2026-06-30",
        financialSource: {
          source: "SEC companyfacts",
          sourceType: "company_filing",
          sourceUrl: "https://data.sec.gov/api/xbrl/companyfacts/CIK0001045810.json",
          fetchedAt: "2026-07-09T19:54:00.000Z",
          dataAsOf: "2026-06-30",
          filingDate: "2026-08-28",
        },
        quarters,
      },
      calledAt: "2026-07-09T20:00:00.000Z",
    };
  }

  if (tool === "earnings_vol_crush") {
    return {
      ok: true,
      tool,
      params,
      text: "NVDA earnings event context",
      raw: {
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
          priceMove: { eventTradingDate: "2026-05-20", previousClose: 134.38, close: 135.5, changePercent: 0.83, basis: "close_to_close" },
        },
      },
      calledAt: "2026-07-09T20:00:00.000Z",
    };
  }

  if (tool === "historical_context") {
    return { ok: true, tool, params, text: "NVDA earnings context\n- 1M return: +2.56%\n- 30-session close range: $195.04 - $230.36", raw: { source: "Yahoo Finance" }, calledAt: "2026-07-09T20:00:00.000Z" };
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
    return { ok: true, tool, params, text: `${provenance.provider} options chain`, raw: { source: provenance.provider, chain, exposures: zeroOi ? [] : rows, provenance }, calledAt: "2026-07-09T21:00:00.000Z" };
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
    server = startVite({ rootDir, port, host: "127.0.0.1", logOutput: true });
    await waitForServer(baseUrl);

    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    page.on("console", (message) => {
      if (message.type() === "error" && !/status of (404|502|503)/.test(message.text())) consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.setRequestInterception(true);
    page.on("request", async (request) => {
      const url = new URL(request.url());
      if (url.pathname.includes("/api/market-breadth")) {
        apiCalls.push({ method: "GET", endpoint: "market-breadth", mode: marketBreadthApiMode });
        if (marketBreadthApiMode === "EMPTY") {
          await request.respond({ status: 404, contentType: "application/json", body: JSON.stringify({ status: "EMPTY", errorCode: "INITIAL_BACKFILL_REQUIRED", message: "Market breadth initial backfill has not published a snapshot yet." }) });
          return;
        }
        if (marketBreadthApiMode === "ERROR") {
          await request.respond({ status: 503, contentType: "application/json", body: JSON.stringify({ status: "ERROR", errorCode: "MARKET_BREADTH_R2_BINDING_MISSING", message: "Market breadth storage is unavailable." }) });
          return;
        }
        if (marketBreadthApiMode === "INVALID") {
          await request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "READY", freshness: { status: "FRESH", reason: "CURRENT" } }) });
          return;
        }
        await request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(marketBreadthFixture(marketBreadthApiMode === "STALE")) });
        return;
      }
      if (url.pathname.includes("/api/fear-greed")) {
        apiCalls.push({ method: "GET", endpoint: "fear-greed" });
        await request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(fearGreedFixture()) });
        return;
      }
      if (url.pathname.includes("/api/treasury-yield-curve")) {
        apiCalls.push({ method: "GET", endpoint: "treasury-yield-curve" });
        await request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(treasuryYieldCurveFixture()) });
        return;
      }
      if (url.pathname.includes("/api/fomc-rate-probability")) {
        apiCalls.push({ method: "GET", endpoint: "fomc-rate-probability" });
        await request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(fomcRateProbabilityFixture()) });
        return;
      }
      if (url.pathname.includes("/api/stocks-watcher-macro")) {
        apiCalls.push({ method: "GET", endpoint: "stocks-watcher-macro", mode: macroApiMode });
        if (macroApiMode === "ERROR") {
          await request.respond({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "FRED refresh timed out." }) });
          return;
        }
        const payload = macroFixture();
        if (macroApiMode === "STALE") {
          payload.cache = { ...payload.cache, status: "stale", refreshError: "FRED refresh timed out." };
        }
        await request.respond({ status: macroApiMode === "STALE" ? 206 : 200, contentType: "application/json", body: JSON.stringify(payload) });
        return;
      }
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
    await page.waitForFunction(() => document.querySelectorAll("[data-spx-market-breadth] table[data-testid]").length === 3, { timeout: 5000 });
    const spxBreadthLayout = await page.evaluate(() => {
      const panel = document.querySelector("[data-overview-bottom-panel='spx-market-breadth']");
      const tertiary = document.querySelector("[data-overview-tertiary]");
      const panelRect = panel?.getBoundingClientRect();
      const tertiaryRect = tertiary?.getBoundingClientRect();
      return {
        followsTertiary: Boolean(tertiary && panel && (tertiary.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING)),
        panelWidth: panelRect?.width || 0,
        tertiaryWidth: tertiaryRect?.width || 0,
        tables: panel?.querySelectorAll("table[data-testid]").length || 0,
        text: panel?.textContent || "",
      };
    });
    assert.equal(spxBreadthLayout.followsTertiary, true, "S&P 500 breadth must be the final Overview section after the tertiary cards");
    assert.equal(spxBreadthLayout.tables, 3, "Watcher must embed all three S&P 500 breadth tables");
    assert.ok(spxBreadthLayout.panelWidth >= spxBreadthLayout.tertiaryWidth - 1, `S&P 500 breadth must span the full Overview width: ${JSON.stringify(spxBreadthLayout)}`);
    assert.match(spxBreadthLayout.text, /SPY universe[\s\S]*S&P 500 Market Breadth[\s\S]*EOD snapshot publishes after the provider's next-day window, not intraday/i);
    assert.match(spxBreadthLayout.text, /Price date\s*Sep 10, 2026[\s\S]*Constituents\s*504[\s\S]*SMA200 coverage\s*99\.8%[\s\S]*Freshness\s*FRESH/i);
    assert.ok(apiCalls.some((call) => call.endpoint === "market-breadth" && call.mode === "READY"), "Watcher must read the published market-breadth API, not a Yahoo tool fallback");
    assert.match(await visibleText(page), /Watchlist Market Breadth \(Yahoo live quotes\)/i, "existing Yahoo watchlist breadth must remain separately labelled");

    marketBreadthApiMode = "STALE";
    await page.click("[data-spx-market-breadth] .siw-spx-market-breadth-refresh");
    await page.waitForFunction(() => document.querySelector("[data-spx-market-breadth]")?.textContent?.includes("STALE SNAPSHOT"), { timeout: 5000 });
    assert.match(await page.$eval("[data-spx-market-breadth]", (node) => node.textContent || ""), /last successful Sep 10, 2026 close[\s\S]*PROVIDER_UNAVAILABLE/i, "stale breadth must retain EOD date and failure provenance");

    marketBreadthApiMode = "EMPTY";
    await page.click("[data-spx-market-breadth] .siw-spx-market-breadth-refresh");
    await page.waitForFunction(() => document.querySelector("[data-spx-market-breadth]")?.textContent?.includes("Initial backfill required"), { timeout: 5000 });

    marketBreadthApiMode = "INVALID";
    await page.click("[data-spx-market-breadth] .siw-spx-market-breadth-refresh");
    await page.waitForFunction(() => document.querySelector("[data-spx-market-breadth]")?.textContent?.includes("Market breadth unavailable"), { timeout: 5000 });
    assert.match(await page.$eval("[data-spx-market-breadth]", (node) => node.textContent || ""), /schema version is invalid/i, "invalid published breadth payload must fail closed");

    marketBreadthApiMode = "ERROR";
    await page.$eval("[data-spx-market-breadth] button", (button) => button.click());
    await page.waitForFunction(() => document.querySelector("[data-spx-market-breadth]")?.textContent?.includes("storage is unavailable"), { timeout: 5000 });

    marketBreadthApiMode = "READY";
    await page.$eval("[data-spx-market-breadth] button", (button) => button.click());
    await page.waitForFunction(() => document.querySelectorAll("[data-spx-market-breadth] table[data-testid]").length === 3, { timeout: 5000 });
    await page.$eval("[data-spx-market-breadth]", (node) => node.scrollIntoView({ block: "start" }));
    await wait(150);
    await page.screenshot({ path: path.join(screenshotsDir, "01a-spx-market-breadth-desktop.png") });
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
    await page.waitForFunction(() => document.querySelector("[data-watchlist-breadth]")?.getAttribute("data-watchlist-coverage") === "19/20", { timeout: 5000 });
    assert.equal(await page.$eval("[data-watchlist-breadth]", (node) => node.getAttribute("data-watchlist-coverage")), "19/20", "entering the Watcher must automatically refresh the 20-symbol curated Yahoo quote rows");
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
    assert.match(await visibleText(page), /Technology · 3\/3/);
    assert.doesNotMatch(await visibleText(page), /Stale cache sector/);
    assert.match(await visibleText(page), /LEAD \+4\.20%/);
    assert.match(await visibleText(page), /LOSS -2\.70%/);
    assert.match(await visibleText(page), /Watchlist Market Breadth \(Yahoo live quotes\)/i);
    assert.equal(await page.$eval("[data-watchlist-breadth]", (node) => node.getAttribute("data-watchlist-coverage")), "19/20", "breadth coverage must exclude a Yahoo row whose change fields are unavailable");
    assert.equal(await page.$eval("[data-watchlist-row='QQQI']", (node) => node.getAttribute("data-row-change")), "", "missing Yahoo change fields must remain unavailable instead of becoming a fake unchanged quote");
    assert.equal(await page.$eval("[data-watchlist-row='QQQI']", (node) => node.getAttribute("data-row-change-available")), "false", "missing Yahoo change evidence must remain observable in the row contract");
    assert.match(await page.$eval("[data-watchlist-row='QQQI'] .siw-row-change", (node) => node.textContent || ""), /--/, "missing Yahoo change fields must render explicitly unavailable");
    assert.match(await visibleText(page), /Change coverage 19\/20 · 1 unavailable/i, "breadth header must disclose unavailable change evidence");
    assert.match(await page.$eval(".siw-breadth-counts", (node) => node.textContent || ""), /Unchanged\s*1\s*·\s*META/i, "a genuine zero-change Yahoo quote must remain unchanged and identify its ticker");
    assert.equal(await page.$eval("[data-watchlist-sector='Technology']", (node) => node.getAttribute("data-watchlist-sector-coverage")), "3/3", "sector coverage should derive from visible Yahoo quote rows");
    await page.select("select[aria-label='Sector filter']", "Technology");
    await page.waitForFunction(() => document.querySelector("[data-watchlist-breadth]")?.getAttribute("data-watchlist-coverage") === "3/3", { timeout: 5000 });
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
    assert.equal(await page.$("[data-coverage-request-panel]"), null, "coverage request must not occupy dashboard space");
    assert.equal(await page.$("[data-bottom-panels]"), null, "the removed coverage row must not leave an empty layout wrapper");
    assert.equal(await page.$(".siw-tool-runs[data-tool-runs]"), null, "tool telemetry must not take permanent dashboard space");
    assert.equal(await page.$(".siw-tool-catalog[data-tool-catalog]"), null, "tool catalog must not take permanent dashboard space");
    const overviewColumns = await page.evaluate(() => {
      const uniqueColumns = (selector) => {
        const columns = [];
        for (const node of document.querySelectorAll(selector)) {
          const rect = node.getBoundingClientRect();
          if (!columns.some((column) => Math.abs(column.left - rect.left) <= 1)) columns.push({ left: rect.left, right: rect.right });
        }
        return columns.sort((a, b) => a.left - b.left);
      };
      return uniqueColumns("[data-overview-tertiary] > .siw-panel");
    });
    assert.equal(overviewColumns.length, 3, `overview tertiary area must have three columns; got ${JSON.stringify(overviewColumns)}`);
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
    await page.evaluate(() => document.querySelector("[data-overview-tertiary]")?.scrollIntoView({ block: "start" }));
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
    assert.equal(tertiaryBoxes.length, 6, "overview must render news, earnings, valuation, financials, market context, and key metrics panels");
    const tertiaryByPanel = Object.fromEntries(tertiaryBoxes.map((box) => [box.panel, box]));
    assert.ok(
      ["news", "earnings", "metrics"].every((panel) => Math.abs(tertiaryByPanel[panel].top - tertiaryByPanel.news.top) <= 2),
      `news, earnings, and key metrics must remain aligned in the first overview tertiary row; got ${JSON.stringify(tertiaryBoxes)}`,
    );
    assert.ok(
      tertiaryByPanel.news.left < tertiaryByPanel.earnings.left && tertiaryByPanel.earnings.left < tertiaryByPanel.metrics.left,
      "key metrics must swap into valuation's prior top-right position",
    );
    assert.ok(tertiaryByPanel.financials.top > tertiaryByPanel.news.top && tertiaryByPanel.valuation.top > tertiaryByPanel.news.top, "valuation must remain below key metrics");
    assert.ok(tertiaryByPanel.financials.left < tertiaryByPanel.valuation.left && tertiaryByPanel.valuation.left < tertiaryByPanel['market-context'].left, "approved universe market context must replace coverage request in the second tertiary row");
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
    assert.doesNotMatch(overviewText, /Coverage request|Sign in to queue a ticker/i, "the removed owner-only coverage request must not be visible in the overview");
    assert.equal(await page.$("[data-valuation-rainbow-chart]") !== null, true, "valuation card must render the metric-based rainbow band chart");
    assert.equal(await page.$$eval("select[aria-label='Curated valuation ticker'] option", (nodes) => nodes.length), 20, "valuation ticker selector must exactly match the 20 admin-curated symbols");
    await page.select("select[aria-label='Curated valuation ticker']", "MSFT");
    await page.waitForFunction(() => document.querySelector("[data-valuation-rainbow-chart]")?.getAttribute("data-valuation-metric") === "pe", { timeout: 5000 });
    await page.select("select[aria-label='Valuation metric']", "ps");
    await page.waitForFunction(() => document.querySelector("[data-valuation-rainbow-chart]")?.getAttribute("data-valuation-metric") === "ps", { timeout: 5000 });
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
    const heroChartBox = await page.$eval(".siw-hero-chart .siw-sparkline-frame", (node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.left + 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(heroChartBox.x, heroChartBox.y);
    await page.waitForFunction(() => /\b1\/\d+ pts\b/.test(document.querySelector(".siw-hero-chart [data-sparkline-tooltip]")?.textContent || ""));
    assert.equal(await page.$(".siw-hero-chart [data-sparkline-change]"), null, "first hero point has no prior-point change to display");
    assert.equal(await page.$(".siw-hero-chart [data-sparkline-active-dot]"), null, "hero hover should not draw a hollow point ring");
    assert.equal(await page.$$eval(".siw-hero-chart .siw-sparkline line", (nodes) => nodes.length), 1, "hero hover should keep only the vertical guide, without a dashed baseline");
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
      assert.equal(await page.$(`[data-market-index-card='${symbol}'] [data-sparkline-active-dot]`), null, `${symbol} hover should not draw a hollow point ring`);
      assert.equal(await page.$$eval(`[data-market-index-card='${symbol}'] .siw-sparkline line`, (nodes) => nodes.length), 1, `${symbol} hover should keep only the vertical guide`);
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
    assert.equal(await page.$("[data-settings-panel] .siw-tool-runs") !== null, true, "Help must contain the native Yahoo tool-run diagnostics");
    assert.equal(await page.$("[data-settings-panel] .siw-tool-catalog") !== null, true, "Help must contain the native Yahoo tool catalog");
    assert.doesNotMatch(await page.$eval("[data-settings-panel]", (node) => node.textContent || ""), /Approved Universe Market Context/, "market context must remain outside Help as a dashboard panel");
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

    assert.equal(await page.$$eval("button", (nodes) => nodes.some((node) => node.textContent?.trim() === "Stats")), false, "Stats must be merged into Fundamentals instead of remaining as a duplicate tab");
    await clickText(page, "Fundamentals");
    await wait(700);
    assert.match(await visibleText(page), /Fundamentals/i);
    assert.match(await visibleText(page), /NMS/);
    assert.match(await visibleText(page), /Semiconductors/);
    assert.match(await page.$eval("[data-primary-tab-panel='Fundamentals'] [data-company-description]", (node) => node.textContent || ""), /NVIDIA designs accelerated computing/i, "Fundamentals must show the Yahoo company description");
    assert.equal(await page.$eval("[data-primary-tab-panel='Fundamentals'] .siw-description-toggle", (node) => node.textContent), "Read more", "long company descriptions must start collapsed");
    await page.click("[data-primary-tab-panel='Fundamentals'] .siw-description-toggle");
    assert.equal(await page.$eval("[data-primary-tab-panel='Fundamentals'] .siw-description-toggle", (node) => node.textContent), "Show less", "company description toggle must expand the hidden text");
    const statsHeaderAlignment = await page.evaluate(() => [
      [document.querySelector(".siw-stats-left .siw-panel-title span"), document.querySelector(".siw-stats-left .siw-stat-table")],
      [document.querySelector(".siw-financial-summary .siw-panel-title span"), document.querySelector(".siw-financial-summary .siw-stat-table")],
      [document.querySelector(".siw-cashflow-panel .siw-panel-title span"), document.querySelector(".siw-cashflow-panel .siw-stat-table")],
    ].map(([title, table]) => ({ titleLeft: title?.getBoundingClientRect().left, tableLeft: table?.getBoundingClientRect().left })));
    assert.equal(statsHeaderAlignment.every(({ titleLeft, tableLeft }) => Math.abs(titleLeft - tableLeft) <= 1), true, `Stats panel titles must align with their tables; got ${JSON.stringify(statsHeaderAlignment)}`);
    const statsSectionSpacing = await page.evaluate(() => {
      const panelHeader = document.querySelector(".siw-stats-left .siw-panel-title")?.getBoundingClientRect();
      return Array.from(document.querySelectorAll(".siw-stat-columns h3")).slice(0, 2).map((heading) => ({
        label: heading.textContent,
        topInset: panelHeader ? heading.getBoundingClientRect().top - panelHeader.bottom : -1,
      }));
    });
    assert.equal(statsSectionSpacing.every(({ topInset }) => topInset >= 15), true, `Stats subsection headings must keep a 16px gap below the panel divider; got ${JSON.stringify(statsSectionSpacing)}`);
    assert.equal(await page.$eval(".siw-financial-summary .siw-stat-table thead th:nth-child(2)", (node) => getComputedStyle(node).textAlign), "center", "Financial Summary value header must be centered");
    assert.equal(await page.$eval(".siw-financial-summary .siw-stat-table thead th:nth-child(3)", (node) => getComputedStyle(node).textAlign), "center", "Financial Summary context header must be centered");
    assert.doesNotMatch(await page.$eval("[data-primary-tab-panel='Fundamentals']", (node) => node.textContent || ""), /Needs checking/i, "Fundamentals must render Yahoo values or n\/a, never a placeholder");
    await page.screenshot({ path: path.join(screenshotsDir, "04-stats-fundamentals-earnings-desktop.png") });

    await clickText(page, "Fixed Income", true);
    await wait(500);
    assert.equal(await page.$("[data-fixed-income-panel]") !== null, true, "Fixed Income must render the Treasury curve surface");
    assert.equal(await page.$("[data-fomc-probability-panel]") !== null, true, "Fixed Income must render the FOMC probability surface");
    assert.match(await page.$eval("[data-fomc-probability-panel]", (node) => node.textContent || ""), /Polymarket prediction-market implied/, "FOMC probabilities must disclose the prediction-market source");
    assert.deepEqual(await page.$$eval("[data-fomc-probability-outcome]", (nodes) => [...new Set(nodes.map((node) => node.getAttribute("data-fomc-probability-outcome")))].sort()), ["cut", "hike", "hold"], "FOMC probability surface must show Cut, Hold, and Hike");
    assert.equal(await page.$("[data-fixed-income-chart] .recharts-line") !== null, true, "Fixed Income must render the existing yield curve chart");
    assert.match(await page.$eval("[data-fixed-income-table]", (node) => node.textContent || ""), /10Y - 2Y/, "Fixed Income must render the Treasury yield and spread table");
    assert.ok(apiCalls.some((call) => call.endpoint === "treasury-yield-curve"), "Fixed Income must request the server-side Treasury API");
    assert.ok(apiCalls.some((call) => call.endpoint === "fomc-rate-probability"), "Fixed Income must request the server-side FOMC probability API");

    await clickText(page, "F/G Index", true);
    await wait(350);
    assert.equal(await page.$("[data-fear-greed-panel]") !== null, true, "F/G Index must render the CNN sentiment surface");
    assert.match(await page.$eval("[data-fear-greed-gauge]", (node) => node.textContent || ""), /38\.9/, "F/G Index must expose the cached CNN score in its gauge");
    assert.deepEqual(await page.$eval("[data-fear-greed-gauge]", (gauge) => Array.from(gauge.querySelectorAll(".siw-fear-greed-stage")).map((node) => ({ dasharray: node.getAttribute("stroke-dasharray"), dashoffset: node.getAttribute("stroke-dashoffset") }))), [
      { dasharray: "25 100", dashoffset: "0" },
      { dasharray: "20 100", dashoffset: "-25" },
      { dasharray: "11 100", dashoffset: "-45" },
      { dasharray: "19 100", dashoffset: "-56" },
      { dasharray: "25 100", dashoffset: "-75" },
    ], "F/G Index gauge must cover every score range through the Extreme Greed endpoint");
    assert.equal(await page.$("[data-fear-greed-line-chart] svg polyline") !== null, true, "F/G Index must render its one-year line chart");
    assert.equal(await page.$("[data-fear-greed-line-chart] .siw-fear-greed-last-point") === null, true, "F/G Index must not render an unexplained latest-point circle");
    assert.match(await page.$eval("[data-fear-greed-stages]", (node) => node.textContent || ""), /Extreme Fear[\s\S]*Fear[\s\S]*Neutral[\s\S]*Greed[\s\S]*Extreme Greed/, "F/G Index must show all five sentiment stages instead of only the extremes");
    assert.deepEqual(await page.$eval("[data-fear-greed-panel] .siw-fear-greed-comparisons", (panel) => Array.from(panel.children).map((node) => ({ tone: node.className, stage: node.querySelector("em")?.textContent }))), [
      { tone: "is-fear", stage: "Fear" },
      { tone: "is-neutral", stage: "Neutral" },
      { tone: "is-greed", stage: "Greed" },
      { tone: "is-extreme-greed", stage: "Extreme Greed" },
    ], "every F/G comparison period should show its own score stage");
    assert.match(await page.$eval("[data-fear-greed-cache]", (node) => node.textContent || ""), /D1 cache refreshed[\s\S]*TTL: 15 min/, "F/G Index must disclose the shared D1 cache contract");
    assert.ok(apiCalls.some((call) => call.endpoint === "fear-greed"), "F/G Index must call only the server-side fear-greed API");

    await clickText(page, "Earnings", true);
    await wait(350);
    assert.equal(await page.$("[data-earnings-report]") !== null, true, "Earnings must render the dedicated earnings intelligence workspace");
    assert.match(await page.$eval("[data-earnings-yahoo-event]", (node) => node.textContent || ""), /Next earnings[\s\S]*Latest EPS result[\s\S]*Latest price reaction/i, "Earnings must keep Yahoo event fields distinct");
    assert.match(await page.$eval("[data-earnings-source]", (node) => node.textContent || ""), /SEC companyfacts[\s\S]*company_filing[\s\S]*Fetched \/ published/i, "Earnings must disclose financial-source provenance and release freshness");
    const visibleEarningsQuarterRows = async () => page.$$eval("[data-earnings-quarter-row]", (rows) => rows.filter((row) => {
      const rect = row.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).length);
    assert.equal(await visibleEarningsQuarterRows(), 8, "Earnings must default to an 8-quarter reported-results table");
    assert.equal(await page.$eval(".siw-earnings-table thead th:nth-child(2)", (node) => node.textContent), "Filed", "quarter dates are SEC filing dates, not earnings announcement dates");
    const epsChartBox = await page.$eval("[data-earnings-eps-trend] .siw-sparkline-frame", (node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.left + 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(epsChartBox.x, epsChartBox.y);
    await page.waitForFunction(() => /\b1\/\d+ pts\b/.test(document.querySelector("[data-earnings-eps-trend] [data-sparkline-tooltip]")?.textContent || ""));
    assert.equal(await page.$("[data-earnings-eps-trend] [data-sparkline-change]"), null, "first EPS point has no prior-point change to display");
    assert.equal(await page.$("[data-earnings-eps-trend] [data-sparkline-active-dot]"), null, "EPS hover should not draw a hollow point ring");
    assert.equal(await page.$$eval("[data-earnings-eps-trend] .siw-sparkline line", (nodes) => nodes.length), 1, "EPS hover should keep only the vertical guide");
    assert.ok(apiCalls.some((call) => call.tool === "earnings_vol_crush"), "Earnings must execute the Yahoo event plan");
    const earningsSymbol = await page.$eval(".siw-hero-identity h1", (node) => node.textContent || "");
    assert.ok(apiCalls.some((call) => call.tool === "get_financial_statements" && call.params?.symbol === earningsSymbol && call.params?.periods === 12), `Earnings must request 12 ValuationCalculation quarters once; got ${JSON.stringify(apiCalls.filter((call) => call.tool === "get_financial_statements"))}`);
    const financialCallsBeforeQuarterChange = apiCalls.filter((call) => call.tool === "get_financial_statements").length;
    await clickText(page, "12 quarters", true);
    await wait(100);
    assert.equal(await visibleEarningsQuarterRows(), 12, "Earnings quarter selector must reveal the cached 12-quarter report");
    assert.equal(apiCalls.filter((call) => call.tool === "get_financial_statements").length, financialCallsBeforeQuarterChange, "Earnings quarter selector must not refetch the report");

    for (const [topTab, expectedTool] of [["News", "morning_briefing"]]) {
      await clickText(page, topTab, true);
      await wait(350);
      const panelText = await page.$eval(`[data-primary-tab-panel='${topTab}']`, (node) => node.textContent || "");
      assert.match(panelText, new RegExp(expectedTool), `${topTab} must render its source-backed tool result instead of a dead placeholder`);
      assert.ok(apiCalls.some((call) => call.tool === expectedTool), `${topTab} must execute its declared native tool plan`);
    }

    await clickText(page, "Macro", true);
    await page.waitForSelector("[data-macro-panel] [data-macro-markets]");
    const macroProof = await page.evaluate(() => ({
      marketRows: document.querySelectorAll("[data-macro-markets] tbody tr").length,
      inflationRows: document.querySelectorAll("[data-macro-inflation] tbody tr").length,
      inflationMonths: document.querySelectorAll("[data-macro-inflation] thead th").length - 2,
      text: document.querySelector("[data-macro-panel]")?.textContent || "",
    }));
    assert.deepEqual([macroProof.marketRows, macroProof.inflationRows, macroProof.inflationMonths], [9, 7, 12]);
    assert.match(macroProof.text, /Federal Reserve Economic Data \(FRED\)/i);
    assert.match(macroProof.text, /Daily through Sep 9, 2026[\s\S]*Monthly through Jul 26/i, "Macro must distinguish daily and monthly source dates");
    assert.match(macroProof.text, /Retrieved Sep 10, 2026/i, "Macro must expose the cache retrieval time");
    const macroThemeProof = await page.evaluate(() => {
      const style = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const computed = getComputedStyle(node);
        return { color: computed.color, background: computed.backgroundColor };
      };
      return {
        positive: style('.siw-macro-change[data-change-direction="positive"]'),
        negative: style('.siw-macro-change[data-change-direction="negative"]'),
        cool: style(".siw-macro-heat.is-cool-4"),
        hot: style(".siw-macro-heat.is-hot-4"),
      };
    });
    assert.equal(macroThemeProof.positive?.color, "rgb(22, 219, 114)", "positive macro changes must use the Watcher green token");
    assert.match(macroThemeProof.positive?.background || "", /22, 219, 114/, "positive macro changes must have green conditional formatting");
    assert.equal(macroThemeProof.negative?.color, "rgb(255, 62, 77)", "negative macro changes must use the Watcher red token");
    assert.match(macroThemeProof.negative?.background || "", /255, 62, 77/, "negative macro changes must have red conditional formatting");
    assert.match(macroThemeProof.cool?.background || "", /17, 135, 255/, "low inflation readings must use the Watcher blue scale");
    assert.match(macroThemeProof.hot?.background || "", /255, 62, 77/, "high inflation readings must use the Watcher red scale");
    assert.ok(apiCalls.some((call) => call.endpoint === "stocks-watcher-macro"), "Macro must request its dedicated source-backed endpoint");
    const macroStatusText = await page.$eval(".siw-status-bar", (node) => node.textContent || "");
    assert.match(macroStatusText, /Federal Reserve Economic Data[\s\S]*EIA[\s\S]*IMF[\s\S]*BEA/i);
    assert.doesNotMatch(macroStatusText, /Yahoo Finance/i, "Macro footer must not claim Yahoo provenance");
    assert.doesNotMatch(macroStatusText, /Published macro data/i, "Macro footer must not claim freshness independently of the panel state");
    await page.screenshot({ path: path.join(screenshotsDir, "09-macro-dashboard-desktop.png"), fullPage: true });
    await page.$eval(".siw-main-scroll", (node) => { node.scrollTop = node.scrollHeight; });
    await wait(100);
    await page.screenshot({ path: path.join(screenshotsDir, "10-macro-inflation-desktop.png"), fullPage: true });
    await page.$eval(".siw-main-scroll", (node) => { node.scrollTop = 0; });

    macroApiMode = "STALE";
    await clickText(page, "News", true);
    await clickText(page, "Macro", true);
    await page.waitForSelector('[data-macro-panel] [data-macro-cache-status="stale"]');
    const staleMacroProof = await page.evaluate(() => ({
      panel: document.querySelector("[data-macro-panel]")?.textContent || "",
      footer: document.querySelector(".siw-status-bar")?.textContent || "",
      publishedSignal: document.querySelector('.siw-status-bar [data-market-status="published"]') !== null,
    }));
    assert.match(staleMacroProof.panel, /Showing cached macro data[\s\S]*latest FRED refresh failed[\s\S]*FRED refresh timed out/i);
    assert.equal(staleMacroProof.publishedSignal, false, "stale Macro data must not render a published-success signal");
    assert.doesNotMatch(staleMacroProof.footer, /Published macro data/i);

    macroApiMode = "ERROR";
    await clickText(page, "News", true);
    await clickText(page, "Macro", true);
    await page.waitForSelector("[data-macro-panel] .siw-macro-error");
    const failedMacroProof = await page.evaluate(() => ({
      panel: document.querySelector("[data-macro-panel]")?.textContent || "",
      footer: document.querySelector(".siw-status-bar")?.textContent || "",
      publishedSignal: document.querySelector('.siw-status-bar [data-market-status="published"]') !== null,
    }));
    assert.match(failedMacroProof.panel, /Macro source unavailable[\s\S]*FRED refresh timed out/i);
    assert.match(failedMacroProof.footer, /Federal Reserve Economic Data[\s\S]*EIA[\s\S]*IMF[\s\S]*BEA/i);
    assert.equal(failedMacroProof.publishedSignal, false, "failed Macro data must not render a published-success signal");
    assert.doesNotMatch(failedMacroProof.footer, /Published macro data/i);
    macroApiMode = "FRESH";

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
    assert.equal(
      await page.$$eval("[data-chart-gex-bar]", (nodes) => Math.max(...nodes.map((node) => Number(node.getAttribute("data-chart-gex-width")))) >= 50),
      true,
      "the strongest GEX level must consume its full signed half-axis",
    );
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
    const measureGexBarCenters = () => page.$$eval("[data-chart-gex-bar]", (nodes) => nodes.map((node) => {
      const bounds = node.getBoundingClientRect();
      return {
        strike: Number(node.getAttribute("data-chart-gex-strike")),
        center: bounds.top + bounds.height / 2,
      };
    }));
    const beforePriceScaleDrag = await measureGexBarCenters();
    assert.equal(
      beforePriceScaleDrag.every((row, index) => index === 0 || beforePriceScaleDrag[index - 1].center < row.center),
      true,
      "desktop GEX bars must render in the same high-to-low order as the price axis",
    );
    const priceScaleBounds = await page.$eval("[data-price-chart-range] canvas", (canvas) => {
      const bounds = canvas.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top, height: bounds.height };
    });
    await page.mouse.move(priceScaleBounds.right - 8, priceScaleBounds.top + priceScaleBounds.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(priceScaleBounds.right - 8, priceScaleBounds.top + priceScaleBounds.height * 0.72, { steps: 12 });
    await page.mouse.up();
    await wait(180);
    const afterPriceScaleDrag = await measureGexBarCenters();
    assert.equal(
      afterPriceScaleDrag.length === beforePriceScaleDrag.length
        && afterPriceScaleDrag.every((row, index) => row.strike === beforePriceScaleDrag[index].strike && Number.isFinite(row.center))
        && afterPriceScaleDrag.every((row, index) => index === 0 || afterPriceScaleDrag[index - 1].center < row.center),
      true,
      "a price-scale gesture must preserve the finite high-to-low GEX profile alignment",
    );
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
    const desktopGexProfile = await page.evaluate(() => {
      const profile = document.querySelector("[data-chart-gex-by-strike]");
      const list = document.querySelector("[aria-label='Net GEX by strike']");
      const profileBounds = profile?.getBoundingClientRect();
      return {
        mode: profile?.getAttribute("data-chart-gex-profile"),
        listOverflow: list ? getComputedStyle(list).overflowY : null,
        listFitsViewport: list ? list.scrollHeight <= list.clientHeight : false,
        allRowsInProfile: Array.from(document.querySelectorAll("[data-chart-gex-bar]")).every((node) => {
          const bounds = node.getBoundingClientRect();
          return bounds.top >= (profileBounds?.top || 0) && bounds.bottom <= (profileBounds?.bottom || 0);
        }),
        allRowLabelsVisible: Array.from(document.querySelectorAll(".siw-chart-gex-strike-label, .siw-chart-gex-value")).every((node) => getComputedStyle(node).opacity === "1"),
        profileHeight: profileBounds?.height || 0,
        rowCount: document.querySelectorAll("[data-chart-gex-bar]").length,
        spotGuide: document.querySelector(".siw-chart-gex-spot-guide") !== null,
        centers: Array.from(document.querySelectorAll("[data-chart-gex-bar]")).map((node) => {
          const bounds = node.getBoundingClientRect();
          return { strike: node.getAttribute("data-chart-gex-strike"), center: bounds.top + bounds.height / 2 - (profileBounds?.top || 0) };
        }),
      };
    });
    assert.equal(desktopGexProfile.mode, "aligned", "desktop Chart must expose the shared-axis GEX profile");
    assert.ok((await page.$eval("[data-chart-gex-by-strike]", (node) => node.getBoundingClientRect().width)) >= 340, "desktop GEX profile must retain the expanded readable width");
    assert.equal(desktopGexProfile.listOverflow, "hidden", "desktop GEX profile must not create a second vertical scrollbar");
    assert.equal(desktopGexProfile.listFitsViewport, true, "desktop GEX profile must fit every strike row without an internal scrollbar");
    assert.equal(desktopGexProfile.allRowsInProfile, true, "desktop GEX profile must expand until every strike row is visible");
    assert.equal(desktopGexProfile.allRowLabelsVisible, true, "desktop GEX profile must keep every strike label and value visible");
    assert.ok(desktopGexProfile.profileHeight >= 156 + desktopGexProfile.rowCount * 22, "desktop GEX profile height must scale with all strike rows");
    assert.equal(desktopGexProfile.spotGuide, true, "desktop GEX profile must render a visible spot guide");
    await page.evaluate(() => {
      const scrollRoot = document.querySelector(".siw-main-scroll");
      if (scrollRoot) scrollRoot.scrollTop += 260;
      const trigger = document.querySelector("[data-chart-gex-expiry-trigger]");
      if (trigger instanceof HTMLElement) trigger.click();
    });
    await wait(180);
    const desktopGexProfileAfterScroll = await page.evaluate(() => {
      const profile = document.querySelector("[data-chart-gex-by-strike]");
      const profileBounds = profile?.getBoundingClientRect();
      return Array.from(document.querySelectorAll("[data-chart-gex-bar]")).map((node) => {
        const bounds = node.getBoundingClientRect();
        return { strike: node.getAttribute("data-chart-gex-strike"), center: bounds.top + bounds.height / 2 - (profileBounds?.top || 0) };
      });
    });
    assert.deepEqual(
      desktopGexProfileAfterScroll,
      desktopGexProfile.centers,
      "page scrolling and a Chart re-render must not move GEX bars inside the shared plot",
    );
    await page.evaluate(() => {
      const trigger = document.querySelector("[data-chart-gex-expiry-trigger]");
      if (trigger instanceof HTMLElement) trigger.click();
      const scrollRoot = document.querySelector(".siw-main-scroll");
      if (scrollRoot) scrollRoot.scrollTop = 0;
    });
    await wait(120);
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await wait(180);
    assert.equal(await page.$eval("[data-chart-gex-by-strike]", (node) => node.scrollWidth <= node.clientWidth), true, "mobile chart GEX panel must not overflow horizontally");
    const mobileGexLayout = await page.evaluate(() => {
      const list = document.querySelector("[aria-label='Net GEX by strike']");
      const provenance = document.querySelector(".siw-chart-gex-provenance");
      const bars = Array.from(document.querySelectorAll("[data-chart-gex-bar]"));
      const lastBar = bars.at(-1)?.getBoundingClientRect();
      const provenanceBounds = provenance?.getBoundingClientRect();
      return {
        listPosition: list ? getComputedStyle(list).position : null,
        provenancePosition: provenance ? getComputedStyle(provenance).position : null,
        lastBarBottom: lastBar?.bottom,
        provenanceTop: provenanceBounds?.top,
      };
    });
    assert.equal(mobileGexLayout.listPosition, "static", "stacked layout must use the readable flow list instead of absolute axis rows");
    assert.equal(mobileGexLayout.provenancePosition, "static", "stacked provenance must remain below the readable GEX list");
    assert.ok((mobileGexLayout.lastBarBottom ?? Infinity) <= (mobileGexLayout.provenanceTop ?? -Infinity), "stacked provenance must not cover the final GEX row");
    await page.screenshot({ path: path.join(screenshotsDir, "03c-chart-gex-profile-mobile.png"), fullPage: true });
    await page.setViewport({ width: 1248, height: 986, deviceScaleFactor: 1 });
    const marketStatus = await page.$eval("[data-market-status]", (node) => ({
      state: node.getAttribute("data-market-status"),
      label: node.textContent || "",
    }));
    assert.equal(["open", "closed"].includes(marketStatus.state), true, "market label must be derived from the regular US session state");
    assert.match(marketStatus.label, /Market: (Open|Closed)/, "market label must expose its dynamic regular-session state");
    await clickText(page, "Options", true);
    await wait(180);

    const yahooProxyCallsBefore = apiCalls.length;
    await page.goto("about:blank");
    await page.goto(`${baseUrl}/#/work/stocks-intelligence-watcher?symbol=GOOG`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-watcher-replica]");
    await page.waitForFunction(() => document.querySelector(".siw-hero-identity h1")?.textContent === "GOOG", { timeout: 5000 });
    await clickText(page, "Options", true);
    await page.waitForFunction(() => /8\/8/.test(document.querySelector("[data-yahoo-expiry-preload]")?.textContent || ""), { timeout: 5000 });
    assert.match(await page.$eval(".siw-expiry-head", (node) => node.textContent || ""), /Proxy GEX[\s\S]*Proxy DEX/i, "Yahoo fallback expiry rail must label estimated GEX and DEX as proxies");
    assert.equal(await page.$eval("input[aria-label='Strike zoom']", (node) => node.value), "3", "Strike zoom must default to the maximum level");
    assert.equal(
      await page.$$eval(".siw-expiry-list [data-expiry-row]", (nodes) => nodes.slice(0, 8).every((node) => !/n\/a/i.test(node.textContent || ""))),
      true,
      "preloaded Yahoo expiries must show estimated GEX and DEX instead of n/a",
    );
    assert.equal(
      apiCalls.slice(yahooProxyCallsBefore).filter((call) => call.tool === "get_options_gex" && call.params?.ticker === "GOOG").length,
      0,
      "Yahoo preload must reuse exposure rows from get_options instead of doubling upstream chain requests",
    );
    await clickText(page, "P/C", true);
    await page.waitForSelector("[data-options-pcr-chart]");
    assert.deepEqual(
      await page.$$eval("[data-options-pcr-metric]", (nodes) => [...new Set(nodes.filter((node) => node.getClientRects().length > 0).map((node) => node.getAttribute("data-options-pcr-metric")))].sort()),
      ["open-interest", "volume"],
      "P/C must visualize both open-interest and volume ratios",
    );
    assert.match(await page.$eval("[data-options-pcr-chart]", (node) => node.textContent || ""), /1\.00 parity[\s\S]*directional forecast/i, "P/C chart must explain parity and avoid directional claims");
    await page.screenshot({ path: path.join(screenshotsDir, "09-yahoo-proxy-pcr-desktop.png") });
    await clickText(page, "Chart", true);
    await page.waitForFunction(() => document.querySelectorAll("[data-chart-gex-bar]").length > 5, { timeout: 5000 });
    assert.match(await page.$eval("[data-chart-gex-provenance]", (node) => node.textContent || ""), /Yahoo delayed[\s\S]*locally estimated[\s\S]*not dealer GEX/i, "Chart must disclose Yahoo proxy methodology");
    assert.match(await page.$eval("[data-chart-gex-by-strike]", (node) => node.textContent || ""), /Net GEX Proxy by Strike/i, "Chart must render Yahoo estimated GEX by strike");
    await page.screenshot({ path: path.join(screenshotsDir, "09-yahoo-proxy-chart-desktop.png") });
    await clickText(page, "Options", true);
    await clickText(page, "Vol", true);
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
    for (const topTab of ["Overview", "Chart", "Fundamentals", "Fixed Income", "Earnings", "Options", "F/G Index", "News", "Macro"]) {
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
      const tabFileSlug = topTab.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      await page.screenshot({ path: path.join(screenshotsDir, `tab-${tabFileSlug}-desktop.png`) });
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
    await clickText(page, "Options", true);
    await page.waitForSelector("[data-options-robinhood-provenance]", { timeout: 5000 });
    assert.match(await page.$eval("[data-options-robinhood-provenance]", (node) => node.textContent || ""), /Robinhood MCP EOD/i, "mobile proof must use the Robinhood-backed NVDA snapshot");
    await page.screenshot({ path: path.join(screenshotsDir, "uat-mobile.png"), fullPage: true });
    await page.screenshot({ path: path.join(screenshotsDir, "08-responsive-mobile.png"), fullPage: true });
    for (const topTab of ["Overview", "Chart", "Fundamentals", "Fixed Income", "Earnings", "Options", "F/G Index", "News", "Macro"]) {
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
