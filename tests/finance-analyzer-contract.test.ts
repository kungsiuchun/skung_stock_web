import assert from "node:assert/strict";
import test from "node:test";

import {
  DASHBOARD_AGENT_TOOL_NAMES,
  FINANCE_ANALYZER_MODEL_CALL_BUDGETS,
  applyOptionConstraints,
  normalizeQuantStrategiesFromAgentResponse,
  selectRecommendedQuantTrade,
  selectTopQuantStrategies,
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
    "record_dashboard_decision",
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
            {
              displayName: "Volume Breakout",
              signal: "強烈買入",
              score: 72,
              reasons: ["量比突破 1.8"],
              risks: ["留意假突破"],
              entry: 100,
              stopLoss: 95,
              target: 115,
              tradeSetup: {
                actionability: "EXECUTABLE",
                nextStep: "按觸發價進場",
                entryType: "LIMIT_ZONE",
                entryHigh: 100,
                stopLoss: 95,
                target1: 115,
                rewardRisk: 3,
                optionsStatus: "PENDING",
              },
            },
            { name: "Mean Reversion", signal: "觀望", score: 41, reasons: ["未到回歸區"], risks: [] },
          ],
        }),
      },
    ],
  });

  assert.equal(strategies.length, 2);
  assert.equal(strategies[0].tradeSetup.actionability, "EXECUTABLE");
  assert.equal(strategies[0].tradeSetup.rewardRisk, 3);
  assert.equal(strategies[0].entry, 100);
  assert.equal(strategies[1].tradeSetup.actionability, "PENDING_TRIGGER");
  assert.match(strategies[1].tradeSetup.nextStep, /舊快取/);
});

test("quant strategy normalization drops malformed items without inventing insights", () => {
  const strategies = normalizeQuantStrategiesFromAgentResponse({
    quant_strategies: [
      { name: "Valid", score: 50, reasons: [" kept ", 12], risks: ["risk"] },
      { name: "Broken", score: "not-a-number", reasons: ["fake"] },
    ],
  });

  assert.equal(strategies.length, 1);
  assert.deepEqual(strategies[0].reasons, ["kept"]);
  assert.equal(strategies[0].tradeSetup.actionability, "PENDING_TRIGGER");
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

test("quant strategy presentation selects the first five without reordering", () => {
  const strategies = Array.from({ length: 11 }, (_, index) => ({
    name: `Strategy ${index + 1}`,
    signal: "觀望",
    score: 100 - index,
    reasons: [],
    risks: [],
    tradeSetup: { actionability: "PENDING_TRIGGER" as const, nextStep: "等待", optionsStatus: "PENDING" as const },
  }));

  assert.deepEqual(selectTopQuantStrategies(strategies), strategies.slice(0, 5));
  assert.deepEqual(selectTopQuantStrategies(strategies.slice(0, 3)), strategies.slice(0, 3));
  assert.deepEqual(selectTopQuantStrategies(strategies, 0), []);
});

test("option walls can veto an otherwise executable trade and recommended trade ignores non-executable scores", () => {
  const strategies = normalizeQuantStrategiesFromAgentResponse({
    quant_strategies: [
      { name: "High score watch", score: 99, signal: "觀望", reasons: [], risks: [], tradeSetup: { actionability: "PENDING_TRIGGER", nextStep: "等待突破", triggerPrice: 102, optionsStatus: "PENDING" } },
      { name: "Breakout", score: 70, signal: "買入", reasons: [], risks: [], tradeSetup: { actionability: "EXECUTABLE", nextStep: "突破入場", entryType: "BREAKOUT_TRIGGER", triggerPrice: 100, stopLoss: 95, target1: 115, target2: 120, rewardRisk: 3, atr14: 2, optionsStatus: "PENDING" } },
    ],
  });
  assert.equal(selectRecommendedQuantTrade(strategies)?.name, "Breakout");

  const constrained = applyOptionConstraints(strategies, { status: "AVAILABLE", putWall: 98, callWall: 108 });
  const breakout = constrained.find((strategy) => strategy.name === "Breakout");
  assert.equal(breakout?.tradeSetup.actionability, "PENDING_TRIGGER");
  assert.equal(breakout?.entry, undefined);
  assert.match(breakout?.tradeSetup.nextStep || "", /call OI/);
  assert.equal(selectRecommendedQuantTrade(constrained), null);
});
