import {
  applyOptionConstraints,
  normalizeQuantStrategiesFromAgentResponse,
  selectRecommendedQuantTrade,
  type QuantOptionLevels,
  type QuantStrategy,
} from "./finance-analyzer-contract";
import {
  normalizeDashboardDecision,
  type DashboardDecision,
} from "./finance-dashboard-ai-decision";
import {
  getDashboardNarrativeStatus,
  type DashboardNarrativeStatus,
} from "./finance-dashboard-narrative";
import type { SentimentApiResult } from "./market-sentiment";

export interface FinanceDashboardNewsItem {
  title: string;
  publisher: string;
  publish_time: string;
  link: string;
  source?: string;
}

export interface FinanceDashboardData {
  quantStrategySchemaVersion: "v3";
  symbol: string;
  price: number;
  change: string;
  algoRating: number;
  marketSentiment: number | null;
  sentimentSource?: string;
  sentimentData?: SentimentApiResult | null;
  decision: DashboardDecision;
  strategyPoints: { entry?: number; stopLoss?: number; takeProfit?: number };
  news: FinanceDashboardNewsItem[];
  chartData: { date: string; date_iso?: string; price: number; open?: number; high?: number; low?: number; volume: number }[];
  optionsFlow?: {
    totalCallOI: number;
    totalPutOI: number;
    ratio: number;
    topStrikes: { strike: number; callOI: number; putOI: number }[];
    expirationDate?: string;
    putWall?: number;
    callWall?: number;
    interpretation?: string;
    error?: string;
  };
  quantStrategies: QuantStrategy[];
  recommendedTrade: QuantStrategy | null;
  finalAnalysis?: string;
  dashboardNarrative?: DashboardNarrativeStatus;
}

export interface FinanceDashboardSnapshotPayload {
  data: FinanceDashboardData;
  vixData: unknown | null;
  valuationData: unknown | null;
  technicalData: unknown | null;
}

interface DashboardAgentResponse {
  success?: boolean;
  reply?: unknown;
  error?: unknown;
  steps?: Array<{ type?: string; tool_name?: string; tool_result?: string }>;
  dashboardDecision?: unknown;
  dashboardNarrative?: DashboardNarrativeStatus;
}

const finiteNumber = (value: unknown, fallback = 0) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const optionOpenInterest = (leg: Record<string, unknown>) => {
  const value = leg.open_interest ?? leg.openInterest;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
};

const nearestDominantWall = (strikes: Array<{ strike: number; callOI: number; putOI: number }>, price: number, side: "call" | "put") => {
  const key = side === "call" ? "callOI" : "putOI";
  const directional = strikes
    .filter((row) => side === "call" ? row.strike > price : row.strike < price)
    .filter((row) => row[key] > 0);
  if (directional.length === 0) return undefined;
  const interest = directional.map((row) => row[key]).sort((left, right) => left - right);
  const median = interest[Math.floor(interest.length / 2)] || 0;
  return [...directional]
    .filter((row) => row[key] >= median)
    .sort((left, right) => Math.abs(left.strike - price) - Math.abs(right.strike - price) || right[key] - left[key])[0]?.strike;
};

const toOptionLevels = (optionsFlow: FinanceDashboardData["optionsFlow"]): QuantOptionLevels => {
  if (!optionsFlow || optionsFlow.topStrikes.length === 0 || optionsFlow.error) return { status: "MISSING" };
  return {
    status: "AVAILABLE",
    ...(optionsFlow.putWall ? { putWall: optionsFlow.putWall } : {}),
    ...(optionsFlow.callWall ? { callWall: optionsFlow.callWall } : {}),
    ...(optionsFlow.expirationDate ? { expirationDate: optionsFlow.expirationDate } : {}),
  };
};

const parseToolResult = (value: unknown) => {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, any> : null;
  } catch {
    return null;
  }
};

export const buildFinanceDashboardSnapshot = (input: {
  symbol: string;
  agent: DashboardAgentResponse;
  news: unknown;
  vix: unknown;
  fundamentals: unknown;
  technical: unknown;
  sentiment: unknown;
}): FinanceDashboardSnapshotPayload => {
  if (!input.agent.success) {
    throw new Error(typeof input.agent.error === "string" && input.agent.error ? input.agent.error : "Finance dashboard AI analysis failed.");
  }

  let price = 0;
  let change = "0.00%";
  let algoScore = 50;
  let chartData: FinanceDashboardData["chartData"] = [];
  let optionsFlow: FinanceDashboardData["optionsFlow"] = undefined;

  for (const step of input.agent.steps || []) {
    if (step.type !== "tool_call") continue;
    const result = parseToolResult(step.tool_result);
    if (!result) continue;

    if (step.tool_name === "get_realtime_quote") {
      price = finiteNumber(result.price ?? result.current_price);
      const changePercent = Number(result.change_pct ?? result.change_percent);
      if (Number.isFinite(changePercent)) change = `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%`;
    }

    if (Array.isArray(result.chart_data)) {
      chartData = result.chart_data.map((point: any) => ({
        ...point,
        price: finiteNumber(point.price),
        open: finiteNumber(point.open ?? point.price),
        high: finiteNumber(point.high ?? point.price),
        low: finiteNumber(point.low ?? point.price),
        volume: finiteNumber(point.volume),
      }));
    }

    if (result.score !== undefined) algoScore = finiteNumber(result.score, algoScore);

    if (step.tool_name === "get_options_chain") {
      const calls = Array.isArray(result.calls) ? result.calls : [];
      const puts = Array.isArray(result.puts) ? result.puts : [];
      const strikeMap = new Map<number, { callOI: number; putOI: number }>();
      let totalCallOI = 0;
      let totalPutOI = 0;
      for (const call of calls) {
        const openInterest = optionOpenInterest(call);
        if (openInterest === null) continue;
        totalCallOI += openInterest;
        const strike = finiteNumber(call.strike);
        const existing = strikeMap.get(strike) || { callOI: 0, putOI: 0 };
        existing.callOI += openInterest;
        strikeMap.set(strike, existing);
      }
      for (const put of puts) {
        const openInterest = optionOpenInterest(put);
        if (openInterest === null) continue;
        totalPutOI += openInterest;
        const strike = finiteNumber(put.strike);
        const existing = strikeMap.get(strike) || { callOI: 0, putOI: 0 };
        existing.putOI += openInterest;
        strikeMap.set(strike, existing);
      }
      const underlyingPrice = finiteNumber(result.underlying_price);
      const topStrikes = [...strikeMap.entries()]
        .map(([strike, data]) => ({ strike, ...data }))
        .filter((row) => row.callOI + row.putOI > 0)
        .sort((left, right) => Math.abs(left.strike - underlyingPrice) - Math.abs(right.strike - underlyingPrice))
        .slice(0, 12)
        .sort((left, right) => right.strike - left.strike);
      if (topStrikes.length > 0) {
        const expiry = Number(result.current_expiration);
        optionsFlow = {
          totalCallOI,
          totalPutOI,
          ratio: totalPutOI > 0 ? totalCallOI / totalPutOI : 1,
          topStrikes,
          ...(Number.isFinite(expiry) ? { expirationDate: new Date(expiry * 1_000).toISOString().slice(0, 10) } : {}),
        };
      } else {
        optionsFlow = {
          totalCallOI: 0,
          totalPutOI: 0,
          ratio: 1,
          topStrikes: [],
          error: typeof result.error === "string" ? result.error : "Yahoo 未提供可用的期權未平倉量；不會以成交量或假數字代替。",
        };
      }
    }
  }

  if (optionsFlow && optionsFlow.topStrikes.length > 0) {
    const optionsPrice = price > 0
      ? price
      : optionsFlow.topStrikes.reduce((total, row) => total + row.strike, 0) / optionsFlow.topStrikes.length;
    const putWall = nearestDominantWall(optionsFlow.topStrikes, optionsPrice, "put");
    const callWall = nearestDominantWall(optionsFlow.topStrikes, optionsPrice, "call");
    optionsFlow = {
      ...optionsFlow,
      ...(putWall ? { putWall } : {}),
      ...(callWall ? { callWall } : {}),
    };
  }

  const quantStrategies = applyOptionConstraints(
    normalizeQuantStrategiesFromAgentResponse(input.agent),
    toOptionLevels(optionsFlow),
  );
  const recommendedTrade = selectRecommendedQuantTrade(quantStrategies);
  algoScore = recommendedTrade?.score ?? quantStrategies[0]?.score ?? algoScore;

  const sentiment = input.sentiment && typeof input.sentiment === "object" && !(input.sentiment as any).error
    ? input.sentiment as SentimentApiResult
    : null;
  const newsPayload = input.news && typeof input.news === "object" ? input.news as { news?: any[] } : {};
  const reply = typeof input.agent.reply === "string" && input.agent.reply.trim() ? input.agent.reply : undefined;

  return {
    data: {
      quantStrategySchemaVersion: "v3",
      symbol: input.symbol.toUpperCase(),
      price,
      change,
      algoRating: algoScore,
      marketSentiment: typeof sentiment?.score === "number" && Number.isFinite(sentiment.score) ? sentiment.score : null,
      ...(sentiment?.sourceLabel ? { sentimentSource: sentiment.sourceLabel } : {}),
      sentimentData: sentiment,
      decision: normalizeDashboardDecision(input.agent.dashboardDecision),
      strategyPoints: recommendedTrade ? {
        entry: recommendedTrade.entry,
        stopLoss: recommendedTrade.stopLoss,
        takeProfit: recommendedTrade.target,
      } : {},
      news: Array.isArray(newsPayload.news) ? newsPayload.news.map((item) => ({
        ...item,
        publisher: String(item.publisher || item.source || "Yahoo Finance"),
        publish_time: String(item.publish_time || ""),
        link: String(item.link || ""),
        source: String(item.publisher || item.source || "Yahoo Finance"),
      })) : [],
      chartData,
      optionsFlow: optionsFlow || { totalCallOI: 0, totalPutOI: 0, ratio: 1, topStrikes: [], error: "未找到期權鏈數據" },
      quantStrategies,
      recommendedTrade,
      finalAnalysis: reply,
      dashboardNarrative: input.agent.dashboardNarrative || getDashboardNarrativeStatus(reply),
    },
    vixData: input.vix && typeof input.vix === "object" && !(input.vix as any).error ? input.vix : null,
    valuationData: input.fundamentals && typeof input.fundamentals === "object" && !(input.fundamentals as any).error ? input.fundamentals : null,
    technicalData: input.technical && typeof input.technical === "object" && !(input.technical as any).error ? input.technical : null,
  };
};
