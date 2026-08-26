import assert from "node:assert/strict";
import test from "node:test";

import { onRequest as stocksWatcherApi } from "../functions/api/stocks-intelligence-watcher";
import type { D1DatabaseLike } from "../src/lib/spx-recap-d1";

class MarketCacheD1 implements D1DatabaseLike {
  readonly queries: string[] = [];
  trackedAssetScans = 0;
  refreshQuotaReservations = 0;
  trackedAssetsAvailable = true;
  quotaStoreAvailable = true;
  readonly rows = new Map<string, {
    cache_key: string;
    payload_json: string;
    source_as_of: string | null;
    cached_at: string;
    expires_at: string;
    last_refresh_error: string | null;
  }>();
  readonly refreshQuota = new Map<string, { dayUtc: string; rowsRead: number; rowsWritten: number }>();

  prepare(query: string) {
    this.queries.push(query);
    let values: unknown[] = [];
    const statement = {
      bind: (...next: unknown[]) => {
        values = next;
        return statement;
      },
      first: async <T>() => {
        if (query.includes("'market-cache-quota'")) {
          if (!this.quotaStoreAvailable) throw new Error("D1 unavailable");
          this.refreshQuotaReservations += 1;
          const key = String(values[0]);
          const initial = JSON.parse(String(values[1])) as { dayUtc: string; rowsRead: number; rowsWritten: number };
          const current = this.refreshQuota.get(key);
          const next = current
            ? {
              dayUtc: current.dayUtc,
              rowsRead: Math.min(current.rowsRead + Number(values[6]), Number(values[7])),
              rowsWritten: Math.min(current.rowsWritten + Number(values[8]), Number(values[9])),
            }
            : initial;
          if (current && (current.rowsRead >= 1_000_000 || current.rowsWritten >= 20_000)) return null;
          this.refreshQuota.set(key, next);
          return { payload_json: JSON.stringify(next) } as T;
        }
        return (this.rows.get(String(values[0])) || null) as T | null;
      },
      all: async <T>() => {
        if (!query.includes("FROM tracked_assets")) return { results: [] as T[] };
        this.trackedAssetScans += 1;
        return {
          results: this.trackedAssetsAvailable
            ? [{
              symbol: "NVDA", provider_symbol: "NVDA", priority: 100,
              display_name: "NVIDIA", asset_type: "equity", is_active: 1,
              metadata_json: '{"gicsSector":"Information Technology"}',
              created_at: "2026-08-24T00:00:00.000Z", updated_at: "2026-08-24T00:00:00.000Z",
            }] as T[]
            : [],
        };
      },
      run: async () => {
        if (query.includes("INSERT INTO market_cache_entries")) {
          const [cacheKey, , , payloadJson, sourceAsOf, cachedAt, expiresAt] = values;
          this.rows.set(String(cacheKey), {
            cache_key: String(cacheKey),
            payload_json: String(payloadJson),
            source_as_of: sourceAsOf ? String(sourceAsOf) : null,
            cached_at: String(cachedAt),
            expires_at: String(expiresAt),
            last_refresh_error: null,
          });
        }
        return { meta: { changes: 1, rows_read: 1, rows_written: 1 } };
      },
    };
    return statement;
  }
}

test("watchlist caches the authoritative tracking scan after its first refresh", async () => {
  const db = new MarketCacheD1();
  const call = () => stocksWatcherApi({
    request: new Request(
      "https://example.com/api/stocks-intelligence-watcher",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "get_watchlist", params: {} }),
      },
    ),
    env: { MARKET_CACHE_DB: db },
  });

  const first = await call();
  const second = await call();
  const payload = (await second.json()) as {
    ok: boolean;
    observability: { rowsRead: number; rowsWritten: number };
  };
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.observability.rowsRead, 1);
  assert.equal(payload.observability.rowsWritten, 0);
  assert.equal((payload as { cache: { status: string } }).cache.status, "hit");
  assert.equal(db.trackedAssetScans, 1);
  assert.equal(db.refreshQuotaReservations, 1);
});

test("watchlist fails closed when a stale cache cannot refresh authoritative tracking", async () => {
  const db = new MarketCacheD1();
  const call = () => stocksWatcherApi({
    request: new Request(
      "https://example.com/api/stocks-intelligence-watcher",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "get_watchlist", params: {} }),
      },
    ),
    env: { MARKET_CACHE_DB: db },
  });

  assert.equal((await call()).status, 200);
  const cachedWatchlist = [...db.rows.entries()].find(([key]) => !key.startsWith("__market_cache_refresh_quota__"));
  assert.ok(cachedWatchlist);
  cachedWatchlist[1].expires_at = "2000-01-01T00:00:00.000Z";
  db.trackedAssetsAvailable = false;

  const response = await call();
  const payload = (await response.json()) as { ok: boolean; error: string };
  assert.equal(response.status, 502);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /no active tracked assets/i);
  assert.equal(db.trackedAssetScans, 2);
  assert.equal(db.refreshQuotaReservations, 2);
});

test("watchlist quota reserves its bounded authoritative tracking scan", async () => {
  const db = new MarketCacheD1();
  const dayUtc = new Date().toISOString().slice(0, 10);
  db.refreshQuota.set(`__market_cache_refresh_quota__:${dayUtc}`, {
    dayUtc,
    rowsRead: 999_980,
    rowsWritten: 0,
  });
  const response = await stocksWatcherApi({
    request: new Request("https://example.com/api/stocks-intelligence-watcher", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "get_watchlist", params: {} }),
    }),
    env: { MARKET_CACHE_DB: db },
  });

  assert.equal(response.status, 429);
  assert.equal(db.refreshQuotaReservations, 1);
  assert.equal(db.trackedAssetScans, 0);
  assert.equal(db.refreshQuota.get(`__market_cache_refresh_quota__:${dayUtc}`)?.rowsRead, 1_000_000);
});

test("ignored POST parameters cannot create additional market-cache entries", async () => {
  const db = new MarketCacheD1();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    chart: {
      result: [{
        meta: { regularMarketPrice: 180, regularMarketPreviousClose: 179 },
        timestamp: [1_700_000_000],
        indicators: { quote: [{ open: [179], high: [181], low: [178], close: [180], volume: [100] }] },
      }],
      error: null,
    },
  }));
  try {
    const call = (params: Record<string, unknown>) => stocksWatcherApi({
      request: new Request("https://example.com/api/stocks-intelligence-watcher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "get_stock_history", params }),
      }),
      env: { MARKET_CACHE_DB: db },
    });
    const first = await call({ ticker: "NVDA", nonce: "first" });
    const second = await call({ ticker: "NVDA", range: "5y", interval: "1d", nonce: "second" });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal([...db.rows.keys()].filter((key) => !key.startsWith("__market_cache_refresh_quota__")).length, 1);
    assert.equal((await second.json() as { cache: { status: string } }).cache.status, "hit");
    assert.equal(db.refreshQuotaReservations, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ignored ticker input reuses the default quotes market-cache entry", async () => {
  const db = new MarketCacheD1();
  const originalFetch = globalThis.fetch;
  let quoteLoads = 0;
  globalThis.fetch = async () => {
    quoteLoads += 1;
    return new Response(JSON.stringify({
      chart: {
        result: [{
          meta: { regularMarketPrice: 180, regularMarketPreviousClose: 179 },
          timestamp: [1_700_000_000],
          indicators: { quote: [{ open: [179], high: [181], low: [178], close: [180], volume: [100] }] },
        }],
        error: null,
      },
    }));
  };
  try {
    const call = (ticker: string) => stocksWatcherApi({
      request: new Request("https://example.com/api/stocks-intelligence-watcher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "get_quotes", params: { ticker } }),
      }),
      env: { MARKET_CACHE_DB: db },
    });
    const first = await call("NVDA");
    const second = await call("AAPL");
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await second.json() as { cache: { status: string } }).cache.status, "hit");
    assert.equal([...db.rows.keys()].filter((key) => !key.startsWith("__market_cache_refresh_quota__")).length, 1);
    assert.equal(db.refreshQuotaReservations, 1);
    assert.ok(quoteLoads > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("options sweeps refreshes separately for distinct expiry requests", async () => {
  const db = new MarketCacheD1();
  const originalFetch = globalThis.fetch;
  let optionLoads = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://fc.yahoo.com") return new Response("", { headers: { "set-cookie": "A=1" } });
    if (url.includes("/v1/test/getcrumb")) return new Response("crumb");
    const expiry = new URL(url).searchParams.get("date") || "0";
    optionLoads += 1;
    return new Response(JSON.stringify({ optionChain: { result: [{
      expirationDates: [Number(expiry)],
      quote: { regularMarketPrice: 180 },
      options: [{ expirationDate: Number(expiry), calls: [{ strike: 180, volume: 20, openInterest: 10 }], puts: [] }],
    }] } }));
  };
  try {
    const call = (expiry: string) => stocksWatcherApi({
      request: new Request("https://example.com/api/stocks-intelligence-watcher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "get_options_sweeps", params: { ticker: "NVDA", expiry } }),
      }),
      env: { MARKET_CACHE_DB: db },
    });
    const first = await call("2026-08-28");
    const second = await call("2026-09-04");
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await first.json() as { raw: { chain: { selectedExpiry: string } } }).raw.chain.selectedExpiry, "2026-08-28");
    assert.equal((await second.json() as { raw: { chain: { selectedExpiry: string } } }).raw.chain.selectedExpiry, "2026-09-04");
    assert.equal(optionLoads, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("equivalent exposure row limits reuse one market-cache entry", async () => {
  const db = new MarketCacheD1();
  const originalFetch = globalThis.fetch;
  let optionLoads = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://fc.yahoo.com") return new Response("", { headers: { "set-cookie": "A=1" } });
    if (url.includes("/v1/test/getcrumb")) return new Response("crumb");
    optionLoads += 1;
    return new Response(JSON.stringify({ optionChain: { result: [{
      expirationDates: [1_788_000_000],
      quote: { regularMarketPrice: 180 },
      options: [{ expirationDate: 1_788_000_000, calls: [{ strike: 180, volume: 20, openInterest: 10 }], puts: [] }],
    }] } }));
  };
  try {
    const call = (topRows: number) => stocksWatcherApi({
      request: new Request("https://example.com/api/stocks-intelligence-watcher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "chart_dex", params: { ticker: "NVDA", expiry: "2026-08-28", topRows } }),
      }),
      env: { MARKET_CACHE_DB: db },
    });
    const first = await call(12.1);
    const second = await call(12.9);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await second.json() as { cache: { status: string } }).cache.status, "hit");
    assert.equal(optionLoads, 1);
    assert.equal(db.refreshQuotaReservations, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("equivalent options display bounds reuse one market-cache entry", async () => {
  const db = new MarketCacheD1();
  const originalFetch = globalThis.fetch;
  let optionLoads = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://fc.yahoo.com") return new Response("", { headers: { "set-cookie": "A=1" } });
    if (url.includes("/v1/test/getcrumb")) return new Response("crumb");
    optionLoads += 1;
    return new Response(JSON.stringify({ optionChain: { result: [{
      expirationDates: [1_788_000_000],
      quote: { regularMarketPrice: 180 },
      options: [{ expirationDate: 1_788_000_000, calls: [{ strike: 180, volume: 20, openInterest: 10 }], puts: [] }],
    }] } }));
  };
  try {
    const call = (strikesAroundAtm: number) => stocksWatcherApi({
      request: new Request("https://example.com/api/stocks-intelligence-watcher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "get_options", params: { ticker: "NVDA", expiry: "2026-08-28", strikesAroundAtm } }),
      }),
      env: { MARKET_CACHE_DB: db },
    });
    const first = await call(1);
    const second = await call(2);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await second.json() as { cache: { status: string } }).cache.status, "hit");
    assert.equal(optionLoads, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ignored market selection reuses one market breadth cache entry", async () => {
  const db = new MarketCacheD1();
  const originalFetch = globalThis.fetch;
  let quoteLoads = 0;
  globalThis.fetch = async () => {
    quoteLoads += 1;
    return new Response(JSON.stringify({
      chart: {
        result: [{
          meta: { regularMarketPrice: 180, regularMarketPreviousClose: 179 },
          timestamp: [1_700_000_000],
          indicators: { quote: [{ open: [179], high: [181], low: [178], close: [180], volume: [100] }] },
        }],
        error: null,
      },
    }));
  };
  try {
    const call = (market: string) => stocksWatcherApi({
      request: new Request("https://example.com/api/stocks-intelligence-watcher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "market_breadth", params: { market } }),
      }),
      env: { MARKET_CACHE_DB: db },
    });
    const first = await call("US");
    const second = await call("EU");
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await second.json() as { cache: { status: string } }).cache.status, "hit");
    assert.equal(db.refreshQuotaReservations, 1);
    assert.ok(quoteLoads > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normalized ticker and ignored signal intent reuse market-cache entries", async () => {
  const db = new MarketCacheD1();
  const originalFetch = globalThis.fetch;
  let chartLoads = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/v8/finance/chart/")) {
      chartLoads += 1;
      return new Response(JSON.stringify({ chart: { result: [{
        meta: { regularMarketPrice: 180, regularMarketPreviousClose: 179 },
        timestamp: [1_700_000_000],
        indicators: { quote: [{ open: [179], high: [181], low: [178], close: [180], volume: [100] }] },
      }], error: null } }));
    }
    if (url === "https://fc.yahoo.com") return new Response("", { headers: { "set-cookie": "A=1" } });
    if (url.includes("/v1/test/getcrumb")) return new Response("crumb");
    if (url.includes("/quoteSummary/")) return new Response(JSON.stringify({ quoteSummary: { result: [{ defaultKeyStatistics: { beta: { raw: 1.2 } } }] } }));
    throw new Error(`Unexpected Yahoo request ${url}`);
  };
  try {
    const call = (tool: string, params: Record<string, unknown>) => stocksWatcherApi({
      request: new Request("https://example.com/api/stocks-intelligence-watcher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, params }),
      }),
      env: { MARKET_CACHE_DB: db },
    });
    const betaFirst = await call("get_beta", { ticker: "nvda" });
    const betaSecond = await call("get_beta", { ticker: "NVDA" });
    const signalFirst = await call("signal_scan", { ticker: "nvda", intent: "morning" });
    const signalSecond = await call("signal_scan", { ticker: "NVDA", intent: "close" });
    assert.equal(betaFirst.status, 200);
    assert.equal((await betaSecond.json() as { cache: { status: string } }).cache.status, "hit");
    assert.equal(signalFirst.status, 200);
    assert.equal((await signalSecond.json() as { cache: { status: string } }).cache.status, "hit");
    assert.equal(chartLoads, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exhausted refresh quota fails closed before the Yahoo load", async () => {
  const db = new MarketCacheD1();
  const dayUtc = new Date().toISOString().slice(0, 10);
  db.refreshQuota.set(`__market_cache_refresh_quota__:${dayUtc}`, {
    dayUtc,
    rowsRead: 0,
    rowsWritten: 20_000 - 10,
  });
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error("Yahoo must not run after quota rejection");
  };
  try {
    const response = await stocksWatcherApi({
      request: new Request("https://example.com/api/stocks-intelligence-watcher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "get_stock_history", params: { ticker: "NVDA" } }),
      }),
      env: { MARKET_CACHE_DB: db },
    });
    assert.equal(response.status, 429);
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quota-store failures return D1_QUOTA_STORE_UNAVAILABLE instead of pretending reads are exhausted", async () => {
  const db = new MarketCacheD1();
  db.quotaStoreAvailable = false;
  let fetches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error("Yahoo must not run after quota-store failure");
  };
  try {
    const response = await stocksWatcherApi({
      request: new Request("https://example.com/api/stocks-intelligence-watcher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "get_stock_history", params: { ticker: "NVDA" } }),
      }),
      env: { MARKET_CACHE_DB: db },
    });
    const payload = await response.json() as { errorCode: string; error: string };
    assert.equal(response.status, 503);
    assert.equal(payload.errorCode, "D1_QUOTA_STORE_UNAVAILABLE");
    assert.equal(payload.error.includes("Cloudflare free read limit"), false);
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
