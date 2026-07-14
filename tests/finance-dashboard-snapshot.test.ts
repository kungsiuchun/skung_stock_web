import assert from "node:assert/strict";
import test from "node:test";
import { buildFinanceDashboardSnapshot } from "../src/lib/finance-dashboard-snapshot";

const agent = {
  success: true,
  reply: "## 即時行情\nAAPL 測試報告\n## 期權鏈分析\n資料\n## 量化策略分析\n資料\n## 綜合分析結論\n資料\n## 交易建議\n資料",
  dashboardDecision: { trend: "bullish", action: "buy", confidence: 70, evidence: ["quote", "options"] },
  steps: [
    { type: "tool_call", tool_name: "get_realtime_quote", tool_result: JSON.stringify({ price: 200, change_pct: 1.5, chart_data: [{ date: "2026-07-14", price: 200, volume: 100 }] }) },
    { type: "tool_call", tool_name: "get_options_chain", tool_result: JSON.stringify({ underlying_price: 200, calls: [{ strike: 200, open_interest: 10 }], puts: [{ strike: 195, open_interest: 5 }] }) },
    {
      type: "tool_call",
      tool_name: "run_algorithmic_strategy",
      tool_result: JSON.stringify({
        signals: [{
          strategyName: "Breakout",
          signal: "買入",
          score: 77,
          reasons: ["收市突破前高"],
          risks: [],
          tradeSetup: {
            actionability: "EXECUTABLE",
            nextStep: "按觸發價進場",
            entryType: "BREAKOUT_TRIGGER",
            triggerPrice: 199,
            stopLoss: 190,
            target1: 219,
            target2: 230,
            rewardRisk: 2.9,
            optionsStatus: "PENDING",
          },
        }],
      }),
    },
  ],
};

test("finance dashboard snapshot produces the frontend contract from backend-only responses", () => {
  const snapshot = buildFinanceDashboardSnapshot({
    symbol: "aapl",
    agent,
    news: { news: [{ title: "Headline", source: "Yahoo Finance", link: "https://example.test" }] },
    vix: { value: 17 },
    fundamentals: { symbol: "AAPL" },
    technical: { symbol: "AAPL" },
    sentiment: { score: 64, sourceLabel: "Market proxy" },
  });

  assert.equal(snapshot.data.symbol, "AAPL");
  assert.equal(snapshot.data.price, 200);
  assert.equal(snapshot.data.algoRating, 77);
  assert.equal(snapshot.data.recommendedTrade?.name, "Breakout");
  assert.equal(snapshot.data.strategyPoints.entry, 199);
  assert.equal(snapshot.data.optionsFlow?.totalCallOI, 10);
  assert.equal((snapshot.vixData as { value: number }).value, 17);
});

test("finance dashboard snapshot chooses the executable plan instead of signals[0]", () => {
  const snapshot = buildFinanceDashboardSnapshot({
    symbol: "AAPL",
    agent: {
      ...agent,
      steps: [
        { type: "tool_call", tool_name: "get_realtime_quote", tool_result: JSON.stringify({ price: 200, change_pct: 1.5 }) },
        { type: "tool_call", tool_name: "get_options_chain", tool_result: JSON.stringify({ underlying_price: 200, calls: [{ strike: 200, open_interest: 10 }], puts: [{ strike: 195, open_interest: 5 }] }) },
        {
          type: "tool_call",
          tool_name: "run_algorithmic_strategy",
          tool_result: JSON.stringify({
            signals: [
              { strategyName: "High Score Watch", score: 99, signal: "觀望", reasons: [], risks: [], tradeSetup: { actionability: "PENDING_TRIGGER", nextStep: "等待 205 突破", triggerPrice: 205, optionsStatus: "PENDING" } },
              { strategyName: "Executable", score: 71, signal: "買入", reasons: [], risks: [], tradeSetup: { actionability: "EXECUTABLE", nextStep: "按觸發價", entryType: "BREAKOUT_TRIGGER", triggerPrice: 201, stopLoss: 195, target1: 215, target2: 225, rewardRisk: 2.33, optionsStatus: "PENDING" } },
            ],
          }),
        },
      ],
    },
    news: {}, vix: null, fundamentals: null, technical: null, sentiment: null,
  });
  assert.equal(snapshot.data.recommendedTrade?.name, "Executable");
  assert.equal(snapshot.data.strategyPoints.entry, 201);
  assert.equal(snapshot.data.algoRating, 71);
});

test("finance dashboard snapshot fails closed when the agent fails", () => {
  assert.throws(
    () => buildFinanceDashboardSnapshot({
      symbol: "AAPL",
      agent: { success: false, error: "OpenRouter unavailable" },
      news: {}, vix: null, fundamentals: null, technical: null, sentiment: null,
    }),
    /OpenRouter unavailable/,
  );
});

test("finance dashboard snapshot uses only real open interest and returns twelve nearby strikes", () => {
  const calls = Array.from({ length: 14 }, (_, index) => ({ strike: 193 + index, openInterest: 100 + index }));
  const puts = Array.from({ length: 14 }, (_, index) => ({ strike: 193 + index, open_interest: 200 + index }));
  const snapshot = buildFinanceDashboardSnapshot({
    symbol: "SOFI",
    agent: {
      success: true,
      steps: [{
        type: "tool_call",
        tool_name: "get_options_chain",
        tool_result: JSON.stringify({ underlying_price: 200, calls, puts }),
      }],
    },
    news: {}, vix: null, fundamentals: null, technical: null, sentiment: null,
  });

  assert.equal(snapshot.data.optionsFlow?.topStrikes.length, 12);
  assert.equal(snapshot.data.optionsFlow?.totalCallOI, 1491);
  assert.equal(snapshot.data.optionsFlow?.totalPutOI, 2891);
  assert.ok(snapshot.data.optionsFlow?.topStrikes.every((row) => row.callOI + row.putOI > 0));
});

test("finance dashboard snapshot refuses to substitute option volume for missing open interest", () => {
  const snapshot = buildFinanceDashboardSnapshot({
    symbol: "SOFI",
    agent: {
      success: true,
      steps: [{
        type: "tool_call",
        tool_name: "get_options_chain",
        tool_result: JSON.stringify({ underlying_price: 18, calls: [{ strike: 18, volume: 999 }], puts: [{ strike: 18, volume: 888 }] }),
      }],
    },
    news: {}, vix: null, fundamentals: null, technical: null, sentiment: null,
  });

  assert.match(snapshot.data.optionsFlow?.error || "", /Yahoo/);
  assert.deepEqual(snapshot.data.optionsFlow?.topStrikes, []);
});
