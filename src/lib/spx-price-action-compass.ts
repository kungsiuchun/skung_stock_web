export type SpxPriceActionTimeframe = "1m" | "5m" | "15m" | "4h" | "1d";

export type SpxPriceActionPatternType =
  | "PIN_BAR_BULLISH"
  | "PIN_BAR_BEARISH"
  | "ENGULFING_BULLISH"
  | "ENGULFING_BEARISH"
  | "MORNING_STAR"
  | "EVENING_STAR"
  | "DOJI"
  | "INSIDE_BAR"
  | "DOUBLE_TOP"
  | "DOUBLE_BOTTOM"
  | "HEAD_AND_SHOULDERS"
  | "INVERSE_HEAD_AND_SHOULDERS"
  | "TRIANGLE_ASCENDING"
  | "TRIANGLE_DESCENDING"
  | "TRIANGLE_SYMMETRICAL";

export interface SpxPriceActionCandle {
  time: number;
  date_iso: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SpxPriceActionPattern {
  id: string;
  type: SpxPriceActionPatternType;
  name: string;
  label: string;
  category: "candle" | "structure" | "compression";
  direction: "bullish" | "bearish" | "neutral";
  candleIndices: number[];
  fromIndex: number;
  toIndex: number;
  price: number;
  confidence: number;
  description: string;
}

export const sortSpxPriceActionPatternsLatestFirst = (
  patterns: readonly SpxPriceActionPattern[],
): SpxPriceActionPattern[] => [...patterns].sort((a, b) =>
  b.toIndex - a.toIndex
  || b.fromIndex - a.fromIndex
  || b.confidence - a.confidence
  || a.id.localeCompare(b.id));

export interface SpxChartClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const projectSpxChartClientPoint = (input: {
  clientX: number;
  clientY: number;
  rect: SpxChartClientRect;
  viewBoxWidth: number;
  viewBoxHeight: number;
}) => {
  const renderedWidth = Math.max(1, input.rect.width);
  const renderedHeight = Math.max(1, input.rect.height);
  const rawX = (input.clientX - input.rect.left) * input.viewBoxWidth / renderedWidth;
  const rawY = (input.clientY - input.rect.top) * input.viewBoxHeight / renderedHeight;
  return {
    x: Math.max(0, Math.min(input.viewBoxWidth, rawX)),
    y: Math.max(0, Math.min(input.viewBoxHeight, rawY)),
    scaleX: input.viewBoxWidth / renderedWidth,
    scaleY: input.viewBoxHeight / renderedHeight,
  };
};

export interface SpxPriceActionZone {
  id: string;
  type: "support" | "resistance" | "flip";
  price: number;
  minPrice: number;
  maxPrice: number;
  strength: number;
  touches: Array<{ index: number; price: number; type: "high" | "low" }>;
  distanceToLastPercent: number;
}

export interface SpxPriceActionTrendLabel {
  index: number;
  label: "HH" | "HL" | "LH" | "LL";
  price: number;
}

export interface SpxPriceActionTrend {
  direction: "UP" | "DOWN" | "SIDEWAYS";
  strength: number;
  labels: SpxPriceActionTrendLabel[];
}

export interface SpxPriceActionSummary {
  latestClose: number | null;
  latestChange: number | null;
  latestChangePercent: number | null;
  nearestSupport: SpxPriceActionZone | null;
  nearestResistance: SpxPriceActionZone | null;
  latestPattern: SpxPriceActionPattern | null;
  patternCounts: Partial<Record<SpxPriceActionPatternType, number>>;
}

export interface SpxPriceActionSource {
  provider: "yahoo" | "test";
  label: string;
  symbol: string;
  range: string;
  interval: string;
  fetchedAt: string;
  note: string;
}

export interface SpxPriceActionCompassResponse {
  ticker: "SPX";
  timeframe: SpxPriceActionTimeframe;
  availableTimeframes: SpxPriceActionTimeframe[];
  candles: SpxPriceActionCandle[];
  patterns: SpxPriceActionPattern[];
  zones: SpxPriceActionZone[];
  trend: SpxPriceActionTrend;
  summary: SpxPriceActionSummary;
  source: SpxPriceActionSource;
  warnings: string[];
}

export interface SpxPriceActionFetchConfig {
  timeframe: SpxPriceActionTimeframe;
  yahooInterval: "1m" | "5m" | "15m" | "1h" | "1d";
  yahooRange: string;
  maxCandles: number;
  aggregateTo?: SpxPriceActionTimeframe;
  zoneWindow: number;
  swingStrength: number;
  zoneTolerancePercent: number;
}

const AVAILABLE_TIMEFRAMES: SpxPriceActionTimeframe[] = ["1m", "5m", "15m", "4h", "1d"];

const PATTERN_LABELS: Record<SpxPriceActionPatternType, string> = {
  PIN_BAR_BULLISH: "Bullish Pin Bar",
  PIN_BAR_BEARISH: "Bearish Pin Bar",
  ENGULFING_BULLISH: "Bullish Engulfing",
  ENGULFING_BEARISH: "Bearish Engulfing",
  MORNING_STAR: "Morning Star",
  EVENING_STAR: "Evening Star",
  DOJI: "Doji",
  INSIDE_BAR: "Inside Bar",
  DOUBLE_TOP: "Double Top",
  DOUBLE_BOTTOM: "Double Bottom",
  HEAD_AND_SHOULDERS: "Head & Shoulders",
  INVERSE_HEAD_AND_SHOULDERS: "Inverse Head & Shoulders",
  TRIANGLE_ASCENDING: "Ascending Triangle",
  TRIANGLE_DESCENDING: "Descending Triangle",
  TRIANGLE_SYMMETRICAL: "Symmetrical Triangle",
};

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export const normalizeSpxPriceActionTimeframe = (value: string | null | undefined): SpxPriceActionTimeframe => {
  return AVAILABLE_TIMEFRAMES.includes(value as SpxPriceActionTimeframe) ? value as SpxPriceActionTimeframe : "5m";
};

export const getSpxPriceActionFetchConfig = (timeframe: SpxPriceActionTimeframe): SpxPriceActionFetchConfig => {
  switch (timeframe) {
    case "1m":
      return { timeframe, yahooInterval: "1m", yahooRange: "7d", maxCandles: 900, zoneWindow: 390, swingStrength: 5, zoneTolerancePercent: 0.001 };
    case "15m":
      return { timeframe, yahooInterval: "15m", yahooRange: "60d", maxCandles: 1200, zoneWindow: 220, swingStrength: 5, zoneTolerancePercent: 0.002 };
    case "4h":
      return { timeframe, yahooInterval: "1h", yahooRange: "1y", maxCandles: 700, aggregateTo: "4h", zoneWindow: 300, swingStrength: 5, zoneTolerancePercent: 0.004 };
    case "1d":
      return { timeframe, yahooInterval: "1d", yahooRange: "3y", maxCandles: 900, zoneWindow: 750, swingStrength: 6, zoneTolerancePercent: 0.005 };
    case "5m":
    default:
      return { timeframe: "5m", yahooInterval: "5m", yahooRange: "60d", maxCandles: 1500, zoneWindow: 180, swingStrength: 4, zoneTolerancePercent: 0.0015 };
  }
};

export const toSpxPriceActionCandles = (
  rows: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>,
): SpxPriceActionCandle[] => {
  return rows
    .map((row) => {
      const time = Date.parse(row.date.includes("T") ? row.date : `${row.date}T00:00:00Z`);
      return {
        time,
        date_iso: new Date(time).toISOString().slice(0, 10),
        open: round(row.open),
        high: round(row.high),
        low: round(row.low),
        close: round(row.close),
        volume: Math.max(0, Math.round(row.volume || 0)),
      };
    })
    .filter((row) =>
      Number.isFinite(row.time) &&
      row.open > 0 &&
      row.high >= row.low &&
      row.high >= Math.max(row.open, row.close) &&
      row.low <= Math.min(row.open, row.close)
    )
    .sort((a, b) => a.time - b.time);
};

export const aggregateSpxPriceActionCandles = (
  candles: SpxPriceActionCandle[],
  timeframe: SpxPriceActionTimeframe,
): SpxPriceActionCandle[] => {
  if (timeframe !== "4h") return candles;
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const aggregated: SpxPriceActionCandle[] = [];
  for (let index = 0; index < sorted.length; index += 4) {
    const chunk = sorted.slice(index, index + 4);
    if (chunk.length === 0) continue;
    aggregated.push({
      time: chunk[0].time,
      date_iso: chunk[0].date_iso,
      open: chunk[0].open,
      high: round(Math.max(...chunk.map((row) => row.high))),
      low: round(Math.min(...chunk.map((row) => row.low))),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((sum, row) => sum + row.volume, 0),
    });
  }
  return aggregated;
};

const getAverageRanges = (candles: SpxPriceActionCandle[], period = 14) => {
  const ranges: number[] = [];
  let sum = 0;
  for (let index = 0; index < candles.length; index += 1) {
    const range = Math.max(0, candles[index].high - candles[index].low);
    if (index < period) {
      sum += range;
      ranges.push(sum / (index + 1));
    } else {
      sum = sum - Math.max(0, candles[index - period].high - candles[index - period].low) + range;
      ranges.push(sum / period);
    }
  }
  return ranges;
};

export const findSpxPriceActionSwingPoints = (
  candles: SpxPriceActionCandle[],
  leftStrength = 5,
  rightStrength = 5,
) => {
  const highs: Array<{ index: number; price: number }> = [];
  const lows: Array<{ index: number; price: number }> = [];

  for (let index = leftStrength; index < candles.length - rightStrength; index += 1) {
    const high = candles[index].high;
    const low = candles[index].low;
    let isHigh = true;
    let isLow = true;

    for (let offset = 1; offset <= leftStrength; offset += 1) {
      if (candles[index - offset].high >= high) isHigh = false;
      if (candles[index - offset].low <= low) isLow = false;
    }

    for (let offset = 1; offset <= rightStrength; offset += 1) {
      if (candles[index + offset].high > high) isHigh = false;
      if (candles[index + offset].low < low) isLow = false;
    }

    if (isHigh) highs.push({ index, price: high });
    if (isLow) lows.push({ index, price: low });
  }

  return { highs, lows };
};

export const deriveSpxPriceActionTrend = (candles: SpxPriceActionCandle[]): SpxPriceActionTrend => {
  if (candles.length < 10) return { direction: "SIDEWAYS", strength: 35, labels: [] };
  const { highs, lows } = findSpxPriceActionSwingPoints(candles, 4, 4);
  const labels: SpxPriceActionTrendLabel[] = [];

  for (let index = 1; index < highs.length; index += 1) {
    labels.push({
      index: highs[index].index,
      label: highs[index].price > highs[index - 1].price ? "HH" : "LH",
      price: highs[index].price,
    });
  }

  for (let index = 1; index < lows.length; index += 1) {
    labels.push({
      index: lows[index].index,
      label: lows[index].price > lows[index - 1].price ? "HL" : "LL",
      price: lows[index].price,
    });
  }

  const windowSize = Math.min(50, candles.length - 1);
  const firstClose = candles[candles.length - windowSize - 1].close;
  const latestClose = candles[candles.length - 1].close;
  const slopePercent = firstClose > 0 ? (latestClose - firstClose) / firstClose : 0;
  const recentLabels = labels.filter((label) => label.index >= candles.length - Math.min(80, candles.length));
  const bullishStructure = recentLabels.filter((label) => label.label === "HH" || label.label === "HL").length;
  const bearishStructure = recentLabels.filter((label) => label.label === "LH" || label.label === "LL").length;

  let direction: SpxPriceActionTrend["direction"] = "SIDEWAYS";
  if (slopePercent > 0.003 || bullishStructure >= bearishStructure + 2) direction = "UP";
  if (slopePercent < -0.003 || bearishStructure >= bullishStructure + 2) direction = "DOWN";

  const strength = Math.max(
    20,
    Math.min(100, Math.round(35 + Math.abs(slopePercent) * 8000 + Math.abs(bullishStructure - bearishStructure) * 7)),
  );

  return { direction, strength, labels: labels.sort((a, b) => a.index - b.index) };
};

export const deriveSpxSupportResistanceZones = (
  candles: SpxPriceActionCandle[],
  options: { swingStrength?: number; tolerancePercent?: number; maxZones?: number } = {},
): SpxPriceActionZone[] => {
  if (candles.length === 0) return [];
  const swingStrength = options.swingStrength ?? 5;
  const tolerancePercent = options.tolerancePercent ?? 0.0015;
  const { highs, lows } = findSpxPriceActionSwingPoints(candles, swingStrength, swingStrength);
  const latestClose = candles[candles.length - 1]?.close ?? 0;
  const points = [
    ...highs.map((point) => ({ ...point, type: "high" as const })),
    ...lows.map((point) => ({ ...point, type: "low" as const })),
  ].sort((a, b) => a.price - b.price);

  const clusters: typeof points[] = [];
  let currentCluster: typeof points = [];
  for (const point of points) {
    if (currentCluster.length === 0) {
      currentCluster.push(point);
      continue;
    }
    const avg = currentCluster.reduce((sum, item) => sum + item.price, 0) / currentCluster.length;
    if (Math.abs(point.price - avg) / avg <= tolerancePercent) {
      currentCluster.push(point);
    } else {
      clusters.push(currentCluster);
      currentCluster = [point];
    }
  }
  if (currentCluster.length > 0) clusters.push(currentCluster);

  return clusters
    .map((cluster, index) => {
      const prices = cluster.map((point) => point.price);
      const avgPrice = prices.reduce((sum, price) => sum + price, 0) / Math.max(1, prices.length);
      const highTouches = cluster.filter((point) => point.type === "high").length;
      const lowTouches = cluster.filter((point) => point.type === "low").length;
      const type = highTouches > 0 && lowTouches === 0 ? "resistance" : lowTouches > 0 && highTouches === 0 ? "support" : "flip";
      const bandPadding = Math.max(0.25, avgPrice * 0.00045);
      return {
        id: `zone-${index}-${Math.round(avgPrice)}`,
        type,
        price: round(avgPrice),
        minPrice: round(Math.min(...prices) - bandPadding),
        maxPrice: round(Math.max(...prices) + bandPadding),
        strength: cluster.length,
        touches: cluster.map((point) => ({ index: point.index, price: round(point.price), type: point.type })),
        distanceToLastPercent: latestClose > 0 ? round(((avgPrice - latestClose) / latestClose) * 100, 2) : 0,
      } satisfies SpxPriceActionZone;
    })
    .filter((zone) => zone.strength >= 2)
    .sort((a, b) => b.strength - a.strength || Math.abs(a.distanceToLastPercent) - Math.abs(b.distanceToLastPercent))
    .slice(0, options.maxZones ?? 8);
};

const categoryForPattern = (type: SpxPriceActionPatternType): SpxPriceActionPattern["category"] => {
  if (type.includes("TRIANGLE")) return "compression";
  if (type.includes("DOUBLE") || type.includes("SHOULDERS")) return "structure";
  return "candle";
};

const directionForPattern = (type: SpxPriceActionPatternType): SpxPriceActionPattern["direction"] => {
  if (type.includes("BULLISH") || type.includes("BOTTOM") || type === "MORNING_STAR" || type === "INVERSE_HEAD_AND_SHOULDERS" || type === "TRIANGLE_ASCENDING") return "bullish";
  if (type.includes("BEARISH") || type.includes("TOP") || type === "EVENING_STAR" || type === "HEAD_AND_SHOULDERS" || type === "TRIANGLE_DESCENDING") return "bearish";
  return "neutral";
};

export const detectSpxPriceActionPatterns = (candles: SpxPriceActionCandle[]): SpxPriceActionPattern[] => {
  const patterns = new Map<string, SpxPriceActionPattern>();
  const averageRanges = getAverageRanges(candles);
  const { highs, lows } = findSpxPriceActionSwingPoints(candles, 6, 6);

  const addPattern = (
    type: SpxPriceActionPatternType,
    indices: number[],
    price: number,
    confidence: number,
    description: string,
  ) => {
    if (indices.length === 0 || !isFiniteNumber(price)) return;
    const fromIndex = Math.min(...indices);
    const toIndex = Math.max(...indices);
    const id = `${type}-${fromIndex}-${toIndex}`;
    patterns.set(id, {
      id,
      type,
      name: PATTERN_LABELS[type],
      label: PATTERN_LABELS[type],
      category: categoryForPattern(type),
      direction: directionForPattern(type),
      candleIndices: indices,
      fromIndex,
      toIndex,
      price: round(price),
      confidence: round(Math.max(0, Math.min(1, confidence)), 2),
      description,
    });
  };

  for (let index = 2; index < candles.length; index += 1) {
    const candle = candles[index];
    const previous = candles[index - 1];
    const previous2 = candles[index - 2];
    const range = candle.high - candle.low;
    if (range <= 0) continue;
    const body = Math.abs(candle.close - candle.open);
    const upperShadow = candle.high - Math.max(candle.open, candle.close);
    const lowerShadow = Math.min(candle.open, candle.close) - candle.low;
    const bodyRatio = body / range;
    const averageRange = Math.max(0.01, averageRanges[index] || range);

    if (bodyRatio < 0.08 && range > averageRange * 0.2) {
      addPattern("DOJI", [index], candle.close, 0.6, "Open and close are nearly equal, showing a two-sided stall near the current level.");
    }

    if (range > averageRange * 0.4) {
      if (lowerShadow > range * 0.6 && upperShadow < range * 0.15 && bodyRatio < 0.3) {
        addPattern("PIN_BAR_BULLISH", [index], candle.low, Math.min(1, lowerShadow / range), "Long lower wick with small body; buyers rejected lower prices.");
      }
      if (upperShadow > range * 0.6 && lowerShadow < range * 0.15 && bodyRatio < 0.3) {
        addPattern("PIN_BAR_BEARISH", [index], candle.high, Math.min(1, upperShadow / range), "Long upper wick with small body; sellers rejected higher prices.");
      }
    }

    if (candle.high < previous.high && candle.low > previous.low) {
      addPattern("INSIDE_BAR", [index - 1, index], candle.close, 0.72, "Range contracted fully inside the previous candle; breakout risk is compressed.");
    }

    const previousBody = Math.abs(previous.close - previous.open);
    if (body > previousBody && range > averageRange * 0.3) {
      if (previous.close < previous.open && candle.close > candle.open && candle.open <= previous.close && candle.close >= previous.open) {
        addPattern("ENGULFING_BULLISH", [index - 1, index], candle.low, 0.85, "Bullish body fully engulfed the prior bearish body.");
      }
      if (previous.close > previous.open && candle.close < candle.open && candle.open >= previous.close && candle.close <= previous.open) {
        addPattern("ENGULFING_BEARISH", [index - 1, index], candle.high, 0.85, "Bearish body fully engulfed the prior bullish body.");
      }
    }

    const previous2Body = Math.abs(previous2.close - previous2.open);
    if (previous2Body > averageRange * 0.5) {
      const middleBody = Math.abs(previous.close - previous.open);
      if (
        previous2.close < previous2.open &&
        middleBody < averageRange * 0.3 &&
        candle.close > candle.open &&
        candle.close > (previous2.open + previous2.close) / 2
      ) {
        addPattern("MORNING_STAR", [index - 2, index - 1, index], candle.low, 0.88, "Three-candle bullish reversal: selloff, small indecision bar, then recovery through the first body.");
      }
      if (
        previous2.close > previous2.open &&
        middleBody < averageRange * 0.3 &&
        candle.close < candle.open &&
        candle.close < (previous2.open + previous2.close) / 2
      ) {
        addPattern("EVENING_STAR", [index - 2, index - 1, index], candle.high, 0.88, "Three-candle bearish reversal: rally, small indecision bar, then rejection through the first body.");
      }
    }
  }

  for (let index = 1; index < highs.length; index += 1) {
    const previousHigh = highs[index - 1];
    const currentHigh = highs[index];
    const priceDiff = Math.abs(currentHigh.price - previousHigh.price) / previousHigh.price;
    const distance = currentHigh.index - previousHigh.index;
    if (priceDiff < 0.0012 && distance >= 8 && distance <= 45) {
      const indices = Array.from({ length: distance + 1 }, (_, offset) => previousHigh.index + offset);
      addPattern("DOUBLE_TOP", indices, currentHigh.price, 0.8, "Two swing highs formed at nearly the same level with a tradable valley between them.");
    }
  }

  for (let index = 1; index < lows.length; index += 1) {
    const previousLow = lows[index - 1];
    const currentLow = lows[index];
    const priceDiff = Math.abs(currentLow.price - previousLow.price) / previousLow.price;
    const distance = currentLow.index - previousLow.index;
    if (priceDiff < 0.0012 && distance >= 8 && distance <= 45) {
      const indices = Array.from({ length: distance + 1 }, (_, offset) => previousLow.index + offset);
      addPattern("DOUBLE_BOTTOM", indices, currentLow.price, 0.8, "Two swing lows formed at nearly the same level with a tradable peak between them.");
    }
  }

  for (let index = 2; index < highs.length; index += 1) {
    const left = highs[index - 2];
    const head = highs[index - 1];
    const right = highs[index];
    if (
      head.price > left.price &&
      head.price > right.price &&
      Math.abs(left.price - right.price) / left.price < 0.002 &&
      head.index - left.index >= 6 &&
      right.index - head.index >= 6
    ) {
      const indices = Array.from({ length: right.index - left.index + 1 }, (_, offset) => left.index + offset);
      addPattern("HEAD_AND_SHOULDERS", indices, head.price, 0.84, "Three-peak topping structure with the center high above two similar shoulders.");
    }
  }

  for (let index = 2; index < lows.length; index += 1) {
    const left = lows[index - 2];
    const head = lows[index - 1];
    const right = lows[index];
    if (
      head.price < left.price &&
      head.price < right.price &&
      Math.abs(left.price - right.price) / left.price < 0.002 &&
      head.index - left.index >= 6 &&
      right.index - head.index >= 6
    ) {
      const indices = Array.from({ length: right.index - left.index + 1 }, (_, offset) => left.index + offset);
      addPattern("INVERSE_HEAD_AND_SHOULDERS", indices, head.price, 0.84, "Three-trough basing structure with the center low below two similar shoulders.");
    }
  }

  if (highs.length >= 3 && lows.length >= 3) {
    const recentHighs = highs.slice(-3);
    const recentLows = lows.slice(-3);
    const highSlope = (recentHighs[2].price - recentHighs[0].price) / Math.max(1, recentHighs[2].index - recentHighs[0].index);
    const lowSlope = (recentLows[2].price - recentLows[0].price) / Math.max(1, recentLows[2].index - recentLows[0].index);
    const startIndex = Math.min(recentHighs[0].index, recentLows[0].index);
    const endIndex = Math.max(recentHighs[2].index, recentLows[2].index);
    const indices = Array.from({ length: endIndex - startIndex + 1 }, (_, offset) => startIndex + offset);

    if (highSlope < -0.01 && lowSlope > 0.01) {
      addPattern("TRIANGLE_SYMMETRICAL", indices, (recentHighs[2].price + recentLows[2].price) / 2, 0.7, "Lower highs and higher lows are compressing into a symmetrical triangle.");
    } else if (Math.abs(highSlope) < 0.015 && lowSlope > 0.02) {
      addPattern("TRIANGLE_ASCENDING", indices, recentHighs[2].price, 0.74, "Flat upper boundary with rising lows; buyers are pressing into resistance.");
    } else if (highSlope < -0.02 && Math.abs(lowSlope) < 0.015) {
      addPattern("TRIANGLE_DESCENDING", indices, recentLows[2].price, 0.74, "Falling highs above a flat lower boundary; sellers are pressing support.");
    }
  }

  return Array.from(patterns.values()).sort((a, b) => b.confidence - a.confidence || b.toIndex - a.toIndex);
};

const buildPatternCounts = (patterns: SpxPriceActionPattern[]) => {
  return patterns.reduce((counts, pattern) => {
    counts[pattern.type] = (counts[pattern.type] || 0) + 1;
    return counts;
  }, {} as Record<SpxPriceActionPatternType, number>);
};

export const buildSpxPriceActionCompassResponse = (input: {
  timeframe: SpxPriceActionTimeframe;
  candles: SpxPriceActionCandle[];
  source: SpxPriceActionSource;
  warnings?: string[];
}): SpxPriceActionCompassResponse => {
  const config = getSpxPriceActionFetchConfig(input.timeframe);
  const candles = input.candles.slice(-config.maxCandles);
  const zoneCandles = candles.slice(-Math.min(config.zoneWindow, candles.length));
  const patterns = detectSpxPriceActionPatterns(candles);
  const zones = deriveSpxSupportResistanceZones(zoneCandles, {
    swingStrength: config.swingStrength,
    tolerancePercent: config.zoneTolerancePercent,
  });
  const trend = deriveSpxPriceActionTrend(candles);
  const latest = candles[candles.length - 1] || null;
  const previous = candles[candles.length - 2] || null;
  const latestChange = latest && previous ? round(latest.close - previous.close) : null;
  const latestChangePercent = latest && previous && previous.close > 0 ? round(((latest.close - previous.close) / previous.close) * 100, 2) : null;
  const below = zones.filter((zone) => latest && zone.price <= latest.close).sort((a, b) => Math.abs(a.price - latest!.close) - Math.abs(b.price - latest!.close));
  const above = zones.filter((zone) => latest && zone.price >= latest.close).sort((a, b) => Math.abs(a.price - latest!.close) - Math.abs(b.price - latest!.close));

  return {
    ticker: "SPX",
    timeframe: input.timeframe,
    availableTimeframes: AVAILABLE_TIMEFRAMES,
    candles,
    patterns,
    zones,
    trend,
    summary: {
      latestClose: latest?.close ?? null,
      latestChange,
      latestChangePercent,
      nearestSupport: below[0] || null,
      nearestResistance: above[0] || null,
      latestPattern: [...patterns].sort((a, b) => b.toIndex - a.toIndex || b.confidence - a.confidence)[0] || null,
      patternCounts: buildPatternCounts(patterns),
    },
    source: input.source,
    warnings: input.warnings || [],
  };
};
