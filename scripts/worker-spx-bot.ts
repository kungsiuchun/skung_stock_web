import { RSI, BollingerBands, SMA, MACD, EMA } from 'technicalindicators';
import { PERSONAS, ORCHESTRATOR_PROMPT, AUDIT_AGENT_PROMPT } from './prompts';
import { readFinalSignalPerformance, readPendingFinalSignalOutcomes, updateFinalSignalOutcome, upsertFinalSignalOutcome, upsertRecapDay, type D1DatabaseLike } from '../src/lib/spx-recap-d1';
import { generateAndStoreSpxGexHeatmap, getSpxGexGenerationStatus, readSpxGexHeatmap, SpxGexSnapshotValidationError, toTelegramGexSummary, type SpxGexDataClient, type SpxGexHeatmapModel, type SpxGexTelegramSummary } from '../src/lib/spx-gex-heatmap';
import { createCboeOnlySpxGexDataClient, createSpxGexIntradayDataClient } from '../src/lib/spx-gex-cboe';
import {
  applyRiskGate,
  applyPositionTransitionGuard,
  dispatchSpxDecisionDelivery,
  formatTelegramDecisionMessage,
  getCanonicalGexRiskDirective,
  getCioValidationFailure,
  NT_VOLATILITY_RISK_PROMPT,
  resolveSpxDeliveryMode,
  retrySpxDelivery,
  runSpxDecisionPipeline,
  InMemorySpxDecisionStore,
  type CioDecision,
  type CouncilResult,
  type DecisionRunRecord,
  type MarketSnapshot,
  type ModelAttemptMetadata,
  type RiskGateDirective,
  type SpxDeliveryMode,
  type SpxLifecycleStage,
  type SpxOpenPositionContext,
  type SpxPosition,
  resolveSpxDecisionStatus,
} from '../src/lib/spx-decision-pipeline';
import { D1SpxDecisionStore, queryLifecycleCoverage } from '../src/lib/spx-decision-ledger';
import { D1SpxGexCollectionStore, querySpxGexCollectionCoverage } from '../src/lib/spx-gex-collection-lifecycle';
import { D1SpxOperationalHealthStore, classifySpxOperationalFailure, type SpxOperationalJob } from '../src/lib/spx-operational-health';
import {
  EMPTY_SPX_SCHEDULER_STATE,
  SPX_GEX_OPENING_COLLECTION_MINUTE_ET,
  SPX_GEX_OPENING_SNAPSHOT_MINUTE_ET,
  SPX_SCHEDULER_STORAGE_KEY,
  advanceSpxGexOpeningRetryState,
  canonicalQuarterHourUtc,
  createSpxGexOpeningRetryState,
  dueMissingRunIds,
  nextSchedulerAlarmAt,
  shouldRunScheduledTick,
  type SpxSchedulerState,
} from '../src/lib/spx-market-scheduler';
import { runSpxDecisionRun } from '../src/lib/spx-decision-run';
import { buildSpxMarketSnapshot, normalizeSpxReplaySeries } from '../src/lib/spx-market-snapshot';
import { runSpxRetention, SPX_KV_RETENTION_SECONDS } from '../src/lib/spx-retention';

// Cloudflare Worker Environment Types
interface Env {
  TELEGRAM_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL?: string;
  SPX_COUNCIL_MODEL?: string;
  SPX_CIO_MODEL?: string;
  SPX_BOARD_URL?: string;
  SPX_ENABLE_LLM_COUNCIL?: string;
  SPX_ENABLE_LLM_CIO?: string;
  WEBHOOK_SECRET?: string; // 🔒 防護互聯網隨機觸發的安全金鑰
  SPX_MEMORY: any;
  SPX_SCHEDULER: SpxSchedulerNamespace;
  SPX_RECAP_DB?: D1DatabaseLike;
  CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string };
}

interface SpxSchedulerStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
}

interface SpxSchedulerStateHandle { storage: SpxSchedulerStorage; }
interface SpxSchedulerStub { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>; }
interface SpxSchedulerNamespace { idFromName(name: string): unknown; get(id: unknown): SpxSchedulerStub; }

interface ActionLogItem {
  time: string;
  price: number;
  action: string;
  reasoning: string;
  pnl?: number;
  buyZone?: string;
  stopLoss?: string;
  takeProfit?: string;
  riskWarning?: string;
  ruleEngineVerdict?: string;
  signalScore?: number;
  runId?: string;
  dataQuality?: MarketDataQualitySummary;
  agentVotes?: Record<string, unknown>;
  cioConfidence?: number;
}
interface DailyMemory {
  currentPosition: "NONE" | "CALL" | "PUT";
  entryPrice: number | null;
  entryTime: string | null;
  actionLog: ActionLogItem[];
  // Iron Condor tracking
  icPosition: "NONE" | "DEPLOYED" | "PARTIAL" | "ROLLING";
  icDeployTime: string | null;
  icAction: string | null;
}
interface TrendDayContext {
  regime: "BULL_TREND_DAY" | "BEAR_TREND_DAY" | "RANGE_OR_MIXED";
  directionalBias: "CALL" | "PUT" | "NONE";
  confidence: number;
  recommendedAction: "OPEN_CALL" | "OPEN_PUT" | "HOLD";
  icAllowed: boolean;
  icBlockReason: string | null;
  previousClose: number | null;
  dayOpen: number | null;
  dayChangePct: number | null;
  fromOpenPct: number | null;
  rangePositionPct: number | null;
  priorBoxHigh: number | null;
  priorBoxLow: number | null;
  aboveVWAP: boolean | null;
  aboveEMA9: boolean;
  aboveGammaFlip: boolean | null;
  nearestExpiryGammaStatus: string | null;
  rationale: string;
}
type GexData = SpxGexTelegramSummary;

type MarketDataQualityStatus = "OK" | "STALE" | "MISSING" | "FALLBACK";
type MarketDataQualityOverall = "OK" | "WARN" | "BLOCK";

interface MarketDataQualityItem {
  status: MarketDataQualityStatus;
  required: boolean;
  detail: string;
}

interface MarketDataQualitySummary {
  overallStatus: MarketDataQualityOverall;
  items: Record<string, MarketDataQualityItem>;
  hardBlocks: string[];
  warnings: string[];
}

interface IntradayKeyLevel {
  level: number;
  touches: number;
  kind: "support" | "resistance";
  distance: number;
}

interface IntradayStructureContext {
  nearestSupport: IntradayKeyLevel | null;
  nearestResistance: IntradayKeyLevel | null;
  repeatedSupport: IntradayKeyLevel | null;
  repeatedResistance: IntradayKeyLevel | null;
  targetDisciplineNote: string;
}

type ZeroDteAdvisoryVerdict =
  | "TRADE_ALLOWED"
  | "WAIT_AND_OBSERVE"
  | "NO_TRADE"
  | "CLOSE_OR_REDUCE_SUGGESTED"
  | "FREEZE_NEW_SIGNALS";

interface ZeroDteRuleEngineResult {
  verdict: ZeroDteAdvisoryVerdict;
  directionalBias: "CALL" | "PUT" | "NONE";
  marketRegime: "TREND" | "CHOP" | "GAMMA_PIN" | "UNKNOWN";
  signalScore: number;
  hardBlocks: string[];
  softWarnings: string[];
  advisoryNotes: string[];
  activeRisks: string[];
  allowNewSignal: boolean;
  hardRuleTriggered: boolean;
  thetaDecayRiskHigh: boolean;
  gammaPinningDetected: boolean;
  liquidityRisk: "UNKNOWN";
  dataQuality: {
    status: MarketDataQualityOverall;
    warnings: string[];
  };
  tradeEligibility: {
    hardBlocked: boolean;
    reasons: string[];
  };
}

type AgentRating = "bullish" | "bearish" | "neutral";

interface AgentDecisionContract {
  decision: string;
  rating: AgentRating;
  confidence: number;
  confidence_score: number;
  evidence: string[];
  evidenceRefs: string[];
  evidence_refs: string[];
  claims: Array<{ text: string; evidenceRefs: string[]; evidence_refs: string[] }>;
  blockingRisk: string | null;
  blocking_risk: string | null;
  neutralReason: string | null;
  neutral_reason: string | null;
  reasoning: string;
  analysis: string;
  modelStatus?: string;
  latencyMs?: number;
  attempts?: ModelAttemptMetadata[];
}

type StructuredOpenRouterCallKind = "agent" | "cio";
export const DEFAULT_SPX_COUNCIL_MODEL = "openai/gpt-5-mini";
export const DEFAULT_SPX_CIO_MODEL = "openai/gpt-5-mini";

const AGENT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["CALL", "PUT", "HOLD"] },
    confidence_score: { type: "number", minimum: 1, maximum: 100 },
    evidence_refs: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      uniqueItems: true,
      items: { type: "string" },
    },
    blocking_risk: { type: ["string", "null"], maxLength: 80 },
    reasoning: { type: "string", minLength: 1, maxLength: 180 },
  },
  required: ["decision", "confidence_score", "evidence_refs", "blocking_risk", "reasoning"],
} as const;

const CIO_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    trade_action: { type: "string", enum: ["OPEN_CALL", "OPEN_PUT", "HOLD", "CLOSE"] },
    confidence_score: { type: "number", minimum: 1, maximum: 100 },
    logic: { type: "string" },
    buy_zone: { type: ["string", "null"] },
    stop_loss: { type: ["string", "null"] },
    targets: { type: "array", items: { type: "string" } },
    no_trade_conditions: { type: "array", items: { type: "string" } },
    evidence_refs: { type: "array", items: { type: "string" } },
    claims: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          evidence_refs: { type: "array", minItems: 1, items: { type: "string" } },
        },
        required: ["text", "evidence_refs"],
      },
    },
  },
  required: ["trade_action", "confidence_score", "logic", "buy_zone", "stop_loss", "targets", "no_trade_conditions", "evidence_refs", "claims"],
} as const;

const stringArray = (value: unknown): value is string[] => Array.isArray(value)
  && value.every((item) => typeof item === "string");

const structuredClaimsValid = (value: unknown, allowedEvidenceRefs?: Set<string>) => Array.isArray(value)
  && value.length > 0
  && value.every((claim) => claim
    && typeof claim === "object"
    && typeof claim.text === "string"
    && Boolean(claim.text.trim())
    && stringArray(claim.evidence_refs)
    && claim.evidence_refs.length > 0
    && (!allowedEvidenceRefs || claim.evidence_refs.every((reference: string) => allowedEvidenceRefs.has(reference))));

export interface CioModelPlan {
  trade_action: "OPEN_CALL" | "OPEN_PUT" | "HOLD" | "CLOSE";
  confidence_score: number;
  logic: string;
  buy_zone: string | null;
  stop_loss: string | null;
  targets: string[];
  no_trade_conditions: string[];
  evidence_refs: string[];
  claims: Array<{ text: string; evidence_refs: string[] }>;
}

export interface NumericExecutionLevels {
  entryZoneLow: number;
  entryZoneHigh: number;
  invalidation: number;
  targets: number[];
}

const numericLevels = (value: string) => (value.match(/\d+(?:\.\d+)?/g) || [])
  .map(Number)
  .filter((item) => Number.isFinite(item));

export const parseNumericExecutionLevels = (plan: Pick<CioModelPlan, "buy_zone" | "stop_loss" | "targets">): NumericExecutionLevels | null => {
  if (!plan.buy_zone || !plan.stop_loss || plan.targets.length === 0) return null;
  const zone = numericLevels(plan.buy_zone);
  const invalidation = numericLevels(plan.stop_loss)[0];
  const targets = plan.targets.flatMap(numericLevels);
  if (zone.length !== 2 || !Number.isFinite(invalidation) || targets.length === 0) return null;
  const [entryZoneLow, entryZoneHigh] = [...zone].sort((left, right) => left - right);
  if (entryZoneLow === entryZoneHigh) return null;
  return { entryZoneLow, entryZoneHigh, invalidation, targets };
};

export const passesDirectionalEntryGate = (input: {
  action: "OPEN_CALL" | "OPEN_PUT";
  currentPrice: number;
  completedM5Bars: Array<{ open?: number; close?: number }>;
  plan: Pick<CioModelPlan, "buy_zone" | "stop_loss" | "targets">;
  actionLog: Array<{ action?: string }>;
}) => {
  const levels = parseNumericExecutionLevels(input.plan);
  if (!levels) return { ok: false as const, reason: "numeric_execution_levels_required", levels: null };
  if (input.currentPrice < levels.entryZoneLow || input.currentPrice > levels.entryZoneHigh) {
    return { ok: false as const, reason: "entry_zone_not_reached", levels };
  }
  if (input.actionLog.some((item) => /買入\s+(Call|Put)/i.test(String(item.action || "")))) {
    return { ok: false as const, reason: "daily_directional_entry_limit", levels };
  }
  const bar = input.completedM5Bars.at(-1);
  const open = Number(bar?.open);
  const close = Number(bar?.close);
  if (!Number.isFinite(open) || !Number.isFinite(close)) return { ok: false as const, reason: "m5_confirmation_missing", levels };
  const confirmed = input.action === "OPEN_CALL" ? close >= open : close <= open;
  return confirmed
    ? { ok: true as const, reason: null, levels }
    : { ok: false as const, reason: "m5_confirmation_failed", levels };
};

export const deriveOpenPositionContext = (dailyMemory: DailyMemory): SpxOpenPositionContext | null => {
  if (dailyMemory.currentPosition === "NONE") return null;
  const openingAction = dailyMemory.currentPosition === "PUT" ? "買入 Put" : "買入 Call";
  const openingSnapshot = [...dailyMemory.actionLog].reverse().find((item) => item.action === openingAction);
  return {
    side: dailyMemory.currentPosition,
    entryPrice: dailyMemory.entryPrice,
    entryTime: dailyMemory.entryTime,
    invalidation: openingSnapshot?.stopLoss || null,
    targets: openingSnapshot?.takeProfit ? [openingSnapshot.takeProfit] : [],
    openingRunId: openingSnapshot?.runId || null,
  };
};

export const evaluateNumericPositionExit = (dailyMemory: DailyMemory, currentPrice: number) => {
  const context = deriveOpenPositionContext(dailyMemory);
  if (!context || !Number.isFinite(currentPrice)) return null;
  const invalidation = context.invalidation ? numericLevels(context.invalidation)[0] : null;
  const targets = context.targets.flatMap(numericLevels);
  if (!Number.isFinite(invalidation) || targets.length === 0) {
    return { shouldClose: true, reason: "position_missing_numeric_exit_levels" };
  }
  if (context.side === "CALL") {
    if (currentPrice <= invalidation!) return { shouldClose: true, reason: `numeric_invalidation_${invalidation}` };
    if (targets.some((target) => currentPrice >= target)) return { shouldClose: true, reason: "numeric_target_reached" };
  } else {
    if (currentPrice >= invalidation!) return { shouldClose: true, reason: `numeric_invalidation_${invalidation}` };
    if (targets.some((target) => currentPrice <= target)) return { shouldClose: true, reason: "numeric_target_reached" };
  }
  return { shouldClose: false, reason: null };
};

export const validateCioModelPlan = (
  value: unknown,
  allowedEvidenceRefs?: Set<string>,
): { ok: true; value: CioModelPlan } | { ok: false; invalidField: string } => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, invalidField: "root_not_object" };
  const candidate = value as Record<string, unknown>;
  const keys = ["trade_action", "confidence_score", "logic", "buy_zone", "stop_loss", "targets", "no_trade_conditions", "evidence_refs", "claims"];
  const observedKeys = Object.keys(candidate);
  const missingKey = keys.find((key) => !(key in candidate));
  if (missingKey) return { ok: false, invalidField: `${missingKey}_missing` };
  const unexpectedKey = observedKeys.find((key) => !keys.includes(key));
  if (unexpectedKey || observedKeys.length !== keys.length) return { ok: false, invalidField: "keys_exactly_nine_required" };
  if (!(["OPEN_CALL", "OPEN_PUT", "HOLD", "CLOSE"] as const).includes(candidate.trade_action as CioModelPlan["trade_action"])) {
    return { ok: false, invalidField: "trade_action" };
  }
  if (typeof candidate.confidence_score !== "number" || !Number.isFinite(candidate.confidence_score)) {
    return { ok: false, invalidField: "confidence_score_not_number" };
  }
  if (!Number.isInteger(candidate.confidence_score)) return { ok: false, invalidField: "confidence_score_not_integer" };
  if (candidate.confidence_score < 1 || candidate.confidence_score > 100) return { ok: false, invalidField: "confidence_score_out_of_range" };
  if (typeof candidate.logic !== "string" || !candidate.logic.trim()) return { ok: false, invalidField: "logic" };
  if (candidate.buy_zone !== null && typeof candidate.buy_zone !== "string") return { ok: false, invalidField: "buy_zone" };
  if (candidate.stop_loss !== null && typeof candidate.stop_loss !== "string") return { ok: false, invalidField: "stop_loss" };
  if (!stringArray(candidate.targets)) return { ok: false, invalidField: "targets" };
  if (!stringArray(candidate.no_trade_conditions)) return { ok: false, invalidField: "no_trade_conditions" };
  if (!stringArray(candidate.evidence_refs) || candidate.evidence_refs.length === 0) return { ok: false, invalidField: "evidence_refs" };
  if (allowedEvidenceRefs && candidate.evidence_refs.some((reference) => !allowedEvidenceRefs.has(reference))) {
    return { ok: false, invalidField: "evidence_refs_not_in_projection" };
  }
  if (!structuredClaimsValid(candidate.claims, allowedEvidenceRefs)) return { ok: false, invalidField: "claims" };
  const action = candidate.trade_action as CioModelPlan["trade_action"];
  if (["OPEN_CALL", "OPEN_PUT"].includes(action)
    && (!candidate.buy_zone || !candidate.stop_loss || candidate.targets.length === 0)) {
    return { ok: false, invalidField: "directional_trade_levels" };
  }
  if (["OPEN_CALL", "OPEN_PUT"].includes(action)
    && !parseNumericExecutionLevels({
      buy_zone: candidate.buy_zone as string | null,
      stop_loss: candidate.stop_loss as string | null,
      targets: candidate.targets as string[],
    })) {
    return { ok: false, invalidField: "numeric_execution_levels_required" };
  }
  if (action === "HOLD" && (candidate.buy_zone !== null || candidate.stop_loss !== null || candidate.targets.length > 0)) {
    return { ok: false, invalidField: "hold_trade_levels" };
  }
  return {
    ok: true,
    value: {
      trade_action: action,
      confidence_score: candidate.confidence_score,
      logic: candidate.logic,
      buy_zone: candidate.buy_zone as string | null,
      stop_loss: candidate.stop_loss as string | null,
      targets: [...candidate.targets],
      no_trade_conditions: [...candidate.no_trade_conditions],
      evidence_refs: [...candidate.evidence_refs],
      claims: candidate.claims.map((claim: any) => ({ text: claim.text, evidence_refs: [...claim.evidence_refs] })),
    },
  };
};

const isStructuredOutputValid = (
  callKind: StructuredOpenRouterCallKind,
  value: any,
  allowedEvidenceRefs?: Set<string>,
) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (callKind === "agent") {
    const allowedKeys = new Set(["decision", "confidence_score", "evidence_refs", "blocking_risk", "reasoning"]);
    const hasOnlyContractKeys = Object.keys(value).length === allowedKeys.size
      && Object.keys(value).every((key) => allowedKeys.has(key));
    const shapeValid = ["CALL", "PUT", "HOLD"].includes(value.decision)
      && hasOnlyContractKeys
      && Number.isFinite(value.confidence_score) && value.confidence_score >= 1 && value.confidence_score <= 100
      && stringArray(value.evidence_refs)
      && value.evidence_refs.length > 0 && value.evidence_refs.length <= 4
      && new Set(value.evidence_refs).size === value.evidence_refs.length
      && (!allowedEvidenceRefs || value.evidence_refs.every((reference: string) => allowedEvidenceRefs.has(reference)))
      && (typeof value.blocking_risk === "string" || value.blocking_risk === null)
      && (value.blocking_risk === null || value.blocking_risk.length <= 80)
      && typeof value.reasoning === "string" && Boolean(value.reasoning.trim())
      && value.reasoning.length <= 180;
    if (!shapeValid) return false;
    return true;
  }
  return validateCioModelPlan(value, allowedEvidenceRefs).ok;
};

const sha256Text = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const SPX_COUNCIL_PROVIDER_ORDER = ["deepinfra", "parasail"] as const;
export const SPX_COUNCIL_PROVIDER_ALLOWLIST = SPX_COUNCIL_PROVIDER_ORDER;
export const SPX_GPT5_AZURE_PROVIDER_ORDER = ["azure"] as const;
const SPX_GPT5_COUNCIL_MAX_COMPLETION_TOKENS = 1024;
const SPX_GPT5_CIO_MAX_COMPLETION_TOKENS = 1536;

const isGpt5Model = (model: string) => /^openai\/gpt-5(?:-|$)/i.test(model);

const rotateCouncilProviderOrder = (attempt: number) => {
  const offset = Math.max(0, attempt - 1) % SPX_COUNCIL_PROVIDER_ORDER.length;
  return [...SPX_COUNCIL_PROVIDER_ORDER.slice(offset), ...SPX_COUNCIL_PROVIDER_ORDER.slice(0, offset)];
};

const councilProviderSlug = (value: unknown) => {
  const provider = String(value || "").trim().toLowerCase();
  if (provider === "deepinfra" || provider === "parasail") return provider;
  return null;
};

const azureProviderSlug = (value: unknown) => {
  const provider = String(value || "").trim().toLowerCase();
  return provider === "azure" || provider.startsWith("azure/") ? "azure" : null;
};

const isApprovedStructuredProvider = (callKind: StructuredOpenRouterCallKind, model: string, value: string | null) => {
  if (value === null) return true;
  if (isGpt5Model(model)) return azureProviderSlug(value) !== null;
  return callKind !== "agent" || councilProviderSlug(value) !== null;
};

const routingPolicyFor = (callKind: StructuredOpenRouterCallKind, model: string) => (
  isGpt5Model(model) ? "azure_only" : callKind === "agent" ? "ordered_same_model_fallbacks" : "parameters_only"
);

const providerOrderForAttempt = (
  callKind: StructuredOpenRouterCallKind,
  model: string,
  attempt: number,
  ignoredCouncilProviders: readonly string[] = [],
) => {
  if (isGpt5Model(model)) return [...SPX_GPT5_AZURE_PROVIDER_ORDER];
  return callKind === "agent"
    ? rotateCouncilProviderOrder(attempt).filter((provider) => !ignoredCouncilProviders.includes(provider))
    : [];
};

const nullableString = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

const providerNamesFrom = (value: unknown) => Array.from(new Set(
  (Array.isArray(value) ? value : [])
    .map((item: any) => nullableString(item?.provider))
    .filter((provider): provider is string => Boolean(provider)),
));

const isRetryableOpenRouterError = (code: number | null, errorType: string | null) => {
  if ([401, 402, 403].includes(code || 0)) return false;
  return code === 408
    || code === 429
    || (code !== null && code >= 500)
    || ["provider_unavailable", "provider_overloaded", "rate_limit_exceeded", "timeout", "server", "unmapped"].includes(errorType || "");
};

const classifyOpenRouterRequestFailure = (httpStatus: number, errorType: string | null, errorMessage: string | null) => {
  if (httpStatus === 404) return "PROVIDER_UNAVAILABLE" as const;
  if (httpStatus !== 400) return null;
  const evidence = `${errorType || ""} ${errorMessage || ""}`.toLowerCase();
  if (/max[_ ]?(completion[_ ]?)?tokens?|token budget|minimum token|at least \d+/.test(evidence)) return "INVALID_TOKEN_BUDGET" as const;
  if (/unsupported|not supported|unknown parameter|unrecognized parameter|invalid parameter/.test(evidence)) return "UNSUPPORTED_PARAMETER" as const;
  if (/json schema|response_format|structured output|schema/.test(evidence)) return "INVALID_SCHEMA" as const;
  if (/invalid[_ ]?request/.test(evidence)) return "INVALID_REQUEST" as const;
  return "UNKNOWN_ROUTER_400" as const;
};

export const buildStructuredOpenRouterBody = (
  callKind: StructuredOpenRouterCallKind,
  model: string,
  messages: Array<{ role: string; content: string }>,
  maxOutputTokens = isGpt5Model(model)
    ? callKind === "agent" ? SPX_GPT5_COUNCIL_MAX_COMPLETION_TOKENS : SPX_GPT5_CIO_MAX_COMPLETION_TOKENS
    : callKind === "agent" ? 512 : 520,
  councilProviderOrder: readonly string[] = SPX_COUNCIL_PROVIDER_ORDER,
  ignoredCouncilProviders: readonly string[] = [],
) => {
  const isGpt5 = isGpt5Model(model);
  return {
  model,
  ...(isGpt5
    ? { max_completion_tokens: maxOutputTokens, reasoning: { effort: "minimal" } }
    : { temperature: 0, max_tokens: maxOutputTokens }),
  provider: isGpt5
    ? {
      require_parameters: true,
      order: [...SPX_GPT5_AZURE_PROVIDER_ORDER],
      only: [...SPX_GPT5_AZURE_PROVIDER_ORDER],
      allow_fallbacks: false,
    }
    : callKind === "agent"
    ? {
      require_parameters: true,
      order: [...councilProviderOrder],
      only: [...SPX_COUNCIL_PROVIDER_ALLOWLIST],
      allow_fallbacks: true,
      ...(ignoredCouncilProviders.length ? { ignore: [...ignoredCouncilProviders] } : {}),
    }
    : { require_parameters: true },
  // Azure accepts GPT-5 Mini JSON mode but rejects OpenRouter's json_schema wire
  // contract. The response remains fail-closed: isStructuredOutputValid below
  // still enforces the exact schema and snapshot-evidence contract before any
  // Council vote or CIO decision is accepted.
  response_format: isGpt5
    ? { type: "json_object" }
    : {
      type: "json_schema",
      json_schema: {
        name: callKind === "agent" ? "spx_council_agent_analysis" : "spx_cio_decision",
        strict: true,
        schema: callKind === "agent" ? AGENT_RESPONSE_SCHEMA : CIO_RESPONSE_SCHEMA,
      },
    },
  messages,
  };
};

export const resolveAttemptTimeoutMs = (timeoutMs: number, deadlineRemainingMs: number | null) => (
  deadlineRemainingMs === null ? timeoutMs : Math.min(timeoutMs, deadlineRemainingMs)
);

const isTransientCioFailure = (httpStatus: number | null, timedOut = false) => timedOut
  || httpStatus === 408
  || httpStatus === 429
  || (httpStatus !== null && httpStatus >= 500);

export async function runStructuredOpenRouterRequest(input: {
  callKind: StructuredOpenRouterCallKind;
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  allowedEvidenceRefs?: string[];
  projectionBytes?: number;
  factCount?: number;
  deadlineAtMs?: number;
  maxProjectionBytes?: number;
  postParseValidator?: (value: unknown) => { ok: true; value: unknown } | { ok: false; invalidField: string };
}): Promise<{
  ok: boolean;
  value: any | null;
  attempts: ModelAttemptMetadata[];
  failureStatus: string | null;
}> {
  const fetcher = input.fetcher || fetch;
  const timeoutMs = input.timeoutMs ?? 12_000;
  const attempts: ModelAttemptMetadata[] = [];
  let failureStatus: string | null = null;
  let maxOutputTokens = isGpt5Model(input.model)
    ? input.callKind === "agent" ? SPX_GPT5_COUNCIL_MAX_COMPLETION_TOKENS : SPX_GPT5_CIO_MAX_COMPLETION_TOKENS
    : input.callKind === "agent" ? 512 : 520;
  let retryIgnoredProviders: string[] = [];
  const unavailableResponseMetadata = {
    requestedModel: input.model,
    resolvedModel: null,
    provider: null,
    responseId: null,
    promptTokens: null,
    completionTokens: null,
    reasoningTokens: null,
    totalTokens: null,
    cost: null,
  };

  if (input.maxProjectionBytes !== undefined
    && input.projectionBytes !== undefined
    && input.projectionBytes > input.maxProjectionBytes) {
    const body = buildStructuredOpenRouterBody(input.callKind, input.model, input.messages, maxOutputTokens);
    const requestBody = JSON.stringify(body);
    const requestBytes = new TextEncoder().encode(requestBody).byteLength;
    return {
      ok: false,
      value: null,
      failureStatus: "input_budget_exceeded",
      attempts: [{
        attempt: 1,
        model: input.model,
        ...unavailableResponseMetadata,
        status: "INPUT_BUDGET_EXCEEDED",
        latencyMs: 0,
        httpStatus: null,
        errorCategory: "INPUT_BUDGET_EXCEEDED",
        finishReason: null,
        contentLength: 0,
        responseHash: null,
        requestBytes,
        projectionBytes: input.projectionBytes,
        factCount: input.factCount ?? null,
        requestHash: await sha256Text(requestBody),
        maxOutputTokens,
        deadlineRemainingMs: input.deadlineAtMs === undefined
          ? null
          : Math.max(0, input.deadlineAtMs - Date.now()),
        routingPolicy: routingPolicyFor(input.callKind, input.model),
        providerOrder: providerOrderForAttempt(input.callKind, input.model, 1),
      }],
    };
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const startedAt = Date.now();
    const deadlineRemainingMs = input.deadlineAtMs === undefined
      ? null
      : Math.max(0, input.deadlineAtMs - startedAt);
    if (deadlineRemainingMs === 0) {
      failureStatus = input.callKind === "cio" ? "cio_deadline_exceeded" : "council_deadline_exceeded";
      attempts.push({
        attempt,
        model: input.model,
        ...unavailableResponseMetadata,
        status: "DEADLINE_EXCEEDED",
        latencyMs: 0,
        httpStatus: null,
        errorCategory: "DEADLINE_EXCEEDED",
        finishReason: null,
        contentLength: 0,
        responseHash: null,
        requestBytes: 0,
        projectionBytes: input.projectionBytes ?? null,
        factCount: input.factCount ?? null,
        requestHash: null,
        maxOutputTokens,
        deadlineRemainingMs,
        routingPolicy: routingPolicyFor(input.callKind, input.model),
        providerOrder: providerOrderForAttempt(input.callKind, input.model, attempt),
      });
      break;
    }
    const providerOrder = providerOrderForAttempt(input.callKind, input.model, attempt, retryIgnoredProviders);
    const body = buildStructuredOpenRouterBody(
      input.callKind,
      input.model,
      input.messages,
      maxOutputTokens,
      providerOrder,
      retryIgnoredProviders,
    );
    const requestBody = JSON.stringify(body);
    const configuredAttemptTimeoutMs = input.callKind === "cio"
      ? attempt === 1 ? SPX_CIO_TIMING_POLICY.primaryAttemptTimeoutMs : SPX_CIO_TIMING_POLICY.retryAttemptTimeoutMs
      : timeoutMs;
    const attemptTimeoutMs = resolveAttemptTimeoutMs(configuredAttemptTimeoutMs, deadlineRemainingMs);
    const requestMetadata = {
      requestBytes: new TextEncoder().encode(requestBody).byteLength,
      projectionBytes: input.projectionBytes ?? null,
      factCount: input.factCount ?? null,
      requestHash: await sha256Text(requestBody),
      maxOutputTokens,
      deadlineRemainingMs,
      attemptTimeoutMs,
      routingPolicy: routingPolicyFor(input.callKind, input.model),
      providerOrder,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
    try {
      const response = await fetcher("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://spx-trading-pua.kungsiuchun0.workers.dev",
          "X-OpenRouter-Title": "SPX Decision Pipeline",
          "X-OpenRouter-Metadata": "enabled",
        },
        body: requestBody,
        signal: controller.signal,
      });
      if (!response.ok) {
        const responseText = await response.text();
        let responseData: any = null;
        try {
          responseData = JSON.parse(responseText);
        } catch {
          responseData = null;
        }
        const upstreamError = responseData?.error && typeof responseData.error === "object" ? responseData.error : null;
        const routerMetadata = responseData?.openrouter_metadata;
        const selectedProvider = nullableString(routerMetadata?.endpoints?.available?.find((endpoint: any) => endpoint?.selected)?.provider)
          || nullableString(responseData?.provider);
        const errorType = nullableString(upstreamError?.metadata?.error_type);
        const providerCode = nullableString(upstreamError?.metadata?.provider_code);
        const upstreamErrorCode = toNullableFiniteNumber(upstreamError?.code);
        const errorMessage = nullableString(upstreamError?.message);
        const contractError = classifyOpenRouterRequestFailure(response.status, errorType, errorMessage);
        const unapprovedProvider = !isApprovedStructuredProvider(input.callKind, input.model, selectedProvider);
        const retryable = !unapprovedProvider && (input.callKind === "cio"
          ? isTransientCioFailure(response.status)
          : response.status === 429 || response.status >= 500);
        failureStatus = unapprovedProvider
          ? input.callKind === "agent" ? "model_unapproved_provider" : "cio_unapproved_provider"
          : contractError
            ? `${input.callKind === "agent" ? "model" : "cio"}_${contractError.toLowerCase()}`
            : `openrouter_${response.status}`;
        attempts.push({
          attempt,
          model: input.model,
          ...unavailableResponseMetadata,
          provider: selectedProvider,
          responseId: nullableString(responseData?.id),
          status: unapprovedProvider ? "UNAPPROVED_PROVIDER" : "HTTP_ERROR",
          latencyMs: Math.max(0, Date.now() - startedAt),
          httpStatus: response.status,
          errorCategory: unapprovedProvider ? "UNAPPROVED_PROVIDER" : contractError || `HTTP_${response.status}`,
          finishReason: null,
          contentLength: responseText.length,
          responseHash: responseText ? await sha256Text(responseText) : null,
          responseShape: unapprovedProvider ? "UNAPPROVED_PROVIDER" : "ERROR_ENVELOPE",
          choiceCount: Array.isArray(responseData?.choices) ? responseData.choices.length : 0,
          selectedProvider,
          attemptedProviders: providerNamesFrom(routerMetadata?.attempts),
          generationId: response.headers.get("X-Generation-Id") || nullableString(responseData?.id),
          errorType,
          upstreamErrorCode,
          providerCode,
          errorMessageHash: errorMessage ? await sha256Text(errorMessage) : null,
          contractError,
          ...requestMetadata,
        });
        if (!retryable || attempt === 2) break;
        retryIgnoredProviders = isGpt5Model(input.model) ? [] : Array.from(new Set(
          [selectedProvider, ...providerNamesFrom(routerMetadata?.attempts)]
            .map(councilProviderSlug)
            .filter((provider): provider is string => Boolean(provider)),
        ));
        continue;
      }

      const responseData = await response.json() as any;
      const choices = Array.isArray(responseData?.choices) ? responseData.choices : [];
      const choice = choices[0];
      const usage = responseData?.usage || {};
      const routerMetadata = responseData?.openrouter_metadata;
      const attemptedProviders = providerNamesFrom(routerMetadata?.attempts);
      const selectedProvider = nullableString(routerMetadata?.endpoints?.available?.find((endpoint: any) => endpoint?.selected)?.provider)
        || nullableString(responseData?.provider);
      const upstreamError = responseData?.error && typeof responseData.error === "object"
        ? responseData.error
        : choice?.error && typeof choice.error === "object"
          ? choice.error
          : null;
      const errorType = nullableString(upstreamError?.metadata?.error_type);
      const providerCode = nullableString(upstreamError?.metadata?.provider_code);
      const upstreamErrorCode = toNullableFiniteNumber(upstreamError?.code);
      const errorMessage = nullableString(upstreamError?.message);
      const responseMetadata = {
        requestedModel: input.model,
        resolvedModel: typeof responseData?.model === "string" ? responseData.model : input.model,
        provider: selectedProvider,
        responseId: typeof responseData?.id === "string" ? responseData.id : null,
        promptTokens: toNullableFiniteNumber(usage.prompt_tokens),
        completionTokens: toNullableFiniteNumber(usage.completion_tokens),
        reasoningTokens: toNullableFiniteNumber(usage?.completion_tokens_details?.reasoning_tokens),
        totalTokens: toNullableFiniteNumber(usage.total_tokens),
        cost: toNullableFiniteNumber(usage.cost),
        choiceCount: choices.length,
        selectedProvider,
        attemptedProviders,
        generationId: response.headers.get("X-Generation-Id") || (typeof responseData?.id === "string" ? responseData.id : null),
        errorType,
        upstreamErrorCode,
        providerCode,
        errorMessageHash: errorMessage ? await sha256Text(errorMessage) : null,
      };
      const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
      if (!isApprovedStructuredProvider(input.callKind, input.model, selectedProvider)) {
        failureStatus = input.callKind === "agent" ? "model_unapproved_provider" : "cio_unapproved_provider";
        attempts.push({
          attempt,
          model: input.model,
          ...responseMetadata,
          status: "UNAPPROVED_PROVIDER",
          latencyMs: Math.max(0, Date.now() - startedAt),
          httpStatus: response.status,
          errorCategory: "UNAPPROVED_PROVIDER",
          finishReason: choice?.finish_reason || null,
          contentLength: content.length,
          responseHash: content ? await sha256Text(content) : null,
          responseShape: "UNAPPROVED_PROVIDER",
          ...requestMetadata,
        });
        break;
      }
      if (upstreamError || choice?.finish_reason === "error") {
        failureStatus = input.callKind === "agent" ? "model_upstream_error" : "cio_upstream_error";
        attempts.push({
          attempt,
          model: input.model,
          ...responseMetadata,
          status: "UPSTREAM_ERROR",
          latencyMs: Math.max(0, Date.now() - startedAt),
          httpStatus: response.status,
          errorCategory: "UPSTREAM_ERROR",
          finishReason: choice?.finish_reason || "error",
          contentLength: content.length,
          responseHash: content ? await sha256Text(content) : null,
          responseShape: upstreamError && choice ? "CHOICE_ERROR" : "ERROR_ENVELOPE",
          ...requestMetadata,
        });
        if (!isRetryableOpenRouterError(upstreamErrorCode, errorType) || attempt === 2) break;
        retryIgnoredProviders = isGpt5Model(input.model) ? [] : Array.from(new Set(
          [selectedProvider, ...attemptedProviders]
            .map(councilProviderSlug)
            .filter((provider): provider is string => Boolean(provider)),
        ));
        continue;
      }
      if (!choice) {
        failureStatus = input.callKind === "agent" ? "model_missing_choice" : "cio_missing_choice";
        attempts.push({
          attempt,
          model: input.model,
          ...responseMetadata,
          status: "MISSING_CHOICE",
          latencyMs: Math.max(0, Date.now() - startedAt),
          httpStatus: response.status,
          errorCategory: "MISSING_CHOICE",
          finishReason: null,
          contentLength: 0,
          responseHash: null,
          responseShape: "MISSING_CHOICE",
          ...requestMetadata,
        });
        if (input.callKind === "cio" || attempt === 2) break;
        continue;
      }
      if (!content.trim()) {
        failureStatus = input.callKind === "agent" ? "model_empty_content" : "cio_empty_content";
        attempts.push({
          attempt,
          model: input.model,
          ...responseMetadata,
          status: "EMPTY_CONTENT",
          latencyMs: Math.max(0, Date.now() - startedAt),
          httpStatus: response.status,
          errorCategory: "EMPTY_CONTENT",
          finishReason: choice?.finish_reason || null,
          contentLength: 0,
          responseHash: null,
          responseShape: "EMPTY_CONTENT",
          ...requestMetadata,
        });
        if (input.callKind === "cio" || attempt === 2) break;
        continue;
      }
      if (choice?.finish_reason === "length") {
        failureStatus = input.callKind === "agent" ? "model_output_truncated" : "cio_output_truncated";
        attempts.push({
          attempt,
          model: input.model,
          ...responseMetadata,
          status: "OUTPUT_TRUNCATED",
          latencyMs: Math.max(0, Date.now() - startedAt),
          httpStatus: response.status,
          errorCategory: "OUTPUT_TRUNCATED",
          finishReason: "length",
          contentLength: content.length,
          responseHash: content ? await sha256Text(content) : null,
          responseShape: "OUTPUT_TRUNCATED",
          ...requestMetadata,
        });
        if (input.callKind === "cio" || attempt === 2) break;
        if (!isGpt5Model(input.model) && input.callKind === "agent") maxOutputTokens = 640;
        continue;
      }
      let value: any = null;
      let outputIsJson = true;
      try {
        value = JSON.parse(content);
      } catch {
        outputIsJson = false;
      }
      if (!outputIsJson) {
        failureStatus = input.callKind === "agent" ? "model_output_not_json" : "cio_output_not_json";
        attempts.push({
          attempt,
          model: input.model,
          ...responseMetadata,
          status: "OUTPUT_NOT_JSON",
          latencyMs: Math.max(0, Date.now() - startedAt),
          httpStatus: response.status,
          errorCategory: "OUTPUT_NOT_JSON",
          finishReason: choice?.finish_reason || null,
          contentLength: content.length,
          responseHash: await sha256Text(content),
          responseShape: "NON_JSON",
          ...requestMetadata,
        });
        if (input.callKind === "cio" || attempt === 2) break;
        continue;
      }
      const allowedEvidenceRefs = input.allowedEvidenceRefs ? new Set(input.allowedEvidenceRefs) : undefined;
      const postParseResult = input.postParseValidator?.(value);
      if (!isStructuredOutputValid(input.callKind, value, allowedEvidenceRefs) || postParseResult?.ok === false) {
        failureStatus = input.callKind === "agent" ? "model_output_schema_invalid" : "cio_schema_invalid";
        attempts.push({
          attempt,
          model: input.model,
          ...responseMetadata,
          status: "SCHEMA_INVALID",
          latencyMs: Math.max(0, Date.now() - startedAt),
          httpStatus: response.status,
          errorCategory: postParseResult?.ok === false ? "POST_PARSE_CONTRACT" : "SCHEMA_INVALID",
          invalidField: postParseResult?.ok === false ? postParseResult.invalidField : null,
          finishReason: choice?.finish_reason || null,
          contentLength: content.length,
          responseHash: content ? await sha256Text(content) : null,
          responseShape: "SCHEMA_INVALID",
          ...requestMetadata,
        });
        if (input.callKind === "cio" || attempt === 2) break;
        continue;
      }

      if (postParseResult?.ok) value = postParseResult.value;

      attempts.push({
        attempt,
        model: input.model,
        ...responseMetadata,
        status: "SUCCESS",
        latencyMs: Math.max(0, Date.now() - startedAt),
        httpStatus: response.status,
        errorCategory: null,
        finishReason: choice?.finish_reason || null,
        contentLength: content.length,
        responseHash: content ? await sha256Text(content) : null,
        responseShape: "COMPLETION",
        ...requestMetadata,
      });
      return { ok: true, value, attempts, failureStatus: null };
    } catch (error: any) {
      const timedOut = error?.name === "AbortError" || /timeout|timed out/i.test(String(error?.message || error));
      const deadlineExceeded = timedOut
        && input.deadlineAtMs !== undefined
        && Date.now() >= input.deadlineAtMs - 5;
      failureStatus = deadlineExceeded
        ? input.callKind === "cio" ? "cio_deadline_exceeded" : "council_deadline_exceeded"
        : timedOut
          ? "model_timeout"
          : "model_request_failed";
      attempts.push({
        attempt,
        model: input.model,
        ...unavailableResponseMetadata,
        status: deadlineExceeded ? "DEADLINE_EXCEEDED" : timedOut ? "TIMEOUT" : "REQUEST_FAILED",
        latencyMs: Math.max(0, Date.now() - startedAt),
        httpStatus: null,
        errorCategory: deadlineExceeded ? "DEADLINE_EXCEEDED" : timedOut ? "TIMEOUT" : "REQUEST_FAILED",
        finishReason: null,
        contentLength: 0,
        responseHash: null,
        responseShape: "REQUEST_FAILED",
        ...requestMetadata,
      });
      if (deadlineExceeded || !isTransientCioFailure(null, timedOut) || attempt === 2) break;
    } finally {
      clearTimeout(timeout);
    }
  }
  return { ok: false, value: null, attempts, failureStatus };
}

const YAHOO_CHART_TIMEOUT_MS = 6500;
const OPTIONAL_MARKET_DATA_TIMEOUT_MS = 6500;
export const SPX_COUNCIL_TIMING_POLICY = Object.freeze({
  attemptTimeoutMs: 45_000,
  absoluteDeadlineMs: 100_000,
});
export const SPX_CIO_TIMING_POLICY = Object.freeze({
  primaryAttemptTimeoutMs: 20_000,
  retryAttemptTimeoutMs: 10_000,
  absoluteDeadlineMs: 30_000,
});
const AGENT_PROJECTION_MAX_BYTES = 8 * 1024;
const CIO_PROJECTION_MAX_BYTES = 8 * 1024;
const TELEGRAM_TIMEOUT_MS = 6000;
const M5_INTERVAL_MS = 5 * 60_000;
const TRADING_RUN_LOCK_KEY = "spx_trading_run_lock";
const TRADING_RUN_LOCK_TTL_SECONDS = 12 * 60;

const LONG_DECISIONS = new Set(["BUY", "LONG", "CALL", "OPEN_CALL"]);
const SHORT_DECISIONS = new Set(["SELL", "SHORT", "PUT", "OPEN_PUT"]);
const ALLOWED_AGENT_DECISIONS = new Set([...LONG_DECISIONS, ...SHORT_DECISIONS, "HOLD"]);

const falseyFlag = (value: unknown) => ["0", "false", "no", "off"].includes(String(value || "").trim().toLowerCase());
export const shouldRunLlmCouncil = (value: unknown) => !falseyFlag(value);
export const shouldRunLlmCio = (value: unknown) => !falseyFlag(value);

const toFiniteNumber = (value: unknown, fallback = 0) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number.parseFloat(String(value ?? "").replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toNullableFiniteNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseFloat(String(value).replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const clampConfidence = (value: unknown, fallback = 45) =>
  Math.max(0, Math.min(100, Math.round(toFiniteNumber(value, fallback))));

const qualityItem = (status: MarketDataQualityStatus, required: boolean, detail: string): MarketDataQualityItem => ({
  status,
  required,
  detail,
});

export function assessMarketDataQuality(input: {
  spxQuotes?: unknown[];
  spxM5Quotes?: unknown[];
  spxPriceSource?: string;
  intradayVolumeAvailable?: boolean;
  spxD1Quotes?: unknown[];
  spxH1Quotes?: unknown[];
  currentVix?: unknown;
  currentVix9d?: unknown;
  pcrValue?: unknown;
  calculatedGex?: unknown;
}): MarketDataQualitySummary {
  const items: Record<string, MarketDataQualityItem> = {
    spx15m: qualityItem(Array.isArray(input.spxQuotes) && input.spxQuotes.length > 0 ? "OK" : "MISSING", true, input.spxPriceSource === "0dtespx" ? "0DTESPX current-RTH 1m core chart" : "SPX 15m core chart"),
    spx5m: qualityItem(Array.isArray(input.spxM5Quotes) && input.spxM5Quotes.length > 0 ? "OK" : "MISSING", true, input.spxPriceSource === "0dtespx" ? "0DTESPX current-RTH 1m aggregated 5m trigger chart" : "SPX 5m trigger chart"),
    intradayVolume: qualityItem(input.intradayVolumeAvailable === true ? "OK" : "MISSING", false, "Current-RTH trade volume / VWAP"),
    spxD1: qualityItem(Array.isArray(input.spxD1Quotes) && input.spxD1Quotes.length > 0 ? "OK" : "MISSING", false, "SPX D1 structure chart"),
    spxH1: qualityItem(Array.isArray(input.spxH1Quotes) && input.spxH1Quotes.length > 0 ? "OK" : "MISSING", false, "SPX H1 structure chart"),
    vix: qualityItem(toNullableFiniteNumber(input.currentVix) !== null ? "OK" : "MISSING", false, "VIX 15m"),
    vix9d: qualityItem(toNullableFiniteNumber(input.currentVix9d) !== null ? "OK" : "MISSING", false, "VIX9D term structure"),
    pcr: qualityItem(toNullableFiniteNumber(input.pcrValue) !== null ? "OK" : "MISSING", false, "CBOE put/call ratio"),
    cboeGex: qualityItem(input.calculatedGex ? "OK" : "MISSING", false, "CBOE GEX snapshot"),
  };
  const hardBlocks = Object.entries(items)
    .filter(([, item]) => item.required && item.status === "MISSING")
    .map(([key]) => ({
      spx15m: "spx_15m_missing",
      spx5m: "spx_5m_missing",
    }[key] || `${key}_missing`));
  const warnings = Object.entries(items)
    .filter(([, item]) => !item.required && item.status !== "OK")
    .map(([key]) => ({
      spxD1: "spx_d1",
      spxH1: "spx_h1",
      intradayVolume: "intraday_volume",
      vix: "vix",
      vix9d: "vix9d",
      pcr: "pcr",
      cboeGex: "cboe_gex",
    }[key] || key) + `_${items[key].status.toLowerCase()}`);
  return {
    overallStatus: hardBlocks.length > 0 ? "BLOCK" : warnings.length > 0 ? "WARN" : "OK",
    items,
    hardBlocks,
    warnings,
  };
}

const getDecisionRating = (decision: unknown): AgentRating => {
  const normalized = normalizeAgentDecisionValue(decision);
  if (LONG_DECISIONS.has(normalized)) return "bullish";
  if (SHORT_DECISIONS.has(normalized)) return "bearish";
  return "neutral";
};

export function countDirectionalVotes(decisions: unknown[]) {
  const normalized = decisions.map((decision) => normalizeAgentDecisionValue(decision));
  const buyVotes = normalized.filter((decision) => LONG_DECISIONS.has(decision)).length;
  const sellVotes = normalized.filter((decision) => SHORT_DECISIONS.has(decision)).length;
  const holdVotes = normalized.length - buyVotes - sellVotes;
  const consensusVote = buyVotes > sellVotes ? "LONG" : sellVotes > buyVotes ? "SHORT" : "NEUTRAL";
  return { buyVotes, sellVotes, holdVotes, consensusVote };
}

async function withPromiseTimeout<T>(label: string, task: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function timedStep<T>(label: string, task: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await task();
    console.log(`[TIMING] ${label} completed in ${Date.now() - startedAt}ms`);
    return result;
  } catch (error) {
    console.error(`[TIMING] ${label} failed after ${Date.now() - startedAt}ms`, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

// --- Helper: Fetch with Timeout ---
async function fetchWithTimeout(url: string, options: any, timeoutMs: number = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

// --- 輕量級 Yahoo Finance API 調用 ---

async function fetchYahooChart(symbol: string, interval: string, range: string) {
  const encodedSymbol = encodeURIComponent(symbol);
  const errors: string[] = [];

  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    const url = `https://${host}/v8/finance/chart/${encodedSymbol}?interval=${interval}&range=${range}`;
    try {
      const response = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        }
      }, YAHOO_CHART_TIMEOUT_MS);
      const text = await response.text();

      if (!response.ok) {
        errors.push(`${host} HTTP ${response.status}: ${text.slice(0, 160)}`);
        continue;
      }

      const data = JSON.parse(text) as any;
      const result = data.chart?.result?.[0];
      const timestamps = result?.timestamp || [];
      const quotes = result?.indicators?.quote?.[0];
      if (!result || !quotes || timestamps.length === 0) {
        errors.push(`${host} returned empty chart payload`);
        continue;
      }

      return timestamps.map((t: number, i: number) => ({
        date: new Date(t * 1000),
        open: quotes.open?.[i],
        high: quotes.high?.[i],
        low: quotes.low?.[i],
        close: quotes.close?.[i],
        volume: quotes.volume?.[i]
      })).filter((q: any) => q.close !== null);
    } catch (error) {
      errors.push(`${host}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Yahoo chart failed for ${symbol} ${interval}/${range}: ${errors.join(' | ')}`);
}

async function fetchOptionalMarketData<T>(label: string, task: Promise<T>, fallback: T): Promise<T> {
  try {
    return await timedStep(label, () => task);
  } catch (error) {
    console.error(`[DATA] Optional market data failed: ${label}`, error instanceof Error ? error.message : String(error));
    return fallback;
  }
}
const readCanonicalSnapshotPcrValue = async (db: D1DatabaseLike, heatmap: SpxGexHeatmapModel | null) => {
  if (!heatmap?.session) return null;
  try {
    const row = await db
      .prepare(`
        SELECT pcr_value
        FROM spx_cboe_option_chain_cache
        WHERE trading_date = ? AND collected_minute_et = ?
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .bind(heatmap.session.tradingDate, heatmap.session.collectedMinuteEt)
      .first<{ pcr_value: number | null }>();
    const value = Number(row?.pcr_value);
    return Number.isFinite(value) ? value : null;
  } catch (error) {
    console.error('[SPX_GEX_CANONICAL] PCR metadata read failed', error instanceof Error ? error.message : String(error));
    return null;
  }
};

const readLatestCboeCacheMinuteEt = async (db: D1DatabaseLike, tradingDate: string) => {
  try {
    const row = await db
      .prepare(`
        SELECT collected_minute_et
        FROM spx_cboe_option_chain_cache
        WHERE trading_date = ?
        ORDER BY collected_minute_et DESC, created_at DESC
        LIMIT 1
      `)
      .bind(tradingDate)
      .first<{ collected_minute_et: number | null }>();
    const value = Number(row?.collected_minute_et);
    return Number.isFinite(value) ? value : null;
  } catch (error) {
    console.error('[SPX_GEX_CANONICAL] CBOE cache freshness read failed', error instanceof Error ? error.message : String(error));
    return null;
  }
};

const logCanonicalGexFreshness = async (db: D1DatabaseLike, tradingDate: string, heatmap: SpxGexHeatmapModel | null) => {
  const latestCacheMinuteEt = await readLatestCboeCacheMinuteEt(db, tradingDate);
  const latestSnapshotCollectedMinuteEt = heatmap?.session?.collectedMinuteEt ?? null;
  if (
    latestCacheMinuteEt !== null
    && latestSnapshotCollectedMinuteEt !== null
    && latestCacheMinuteEt > latestSnapshotCollectedMinuteEt
  ) {
    console.error(`[SPX_GEX_CANONICAL] cache_latest > snapshot_latest tradingDate=${tradingDate} cacheCollected=${latestCacheMinuteEt} snapshotCollected=${latestSnapshotCollectedMinuteEt}`);
  }
};

export interface CanonicalSpxGexForTelegram {
  pcrValue: number | null;
  calculatedGex: SpxGexTelegramSummary | null;
  heatmap: SpxGexHeatmapModel | null;
  status: 'READY' | 'MISSING' | 'INVALID';
}

export const isUsableCanonicalSpxGexHeatmap = (value: unknown): value is SpxGexHeatmapModel => {
  if (!value || typeof value !== 'object') return false;
  const heatmap = value as Partial<SpxGexHeatmapModel>;
  return Boolean(
    heatmap.session
    && heatmap.quote
    && heatmap.zeroDte
    && heatmap.canonical
    && Array.isArray(heatmap.cells)
    && heatmap.cells.length > 0
    && Array.isArray(heatmap.strikeProfiles)
    && heatmap.strikeProfiles.length > 0,
  );
};

export async function loadCanonicalSpxGexForTelegram(
  env: { SPX_RECAP_DB?: D1DatabaseLike },
  now: Date = new Date(),
  options: { dataClient?: SpxGexDataClient; allowGeneration?: boolean } = {},
): Promise<CanonicalSpxGexForTelegram> {
  const db = env.SPX_RECAP_DB;
  if (!db) return { pcrValue: null, calculatedGex: null, heatmap: null, status: 'MISSING' };

  const generationStatus = getSpxGexGenerationStatus(now);
  const tradingDate = generationStatus.etDateKey;
  let heatmap = await readSpxGexHeatmap(db, tradingDate, generationStatus.snapshotMinuteEt);

  if (!heatmap && generationStatus.isGenerationWindow && options.allowGeneration !== false) {
    const result = await generateAndStoreSpxGexHeatmap({
      db,
      dataClient: options.dataClient || createSpxGexIntradayDataClient({ db, now }),
      now,
    });
    console.log(`[SPX_GEX_CANONICAL] ensure ${result.status} ${result.date}${'reason' in result ? ` ${result.reason}` : ` snapshot=${result.snapshotTimeEt} collected=${result.collectedTimeEt}`}`);
    heatmap = await readSpxGexHeatmap(db, tradingDate, generationStatus.snapshotMinuteEt);
  }

  if (!heatmap) {
    heatmap = await readSpxGexHeatmap(db, tradingDate);
  }

  if (!heatmap) {
    await logCanonicalGexFreshness(db, tradingDate, null);
    return { pcrValue: null, calculatedGex: null, heatmap: null, status: 'MISSING' };
  }
  if (!isUsableCanonicalSpxGexHeatmap(heatmap)) {
    console.error(`[SPX_GEX_CANONICAL] invalid normalized snapshot tradingDate=${tradingDate}`);
    return { pcrValue: null, calculatedGex: null, heatmap: null, status: 'INVALID' };
  }
  await logCanonicalGexFreshness(db, tradingDate, heatmap);
  try {
    return {
      pcrValue: await readCanonicalSnapshotPcrValue(db, heatmap),
      calculatedGex: toTelegramGexSummary(heatmap),
      heatmap,
      status: 'READY',
    };
  } catch (error) {
    console.error('[SPX_GEX_CANONICAL] canonical summary rejected', error instanceof Error ? error.message : String(error));
    return { pcrValue: null, calculatedGex: null, heatmap: null, status: 'INVALID' };
  }
}

const cleanVisibleModelText = (value: unknown) => {
  const jsonField =
    /(?:^|[,{]\s*)"?(?:decision|trade_action|rating|confidence|confidence_score|evidence|evidence_bullets|blockingRisk|blocking_risk|neutralReason|neutral_reason|reasoning|analysis|modelStatus)"?\s*:\s*(?:"(?:\\.|[^"\\])*"|null|true|false|-?\d+(?:\.\d+)?|\[[\s\S]*?\]|\{[\s\S]*?\})\s*,?/gi;
  return String(value || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .replace(jsonField, " ")
    .replace(/"(?:decision|trade_action|rating|confidence|confidence_score|evidence|evidence_bullets|blockingRisk|blocking_risk|neutralReason|neutral_reason|reasoning|analysis|modelStatus)"\s*:\s*/gi, " ")
    .replace(/[{}]/g, "")
    .replace(/^[\s,;:"'`)\]}]+/, "")
    .replace(/[\s,;:"'`)\]}]+$/, "")
    .trim();
};

const compactModelText = (value: unknown, maxLength = 520) => {
  const text = cleanVisibleModelText(String(value || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim());
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
};

const extractJsonStringField = (content: string, field: string) => {
  const pattern = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i");
  const match = String(content || "").match(pattern);
  if (!match) return "";
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1].replace(/\\"/g, '"').replace(/\\n/g, "\n");
  }
};

const extractJsonObjectText = (content: string) => {
  const text = String(content || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const source = (fenced?.[1] || text).trim();
  const firstBrace = source.indexOf("{");
  if (firstBrace < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = firstBrace; i < source.length; i += 1) {
    const char = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(firstBrace, i + 1);
    }
  }
  return null;
};

const parseLooseJsonObject = (content: string) => {
  const objectText = extractJsonObjectText(content);
  if (!objectText) return null;
  try {
    return JSON.parse(objectText) as Record<string, any>;
  } catch {
    return null;
  }
};

const normalizeAgentDecisionValue = (value: unknown) => {
  const decision = String(value || "HOLD").trim().toUpperCase();
  return ALLOWED_AGENT_DECISIONS.has(decision) ? decision : "HOLD";
};

const normalizeEvidenceList = (value: unknown, fallback: string[]) => {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[;|]/) : [];
  const cleaned = source
    .map((item) => compactModelText(item, 120))
    .filter(Boolean)
    .slice(0, 4);
  return cleaned.length > 0 ? cleaned : fallback.slice(0, 4);
};

const normalizeEvidenceRefs = (value: unknown) => (Array.isArray(value) ? value : [])
  .map((item) => String(item || '').trim())
  .filter((item) => /^[a-z0-9_.-]+$/i.test(item))
  .slice(0, 8);

const normalizeEvidenceClaims = (value: unknown) => (Array.isArray(value) ? value : [])
  .map((claim) => {
    const text = compactModelText(claim?.text, 180);
    const evidenceRefs = normalizeEvidenceRefs(claim?.evidenceRefs || claim?.evidence_refs);
    return text && evidenceRefs.length > 0
      ? { text, evidenceRefs, evidence_refs: evidenceRefs }
      : null;
  })
  .filter((claim): claim is { text: string; evidenceRefs: string[]; evidence_refs: string[] } => Boolean(claim))
  .slice(0, 6);

const isPlaceholderAgentText = (value: unknown) => {
  const text = compactModelText(value, 160).toLowerCase();
  return !text
    || text === "null"
    || text === "n/a"
    || text === "short analysis"
    || text.includes("concrete data field");
};

const normalizeAgentContract = (raw: Record<string, any>, fallbackReason: string): AgentDecisionContract => {
  const decision = normalizeAgentDecisionValue(raw.decision || raw.trade_action);
  const rating = (raw.rating === "bullish" || raw.rating === "bearish" || raw.rating === "neutral")
    ? raw.rating
    : getDecisionRating(decision);
  const confidence = clampConfidence(raw.confidence ?? raw.confidence_score, decision === "HOLD" ? 40 : 65);
  const neutralReason = rating === "neutral"
    ? compactModelText(raw.neutralReason || raw.neutral_reason || raw.reasoning || fallbackReason, 180)
    : null;
  const blockingRisk = compactModelText(raw.blockingRisk || raw.blocking_risk || "", 160) || null;
  const reasoning = compactModelText(raw.reasoning || raw.analysis || fallbackReason) || fallbackReason;
  const evidence = normalizeEvidenceList(raw.evidence || raw.evidence_bullets, [reasoning]);
  const evidenceRefs = normalizeEvidenceRefs(raw.evidenceRefs || raw.evidence_refs);
  const claims = normalizeEvidenceClaims(raw.claims);
  const traceableClaims = claims.length > 0 || evidenceRefs.length === 0
    ? claims
    : [{ text: reasoning, evidenceRefs, evidence_refs: evidenceRefs }];
  return {
    ...raw,
    decision,
    rating,
    confidence,
    confidence_score: confidence,
    evidence,
    evidenceRefs,
    evidence_refs: evidenceRefs,
    claims: traceableClaims,
    blockingRisk,
    blocking_risk: blockingRisk,
    neutralReason,
    neutral_reason: neutralReason,
    reasoning,
    analysis: compactModelText(raw.analysis || reasoning),
  };
};

export function isLikelyCopiedAgentSchema(agent: Partial<AgentDecisionContract>) {
  const decision = normalizeAgentDecisionValue(agent.decision);
  const confidence = clampConfidence(agent.confidence ?? agent.confidence_score, decision === "HOLD" ? 40 : 65);
  if (decision !== "HOLD" || confidence > 5) return false;

  const evidence = Array.isArray(agent.evidence) ? agent.evidence : [];
  const fields = [
    agent.neutralReason,
    agent.neutral_reason,
    agent.reasoning,
    agent.analysis,
    ...evidence,
  ].filter((value) => value !== null && value !== undefined);
  return fields.length === 0 || fields.every(isPlaceholderAgentText);
}

const hasVisibleContractLeak = (value: unknown) =>
  /"?(?:decision|trade_action|rating|confidence|confidence_score|evidence|evidence_bullets|blockingRisk|blocking_risk|neutralReason|neutral_reason|reasoning|analysis|modelStatus)"?\s*:/.test(String(value || ""));

const safeVisibleAgentText = (value: unknown, fallback: string, maxLength = 180) => {
  const cleaned = compactModelText(value, maxLength);
  if (!cleaned || hasVisibleContractLeak(cleaned)) return fallback;
  return cleaned;
};

const formatAgentModelSource = (agent: Partial<AgentDecisionContract>) => {
  const status = safeVisibleAgentText(agent.modelStatus || "", "", 64);
  return status ? `fallback:${status}` : "AI";
};

export function formatAgentTelegramBrief(personaKey: string, agent: Partial<AgentDecisionContract>) {
  personaKey = `${personaKey} [${formatAgentModelSource(agent)}]`;
  const decision = normalizeAgentDecisionValue(agent.decision);
  const confidence = clampConfidence(agent.confidence ?? agent.confidence_score, decision === "HOLD" ? 40 : 65);
  const evidence = normalizeEvidenceList(agent.evidence, [agent.reasoning || agent.analysis || "資料不足，保持觀望。"])
    .map((item) => safeVisibleAgentText(item, "", 110))
    .filter(Boolean)
    .slice(0, 2);
  const risk = safeVisibleAgentText(agent.blockingRisk || agent.blocking_risk || "", "", 120);
  const neutral = decision === "HOLD"
    ? safeVisibleAgentText(agent.neutralReason || agent.neutral_reason || "", "", 120)
    : "";
  const proof = evidence.length > 0 ? evidence.join("；") : safeVisibleAgentText(agent.reasoning || agent.analysis, "資料不足，保持觀望。", 140);
  const action = LONG_DECISIONS.has(decision)
    ? "偏多"
    : SHORT_DECISIONS.has(decision)
      ? "偏空"
      : "觀望";
  const guard = risk || neutral;
  return `${personaKey} ${action}，信心 ${confidence}/100。證據：${proof}${guard ? `。風險：${guard}` : ""}`;
}

export function parseAgentResponseContent(content: string) {
  const parsed = parseLooseJsonObject(content);
  if (parsed) {
    const reasoning = compactModelText(parsed.reasoning || parsed.analysis || content);
    return normalizeAgentContract({
      ...parsed,
      decision: normalizeAgentDecisionValue(parsed.decision),
      reasoning: reasoning || "模型回覆缺少理由，降級觀望。",
      analysis: compactModelText(parsed.analysis || reasoning || parsed.reasoning),
    }, "model_json_missing_reason");
  }

  const extractedReason = extractJsonStringField(content, "reasoning") || extractJsonStringField(content, "analysis");
  const fallbackReason = compactModelText(extractedReason || content) || "模型回覆格式錯誤；已改用數據規則降級。";
  return normalizeAgentContract({
    decision: "HOLD",
    reasoning: fallbackReason,
    analysis: fallbackReason,
    neutral_reason: "model_output_not_json",
    modelStatus: "model_output_not_json",
  }, fallbackReason);
}

export function parseAgentResponseWithDataFallback(personaKey: string, content: string, contextData: any) {
  const parsed = parseAgentResponseContent(content);
  return isLikelyCopiedAgentSchema(parsed)
    ? buildDataBackedAgentFallback(personaKey, contextData, "model_copied_schema_zero_confidence")
    : parsed;
}

export function parseOrchestratorResponseContent(content: string) {
  const parsed = parseLooseJsonObject(content);
  if (parsed) return parsed;

  const fallbackReason = compactModelText(content, 420) || "模型未回傳可讀執行計劃，降級觀望。";
  return {
    strategy: "觀望 (Hold)",
    trade_action: "HOLD",
    action_reasoning: "解析降級",
    logic: fallbackReason,
    buy_zone: "N/A",
    stop_loss: "N/A",
    take_profit: "N/A",
    risk_warning: "CIO output was not valid JSON; preserved source text and degraded to HOLD.",
  };
}

const hasHardNewSignalBlock = (contextData: any) => {
  const rule = contextData?.zeroDteRuleEngine || {};
  const position = contextData?.TODAYS_MEMORY?.currentPosition || "NONE";
  return position === "NONE" && (
    rule.hardRuleTriggered === true ||
    rule.verdict === "FREEZE_NEW_SIGNALS" ||
    (rule.verdict === "NO_TRADE" && toFiniteNumber(rule.signalScore, 0) < 45)
  );
};

export function buildDataBackedAgentFallback(personaKey: string, contextData: any, failureReason = "model_unavailable") {
  const key = String(personaKey || "").toUpperCase();
  const trend = contextData?.trendDayContext || {};
  const rule = contextData?.zeroDteRuleEngine || {};
  const price = toFiniteNumber(contextData?.currentPrice);
  const vwap = toFiniteNumber(contextData?.currentVWAP);
  const ema9 = toFiniteNumber(contextData?.ema9);
  const evidence = [
    `fallback=${failureReason}`,
    `price=${price || "n/a"} vwap=${vwap || "n/a"} ema9=${ema9 || "n/a"}`,
    `trend=${trend.regime || "UNKNOWN"} score=${trend.confidence ?? "n/a"}`,
    `0dte=${rule.verdict || "UNKNOWN"} score=${rule.signalScore ?? "n/a"}`,
  ];
  const blockingRisk = hasHardNewSignalBlock(contextData)
    ? `hard_block=${rule.verdict || "UNKNOWN"} ${(rule.hardBlocks || []).join(",")}`
    : `model_unavailable=${failureReason}`;
  const neutralReason = "Fail-closed: Council model output was unavailable or invalid; fallback cannot create direction.";

  return normalizeAgentContract({
    decision: "HOLD",
    confidence: 0,
    evidence,
    blocking_risk: blockingRisk,
    neutral_reason: neutralReason,
    reasoning: `${key || "AGENT"} DEGRADED HOLD: ${neutralReason}`,
    analysis: `${key || "AGENT"} fail-closed after ${failureReason}.`,
    modelStatus: failureReason,
  }, failureReason);
}

const normalizeCioAction = (value: unknown) => {
  const action = String(value || "HOLD").trim().toUpperCase();
  return ["OPEN_CALL", "OPEN_PUT", "CLOSE", "HOLD"].includes(action) ? action : "HOLD";
};

export function buildDataBackedCioPlan(contextData: any, agents: any[]) {
  const rule = contextData?.zeroDteRuleEngine || {};
  const votes = countDirectionalVotes(agents.map((agent) => agent?.decision));

  return {
    strategy: "DEGRADED HOLD",
    trade_action: "HOLD",
    action_reasoning: "fail_closed_cio_fallback",
    logic: `CIO model unavailable or invalid. Council tally CALL=${votes.buyVotes}, PUT=${votes.sellVotes}, HOLD=${votes.holdVotes}; deterministic fallback is forbidden from creating direction.`,
    buy_zone: "N/A",
    stop_loss: "N/A",
    take_profit: "N/A",
    risk_warning: `DEGRADED: CIO decision unavailable. Rule=${rule.verdict || "UNKNOWN"}.`,
    rule_engine_verdict: rule.verdict || "UNKNOWN",
    hard_rule_triggered: rule.hardRuleTriggered === true,
    confidence_score: 0,
    agent_vote_summary: votes,
    model_status: "DEGRADED_FALLBACK",
  };
}

export function applyRequiredSpxFreshnessGate(
  quality: MarketDataQualitySummary,
  sourceFreshness: MarketSnapshot["sourceFreshness"],
  runMode: "LIVE" | "UAT_REPLAY",
): MarketDataQualitySummary {
  const result: MarketDataQualitySummary = {
    overallStatus: quality.overallStatus,
    items: Object.fromEntries(Object.entries(quality.items).map(([key, item]) => [key, { ...item }])),
    hardBlocks: [...quality.hardBlocks],
    warnings: [...quality.warnings],
  };
  if (runMode === "UAT_REPLAY") {
    result.warnings = [...new Set([...result.warnings, "uat_replay_non_live"] )];
    result.overallStatus = result.hardBlocks.length > 0 ? "BLOCK" : "WARN";
    return result;
  }
  const requiredSources = [
    ["spxYahoo", "spx15m", "spx_15m"],
    ["spxM5Yahoo", "spx5m", "spx_5m"],
  ] as const;
  for (const [sourceKey, itemKey, reasonPrefix] of requiredSources) {
    const status = sourceFreshness[sourceKey]?.status || "MISSING";
    if (status === "OK" || status === "FALLBACK") continue;
    result.items[itemKey] = { ...(result.items[itemKey] || qualityItem(status, true, itemKey)), status };
    result.hardBlocks.push(`${reasonPrefix}_${status.toLowerCase()}`);
  }
  result.hardBlocks = [...new Set(result.hardBlocks)];
  result.overallStatus = result.hardBlocks.length > 0 ? "BLOCK" : result.warnings.length > 0 ? "WARN" : "OK";
  return result;
}

export function analyzeCompletedM5Bars(quotes: any[], snapshotAt: Date) {
  const snapshotMs = snapshotAt.getTime();
  const completed = quotes
    .filter((quote: any) => quote?.date instanceof Date && Number.isFinite(quote.date.getTime()))
    .filter((quote: any) => quote.close !== null && quote.close !== undefined)
    .filter((quote: any) => quote.date.getTime() + M5_INTERVAL_MS <= snapshotMs);
  const completedWithVolume = completed.filter((quote: any) => Number(quote.volume) > 0);
  const recent = completed.slice(-24);
  const latestCompleted = completed.at(-1) || null;
  const latestWithVolume = completedWithVolume.at(-1) || null;
  const previousTenWithVolume = completedWithVolume.slice(-11, -1);
  const avgM5Vol = previousTenWithVolume.length === 10
    ? previousTenWithVolume.reduce((sum: number, quote: any) => sum + Number(quote.volume || 0), 0) / 10
    : 0;
  const hasVolume = completedWithVolume.length >= 11;
  const currentM5Vol = hasVolume ? Number(latestWithVolume?.volume || 0) : null;

  return {
    completedBars: completed,
    boxHigh: recent.length >= 24 ? Math.max(...recent.map((quote: any) => Number(quote.high))) : 0,
    boxLow: recent.length >= 24 ? Math.min(...recent.map((quote: any) => Number(quote.low))) : 0,
    volumeSurge: hasVolume && avgM5Vol > 0 && currentM5Vol !== null ? currentM5Vol / avgM5Vol : null,
    currentM5Vol,
    avgM5Vol: hasVolume ? avgM5Vol : null,
    latestCompletedAt: latestCompleted?.date?.toISOString() || null,
  };
}

export const formatM5AnalysisForContext = (analysis: {
  boxHigh: number | null;
  boxLow: number | null;
  volumeSurge: number | null;
}) => ({
  boxHigh: Number.isFinite(analysis.boxHigh) ? Number(analysis.boxHigh).toFixed(2) : "UNAVAILABLE",
  boxLow: Number.isFinite(analysis.boxLow) ? Number(analysis.boxLow).toFixed(2) : "UNAVAILABLE",
  volumeSurge: Number.isFinite(analysis.volumeSurge) ? `${Number(analysis.volumeSurge).toFixed(2)}x` : "UNAVAILABLE",
});

export const buildCioContextProjection = (contextData: any, agents: any[]) => ({
  snapshotFacts: (() => {
    const facts = contextData?.snapshotFacts || {};
    const citedFacts = new Set(agents.flatMap((agent) => [
      ...normalizeEvidenceRefs(agent.evidenceRefs || agent.evidence_refs),
      ...normalizeEvidenceClaims(agent.claims).flatMap((claim) => claim.evidenceRefs),
    ]));
    const requiredFacts = new Set(["spx.last", "spx.vwap", "spx.ema9", "spx.ema20", "quality.status"]);
    return Object.fromEntries(Object.entries(facts).filter(([key]) => citedFacts.has(key) || requiredFacts.has(key)));
  })(),
  marketDataQuality: {
    overallStatus: contextData?.marketDataQuality?.overallStatus || "UNKNOWN",
    hardBlocks: contextData?.marketDataQuality?.hardBlocks || [],
    warnings: contextData?.marketDataQuality?.warnings || [],
  },
  currentPosition: contextData?.TODAYS_MEMORY?.currentPosition || "NONE",
  openPosition: contextData?.TODAYS_MEMORY?.openPosition || null,
  council: agents.map((agent, index) => ({
    agent: agent.agent || (["QM", "CM", "NT", "PA"][index] ?? null),
    decision: normalizeAgentDecisionValue(agent.decision),
    confidence: clampConfidence(agent.confidence ?? agent.confidence_score, 0),
    evidenceRefs: normalizeEvidenceRefs(agent.evidenceRefs || agent.evidence_refs),
    claims: normalizeEvidenceClaims(agent.claims).map((claim) => ({
      text: claim.text,
      evidence_refs: claim.evidenceRefs,
    })),
    reasoning: compactModelText(agent.reasoning, 180),
    modelStatus: agent.modelStatus || "AI",
  })),
});

export async function decideWithCio(
  contextData: any,
  agents: any[],
  env: Env,
  options: { fetcher?: typeof fetch } = {},
) {
  const fallbackPlan = buildDataBackedCioPlan(contextData, agents);
  if (!env.OPENROUTER_API_KEY) {
    return { plan: fallbackPlan, modelStatus: "MISSING_OPENROUTER_KEY", attempts: [] as ModelAttemptMetadata[] };
  }
  const projection = buildCioContextProjection(contextData, agents);
  const projectionBytes = new TextEncoder().encode(JSON.stringify(projection)).byteLength;
  const result = await runStructuredOpenRouterRequest({
    callKind: "cio",
    apiKey: env.OPENROUTER_API_KEY,
    model: env.SPX_CIO_MODEL || DEFAULT_SPX_CIO_MODEL,
    messages: [
      {
        role: "system",
        content: `${ORCHESTRATOR_PROMPT}\nYou are the sole direction authority. Return the strict JSON schema. Use only exact snapshotFacts keys in evidence_refs. Never infer facts outside this normalized projection.`,
      },
      { role: "user", content: `Normalized CIO projection: ${JSON.stringify(projection)}` },
    ],
    fetcher: options.fetcher,
    timeoutMs: SPX_CIO_TIMING_POLICY.primaryAttemptTimeoutMs,
    deadlineAtMs: Date.now() + SPX_CIO_TIMING_POLICY.absoluteDeadlineMs,
    allowedEvidenceRefs: Object.keys(projection.snapshotFacts),
    projectionBytes,
    factCount: Object.keys(projection.snapshotFacts).length,
    maxProjectionBytes: CIO_PROJECTION_MAX_BYTES,
    postParseValidator: (value) => validateCioModelPlan(
      value,
      new Set(Object.keys(contextData?.snapshotFacts || {})),
    ),
  });
  if (result.ok) {
    return {
      plan: result.value as CioModelPlan,
      modelStatus: "AI",
      attempts: result.attempts,
    };
  }
  const modelStatus = result.failureStatus === "model_timeout" || result.failureStatus === "cio_deadline_exceeded"
    ? "TIMEOUT"
    : result.failureStatus === "cio_schema_invalid"
      ? "INVALID_SCHEMA"
      : result.failureStatus === "cio_output_not_json"
        ? "INVALID_OUTPUT"
        : result.failureStatus === "cio_upstream_error"
          ? "UPSTREAM_ERROR"
          : result.failureStatus === "cio_unapproved_provider"
            ? "UNAPPROVED_PROVIDER"
            : result.failureStatus?.startsWith("cio_") || result.failureStatus?.startsWith("openrouter_")
              ? result.failureStatus.toUpperCase()
              : "REQUEST_FAILED";
  console.error(`[CIO] structured model failed after ${result.attempts.length} attempt(s): ${result.failureStatus}`);
  return { plan: fallbackPlan, modelStatus, attempts: result.attempts };
}

// --- 分析與邏輯函數 ---

function getDisabledNewsSentiment() {
  return {
    score: 0,
    label: 'neutral',
    reason: 'News sentiment model call disabled to reduce token usage.'
  };
}

async function calculateIndicators(quotes: any[]) {
  const closes = quotes.map(q => q.close).filter(c => c !== null) as number[];
  if (closes.length < 20) return null;

  const rsi = RSI.calculate({ values: closes, period: 14 });
  const bb = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
  const currentRSI = rsi[rsi.length - 1];
  const currentBB = bb[bb.length - 1];
  const currentClose = closes[closes.length - 1];
  const bandwidth = ((currentBB.upper - currentBB.lower) / currentBB.middle) * 100;

  const macd = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
  const currentMACD = macd.length > 0 ? macd[macd.length - 1] : null;

  const sma20 = SMA.calculate({ values: closes, period: 20 });
  const sma50 = SMA.calculate({ values: closes, period: 50 });
  const ema9 = EMA.calculate({ values: closes, period: 9 });
  const ema20 = EMA.calculate({ values: closes, period: 20 });

  // Calculate Intraday VWAP (using quotes from the latest trading day)
  const latestDateStr = quotes[quotes.length - 1].date.toDateString();
  const todayQuotes = quotes.filter(q => q.date.toDateString() === latestDateStr);
  let cumulativeTypicalVol = 0;
  let cumulativeVol = 0;
  for (const q of todayQuotes) {
    const typicalPrice = (q.high + q.low + q.close) / 3;
    const vol = q.volume || 0;
    cumulativeTypicalVol += typicalPrice * vol;
    cumulativeVol += vol;
  }
  const currentVWAP = cumulativeVol > 0 ? cumulativeTypicalVol / cumulativeVol : null;
  const vwapDeviation = currentVWAP === null ? null : ((currentClose - currentVWAP) / currentVWAP) * 100;

  return {
    currentClose,
    currentRSI,
    currentBB,
    bandwidth,
    isSqueeze: bandwidth < 1.5,
    recentHigh: quotes[quotes.length - 1].high,
    recentLow: quotes[quotes.length - 1].low,
    volume: quotes[quotes.length - 1].volume || 0,
    sma20: sma20.length > 0 ? sma20[sma20.length - 1] : null,
    sma50: sma50.length > 0 ? sma50[sma50.length - 1] : null,
    macd: currentMACD,
    ema9: ema9.length > 0 ? ema9[ema9.length - 1] : null,
    ema20: ema20.length > 0 ? ema20[ema20.length - 1] : null,
    currentVWAP,
    vwapDeviation
  };
}

function computeTrendDayContext(m5Quotes: any[], indicators: any, gexData: GexData | null): TrendDayContext {
  const fallback: TrendDayContext = {
    regime: "RANGE_OR_MIXED",
    directionalBias: "NONE",
    confidence: 0,
    recommendedAction: "HOLD",
    icAllowed: true,
    icBlockReason: null,
    previousClose: null,
    dayOpen: null,
    dayChangePct: null,
    fromOpenPct: null,
    rangePositionPct: null,
    priorBoxHigh: null,
    priorBoxLow: null,
    aboveVWAP: false,
    aboveEMA9: false,
    aboveGammaFlip: null,
    nearestExpiryGammaStatus: gexData?.zeroDteGammaStatus || gexData?.gammaStatus || null,
    rationale: "5分鐘資料不足，暫時當震盪市處理，唔好硬追方向。"
  };

  const validQuotes = m5Quotes.filter((q: any) => q?.close != null && q?.date instanceof Date);
  if (validQuotes.length < 12) return fallback;

  const latest = validQuotes[validQuotes.length - 1];
  const latestDate = latest.date.toDateString();
  const todayQuotes = validQuotes.filter((q: any) => q.date.toDateString() === latestDate);
  const priorQuotes = validQuotes.filter((q: any) => q.date.toDateString() !== latestDate);
  if (todayQuotes.length < 6) return fallback;

  const currentClose = Number(indicators.currentClose ?? latest.close);
  const previousClose = priorQuotes.length > 0 ? Number(priorQuotes[priorQuotes.length - 1].close) : null;
  const dayOpen = Number(todayQuotes[0].open ?? todayQuotes[0].close);
  const dayHigh = Math.max(...todayQuotes.map((q: any) => Number(q.high ?? q.close)));
  const dayLow = Math.min(...todayQuotes.map((q: any) => Number(q.low ?? q.close)));
  const dayRange = dayHigh - dayLow;
  const dayChangePct = previousClose ? ((currentClose - previousClose) / previousClose) * 100 : null;
  const fromOpenPct = dayOpen ? ((currentClose - dayOpen) / dayOpen) * 100 : null;
  const rangePositionPct = dayRange > 0 ? ((currentClose - dayLow) / dayRange) * 100 : 50;
  const priorWindow = todayQuotes.slice(Math.max(0, todayQuotes.length - 25), Math.max(0, todayQuotes.length - 1));
  const priorBoxHigh = priorWindow.length > 0 ? Math.max(...priorWindow.map((q: any) => Number(q.high ?? q.close))) : null;
  const priorBoxLow = priorWindow.length > 0 ? Math.min(...priorWindow.map((q: any) => Number(q.low ?? q.close))) : null;
  const vwap = toNullableFiniteNumber(indicators.currentVWAP);
  const aboveVWAP = vwap === null ? null : currentClose > vwap;
  const ema9 = indicators.ema9 != null ? Number(indicators.ema9) : null;
  const aboveEMA9 = ema9 != null ? currentClose > ema9 : false;
  const aboveGammaFlip = gexData?.gammaFlipLevel ? currentClose > gexData.gammaFlipLevel : null;
  const nearestExpiryGammaStatus = gexData?.zeroDteGammaStatus || gexData?.gammaStatus || null;

  let bullScore = 0;
  if ((dayChangePct ?? 0) >= 0.45) bullScore++;
  if ((fromOpenPct ?? 0) >= 0.25) bullScore++;
  if (aboveVWAP === true) bullScore++;
  if (aboveEMA9) bullScore++;
  if ((rangePositionPct ?? 50) >= 70) bullScore++;
  if (priorBoxHigh != null && currentClose >= priorBoxHigh - 1) bullScore++;
  if (aboveGammaFlip !== false) bullScore++;

  let bearScore = 0;
  if ((dayChangePct ?? 0) <= -0.45) bearScore++;
  if ((fromOpenPct ?? 0) <= -0.25) bearScore++;
  if (aboveVWAP === false) bearScore++;
  if (!aboveEMA9) bearScore++;
  if ((rangePositionPct ?? 50) <= 30) bearScore++;
  if (priorBoxLow != null && currentClose <= priorBoxLow + 1) bearScore++;
  if (aboveGammaFlip !== true) bearScore++;

  const isBullTrend = bullScore >= 4 && aboveVWAP !== false && aboveEMA9 && (((dayChangePct ?? 0) >= 0.45) || ((fromOpenPct ?? 0) >= 0.35));
  const isBearTrend = bearScore >= 4 && aboveVWAP !== true && !aboveEMA9 && (((dayChangePct ?? 0) <= -0.45) || ((fromOpenPct ?? 0) <= -0.35));
  const confidence = Math.round((Math.max(bullScore, bearScore) / 7) * 100);
  const fmt = (n: number | null) => n == null || !Number.isFinite(n) ? "N/A" : n.toFixed(2);

  if (isBullTrend) {
    const rationale = `單邊上升日：較昨日升 ${fmt(dayChangePct)}%，較開市升 ${fmt(fromOpenPct)}%，價格企在 VWAP/EMA9 之上，位於今日波幅頂部 ${Math.round(rangePositionPct)}%。`;
    return {
      regime: "BULL_TREND_DAY",
      directionalBias: "CALL",
      confidence,
      recommendedAction: "OPEN_CALL",
      icAllowed: false,
      icBlockReason: "單邊上升日唔適合開中性 0DTE 鐵鷹，容易被 CALL 邊打穿。",
      previousClose,
      dayOpen,
      dayChangePct,
      fromOpenPct,
      rangePositionPct,
      priorBoxHigh,
      priorBoxLow,
      aboveVWAP,
      aboveEMA9,
      aboveGammaFlip,
      nearestExpiryGammaStatus,
      rationale
    };
  }

  if (isBearTrend) {
    const rationale = `單邊下跌日：較昨日跌 ${fmt(dayChangePct)}%，較開市跌 ${fmt(fromOpenPct)}%，價格壓在 VWAP/EMA9 之下，位於今日波幅底部 ${Math.round(rangePositionPct)}%。`;
    return {
      regime: "BEAR_TREND_DAY",
      directionalBias: "PUT",
      confidence,
      recommendedAction: "OPEN_PUT",
      icAllowed: false,
      icBlockReason: "單邊下跌日唔適合開中性 0DTE 鐵鷹，容易被 PUT 邊打穿。",
      previousClose,
      dayOpen,
      dayChangePct,
      fromOpenPct,
      rangePositionPct,
      priorBoxHigh,
      priorBoxLow,
      aboveVWAP,
      aboveEMA9,
      aboveGammaFlip,
      nearestExpiryGammaStatus,
      rationale
    };
  }

  return {
    regime: "RANGE_OR_MIXED",
    directionalBias: "NONE",
    confidence,
    recommendedAction: "HOLD",
    icAllowed: true,
    icBlockReason: null,
    previousClose,
    dayOpen,
    dayChangePct,
    fromOpenPct,
    rangePositionPct,
    priorBoxHigh,
    priorBoxLow,
    aboveVWAP,
    aboveEMA9,
    aboveGammaFlip,
    nearestExpiryGammaStatus,
    rationale: `震盪或方向未清：多方分 ${bullScore}/7，空方分 ${bearScore}/7，未夠資格當單邊日。`
  };
}

function planReason(plan: any) {
  return plan?.logic || plan?.action_reasoning || plan?.buy_zone || plan?.risk_warning || "策略未提供具體理由";
}

async function getFundFlow(quotes: any[], etfQuotes: Record<string, any[]> = {}) {
  const windowSize = 24;
  const recentQuotes = quotes.slice(-windowSize);
  if (recentQuotes.length === 0) return null;

  let totalNet = 0;
  let superLarge = 0;
  let large = 0;
  let medium = 0;
  let small = 0;

  for (const q of recentQuotes) {
    const range = q.high - q.low;
    const buyPower = range > 0 ? (q.close - q.low) / range : 0.5;
    const netRatio = (buyPower - 0.5) * 2;
    const dollarVol = (q.volume || 1000000) * q.close;

    superLarge += dollarVol * 0.3 * netRatio;
    large += dollarVol * 0.25 * netRatio;
    medium += dollarVol * 0.25 * netRatio;
    small += dollarVol * 0.2 * netRatio;
  }

  totalNet = superLarge + large;

  // ETF Flow Analysis
  let etfInterpretation = "";
  if (etfQuotes['SPY'] && etfQuotes['IWM'] && etfQuotes['SPY'].length >= 2 && etfQuotes['IWM'].length >= 2) {
    const spyRet = etfQuotes['SPY'].slice(-1)[0]?.close / etfQuotes['SPY'].slice(-2)[0]?.close - 1;
    const iwmRet = etfQuotes['IWM'].slice(-1)[0]?.close / etfQuotes['IWM'].slice(-2)[0]?.close - 1;
    if (spyRet > 0 && iwmRet > 0) etfInterpretation += "全局 Risk-On (SPY/IWM 雙漲)。";
    else if (spyRet < 0 && iwmRet < 0) etfInterpretation += "全局 Risk-Off (SPY/IWM 雙跌)。";
    else etfInterpretation += "市場分化 (SPY/IWM 背離)。";
  }

  if (etfQuotes['XLK'] && etfQuotes['XLV'] && etfQuotes['XLK'].length >= 2 && etfQuotes['XLV'].length >= 2) {
    const xlkRet = etfQuotes['XLK'].slice(-1)[0]?.close / etfQuotes['XLK'].slice(-2)[0]?.close - 1;
    const xlvRet = etfQuotes['XLV'].slice(-1)[0]?.close / etfQuotes['XLV'].slice(-2)[0]?.close - 1;
    if (xlkRet > xlvRet) etfInterpretation += " 週期強於防禦 (XLK > XLV)，偏好成長。";
    else etfInterpretation += " 防禦強於週期 (XLV > XLK)，資金避險。";
  }

  return {
    mainNetInflow: totalNet,
    superLarge,
    large,
    medium,
    small,
    interpretation: (totalNet > 0 ? "主力資金強勢掃貨，" : "主力資金高位套現，") + etfInterpretation
  };
}

// --- Price Action Context Calculator ---
function calculatePriceActionContext(d1Quotes: any[], h1Quotes: any[]) {
  if (d1Quotes.length < 10 || h1Quotes.length < 10) return null;

  // D1 structure: find recent HH/HL or LH/LL
  const d1Closes = d1Quotes.slice(-20);
  const swingHighs: number[] = [];
  const swingLows: number[] = [];
  for (let i = 2; i < d1Closes.length - 2; i++) {
    const h = d1Closes[i].high;
    const l = d1Closes[i].low;
    if (h > d1Closes[i-1].high && h > d1Closes[i-2].high && h > d1Closes[i+1].high && h > d1Closes[i+2].high) swingHighs.push(h);
    if (l < d1Closes[i-1].low && l < d1Closes[i-2].low && l < d1Closes[i+1].low && l < d1Closes[i+2].low) swingLows.push(l);
  }

  let macroTrend = 'RANGING';
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const hh = swingHighs[swingHighs.length - 1] > swingHighs[swingHighs.length - 2];
    const hl = swingLows[swingLows.length - 1] > swingLows[swingLows.length - 2];
    const lh = swingHighs[swingHighs.length - 1] < swingHighs[swingHighs.length - 2];
    const ll = swingLows[swingLows.length - 1] < swingLows[swingLows.length - 2];
    if (hh && hl) macroTrend = 'UPTREND (HH/HL)';
    else if (lh && ll) macroTrend = 'DOWNTREND (LH/LL)';
  }

  // Detect recent BOS/CHoCH from last 5 D1 candles
  const recent5 = d1Closes.slice(-5);
  let recentBOS = false;
  let recentCHoCH = false;
  if (recent5.length >= 3) {
    const prevHigh = Math.max(recent5[0].high, recent5[1].high);
    const prevLow = Math.min(recent5[0].low, recent5[1].low);
    const latestClose = recent5[recent5.length - 1].close;
    if (macroTrend.includes('UPTREND') && latestClose > prevHigh) recentBOS = true;
    if (macroTrend.includes('DOWNTREND') && latestClose < prevLow) recentBOS = true;
    if (macroTrend.includes('UPTREND') && latestClose < prevLow) recentCHoCH = true;
    if (macroTrend.includes('DOWNTREND') && latestClose > prevHigh) recentCHoCH = true;
  }

  // Find nearest Order Block (last opposing candle before impulse) from 1H
  const h1Recent = h1Quotes.slice(-30);
  let nearestOB: { high: number; low: number; type: string } | null = null;
  for (let i = h1Recent.length - 3; i >= 1; i--) {
    const curr = h1Recent[i];
    const next = h1Recent[i + 1];
    const impulseUp = (next.close - next.open) > (curr.high - curr.low) * 1.5 && curr.close < curr.open;
    const impulseDown = (next.open - next.close) > (curr.high - curr.low) * 1.5 && curr.close > curr.open;
    if (impulseUp) { nearestOB = { high: curr.high, low: curr.low, type: '看漲訂單塊 (Bullish OB)' }; break; }
    if (impulseDown) { nearestOB = { high: curr.high, low: curr.low, type: '看跌訂單塊 (Bearish OB)' }; break; }
  }

  // Find nearest FVG from 1H
  let nearestFVG: { high: number; low: number; type: string } | null = null;
  for (let i = h1Recent.length - 1; i >= 2; i--) {
    const c1 = h1Recent[i - 2];
    const c3 = h1Recent[i];
    if (c3.low > c1.high) { nearestFVG = { high: c3.low, low: c1.high, type: '看漲缺口 (Bullish FVG)' }; break; }
    if (c1.low > c3.high) { nearestFVG = { high: c1.low, low: c3.high, type: '看跌缺口 (Bearish FVG)' }; break; }
  }

  // Fibonacci golden pocket from last swing
  const recentHigh = Math.max(...d1Closes.slice(-10).map((q: any) => q.high));
  const recentLow = Math.min(...d1Closes.slice(-10).map((q: any) => q.low));
  const range = recentHigh - recentLow;
  const fibGoldenPocket = macroTrend.includes('UPTREND')
    ? { top: recentHigh - range * 0.618, bottom: recentHigh - range * 0.786 }
    : { top: recentLow + range * 0.786, bottom: recentLow + range * 0.618 };

  return {
    macroTrend,
    recentBOS,
    recentCHoCH,
    swingHighs: swingHighs.slice(-3).map(h => h.toFixed(2)),
    swingLows: swingLows.slice(-3).map(l => l.toFixed(2)),
    nearestOB: nearestOB ? `${nearestOB.type} [${nearestOB.low.toFixed(2)}-${nearestOB.high.toFixed(2)}]` : 'None detected',
    nearestFVG: nearestFVG ? `${nearestFVG.type} [${nearestFVG.low.toFixed(2)}-${nearestFVG.high.toFixed(2)}]` : 'None detected',
    fibGoldenPocket: `${fibGoldenPocket.bottom.toFixed(2)} - ${fibGoldenPocket.top.toFixed(2)}`
  };
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getEtMinutes(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function parseEtTimestamp(input: string | null): Date | null {
  if (!input) return null;
  const nums = input.match(/\d+/g)?.map(Number);
  if (!nums || nums.length < 5) return null;
  const [year, month, day, hour, minute, second = 0] = nums;
  return new Date(year, month - 1, day, hour, minute, second);
}

const MARKET_TIME_ZONE = 'America/New_York';
const AUDIT_CRON = '15 17-21 * * MON-FRI';
// SPX GEX collection is gated in src/lib/spx-gex-heatmap.ts as a 15-minute delayed feed:
// collect 09:45-16:15 ET, display represented market time 09:30-16:00 ET.
const SPX_GEX_HEATMAP_CRON = '*/15 13-21 * * MON-FRI';
const SPX_HEALTH_ALERT_DEDUP_MS = 30 * 60_000;
const SPX_STALE_RUN_MS = 13 * 60_000;

interface ScheduledRunOptions {
  force?: boolean;
  openingRetryAttempt?: 2 | 3;
  fetchNow?: Date;
  debugReportPreview?: boolean;
  deliveryMode?: SpxDeliveryMode;
  runMode?: "LIVE" | "UAT_REPLAY";
}

function toDateKey(year: number, month: number, day: number) {
  return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function toEasternDate(date: Date) {
  return new Date(date.toLocaleString('en-US', { timeZone: MARKET_TIME_ZONE }));
}

function observedHolidayKey(year: number, monthIndex: number, day: number) {
  const date = new Date(year, monthIndex, day);
  const weekday = date.getDay();
  if (weekday === 6) date.setDate(date.getDate() - 1);
  if (weekday === 0) date.setDate(date.getDate() + 1);
  return toDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function nthWeekdayOfMonth(year: number, monthIndex: number, weekday: number, nth: number) {
  const date = new Date(year, monthIndex, 1);
  const offset = (weekday - date.getDay() + 7) % 7;
  date.setDate(1 + offset + (nth - 1) * 7);
  return date;
}

function lastWeekdayOfMonth(year: number, monthIndex: number, weekday: number) {
  const date = new Date(year, monthIndex + 1, 0);
  const offset = (date.getDay() - weekday + 7) % 7;
  date.setDate(date.getDate() - offset);
  return date;
}

function getEasterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function getFullMarketHolidayKeys(year: number) {
  const holidays = new Set<string>();
  const addDate = (date: Date) => holidays.add(toDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate()));

  holidays.add(observedHolidayKey(year, 0, 1));
  holidays.add(observedHolidayKey(year + 1, 0, 1));
  addDate(nthWeekdayOfMonth(year, 0, 1, 3));
  addDate(nthWeekdayOfMonth(year, 1, 1, 3));

  const goodFriday = getEasterSunday(year);
  goodFriday.setDate(goodFriday.getDate() - 2);
  addDate(goodFriday);

  addDate(lastWeekdayOfMonth(year, 4, 1));

  if (year >= 2022) {
    holidays.add(observedHolidayKey(year, 5, 19));
  }

  holidays.add(observedHolidayKey(year, 6, 4));
  addDate(nthWeekdayOfMonth(year, 8, 1, 1));
  addDate(nthWeekdayOfMonth(year, 10, 4, 4));
  holidays.add(observedHolidayKey(year, 11, 25));

  return holidays;
}

function getEarlyCloseMarketHolidayKeys(year: number, fullHolidayKeys = getFullMarketHolidayKeys(year)) {
  const earlyCloses = new Set<string>();
  const addIfTradingDay = (date: Date) => {
    const key = toDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const weekday = date.getDay();
    if (weekday !== 0 && weekday !== 6 && !fullHolidayKeys.has(key)) {
      earlyCloses.add(key);
    }
  };

  const julyThird = new Date(year, 6, 3);
  addIfTradingDay(julyThird);

  const dayAfterThanksgiving = nthWeekdayOfMonth(year, 10, 4, 4);
  dayAfterThanksgiving.setDate(dayAfterThanksgiving.getDate() + 1);
  addIfTradingDay(dayAfterThanksgiving);

  const christmasEve = new Date(year, 11, 24);
  addIfTradingDay(christmasEve);

  return earlyCloses;
}

export function getMarketScheduleStatus(now: Date = new Date()) {
  const etNow = toEasternDate(now);
  const etDateKey = toDateKey(etNow.getFullYear(), etNow.getMonth() + 1, etNow.getDate());
  const weekday = etNow.getDay();
  const minutes = getEtMinutes(etNow);
  const isWeekend = weekday === 0 || weekday === 6;
  const fullHolidayKeys = getFullMarketHolidayKeys(etNow.getFullYear());
  const isFullHoliday = fullHolidayKeys.has(etDateKey);
  const isMarketOpenDay = !isWeekend && !isFullHoliday;
  const isEarlyClose = isMarketOpenDay && getEarlyCloseMarketHolidayKeys(etNow.getFullYear(), fullHolidayKeys).has(etDateKey);
  // The final scheduled decision slot is a deterministic flattening pass, not
  // a discretionary trade window.  It leaves fifteen minutes before the cash
  // close for the advisory close to be acted on without keeping a strategy
  // position overnight.
  const closeFlattenMinutes = isEarlyClose ? 12 * 60 + 45 : 15 * 60 + 45;
  const tradingEndMinutes = closeFlattenMinutes;
  const auditMinutes = isEarlyClose ? 13 * 60 + 15 : 16 * 60 + 15;

  return {
    etNow,
    etDateKey,
    minutes,
    isMarketOpenDay,
    isEarlyClose,
    isTradingWindow: isMarketOpenDay && minutes >= 10 * 60 && minutes <= tradingEndMinutes,
    isCloseFlattenWindow: isMarketOpenDay && minutes === closeFlattenMinutes,
    isAuditWindow: isMarketOpenDay && minutes === auditMinutes,
    skipReason: isWeekend ? 'weekend' : isFullHoliday ? 'us_market_holiday' : null
  };
}

export const END_OF_DAY_FLATTEN_REASON = 'end_of_day_flatten';

export function getEndOfDayRiskDirective(
  marketStatus: Pick<ReturnType<typeof getMarketScheduleStatus>, 'isCloseFlattenWindow'>,
  currentPosition: SpxPosition,
): RiskGateDirective | null {
  if (!marketStatus.isCloseFlattenWindow) return null;
  return currentPosition === 'NONE'
    ? { disposition: 'VETO_TO_HOLD', reason: END_OF_DAY_FLATTEN_REASON }
    : { disposition: 'REQUIRE_CLOSE', reason: END_OF_DAY_FLATTEN_REASON };
}

function getConsecutiveLosses(actionLog: ActionLogItem[]) {
  let losses = 0;
  for (let i = actionLog.length - 1; i >= 0; i--) {
    const pnl = actionLog[i].pnl;
    if (pnl == null) continue;
    if (pnl < 0) losses++;
    else break;
  }
  return losses;
}

function getDailyPnlPoints(actionLog: ActionLogItem[]) {
  return actionLog.reduce((sum, item) => sum + (item.pnl || 0), 0);
}

function hasUnverifiedMacroEventRisk(sentimentData: any) {
  const text = `${sentimentData?.label || ""} ${sentimentData?.reason || ""}`.toLowerCase();
  return /\b(cpi|fomc|fed|powell|nfp|jobs report|payroll|inflation|rate decision)\b/.test(text);
}

function bucketLevel(price: number, bucketSize = 5) {
  return Math.round(price / bucketSize) * bucketSize;
}

function buildKeyLevels(prices: number[], currentPrice: number, kind: "support" | "resistance"): IntradayKeyLevel[] {
  const counts = new Map<number, number>();
  for (const price of prices) {
    if (!Number.isFinite(price)) continue;
    const level = bucketLevel(price);
    counts.set(level, (counts.get(level) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([level, touches]) => ({
      level,
      touches,
      kind,
      distance: Math.abs(currentPrice - level)
    }))
    .filter((item) => item.touches >= 2)
    .sort((a, b) => b.touches - a.touches || a.distance - b.distance);
}

function getNearestLevel(levels: IntradayKeyLevel[], currentPrice: number, direction: "below" | "above") {
  const filtered = levels
    .filter((level) => direction === "below" ? level.level <= currentPrice : level.level >= currentPrice)
    .sort((a, b) => a.distance - b.distance || b.touches - a.touches);
  return filtered[0] || null;
}

function computeIntradayStructureContext(m5Quotes: any[], currentPrice: number): IntradayStructureContext {
  const validQuotes = m5Quotes
    .filter((q: any) => q?.high != null && q?.low != null && q?.close != null)
    .slice(-72);

  if (validQuotes.length < 18 || !Number.isFinite(currentPrice)) {
    return {
      nearestSupport: null,
      nearestResistance: null,
      repeatedSupport: null,
      repeatedResistance: null,
      targetDisciplineNote: "5分鐘資料不足，止盈止損先跟 VWAP/EMA9 同 GEX 關鍵位。"
    };
  }

  const supports = buildKeyLevels(validQuotes.map((q: any) => Number(q.low)), currentPrice, "support");
  const resistances = buildKeyLevels(validQuotes.map((q: any) => Number(q.high)), currentPrice, "resistance");
  const nearestSupport = getNearestLevel(supports, currentPrice, "below");
  const nearestResistance = getNearestLevel(resistances, currentPrice, "above");
  const repeatedSupport = supports.find((level) => level.level <= currentPrice && level.touches >= 3) || null;
  const repeatedResistance = resistances.find((level) => level.level >= currentPrice && level.touches >= 3) || null;

  const notes: string[] = [];
  if (repeatedSupport) {
    notes.push(`${repeatedSupport.level} 附近係重複支撐，已經守住 ${repeatedSupport.touches} 次；做 PUT 要先喺支撐前收割，除非價格明確跌穿並企穩下面。`);
  }
  if (repeatedResistance) {
    notes.push(`${repeatedResistance.level} 附近係重複阻力，已經壓住 ${repeatedResistance.touches} 次；做 CALL 要先喺阻力前收割，除非價格明確升穿並企穩上面。`);
  }

  return {
    nearestSupport,
    nearestResistance,
    repeatedSupport,
    repeatedResistance,
    targetDisciplineNote: notes.join(" ") || "暫時未見重複日內牆位，止盈用 GEX 牆位加 M5 trailing。"
  };
}

function appendPlanSnapshot(
  logItem: ActionLogItem,
  plan: any,
  ruleEngine: ZeroDteRuleEngineResult,
  meta: {
    runId?: string;
    dataQuality?: MarketDataQualitySummary;
    agentVotes?: Record<string, unknown>;
    cioConfidence?: number;
  } = {},
): ActionLogItem {
  return {
    ...logItem,
    buyZone: plan?.buy_zone,
    stopLoss: plan?.stop_loss,
    takeProfit: Array.isArray(plan?.targets) ? plan.targets.join(" | ") : plan?.take_profit,
    riskWarning: plan?.risk_warning,
    ruleEngineVerdict: ruleEngine.verdict,
    signalScore: ruleEngine.signalScore,
    runId: meta.runId,
    dataQuality: meta.dataQuality,
    agentVotes: meta.agentVotes,
    cioConfidence: meta.cioConfidence,
  };
}

export function analyzeZeroDteRules(args: {
  etNow: Date;
  spxInd: any;
  m5Analysis: { volumeSurge: number; currentM5Vol?: number; avgM5Vol?: number };
  currentVix: number | null | undefined;
  currentVix9d: number | null | undefined;
  pcrValue: number | null;
  calculatedGex: GexData | null;
  trendDayContext: TrendDayContext;
  intradayStructure: IntradayStructureContext;
  dailyMemory: DailyMemory;
  sentimentData: any;
  priceActionContext: any;
  marketDataQuality?: MarketDataQualitySummary;
}): ZeroDteRuleEngineResult {
  const {
    etNow,
    spxInd,
    m5Analysis,
    currentVix,
    currentVix9d,
    pcrValue,
    calculatedGex,
    trendDayContext,
    intradayStructure,
    dailyMemory,
    sentimentData,
    priceActionContext,
    marketDataQuality
  } = args;

  const hardBlocks: string[] = [];
  const softWarnings: string[] = [];
  const advisoryNotes: string[] = [];
  let score = 45;

  const currentPrice = Number(spxInd.currentClose);
  const ema9 = spxInd.ema9 != null ? Number(spxInd.ema9) : null;
  const ema20 = spxInd.ema20 != null ? Number(spxInd.ema20) : null;
  const vwap = spxInd.currentVWAP != null ? Number(spxInd.currentVWAP) : null;
  const macdHistogram = spxInd.macd?.histogram != null ? Number(spxInd.macd.histogram) : null;
  const volumeSurge = Number(m5Analysis.volumeSurge || 1);
  const gammaFlip = calculatedGex?.gammaFlipLevel ? Number(calculatedGex.gammaFlipLevel) : null;

  const aboveVwap = vwap != null && currentPrice > vwap;
  const belowVwap = vwap != null && currentPrice < vwap;
  const emaBull = ema9 != null && ema20 != null && ema9 > ema20 && currentPrice > ema9;
  const emaBear = ema9 != null && ema20 != null && ema9 < ema20 && currentPrice < ema9;
  const macdBull = macdHistogram != null && macdHistogram > 0;
  const macdBear = macdHistogram != null && macdHistogram < 0;
  const aboveGammaFlip = gammaFlip != null ? currentPrice > gammaFlip : null;
  const nearGammaFlip = gammaFlip != null && Math.abs(currentPrice - gammaFlip) <= 8;
  const isTrendDay = trendDayContext.regime === "BULL_TREND_DAY" || trendDayContext.regime === "BEAR_TREND_DAY";
  const isNegativeGamma = calculatedGex?.zeroDteGammaStatus === "negative_gamma" || calculatedGex?.gammaStatus === "negative_gamma";
  const macroEventRisk = hasUnverifiedMacroEventRisk(sentimentData);
  const volumeReliable = Number(m5Analysis.avgM5Vol || 0) > 0 && Number(m5Analysis.currentM5Vol || 0) > 0;
  const gammaPinningDetected = Boolean(
    calculatedGex?.zeroDteGammaStatus === "positive_gamma" &&
    !isTrendDay &&
    (nearGammaFlip ||
      calculatedGex.longWalls?.some((w) => Math.abs(currentPrice - Number(w.strike)) <= 8))
  );
  const thetaDecayRiskHigh = dailyMemory.currentPosition !== "NONE" && getEtMinutes(etNow) >= 14 * 60 + 30;

  let callScore = 0;
  let putScore = 0;
  if (aboveVwap) callScore += 2;
  if (belowVwap) putScore += 2;
  if (emaBull) callScore += 2;
  if (emaBear) putScore += 2;
  if (macdBull) callScore += 1;
  if (macdBear) putScore += 1;
  if (aboveGammaFlip === true) callScore += 1;
  if (aboveGammaFlip === false) putScore += 1;
  if (trendDayContext.directionalBias === "CALL") callScore += 3;
  if (trendDayContext.directionalBias === "PUT") putScore += 3;
  if (priceActionContext?.macroTrend?.includes("UPTREND")) callScore += 1;
  if (priceActionContext?.macroTrend?.includes("DOWNTREND")) putScore += 1;

  const directionalBias: "CALL" | "PUT" | "NONE" =
    callScore >= putScore + 2 ? "CALL" : putScore >= callScore + 2 ? "PUT" : "NONE";

  if (directionalBias !== "NONE") score += 14;
  if (isTrendDay) score += 12;
  if (isNegativeGamma && directionalBias !== "NONE") score += 8;
  if (volumeReliable && volumeSurge >= 1.25) score += 8;
  else if (!volumeReliable && isTrendDay) {
    score += 4;
    softWarnings.push("index_volume_unavailable_using_price_trend");
  }
  else {
    score -= 8;
    softWarnings.push("volume_follow_through_weak");
  }
  if (!calculatedGex) softWarnings.push("gex_missing");
  if (!(currentVix && currentVix9d)) softWarnings.push("vix_term_structure_missing");
  if (pcrValue == null) softWarnings.push("pcr_missing");
  if (gammaPinningDetected) {
    score -= 12;
    advisoryNotes.push("gamma_pinning_detected");
  }
  if (thetaDecayRiskHigh) {
    score -= 10;
    softWarnings.push("theta_decay_risk_high");
  }
  if (macroEventRisk && isTrendDay && directionalBias !== "NONE") {
    score += 6;
    advisoryNotes.push("macro_event_is_catalyst_verify_calendar");
  } else if (macroEventRisk) {
    score -= 10;
    softWarnings.push("macro_event_risk_unverified");
  }
  if (directionalBias === "NONE") {
    score -= 12;
    softWarnings.push("signal_conflict");
  }

  if (directionalBias === "PUT" && intradayStructure.repeatedSupport && intradayStructure.repeatedSupport.distance <= 12) {
    score -= 6;
    advisoryNotes.push(`put_target_near_repeated_support_${intradayStructure.repeatedSupport.level}`);
  }
  if (directionalBias === "CALL" && intradayStructure.repeatedResistance && intradayStructure.repeatedResistance.distance <= 12) {
    score -= 6;
    advisoryNotes.push(`call_target_near_repeated_resistance_${intradayStructure.repeatedResistance.level}`);
  }

  const minutesNow = getEtMinutes(etNow);
  const marketOpen = 9 * 60 + 30;
  if (minutesNow >= marketOpen && minutesNow < marketOpen + 5) {
    hardBlocks.push("first_5_minutes_no_chasing");
  }
  const consecutiveLosses = getConsecutiveLosses(dailyMemory.actionLog);
  const dailyPnlPoints = getDailyPnlPoints(dailyMemory.actionLog);
  if (consecutiveLosses >= 3 || dailyPnlPoints <= -30) {
    hardBlocks.push("daily_circuit_breaker");
  }
  if (marketDataQuality?.overallStatus === "BLOCK") {
    hardBlocks.push(...marketDataQuality.hardBlocks);
  }

  let positionTimedOut = false;
  if (dailyMemory.currentPosition !== "NONE" && dailyMemory.entryPrice != null) {
    const entryDate = parseEtTimestamp(dailyMemory.entryTime);
    const elapsedMinutes = entryDate ? (etNow.getTime() - entryDate.getTime()) / 60000 : null;
    const expectedMove =
      dailyMemory.currentPosition === "CALL"
        ? currentPrice - dailyMemory.entryPrice
        : dailyMemory.entryPrice - currentPrice;
    if (elapsedMinutes != null && elapsedMinutes >= 15 && expectedMove <= 0) {
      positionTimedOut = true;
      hardBlocks.push("position_no_follow_through_after_15m");
    }
  }

  score = clampNumber(Math.round(score), 0, 100);

  let marketRegime: ZeroDteRuleEngineResult["marketRegime"] = "UNKNOWN";
  if (gammaPinningDetected) marketRegime = "GAMMA_PIN";
  else if (trendDayContext.regime === "BULL_TREND_DAY" || trendDayContext.regime === "BEAR_TREND_DAY") marketRegime = "TREND";
  else if (trendDayContext.regime === "RANGE_OR_MIXED") marketRegime = "CHOP";

  let verdict: ZeroDteAdvisoryVerdict = "WAIT_AND_OBSERVE";
  if (positionTimedOut) verdict = "CLOSE_OR_REDUCE_SUGGESTED";
  else if (hardBlocks.includes("daily_circuit_breaker")) verdict = "FREEZE_NEW_SIGNALS";
  else if (hardBlocks.length > 0 || score < 45) verdict = "NO_TRADE";
  else if (
    directionalBias !== "NONE" &&
    (score >= 70 || (isTrendDay && score >= 62) || (isNegativeGamma && score >= 62))
  ) verdict = "TRADE_ALLOWED";

  return {
    verdict,
    directionalBias,
    marketRegime,
    signalScore: score,
    hardBlocks,
    softWarnings,
    advisoryNotes,
    activeRisks: [...softWarnings, ...advisoryNotes],
    allowNewSignal: verdict === "TRADE_ALLOWED",
    hardRuleTriggered: hardBlocks.length > 0,
    thetaDecayRiskHigh,
    gammaPinningDetected,
    liquidityRisk: "UNKNOWN",
    dataQuality: {
      status: marketDataQuality?.overallStatus || "OK",
      warnings: [...(marketDataQuality?.warnings || [])],
    },
    tradeEligibility: {
      hardBlocked: hardBlocks.length > 0,
      reasons: [...hardBlocks],
    },
  };
}

export const buildAgentContextProjection = (personaKey: string, contextData: any) => {
  const prefixByAgent: Record<string, string[]> = {
    QM: ["spx.", "m5.", "trend.", "zeroDte.", "quality.", "freshness.spx"],
    CM: ["spx.last", "spx.vwap", "spx.ema9", "gex.", "trend.", "quality.", "freshness.gex"],
    NT: ["spx.bollingerBandwidthPct", "spx.isSqueeze", "vix.", "vix9d.", "gex.gammaStatus", "gex.zeroDteGammaStatus", "options.", "zeroDte.", "quality.", "freshness."],
    PA: ["spx.last", "spx.vwap", "spx.ema9", "spx.ema20", "m5.", "trend.", "price.", "zeroDte.", "quality.", "freshness.spx"],
  };
  const allowedPrefixes = prefixByAgent[String(personaKey || "").toUpperCase()] || ["spx."];
  const roleFacts = Object.fromEntries(Object.entries(contextData?.snapshotFacts || {})
    .filter(([key]) => allowedPrefixes.some((prefix) => key === prefix || key.startsWith(prefix))));
  return {
    role: String(personaKey || "").toUpperCase(),
    snapshotFacts: roleFacts,
    marketDataQuality: {
      overallStatus: contextData?.marketDataQuality?.overallStatus || "UNKNOWN",
      hardBlocks: contextData?.marketDataQuality?.hardBlocks || [],
      warnings: contextData?.marketDataQuality?.warnings || [],
    },
    currentPosition: contextData?.TODAYS_MEMORY?.currentPosition || "NONE",
  };
};

export async function analyzeWithAgent(
  personaKey: string,
  personaPrompt: string,
  contextData: any,
  env: Env,
  options: { fetcher?: typeof fetch; deadlineAtMs?: number } = {},
) {
  const startedAt = Date.now();
  const finish = (analysis: AgentDecisionContract): AgentDecisionContract => ({
    ...analysis,
    latencyMs: Math.max(0, Date.now() - startedAt),
  });
  const systemPrompt = `You are an SPX council analyst with this role: ${personaPrompt}. Analyze only the supplied normalized snapshotFacts. Return exactly one JSON object and no markdown with exactly these fields: decision, confidence_score, evidence_refs, blocking_risk, reasoning. decision must be CALL, PUT, or HOLD analysis, never OPEN_* execution language. confidence_score must be 1-100. evidence_refs must contain 1-4 exact supplied snapshotFacts keys. blocking_risk must be null or at most 80 characters. reasoning must be a non-empty string of at most 180 characters. For HOLD, state the concrete conflict in reasoning. You analyze; you never execute trades or override the CIO.`;
  if (!env.OPENROUTER_API_KEY) {
    return finish({
      ...buildDataBackedAgentFallback(personaKey, contextData, "missing_openrouter_key"),
      attempts: [],
    });
  }
  const projection = buildAgentContextProjection(personaKey, contextData);
  const projectionJson = JSON.stringify(projection);
  const projectionBytes = new TextEncoder().encode(projectionJson).byteLength;
  const result = await runStructuredOpenRouterRequest({
    callKind: "agent",
    apiKey: env.OPENROUTER_API_KEY,
    model: env.SPX_COUNCIL_MODEL || env.OPENROUTER_MODEL || DEFAULT_SPX_COUNCIL_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Normalized ${personaKey} projection: ${projectionJson}` },
    ],
    fetcher: options.fetcher,
    timeoutMs: SPX_COUNCIL_TIMING_POLICY.attemptTimeoutMs,
    allowedEvidenceRefs: Object.keys(projection.snapshotFacts),
    projectionBytes,
    factCount: Object.keys(projection.snapshotFacts).length,
    maxProjectionBytes: AGENT_PROJECTION_MAX_BYTES,
    deadlineAtMs: options.deadlineAtMs,
  });
  if (!result.ok) {
    console.error(`[COUNCIL:${personaKey}] structured model failed after ${result.attempts.length} attempt(s): ${result.failureStatus}`);
    return finish({
      ...buildDataBackedAgentFallback(personaKey, contextData, result.failureStatus || "model_request_failed"),
      attempts: result.attempts,
    });
  }
  const parsed = parseAgentResponseContent(JSON.stringify(result.value));
  return finish({
    ...parsed,
    modelStatus: "AI",
    attempts: result.attempts,
  });
}

export async function runCouncilAnalyses(
  contextData: any,
  env: Env,
  options: { fetcher?: typeof fetch; deadlineMs?: number } = {},
) {
  const deadlineAtMs = Date.now() + (options.deadlineMs ?? SPX_COUNCIL_TIMING_POLICY.absoluteDeadlineMs);
  return Promise.all([
    analyzeWithAgent("QM", PERSONAS.QM_MOMENTUM_SNIPER, contextData, env, { fetcher: options.fetcher, deadlineAtMs }),
    analyzeWithAgent("CM", PERSONAS.CM_OPTIONS_MAKER, contextData, env, { fetcher: options.fetcher, deadlineAtMs }),
    analyzeWithAgent("NT", NT_VOLATILITY_RISK_PROMPT, contextData, env, { fetcher: options.fetcher, deadlineAtMs }),
    analyzeWithAgent("PA", PERSONAS.PA_PRICE_ACTION, contextData, env, { fetcher: options.fetcher, deadlineAtMs }),
  ]);
}

export const buildTelegramSendPayload = (chatId: string, text: string, parseMode: "HTML" | null = "HTML") => ({
  chat_id: chatId,
  text,
  ...(parseMode ? { parse_mode: parseMode } : {}),
  disable_web_page_preview: true,
});

export const buildSpxDecisionTelegramPayload = (chatId: string, text: string) =>
  buildTelegramSendPayload(chatId, tgEscape(text), "HTML");

async function sendTelegramMessage(token: string, chatId: string, text: string, parseMode: "HTML" | null = "HTML") {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildTelegramSendPayload(chatId, text, parseMode))
  }, TELEGRAM_TIMEOUT_MS);
  const resData = await res.json() as any;
  if (!res.ok) {
    throw new Error(`telegram_http_${res.status}:${compactModelText(resData?.description || JSON.stringify(resData), 180)}`);
  }
  const messageId = resData?.result?.message_id;
  if (messageId === null || messageId === undefined) throw new Error('telegram_response_missing_message_id');
  console.log(`[TELEGRAM] Delivered message_id=${messageId}`);
  return { messageId: String(messageId) };
}

const sendSpxDecisionTelegramMessage = async (token: string, chatId: string, text: string) => {
  const payload = buildSpxDecisionTelegramPayload(chatId, text);
  return sendTelegramMessage(token, chatId, payload.text, "HTML");
};

export function hasActiveTradingRunLock(rawLock: string | null, nowMs = Date.now()) {
  if (!rawLock) return false;
  try {
    const parsed = JSON.parse(rawLock);
    return Number(parsed.expiresAtMs || 0) > nowMs;
  } catch {
    return false;
  }
}

async function acquireTradingRunLock(env: Env, now: Date, options: ScheduledRunOptions) {
  try {
    const rawLock = await env.SPX_MEMORY.get(TRADING_RUN_LOCK_KEY);
    if (!options.force && hasActiveTradingRunLock(rawLock, now.getTime())) {
      console.log("[SCHEDULE] Skip trading run: active trading lock still valid");
      return null;
    }

    const token = `${now.toISOString()}-${Math.random().toString(36).slice(2)}`;
    await env.SPX_MEMORY.put(TRADING_RUN_LOCK_KEY, JSON.stringify({
      token,
      startedAt: now.toISOString(),
      expiresAtMs: now.getTime() + TRADING_RUN_LOCK_TTL_SECONDS * 1000,
    }), { expirationTtl: TRADING_RUN_LOCK_TTL_SECONDS });
    return token;
  } catch (error) {
    console.error("[SCHEDULE] Trading lock unavailable; run stopped fail-closed", error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function releaseTradingRunLock(env: Env, token: string | null) {
  if (!token || token === "lock_unavailable") return;
  try {
    const rawLock = await env.SPX_MEMORY.get(TRADING_RUN_LOCK_KEY);
    const parsed = rawLock ? JSON.parse(rawLock) : null;
    if (parsed?.token === token) {
      await env.SPX_MEMORY.delete(TRADING_RUN_LOCK_KEY);
    }
  } catch (error) {
    console.error("[SCHEDULE] Trading lock release failed", error instanceof Error ? error.message : String(error));
  }
}

function tgEscape(str: string): string {
  if (!str) return "";
  // 處理 AI 返回的字面 "\n" 符號，將其轉換為真實的換行
  return str.replace(/\\n/g, '\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const makeDecisionRunRecord = (runId: string, scheduledAt: Date, runMode: "LIVE" | "UAT_REPLAY" = "LIVE"): DecisionRunRecord => {
  const createdAt = new Date().toISOString();
  return {
    runId,
    scheduledAt: scheduledAt.toISOString(),
    currentStage: 'SCHEDULED',
    snapshot: null,
    council: null,
    cioDecision: null,
    riskGate: null,
    finalDecision: null,
    finalAction: null,
    degraded: false,
    degradedReason: null,
    createdAt,
    updatedAt: createdAt,
    runMode,
  };
};

const appendDecisionLifecycle = async (
  store: D1SpxDecisionStore,
  run: DecisionRunRecord,
  stage: SpxLifecycleStage,
  payload: Record<string, unknown> = {},
  latencyMs: number | null = null,
  attempt = 0,
) => {
  const occurredAt = new Date().toISOString();
  run.currentStage = stage;
  run.updatedAt = occurredAt;
  // Persist the stage payload before making the lifecycle event visible. A crash
  // after SNAPSHOT_READY/COUNCIL_COMPLETED must not leave an empty run shell.
  await store.persistDecision(run);
  await store.appendLifecycle({ runId: run.runId, stage, occurredAt, attempt, latencyMs, payload });
};

const toCouncilDecision = (value: unknown): 'CALL' | 'PUT' | 'HOLD' => {
  const normalized = normalizeAgentDecisionValue(value);
  if (LONG_DECISIONS.has(normalized)) return 'CALL';
  if (SHORT_DECISIONS.has(normalized)) return 'PUT';
  return 'HOLD';
};

const buildCouncilResult = (agents: Record<'QM' | 'CM' | 'NT' | 'PA', AgentDecisionContract>, latencyMs: number): CouncilResult => {
  const ordered = (['QM', 'CM', 'NT', 'PA'] as const).map((agent) => {
    const analysis = agents[agent];
    const modelStatus = analysis.modelStatus || 'AI';
    return {
      agent,
      decision: toCouncilDecision(analysis.decision),
      confidence: clampConfidence(analysis.confidence ?? analysis.confidence_score, 0),
      evidenceRefs: [...analysis.evidenceRefs],
      claims: analysis.claims.map((claim) => ({ text: claim.text, evidenceRefs: [...claim.evidenceRefs] })),
      modelStatus,
      fallbackStatus: modelStatus === 'AI' ? null : modelStatus,
      latencyMs: analysis.latencyMs ?? latencyMs,
      reasoning: analysis.reasoning,
      valid: modelStatus === 'AI',
      attempts: analysis.attempts || [],
    };
  });
  const degradedAgent = ordered.find((agent) => agent.modelStatus !== 'AI');
  return {
    status: degradedAgent ? 'DEGRADED' : 'OK',
    agents: ordered,
    latencyMs,
    degradedReason: degradedAgent ? `council_${degradedAgent.agent.toLowerCase()}_${degradedAgent.modelStatus}` : null,
  };
};

const expectedTradingRunIdsForDate = (dateKey: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error('lifecycle_date must use YYYY-MM-DD');
  const anchor = Date.parse(`${dateKey}T00:00:00.000Z`);
  const ids: string[] = [];
  for (let timestamp = anchor - 12 * 60 * 60_000; timestamp <= anchor + 36 * 60 * 60_000; timestamp += 15 * 60_000) {
    const candidate = new Date(timestamp);
    const status = getMarketScheduleStatus(candidate);
    if (status.etDateKey === dateKey && status.isTradingWindow && status.minutes % 15 === 0) {
      ids.push(`${dateKey}-${timestamp}`);
    }
  }
  return ids;
};

async function retryDueDecisionOutbox(env: Env, now: Date) {
  if (!env.SPX_RECAP_DB) return;
  const store = new D1SpxDecisionStore(env.SPX_RECAP_DB);
  const pending = await store.listRetryableOutbox(now.toISOString(), 3);
  for (const record of pending) {
    await retrySpxDelivery(record.runId, {
      clock: { now: () => new Date() },
      store,
      telegram: { send: (message) => sendSpxDecisionTelegramMessage(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID, message) },
    });
  }
}

async function completeDegradedDecisionRun(
  env: Env,
  store: D1SpxDecisionStore,
  run: DecisionRunRecord,
  reason: string,
  deliveryMode: SpxDeliveryMode,
) {
  const occurredAt = new Date().toISOString();
  const snapshot: MarketSnapshot = run.snapshot || {
    runId: run.runId,
    scheduledAt: run.scheduledAt,
    snapshotAt: occurredAt,
    sourceFreshness: {},
    dataQuality: { status: 'BLOCK', hardBlocks: [reason], warnings: [] },
    facts: {},
    boardDeepLink: null,
    replayGrade: 'UNAVAILABLE',
    replayEvidence: null,
    rawSnapshotAvailable: false,
  };
  const council: CouncilResult = run.council || {
    status: 'DEGRADED',
    degradedReason: reason,
    latencyMs: 0,
    agents: (['QM', 'CM', 'NT', 'PA'] as const).map((agent) => ({
      agent,
      decision: 'HOLD',
      confidence: 0,
      evidenceRefs: [],
      claims: [],
      modelStatus: 'SKIPPED',
      fallbackStatus: reason,
      latencyMs: 0,
      reasoning: reason,
      valid: false,
      attempts: [],
    })),
  };
  const cioDecision: CioDecision = run.cioDecision || {
    action: 'HOLD',
    confidence: 0,
    thesis: `DEGRADED: ${reason}`,
    entry: null,
    invalidation: null,
    targets: [],
    noTradeConditions: [reason],
    evidenceRefs: [],
    claims: [],
    modelStatus: 'PIPELINE_ERROR',
    decisionStatus: 'PIPELINE_FAILED',
    latencyMs: 0,
    attempts: [],
  };
  const riskGate = run.riskGate || applyRiskGate(
    cioDecision,
    { disposition: 'VETO_TO_HOLD', reason },
    'NONE',
  );

  run.snapshot = snapshot;
  run.council = council;
  run.cioDecision = cioDecision;
  run.riskGate = riskGate;
  run.finalDecision = { ...cioDecision, action: riskGate.action };
  run.finalAction = riskGate.action;
  run.degraded = true;
  run.degradedReason = reason;
  run.updatedAt = occurredAt;

  const existingStages = new Set((await store.getLifecycle(run.runId)).map((event) => event.stage));
  if (!existingStages.has('SNAPSHOT_READY')) {
    await appendDecisionLifecycle(store, run, 'SNAPSHOT_READY', {
      snapshotAt: snapshot.snapshotAt,
      sourceFreshness: snapshot.sourceFreshness,
      dataQuality: snapshot.dataQuality,
      replayGrade: snapshot.replayGrade,
      replayEvidencePersisted: Boolean(snapshot.replayEvidence),
      vendorRawPayloadsPersisted: snapshot.rawSnapshotAvailable,
    });
  }
  if (!existingStages.has('COUNCIL_COMPLETED')) {
    await appendDecisionLifecycle(store, run, 'COUNCIL_COMPLETED', {
      status: council.status,
      degradedReason: reason,
      agents: council.agents,
    });
  }
  if (!existingStages.has('CIO_DECIDED')) {
    await appendDecisionLifecycle(store, run, 'CIO_DECIDED', { decision: cioDecision });
  }
  if (!existingStages.has('RISK_GATED')) {
    await appendDecisionLifecycle(store, run, 'RISK_GATED', { riskGate, finalAction: riskGate.action });
  }
  await store.persistDecision(run);
  if (!existingStages.has('PERSISTED')) {
    await appendDecisionLifecycle(store, run, 'PERSISTED', {
      finalAction: run.finalAction,
      degraded: true,
      degradedReason: reason,
    });
  }
  await store.persistDecision(run);

  const message = formatTelegramDecisionMessage({ run, snapshot, council, cioDecision, riskGate });
  return dispatchSpxDecisionDelivery({
    runId: run.runId,
    message,
    mode: deliveryMode,
  }, {
    clock: { now: () => new Date() },
    store,
    telegram: { send: (payload) => sendSpxDecisionTelegramMessage(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID, payload) },
  });
}

// --- 主要執行邏輯 ---

async function persistRecapDayToD1(env: Env, date: string, memory: DailyMemory, audit?: {
  report: string;
  learnedRules: string[];
  generatedAt?: string | null;
}): Promise<boolean> {
  if (!env.SPX_RECAP_DB) return false;

  try {
    await upsertRecapDay(env.SPX_RECAP_DB, date, memory, audit ? {
      date,
      generatedAt: audit.generatedAt || new Date().toISOString(),
      report: audit.report,
      learnedRules: audit.learnedRules,
      actionLogSize: memory.actionLog.length
    } : null);
    console.log('[D1] SPX recap persisted', date);
    return true;
  } catch (err: any) {
    console.error('[D1] SPX recap persist failed', err?.message || err);
    return false;
  }
}

type SpxKvPutOptions = { expirationTtl?: number };
type SpxKvPutLike = { put(key: string, value: string, options?: SpxKvPutOptions): Promise<void> };

export async function putSpxKvWithRetry(
  kv: SpxKvPutLike,
  key: string,
  value: string,
  options?: SpxKvPutOptions,
  retryDelayMs = 250,
) {
  const maxAttempts = 2;
  const valueBytes = new TextEncoder().encode(value).byteLength;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await kv.put(key, value, options);
      console.log('[SPX_KV_PUT]', { key, valueBytes, expirationTtl: options?.expirationTtl ?? null, attempt });
      return { attempts: attempt, valueBytes };
    } catch (error) {
      lastError = error;
      const status = /\b[45]\d\d\b/.exec(String(error instanceof Error ? error.message : error))?.[0] || 'UNKNOWN';
      console.error('[SPX_KV_PUT_RETRY]', { key, valueBytes, expirationTtl: options?.expirationTtl ?? null, attempt, maxAttempts, status });
      if (attempt < maxAttempts && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('SPX_KV_PUT_FAILED');
}

const finalSignalReturn = (action: 'OPEN_CALL' | 'OPEN_PUT', entry: number, price: number) => (
  action === 'OPEN_CALL' ? price - entry : entry - price
);

async function refreshPendingFinalSignalOutcomes(env: Env, tradingDate: string, quotes: any[], now: Date) {
  if (!env.SPX_RECAP_DB) return;
  try {
    const pending = await readPendingFinalSignalOutcomes(env.SPX_RECAP_DB);
    for (const item of pending.filter((candidate) => candidate.tradingDate === tradingDate)) {
      const entryAt = Date.parse(item.entryAt);
      if (!Number.isFinite(entryAt)) {
        await updateFinalSignalOutcome(env.SPX_RECAP_DB, item.runId, { outcomeStatus: 'UNAVAILABLE' });
        continue;
      }
      const completeAt = entryAt + 30 * 60_000;
      if (now.getTime() < completeAt) continue;
      const window = quotes.filter((quote) => quote?.date instanceof Date && quote.date.getTime() >= entryAt && quote.date.getTime() <= completeAt);
      const atOffset = (minutes: number) => window.find((quote) => quote.date.getTime() >= entryAt + minutes * 60_000);
      const five = atOffset(5);
      const fifteen = atOffset(15);
      const thirty = atOffset(30);
      if (!five || !fifteen || !thirty) continue;
      const returns = window.map((quote) => finalSignalReturn(item.action, item.entrySpx, Number(quote.close))).filter(Number.isFinite);
      const ready = returns.length > 0;
      await updateFinalSignalOutcome(env.SPX_RECAP_DB, item.runId, ready ? {
        outcome5m: Number(finalSignalReturn(item.action, item.entrySpx, Number(five.close)).toFixed(2)),
        outcome15m: Number(finalSignalReturn(item.action, item.entrySpx, Number(fifteen.close)).toFixed(2)),
        outcome30m: Number(finalSignalReturn(item.action, item.entrySpx, Number(thirty.close)).toFixed(2)),
        mae30m: Number(Math.min(...returns).toFixed(2)),
        mfe30m: Number(Math.max(...returns).toFixed(2)),
        success15m: finalSignalReturn(item.action, item.entrySpx, Number(fifteen.close)) > 0,
        outcomeStatus: 'READY',
      } : { outcomeStatus: 'UNAVAILABLE' });
    }
  } catch (err: any) {
    console.error('[D1] Final signal outcome refresh failed', err?.message || err);
  }
}

const SPX_UAT_REPLAY_SCHEDULED_AT = new Date('2026-07-13T18:45:39.000Z');

const buildSpxUatReplaySnapshot = (runId: string): MarketSnapshot => ({
  runId,
  scheduledAt: SPX_UAT_REPLAY_SCHEDULED_AT.toISOString(),
  snapshotAt: SPX_UAT_REPLAY_SCHEDULED_AT.toISOString(),
  runMode: 'UAT_REPLAY',
  facts: {
    'run.mode': 'UAT_REPLAY',
    'spx.last': 7523.9599609375,
    'spx.vwap': 7540.03,
    'spx.ema9': 7525.19,
    'spx.dayChangePct': -0.68,
    'spx.fromOpenPct': -0.31,
    'spx.rangePositionPct': 18,
    'gex.gammaFlip': 7527.76,
    'gex.gammaStatus': 'negative_gamma',
    'quality.status': 'WARN',
    'freshness.spx': 'FIXTURE',
    'freshness.gex': 'FIXTURE',
  },
  sourceFreshness: {
    spxYahoo: { source: 'saved normalized UAT fixture', observedAt: SPX_UAT_REPLAY_SCHEDULED_AT.toISOString(), ageMs: 0, status: 'OK' },
    canonicalGex: { source: 'saved canonical Board fixture', observedAt: SPX_UAT_REPLAY_SCHEDULED_AT.toISOString(), ageMs: 0, status: 'OK' },
  },
  dataQuality: { status: 'WARN', hardBlocks: [], warnings: ['uat_replay_non_live', 'historical_raw_snapshot_missing'] },
  gexSummary: {
    spot: 7516.04,
    gammaFlipLevel: 7527.76,
    gammaStatus: 'negative_gamma',
    generatedAt: SPX_UAT_REPLAY_SCHEDULED_AT.toISOString(),
    displayTimeLabel: '14:30 ET snapshot / collected 14:45 ET',
    snapshotTimeEt: '14:30',
    collectedTimeEt: '14:45',
    source: 'Canonical D1 SPX GEX heatmap (black_scholes_exposure_engine)',
    canonical: {
      snapshotId: 'spx-gex:2026-07-13:870:fnv1a64:005c35ebfd5c5a90',
      replayGrade: 'NORMALIZED_CANONICAL',
      tradingDate: '2026-07-13',
      snapshotMinuteEt: 870,
      snapshotTimeEt: '14:30',
      collectedMinuteEt: 885,
      collectedTimeEt: '14:45',
      generatedAt: SPX_UAT_REPLAY_SCHEDULED_AT.toISOString(),
      displayTimeLabel: '14:30 ET snapshot / collected 14:45 ET',
      sourceTimestamp: '2026-07-13T18:45:36.000Z',
      provider: 'cboe',
      fallbackFrom: null,
      schemaVersion: 1,
      payloadHash: 'fnv1a64:005c35ebfd5c5a90',
      dataQuality: { total: 480, priced: 428, repaired: 4, partial: 48, unpriced: 0, excluded: 48 },
    },
  },
  normalizedContext: { fixture: 'spx-2026-07-13-1445-et', nonLive: true },
  boardDeepLink: 'https://sius-ai-workshop.pages.dev/#/work/spx-gex-heatmap?date=2026-07-13&snapshot=870',
  replayGrade: 'NORMALIZED_CANONICAL',
  replayEvidence: {
    replayGrade: 'NORMALIZED_CANONICAL',
    vendorRawPayloadsPersisted: false,
    gex: {
      snapshotId: 'spx-gex:2026-07-13:870:fnv1a64:005c35ebfd5c5a90',
      payloadHash: 'fnv1a64:005c35ebfd5c5a90',
      schemaVersion: 1,
      provider: 'cboe',
      fallbackFrom: null,
      sourceTimestamp: '2026-07-13T18:45:36.000Z',
      facts: { 'gex.gammaFlip': 7527.76, 'gex.gammaStatus': 'negative_gamma' },
      dataQuality: { total: 480, priced: 428, repaired: 4, partial: 48, unpriced: 0, excluded: 48 },
    },
    normalizedSeries: { spx15m: [], spx5m: [], spxD1: [], spxH1: [], vix15m: [], vix9d: [] },
  },
  rawSnapshotAvailable: false,
});

const buildSpxUatReplayCouncil = (): CouncilResult => ({
  status: 'OK',
  latencyMs: 0,
  agents: (['QM', 'CM', 'NT', 'PA'] as const).map((agent) => ({
    agent,
    decision: 'HOLD',
    confidence: 65,
    evidenceRefs: ['spx.last', 'spx.vwap'],
    claims: [{ text: `${agent} 固定歷史證據未形成可執行入場優勢。`, evidenceRefs: ['spx.last', 'spx.vwap'] }],
    modelStatus: 'FIXTURE_REPLAY',
    fallbackStatus: null,
    latencyMs: 0,
    reasoning: `${agent} 固定歷史分析票為觀望；本次重播沒有呼叫模型。`,
    valid: true,
    attempts: [],
  })),
});

export async function runSpxUatReplay(
  env: Env,
  runId: string,
  deliveryMode: SpxDeliveryMode,
) {
  if (deliveryMode === 'SEND' && !env.SPX_RECAP_DB) throw new Error('SPX_RECAP_DB unavailable');
  const previewStore = new InMemorySpxDecisionStore();
  const store = deliveryMode === 'SEND' ? new D1SpxDecisionStore(env.SPX_RECAP_DB!) : previewStore;
  let message = '';
  const result = await runSpxDecisionPipeline({
    runId,
    scheduledAt: SPX_UAT_REPLAY_SCHEDULED_AT,
    currentPosition: 'NONE',
    runMode: 'UAT_REPLAY',
  }, {
    clock: { now: () => new Date() },
    marketData: { load: async () => buildSpxUatReplaySnapshot(runId) },
    council: { analyze: async () => buildSpxUatReplayCouncil() },
    cio: { decide: async () => ({
      action: 'HOLD',
      confidence: 65,
      thesis: '固定歷史證據未形成可執行入場條件。',
      entry: null,
      invalidation: null,
      targets: [],
      noTradeConditions: ['UAT 重播並非即時訊號'],
      evidenceRefs: ['spx.last', 'spx.vwap'],
      claims: [{ text: '已保存 snapshot 顯示價格低於 VWAP。', evidenceRefs: ['spx.last', 'spx.vwap'] }],
      modelStatus: 'FIXTURE_REPLAY',
      latencyMs: 0,
      attempts: [],
    }) },
    riskGate: { evaluate: async () => ({ disposition: 'PASS', reason: 'No safety veto.' }) },
    store,
    telegram: { send: async (text) => {
      message = text;
      return deliveryMode === 'SEND'
        ? sendSpxDecisionTelegramMessage(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID, text)
        : { messageId: 'uat-preview' };
    } },
  });
  return { runId, message, result };
}

const buildSpxUatLlmContext = (snapshot: MarketSnapshot) => ({
  snapshotFacts: snapshot.facts,
  marketDataQuality: {
    overallStatus: snapshot.dataQuality.status,
    hardBlocks: snapshot.dataQuality.hardBlocks,
    warnings: snapshot.dataQuality.warnings,
  },
  TODAYS_MEMORY: { currentPosition: 'NONE', entryPrice: null, recentActions: [] },
});

export async function runSpxGpt5CompatibilityProbe(
  env: Env,
  options: { fetcher?: typeof fetch } = {},
) {
  const model = env.SPX_COUNCIL_MODEL || env.OPENROUTER_MODEL || DEFAULT_SPX_COUNCIL_MODEL;
  if (!env.OPENROUTER_API_KEY) throw new Error('gpt5_probe_missing_openrouter_key');
  const result = await runStructuredOpenRouterRequest({
    callKind: 'agent',
    apiKey: env.OPENROUTER_API_KEY,
    model,
    messages: [
      {
        role: 'system',
        content: 'This is a provider compatibility probe, not market analysis. Return exactly one JSON object and no markdown. It must contain exactly these fields: decision, confidence_score, evidence_refs, blocking_risk, reasoning. Use decision="HOLD", confidence_score=50, evidence_refs=["probe.status"], blocking_risk=null, and reasoning="Azure compatibility confirmed." Do not add any other fields.',
      },
      { role: 'user', content: 'snapshotFacts: {"probe.status":"ok"}' },
    ],
    fetcher: options.fetcher,
    timeoutMs: SPX_COUNCIL_TIMING_POLICY.attemptTimeoutMs,
    allowedEvidenceRefs: ['probe.status'],
    projectionBytes: 21,
    factCount: 1,
    maxProjectionBytes: AGENT_PROJECTION_MAX_BYTES,
  });
  return result;
}

export async function runSpxUatLlm(
  env: Env,
  runId: string,
  deliveryMode: SpxDeliveryMode,
  options: { fetcher?: typeof fetch } = {},
) {
  if (deliveryMode === 'SEND' && !env.SPX_RECAP_DB) throw new Error('SPX_RECAP_DB unavailable');
  const probe = await runSpxGpt5CompatibilityProbe(env, options);
  if (!probe.ok) {
    return { runId, message: '', result: null, probe };
  }
  const previewStore = new InMemorySpxDecisionStore();
  const store = deliveryMode === 'SEND' ? new D1SpxDecisionStore(env.SPX_RECAP_DB!) : previewStore;
  let message = '';
  const result = await runSpxDecisionPipeline({
    runId,
    scheduledAt: SPX_UAT_REPLAY_SCHEDULED_AT,
    currentPosition: 'NONE',
    runMode: 'UAT_LLM',
  }, {
    clock: { now: () => new Date() },
    marketData: { load: async () => ({
      ...buildSpxUatReplaySnapshot(runId),
      runMode: 'UAT_LLM' as const,
      facts: { ...buildSpxUatReplaySnapshot(runId).facts, 'run.mode': 'UAT_LLM' },
    }) },
    council: { analyze: async (snapshot) => {
      const context = buildSpxUatLlmContext(snapshot);
      const startedAt = Date.now();
      const [QM, CM, NT, PA] = await runCouncilAnalyses(context, env, { fetcher: options.fetcher });
      return buildCouncilResult({ QM, CM, NT, PA }, Date.now() - startedAt);
    } },
    cio: { decide: async (snapshot, council) => {
      const context = buildSpxUatLlmContext(snapshot);
      const result = await decideWithCio(context, council.agents, env, { fetcher: options.fetcher });
      const plan = result.plan as any;
      return {
        action: normalizeCioAction(plan?.trade_action),
        confidence: clampConfidence(plan?.confidence_score, 0),
        thesis: compactModelText(plan?.logic, 320),
        entry: compactModelText(plan?.buy_zone, 180) || null,
        invalidation: compactModelText(plan?.stop_loss, 180) || null,
        targets: Array.isArray(plan?.targets) ? plan.targets.map((item: unknown) => compactModelText(item, 180)).filter(Boolean) : [],
        noTradeConditions: Array.isArray(plan?.no_trade_conditions) ? plan.no_trade_conditions.map((item: unknown) => compactModelText(item, 180)).filter(Boolean) : [],
        evidenceRefs: normalizeEvidenceRefs(plan?.evidence_refs),
        claims: normalizeEvidenceClaims(plan?.claims).map((claim) => ({ text: claim.text, evidenceRefs: claim.evidenceRefs })),
        modelStatus: result.modelStatus,
        latencyMs: result.attempts.reduce((total, attempt) => total + attempt.latencyMs, 0),
        attempts: result.attempts,
      };
    } },
    riskGate: { evaluate: async () => ({ disposition: 'PASS', reason: 'No safety veto.' }) },
    store,
    telegram: { send: async (text) => {
      message = text;
      return deliveryMode === 'SEND'
        ? sendSpxDecisionTelegramMessage(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID, text)
        : { messageId: 'uat-llm-preview' };
    } },
  });
  return { runId, message, result, probe };
}

async function executeTradingDecisionRun(env: Env, now: Date = new Date(), options: ScheduledRunOptions = {}) {
  let runLockToken: string | null = null;
  let decisionStore: D1SpxDecisionStore | null = null;
  let decisionRun: DecisionRunRecord | null = null;
  let activeRunId: string | null = null;
  const deliveryMode = options.deliveryMode || (options.debugReportPreview ? 'PREVIEW' : 'SEND');
  try {
    const marketStatus = getMarketScheduleStatus(now);
    const runMode = options.runMode || (options.force && !marketStatus.isTradingWindow ? 'UAT_REPLAY' : 'LIVE');
    if (!options.force && !marketStatus.isTradingWindow) {
      console.log(`[SCHEDULE] Skip trading run: ${marketStatus.skipReason || 'outside_trading_window'} ${marketStatus.etDateKey} ${marketStatus.minutes}`);
      return { status: 'SKIPPED' as const, runId: null, failureCode: null };
    }

    // 0. 密鑰效驗 (PUA 診斷)
    if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID) {
      throw new Error(`環境變量缺失: TOKEN=${!!env.TELEGRAM_TOKEN}, CHAT=${!!env.TELEGRAM_CHAT_ID}`);
    }

    if (!env.SPX_RECAP_DB) throw new Error('SPX_RECAP_DB is required for traceable decision runs');
    const etNow = marketStatus.etNow;
    const etDateStr = etNow.getFullYear() + "-" + (etNow.getMonth() + 1).toString().padStart(2, '0') + "-" + etNow.getDate().toString().padStart(2, '0');
    const etTime = new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(now);
    const runId = `${etDateStr}-${now.getTime()}`;
    activeRunId = runId;
    decisionStore = new D1SpxDecisionStore(env.SPX_RECAP_DB);
    decisionRun = makeDecisionRunRecord(runId, now, runMode);

    const isNewRun = await decisionStore.beginRun(decisionRun);
    if (!isNewRun) {
      const existingOutbox = await decisionStore.getOutbox(runId);
      if (deliveryMode === 'SEND' && existingOutbox && existingOutbox.status !== 'DELIVERED') {
        await retrySpxDelivery(runId, {
          clock: { now: () => new Date() },
          store: decisionStore,
          telegram: { send: (message) => sendSpxDecisionTelegramMessage(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID, message) },
        });
      }
      if (deliveryMode === 'PREVIEW') {
        console.log(`[DELIVERY_PREVIEW] run_id=${runId} duplicate run; Telegram retry suppressed.`);
      }
      console.log(`[RUN] Duplicate run_id=${runId}; analysis skipped and outbox handled idempotently.`);
      return { status: 'SKIPPED' as const, runId, failureCode: null };
    }
    await appendDecisionLifecycle(decisionStore, decisionRun, 'SCHEDULED', { scheduledAt: now.toISOString() });

    runLockToken = await acquireTradingRunLock(env, now, options);
    if (!runLockToken) {
      decisionRun.degraded = true;
      decisionRun.degradedReason = 'lock_not_acquired';
      await decisionStore.persistDecision(decisionRun);
      return { status: 'SKIPPED' as const, runId, failureCode: 'LOCK_NOT_ACQUIRED' };
    }
    await appendDecisionLifecycle(decisionStore, decisionRun, 'LOCK_ACQUIRED');

    if (deliveryMode === 'SEND') {
      await retryDueDecisionOutbox(env, now);
    }

    if (options.force || options.debugReportPreview) {
      console.log('[DEBUG] Manual diagnostic run started; no pre-ledger heartbeat is sent.');
    }

    // Memory Fetch
    const memoryKey = `spx_memory_${etDateStr}`;

    // 並行讀取日內記憶
    const rawMemory = await env.SPX_MEMORY.get(memoryKey);
    let dailyMemory: DailyMemory = rawMemory ? JSON.parse(rawMemory) : { currentPosition: "NONE", entryPrice: null, entryTime: null, actionLog: [], icPosition: "NONE", icDeployTime: null, icAction: null };
    // Ensure IC fields exist for legacy memory
    if (!dailyMemory.icPosition) { dailyMemory.icPosition = 'NONE'; dailyMemory.icDeployTime = null; dailyMemory.icAction = null; }
    const openPositionContext = deriveOpenPositionContext(dailyMemory);

    console.log('[DEBUG] Step 1: Fetching Yahoo SPX intraday, optional market context, canonical SPX GEX...');
    const spxQuotes = await timedStep('Yahoo SPX 15m core chart', () => fetchYahooChart('^GSPC', '15m', '7d'));
    const spxQuotesM5 = await fetchOptionalMarketData('Yahoo SPX 5m trigger chart', fetchYahooChart('^GSPC', '5m', '2d'), spxQuotes);
    const [spxQuotesD1, spxQuotesH1, vixQuotes, vixQuotes9d, canonicalGexSnapshot, sentimentData] = await Promise.all([
      fetchOptionalMarketData('SPX D1 price-action chart', fetchYahooChart('^GSPC', '1d', '3mo'), []),
      fetchOptionalMarketData('SPX H1 price-action chart', fetchYahooChart('^GSPC', '1h', '10d'), []),
      fetchOptionalMarketData('VIX 15m chart', fetchYahooChart('^VIX', '15m', '7d'), []),
      fetchOptionalMarketData('VIX9D term-structure chart', fetchYahooChart('^VIX9D', '1d', '3mo'), []),
      fetchOptionalMarketData(
        'Canonical SPX GEX heatmap snapshot',
        withPromiseTimeout('Canonical SPX GEX heatmap snapshot', loadCanonicalSpxGexForTelegram(env, now, { allowGeneration: false }), OPTIONAL_MARKET_DATA_TIMEOUT_MS),
        { pcrValue: null, calculatedGex: null, heatmap: null, status: 'MISSING' as const },
      ),
      getDisabledNewsSentiment(),
    ]);
    if (canonicalGexSnapshot.status !== 'READY') {
      throw new Error(`canonical_gex_${canonicalGexSnapshot.status.toLowerCase()}`);
    }
    const pcrValue = canonicalGexSnapshot.pcrValue;
    const calculatedGex = canonicalGexSnapshot.calculatedGex;
    const canonicalHeatmap = canonicalGexSnapshot.heatmap;

    console.log('[DEBUG] Step 2: Calculating Indicators...');
    const spxInd = await calculateIndicators(spxQuotes);
    const currentVix = vixQuotes[vixQuotes.length - 1]?.close;

    if (!spxInd) {
      throw new Error('無法計算技術指標');
    }
    await refreshPendingFinalSignalOutcomes(env, etDateStr, spxQuotes, now);

    const snapshotAt = new Date();
    const completedM5 = analyzeCompletedM5Bars(spxQuotesM5, snapshotAt);
    const m5QuotesValid = completedM5.completedBars;
    const m5Analysis = {
      boxHigh: completedM5.boxHigh,
      boxLow: completedM5.boxLow,
      volumeSurge: completedM5.volumeSurge,
      currentM5Vol: completedM5.currentM5Vol,
      avgM5Vol: completedM5.avgM5Vol,
    };

    const pcrStatus = !pcrValue ? '數據缺失' : (pcrValue > 1.25 ? '⚠️ 極度恐慌避險 (反轉契機)' : pcrValue < 0.8 ? '極度貪婪 (回調風險)' : '情緒中性');

    const context = {
      asset: 'SPX',
      currentPrice: spxInd.currentClose.toFixed(2),
      volume: spxInd.volume,
      rsi14: spxInd.currentRSI.toFixed(2),
      bollingerBandwidth: spxInd.bandwidth.toFixed(2) + '%',
      isSqueeze: spxInd.isSqueeze,
      currentVix: currentVix?.toFixed(2),
      recentHigh: spxInd.recentHigh,
      recentLow: spxInd.recentLow,
      ema9: spxInd.ema9?.toFixed(2),
      ema20: spxInd.ema20?.toFixed(2),
      ema9Trend: spxInd.currentClose > (spxInd.ema9 || 0) ? 'Bullish (Above EMA9)' : 'Bearish (Below EMA9)',
      currentVWAP: spxInd.currentVWAP === null ? 'UNAVAILABLE' : spxInd.currentVWAP.toFixed(2),
      vwapDeviation: spxInd.vwapDeviation === null ? 'UNAVAILABLE' : spxInd.vwapDeviation.toFixed(2) + '%',
      pcrValue: pcrValue ? pcrValue.toFixed(2) : 'N/A',
      pcrStatus: pcrStatus
    };

    const currentVix9d = vixQuotes9d[vixQuotes9d.length - 1]?.close;
    let marketDataQuality = assessMarketDataQuality({
      spxQuotes,
      spxM5Quotes: m5QuotesValid,
      spxPriceSource: 'yahoo',
      intradayVolumeAvailable: spxInd.currentVWAP !== null,
      spxD1Quotes: spxQuotesD1,
      spxH1Quotes: spxQuotesH1,
      currentVix,
      currentVix9d,
      pcrValue,
      calculatedGex,
    });
    const fundFlow = await getFundFlow(spxQuotes);

    // GEX 整合到 AI context
    const calculatedGexContext = calculatedGex ? {
      source: `${calculatedGex.source || 'Canonical D1 SPX GEX heatmap'} (${calculatedGex.generatedAt})`,
      gammaFlipLevel: calculatedGex.gammaFlipLevel,
      gammaStatus: calculatedGex.gammaStatus,
      broadGammaStatus: calculatedGex.broadGammaStatus,
      zeroDteGammaStatus: calculatedGex.zeroDteGammaStatus,
      totalNetGex: calculatedGex.totalNetGex,
      zeroDteNetGex: calculatedGex.zeroDteNetGex,
      mostLongGammaStrike: `${calculatedGex.mostLongStrike} (${calculatedGex.mostLongGex})`,
      mostShortGammaStrike: `${calculatedGex.mostShortStrike} (${calculatedGex.mostShortGex})`,
      longGammaWalls: calculatedGex.longWalls?.map((w: any) => `${w.strike}(${w.gex})`).join(' > '),
      shortGammaPockets: calculatedGex.shortPockets?.map((p: any) => `${p.strike}(${p.gex})`).join(' > '),
      chainSnapshot: canonicalHeatmap?.session ? {
        expiry: calculatedGex.selectedExpiry || canonicalHeatmap.zeroDte.expiry,
        source: calculatedGex.source || 'canonical_heatmap',
        snapshotTimeEt: canonicalHeatmap.session.snapshotTimeEt,
        collectedTimeEt: canonicalHeatmap.session.collectedTimeEt,
        cells: canonicalHeatmap.cells.length,
      } : null,
    } : null;
    const trendDayContext = computeTrendDayContext(m5QuotesValid, spxInd, calculatedGex);
    const priceActionContext = calculatePriceActionContext(spxQuotesD1, spxQuotesH1);
    const intradayStructure = computeIntradayStructureContext(m5QuotesValid, spxInd.currentClose);
    const zeroDteRuleEngine = analyzeZeroDteRules({
      etNow,
      spxInd,
      m5Analysis,
      currentVix,
      currentVix9d,
      pcrValue,
      calculatedGex,
      trendDayContext,
      intradayStructure,
      dailyMemory,
      sentimentData,
      priceActionContext,
      marketDataQuality
    });

    const rawWisdom = await env.SPX_MEMORY.get('SPX_WISDOM_BOOK');
    const learnedRules = rawWisdom ? JSON.parse(rawWisdom) : [];
    // Legacy Council-vote calibration is intentionally no longer a decision input.
    // Only finalized SPX proxy outcomes can veto a future directional signal.
    const agentCalibrationWeights = null;

    const snapshotFacts: MarketSnapshot['facts'] = {
      'spx.last': spxInd.currentClose,
      'spx.vwap': spxInd.currentVWAP,
      'spx.ema9': spxInd.ema9 ?? null,
      'spx.ema20': spxInd.ema20 ?? null,
      'spx.rsi14': spxInd.currentRSI,
      'spx.macdHistogram': spxInd.macd?.histogram ?? null,
      'spx.bollingerBandwidthPct': spxInd.bandwidth ?? null,
      'spx.isSqueeze': spxInd.isSqueeze === true,
      'spx.dayChangePct': trendDayContext.dayChangePct,
      'spx.fromOpenPct': trendDayContext.fromOpenPct,
      'spx.rangePositionPct': trendDayContext.rangePositionPct,
      'm5.volumeSurge': m5Analysis.volumeSurge,
      'm5.currentVolume': m5Analysis.currentM5Vol,
      'm5.averageVolume': m5Analysis.avgM5Vol,
      'm5.latestCompletedAt': m5Analysis.latestCompletedAt,
      'm5.boxHigh': m5Analysis.boxHigh,
      'm5.boxLow': m5Analysis.boxLow,
      'price.nearestSupport': intradayStructure.nearestSupport?.level ?? null,
      'price.nearestResistance': intradayStructure.nearestResistance?.level ?? null,
      'price.repeatedSupport': intradayStructure.repeatedSupport?.level ?? null,
      'price.repeatedSupportTouches': intradayStructure.repeatedSupport?.touches ?? null,
      'price.repeatedResistance': intradayStructure.repeatedResistance?.level ?? null,
      'price.repeatedResistanceTouches': intradayStructure.repeatedResistance?.touches ?? null,
      'price.macroTrend': priceActionContext?.macroTrend ?? null,
      'price.recentBOS': priceActionContext?.recentBOS ?? null,
      'price.recentCHoCH': priceActionContext?.recentCHoCH ?? null,
      'price.nearestOB': priceActionContext?.nearestOB ?? null,
      'price.nearestFVG': priceActionContext?.nearestFVG ?? null,
      'price.fibGoldenPocket': priceActionContext?.fibGoldenPocket ?? null,
      'vix.last': currentVix ?? null,
      'vix9d.last': currentVix9d ?? null,
      'vix.termSpread': currentVix != null && currentVix9d != null ? currentVix9d - currentVix : null,
      'options.pcr': pcrValue ?? null,
      'gex.gammaStatus': calculatedGex?.gammaStatus || null,
      'gex.zeroDteGammaStatus': calculatedGex?.zeroDteGammaStatus || null,
      'gex.gammaFlip': calculatedGex?.gammaFlipLevel ?? null,
      'gex.totalNet': calculatedGex?.totalNetGex ?? null,
      'gex.zeroDteNet': calculatedGex?.zeroDteNetGex ?? null,
      'gex.strongestLongStrike': calculatedGex?.mostLongStrike ?? null,
      'gex.strongestShortStrike': calculatedGex?.mostShortStrike ?? null,
      'trend.regime': trendDayContext.regime,
      'zeroDte.verdict': zeroDteRuleEngine.verdict,
      'zeroDte.signalScore': zeroDteRuleEngine.signalScore,
      'zeroDte.dataQuality': zeroDteRuleEngine.dataQuality.status,
      'zeroDte.tradeEligible': !zeroDteRuleEngine.tradeEligibility.hardBlocked,
    };
    (calculatedGex?.longWalls || []).slice(0, 3).forEach((wall: any, index: number) => {
      snapshotFacts[`gex.longWall${index + 1}`] = wall?.strike ?? null;
    });
    (calculatedGex?.shortPockets || []).slice(0, 3).forEach((pocket: any, index: number) => {
      snapshotFacts[`gex.shortPocket${index + 1}`] = pocket?.strike ?? null;
    });
    const canonicalGex = canonicalHeatmap?.canonical || calculatedGex?.canonical || null;
    const boardRoot = env.SPX_BOARD_URL || 'https://sius-ai-workshop.pages.dev/#/work/spx-gex-heatmap';
    const boardDeepLink = canonicalGex
      ? `${boardRoot}?date=${encodeURIComponent(canonicalGex.tradingDate)}&snapshot=${canonicalGex.snapshotMinuteEt}`
      : boardRoot;
    const replayEvidence: MarketSnapshot['replayEvidence'] = {
      replayGrade: canonicalGex ? 'NORMALIZED_CANONICAL' : 'PARTIAL_NORMALIZED',
      vendorRawPayloadsPersisted: false,
      gex: canonicalGex ? {
        snapshotId: canonicalGex.snapshotId,
        payloadHash: canonicalGex.payloadHash,
        schemaVersion: canonicalGex.schemaVersion,
        provider: canonicalGex.provider,
        fallbackFrom: canonicalGex.fallbackFrom,
        sourceTimestamp: canonicalGex.sourceTimestamp,
        facts: Object.fromEntries(Object.entries(snapshotFacts).filter(([key]) => key.startsWith('gex.'))),
        dataQuality: canonicalGex.dataQuality,
      } : null,
      normalizedSeries: {
        spx15m: normalizeSpxReplaySeries(spxQuotes),
        spx5m: normalizeSpxReplaySeries(m5QuotesValid),
        spxD1: normalizeSpxReplaySeries(spxQuotesD1),
        spxH1: normalizeSpxReplaySeries(spxQuotesH1),
        vix15m: normalizeSpxReplaySeries(vixQuotes),
        vix9d: normalizeSpxReplaySeries(vixQuotes9d),
      },
    };
    const marketSnapshot = buildSpxMarketSnapshot({
      runId,
      scheduledAt: now,
      snapshotAt,
      spxLatestAt: spxQuotes[spxQuotes.length - 1]?.date || null,
      spxM5LatestAt: m5QuotesValid[m5QuotesValid.length - 1]?.date || null,
      vixLatestAt: vixQuotes[vixQuotes.length - 1]?.date || null,
      gexSnapshotAt: calculatedGex?.generatedAt || null,
      gexProvider: canonicalGex?.provider || null,
      gexFallbackFrom: canonicalGex?.fallbackFrom || null,
      dataQuality: marketDataQuality,
      facts: snapshotFacts,
      gexSummary: calculatedGex,
      boardDeepLink,
      replayEvidence,
    });
    marketSnapshot.runMode = runMode;
    marketDataQuality = applyRequiredSpxFreshnessGate(marketDataQuality, marketSnapshot.sourceFreshness, runMode);
    marketSnapshot.dataQuality = {
      status: marketDataQuality.overallStatus,
      hardBlocks: [...marketDataQuality.hardBlocks],
      warnings: [...marketDataQuality.warnings],
    };
    if (marketDataQuality.overallStatus === 'BLOCK') {
      zeroDteRuleEngine.hardBlocks = [...new Set([...zeroDteRuleEngine.hardBlocks, ...marketDataQuality.hardBlocks])];
      zeroDteRuleEngine.hardRuleTriggered = true;
      zeroDteRuleEngine.allowNewSignal = false;
      zeroDteRuleEngine.verdict = 'NO_TRADE';
      zeroDteRuleEngine.dataQuality.status = 'BLOCK';
      zeroDteRuleEngine.tradeEligibility = { hardBlocked: true, reasons: [...zeroDteRuleEngine.hardBlocks] };
    }
    marketSnapshot.facts['run.mode'] = runMode;
    marketSnapshot.facts['zeroDte.verdict'] = zeroDteRuleEngine.verdict;
    marketSnapshot.facts['zeroDte.dataQuality'] = zeroDteRuleEngine.dataQuality.status;
    marketSnapshot.facts['zeroDte.tradeEligible'] = !zeroDteRuleEngine.tradeEligibility.hardBlocked;
    marketSnapshot.facts['quality.status'] = marketSnapshot.dataQuality.status;
    marketSnapshot.facts['quality.warningCount'] = marketSnapshot.dataQuality.warnings.length;
    marketSnapshot.facts['freshness.spx'] = marketSnapshot.sourceFreshness.spxYahoo?.status || 'MISSING';
    marketSnapshot.facts['freshness.spxM5'] = marketSnapshot.sourceFreshness.spxM5Yahoo?.status || 'MISSING';
    marketSnapshot.facts['freshness.vix'] = marketSnapshot.sourceFreshness.vixYahoo?.status || 'MISSING';
    marketSnapshot.facts['freshness.gex'] = marketSnapshot.sourceFreshness.canonicalGex?.status || 'MISSING';
    const extendedContext = {
      currentTime: etTime,
      ...context,
      macd: spxInd.macd,
      fundFlow,
      learned_rules: learnedRules,
      m5Analysis: formatM5AnalysisForContext(m5Analysis),
      newsSentiment: {
        score: sentimentData.score,
        label: sentimentData.label,
        reason: sentimentData.reason
      },
      trendDayContext,
      intradayStructure,
      zeroDteRuleEngine,
      marketDataQuality,
      agentCalibrationWeights,
      calculatedGEX: calculatedGexContext,
      snapshotFacts: marketSnapshot.facts,
      priceActionContext,
      TODAYS_MEMORY: {
        currentPosition: dailyMemory.currentPosition,
        entryPrice: dailyMemory.entryPrice,
        openPosition: openPositionContext,
        recentActions: dailyMemory.actionLog.slice(-3),
      }
    };
    marketSnapshot.normalizedContext = extendedContext;
    decisionRun!.snapshot = marketSnapshot;
    await appendDecisionLifecycle(decisionStore!, decisionRun!, 'SNAPSHOT_READY', {
      snapshotAt: marketSnapshot.snapshotAt,
      sourceFreshness: marketSnapshot.sourceFreshness,
      dataQuality: marketSnapshot.dataQuality,
      facts: marketSnapshot.facts,
      normalizedContextPersisted: true,
      replayGrade: marketSnapshot.replayGrade,
      replayEvidencePersisted: Boolean(marketSnapshot.replayEvidence),
      vendorRawPayloadsPersisted: marketSnapshot.rawSnapshotAvailable,
    });

    console.log('[DEBUG] Step 3: Triggering 4 AI council agents (QM/CM/NT/PA). Fail-closed HOLD on any model/schema failure...');
    const councilStartedAt = Date.now();
    let [agent1, agent2, agent3, agent4] = ['QM', 'CM', 'NT', 'PA'].map((key) =>
      buildDataBackedAgentFallback(key, extendedContext, 'council_not_run')
    );
    if (marketDataQuality.overallStatus !== 'BLOCK' && shouldRunLlmCouncil(env.SPX_ENABLE_LLM_COUNCIL)) {
      [agent1, agent2, agent3, agent4] = await runCouncilAnalyses(extendedContext, env);
    } else if (marketDataQuality.overallStatus === 'BLOCK') {
      [agent1, agent2, agent3, agent4] = ['QM', 'CM', 'NT', 'PA'].map((key) =>
        buildDataBackedAgentFallback(key, extendedContext, 'market_data_block')
      );
      console.error(`[COUNCIL] Required market data unavailable: ${marketDataQuality.hardBlocks.join(',')}`);
    } else {
      [agent1, agent2, agent3, agent4] = ['QM', 'CM', 'NT', 'PA'].map((key) =>
        buildDataBackedAgentFallback(key, extendedContext, 'council_disabled')
      );
      console.log('[COUNCIL] LLM council disabled; final run is DEGRADED HOLD.');
    }

    const normalizeDecision = (d: string) => d ? d.toString().trim().toUpperCase() : "HOLD";
    const d1 = normalizeDecision(agent1.decision);
    const d2 = normalizeDecision(agent2.decision);
    const d3 = normalizeDecision(agent3.decision);
    const d4 = normalizeDecision(agent4.decision);
    const councilResult = buildCouncilResult({ QM: agent1, CM: agent2, NT: agent3, PA: agent4 }, Date.now() - councilStartedAt);
    decisionRun!.council = councilResult;
    if (councilResult.status === 'DEGRADED') {
      decisionRun!.degraded = true;
      decisionRun!.degradedReason = councilResult.degradedReason || 'council_degraded';
    }
    await appendDecisionLifecycle(decisionStore!, decisionRun!, 'COUNCIL_COMPLETED', {
      status: councilResult.status,
      degradedReason: councilResult.degradedReason || null,
      agents: councilResult.agents,
    }, councilResult.latencyMs);
    console.log('[DEBUG] Step 4: Triggering Orchestrator...');
    const cioStartedAt = Date.now();
    const fallbackOrchestratorPlan = buildDataBackedCioPlan(extendedContext, [agent1, agent2, agent3, agent4]);
    let orchestratorPlan: any = fallbackOrchestratorPlan;
    let cioModelStatus = councilResult.status === 'DEGRADED' ? 'COUNCIL_DEGRADED' : 'NOT_RUN';
    let cioAttempts: ModelAttemptMetadata[] = [];
    if (councilResult.status === 'OK' && marketDataQuality.overallStatus !== 'BLOCK' && shouldRunLlmCio(env.SPX_ENABLE_LLM_CIO)) {
      const cioResult = await decideWithCio(extendedContext, [agent1, agent2, agent3, agent4], env);
      orchestratorPlan = cioResult.plan;
      cioModelStatus = cioResult.modelStatus;
      cioAttempts = cioResult.attempts;
    } else if (marketDataQuality.overallStatus === 'BLOCK') {
      cioModelStatus = 'DATA_BLOCK';
    } else if (councilResult.status === 'DEGRADED') {
      cioModelStatus = 'COUNCIL_DEGRADED';
    } else {
      cioModelStatus = 'DISABLED';
      console.log('[CIO] LLM CIO disabled; final run is DEGRADED HOLD.');
    }

    const toStringArray = (value: unknown) => (Array.isArray(value) ? value : [])
      .map((item) => compactModelText(item, 180))
      .filter(Boolean);
    let cioDecision: CioDecision = {
      action: normalizeCioAction((orchestratorPlan as any).trade_action) as CioDecision['action'],
      confidence: clampConfidence((orchestratorPlan as any).confidence_score, 0),
      thesis: compactModelText((orchestratorPlan as any).logic || (orchestratorPlan as any).action_reasoning, 320),
      entry: compactModelText((orchestratorPlan as any).buy_zone, 180) || null,
      invalidation: compactModelText((orchestratorPlan as any).stop_loss, 180) || null,
      targets: toStringArray((orchestratorPlan as any).targets).length
        ? toStringArray((orchestratorPlan as any).targets)
        : compactModelText((orchestratorPlan as any).take_profit, 180) && (orchestratorPlan as any).take_profit !== 'N/A'
          ? [compactModelText((orchestratorPlan as any).take_profit, 180)]
          : [],
      noTradeConditions: toStringArray((orchestratorPlan as any).no_trade_conditions),
      evidenceRefs: normalizeEvidenceRefs((orchestratorPlan as any).evidence_refs),
      claims: normalizeEvidenceClaims((orchestratorPlan as any).claims)
        .map((claim) => ({ text: claim.text, evidenceRefs: claim.evidenceRefs })),
      modelStatus: cioModelStatus,
      decisionStatus: resolveSpxDecisionStatus(cioModelStatus),
      latencyMs: Date.now() - cioStartedAt,
      attempts: cioAttempts,
    };
    const cioValidationFailure = getCioValidationFailure(cioDecision, marketSnapshot);
    if (cioValidationFailure) {
      const degradedReason = decisionRun!.degradedReason || (cioModelStatus === 'TIMEOUT' ? 'cio_timeout' : cioValidationFailure);
      decisionRun!.degraded = true;
      decisionRun!.degradedReason = degradedReason;
      orchestratorPlan = fallbackOrchestratorPlan;
      cioDecision = {
        action: 'HOLD',
        confidence: 0,
        thesis: `DEGRADED: ${degradedReason}`,
        entry: null,
        invalidation: null,
        targets: [],
        noTradeConditions: [degradedReason],
      evidenceRefs: [],
      claims: [],
        modelStatus: cioModelStatus,
        decisionStatus: resolveSpxDecisionStatus(cioModelStatus),
        latencyMs: Date.now() - cioStartedAt,
        attempts: cioAttempts,
      };
    }
    const positionTransition = applyPositionTransitionGuard(cioDecision, dailyMemory.currentPosition);
    if (positionTransition.failure) {
      cioDecision = positionTransition.decision;
      decisionRun!.degraded = true;
      decisionRun!.degradedReason = positionTransition.failure;
    }
    decisionRun!.cioDecision = cioDecision;
    await appendDecisionLifecycle(decisionStore!, decisionRun!, 'CIO_DECIDED', {
      decision: cioDecision,
      positionContext: openPositionContext,
      positionDirective: positionTransition.positionDirective,
      positionTransitionValidation: positionTransition.failure,
      modelContractFailures: cioAttempts
        .filter((attempt) => attempt.status === 'SCHEMA_INVALID')
        .map((attempt) => ({
          stage: 'CIO_POST_PARSE',
          failureFamily: attempt.errorCategory,
          invalidField: attempt.invalidField || null,
          attempt: attempt.attempt,
          provider: attempt.provider || attempt.selectedProvider || null,
          responseHash: attempt.responseHash,
          requestHash: attempt.requestHash || null,
        })),
    }, cioDecision.latencyMs);

    const plannedTradeAction = cioDecision.action;
    const mustBlockNewDirectionalSignal =
      zeroDteRuleEngine.hardRuleTriggered ||
      zeroDteRuleEngine.verdict === 'FREEZE_NEW_SIGNALS' ||
      (zeroDteRuleEngine.verdict === 'NO_TRADE' && zeroDteRuleEngine.signalScore < 45) ||
      (zeroDteRuleEngine.gammaPinningDetected && trendDayContext.regime === 'RANGE_OR_MIXED') ||
      zeroDteRuleEngine.directionalBias === 'NONE';
    const endOfDayDirective = getEndOfDayRiskDirective(marketStatus, dailyMemory.currentPosition);
    const canonicalGexDirective = getCanonicalGexRiskDirective(marketSnapshot, cioDecision);
    const numericExit = evaluateNumericPositionExit(dailyMemory, spxInd.currentClose);
    let riskDirective: RiskGateDirective = { disposition: 'PASS', reason: 'No safety veto.' };
    if (endOfDayDirective) {
      riskDirective = endOfDayDirective;
    } else if (numericExit?.shouldClose) {
      riskDirective = { disposition: 'REQUIRE_CLOSE', reason: `Numeric exit: ${numericExit.reason}` };
    } else if (zeroDteRuleEngine.verdict === 'CLOSE_OR_REDUCE_SUGGESTED' && dailyMemory.currentPosition !== 'NONE') {
      riskDirective = {
        disposition: 'REQUIRE_CLOSE',
        reason: `0DTE safety close: ${zeroDteRuleEngine.hardBlocks.join(', ') || 'position_timeout'}`,
      };
    } else if (canonicalGexDirective) {
      riskDirective = canonicalGexDirective;
      decisionRun!.degraded = true;
      decisionRun!.degradedReason = canonicalGexDirective.reason;
    } else if (
      dailyMemory.currentPosition === 'NONE' &&
      ['OPEN_CALL', 'OPEN_PUT'].includes(plannedTradeAction) &&
      zeroDteRuleEngine.verdict !== 'TRADE_ALLOWED' &&
      mustBlockNewDirectionalSignal
    ) {
      riskDirective = {
        disposition: 'VETO_TO_HOLD',
        reason: `0DTE veto: ${zeroDteRuleEngine.verdict}. ${zeroDteRuleEngine.hardBlocks.join(', ') || zeroDteRuleEngine.activeRisks.join(', ') || 'score_not_enough'}`,
      };
    }

    let riskGateResult = applyRiskGate(cioDecision, riskDirective, dailyMemory.currentPosition);
    if (dailyMemory.currentPosition !== 'NONE' && riskGateResult.action === 'CLOSE' && riskDirective.disposition === 'PASS') {
      riskGateResult = {
        ...riskGateResult,
        action: 'HOLD',
        disposition: 'VETO_TO_HOLD',
        reason: 'Execution exit veto: numeric invalidation/target or Risk Gate close requirement not met.',
      };
    }
    let executionLevels: NumericExecutionLevels | null = null;
    if (dailyMemory.currentPosition === 'NONE' && (riskGateResult.action === 'OPEN_CALL' || riskGateResult.action === 'OPEN_PUT')) {
      const entryGate = passesDirectionalEntryGate({
        action: riskGateResult.action,
        currentPrice: spxInd.currentClose,
        completedM5Bars: m5QuotesValid,
        plan: {
          buy_zone: cioDecision.entry,
          stop_loss: cioDecision.invalidation,
          targets: cioDecision.targets,
        },
        actionLog: dailyMemory.actionLog,
      });
      executionLevels = entryGate.levels;
      if (!entryGate.ok) {
        riskGateResult = {
          ...riskGateResult,
          action: 'HOLD',
          disposition: 'VETO_TO_HOLD',
          reason: `Execution entry veto: ${entryGate.reason}`,
        };
      } else if (env.SPX_RECAP_DB) {
        const calibrationFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
        const calibration = await readFinalSignalPerformance(env.SPX_RECAP_DB, calibrationFrom, etDateStr);
        const bucket = calibration.find((candidate) => candidate.action === riskGateResult.action && candidate.regime === trendDayContext.regime);
        if (bucket && bucket.sampleCount >= 20 && ((bucket.hitRate ?? 0) < 55 || (bucket.averageReturn15m ?? 0) <= 0)) {
          riskGateResult = {
            ...riskGateResult,
            action: 'HOLD',
            disposition: 'VETO_TO_HOLD',
            reason: `Calibration veto: ${bucket.action}/${bucket.regime} sample=${bucket.sampleCount} hit=${bucket.hitRate ?? 'N/A'} return15m=${bucket.averageReturn15m ?? 'N/A'}`,
          };
        }
      }
    }
    orchestratorPlan = {
      ...(orchestratorPlan as any),
      trade_action: riskGateResult.action,
      risk_warning: riskDirective.disposition === 'PASS'
        ? (orchestratorPlan as any).risk_warning || 'No Risk Gate veto.'
        : riskDirective.reason,
    };
    decisionRun!.riskGate = riskGateResult;
    decisionRun!.finalAction = riskGateResult.action;
    decisionRun!.finalDecision = { ...cioDecision, action: riskGateResult.action };
    await appendDecisionLifecycle(decisionStore!, decisionRun!, 'RISK_GATED', {
      cioAction: cioDecision.action,
      finalAction: riskGateResult.action,
      disposition: riskGateResult.disposition,
      reason: riskGateResult.reason,
    });

    const finalPlannedAction = ((orchestratorPlan as any).trade_action || 'HOLD').toString().toUpperCase();
    if (finalPlannedAction === 'OPEN_PUT' && intradayStructure.repeatedSupport) {
      orchestratorPlan = {
        ...(orchestratorPlan as any),
        take_profit: `${(orchestratorPlan as any).take_profit || 'N/A'} | Adaptive guard: ${intradayStructure.repeatedSupport.level} 是 M5 重複支撐，未接受下破前先收割，禁止死等更遠目標。`,
        risk_warning: `${(orchestratorPlan as any).risk_warning || ''} 重複支撐會製造反抽，PUT 要用 trailing stop。`.trim()
      };
    } else if (finalPlannedAction === 'OPEN_CALL' && intradayStructure.repeatedResistance) {
      orchestratorPlan = {
        ...(orchestratorPlan as any),
        take_profit: `${(orchestratorPlan as any).take_profit || 'N/A'} | Adaptive guard: ${intradayStructure.repeatedResistance.level} 是 M5 重複阻力，未接受上破前先收割，禁止死等更遠目標。`,
        risk_warning: `${(orchestratorPlan as any).risk_warning || ''} 重複阻力會製造回吐，CALL 要用 trailing stop。`.trim()
      };
    }

    // Update Memory based on Action
    const tradeAction = (orchestratorPlan as any).trade_action || "HOLD";
    const currentPriceStr = spxInd.currentClose;
    const planSnapshotMeta = {
      runId,
      dataQuality: marketDataQuality,
      agentVotes: {
        QM: { decision: d1, confidence: agent1.confidence, modelStatus: agent1.modelStatus || "AI", neutralReason: agent1.neutralReason },
        CM: { decision: d2, confidence: agent2.confidence, modelStatus: agent2.modelStatus || "AI", neutralReason: agent2.neutralReason },
        NT: { decision: d3, confidence: agent3.confidence, modelStatus: agent3.modelStatus || "AI", neutralReason: agent3.neutralReason },
        PA: { decision: d4, confidence: agent4.confidence, modelStatus: agent4.modelStatus || "AI", neutralReason: agent4.neutralReason },
      },
      cioConfidence: clampConfidence((orchestratorPlan as any).confidence_score, 45),
    };

    if (tradeAction === 'OPEN_CALL' && dailyMemory.currentPosition === 'NONE') {
      dailyMemory.currentPosition = 'CALL';
      dailyMemory.entryPrice = currentPriceStr;
      dailyMemory.entryTime = etTime;
      dailyMemory.actionLog.push(appendPlanSnapshot({ time: etTime, price: currentPriceStr, action: '買入 Call', reasoning: planReason(orchestratorPlan) }, orchestratorPlan, zeroDteRuleEngine, planSnapshotMeta));
      if (executionLevels && env.SPX_RECAP_DB) await upsertFinalSignalOutcome(env.SPX_RECAP_DB, {
        runId, tradingDate: etDateStr, action: 'OPEN_CALL', regime: trendDayContext.regime, entryAt: now.toISOString(),
        entrySpx: currentPriceStr, entryZoneLow: executionLevels.entryZoneLow, entryZoneHigh: executionLevels.entryZoneHigh,
      });
    } else if (tradeAction === 'OPEN_PUT' && dailyMemory.currentPosition === 'NONE') {
      dailyMemory.currentPosition = 'PUT';
      dailyMemory.entryPrice = currentPriceStr;
      dailyMemory.entryTime = etTime;
      dailyMemory.actionLog.push(appendPlanSnapshot({ time: etTime, price: currentPriceStr, action: '買入 Put', reasoning: planReason(orchestratorPlan) }, orchestratorPlan, zeroDteRuleEngine, planSnapshotMeta));
      if (executionLevels && env.SPX_RECAP_DB) await upsertFinalSignalOutcome(env.SPX_RECAP_DB, {
        runId, tradingDate: etDateStr, action: 'OPEN_PUT', regime: trendDayContext.regime, entryAt: now.toISOString(),
        entrySpx: currentPriceStr, entryZoneLow: executionLevels.entryZoneLow, entryZoneHigh: executionLevels.entryZoneHigh,
      });
    } else if (tradeAction === 'CLOSE' && dailyMemory.currentPosition !== 'NONE') {
      const pnlRaw = dailyMemory.currentPosition === 'CALL'
        ? (currentPriceStr - dailyMemory.entryPrice!)
        : (dailyMemory.entryPrice! - currentPriceStr);
      dailyMemory.actionLog.push(appendPlanSnapshot({
        time: etTime,
        price: currentPriceStr,
        action: `平倉 ${dailyMemory.currentPosition}`,
        reasoning: planReason(orchestratorPlan),
        pnl: parseFloat(pnlRaw.toFixed(2))
      }, orchestratorPlan, zeroDteRuleEngine, planSnapshotMeta));
      dailyMemory.currentPosition = 'NONE';
      dailyMemory.entryPrice = null;
      dailyMemory.entryTime = null;
    } else if (tradeAction === 'HOLD' && dailyMemory.currentPosition === 'NONE') {
      dailyMemory.actionLog.push(appendPlanSnapshot({ time: etTime, price: currentPriceStr, action: '觀望防守', reasoning: planReason(orchestratorPlan) }, orchestratorPlan, zeroDteRuleEngine, planSnapshotMeta));
    }

    // Save Memory
    const etNowDateStr = etTime.split(' ')[0].replace(/\//g, '-');
    const dbKey = `spx_memory_${etNowDateStr}`;
    await env.SPX_MEMORY.put(dbKey, JSON.stringify(dailyMemory), { expirationTtl: SPX_KV_RETENTION_SECONDS });
    await persistRecapDayToD1(env, etNowDateStr, dailyMemory);

    await decisionStore!.persistDecision(decisionRun!);
    await appendDecisionLifecycle(decisionStore!, decisionRun!, 'PERSISTED', {
      finalAction: decisionRun!.finalAction,
      degraded: decisionRun!.degraded,
      degradedReason: decisionRun!.degradedReason,
    });
    await decisionStore!.persistDecision(decisionRun!);

    const message = formatTelegramDecisionMessage({
      run: decisionRun!,
      snapshot: marketSnapshot,
      council: councilResult,
      cioDecision,
      riskGate: riskGateResult,
      openPosition: openPositionContext,
    });

    if (options.debugReportPreview) {
      console.log(`[DEBUG_FINAL_REPORT]\n${message.trim()}`);
    }
    const delivery = await dispatchSpxDecisionDelivery({
      runId,
      message: message.trim(),
      mode: deliveryMode,
    }, {
      clock: { now: () => new Date() },
      store: decisionStore!,
      telegram: { send: (payload) => sendSpxDecisionTelegramMessage(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID, payload) },
    });
    if (delivery) {
      console.log(`[DELIVERY] run_id=${runId} status=${delivery.status} message_id=${delivery.telegramMessageId || 'none'} attempts=${delivery.attemptCount}`);
    } else {
      console.log(`[DELIVERY_PREVIEW] run_id=${runId} Telegram enqueue/send suppressed.`);
    }

    return { status: 'SUCCEEDED' as const, runId, failureCode: null };

  } catch (e: any) {
    console.error('CRITICAL BOT ERROR:', e.message);
    if (decisionStore && decisionRun) {
      const failedStage = decisionRun.currentStage;
      const reason = `pipeline_error:${failedStage}:${compactModelText(e?.message || String(e), 180)}`;
      await completeDegradedDecisionRun(env, decisionStore, decisionRun, reason, deliveryMode).catch(async (persistError) => {
        console.error('[LEDGER] Failed to complete degraded pipeline run', persistError);
        decisionRun!.degraded = true;
        decisionRun!.degradedReason = reason;
        decisionRun!.updatedAt = new Date().toISOString();
        await decisionStore!.persistDecision(decisionRun!).catch(() => undefined);
        await decisionStore!.appendLifecycle({
          runId: decisionRun!.runId,
          stage: failedStage,
          occurredAt: decisionRun!.updatedAt,
          attempt: 99,
          latencyMs: null,
          payload: { failed: true, failedStage, error: reason, recoveryFailed: true },
        }).catch(() => undefined);
      });
    }
    return { status: 'FAILED' as const, runId: activeRunId, failureCode: classifySpxOperationalFailure(e, 'TRADING_PIPELINE_FAILED') };
  } finally {
    await releaseTradingRunLock(env, runLockToken);
  }
}

/** The only live adapter for cron and authenticated manual SPX decision runs. */
export async function runLiveSpxDecisionRun(env: Env, now: Date = new Date(), options: ScheduledRunOptions = {}) {
  const marketStatus = getMarketScheduleStatus(now);
  return runSpxDecisionRun({
    isTradingWindow: options.force || marketStatus.isTradingWindow,
    skipReason: marketStatus.skipReason || null,
    execute: () => executeTradingDecisionRun(env, now, options),
  });
}

type EndOfDayAuditResult =
  | { status: 'COMPLETED'; date: string; kvMirrorFailures: string[] }
  | { status: 'SKIPPED'; date: string }
  | { status: 'NO_MEMORY'; date: string }
  | { status: 'FAILED'; date: string; failureCode: string };

export async function runEndOfDayAudit(env: Env, now: Date = new Date(), options: ScheduledRunOptions = {}): Promise<EndOfDayAuditResult> {
  const marketStatus = getMarketScheduleStatus(now);
  if (!options.force && !marketStatus.isMarketOpenDay) {
    console.log(`[SCHEDULE] Skip audit run: ${marketStatus.skipReason || 'market_closed'} ${marketStatus.etDateKey}`);
    return { status: 'SKIPPED', date: marketStatus.etDateKey };
  }

  const etNow = marketStatus.etNow;
  const etDateStr = etNow.getFullYear() + "-" + (etNow.getMonth() + 1).toString().padStart(2, '0') + "-" + etNow.getDate().toString().padStart(2, '0');
  const memoryKey = `spx_memory_${etDateStr}`;
  const rawMemory = await env.SPX_MEMORY.get(memoryKey);

  if (!rawMemory) {
    console.log("[AUDIT] No memory found for today.");
    await sendTelegramMessage(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID, `⚠️ <b>[盤後審計]</b> 查無今日 (${etDateStr}) 的交易記憶，無需生成審計報告。`);
    return { status: 'NO_MEMORY', date: etDateStr };
  }
  const memory: DailyMemory = JSON.parse(rawMemory);

  try {
    const response = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free',
        messages: [
          { role: 'system', content: AUDIT_AGENT_PROMPT },
          { role: 'user', content: `Today's Action Log: ${JSON.stringify(memory.actionLog)}` }
        ]
      })
    }, 30000);

    if (!response.ok) throw new Error("Audit generation failed");
    const data = await response.json() as any;
    let report = data.choices[0].message.content;

    // Parse out learned rules for self-evolution
    const jsonMatch = report.match(/```json\s*([\s\S]*?)\s*```/i);
    let extractedRules: string[] = [];
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.learned_rules && Array.isArray(parsed.learned_rules)) {
          extractedRules = parsed.learned_rules;
        }
      } catch (err) {
        console.error('Failed to parse learned_rules JSON:', err);
      }
      // Remove JSON block from report to keep Telegram clean
      report = report.replace(/```json\s*[\s\S]*?\s*```/i, '').trim();
    }

    const generatedAt = new Date().toISOString();
    const auditPayload = JSON.stringify({
      date: etDateStr,
      generatedAt,
      report,
      learnedRules: extractedRules,
      actionLogSize: memory.actionLog.length
    });
    const recapPersisted = await persistRecapDayToD1(env, etDateStr, memory, {
      report,
      learnedRules: extractedRules,
      generatedAt
    });
    if (!recapPersisted) throw new Error('D1_RECAP_PERSIST_FAILED');
    if (env.SPX_RECAP_DB) {
      const retention = await runSpxRetention(env.SPX_RECAP_DB, now);
      console.log('[D1] SPX retention completed', retention);
    }

    const kvMirrorFailures: string[] = [];
    if (extractedRules.length > 0) {
      try {
        const existingBook = await env.SPX_MEMORY.get('SPX_WISDOM_BOOK');
        const wisdomBook: string[] = [...extractedRules, ...(existingBook ? JSON.parse(existingBook) : [])].slice(0, 10);
        await putSpxKvWithRetry(env.SPX_MEMORY, 'SPX_WISDOM_BOOK', JSON.stringify(wisdomBook));
      } catch (error) {
        kvMirrorFailures.push('wisdom');
        console.error('[AUDIT] KV wisdom mirror failed after retry', error instanceof Error ? error.message : String(error));
      }
    }
    try {
      await putSpxKvWithRetry(env.SPX_MEMORY, `spx_audit_${etDateStr}`, auditPayload, { expirationTtl: SPX_KV_RETENTION_SECONDS });
    } catch (error) {
      kvMirrorFailures.push('audit');
      console.error('[AUDIT] KV audit mirror failed after retry', error instanceof Error ? error.message : String(error));
    }

    const storageNotice = kvMirrorFailures.length ? '\n\n⚠️ 儲存｜D1 已保存；KV 鏡像重試後仍失敗。' : '';
    const finalMsg = `📅 <b>【每日審計清單】 (${etDateStr})</b>\n\n<pre>${tgEscape(report)}</pre>${storageNotice}`;

    await sendTelegramMessage(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID, finalMsg);
    return { status: 'COMPLETED', date: etDateStr, kvMirrorFailures };
  } catch (e: any) {
    console.error('[AUDIT] Failed to generate audit', e);
    await sendTelegramMessage(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID, `❌ <b>[審計失敗]</b> ${tgEscape(e.message || String(e))}`);
    return { status: 'FAILED', date: etDateStr, failureCode: classifySpxOperationalFailure(e, 'AUDIT_FAILED') };
  }
}

async function runSpxGexHeatmapGeneration(env: Env, now: Date = new Date(), options: ScheduledRunOptions = {}) {
  if (!env.SPX_RECAP_DB) {
    console.log('[SPX_GEX_HEATMAP] Skip: SPX_RECAP_DB binding is missing.');
    return { status: 'FAILED' as const, failureCode: 'D1_OPERATION_FAILED', retryableOpeningFailure: false };
  }

  const generationStatus = getSpxGexGenerationStatus(now);
  const collectionStore = new D1SpxGexCollectionStore(env.SPX_RECAP_DB);
  const slotId = `${generationStatus.etDateKey}:${generationStatus.snapshotMinuteEt}`;
  const isOpeningSlot = generationStatus.snapshotMinuteEt === SPX_GEX_OPENING_SNAPSHOT_MINUTE_ET
    && generationStatus.collectedMinuteEt === SPX_GEX_OPENING_COLLECTION_MINUTE_ET;
  const attempt = options.openingRetryAttempt || (isOpeningSlot ? 1 : 0);
  const occurredAt = () => (options.fetchNow || new Date()).toISOString();
  const dataClient = options.openingRetryAttempt
    ? createCboeOnlySpxGexDataClient({
      db: env.SPX_RECAP_DB,
      now: options.fetchNow || new Date(),
      cachePolicy: 'force_refresh',
      allowStaleCache: false,
    })
    : createSpxGexIntradayDataClient({ db: env.SPX_RECAP_DB, now });

  try {
    await collectionStore.scheduleDate(generationStatus.etDateKey, occurredAt());
    const result = await generateAndStoreSpxGexHeatmap({
      db: env.SPX_RECAP_DB,
      dataClient,
      now,
      force: options.force,
      onStage: (stage, payload) => collectionStore.appendStage(slotId, stage, payload, occurredAt(), attempt),
    });
    if (result.status === 'skipped_existing') {
      const existing = await readSpxGexHeatmap(env.SPX_RECAP_DB, result.date, result.snapshotMinuteEt);
      const current = await collectionStore.getSlot(slotId);
      if (current?.currentStage === 'SCHEDULED' || current?.currentStage === 'FAILED') {
        await collectionStore.appendStage(slotId, 'FETCHED', { reusedExistingSnapshot: true }, occurredAt(), attempt);
      }
      if (current?.currentStage === 'SCHEDULED' || current?.currentStage === 'FETCHED' || current?.currentStage === 'FAILED') {
        await collectionStore.appendStage(slotId, 'NORMALIZED', { reusedExistingSnapshot: true }, occurredAt(), attempt);
      }
      if (current?.currentStage !== 'PERSISTED') {
        await collectionStore.appendStage(slotId, 'PERSISTED', {
          reusedExistingSnapshot: true,
          snapshotId: existing?.canonical?.snapshotId || null,
          payloadHash: existing?.canonical?.payloadHash || null,
          provider: existing?.canonical?.provider || null,
          fallbackFrom: existing?.canonical?.fallbackFrom || null,
        }, occurredAt(), attempt);
      }
    }
    console.log(`[SPX_GEX_HEATMAP] ${result.status} ${result.date}${'reason' in result ? ` ${result.reason}` : ''}`);
    return { status: 'SUCCEEDED' as const, failureCode: null, retryableOpeningFailure: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failureCode = error instanceof SpxGexSnapshotValidationError
      ? error.reasonCode
      : classifySpxOperationalFailure(error, 'GEX_COLLECTION_FAILED');
    const retryableOpeningFailure = isOpeningSlot && failureCode === 'NO_AUDITED_BLENDED_IV_CELLS';
    await collectionStore.appendStage(slotId, 'FAILED', {
      error: failureCode,
      retryStatus: retryableOpeningFailure && attempt < 3 ? 'OPENING_RETRY_PENDING' : 'TERMINAL',
      collectionQuality: dataClient.getCollectionQualitySummary?.() || null,
    }, occurredAt(), attempt)
      .catch((persistError) => console.error('[SPX_GEX_HEATMAP] failed to persist terminal collection state', persistError instanceof Error ? persistError.message : String(persistError)));
    console.error('[SPX_GEX_HEATMAP] Generation failed', message);
    return { status: 'FAILED' as const, failureCode, retryableOpeningFailure };
  }
}

const operationalTickId = (now: Date) => `tick-${now.toISOString()}`;

async function sendOperationalHealthAlert(
  env: Env,
  health: D1SpxOperationalHealthStore,
  tickId: string,
  job: SpxOperationalJob,
  message: string,
) {
  const now = new Date();
  const recentlyAlerted = await health.hasRecentAlert(job, new Date(now.getTime() - SPX_HEALTH_ALERT_DEDUP_MS).toISOString());
  if (recentlyAlerted || !env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  try {
    await sendTelegramMessage(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID, `⚠️ <b>SPX 系統健康告警</b>\n${tgEscape(message)}`);
    await health.markAlertSent(tickId, job, now.toISOString());
    return true;
  } catch (error) {
    console.error('[SPX_HEALTH] Telegram health alert failed', error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function recoverStaleTradingRuns(env: Env, now: Date, health: D1SpxOperationalHealthStore, tickId: string) {
  if (!env.SPX_RECAP_DB) return 0;
  const store = new D1SpxDecisionStore(env.SPX_RECAP_DB);
  const stale = await store.listStaleIncomplete(new Date(now.getTime() - SPX_STALE_RUN_MS).toISOString());
  if (stale.length === 0) return 0;

  await health.begin({ tickId, job: 'STALE_RECOVERY', runId: null, stage: 'DISCOVERED' }, now.toISOString());
  let recovered = 0;
  for (const record of stale) {
    try {
      await completeDegradedDecisionRun(env, store, record.run, 'stale_run_recovered_without_replay', 'PREVIEW');
      recovered += 1;
    } catch (error) {
      console.error('[SPX_HEALTH] stale-run recovery failed', record.run.runId, error instanceof Error ? error.message : String(error));
    }
  }
  await health.finish({
    tickId,
    job: 'STALE_RECOVERY',
    runId: null,
    status: recovered === stale.length ? 'RECOVERED' : 'FAILED',
    stage: recovered === stale.length ? 'TERMINAL' : 'PARTIAL',
    failureCode: recovered === stale.length ? null : 'STALE_RECOVERY_PARTIAL',
  }, new Date().toISOString());
  if (recovered > 0) {
    await sendOperationalHealthAlert(env, health, tickId, 'STALE_RECOVERY', `已封存 ${recovered} 個卡死 run；沒有重跑過期交易決策。`);
  }
  return recovered;
}

const scheduledAtMsFromRunId = (runId: string) => Number(runId.slice(runId.lastIndexOf('-') + 1));

export async function reconcileMissedSpxScheduledWork(env: Env, now: Date, health: D1SpxOperationalHealthStore, tickId: string) {
  if (!env.SPX_RECAP_DB) return { gexSlotIds: [] as string[], runIds: [] as string[] };
  const generation = getSpxGexGenerationStatus(now);
  const collectionStore = new D1SpxGexCollectionStore(env.SPX_RECAP_DB);
  const decisionStore = new D1SpxDecisionStore(env.SPX_RECAP_DB);
  await collectionStore.scheduleDate(generation.etDateKey, now.toISOString());
  const gexSlotIds = await collectionStore.markOverdueScheduledSlotsFailed(
    generation.etDateKey,
    generation.collectedMinuteEt,
    now.toISOString(),
  );
  const dueRunIds = dueMissingRunIds(expectedTradingRunIdsForDate(generation.etDateKey), now.getTime());
  const coverage = await queryLifecycleCoverage(env.SPX_RECAP_DB, dueRunIds);
  const runIds: string[] = [];
  for (const runId of coverage.missingRunIds) {
    const scheduledAtMs = scheduledAtMsFromRunId(runId);
    if (!Number.isFinite(scheduledAtMs)) continue;
    const run = makeDecisionRunRecord(runId, new Date(scheduledAtMs), 'LIVE');
    if (!await decisionStore.beginRun(run)) continue;
    await appendDecisionLifecycle(decisionStore, run, 'SCHEDULED', { scheduledAt: run.scheduledAt, source: 'scheduler_watchdog' });
    await completeDegradedDecisionRun(env, decisionStore, run, 'cron_invocation_missed', 'PREVIEW');
    runIds.push(runId);
  }
  if (gexSlotIds.length + runIds.length > 0) {
    await health.begin({ tickId, job: 'STALE_RECOVERY', runId: null, stage: 'MISSED_SLOT_RECONCILIATION' }, now.toISOString());
    await health.finish({ tickId, job: 'STALE_RECOVERY', runId: null, status: 'RECOVERED', stage: 'MISSED_SLOTS_MARKED', failureCode: 'CRON_INVOCATION_MISSED' }, new Date().toISOString());
    await sendOperationalHealthAlert(env, health, tickId, 'STALE_RECOVERY', `偵測到漏掉排程：${gexSlotIds.length} 個 GEX slot、${runIds.length} 個交易 run 已標記為 cron_invocation_missed；沒有補造歷史數據或重播交易。`);
  }
  return { gexSlotIds, runIds };
}

export async function runSupervisedSpxMarketTick(env: Env, now: Date = new Date()) {
  if (!env.SPX_RECAP_DB) {
    console.error('[SPX_TICK] SPX_RECAP_DB binding is missing.');
    return { status: 'FAILED' as const, failureCode: 'D1_OPERATION_FAILED' };
  }
  const tickId = operationalTickId(now);
  const health = new D1SpxOperationalHealthStore(env.SPX_RECAP_DB);
  try {
    await health.begin({ tickId, job: 'MARKET_TICK', runId: null, stage: 'STARTED' }, now.toISOString());
    await reconcileMissedSpxScheduledWork(env, now, health, tickId);
    await recoverStaleTradingRuns(env, now, health, tickId);

    await health.begin({ tickId, job: 'GEX_COLLECTION', runId: null, stage: 'STARTED' }, new Date().toISOString());
    const gex = await runSpxGexHeatmapGeneration(env, now);
    await health.finish({
      tickId,
      job: 'GEX_COLLECTION',
      runId: null,
      status: gex.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
      stage: gex.status === 'FAILED' && gex.retryableOpeningFailure ? 'OPENING_RETRY_PENDING' : 'TERMINAL',
      failureCode: gex.failureCode,
    }, new Date().toISOString());
    if (gex.status === 'FAILED') {
      if (gex.retryableOpeningFailure) {
        await health.finish({
          tickId,
          job: 'MARKET_TICK',
          runId: null,
          status: 'FAILED',
          stage: 'OPENING_RETRY_PENDING',
          failureCode: gex.failureCode,
        }, new Date().toISOString());
        return { status: 'OPENING_RETRY_PENDING' as const, failureCode: gex.failureCode };
      }
      await sendOperationalHealthAlert(env, health, tickId, 'GEX_COLLECTION', 'GEX 更新失敗；系統只會使用已持久化且新鮮的 snapshot，否則本輪會 fail-closed。');
      await health.finish({ tickId, job: 'MARKET_TICK', runId: null, status: 'FAILED', stage: 'GEX_FAILED', failureCode: gex.failureCode }, new Date().toISOString());
      return { status: 'FAILED' as const, failureCode: gex.failureCode };
    }

    const marketStatus = getMarketScheduleStatus(now);
    if (!marketStatus.isTradingWindow) {
      const skipped = await runSpxDecisionRun({
        isTradingWindow: false,
        skipReason: marketStatus.skipReason || null,
      });
      if (skipped.status !== 'SKIPPED') throw new Error('outside-window decision run executed unexpectedly');
      await health.finish({ tickId, job: 'MARKET_TICK', runId: null, status: 'SUCCEEDED', stage: 'GEX_ONLY' }, new Date().toISOString());
      return { status: 'SUCCEEDED' as const, failureCode: null };
    }

    await health.begin({ tickId, job: 'TRADING', runId: null, stage: 'STARTED' }, new Date().toISOString());
    const trading = await runLiveSpxDecisionRun(env, now);
    await health.finish({
      tickId,
      job: 'TRADING',
      runId: trading.runId,
      status: trading.status === 'FAILED' ? 'FAILED' : 'SUCCEEDED',
      stage: trading.status,
      failureCode: trading.failureCode,
    }, new Date().toISOString());
    await health.finish({
      tickId,
      job: 'MARKET_TICK',
      runId: trading.runId,
      status: trading.status === 'FAILED' ? 'FAILED' : 'SUCCEEDED',
      stage: 'TERMINAL',
      failureCode: trading.failureCode,
    }, new Date().toISOString());
    return { status: trading.status === 'FAILED' ? 'FAILED' as const : 'SUCCEEDED' as const, failureCode: trading.failureCode };
  } catch (error) {
    const failureCode = classifySpxOperationalFailure(error, 'MARKET_TICK_FAILED');
    console.error('[SPX_TICK] supervised tick failed', failureCode, error instanceof Error ? error.message : String(error));
    await health.finish({ tickId, job: 'MARKET_TICK', runId: null, status: 'FAILED', stage: 'UNHANDLED', failureCode }, new Date().toISOString()).catch(() => undefined);
    await sendOperationalHealthAlert(env, health, tickId, 'MARKET_TICK', '排程執行中斷；本輪沒有重跑交易決策，下一輪會重新取得即時資料。').catch(() => undefined);
    return { status: 'FAILED' as const, failureCode };
  }
}

// --- Worker Entry Point ---

const SPX_SCHEDULER_SINGLETON = 'primary';

const getSpxSchedulerStub = (env: Env) => env.SPX_SCHEDULER.get(env.SPX_SCHEDULER.idFromName(SPX_SCHEDULER_SINGLETON));

const findNextSpxMarketSchedulerAlarmAt = (scheduledAtMs: number, nowMs: number) => {
  let candidateMs = nextSchedulerAlarmAt(scheduledAtMs, nowMs);
  const maxCandidateMs = nowMs + 8 * 24 * 60 * 60_000;
  while (candidateMs <= maxCandidateMs) {
    const candidate = new Date(candidateMs);
    if (getSpxGexGenerationStatus(candidate).isGenerationWindow || getMarketScheduleStatus(candidate).isTradingWindow) return candidateMs;
    candidateMs += 900_000;
  }
  throw new Error('SPX scheduler could not find a market tick within eight days');
};

export class SpxMarketScheduler {
  constructor(private readonly state: SpxSchedulerStateHandle, private readonly env: Env) {}

  private async readState() {
    const stored = await this.state.storage.get<SpxSchedulerState>(SPX_SCHEDULER_STORAGE_KEY);
    return stored ? { ...EMPTY_SPX_SCHEDULER_STATE, ...stored } : { ...EMPTY_SPX_SCHEDULER_STATE };
  }

  private async writeState(value: SpxSchedulerState) {
    await this.state.storage.put(SPX_SCHEDULER_STORAGE_KEY, value);
  }

  private async scheduleNext(state: SpxSchedulerState, scheduledAtMs: number, nowMs: number) {
    const nextAlarmAt = findNextSpxMarketSchedulerAlarmAt(scheduledAtMs, nowMs);
    const next = { ...state, nextAlarmAt };
    await this.writeState(next);
    await this.state.storage.setAlarm(nextAlarmAt);
    return next;
  }

  private async armOpeningRetry(state: SpxSchedulerState, retry: NonNullable<SpxSchedulerState['openingRetry']>) {
    const next = { ...state, openingRetry: retry, nextAlarmAt: retry.nextAttemptAtMs };
    await this.writeState(next);
    await this.state.storage.setAlarm(retry.nextAttemptAtMs);
    return next;
  }

  private async executeOpeningRetry(scheduler: SpxSchedulerState) {
    const retry = scheduler.openingRetry;
    if (!retry) return { status: 'NO_OPENING_RETRY' as const, scheduler };
    const now = new Date();
    const nowMs = now.getTime();
    if (scheduler.nextAlarmAt !== retry.nextAttemptAtMs) {
      return { status: 'STALE_OPENING_RETRY' as const, scheduler };
    }
    const result = await runSpxGexHeatmapGeneration(
      this.env,
      new Date(retry.canonicalScheduledAtMs),
      { force: true, openingRetryAttempt: retry.attempt, fetchNow: now },
    );
    if (result.status === 'SUCCEEDED') {
      const next = await this.scheduleNext({
        ...scheduler,
        openingRetry: null,
        lastSucceededAt: retry.canonicalScheduledAtMs,
        lastFailureCode: null,
        lastFailureAt: null,
      }, retry.canonicalScheduledAtMs, nowMs);
      return { status: 'OPENING_RETRY_SUCCEEDED' as const, scheduler: next };
    }
    if (result.retryableOpeningFailure) {
      const advanced = advanceSpxGexOpeningRetryState(retry);
      if (advanced) {
        const next = await this.armOpeningRetry({
          ...scheduler,
          lastFailureCode: result.failureCode,
          lastFailureAt: nowMs,
        }, advanced);
        return { status: 'OPENING_RETRY_PENDING' as const, scheduler: next };
      }
      const health = this.env.SPX_RECAP_DB ? new D1SpxOperationalHealthStore(this.env.SPX_RECAP_DB) : null;
      if (health) {
        await sendOperationalHealthAlert(
          this.env,
          health,
          operationalTickId(new Date(retry.canonicalScheduledAtMs)),
          'GEX_COLLECTION',
          '09:30 opening bucket 三次 CBOE 收集均未通過 IV 壓力資料合約；slot 維持 MISSING，沒有重播交易決策。',
        );
      }
      const next = await this.scheduleNext({
        ...scheduler,
        openingRetry: null,
        lastFailureCode: result.failureCode,
        lastFailureAt: nowMs,
      }, retry.canonicalScheduledAtMs, nowMs);
      return { status: 'OPENING_RETRY_EXHAUSTED' as const, scheduler: next };
    }
    scheduler = await this.scheduleNext({
      ...scheduler,
      openingRetry: null,
      lastFailureCode: result.failureCode || 'GEX_COLLECTION_FAILED',
      lastFailureAt: nowMs,
    }, retry.canonicalScheduledAtMs, nowMs);
    throw new Error(`SPX opening retry failed: ${scheduler.lastFailureCode}`);
  }

  private async execute(requestedAtMs: number) {
    const now = new Date();
    const nowMs = now.getTime();
    let scheduler = await this.readState();
    if (scheduler.openingRetry && requestedAtMs === scheduler.openingRetry.nextAttemptAtMs) {
      return this.executeOpeningRetry(scheduler);
    }
    if (requestedAtMs % 900_000 !== 0) {
      return { status: 'STALE_NON_QUARTER_ALARM' as const, scheduler };
    }
    const scheduledAtMs = canonicalQuarterHourUtc(requestedAtMs);
    if ((scheduler.lastSucceededAt || 0) >= scheduledAtMs) return { status: 'DUPLICATE' as const, scheduler };

    const health = this.env.SPX_RECAP_DB ? new D1SpxOperationalHealthStore(this.env.SPX_RECAP_DB) : null;
    const tickId = operationalTickId(new Date(scheduledAtMs));
    const scheduledAt = new Date(scheduledAtMs);
    if (!getSpxGexGenerationStatus(scheduledAt).isGenerationWindow && !getMarketScheduleStatus(scheduledAt).isTradingWindow) {
      scheduler = await this.scheduleNext(scheduler, scheduledAtMs, nowMs);
      return { status: 'OUTSIDE_MARKET_WINDOW' as const, scheduler };
    }
    if (!shouldRunScheduledTick(scheduledAtMs, nowMs)) {
      if (health) await reconcileMissedSpxScheduledWork(this.env, now, health, tickId);
      scheduler = await this.scheduleNext({ ...scheduler, lastFailureCode: 'SCHEDULER_ALARM_LATE', lastFailureAt: nowMs }, scheduledAtMs, nowMs);
      return { status: 'LATE_SKIPPED' as const, scheduler };
    }

    scheduler = { ...scheduler, lastStartedAt: scheduledAtMs, lastFailureCode: null, lastFailureAt: null };
    await this.writeState(scheduler);
    const result = await runSupervisedSpxMarketTick(this.env, new Date(scheduledAtMs));
    if (result.status === 'OPENING_RETRY_PENDING') {
      const generation = getSpxGexGenerationStatus(new Date(scheduledAtMs));
      const retry = createSpxGexOpeningRetryState(
        `${generation.etDateKey}:${generation.snapshotMinuteEt}`,
        scheduledAtMs,
      );
      scheduler = await this.armOpeningRetry({
        ...scheduler,
        lastFailureCode: result.failureCode,
        lastFailureAt: nowMs,
      }, retry);
      return { status: 'OPENING_RETRY_PENDING' as const, scheduler };
    }
    if (result.status === 'FAILED') {
      scheduler = { ...scheduler, lastFailureCode: result.failureCode || 'MARKET_TICK_FAILED', lastFailureAt: nowMs };
      await this.writeState(scheduler);
      throw new Error(`SPX scheduler tick failed: ${scheduler.lastFailureCode}`);
    }
    scheduler = await this.scheduleNext({ ...scheduler, lastSucceededAt: scheduledAtMs }, scheduledAtMs, nowMs);
    return { status: 'SUCCEEDED' as const, scheduler };
  }

  async alarm() {
    const scheduler = await this.readState();
    await this.execute(scheduler.nextAlarmAt || Date.now());
  }

  private async ensure() {
    const now = new Date();
    const scheduler = await this.readState();
    if (scheduler.openingRetry && scheduler.nextAlarmAt === scheduler.openingRetry.nextAttemptAtMs) {
      await this.state.storage.setAlarm(scheduler.nextAlarmAt);
      return { status: 'ARMED' as const, scheduler };
    }
    const isQuarterHour = scheduler.nextAlarmAt != null && scheduler.nextAlarmAt % 900_000 === 0;
    if (scheduler.nextAlarmAt && scheduler.nextAlarmAt > now.getTime() && isQuarterHour) return { status: 'ARMED' as const, scheduler };
    const next = await this.scheduleNext(scheduler, now.getTime() - 900_000, now.getTime());
    return { status: 'ARMED' as const, scheduler: next };
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === '/status') return Response.json(await this.readState());
    if (url.pathname === '/ensure') return Response.json(await this.ensure());
    if (url.pathname !== '/wake') return new Response('Not found', { status: 404 });
    const scheduledAtMs = Number(url.searchParams.get('scheduledAt'));
    if (!Number.isFinite(scheduledAtMs)) return new Response('scheduledAt is required', { status: 400 });
    return Response.json(await this.execute(scheduledAtMs));
  }
}

export default {
  async scheduled(event: any, env: Env, ctx: any) {
    const scheduledAt = new Date(typeof event.scheduledTime === 'number' ? event.scheduledTime : Date.now());
    const marketStatus = getMarketScheduleStatus(scheduledAt);
    const cron = String(event.cron || '');
    if (!marketStatus.isMarketOpenDay) {
      console.log(`[SCHEDULE] No-op: ${marketStatus.skipReason || 'market_closed'} ${marketStatus.etDateKey}`);
      return;
    }

    if (cron === AUDIT_CRON && marketStatus.isAuditWindow) {
      ctx.waitUntil(runEndOfDayAudit(env, scheduledAt));
      return;
    }

    if (cron === SPX_GEX_HEATMAP_CRON) {
      ctx.waitUntil(getSpxSchedulerStub(env).fetch(`https://spx-scheduler/wake?scheduledAt=${scheduledAt.getTime()}`).then(async (response) => {
        if (!response.ok) throw new Error(`SPX scheduler wake failed: ${response.status}`);
      }));
      return;
    }

    console.log(`[SCHEDULE] No-op: outside configured ET windows cron=${cron} date=${marketStatus.etDateKey} minutes=${marketStatus.minutes}`);
  },
  async fetch(request: Request, env: Env, ctx: any) {
    const url = new URL(request.url);

    // 🔒 安全防護：驗證請求，防止互聯網掃描器/爬蟲隨機觸發 AI API (浪費您的錢)
    const reqToken = url.searchParams.get('token');

    // 如果沒有在 Cloudflare 設置 WEBHOOK_SECRET，則預設使用 TELEGRAM_CHAT_ID 作為簡單驗證密碼
    const expectedToken = env.WEBHOOK_SECRET || env.TELEGRAM_CHAT_ID;

    if (reqToken !== expectedToken) {
      return new Response('Unauthorized: Please provide a valid ?token parameter to protect your AI credits!', { status: 401 });
    }

    const forceManualRun = url.searchParams.has('force');

    if (url.searchParams.has('run_id')) {
      if (!env.SPX_RECAP_DB) return new Response('SPX_RECAP_DB unavailable', { status: 503 });
      const runId = url.searchParams.get('run_id') || '';
      const store = new D1SpxDecisionStore(env.SPX_RECAP_DB);
      const [run, lifecycle, outbox] = await Promise.all([
        store.getRun(runId),
        store.getLifecycle(runId),
        store.getOutbox(runId),
      ]);
      return Response.json({ run, lifecycle, outbox }, { status: run ? 200 : 404 });
    }

    if (url.searchParams.has('retry_run_id')) {
      if (!env.SPX_RECAP_DB) return new Response('SPX_RECAP_DB unavailable', { status: 503 });
      const runId = url.searchParams.get('retry_run_id') || '';
      const store = new D1SpxDecisionStore(env.SPX_RECAP_DB);
      const delivery = await retrySpxDelivery(runId, {
        clock: { now: () => new Date() },
        store,
        telegram: { send: (message) => sendSpxDecisionTelegramMessage(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID, message) },
      });
      return Response.json({ runId, delivery });
    }

    if (url.searchParams.has('lifecycle_date')) {
      if (!env.SPX_RECAP_DB) return new Response('SPX_RECAP_DB unavailable', { status: 503 });
      const dateKey = url.searchParams.get('lifecycle_date') || '';
      const expectedRunIds = expectedTradingRunIdsForDate(dateKey);
      const coverage = await queryLifecycleCoverage(env.SPX_RECAP_DB, expectedRunIds);
      return Response.json({ date: dateKey, expectedRunCount: expectedRunIds.length, ...coverage });
    }

    if (url.searchParams.has('health')) {
      if (!env.SPX_RECAP_DB) return new Response('SPX_RECAP_DB unavailable', { status: 503 });
      const now = new Date();
      const marketStatus = getMarketScheduleStatus(now);
      const [recentJobs, staleRuns, gexCoverage, scheduler] = await Promise.all([
        new D1SpxOperationalHealthStore(env.SPX_RECAP_DB).listRecent(12),
        new D1SpxDecisionStore(env.SPX_RECAP_DB).listStaleIncomplete(new Date(now.getTime() - SPX_STALE_RUN_MS).toISOString()),
        querySpxGexCollectionCoverage(env.SPX_RECAP_DB, marketStatus.etDateKey, getSpxGexGenerationStatus(now).collectedMinuteEt),
        getSpxSchedulerStub(env).fetch('https://spx-scheduler/ensure')
          .then(async (response) => response.ok ? response.json() : { status: 'UNAVAILABLE', httpStatus: response.status })
          .catch(() => ({ status: 'UNAVAILABLE' })),
      ]);
      return Response.json({
        checkedAt: now.toISOString(),
        deployment: env.CF_VERSION_METADATA || null,
        market: { date: marketStatus.etDateKey, minutesEt: marketStatus.minutes, isTradingWindow: marketStatus.isTradingWindow },
        staleRunIds: staleRuns.map(({ run }) => run.runId),
        gex: {
          persistedCount: gexCoverage.persistedCount,
          incompleteSlotIds: gexCoverage.incompleteSlotIds,
          failedSlotIds: gexCoverage.failedSlotIds,
        },
        scheduler,
        recentJobs,
      });
    }

    if (url.searchParams.has('gex_lifecycle_date')) {
      if (!env.SPX_RECAP_DB) return new Response('SPX_RECAP_DB unavailable', { status: 503 });
      const dateKey = url.searchParams.get('gex_lifecycle_date') || '';
      const currentStatus = getSpxGexGenerationStatus(new Date());
      const asOfCollectedMinuteEt = dateKey === currentStatus.etDateKey
        ? currentStatus.collectedMinuteEt
        : 16 * 60 + 15;
      const coverage = await querySpxGexCollectionCoverage(env.SPX_RECAP_DB, dateKey, asOfCollectedMinuteEt);
      return Response.json({ date: dateKey, asOfCollectedMinuteEt, ...coverage });
    }

    // ?audit — 手動觸發盤後審計報告
    if (url.searchParams.has('audit')) {
      const result = await runEndOfDayAudit(env, new Date(), { force: forceManualRun });
      return Response.json(result, { status: result.status === 'FAILED' ? 502 : 200 });
    }

    if (url.searchParams.has('gex')) {
      ctx.waitUntil(runSpxGexHeatmapGeneration(env, new Date(), { force: forceManualRun }));
      return new Response('SPX GEX heatmap generation triggered.');
    }

    if (url.searchParams.has('probe_llm')) {
      const probe = await runSpxGpt5CompatibilityProbe(env);
      return Response.json({
        probe: probe.ok ? 'SUCCESS' : 'FAILED',
        failureStatus: probe.failureStatus,
        attempts: probe.attempts,
      }, { status: probe.ok ? 200 : 502 });
    }

    if (url.searchParams.has('uat_llm')) {
      const deliveryMode = resolveSpxDeliveryMode({
        trigger: 'MANUAL',
        explicitDelivery: url.searchParams.has('deliver'),
        debugPreview: url.searchParams.has('debug'),
      });
      const requestedRunId = url.searchParams.get('uat_run_id');
      const runId = requestedRunId && /^[a-z0-9_.:-]{8,120}$/i.test(requestedRunId)
        ? requestedRunId
        : `uat-llm-20260713-1445-${Date.now()}`;
      try {
        const outcome = await runSpxUatLlm(env, runId, deliveryMode);
        if (!outcome.result) {
          return Response.json({
            runId,
            deliveryMode,
            probe: 'FAILED',
            failureStatus: outcome.probe.failureStatus || 'UAT_RUNTIME_FAILURE',
            attempts: outcome.probe.attempts,
          }, { status: 502 });
        }
        return Response.json({
          runId,
          deliveryMode,
          probe: 'SUCCESS',
          delivery: outcome.result.delivery,
          finalAction: outcome.result.finalDecision.action,
          degraded: outcome.result.run.degraded,
        });
      } catch (error) {
        console.error('[SPX_UAT_LLM]', error);
        return Response.json({
          runId,
          deliveryMode,
          probe: 'FAILED',
          failureStatus: 'UAT_RUNTIME_FAILURE',
          attempts: [],
        }, { status: 502 });
      }
    }

    const manualStatus = getMarketScheduleStatus(new Date());
    if (!manualStatus.isTradingWindow) {
      const deliveryMode = resolveSpxDeliveryMode({
        trigger: 'MANUAL',
        explicitDelivery: url.searchParams.has('deliver'),
        debugPreview: url.searchParams.has('debug'),
      });
      const requestedRunId = url.searchParams.get('uat_run_id');
      const uatRunId = requestedRunId && /^[a-z0-9_.:-]{8,120}$/i.test(requestedRunId)
        ? requestedRunId
        : `uat-replay-20260713-1445-${Date.now()}`;
      if (deliveryMode === 'PREVIEW') {
        const preview = await runSpxUatReplay(env, uatRunId, 'PREVIEW');
        return new Response(`UAT_REPLAY PREVIEW (non-live; no model call; Telegram suppressed)\n\n${preview.message}`);
      }
      ctx.waitUntil(runSpxUatReplay(env, uatRunId, 'SEND'));
      return new Response(`UAT_REPLAY delivery triggered for run_id=${uatRunId}; fixed historical fixture, not a live signal.`);
    }

    if (url.searchParams.has('debug')) {
      const logs: string[] = [];
      const originalLog = console.log;
      const originalError = console.error;
      console.log = (...args) => logs.push(`[LOG] ${args.join(' ')}`);
      console.error = (...args) => logs.push(`[ERR] ${args.join(' ')}`);

      try {
        await runLiveSpxDecisionRun(env, new Date(), {
          force: forceManualRun,
          debugReportPreview: true,
          deliveryMode: resolveSpxDeliveryMode({ trigger: 'MANUAL', debugPreview: true }),
        });
        return new Response(`DEBUG COMPLETE.\n\nLOGS:\n${logs.join('\n')}`);
      } catch (e: any) {
        return new Response(`DEBUG ERROR: ${e.message}\n${e.stack}\n\nLOGS:\n${logs.join('\n')}`, { status: 500 });
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }
    }
    const deliveryMode = resolveSpxDeliveryMode({
      trigger: 'MANUAL',
      explicitDelivery: url.searchParams.has('deliver'),
    });
    ctx.waitUntil(runLiveSpxDecisionRun(env, new Date(), { force: forceManualRun, deliveryMode }));
    return new Response(deliveryMode === 'SEND'
      ? 'Analysis delivery triggered.'
      : 'Analysis preview triggered; Telegram delivery suppressed. Add ?deliver to send explicitly.');
  }
};
