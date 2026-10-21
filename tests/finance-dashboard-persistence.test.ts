import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStoredDashboardData, sanitizeDashboardHistory } from "../src/lib/finance-dashboard-persistence";

test("Dashboard persistence removes legacy DeepEar payloads without deleting the history entry", () => {
  const history = sanitizeDashboardHistory([{ symbol: "SPY", timestamp: "10:00", score: 50, fullData: { financialSignals: { stale: true } } }]);
  assert.deepEqual(history, [{ symbol: "SPY", timestamp: "10:00", score: 50, fullData: undefined }]);
});

test("Dashboard persistence detects the preserved legacy DeepEar marker with a non-breaking space", () => {
  const history = sanitizeDashboardHistory([{ symbol: "SPY", timestamp: "10:00", score: 50, fullData: { finalAnalysis: "é«˜é\u00a0»" } }]);
  assert.deepEqual(history, [{ symbol: "SPY", timestamp: "10:00", score: 50, fullData: undefined }]);
});

test("Dashboard persistence also rejects the original Chinese legacy marker", () => {
  const history = sanitizeDashboardHistory([{ symbol: "SPY", timestamp: "10:00", score: 50, fullData: { finalAnalysis: "高頻訊號" } }]);
  assert.deepEqual(history, [{ symbol: "SPY", timestamp: "10:00", score: 50, fullData: undefined }]);
});

const validData = {
  symbol: "SPY", price: 500, change: "+1.00%", algoRating: 50, marketSentiment: null,
  strategyPoints: {}, news: [], chartData: [], quantStrategies: [], quantStrategySchemaVersion: "v3",
};

test("Stored dashboard data rejects malformed render fields without manufacturing values", () => {
  assert.equal(normalizeStoredDashboardData(validData)?.price, 500);
  for (const patch of [{ price: null }, { price: "500" }, { change: {} }, { news: [null] }, { chartData: [{}] }, { optionsFlow: { topStrikes: [null] } }, { sentimentData: { components: {} } }, { strategyPoints: { entry: "10" } }, { quantStrategies: "bad" }, { quantStrategies: [{}] }, { dashboardNarrative: { status: "unavailable", reason: {} } }]) {
    assert.equal(normalizeStoredDashboardData({ ...validData, ...patch }), null, JSON.stringify(patch));
  }
  assert.equal(normalizeStoredDashboardData({}), null);
});

test("History keeps valid metadata but never restores malformed or mismatched results", () => {
  const metadata = { symbol: "SPY", timestamp: "10:00", score: 50 };
  const history = sanitizeDashboardHistory([
    { ...metadata, symbol: {} }, { ...metadata, score: {} }, { ...metadata, timestamp: null },
    { ...metadata, fullData: {} }, { ...metadata, fullData: { ...validData, symbol: "NVDA" } },
  ]);
  assert.deepEqual(history, [{ ...metadata, fullData: undefined }, { ...metadata, fullData: undefined }]);
});

test("An available narrative cannot smuggle an object reason into unavailable rendering", () => {
  assert.equal(normalizeStoredDashboardData({ ...validData, finalAnalysis: "", dashboardNarrative: { status: "available", reason: { corrupt: true } } }), null);
});

test("Restored charts require real, unique and ascending effective chart dates", () => {
  const point = (date_iso: string) => ({ date: date_iso, date_iso, price: 500, volume: 100 });
  for (const chartData of [[point("invalid")], [point("2026-02-30")], [point("2026-10-19"), point("2026-10-19")],
    [point("2026-10-20"), point("2026-10-19")], [{ ...point("2026-10-19"), time: "invalid" }]]) {
    assert.equal(normalizeStoredDashboardData({ ...validData, chartData }), null);
  }
  const chartData = [point("2026-10-19"), point("2026-10-20")];
  assert.deepEqual(normalizeStoredDashboardData({ ...validData, chartData })?.chartData, chartData);
});

test("Restored trade setup prices never coerce booleans or numeric strings into executable levels", () => {
  const strategy = { name: "Fixture", signal: "buy", score: 70, reasons: [], risks: [], tradeSetup: {
    actionability: "EXECUTABLE", entryType: "LIMIT_ZONE", entryLow: 1, entryHigh: 1,
    stopLoss: 0.5, target1: 2, rewardRisk: 2, nextStep: "fixture", optionsStatus: "AVAILABLE",
  } };
  for (const value of [true, "1"]) {
    assert.equal(normalizeStoredDashboardData({ ...validData, quantStrategies: [{ ...strategy, tradeSetup: { ...strategy.tradeSetup, entryLow: value, entryHigh: value } }] }), null);
    assert.equal(normalizeStoredDashboardData({ ...validData, quantStrategies: [{ ...strategy, entry: value }] }), null);
  }
  assert.equal(normalizeStoredDashboardData({ ...validData, quantStrategies: [strategy] })?.recommendedTrade?.entry, 1);
});
