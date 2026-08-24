import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeDashboardHistory } from "../src/lib/finance-dashboard-persistence";

test("Dashboard persistence removes legacy DeepEar payloads without deleting the history entry", () => {
  const history = sanitizeDashboardHistory([{ symbol: "SPY", timestamp: "10:00", score: 50, fullData: { financialSignals: { stale: true } } }]);
  assert.deepEqual(history, [{ symbol: "SPY", timestamp: "10:00", score: 50, fullData: undefined }]);
});

test("Dashboard persistence detects the preserved legacy DeepEar marker with a non-breaking space", () => {
  const history = sanitizeDashboardHistory([{ symbol: "SPY", timestamp: "10:00", score: 50, fullData: { finalAnalysis: "é«˜é\u00a0»" } }]);
  assert.deepEqual(history, [{ symbol: "SPY", timestamp: "10:00", score: 50, fullData: undefined }]);
});
