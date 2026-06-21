export type FinanceAnalyzerSurface = "dashboard" | "chat" | "committee";

export const DASHBOARD_AGENT_TOOL_NAMES = [
  "get_realtime_quote",
  "get_options_chain",
  "run_algorithmic_strategy",
  "get_financial_signals",
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

type QuantStrategy = {
  name: string;
  score: number;
};

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
      .map((item: any) => ({
        name: String(item?.name || item?.strategy_name || item?.display_name || "").trim(),
        score: Number(item?.score),
      }))
      .filter((item) => item.name && Number.isFinite(item.score));
  }

  for (const step of data.steps || []) {
    if (step.type !== "tool_call" || step.tool_name !== "run_algorithmic_strategy") continue;
    const result = parseToolResult(step);
    if (!Array.isArray(result?.signals)) continue;

    return result.signals
      .map((signal: any) => ({
        name: String(signal?.displayName || signal?.display_name || signal?.name || signal?.strategy || "").trim(),
        score: Number(signal?.score),
      }))
      .filter((item: QuantStrategy) => item.name && Number.isFinite(item.score));
  }

  return [];
}
