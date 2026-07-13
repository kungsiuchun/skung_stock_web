import assert from "node:assert/strict";
import test from "node:test";
import {
  STOCKS_WATCHER_CACHE_TTL_MS,
  applyStocksWatcherSymbolRemoval,
  buildDemoStocksWatcherSnapshot,
  buildStocksWatcherSnapshotFromNative,
  getFreshStocksWatcherCacheEntry,
  getGammaFlipLevel,
  getStocksWatcherMarketSession,
  getStocksWatcherRowQuotesFromRawResult,
  getStocksWatcherVisibleSymbols,
  getNearestSpotStrike,
  mergeStocksWatcherRowQuoteMap,
  refreshStocksWatcherSymbolsBatch,
  resolveStocksWatcherSearchSymbol,
  type StocksWatcherToolClient,
} from "../src/lib/stocks-intelligence-watcher";
import { STOCKS_WATCHER_SYMBOLS, STOCKS_WATCHER_UNIVERSE } from "../src/lib/stocks-watcher-universe";
import {
  buildNativeYahooEarningsSnapshot,
  listNativeStocksTools,
  normalizeStocksWatcherSymbol,
  quoteRowFromYahooChartResult,
  resolveStocksWatcherYahooSymbol,
} from "../src/lib/stocks-native-yahoo";
import {
  buildStocksWatcherAiSummaryPayload,
  buildStocksWatcherDeterministicSummary,
  getStocksWatcherAiSummaryCacheKey,
} from "../src/lib/stocks-intelligence-watcher-summary";
import {
  getStocksWatcherExpiryOverviewToolPlan,
  getStocksWatcherOptionsSubTabCacheKey,
  getStocksWatcherOptionsSubTabToolPlan,
  getStocksWatcherCustomStockFromSnapshot,
  getStocksWatcherStrikeDetailToolPlan,
  getStocksWatcherSnapshotExpiry,
  getStocksWatcherSnapshotLoadDecision,
  getStocksWatcherTopTabCacheKey,
  getStocksWatcherTopTabToolPlan,
  normalizeWatcherExpiryForYahoo,
} from "../src/lib/stocks-intelligence-watcher-session";
import { onRequest as stocksWatcherApi } from "../functions/api/stocks-intelligence-watcher";

class FakeStocksNativeClient implements StocksWatcherToolClient {
  async listTools() {
    return [
      {
        name: "get_quotes",
        description: "Get latest quotes.",
        inputSchema: { properties: { tickers: { type: "string" } }, required: ["tickers"] },
      },
      {
        name: "get_options",
        description: "Get options chain.",
        inputSchema: { properties: { ticker: { type: "string" } }, required: ["ticker"] },
      },
    ];
  }

  async callToolText(name: string) {
    if (name === "get_quotes") {
      return `
| Ticker | Last | Change | Change % |
| NVDA | $181.80 | +2.14 | +1.19% |
`;
    }

    if (name === "get_options") {
      return `
**Available expiries:** 2026-05-29, 2026-06-01, 2026-06-05
| Exp | OI | Str | Volume | Type |
| 2026-05-29 | 426k | 180 | 98.4k | C |
| 2026-06-01 | 56k | 175 | 17.5k | C |
`;
    }

    if (name === "get_options_gex" || name === "get_options_0dte") {
      return `
| Strike | Call GEX | Put GEX | Net GEX |
| $180 | 12.8M | -3.0M | 9.8M |
| $185 | 35.0M | -4.0M | 31.0M |
`;
    }

    if (name === "get_intraday") {
      return `
| Time | Price |
| 2026-05-28 09:30 | 178.10 |
| 2026-05-28 10:00 | 179.40 |
| 2026-05-28 10:30 | 181.80 |
| 2026-05-28 11:00 | 181.70 |
`;
    }

    if (name === "get_stock_history") {
      return "| Date | Close |\n| 2026-05-27 | 179.66 |";
    }

    if (name === "market_breadth") {
      return "US breadth: advancers led decliners.";
    }

    if (name === "basket_relative_strength") {
      return "NVDA leads the watchlist.";
    }

    if (name === "pre_event_brief") {
      return "# NVDA pre-event brief\n- Latest news: NVIDIA headline (Yahoo Finance)";
    }

    if (name === "earnings_vol_crush") {
      return "# NVDA earnings vol-crush context\n- Earnings date: 2026-08-26";
    }

    throw new Error(`Unexpected tool ${name}`);
  }

  async callTool(name: string, args: Record<string, unknown> = {}) {
    const text = await this.callToolText(name);
    if (name === "get_quotes") {
      return {
        text,
        raw: {
          quotes: [{
            symbol: "NVDA",
            name: "NVIDIA Corporation",
            price: 181.8,
            open: 179.8,
            high: 182.4,
            low: 178.6,
            previousClose: 179.66,
            change: 2.14,
            changePercent: 1.19,
            marketState: "REGULAR",
            asOf: "2026-05-28T20:00:00.000Z",
          }],
        },
      };
    }
    if (name === "get_intraday") {
      return {
        text,
        raw: {
          history: [
            { date: "2026-05-28T13:30:00.000Z", open: 178.1, high: 179, low: 177.9, close: 178.4, volume: 1000 },
            { date: "2026-05-28T14:00:00.000Z", open: 178.4, high: 180, low: 178.2, close: 179.4, volume: 1100 },
            { date: "2026-05-28T14:30:00.000Z", open: 179.4, high: 182, low: 179.1, close: 181.8, volume: 1200 },
            { date: "2026-05-28T15:00:00.000Z", open: 181.8, high: 182.4, low: 181.2, close: 181.7, volume: 900 },
          ],
        },
      };
    }
    if (name === "pre_event_brief") {
      return {
        text,
        raw: {
          news: [
            { title: "NVIDIA expands AI platform", publisher: "Yahoo Finance", link: "https://finance.yahoo.com/nvda-1", publishedAt: "2026-05-28T13:00:00.000Z" },
            { title: "Chip stocks rally with NVDA", publisher: "Reuters", link: "https://finance.yahoo.com/nvda-2", publishedAt: "2026-05-28T12:00:00.000Z" },
            { title: "Analysts lift NVIDIA targets", publisher: "MarketWatch", link: "https://finance.yahoo.com/nvda-3", publishedAt: "2026-05-28T11:00:00.000Z" },
          ],
        },
      };
    }
    if (name === "earnings_vol_crush") {
      return {
        text,
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
            priceMove: {
              eventTradingDate: "2026-05-20",
              previousClose: 134.38,
              close: 135.5,
              changePercent: 0.83,
              basis: "close_to_close",
            },
          },
        },
      };
    }
    return { text, raw: null };
  }
}

test("demo snapshot is deterministic enough for the watcher shell", () => {
  const snapshot = buildDemoStocksWatcherSnapshot("NVDA", "fallback");

  assert.equal(snapshot.symbol, "NVDA");
  assert.equal(snapshot.source, "demo_fallback");
  assert.ok(snapshot.availableExpiries.length > 0);
  assert.equal(snapshot.selectedExpiry, snapshot.availableExpiries[0]);
  assert.equal(snapshot.expiryRows.length, snapshot.availableExpiries.length);
  assert.ok(snapshot.expiries.length >= 12);
  assert.ok(snapshot.strikes.length >= 20);
  assert.ok(snapshot.warnings.includes("fallback"));
});

test("nearest spot strike chooses one strike when several are close to spot", () => {
  const snapshot = buildDemoStocksWatcherSnapshot("NVDA", "fallback");
  const nearest = getNearestSpotStrike(
    [
      { ...snapshot.strikes[0], strike: 180 },
      { ...snapshot.strikes[1], strike: 182.5 },
      { ...snapshot.strikes[2], strike: 185 },
    ],
    181.8,
  );

  assert.equal(nearest?.strike, 182.5);
});

test("gamma flip uses nearest net-GEX sign crossing, not the smallest absolute bar", () => {
  const base = buildDemoStocksWatcherSnapshot("GOOG", "fallback").strikes[0];
  const rows = [
    { ...base, strike: 220, netGex: 1 },
    { ...base, strike: 360, netGex: -2_000_000 },
    { ...base, strike: 365, netGex: -500_000 },
    { ...base, strike: 370, netGex: 500_000 },
    { ...base, strike: 400, netGex: 3_000_000 },
  ];

  assert.equal(getGammaFlipLevel(rows, 365.76), 367.5);
});

test("gamma flip is unavailable when visible net GEX never changes sign", () => {
  const base = buildDemoStocksWatcherSnapshot("GOOG", "fallback").strikes[0];
  const rows = [
    { ...base, strike: 350, netGex: 100_000 },
    { ...base, strike: 360, netGex: 200_000 },
    { ...base, strike: 370, netGex: 300_000 },
  ];

  assert.equal(getGammaFlipLevel(rows, 365.76), null);
});

test("AI summary payload compacts watcher data and changes cache key by expiry", () => {
  const snapshot = buildDemoStocksWatcherSnapshot("NVDA", "fallback");
  const payload = buildStocksWatcherAiSummaryPayload(snapshot, {
    selectedExpiry: snapshot.availableExpiries[0],
    marketBreadth: "Controlled breadth context for unit tests.",
  });
  const nextPayload = buildStocksWatcherAiSummaryPayload(snapshot, {
    selectedExpiry: snapshot.availableExpiries[1],
    marketBreadth: "Controlled breadth context for unit tests.",
  });

  assert.equal(payload.symbol, "NVDA");
  assert.equal(payload.selectedExpiry, snapshot.availableExpiries[0]);
  assert.equal(payload.topAbsGexStrikes.length, 5);
  assert.ok(payload.netGexTotal !== 0);
  assert.notEqual(getStocksWatcherAiSummaryCacheKey(payload), getStocksWatcherAiSummaryCacheKey(nextPayload));
});

test("AI summary is deterministic and does not depend on model output", () => {
  const snapshot = buildDemoStocksWatcherSnapshot("TSLA", "fallback");
  const payload = buildStocksWatcherAiSummaryPayload(snapshot);
  const summary = buildStocksWatcherDeterministicSummary(payload);

  assert.equal(summary.model, "deterministic-rules");
  assert.equal(summary.generatedAt, payload.quote.asOf || payload.generatedAt);
  assert.ok(summary.headline.includes("TSLA"));
  assert.ok(summary.whatItTellsUs.length > 0);
  assert.ok(summary.howToAct.some((item) => item.includes("not a standalone buy or sell trigger")));
});

test("watchlist removal removes favorites, hides defaults, and chooses the next visible ticker", () => {
  const result = applyStocksWatcherSymbolRemoval(
    {
      favorites: ["NVDA", "FEPI", "IREN"],
      hiddenSymbols: [],
      selectedSymbol: "FEPI",
      defaultSymbols: ["NVDA", "IREN", "QQQI", "FEPI", "NTSX", "UNH"],
    },
    "FEPI",
  );

  assert.deepEqual(result.favorites, ["NVDA", "IREN"]);
  assert.deepEqual(result.hiddenSymbols, ["FEPI"]);
  assert.equal(result.nextSelectedSymbol, "NVDA");
});

test("SPX aliases display as SPX while querying Yahoo index data internally", () => {
  assert.equal(normalizeStocksWatcherSymbol("SPX"), "SPX");
  assert.equal(normalizeStocksWatcherSymbol("^SPX"), "SPX");
  assert.deepEqual(resolveStocksWatcherYahooSymbol("SPX"), { displaySymbol: "SPX", yahooSymbol: "^SPX" });
  assert.deepEqual(resolveStocksWatcherYahooSymbol("^SPX"), { displaySymbol: "SPX", yahooSymbol: "^SPX" });
  assert.deepEqual(resolveStocksWatcherYahooSymbol("AAPL"), { displaySymbol: "AAPL", yahooSymbol: "AAPL" });
  assert.deepEqual(resolveStocksWatcherYahooSymbol("BRK-B"), { displaySymbol: "BRK-B", yahooSymbol: "BRK-B" });
});

test("native Yahoo registry exposes unique public tool names without compatibility aliases", () => {
  const tools = listNativeStocksTools();
  const names = tools.map((tool) => tool.name);

  assert.equal(new Set(names).size, names.length);
  assert.equal(names.includes("chart_greeks"), true);
  assert.equal(names.includes("chart_dex"), true);
  assert.equal(names.includes("chart_indicator"), true);
  assert.equal(names.includes("chart_gex"), false);
  assert.equal(names.includes("chart_indicators"), false);
  assert.equal(names.includes("pre_event_briefing"), false);
});

test("watcher session plans native tool calls and cache keys without UI state", () => {
  assert.equal(normalizeWatcherExpiryForYahoo("26-06-19"), "2026-06-19");
  assert.equal(getStocksWatcherTopTabCacheKey(" nvda ", "Stats"), "NVDA:Stats");
  assert.equal(getStocksWatcherOptionsSubTabCacheKey("nvda", "26-06-19", "Greeks"), "NVDA:2026-06-19:Greeks");

  assert.deepEqual(getStocksWatcherTopTabToolPlan("Stats", "nvda"), [
    { name: "get_stock_stats", params: { ticker: "NVDA" } },
    { name: "get_beta", params: { ticker: "NVDA" } },
  ]);
  assert.deepEqual(getStocksWatcherOptionsSubTabToolPlan("Greeks", "nvda", "26-06-19"), [
    { name: "get_options_greeks", params: { ticker: "NVDA", expiry: "2026-06-19" } },
    { name: "chart_greeks", params: { ticker: "NVDA", expiry: "2026-06-19" } },
  ]);
  assert.deepEqual(getStocksWatcherExpiryOverviewToolPlan("nvda", "26-06-19"), [
    { name: "get_options", params: { ticker: "NVDA", expiry: "2026-06-19", strikesAroundAtm: 40 } },
    { name: "get_options_gex", params: { ticker: "NVDA", expiry: "2026-06-19", topRows: 24 } },
    { name: "get_options_pcr", params: { ticker: "NVDA", expiry: "2026-06-19" } },
  ]);
  assert.deepEqual(getStocksWatcherStrikeDetailToolPlan("nvda", "26-06-19", 180), [
    { name: "get_options_greeks", params: { ticker: "NVDA", expiry: "2026-06-19", strike: 180 } },
    { name: "get_options_iv_intraday", params: { ticker: "NVDA", expiry: "2026-06-19", strike: 180 } },
    { name: "get_options_mispricing", params: { ticker: "NVDA", expiry: "2026-06-19", strike: 180 } },
  ]);
});

test("watcher session resolves snapshot cache and custom stock decisions", () => {
  const snapshot = buildDemoStocksWatcherSnapshot("SOFI", "fallback");
  const cached = { snapshot, fetchedAt: 12345 };

  assert.equal(getStocksWatcherSnapshotExpiry(snapshot), snapshot.selectedExpiry);
  assert.deepEqual(
    getStocksWatcherSnapshotLoadDecision({
      requestedSymbol: "",
      selectedSymbol: "NVDA",
      loadingSymbol: null,
      cached,
    }),
    { symbol: "", skip: true, cached: null, backgroundRefresh: false },
  );
  assert.deepEqual(
    getStocksWatcherSnapshotLoadDecision({
      requestedSymbol: "sofi",
      selectedSymbol: "NVDA",
      loadingSymbol: null,
      cached,
    }),
    { symbol: "SOFI", skip: false, cached, backgroundRefresh: true },
  );
  assert.deepEqual(
    getStocksWatcherSnapshotLoadDecision({
      requestedSymbol: "sofi",
      selectedSymbol: "SOFI",
      loadingSymbol: "SOFI",
      cached,
    }),
    { symbol: "SOFI", skip: true, cached: null, backgroundRefresh: false },
  );
  assert.equal(getStocksWatcherCustomStockFromSnapshot(snapshot, STOCKS_WATCHER_UNIVERSE[0])?.symbol, undefined);
  assert.deepEqual(getStocksWatcherCustomStockFromSnapshot(snapshot, null), {
    symbol: "SOFI",
    companyName: snapshot.quote.companyName,
    sector: "Custom",
    type: "Stock",
    fallbackPrice: snapshot.quote.price,
    fallbackChange: snapshot.quote.change,
    fallbackChangePercent: snapshot.quote.changePercent,
  });
});

test("all-stocks visible list supports the curated universe including SPX", () => {
  assert.equal(STOCKS_WATCHER_UNIVERSE.length, 51);
  assert.equal(STOCKS_WATCHER_UNIVERSE.some((stock) => stock.symbol === "SPX" && stock.type === "Index"), true);
  assert.deepEqual(
    getStocksWatcherVisibleSymbols({
      favorites: STOCKS_WATCHER_SYMBOLS,
      hiddenSymbols: [],
      selectedSymbol: "NVDA",
      defaultSymbols: STOCKS_WATCHER_SYMBOLS,
      universe: STOCKS_WATCHER_UNIVERSE,
      includeSelected: false,
      limit: 51,
    }),
    STOCKS_WATCHER_SYMBOLS,
  );
});

test("visible list filters locally by ticker and company name", () => {
  assert.deepEqual(
    getStocksWatcherVisibleSymbols({
      favorites: STOCKS_WATCHER_SYMBOLS,
      hiddenSymbols: [],
      selectedSymbol: "NVDA",
      defaultSymbols: STOCKS_WATCHER_SYMBOLS,
      universe: STOCKS_WATCHER_UNIVERSE,
      includeSelected: false,
      query: "alphabet",
      limit: 50,
    }),
    ["GOOG", "GOOGL"],
  );
  assert.deepEqual(
    getStocksWatcherVisibleSymbols({
      favorites: STOCKS_WATCHER_SYMBOLS,
      hiddenSymbols: [],
      selectedSymbol: "NVDA",
      defaultSymbols: STOCKS_WATCHER_SYMBOLS,
      universe: STOCKS_WATCHER_UNIVERSE,
      includeSelected: false,
      query: "AAPL",
      limit: 50,
    }),
    ["AAPL"],
  );
});

test("watcher search resolves symbols, company names, and custom tickers without fallback rows", () => {
  assert.equal(resolveStocksWatcherSearchSymbol("tsla", STOCKS_WATCHER_UNIVERSE), "TSLA");
  assert.equal(resolveStocksWatcherSearchSymbol("Tesla", STOCKS_WATCHER_UNIVERSE), "TSLA");
  assert.equal(resolveStocksWatcherSearchSymbol("Microsoft", STOCKS_WATCHER_UNIVERSE), "MSFT");
  assert.equal(resolveStocksWatcherSearchSymbol("Microsoft", [{
    symbol: "SOFI",
    companyName: "SoFi Technologies Inc.",
    sector: "Custom",
    type: "Stock",
    fallbackPrice: 12.34,
    fallbackChange: 0.56,
    fallbackChangePercent: 4.75,
  }]), "MSFT");
  assert.equal(resolveStocksWatcherSearchSymbol("SOFI", STOCKS_WATCHER_UNIVERSE), "SOFI");
  assert.equal(resolveStocksWatcherSearchSymbol("AI semiconductor", STOCKS_WATCHER_UNIVERSE), null);
  assert.equal(resolveStocksWatcherSearchSymbol("AAPL DROP", STOCKS_WATCHER_UNIVERSE), null);
});

test("explicit watcher search can reveal a hidden ticker instead of leaving the list empty", () => {
  const hiddenSymbols = ["MSFT", "TSLA"];
  const resolved = resolveStocksWatcherSearchSymbol("Microsoft", STOCKS_WATCHER_UNIVERSE);
  assert.equal(resolved, "MSFT");

  assert.deepEqual(
    getStocksWatcherVisibleSymbols({
      favorites: STOCKS_WATCHER_SYMBOLS,
      hiddenSymbols,
      selectedSymbol: "NVDA",
      defaultSymbols: STOCKS_WATCHER_SYMBOLS,
      universe: STOCKS_WATCHER_UNIVERSE,
      includeSelected: false,
      query: "Microsoft",
      limit: 50,
    }),
    [],
  );
  assert.deepEqual(
    getStocksWatcherVisibleSymbols({
      favorites: STOCKS_WATCHER_SYMBOLS,
      hiddenSymbols: hiddenSymbols.filter((symbol) => symbol !== resolved),
      selectedSymbol: resolved,
      defaultSymbols: STOCKS_WATCHER_SYMBOLS,
      universe: STOCKS_WATCHER_UNIVERSE,
      includeSelected: false,
      query: "Microsoft",
      limit: 50,
    }),
    ["MSFT"],
  );
});

test("visible list combines sector and type filters", () => {
  assert.deepEqual(
    getStocksWatcherVisibleSymbols({
      favorites: STOCKS_WATCHER_SYMBOLS,
      hiddenSymbols: [],
      selectedSymbol: "NVDA",
      defaultSymbols: STOCKS_WATCHER_SYMBOLS,
      universe: STOCKS_WATCHER_UNIVERSE,
      includeSelected: false,
      sector: "Semiconductors",
      type: "ADR",
      limit: 50,
    }),
    ["TSM", "ASML"],
  );
});

test("favorites can be restored from local-storage shaped data and filtered", () => {
  const stored = JSON.stringify(["GOOG", "QQQI", "ASML"]);
  const favorites = JSON.parse(stored) as string[];

  assert.deepEqual(
    getStocksWatcherVisibleSymbols({
      favorites,
      hiddenSymbols: [],
      selectedSymbol: "NVDA",
      defaultSymbols: STOCKS_WATCHER_SYMBOLS,
      universe: STOCKS_WATCHER_UNIVERSE,
      includeSelected: false,
      includeDefaultSymbols: false,
      type: "ETF",
      limit: 50,
    }),
    ["QQQI"],
  );
});

test("typed custom tickers are valid watcher symbols and can enter the visible list", () => {
  const customUniverse = [
    ...STOCKS_WATCHER_UNIVERSE,
    {
      symbol: "SOFI",
      companyName: "SoFi Technologies Inc.",
      sector: "Custom",
      type: "Stock" as const,
      fallbackPrice: 12.34,
      fallbackChange: 0.56,
      fallbackChangePercent: 4.75,
    },
  ];
  const customSymbols = [...STOCKS_WATCHER_SYMBOLS, "SOFI"];

  assert.equal(normalizeStocksWatcherSymbol("SOFI"), "SOFI");
  assert.deepEqual(
    getStocksWatcherVisibleSymbols({
      favorites: customSymbols,
      hiddenSymbols: [],
      selectedSymbol: "NVDA",
      defaultSymbols: customSymbols,
      universe: customUniverse,
      includeSelected: false,
      includeDefaultSymbols: false,
      query: "sofi",
      limit: 50,
    }),
    ["SOFI"],
  );
});

test("all-stocks source can render a dynamic universe without stale default-symbol gating", () => {
  const dynamicUniverse = [
    {
      symbol: "MCD",
      companyName: "McDonald's Corporation",
      sector: "Consumer Discretionary",
      type: "Stock" as const,
      fallbackPrice: 291.7,
      fallbackChange: -1.4,
      fallbackChangePercent: -0.48,
    },
  ];

  assert.deepEqual(
    getStocksWatcherVisibleSymbols({
      favorites: ["MCD"],
      hiddenSymbols: [],
      selectedSymbol: "NVDA",
      defaultSymbols: ["NVDA"],
      universe: dynamicUniverse,
      includeSelected: false,
      includeDefaultSymbols: false,
      restrictToDefaultSymbols: false,
      limit: 50,
    }),
    ["MCD"],
  );
});

test("snapshot cache returns only fresh entries", () => {
  const snapshot = buildDemoStocksWatcherSnapshot("NVDA", "fallback");
  const cache = new Map([
    ["NVDA", { snapshot, fetchedAt: 1_000 }],
    ["IREN", { snapshot: buildDemoStocksWatcherSnapshot("IREN", "fallback"), fetchedAt: 1_000 }],
  ]);

  assert.equal(getFreshStocksWatcherCacheEntry(cache, "nvda", 1_000 + STOCKS_WATCHER_CACHE_TTL_MS - 1)?.snapshot.symbol, "NVDA");
  assert.equal(getFreshStocksWatcherCacheEntry(cache, "iren", 1_000 + STOCKS_WATCHER_CACHE_TTL_MS + 1), null);
});

test("refresh batch bounds concurrency and keeps failed symbols isolated", async () => {
  let active = 0;
  let maxActive = 0;
  const started: string[] = [];
  const results = await refreshStocksWatcherSymbolsBatch(
    ["NVDA", "GOOG", "AAPL", "MSFT", "NVDA"],
    async (symbol) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      started.push(symbol);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (symbol === "AAPL") throw new Error("AAPL failed");
      return `${symbol}-quote`;
    },
    { concurrency: 2 },
  );

  assert.equal(maxActive <= 2, true);
  assert.deepEqual(started.sort(), ["AAPL", "GOOG", "MSFT", "NVDA"]);
  assert.equal(results.length, 4);
  assert.equal(results.find((item) => item.symbol === "AAPL")?.status, "rejected");
  assert.equal(results.find((item) => item.symbol === "MSFT")?.value, "MSFT-quote");
});

test("row quote parser preserves Yahoo quote fields for watcher rows", () => {
  const quotes = getStocksWatcherRowQuotesFromRawResult({
    quotes: [
      { symbol: "goog", name: "Alphabet Inc.", price: 356.24, previousClose: 357.89, change: -1.65, changePercent: -0.46, marketState: "CLOSED", asOf: "2026-07-09T20:00:00.000Z" },
      { symbol: "AAPL", name: "Apple Inc.", price: 316.22, change: 21.84, changePercent: 7.42, asOf: "2026-07-09T20:01:00.000Z" },
      { symbol: "BAD", name: "Bad row" },
    ],
  }, 1234);

  assert.deepEqual(
    quotes.map((quote) => ({ symbol: quote.symbol, price: quote.price, previousClose: quote.previousClose, change: quote.change, changePercent: quote.changePercent, source: quote.source, fetchedAt: quote.fetchedAt })),
    [
      { symbol: "GOOG", price: 356.24, previousClose: 357.89, change: -1.65, changePercent: -0.46, source: "yahoo_quote", fetchedAt: 1234 },
      { symbol: "AAPL", price: 316.22, previousClose: null, change: 21.84, changePercent: 7.42, source: "yahoo_quote", fetchedAt: 1234 },
    ],
  );
  assert.equal(quotes[0]?.asOf, "2026-07-09T20:00:00.000Z");
  assert.equal(quotes[0]?.marketState, "CLOSED");
});

test("market session label follows Yahoo marketState without guessing from local time", () => {
  assert.deepEqual(getStocksWatcherMarketSession("REGULAR"), { label: "Open", tone: "open" });
  assert.deepEqual(getStocksWatcherMarketSession("PRE"), { label: "Pre-market", tone: "extended" });
  assert.deepEqual(getStocksWatcherMarketSession("POST"), { label: "After-hours", tone: "extended" });
  assert.deepEqual(getStocksWatcherMarketSession("CLOSED"), { label: "Closed", tone: "closed" });
  assert.deepEqual(getStocksWatcherMarketSession(null), { label: "Unavailable", tone: "unknown" });
});

test("Yahoo chart quote derivation keeps explicit same-session TSLA change positive", () => {
  const quote = quoteRowFromYahooChartResult("TSLA", {
    meta: {
      longName: "Tesla, Inc.",
      regularMarketPrice: 406.55,
      regularMarketPreviousClose: 394.06,
      chartPreviousClose: 425.3,
      regularMarketChange: 12.49,
      regularMarketChangePercent: 3.17,
      regularMarketOpen: 393.94,
      regularMarketDayHigh: 407.86,
      regularMarketDayLow: 390.86,
      regularMarketVolume: 102_000_000,
      currency: "USD",
      marketState: "REGULAR",
      regularMarketTime: 1783641600,
    },
    timestamp: [1783555200, 1783641600],
    indicators: {
      quote: [{
        close: [394.06, 406.55],
        open: [392.1, 393.94],
        high: [396.2, 407.86],
        low: [389.2, 390.86],
        volume: [91_000_000, 102_000_000],
      }],
    },
  });

  assert.equal(quote.symbol, "TSLA");
  assert.equal(quote.price, 406.55);
  assert.equal(quote.previousClose, 394.06);
  assert.equal(quote.change, 12.49);
  assert.equal(quote.changePercent, 3.17);
});

test("Yahoo explicit quote change wins over bad chartPreviousClose fallback", () => {
  const quote = quoteRowFromYahooChartResult("TSLA", {
    meta: {
      shortName: "Tesla, Inc.",
      regularMarketPrice: 406.55,
      chartPreviousClose: 425.3,
      regularMarketChange: 12.49,
      regularMarketChangePercent: 3.17,
      regularMarketTime: 1783641600,
    },
    timestamp: [1783555200, 1783641600],
    indicators: {
      quote: [{
        close: [425.3, 406.55],
        volume: [91_000_000, 102_000_000],
      }],
    },
  });

  assert.equal(quote.previousClose, 394.06);
  assert.equal(quote.change, 12.49);
  assert.equal(quote.changePercent, 3.17);
  assert.equal(quote.warning, undefined);
});

test("earnings move uses the latest reported quarter instead of a future call date", () => {
  const earnings = buildNativeYahooEarningsSnapshot({
    calendarEvents: {
      earnings: {
        earningsDate: [{ fmt: "2026-07-29" }],
        earningsCallDate: [{ fmt: "2026-07-29" }],
      },
    },
    earningsHistory: {
      history: [{
        quarter: { fmt: "2026-04-30" },
        epsActual: { raw: 0.11 },
        epsEstimate: { raw: 0.08 },
      }],
    },
  }, [
    { date: "2026-04-29", open: 10, high: 10.2, low: 9.8, close: 10, volume: 1_000 },
    { date: "2026-04-30", open: 10.1, high: 10.6, low: 10, close: 10.5, volume: 1_100 },
  ]);

  assert.equal(earnings.nextEarningsDate, "2026-07-29");
  assert.equal(earnings.lastEarningsDate, "2026-04-30");
  assert.equal(earnings.priceMove?.eventTradingDate, "2026-04-30");
  assert.equal(earnings.priceMove?.changePercent, 5);
});

test("row quote map merge keeps old quotes when a refresh chunk omits a symbol", () => {
  const current = mergeStocksWatcherRowQuoteMap({}, getStocksWatcherRowQuotesFromRawResult({
    quotes: [
      { symbol: "GOOG", price: 376.43, change: -9.69, changePercent: -2.51, asOf: "old" },
      { symbol: "AAPL", price: 312.06, change: -0.45, changePercent: -0.14, asOf: "old" },
    ],
  }, 1000));
  const next = mergeStocksWatcherRowQuoteMap(current, getStocksWatcherRowQuotesFromRawResult({
    quotes: [
      { symbol: "GOOG", price: 356.24, change: -1.65, changePercent: -0.46, asOf: "new" },
    ],
  }, 2000));

  assert.equal(next.GOOG.price, 356.24);
  assert.equal(next.GOOG.fetchedAt, 2000);
  assert.equal(next.AAPL.price, 312.06);
  assert.equal(next.AAPL.fetchedAt, 1000);
});

test("native snapshot parses quotes, options, GEX, and tools/list metadata", async () => {
  const snapshot = await buildStocksWatcherSnapshotFromNative("NVDA", new FakeStocksNativeClient());

  assert.equal(snapshot.source, "native_yahoo");
  assert.equal(snapshot.quote.price, 181.8);
  assert.equal(snapshot.quote.open, 179.8);
  assert.equal(snapshot.quote.high, 182.4);
  assert.equal(snapshot.quote.low, 178.6);
  assert.equal(snapshot.quote.previousClose, 179.66);
  assert.equal(snapshot.quote.marketState, "REGULAR");
  assert.equal(snapshot.history[0]?.price, 178.4);
  assert.equal(snapshot.history[0]?.date, "2026-05-28T13:30:00.000Z");
  assert.equal(snapshot.history[0]?.label, "13:30");
  assert.equal(snapshot.recentNews.length, 3);
  assert.equal(snapshot.earnings.nextEarningsDate, "2026-08-26");
  assert.equal(snapshot.earnings.result, "beat");
  assert.equal(snapshot.earnings.priceMove?.changePercent, 0.83);
  assert.equal(snapshot.availableTools.length, 2);
  assert.deepEqual(snapshot.availableExpiries, ["2026-05-29", "2026-06-01", "2026-06-05"]);
  assert.equal(snapshot.selectedExpiry, "2026-05-29");
  assert.equal(new Set(snapshot.expiryRows.map((row) => row.expiry)).size, snapshot.expiryRows.length);
  assert.ok(snapshot.expiryRows.some((row) => row.expiry === "2026-05-29" && row.openInterest === 426_000));
  assert.ok(snapshot.strikes.some((row) => row.strike === 180 && row.callGex === 12_800_000));
  assert.ok(snapshot.toolRuns.some((run) => run.name === "market_breadth" && run.status === "ok"));
});

test("native snapshot preserves markdown history dates when raw history is unavailable", async () => {
  const client = new FakeStocksNativeClient();
  const originalCallTool = client.callTool.bind(client);
  client.callTool = async (name, args) => {
    if (name === "get_intraday" || name === "get_stock_history") {
      return { text: await client.callToolText(name), raw: {} };
    }
    return originalCallTool(name, args);
  };

  const snapshot = await buildStocksWatcherSnapshotFromNative("NVDA", client);

  assert.equal(snapshot.history[0]?.date, "2026-05-28 09:30");
  assert.equal(snapshot.history[0]?.label, "05-28 09:30");
  assert.equal(snapshot.history[0]?.price, 178.1);
});

test("native snapshot records a failed optional tool without blocking core ticker data", async () => {
  const client = new FakeStocksNativeClient();
  const originalCallToolText = client.callToolText.bind(client);
  client.callToolText = async (name, args) => {
    if (name === "basket_relative_strength") throw new Error("relative strength unavailable");
    return originalCallToolText(name, args);
  };

  const snapshot = await buildStocksWatcherSnapshotFromNative("NVDA", client);

  assert.equal(snapshot.source, "native_yahoo");
  assert.equal(snapshot.quote.price, 181.8);
  assert.ok(snapshot.toolRuns.some((run) => run.name === "basket_relative_strength" && run.status === "failed"));
});

test("POST endpoint keeps the native tool-call contract", async () => {
  const response = await stocksWatcherApi({
    request: new Request("https://example.com/api/stocks-intelligence-watcher", {
      method: "POST",
      body: JSON.stringify({ tool: "get_watchlist", params: {} }),
    }),
  });
  const payload = await response.json() as {
    ok: boolean;
    tool: string;
    text: string;
    raw: { symbols: string[]; stocks?: unknown };
  };

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.tool, "get_watchlist");
  assert.deepEqual(payload.raw.symbols.slice(0, 6), ["NVDA", "GOOG", "GOOGL", "AAPL", "MSFT", "AMZN"]);
  assert.equal(payload.raw.symbols.length, 51);
  assert.equal(payload.raw.symbols.includes("SPX"), true);
  assert.equal(Array.isArray((payload.raw as { stocks?: unknown }).stocks), true);
  assert.match(payload.text, /NVDA/);
});
