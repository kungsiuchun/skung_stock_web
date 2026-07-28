import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDashboardSnapshot,
  beginDashboardAnalysis,
  completeDashboardAnalysis,
  EMPTY_DASHBOARD_SNAPSHOT_STATE,
  failDashboardAnalysis,
} from "../src/lib/finance-dashboard-state";

test("Dashboard snapshot state exposes loading, failure, and completion transitions", () => {
  const loading = beginDashboardAnalysis({ ...EMPTY_DASHBOARD_SNAPSHOT_STATE, activeData: { algoRating: 50 } as any });
  assert.equal(loading.activeData, null);
  assert.equal(loading.loading, true);
  assert.equal(loading.loadingPhase, "market");

  const failed = failDashboardAnalysis(loading, "source timeout");
  assert.deepEqual({ loading: failed.loading, loadingPhase: failed.loadingPhase, error: failed.error }, {
    loading: false, loadingPhase: null, error: "source timeout",
  });
  assert.deepEqual(completeDashboardAnalysis(loading), { ...loading, loading: false, loadingPhase: null });
});

test("Dashboard snapshot state updates related market payloads atomically and deduplicates history", () => {
  const data = { algoRating: 78 } as any;
  const prior = {
    ...EMPTY_DASHBOARD_SNAPSHOT_STATE,
    history: [
      { symbol: "AAPL", timestamp: "09:00", score: 50 },
      { symbol: "TSLA", timestamp: "09:01", score: 60 },
    ],
  };

  const result = applyDashboardSnapshot(
    prior,
    { data, vixData: { value: 18 }, valuationData: { pe: 20 }, technicalData: { rsi: 52 } },
    { status: "miss" } as any,
    "aapl",
    "10:00",
  );

  assert.equal(result.activeData, data);
  assert.deepEqual(result.cache, { status: "miss" });
  assert.deepEqual(result.vixData, { value: 18 });
  assert.deepEqual(result.history, [
    { symbol: "AAPL", timestamp: "10:00", score: 78, fullData: data },
    { symbol: "TSLA", timestamp: "09:01", score: 60 },
  ]);
});
