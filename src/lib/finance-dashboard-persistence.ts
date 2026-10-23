import {
  normalizeQuantStrategiesFromAgentResponse,
  selectRecommendedQuantTrade,
} from "./finance-analyzer-contract";
import { normalizeDashboardDecision } from "./finance-dashboard-ai-decision";
import { getDashboardNarrativeStatus } from "./finance-dashboard-narrative";
import type { FinanceDashboardData } from "./finance-dashboard-snapshot";
import { readBrowserJson } from "./browser-storage";
import {
  isValidIsoDate,
  isValidIsoTimestamp,
  normalizeFinanceChartPoint,
} from "./yahoo-finance-normalizer";

export interface DashboardHistoryItem {
  symbol: string;
  timestamp: string;
  score: number;
  fullData?: FinanceDashboardData;
}

const LEGACY_DEEPEAR_PATTERN = /DeepEar|高頻|é«˜é\u00a0»|get_financial_signals/i;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: unknown): value is string => typeof value === "string";
const optionalText = (value: unknown) => value === undefined || text(value);
const optionalNumber = (value: unknown) => value === undefined || finite(value);
const optionalNonNegativeInteger = (value: unknown) => value === undefined || typeof value === "number" && Number.isInteger(value) && value >= 0;
const validStoredStrategy = (item: unknown) => {
  if (!record(item) || !finite(item.score) || !["entry", "stopLoss", "target"].every((key) => optionalNumber(item[key]))) return false;
  const setup = item.tradeSetup || item.trade_setup;
  if (setup === undefined) return true;
  if (!record(setup)) return false;
  return ["entryLow", "entry_low", "entryHigh", "entry_high", "triggerPrice", "trigger_price", "stopLoss", "stop_loss",
    "target1", "target_1", "target", "target2", "target_2", "rewardRisk", "reward_risk", "maxHoldingDays", "max_holding_days",
    "optionSupport", "option_support", "optionResistance", "option_resistance", "atr14", "atr_14"]
    .every((key) => optionalNumber(setup[key]));
};

const validRenderData = (data: Record<string, unknown>) => {
  const validQuote = data.price === null
    ? data.quoteStatus === "unavailable" && data.change === "未提供"
    : finite(data.price) && data.price > 0 && (data.quoteStatus === undefined || data.quoteStatus === "available");
  if (!text(data.symbol) || !data.symbol.trim() || !validQuote || !text(data.change) || !finite(data.algoRating)
    || !(data.marketSentiment === null || finite(data.marketSentiment)) || !optionalText(data.sentimentSource)
    || !optionalText(data.finalAnalysis) || !record(data.strategyPoints)
    || !["entry", "stopLoss", "takeProfit"].every((key) => optionalNumber((data.strategyPoints as Record<string, unknown>)[key]))) return false;
  if ((data.quoteStatus !== undefined && data.quoteStatus !== "available" && data.quoteStatus !== "unavailable")
    || (data.quoteSourceAsOf !== undefined && data.quoteSourceAsOf !== null && !isValidIsoTimestamp(data.quoteSourceAsOf))
    || !optionalNonNegativeInteger(data.chartDataRejectedCount)
    || (data.chartDataPartial !== undefined && typeof data.chartDataPartial !== "boolean")
    || (data.chartDataLastValidDate !== undefined && data.chartDataLastValidDate !== null && !isValidIsoDate(data.chartDataLastValidDate))) return false;
  if (!Array.isArray(data.news) || !data.news.every((item) => record(item)
    && ["title", "publisher", "publish_time", "link"].every((key) => text(item[key])) && optionalText(item.source))) return false;
  if (!Array.isArray(data.chartData) || !data.chartData.every((item) => record(item) && text(item.date) && normalizeFinanceChartPoint(item))) return false;
  let previousTime = "";
  for (const point of data.chartData) {
    const time = point.date_iso || point.time;
    if (!isValidIsoDate(time)) return false;
    const timestamp = Date.parse(`${time}T00:00:00Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== time || time <= previousTime) return false;
    previousTime = time;
  }
  if (data.dashboardNarrative !== undefined) {
    const narrative = data.dashboardNarrative;
    if (!record(narrative) || !optionalText(narrative.reason)
      || !(narrative.status === "available" || (narrative.status === "unavailable" && text(narrative.reason)))) return false;
  }
  if (data.quantStrategies !== undefined || data.quantStrategySchemaVersion === "v3") {
    if (!Array.isArray(data.quantStrategies) || !data.quantStrategies.every((item) => record(item) && validStoredStrategy(item)
      && (data.quantStrategySchemaVersion !== "v3" || (text(item.name) && text(item.signal)
        && Array.isArray(item.reasons) && item.reasons.every(text) && Array.isArray(item.risks) && item.risks.every(text))))) return false;
  }
  if (data.optionsFlow !== undefined) {
    const options = data.optionsFlow;
    if (!record(options) || !["totalCallOI", "totalPutOI", "ratio"].every((key) => finite(options[key]))
      || !["putWall", "callWall"].every((key) => optionalNumber(options[key]))
      || !["expirationDate", "interpretation", "error"].every((key) => optionalText(options[key]))
      || !Array.isArray(options.topStrikes) || !options.topStrikes.every((row) => record(row)
        && ["strike", "callOI", "putOI"].every((key) => finite(row[key])))) return false;
  }
  if (data.sentimentData !== undefined && data.sentimentData !== null) {
    const sentiment = data.sentimentData;
    if (!record(sentiment) || !(sentiment.score === null || finite(sentiment.score))
      || !["symbol", "sourceLabel", "coverage", "generatedAt"].every((key) => text(sentiment[key]))
      || !["retail", "proxy", "unavailable"].includes(String(sentiment.sourceType))
      || !Array.isArray(sentiment.warnings) || !sentiment.warnings.every(text)
      || !Array.isArray(sentiment.components) || !sentiment.components.every((item) => record(item)
        && ["id", "label", "detail"].every((key) => text(item[key])) && finite(item.weight)
        && (item.score === null || finite(item.score))
        && ["bullish", "bearish", "neutral", "unavailable"].includes(String(item.status)))) return false;
  }
  return true;
};

export const hasLegacyDeepEarData = (data: unknown) => {
  if (!data || typeof data !== "object") return false;
  const value = data as { financialSignals?: unknown; finalAnalysis?: unknown };
  return Boolean(value.financialSignals || (typeof value.finalAnalysis === "string" && LEGACY_DEEPEAR_PATTERN.test(value.finalAnalysis)));
};

export const normalizeStoredDashboardData = (data: unknown): FinanceDashboardData | null => {
  if (!record(data) || hasLegacyDeepEarData(data) || !validRenderData(data)) return null;
  const stored = data as unknown as FinanceDashboardData & { quantStrategies?: unknown };
  const normalizedStrategies = normalizeQuantStrategiesFromAgentResponse({ quant_strategies: stored.quantStrategies });
  if (Array.isArray(stored.quantStrategies) && normalizedStrategies.length !== stored.quantStrategies.length) return null;
  const hasCurrentQuantSchema = stored.quantStrategySchemaVersion === "v3";
  const quantStrategies = hasCurrentQuantSchema ? normalizedStrategies : normalizedStrategies.map((strategy) => ({
    ...strategy, entry: undefined, stopLoss: undefined, target: undefined,
    tradeSetup: { actionability: "PENDING_TRIGGER" as const, nextStep: "Legacy cache needs a fresh analysis before it can publish a trade plan.", optionsStatus: "PENDING" as const },
  }));
  return { ...(stored as FinanceDashboardData), quantStrategySchemaVersion: "v3", decision: normalizeDashboardDecision((stored as { decision?: unknown }).decision), quantStrategies, recommendedTrade: hasCurrentQuantSchema ? selectRecommendedQuantTrade(quantStrategies) : null, dashboardNarrative: stored.dashboardNarrative || getDashboardNarrativeStatus(stored.finalAnalysis) };
};

export const sanitizeDashboardHistory = (items: unknown): DashboardHistoryItem[] => !Array.isArray(items) ? [] : items
  .filter((item): item is DashboardHistoryItem => record(item) && text(item.symbol) && Boolean(item.symbol.trim()) && text(item.timestamp) && finite(item.score))
  .map((item) => {
    const fullData = normalizeStoredDashboardData(item.fullData);
    return { symbol: item.symbol, timestamp: item.timestamp, score: item.score, fullData: fullData?.symbol === item.symbol ? fullData : undefined };
  });

export const loadDashboardPersistence = () => {
  const savedHistory = readBrowserJson("finance_dashboard_history");
  const savedActive = readBrowserJson("finance_dashboard_active_data");
  const history = sanitizeDashboardHistory(savedHistory.value);
  const activeData = normalizeStoredDashboardData(savedActive.value);
  const invalidHistory = savedHistory.value !== undefined && (!Array.isArray(savedHistory.value)
    || history.length !== savedHistory.value.length || savedHistory.value.some((item) => record(item)
      && item.fullData != null && (!normalizeStoredDashboardData(item.fullData)
        || (item.fullData as Record<string, unknown>).symbol !== item.symbol)));
  return {
    history, activeData,
    warnings: {
      history: savedHistory.error || (invalidHistory ? "Some saved history data is invalid or outdated and was not loaded. The original stored data has not been deleted." : null),
      active: savedActive.error || (savedActive.value !== undefined && !activeData ? "The saved result is invalid or outdated and was not loaded. Run a new analysis to replace it." : null),
    },
  };
};
