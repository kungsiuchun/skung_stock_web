import type { SpxGexTelegramSummary } from "./spx-gex-heatmap";

export type SpxDecisionAction = "OPEN_CALL" | "OPEN_PUT" | "HOLD" | "CLOSE";
export type SpxPosition = "NONE" | "CALL" | "PUT";
export type SpxDeliveryMode = "SEND" | "PREVIEW";

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
}

export interface CouncilAgentAnalysis {
  agent: "QM" | "CM" | "NT" | "PA";
  decision: "OPEN_CALL" | "OPEN_PUT" | "HOLD";
  confidence: number;
  evidenceRefs: string[];
  modelStatus: string;
  fallbackStatus: string | null;
  latencyMs: number;
  reasoning?: string;
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
  modelStatus: string;
  latencyMs: number;
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
  modelStatus,
  latencyMs: 0,
});

const validateCouncil = (council: CouncilResult) => {
  if (council.status !== "OK") return council.degradedReason || "council_degraded";
  if (council.agents.length !== expectedCouncilAgents.length) return "council_agent_count_invalid";
  const observed = new Set(council.agents.map((agent) => agent.agent));
  if (expectedCouncilAgents.some((agent) => !observed.has(agent as CouncilAgentAnalysis["agent"]))) {
    return "council_agent_set_invalid";
  }
  const failedAgent = council.agents.find((agent) => agent.modelStatus !== "AI" || Boolean(agent.fallbackStatus));
  if (failedAgent) return `council_${failedAgent.agent.toLowerCase()}_${failedAgent.fallbackStatus || failedAgent.modelStatus}`;
  return null;
};

const validateCioDecision = (decision: CioDecision, snapshot: MarketSnapshot) => {
  if (!decision || !allowedCioActions.has(decision.action)) return "cio_schema_invalid_action";
  if (!Number.isFinite(Number(decision.confidence))) return "cio_schema_invalid_confidence";
  if (typeof decision.thesis !== "string" || !decision.thesis.trim()) return "cio_schema_invalid_thesis";
  if (!Array.isArray(decision.evidenceRefs) || !Array.isArray(decision.targets) || !Array.isArray(decision.noTradeConditions)) {
    return "cio_schema_invalid_arrays";
  }
  if (decision.modelStatus !== "AI") return `cio_model_${decision.modelStatus || "unknown"}`;
  if (directionalActions.has(decision.action)) {
    if (decision.evidenceRefs.length === 0) return "cio_direction_missing_evidence";
    const missingEvidence = decision.evidenceRefs.filter((reference) => !(reference in snapshot.facts));
    if (missingEvidence.length > 0) return `cio_evidence_not_in_snapshot:${missingEvidence.join(",")}`;
    if (!decision.entry || !decision.invalidation || decision.targets.length === 0) {
      return "cio_direction_missing_trade_levels";
    }
  }
  return null;
};

export const getCioValidationFailure = validateCioDecision;

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
    return { action: cioDecision.action, disposition: directive.disposition, reason: directive.reason, cioAction: cioDecision.action };
  }
  if (directive.disposition === "VETO_TO_HOLD") {
    return { action: "HOLD", disposition: directive.disposition, reason: directive.reason, cioAction: cioDecision.action };
  }
  if (directive.disposition === "REQUIRE_CLOSE") {
    const action = currentPosition === "NONE" ? "HOLD" : "CLOSE";
    return { action, disposition: directive.disposition, reason: directive.reason, cioAction: cioDecision.action };
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

export function formatTelegramDecisionMessage(input: TelegramDecisionMessageInput) {
  const { run, snapshot, council, cioDecision, riskGate } = input;
  const tally = council.agents.reduce((result, agent) => {
    result[agent.decision] = (result[agent.decision] || 0) + 1;
    return result;
  }, {} as Record<string, number>);
  const factLabels: Record<string, string> = {
    "spx.last": "SPX",
    "spx.vwap": "VWAP",
    "spx.ema9": "EMA9",
    "gex.gammaFlip": "Gamma Flip",
    "gex.callWall": "Call Wall",
    "gex.putWall": "Put Wall",
    "gex.netGex": "Net GEX",
    "gex.totalNet": "Net GEX",
  };
  const evidence = cioDecision.evidenceRefs
    .filter((reference) => reference in snapshot.facts)
    .map((reference) => `${factLabels[reference] || reference} ${formatDisplayNumber(snapshot.facts[reference])}`);
  const actionHeader: Record<SpxDecisionAction, string> = {
    OPEN_CALL: "🟢 SPX｜CALL 機會",
    OPEN_PUT: "🔴 SPX｜PUT 機會",
    HOLD: "🟡 SPX｜觀望",
    CLOSE: "⚪ SPX｜平倉",
  };
  const modelComplete = cioDecision.modelStatus === "AI";
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
    if (riskGate.disposition === "REQUIRE_CLOSE") return "安全條件要求關閉現有持倉";
    return "安全條件未通過，方向性交易已否決";
  })();
  const lines: Array<string | null> = [
    run.degraded ? "⚠️ SPX｜降級觀望" : actionHeader[riskGate.action],
    `判斷｜${run.degraded ? "本輪分析未完整，按契約保持觀望。" : cioDecision.thesis}`,
    ...formatTelegramGexSection(snapshot),
    `議會｜Call ${tally.OPEN_CALL || 0} · Put ${tally.OPEN_PUT || 0} · 觀望 ${tally.HOLD || 0}`,
    `CIO｜${cioDecision.action} · ${safeConfidence(cioDecision.confidence)}% · ${modelComplete ? "完成" : "未完成"}`,
    evidence.length ? `依據｜${evidence.join(" · ")}` : null,
  ];

  if (riskGate.action === "HOLD") {
    lines.push(`計劃｜不開倉；${run.degraded ? "等待下一個完整決策週期。" : "等待條件成立。"}`);
  } else if (riskGate.action === "CLOSE") {
    lines.push("計劃｜關閉現有持倉，不建立反方向倉位。");
  } else {
    if (cioDecision.entry) lines.push(`進場｜${cioDecision.entry}`);
    if (cioDecision.invalidation) lines.push(`失效｜${cioDecision.invalidation}`);
    if (cioDecision.targets.length) lines.push(`目標｜${cioDecision.targets.join(" · ")}`);
    if (cioDecision.noTradeConditions.length) lines.push(`不交易｜${cioDecision.noTradeConditions.join(" · ")}`);
  }

  lines.push(
    `風控｜${riskGate.disposition} · ${riskReason}`,
    `資料｜${dataLabel} · ${replayLabel[snapshot.replayGrade]}`,
    `狀態｜${run.degraded ? "DEGRADED · 分析未完整" : "NORMAL"}`,
    `Run｜${run.runId}`,
    snapshot.boardDeepLink ? `Board｜${snapshot.boardDeepLink}` : null,
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
    modelStatus: "SKIPPED",
    fallbackStatus: reason,
    latencyMs: 0,
    reasoning: reason,
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
  const councilFailure = validateCouncil(council);
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
  cioDecision.confidence = safeConfidence(cioDecision.confidence);
  cioDecision.latencyMs = cioDecision.latencyMs || toLatency(cioStarted, dependencies);
  run.cioDecision = cioDecision;
  run.currentStage = "CIO_DECIDED";
  await appendLifecycle(dependencies, run, "CIO_DECIDED", { decision: cioDecision }, toLatency(cioStarted, dependencies));

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
  const message = render({ run, snapshot, council, cioDecision, riskGate });
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
