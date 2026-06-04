import assert from "node:assert/strict";
import test from "node:test";
import {
  STOCKS_WATCHER_CACHE_TTL_MS,
  applyStocksWatcherSymbolRemoval,
  buildDemoStocksWatcherSnapshot,
  buildStocksWatcherSnapshotFromNative,
  getFreshStocksWatcherCacheEntry,
  getStocksWatcherVisibleSymbols,
  getNearestSpotStrike,
  type StocksWatcherToolClient,
} from "../src/lib/stocks-intelligence-watcher";
import { STOCKS_WATCHER_SYMBOLS, STOCKS_WATCHER_UNIVERSE } from "../src/lib/stocks-watcher-universe";
import { normalizeStocksWatcherSymbol, resolveStocksWatcherYahooSymbol } from "../src/lib/stocks-native-yahoo";
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

    throw new Error(`Unexpected tool ${name}`);
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

test("native snapshot parses quotes, options, GEX, and tools/list metadata", async () => {
  const snapshot = await buildStocksWatcherSnapshotFromNative("NVDA", new FakeStocksNativeClient());

  assert.equal(snapshot.source, "native_yahoo");
  assert.equal(snapshot.quote.price, 181.8);
  assert.equal(snapshot.availableTools.length, 2);
  assert.deepEqual(snapshot.availableExpiries, ["2026-05-29", "2026-06-01", "2026-06-05"]);
  assert.equal(snapshot.selectedExpiry, "2026-05-29");
  assert.equal(new Set(snapshot.expiryRows.map((row) => row.expiry)).size, snapshot.expiryRows.length);
  assert.ok(snapshot.expiryRows.some((row) => row.expiry === "2026-05-29" && row.openInterest === 426_000));
  assert.ok(snapshot.strikes.some((row) => row.strike === 180 && row.callGex === 12_800_000));
  assert.ok(snapshot.toolRuns.some((run) => run.name === "market_breadth" && run.status === "ok"));
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
