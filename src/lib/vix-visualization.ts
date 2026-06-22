export interface VixChartPoint {
  index: number;
  value: number;
  label: string;
}

export function buildVixChartData(history: number[]): VixChartPoint[] {
  const values = history.filter((value) => Number.isFinite(value));
  const lastIndex = values.length - 1;

  return values.map((value, index) => ({
    index,
    value,
    label: index === lastIndex ? "Now" : `D-${lastIndex - index}`,
  }));
}

export function getVixStatus(value: number) {
  if (value >= 25) return "高恐慌";
  if (value >= 20) return "恐慌";
  if (value >= 15) return "偏緊張";
  return "平穩";
}

export function getVixTone(value: number) {
  if (value >= 20) return "stress";
  if (value >= 15) return "watch";
  return "calm";
}

export function getVixChartDomain(history: number[], reference = 20): [number, number] {
  const values = history.filter((value) => Number.isFinite(value));
  if (values.length === 0) return [10, 25];

  const min = Math.min(...values, reference);
  const max = Math.max(...values, reference);
  const span = Math.max(1, max - min);
  const padding = Math.max(1.5, span * 0.18);

  return [
    Math.max(0, Math.floor(min - padding)),
    Math.ceil(max + padding),
  ];
}

export function getVixRangeLabel(history: number[]) {
  const values = history.filter((value) => Number.isFinite(value));
  if (values.length === 0) return "N/A";

  const min = Math.min(...values);
  const max = Math.max(...values);
  return `${min.toFixed(1)}-${max.toFixed(1)}`;
}
