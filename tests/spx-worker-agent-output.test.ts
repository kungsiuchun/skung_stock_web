import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAgentResponseContent,
  parseOrchestratorResponseContent,
} from "../scripts/worker-spx-bot";

const forbiddenVisibleFragments = [
  "{",
  "}",
  '"decision"',
  '"reasoning"',
  "```",
  "analysis failed",
  "parse failed",
];

function assertCleanVisibleReasoning(text: string) {
  for (const fragment of forbiddenVisibleFragments) {
    assert.equal(text.toLowerCase().includes(fragment), false, `visible reasoning leaked ${fragment}`);
  }
  assert.equal(/^\s*[)\]}]/.test(text), false, "visible reasoning starts with parser debris");
  assert.equal(/[{"}\])]\s*$/.test(text), false, "visible reasoning ends with parser debris");
}

test("agent output parser preserves prose instead of showing analysis failure", () => {
  const parsed = parseAgentResponseContent("BB Squeeze is active, volume is not confirming, stand down.");

  assert.equal(parsed.decision, "HOLD");
  assert.match(parsed.reasoning, /BB Squeeze/);
  assert.notEqual(parsed.reasoning.toLowerCase(), "analysis failed");
  assert.notEqual(parsed.analysis.toLowerCase(), "parse failed");
  assertCleanVisibleReasoning(parsed.reasoning);
});

test("agent output parser accepts valid JSON", () => {
  const parsed = parseAgentResponseContent('{"decision":"SELL","reasoning":"Volatility risk is rising; defend first."}');

  assert.equal(parsed.decision, "SELL");
  assert.equal(parsed.reasoning, "Volatility risk is rising; defend first.");
  assertCleanVisibleReasoning(parsed.reasoning);
});

test("agent output parser accepts fenced JSON", () => {
  const parsed = parseAgentResponseContent('```json\n{"decision":"SELL","reasoning":"Volatility risk is rising; defend first."}\n```');

  assert.equal(parsed.decision, "SELL");
  assert.equal(parsed.reasoning, "Volatility risk is rising; defend first.");
  assertCleanVisibleReasoning(parsed.reasoning);
});

test("agent output parser cleans screenshot-style parser debris from malformed text", () => {
  const parsed = parseAgentResponseContent(')" BB Squeeze and Negative Gamma overlap; volume is too weak for a clean breakout."}');

  assert.equal(parsed.decision, "HOLD");
  assert.match(parsed.reasoning, /BB Squeeze/);
  assertCleanVisibleReasoning(parsed.reasoning);
});

test("agent output parser extracts clean reasoning from malformed JSON plus trailing prose", () => {
  const parsed = parseAgentResponseContent('{"decision":"HOLD","reasoning":"BB Squeeze is active; wait for volume confirmation."} Blind entry only burns theta."}');

  assert.equal(parsed.decision, "HOLD");
  assert.equal(parsed.reasoning, "BB Squeeze is active; wait for volume confirmation.");
  assertCleanVisibleReasoning(parsed.reasoning);
});

test("orchestrator output parser degrades without throwing on non-JSON text", () => {
  const parsed = parseOrchestratorResponseContent("Signals conflict; wait for volume confirmation.");

  assert.equal(parsed.trade_action, "HOLD");
  assert.equal(parsed.action_reasoning, "解析降級");
  assert.match(parsed.logic, /volume confirmation/);
});
