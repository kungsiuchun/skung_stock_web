/**
 * Agent Framework — Analysis Tools
 * Mirrors the Python blueprint's analysis_tools.py.
 *
 * Tools:
 *   1. analyze_trend — Comprehensive trend analysis (MA alignment, MACD, RSI approx)
 */

import type { ToolDefinition } from "../types";
import { runAlgorithmicStrategy, StrategyContext, BuySignal } from "../strategies/engine";
import { TechnicalIndicators } from "../strategies/indicators";

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
  const result = data.chart?.result?.[0];
  if (!result) return { error: `No data for ${symbol}` };

  const quote = result.indicators?.quote?.[0] || {};
  const validIndices: number[] = [];
  const closes: number[] = [];
  (quote.close || []).forEach((c: any, idx: number) => {
    if (c !== null) {
      closes.push(c);
      validIndices.push(idx);
    }
  });
  const opens: number[] = validIndices.map(i => quote.open[i] || closes[validIndices.indexOf(i)]);
  const highs: number[] = validIndices.map(i => quote.high[i] || closes[validIndices.indexOf(i)]);
  const lows: number[] = validIndices.map(i => quote.low[i] || closes[validIndices.indexOf(i)]);
  const volumes: number[] = validIndices.map(i => quote.volume[i] || 0);

  if (closes.length < 30) return { error: "Insufficient data for trend analysis (need at least 30 days)" };

  // --- 1. MA Alignment (5, 10, 20) ---
  function getMA(period: number) {
    if (closes.length < period) return null;
    const slice = closes.slice(closes.length - period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  // --- 1.5 Volume Analysis (Current vs 30d Avg) ---
  const currentVolume = volumes[volumes.length - 1] || 0;
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
    chart_data: closes.slice(-30).map((c, i) => {
      const vIndex = validIndices[validIndices.length - closes.slice(-30).length + i];
      const ts = result.timestamp?.[vIndex] || 0;
      return {
        date: new Date(ts * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' }),
        price: Number(c.toFixed(2)),
        volume: Number(quote.volume?.[vIndex] || 0)
      };
    })
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

  // 1. Fetch data (Reusing logic from analyze_trend but encapsulated)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=60d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) return { error: `Yahoo Finance API returned ${res.status}` };

  const data = await res.json();
  const result = data.chart?.result?.[0];
  if (!result) return { error: `No data for ${symbol}` };

  const quote = result.indicators?.quote?.[0] || {};
  const validIndices: number[] = [];
  const closes: number[] = [];
  (quote.close || []).forEach((c: any, idx: number) => {
    if (c !== null) {
      closes.push(c);
      validIndices.push(idx);
    }
  });
  const opens: number[] = validIndices.map(i => quote.open[i] || closes[validIndices.indexOf(i)]);
  const highs: number[] = validIndices.map(i => quote.high[i] || closes[validIndices.indexOf(i)]);
  const lows: number[] = validIndices.map(i => quote.low[i] || closes[validIndices.indexOf(i)]);
  const volumes: number[] = validIndices.map(i => quote.volume[i] || 0);
  
  if (closes.length < 30) {
    return { error: "Insufficient data for algorithmic strategy (need at least 30 days)" };
  }

  // 2. Calculate Indicators using helper
  const currentPrice = closes[closes.length - 1];
  const high60d = Math.max(...closes);
  const low60d = Math.min(...closes);

  const ma5 = TechnicalIndicators.SMA(closes, 5);
  const ma10 = TechnicalIndicators.SMA(closes, 10);
  const ma20 = TechnicalIndicators.SMA(closes, 20);
  const rsi14 = TechnicalIndicators.RSI(closes, 14);

  // Volume Ratio
  const currentVolume = volumes[volumes.length - 1] || 0;
  const avgVol30 = volumes.slice(Math.max(0, volumes.length - 31), volumes.length - 1).reduce((a, b) => a + b, 0) / 30;
  const volumeRatio = currentVolume / (avgVol30 || 1);

  // MA Alignment string for engine
  let maAlignment = "Mixed";
  if (ma5 && ma10 && ma20) {
    if (currentPrice > ma5 && ma5 > ma10 && ma10 > ma20) maAlignment = "Strong Bullish";
    else if (currentPrice < ma5 && ma5 < ma10 && ma10 < ma20) maAlignment = "Strong Bearish";
  }

  // 3. Prepare Context & Run Strategy
  const context: StrategyContext = {
    symbol,
    currentPrice,
    ma5,
    ma10,
    ma20,
    rsi14,
    maAlignment,
    currentVolume,
    averageVolume30d: avgVol30,
    volumeRatio,
    high60d,
    low60d,
    ohlc: {
      open: opens,
      high: highs,
      low: lows,
      close: closes,
      volume: volumes
    }
  };

  if (strategyName === "all") {
    const allStrategies = [
      "bull_trend", "ma_golden_cross", "shrink_pullback",
      "box_oscillation", "volume_breakout", "dragon_head",
      "emotion_cycle", "chan_theory", "wave_theory",
      "one_yang_three_yin", "bottom_volume"
    ];
    
    // Sort highest score first, filtering out errors if any
    const results = allStrategies
      .map(name => runAlgorithmicStrategy(name, context))
      .filter(r => r !== null)
      .sort((a, b) => (b as any).score - (a as any).score);

    return {
      symbol,
      strategies_evaluated: results.length,
      signals: results,
      timestamp: new Date().toISOString(),
      chart_data: closes.slice(-30).map((c, i) => {
        const vIndex = validIndices[validIndices.length - closes.slice(-30).length + i];
        const ts = result.timestamp?.[vIndex] || 0;
        const d = new Date(ts * 1000);
        return {
          date: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
          date_iso: d.toISOString().split('T')[0],
          price: Number(c.toFixed(2)),
          open: Number((quote.open?.[vIndex] || c).toFixed(2)),
          high: Number((quote.high?.[vIndex] || c).toFixed(2)),
          low: Number((quote.low?.[vIndex] || c).toFixed(2)),
          volume: Number(quote.volume?.[vIndex] || 0)
        };
      })
    };
  }

  const strategyResult = runAlgorithmicStrategy(strategyName, context);
  if (!strategyResult) {
    return { error: `Strategy '${strategyName}' is not implemented in the engine.` };
  }

  return {
    ...strategyResult,
    timestamp: new Date().toISOString(),
    chart_data: closes.slice(-30).map((c, i) => {
      const vIndex = validIndices[validIndices.length - closes.slice(-30).length + i];
      const ts = result.timestamp?.[vIndex] || 0;
      const d = new Date(ts * 1000);
      return {
        date: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
        date_iso: d.toISOString().split('T')[0],
        price: Number(c.toFixed(2)),
        open: Number((quote.open?.[vIndex] || c).toFixed(2)),
        high: Number((quote.high?.[vIndex] || c).toFixed(2)),
        low: Number((quote.low?.[vIndex] || c).toFixed(2)),
        volume: Number(quote.volume?.[vIndex] || 0)
      };
    })
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

  console.log(`[Tool:read_financial_theory] Loading theory for: ${strategyName}`);
  return {
    strategy_name: spec.name,
    display_name: spec.display_name,
    category: spec.category,
    description: spec.description,
    methodology: spec.instructions,
    required_tools: spec.required_tools,
  };
}

const readFinancialTheoryTool: ToolDefinition = {
  name: "read_financial_theory",
  description: "Load the detailed methodology and analysis framework for a specific quantitative trading strategy. Call this BEFORE executing run_algorithmic_strategy so you understand the theory behind the strategy. Available strategies: bull_trend, ma_golden_cross, shrink_pullback, box_oscillation, volume_breakout, dragon_head, emotion_cycle, chan_theory, wave_theory, one_yang_three_yin, bottom_volume, financial_expert.",
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
