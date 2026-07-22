import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet } from "../functions/api/candlestick-patterns";
import type { D1DatabaseLike } from "../src/lib/spx-recap-d1";

type CacheRow = {
  cache_key: string;
  payload_json: string;
  source_as_of: string | null;
  cached_at: string;
  expires_at: string;
  last_refresh_error: string | null;
};

class MemoryD1 implements D1DatabaseLike {
  private readonly rows = new Map<string, CacheRow>();

  expireAll() {
    for (const row of this.rows.values()) row.expires_at = "1970-01-01T00:00:00.000Z";
  }

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
        return {};
      },
    };
    return statement;
  }
}

const yahooPayload = () => {
  const timestamps = Array.from({ length: 30 }, (_, index) => Date.parse(`2026-06-${String(index + 1).padStart(2, "0")}T13:30:00.000Z`) / 1_000);
  const closes = timestamps.map((_, index) => 100 + index);
  return {
    chart: {
      result: [{
        meta: { exchangeTimezoneName: "America/New_York" },
        timestamp: timestamps,
        indicators: { quote: [{
          open: closes.map((close) => close - 0.25),
          high: closes.map((close) => close + 0.5),
          low: closes.map((close) => close - 0.5),
          close: closes,
          volume: closes.map((_, index) => 1_000 + index),
        }] },
      }],
      error: null,
    },
  };
};

const parse = async (response: Response) => response.json() as Promise<any>;

test("API maps each supported interval to its fixed Yahoo range and bypasses absent D1", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    requested.push(String(input));
    return new Response(JSON.stringify(yahooPayload()), { status: 200 });
  };

  try {
    for (const [interval, range] of [["1d", "1y"], ["1wk", "5y"], ["1mo", "10y"]] as const) {
      const response = await onRequestGet({
        request: new Request(`http://localhost/api/candlestick-patterns?symbol=aapl&interval=${interval}`),
        env: {},
      });
      const body = await parse(response);
      assert.equal(response.status, 200);
      assert.equal(body.data.interval, interval);
      assert.equal(body.cache.status, "bypassed");
      assert.match(requested[requested.length - 1], new RegExp(`interval=${interval}.*range=${range}`));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("API rejects invalid symbols and intervals before calling Yahoo", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response();
  };
  try {
    const badSymbol = await onRequestGet({
      request: new Request("http://localhost/api/candlestick-patterns?symbol=AAPL%20DROP&interval=1d"),
      env: {},
    });
    const badInterval = await onRequestGet({
      request: new Request("http://localhost/api/candlestick-patterns?symbol=AAPL&interval=4h"),
      env: {},
    });
    assert.equal(badSymbol.status, 400);
    assert.equal(badInterval.status, 400);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("API fails closed for malformed upstream data when no stale cache exists", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("not-json", { status: 200 });
  try {
    const response = await onRequestGet({
      request: new Request("http://localhost/api/candlestick-patterns?symbol=NVDA&interval=1d"),
      env: { MARKET_CACHE_DB: new MemoryD1() },
    });
    const body = await parse(response);
    assert.equal(response.status, 502);
    assert.match(body.error, /not valid JSON/);
    assert.equal("data" in body, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("API returns an explicit 206 stale response after refresh failure", async () => {
  const originalFetch = globalThis.fetch;
  const db = new MemoryD1();
  let fail = false;
  globalThis.fetch = async () => {
    if (fail) throw new Error("Yahoo unavailable");
    return new Response(JSON.stringify(yahooPayload()), { status: 200 });
  };
  try {
    const request = new Request("http://localhost/api/candlestick-patterns?symbol=MSFT&interval=1d");
    const fresh = await onRequestGet({ request, env: { MARKET_CACHE_DB: db } });
    assert.equal(fresh.status, 200);
    db.expireAll();
    fail = true;

    const stale = await onRequestGet({ request, env: { MARKET_CACHE_DB: db } });
    const body = await parse(stale);
    assert.equal(stale.status, 206);
    assert.equal(body.cache.status, "stale");
    assert.match(body.cache.refreshError, /Yahoo unavailable/);
    assert.equal(body.data.symbol, "MSFT");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
