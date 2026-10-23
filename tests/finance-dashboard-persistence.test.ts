import assert from "node:assert/strict";
import test from "node:test";
import { loadDashboardPersistence, normalizeStoredDashboardData, sanitizeDashboardHistory } from "../src/lib/finance-dashboard-persistence";
import { applyDashboardSnapshot, EMPTY_DASHBOARD_SNAPSHOT_STATE } from "../src/lib/finance-dashboard-state";
import { buildFinanceDashboardSnapshot } from "../src/lib/finance-dashboard-snapshot";
import { writeBrowserJson } from "../src/lib/browser-storage";

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
  for (const patch of [{ price: null }, { price: null, quoteStatus: "unavailable", change: "+1.00%" }, { price: "500" }, { change: {} }, { news: [null] }, { chartData: [{}] }, { optionsFlow: { topStrikes: [null] } }, { sentimentData: { components: {} } }, { strategyPoints: { entry: "10" } }, { quantStrategies: "bad" }, { quantStrategies: [{}] }, { dashboardNarrative: { status: "unavailable", reason: {} } }]) {
    assert.equal(normalizeStoredDashboardData({ ...validData, ...patch }), null, JSON.stringify(patch));
  }
  assert.equal(normalizeStoredDashboardData({}), null);
});

test("mapped unavailable snapshots survive active and history persistence", () => {
  const snapshot = buildFinanceDashboardSnapshot({
    symbol: "AAPL",
    agent: {
      success: true,
      steps: [
        { type: "tool_call", tool_name: "get_realtime_quote", tool_result: JSON.stringify({ price: null, change_pct: null, quote_status: "unavailable", source_as_of: null }) },
        { type: "tool_call", tool_name: "run_algorithmic_strategy", tool_result: JSON.stringify({
          partial: true,
          rejected_bar_count: 2,
          last_valid_date: "2026-10-20",
          chart_data: [{ date: "Oct 20", date_iso: "2026-10-20", price: 100, open: 99, high: 101, low: 98, volume: 1_000 }],
        }) },
      ],
    },
    news: {}, vix: null, fundamentals: null, technical: null, sentiment: null,
  });
  const state = applyDashboardSnapshot(
    EMPTY_DASHBOARD_SNAPSHOT_STATE,
    snapshot,
    {} as Parameters<typeof applyDashboardSnapshot>[2],
    "AAPL",
    "10:00",
  );
  const previousWindow = globalThis.window;
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    } },
  });
  try {
    assert.equal(writeBrowserJson("finance_dashboard_active_data", state.activeData), null);
    assert.equal(writeBrowserJson("finance_dashboard_history", state.history), null);
    const restored = loadDashboardPersistence();
    assert.equal(restored.activeData?.price, null);
    assert.equal(restored.activeData?.quoteStatus, "unavailable");
    assert.equal(restored.activeData?.change, "未提供");
    assert.equal(restored.activeData?.chartDataLastValidDate, "2026-10-20");
    assert.equal(restored.activeData?.chartDataRejectedCount, 2);
    assert.equal(restored.activeData?.chartDataPartial, true);
    assert.equal(restored.history[0].fullData?.price, null);
    assert.equal(restored.history[0].fullData?.chartDataLastValidDate, "2026-10-20");
    assert.equal(restored.warnings.active, null);
    assert.equal(restored.warnings.history, null);
  } finally {
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
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
  const point = (date_iso: string) => ({ date: date_iso, date_iso, price: 500, open: 495, high: 505, low: 490, volume: 100 });
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
