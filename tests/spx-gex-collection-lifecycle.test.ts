import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  D1SpxGexCollectionStore,
  getExpectedSpxGexCollectionSlots,
  summarizeSpxGexCollectionCoverage,
  validateSpxGexCollectionTransition,
} from "../src/lib/spx-gex-collection-lifecycle";
import type { D1DatabaseLike } from "../src/lib/spx-recap-d1";

test("a recovered collection keeps its allocated attempt through normalization and persistence", async () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("../migrations/0008_spx_gex_collection_lifecycle.sql", import.meta.url), "utf8"));
  const db: D1DatabaseLike = { prepare(query) {
    const statement = sql.prepare(query); let values: any[] = [];
    const prepared = {
      bind(...params: unknown[]) { values = params; return prepared; },
      async first<T>() { return (statement.get(...values) || null) as T | null; },
      async all<T>() { return { results: statement.all(...values) as T[] }; },
      async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
    }; return prepared;
  } };
  const store = new D1SpxGexCollectionStore(db);
  const at = "2026-11-16T14:45:00Z";
  try {
    await store.scheduleDate("2026-11-16", at);
    await store.appendStage("2026-11-16:570", "FAILED", { error: "GEX_COLLECTION_FAILED" }, at, 1);
    for (const stage of ["FETCHED", "NORMALIZED", "PERSISTED"] as const) await store.appendStage("2026-11-16:570", stage, {}, at, 1);
    const attempts = await store.listAttemptsForDate("2026-11-16");
    assert.deepEqual(attempts.map(({ attempt, status }) => ({ attempt, status })), [{ attempt: 1, status: "FAILED" }, { attempt: 2, status: "ACCEPTED" }]);
  } finally { sql.close(); }
});

test("collection attempts retain provider diagnostics when normalized cell counts arrive later", async () => {
  const rows = [
    { slot_id: "2026-11-16:570", snapshot_minute_et: 570, stage: "FETCHED", attempt: 1, occurred_at: "2026-11-16T14:45:00Z", payload_json: JSON.stringify({ collectionQuality: { rawLegCount: 960, sourceTimestamp: "2026-11-16T14:44:00Z", cacheStatus: "miss" } }) },
    { slot_id: "2026-11-16:570", snapshot_minute_et: 570, stage: "PERSISTED", attempt: 1, occurred_at: "2026-11-16T14:45:11Z", payload_json: JSON.stringify({ collectionQuality: { pricedCellCount: 18, repairedCellCount: 0, partialCellCount: 1, unpricedCellCount: 461 } }) },
  ];
  const statement = { bind: () => statement, all: async () => ({ results: rows }) };
  const store = new D1SpxGexCollectionStore({ prepare: () => statement } as unknown as D1DatabaseLike);
  const [attempt] = await store.listAttemptsForDate("2026-11-16");
  assert.equal(attempt.quality?.rawLegCount, 960);
  assert.equal(attempt.quality?.pricedCellCount, 18);
  assert.equal(attempt.quality?.sourceTimestamp, "2026-11-16T14:44:00Z");
});

test("2026-07-13 lifecycle query exposes the eight missing Board slots", () => {
  const expected = getExpectedSpxGexCollectionSlots("2026-07-13");
  const persistedMinutes = [570, 585, 600, 615, 645, 660, 675, 720, 750, 765, 780, 795, 810, 825, 840, 855, 870, 885, 930];
  const records = persistedMinutes.map((snapshotMinuteEt) => ({
    slotId: `2026-07-13:${snapshotMinuteEt}`,
    tradingDate: "2026-07-13",
    snapshotMinuteEt,
    collectedMinuteEt: snapshotMinuteEt + 15,
    currentStage: "PERSISTED" as const,
    snapshotId: `snapshot-${snapshotMinuteEt}`,
    payloadHash: `hash-${snapshotMinuteEt}`,
    provider: "cboe",
    fallbackFrom: null,
    error: null,
    updatedAt: "2026-07-13T20:15:00.000Z",
  }));

  const coverage = summarizeSpxGexCollectionCoverage(expected, records, 16 * 60 + 15);

  assert.equal(expected.length, 27);
  assert.equal(expected[0]?.snapshotMinuteEt, 570);
  assert.equal(expected.at(-1)?.snapshotMinuteEt, 960);
  assert.deepEqual(coverage.missingSnapshotMinutesEt, [630, 690, 705, 735, 900, 915, 945, 960]);
  assert.equal(coverage.persistedCount, 19);
});

test("GEX collection lifecycle is monotonic and failure is explicit", () => {
  assert.equal(validateSpxGexCollectionTransition("SCHEDULED", "FETCHED"), true);
  assert.equal(validateSpxGexCollectionTransition("FETCHED", "NORMALIZED"), true);
  assert.equal(validateSpxGexCollectionTransition("NORMALIZED", "PERSISTED"), true);
  assert.equal(validateSpxGexCollectionTransition("FETCHED", "FAILED"), true);
  assert.equal(validateSpxGexCollectionTransition("PERSISTED", "FETCHED"), false);
});
