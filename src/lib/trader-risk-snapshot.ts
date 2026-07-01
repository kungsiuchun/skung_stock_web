export interface TraderRiskBar {
  label: string;
  value: string;
  tone: "green" | "amber" | "red" | "gray";
  detail: string;
}

export interface TraderRiskSnapshot {
  source: string;
  dollarVolume: number | null;
  relativeVolume: number | null;
  atr14: number | null;
  rangePositionPct: number | null;
  bars: TraderRiskBar[];
}

export interface TraderRiskCandle {
  price?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

const formatCompactUsd = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return "Needs data";
  if (value >= 100_000_000) return `$${(value / 100_000_000).toFixed(2)}億`;
  if (value >= 10_000) return `$${(value / 10_000).toFixed(1)}萬`;
  return `$${Math.round(value).toLocaleString()}`;
};

const average = (values: number[]) => {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const metricTone = (
  value: number | null,
  high: number,
  low: number,
  highTone: TraderRiskBar["tone"],
  lowTone: TraderRiskBar["tone"],
): TraderRiskBar["tone"] => {
  if (value === null || !Number.isFinite(value)) return "gray";
  if (value >= high) return highTone;
  if (value <= low) return lowTone;
  return "amber";
};

export function deriveTraderRiskSnapshot(candles: TraderRiskCandle[]): TraderRiskSnapshot {
  const clean = candles
    .map((item) => ({
      close: Number(item.price),
      open: Number(item.open ?? item.price),
      high: Number(item.high ?? item.price),
      low: Number(item.low ?? item.price),
      volume: Number(item.volume),
    }))
    .filter((item) =>
      Number.isFinite(item.close) &&
      Number.isFinite(item.open) &&
      Number.isFinite(item.high) &&
      Number.isFinite(item.low) &&
      Number.isFinite(item.volume)
    );

  const latest = clean.length > 0 ? clean[clean.length - 1] : undefined;
  const previous20 = clean.slice(-21, -1);
  const last20 = clean.slice(-20);
  const dollarVolume = latest ? latest.close * latest.volume : null;
  const average20Volume = average(previous20.map((item) => item.volume));
  const relativeVolume = latest && average20Volume ? latest.volume / average20Volume : null;

  const atrWindow = clean.slice(-15);
  const trueRanges = atrWindow.slice(1).map((item, index) => {
    const previousClose = atrWindow[index].close;
    return Math.max(
      item.high - item.low,
      Math.abs(item.high - previousClose),
      Math.abs(item.low - previousClose),
    );
  });
  const atr14 = average(trueRanges.slice(-14));

  const rangeHigh = Math.max(...last20.map((item) => item.high));
  const rangeLow = Math.min(...last20.map((item) => item.low));
  const rangePositionPct =
    latest && Number.isFinite(rangeHigh) && Number.isFinite(rangeLow) && rangeHigh > rangeLow
      ? ((latest.close - rangeLow) / (rangeHigh - rangeLow)) * 100
      : null;

  return {
    source: "Yahoo Finance chart data + local deterministic calculation",
    dollarVolume,
    relativeVolume,
    atr14,
    rangePositionPct,
    bars: [
      {
        label: "Dollar Volume",
        value: formatCompactUsd(dollarVolume),
        tone: metricTone(dollarVolume, 1_000_000_000, 100_000_000, "green", "red"),
        detail: "close x volume",
      },
      {
        label: "Relative Volume",
        value: relativeVolume ? `${relativeVolume.toFixed(2)}x` : "Needs data",
        tone: metricTone(relativeVolume, 1.5, 0.7, "green", "red"),
        detail: "latest vs prior 20-day avg",
      },
      {
        label: "ATR 14",
        value: atr14 ? `$${atr14.toFixed(2)}` : "Needs data",
        tone: atr14 ? "amber" : "gray",
        detail: "average true range",
      },
      {
        label: "20D Range Position",
        value: rangePositionPct === null ? "Needs data" : `${Math.round(rangePositionPct)}%`,
        tone: metricTone(rangePositionPct, 80, 20, "green", "red"),
        detail: "close in 20-day high-low band",
      },
    ],
  };
}
