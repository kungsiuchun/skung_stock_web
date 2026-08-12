import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  STOCKS_WATCHER_BLOCKED_LEDGER_READ_ROWS,
  STOCKS_WATCHER_BLOCKED_LEDGER_WRITE_ROWS,
  STOCKS_WATCHER_KNOWN_THRESHOLD_BLOCKED_LEDGER_READ_ROWS,
  STOCKS_WATCHER_QUOTA_CACHE_READ_RESERVE,
  STOCKS_WATCHER_QUOTA_CACHE_WRITE_RESERVE,
  STOCKS_WATCHER_D1_READ_HEADROOM_AT_THRESHOLD,
  STOCKS_WATCHER_FREE_REQUESTS_PER_DAY,
  STOCKS_WATCHER_QUOTA_LEDGER_READ_RESERVE,
  STOCKS_WATCHER_QUOTA_RESERVE_ROWS_READ,
  STOCKS_WATCHER_QUOTA_RESERVE_ROWS_WRITTEN,
  STOCKS_WATCHER_QUOTA_LEDGER_WRITE_RESERVE,
  reserveStocksWatcherD1Quota,
} from "../src/lib/stocks-watcher-quota";
import {
  MARKET_CACHE_D1_DAILY_WRITE_LIMIT,
  MARKET_CACHE_D1_QUOTA_HARD_THRESHOLD,
  MARKET_CACHE_WRITE_INDEX_AMPLIFICATION,
  MAX_CACHE_PRUNE_READ_ROWS,
  MAX_CACHE_PRUNE_ROWS,
} from "../src/lib/market-data-cache";
import { onRequest as stocksWatcherApi } from "../functions/api/stocks-intelligence-watcher";
import type { D1DatabaseLike } from "../src/lib/spx-recap-d1";

type LedgerRow = {
  usage_date: string;
  observed_reads: number;
  reserved_reads: number;
  observed_writes: number;
  reserved_writes: number;
  updated_at: string;
};

type CacheRow = {
  cache_key: string;
  payload_json: string;
  source_as_of: string | null;
  cached_at: string;
  expires_at: string;
  last_refresh_error: string | null;
};

class WatcherQuotaD1 implements D1DatabaseLike {
  readonly ledger = new Map<string, LedgerRow>();
  readonly cache = new Map<string, CacheRow>();
  readonly queries: string[] = [];
  failLedger = false;
  forceReserveRaceLoss = false;

  prepare(query: string) {
    this.queries.push(query);
    let values: unknown[] = [];
    const statement = {
      bind: (...next: unknown[]) => {
        values = next;
        return statement;
      },
      first: async <T>() => {
        if (query.includes("FROM watcher_daily_usage_ledger")) {
          return (this.ledger.get(String(values[0])) || null) as T | null;
        }
        if (query.includes("FROM market_cache_entries")) {
          return (this.cache.get(String(values[0])) || null) as T | null;
        }
        return null;
      },
      all: async <T>() => {
        if (query.includes("FROM tracked_assets")) {
          return {
            results: [{
              symbol: "NVDA",
              provider_symbol: "NVDA",
              priority: 100,
              display_name: "NVIDIA",
              asset_type: "equity",
              is_active: 1,
              metadata_json: '{"gicsSector":"Information Technology","seedSet":"sp500-50-v1"}',
              created_at: "2026-08-11T00:00:00.000Z",
              updated_at: "2026-08-11T00:00:00.000Z",
            }] as T[],
          };
        }
        return { results: [] as T[] };
      },
      run: async () => {
        if (query.includes("watcher_daily_usage_ledger")) {
          if (this.failLedger) throw new Error("ledger unavailable");
          if (query.includes("INSERT OR IGNORE")) {
            const day = String(values[0]);
            if (this.ledger.has(day)) return { meta: { changes: 0 } };
            this.ledger.set(day, {
              usage_date: day,
              observed_reads: 0,
              reserved_reads: 0,
              observed_writes: 0,
              reserved_writes: 0,
              updated_at: String(values[1]),
            });
            return { meta: { changes: 1 } };
          }
          if (query.includes("reserved_reads = reserved_reads +")) {
            const day = String(values[3]);
            const row = this.ledger.get(day);
            if (!row) return { meta: { changes: 0 } };
            const reserveRead = Number(values[0]);
            const reserveWrite = Number(values[1]);
            const canReserve = row.observed_reads + row.reserved_reads + Number(values[4]) < Number(values[5])
              && row.observed_writes + row.reserved_writes + Number(values[6]) < Number(values[7]);
            if (this.forceReserveRaceLoss) {
              row.observed_reads = Number(values[5]);
              return { meta: { changes: 0 } };
            }
            if (!canReserve) return { meta: { changes: 0 } };
            row.reserved_reads += reserveRead;
            row.reserved_writes += reserveWrite;
            row.updated_at = String(values[2]);
            return { meta: { changes: 1 } };
          }
          if (query.includes("observed_reads = observed_reads +")) {
            const day = String(values[5]);
            const row = this.ledger.get(day);
            if (!row) return { meta: { changes: 0 } };
            row.observed_reads += Number(values[0]);
            row.reserved_reads = Math.max(0, row.reserved_reads - Number(values[1]));
            row.observed_writes += Number(values[2]);
            row.reserved_writes = Math.max(0, row.reserved_writes - Number(values[3]));
            row.updated_at = String(values[4]);
            return { meta: { changes: 1 } };
          }
        }
        if (query.includes("INSERT INTO market_cache_entries")) {
          const [cacheKey, , , payloadJson, sourceAsOf, cachedAt, expiresAt] = values;
          this.cache.set(String(cacheKey), {
            cache_key: String(cacheKey),
            payload_json: String(payloadJson),
            source_as_of: sourceAsOf ? String(sourceAsOf) : null,
            cached_at: String(cachedAt),
            expires_at: String(expiresAt),
            last_refresh_error: null,
          });
          return { meta: { changes: 1, rows_read: 1, rows_written: 1 } };
        }
        if (query.includes("DELETE FROM market_cache_entries")) {
          return { meta: { changes: 0, rows_read: 0, rows_written: 0 } };
        }
        return { meta: { changes: 1 } };
      },
    };
    return statement;
  }
}

const request = (method: "GET" | "POST", body?: unknown) => new Request(
  "https://example.com/api/stocks-intelligence-watcher?symbol=NVDA",
  {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  },
);

test("watcher POST reserves and finalizes D1 quota around a cache resolve", async () => {
  const db = new WatcherQuotaD1();
  const response = await stocksWatcherApi({
    request: request("POST", { tool: "get_watchlist", params: {} }),
    env: { MARKET_CACHE_DB: db },
  });
  assert.equal(response.status, 200);
  const row = db.ledger.get(new Date().toISOString().slice(0, 10));
  assert.ok(row);
  assert.equal(row.reserved_reads, 0);
  assert.equal(row.reserved_writes, 0);
  assert.equal(row.observed_reads, 5); // one tracking query + conservative four ledger reads
  assert.equal(row.observed_writes, 4); // ledger writes only; watchlist metadata is read-only
  assert.equal(db.queries.some((query) => query.includes("UPDATE watcher_daily_usage_ledger")), true);
  const payload = await response.json() as { raw: { source: string; symbols: string[]; stocks: Array<{ sector: string }> } };
  assert.equal(payload.raw.source, "d1_tracking");
  assert.deepEqual(payload.raw.symbols, ["NVDA"]);
  assert.equal(payload.raw.stocks[0]?.sector, "Information Technology");
});

test("watcher GET and POST fail before upstream/cache work at the hard threshold", async () => {
  for (const [method, body] of [
    ["POST", { tool: "get_watchlist", params: {} }],
    ["GET", undefined],
  ] as const) {
    const db = new WatcherQuotaD1();
    const day = new Date().toISOString().slice(0, 10);
    db.ledger.set(day, {
      usage_date: day,
      observed_reads: 3_499_999,
      reserved_reads: 0,
      observed_writes: 0,
      reserved_writes: 0,
      updated_at: new Date().toISOString(),
    });
    const response = await stocksWatcherApi({ request: request(method, body), env: { MARKET_CACHE_DB: db } });
    assert.equal(response.status, 502);
    assert.equal(db.queries.filter((query) => query.includes("FROM watcher_daily_usage_ledger")).length, 1);
    assert.equal(db.queries.some((query) => query.includes("INSERT") || query.includes("UPDATE")), false);
    assert.equal(db.queries.some((query) => query.includes("FROM market_cache_entries")), false);
  }
});

test("blocked existing ledger reads one PK row and performs no ledger write or finalize", async () => {
  const db = new WatcherQuotaD1();
  const day = new Date().toISOString().slice(0, 10);
  db.ledger.set(day, {
    usage_date: day,
    observed_reads: 3_500_000,
    reserved_reads: 0,
    observed_writes: 0,
    reserved_writes: 0,
    updated_at: new Date().toISOString(),
  });

  const reservation = await reserveStocksWatcherD1Quota(db, new Date());
  assert.equal(reservation.reserved, false);
  assert.equal(db.queries.length, STOCKS_WATCHER_KNOWN_THRESHOLD_BLOCKED_LEDGER_READ_ROWS);
  assert.match(db.queries[0], /WHERE usage_date = \?/);
  assert.equal(db.queries.some((query) => query.includes("INSERT") || query.includes("UPDATE")), false);
  await reservation.finalize({ rowsRead: 0, rowsWritten: 0 });
  assert.equal(db.queries.length, STOCKS_WATCHER_KNOWN_THRESHOLD_BLOCKED_LEDGER_READ_ROWS);
  assert.equal(STOCKS_WATCHER_BLOCKED_LEDGER_WRITE_ROWS, 0);
});

test("blocked-request read math stays below the remaining D1 headroom", () => {
  assert.equal(STOCKS_WATCHER_D1_READ_HEADROOM_AT_THRESHOLD, 1_500_000);
  assert.equal(STOCKS_WATCHER_FREE_REQUESTS_PER_DAY * STOCKS_WATCHER_BLOCKED_LEDGER_READ_ROWS, 300_000);
  assert.ok(
    STOCKS_WATCHER_FREE_REQUESTS_PER_DAY * STOCKS_WATCHER_BLOCKED_LEDGER_READ_ROWS
      < STOCKS_WATCHER_D1_READ_HEADROOM_AT_THRESHOLD,
  );
});

test("race-loser blocked path accounts three ledger reads without finalize or writes", async () => {
  const db = new WatcherQuotaD1();
  db.forceReserveRaceLoss = true;
  const day = new Date().toISOString().slice(0, 10);
  db.ledger.set(day, {
    usage_date: day,
    observed_reads: 3_500_000 - STOCKS_WATCHER_QUOTA_RESERVE_ROWS_READ - 1,
    reserved_reads: 0,
    observed_writes: 0,
    reserved_writes: 0,
    updated_at: new Date().toISOString(),
  });

  const reservation = await reserveStocksWatcherD1Quota(db, new Date());
  assert.equal(reservation.reserved, false);
  const ledgerQueries = db.queries.filter((query) => query.includes("watcher_daily_usage_ledger"));
  assert.equal(ledgerQueries.length, STOCKS_WATCHER_BLOCKED_LEDGER_READ_ROWS);
  assert.equal(ledgerQueries.filter((query) => query.includes("UPDATE")).length, 1);
  assert.equal(db.queries.some((query) => query.includes("observed_reads = observed_reads +")), false);
  await reservation.finalize({ rowsRead: 0, rowsWritten: 0 });
  assert.equal(db.queries.filter((query) => query.includes("observed_reads = observed_reads +")).length, 0);
  assert.equal(STOCKS_WATCHER_BLOCKED_LEDGER_WRITE_ROWS, 0);
});

test("D1 ledger failures and a missing tracking binding fail closed", async () => {
  const failed = new WatcherQuotaD1();
  failed.failLedger = true;
  const blocked = await stocksWatcherApi({
    request: request("POST", { tool: "get_watchlist", params: {} }),
    env: { MARKET_CACHE_DB: failed },
  });
  assert.equal(blocked.status, 502);
  assert.equal(failed.queries.some((query) => query.includes("FROM market_cache_entries")), false);

  const bypassed = await stocksWatcherApi({
    request: request("POST", { tool: "get_watchlist", params: {} }),
  });
  assert.equal(bypassed.status, 503);
  const payload = await bypassed.json() as { error: string };
  assert.match(payload.error, /MARKET_CACHE_DB is not bound/);
});

test("ledger usage rolls over by UTC date", async () => {
  const db = new WatcherQuotaD1();
  const oldReservation = await reserveStocksWatcherD1Quota(db, new Date("2026-08-10T23:59:59.000Z"));
  await oldReservation.finalize({ rowsRead: 1, rowsWritten: 0 });
  const nextReservation = await reserveStocksWatcherD1Quota(db, new Date("2026-08-11T00:00:00.000Z"));
  await nextReservation.finalize({ rowsRead: 0, rowsWritten: 0 });
  assert.equal(db.ledger.get("2026-08-10")?.reserved_reads, 0);
  assert.equal(db.ledger.get("2026-08-11")?.reserved_reads, 0);
  assert.equal(db.ledger.get("2026-08-11")?.observed_reads, 4);
});

test("conditional reservation prevents concurrent threshold overrun", async () => {
  const db = new WatcherQuotaD1();
  const day = "2026-08-10";
  db.ledger.set(day, {
    usage_date: day,
    observed_reads: 3_500_000 - STOCKS_WATCHER_QUOTA_RESERVE_ROWS_READ - 1,
    reserved_reads: 0,
    observed_writes: 0,
    reserved_writes: 0,
    updated_at: `${day}T00:00:00.000Z`,
  });
  const reservations = await Promise.all([
    reserveStocksWatcherD1Quota(db, new Date(`${day}T12:00:00.000Z`)),
    reserveStocksWatcherD1Quota(db, new Date(`${day}T12:00:01.000Z`)),
  ]);
  assert.equal(reservations.filter((reservation) => reservation.reserved).length, 1);
  assert.equal(reservations.filter((reservation) => !reservation.reserved).length, 1);
  assert.equal(db.ledger.get(day)?.reserved_reads, STOCKS_WATCHER_QUOTA_RESERVE_ROWS_READ);
  const winner = reservations.find((reservation) => reservation.reserved);
  await winner?.finalize({ rowsRead: 1, rowsWritten: 0 });
  assert.equal(db.ledger.get(day)?.reserved_writes, 0);
  assert.equal(STOCKS_WATCHER_QUOTA_RESERVE_ROWS_WRITTEN > 0, true);
});

test("write reservation includes the bounded prune and index amplification", async () => {
  const db = new WatcherQuotaD1();
  const day = "2026-08-10";
  const writeGuard = Math.floor(MARKET_CACHE_D1_DAILY_WRITE_LIMIT * MARKET_CACHE_D1_QUOTA_HARD_THRESHOLD);
  db.ledger.set(day, {
    usage_date: day,
    observed_reads: 0,
    reserved_reads: 0,
    observed_writes: writeGuard - STOCKS_WATCHER_QUOTA_RESERVE_ROWS_WRITTEN - 1,
    reserved_writes: 0,
    updated_at: `${day}T00:00:00.000Z`,
  });
  const reservations = await Promise.all([
    reserveStocksWatcherD1Quota(db, new Date(`${day}T12:00:00.000Z`)),
    reserveStocksWatcherD1Quota(db, new Date(`${day}T12:00:01.000Z`)),
  ]);
  assert.equal(reservations.filter((reservation) => reservation.reserved).length, 1);
  assert.equal(reservations.filter((reservation) => !reservation.reserved).length, 1);
  assert.equal(
    STOCKS_WATCHER_QUOTA_CACHE_READ_RESERVE,
    1 + 1 + 1 + MAX_CACHE_PRUNE_ROWS + MAX_CACHE_PRUNE_ROWS,
  );
  assert.equal(MAX_CACHE_PRUNE_READ_ROWS, MAX_CACHE_PRUNE_ROWS * 2);
  assert.equal(STOCKS_WATCHER_QUOTA_LEDGER_READ_RESERVE, 4);
  assert.equal(STOCKS_WATCHER_QUOTA_RESERVE_ROWS_READ, 107);
  assert.equal(MARKET_CACHE_WRITE_INDEX_AMPLIFICATION, 5);
  assert.equal(STOCKS_WATCHER_QUOTA_CACHE_WRITE_RESERVE, 255);
  assert.equal(
    STOCKS_WATCHER_QUOTA_RESERVE_ROWS_WRITTEN,
    (1 + MAX_CACHE_PRUNE_ROWS) * MARKET_CACHE_WRITE_INDEX_AMPLIFICATION + STOCKS_WATCHER_QUOTA_LEDGER_WRITE_RESERVE,
  );
  assert.equal(STOCKS_WATCHER_QUOTA_RESERVE_ROWS_WRITTEN, 259);
});

test("0012 declares the composite expiry/cache-key prune index", () => {
  const migration = readFileSync(new URL("../migrations/0012_stocks_watcher_tracking.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_market_cache_entries_expiry_cache_key/);
  assert.match(migration, /ON market_cache_entries \(expires_at, cache_key\)/);
  assert.match(migration, /usage_date TEXT PRIMARY KEY/);
});
