import {
  bearishengulfingpattern,
  bullishengulfingpattern,
  darkcloudcover,
  doji,
  eveningstar,
  hammerpattern,
  hangingman,
  morningstar,
  piercingline,
  shootingstar,
  threeblackcrows,
  threewhitesoldiers,
} from "technicalindicators";
import {
  deriveSupportResistanceAnalysis,
  type SupportResistanceAnalysis,
} from "./support-resistance";

export const CANDLESTICK_SCHEMA_VERSION = "v2" as const;
export const CANDLESTICK_INTERVALS = ["1d", "1wk", "1mo"] as const;

export type CandlestickInterval = typeof CANDLESTICK_INTERVALS[number];
export type CandlestickBias = "bullish" | "bearish" | "neutral";
export type CandlestickTrendContext = CandlestickBias | "unavailable";
export type CandlestickConfirmation = "shape_only" | "pattern_complete" | "next_bar";

export interface CandlestickBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandlestickPatternMatch {
  id: string;
  nameZh: string;
  bias: CandlestickBias;
  startTime: string;
  endTime: string;
  confirmation: CandlestickConfirmation;
  ruleSummary: string;
}

export interface CandlestickAnalysis {
  patternBias: CandlestickBias;
  trendContext: CandlestickTrendContext;
  latestMatches: CandlestickPatternMatch[];
  recentMatches: CandlestickPatternMatch[];
  supportResistance: SupportResistanceAnalysis;
}

export interface CandlestickPatternData {
  schemaVersion: typeof CANDLESTICK_SCHEMA_VERSION;
  symbol: string;
  interval: CandlestickInterval;
  source: "Yahoo Finance chart API";
  sourceAsOf: string;
  exchangeTimezone: string;
  partialBarExcluded: boolean;
  rejectedBarCount: number;
  bars: CandlestickBar[];
  analysis: CandlestickAnalysis;
}

type PatternInput = {
  open: number[];
  high: number[];
  low: number[];
  close: number[];
};

type PatternRule = {
  id: string;
  nameZh: string;
  bias: CandlestickBias;
  requiredCount: number;
  confirmation: CandlestickConfirmation;
  ruleSummary: string;
  detect: (input: PatternInput) => boolean;
};

export const CANDLESTICK_PATTERN_RULES: readonly PatternRule[] = [
  {
    id: "bullish_engulfing",
    nameZh: "多頭吞噬",
    bias: "bullish",
    requiredCount: 2,
    confirmation: "shape_only",
    ruleSummary: "前一支為陰燭，後一支陽燭實體完全吞噬前一支實體。",
    detect: (input) => Boolean(bullishengulfingpattern(input)),
  },
  {
    id: "morning_star",
    nameZh: "晨星",
    bias: "bullish",
    requiredCount: 3,
    confirmation: "pattern_complete",
    ruleSummary: "長陰燭後出現向下跳空的小實體，第三支陽燭收復第一支實體中點。",
    detect: (input) => Boolean(morningstar(input)),
  },
  {
    id: "piercing_line",
    nameZh: "曙光初現",
    bias: "bullish",
    requiredCount: 2,
    confirmation: "shape_only",
    ruleSummary: "陰燭後低開，第二支陽燭收市穿越前一支實體中點。",
    detect: (input) => Boolean(piercingline(input)),
  },
  {
    id: "confirmed_hammer_family",
    nameZh: "確認錘頭／倒錘頭",
    bias: "bullish",
    requiredCount: 5,
    confirmation: "next_bar",
    ruleSummary: "短期下跌後出現錘頭或倒錘頭形狀，下一支陽燭收市高於形態燭。",
    detect: (input) => Boolean(hammerpattern(input)),
  },
  {
    id: "three_white_soldiers",
    nameZh: "三白兵",
    bias: "bullish",
    requiredCount: 3,
    confirmation: "pattern_complete",
    ruleSummary: "連續三支陽燭逐步創高，後兩支在前一支實體內開市。",
    detect: (input) => Boolean(threewhitesoldiers(input)),
  },
  {
    id: "bearish_engulfing",
    nameZh: "空頭吞噬",
    bias: "bearish",
    requiredCount: 2,
    confirmation: "shape_only",
    ruleSummary: "前一支為陽燭，後一支陰燭實體完全吞噬前一支實體。",
    detect: (input) => Boolean(bearishengulfingpattern(input)),
  },
  {
    id: "evening_star",
    nameZh: "暮星",
    bias: "bearish",
    requiredCount: 3,
    confirmation: "pattern_complete",
    ruleSummary: "長陽燭後出現向上跳空的小實體，第三支陰燭跌穿第一支實體中點。",
    detect: (input) => Boolean(eveningstar(input)),
  },
  {
    id: "dark_cloud_cover",
    nameZh: "烏雲蓋頂",
    bias: "bearish",
    requiredCount: 2,
    confirmation: "shape_only",
    ruleSummary: "陽燭後高開，第二支陰燭收市跌穿前一支實體中點。",
    detect: (input) => Boolean(darkcloudcover(input)),
  },
  {
    id: "hanging_man",
    nameZh: "吊頸線",
    bias: "bearish",
    requiredCount: 5,
    confirmation: "next_bar",
    ruleSummary: "短期上升後出現長下影錘形燭，下一支陰燭收市低於形態燭。",
    detect: (input) => Boolean(hangingman(input)),
  },
  {
    id: "shooting_star",
    nameZh: "射擊之星",
    bias: "bearish",
    requiredCount: 5,
    confirmation: "next_bar",
    ruleSummary: "短期上升後出現長上影倒錘形燭，下一支陰燭收市低於形態燭。",
    detect: (input) => Boolean(shootingstar(input)),
  },
  {
    id: "three_black_crows",
    nameZh: "三黑鴉",
    bias: "bearish",
    requiredCount: 3,
    confirmation: "pattern_complete",
    ruleSummary: "連續三支陰燭逐步創低，後兩支在前一支實體內開市。",
    detect: (input) => Boolean(threeblackcrows(input)),
  },
  {
    id: "doji",
    nameZh: "十字星",
    bias: "neutral",
    requiredCount: 1,
    confirmation: "shape_only",
    ruleSummary: "開市與收市近乎相同，代表當期多空力量暫時平衡。",
    detect: (input) => Boolean(doji(input)),
  },
] as const;

const toPatternInput = (bars: CandlestickBar[]): PatternInput => ({
  open: bars.map((bar) => bar.open),
  high: bars.map((bar) => bar.high),
  low: bars.map((bar) => bar.low),
  close: bars.map((bar) => bar.close),
});

const smaAt = (values: number[], endIndex: number, period: number): number | null => {
  const startIndex = endIndex - period + 1;
  if (startIndex < 0) return null;
  const slice = values.slice(startIndex, endIndex + 1);
  return slice.reduce((sum, value) => sum + value, 0) / period;
};

export const deriveTrendContext = (bars: CandlestickBar[]): CandlestickTrendContext => {
  if (bars.length < 25) return "unavailable";
  const closes = bars.map((bar) => bar.close);
  const lastIndex = closes.length - 1;
  const currentSma20 = smaAt(closes, lastIndex, 20);
  const priorSma20 = smaAt(closes, lastIndex - 5, 20);
  if (currentSma20 === null || priorSma20 === null) return "unavailable";
  const currentClose = closes[lastIndex];
  if (currentClose > currentSma20 && currentSma20 > priorSma20) return "bullish";
  if (currentClose < currentSma20 && currentSma20 < priorSma20) return "bearish";
  return "neutral";
};

const SUPPORT_RESISTANCE_CONFIG: Record<CandlestickInterval, { swingRadius: number; tolerancePercent: number }> = {
  "1d": { swingRadius: 3, tolerancePercent: 0.005 },
  "1wk": { swingRadius: 2, tolerancePercent: 0.01 },
  "1mo": { swingRadius: 2, tolerancePercent: 0.015 },
};

export const analyzeCandlestickBars = (
  bars: CandlestickBar[],
  interval: CandlestickInterval = "1d",
): CandlestickAnalysis => {
  const recentMatches: CandlestickPatternMatch[] = [];

  for (let endIndex = 0; endIndex < bars.length; endIndex += 1) {
    for (const rule of CANDLESTICK_PATTERN_RULES) {
      const startIndex = endIndex - rule.requiredCount + 1;
      if (startIndex < 0) continue;
      const window = bars.slice(startIndex, endIndex + 1);
      if (!rule.detect(toPatternInput(window))) continue;
      recentMatches.push({
        id: rule.id,
        nameZh: rule.nameZh,
        bias: rule.bias,
        startTime: window[0].time,
        endTime: window[window.length - 1].time,
        confirmation: rule.confirmation,
        ruleSummary: rule.ruleSummary,
      });
    }
  }

  const latestTime = bars[bars.length - 1]?.time;
  const latestMatches = latestTime
    ? recentMatches.filter((match) => match.endTime === latestTime)
    : [];
  const hasBullish = latestMatches.some((match) => match.bias === "bullish");
  const hasBearish = latestMatches.some((match) => match.bias === "bearish");
  const patternBias: CandlestickBias = hasBullish === hasBearish
    ? "neutral"
    : hasBullish
      ? "bullish"
      : "bearish";

  return {
    patternBias,
    trendContext: deriveTrendContext(bars),
    latestMatches,
    recentMatches,
    supportResistance: deriveSupportResistanceAnalysis(bars, SUPPORT_RESISTANCE_CONFIG[interval]),
  };
};

const finiteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const dateKeyInTimeZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

const weekKey = (dateKey: string) => {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

const isFormingBar = (input: {
  barDate: Date;
  interval: CandlestickInterval;
  now: Date;
  timeZone: string;
  regularSessionEnd?: number;
}) => {
  const barKey = dateKeyInTimeZone(input.barDate, input.timeZone);
  const nowKey = dateKeyInTimeZone(input.now, input.timeZone);
  if (input.interval === "1d") {
    if (barKey !== nowKey) return false;
    return !input.regularSessionEnd || input.now.getTime() < input.regularSessionEnd * 1_000;
  }
  if (input.interval === "1wk") return weekKey(barKey) === weekKey(nowKey);
  return barKey.slice(0, 7) === nowKey.slice(0, 7);
};

export class CandlestickDataError extends Error {
  constructor(public readonly code: "NO_RESULT" | "MALFORMED_PAYLOAD" | "INSUFFICIENT_BARS" | "YAHOO_TIMEOUT", message: string) {
    super(message);
    this.name = "CandlestickDataError";
  }
}

export const buildCandlestickPatternData = (input: {
  symbol: string;
  interval: CandlestickInterval;
  payload: unknown;
  now?: Date;
}): CandlestickPatternData => {
  const payload = input.payload as any;
  const result = payload?.chart?.result?.[0];
  if (!result) {
    const upstreamMessage = payload?.chart?.error?.description;
    throw new CandlestickDataError("NO_RESULT", upstreamMessage || "Yahoo Finance did not return chart data.");
  }
  const timestamps = result.timestamp;
  const quote = result.indicators?.quote?.[0];
  if (!Array.isArray(timestamps) || !quote || !Array.isArray(quote.open) || !Array.isArray(quote.high)
    || !Array.isArray(quote.low) || !Array.isArray(quote.close) || !Array.isArray(quote.volume)) {
    throw new CandlestickDataError("MALFORMED_PAYLOAD", "Yahoo Finance returned a malformed OHLCV payload.");
  }

  const timeZone = typeof result.meta?.exchangeTimezoneName === "string"
    ? result.meta.exchangeTimezoneName
    : "UTC";
  const regularSessionEnd = finiteNumber(result.meta?.currentTradingPeriod?.regular?.end) || undefined;
  const now = input.now || new Date();
  const byTime = new Map<string, CandlestickBar>();
  let rejectedBarCount = 0;

  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = finiteNumber(timestamps[index]);
    const open = finiteNumber(quote.open[index]);
    const high = finiteNumber(quote.high[index]);
    const low = finiteNumber(quote.low[index]);
    const close = finiteNumber(quote.close[index]);
    const volume = finiteNumber(quote.volume[index]);
    if (timestamp === null || open === null || high === null || low === null || close === null || volume === null
      || timestamp <= 0 || volume < 0 || low > Math.min(open, close) || high < Math.max(open, close) || low > high) {
      rejectedBarCount += 1;
      continue;
    }
    const time = new Date(timestamp * 1_000).toISOString().slice(0, 10);
    if (byTime.has(time)) rejectedBarCount += 1;
    byTime.set(time, { time, open, high, low, close, volume });
  }

  let bars = [...byTime.values()].sort((left, right) => left.time.localeCompare(right.time));
  const beforePartialFilter = bars.length;
  bars = bars.filter((bar) => !isFormingBar({
    barDate: new Date(`${bar.time}T12:00:00.000Z`),
    interval: input.interval,
    now,
    timeZone,
    regularSessionEnd,
  }));
  const partialBarExcluded = bars.length < beforePartialFilter;
  bars = bars.slice(-120);
  if (bars.length < 5) {
    throw new CandlestickDataError("INSUFFICIENT_BARS", `Only ${bars.length} completed bars were available; at least 5 are required.`);
  }

  return {
    schemaVersion: CANDLESTICK_SCHEMA_VERSION,
    symbol: input.symbol.trim().toUpperCase(),
    interval: input.interval,
    source: "Yahoo Finance chart API",
    sourceAsOf: bars[bars.length - 1].time,
    exchangeTimezone: timeZone,
    partialBarExcluded,
    rejectedBarCount,
    bars,
    analysis: analyzeCandlestickBars(bars, input.interval),
  };
};
