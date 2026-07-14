export const DASHBOARD_REQUIRED_DATA_TOOLS = [
  "get_realtime_quote",
  "get_options_chain",
  "run_algorithmic_strategy",
] as const;

export const DASHBOARD_DECISION_TOOL_NAME = "record_dashboard_decision";

export type DashboardTrend = "bullish" | "bearish" | "range";
export type DashboardAction = "buy" | "wait" | "sell";
export type DashboardEvidenceSource = "quote" | "options" | "quant";

export interface DashboardDecisionEvidence {
  source: DashboardEvidenceSource;
  fact: string;
}

export interface AvailableDashboardDecision {
  status: "available";
  trend: DashboardTrend;
  action: DashboardAction;
  rationale: string;
  evidence: DashboardDecisionEvidence[];
}

export interface UnavailableDashboardDecision {
  status: "unavailable";
  reason: string;
}

export type DashboardDecision = AvailableDashboardDecision | UnavailableDashboardDecision;

type AgentStepLike = {
  type?: string;
  tool_name?: string;
  tool_result?: string;
};

const trendValues = new Set<DashboardTrend>(["bullish", "bearish", "range"]);
const actionValues = new Set<DashboardAction>(["buy", "wait", "sell"]);
const evidenceSources = new Set<DashboardEvidenceSource>(["quote", "options", "quant"]);

export const unavailableDashboardDecision = (reason: string): UnavailableDashboardDecision => ({
  status: "unavailable",
  reason,
});

const parseToolResult = (step: AgentStepLike): Record<string, unknown> | null => {
  if (!step.tool_result) return null;
  try {
    const value = JSON.parse(step.tool_result);
    return value && typeof value === "object" ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

export function validateDashboardDecision(value: unknown): DashboardDecision {
  if (!value || typeof value !== "object") {
    return unavailableDashboardDecision("AI decision payload is missing.");
  }

  const candidate = value as Record<string, unknown>;
  const trend = candidate.trend;
  const action = candidate.action;
  const rationale = typeof candidate.rationale === "string" ? candidate.rationale.trim() : "";
  const evidence = candidate.evidence;

  if (typeof trend !== "string" || !trendValues.has(trend as DashboardTrend)) {
    return unavailableDashboardDecision("AI decision trend is invalid.");
  }
  if (typeof action !== "string" || !actionValues.has(action as DashboardAction)) {
    return unavailableDashboardDecision("AI decision action is invalid.");
  }
  if (rationale.length < 10 || rationale.length > 280) {
    return unavailableDashboardDecision("AI decision rationale is missing or too long.");
  }
  if (!Array.isArray(evidence) || evidence.length < 2) {
    return unavailableDashboardDecision("AI decision requires at least two evidence items.");
  }

  const normalizedEvidence: DashboardDecisionEvidence[] = [];
  for (const item of evidence) {
    if (!item || typeof item !== "object") {
      return unavailableDashboardDecision("AI decision evidence is invalid.");
    }
    const source = (item as Record<string, unknown>).source;
    const fact = (item as Record<string, unknown>).fact;
    if (
      typeof source !== "string" ||
      !evidenceSources.has(source as DashboardEvidenceSource) ||
      typeof fact !== "string" ||
      fact.trim().length < 4 ||
      fact.trim().length > 220
    ) {
      return unavailableDashboardDecision("AI decision evidence is invalid.");
    }
    normalizedEvidence.push({ source: source as DashboardEvidenceSource, fact: fact.trim() });
  }

  if (new Set(normalizedEvidence.map((item) => item.source)).size < 2) {
    return unavailableDashboardDecision("AI decision evidence must cite at least two source types.");
  }

  return {
    status: "available",
    trend: trend as DashboardTrend,
    action: action as DashboardAction,
    rationale,
    evidence: normalizedEvidence,
  };
}

export function deriveDashboardDecisionFromAgentSteps(steps: AgentStepLike[]): DashboardDecision {
  for (const toolName of DASHBOARD_REQUIRED_DATA_TOOLS) {
    const matchingStep = steps.find((step) => step.type === "tool_call" && step.tool_name === toolName);
    if (!matchingStep) {
      return unavailableDashboardDecision(`Required tool was not called: ${toolName}.`);
    }

    const result = parseToolResult(matchingStep);
    if (!result || typeof result.error === "string") {
      return unavailableDashboardDecision(`Required tool failed: ${toolName}.`);
    }
  }

  const decisionStep = [...steps]
    .reverse()
    .find((step) => step.type === "tool_call" && step.tool_name === DASHBOARD_DECISION_TOOL_NAME);
  if (!decisionStep) {
    return unavailableDashboardDecision("AI did not submit a structured dashboard decision.");
  }

  const decisionResult = parseToolResult(decisionStep);
  if (!decisionResult || typeof decisionResult.error === "string") {
    return unavailableDashboardDecision("AI dashboard decision failed schema validation.");
  }

  return validateDashboardDecision(decisionResult.decision);
}

export function normalizeDashboardDecision(value: unknown): DashboardDecision {
  if (!value || typeof value !== "object") {
    return unavailableDashboardDecision("Dashboard decision was not returned by the API.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.status === "unavailable" && typeof candidate.reason === "string" && candidate.reason.trim()) {
    return unavailableDashboardDecision(candidate.reason.trim());
  }
  return validateDashboardDecision(candidate);
}

export const formatDashboardTrend = (trend: DashboardTrend) => ({
  bullish: "看升",
  bearish: "看跌",
  range: "區間",
})[trend];

export const formatDashboardAction = (action: DashboardAction) => ({
  buy: "買入",
  wait: "觀望",
  sell: "賣出",
})[action];
