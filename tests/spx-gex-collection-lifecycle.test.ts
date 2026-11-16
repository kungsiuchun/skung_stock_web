import assert from "node:assert/strict";
import test from "node:test";

import {
  D1SpxGexCollectionStore,
  getExpectedSpxGexCollectionSlots,
  summarizeSpxGexCollectionCoverage,
  validateSpxGexCollectionTransition,
} from "../src/lib/spx-gex-collection-lifecycle";
import type { D1DatabaseLike } from "../src/lib/spx-recap-d1";

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
