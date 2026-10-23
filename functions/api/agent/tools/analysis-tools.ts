/**
 * Agent Framework — Analysis Tools
 * Mirrors the Python blueprint's analysis_tools.py.
 *
 * Tools:
 *   1. analyze_trend — Comprehensive trend analysis (MA alignment, MACD, RSI approx)
 */

import type { ToolDefinition } from "../types";
import { buildStrategyContext, rankStrategyResults, runAlgorithmicStrategy, selectRecommendedTrade, type StrategyBar } from "../strategies/engine";
import { TechnicalIndicators } from "../strategies/indicators";
import { getStrategyResearchPolicy, isQuantStrategyId } from "../strategies/research-policy";
import {
  filterYahooFormingDailyBars,
  normalizeYahooChartResult,
  reportYahooChartValidation,
  yahooChartQuality,
} from "../../../../src/lib/yahoo-finance-normalizer";

// ── Tool 1: analyze_trend ──────────────────────────────────────────

async function handleAnalyzeTrend(args: Record<string, any>): Promise<Record<string, any>> {
  const symbol = (args.stock_code as string || "").toUpperCase();
  if (!symbol) return { error: "No stock_code provided" };

  // Fetch 60 days of data to calculate MACD and RSI properly
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=60d`;
  console.log(`[Tool:analyze_trend] Fetching ${url}`);

  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) return { error: `Yahoo Finance API returned ${res.status}` };

  const data = await res.json();
  const normalized = normalizeYahooChartResult(data);
  reportYahooChartValidation(symbol, normalized);
  if (normalized.malformedPayload) return { error: `Yahoo returned malformed chart data for ${symbol}`, ...yahooChartQuality(normalized) };
  const completed = filterYahooFormingDailyBars(data, normalized.bars);
  const bars = completed.bars;
  const closes = bars.map((bar) => bar.close);
  const volumes = bars.map((bar) => bar.volume);
  const quality = yahooChartQuality(normalized, completed.partialBarExcluded, bars.at(-1)?.date || null);

  if (closes.length < 30) return { error: "Insufficient data for trend analysis (need at least 30 days)", ...quality };

  // --- 1.5 Volume Analysis (Current vs 30d Avg) ---
  const currentVolume = volumes[volumes.length - 1];
  const volSlice = volumes.slice(Math.max(0, volumes.length - 30), volumes.length - 1); // exclude today
  const avgVolume30d = volSlice.length > 0 ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : 1;
  const volumeRatio = currentVolume / avgVolume30d;

  // --- 2. Price Range (60d) ---
  const high60 = Math.max(...closes);
  const low60 = Math.min(...closes);

  const ma5 = TechnicalIndicators.SMA(closes, 5);
  const ma10 = TechnicalIndicators.SMA(closes, 10);
  const ma20 = TechnicalIndicators.SMA(closes, 20);
  const currentPrice = closes[closes.length - 1];

  let maAlignment = "Mixed";
  if (ma5 && ma10 && ma20) {
    if (currentPrice > ma5 && ma5 > ma10 && ma10 > ma20) maAlignment = "Strong Bullish (多頭排列)";
    else if (currentPrice < ma5 && ma5 < ma10 && ma10 < ma20) maAlignment = "Strong Bearish (空頭排列)";
    else if (ma5 > ma20) maAlignment = "Weak Bullish (偏多)";
    else if (ma5 < ma20) maAlignment = "Weak Bearish (偏空)";
  }

  // --- 2. Proper RSI (14 days) ---
  const rsi = TechnicalIndicators.RSI(closes, 14);

  let rsiSignal = "Neutral";
  if (rsi > 70) rsiSignal = "Overbought (超買)";
  if (rsi < 30) rsiSignal = "Oversold (超賣)";

  // --- 3. Price vs 20-day High/Low ---
  const last20 = closes.slice(closes.length - 20);
  const high20 = Math.max(...last20);
  const low20 = Math.min(...last20);
  const posInRange = ((currentPrice - low20) / (high20 - low20)) * 100;

  return {
    symbol,
    current_price: currentPrice.toFixed(2),
    trend: {
      ma_alignment: maAlignment,
      rsi_14: rsi.toFixed(1),
      rsi_signal: rsiSignal,
      position_in_20d_range: `${posInRange.toFixed(1)}%`,
    },
    ma_values: {
      ma5: ma5?.toFixed(2),
      ma10: ma10?.toFixed(2),
      ma20: ma20?.toFixed(2)
    },
    volume_data: {
      current_volume: currentVolume,
      average_volume_30d: avgVolume30d,
      volume_ratio: volumeRatio.toFixed(2)
    },
    price_range_60d: {
      high: high60.toFixed(2),
      low: low60.toFixed(2),
      position_percent: (((currentPrice - low60) / (high60 - low60)) * 100).toFixed(1)
    },
    chart_data: bars.slice(-30).map((bar) => {
      return {
        date: bar.date,
        date_iso: bar.date,
        price: Number(bar.close.toFixed(2)),
        open: Number(bar.open.toFixed(2)),
        high: Number(bar.high.toFixed(2)),
        low: Number(bar.low.toFixed(2)),
        volume: bar.volume,
      };
    }),
    ...quality,
  };
}

const analyzeTrendTool: ToolDefinition = {
  name: "analyze_trend",
  description:
    "Comprehensive technical trend analysis. Calculates MA alignment (多頭/空頭排列), 14-day RSI (超買/超賣), and price position relative to 20-day high/low. Use this for deep technical evaluation of trend strength.",
  parameters: [
    {
      name: "stock_code",
      type: "string",
      description: "Stock ticker symbol, e.g. 'AAPL'",
    },
  ],
  handler: handleAnalyzeTrend,
  category: "analysis",
};

// ── Tool 2: run_algorithmic_strategy ──────────────────────────────

async function handleRunAlgorithmicStrategy(args: Record<string, any>): Promise<Record<string, any>> {
  const symbol = (args.stock_code as string || "").toUpperCase();
  const strategyName = args.strategy_name as string;

  if (!symbol) return { error: "No stock_code provided" };
  if (!strategyName) return { error: "No strategy_name provided" };

  console.log(`[Tool:run_algorithmic_strategy] Executing ${strategyName} for ${symbol}`);

  const chartUrl = (ticker: string) => `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=2y`;
  const [stockResponse, benchmarkResponse] = await Promise.all([
    fetch(chartUrl(symbol), { headers: { "User-Agent": "Mozilla/5.0" } }),
    fetch(chartUrl("SPY"), { headers: { "User-Agent": "Mozilla/5.0" } }),
  ]);
  if (!stockResponse.ok) return { error: `Yahoo Finance API returned ${stockResponse.status}` };

  const toCompletedBars = (payload: any, ticker: string) => {
    const normalized = normalizeYahooChartResult(payload);
    reportYahooChartValidation(ticker, normalized);
    if (normalized.malformedPayload) return {
      bars: [] as StrategyBar[],
      rejectedBarCount: normalized.rejectedBarCount,
      lastValidDate: null as string | null,
      partialSessionExcluded: false,
      malformedPayload: true,
    };
    const completed = filterYahooFormingDailyBars(payload, normalized.bars);
    return {
      bars: completed.bars.map(({ date, open, high, low, close, volume }) => ({ date, open, high, low, close, volume })),
      rejectedBarCount: normalized.rejectedBarCount,
      lastValidDate: completed.bars.at(-1)?.date || null,
      partialSessionExcluded: completed.partialBarExcluded,
      malformedPayload: false,
    };
  };

  const stockPayload = await stockResponse.json();
  const benchmarkPayload = benchmarkResponse.ok ? await benchmarkResponse.json() : null;
  const stockData = toCompletedBars(stockPayload, symbol);
  const benchmarkData = benchmarkPayload ? toCompletedBars(benchmarkPayload, "SPY") : null;
  const bars = stockData.bars;
  const benchmarkBars = benchmarkData?.bars || [];
  const benchmarkDates = new Set(benchmarkBars.map((bar) => bar.date));
  const benchmarkWindowAligned = Boolean(
    benchmarkData
    && bars.at(-1)?.date
    && bars.at(-21)?.date
    && benchmarkDates.has(bars.at(-1)!.date)
    && benchmarkDates.has(bars.at(-21)!.date),
  );
  const stockPartial = stockData.malformedPayload || stockData.rejectedBarCount > 0 || stockData.partialSessionExcluded;
  const benchmarkPartial = !benchmarkData || benchmarkData.malformedPayload || benchmarkData.bars.length === 0
    || !benchmarkWindowAligned || benchmarkData.rejectedBarCount > 0 || benchmarkData.partialSessionExcluded;
  const quality = {
    partial: stockPartial,
    rejected_bar_count: stockData.rejectedBarCount,
    last_valid_date: stockData.lastValidDate,
    benchmark_data_available: Boolean(benchmarkData && benchmarkData.bars.length > 0),
    benchmark_partial: benchmarkPartial,
    benchmark_rejected_bar_count: benchmarkData?.rejectedBarCount || 0,
    benchmark_last_valid_date: benchmarkData?.lastValidDate || null,
  };
  const marketQuality = {
    partial_session_excluded: stockData.partialSessionExcluded,
    data_partial: stockPartial || benchmarkPartial,
    rejected_bar_count: stockData.rejectedBarCount,
    last_valid_date: stockData.lastValidDate,
    benchmark_data_available: quality.benchmark_data_available,
    benchmark_partial: benchmarkPartial,
    benchmark_rejected_bar_count: quality.benchmark_rejected_bar_count,
    benchmark_last_valid_date: quality.benchmark_last_valid_date,
  };
  let context;
  try {
    context = buildStrategyContext({ symbol, bars, benchmarkBars });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), ...quality };
  }

  const chartData = bars.slice(-30).map((bar) => ({
    date: new Date(`${bar.date}T00:00:00.000Z`).toLocaleDateString([], { month: "short", day: "numeric" }),
    date_iso: bar.date,
    price: Number(bar.close.toFixed(2)),
    open: Number(bar.open.toFixed(2)),
    high: Number(bar.high.toFixed(2)),
    low: Number(bar.low.toFixed(2)),
    volume: bar.volume,
  }));

  if (strategyName === "all") {
    const allStrategies = [
      "bull_trend", "ma_golden_cross", "shrink_pullback",
      "box_oscillation", "volume_breakout", "dragon_head",
      "emotion_cycle", "chan_theory", "wave_theory",
      "one_yang_three_yin", "bottom_volume"
    ];
    
    const results = rankStrategyResults(allStrategies
      .map(name => runAlgorithmicStrategy(name, context))
      .filter((result): result is NonNullable<typeof result> => result !== null));
    const recommendedTrade = selectRecommendedTrade(results);

    return {
      symbol,
      strategies_evaluated: results.length,
      signals: results,
      recommended_trade: recommendedTrade,
      market_snapshot: {
        as_of: context.asOf,
        daily_bars: bars.length,
        atr14: Number(context.atr14?.toFixed(2)),
        relative_volume_20d: Number(context.volumeRatio?.toFixed(2)),
        relative_strength_vs_spy_20d: context.relativeStrength20 === null ? null : Number(context.relativeStrength20.toFixed(2)),
        ...marketQuality,
      },
      ...quality,
      timestamp: new Date().toISOString(),
      chart_data: chartData,
    };
  }

  const strategyResult = runAlgorithmicStrategy(strategyName, context);
  if (!strategyResult) {
    return { error: `Strategy '${strategyName}' is not implemented in the engine.`, ...quality };
  }

  return {
    ...strategyResult,
    market_snapshot: {
      as_of: context.asOf,
      daily_bars: bars.length,
      atr14: Number(context.atr14?.toFixed(2)),
      relative_volume_20d: Number(context.volumeRatio?.toFixed(2)),
      relative_strength_vs_spy_20d: context.relativeStrength20 === null ? null : Number(context.relativeStrength20.toFixed(2)),
      ...marketQuality,
    },
    ...quality,
    timestamp: new Date().toISOString(),
    chart_data: chartData,
  };
}

const runAlgorithmicStrategyTool: ToolDefinition = {
  name: "run_algorithmic_strategy",
  description: "Execute a specific deterministic quantitative strategy. Returns trade signal, confidence score, and detailed technical reasoning. Use this when a specific strategy mode is selected.",
  parameters: [
    {
      name: "stock_code",
      type: "string",
      description: "Stock ticker symbol",
    },
    {
      name: "strategy_name",
      type: "string",
      description: "Name of the quantitative strategy to execute. Use 'all' to execute all available strategies at once.",
      enum: [
        "all", "bull_trend", "ma_golden_cross", "shrink_pullback",
        "box_oscillation", "volume_breakout", "dragon_head",
        "emotion_cycle", "chan_theory", "wave_theory",
        "one_yang_three_yin", "bottom_volume"
      ],
    }
  ],
  handler: handleRunAlgorithmicStrategy,
  category: "analysis",
};

// ── Tool 3: save_user_memory (Phase 1 — Persistent Memory) ──────────

async function handleSaveUserMemory(args: Record<string, any>): Promise<Record<string, any>> {
  const fact = (args.fact as string || "").trim();
  if (!fact) return { error: "No fact provided" };

  console.log(`[Tool:save_user_memory] Saving: "${fact}"`);
  return {
    status: "saved",
    fact,
    message: "Memory saved successfully. This fact will be remembered across sessions.",
  };
}

const saveUserMemoryTool: ToolDefinition = {
  name: "save_user_memory",
  description: "Save an important fact about the user for future reference. Use this when the user reveals a preference, favorite stock, risk tolerance, trading style, or any personal detail worth remembering. Examples: 'User prefers tech stocks', 'User has high risk tolerance', 'User's favorite stock is PLTR'.",
  parameters: [
    {
      name: "fact",
      type: "string",
      description: "A concise fact about the user to remember, e.g. 'Prefers tech stocks' or 'Risk tolerance: high'",
    },
  ],
  handler: handleSaveUserMemory,
  category: "analysis",
};

// ── Tool 4: read_financial_theory (Phase 2 — On-Demand Skill Loading) ──

import { BUILTIN_STRATEGIES } from "../strategies";

async function handleReadFinancialTheory(args: Record<string, any>): Promise<Record<string, any>> {
  const strategyName = (args.strategy_name as string || "").trim();
  if (!strategyName) return { error: "No strategy_name provided" };

  const spec = BUILTIN_STRATEGIES[strategyName];
  if (!spec) {
    const available = Object.keys(BUILTIN_STRATEGIES).join(", ");
    return { error: `Strategy '${strategyName}' not found. Available: ${available}` };
  }

  const researchStatus = (() => {
    if (isQuantStrategyId(strategyName)) {
      const policy = getStrategyResearchPolicy(strategyName);
      return {
        ...policy,
        institutional_gate: policy.classification === "DISCRETIONARY_FRAMEWORK" ? "NOT_ELIGIBLE" : "NOT_EVALUATED",
      };
    }
    return {
      classification: "ANALYSIS_FRAMEWORK",
      liveTradingEligible: false,
      institutional_gate: "NOT_APPLICABLE",
      rationale: "financial_expert is a fundamental/options analysis framework, not a quantitative trading strategy.",
    };
  })();

  console.log(`[Tool:read_financial_theory] Loading theory for: ${strategyName}`);
  return {
    strategy_name: spec.name,
    display_name: spec.display_name,
    category: spec.category,
    description: spec.description,
    methodology: spec.instructions,
    required_tools: spec.required_tools,
    research_status: researchStatus,
  };
}

const readFinancialTheoryTool: ToolDefinition = {
  name: "read_financial_theory",
  description: "Load a strategy methodology and its research-only status. A theory is not validated alpha: only a future declared-data walk-forward PASS can support an institutional research claim. Available strategies: bull_trend, ma_golden_cross, shrink_pullback, box_oscillation, volume_breakout, dragon_head, emotion_cycle, chan_theory, wave_theory, one_yang_three_yin, bottom_volume, financial_expert.",
  parameters: [
    {
      name: "strategy_name",
      type: "string",
      description: "Name of the strategy to load theory for.",
      enum: [
        "bull_trend", "ma_golden_cross", "shrink_pullback",
        "box_oscillation", "volume_breakout", "dragon_head",
        "emotion_cycle", "chan_theory", "wave_theory",
        "one_yang_three_yin", "bottom_volume", "financial_expert"
      ],
    },
  ],
  handler: handleReadFinancialTheory,
  category: "analysis",
};

// ── Tool 5: delegate_task (Phase 3 — Subagent Swarm) ──────────────

async function handleDelegateTask(args: Record<string, any>): Promise<Record<string, any>> {
  const role = (args.role as string || "").trim();
  const taskDescription = (args.task_description as string || "").trim();

  if (!role) return { error: "No role provided" };
  if (!taskDescription) return { error: "No task_description provided" };

  const validRoles = ["Fundamental Analyst", "Technical Analyst", "News Sentiment Analyst"];
  if (!validRoles.includes(role)) {
    return { error: `Invalid role '${role}'. Must be one of: ${validRoles.join(", ")}` };
  }

  console.log(`[Tool:delegate_task] Delegating to SubAgent [${role}]: "${taskDescription.slice(0, 80)}..."`);

  // The actual subagent execution is handled by the executor via a special callback.
  // This tool acts as a "request" that the executor intercepts.
  return {
    _delegate: true,
    role,
    task_description: taskDescription,
  };
}

const delegateTaskTool: ToolDefinition = {
  name: "delegate_task",
  description: "Delegate a sub-task to a specialist sub-agent. The sub-agent will independently use tools and return a complete analysis report. Use this for complex analyses that benefit from specialization — e.g., one agent for fundamentals, another for technicals. Valid roles: 'Fundamental Analyst', 'Technical Analyst', 'News Sentiment Analyst'.",
  parameters: [
    {
      name: "role",
      type: "string",
      description: "The specialist role for the sub-agent.",
      enum: ["Fundamental Analyst", "Technical Analyst", "News Sentiment Analyst"],
    },
    {
      name: "task_description",
      type: "string",
      description: "A clear description of what the sub-agent should analyze, including the target stock ticker if applicable.",
    },
  ],
  handler: handleDelegateTask,
  category: "analysis",
};

export const ALL_ANALYSIS_TOOLS: ToolDefinition[] = [
  analyzeTrendTool,
  runAlgorithmicStrategyTool,
  saveUserMemoryTool,
  readFinancialTheoryTool,
  delegateTaskTool,
];
