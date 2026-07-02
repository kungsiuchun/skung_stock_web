import assert from "node:assert/strict";
import test from "node:test";

import {
  assessMarketDataQuality,
  buildDataBackedAgentFallback,
  buildDataBackedCioPlan,
  countDirectionalVotes,
  formatAgentTelegramBrief,
  hasActiveTradingRunLock,
  parseAgentResponseWithDataFallback,
  parseAgentResponseContent,
  parseOrchestratorResponseContent,
  shouldRunLlmCio,
  shouldRunLlmCouncil,
} from "../scripts/worker-spx-bot";
import { ORCHESTRATOR_PROMPT, SYSTEM_PROMPT_PREFIX } from "../scripts/prompts";

const forbiddenVisibleFragments = [
  "{",
  "}",
  '"decision"',
  '"reasoning"',
  "rating",
  "confidence_score",
  "evidence",
  "neutral_reason",
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

test("directional vote counter treats option-style agent decisions as real votes", () => {
  const votes = countDirectionalVotes(["OPEN_CALL", "CALL", "OPEN_PUT", "PUT"]);

  assert.equal(votes.buyVotes, 2);
  assert.equal(votes.sellVotes, 2);
  assert.equal(votes.holdVotes, 0);
  assert.equal(votes.consensusVote, "NEUTRAL");
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

test("agent output parser strips screenshot-style raw contract fragments", () => {
  const parsed = parseAgentResponseContent(
    '"rating":"bullish","confidence_score":75,"evidence":["gammaStatus: positive_gamma","trendDayContext: BULL_TREND_DAY"],"neutral_reason":"Price is approaching resistance." Market is pinned near resistance; do not chase blindly.',
  );

  assert.equal(parsed.decision, "HOLD");
  assertCleanVisibleReasoning(parsed.reasoning);
  assert.equal(parsed.reasoning.includes("Market is pinned"), true);
});

test("copied zero-confidence agent schema falls back to data-backed direction", () => {
  const bullishContext = {
    currentPrice: "7420",
    currentVWAP: "7398",
    ema9: "7410",
    currentVix: "13.8",
    m5Analysis: { volumeSurge: "1.70x" },
    trendDayContext: {
      regime: "BULL_TREND_DAY",
      directionalBias: "CALL",
      confidence: 78,
      aboveVWAP: true,
      aboveEMA9: true,
      aboveGammaFlip: true,
    },
    calculatedGEX: { gammaStatus: "positive_gamma", gammaFlipLevel: 7400 },
    zeroDteRuleEngine: {
      verdict: "TRADE_ALLOWED",
      hardRuleTriggered: false,
      signalScore: 76,
      directionalBias: "CALL",
      hardBlocks: [],
      activeRisks: [],
    },
    TODAYS_MEMORY: { currentPosition: "NONE" },
  };
  const parsed = parseAgentResponseWithDataFallback("QM", JSON.stringify({
    decision: "HOLD",
    rating: "neutral",
    confidence_score: 0,
    evidence: ["concrete data field 1", "concrete data field 2"],
    neutral_reason: null,
    reasoning: "short analysis",
  }), bullishContext);

  assert.equal(parsed.decision, "BUY");
  assert.equal(parsed.rating, "bullish");
  assert.equal(parsed.modelStatus, "model_copied_schema_zero_confidence");
});

test("specific nonzero neutral agent output stays neutral", () => {
  const parsed = parseAgentResponseWithDataFallback("QM", JSON.stringify({
    decision: "HOLD",
    rating: "neutral",
    confidence_score: 37,
    evidence: ["trendDayContext RANGE_OR_MIXED", "volumeSurge 0.90x"],
    neutral_reason: "VWAP and EMA9 conflict",
    reasoning: "Trend and trigger fields conflict; stand down.",
  }), {});

  assert.equal(parsed.decision, "HOLD");
  assert.equal(parsed.rating, "neutral");
  assert.equal(parsed.confidence, 37);
  assert.equal(parsed.modelStatus, undefined);
  assert.match(parsed.neutralReason || "", /VWAP/);
});

test("telegram agent renderer never prints raw JSON contract fields", () => {
  const line = formatAgentTelegramBrief("CM", {
    decision: "HOLD",
    confidence_score: 75,
    evidence: ['"rating":"bullish","confidence_score":75,"evidence":["gammaStatus"]'],
    reasoning: '"neutral_reason":"metadata leak" Price is pinned near 7440.',
    neutral_reason: '"evidence":["raw"]',
    modelStatus: "model_timeout",
  } as any);

  assert.match(line, /CM/);
  assert.match(line, /fallback:model_timeout/);
  assert.match(line, /75\/100/);
  assertCleanVisibleReasoning(line);
});

test("prompt examples do not teach the model to copy zero confidence or hard-block true", () => {
  assert.equal(SYSTEM_PROMPT_PREFIX.includes('"confidence_score": 0'), false);
  assert.equal(ORCHESTRATOR_PROMPT.includes('"confidence_score": 0'), false);
  assert.equal(ORCHESTRATOR_PROMPT.includes('"hard_rule_triggered": true'), false);
  assert.match(ORCHESTRATOR_PROMPT, /copy zeroDteRuleEngine\.hardRuleTriggered/);
});

test("trading run lock treats unexpired lock as active and expired lock as inactive", () => {
  const now = Date.parse("2026-06-29T16:00:00.000Z");

  assert.equal(hasActiveTradingRunLock(JSON.stringify({ expiresAtMs: now + 1000 }), now), true);
  assert.equal(hasActiveTradingRunLock(JSON.stringify({ expiresAtMs: now - 1000 }), now), false);
  assert.equal(hasActiveTradingRunLock("not json", now), false);
});

test("AI council and CIO are enabled by default and only falsey flags disable them", () => {
  assert.equal(shouldRunLlmCouncil(undefined), true);
  assert.equal(shouldRunLlmCouncil(""), true);
  assert.equal(shouldRunLlmCouncil("true"), true);
  assert.equal(shouldRunLlmCouncil("0"), false);
  assert.equal(shouldRunLlmCouncil("false"), false);

  assert.equal(shouldRunLlmCio(undefined), true);
  assert.equal(shouldRunLlmCio(""), true);
  assert.equal(shouldRunLlmCio("yes"), true);
  assert.equal(shouldRunLlmCio("off"), false);
  assert.equal(shouldRunLlmCio("no"), false);
});

test("orchestrator output parser degrades without throwing on non-JSON text", () => {
  const parsed = parseOrchestratorResponseContent("Signals conflict; wait for volume confirmation.");

  assert.equal(parsed.trade_action, "HOLD");
  assert.equal(parsed.action_reasoning, "解析降級");
  assert.match(parsed.logic, /volume confirmation/);
});

test("agent output parser normalizes the decision contract fields", () => {
  const parsed = parseAgentResponseContent(
    JSON.stringify({
      decision: "OPEN_PUT",
      confidence_score: 82,
      evidence: ["below VWAP", "negative gamma"],
      blocking_risk: "VIX expansion",
      reasoning: "Below VWAP with negative gamma; short side has control.",
    }),
  );

  assert.equal(parsed.decision, "OPEN_PUT");
  assert.equal(parsed.rating, "bearish");
  assert.equal(parsed.confidence, 82);
  assert.deepEqual(parsed.evidence, ["below VWAP", "negative gamma"]);
  assert.equal(parsed.blockingRisk, "VIX expansion");
  assert.equal(parsed.neutralReason, null);
});

test("data-backed fallback agents and CIO are directional for bullish and bearish fixtures", () => {
  const bullishContext = {
    currentPrice: "7420",
    currentVWAP: "7398",
    ema9: "7410",
    currentVix: "13.8",
    m5Analysis: { volumeSurge: "1.70x" },
    trendDayContext: {
      regime: "BULL_TREND_DAY",
      directionalBias: "CALL",
      confidence: 78,
      aboveVWAP: true,
      aboveEMA9: true,
      aboveGammaFlip: true,
      rationale: "Price is above VWAP/EMA9 with trend-day breadth.",
    },
    calculatedGEX: {
      gammaStatus: "positive_gamma",
      gammaFlipLevel: 7400,
      mostLongGammaStrike: "7450 (12.0M)",
      mostShortGammaStrike: "7350 (-8.0M)",
    },
    zeroDteRuleEngine: {
      verdict: "TRADE_ALLOWED",
      hardRuleTriggered: false,
      signalScore: 76,
      directionalBias: "CALL",
      hardBlocks: [],
      activeRisks: [],
    },
    TODAYS_MEMORY: { currentPosition: "NONE" },
  };

  const bearishContext = {
    ...bullishContext,
    currentPrice: "7368",
    currentVWAP: "7395",
    ema9: "7388",
    m5Analysis: { volumeSurge: "1.60x" },
    trendDayContext: {
      regime: "BEAR_TREND_DAY",
      directionalBias: "PUT",
      confidence: 80,
      aboveVWAP: false,
      aboveEMA9: false,
      aboveGammaFlip: false,
      rationale: "Price is below VWAP/EMA9 with downside trend-day tape.",
    },
    calculatedGEX: {
      gammaStatus: "negative_gamma",
      gammaFlipLevel: 7400,
      mostLongGammaStrike: "7450 (12.0M)",
      mostShortGammaStrike: "7350 (-8.0M)",
    },
    zeroDteRuleEngine: {
      verdict: "TRADE_ALLOWED",
      hardRuleTriggered: false,
      signalScore: 78,
      directionalBias: "PUT",
      hardBlocks: [],
      activeRisks: [],
    },
  };

  const bullishAgents = ["QM", "CM", "NT", "PA"].map((key) =>
    buildDataBackedAgentFallback(key, bullishContext, "model_timeout"),
  );
  const bearishAgents = ["QM", "CM", "NT", "PA"].map((key) =>
    buildDataBackedAgentFallback(key, bearishContext, "model_timeout"),
  );

  assert.ok(bullishAgents.some((agent) => agent.rating === "bullish"));
  assert.ok(bearishAgents.some((agent) => agent.rating === "bearish"));
  assert.equal(buildDataBackedCioPlan(bullishContext, bullishAgents).trade_action, "OPEN_CALL");
  assert.equal(buildDataBackedCioPlan(bearishContext, bearishAgents).trade_action, "OPEN_PUT");
});

test("data-backed CIO stays neutral only when fixture signals are mixed or hard-blocked", () => {
  const mixedContext = {
    currentPrice: "7405",
    currentVWAP: "7404",
    ema9: "7406",
    m5Analysis: { volumeSurge: "0.90x" },
    trendDayContext: {
      regime: "RANGE_OR_MIXED",
      directionalBias: "NONE",
      confidence: 35,
      aboveVWAP: true,
      aboveEMA9: false,
      aboveGammaFlip: true,
      rationale: "Range tape with no clean trigger.",
    },
    calculatedGEX: {
      gammaStatus: "positive_gamma",
      gammaFlipLevel: 7400,
      mostLongGammaStrike: "7450 (12.0M)",
      mostShortGammaStrike: "7350 (-8.0M)",
    },
    zeroDteRuleEngine: {
      verdict: "WAIT_AND_OBSERVE",
      hardRuleTriggered: false,
      signalScore: 42,
      directionalBias: "NONE",
      hardBlocks: [],
      activeRisks: ["volume_not_confirmed"],
    },
    TODAYS_MEMORY: { currentPosition: "NONE" },
  };

  const agents = ["QM", "CM", "NT", "PA"].map((key) =>
    buildDataBackedAgentFallback(key, mixedContext, "model_timeout"),
  );
  const plan = buildDataBackedCioPlan(mixedContext, agents);

  assert.equal(plan.trade_action, "HOLD");
  assert.match(plan.risk_warning, /volume_not_confirmed|mixed/i);
});

test("market data quality blocks only required missing feeds and warns on optional feeds", () => {
  const degraded = assessMarketDataQuality({
    spxQuotes: [],
    spxM5Quotes: [{ close: 7400 }],
    spxD1Quotes: [],
    spxH1Quotes: [],
    currentVix: null,
    currentVix9d: null,
    pcrValue: null,
    calculatedGex: null,
  });

  assert.equal(degraded.overallStatus, "BLOCK");
  assert.deepEqual(degraded.hardBlocks, ["spx_15m_missing"]);
  assert.equal(degraded.items.cboeGex.status, "MISSING");
  assert.equal(degraded.items.cboeGex.required, false);

  const usable = assessMarketDataQuality({
    spxQuotes: [{ close: 7400 }],
    spxM5Quotes: [{ close: 7401 }],
    spxD1Quotes: [],
    spxH1Quotes: [],
    currentVix: null,
    currentVix9d: null,
    pcrValue: null,
    calculatedGex: null,
  });

  assert.equal(usable.overallStatus, "WARN");
  assert.deepEqual(usable.hardBlocks, []);
  assert.ok(usable.warnings.includes("cboe_gex_missing"));
});

test("CIO does not treat soft warnings as hard vetoes but blocks required data failure", () => {
  const context = {
    currentPrice: "7420",
    currentVWAP: "7398",
    ema9: "7410",
    m5Analysis: { volumeSurge: "1.70x" },
    trendDayContext: {
      regime: "BULL_TREND_DAY",
      directionalBias: "CALL",
      confidence: 78,
      aboveVWAP: true,
      aboveEMA9: true,
      aboveGammaFlip: true,
    },
    calculatedGEX: { gammaStatus: "positive_gamma", mostLongGammaStrike: "7450 (12.0M)" },
    zeroDteRuleEngine: {
      verdict: "WAIT_AND_OBSERVE",
      hardRuleTriggered: false,
      signalScore: 63,
      directionalBias: "CALL",
      hardBlocks: [],
      activeRisks: ["legacy_warning"],
      softWarnings: ["volume_follow_through_weak"],
      advisoryNotes: ["gamma_pinning_detected"],
    },
    marketDataQuality: { overallStatus: "WARN", hardBlocks: [] },
    TODAYS_MEMORY: { currentPosition: "NONE" },
  };
  const agents = ["QM", "CM", "NT", "PA"].map((key) => buildDataBackedAgentFallback(key, context, "model_timeout"));

  assert.equal(buildDataBackedCioPlan(context, agents).trade_action, "OPEN_CALL");
  assert.equal(
    buildDataBackedCioPlan({ ...context, marketDataQuality: { overallStatus: "BLOCK", hardBlocks: ["spx_15m_missing"] } }, agents).trade_action,
    "HOLD",
  );
});
