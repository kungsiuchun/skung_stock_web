import assert from "node:assert/strict";
import test from "node:test";

import {
  getStocksWatcherInitialSymbolFromHash,
  normalizeStocksWatcherRouteSymbol,
  STOCKS_WATCHER_DEFAULT_SYMBOL,
} from "../src/lib/stocks-intelligence-watcher-route";

test("reads prefilled watcher ticker from hash query", () => {
  assert.equal(getStocksWatcherInitialSymbolFromHash("#/work/stocks-intelligence-watcher?symbol=AAPL"), "AAPL");
});

test("normalizes lowercase hash ticker", () => {
  assert.equal(getStocksWatcherInitialSymbolFromHash("#/work/stocks-intelligence-watcher?symbol=tsla"), "TSLA");
});

test("falls back for invalid or missing hash ticker", () => {
  assert.equal(getStocksWatcherInitialSymbolFromHash("#/work/stocks-intelligence-watcher"), STOCKS_WATCHER_DEFAULT_SYMBOL);
  assert.equal(getStocksWatcherInitialSymbolFromHash("#/work/stocks-intelligence-watcher?symbol=AAPL%20DROP"), STOCKS_WATCHER_DEFAULT_SYMBOL);
});

test("route symbol validation matches watcher ticker syntax", () => {
  assert.equal(normalizeStocksWatcherRouteSymbol("^SPX"), "^SPX");
  assert.equal(normalizeStocksWatcherRouteSymbol("btc-usd"), "BTC-USD");
  assert.equal(normalizeStocksWatcherRouteSymbol("TOO-LONG-SYMBOL"), null);
});
