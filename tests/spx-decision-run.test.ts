import assert from "node:assert/strict";
import test from "node:test";
import { runSpxDecisionRun } from "../src/lib/spx-decision-run";
import { buildSpxMarketSnapshot } from "../src/lib/spx-market-snapshot";

test("SPX Decision Run skips outside the trading window without invoking the execution adapter", async () => {
  const result = await runSpxDecisionRun({
    isTradingWindow: false,
    skipReason: "outside_trading_window",
  });

  assert.deepEqual(result, { status: "SKIPPED", runId: null, failureCode: null });
});

test("SPX Decision Run delegates the scheduled execution and preserves its traceable terminal result", async () => {
  const expected = { status: "SUCCEEDED" as const, runId: "2026-07-27-123", failureCode: null };

  const result = await runSpxDecisionRun({
    isTradingWindow: true,
    skipReason: null,
    execute: async () => expected,
  });

  assert.equal(result, expected);
});

test("SPX market snapshot exposes stale canonical GEX as a fail-closed freshness signal", () => {
  const snapshot = buildSpxMarketSnapshot({
    runId: "run-1",
    scheduledAt: new Date("2026-07-27T14:45:00.000Z"),
    snapshotAt: new Date("2026-07-27T15:30:01.000Z"),
    spxLatestAt: new Date("2026-07-27T15:25:00.000Z"),
    spxM5LatestAt: new Date("2026-07-27T15:25:00.000Z"),
    vixLatestAt: new Date("2026-07-27T15:25:00.000Z"),
    gexSnapshotAt: "2026-07-27T14:45:00.000Z",
    gexProvider: "CBOE",
    gexFallbackFrom: null,
    dataQuality: { overallStatus: "OK", hardBlocks: [], warnings: [] },
    facts: {},
    boardDeepLink: null,
    replayEvidence: { replayGrade: "UNAVAILABLE", vendorRawPayloadsPersisted: false, gex: null, normalizedSeries: {} },
  });

  assert.equal(snapshot.sourceFreshness.canonicalGex?.status, "STALE");
  assert.equal(snapshot.rawSnapshotAvailable, false);
});
