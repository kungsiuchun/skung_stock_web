import assert from "node:assert/strict";
import test from "node:test";

import {
  DASHBOARD_AGENT_TOOL_NAMES,
  FINANCE_ANALYZER_MODEL_CALL_BUDGETS,
  normalizeQuantStrategiesFromAgentResponse,
} from "../src/lib/finance-analyzer-contract";

test("dashboard model budget stays narrower than chat and committee flows", () => {
  assert.equal(FINANCE_ANALYZER_MODEL_CALL_BUDGETS.dashboard.maxOpenRouterCalls, 6);
  assert.equal(FINANCE_ANALYZER_MODEL_CALL_BUDGETS.chat.maxOpenRouterCalls, 10);
  assert.equal(FINANCE_ANALYZER_MODEL_CALL_BUDGETS.committee.maxOpenRouterCalls, 25);
});

test("dashboard tool contract excludes broad chat-only tools", () => {
  assert.deepEqual([...DASHBOARD_AGENT_TOOL_NAMES], [
    "get_realtime_quote",
    "get_options_chain",
    "run_algorithmic_strategy",
    "get_financial_signals",
  ]);
  assert.equal(DASHBOARD_AGENT_TOOL_NAMES.includes("delegate_task" as any), false);
  assert.equal(DASHBOARD_AGENT_TOOL_NAMES.includes("get_retail_sentiment" as any), false);
  assert.equal(DASHBOARD_AGENT_TOOL_NAMES.includes("search_fred_series" as any), false);
});

test("quant strategy normalization uses deterministic tool output", () => {
  const strategies = normalizeQuantStrategiesFromAgentResponse({
    steps: [
      {
        type: "tool_call",
        tool_name: "run_algorithmic_strategy",
        tool_result: JSON.stringify({
          signals: [
            { displayName: "Volume Breakout", score: 72 },
            { name: "Mean Reversion", score: 41 },
          ],
        }),
      },
    ],
  });

  assert.deepEqual(strategies, [
    { name: "Volume Breakout", score: 72 },
    { name: "Mean Reversion", score: 41 },
  ]);
});

test("quant strategy normalization does not invent mock fallback values", () => {
  assert.deepEqual(normalizeQuantStrategiesFromAgentResponse({ steps: [] }), []);
  assert.deepEqual(
    normalizeQuantStrategiesFromAgentResponse({
      steps: [{ type: "tool_call", tool_name: "run_algorithmic_strategy", tool_result: "{broken" }],
    }),
    [],
  );
});
