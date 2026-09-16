export const POLYMARKET_FOMC_DECISION_URL = "https://gamma-api.polymarket.com/public-search?q=fed%20rate%20decision";
export const POLYMARKET_EVENT_URL = (slug: string) => `https://polymarket.com/event/${slug}`;

type OutcomeKey = "cut" | "hold" | "hike";

export interface PolymarketFomcMarket {
  question?: unknown;
  outcomes?: unknown;
  outcomePrices?: unknown;
  updatedAt?: unknown;
  active?: unknown;
  closed?: unknown;
}

export interface PolymarketFomcEvent {
  title?: unknown;
  slug?: unknown;
  endDate?: unknown;
  updatedAt?: unknown;
  volume?: unknown;
  active?: unknown;
  closed?: unknown;
  markets?: unknown;
}

export interface FomcRateProbabilityResponse {
  meeting: {
    eventSlug: string;
    title: string;
    date: string;
    closesAt: string;
    observedAt: string;
    rawProbabilityTotal: number;
    outcomes: Array<{ key: OutcomeKey; label: "Cut" | "Hold" | "Hike"; probability: number }>;
    noHikeProbability: number;
    volume: number;
  };
  source: {
    provider: "Polymarket";
    label: "Fed decision prediction markets";
    type: "prediction-market implied";
    url: string;
    fetchedAt: string;
  };
}

export class FomcRateProbabilityError extends Error {}

const MAX_MARKET_AGE_MS = 36 * 60 * 60 * 1000;
const labelFor: Record<OutcomeKey, "Cut" | "Hold" | "Hike"> = { cut: "Cut", hold: "Hold", hike: "Hike" };
const roundedPercent = (value: number) => Number((value * 100).toFixed(1));

const finiteNumber = (value: unknown, label: string) => {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) throw new FomcRateProbabilityError(`Polymarket ${label} is invalid.`);
  return number;
};

const requiredString = (value: unknown, label: string) => {
  if (typeof value !== "string" || !value.trim()) throw new FomcRateProbabilityError(`Polymarket ${label} is missing.`);
  return value;
};

const timestamp = (value: unknown, label: string) => {
  const text = requiredString(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new FomcRateProbabilityError(`Polymarket ${label} is invalid.`);
  return text;
};

const outcomeFor = (question: string): OutcomeKey => {
  const normalized = question.toLowerCase();
  if (normalized.includes("decrease interest rates")) return "cut";
  if (normalized.includes("no change in fed interest rates")) return "hold";
  if (normalized.includes("increase interest rates")) return "hike";
  throw new FomcRateProbabilityError("Polymarket decision market has an unsupported outcome.");
};

const yesPrice = (market: PolymarketFomcMarket) => {
  if (typeof market.outcomes !== "string" || typeof market.outcomePrices !== "string") throw new FomcRateProbabilityError("Polymarket decision market is missing outcome prices.");
  let outcomes: unknown;
  let prices: unknown;
  try { outcomes = JSON.parse(market.outcomes); prices = JSON.parse(market.outcomePrices); }
  catch { throw new FomcRateProbabilityError("Polymarket decision market has invalid outcome prices."); }
  if (!Array.isArray(outcomes) || !Array.isArray(prices) || outcomes.length !== prices.length) throw new FomcRateProbabilityError("Polymarket decision market has an invalid outcome-price mapping.");
  const yesIndex = outcomes.findIndex((outcome) => outcome === "Yes");
  if (yesIndex < 0) throw new FomcRateProbabilityError("Polymarket decision market is missing the Yes outcome.");
  const price = finiteNumber(prices[yesIndex], "Yes price");
  if (price < 0 || price > 1) throw new FomcRateProbabilityError("Polymarket Yes price is outside the probability range.");
  return price;
};

export const buildFomcRateProbabilityResponse = (input: { events: PolymarketFomcEvent[]; fetchedAt: string; now?: Date }): FomcRateProbabilityResponse => {
  const now = input.now || new Date();
  const candidates = input.events.map((event) => {
    const title = requiredString(event.title, "event title");
    const closesAt = timestamp(event.endDate, "event end date");
    return { event, title, closesAt, closeTimestamp: Date.parse(closesAt) };
  }).filter(({ event, title, closeTimestamp }) => event.active === true && event.closed === false && /^Fed Decision in .+\?$/.test(title) && closeTimestamp > now.getTime());
  candidates.sort((left, right) => left.closeTimestamp - right.closeTimestamp);
  const next = candidates[0];
  if (!next) throw new FomcRateProbabilityError("Polymarket returned no future FOMC decision market.");
  if (!Array.isArray(next.event.markets)) throw new FomcRateProbabilityError("Polymarket FOMC decision event is missing markets.");

  const byOutcome = new Map<OutcomeKey, number>();
  let observedAt: string | undefined;
  let observedTimestamp = Number.POSITIVE_INFINITY;
  for (const rawMarket of next.event.markets) {
    if (!rawMarket || typeof rawMarket !== "object" || Array.isArray(rawMarket)) throw new FomcRateProbabilityError("Polymarket FOMC decision market is invalid.");
    const market = rawMarket as PolymarketFomcMarket;
    if (market.active !== true || market.closed !== false) continue;
    const key = outcomeFor(requiredString(market.question, "market question"));
    const updatedAt = timestamp(market.updatedAt, "market update time");
    const updatedTimestamp = Date.parse(updatedAt);
    if (now.getTime() - updatedTimestamp > MAX_MARKET_AGE_MS) throw new FomcRateProbabilityError("Polymarket FOMC decision prices are stale.");
    byOutcome.set(key, (byOutcome.get(key) || 0) + yesPrice(market));
    if (updatedTimestamp < observedTimestamp) {
      observedAt = updatedAt;
      observedTimestamp = updatedTimestamp;
    }
  }
  if (!observedAt) throw new FomcRateProbabilityError("Polymarket FOMC decision event has no active markets.");

  const rawValues = (Object.keys(labelFor) as OutcomeKey[]).map((key) => {
    const value = byOutcome.get(key);
    if (value === undefined) throw new FomcRateProbabilityError(`Polymarket is missing the ${key} decision market.`);
    return value;
  });
  const rawProbabilityTotal = Number(rawValues.reduce((sum, value) => sum + value, 0).toFixed(4));
  if (rawProbabilityTotal < 0.95 || rawProbabilityTotal > 1.05) throw new FomcRateProbabilityError(`Polymarket mutually-exclusive probabilities total ${rawProbabilityTotal}, outside the allowed range.`);
  const outcomes = (Object.keys(labelFor) as OutcomeKey[]).map((key) => ({ key, label: labelFor[key], probability: roundedPercent((byOutcome.get(key) || 0) / rawProbabilityTotal) }));
  const cut = outcomes.find((outcome) => outcome.key === "cut")!.probability;
  const hold = outcomes.find((outcome) => outcome.key === "hold")!.probability;
  const slug = requiredString(next.event.slug, "event slug");

  return {
    meeting: { eventSlug: slug, title: next.title, date: next.closesAt.slice(0, 10), closesAt: next.closesAt, observedAt, rawProbabilityTotal, outcomes, noHikeProbability: Number((cut + hold).toFixed(1)), volume: Number(finiteNumber(next.event.volume, "event volume").toFixed(2)) },
    source: { provider: "Polymarket", label: "Fed decision prediction markets", type: "prediction-market implied", url: POLYMARKET_EVENT_URL(slug), fetchedAt: input.fetchedAt },
  };
};
