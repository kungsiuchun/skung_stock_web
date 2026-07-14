import {
  QUANT_STRATEGY_IDS,
  getStrategyResearchPolicy,
  type QuantStrategyId,
  type StrategyResearchPolicy,
} from "./research-policy";

export interface ResearchBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BacktestConfig {
  annualization: number;
  warmupBars: number;
  commissionBps: number;
  spreadBps: number;
  slippageBps: number;
}

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  annualization: 252,
  warmupBars: 65,
  commissionBps: 1,
  spreadBps: 1,
  slippageBps: 5,
};

export const INSTITUTIONAL_RESEARCH_GATE = {
  minTestObservations: 126,
  minCompletedTrades: 8,
  minSharpe: 0.5,
  maxDrawdown: 0.2,
  minExcessCagr: 0,
  maxAnnualizedTurnover: 24,
} as const;

export type MarketRegime = "BULL" | "BEAR" | "SIDEWAYS" | "UNCLASSIFIED";
export type Position = 0 | 1;

export interface StrategySignal {
  position: Position;
  reason: string;
}

export interface BacktestRecord {
  date: string;
  netReturn: number;
  benchmarkReturn: number;
  position: number;
  turnover: number;
  regime: MarketRegime;
}

export interface WorstRegimeResult {
  regime: MarketRegime;
  observations: number;
  averageDailyReturn: number;
  annualizedReturn: number;
}

export interface QuantPerformanceMetrics {
  observations: number;
  totalReturn: number;
  cagr: number | null;
  annualizedVolatility: number | null;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdown: number;
  calmar: number | null;
  winRate: number | null;
  profitFactor: number | null;
  annualizedTurnover: number;
  averageExposure: number;
  averageHoldingDays: number | null;
  completedTrades: number;
  benchmarkCagr: number | null;
  excessCagr: number | null;
  worstRegime: WorstRegimeResult | null;
}

export interface StrategyBacktestReport {
  strategyId: QuantStrategyId;
  policy: StrategyResearchPolicy;
  dataRange: { start: string; end: string; observations: number };
  execution: "signal_at_close_execute_next_open";
  config: BacktestConfig;
  metrics: QuantPerformanceMetrics;
  costSensitivity: {
    halfCostCagr: number | null;
    baseCostCagr: number | null;
    doubleCostCagr: number | null;
  };
  records: BacktestRecord[];
}

export interface WalkForwardWindow {
  name: "train" | "validation" | "test";
  start: string;
  end: string;
  metrics: QuantPerformanceMetrics;
}

export type InstitutionalGateStatus =
  | "NOT_ELIGIBLE"
  | "INSUFFICIENT_EVIDENCE"
  | "FAIL"
  | "PASS";

export interface InstitutionalGateResult {
  status: InstitutionalGateStatus;
  failures: string[];
}

export interface StrategyWalkForwardReport {
  strategyId: QuantStrategyId;
  parameterSelection: "none_fixed_rules";
  windows: WalkForwardWindow[];
  gate: InstitutionalGateResult;
}

export interface QuantResearchSuite {
  reports: StrategyBacktestReport[];
  walkForward: StrategyWalkForwardReport[];
  correlation: Record<QuantStrategyId, Record<QuantStrategyId, number | null>>;
  candidatePortfolio: QuantPerformanceMetrics;
  candidatePortfolioWalkForward: WalkForwardWindow[];
  candidatePortfolioGate: InstitutionalGateResult;
}

interface CompletedTrade {
  return: number;
  holdingDays: number;
}

interface Simulation {
  records: BacktestRecord[];
  trades: CompletedTrade[];
  metrics: QuantPerformanceMetrics;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function sma(bars: ResearchBar[], period: number): number | null {
  if (bars.length < period) return null;
  return mean(bars.slice(-period).map((bar) => bar.close));
}

function averageVolume(bars: ResearchBar[], period: number): number | null {
  if (bars.length < period) return null;
  return mean(bars.slice(-period).map((bar) => bar.volume));
}

function rsi(bars: ResearchBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;

  let gains = 0;
  let losses = 0;
  const slice = bars.slice(-(period + 1));
  for (let index = 1; index < slice.length; index += 1) {
    const change = slice[index].close - slice[index - 1].close;
    if (change > 0) gains += change;
    else losses -= change;
  }

  if (losses === 0) return 100;
  const relativeStrength = gains / losses;
  return 100 - 100 / (1 + relativeStrength);
}

function isStrongBullTrend(bars: ResearchBar[]): boolean {
  const ma5 = sma(bars, 5);
  const ma10 = sma(bars, 10);
  const ma20 = sma(bars, 20);
  const last = bars.at(-1);
  return Boolean(
    last &&
      ma5 !== null &&
      ma10 !== null &&
      ma20 !== null &&
      last.close > ma5 &&
      ma5 > ma10 &&
      ma10 > ma20,
  );
}

function discretionarySignal(strategyId: QuantStrategyId): StrategySignal {
  const rationale = getStrategyResearchPolicy(strategyId).rationale;
  return { position: 0, reason: `未量化批准：${rationale}` };
}

/**
 * Signal uses only bars known at the close of the last bar in `history`.
 * The backtester executes it at the next session open, so no same-bar close
 * execution or future high/low can leak into the result.
 */
export function deriveStrategySignal(
  strategyId: QuantStrategyId,
  history: ResearchBar[],
): StrategySignal {
  const policy = getStrategyResearchPolicy(strategyId);
  if (policy.classification === "DISCRETIONARY_FRAMEWORK") {
    return discretionarySignal(strategyId);
  }

  const last = history.at(-1);
  if (!last) return { position: 0, reason: "資料不足" };

  switch (strategyId) {
    case "bull_trend": {
      const lastRsi = rsi(history);
      if (isStrongBullTrend(history) && lastRsi !== null && lastRsi < 70) {
        return { position: 1, reason: "MA5 > MA10 > MA20、價格在 MA5 上且 RSI 未超買" };
      }
      return { position: 0, reason: "未符合多頭趨勢及 RSI 閘門" };
    }
    case "ma_golden_cross": {
      const previous = history.slice(0, -1);
      const previousMa5 = sma(previous, 5);
      const previousMa10 = sma(previous, 10);
      const currentMa5 = sma(history, 5);
      const currentMa10 = sma(history, 10);
      const currentMa20 = sma(history, 20);
      if (
        previousMa5 !== null &&
        previousMa10 !== null &&
        currentMa5 !== null &&
        currentMa10 !== null &&
        currentMa20 !== null &&
        previousMa5 <= previousMa10 &&
        currentMa5 > currentMa10 &&
        currentMa10 > currentMa20
      ) {
        return { position: 1, reason: "MA5 上穿 MA10，且 MA10 > MA20" };
      }
      return { position: 0, reason: "未發生合格的黃金交叉" };
    }
    case "shrink_pullback": {
      const ma20 = sma(history, 20);
      const priorVolume = averageVolume(history.slice(0, -1), 20);
      if (
        ma20 !== null &&
        priorVolume !== null &&
        isStrongBullTrend(history) &&
        last.close >= ma20 &&
        last.close <= ma20 * 1.015 &&
        last.volume <= priorVolume * 0.8
      ) {
        return { position: 1, reason: "多頭趨勢中回踩 MA20，且當日量低於前 20 日均量 80%" };
      }
      return { position: 0, reason: "未符合縮量回踩條件" };
    }
    case "box_oscillation": {
      const rangeBars = history.slice(-40);
      const ma10 = sma(history, 10);
      const ma20 = sma(history, 20);
      if (rangeBars.length < 40 || ma10 === null || ma20 === null) {
        return { position: 0, reason: "箱體所需歷史不足" };
      }
      const high = Math.max(...rangeBars.map((bar) => bar.high));
      const low = Math.min(...rangeBars.map((bar) => bar.low));
      const width = (high - low) / low;
      const nearBottom = last.close <= low + (high - low) * 0.25;
      const nonTrending = Math.abs(ma10 / ma20 - 1) <= 0.03;
      if (width >= 0.08 && nearBottom && nonTrending) {
        return { position: 1, reason: "40 日有效箱體下緣，且 MA10/MA20 顯示非趨勢狀態" };
      }
      return { position: 0, reason: "未符合寬箱體、下緣及非趨勢條件" };
    }
    case "volume_breakout": {
      const priorBars = history.slice(-21, -1);
      const priorVolume = averageVolume(history.slice(0, -1), 20);
      if (priorBars.length < 20 || priorVolume === null) {
        return { position: 0, reason: "突破所需歷史不足" };
      }
      const priorHigh = Math.max(...priorBars.map((bar) => bar.high));
      if (last.close > priorHigh && last.volume >= priorVolume * 1.5) {
        return { position: 1, reason: "收市突破前 20 日高位，且成交量至少 1.5 倍均量" };
      }
      return { position: 0, reason: "未符合價格突破及放量條件" };
    }
    case "one_yang_three_yin": {
      const candles = history.slice(-5);
      const priorVolume = averageVolume(history.slice(0, -1), 20);
      if (candles.length < 5 || priorVolume === null) {
        return { position: 0, reason: "形態所需歷史不足" };
      }
      const [first, pullbackOne, pullbackTwo, pullbackThree, breakout] = candles;
      const firstYang = first.close >= first.open * 1.015;
      const threeYin = [pullbackOne, pullbackTwo, pullbackThree].every(
        (bar) => bar.close < bar.open && bar.volume <= first.volume,
      );
      const containedPullback = [pullbackOne, pullbackTwo, pullbackThree].every(
        (bar) => bar.low >= first.open,
      );
      const confirmedBreakout =
        breakout.close > first.high && breakout.volume >= priorVolume;
      if (isStrongBullTrend(history) && firstYang && threeYin && containedPullback && confirmedBreakout) {
        return { position: 1, reason: "定義化的一陽三陰整理後，收市放量突破首根陽線高位" };
      }
      return { position: 0, reason: "未符合已定義的一陽三陰突破條件" };
    }
    case "bottom_volume": {
      const priorBars = history.slice(-61, -1);
      const priorVolume = averageVolume(history.slice(0, -1), 20);
      if (priorBars.length < 60 || priorVolume === null) {
        return { position: 0, reason: "底部放量所需歷史不足" };
      }
      const priorHigh = Math.max(...priorBars.map((bar) => bar.high));
      const priorClose = priorBars.at(-1)?.close;
      const drawnDown = last.close <= priorHigh * 0.8;
      const reversalDay = last.close > last.open && priorClose !== undefined && last.close > priorClose;
      if (drawnDown && reversalDay && last.volume >= priorVolume * 2.5) {
        return { position: 1, reason: "60 日高位回撤至少 20%、收陽反轉且量能至少 2.5 倍均量" };
      }
      return { position: 0, reason: "未符合底部放量反轉條件" };
    }
    case "dragon_head":
    case "emotion_cycle":
    case "chan_theory":
    case "wave_theory":
      return discretionarySignal(strategyId);
  }
}

export function assertResearchBars(bars: ResearchBar[]): void {
  if (bars.length < 3) {
    throw new Error("Quant research requires at least three OHLCV bars.");
  }

  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const bar of bars) {
    const timestamp = Date.parse(bar.date);
    if (!Number.isFinite(timestamp) || timestamp <= previousTimestamp) {
      throw new Error("Research bars must have unique, strictly ascending ISO dates.");
    }
    previousTimestamp = timestamp;

    for (const value of [bar.open, bar.high, bar.low, bar.close, bar.volume]) {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid OHLCV value on ${bar.date}.`);
      }
    }
    if (bar.open === 0 || bar.high === 0 || bar.low === 0 || bar.close === 0 || bar.high < bar.low) {
      throw new Error(`Invalid OHLC range on ${bar.date}.`);
    }
  }
}

function resolveConfig(overrides: Partial<BacktestConfig>): BacktestConfig {
  const config = { ...DEFAULT_BACKTEST_CONFIG, ...overrides };
  for (const value of [
    config.annualization,
    config.warmupBars,
    config.commissionBps,
    config.spreadBps,
    config.slippageBps,
  ]) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("Backtest configuration must contain finite, non-negative values.");
    }
  }
  if (config.annualization === 0 || !Number.isInteger(config.warmupBars)) {
    throw new Error("annualization must be positive and warmupBars must be an integer.");
  }
  return config;
}

function classifyRegime(history: ResearchBar[]): MarketRegime {
  const ma20 = sma(history, 20);
  const ma60 = sma(history, 60);
  const last = history.at(-1);
  if (ma20 === null || ma60 === null || !last) return "UNCLASSIFIED";
  if (last.close > ma60 && ma20 > ma60) return "BULL";
  if (last.close < ma60 && ma20 < ma60) return "BEAR";
  return "SIDEWAYS";
}

function cagr(totalReturn: number, observations: number, annualization: number): number | null {
  if (observations === 0 || totalReturn <= -1) return null;
  return (1 + totalReturn) ** (annualization / observations) - 1;
}

function calculateMetrics(
  records: BacktestRecord[],
  trades: CompletedTrade[],
  annualization: number,
): QuantPerformanceMetrics {
  const returns = records.map((record) => record.netReturn);
  const benchmarkReturns = records.map((record) => record.benchmarkReturn);
  const observations = returns.length;
  const totalReturn = returns.reduce((equity, value) => equity * (1 + value), 1) - 1;
  const benchmarkReturn = benchmarkReturns.reduce((equity, value) => equity * (1 + value), 1) - 1;
  const averageReturn = mean(returns);
  const volatility = standardDeviation(returns);
  const downside = standardDeviation(returns.filter((value) => value < 0));
  const annualizedVolatility = observations > 1 ? volatility * Math.sqrt(annualization) : null;
  const sharpe = volatility > 0 ? (averageReturn / volatility) * Math.sqrt(annualization) : null;
  const sortino = downside > 0 ? (averageReturn / downside) * Math.sqrt(annualization) : null;

  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const value of returns) {
    equity *= 1 + value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
  }

  const cagrValue = cagr(totalReturn, observations, annualization);
  const benchmarkCagr = cagr(benchmarkReturn, observations, annualization);
  const gains = trades.filter((trade) => trade.return > 0).reduce((sum, trade) => sum + trade.return, 0);
  const losses = trades.filter((trade) => trade.return < 0).reduce((sum, trade) => sum + Math.abs(trade.return), 0);
  const byRegime = new Map<MarketRegime, number[]>();
  for (const record of records) {
    const values = byRegime.get(record.regime) ?? [];
    values.push(record.netReturn);
    byRegime.set(record.regime, values);
  }
  const worstRegime = [...byRegime.entries()]
    .map(([regime, values]): WorstRegimeResult => {
      const regimeAverage = mean(values);
      return {
        regime,
        observations: values.length,
        averageDailyReturn: regimeAverage,
        annualizedReturn: (1 + regimeAverage) ** annualization - 1,
      };
    })
    .sort((left, right) => left.averageDailyReturn - right.averageDailyReturn)[0] ?? null;

  return {
    observations,
    totalReturn,
    cagr: cagrValue,
    annualizedVolatility,
    sharpe,
    sortino,
    maxDrawdown,
    calmar: cagrValue !== null && maxDrawdown > 0 ? cagrValue / maxDrawdown : null,
    winRate: trades.length > 0 ? trades.filter((trade) => trade.return > 0).length / trades.length : null,
    profitFactor: trades.length > 0 && losses > 0 ? gains / losses : null,
    annualizedTurnover: observations > 0 ? mean(records.map((record) => record.turnover)) * annualization : 0,
    averageExposure: mean(records.map((record) => record.position)),
    averageHoldingDays: trades.length > 0 ? mean(trades.map((trade) => trade.holdingDays)) : null,
    completedTrades: trades.length,
    benchmarkCagr,
    excessCagr: cagrValue !== null && benchmarkCagr !== null ? cagrValue - benchmarkCagr : null,
    worstRegime,
  };
}

function simulateStrategy(
  strategyId: QuantStrategyId,
  bars: ResearchBar[],
  config: BacktestConfig,
  startExecutionIndex: number,
  endExecutionIndex: number,
): Simulation {
  const executionCost = (config.commissionBps + config.spreadBps + config.slippageBps) / 10_000;
  const start = Math.max(config.warmupBars + 1, startExecutionIndex);
  const end = Math.min(endExecutionIndex, bars.length - 1);
  const records: BacktestRecord[] = [];
  const trades: CompletedTrade[] = [];
  let position: Position = 0;
  let activeTrade: { compoundedReturn: number; holdingDays: number } | null = null;

  for (let executionIndex = start; executionIndex < end; executionIndex += 1) {
    const history = bars.slice(0, executionIndex);
    const signal = deriveStrategySignal(strategyId, history);
    const target = signal.position;
    const turnover = Math.abs(target - position);
    const cost = turnover * executionCost;
    const openToOpenReturn = bars[executionIndex + 1].open / bars[executionIndex].open - 1;
    const netReturn = target * openToOpenReturn - cost;

    if (position === 0 && target === 1) {
      activeTrade = { compoundedReturn: 1, holdingDays: 0 };
    }
    if (activeTrade) {
      activeTrade.compoundedReturn *= 1 + netReturn;
      if (target === 1) activeTrade.holdingDays += 1;
      if (position === 1 && target === 0) {
        trades.push({
          return: activeTrade.compoundedReturn - 1,
          holdingDays: activeTrade.holdingDays,
        });
        activeTrade = null;
      }
    }

    records.push({
      date: bars[executionIndex + 1].date,
      netReturn,
      benchmarkReturn: openToOpenReturn,
      position: target,
      turnover,
      regime: classifyRegime(history),
    });
    position = target;
  }

  // Liquidate the final simulated position at the last observed open. This is
  // explicit in the report rather than silently leaving terminal costs out.
  if (position === 1 && activeTrade) {
    activeTrade.compoundedReturn *= 1 - executionCost;
    trades.push({
      return: activeTrade.compoundedReturn - 1,
      holdingDays: activeTrade.holdingDays,
    });
    records.push({
      date: `${bars.at(-1)?.date ?? "unknown"}:liquidation`,
      netReturn: -executionCost,
      benchmarkReturn: 0,
      position: 0,
      turnover: 1,
      regime: classifyRegime(bars.slice(0, -1)),
    });
  }

  return { records, trades, metrics: calculateMetrics(records, trades, config.annualization) };
}

export function runStrategyBacktest(
  strategyId: QuantStrategyId,
  bars: ResearchBar[],
  overrides: Partial<BacktestConfig> = {},
): StrategyBacktestReport {
  assertResearchBars(bars);
  const config = resolveConfig(overrides);
  if (bars.length < config.warmupBars + 3) {
    throw new Error(`Backtest requires at least ${config.warmupBars + 3} bars for this configuration.`);
  }

  const base = simulateStrategy(strategyId, bars, config, config.warmupBars + 1, bars.length - 1);
  const halfCost = simulateStrategy(
    strategyId,
    bars,
    { ...config, commissionBps: config.commissionBps / 2, spreadBps: config.spreadBps / 2, slippageBps: config.slippageBps / 2 },
    config.warmupBars + 1,
    bars.length - 1,
  );
  const doubleCost = simulateStrategy(
    strategyId,
    bars,
    { ...config, commissionBps: config.commissionBps * 2, spreadBps: config.spreadBps * 2, slippageBps: config.slippageBps * 2 },
    config.warmupBars + 1,
    bars.length - 1,
  );

  return {
    strategyId,
    policy: getStrategyResearchPolicy(strategyId),
    dataRange: { start: bars[0].date, end: bars.at(-1)?.date ?? bars[0].date, observations: bars.length },
    execution: "signal_at_close_execute_next_open",
    config,
    metrics: base.metrics,
    costSensitivity: {
      halfCostCagr: halfCost.metrics.cagr,
      baseCostCagr: base.metrics.cagr,
      doubleCostCagr: doubleCost.metrics.cagr,
    },
    records: base.records,
  };
}

export function runStrategyWalkForward(
  strategyId: QuantStrategyId,
  bars: ResearchBar[],
  overrides: Partial<BacktestConfig> = {},
): StrategyWalkForwardReport {
  assertResearchBars(bars);
  const config = resolveConfig(overrides);
  if (bars.length < config.warmupBars + INSTITUTIONAL_RESEARCH_GATE.minTestObservations * 4) {
    throw new Error("Walk-forward research needs enough bars for warmup, training, validation, and test windows.");
  }

  const trainEnd = Math.floor(bars.length * 0.5);
  const validationEnd = Math.floor(bars.length * 0.75);
  const ranges: Array<{ name: WalkForwardWindow["name"]; start: number; end: number }> = [
    { name: "train", start: config.warmupBars + 1, end: trainEnd },
    { name: "validation", start: trainEnd, end: validationEnd },
    { name: "test", start: validationEnd, end: bars.length - 1 },
  ];
  const windows = ranges.map(({ name, start, end }): WalkForwardWindow => {
    const simulation = simulateStrategy(strategyId, bars, config, start, end);
    const firstRecord = simulation.records[0];
    const lastRecord = simulation.records.at(-1);
    if (!firstRecord || !lastRecord) {
      throw new Error(`Walk-forward ${name} window produced no observations.`);
    }
    return { name, start: firstRecord.date, end: lastRecord.date, metrics: simulation.metrics };
  });

  return {
    strategyId,
    parameterSelection: "none_fixed_rules",
    windows,
    gate: evaluateInstitutionalResearchGate(strategyId, windows.find((window) => window.name === "test")?.metrics),
  };
}

export function evaluateInstitutionalResearchGate(
  strategyId: QuantStrategyId,
  testMetrics: QuantPerformanceMetrics | undefined,
): InstitutionalGateResult {
  const policy = getStrategyResearchPolicy(strategyId);
  if (policy.classification !== "RESEARCH_CANDIDATE") {
    return { status: "NOT_ELIGIBLE", failures: [policy.rationale] };
  }
  if (!testMetrics || testMetrics.observations < INSTITUTIONAL_RESEARCH_GATE.minTestObservations) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      failures: [`樣本外 observations 少於 ${INSTITUTIONAL_RESEARCH_GATE.minTestObservations}。`],
    };
  }

  return evaluatePerformanceGate(testMetrics);
}

function evaluatePerformanceGate(testMetrics: QuantPerformanceMetrics): InstitutionalGateResult {
  const failures: string[] = [];
  if (testMetrics.completedTrades < INSTITUTIONAL_RESEARCH_GATE.minCompletedTrades) {
    failures.push(`完成交易少於 ${INSTITUTIONAL_RESEARCH_GATE.minCompletedTrades} 筆。`);
  }
  if (testMetrics.sharpe === null || testMetrics.sharpe < INSTITUTIONAL_RESEARCH_GATE.minSharpe) {
    failures.push(`樣本外 Sharpe 未達 ${INSTITUTIONAL_RESEARCH_GATE.minSharpe}。`);
  }
  if (testMetrics.maxDrawdown > INSTITUTIONAL_RESEARCH_GATE.maxDrawdown) {
    failures.push(`最大回撤超過 ${(INSTITUTIONAL_RESEARCH_GATE.maxDrawdown * 100).toFixed(0)}%。`);
  }
  if (testMetrics.excessCagr === null || testMetrics.excessCagr < INSTITUTIONAL_RESEARCH_GATE.minExcessCagr) {
    failures.push("成本後 CAGR 未超越買入持有基準。");
  }
  if (testMetrics.annualizedTurnover > INSTITUTIONAL_RESEARCH_GATE.maxAnnualizedTurnover) {
    failures.push(`年化 turnover 超過 ${INSTITUTIONAL_RESEARCH_GATE.maxAnnualizedTurnover}。`);
  }
  return failures.length === 0 ? { status: "PASS", failures: [] } : { status: "FAIL", failures };
}

function correlation(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < 2) return null;
  const leftDeviation = standardDeviation(left);
  const rightDeviation = standardDeviation(right);
  if (leftDeviation === 0 || rightDeviation === 0) return null;
  const leftAverage = mean(left);
  const rightAverage = mean(right);
  const covariance =
    left.reduce((sum, value, index) => sum + (value - leftAverage) * (right[index] - rightAverage), 0) /
    (left.length - 1);
  return covariance / (leftDeviation * rightDeviation);
}

function alignedReturns(
  left: BacktestRecord[],
  right: BacktestRecord[],
): { left: number[]; right: number[] } {
  const rightByDate = new Map(right.map((record) => [record.date, record.netReturn]));
  const leftReturns: number[] = [];
  const rightReturns: number[] = [];
  for (const record of left) {
    const matchingReturn = rightByDate.get(record.date);
    if (matchingReturn !== undefined) {
      leftReturns.push(record.netReturn);
      rightReturns.push(matchingReturn);
    }
  }
  return { left: leftReturns, right: rightReturns };
}

function buildCandidatePortfolioRecords(reports: StrategyBacktestReport[]): BacktestRecord[] {
  const candidateReports = reports.filter(
    (report) => report.policy.classification === "RESEARCH_CANDIDATE",
  );
  if (candidateReports.length === 0) return [];

  const recordMaps = candidateReports.map(
    (report) => new Map(report.records.map((record) => [record.date, record])),
  );
  return candidateReports[0].records
    .filter((record) => recordMaps.every((recordMap) => recordMap.has(record.date)))
    .map((record): BacktestRecord => {
      const alignedRecords = recordMaps.map((recordMap) => recordMap.get(record.date) as BacktestRecord);
      return {
        date: record.date,
        netReturn: mean(alignedRecords.map((candidate) => candidate.netReturn)),
        benchmarkReturn: record.benchmarkReturn,
        position: mean(alignedRecords.map((candidate) => candidate.position)),
        turnover: mean(alignedRecords.map((candidate) => candidate.turnover)),
        regime: record.regime,
      };
    });
}

function deriveExposureTrades(records: BacktestRecord[]): CompletedTrade[] {
  const trades: CompletedTrade[] = [];
  let active: { compoundedReturn: number; holdingDays: number } | null = null;
  for (const record of records) {
    const isInvested = record.position > 0;
    if (isInvested && !active) {
      active = { compoundedReturn: 1, holdingDays: 0 };
    }
    if (active) {
      active.compoundedReturn *= 1 + record.netReturn;
      if (isInvested) active.holdingDays += 1;
      if (!isInvested) {
        trades.push({ return: active.compoundedReturn - 1, holdingDays: active.holdingDays });
        active = null;
      }
    }
  }
  if (active) {
    trades.push({ return: active.compoundedReturn - 1, holdingDays: active.holdingDays });
  }
  return trades;
}

function buildPortfolioWalkForward(
  records: BacktestRecord[],
  bars: ResearchBar[],
  annualization: number,
): WalkForwardWindow[] {
  const validationStart = bars[Math.floor(bars.length * 0.5) + 1]?.date;
  const testStart = bars[Math.floor(bars.length * 0.75) + 1]?.date;
  if (!validationStart || !testStart) {
    throw new Error("Portfolio walk-forward cannot derive chronological boundaries.");
  }

  const slices: Array<{ name: WalkForwardWindow["name"]; records: BacktestRecord[] }> = [
    { name: "train", records: records.filter((record) => record.date < validationStart) },
    { name: "validation", records: records.filter((record) => record.date >= validationStart && record.date < testStart) },
    { name: "test", records: records.filter((record) => record.date >= testStart) },
  ];
  return slices.map(({ name, records: windowRecords }): WalkForwardWindow => {
    const first = windowRecords[0];
    const last = windowRecords.at(-1);
    if (!first || !last) {
      throw new Error(`Candidate portfolio ${name} window produced no observations.`);
    }
    return {
      name,
      start: first.date,
      end: last.date,
      metrics: calculateMetrics(windowRecords, deriveExposureTrades(windowRecords), annualization),
    };
  });
}

export function runQuantResearchSuite(
  bars: ResearchBar[],
  overrides: Partial<BacktestConfig> = {},
): QuantResearchSuite {
  const reports = QUANT_STRATEGY_IDS.map((strategyId) => runStrategyBacktest(strategyId, bars, overrides));
  const walkForward = QUANT_STRATEGY_IDS.map((strategyId) => runStrategyWalkForward(strategyId, bars, overrides));
  const correlationMatrix = {} as Record<QuantStrategyId, Record<QuantStrategyId, number | null>>;
  for (const left of QUANT_STRATEGY_IDS) {
    correlationMatrix[left] = {} as Record<QuantStrategyId, number | null>;
    const leftRecords = reports.find((report) => report.strategyId === left)?.records ?? [];
    for (const right of QUANT_STRATEGY_IDS) {
      const rightRecords = reports.find((report) => report.strategyId === right)?.records ?? [];
      const aligned = alignedReturns(leftRecords, rightRecords);
      correlationMatrix[left][right] = correlation(aligned.left, aligned.right);
    }
  }

  const annualization = resolveConfig(overrides).annualization;
  const candidateRecords = buildCandidatePortfolioRecords(reports);
  const candidatePortfolioWalkForward = buildPortfolioWalkForward(candidateRecords, bars, annualization);
  const candidatePortfolioTest = candidatePortfolioWalkForward.find((window) => window.name === "test")?.metrics;

  return {
    reports,
    walkForward,
    correlation: correlationMatrix,
    candidatePortfolio: calculateMetrics(candidateRecords, deriveExposureTrades(candidateRecords), annualization),
    candidatePortfolioWalkForward,
    candidatePortfolioGate: candidatePortfolioTest
      ? evaluatePerformanceGate(candidatePortfolioTest)
      : { status: "INSUFFICIENT_EVIDENCE", failures: ["缺少 portfolio 測試期資料。"] },
  };
}
