import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  runSpxRetention,
  SPX_KV_RETENTION_SECONDS,
  SPX_RAW_RETENTION_DAYS,
  SPX_RECAP_RETENTION_DAYS,
} from "../src/lib/spx-retention";

test("SPX retention migration removes only lifecycle delete blocks and creates the finalized proxy ledger", () => {
  const migration = readFileSync(join(process.cwd(), "migrations", "0014_spx_recap_retention_and_outcomes.sql"), "utf8");
  assert.match(migration, /DROP TRIGGER IF EXISTS trg_spx_run_lifecycle_events_no_delete/);
  assert.match(migration, /DROP TRIGGER IF EXISTS trg_spx_gex_collection_events_no_delete/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS spx_final_signal_outcomes/);
  assert.match(migration, /source TEXT NOT NULL CHECK \(source = '0dtespx'\)/);
  assert.doesNotMatch(migration, /DROP TRIGGER IF EXISTS .*no_update/);
});

test("SPX retention uses 30/90 day tiers, bounded delete batches, and records one audit", async () => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const query = { sql, values: [] as unknown[] };
      queries.push(query);
      return {
        bind(...values: unknown[]) { query.values = values; return this; },
        async run() { return { meta: { changes: 1 } }; },
        async first<T>() { return { count: 0 } as T; },
        async all<T>() { return { results: [] as T[] }; },
      };
    },
  };
  const result = await runSpxRetention(db as any, new Date("2026-08-23T20:00:00.000Z"));

  assert.equal(SPX_RAW_RETENTION_DAYS, 30);
  assert.equal(SPX_RECAP_RETENTION_DAYS, 90);
  assert.equal(SPX_KV_RETENTION_SECONDS, 91 * 24 * 60 * 60);
  assert.equal(result.rawCutoff, "2026-07-24T20:00:00.000Z");
  assert.equal(result.recapCutoff, "2026-05-25");
  assert.equal(queries.filter(({ sql }) => /DELETE FROM/.test(sql)).length, 8);
  assert.ok(queries.some(({ sql }) => /INSERT INTO spx_retention_audit/.test(sql)));
  assert.ok(queries.filter(({ sql }) => /DELETE FROM/.test(sql)).every(({ sql }) => /LIMIT \?/.test(sql)));
});
