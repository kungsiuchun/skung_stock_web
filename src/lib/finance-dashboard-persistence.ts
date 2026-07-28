import {
  normalizeQuantStrategiesFromAgentResponse,
  selectRecommendedQuantTrade,
} from "./finance-analyzer-contract";
import { normalizeDashboardDecision } from "./finance-dashboard-ai-decision";
import { getDashboardNarrativeStatus } from "./finance-dashboard-narrative";
import type { FinanceDashboardData } from "./finance-dashboard-snapshot";

export interface DashboardHistoryItem {
  symbol: string;
  timestamp: string;
  score: number;
  fullData?: FinanceDashboardData;
}

const LEGACY_DEEPEAR_PATTERN = /DeepEar|é«˜é »|get_financial_signals/i;

export const hasLegacyDeepEarData = (data: unknown) => {
  if (!data || typeof data !== "object") return false;
  const value = data as { financialSignals?: unknown; finalAnalysis?: unknown };
  return Boolean(value.financialSignals || (typeof value.finalAnalysis === "string" && LEGACY_DEEPEAR_PATTERN.test(value.finalAnalysis)));
};

export const normalizeStoredDashboardData = (data: unknown): FinanceDashboardData | null => {
  if (!data || typeof data !== "object") return null;
  const stored = data as FinanceDashboardData & { quantStrategies?: unknown };
  const normalizedStrategies = normalizeQuantStrategiesFromAgentResponse({ quant_strategies: stored.quantStrategies });
  const hasCurrentQuantSchema = stored.quantStrategySchemaVersion === "v3";
  const quantStrategies = hasCurrentQuantSchema ? normalizedStrategies : normalizedStrategies.map((strategy) => ({
    ...strategy, entry: undefined, stopLoss: undefined, target: undefined,
    tradeSetup: { actionability: "PENDING_TRIGGER" as const, nextStep: "Legacy cache needs a fresh analysis before it can publish a trade plan.", optionsStatus: "PENDING" as const },
  }));
  return { ...(stored as FinanceDashboardData), quantStrategySchemaVersion: "v3", decision: normalizeDashboardDecision((stored as { decision?: unknown }).decision), quantStrategies, recommendedTrade: hasCurrentQuantSchema ? selectRecommendedQuantTrade(quantStrategies) : null, dashboardNarrative: stored.dashboardNarrative || getDashboardNarrativeStatus(stored.finalAnalysis) };
};

export const sanitizeDashboardHistory = (items: unknown): DashboardHistoryItem[] => !Array.isArray(items) ? [] : items
  .filter((item): item is DashboardHistoryItem => Boolean(item && typeof item === "object" && "symbol" in item))
  .map((item) => hasLegacyDeepEarData(item.fullData) ? { ...item, fullData: undefined } : { ...item, fullData: item.fullData ? normalizeStoredDashboardData(item.fullData) || undefined : undefined });
