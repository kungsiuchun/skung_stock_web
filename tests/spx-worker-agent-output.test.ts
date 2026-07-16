import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSpxDecisionTelegramPayload,
  buildTelegramSendPayload,
  assessMarketDataQuality,
  analyzeCompletedM5Bars,
  analyzeZeroDteRules,
  analyzeWithAgent,
  applyRequiredSpxFreshnessGate,
  buildDataBackedAgentFallback,
  buildDataBackedCioPlan,
  buildCioContextProjection,
  buildStructuredOpenRouterBody,
  countDirectionalVotes,
  decideWithCio,
  deriveOpenPositionContext,
  formatAgentTelegramBrief,
  hasActiveTradingRunLock,
  parseAgentResponseWithDataFallback,
  parseAgentResponseContent,
  parseOrchestratorResponseContent,
  runCouncilAnalyses,
  runSpxGpt5CompatibilityProbe,
  runStructuredOpenRouterRequest,
  runSpxUatLlm,
  runSpxUatReplay,
  resolveAttemptTimeoutMs,
  SPX_COUNCIL_TIMING_POLICY,
  shouldRunLlmCio,
  shouldRunLlmCouncil,
  validateCioModelPlan,
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

test("SPX decision Telegram payload escapes model punctuation before HTML delivery", () => {
  const payload = buildSpxDecisionTelegramPayload("chat", "QM｜price < VWAP & invalidation > 0");
  assert.equal(payload.parse_mode, "HTML");
  assert.equal(payload.text, "QM｜price &lt; VWAP &amp; invalidation &gt; 0");

  const auditPayload = buildTelegramSendPayload("chat", "<b>audit</b>");
  assert.equal(auditPayload.parse_mode, "HTML");
});

function assertCleanVisibleReasoning(text: string) {
  for (const fragment of forbiddenVisibleFragments) {
    assert.equal(text.toLowerCase().includes(fragment), false, `visible reasoning leaked ${fragment}`);
  }
  assert.equal(/^\s*[)\]}]/.test(text), false, "visible reasoning starts with parser debris");
  assert.equal(/[{"}\])]\s*$/.test(text), false, "visible reasoning ends with parser debris");
}

test("production Council timing policy allows two full 45-second attempts inside 100 seconds", () => {
  assert.deepEqual(SPX_COUNCIL_TIMING_POLICY, {
    attemptTimeoutMs: 45_000,
    absoluteDeadlineMs: 100_000,
  });
  assert.equal(
    SPX_COUNCIL_TIMING_POLICY.absoluteDeadlineMs
      >= SPX_COUNCIL_TIMING_POLICY.attemptTimeoutMs * 2,
    true,
  );
});

test("Council retry keeps a full 45-second timeout while the shared deadline has enough budget", () => {
  assert.equal(resolveAttemptTimeoutMs(45_000, 100_000), 45_000);
  assert.equal(resolveAttemptTimeoutMs(45_000, 55_000), 45_000);
  assert.equal(resolveAttemptTimeoutMs(45_000, 10_000), 10_000);
  assert.equal(resolveAttemptTimeoutMs(45_000, null), 45_000);
});

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

test("OpenRouter request profiles keep every GPT-5 Mini decision role Azure-only with minimal reasoning and JSON mode", () => {
  const council = buildStructuredOpenRouterBody("agent", "openai/gpt-5-mini", []);
  const cio = buildStructuredOpenRouterBody("cio", "openai/gpt-5-mini", []);

  assert.equal(council.model, "openai/gpt-5-mini");
  assert.equal("temperature" in council, false);
  assert.equal(council.max_completion_tokens, 1024);
  assert.deepEqual(council.reasoning, { effort: "minimal" });
  assert.equal(council.provider.require_parameters, true);
  assert.deepEqual(council.provider.order, ["azure"]);
  assert.deepEqual(council.provider.only, ["azure"]);
  assert.equal(council.provider.allow_fallbacks, false);
  assert.deepEqual(council.response_format, { type: "json_object" });
  assert.equal(cio.model, "openai/gpt-5-mini");
  assert.equal("temperature" in cio, false);
  assert.equal("max_tokens" in cio, false);
  assert.equal(cio.max_completion_tokens, 1536);
  assert.deepEqual(cio.reasoning, { effort: "minimal" });
  assert.deepEqual(cio.provider, {
    require_parameters: true,
    order: ["azure"],
    only: ["azure"],
    allow_fallbacks: false,
  });
  assert.deepEqual(cio.response_format, { type: "json_object" });
});

test("CIO projection carries the complete open-position plan instead of only a direction flag", () => {
  const projection = buildCioContextProjection({
    snapshotFacts: { "spx.last": 7531.98 },
    TODAYS_MEMORY: {
      currentPosition: "PUT",
      openPosition: {
        side: "PUT",
        entryPrice: 7532.21,
        entryTime: "2026/07/16 14:30:03",
        invalidation: "SPX 7540 reclaim invalidates the PUT",
        targets: ["SPX 7520"],
        openingRunId: "open-put-run",
      },
    },
  }, []);

  assert.deepEqual(projection.openPosition, {
    side: "PUT",
    entryPrice: 7532.21,
    entryTime: "2026/07/16 14:30:03",
    invalidation: "SPX 7540 reclaim invalidates the PUT",
    targets: ["SPX 7520"],
    openingRunId: "open-put-run",
  });
});

test("open-position context is reconstructed from the original entry snapshot, not the latest HOLD", () => {
  const context = deriveOpenPositionContext({
    currentPosition: "PUT",
    entryPrice: 7532.21,
    entryTime: "2026/07/16 14:30:03",
    actionLog: [
      { time: "2026/07/16 14:30:03", price: 7532.21, action: "買入 Put", reasoning: "Open.", stopLoss: "SPX 7540", takeProfit: "SPX 7520", runId: "open-put-run" },
      { time: "2026/07/16 14:45:03", price: 7531.98, action: "觀望防守", reasoning: "Hold." },
    ],
    icPosition: "NONE",
    icDeployTime: null,
    icAction: null,
  });

  assert.deepEqual(context, {
    side: "PUT",
    entryPrice: 7532.21,
    entryTime: "2026/07/16 14:30:03",
    invalidation: "SPX 7540",
    targets: ["SPX 7520"],
    openingRunId: "open-put-run",
  });
});

test("CIO post-parse contract retries a fractional confidence and preserves a valid confidence without mapping it to zero", async () => {
  const responses = [
    {
      trade_action: "HOLD",
      confidence_score: 55.5,
      logic: "First response is not a valid integer confidence.",
      buy_zone: null,
      stop_loss: null,
      targets: [],
      no_trade_conditions: ["Wait for confirmation."],
      evidence_refs: ["spx.last"],
      claims: [{ text: "SPX has no confirmed entry edge.", evidence_refs: ["spx.last"] }],
    },
    {
      trade_action: "HOLD",
      confidence_score: 56,
      logic: "Second response is contract-valid.",
      buy_zone: null,
      stop_loss: null,
      targets: [],
      no_trade_conditions: ["Wait for confirmation."],
      evidence_refs: ["spx.last"],
      claims: [{ text: "SPX has no confirmed entry edge.", evidence_refs: ["spx.last"] }],
    },
  ];
  const result = await decideWithCio({
    snapshotFacts: { "spx.last": 7531.98 },
    marketDataQuality: { overallStatus: "OK", hardBlocks: [], warnings: [] },
    TODAYS_MEMORY: { currentPosition: "PUT", openPosition: null },
  }, [], { OPENROUTER_API_KEY: "test-key", SPX_CIO_MODEL: "openai/gpt-5-mini" } as any, {
    fetcher: async () => new Response(JSON.stringify({
      model: "openai/gpt-5-mini",
      provider: "Azure",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(responses.shift()) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });

  assert.equal(result.modelStatus, "AI");
  assert.equal(result.plan.confidence_score, 56);
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["SCHEMA_INVALID", "SUCCESS"]);
  assert.equal(result.attempts[0].errorCategory, "POST_PARSE_CONTRACT");
  assert.equal(result.attempts[0].invalidField, "confidence_score_not_integer");
  assert.equal(result.attempts[0].responseHash?.length, 64);
  assert.equal(result.attempts[0].requestHash?.length, 64);
});

test("CIO typed validator reports precise confidence contract fields", () => {
  const valid = {
    trade_action: "HOLD",
    confidence_score: 56,
    logic: "No confirmed entry edge.",
    buy_zone: null,
    stop_loss: null,
    targets: [],
    no_trade_conditions: ["Wait."],
    evidence_refs: ["spx.last"],
    claims: [{ text: "SPX has no confirmed entry edge.", evidence_refs: ["spx.last"] }],
  };
  const allowed = new Set(["spx.last"]);
  const missing = { ...valid } as Record<string, unknown>;
  delete missing.confidence_score;

  assert.deepEqual(validateCioModelPlan(missing, allowed), { ok: false, invalidField: "confidence_score_missing" });
  assert.deepEqual(validateCioModelPlan({ ...valid, confidence_score: "56" }, allowed), { ok: false, invalidField: "confidence_score_not_number" });
  assert.deepEqual(validateCioModelPlan({ ...valid, confidence_score: 0 }, allowed), { ok: false, invalidField: "confidence_score_out_of_range" });
  assert.deepEqual(validateCioModelPlan({ ...valid, confidence_score: 101 }, allowed), { ok: false, invalidField: "confidence_score_out_of_range" });
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
      blocking_risk: null,
      reasoning: "Quality is weak.",
    },
  ];
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(responses.shift()) } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  const result = await runStructuredOpenRouterRequest({
    callKind: "agent",
    apiKey: "test-key",
    model: "openai/gpt-5-mini",
    messages: [],
    allowedEvidenceRefs: ["spx.last"],
    fetcher,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureStatus, "model_output_schema_invalid");
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["SCHEMA_INVALID", "SCHEMA_INVALID"]);
});

test("compact Council contract rejects legacy duplicated fields", async () => {
  const content = JSON.stringify({
    decision: "HOLD",
    confidence_score: 55,
    evidence_refs: ["spx.last"],
    claims: [{ text: "Legacy duplicated claim.", evidence_refs: ["spx.last"] }],
    blocking_risk: null,
    neutral_reason: "Legacy duplicated neutral reason.",
    reasoning: "Price lacks a confirmed edge.",
  });
  const result = await runStructuredOpenRouterRequest({
    callKind: "agent",
    apiKey: "test-key",
    model: "google/gemma-4-26b-a4b-it",
    messages: [],
    allowedEvidenceRefs: ["spx.last"],
    fetcher: async () => new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["SCHEMA_INVALID", "SCHEMA_INVALID"]);
});

test("HTTP 200 OpenRouter error envelopes are classified as upstream errors with safe evidence", async () => {
  const requestBodies: any[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body || "{}")));
    return new Response(JSON.stringify({
      error: {
        code: 502,
        message: "Upstream returned an invalid or empty response",
        metadata: {
          error_type: "provider_unavailable",
          provider_code: "empty_response",
        },
      },
      openrouter_metadata: {
        requested: "openai/gpt-5-mini",
        attempt: 1,
        endpoints: {
          available: [{ provider: "Azure", selected: true }],
        },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const result = await runStructuredOpenRouterRequest({
    callKind: "agent",
    apiKey: "test-key",
    model: "openai/gpt-5-mini",
    messages: [],
    fetcher,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureStatus, "model_upstream_error");
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["UPSTREAM_ERROR", "UPSTREAM_ERROR"]);
  assert.equal(result.attempts[0].errorType, "provider_unavailable");
  assert.equal(result.attempts[0].upstreamErrorCode, 502);
  assert.equal(result.attempts[0].providerCode, "empty_response");
  assert.equal(result.attempts[0].responseShape, "ERROR_ENVELOPE");
  assert.equal(result.attempts[0].choiceCount, 0);
  assert.equal(result.attempts[0].selectedProvider, "Azure");
  assert.equal(result.attempts[0].errorMessageHash?.length, 64);
  assert.equal("errorMessage" in result.attempts[0], false);
  assert.deepEqual(requestBodies[0].provider, { require_parameters: true, order: ["azure"], only: ["azure"], allow_fallbacks: false });
  assert.deepEqual(requestBodies[1].provider, { require_parameters: true, order: ["azure"], only: ["azure"], allow_fallbacks: false });
});

test("GPT-5 compatibility probe uses the exact Azure-only Council wire contract before UAT delivery", async () => {
  const requestBodies: any[] = [];
  const probe = await runSpxGpt5CompatibilityProbe({
    OPENROUTER_API_KEY: "test-key",
    SPX_COUNCIL_MODEL: "openai/gpt-5-mini",
  } as any, {
    fetcher: async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body || "{}")));
      return new Response(JSON.stringify({
        model: "openai/gpt-5-mini",
        provider: "Azure",
        choices: [{
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              decision: "HOLD",
              confidence_score: 55,
              evidence_refs: ["probe.status"],
              blocking_risk: null,
              reasoning: "Azure strict schema compatibility confirmed.",
            }),
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  assert.equal(probe.ok, true);
  assert.equal(requestBodies.length, 1);
  assert.equal(requestBodies[0].max_completion_tokens, 1024);
  assert.deepEqual(requestBodies[0].reasoning, { effort: "minimal" });
  assert.equal("temperature" in requestBodies[0], false);
  assert.deepEqual(requestBodies[0].provider, {
    require_parameters: true,
    order: ["azure"],
    only: ["azure"],
    allow_fallbacks: false,
  });
  assert.deepEqual(requestBodies[0].response_format, { type: "json_object" });
  assert.match(requestBodies[0].messages[0].content, /exactly these fields: decision, confidence_score, evidence_refs, blocking_risk, reasoning/);
  assert.match(requestBodies[0].messages[0].content, /evidence_refs=\["probe\.status"\]/);
  assert.match(requestBodies[0].messages[0].content, /reasoning="Azure compatibility confirmed\."/);
});

test("GPT-5 compatibility probe returns sanitized failure evidence so UAT never sends Telegram blindly", async () => {
  const probe = await runSpxGpt5CompatibilityProbe({
    OPENROUTER_API_KEY: "test-key",
    SPX_COUNCIL_MODEL: "openai/gpt-5-mini",
  } as any, {
    fetcher: async () => new Response(JSON.stringify({
      error: { code: 400, message: "unsupported parameter temperature" },
    }), { status: 400, headers: { "Content-Type": "application/json" } }),
  });

  assert.equal(probe.ok, false);
  assert.equal(probe.failureStatus, "model_unsupported_parameter");
  assert.equal(probe.attempts.length, 1);
  assert.equal(probe.attempts[0].contractError, "UNSUPPORTED_PARAMETER");
  assert.equal("errorMessage" in probe.attempts[0], false);
});

test("HTTP 400 GPT-5 contract failures persist a safe canonical cause without raw router text", async () => {
  const result = await runStructuredOpenRouterRequest({
    callKind: "agent",
    apiKey: "test-key",
    model: "openai/gpt-5-mini",
    messages: [],
    fetcher: async () => new Response(JSON.stringify({
      error: {
        code: 400,
        message: "max_completion_tokens must be at least 1024 for this reasoning model",
        metadata: { error_type: "invalid_request_error" },
      },
    }), { status: 400, headers: { "Content-Type": "application/json" } }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureStatus, "model_invalid_token_budget");
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].errorCategory, "INVALID_TOKEN_BUDGET");
  assert.equal(result.attempts[0].contractError, "INVALID_TOKEN_BUDGET");
  assert.equal("errorMessage" in result.attempts[0], false);
});

test("GPT-5 Azure provider 404 is traceable as provider unavailable, never as timeout or schema failure", async () => {
  const result = await runStructuredOpenRouterRequest({
    callKind: "agent",
    apiKey: "test-key",
    model: "openai/gpt-5-mini",
    messages: [],
    fetcher: async () => new Response(JSON.stringify({
      error: { code: 404, message: "No endpoints found for Azure" },
    }), { status: 404, headers: { "Content-Type": "application/json" } }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureStatus, "model_provider_unavailable");
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].errorCategory, "PROVIDER_UNAVAILABLE");
  assert.equal(result.attempts[0].contractError, "PROVIDER_UNAVAILABLE");
  assert.equal(result.attempts[0].status, "HTTP_ERROR");
});

test("GPT-5 Mini Council accepts Azure endpoint variants and rejects non-Azure providers", async () => {
  const content = JSON.stringify({
    decision: "HOLD",
    confidence_score: 58,
    evidence_refs: ["spx.last"],
    blocking_risk: null,
    reasoning: "Price remains inside the current range.",
  });
  const result = await runStructuredOpenRouterRequest({
    callKind: "agent",
    apiKey: "test-key",
    model: "openai/gpt-5-mini",
    messages: [],
    allowedEvidenceRefs: ["spx.last"],
    fetcher: async () => new Response(JSON.stringify({
      id: "gen-unapproved-provider",
      choices: [{ finish_reason: "stop", message: { content } }],
      openrouter_metadata: {
        endpoints: { available: [{ provider: "Azure/eastus", selected: true }] },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["SUCCESS"]);
  assert.equal(result.attempts[0].selectedProvider, "Azure/eastus");
});

test("Council preserves an unapproved provider contract violation from an HTTP error envelope", async () => {
  const result = await runStructuredOpenRouterRequest({
    callKind: "agent",
    apiKey: "test-key",
    model: "openai/gpt-5-mini",
    messages: [],
    fetcher: async () => new Response(JSON.stringify({
      error: { code: 503, message: "unavailable" },
      openrouter_metadata: {
        endpoints: { available: [{ provider: "OpenAI", selected: true }] },
      },
    }), { status: 503, headers: { "Content-Type": "application/json" } }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureStatus, "model_unapproved_provider");
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["UNAPPROVED_PROVIDER"]);
  assert.equal(result.attempts[0].selectedProvider, "OpenAI");
});

test("GPT-5 Mini CIO classifies a non-Azure resolved provider as a CIO contract violation", async () => {
  const result = await runStructuredOpenRouterRequest({
    callKind: "cio",
    apiKey: "test-key",
    model: "openai/gpt-5-mini",
    messages: [],
    fetcher: async () => new Response(JSON.stringify({
      id: "gen-cio-unapproved-provider",
      choices: [{ finish_reason: "stop", message: { content: "{}" } }],
      openrouter_metadata: {
        endpoints: { available: [{ provider: "OpenAI", selected: true }] },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureStatus, "cio_unapproved_provider");
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["UNAPPROVED_PROVIDER"]);
  assert.equal(result.attempts[0].selectedProvider, "OpenAI");
});

test("GPT-5 Mini Azure timeout retries only Azure and never falls back to another provider", async () => {
  const requestBodies: any[] = [];
  const result = await runStructuredOpenRouterRequest({
    callKind: "agent",
    apiKey: "test-key",
    model: "openai/gpt-5-mini",
    messages: [],
    fetcher: async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body || "{}")));
      throw new DOMException("Aborted", "AbortError");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureStatus, "model_timeout");
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["TIMEOUT", "TIMEOUT"]);
  assert.deepEqual(requestBodies.map((body) => body.provider), [
    { require_parameters: true, order: ["azure"], only: ["azure"], allow_fallbacks: false },
    { require_parameters: true, order: ["azure"], only: ["azure"], allow_fallbacks: false },
  ]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.providerOrder), [["azure"], ["azure"]]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.routingPolicy), ["azure_only", "azure_only"]);
});

test("missing choices and empty model content retry as distinct recoverable failures", async () => {
  const validContent = JSON.stringify({
    decision: "HOLD",
    confidence_score: 55,
    evidence_refs: ["spx.last"],
    blocking_risk: null,
    reasoning: "No confirmed entry edge.",
  });
  const missingChoice = await runStructuredOpenRouterRequest({
    callKind: "agent",
    apiKey: "test-key",
    model: "google/gemma-4-26b-a4b-it",
    messages: [],
    fetcher: async () => new Response(JSON.stringify({ id: "gen-missing", choices: [] }), { status: 200 }),
  });
  assert.equal(missingChoice.failureStatus, "model_missing_choice");
  assert.deepEqual(missingChoice.attempts.map((attempt) => attempt.status), ["MISSING_CHOICE", "MISSING_CHOICE"]);
  assert.equal(missingChoice.attempts[0].responseShape, "MISSING_CHOICE");

  let emptyCall = 0;
  const emptyContent = await runStructuredOpenRouterRequest({
    callKind: "agent",
    apiKey: "test-key",
    model: "google/gemma-4-26b-a4b-it",
    messages: [],
    fetcher: async () => {
      emptyCall += 1;
      return new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: emptyCall === 1 ? "" : validContent } }],
      }), { status: 200 });
    },
  });
  assert.equal(emptyContent.ok, true);
  assert.deepEqual(emptyContent.attempts.map((attempt) => attempt.status), ["EMPTY_CONTENT", "SUCCESS"]);
  assert.equal(emptyContent.attempts[0].responseShape, "EMPTY_CONTENT");
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

test("Council prompt matches the strict v2 schema without legacy contract fields", () => {
  assert.equal(SYSTEM_PROMPT_PREFIX.includes('"confidence_score": 0'), false);
  assert.equal(ORCHESTRATOR_PROMPT.includes('"confidence_score": 0'), false);
  assert.equal(SYSTEM_PROMPT_PREFIX.includes('"OPEN_CALL"'), false);
  assert.equal(SYSTEM_PROMPT_PREFIX.includes('"claims"'), false);
  assert.equal(SYSTEM_PROMPT_PREFIX.includes('"neutral_reason"'), false);
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

test("Council classifies length truncation and retries the same model with a larger output cap", async () => {
  const requestBodies: any[] = [];
  const responses = [
    {
      model: "google/gemma-4-26b-a4b-it-202607",
      provider: "DeepInfra",
      usage: { prompt_tokens: 101, completion_tokens: 512, total_tokens: 613, cost: 0.0002 },
      choices: [{ finish_reason: "length", message: { content: '{"decision":"HOLD"' } }],
    },
    {
      id: "gen-uat-2",
      model: "google/gemma-4-26b-a4b-it-202607",
      provider: "Parasail",
      usage: { prompt_tokens: 101, completion_tokens: 42, total_tokens: 143, cost: 0.00012 },
      choices: [{
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            decision: "HOLD",
            confidence_score: 62,
            evidence_refs: ["spx.last"],
            blocking_risk: null,
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
    projectionBytes: 123,
    factCount: 1,
    deadlineAtMs: Date.now() + 30_000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.value?.decision, "HOLD");
  assert.equal(requestBodies.length, 2);
  assert.equal(requestBodies[0].model, requestBodies[1].model);
  assert.equal(result.attempts[1].requestedModel, "google/gemma-4-26b-a4b-it");
  assert.equal(result.attempts[1].resolvedModel, "google/gemma-4-26b-a4b-it-202607");
  assert.deepEqual(result.attempts.map((attempt) => attempt.provider), ["DeepInfra", "Parasail"]);
  assert.equal(result.attempts[1].totalTokens, 143);
  assert.equal(result.attempts[1].cost, 0.00012);
  assert.equal(requestBodies[0].temperature, 0);
  assert.equal(requestBodies[0].max_tokens, 512);
  assert.equal(requestBodies[1].max_tokens, 640);
  assert.equal(requestBodies[0].provider.require_parameters, true);
  assert.deepEqual(requestBodies[0].provider.order, ["deepinfra", "parasail"]);
  assert.deepEqual(requestBodies[0].provider.only, ["deepinfra", "parasail"]);
  assert.equal(requestBodies[0].provider.allow_fallbacks, true);
  assert.equal(requestBodies[0].response_format.type, "json_schema");
  assert.equal(requestBodies[0].response_format.json_schema.strict, true);
  assert.equal(requestBodies[0].response_format.json_schema.schema.additionalProperties, false);
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["OUTPUT_TRUNCATED", "SUCCESS"]);
  assert.equal(result.attempts[0].requestBytes > 0, true);
  assert.equal(result.attempts[0].projectionBytes, 123);
  assert.equal(result.attempts[0].factCount, 1);
  assert.equal(result.attempts[0].maxOutputTokens, 512);
  assert.equal(result.attempts[1].maxOutputTokens, 640);
  assert.equal(result.attempts[0].routingPolicy, "ordered_same_model_fallbacks");
  assert.equal(typeof result.attempts[0].deadlineRemainingMs, "number");
  assert.ok(result.attempts[0].requestHash);
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
        blocking_risk: null,
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
  } as any, { fetcher });

  assert.equal(result.modelStatus, "AI");
  assert.equal(result.decision, "HOLD");
  assert.deepEqual(result.claims, [{
    text: "SPX remains close to VWAP.",
    evidenceRefs: ["spx.last", "spx.vwap"],
    evidence_refs: ["spx.last", "spx.vwap"],
  }]);
  assert.deepEqual(result.attempts?.map((attempt) => attempt.status), ["OUTPUT_NOT_JSON", "SUCCESS"]);
  assert.equal(requestBodies.length, 2);
  assert.equal(requestBodies[0].model, "openai/gpt-5-mini");
  assert.deepEqual(requestBodies[0].provider, { require_parameters: true, order: ["azure"], only: ["azure"], allow_fallbacks: false });
  const sentProjection = requestBodies[1].messages[1].content;
  assert.match(sentProjection, /spx\.last/);
  assert.doesNotMatch(sentProjection, /extendedOnlyPayload|mustNotBeSent|gex\.gammaFlip/);
});

test("Council rejects an oversized role projection before spending a model request", async () => {
  let calls = 0;
  const oversizedFacts = Object.fromEntries(Array.from({ length: 80 }, (_, index) => [
    `spx.synthetic${index}`,
    "x".repeat(160),
  ]));
  const result = await analyzeWithAgent("QM", "Momentum analyst", {
    snapshotFacts: oversizedFacts,
    marketDataQuality: { overallStatus: "OK", hardBlocks: [], warnings: [] },
  }, {
    OPENROUTER_API_KEY: "test-key",
    SPX_COUNCIL_MODEL: "google/gemma-4-26b-a4b-it",
  } as any, {
    fetcher: async () => {
      calls += 1;
      throw new Error("must not fetch");
    },
  });

  assert.equal(calls, 0);
  assert.equal(result.modelStatus, "input_budget_exceeded");
  assert.equal(result.attempts?.[0].status, "INPUT_BUDGET_EXCEEDED");
  assert.equal((result.attempts?.[0].projectionBytes || 0) > 8_192, true);
  assert.equal(result.attempts?.[0].factCount, 80);
  assert.ok(result.attempts?.[0].requestHash);
});

test("four Council agents run concurrently under one absolute deadline", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    calls += 1;
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  };
  const startedAt = Date.now();
  const agents = await runCouncilAnalyses({
    snapshotFacts: { "spx.last": 7532.8, "quality.status": "OK" },
    marketDataQuality: { overallStatus: "OK", hardBlocks: [], warnings: [] },
  }, {
    OPENROUTER_API_KEY: "test-key",
    SPX_COUNCIL_MODEL: "google/gemma-4-26b-a4b-it",
  } as any, { fetcher, deadlineMs: 60 });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(calls, 4);
  assert.equal(agents.length, 4);
  assert.equal(elapsedMs < 250, true);
  assert.equal(agents.every((agent) => agent.modelStatus === "council_deadline_exceeded"), true);
  assert.equal(agents.every((agent) => agent.attempts?.[0].deadlineRemainingMs! <= 60), true);
});

test("CIO non-JSON output retries once and then reports a traceable failure", async () => {
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
    model: "openai/gpt-5-mini",
    messages: [{ role: "user", content: "normalized CIO projection" }],
    fetcher,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureStatus, "cio_output_not_json");
  assert.equal(requestBodies.length, 2);
  assert.equal(requestBodies[0].max_completion_tokens, 1536);
  assert.equal("temperature" in requestBodies[0], false);
  assert.deepEqual(requestBodies[0].provider, { require_parameters: true, order: ["azure"], only: ["azure"], allow_fallbacks: false });
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["OUTPUT_NOT_JSON", "OUTPUT_NOT_JSON"]);
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

  assert.equal(result.modelStatus, "INVALID_OUTPUT");
  assert.equal(result.plan.trade_action, "HOLD");
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["OUTPUT_NOT_JSON", "OUTPUT_NOT_JSON"]);
});

test("OpenRouter retry policy retries 429 and 5xx but fails fast on 401, 402, and 403", async () => {
  let rateLimitedCalls = 0;
  const validAgentContent = JSON.stringify({
    decision: "HOLD",
    confidence_score: 50,
    evidence_refs: ["spx.last"],
    blocking_risk: null,
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

  let unavailableCalls = 0;
  const unavailable = await runStructuredOpenRouterRequest({
    callKind: "agent",
    apiKey: "test-key",
    model: "same-model",
    messages: [],
    fetcher: async () => {
      unavailableCalls += 1;
      return unavailableCalls === 1
        ? new Response("unavailable", { status: 503 })
        : new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: validAgentContent } }] }), { status: 200 });
    },
  });
  assert.equal(unavailable.ok, true);
  assert.equal(unavailableCalls, 2);

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

  let paymentRequiredCalls = 0;
  const paymentRequired = await runStructuredOpenRouterRequest({
    callKind: "agent",
    apiKey: "test-key",
    model: "same-model",
    messages: [],
    fetcher: async () => {
      paymentRequiredCalls += 1;
      return new Response("payment required", { status: 402 });
    },
  });
  assert.equal(paymentRequired.ok, false);
  assert.equal(paymentRequiredCalls, 1);
  assert.equal(paymentRequired.attempts[0].errorCategory, "HTTP_402");

  let forbiddenCalls = 0;
  const forbidden = await runStructuredOpenRouterRequest({
    callKind: "agent",
    apiKey: "test-key",
    model: "same-model",
    messages: [],
    fetcher: async () => {
      forbiddenCalls += 1;
      return new Response("forbidden", { status: 403 });
    },
  });
  assert.equal(forbidden.ok, false);
  assert.equal(forbiddenCalls, 1);
  assert.equal(forbidden.attempts[0].errorCategory, "HTTP_403");
});

test("OpenRouter retry policy retries a per-attempt timeout only once", async () => {
  let calls = 0;
  const result = await runStructuredOpenRouterRequest({
    callKind: "agent",
    apiKey: "test-key",
    model: "same-model",
    messages: [],
    fetcher: async () => {
      calls += 1;
      throw new DOMException("aborted", "AbortError");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(calls, 2);
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["TIMEOUT", "TIMEOUT"]);
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
  assert.match(preview.message, /📈 QM｜⚪ 觀望 · 65% — QM 固定歷史分析票為觀望/);
  assert.match(preview.message, /🧠 CIO｜🟡 HOLD · 65%/);
  assert.match(preview.message, /⏸️ 計劃｜不開倉；等待條件成立。/);
  assert.equal(preview.result.run.council?.agents.every((agent) => agent.attempts?.length === 0), true);
});

test("controlled GPT-5 UAT uses the fixture, calls Council and CIO, and labels the message non-tradable", async () => {
  const preview = await runSpxUatLlm({
    TELEGRAM_TOKEN: "unused",
    TELEGRAM_CHAT_ID: "unused",
    OPENROUTER_API_KEY: "test-key",
    SPX_COUNCIL_MODEL: "openai/gpt-5-mini",
    SPX_CIO_MODEL: "openai/gpt-5-mini",
  } as any, "uat-llm-contract-test", "PREVIEW", {
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      const prompt = String(body.messages?.[1]?.content || "");
      const content = prompt.includes("probe.status")
        ? {
          decision: "HOLD", confidence_score: 55, evidence_refs: ["probe.status"], blocking_risk: null,
          reasoning: "Provider strict schema compatibility confirmed.",
        }
        : prompt.includes("Normalized CIO projection")
          ? {
            trade_action: "HOLD", confidence_score: 55, logic: "四位分析師均未形成可執行共識。",
            buy_zone: null, stop_loss: null, targets: [], no_trade_conditions: ["固定歷史測試不可交易"],
            evidence_refs: ["spx.last"], claims: [{ text: "固定 snapshot 價格已保存。", evidence_refs: ["spx.last"] }],
          }
          : {
            decision: "HOLD", confidence_score: 55,
            evidence_refs: [prompt.includes('"role":"NT"') ? "gex.gammaStatus" : "spx.last"],
            blocking_risk: null, reasoning: "固定歷史 snapshot 未形成可執行方向。",
          };
      return new Response(JSON.stringify({
      model: "openai/gpt-5-mini",
      provider: "Azure",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  assert.equal(preview.result.run.runMode, "UAT_LLM");
  assert.equal(preview.result.run.council?.status, "OK");
  assert.equal(preview.result.run.cioDecision?.modelStatus, "AI");
  assert.equal(preview.result.run.finalDecision.action, "HOLD");
  assert.match(preview.message, /^SYSTEM UAT｜非即時訊號｜不可交易/);
  assert.equal(preview.result.run.council?.agents.every((agent) => agent.attempts?.[0]?.providerOrder?.[0] === "azure"), true);
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
