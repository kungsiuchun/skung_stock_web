import assert from "node:assert/strict";
import test from "node:test";

import { onRequest as stocksWatcherApi } from "../functions/api/stocks-intelligence-watcher";
import type { D1DatabaseLike } from "../src/lib/spx-recap-d1";

class TrackingOnlyD1 implements D1DatabaseLike {
  readonly queries: string[] = [];

  prepare(query: string) {
    this.queries.push(query);
    const statement = {
      bind: () => statement,
      first: async <T>() => {
        throw new Error(`Unexpected D1 first query: ${query}`);
      },
      all: async <T>() => {
        if (!query.includes("FROM tracked_assets"))
          throw new Error(`Unexpected D1 scan: ${query}`);
        return {
          results: [
            {
              symbol: "NVDA",
              provider_symbol: "NVDA",
              priority: 100,
              display_name: "NVIDIA",
              asset_type: "equity",
              is_active: 1,
              metadata_json: '{"gicsSector":"Information Technology"}',
              created_at: "2026-08-24T00:00:00.000Z",
              updated_at: "2026-08-24T00:00:00.000Z",
            },
          ] as T[],
        };
      },
      run: async () => {
        throw new Error(`Unexpected D1 write: ${query}`);
      },
    };
    return statement;
  }
}

class MarketCacheD1 implements D1DatabaseLike {
  readonly queries: string[] = [];
  readonly rows = new Map<string, {
    cache_key: string;
    payload_json: string;
    source_as_of: string | null;
    cached_at: string;
    expires_at: string;
    last_refresh_error: string | null;
  }>();

  prepare(query: string) {
    this.queries.push(query);
    let values: unknown[] = [];
    const statement = {
      bind: (...next: unknown[]) => {
        values = next;
        return statement;
      },
      first: async <T>() => (this.rows.get(String(values[0])) || null) as T | null,
      all: async <T>() => ({ results: [] as T[] }),
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

test("watchlist performs one authoritative tracking read and no quota-ledger operation", async () => {
  const db = new TrackingOnlyD1();
  const response = await stocksWatcherApi({
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

  const payload = (await response.json()) as {
    ok: boolean;
    observability: { rowsRead: number; rowsWritten: number };
  };
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.observability.rowsRead, 1);
  assert.equal(payload.observability.rowsWritten, 0);
  assert.equal(db.queries.length, 1);
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
    const call = (nonce: string) => stocksWatcherApi({
      request: new Request("https://example.com/api/stocks-intelligence-watcher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "get_stock_history", params: { ticker: "NVDA", nonce } }),
      }),
      env: { MARKET_CACHE_DB: db },
    });
    const first = await call("first");
    const second = await call("second");
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(db.rows.size, 1);
    assert.equal((await second.json() as { cache: { status: string } }).cache.status, "hit");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
