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
  private hangInsert = false;

  setHangInsert(value: boolean) {
    this.hangInsert = value;
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
        if (query.includes("INSERT INTO market_cache_entries") && this.hangInsert) {
          return new Promise<never>(() => {});
        }
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

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

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

test("market cache deadlines settle never-resolving loads and D1 reads", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    resolveMarketCache({
      scope: "deadline",
      symbol: "AAPL",
      deadlineMs: 30,
      load: async () => new Promise<never>(() => {}),
    }),
    (error) => error instanceof Error && error.name === "MarketCacheTimeoutError" && /upstream/.test(error.message),
  );

  const hangingReadDb = {
    prepare: () => {
      const statement = {
        bind: () => statement,
        first: async <T>() => new Promise<T | null>(() => {}),
        all: async <T>() => ({ results: [] as T[] }),
        run: async () => ({}),
      };
      return statement;
    },
  } satisfies D1DatabaseLike;
  await assert.rejects(
    resolveMarketCache({
      db: hangingReadDb,
      scope: "deadline",
      symbol: "MSFT",
      deadlineMs: 40,
      load: async () => ({ price: 1 }),
    }),
    (error) => error instanceof Error && error.name === "MarketCacheTimeoutError" && /cache-read/.test(error.message),
  );
  assert.ok(Date.now() - startedAt < 300);
});

test("market cache serves stale data when cache write exceeds its phase deadline", async () => {
  const db = new MemoryD1();
  let now = new Date("2026-07-14T12:00:00.000Z");
  await resolveMarketCache({
    db,
    scope: "write-timeout",
    symbol: "SOFI",
    now: () => now,
    load: async () => ({ price: 20 }),
  });
  now = new Date(now.getTime() + 61_000);
  db.setHangInsert(true);

  const startedAt = Date.now();
  const stale = await resolveMarketCache({
    db,
    scope: "write-timeout",
    symbol: "SOFI",
    now: () => now,
    deadlineMs: 120,
    load: async () => {
      await wait(75);
      return { price: 21 };
    },
  });
  assert.equal(stale.cache.status, "stale");
  assert.equal(stale.value.price, 20);
  assert.match(stale.cache.refreshError || "", /cache-write exceeded/);
  assert.ok(Date.now() - startedAt < 180);
});

test("aborting the refresh leader does not cancel a coalesced follower", async () => {
  const db = new MemoryD1();
  const leaderController = new AbortController();
  let calls = 0;
  let releaseLoad!: (value: { price: number }) => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const loadResult = new Promise<{ price: number }>((resolve) => { releaseLoad = resolve; });
  const load = async () => {
    calls += 1;
    markStarted();
    return loadResult;
  };

  const leader = resolveMarketCache({
    db,
    scope: "coalesced-abort",
    symbol: "AAPL",
    deadlineMs: 500,
    signal: leaderController.signal,
    load,
  });
  await started;
  const follower = resolveMarketCache({
    db,
    scope: "coalesced-abort",
    symbol: "AAPL",
    deadlineMs: 500,
    load,
  });
  await wait(5);
  leaderController.abort();
  releaseLoad({ price: 123 });

  await assert.rejects(leader, (error) => error instanceof Error && error.name === "AbortError");
  const followerResult = await follower;
  assert.equal(followerResult.value.price, 123);
  assert.equal(followerResult.cache.status, "refreshed");
  assert.equal(calls, 1);
});

test("stale fallback failure emits terminal phase diagnostics", async () => {
  let reads = 0;
  const db = {
    prepare: () => {
      const statement = {
        bind: () => statement,
        first: async <T>() => {
          reads += 1;
          if (reads === 1) return null;
          return new Promise<T | null>(() => {});
        },
        all: async <T>() => ({ results: [] as T[] }),
        run: async () => ({}),
      };
      return statement;
    },
  } satisfies D1DatabaseLike;
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => logs.push(values.map(String).join(" "));
  try {
    await assert.rejects(
      resolveMarketCache({
        db,
        scope: "fallback-log",
        symbol: "MSFT",
        deadlineMs: 80,
        load: async () => { throw new Error("Yahoo unavailable"); },
      }),
      (error) => error instanceof Error && error.name === "MarketCacheTimeoutError" && /stale-read/.test(error.message),
    );
  } finally {
    console.log = originalLog;
  }

  const terminal = logs.map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((entry) => entry.status === "failed" && entry.fallbackFailurePhase === "stale-read");
  assert.ok(terminal);
  assert.equal(terminal.originalErrorClass, "Error");
  assert.equal(terminal.fallbackErrorClass, "MarketCacheTimeoutError");
});
