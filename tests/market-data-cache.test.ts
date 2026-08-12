import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMarketCacheKey,
  MAX_CACHE_PRUNE_READ_ROWS,
  MAX_CACHE_PRUNE_ROWS,
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
  lastPrunedRows = 0;
  lastPrunedRowsRead = 0;
  omitPruneMetadata = false;
  pruneRowsReadOverride: number | null = null;
  lastPruneQuery = "";

  seedExpiredRows(count: number, expiresAt: string) {
    for (let index = 0; index < count; index += 1) {
      const cacheKey = `expired:${index}`;
      this.rows.set(cacheKey, {
        cache_key: cacheKey,
        payload_json: JSON.stringify({ expired: index }),
        source_as_of: null,
        cached_at: "2026-07-01T00:00:00.000Z",
        expires_at: expiresAt,
        last_refresh_error: null,
      });
    }
  }

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
          return { meta: { changes: 1, rows_read: 1, rows_written: 1 } };
        }
        if (query.includes("UPDATE market_cache_entries")) {
          const [error, , cacheKey] = values;
          const row = this.rows.get(String(cacheKey));
          if (row) row.last_refresh_error = String(error);
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (query.includes("DELETE FROM market_cache_entries") && query.includes("LIMIT ?")) {
          this.lastPruneQuery = query;
          const cutoff = Date.parse(String(values[0]));
          const limit = Number(values[1]);
          const candidates = [...this.rows.values()]
            .filter((row) => Date.parse(row.expires_at) < cutoff)
            .sort((left, right) => left.expires_at.localeCompare(right.expires_at) || left.cache_key.localeCompare(right.cache_key))
            .slice(0, limit);
          for (const row of candidates) this.rows.delete(row.cache_key);
          this.lastPrunedRows = candidates.length;
          this.lastPrunedRowsRead = candidates.length;
          const rowsRead = this.pruneRowsReadOverride ?? candidates.length;
          return this.omitPruneMetadata
            ? {}
            : { meta: { changes: candidates.length, rows_read: rowsRead, rows_written: candidates.length } };
        }
        return { meta: { changes: 0 } };
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

test("cache prune is indexed, bounded, and reports actual deleted rows", async () => {
  const db = new MemoryD1();
  db.seedExpiredRows(MAX_CACHE_PRUNE_ROWS + 17, "2026-07-01T00:00:00.000Z");
  const resolved = await resolveMarketCache({
    db,
    scope: "bounded-prune",
    symbol: "AAPL",
    now: () => new Date("2026-07-14T12:00:00.000Z"),
    load: async () => ({ price: 1 }),
  });

  assert.equal(db.lastPrunedRows, MAX_CACHE_PRUNE_ROWS);
  assert.equal(db.lastPrunedRowsRead, MAX_CACHE_PRUNE_ROWS);
  assert.match(db.lastPruneQuery, /WHERE cache_key IN\s*\(\s*SELECT cache_key/);
  assert.match(db.lastPruneQuery, /ORDER BY expires_at ASC, cache_key ASC\s+LIMIT \?/);
  assert.equal(resolved.cache.rowsRead, 1 + 1 + MAX_CACHE_PRUNE_ROWS);
  assert.equal(resolved.cache.rowsWritten, 1 + MAX_CACHE_PRUNE_ROWS);
});

test("cache preserves actual prune rows_read above the bounded delete count", async () => {
  const db = new MemoryD1();
  db.pruneRowsReadOverride = MAX_CACHE_PRUNE_READ_ROWS + 17;
  const resolved = await resolveMarketCache({
    db,
    scope: "prune-read-metadata",
    symbol: "AAPL",
    now: () => new Date("2026-07-14T12:00:00.000Z"),
    load: async () => ({ price: 1 }),
  });

  assert.equal(resolved.cache.rowsRead, 1 + 1 + MAX_CACHE_PRUNE_READ_ROWS + 17);
});

test("cache prune metadata absence reports the bounded worst-case read/write", async () => {
  const db = new MemoryD1();
  db.omitPruneMetadata = true;
  db.seedExpiredRows(MAX_CACHE_PRUNE_ROWS + 3, "2026-07-01T00:00:00.000Z");
  const resolved = await resolveMarketCache({
    db,
    scope: "bounded-prune-fallback",
    symbol: "AAPL",
    now: () => new Date("2026-07-14T12:00:00.000Z"),
    load: async () => ({ price: 1 }),
  });

  assert.equal(resolved.cache.rowsRead, 1 + 1 + MAX_CACHE_PRUNE_READ_ROWS);
  assert.equal(resolved.cache.rowsWritten, 1 + MAX_CACHE_PRUNE_ROWS);
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
