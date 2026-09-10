import assert from "node:assert/strict";
import test from "node:test";

import { onRequestGet } from "../functions/api/fear-greed";
import type { D1DatabaseLike } from "../src/lib/spx-recap-d1";

class CacheDb implements D1DatabaseLike {
  readonly rows = new Map<string, { payload_json: string; source_as_of: string | null; cached_at: string; expires_at: string; last_refresh_error: string | null }>();
  refreshQuotaReservations = 0;

  prepare(query: string) {
    let values: unknown[] = [];
    const statement = {
      bind: (...next: unknown[]) => { values = next; return statement; },
      first: async <T>() => {
        if (query.includes("'market-cache-quota'")) {
          this.refreshQuotaReservations += 1;
          const key = String(values[0]);
          const initial = JSON.parse(String(values[1]));
          this.rows.set(key, { payload_json: JSON.stringify(initial), source_as_of: null, cached_at: String(values[2]), expires_at: String(values[3]), last_refresh_error: null });
          return { payload_json: JSON.stringify(initial) } as T;
        }
        return (this.rows.get(String(values[0])) || null) as T | null;
      },
      all: async <T>() => ({ results: [] as T[] }),
      run: async () => {
        if (query.includes("INSERT INTO market_cache_entries")) {
          const [cacheKey, , , payloadJson, sourceAsOf, cachedAt, expiresAt] = values;
          this.rows.set(String(cacheKey), { payload_json: String(payloadJson), source_as_of: sourceAsOf ? String(sourceAsOf) : null, cached_at: String(cachedAt), expires_at: String(expiresAt), last_refresh_error: null });
        }
        return { meta: { changes: 1 } };
      },
    };
    return statement;
  }
}

const cnnPayload = {
  fear_and_greed: { score: 38.9, rating: "fear", timestamp: "2026-09-09T20:00:00.000Z", previous_close: 40.2, previous_1_week: 44.8, previous_1_month: 52.1, previous_1_year: 29.7 },
  fear_and_greed_historical: { data: [
    { x: 1_725_840_000_000, y: 35.1, rating: "fear" },
    { x: 1_725_926_400_000, y: 38.9, rating: "fear" },
  ] },
};

test("fear-greed API reads CNN once then serves its D1 cache", async () => {
  const db = new CacheDb();
  const originalFetch = globalThis.fetch;
  let cnnLoads = 0;
  let userAgent = "";
  globalThis.fetch = async (_input, init) => {
    cnnLoads += 1;
    userAgent = new Headers(init?.headers).get("User-Agent") || "";
    return new Response(JSON.stringify(cnnPayload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const call = () => onRequestGet({ request: new Request("https://example.com/api/fear-greed"), env: { MARKET_CACHE_DB: db } });
    const first = await call();
    const second = await call();
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await first.json() as { cache: { status: string; ttlMs: number } }).cache.status, "refreshed");
    assert.equal((await second.json() as { cache: { status: string } }).cache.status, "hit");
    assert.equal(cnnLoads, 1);
    assert.equal(db.refreshQuotaReservations, 1);
    assert.match(userAgent, /^SiusAIWorkshop\/1\.0/, "CNN requests must carry an honest server identity");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fear-greed API fails closed when CNN returns an invalid payload", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ fear_and_greed: { score: 999 } }), { status: 200 });
  try {
    const response = await onRequestGet({ request: new Request("https://example.com/api/fear-greed"), env: {} });
    const payload = await response.json() as { errorCode: string };
    assert.equal(response.status, 502);
    assert.equal(payload.errorCode, "CNN_FEAR_GREED_UNAVAILABLE");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
