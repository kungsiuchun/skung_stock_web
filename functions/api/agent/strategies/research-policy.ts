/**
 * Research governance for the built-in strategy catalogue.
 *
 * A deterministic signal is not approval to trade.  Every strategy stays
 * research-only until it passes the walk-forward gate in research.ts on a
 * declared, point-in-time-capable dataset.
 */

export const QUANT_STRATEGY_IDS = [
  "bull_trend",
  "ma_golden_cross",
  "shrink_pullback",
  "box_oscillation",
  "volume_breakout",
  "dragon_head",
  "emotion_cycle",
  "chan_theory",
  "wave_theory",
  "one_yang_three_yin",
  "bottom_volume",
] as const;

export type QuantStrategyId = (typeof QUANT_STRATEGY_IDS)[number];

export type StrategyResearchClassification =
  | "RESEARCH_CANDIDATE"
  | "DISCRETIONARY_FRAMEWORK";

export interface StrategyResearchPolicy {
  classification: StrategyResearchClassification;
  liveTradingEligible: false;
  rationale: string;
}

export const STRATEGY_RESEARCH_POLICIES: Record<
  QuantStrategyId,
  StrategyResearchPolicy
> = {
  bull_trend: {
    classification: "RESEARCH_CANDIDATE",
    liveTradingEligible: false,
    rationale: "可由 OHLCV 明確定義；尚未通過成本後樣本外驗證。",
  },
  ma_golden_cross: {
    classification: "RESEARCH_CANDIDATE",
    liveTradingEligible: false,
    rationale: "可由 OHLCV 明確定義；尚未通過成本後樣本外驗證。",
  },
  shrink_pullback: {
    classification: "RESEARCH_CANDIDATE",
    liveTradingEligible: false,
    rationale: "可由 OHLCV 明確定義；尚未通過成本後樣本外驗證。",
  },
  box_oscillation: {
    classification: "RESEARCH_CANDIDATE",
    liveTradingEligible: false,
    rationale: "可由 OHLCV 明確定義；區間 regime 及成本後績效仍待驗證。",
  },
  volume_breakout: {
    classification: "RESEARCH_CANDIDATE",
    liveTradingEligible: false,
    rationale: "可由 OHLCV 明確定義；成交量與突破條件仍待樣本外驗證。",
  },
  dragon_head: {
    classification: "DISCRETIONARY_FRAMEWORK",
    liveTradingEligible: false,
    rationale: "需要 point-in-time 板塊、橫斷面相對強弱與可交易性資料；單一股票 OHLCV 無法證明「龍頭」。",
  },
  emotion_cycle: {
    classification: "DISCRETIONARY_FRAMEWORK",
    liveTradingEligible: false,
    rationale: "原定義依賴新聞／市場情緒；目前沒有可重現的 point-in-time 情緒資料集。",
  },
  chan_theory: {
    classification: "DISCRETIONARY_FRAMEWORK",
    liveTradingEligible: false,
    rationale: "中樞、分型與買賣點未有唯一、已驗證的 deterministic 定義。",
  },
  wave_theory: {
    classification: "DISCRETIONARY_FRAMEWORK",
    liveTradingEligible: false,
    rationale: "浪數標記具有高度事後詮釋性；現有 Fibonacci 接近度不是可證明的波浪模型。",
  },
  one_yang_three_yin: {
    classification: "RESEARCH_CANDIDATE",
    liveTradingEligible: false,
    rationale: "可由 OHLCV K 線與成交量明確定義；尚未通過成本後樣本外驗證。",
  },
  bottom_volume: {
    classification: "RESEARCH_CANDIDATE",
    liveTradingEligible: false,
    rationale: "可由 OHLCV 明確定義；反轉訊號易受倖存者偏差與極端尾部影響，必須樣本外驗證。",
  },
};

export function isQuantStrategyId(value: string): value is QuantStrategyId {
  return (QUANT_STRATEGY_IDS as readonly string[]).includes(value);
}

export function getStrategyResearchPolicy(
  strategyId: QuantStrategyId,
): StrategyResearchPolicy {
  return STRATEGY_RESEARCH_POLICIES[strategyId];
}
