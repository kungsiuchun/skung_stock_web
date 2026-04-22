/**
 * Phase 4: Algorithmic Strategy Engine
 * 
 * This file defines the core types and the BaseStrategy interface
 * used for exact, deterministic quantitative analysis.
 */

import { TechnicalIndicators, MACDResult, BollingerResult } from "./indicators";

export enum TrendStatus {
  STRONG_BULL = "強勢多頭",
  BULL = "多頭排列",
  WEAK_BULL = "弱勢多頭",
  CONSOLIDATION = "盤整",
  WEAK_BEAR = "弱勢空頭",
  BEAR = "空頭排列",
  STRONG_BEAR = "強勢空頭"
}

export enum BuySignal {
  STRONG_BUY = "強烈買入",
  BUY = "買入",
  HOLD = "持有",
  WAIT = "觀望",
  SELL = "賣出",
  STRONG_SELL = "強烈賣出"
}

// Data passed to a strategy for evaluation
export interface StrategyContext {
  symbol: string;
  currentPrice: number;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  rsi14: number | null;
  maAlignment: string; // from analyze_trend tool
  newsSentiment?: string;
  
  // Phase 5 advanced metrics
  currentVolume?: number;
  averageVolume30d?: number;
  volumeRatio?: number;
  high60d?: number;
  low60d?: number;

  // OHLC data for pattern recognition
  ohlc?: {
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
  };
}

export interface StrategyResult {
  strategyName: string;
  signal: BuySignal;
  score: number; // 0-100
  reasons: string[];
  risks: string[];
  entry?: number;
  stopLoss?: number;
  target?: number;
  sentiment_score?: number;
}

export abstract class BaseStrategy {
  abstract readonly name: string;
  abstract readonly displayName: string;

  /**
   * Evaluate the deterministic rules of the strategy.
   */
  abstract analyze(context: StrategyContext): StrategyResult;

  protected calculateBias(price: number, ma: number | null): number | null {
    if (!ma) return null;
    return ((price - ma) / ma) * 100;
  }
}

export class BullTrendStrategy extends BaseStrategy {
  readonly name = 'bull_trend';
  readonly displayName = '多頭趨勢 (算法)';

  analyze(context: StrategyContext): StrategyResult {
    const isBullish = context.maAlignment.includes("Bullish") || context.maAlignment.includes("多頭");
    
    // Position bias checking: bias to MA5 < 5% is preferred (not chasing high)
    const biasMa5 = this.calculateBias(context.currentPrice, context.ma5) || 0;
    const biasOk = Math.abs(biasMa5) < 5;
    
    // Volume checking is omitted as we don't have volume data in this simplified context yet
    
    let signal = BuySignal.WAIT;
    let score = 50;
    const reasons: string[] = [];
    const risks: string[] = [];
    
    if (isBullish && biasOk) {
      signal = BuySignal.BUY;
      score = 75;
      reasons.push('✅ MA呈現多頭排列，趨勢向上');
      reasons.push(`✅ 乖離率合理 (${biasMa5.toFixed(1)}%)，不追高`);
    } else if (isBullish && !biasOk) {
      signal = BuySignal.WAIT;
      score = 60;
      reasons.push('✅ 趨勢向上');
      risks.push(`⚠️ 乖離率偏高 (${biasMa5.toFixed(1)}%)，等待回踩`);
    } else {
      signal = BuySignal.SELL;
      score = 30;
      risks.push(`❌ 趨勢不明或向下 (${context.maAlignment})`);
    }

    if (context.rsi14 && context.rsi14 > 70) {
      score -= 10;
      risks.push(`⚠️ RSI 超買 (${context.rsi14.toFixed(1)})，回調風險增高`);
    }
    
    return {
      strategyName: this.displayName,
      signal,
      score,
      reasons,
      risks,
      stopLoss: context.ma20 ? context.ma20 * 0.97 : undefined, // 3% below 20MA
      target: context.ma5 ? context.ma5 * 1.05 : undefined // 5% above 5MA
    };
  }
}

export class MAGoldenCrossStrategy extends BaseStrategy {
  readonly name = 'ma_golden_cross';
  readonly displayName = '均線金叉 (算法)';

  analyze(context: StrategyContext): StrategyResult {
    // Basic check: MA5 crossing above MA10
    const ma5AboveMa10 = context.ma5 && context.ma10 && context.ma5 > context.ma10;
    const ma10AboveMa20 = context.ma10 && context.ma20 && context.ma10 > context.ma20;
    
    // Simplification for the algorithmic test: we assume a recent cross if they are close
    const isGoldenCross = ma5AboveMa10 && ma10AboveMa20;
    const isTight = context.ma5 && context.ma10 && (Math.abs(context.ma5 - context.ma10) / context.ma10 < 0.02);
    
    let signal = BuySignal.WAIT;
    let score = 50;
    const reasons: string[] = [];
    const risks: string[] = [];
    
    if (isGoldenCross && isTight) {
      signal = BuySignal.BUY;
      score = 80;
      reasons.push('✅ MA5 剛突破 MA10，均線糾結轉金叉');
    } else if (isGoldenCross && !isTight) {
      signal = BuySignal.WAIT;
      score = 65;
      reasons.push('✅ 金叉已形成，但差距拉開');
      risks.push('⚠️ 進場點位可能稍遲');
    } else {
      signal = BuySignal.SELL;
      score = 25;
      risks.push('❌ 未形成有效金叉，或空頭排列');
    }
    
    return {
      strategyName: this.displayName,
      signal,
      score,
      reasons,
      risks,
      stopLoss: context.ma10 ? context.ma10 * 0.98 : undefined,
      target: context.ma5 ? context.ma5 * 1.10 : undefined
    };
  }
}

export class ShrinkPullbackStrategy extends BaseStrategy {
  readonly name = 'shrink_pullback';
  readonly displayName = '縮量回踩 (算法)';

  analyze(context: StrategyContext): StrategyResult {
    let signal = BuySignal.WAIT;
    let score = 50;
    const reasons: string[] = [];
    const risks: string[] = [];
    
    // Safety check
    if (!context.ma20 || !context.volumeRatio) {
      return { strategyName: this.displayName, signal, score: 0, reasons, risks: ['❌ 缺少均線或量能數據，無法計算'] };
    }

    const priceDistance = Math.abs(context.currentPrice - context.ma20) / context.ma20;
    const isPullback = priceDistance < 0.02; // within 2% of MA20
    const isVolumeShrink = context.volumeRatio < 0.8; // volume dropped by 20%
    
    if (isPullback && isVolumeShrink && context.currentPrice >= context.ma20) {
      signal = BuySignal.BUY;
      score = 85;
      reasons.push(`✅ 縮量回踩確認: 價格靠近 20MA (差距 ${(priceDistance * 100).toFixed(1)}%)`);
      reasons.push(`✅ 量能萎縮: 量比 ${context.volumeRatio.toFixed(2)} (< 0.8)`);
    } else if (isPullback) {
      score = 60;
      reasons.push(`⚠️ 價格回踩 20MA，但量能未縮 (量比 ${context.volumeRatio.toFixed(2)})`);
      risks.push('等待量能進一步萎縮確認支撐');
    } else {
      score = 30;
      risks.push(`❌ 當前未在回踩 20MA 區間 (差距 ${(priceDistance * 100).toFixed(1)}%)`);
    }

    return {
      strategyName: this.displayName, signal, score, reasons, risks,
      stopLoss: context.ma20 * 0.98,
      target: context.currentPrice * 1.10
    };
  }
}

export class BoxOscillationStrategy extends BaseStrategy {
  readonly name = 'box_oscillation';
  readonly displayName = '箱體震盪 (算法)';

  analyze(context: StrategyContext): StrategyResult {
    if (!context.high60d || !context.low60d) {
      return { strategyName: this.displayName, signal: BuySignal.WAIT, score: 0, reasons: [], risks: ['❌ 缺少區間數據'] };
    }

    const boxWidth = ((context.high60d - context.low60d) / context.low60d) * 100;
    const position = (context.currentPrice - context.low60d) / (context.high60d - context.low60d);
    
    let signal = BuySignal.WAIT;
    let score = 50;
    const reasons: string[] = [];
    const risks: string[] = [];

    reasons.push(`📦 箱體寬度: ${boxWidth.toFixed(1)}%, 支撐: $${context.low60d}, 阻力: $${context.high60d}`);

    if (boxWidth < 5) {
      risks.push('⚠️ 箱體過窄 (<5%)，操作空間有限');
      score = 40;
    } else {
      if (position < 0.3) {
        signal = BuySignal.BUY;
        score = 80;
        reasons.push(`✅ 靠近箱底 (位置 ${(position * 100).toFixed(1)}%)，買入機會`);
      } else if (position > 0.7) {
        signal = BuySignal.SELL;
        score = 20;
        risks.push(`❌ 靠近箱頂 (位置 ${(position * 100).toFixed(1)}%)，建議賣出或觀望`);
      } else {
        score = 50;
        reasons.push(`🟡 處於箱體中軌，不上不下`);
      }
    }

    return {
      strategyName: this.displayName, signal, score, reasons, risks,
      stopLoss: context.low60d * 0.98,
      target: context.high60d * 0.98
    };
  }
}

export class VolumeBreakoutStrategy extends BaseStrategy {
  readonly name = 'volume_breakout';
  readonly displayName = '放量突破 (算法)';

  analyze(context: StrategyContext): StrategyResult {
    if (!context.high60d || !context.volumeRatio) {
      return { strategyName: this.displayName, signal: BuySignal.WAIT, score: 0, reasons: [], risks: ['❌ 缺少必要數據'] };
    }

    const distanceToHigh = (context.high60d - context.currentPrice) / context.currentPrice;
    const isNearHigh = distanceToHigh < 0.03; // Within 3% of 60-day high
    const isNewHigh = context.currentPrice >= context.high60d;
    const isBreakoutVolume = context.volumeRatio > 1.8;
    
    let signal = BuySignal.WAIT;
    let score = 50;
    const reasons: string[] = [];
    const risks: string[] = [];

    if ((isNearHigh || isNewHigh) && isBreakoutVolume) {
      signal = BuySignal.STRONG_BUY;
      score = 90;
      reasons.push(`🔥 放量突破確認: 量比 ${context.volumeRatio.toFixed(2)} (> 1.8)`);
      reasons.push(`✅ 價格突破阻力: 距離前高只差 ${(distanceToHigh * 100).toFixed(1)}%`);
    } else if (isNearHigh && !isBreakoutVolume) {
      score = 60;
      reasons.push(`⚠️ 價格接近阻力位，但量能不足 (量比 ${context.volumeRatio.toFixed(2)})`);
      risks.push('警惕假突破');
    } else {
      score = 30;
      risks.push('❌ 尚未達到突破條件');
    }

    return {
      strategyName: this.displayName, signal, score, reasons, risks,
      stopLoss: context.currentPrice * 0.95,
      target: context.currentPrice * 1.15
    };
  }
}

export class DragonHeadStrategy extends BaseStrategy {
  readonly name = 'dragon_head';
  readonly displayName = '龍頭策略 (算法)';

  analyze(context: StrategyContext): StrategyResult {
    if (!context.ma5 || !context.volumeRatio) {
      return { strategyName: this.displayName, signal: BuySignal.WAIT, score: 0, reasons: [], risks: ['❌ 缺少必要數據'] };
    }

    const isStrongUptrend = context.currentPrice > context.ma5 && context.maAlignment.includes('Bullish');
    const isHighMomentum = context.rsi14 ? context.rsi14 > 65 : false;
    const isHighVolume = context.volumeRatio > 2.0;
    
    let signal = BuySignal.WAIT;
    let score = 50;
    const reasons: string[] = [];
    const risks: string[] = [];

    if (isStrongUptrend && isHighMomentum && isHighVolume) {
      signal = BuySignal.BUY;
      score = 88;
      reasons.push(`🐲 龍頭特徵明顯: 強勢上漲且 RSI(${context.rsi14?.toFixed(1)}) 具有動能`);
      reasons.push(`🔥 資金高度活躍: 量比 ${context.volumeRatio.toFixed(2)} (> 2.0)`);
    } else if (isStrongUptrend && isHighMomentum) {
      score = 70;
      reasons.push('✅ 強勢趨勢，但板塊整體動能或個股量能未達到龍頭級別');
    } else {
      score = 40;
      risks.push('❌ 動能不足，並非市場焦點龍頭');
      if (context.rsi14 && context.rsi14 > 80) risks.push('⚠️ RSI 極端超買，當心回吐');
    }

    return {
      strategyName: this.displayName, signal, score, reasons, risks,
      stopLoss: context.ma5 * 0.95,
      target: context.currentPrice * 1.25 // Dragon targets are higher
    };
  }
}

export class EmotionCycleStrategy extends BaseStrategy {
  readonly name = 'emotion_cycle';
  readonly displayName = '情緒週期 (算法)';

  analyze(context: StrategyContext): StrategyResult {
    let score = 50;
    const reasons: string[] = [];
    const risks: string[] = [];
    
    const turnover = context.volumeRatio || 1;
    const sentiment = context.newsSentiment || 'neutral';
    
    // Create a smooth, continuous score instead of flat 50. 
    // Example: blend RSI, RSI momentum, and distance from MA
    const rsi = context.rsi14 || 50;
    // Map RSI inverted to score (lower RSI -> higher fear -> better entry for Emotion Cycle)
    let fearGreedIndex = 100 - rsi; 
    
    score = Math.floor((fearGreedIndex * 0.6) + (turnover * 10));
    // Clamp between 0 and 100
    score = Math.max(0, Math.min(100, score));

    reasons.push(`📊 當前量能活躍度: ${turnover.toFixed(2)}`);
    reasons.push(`動態情緒評分 (基於超買超賣與量能): ${score}`);

    if (score > 75) {
      reasons.push('✅ 恐慌發酵至極點，市場冰點正是「別人恐慌我貪婪」好時機');
    } else if (score < 30) {
      risks.push('❌ 情緒過熱，籌碼鬆動，警惕接盤風險');
    } else {
      reasons.push('🔄 情緒處於混沌期，多空博弈激烈');
    }
    
    // Dynamic entry point: prefer a pullback to MA10 or a 1.5% buffer below current price.
    const idealEntry = context.ma10 
      ? Math.min(context.currentPrice * 0.985, context.ma10) 
      : context.currentPrice * 0.985;

    return {
      strategyName: this.displayName,
      signal: score > 75 ? BuySignal.BUY : score < 35 ? BuySignal.SELL : BuySignal.WAIT,
      score, reasons, risks,
      sentiment_score: Math.round(context.rsi14 || 50),
      entry: idealEntry,
      stopLoss: idealEntry * 0.94, // Stop loss slightly below entry
      target: context.currentPrice * 1.15
    };
  }
}

export class ChanTheoryStrategy extends BaseStrategy {
  readonly name = 'chan_theory';
  readonly displayName = '纏論策略 (算法)';

  analyze(context: StrategyContext): StrategyResult {
    const reasons: string[] = [];
    const risks: string[] = [];
    
    if (!context.ohlc) {
      return { strategyName: this.displayName, signal: BuySignal.WAIT, score: 0, reasons: [], risks: ['❌ 缺少 K 線數據'] };
    }

    // Simplified fractal & divergence logic
    const { close } = context.ohlc;
    const macd = TechnicalIndicators.MACD(close);
    
    reasons.push(`🌀 當前 MACD BAR: ${macd.bar.toFixed(4)} (DIF: ${macd.dif.toFixed(2)})`);

    let signal = BuySignal.WAIT;
    let score = 50;

    // Detect potential bottom divergence (simplified)
    const isBottomDivergence = macd.bar > 0 && close[close.length-1] < close[close.length-20];
    
    if (isBottomDivergence) {
      signal = BuySignal.BUY;
      score = 82;
      reasons.push('✅ 偵測到潛在「底背馳」結構（價格新低但動能回升）');
      reasons.push('✅ 符合纏論「第一類買點」預期');
    } else if (macd.bar < 0 && macd.dif > 0) {
      score = 65;
      reasons.push('🟡 處於中樞震盪或回調段，等待二買');
    } else {
      risks.push('⚠️ 尚未形成明確的分型結構或買賣點');
    }

    return { strategyName: this.displayName, signal, score, reasons, risks };
  }
}

export class WaveTheoryStrategy extends BaseStrategy {
  readonly name = 'wave_theory';
  readonly displayName = '波浪理論 (算法)';

  analyze(context: StrategyContext): StrategyResult {
    const reasons: string[] = [];
    
    if (!context.high60d || !context.low60d) {
      return { strategyName: this.displayName, signal: BuySignal.WAIT, score: 0, reasons: [], risks: ['❌ 缺少區間數據'] };
    }

    const fib = TechnicalIndicators.Fibonacci(context.high60d, context.low60d);
    const pullbackLevel = ((context.high60d - context.currentPrice) / (context.high60d - context.low60d)) * 100;

    reasons.push(`🌊 浪型定位: 處於 60 日波段回測中 (${pullbackLevel.toFixed(1)}%)`);
    reasons.push(`🎯 關鍵支撐 (0.618): $${fib['61.8'].toFixed(2)}`);

    let signal = BuySignal.WAIT;
    let score = 50;

    if (Math.abs(context.currentPrice - fib['61.8']) / fib['61.8'] < 0.02) {
      signal = BuySignal.BUY;
      score = 80;
      reasons.push('✅ 完美回測黃金分割位 (0.618)，疑似第 2 浪或第 4 浪結束');
    } else if (context.currentPrice > context.high60d) {
      signal = BuySignal.STRONG_BUY;
      score = 92;
      reasons.push('🔥 進入主升第 3 浪突破，目標向上延伸');
    }

    return { strategyName: this.displayName, signal, score, reasons, risks: [] };
  }
}

export class OneYangThreeYinStrategy extends BaseStrategy {
  readonly name = 'one_yang_three_yin';
  readonly displayName = '一陽夾三陰 (算法)';

  analyze(context: StrategyContext): StrategyResult {
    if (!context.ohlc || context.ohlc.close.length < 5) {
      return { strategyName: this.displayName, signal: BuySignal.WAIT, score: 0, reasons: [], risks: ['❌ 數據不足'] };
    }

    const { open, close } = context.ohlc;
    const len = close.length;
    
    // Check last 5 candles
    const isLastYang = close[len-1] > open[len-1];
    const isMiddleThreeYin = (close[len-2] < open[len-2]) && (close[len-3] < open[len-3]) && (close[len-4] < open[len-4]);
    const isFirstYang = close[len-5] > open[len-5];

    let signal = BuySignal.WAIT;
    let score = 50;
    const reasons: string[] = [];

    if (isFirstYang && isMiddleThreeYin && isLastYang) {
      signal = BuySignal.STRONG_BUY;
      score = 95;
      reasons.push('🔥 觸發「一陽夾三陰」經典看漲形態');
      reasons.push('✅ 洗盤結束，主力重新介入預期強烈');
    } else if (isFirstYang && isLastYang) {
      score = 60;
      reasons.push('🟡 近期有陽包陰跡象，但中間調整不完全符合三陰形態');
    }

    return { strategyName: this.displayName, signal, score, reasons, risks: [] };
  }
}

export class BottomVolumeStrategy extends BaseStrategy {
  readonly name = 'bottom_volume';
  readonly displayName = '底部放量 (算法)';

  analyze(context: StrategyContext): StrategyResult {
    if (!context.high60d || !context.volumeRatio) {
      return { strategyName: this.displayName, signal: BuySignal.WAIT, score: 0, reasons: [], risks: ['❌ 必要數據缺失'] };
    }

    const dropFromHigh = (context.high60d - context.currentPrice) / context.high60d;
    const isOversold = dropFromHigh > 0.20; // 20% drop from 60d high
    const isVolumeSpike = context.volumeRatio > 2.5;

    let signal = BuySignal.WAIT;
    let score = 50;
    const reasons: string[] = [];
    const risks: string[] = [];

    reasons.push(`📉 距 60 日高點跌幅: ${(dropFromHigh * 100).toFixed(1)}%`);

    if (isOversold && isVolumeSpike) {
      signal = BuySignal.BUY;
      score = 88;
      reasons.push('✅ 底部放量確認: 長期下跌後突發巨量，疑似主力抄底');
    } else if (isOversold) {
      score = 60;
      reasons.push('⚠️ 已進入超跌區間，但尚未見到明顯放量止跌信號');
    }

    return { strategyName: this.displayName, signal, score, reasons, risks };
  }
}

export function runAlgorithmicStrategy(strategyName: string, context: StrategyContext): StrategyResult | null {
  let strategy: BaseStrategy;
  
  switch(strategyName) {
    case 'bull_trend':
      strategy = new BullTrendStrategy();
      break;
    case 'ma_golden_cross':
      strategy = new MAGoldenCrossStrategy();
      break;
    case 'shrink_pullback':
      strategy = new ShrinkPullbackStrategy();
      break;
    case 'box_oscillation':
      strategy = new BoxOscillationStrategy();
      break;
    case 'volume_breakout':
      strategy = new VolumeBreakoutStrategy();
      break;
    case 'dragon_head':
      strategy = new DragonHeadStrategy();
      break;
    case 'emotion_cycle':
      strategy = new EmotionCycleStrategy();
      break;
    case 'chan_theory':
      strategy = new ChanTheoryStrategy();
      break;
    case 'wave_theory':
      strategy = new WaveTheoryStrategy();
      break;
    case 'one_yang_three_yin':
      strategy = new OneYangThreeYinStrategy();
      break;
    case 'bottom_volume':
      strategy = new BottomVolumeStrategy();
      break;
    default:
      return null;
  }
  
  return strategy.analyze(context);
}
