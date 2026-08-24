import assert from "node:assert/strict";
import test from "node:test";

import { readFinalSignalPerformance, upsertFinalSignalOutcome } from "../src/lib/spx-recap-d1";

test("finalized outcome scorecard is grouped by action and regime with SPX-proxy 15m metrics", async () => {
  let sql = "";
  let values: unknown[] = [];
  const db = {
    prepare(query: string) {
      sql = query;
      return {
        bind(...bound: unknown[]) { values = bound; return this; },
        async run() { return {}; },
        async first() { return null; },
        async all() {
          return { results: [{
            action: "OPEN_CALL", regime: "TREND_UP", sample_count: 20, success_count: 11,
            average_return_15m: 1.235, average_mae_30m: -2.345, average_mfe_30m: 3.456,
          }] };
        },
      };
    },
  };
  const scorecard = await readFinalSignalPerformance(db as any, "2026-05-25", "2026-08-23");
  assert.deepEqual(values, ["2026-05-25", "2026-08-23"]);
  assert.match(sql, /outcome_status = 'READY'/);
  assert.deepEqual(scorecard, [{
    action: "OPEN_CALL", regime: "TREND_UP", sampleCount: 20, successCount: 11,
    hitRate: 55, averageReturn15m: 1.24, averageMae30m: -2.35, averageMfe30m: 3.46,
  }]);
});

test("opened directional signal is stored as a pending 0DTESPX SPX proxy outcome", async () => {
  let sql = "";
  let values: unknown[] = [];
  const db = {
    prepare(query: string) {
      sql = query;
      return {
        bind(...bound: unknown[]) { values = bound; return this; },
        async run() { return {}; },
        async first() { return null; },
        async all() { return { results: [] }; },
      };
    },
  };
  await upsertFinalSignalOutcome(db as any, {
    runId: "run-1", tradingDate: "2026-08-23", action: "OPEN_PUT", regime: "TREND_DOWN",
    entryAt: "2026-08-23T18:00:00.000Z", entrySpx: 7521, entryZoneLow: 7520, entryZoneHigh: 7522,
  });
  assert.match(sql, /'0dtespx'/);
  assert.equal(values[14], "PENDING");
});
