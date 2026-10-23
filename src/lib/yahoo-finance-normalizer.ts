export interface YahooOhlcvBar {
  index: number;
  timestamp: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface YahooChartNormalization {
  bars: YahooOhlcvBar[];
  rejectedBarCount: number;
  lastValidDate: string | null;
  malformedPayload: boolean;
}

export interface FinanceChartPoint {
  date?: unknown;
  date_iso?: unknown;
  time?: unknown;
  price?: unknown;
  close?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  volume?: unknown;
}

export interface NormalizedFinanceChartPoint {
  date: string;
  date_iso: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

export const isStrictFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export const isValidIsoDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
};

export const isValidIsoTimestamp = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

export const normalizeYahooChartResult = (payload: unknown): YahooChartNormalization => {
  const result = (payload as { chart?: { result?: unknown[] } } | null)?.chart?.result?.[0] as {
    timestamp?: unknown;
    indicators?: { quote?: unknown[] };
  } | undefined;
  const quote = result?.indicators?.quote?.[0] as {
    open?: unknown;
    high?: unknown;
    low?: unknown;
    close?: unknown;
    volume?: unknown;
  } | undefined;
  const timestamps = result?.timestamp;
  const opens = quote?.open;
  const highs = quote?.high;
  const lows = quote?.low;
  const closes = quote?.close;
  const volumes = quote?.volume;
  if (!Array.isArray(timestamps) || !Array.isArray(opens) || !Array.isArray(highs)
    || !Array.isArray(lows) || !Array.isArray(closes) || !Array.isArray(volumes)) {
    return { bars: [], rejectedBarCount: 0, lastValidDate: null, malformedPayload: true };
  }

  const rowCount = Math.max(timestamps.length, opens.length, highs.length, lows.length, closes.length, volumes.length);
  const bars: YahooOhlcvBar[] = [];
  const seenDates = new Set<string>();
  let rejectedBarCount = 0;
  for (let index = 0; index < rowCount; index += 1) {
    const timestamp = timestamps[index];
    const open = opens[index];
    const high = highs[index];
    const low = lows[index];
    const close = closes[index];
    const volume = volumes[index];
    if (![timestamp, open, high, low, close, volume].every(isStrictFiniteNumber)) {
      rejectedBarCount += 1;
      continue;
    }
    if (timestamp <= 0 || Math.min(open, high, low, close) <= 0 || volume < 0) {
      rejectedBarCount += 1;
      continue;
    }
    const barDate = new Date(timestamp * 1_000);
    if (!Number.isFinite(barDate.getTime())) {
      rejectedBarCount += 1;
      continue;
    }
    const date = barDate.toISOString().slice(0, 10);
    if (!isValidIsoDate(date) || low > Math.min(open, close) || high < Math.max(open, close) || seenDates.has(date)) {
      rejectedBarCount += 1;
      continue;
    }
    seenDates.add(date);
    bars.push({ index, timestamp, date, open, high, low, close, volume });
  }

  bars.sort((left, right) => left.timestamp - right.timestamp);
  return {
    bars,
    rejectedBarCount,
    lastValidDate: bars.at(-1)?.date || null,
    malformedPayload: false,
  };
};

export const reportYahooChartValidation = (symbol: string, result: YahooChartNormalization) => {
  if (result.rejectedBarCount > 0) {
    console.warn("[FinanceOHLCValidation]", JSON.stringify({ symbol, rejectedBarCount: result.rejectedBarCount, lastValidDate: result.lastValidDate }));
  }
};

export const isYahooDailyBarForming = (payload: unknown, barDate: string, now = new Date()) => {
  const result = (payload as { chart?: { result?: unknown[] } } | null)?.chart?.result?.[0] as {
    meta?: { currentTradingPeriod?: { regular?: { end?: unknown } } };
  } | undefined;
  if (barDate !== now.toISOString().slice(0, 10)) return false;
  const rawRegularEnd = result?.meta?.currentTradingPeriod?.regular?.end;
  if (!isStrictFiniteNumber(rawRegularEnd) || rawRegularEnd <= 0) return true;
  const regularEnd = new Date(rawRegularEnd * 1_000);
  if (!Number.isFinite(regularEnd.getTime())) return true;
  return now.getTime() < regularEnd.getTime();
};

export const filterYahooFormingDailyBars = (payload: unknown, bars: YahooOhlcvBar[], now = new Date()) => {
  const completedBars = bars.filter((bar) => !isYahooDailyBarForming(payload, bar.date, now));
  return { bars: completedBars, partialBarExcluded: completedBars.length < bars.length };
};

export const normalizeFinanceChartPoint = (value: unknown): NormalizedFinanceChartPoint | null => {
  if (!record(value)) return null;
  const point = value as FinanceChartPoint;
  if ((point.date_iso !== undefined && !isValidIsoDate(point.date_iso))
    || (point.time !== undefined && !isValidIsoDate(point.time))
    || (point.date_iso !== undefined && point.time !== undefined && point.date_iso !== point.time)) return null;
  const rawDate = point.date_iso !== undefined ? point.date_iso : point.time;
  const rawPrice = point.price !== undefined ? point.price : point.close;
  if (!isValidIsoDate(rawDate) || (point.date !== undefined && (typeof point.date !== "string" || !point.date.trim()))
    || !isStrictFiniteNumber(rawPrice) || !isStrictFiniteNumber(point.open)
    || !isStrictFiniteNumber(point.high) || !isStrictFiniteNumber(point.low)
    || !isStrictFiniteNumber(point.volume) || rawPrice <= 0 || point.open <= 0
    || point.high <= 0 || point.low <= 0 || point.volume < 0
    || point.low > Math.min(point.open, rawPrice) || point.high < Math.max(point.open, rawPrice)) {
    return null;
  }
  return {
    date: typeof point.date === "string" ? point.date : rawDate,
    date_iso: rawDate,
    price: rawPrice,
    open: point.open,
    high: point.high,
    low: point.low,
    volume: point.volume,
  };
};

export const normalizeFinanceChartData = (value: unknown) => {
  if (!Array.isArray(value)) return { bars: [] as NormalizedFinanceChartPoint[], rejectedBarCount: 0, lastValidDate: null as string | null };
  const bars: NormalizedFinanceChartPoint[] = [];
  let rejectedBarCount = 0;
  let previousDate = "";
  for (const item of value) {
    const normalized = normalizeFinanceChartPoint(item);
    if (!normalized || normalized.date_iso <= previousDate) {
      rejectedBarCount += 1;
      continue;
    }
    previousDate = normalized.date_iso;
    bars.push(normalized);
  }
  return { bars, rejectedBarCount, lastValidDate: bars.at(-1)?.date_iso || null };
};
