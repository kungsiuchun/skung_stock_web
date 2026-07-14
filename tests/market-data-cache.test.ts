import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMarketCacheKey,
  resolveMarketCache,
} from "../src/lib/market-data-cache";
import type { D1DatabaseLike } from "../src/lib/spx-recap-d1";

type Row = {
  cache_key: string;
  payload_json: string;
  source_as_of: string | null;
  cached_at: string;
  expires_at: string;
  last_refresh_error: string | null;
};

class MemoryD1 implements D1DatabaseLike {
  private readonly rows = new Map<string, Row>();

  prepare(query: string) {
    let values: unknown[] = [];
    const statement = {
      bind: (...next: unknown[]) => {
        values = next;
        return statement;
      },
      first: async <T>() => {
        if (!query.includes("SELECT")) return null;
        return (this.rows.get(String(values[0])) || null) as T | null;
      },
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
        if (query.includes("UPDATE market_cache_entries")) {
          const [error, , cacheKey] = values;
          const row = this.rows.get(String(cacheKey));
          if (row) row.last_refresh_error = String(error);
        }
        if (query.includes("DELETE FROM market_cache_entries WHERE cached_at")) {
          const cutoff = Date.parse(String(values[0]));
          for (const [key, row] of this.rows) {
            if (Date.parse(row.cached_at) < cutoff) this.rows.delete(key);
          }
        }
        return {};
      },
    };
    return statement;
  }
}

test("market cache returns a fresh hit without repeating the upstream call", async () => {
  const db = new MemoryD1();
  let now = new Date("2026-07-14T12:00:00.000Z");
  let calls = 0;
  const options = {
    db,
    scope: "test",
    symbol: "aapl",
    params: { expiry: "2026-07-17", strikes: 40 },
    now: () => now,
    load: async () => ({ price: ++calls }),
  };

  const first = await resolveMarketCache(options);
  const second = await resolveMarketCache(options);

  assert.equal(first.cache.status, "refreshed");
  assert.equal(second.cache.status, "hit");
  assert.equal(second.value.price, 1);
  assert.equal(calls, 1);
});

test("market cache serves explicit stale data after a failed refresh", async () => {
  const db = new MemoryD1();
  let now = new Date("2026-07-14T12:00:00.000Z");
  await resolveMarketCache({
    db,
    scope: "test",
    symbol: "TSLA",
    now: () => now,
    load: async () => ({ price: 300 }),
  });
  now = new Date(now.getTime() + 61_000);

  const stale = await resolveMarketCache({
    db,
    scope: "test",
    symbol: "TSLA",
    now: () => now,
    load: async () => { throw new Error("Yahoo 503"); },
  });

  assert.equal(stale.cache.status, "stale");
  assert.equal(stale.value.price, 300);
  assert.match(stale.cache.refreshError || "", /Yahoo 503/);
});

test("market cache does not manufacture a result when no stale entry exists", async () => {
  await assert.rejects(
    resolveMarketCache({
      db: new MemoryD1(),
      scope: "test",
      symbol: "NVDA",
      load: async () => { throw new Error("Yahoo unavailable"); },
    }),
    /Yahoo unavailable/,
  );
});

test("cache keys are stable across parameter key order", () => {
  assert.equal(
    buildMarketCacheKey("tool", "aapl", { expiry: "2026-07-17", strike: 200 }),
    buildMarketCacheKey("tool", "AAPL", { strike: 200, expiry: "2026-07-17" }),
  );
});
