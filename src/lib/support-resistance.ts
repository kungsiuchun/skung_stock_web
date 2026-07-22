export type SupportResistanceRole = "support" | "resistance";
export type SupportResistanceTouchType = "high" | "low" | "mixed";

export interface SupportResistanceCandle {
  time: string;
  high: number;
  low: number;
  close: number;
}

export interface SupportResistanceZone {
  id: string;
  role: SupportResistanceRole;
  price: number;
  lowerBound: number;
  upperBound: number;
  touchCount: number;
  lastTouchTime: string;
  distancePct: number;
  touchType: SupportResistanceTouchType;
}

export interface SupportResistanceDisplayLevels {
  nearestSupport: SupportResistanceZone | null;
  majorSupport: SupportResistanceZone | null;
  nearestResistance: SupportResistanceZone | null;
  majorResistance: SupportResistanceZone | null;
}

export interface SupportResistanceAnalysis {
  method: "swing_cluster";
  lookbackBars: number;
  latestClose: number;
  zones: SupportResistanceZone[];
  displayLevels: SupportResistanceDisplayLevels;
}

interface SwingPoint {
  index: number;
  time: string;
  price: number;
  type: "high" | "low";
}

export interface SupportResistanceOptions {
  swingRadius: number;
  tolerancePercent: number;
  minBars?: number;
  minTouches?: number;
}

const round = (value: number, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const isValidCandle = (candle: SupportResistanceCandle) => (
  typeof candle.time === "string"
  && candle.time.length > 0
  && [candle.high, candle.low, candle.close].every(Number.isFinite)
  && candle.low <= candle.close
  && candle.high >= candle.close
  && candle.low <= candle.high
);

export const findSupportResistanceSwingPoints = (
  candles: SupportResistanceCandle[],
  radius: number,
): SwingPoint[] => {
  const resolvedRadius = Math.max(1, Math.floor(radius));
  const points: SwingPoint[] = [];

  for (let index = resolvedRadius; index < candles.length - resolvedRadius; index += 1) {
    const candle = candles[index];
    const neighbours = candles.slice(index - resolvedRadius, index + resolvedRadius + 1)
      .filter((_, offset) => offset !== resolvedRadius);
    const isHigh = neighbours.every((other) => candle.high >= other.high)
      && neighbours.some((other) => candle.high > other.high);
    const isLow = neighbours.every((other) => candle.low <= other.low)
      && neighbours.some((other) => candle.low < other.low);
    if (isHigh) points.push({ index, time: candle.time, price: candle.high, type: "high" });
    if (isLow) points.push({ index, time: candle.time, price: candle.low, type: "low" });
  }

  return points;
};

const byNearest = (left: SupportResistanceZone, right: SupportResistanceZone) => (
  Math.abs(left.distancePct) - Math.abs(right.distancePct)
  || right.touchCount - left.touchCount
  || right.lastTouchTime.localeCompare(left.lastTouchTime)
);

const byMajor = (left: SupportResistanceZone, right: SupportResistanceZone) => (
  right.touchCount - left.touchCount
  || right.lastTouchTime.localeCompare(left.lastTouchTime)
  || Math.abs(left.distancePct) - Math.abs(right.distancePct)
);

export const selectSupportResistanceDisplayLevels = (
  zones: SupportResistanceZone[],
): SupportResistanceDisplayLevels => {
  const supports = zones.filter((zone) => zone.role === "support").sort(byNearest);
  const resistances = zones.filter((zone) => zone.role === "resistance").sort(byNearest);
  const nearestSupport = supports[0] || null;
  const nearestResistance = resistances[0] || null;
  const majorSupport = supports.filter((zone) => zone.id !== nearestSupport?.id).sort(byMajor)[0] || null;
  const majorResistance = resistances.filter((zone) => zone.id !== nearestResistance?.id).sort(byMajor)[0] || null;

  return { nearestSupport, majorSupport, nearestResistance, majorResistance };
};

export const deriveSupportResistanceAnalysis = (
  input: SupportResistanceCandle[],
  options: SupportResistanceOptions,
): SupportResistanceAnalysis => {
  const candles = input.filter(isValidCandle);
  const latestClose = candles[candles.length - 1]?.close || 0;
  const empty = (): SupportResistanceAnalysis => ({
    method: "swing_cluster",
    lookbackBars: candles.length,
    latestClose,
    zones: [],
    displayLevels: selectSupportResistanceDisplayLevels([]),
  });
  if (candles.length < (options.minBars ?? 20) || latestClose <= 0) return empty();

  const tolerancePercent = Math.max(0.0001, options.tolerancePercent);
  const points = findSupportResistanceSwingPoints(candles, options.swingRadius)
    .sort((left, right) => left.price - right.price || left.index - right.index);
  const clusters: SwingPoint[][] = [];
  let current: SwingPoint[] = [];
  for (const point of points) {
    if (current.length === 0) {
      current = [point];
      continue;
    }
    const average = current.reduce((sum, item) => sum + item.price, 0) / current.length;
    if (Math.abs(point.price - average) / average <= tolerancePercent) {
      current.push(point);
    } else {
      clusters.push(current);
      current = [point];
    }
  }
  if (current.length > 0) clusters.push(current);

  const zones = clusters
    .filter((cluster) => cluster.length >= (options.minTouches ?? 2))
    .map((cluster, index) => {
      const prices = cluster.map((point) => point.price);
      const price = prices.reduce((sum, value) => sum + value, 0) / prices.length;
      const padding = price * tolerancePercent / 4;
      const highTouches = cluster.filter((point) => point.type === "high").length;
      const lowTouches = cluster.length - highTouches;
      const role: SupportResistanceRole = price <= latestClose ? "support" : "resistance";
      const touchType: SupportResistanceTouchType = highTouches > 0 && lowTouches > 0
        ? "mixed"
        : highTouches > 0
          ? "high"
          : "low";
      return {
        id: `zone-${index}-${round(price, 4)}`,
        role,
        price: round(price),
        lowerBound: round(Math.min(...prices) - padding),
        upperBound: round(Math.max(...prices) + padding),
        touchCount: cluster.length,
        lastTouchTime: cluster.reduce((latest, point) => point.time > latest ? point.time : latest, ""),
        distancePct: round(((price - latestClose) / latestClose) * 100, 2),
        touchType,
      } satisfies SupportResistanceZone;
    })
    .sort((left, right) => left.price - right.price);

  return {
    method: "swing_cluster",
    lookbackBars: candles.length,
    latestClose,
    zones,
    displayLevels: selectSupportResistanceDisplayLevels(zones),
  };
};
