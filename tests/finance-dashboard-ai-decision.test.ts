import assert from "node:assert/strict";
import test from "node:test";

import {
  DASHBOARD_DECISION_TOOL_NAME,
  deriveDashboardDecisionFromAgentSteps,
  formatDashboardAction,
  formatDashboardTrend,
  normalizeDashboardDecision,
  validateDashboardDecision,
} from "../src/lib/finance-dashboard-ai-decision";

const requiredSteps = () => [
  { type: "tool_call", tool_name: "get_realtime_quote", tool_result: JSON.stringify({ price: 100 }) },
  { type: "tool_call", tool_name: "get_options_chain", tool_result: JSON.stringify({ calls: [], puts: [] }) },
  { type: "tool_call", tool_name: "run_algorithmic_strategy", tool_result: JSON.stringify({ signals: [] }) },
];

const validDecision = {
  trend: "bullish",
  action: "buy",
  rationale: "量化策略與即時價格支持偏多，但期權持倉仍需持續監察。",
  evidence: [
    { source: "quote", fact: "即時價格維持在當日反彈區間。" },
    { source: "quant", fact: "量化策略最高分為 80，支持偏多結構。" },
  ],
};

test("accepts a structured AI dashboard decision with traceable evidence", () => {
  const decision = deriveDashboardDecisionFromAgentSteps([
    ...requiredSteps(),
    {
      type: "tool_call",
      tool_name: DASHBOARD_DECISION_TOOL_NAME,
      tool_result: JSON.stringify({ status: "recorded", decision: validDecision }),
    },
  ]);

  assert.deepEqual(decision, { status: "available", ...validDecision });
});

test("fails closed when a required source tool is absent or errors", () => {
  const missing = deriveDashboardDecisionFromAgentSteps([]);
  assert.equal(missing.status, "unavailable");
  if (missing.status === "unavailable") assert.match(missing.reason, /get_realtime_quote/);

  const failed = deriveDashboardDecisionFromAgentSteps([
    { type: "tool_call", tool_name: "get_realtime_quote", tool_result: JSON.stringify({ error: "upstream unavailable" }) },
    ...requiredSteps().slice(1),
  ]);
  assert.equal(failed.status, "unavailable");
  if (failed.status === "unavailable") assert.match(failed.reason, /get_realtime_quote/);
});

test("fails closed for absent or invalid AI decision payloads", () => {
  const missing = deriveDashboardDecisionFromAgentSteps(requiredSteps());
  assert.equal(missing.status, "unavailable");

  const badEnum = validateDashboardDecision({ ...validDecision, trend: "sideways" });
  assert.equal(badEnum.status, "unavailable");

  const badEvidence = validateDashboardDecision({ ...validDecision, evidence: [] });
  assert.equal(badEvidence.status, "unavailable");
});

test("client normalization never invents a trend or action fallback", () => {
  const unavailable = normalizeDashboardDecision(null);
  assert.deepEqual(unavailable, {
    status: "unavailable",
    reason: "Dashboard decision was not returned by the API.",
  });
  assert.equal(formatDashboardTrend("range"), "區間");
  assert.equal(formatDashboardAction("wait"), "觀望");
});
