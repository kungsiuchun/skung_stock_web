export const CNN_FEAR_GREED_GRAPH_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
export const CNN_FEAR_GREED_SOURCE_URL = "https://www.cnn.com/markets/fear-and-greed";

export type FearGreedRating = "extreme fear" | "fear" | "neutral" | "greed" | "extreme greed";

export interface FearGreedPoint {
  at: string;
  score: number;
  rating: FearGreedRating;
}

export interface FearGreedSnapshot {
  schemaVersion: "1.0";
  source: "CNN Fear & Greed Index";
  sourceUrl: string;
  asOf: string;
  score: number;
  rating: FearGreedRating;
  comparisons: {
    previousClose: number | null;
    previousWeek: number | null;
    previousMonth: number | null;
    previousYear: number | null;
  };
  history: FearGreedPoint[];
}

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;

const finiteScore = (value: unknown) => {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? numeric : null;
};

const ratingFrom = (value: unknown): FearGreedRating | null => {
  const normalized = String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  return normalized === "extreme fear" || normalized === "fear" || normalized === "neutral" || normalized === "greed" || normalized === "extreme greed"
    ? normalized
    : null;
};

const isoFrom = (value: unknown) => {
  const numeric = typeof value === "number" ? value : Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1_000)
    : new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

export const normalizeCnnFearGreedPayload = (payload: unknown): FearGreedSnapshot => {
  const root = asRecord(payload);
  const current = asRecord(root?.fear_and_greed);
  const historical = asRecord(root?.fear_and_greed_historical);
  const score = finiteScore(current?.score);
  const rating = ratingFrom(current?.rating);
  const asOf = isoFrom(current?.timestamp);
  if (score === null || rating === null || asOf === null) {
    throw new Error("CNN Fear & Greed response is missing a valid current score, rating, or timestamp.");
  }

  const rawHistory = Array.isArray(historical?.data) ? historical.data : [];
  const history = rawHistory.flatMap((value): FearGreedPoint[] => {
    const point = asRecord(value);
    const pointScore = finiteScore(point?.y);
    const pointRating = ratingFrom(point?.rating);
    const at = isoFrom(point?.x);
    return pointScore === null || pointRating === null || at === null ? [] : [{ at, score: pointScore, rating: pointRating }];
  }).sort((left, right) => left.at.localeCompare(right.at));
  if (history.length < 2) throw new Error("CNN Fear & Greed response has insufficient valid history.");

  const comparison = (key: string) => finiteScore(current?.[key]);
  return {
    schemaVersion: "1.0",
    source: "CNN Fear & Greed Index",
    sourceUrl: CNN_FEAR_GREED_SOURCE_URL,
    asOf,
    score,
    rating,
    comparisons: {
      previousClose: comparison("previous_close"),
      previousWeek: comparison("previous_1_week"),
      previousMonth: comparison("previous_1_month"),
      previousYear: comparison("previous_1_year"),
    },
    history,
  };
};

export const fearGreedTone = (rating: FearGreedRating) => rating.replace(/\s+/g, "-");

export const fearGreedLabel = (rating: FearGreedRating) => rating.replace(/\b\w/g, (letter) => letter.toUpperCase());
