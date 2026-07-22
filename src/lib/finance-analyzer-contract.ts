export type FinanceAnalyzerSurface = "dashboard" | "chat" | "committee";

export const DASHBOARD_AGENT_TOOL_NAMES = [
  "get_realtime_quote",
  "get_options_chain",
  "run_algorithmic_strategy",
  "record_dashboard_decision",
] as const;

export const FINANCE_ANALYZER_MODEL_CALL_BUDGETS: Record<
  FinanceAnalyzerSurface,
  {
    endpoint: string;
    maxOpenRouterCalls: number;
    role: string;
  }
> = {
  dashboard: {
    endpoint: "/api/agent/chat",
    maxOpenRouterCalls: 6,
    role: "Default dashboard narrative, narrow tool scope",
  },
  chat: {
    endpoint: "/api/agent/chat",
    maxOpenRouterCalls: 10,
    role: "User-opened Finance Agent Chat, broad ReAct scope",
  },
  committee: {
    endpoint: "/api/trading-agent/query",
    maxOpenRouterCalls: 25,
    role: "Explicit secondary Trading Agent Committee action",
  },
};

export const FINANCE_ANALYZER_SOURCE_MAP = [
  {
    layer: "Dashboard price and chart",
    displayLayer: "價格與 K 線",
    endpoint: "/api/agent/chat",
    tools: ["get_realtime_quote", "run_algorithmic_strategy"],
    source: "Yahoo Finance chart API",
    displaySource: "Yahoo Finance 行情 + 本地策略計算",
    deterministic: true,
  },
  {
    layer: "Candlestick pattern analysis",
    displayLayer: "多時段 K 線型態",
    endpoint: "/api/candlestick-patterns",
    tools: [],
    source: "Yahoo Finance chart API plus local deterministic candlestick rules",
    displaySource: "Yahoo Finance 行情 + 本地固定型態規則",
    deterministic: true,
  },
  {
    layer: "Stock options exposure",
    displayLayer: "期權曝險",
    endpoint: "/api/agent/chat",
    tools: ["get_options_chain"],
    source: "Yahoo Finance options chain",
    displaySource: "Yahoo Finance 期權鏈",
    deterministic: true,
  },
  {
    layer: "News feed",
    displayLayer: "新聞快訊",
    endpoint: "/api/news",
    tools: [],
    source: "Yahoo Finance search news",
    displaySource: "Yahoo Finance 新聞搜尋",
    deterministic: true,
  },
  {
    layer: "VIX card",
    displayLayer: "VIX 恐慌指數",
    endpoint: "/api/vix",
    tools: [],
    source: "Yahoo Finance ^VIX chart API",
    displaySource: "Yahoo Finance ^VIX",
    deterministic: true,
  },
  {
    layer: "Valuation widget",
    displayLayer: "估值摘要",
    endpoint: "/api/fundamentals",
    tools: [],
    source: "Yahoo Finance quoteSummary",
    displaySource: "Yahoo Finance 財務摘要",
    deterministic: true,
  },
  {
    layer: "Technical radar",
    displayLayer: "技術雷達",
    endpoint: "/api/technical-radar",
    tools: [],
    source: "Yahoo Finance chart API plus local indicators",
    displaySource: "行情資料 + 本地技術指標",
    deterministic: true,
  },
  {
    layer: "Market mood",
    displayLayer: "Market Mood Proxy",
    endpoint: "/api/sentiment",
    tools: [],
    source: "ADANOS retail sentiment when available, otherwise deterministic Yahoo/options/technical/news proxy",
    displaySource: "Retail sentiment or Market Mood Proxy",
    deterministic: true,
  },
  {
    layer: "AI narrative",
    displayLayer: "個股解讀",
    endpoint: "/api/agent/chat",
    tools: [...DASHBOARD_AGENT_TOOL_NAMES],
    source: "OpenRouter synthesis over fetched tool results",
    displaySource: "AI 摘要引擎只整合已抓取資料",
    deterministic: false,
  },
  {
    layer: "Trading Agent Committee",
    displayLayer: "深度多角色分析",
    endpoint: "/api/trading-agent/query",
    tools: ["role-specific registries"],
    source: "Explicit secondary multi-agent flow",
    displaySource: "使用者主動開啟的進階分析",
    deterministic: false,
  },
  {
    layer: "SPX GEX heatmap",
    displayLayer: "SPX GEX 熱力圖",
    endpoint: "/api/spx-gex-heatmap",
    tools: [],
    source: "Deterministic D1 snapshot contract",
    displaySource: "D1 快照 + 固定計算規則",
    deterministic: true,
  },
] as const;

type AgentStepLike = {
  type?: string;
  tool_name?: string;
  tool_result?: string;
};

export type QuantTradeActionability = "EXECUTABLE" | "PENDING_TRIGGER" | "NO_TRADE" | "RESEARCH_ONLY";
export type QuantEntryType = "LIMIT_ZONE" | "BREAKOUT_TRIGGER";

export type QuantTradeSetup = {
  actionability: QuantTradeActionability;
  nextStep: string;
  entryType?: QuantEntryType;
  entryLow?: number;
  entryHigh?: number;
  triggerPrice?: number;
  stopLoss?: number;
  target1?: number;
  target2?: number;
  rewardRisk?: number;
  invalidation?: string;
  maxHoldingDays?: number;
  optionSupport?: number;
  optionResistance?: number;
  atr14?: number;
  optionsStatus: "PENDING" | "MISSING" | "AVAILABLE";
};

export type QuantStrategy = {
  id?: string;
  name: string;
  score: number;
  signal: string;
  reasons: string[];
  risks: string[];
  tradeSetup: QuantTradeSetup;
  asOf?: string;
  entry?: number;
  stopLoss?: number;
  target?: number;
};

export type QuantOptionLevels = {
  status: "MISSING" | "AVAILABLE";
  putWall?: number;
  callWall?: number;
  expirationDate?: string;
};

const actionabilityRank: Record<QuantTradeActionability, number> = {
  EXECUTABLE: 0,
  PENDING_TRIGGER: 1,
  NO_TRADE: 2,
  RESEARCH_ONLY: 3,
};

export function selectTopQuantStrategies(strategies: QuantStrategy[], limit = 5): QuantStrategy[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  return [...strategies]
    .sort((left, right) => actionabilityRank[left.tradeSetup?.actionability || "PENDING_TRIGGER"] - actionabilityRank[right.tradeSetup?.actionability || "PENDING_TRIGGER"] || right.score - left.score)
    .slice(0, Math.floor(limit));
}

export function selectRecommendedQuantTrade(strategies: QuantStrategy[]): QuantStrategy | null {
  return selectTopQuantStrategies(strategies, strategies.length)
    .find((strategy) => strategy.tradeSetup.actionability === "EXECUTABLE") || null;
}

const normalizeStrategyTextList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeStrategyNumber = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const isActionability = (value: unknown): value is QuantTradeActionability =>
  value === "EXECUTABLE" || value === "PENDING_TRIGGER" || value === "NO_TRADE" || value === "RESEARCH_ONLY";

const isEntryType = (value: unknown): value is QuantEntryType => value === "LIMIT_ZONE" || value === "BREAKOUT_TRIGGER";

const normalizeTradeSetup = (item: any): QuantTradeSetup => {
  const rawCandidate = item?.tradeSetup || item?.trade_setup;
  const hasExplicitSetup = Boolean(rawCandidate && typeof rawCandidate === "object");
  const raw = hasExplicitSetup ? rawCandidate : {};
  const requestedActionability = hasExplicitSetup && isActionability(raw.actionability)
    ? raw.actionability
    : "PENDING_TRIGGER";
  const entryType = hasExplicitSetup && isEntryType(raw.entryType ?? raw.entry_type)
    ? raw.entryType ?? raw.entry_type
    : undefined;
  const entryLow = normalizeStrategyNumber(raw.entryLow ?? raw.entry_low);
  const entryHigh = normalizeStrategyNumber(raw.entryHigh ?? raw.entry_high);
  const triggerPrice = normalizeStrategyNumber(raw.triggerPrice ?? raw.trigger_price);
  const stopLoss = normalizeStrategyNumber(raw.stopLoss ?? raw.stop_loss);
  const target1 = normalizeStrategyNumber(raw.target1 ?? raw.target_1 ?? raw.target);
  const target2 = normalizeStrategyNumber(raw.target2 ?? raw.target_2);
  const primaryEntry = entryType === "BREAKOUT_TRIGGER" ? triggerPrice : entryHigh;
  const rewardRisk = normalizeStrategyNumber(raw.rewardRisk ?? raw.reward_risk)
    ?? (primaryEntry && stopLoss && target1 && primaryEntry > stopLoss ? (target1 - primaryEntry) / (primaryEntry - stopLoss) : undefined);
  const executable = requestedActionability === "EXECUTABLE"
    && primaryEntry && stopLoss && target1 && target1 > primaryEntry && stopLoss < primaryEntry && rewardRisk && rewardRisk >= 2;

  if (requestedActionability === "EXECUTABLE" && !executable) {
    return {
      actionability: "PENDING_TRIGGER",
      nextStep: "策略未提供完整且至少 2.0R 的交易計劃；等待可驗證觸發。",
      ...(entryType ? { entryType } : {}),
      ...(entryLow ? { entryLow } : {}),
      ...(entryHigh ? { entryHigh } : {}),
      ...(triggerPrice ? { triggerPrice } : {}),
      optionsStatus: "PENDING",
    };
  }

  if (requestedActionability !== "EXECUTABLE") {
    return {
      actionability: requestedActionability,
      nextStep: String(raw.nextStep ?? raw.next_step ?? (hasExplicitSetup ? "等待策略條件完成；目前不可交易。" : "舊快取不含可驗證交易計劃；重新分析後才會產生新價位。")),
      ...(entryType ? { entryType } : {}),
      ...(entryLow ? { entryLow } : {}),
      ...(entryHigh ? { entryHigh } : {}),
      ...(triggerPrice ? { triggerPrice } : {}),
      ...(typeof raw.invalidation === "string" && raw.invalidation.trim() ? { invalidation: raw.invalidation.trim() } : {}),
      optionsStatus: raw.optionsStatus === "AVAILABLE" || raw.optionsStatus === "MISSING" ? raw.optionsStatus : "PENDING",
    };
  }

  return {
    actionability: "EXECUTABLE",
    nextStep: String(raw.nextStep ?? raw.next_step ?? "按交易計劃執行，勿超過入場區。"),
    entryType: entryType!,
    ...(entryLow ? { entryLow } : {}),
    ...(entryHigh ? { entryHigh } : {}),
    ...(triggerPrice ? { triggerPrice } : {}),
    stopLoss: stopLoss!,
    target1: target1!,
    ...(target2 ? { target2 } : {}),
    rewardRisk: Number(rewardRisk!.toFixed(2)),
    ...(typeof raw.invalidation === "string" && raw.invalidation.trim() ? { invalidation: raw.invalidation.trim() } : {}),
    ...(normalizeStrategyNumber(raw.maxHoldingDays ?? raw.max_holding_days) ? { maxHoldingDays: normalizeStrategyNumber(raw.maxHoldingDays ?? raw.max_holding_days) } : {}),
    ...(normalizeStrategyNumber(raw.optionSupport ?? raw.option_support) ? { optionSupport: normalizeStrategyNumber(raw.optionSupport ?? raw.option_support) } : {}),
    ...(normalizeStrategyNumber(raw.optionResistance ?? raw.option_resistance) ? { optionResistance: normalizeStrategyNumber(raw.optionResistance ?? raw.option_resistance) } : {}),
    ...(normalizeStrategyNumber(raw.atr14 ?? raw.atr_14) ? { atr14: normalizeStrategyNumber(raw.atr14 ?? raw.atr_14) } : {}),
    optionsStatus: raw.optionsStatus === "AVAILABLE" || raw.optionsStatus === "MISSING" ? raw.optionsStatus : "PENDING",
  };
};

const normalizeQuantStrategy = (item: any): QuantStrategy | null => {
  const name = String(item?.name || item?.strategy_name || item?.strategyName || item?.display_name || item?.displayName || "").trim();
  const score = Number(item?.score);
  if (!name || !Number.isFinite(score)) return null;

  const normalized: QuantStrategy = {
    ...(typeof item?.strategyId === "string" ? { id: item.strategyId } : {}),
    name,
    score,
    signal: String(item?.signal || "").trim(),
    reasons: normalizeStrategyTextList(item?.reasons),
    risks: normalizeStrategyTextList(item?.risks),
    tradeSetup: normalizeTradeSetup(item),
    ...(typeof item?.asOf === "string" && item.asOf ? { asOf: item.asOf } : {}),
  };

  if (normalized.tradeSetup.actionability === "EXECUTABLE") {
    const entry = normalized.tradeSetup.entryType === "BREAKOUT_TRIGGER"
      ? normalized.tradeSetup.triggerPrice
      : normalized.tradeSetup.entryHigh;
    if (entry !== undefined) normalized.entry = entry;
    if (normalized.tradeSetup.stopLoss !== undefined) normalized.stopLoss = normalized.tradeSetup.stopLoss;
    if (normalized.tradeSetup.target1 !== undefined) normalized.target = normalized.tradeSetup.target1;
  }
  return normalized;
};

const pendingForOptions = (setup: QuantTradeSetup, message: string): QuantTradeSetup => ({
  actionability: "PENDING_TRIGGER",
  nextStep: message,
  ...(setup.entryType ? { entryType: setup.entryType } : {}),
  ...(setup.entryLow ? { entryLow: setup.entryLow } : {}),
  ...(setup.entryHigh ? { entryHigh: setup.entryHigh } : {}),
  ...(setup.triggerPrice ? { triggerPrice: setup.triggerPrice } : {}),
  ...(setup.invalidation ? { invalidation: setup.invalidation } : {}),
  ...(setup.optionSupport ? { optionSupport: setup.optionSupport } : {}),
  ...(setup.optionResistance ? { optionResistance: setup.optionResistance } : {}),
  ...(setup.atr14 ? { atr14: setup.atr14 } : {}),
  optionsStatus: setup.optionsStatus,
});

export function applyOptionConstraints(strategies: QuantStrategy[], options: QuantOptionLevels): QuantStrategy[] {
  return strategies.map((strategy) => {
    const setup = strategy.tradeSetup;
    if (options.status === "MISSING") {
      return {
        ...strategy,
        tradeSetup: { ...setup, optionsStatus: "MISSING" },
        risks: [...strategy.risks, "期權鏈不可用；未以虛構支持或阻力代替。"],
      };
    }

    let nextSetup: QuantTradeSetup = {
      ...setup,
      optionsStatus: "AVAILABLE",
      ...(options.putWall ? { optionSupport: options.putWall } : {}),
      ...(options.callWall ? { optionResistance: options.callWall } : {}),
    };
    const reasons = [...strategy.reasons];
    if (options.putWall) reasons.push(`期權 put OI 支持牆：${options.putWall.toFixed(2)}。`);
    if (options.callWall) reasons.push(`期權 call OI 阻力牆：${options.callWall.toFixed(2)}。`);

    if (nextSetup.actionability === "EXECUTABLE") {
      const entry = nextSetup.entryType === "BREAKOUT_TRIGGER" ? nextSetup.triggerPrice : nextSetup.entryHigh;
      const buffer = Math.max((nextSetup.atr14 || 0) * 0.25, 0.01);
      if (entry && nextSetup.stopLoss && nextSetup.target1 && options.callWall) {
        const cappedTarget = options.callWall - buffer;
        if (cappedTarget <= entry) {
          nextSetup = pendingForOptions(nextSetup, `最近 call OI 牆 ${options.callWall.toFixed(2)} 在入場價前；等待有效突破期權阻力。`);
        } else if (cappedTarget < nextSetup.target1) {
          const rewardRisk = (cappedTarget - entry) / (entry - nextSetup.stopLoss);
          if (rewardRisk < 2) {
            nextSetup = pendingForOptions(nextSetup, `call OI 牆 ${options.callWall.toFixed(2)} 壓縮回報至不足 2.0R；等待突破。`);
          } else {
            nextSetup = { ...nextSetup, target1: Number(cappedTarget.toFixed(2)), rewardRisk: Number(rewardRisk.toFixed(2)) };
          }
        }
      }
    }

    const next: QuantStrategy = { ...strategy, reasons, tradeSetup: nextSetup };
    if (nextSetup.actionability === "EXECUTABLE") {
      next.entry = nextSetup.entryType === "BREAKOUT_TRIGGER" ? nextSetup.triggerPrice : nextSetup.entryHigh;
      next.stopLoss = nextSetup.stopLoss;
      next.target = nextSetup.target1;
    } else {
      delete next.entry;
      delete next.stopLoss;
      delete next.target;
    }
    return next;
  });
}

const parseToolResult = (step: AgentStepLike) => {
  if (!step.tool_result) return null;
  try {
    return JSON.parse(step.tool_result);
  } catch {
    return null;
  }
};

export function normalizeQuantStrategiesFromAgentResponse(data: {
  quant_strategies?: unknown;
  steps?: AgentStepLike[];
}): QuantStrategy[] {
  if (Array.isArray(data.quant_strategies)) {
    return data.quant_strategies
      .map((item: unknown) => normalizeQuantStrategy(item))
      .filter((item): item is QuantStrategy => item !== null);
  }

  for (const step of data.steps || []) {
    if (step.type !== "tool_call" || step.tool_name !== "run_algorithmic_strategy") continue;
    const result = parseToolResult(step);
    if (!Array.isArray(result?.signals)) continue;

    return result.signals
      .map((item: unknown) => normalizeQuantStrategy(item))
      .filter((item: QuantStrategy | null): item is QuantStrategy => item !== null);
  }

  return [];
}
