import type { SpxGexTelegramSummary } from "./spx-gex-heatmap";

export type SpxDecisionAction = "OPEN_CALL" | "OPEN_PUT" | "HOLD" | "CLOSE";
export type SpxPosition = "NONE" | "CALL" | "PUT";
export type SpxPositionDirective = "FLAT_WAIT" | "HOLD_CALL" | "HOLD_PUT" | "CLOSE_CALL" | "CLOSE_PUT";
export type SpxDeliveryMode = "SEND" | "PREVIEW";
export type SpxRunMode = "LIVE" | "UAT_REPLAY" | "UAT_LLM";

export const NT_VOLATILITY_RISK_PROMPT = `You are NT, a ruthless Volatility Risk Manager. You monitor options premium pressure, VIX/VIX9D stress, gamma regime, and tail-risk.
Your Task: Analyze current VIX, VIX9D, volatility compression or expansion, BB squeeze, GEX regime, and any disabled or missing sentiment inputs honestly. Do not require removed external flow sources.
Your Voice: Analytical, risk-averse, and highly aware of macro shocks. Use terms like "IV Crush", "Volatility Premium", "Tail Risk", "Gamma Regime", and "Sentiment Index". Act as a contrarian who fades retail FOMO and panic.
Format: Keep it under 2 sentences. Always acknowledge the current trend but explicitly highlight the hidden tail-risk, volatility contraction trap, or gamma-volatility mismatch. MUST use Traditional Chinese.`;

export const SPX_LIFECYCLE_STAGES = [
  "SCHEDULED",
  "LOCK_ACQUIRED",
  "SNAPSHOT_READY",
  "COUNCIL_COMPLETED",
  "CIO_DECIDED",
  "RISK_GATED",
  "PERSISTED",
  "DELIVERY_ATTEMPTED",
  "DELIVERED",
  "DELIVERY_FAILED",
] as const;

export type SpxLifecycleStage = typeof SPX_LIFECYCLE_STAGES[number];

export interface SourceFreshnessItem {
  source: string;
  observedAt: string | null;
  ageMs: number | null;
  status: "OK" | "STALE" | "MISSING" | "FALLBACK";
}

export interface MarketDataQuality {
  status: "OK" | "WARN" | "BLOCK";
  hardBlocks: string[];
  warnings: string[];
}

export type SpxReplayGrade = "NORMALIZED_CANONICAL" | "PARTIAL_NORMALIZED" | "UNAVAILABLE";

export interface SpxDecisionReplayEvidence {
  replayGrade: SpxReplayGrade;
  vendorRawPayloadsPersisted: boolean;
  gex: {
    snapshotId: string;
    payloadHash: string;
    schemaVersion: number;
    provider: string;
    fallbackFrom: string | null;
    sourceTimestamp: string | null;
    facts: Record<string, string | number | boolean | null>;
    dataQuality: Record<string, number> | null;
  } | null;
  normalizedSeries: {
    spx15m: Array<Record<string, unknown>>;
    spx5m: Array<Record<string, unknown>>;
    spxD1: Array<Record<string, unknown>>;
    spxH1: Array<Record<string, unknown>>;
    vix15m: Array<Record<string, unknown>>;
    vix9d: Array<Record<string, unknown>>;
  };
}

export interface MarketSnapshot {
  runId: string;
  scheduledAt: string;
  snapshotAt: string;
  sourceFreshness: Record<string, SourceFreshnessItem>;
  dataQuality: MarketDataQuality;
  facts: Record<string, string | number | boolean | null>;
  gexSummary?: SpxGexTelegramSummary | null;
  normalizedContext?: Record<string, unknown> | null;
  boardDeepLink: string | null;
  replayGrade: SpxReplayGrade;
  replayEvidence: SpxDecisionReplayEvidence | null;
  rawSnapshotAvailable: boolean;
  runMode?: SpxRunMode;
}

export interface CouncilAgentAnalysis {
  agent: "QM" | "CM" | "NT" | "PA";
  decision: "CALL" | "PUT" | "HOLD";
  confidence: number;
  evidenceRefs: string[];
  claims: SpxEvidenceClaim[];
  modelStatus: string;
  fallbackStatus: string | null;
  latencyMs: number;
  reasoning?: string;
  valid?: boolean;
  attempts?: ModelAttemptMetadata[];
}

export interface SpxEvidenceClaim {
  text: string;
  evidenceRefs: string[];
}

export interface ModelAttemptMetadata {
  attempt: number;
  model: string;
  requestedModel?: string;
  resolvedModel?: string | null;
  provider?: string | null;
  responseId?: string | null;
  status: "SUCCESS" | "TIMEOUT" | "HTTP_ERROR" | "UPSTREAM_ERROR" | "UNAPPROVED_PROVIDER" | "MISSING_CHOICE" | "EMPTY_CONTENT" | "OUTPUT_NOT_JSON" | "SCHEMA_INVALID" | "OUTPUT_TRUNCATED" | "DEADLINE_EXCEEDED" | "INPUT_BUDGET_EXCEEDED" | "REQUEST_FAILED";
  latencyMs: number;
  httpStatus: number | null;
  errorCategory: string | null;
  finishReason: string | null;
  contentLength: number;
  responseHash: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  reasoningTokens?: number | null;
  totalTokens?: number | null;
  cost?: number | null;
  requestBytes?: number;
  projectionBytes?: number | null;
  factCount?: number | null;
  requestHash?: string | null;
  maxOutputTokens?: number;
  deadlineRemainingMs?: number | null;
  routingPolicy?: string;
  providerOrder?: string[];
  responseShape?: "COMPLETION" | "ERROR_ENVELOPE" | "CHOICE_ERROR" | "UNAPPROVED_PROVIDER" | "MISSING_CHOICE" | "EMPTY_CONTENT" | "NON_JSON" | "SCHEMA_INVALID" | "OUTPUT_TRUNCATED" | "REQUEST_FAILED";
  choiceCount?: number;
  selectedProvider?: string | null;
  attemptedProviders?: string[];
  generationId?: string | null;
  errorType?: string | null;
  upstreamErrorCode?: number | null;
  providerCode?: string | null;
  errorMessageHash?: string | null;
  contractError?: "INVALID_REQUEST" | "UNSUPPORTED_PARAMETER" | "INVALID_SCHEMA" | "INVALID_TOKEN_BUDGET" | "UNKNOWN_ROUTER_400" | "PROVIDER_UNAVAILABLE" | null;
  invalidField?: string | null;
}

export interface CouncilResult {
  status: "OK" | "DEGRADED";
  agents: CouncilAgentAnalysis[];
  latencyMs: number;
  degradedReason?: string | null;
}

export interface CioDecision {
  action: SpxDecisionAction;
  confidence: number;
  thesis: string;
  entry: string | null;
  invalidation: string | null;
  targets: string[];
  noTradeConditions: string[];
  evidenceRefs: string[];
  claims: SpxEvidenceClaim[];
  modelStatus: string;
  latencyMs: number;
  attempts?: ModelAttemptMetadata[];
}

export interface SpxOpenPositionContext {
  side: Exclude<SpxPosition, "NONE">;
  entryPrice: number | null;
  entryTime: string | null;
  invalidation: string | null;
  targets: string[];
  openingRunId: string | null;
}

export type RiskGateDisposition = "PASS" | "VETO_TO_HOLD" | "REQUIRE_CLOSE";

export interface RiskGateDirective {
  disposition: RiskGateDisposition;
  reason: string;
}

export interface RiskGateResult {
  action: SpxDecisionAction;
  disposition: RiskGateDisposition;
  reason: string;
  cioAction: SpxDecisionAction;
  positionDirective: SpxPositionDirective;
}

export interface LifecycleEvent {
  runId: string;
  stage: SpxLifecycleStage;
  occurredAt: string;
  attempt: number;
  latencyMs: number | null;
  payload: Record<string, unknown>;
}

export interface DecisionRunRecord {
  runId: string;
  scheduledAt: string;
  currentStage: SpxLifecycleStage;
  snapshot: MarketSnapshot | null;
  council: CouncilResult | null;
  cioDecision: CioDecision | null;
  riskGate: RiskGateResult | null;
  finalDecision: CioDecision | null;
  finalAction: SpxDecisionAction | null;
  degraded: boolean;
  degradedReason: string | null;
  createdAt: string;
  updatedAt: string;
  runMode?: SpxRunMode;
}

export interface OutboxRecord {
  runId: string;
  message: string;
  status: "PENDING" | "SENDING" | "FAILED" | "DELIVERED";
  attemptCount: number;
  telegramMessageId: string | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpxDecisionStore {
  beginRun(record: DecisionRunRecord): Promise<boolean> | boolean;
  appendLifecycle(event: LifecycleEvent): Promise<void> | void;
  persistDecision(record: DecisionRunRecord): Promise<void> | void;
  getRun(runId: string): Promise<DecisionRunRecord | null> | DecisionRunRecord | null;
  getLifecycle(runId: string): Promise<LifecycleEvent[]> | LifecycleEvent[];
  enqueueOutbox(record: OutboxRecord): Promise<void> | void;
  getOutbox(runId: string): Promise<OutboxRecord | null> | OutboxRecord | null;
  markDeliveryAttempt(runId: string, at: string): Promise<OutboxRecord> | OutboxRecord;
  markDeliveryFailed(runId: string, error: string, nextAttemptAt: string, at: string): Promise<OutboxRecord> | OutboxRecord;
  markDelivered(runId: string, telegramMessageId: string, at: string): Promise<OutboxRecord> | OutboxRecord;
  hasRun(runId: string): Promise<boolean> | boolean;
}

export interface SpxDecisionPipelineDependencies {
  clock: {
    now: () => Date;
  };
  lock?: {
    acquire: (runId: string) => Promise<boolean>;
  };
  marketData: {
    load: (runId: string, scheduledAt: Date) => Promise<MarketSnapshot>;
  };
  council: {
    analyze: (snapshot: MarketSnapshot) => Promise<CouncilResult>;
  };
  cio: {
    decide: (snapshot: MarketSnapshot, council: CouncilResult) => Promise<CioDecision>;
  };
  riskGate: {
    evaluate: (snapshot: MarketSnapshot, council: CouncilResult, cio: CioDecision) => Promise<RiskGateDirective>;
  };
  store: SpxDecisionStore;
  telegram: {
    send: (message: string) => Promise<{ messageId: string }>;
  };
  renderMessage?: (input: TelegramDecisionMessageInput) => string;
  deliveryRetryDelayMs?: number;
}

export type SpxDeliveryDependencies = Pick<
  SpxDecisionPipelineDependencies,
  "clock" | "store" | "telegram" | "deliveryRetryDelayMs"
>;

export interface SpxDecisionPipelineInput {
  runId: string;
  scheduledAt: Date;
  currentPosition: SpxPosition;
  openPosition?: SpxOpenPositionContext | null;
  runMode?: SpxRunMode;
}

export interface SpxDecisionPipelineResult {
  run: DecisionRunRecord;
  finalDecision: CioDecision;
  delivery: OutboxRecord;
  duplicate: boolean;
}

export interface TelegramDecisionMessageInput {
  run: DecisionRunRecord;
  snapshot: MarketSnapshot;
  council: CouncilResult;
  cioDecision: CioDecision;
  riskGate: RiskGateResult;
  openPosition?: SpxOpenPositionContext | null;
}

export function resolveSpxDeliveryMode(input: {
  trigger: "SCHEDULED" | "MANUAL";
  explicitDelivery?: boolean;
  debugPreview?: boolean;
}): SpxDeliveryMode {
  if (input.debugPreview) return "PREVIEW";
  if (input.trigger === "SCHEDULED") return "SEND";
  return input.explicitDelivery ? "SEND" : "PREVIEW";
}

const directionalActions = new Set<SpxDecisionAction>(["OPEN_CALL", "OPEN_PUT"]);
const allowedCioActions = new Set<SpxDecisionAction>(["OPEN_CALL", "OPEN_PUT", "HOLD", "CLOSE"]);
const expectedCouncilAgents = ["QM", "CM", "NT", "PA"];
const CURRENT_GEX_SCHEMA_VERSION = 1;

const asErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const isTimeoutError = (error: unknown) => /timeout|timed out/i.test(asErrorMessage(error));
const nowIso = (dependencies: Pick<SpxDecisionPipelineDependencies, "clock">) => dependencies.clock.now().toISOString();
const toLatency = (startedAt: number, dependencies: SpxDecisionPipelineDependencies) =>
  Math.max(0, dependencies.clock.now().getTime() - startedAt);

const safeConfidence = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
};

const formatDisplayNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  }
  return String(value);
};

const holdDecision = (reason: string, modelStatus: string): CioDecision => ({
  action: "HOLD",
  confidence: 0,
  thesis: `DEGRADED: ${reason}`,
  entry: null,
  invalidation: null,
  targets: [],
  noTradeConditions: [reason],
  evidenceRefs: [],
  claims: [],
  modelStatus,
  latencyMs: 0,
});

const validateCouncil = (council: CouncilResult, snapshot: MarketSnapshot) => {
  if (council.status !== "OK") return council.degradedReason || "council_degraded";
  if (council.agents.length !== expectedCouncilAgents.length) return "council_agent_count_invalid";
  const observed = new Set(council.agents.map((agent) => agent.agent));
  if (expectedCouncilAgents.some((agent) => !observed.has(agent as CouncilAgentAnalysis["agent"]))) {
    return "council_agent_set_invalid";
  }
  const failedAgent = council.agents.find((agent) => !councilAgentIsValid(agent));
  if (failedAgent) return `council_${failedAgent.agent.toLowerCase()}_${failedAgent.fallbackStatus || failedAgent.modelStatus}`;
  for (const agent of council.agents) {
    if (!(["CALL", "PUT", "HOLD"] as const).includes(agent.decision)) return `council_${agent.agent.toLowerCase()}_decision_invalid`;
    if (!Number.isFinite(agent.confidence) || agent.confidence < 1 || agent.confidence > 100) {
      return `council_${agent.agent.toLowerCase()}_confidence_invalid`;
    }
    if (!Array.isArray(agent.evidenceRefs) || agent.evidenceRefs.length === 0) return `council_${agent.agent.toLowerCase()}_evidence_missing`;
    if (!Array.isArray(agent.claims) || agent.claims.length === 0 || agent.claims.some((claim) => !claim.text.trim() || claim.evidenceRefs.length === 0)) {
      return `council_${agent.agent.toLowerCase()}_claims_invalid`;
    }
    const evidenceRefs = [...agent.evidenceRefs, ...agent.claims.flatMap((claim) => claim.evidenceRefs)];
    const missingEvidence = evidenceRefs.filter((reference) => !(reference in snapshot.facts));
    if (missingEvidence.length > 0) return `council_${agent.agent.toLowerCase()}_evidence_not_in_snapshot:${missingEvidence.join(",")}`;
  }
  return null;
};

const validateCioDecision = (decision: CioDecision, snapshot: MarketSnapshot) => {
  if (!decision || !allowedCioActions.has(decision.action)) return "cio_schema_invalid_action";
  if (!Number.isFinite(Number(decision.confidence)) || decision.confidence < 1 || decision.confidence > 100) return "cio_schema_invalid_confidence";
  if (typeof decision.thesis !== "string" || !decision.thesis.trim()) return "cio_schema_invalid_thesis";
  if (!Array.isArray(decision.evidenceRefs) || !Array.isArray(decision.claims) || !Array.isArray(decision.targets) || !Array.isArray(decision.noTradeConditions)) {
    return "cio_schema_invalid_arrays";
  }
  if (decision.modelStatus !== "AI" && !(snapshot.runMode === "UAT_REPLAY" && decision.modelStatus === "FIXTURE_REPLAY")) {
    return `cio_model_${decision.modelStatus || "unknown"}`;
  }
  if (decision.evidenceRefs.length === 0 || decision.claims.length === 0) return "cio_evidence_missing";
  if (decision.claims.some((claim) => !claim.text.trim() || claim.evidenceRefs.length === 0)) return "cio_claims_invalid";
  const allEvidenceRefs = [...decision.evidenceRefs, ...decision.claims.flatMap((claim) => claim.evidenceRefs)];
  const missingEvidence = allEvidenceRefs.filter((reference) => !(reference in snapshot.facts));
  if (missingEvidence.length > 0) return `cio_evidence_not_in_snapshot:${missingEvidence.join(",")}`;
  if (directionalActions.has(decision.action)) {
    if (!decision.entry || !decision.invalidation || decision.targets.length === 0) {
      return "cio_direction_missing_trade_levels";
    }
  }
  if (decision.action === "HOLD" && (decision.entry !== null || decision.invalidation !== null || decision.targets.length > 0)) {
    return "cio_hold_has_trade_levels";
  }
  return null;
};

export const getCioValidationFailure = validateCioDecision;

const positionDirectiveFor = (action: SpxDecisionAction, currentPosition: SpxPosition): SpxPositionDirective => {
  if (currentPosition === "PUT") return action === "CLOSE" ? "CLOSE_PUT" : "HOLD_PUT";
  if (currentPosition === "CALL") return action === "CLOSE" ? "CLOSE_CALL" : "HOLD_CALL";
  return "FLAT_WAIT";
};

export function applyPositionTransitionGuard(
  cioDecision: CioDecision,
  currentPosition: SpxPosition,
): { decision: CioDecision; failure: string | null; positionDirective: SpxPositionDirective } {
  if (currentPosition === "NONE" || !directionalActions.has(cioDecision.action)) {
    return {
      decision: cioDecision,
      failure: null,
      positionDirective: positionDirectiveFor(cioDecision.action, currentPosition),
    };
  }
  const failure = `position_transition_${cioDecision.action.toLowerCase()}_while_${currentPosition.toLowerCase()}`;
  return {
    decision: {
      ...cioDecision,
      action: "HOLD",
      thesis: `${cioDecision.thesis} Position transition rejected: close the existing ${currentPosition} before a new entry.`,
      entry: null,
      invalidation: null,
      targets: [],
      noTradeConditions: Array.from(new Set([...cioDecision.noTradeConditions, failure])),
    },
    failure,
    positionDirective: positionDirectiveFor("HOLD", currentPosition),
  };
}

export function getCanonicalGexRiskDirective(
  snapshot: MarketSnapshot,
  cioDecision: CioDecision,
): RiskGateDirective | null {
  if (!directionalActions.has(cioDecision.action)) return null;
  if (!cioDecision.evidenceRefs.some((reference) => reference.startsWith("gex."))) return null;

  const evidence = snapshot.replayEvidence?.gex;
  if (!evidence?.snapshotId || !evidence.payloadHash) {
    return { disposition: "VETO_TO_HOLD", reason: "canonical_gex_missing" };
  }
  if (evidence.schemaVersion !== CURRENT_GEX_SCHEMA_VERSION) {
    return {
      disposition: "VETO_TO_HOLD",
      reason: `canonical_gex_schema_mismatch:${evidence.schemaVersion}`,
    };
  }
  const freshness = snapshot.sourceFreshness.canonicalGex || snapshot.sourceFreshness.cboeD1;
  if (!freshness || freshness.status === "MISSING") {
    return { disposition: "VETO_TO_HOLD", reason: "canonical_gex_missing" };
  }
  if (freshness.status === "STALE" || (freshness.ageMs !== null && freshness.ageMs > 35 * 60_000)) {
    return { disposition: "VETO_TO_HOLD", reason: "canonical_gex_stale" };
  }
  return null;
}

export function applyRiskGate(
  cioDecision: CioDecision,
  directive: RiskGateDirective,
  currentPosition: SpxPosition,
): RiskGateResult {
  if (directive.disposition === "PASS") {
    return {
      action: cioDecision.action,
      disposition: directive.disposition,
      reason: directive.reason,
      cioAction: cioDecision.action,
      positionDirective: positionDirectiveFor(cioDecision.action, currentPosition),
    };
  }
  if (directive.disposition === "VETO_TO_HOLD") {
    return {
      action: "HOLD",
      disposition: directive.disposition,
      reason: directive.reason,
      cioAction: cioDecision.action,
      positionDirective: positionDirectiveFor("HOLD", currentPosition),
    };
  }
  if (directive.disposition === "REQUIRE_CLOSE") {
    const action = currentPosition === "NONE" ? "HOLD" : "CLOSE";
    return {
      action,
      disposition: directive.disposition,
      reason: directive.reason,
      cioAction: cioDecision.action,
      positionDirective: positionDirectiveFor(action, currentPosition),
    };
  }
  throw new Error(`Risk Gate cannot create directional action: ${String((directive as { disposition?: unknown }).disposition)}`);
}

const withFinalAction = (cio: CioDecision, risk: RiskGateResult): CioDecision => ({
  ...cio,
  action: risk.action,
  thesis: risk.disposition === "PASS" ? cio.thesis : `${cio.thesis} Risk Gate: ${risk.reason}`,
});

const appendLifecycle = async (
  dependencies: Pick<SpxDecisionPipelineDependencies, "clock" | "store">,
  runOrId: DecisionRunRecord | string,
  stage: SpxLifecycleStage,
  payload: Record<string, unknown> = {},
  latencyMs: number | null = null,
  attempt = 0,
) => {
  const occurredAt = nowIso(dependencies);
  const runId = typeof runOrId === "string" ? runOrId : runOrId.runId;
  if (typeof runOrId !== "string") {
    runOrId.currentStage = stage;
    runOrId.updatedAt = occurredAt;
    await dependencies.store.persistDecision(runOrId);
  }
  await dependencies.store.appendLifecycle({
    runId,
    stage,
    occurredAt,
    attempt,
    latencyMs,
    payload,
  });
};

const lifecyclePayloadForCouncil = (council: CouncilResult) => ({
  status: council.status,
  degradedReason: council.degradedReason || null,
  agents: council.agents.map((agent) => ({
    agent: agent.agent,
    decision: agent.decision,
    confidence: agent.confidence,
    modelStatus: agent.modelStatus,
    fallbackStatus: agent.fallbackStatus,
    evidenceRefs: agent.evidenceRefs,
    claims: agent.claims,
    latencyMs: agent.latencyMs,
  })),
});

const formatTelegramGexSection = (snapshot: MarketSnapshot): string[] => {
  const summary = snapshot.gexSummary;
  if (!summary) return ["🛰️ GEX｜Canonical snapshot 缺失；本輪不引用 GEX。"];

  const freshness = snapshot.sourceFreshness.canonicalGex?.status;
  const timeLabel = summary.snapshotTimeEt && summary.collectedTimeEt
    ? `${summary.snapshotTimeEt} ET snapshot · ${summary.collectedTimeEt} ET collected`
    : summary.displayTimeLabel || "snapshot time unavailable";
  const freshnessLabel = freshness && freshness !== "OK" ? ` · ${freshness}` : "";
  const engine = summary.source?.match(/\(([^)]+)\)\s*$/)?.[1] || "canonical_snapshot";
  const gammaRegime = summary.gammaStatus === "positive_gamma"
    ? "✅ Positive Gamma · 波動受抑"
    : summary.gammaStatus === "negative_gamma"
      ? "⚠️ Negative Gamma · 波動放大"
      : "Gamma regime 未知";
  const lines = [
    `🛰️ GEX｜${timeLabel}${freshnessLabel}`,
    `來源｜Canonical D1 · ${engine}`,
    `態勢｜${gammaRegime}`,
  ];

  if (Number.isFinite(summary.gammaFlipLevel)) {
    const relation = Number.isFinite(summary.spot)
      ? Number(summary.spot) > Number(summary.gammaFlipLevel)
        ? "現價在上方，偏多"
        : Number(summary.spot) < Number(summary.gammaFlipLevel)
          ? "現價在下方，偏空"
          : "現價貼近 Flip"
      : "現價關係未知";
    lines.push(`Gamma Flip｜${formatDisplayNumber(summary.gammaFlipLevel)} · ${relation}`);
  }

  const keyLevels = [
    Number.isFinite(summary.mostLongStrike)
      ? `🟢 SG High ${formatDisplayNumber(summary.mostLongStrike)} (${summary.mostLongGex || "數值缺失"})`
      : null,
    Number.isFinite(summary.mostShortStrike)
      ? `🔴 SG Low ${formatDisplayNumber(summary.mostShortStrike)} (${summary.mostShortGex || "數值缺失"})`
      : null,
  ].filter((value): value is string => Boolean(value));
  lines.push(keyLevels.length ? `關鍵｜${keyLevels.join(" · ")}` : "關鍵｜Canonical levels 缺失");

  const formatLevels = (levels: { strike: number; gex: string }[] | undefined) => (levels || [])
    .filter((level) => Number.isFinite(level.strike) && Boolean(level.gex))
    .slice(0, 3)
    .map((level) => `${formatDisplayNumber(level.strike)} (${level.gex})`)
    .join(" › ");
  const longWalls = formatLevels(summary.longWalls);
  const shortPockets = formatLevels(summary.shortPockets);
  if (longWalls) lines.push(`Long Walls｜${longWalls}`);
  if (shortPockets) lines.push(`Short Pockets｜${shortPockets}`);
  return lines;
};

const councilAgentIsValid = (agent: CouncilAgentAnalysis) => agent.valid
  ?? (agent.modelStatus === "AI" && !agent.fallbackStatus);

const humanizeModelFailure = (value: string | null | undefined) => {
  const reason = String(value || "").toLowerCase();
  if (reason.includes("pipeline_error")) return "決策管線中斷，模型未執行";
  if (reason.includes("invalid_token_budget")) return "GPT-5 輸出／推理 token 預算無效";
  if (reason.includes("unsupported_parameter")) return "GPT-5 請求參數不受 provider 支援";
  if (reason.includes("invalid_schema")) return "GPT-5 JSON schema 不被接受";
  if (reason.includes("invalid_request") || reason.includes("unknown_router_400")) return "GPT-5 請求契約被 Router 拒絕";
  if (reason.includes("provider_unavailable") || reason.includes("openrouter_404")) return "Azure GPT-5 provider 目前不可用";
  if (reason.includes("input_budget_exceeded")) return "模型輸入超出預算";
  if (reason.includes("unapproved_provider")) return "模型供應商不在批准清單";
  if (reason.includes("upstream_error")) return "上游模型服務失敗";
  if (reason.includes("missing_choice") || reason.includes("empty_content")) return "上游模型服務未產生內容";
  if (reason.includes("output_truncated")) return "模型輸出被截斷";
  if (reason.includes("deadline_exceeded")) return "Council 時間預算耗盡";
  if (reason.includes("output_not_json")) return "模型輸出不是有效 JSON";
  if (reason.includes("schema") || reason.includes("format")) {
    return "模型回應格式無效";
  }
  if (reason.includes("timeout") || reason.includes("timed out")) return "模型逾時";
  if (reason.includes("429") || reason.includes("rate_limit")) return "模型服務限流";
  if (reason.includes("401") || reason.includes("403") || reason.includes("unauthorized") || reason.includes("forbidden")) {
    return "模型授權失敗";
  }
  if (reason.includes("5xx") || /http_5\d\d/.test(reason)) return "模型服務暫時失敗";
  if (reason.includes("disabled") || reason.includes("skipped")) return "模型分析未啟用";
  if (reason.includes("market_data") || reason.includes("snapshot")) return "必要市場資料不足";
  return "模型分析失敗";
};

const modelAnalysisDidNotStart = (agent: CouncilAgentAnalysis) => agent.modelStatus === "SKIPPED"
  || ((agent.attempts?.length ?? 0) === 0 && String(agent.fallbackStatus || "").toLowerCase().includes("pipeline_error"));

const councilFailureSummary = (council: CouncilResult, cioDecision: CioDecision) => {
  const invalidAgents = expectedCouncilAgents
    .map((agentName) => council.agents.find((agent) => agent.agent === agentName))
    .filter((agent): agent is CouncilAgentAnalysis => Boolean(agent) && !councilAgentIsValid(agent as CouncilAgentAnalysis));
  if (invalidAgents.length) {
    const failures = invalidAgents
      .map((agent) => `${agent.agent} ${humanizeModelFailure(agent.fallbackStatus || agent.modelStatus || agent.reasoning).replace("模型回應格式無效", "模型格式無效")}`)
      .join("、");
    return `Council 未完整：${failures}；CIO 按契約未執行。`;
  }
  if (council.agents.length !== expectedCouncilAgents.length) {
    return "Council 未完整：agent 數量或身份不符；CIO 按契約未執行。";
  }
  if (cioDecision.modelStatus !== "AI") {
    return `CIO 未完成：${humanizeModelFailure(cioDecision.modelStatus)}；按契約保持觀望。`;
  }
  return "必要市場資料未完整；Council 與 CIO 按契約未執行。";
};

const formatCouncilAgentLines = (council: CouncilResult) => {
  const decisionLabel: Record<CouncilAgentAnalysis["decision"], string> = {
    CALL: "Call",
    PUT: "Put",
    HOLD: "觀望",
  };
  const decisionEmoji: Record<CouncilAgentAnalysis["decision"], string> = {
    CALL: "🟢",
    PUT: "🔴",
    HOLD: "⚪",
  };
  const agentEmoji: Record<string, string> = {
    QM: "📈",
    CM: "🧲",
    NT: "🌪️",
    PA: "🕯️",
  };
  const compactReason = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 96);
  return expectedCouncilAgents.map((agentName) => {
    const agent = council.agents.find((candidate) => candidate.agent === agentName);
    if (!agent) {
      return `${agentEmoji[agentName]} ${agentName}｜⚫ 無效 — Council agent 結果缺失。`;
    }
    const valid = councilAgentIsValid(agent);
    const failure = humanizeModelFailure(agent.fallbackStatus || agent.modelStatus || agent.reasoning);
    const reasoning = valid
      ? compactReason(String(agent.reasoning || "未提供可審計 reasoning。"))
      : modelAnalysisDidNotStart(agent)
        ? `${failure}。`
        : `${failure}；重試後仍無法驗證。`;
    return valid
      ? `${agentEmoji[agent.agent]} ${agent.agent}｜${decisionEmoji[agent.decision]} ${decisionLabel[agent.decision]} · ${safeConfidence(agent.confidence)}% — ${reasoning}`
      : `${agentEmoji[agent.agent]} ${agent.agent}｜⚫ 無效 — ${compactReason(reasoning)}`;
  });
};

export function formatTelegramDecisionMessage(input: TelegramDecisionMessageInput) {
  const { run, snapshot, council, cioDecision, riskGate, openPosition } = input;
  const tally = council.agents.reduce((result, agent) => {
    const bucket = councilAgentIsValid(agent) ? agent.decision : "INVALID";
    result[bucket] = (result[bucket] || 0) + 1;
    return result;
  }, {} as Record<string, number>);
  const actionLabel: Record<SpxDecisionAction, string> = {
    OPEN_CALL: "買入 Call",
    OPEN_PUT: "買入 Put",
    HOLD: "觀望",
    CLOSE: "平倉",
  };
  const positionActionLabel: Record<SpxPositionDirective, string> = {
    FLAT_WAIT: actionLabel[riskGate.action],
    HOLD_CALL: "持有 Call",
    HOLD_PUT: "持有 Put",
    CLOSE_CALL: "平倉 Call",
    CLOSE_PUT: "平倉 Put",
  };
  const scheduledEtParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(run.scheduledAt));
  const scheduledEt = Object.fromEntries(scheduledEtParts.map((part) => [part.type, part.value]));
  const spxLast = Number(snapshot.facts["spx.last"]);
  const spxLabel = Number.isFinite(spxLast) ? spxLast.toFixed(2) : "N/A";
  const actionEmoji: Record<SpxDecisionAction, string> = {
    OPEN_CALL: "🟢",
    OPEN_PUT: "🔴",
    HOLD: "🟡",
    CLOSE: "⚪",
  };
  const dataLabel = snapshot.dataQuality.status === "OK"
    ? "正常"
    : snapshot.dataQuality.status === "WARN" ? "警告" : "阻擋";
  const replayLabel: Record<SpxReplayGrade, string> = {
    NORMALIZED_CANONICAL: "標準化可重播",
    PARTIAL_NORMALIZED: "部分標準化",
    UNAVAILABLE: "不可重播",
  };
  const riskReason = (() => {
    if (riskGate.disposition === "PASS") return "未觸發安全否決";
    if (riskGate.reason === "canonical_gex_missing") return "Canonical GEX 缺失，禁止方向性開倉";
    if (riskGate.reason === "canonical_gex_stale") return "Canonical GEX 超過 35 分鐘，禁止方向性開倉";
    if (riskGate.reason.startsWith("canonical_gex_schema_mismatch")) return "Canonical GEX schema 不相容，禁止方向性開倉";
    if (riskGate.reason === "end_of_day_flatten") return "收市前策略平倉；不留策略過夜倉";
    if (riskGate.disposition === "REQUIRE_CLOSE") return "安全條件要求關閉現有持倉";
    return "安全條件未通過，方向性交易已否決";
  })();
  const compactPlanText = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 150);
  const lines: Array<string | null> = [
    run.runMode === "UAT_LLM" ? "SYSTEM UAT｜非即時訊號｜不可交易" : null,
    `SPX: ${spxLabel} 操作：${positionActionLabel[riskGate.positionDirective]}`,
    `⏱️ 美東時間：${scheduledEt.year}/${scheduledEt.month}/${scheduledEt.day} ${scheduledEt.hour}:${scheduledEt.minute}:${scheduledEt.second} ET｜標的：SPX`,
    run.runMode === "UAT_REPLAY" ? "🧪 UAT REPLAY｜非即時訊號，只用固定歷史 fixture 驗證流水線。" : null,
    ...formatTelegramGexSection(snapshot),
    "📊 Council",
    `🟢 Call ${tally.CALL || 0}｜🔴 Put ${tally.PUT || 0}｜⚪ 觀望 ${tally.HOLD || 0}｜⚫ 無效 ${tally.INVALID || 0}`,
    ...formatCouncilAgentLines(council),
    run.degraded ? `⚠️ 降級｜${councilFailureSummary(council, cioDecision)}` : null,
    `🧠 CIO｜${actionEmoji[cioDecision.action]} ${cioDecision.action} · ${safeConfidence(cioDecision.confidence)}%`,
  ];

  const holdingPosition = riskGate.positionDirective === "HOLD_CALL" || riskGate.positionDirective === "HOLD_PUT";
  if (holdingPosition) {
    const sideLabel = riskGate.positionDirective === "HOLD_PUT" ? "Put" : "Call";
    lines.push(`⏸️ 計劃｜${run.degraded ? `CIO 本輪未完成，維持現有 ${sideLabel}。` : `維持現有 ${sideLabel}。`}`);
    if (openPosition?.entryTime || openPosition?.entryPrice !== null) {
      const entryPrice = openPosition?.entryPrice === null || openPosition?.entryPrice === undefined
        ? "N/A"
        : formatDisplayNumber(openPosition.entryPrice);
      lines.push(`🧾 入場｜${openPosition?.entryTime || "時間未記錄"} ET · SPX ${entryPrice}`);
    }
    if (openPosition?.invalidation) lines.push(`🛑 失效｜${compactPlanText(openPosition.invalidation)}`);
    if (openPosition?.targets.length) lines.push(`🏁 目標｜${openPosition.targets.slice(0, 2).map(compactPlanText).join(" · ")}`);
  } else if (riskGate.action === "HOLD") {
    lines.push(`⏸️ 計劃｜不開倉；${run.degraded ? "等待下一個完整決策週期。" : "等待條件成立。"}`);
  } else if (riskGate.action === "CLOSE") {
    lines.push(riskGate.reason === "end_of_day_flatten"
      ? "⏸️ 計劃｜收市前策略平倉；不留策略過夜倉。"
      : "⏸️ 計劃｜關閉現有持倉，不建立反方向倉位。"
    );
  } else {
    if (cioDecision.entry) lines.push(`🎯 進場｜${compactPlanText(cioDecision.entry)}`);
    if (cioDecision.invalidation) lines.push(`🛑 失效｜${compactPlanText(cioDecision.invalidation)}`);
    if (cioDecision.targets.length) lines.push(`🏁 目標｜${cioDecision.targets.slice(0, 2).map(compactPlanText).join(" · ")}`);
    if (cioDecision.noTradeConditions.length) lines.push(`🚫 不交易｜${compactPlanText(cioDecision.noTradeConditions[0])}`);
  }

  lines.push(
    riskGate.disposition === "PASS" ? "🛡️ 風控｜PASS" : `🛡️ 風控｜${riskGate.disposition} · ${riskReason}`,
    snapshot.dataQuality.status === "OK" ? null : `⚠️ 資料｜${dataLabel} · ${replayLabel[snapshot.replayGrade]}`,
    `🔎 Run｜${run.runId}`,
    snapshot.boardDeepLink ? `🔗 Board｜${snapshot.boardDeepLink}` : null,
  );
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

const buildEmptyCouncil = (reason: string): CouncilResult => ({
  status: "DEGRADED",
  degradedReason: reason,
  latencyMs: 0,
  agents: expectedCouncilAgents.map((agent) => ({
    agent: agent as CouncilAgentAnalysis["agent"],
    decision: "HOLD",
    confidence: 0,
    evidenceRefs: [],
    claims: [],
    modelStatus: "SKIPPED",
    fallbackStatus: reason,
    latencyMs: 0,
    reasoning: reason,
    valid: false,
    attempts: [],
  })),
});

const makeRunRecord = (input: SpxDecisionPipelineInput, at: string): DecisionRunRecord => ({
  runId: input.runId,
  scheduledAt: input.scheduledAt.toISOString(),
  currentStage: "SCHEDULED",
  snapshot: null,
  council: null,
  cioDecision: null,
  riskGate: null,
  finalDecision: null,
  finalAction: null,
  degraded: false,
  degradedReason: null,
  createdAt: at,
  updatedAt: at,
  runMode: input.runMode || "LIVE",
});

const resultFromExisting = async (
  runId: string,
  dependencies: SpxDecisionPipelineDependencies,
): Promise<SpxDecisionPipelineResult> => {
  const run = await dependencies.store.getRun(runId);
  const outbox = await dependencies.store.getOutbox(runId);
  if (!run) throw new Error(`duplicate run ${runId} is not queryable`);
  const fallback = run.finalDecision || holdDecision("duplicate_run_in_progress", "DUPLICATE");
  const delivery = outbox || {
    runId,
    message: "",
    status: "PENDING" as const,
    attemptCount: 0,
    telegramMessageId: null,
    lastError: null,
    nextAttemptAt: null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
  return { run, finalDecision: fallback, delivery, duplicate: true };
};

export async function runSpxDecisionPipeline(
  input: SpxDecisionPipelineInput,
  dependencies: SpxDecisionPipelineDependencies,
): Promise<SpxDecisionPipelineResult> {
  const createdAt = nowIso(dependencies);
  const run = makeRunRecord(input, createdAt);
  const started = dependencies.clock.now().getTime();
  const isNew = await dependencies.store.beginRun(run);
  if (!isNew) return resultFromExisting(input.runId, dependencies);

  await appendLifecycle(dependencies, run, "SCHEDULED", { scheduledAt: run.scheduledAt });

  const lockAcquired = dependencies.lock ? await dependencies.lock.acquire(input.runId) : true;
  if (!lockAcquired) {
    run.degraded = true;
    run.degradedReason = "lock_not_acquired";
    run.updatedAt = nowIso(dependencies);
    await dependencies.store.persistDecision(run);
    return {
      run,
      finalDecision: holdDecision("lock_not_acquired", "LOCK_FAILED"),
      delivery: {
        runId: run.runId,
        message: "",
        status: "PENDING",
        attemptCount: 0,
        telegramMessageId: null,
        lastError: null,
        nextAttemptAt: null,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      },
      duplicate: false,
    };
  }
  run.currentStage = "LOCK_ACQUIRED";
  await appendLifecycle(dependencies, run, "LOCK_ACQUIRED", {}, toLatency(started, dependencies));

  const snapshotStarted = dependencies.clock.now().getTime();
  let snapshot: MarketSnapshot;
  try {
    snapshot = await dependencies.marketData.load(input.runId, input.scheduledAt);
    snapshot.runMode = input.runMode || snapshot.runMode || "LIVE";
  } catch (error) {
    const reason = `market_data_${isTimeoutError(error) ? "timeout" : "failed"}:${asErrorMessage(error)}`;
    snapshot = {
      runId: input.runId,
      scheduledAt: input.scheduledAt.toISOString(),
      snapshotAt: nowIso(dependencies),
      sourceFreshness: {},
      dataQuality: { status: "BLOCK", hardBlocks: [reason], warnings: [] },
      facts: {},
      boardDeepLink: null,
      replayGrade: "UNAVAILABLE",
      replayEvidence: null,
      rawSnapshotAvailable: false,
      runMode: input.runMode || "LIVE",
    };
  }
  if (snapshot.runId !== input.runId) {
    throw new Error(`snapshot run_id mismatch: expected ${input.runId}, received ${snapshot.runId}`);
  }
  run.snapshot = snapshot;
  run.currentStage = "SNAPSHOT_READY";
  await appendLifecycle(dependencies, run, "SNAPSHOT_READY", {
    snapshotAt: snapshot.snapshotAt,
    sourceFreshness: snapshot.sourceFreshness,
    dataQuality: snapshot.dataQuality,
    normalizedContextPersisted: Boolean(snapshot.normalizedContext),
    replayGrade: snapshot.replayGrade,
    replayEvidencePersisted: Boolean(snapshot.replayEvidence),
    vendorRawPayloadsPersisted: snapshot.rawSnapshotAvailable,
  }, toLatency(snapshotStarted, dependencies));

  const councilStarted = dependencies.clock.now().getTime();
  let council: CouncilResult;
  if (snapshot.dataQuality.status === "BLOCK") {
    council = buildEmptyCouncil(`market_data_block:${snapshot.dataQuality.hardBlocks.join(",")}`);
  } else {
    try {
      council = await dependencies.council.analyze(snapshot);
    } catch (error) {
      const reason = `council_${isTimeoutError(error) ? "timeout" : "failed"}:${asErrorMessage(error)}`;
      council = buildEmptyCouncil(reason);
    }
  }
  const councilFailure = validateCouncil(council, snapshot);
  if (councilFailure) {
    council = { ...council, status: "DEGRADED", degradedReason: councilFailure };
    run.degraded = true;
    run.degradedReason = councilFailure;
  }
  run.council = council;
  run.currentStage = "COUNCIL_COMPLETED";
  await appendLifecycle(dependencies, run, "COUNCIL_COMPLETED", lifecyclePayloadForCouncil(council), toLatency(councilStarted, dependencies));

  const cioStarted = dependencies.clock.now().getTime();
  let cioDecision: CioDecision;
  if (council.status === "DEGRADED") {
    cioDecision = holdDecision(council.degradedReason || "council_degraded", "COUNCIL_DEGRADED");
  } else {
    try {
      cioDecision = await dependencies.cio.decide(snapshot, council);
    } catch (error) {
      const status = isTimeoutError(error) ? "TIMEOUT" : "REQUEST_FAILED";
      const reason = `cio_${status.toLowerCase()}:${asErrorMessage(error)}`;
      cioDecision = holdDecision(reason, status);
      run.degraded = true;
      run.degradedReason = reason;
    }
  }
  const cioValidationFailure = validateCioDecision(cioDecision, snapshot);
  if (cioValidationFailure) {
    const failureReason = run.degradedReason || cioValidationFailure;
    cioDecision = holdDecision(failureReason, run.degraded ? cioDecision.modelStatus : "INVALID_SCHEMA");
    run.degraded = true;
    run.degradedReason = failureReason;
  }
  const positionTransition = applyPositionTransitionGuard(cioDecision, input.currentPosition);
  if (positionTransition.failure) {
    cioDecision = positionTransition.decision;
    run.degraded = true;
    run.degradedReason = positionTransition.failure;
  }
  cioDecision.confidence = safeConfidence(cioDecision.confidence);
  cioDecision.latencyMs = cioDecision.latencyMs || toLatency(cioStarted, dependencies);
  run.cioDecision = cioDecision;
  run.currentStage = "CIO_DECIDED";
  await appendLifecycle(dependencies, run, "CIO_DECIDED", {
    decision: cioDecision,
    positionTransitionValidation: positionTransition.failure,
    positionDirective: positionTransition.positionDirective,
  }, toLatency(cioStarted, dependencies));

  const riskStarted = dependencies.clock.now().getTime();
  let directive: RiskGateDirective;
  const canonicalGexDirective = getCanonicalGexRiskDirective(snapshot, cioDecision);
  if (canonicalGexDirective) {
    directive = canonicalGexDirective;
    run.degraded = true;
    run.degradedReason = directive.reason;
  } else {
    try {
      directive = await dependencies.riskGate.evaluate(snapshot, council, cioDecision);
    } catch (error) {
      directive = input.currentPosition === "NONE"
        ? { disposition: "VETO_TO_HOLD", reason: `risk_gate_failed:${asErrorMessage(error)}` }
        : { disposition: "REQUIRE_CLOSE", reason: `risk_gate_failed:${asErrorMessage(error)}` };
      run.degraded = true;
      run.degradedReason = directive.reason;
    }
  }
  const riskGate = applyRiskGate(cioDecision, directive, input.currentPosition);
  const finalDecision = withFinalAction(cioDecision, riskGate);
  run.riskGate = riskGate;
  run.finalDecision = finalDecision;
  run.finalAction = finalDecision.action;
  run.currentStage = "RISK_GATED";
  run.updatedAt = nowIso(dependencies);
  await appendLifecycle(dependencies, run, "RISK_GATED", { riskGate, finalAction: finalDecision.action }, toLatency(riskStarted, dependencies));

  await dependencies.store.persistDecision(run);
  run.currentStage = "PERSISTED";
  run.updatedAt = nowIso(dependencies);
  await appendLifecycle(dependencies, run, "PERSISTED", {
    finalAction: run.finalAction,
    degraded: run.degraded,
    degradedReason: run.degradedReason,
  });
  await dependencies.store.persistDecision(run);

  const render = dependencies.renderMessage || formatTelegramDecisionMessage;
  const message = render({
    run,
    snapshot,
    council,
    cioDecision,
    riskGate,
    openPosition: input.openPosition || null,
  });
  const delivery = await dispatchSpxDecisionDelivery({
    runId: input.runId,
    message,
    mode: "SEND",
  }, dependencies);
  if (!delivery) throw new Error("scheduled decision delivery unexpectedly resolved to preview");
  const finalRun = await dependencies.store.getRun(input.runId) || run;
  return { run: finalRun, finalDecision, delivery, duplicate: false };
}

export async function dispatchSpxDecisionDelivery(
  input: { runId: string; message: string; mode: SpxDeliveryMode },
  dependencies: SpxDeliveryDependencies,
): Promise<OutboxRecord | null> {
  if (input.mode === "PREVIEW") return null;
  const createdAt = nowIso(dependencies);
  await dependencies.store.enqueueOutbox({
    runId: input.runId,
    message: input.message,
    status: "PENDING",
    attemptCount: 0,
    telegramMessageId: null,
    lastError: null,
    nextAttemptAt: null,
    createdAt,
    updatedAt: createdAt,
  });
  return retrySpxDelivery(input.runId, dependencies);
}

export async function retrySpxDelivery(
  runId: string,
  dependencies: SpxDeliveryDependencies,
): Promise<OutboxRecord> {
  const existing = await dependencies.store.getOutbox(runId);
  if (!existing) throw new Error(`outbox not found for run ${runId}`);
  if (existing.status === "DELIVERED") return existing;

  const attemptedAt = nowIso(dependencies);
  const attempting = await dependencies.store.markDeliveryAttempt(runId, attemptedAt);
  if (attempting.status === "DELIVERED") return attempting;
  await appendLifecycle(dependencies, runId, "DELIVERY_ATTEMPTED", {
    retry: attempting.attemptCount > 1,
  }, null, attempting.attemptCount);

  try {
    const result = await dependencies.telegram.send(attempting.message);
    const deliveredAt = nowIso(dependencies);
    const delivered = await dependencies.store.markDelivered(runId, result.messageId, deliveredAt);
    await appendLifecycle(dependencies, runId, "DELIVERED", {
      telegramMessageId: result.messageId,
    }, null, attempting.attemptCount);
    return delivered;
  } catch (error) {
    const message = asErrorMessage(error);
    const failedAt = nowIso(dependencies);
    const nextAttemptAt = new Date(
      dependencies.clock.now().getTime() + (dependencies.deliveryRetryDelayMs ?? 60_000),
    ).toISOString();
    await appendLifecycle(dependencies, runId, "DELIVERY_FAILED", {
      error: message,
      retryable: true,
      nextAttemptAt,
    }, null, attempting.attemptCount);
    return dependencies.store.markDeliveryFailed(runId, message, nextAttemptAt, failedAt);
  }
}

export function findMissingScheduledRuns(expectedRunIds: string[], store: SpxDecisionStore) {
  return expectedRunIds.filter((runId) => {
    const value = store.hasRun(runId);
    if (value instanceof Promise) {
      throw new Error("findMissingScheduledRuns requires a synchronous store; use the D1 lifecycle query for production");
    }
    return !value;
  });
}

export class InMemorySpxDecisionStore implements SpxDecisionStore {
  private readonly runs = new Map<string, DecisionRunRecord>();
  private readonly lifecycle = new Map<string, LifecycleEvent[]>();
  private readonly outbox = new Map<string, OutboxRecord>();

  beginRun(record: DecisionRunRecord) {
    if (this.runs.has(record.runId)) return false;
    this.runs.set(record.runId, structuredClone(record));
    this.lifecycle.set(record.runId, []);
    return true;
  }

  appendLifecycle(event: LifecycleEvent) {
    const events = this.lifecycle.get(event.runId);
    if (!events) throw new Error(`run not found: ${event.runId}`);
    const duplicate = events.some((item) => item.stage === event.stage && item.attempt === event.attempt);
    if (!duplicate) events.push(structuredClone(event));
    const run = this.runs.get(event.runId);
    if (run) {
      run.currentStage = event.stage;
      run.updatedAt = event.occurredAt;
    }
  }

  persistDecision(record: DecisionRunRecord) {
    if (!this.runs.has(record.runId)) throw new Error(`run not found: ${record.runId}`);
    this.runs.set(record.runId, structuredClone(record));
  }

  getRun(runId: string) {
    const run = this.runs.get(runId);
    return run ? structuredClone(run) : null;
  }

  getLifecycle(runId: string) {
    return structuredClone(this.lifecycle.get(runId) || []);
  }

  enqueueOutbox(record: OutboxRecord) {
    if (!this.outbox.has(record.runId)) this.outbox.set(record.runId, structuredClone(record));
  }

  getOutbox(runId: string) {
    const record = this.outbox.get(runId);
    return record ? structuredClone(record) : null;
  }

  markDeliveryAttempt(runId: string, at: string) {
    const record = this.requireOutbox(runId);
    if (record.status === "DELIVERED") return structuredClone(record);
    if (record.status === "SENDING") throw new Error(`outbox delivery already in progress for run ${runId}`);
    record.status = "SENDING";
    record.attemptCount += 1;
    record.updatedAt = at;
    return structuredClone(record);
  }

  markDeliveryFailed(runId: string, error: string, nextAttemptAt: string, at: string) {
    const record = this.requireOutbox(runId);
    record.status = "FAILED";
    record.lastError = error;
    record.nextAttemptAt = nextAttemptAt;
    record.updatedAt = at;
    return structuredClone(record);
  }

  markDelivered(runId: string, telegramMessageId: string, at: string) {
    const record = this.requireOutbox(runId);
    record.status = "DELIVERED";
    record.telegramMessageId = telegramMessageId;
    record.lastError = null;
    record.nextAttemptAt = null;
    record.updatedAt = at;
    return structuredClone(record);
  }

  hasRun(runId: string) {
    return this.runs.has(runId);
  }

  private requireOutbox(runId: string) {
    const record = this.outbox.get(runId);
    if (!record) throw new Error(`outbox not found for run ${runId}`);
    return record;
  }
}
