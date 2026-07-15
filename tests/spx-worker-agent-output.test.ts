import assert from "node:assert/strict";
import test from "node:test";

import {
  assessMarketDataQuality,
  analyzeCompletedM5Bars,
  analyzeZeroDteRules,
  analyzeWithAgent,
  applyRequiredSpxFreshnessGate,
  buildDataBackedAgentFallback,
  buildDataBackedCioPlan,
  buildStructuredOpenRouterBody,
  countDirectionalVotes,
  decideWithCio,
  formatAgentTelegramBrief,
  hasActiveTradingRunLock,
  parseAgentResponseWithDataFallback,
  parseAgentResponseContent,
  parseOrchestratorResponseContent,
  runStructuredOpenRouterRequest,
  runSpxUatReplay,
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

test("M5 analysis excludes the in-progress and zero-volume phantom candles", () => {
  const bars = [
    ...Array.from({ length: 10 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 6, 14, 17, 35 + index * 5)),
      high: 7540 + index,
      low: 7538 + index,
      close: 7539 + index,
      volume: 18_000_000,
    })),
    { date: new Date("2026-07-14T18:25:00.000Z"), high: 7552.5, low: 7549.45, close: 7551.18, volume: 19_577_000 },
    { date: new Date("2026-07-14T18:30:00.000Z"), high: 7551.67, low: 7550.38, close: 7550.55, volume: 4_157_000 },
    { date: new Date("2026-07-14T18:31:00.000Z"), high: 7550.47, low: 7550.47, close: 7550.47, volume: 0 },
  ];

  const analysis = analyzeCompletedM5Bars(bars, new Date("2026-07-14T18:30:59.000Z"));

  assert.equal(analysis.latestCompletedAt, "2026-07-14T18:25:00.000Z");
  assert.equal(analysis.currentM5Vol, 19_577_000);
  assert.equal(analysis.avgM5Vol, 18_000_000);
  assert.equal(Number(analysis.volumeSurge.toFixed(3)), 1.088);
});

test("0DTE rules use VIX and VIX9D without a removed VIX3M penalty", () => {
  const result = analyzeZeroDteRules({
    etNow: new Date("2026-07-14T18:30:59.000Z"),
    spxInd: {
      currentClose: 7550.55,
      ema9: 7548.26,
      ema20: 7546,
      currentVWAP: 7540.68,
      macd: { histogram: 0.5 },
    },
    m5Analysis: { volumeSurge: 1.08, currentM5Vol: 19_577_000, avgM5Vol: 18_000_000 },
    currentVix: 16.36,
    currentVix9d: 13.51,
    pcrValue: 1.04,
    calculatedGex: null,
    trendDayContext: { regime: "BULL_TREND_DAY", directionalBias: "CALL" },
    intradayStructure: { repeatedSupport: null, repeatedResistance: null },
    dailyMemory: { currentPosition: "NONE", entryPrice: null, entryTime: null, actionLog: [] },
    sentimentData: { score: 0, label: "neutral", reason: "disabled" },
    priceActionContext: { macroTrend: "UPTREND" },
    marketDataQuality: { overallStatus: "OK", hardBlocks: [], warnings: [] },
  } as any);

  assert.equal(result.softWarnings.includes("vix_term_structure_missing"), false);
  assert.equal(result.dataQuality.status, "OK");
  assert.equal(result.tradeEligibility.hardBlocked, false);
});

test("OpenRouter request profiles keep Gemma Council deterministic and omit temperature for GPT-5 Mini CIO", () => {
  const council = buildStructuredOpenRouterBody("agent", "google/gemma-4-26b-a4b-it", []);
  const cio = buildStructuredOpenRouterBody("cio", "openai/gpt-5-mini", []);

  assert.equal(council.model, "google/gemma-4-26b-a4b-it");
  assert.equal(council.temperature, 0);
  assert.equal(council.max_tokens, 420);
  assert.equal(cio.model, "openai/gpt-5-mini");
  assert.equal("temperature" in cio, false);
  assert.equal("max_tokens" in cio, false);
  assert.equal(cio.max_completion_tokens, 520);
});

test("valid AI Council output rejects zero confidence and invalid HOLD evidence references", async () => {
  const responses = [
    {
      decision: "HOLD",
      confidence_score: 0,
      evidence_refs: ["spx.last"],
      claims: [{ text: "No edge.", evidence_refs: ["spx.last"] }],
      blocking_risk: null,
      neutral_reason: "No edge.",
      reasoning: "No edge.",
    },
    {
      decision: "HOLD",
      confidence_score: 55,
      evidence_refs: ["marketDataQuality"],
      claims: [{ text: "Quality is weak.", evidence_refs: ["marketDataQuality"] }],
      blocking_risk: null,
      neutral_reason: "Quality is weak.",
      reasoning: "Quality is weak.",
    },
  ];
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(responses.shift()) } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  const result = await runStructuredOpenRouterRequest({
    callKind: "agent",
    apiKey: "test-key",
    model: "google/gemma-4-26b-a4b-it",
    messages: [],
    allowedEvidenceRefs: ["spx.last"],
    fetcher,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureStatus, "model_output_schema_invalid");
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["SCHEMA_INVALID", "SCHEMA_INVALID"]);
});

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

test("copied zero-confidence agent schema fails closed to HOLD", () => {
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

  assert.equal(parsed.decision, "HOLD");
  assert.equal(parsed.rating, "neutral");
  assert.equal(parsed.confidence, 0);
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

test("prompts teach strict evidence claims without zero-confidence or Council execution language", () => {
  assert.equal(SYSTEM_PROMPT_PREFIX.includes('"confidence_score": 0'), false);
  assert.equal(ORCHESTRATOR_PROMPT.includes('"confidence_score": 0'), false);
  assert.equal(SYSTEM_PROMPT_PREFIX.includes('"OPEN_CALL"'), false);
  assert.match(SYSTEM_PROMPT_PREFIX, /"claims"/);
  assert.match(ORCHESTRATOR_PROMPT, /For HOLD, buy_zone and stop_loss MUST be null/);
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

test("Council OpenRouter call uses strict schema and recovers when the second same-model attempt is valid", async () => {
  const requestBodies: any[] = [];
  const responses = [
    { choices: [{ finish_reason: "stop", message: { content: "not json" } }] },
    {
      id: "gen-uat-2",
      model: "google/gemma-4-26b-a4b-it-202607",
      provider: "Google",
      usage: { prompt_tokens: 101, completion_tokens: 42, total_tokens: 143, cost: 0.00012 },
      choices: [{
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            decision: "HOLD",
            confidence_score: 62,
            evidence_refs: ["spx.last"],
            claims: [{ text: "Price remains pinned near VWAP.", evidence_refs: ["spx.last"] }],
            blocking_risk: null,
            neutral_reason: "No entry edge.",
            reasoning: "Price remains pinned near VWAP.",
          }),
        },
      }],
    },
  ];
  const fetcher: typeof fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body || "{}")));
    return new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await runStructuredOpenRouterRequest({
    callKind: "agent",
    apiKey: "test-key",
    model: "google/gemma-4-26b-a4b-it",
    messages: [{ role: "user", content: "normalized agent projection" }],
    fetcher,
  });

  assert.equal(result.ok, true);
  assert.equal(result.value?.decision, "HOLD");
  assert.equal(requestBodies.length, 2);
  assert.equal(requestBodies[0].model, requestBodies[1].model);
  assert.equal(result.attempts[1].requestedModel, "google/gemma-4-26b-a4b-it");
  assert.equal(result.attempts[1].resolvedModel, "google/gemma-4-26b-a4b-it-202607");
  assert.equal(result.attempts[1].provider, "Google");
  assert.equal(result.attempts[1].totalTokens, 143);
  assert.equal(result.attempts[1].cost, 0.00012);
  assert.equal(requestBodies[0].temperature, 0);
  assert.equal(requestBodies[0].max_tokens, 420);
  assert.equal(requestBodies[0].provider.require_parameters, true);
  assert.equal(requestBodies[0].response_format.type, "json_schema");
  assert.equal(requestBodies[0].response_format.json_schema.strict, true);
  assert.equal(requestBodies[0].response_format.json_schema.schema.additionalProperties, false);
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["SCHEMA_INVALID", "SUCCESS"]);
  assert.ok(result.attempts[1].responseHash);
});

test("Council retries only its failed call and sends a role-specific normalized fact projection", async () => {
  const requestBodies: any[] = [];
  let callCount = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    callCount += 1;
    requestBodies.push(JSON.parse(String(init?.body || "{}")));
    const content = callCount === 1
      ? "invalid"
      : JSON.stringify({
        decision: "HOLD",
        confidence_score: 58,
        evidence_refs: ["spx.last", "spx.vwap"],
        claims: [{ text: "SPX remains close to VWAP.", evidence_refs: ["spx.last", "spx.vwap"] }],
        blocking_risk: null,
        neutral_reason: "No momentum confirmation.",
        reasoning: "SPX remains close to VWAP.",
      });
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await analyzeWithAgent("QM", "Momentum analyst", {
    snapshotFacts: {
      "spx.last": 7532.8,
      "spx.vwap": 7531.2,
      "gex.gammaFlip": 7527.7,
    },
    marketDataQuality: { overallStatus: "OK", hardBlocks: [], warnings: [] },
    extendedOnlyPayload: { mustNotBeSent: true },
  }, {
    OPENROUTER_API_KEY: "test-key",
    OPENROUTER_MODEL: "google/gemma-4-26b-a4b-it",
  } as any, { fetcher });

  assert.equal(result.modelStatus, "AI");
  assert.equal(result.decision, "HOLD");
  assert.deepEqual(result.attempts?.map((attempt) => attempt.status), ["SCHEMA_INVALID", "SUCCESS"]);
  assert.equal(requestBodies.length, 2);
  const sentProjection = requestBodies[1].messages[1].content;
  assert.match(sentProjection, /spx\.last/);
  assert.doesNotMatch(sentProjection, /extendedOnlyPayload|mustNotBeSent|gex\.gammaFlip/);
});

test("CIO strict schema retries once and then reports a traceable failure", async () => {
  const requestBodies: any[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body || "{}")));
    return new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: "not-json" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const result = await runStructuredOpenRouterRequest({
    callKind: "cio",
    apiKey: "test-key",
    model: "google/gemma-4-26b-a4b-it",
    messages: [{ role: "user", content: "normalized CIO projection" }],
    fetcher,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureStatus, "cio_schema_invalid");
  assert.equal(requestBodies.length, 2);
  assert.equal(requestBodies[0].max_tokens, 520);
  assert.equal(requestBodies[0].temperature, 0);
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["SCHEMA_INVALID", "SCHEMA_INVALID"]);
});

test("CIO two-attempt schema failure returns fail-closed HOLD with attempt evidence", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: "not-json" } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const agents = ["QM", "CM", "NT", "PA"].map((agent) => ({
    agent,
    decision: "HOLD",
    confidence: 55,
    evidenceRefs: ["spx.last"],
    reasoning: `${agent} no edge`,
    modelStatus: "AI",
  }));

  const result = await decideWithCio({
    snapshotFacts: { "spx.last": 7532.8, "spx.vwap": 7531.2 },
    marketDataQuality: { overallStatus: "OK", hardBlocks: [], warnings: [] },
    TODAYS_MEMORY: { currentPosition: "NONE" },
    extendedOnlyPayload: { mustNotBeSent: true },
  }, agents as any, {
    OPENROUTER_API_KEY: "test-key",
    OPENROUTER_MODEL: "google/gemma-4-26b-a4b-it",
  } as any, { fetcher });

  assert.equal(result.modelStatus, "INVALID_SCHEMA");
  assert.equal(result.plan.trade_action, "HOLD");
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["SCHEMA_INVALID", "SCHEMA_INVALID"]);
});

test("OpenRouter retry policy retries 429 but fails fast on 401", async () => {
  let rateLimitedCalls = 0;
  const validAgentContent = JSON.stringify({
    decision: "HOLD",
    confidence_score: 50,
    evidence_refs: ["spx.last"],
    claims: [{ text: "No confirmed edge.", evidence_refs: ["spx.last"] }],
    blocking_risk: null,
    neutral_reason: "Wait.",
    reasoning: "No confirmed edge.",
  });
  const rateLimited = await runStructuredOpenRouterRequest({
    callKind: "agent",
    apiKey: "test-key",
    model: "same-model",
    messages: [],
    fetcher: async () => {
      rateLimitedCalls += 1;
      return rateLimitedCalls === 1
        ? new Response("rate limited", { status: 429 })
        : new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: validAgentContent } }] }), { status: 200 });
    },
  });
  assert.equal(rateLimited.ok, true);
  assert.equal(rateLimitedCalls, 2);

  let unauthorizedCalls = 0;
  const unauthorized = await runStructuredOpenRouterRequest({
    callKind: "agent",
    apiKey: "test-key",
    model: "same-model",
    messages: [],
    fetcher: async () => {
      unauthorizedCalls += 1;
      return new Response("unauthorized", { status: 401 });
    },
  });
  assert.equal(unauthorized.ok, false);
  assert.equal(unauthorizedCalls, 1);
  assert.equal(unauthorized.attempts[0].errorCategory, "HTTP_401");
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

test("deterministic Council and CIO fallbacks cannot create direction", () => {
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

  assert.ok(bullishAgents.every((agent) => agent.decision === "HOLD" && agent.confidence === 0));
  assert.ok(bearishAgents.every((agent) => agent.decision === "HOLD" && agent.confidence === 0));
  assert.equal(buildDataBackedCioPlan(bullishContext, bullishAgents).trade_action, "HOLD");
  assert.equal(buildDataBackedCioPlan(bearishContext, bearishAgents).trade_action, "HOLD");
});

test("data-backed CIO always degrades to HOLD when the model is unavailable", () => {
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
  assert.match(plan.risk_warning, /DEGRADED|WAIT_AND_OBSERVE/i);
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

test("stale required SPX data blocks LIVE but UAT replay is explicitly non-normal", () => {
  const base = assessMarketDataQuality({
    spxQuotes: [{}],
    spxM5Quotes: [{}],
  });
  const freshness = {
    spxYahoo: { status: "STALE" },
    spxM5Yahoo: { status: "OK" },
  } as any;

  const live = applyRequiredSpxFreshnessGate(base, freshness, "LIVE");
  assert.equal(live.overallStatus, "BLOCK");
  assert.deepEqual(live.hardBlocks, ["spx_15m_stale"]);

  const replay = applyRequiredSpxFreshnessGate(base, freshness, "UAT_REPLAY");
  assert.equal(replay.overallStatus, "WARN");
  assert.equal(replay.warnings.includes("uat_replay_non_live"), true);
});

test("off-hours UAT replay uses the fixed historical fixture without model or Telegram calls", async () => {
  const preview = await runSpxUatReplay({
    TELEGRAM_TOKEN: "unused",
    TELEGRAM_CHAT_ID: "unused",
    OPENROUTER_API_KEY: "unused",
  } as any, "uat-replay-fixed-fixture-test", "PREVIEW");

  assert.equal(preview.result.finalDecision.action, "HOLD");
  assert.equal(preview.result.run.runMode, "UAT_REPLAY");
  assert.match(preview.message, /UAT REPLAY｜非即時訊號/);
  assert.match(preview.message, /QM｜觀望 · 信心 65% · 固定重播/);
  assert.match(preview.message, /CIO｜HOLD · 65% · 固定重播/);
  assert.equal(preview.result.run.council?.agents.every((agent) => agent.attempts?.length === 0), true);
});

test("fallback CIO never opens a trade regardless of soft warnings or required data failure", () => {
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

  assert.equal(buildDataBackedCioPlan(context, agents).trade_action, "HOLD");
  assert.equal(
    buildDataBackedCioPlan({ ...context, marketDataQuality: { overallStatus: "BLOCK", hardBlocks: ["spx_15m_missing"] } }, agents).trade_action,
    "HOLD",
  );
});
