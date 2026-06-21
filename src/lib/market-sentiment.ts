export type SentimentSourceType = "retail" | "proxy" | "unavailable";

export interface SentimentComponent {
  id: string;
  label: string;
  score: number | null;
  weight: number;
  status: "bullish" | "bearish" | "neutral" | "unavailable";
  detail: string;
}

export interface SentimentApiResult {
  symbol: string;
  score: number | null;
  sourceType: SentimentSourceType;
  sourceLabel: string;
  coverage: string;
  components: SentimentComponent[];
  warnings: string[];
  generatedAt: string;
}

interface RetailSource {
  platform?: string;
  bullish_pct?: unknown;
  activity_count?: unknown;
}

interface RetailSentimentPayload {
  symbol?: string;
  coverage?: string;
  average_bullish_pct?: unknown;
  sources?: RetailSource[];
}

interface ProxyInput {
  symbol: string;
  quote?: { change_pct?: unknown } | null;
  options?: { callPutRatio?: unknown } | null;
  technical?: {
    is_bullish?: unknown;
    is_bearish?: unknown;
    rsi_14?: unknown;
    position_percent?: unknown;
  } | null;
  news?: { title?: string }[];
}

const POSITIVE_KEYWORDS = [
  "beat",
  "beats",
  "growth",
  "upgrade",
  "upgrades",
  "rally",
  "surge",
  "surges",
  "strong",
  "positive",
  "record",
  "breakout",
  "上升",
  "上漲",
  "突破",
  "新高",
];

const NEGATIVE_KEYWORDS = [
  "miss",
  "misses",
  "weak",
  "downgrade",
  "downgrades",
  "falls",
  "drop",
  "risk",
  "risks",
  "crash",
  "sell",
  "lawsuit",
  "下跌",
  "暴跌",
  "風險",
];

function finiteNumber(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function roundedScore(value: number): number {
  return Math.round(clamp(value));
}

function statusForScore(score: number | null): SentimentComponent["status"] {
  if (score === null) return "unavailable";
  if (score >= 58) return "bullish";
  if (score <= 42) return "bearish";
  return "neutral";
}

function parseCoverageCount(coverage: string | undefined): number {
  const match = coverage?.match(/^(\d+)\s*\//);
  return match ? Number(match[1]) : 0;
}

export function normalizeRetailSentiment(payload: RetailSentimentPayload): SentimentApiResult {
  const symbol = (payload.symbol || "").toUpperCase();
  const coverage = payload.coverage || "0/3";
  const scoreValue = finiteNumber(payload.average_bullish_pct);
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  const coveredSources = sources.filter((source) => finiteNumber(source.bullish_pct) !== null);

  if (scoreValue === null || parseCoverageCount(coverage) === 0 || coveredSources.length === 0) {
    return unavailableSentiment(symbol, ["Retail sentiment unavailable: ADANOS coverage is 0 or missing."]);
  }

  const score = roundedScore(scoreValue);
  const components = coveredSources.map((source): SentimentComponent => {
    const sourceScore = roundedScore(finiteNumber(source.bullish_pct) ?? 50);
    const activity = finiteNumber(source.activity_count);
    return {
      id: `retail-${String(source.platform || "source").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      label: source.platform || "Retail source",
      score: sourceScore,
      weight: 1 / coveredSources.length,
      status: statusForScore(sourceScore),
      detail: activity === null ? "Bullish percentage from retail feed." : `${activity} activity items in feed.`,
    };
  });

  return {
    symbol,
    score,
    sourceType: "retail",
    sourceLabel: `Retail sentiment (${coveredSources.map((source) => source.platform || "source").join(", ")})`,
    coverage,
    components,
    warnings: [],
    generatedAt: new Date().toISOString(),
  };
}

export function unavailableSentiment(symbol: string, warnings: string[] = []): SentimentApiResult {
  return {
    symbol: symbol.toUpperCase(),
    score: null,
    sourceType: "unavailable",
    sourceLabel: "Sentiment unavailable",
    coverage: "0/3",
    components: [],
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

export function deriveMarketMoodProxy(input: ProxyInput): SentimentApiResult {
  const components: SentimentComponent[] = [];

  const changePct = finiteNumber(input.quote?.change_pct);
  if (changePct !== null) {
    const score = roundedScore(50 + changePct * 6);
    components.push({
      id: "price-momentum",
      label: "Price momentum",
      score,
      weight: 0.25,
      status: statusForScore(score),
      detail: `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}% latest move.`,
    });
  }

  const callPutRatio = finiteNumber(input.options?.callPutRatio);
  if (callPutRatio !== null && callPutRatio > 0) {
    const score = roundedScore(50 + (callPutRatio - 1) * 50);
    components.push({
      id: "options-bias",
      label: "Options C/P bias",
      score,
      weight: 0.25,
      status: statusForScore(score),
      detail: `Call/Put open interest ratio ${callPutRatio.toFixed(2)}.`,
    });
  }

  if (input.technical) {
    const position = finiteNumber(input.technical.position_percent);
    const rsi = finiteNumber(input.technical.rsi_14);
    let rawScore = 50;
    if (input.technical.is_bullish === true) rawScore += 30;
    if (input.technical.is_bearish === true) rawScore -= 23;
    if (position !== null) rawScore += (position - 50) * 0.25;
    if (rsi !== null && rsi > 75) rawScore -= 4;
    if (rsi !== null && rsi < 25) rawScore += 4;

    const score = roundedScore(rawScore);
    const detailParts = [
      input.technical.is_bullish === true ? "MA bullish" : input.technical.is_bearish === true ? "MA bearish" : "MA mixed",
      position === null ? null : `60d position ${position.toFixed(1)}%`,
      rsi === null ? null : `RSI ${rsi.toFixed(1)}`,
    ].filter(Boolean);

    components.push({
      id: "technical-bias",
      label: "Technical bias",
      score,
      weight: 0.35,
      status: statusForScore(score),
      detail: detailParts.join("; "),
    });
  }

  const newsTitles = Array.isArray(input.news) ? input.news.map((item) => item.title || "") : [];
  const positiveCount = newsTitles.filter((title) => POSITIVE_KEYWORDS.some((keyword) => title.toLowerCase().includes(keyword.toLowerCase()))).length;
  const negativeCount = newsTitles.filter((title) => NEGATIVE_KEYWORDS.some((keyword) => title.toLowerCase().includes(keyword.toLowerCase()))).length;
  if (positiveCount > 0 || negativeCount > 0) {
    const score = roundedScore(50 + (positiveCount - negativeCount) * 15);
    components.push({
      id: "news-keywords",
      label: "News keyword tilt",
      score,
      weight: 0.15,
      status: statusForScore(score),
      detail: `${positiveCount} positive / ${negativeCount} negative headline matches.`,
    });
  }

  if (components.length === 0) {
    return unavailableSentiment(input.symbol, ["Market Mood Proxy unavailable: no quote, options, technical, or keyword signal."]);
  }

  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const weightedScore = components.reduce((sum, component) => sum + (component.score ?? 50) * component.weight, 0) / totalWeight;

  return {
    symbol: input.symbol.toUpperCase(),
    score: roundedScore(weightedScore),
    sourceType: "proxy",
    sourceLabel: "Market Mood Proxy",
    coverage: `${components.length}/4 components`,
    components,
    warnings: [
      "Proxy score only: no first-hand Reddit/X/Polymarket sentiment feed was available.",
      "Do not treat this as real retail sentiment.",
    ],
    generatedAt: new Date().toISOString(),
  };
}
