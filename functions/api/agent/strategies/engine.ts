import { getStrategyResearchPolicy, isQuantStrategyId, type QuantStrategyId, type StrategyResearchClassification } from "./research-policy";

export enum TrendStatus {
  STRONG_BULL = "強勢多頭",
  BULL = "多頭排列",
  WEAK_BULL = "弱勢多頭",
  CONSOLIDATION = "盤整",
  WEAK_BEAR = "弱勢空頭",
  BEAR = "空頭排列",
  STRONG_BEAR = "強勢空頭",
}

export enum BuySignal {
  STRONG_BUY = "強烈買入",
  BUY = "買入",
  HOLD = "持有",
  WAIT = "觀望",
  SELL = "避免新倉",
  STRONG_SELL = "避免新倉",
}

export type TradeActionability = "EXECUTABLE" | "PENDING_TRIGGER" | "NO_TRADE" | "RESEARCH_ONLY";
export type EntryType = "LIMIT_ZONE" | "BREAKOUT_TRIGGER";

export interface TradeSetup {
  actionability: TradeActionability;
  nextStep: string;
  entryType?: EntryType;
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
}

export interface StrategyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StrategyContext {
  symbol: string;
  currentPrice: number;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma50?: number | null;
  ma200?: number | null;
  rsi14: number | null;
  maAlignment: string;
  currentVolume?: number;
  averageVolume30d?: number;
  volumeRatio?: number;
  high60d?: number;
  low60d?: number;
  atr14?: number;
  priorHigh20?: number;
  priorLow20?: number;
  priorHigh60?: number;
  priorLow60?: number;
  ma20Slope?: number;
  ma50Slope?: number;
  relativeStrength20?: number | null;
  asOf?: string;
  dataQuality?: "COMPLETE_DAILY_BAR" | "INSUFFICIENT";
  ohlc?: {
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
  };
}

export interface StrategyResult {
  strategyId: QuantStrategyId;
  strategyName: string;
  signal: BuySignal;
  score: number;
  reasons: string[];
  risks: string[];
  tradeSetup: TradeSetup;
  asOf?: string;
  entry?: number;
  stopLoss?: number;
  target?: number;
  researchStatus: {
    classification: StrategyResearchClassification;
    institutionalGate: "NOT_EVALUATED" | "NOT_ELIGIBLE";
    liveTradingEligible: false;
    rationale: string;
  };
}

const roundPrice = (value: number) => Number(value.toFixed(2));
const finite = (value: number | null | undefined, fallback = 0) => Number.isFinite(value) ? Number(value) : fallback;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const average = (values: number[]) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
const highest = (values: number[]) => values.length ? Math.max(...values) : 0;
const lowest = (values: number[]) => values.length ? Math.min(...values) : 0;

const smaAt = (values: number[], endExclusive: number, period: number) => {
  const start = Math.max(0, endExclusive - period);
  return average(values.slice(start, endExclusive));
};

const calculateRsi = (closes: number[], period = 14) => {
  if (closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let index = closes.length - period; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
};

const calculateAtr = (high: number[], low: number[], close: number[], period = 14) => {
  if (close.length < period + 1) return 0;
  const ranges: number[] = [];
  for (let index = Math.max(1, close.length - period); index < close.length; index += 1) {
    ranges.push(Math.max(high[index] - low[index], Math.abs(high[index] - close[index - 1]), Math.abs(low[index] - close[index - 1])));
  }
  return average(ranges);
};

const completedBars = (bars: StrategyBar[]) => bars.filter((bar) =>
  Boolean(bar.date) && [bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)
    && bar.high >= Math.max(bar.open, bar.close)
    && bar.low <= Math.min(bar.open, bar.close),
);

export function buildStrategyContext(input: { symbol: string; bars: StrategyBar[]; benchmarkBars?: StrategyBar[] }): StrategyContext {
  const bars = completedBars(input.bars);
  if (bars.length < 220) throw new Error(`Quant snapshot requires 220 completed daily bars; received ${bars.length}.`);

  const open = bars.map((bar) => bar.open);
  const high = bars.map((bar) => bar.high);
  const low = bars.map((bar) => bar.low);
  const close = bars.map((bar) => bar.close);
  const volume = bars.map((bar) => bar.volume);
  const end = close.length;
  const ma5 = smaAt(close, end, 5);
  const ma10 = smaAt(close, end, 10);
  const ma20 = smaAt(close, end, 20);
  const ma50 = smaAt(close, end, 50);
  const ma200 = smaAt(close, end, 200);
  const priorMa20 = smaAt(close, end - 5, 20);
  const priorMa50 = smaAt(close, end - 5, 50);
  const currentPrice = close.at(-1)!;
  const previousHigh20 = highest(high.slice(-21, -1));
  const previousLow20 = lowest(low.slice(-21, -1));
  const previousHigh60 = highest(high.slice(-61, -1));
  const previousLow60 = lowest(low.slice(-61, -1));
  const priorVolume20 = average(volume.slice(-21, -1));
  const volumeRatio = priorVolume20 > 0 ? volume.at(-1)! / priorVolume20 : 0;
  const benchmark = completedBars(input.benchmarkBars || []);
  const relativeStrength20 = benchmark.length >= 21
    ? ((currentPrice / close.at(-21)! - 1) - (benchmark.at(-1)!.close / benchmark.at(-21)!.close - 1)) * 100
    : null;
  const maAlignment = currentPrice > ma20 && ma20 > ma50 && ma50 > ma200
    ? "Strong Bullish"
    : currentPrice < ma20 && ma20 < ma50 && ma50 < ma200
      ? "Strong Bearish"
      : "Mixed";

  return {
    symbol: input.symbol,
    currentPrice,
    ma5,
    ma10,
    ma20,
    ma50,
    ma200,
    rsi14: calculateRsi(close),
    maAlignment,
    currentVolume: volume.at(-1),
    averageVolume30d: average(volume.slice(-31, -1)),
    volumeRatio,
    high60d: highest(high.slice(-60)),
    low60d: lowest(low.slice(-60)),
    atr14: calculateAtr(high, low, close),
    priorHigh20: previousHigh20,
    priorLow20: previousLow20,
    priorHigh60: previousHigh60,
    priorLow60: previousLow60,
    ma20Slope: ((ma20 - priorMa20) / priorMa20) * 100,
    ma50Slope: ((ma50 - priorMa50) / priorMa50) * 100,
    relativeStrength20,
    asOf: bars.at(-1)!.date,
    dataQuality: "COMPLETE_DAILY_BAR",
    ohlc: { open, high, low, close, volume },
  };
}

const metric = (context: StrategyContext) => ({
  price: finite(context.currentPrice),
  atr: finite(context.atr14, Math.max(finite(context.currentPrice) * 0.02, 0.01)),
  ma20: finite(context.ma20, finite(context.currentPrice)),
  ma50: finite(context.ma50, finite(context.ma20, finite(context.currentPrice))),
  ma200: finite(context.ma200, finite(context.ma50, finite(context.currentPrice))),
  rvol: finite(context.volumeRatio),
  rsi: finite(context.rsi14, 50),
  priorHigh20: finite(context.priorHigh20, finite(context.high60d, finite(context.currentPrice))),
  priorLow20: finite(context.priorLow20, finite(context.low60d, finite(context.currentPrice))),
  priorHigh60: finite(context.priorHigh60, finite(context.high60d, finite(context.currentPrice))),
  priorLow60: finite(context.priorLow60, finite(context.low60d, finite(context.currentPrice))),
  ma20Slope: finite(context.ma20Slope),
  ma50Slope: finite(context.ma50Slope),
  rs20: context.relativeStrength20,
});

const baseSetup = (actionability: TradeActionability, nextStep: string, details: Partial<TradeSetup> = {}): TradeSetup => ({
  ...details,
  actionability,
  nextStep,
  optionsStatus: "PENDING",
});

const plannedTrade = (input: {
  actionability: "EXECUTABLE" | "PENDING_TRIGGER";
  nextStep: string;
  entryType: EntryType;
  entryLow?: number;
  entryHigh?: number;
  triggerPrice?: number;
  stopLoss: number;
  target1: number;
  target2: number;
  invalidation: string;
}) => {
  const entry = input.entryType === "BREAKOUT_TRIGGER" ? finite(input.triggerPrice) : finite(input.entryHigh);
  const risk = entry - input.stopLoss;
  const rewardRisk = risk > 0 ? (input.target1 - entry) / risk : 0;
  if (input.actionability === "EXECUTABLE" && (risk <= 0 || input.target1 <= entry || rewardRisk < 2)) {
    return baseSetup("PENDING_TRIGGER", `${input.nextStep}；現有結構未提供至少 2.0R 的空間。`, {
      entryType: input.entryType,
      ...(input.entryLow !== undefined ? { entryLow: roundPrice(input.entryLow) } : {}),
      ...(input.entryHigh !== undefined ? { entryHigh: roundPrice(input.entryHigh) } : {}),
      ...(input.triggerPrice !== undefined ? { triggerPrice: roundPrice(input.triggerPrice) } : {}),
      invalidation: input.invalidation,
    });
  }
  if (input.actionability === "PENDING_TRIGGER") {
    return {
      actionability: "PENDING_TRIGGER" as const,
      nextStep: input.nextStep,
      entryType: input.entryType,
      ...(input.entryLow !== undefined ? { entryLow: roundPrice(input.entryLow) } : {}),
      ...(input.entryHigh !== undefined ? { entryHigh: roundPrice(input.entryHigh) } : {}),
      ...(input.triggerPrice !== undefined ? { triggerPrice: roundPrice(input.triggerPrice) } : {}),
      invalidation: input.invalidation,
      optionsStatus: "PENDING" as const,
    };
  }
  return {
    actionability: input.actionability,
    nextStep: input.nextStep,
    entryType: input.entryType,
    ...(input.entryLow !== undefined ? { entryLow: roundPrice(input.entryLow) } : {}),
    ...(input.entryHigh !== undefined ? { entryHigh: roundPrice(input.entryHigh) } : {}),
    ...(input.triggerPrice !== undefined ? { triggerPrice: roundPrice(input.triggerPrice) } : {}),
    stopLoss: roundPrice(input.stopLoss),
    target1: roundPrice(input.target1),
    target2: roundPrice(Math.max(input.target2, input.target1)),
    rewardRisk: roundPrice(rewardRisk),
    invalidation: input.invalidation,
    maxHoldingDays: 20,
    optionsStatus: "PENDING" as const,
  };
};

const strategyNames: Record<QuantStrategyId, string> = {
  bull_trend: "多頭趨勢（規則化）",
  ma_golden_cross: "均線金叉（規則化）",
  shrink_pullback: "縮量回踩（規則化）",
  box_oscillation: "箱體震盪（規則化）",
  volume_breakout: "放量突破（規則化）",
  dragon_head: "龍頭策略（研究）",
  emotion_cycle: "情緒週期（研究）",
  chan_theory: "纏論結構（研究）",
  wave_theory: "波浪結構（研究）",
  one_yang_three_yin: "一陽夾三陰（規則化）",
  bottom_volume: "底部放量（規則化）",
};

type Draft = Omit<StrategyResult, "strategyId" | "strategyName" | "researchStatus" | "entry" | "stopLoss" | "target">;

const draft = (signal: BuySignal, score: number, reasons: string[], risks: string[], tradeSetup: TradeSetup, context: StrategyContext): Draft => ({
  signal,
  score: clamp(Math.round(score), 0, 100),
  reasons,
  risks,
  tradeSetup,
  asOf: context.asOf,
});

const bullishRegime = (m: ReturnType<typeof metric>) => m.price > m.ma20 && m.ma20 > m.ma50 && m.ma50 > m.ma200 && m.ma20Slope > 0 && m.ma50Slope >= 0;

const evaluateBullTrend = (context: StrategyContext): Draft => {
  const m = metric(context);
  const regime = bullishRegime(m);
  const trigger = m.priorHigh20 + m.atr * 0.1;
  const rsPass = m.rs20 === null || m.rs20 > 0;
  const reasons = [`20/50/200MA：${m.ma20.toFixed(2)} / ${m.ma50.toFixed(2)} / ${m.ma200.toFixed(2)}，20MA 五日斜率 ${m.ma20Slope.toFixed(2)}%。`, `相對 SPY 20 日強度：${m.rs20 === null ? "資料缺失" : `${m.rs20.toFixed(2)}%`}。`];
  if (!regime || !rsPass) return draft(BuySignal.SELL, 25, reasons, ["趨勢或相對強度未達標；避免開新 long 倉。"], baseSetup("NO_TRADE", "等待 20/50/200MA 恢復多頭排列及相對 SPY 轉正。"), context);
  const setup = plannedTrade({ actionability: m.price >= trigger && m.price <= trigger + m.atr * 0.3 ? "EXECUTABLE" : "PENDING_TRIGGER", nextStep: `收市突破 ${trigger.toFixed(2)} 後才入場，不追高超過 0.3 ATR。`, entryType: "BREAKOUT_TRIGGER", triggerPrice: trigger, stopLoss: Math.min(m.ma20 - m.atr * 0.5, m.priorLow20 - m.atr * 0.1), target1: m.priorHigh60 + m.atr * 2, target2: m.priorHigh60 + m.atr * 4, invalidation: `收市跌回 20MA ${m.ma20.toFixed(2)} 下方。` });
  return draft(setup.actionability === "EXECUTABLE" ? BuySignal.BUY : BuySignal.WAIT, setup.actionability === "EXECUTABLE" ? 82 : 68, [...reasons, `前 20 日高位（不含今日）${m.priorHigh20.toFixed(2)}；觸發價 ${trigger.toFixed(2)}。`], [], setup, context);
};

const evaluateGoldenCross = (context: StrategyContext): Draft => {
  const m = metric(context);
  const closes = context.ohlc?.close || [];
  const priorMa5 = closes.length >= 11 ? smaAt(closes, closes.length - 1, 5) : finite(context.ma5);
  const priorMa10 = closes.length >= 11 ? smaAt(closes, closes.length - 1, 10) : finite(context.ma10);
  const crossed = priorMa5 <= priorMa10 && finite(context.ma5) > finite(context.ma10) && m.ma20 > m.ma50;
  const trigger = Math.max(m.priorHigh20 + m.atr * 0.1, m.ma5);
  const reasons = [`MA5/10：${finite(context.ma5).toFixed(2)} / ${finite(context.ma10).toFixed(2)}；前一日 ${priorMa5.toFixed(2)} / ${priorMa10.toFixed(2)}。`, `20MA ${m.ma20.toFixed(2)} 高於 50MA ${m.ma50.toFixed(2)}。`];
  if (!crossed) return draft(BuySignal.WAIT, 48, reasons, ["未出現真正由下而上的 MA5/10 cross；不可用均線距離冒充金叉。"], baseSetup("PENDING_TRIGGER", "等待 MA5 由下穿上 MA10，並收市站上前 20 日高位。", { entryType: "BREAKOUT_TRIGGER", triggerPrice: roundPrice(trigger) }), context);
  const setup = plannedTrade({ actionability: m.price >= trigger && m.price <= trigger + m.atr * 0.25 ? "EXECUTABLE" : "PENDING_TRIGGER", nextStep: `收市突破 ${trigger.toFixed(2)} 並保持在 MA10 上方。`, entryType: "BREAKOUT_TRIGGER", triggerPrice: trigger, stopLoss: Math.min(finite(context.ma10) - m.atr * 0.5, m.priorLow20 - m.atr * 0.1), target1: m.priorHigh60 + m.atr * 2, target2: m.priorHigh60 + m.atr * 4, invalidation: `收市跌回 MA10 ${finite(context.ma10).toFixed(2)} 下方。` });
  return draft(setup.actionability === "EXECUTABLE" ? BuySignal.BUY : BuySignal.WAIT, 78, [...reasons, `真實金叉已確認；觸發價 ${trigger.toFixed(2)}。`], [], setup, context);
};

const evaluateShrinkPullback = (context: StrategyContext): Draft => {
  const m = metric(context);
  const nearMa20 = Math.abs(m.price - m.ma20) <= m.atr * 0.5;
  const volumeShrink = m.rvol <= 0.8;
  const bullish = bullishRegime(m);
  const zoneLow = m.ma20 - m.atr * 0.25;
  const zoneHigh = m.ma20 + m.atr * 0.25;
  const trigger = context.ohlc?.high.at(-1)! + m.atr * 0.1;
  const reasons = [`現價 ${m.price.toFixed(2)}，20MA ${m.ma20.toFixed(2)}，距離 ${(Math.abs(m.price - m.ma20) / m.ma20 * 100).toFixed(2)}%。`, `相對成交量 ${m.rvol.toFixed(2)}x；規則要求不高於 0.80x。`];
  if (!bullish) return draft(BuySignal.SELL, 28, reasons, ["回踩只可發生在上升 regime；現時趨勢不合格。"], baseSetup("NO_TRADE", "等待 20/50/200MA 恢復多頭排列。"), context);
  if (!nearMa20 || !volumeShrink) return draft(BuySignal.WAIT, 58, reasons, [!nearMa20 ? `等待回到 ${zoneLow.toFixed(2)}–${zoneHigh.toFixed(2)} 的 20MA 區。` : "等待相對成交量收縮至 0.80x 或以下。"], baseSetup("PENDING_TRIGGER", `先滿足 MA20 區與 0.80x 量比，再突破當日高位 ${trigger.toFixed(2)}。`, { entryType: "LIMIT_ZONE", entryLow: roundPrice(zoneLow), entryHigh: roundPrice(zoneHigh), triggerPrice: roundPrice(trigger) }), context);
  const setup = plannedTrade({ actionability: m.price >= trigger && m.price <= trigger + m.atr * 0.25 ? "EXECUTABLE" : "PENDING_TRIGGER", nextStep: `縮量回踩後突破 ${trigger.toFixed(2)} 才入場。`, entryType: "BREAKOUT_TRIGGER", triggerPrice: trigger, stopLoss: Math.min(m.priorLow20 - m.atr * 0.1, m.ma20 - m.atr), target1: m.priorHigh20 + m.atr * 2, target2: m.priorHigh60 + m.atr * 3, invalidation: `收市跌穿 20MA ${m.ma20.toFixed(2)} 並放量。` });
  return draft(setup.actionability === "EXECUTABLE" ? BuySignal.BUY : BuySignal.WAIT, 84, [...reasons, `回踩與縮量已確認；下一個確認價 ${trigger.toFixed(2)}。`], [], setup, context);
};

const evaluateBox = (context: StrategyContext): Draft => {
  const m = metric(context);
  const range = m.priorHigh60 - m.priorLow60;
  const position = range > 0 ? (m.price - m.priorLow60) / range : 1;
  const tolerance = Math.max(m.atr * 0.5, range * 0.08);
  const lows = context.ohlc?.low.slice(-61, -1) || [];
  const supports = lows.filter((value) => Math.abs(value - m.priorLow60) <= tolerance).length;
  const reasons = [`60 日箱底/箱頂（不含今日）：${m.priorLow60.toFixed(2)} / ${m.priorHigh60.toFixed(2)}。`, `現價位於箱體 ${(position * 100).toFixed(1)}%，箱底可識別觸碰 ${supports} 次。`];
  if (supports < 2 || range <= m.atr * 4) return draft(BuySignal.WAIT, 40, reasons, ["未形成至少兩次支持觸碰的可交易箱體。"], baseSetup("PENDING_TRIGGER", "等待箱體支持／阻力被確認。"), context);
  if (position > 0.45) return draft(BuySignal.SELL, 30, reasons, ["箱體中軌以上沒有良好風險回報；避免追入。"], baseSetup("NO_TRADE", `等待價格回到箱底 ${m.priorLow60.toFixed(2)} 附近並出現反轉。`), context);
  const trigger = context.ohlc?.high.at(-1)! + m.atr * 0.1;
  const setup = plannedTrade({ actionability: position <= 0.3 && m.price >= trigger ? "EXECUTABLE" : "PENDING_TRIGGER", nextStep: `箱底反轉後突破 ${trigger.toFixed(2)} 才入場。`, entryType: "BREAKOUT_TRIGGER", triggerPrice: trigger, stopLoss: m.priorLow60 - m.atr * 0.35, target1: m.priorHigh60 - m.atr * 0.5, target2: m.priorHigh60, invalidation: `收市跌穿箱底 ${m.priorLow60.toFixed(2)}。` });
  return draft(setup.actionability === "EXECUTABLE" ? BuySignal.BUY : BuySignal.WAIT, 76, reasons, [], setup, context);
};

const evaluateBreakout = (context: StrategyContext): Draft => {
  const m = metric(context);
  const trigger = m.priorHigh20 + m.atr * 0.1;
  const closeStrength = m.price >= m.priorHigh20;
  const volumePass = m.rvol >= 1.8;
  const reasons = [`前 20 日高位（不含今日）${m.priorHigh20.toFixed(2)}；突破觸發價 ${trigger.toFixed(2)}。`, `相對成交量 ${m.rvol.toFixed(2)}x；規則門檻 1.80x。`];
  if (!volumePass || !closeStrength) return draft(BuySignal.WAIT, 55, reasons, [!volumePass ? "量能不足，不能把接近前高當成突破。" : "收市尚未站上前高。"], baseSetup("PENDING_TRIGGER", `等待收市突破 ${trigger.toFixed(2)} 並維持至少 1.80x 相對成交量。`, { entryType: "BREAKOUT_TRIGGER", triggerPrice: roundPrice(trigger) }), context);
  const setup = plannedTrade({ actionability: m.price <= trigger + m.atr * 0.3 ? "EXECUTABLE" : "PENDING_TRIGGER", nextStep: `突破 ${trigger.toFixed(2)} 後，僅在 0.3 ATR 追價範圍內進場。`, entryType: "BREAKOUT_TRIGGER", triggerPrice: trigger, stopLoss: Math.max(m.priorHigh20 - m.atr, m.ma20 - m.atr * 0.5), target1: m.priorHigh60 + m.atr * 2, target2: m.priorHigh60 + m.atr * 4, invalidation: `收市跌回前高 ${m.priorHigh20.toFixed(2)} 下方。` });
  return draft(setup.actionability === "EXECUTABLE" ? BuySignal.STRONG_BUY : BuySignal.WAIT, 88, reasons, [], setup, context);
};

const evaluateDragon = (context: StrategyContext): Draft => {
  const m = metric(context);
  const reasons = [`相對 SPY 20 日強度：${m.rs20 === null ? "缺失" : `${m.rs20.toFixed(2)}%`}。`, `相對成交量 ${m.rvol.toFixed(2)}x，現價與 20MA 差 ${(m.price / m.ma20 - 1) * 100 >= 0 ? "+" : ""}${((m.price / m.ma20 - 1) * 100).toFixed(2)}%。`];
  return draft(BuySignal.WAIT, m.rs20 !== null && m.rs20 > 5 && m.rvol > 2 ? 65 : 35, reasons, ["龍頭判定仍缺 point-in-time sector ranking 與成交額橫截面資料；只作研究，不可下單。"], baseSetup("RESEARCH_ONLY", "等待 sector ETF／同業排名資料齊全後，才評估龍頭資格。"), context);
};

const evaluateEmotion = (context: StrategyContext): Draft => {
  const m = metric(context);
  const reasons = [`RSI14 ${m.rsi.toFixed(1)}，相對成交量 ${m.rvol.toFixed(2)}x。`, "情緒策略必須由期權 put/call OI 與期權牆確認，不能用 RSI 反轉代替。"];
  return draft(BuySignal.WAIT, 40, reasons, ["期權定位尚未注入策略快照；只作研究，不可輸出交易價位。"], baseSetup("RESEARCH_ONLY", "等待同一 timestamp 的 put/call OI 與期權牆資料。"), context);
};

const evaluateChan = (context: StrategyContext): Draft => {
  const m = metric(context);
  const closes = context.ohlc?.close || [];
  const pivot = closes.length >= 5 ? closes.slice(-5).filter((value, index, values) => index > 0 && index < values.length - 1 && ((value > values[index - 1] && value > values[index + 1]) || (value < values[index - 1] && value < values[index + 1]))).length : 0;
  return draft(BuySignal.WAIT, pivot >= 2 ? 55 : 30, [`最近五根 K 線可識別 pivot 數：${pivot}。`, `現價 ${m.price.toFixed(2)}，前 20 日高／低 ${m.priorHigh20.toFixed(2)} / ${m.priorLow20.toFixed(2)}。`], ["纏論中樞／筆結構只作規則化研究；未建立可驗證的入場統計前不可下單。"], baseSetup("RESEARCH_ONLY", "等待最少三段已確認 pivot 構成中樞，並完成研究驗證。"), context);
};

const evaluateWave = (context: StrategyContext): Draft => {
  const m = metric(context);
  const range = m.priorHigh60 - m.priorLow60;
  const fib618 = m.priorHigh60 - range * 0.618;
  return draft(BuySignal.WAIT, Math.abs(m.price - fib618) <= m.atr * 0.5 ? 55 : 30, [`60 日 Fibonacci 0.618：${fib618.toFixed(2)}；現價 ${m.price.toFixed(2)}。`, `60 日波段：${m.priorLow60.toFixed(2)}–${m.priorHigh60.toFixed(2)}。`], ["波浪標記具事後解釋風險；未完成固定 ZigZag 參數的 OOS 驗證前只作研究。"], baseSetup("RESEARCH_ONLY", "等待規則化 ZigZag 結構與回測 gate 同時通過。"), context);
};

const evaluateOneYangThreeYin = (context: StrategyContext): Draft => {
  const m = metric(context);
  const bars = context.ohlc;
  if (!bars || bars.close.length < 5) return draft(BuySignal.WAIT, 0, [], ["K 線不足，不能辨識一陽夾三陰。"], baseSetup("NO_TRADE", "等待完整五根完成日 K。"), context);
  const length = bars.close.length;
  const firstBull = bars.close[length - 5] > bars.open[length - 5];
  const threeDown = [2, 3, 4].every((offset) => bars.close[length - offset] < bars.open[length - offset]);
  const trigger = highest(bars.high.slice(-4)) + m.atr * 0.1;
  const reasons = [`首根陽線 ${firstBull ? "成立" : "不成立"}；中間三根陰線 ${threeDown ? "成立" : "不成立"}。`, `相對成交量 ${m.rvol.toFixed(2)}x；確認價 ${trigger.toFixed(2)}。`];
  if (!firstBull || !threeDown || !bullishRegime(m) || m.rvol < 1) return draft(BuySignal.WAIT, 45, reasons, ["需要上升趨勢、完整形態及量能確認；現時不合格。"], baseSetup("PENDING_TRIGGER", `等待完整形態後突破 ${trigger.toFixed(2)}，且相對成交量不低於 1.0x。`, { entryType: "BREAKOUT_TRIGGER", triggerPrice: roundPrice(trigger) }), context);
  const setup = plannedTrade({ actionability: m.price >= trigger && m.price <= trigger + m.atr * 0.25 ? "EXECUTABLE" : "PENDING_TRIGGER", nextStep: `突破 ${trigger.toFixed(2)} 才入場。`, entryType: "BREAKOUT_TRIGGER", triggerPrice: trigger, stopLoss: lowest(bars.low.slice(-4)) - m.atr * 0.1, target1: m.priorHigh60 + m.atr * 2, target2: m.priorHigh60 + m.atr * 4, invalidation: "收市跌穿形態低點。" });
  return draft(setup.actionability === "EXECUTABLE" ? BuySignal.BUY : BuySignal.WAIT, 82, reasons, [], setup, context);
};

const evaluateBottomVolume = (context: StrategyContext): Draft => {
  const m = metric(context);
  const drop = m.priorHigh60 > 0 ? (m.priorHigh60 - m.price) / m.priorHigh60 : 0;
  const bar = context.ohlc;
  const todayRange = bar ? Math.max(bar.high.at(-1)! - bar.low.at(-1)!, 0.01) : 0.01;
  const closeLocation = bar ? (m.price - bar.low.at(-1)!) / todayRange : 0;
  const trigger = bar ? bar.high.at(-1)! + m.atr * 0.1 : m.price + m.atr * 0.1;
  const reasons = [`距 60 日前高回撤 ${(drop * 100).toFixed(1)}%，相對成交量 ${m.rvol.toFixed(2)}x。`, `當日收市位於 K 線區間 ${(closeLocation * 100).toFixed(0)}%，確認價 ${trigger.toFixed(2)}。`];
  if (drop < 0.2 || m.rvol < 2.5 || closeLocation < 0.65) return draft(BuySignal.WAIT, 42, reasons, ["未同時滿足 20% 回撤、2.5x 放量及收市靠近日高；不可猜底。"], baseSetup("PENDING_TRIGGER", `等待止跌 K 線後突破 ${trigger.toFixed(2)}。`, { entryType: "BREAKOUT_TRIGGER", triggerPrice: roundPrice(trigger) }), context);
  const setup = plannedTrade({ actionability: "PENDING_TRIGGER", nextStep: `只在下一個完成日突破 ${trigger.toFixed(2)} 時入場，避免接 falling knife。`, entryType: "BREAKOUT_TRIGGER", triggerPrice: trigger, stopLoss: (bar?.low.at(-1) || m.priorLow20) - m.atr * 0.1, target1: m.ma20, target2: m.priorHigh20, invalidation: "收市跌穿放量日低位。" });
  return draft(BuySignal.WAIT, 68, reasons, [], setup, context);
};

const evaluators: Record<QuantStrategyId, (context: StrategyContext) => Draft> = {
  bull_trend: evaluateBullTrend,
  ma_golden_cross: evaluateGoldenCross,
  shrink_pullback: evaluateShrinkPullback,
  box_oscillation: evaluateBox,
  volume_breakout: evaluateBreakout,
  dragon_head: evaluateDragon,
  emotion_cycle: evaluateEmotion,
  chan_theory: evaluateChan,
  wave_theory: evaluateWave,
  one_yang_three_yin: evaluateOneYangThreeYin,
  bottom_volume: evaluateBottomVolume,
};

const toResult = (id: QuantStrategyId, context: StrategyContext): StrategyResult => {
  const policy = getStrategyResearchPolicy(id);
  const evaluated = evaluators[id](context);
  const researchOnly = policy.classification === "DISCRETIONARY_FRAMEWORK";
  const tradeSetup = researchOnly
    ? { ...evaluated.tradeSetup, actionability: "RESEARCH_ONLY" as const, optionsStatus: "PENDING" as const }
    : evaluated.tradeSetup;
  if (context.atr14 && tradeSetup.actionability !== "RESEARCH_ONLY") tradeSetup.atr14 = roundPrice(context.atr14);
  const actionSignal = tradeSetup.actionability === "EXECUTABLE" ? evaluated.signal : tradeSetup.actionability === "NO_TRADE" ? BuySignal.SELL : BuySignal.WAIT;
  const result: StrategyResult = {
    strategyId: id,
    strategyName: strategyNames[id],
    signal: researchOnly ? BuySignal.WAIT : actionSignal,
    score: researchOnly ? Math.min(evaluated.score, 55) : evaluated.score,
    reasons: evaluated.reasons,
    risks: researchOnly ? [...evaluated.risks, `研究限定：${policy.rationale}`] : evaluated.risks,
    tradeSetup,
    asOf: evaluated.asOf,
    researchStatus: {
      classification: policy.classification,
      institutionalGate: researchOnly ? "NOT_ELIGIBLE" : "NOT_EVALUATED",
      liveTradingEligible: false,
      rationale: policy.rationale,
    },
  };
  if (tradeSetup.actionability === "EXECUTABLE") {
    const entry = tradeSetup.entryType === "BREAKOUT_TRIGGER" ? tradeSetup.triggerPrice : tradeSetup.entryHigh;
    result.entry = entry;
    result.stopLoss = tradeSetup.stopLoss;
    result.target = tradeSetup.target1;
  }
  return result;
};

export function runAlgorithmicStrategy(strategyName: string, context: StrategyContext): StrategyResult | null {
  if (!isQuantStrategyId(strategyName)) return null;
  return toResult(strategyName, context);
}

export function rankStrategyResults(results: StrategyResult[]): StrategyResult[] {
  const rank: Record<TradeActionability, number> = { EXECUTABLE: 0, PENDING_TRIGGER: 1, NO_TRADE: 2, RESEARCH_ONLY: 3 };
  return [...results].sort((left, right) => rank[left.tradeSetup.actionability] - rank[right.tradeSetup.actionability] || right.score - left.score);
}

export function selectRecommendedTrade(results: StrategyResult[]): StrategyResult | null {
  return rankStrategyResults(results).find((result) => result.tradeSetup.actionability === "EXECUTABLE") || null;
}
