export const macroHeatClass = (values: Array<number | null>, value: number | null) => {
  if (value === null) return "is-empty";
  const finite = values.filter((entry): entry is number => entry !== null && Number.isFinite(entry));
  if (finite.length < 2) return "is-neutral";
  const minimum = Math.min(...finite);
  const maximum = Math.max(...finite);
  if (minimum === maximum) return "is-neutral";
  const midpoint = (minimum + maximum) / 2;
  const denominator = Math.max(maximum - midpoint, midpoint - minimum);
  const intensity = Math.max(1, Math.min(4, Math.ceil((Math.abs(value - midpoint) / denominator) * 4)));
  return value >= midpoint ? `is-hot-${intensity}` : `is-cool-${intensity}`;
};
