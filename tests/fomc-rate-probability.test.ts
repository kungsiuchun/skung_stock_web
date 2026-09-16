import assert from "node:assert/strict";
import test from "node:test";

import { buildFomcRateProbabilityResponse, FomcRateProbabilityError } from "../src/lib/fomc-rate-probability";

const market = (question: string, yesPrice: string, updatedAt = "2026-09-14T18:02:00Z") => ({ question, outcomes: '["Yes","No"]', outcomePrices: `["${yesPrice}","0.50"]`, active: true, closed: false, updatedAt });
const events = [
  { title: "Fed Decision in September?", slug: "fed-decision-in-september", endDate: "2026-09-16T17:59:00Z", updatedAt: "2026-09-14T18:01:00Z", volume: "1200", active: true, closed: false, markets: [market("Will the Fed decrease interest rates by 25 bps after the September 2026 meeting?", "0.10"), market("Will the Fed decrease interest rates by 50+ bps after the September 2026 meeting?", "0.02"), market("Will there be no change in Fed interest rates after the September 2026 meeting?", "0.58"), market("Will the Fed increase interest rates by 25 bps after the September 2026 meeting?", "0.25"), market("Will the Fed increase interest rates by 50+ bps after the September 2026 meeting?", "0.05")] },
  { title: "Fed Decision in October?", slug: "fed-decision-in-october", endDate: "2026-10-28T17:59:00Z", updatedAt: "2026-09-14T18:01:00Z", volume: "300", active: true, closed: false, markets: [market("Will the Fed decrease interest rates by 25 bps after the October 2026 meeting?", "0.20"), market("Will there be no change in Fed interest rates after the October 2026 meeting?", "0.50"), market("Will the Fed increase interest rates by 25 bps after the October 2026 meeting?", "0.30")] },
];

test("selects the nearest active FOMC decision and groups Cut / Hold / Hike", () => {
  const response = buildFomcRateProbabilityResponse({ events, fetchedAt: "2026-09-14T18:03:00Z", now: new Date("2026-09-14T18:03:00Z") });
  assert.equal(response.meeting.eventSlug, "fed-decision-in-september");
  assert.equal(response.meeting.date, "2026-09-16");
  assert.deepEqual(response.meeting.outcomes, [{ key: "cut", label: "Cut", probability: 12 }, { key: "hold", label: "Hold", probability: 58 }, { key: "hike", label: "Hike", probability: 30 }]);
  assert.equal(response.meeting.noHikeProbability, 70);
});

test("normalizes a small mutually-exclusive market pricing discrepancy without hiding it", () => {
  const response = buildFomcRateProbabilityResponse({ events: [{ ...events[0], markets: [market("Will the Fed decrease interest rates by 25 bps after the September 2026 meeting?", "0.11"), market("Will there be no change in Fed interest rates after the September 2026 meeting?", "0.61"), market("Will the Fed increase interest rates by 25 bps after the September 2026 meeting?", "0.31")] }], fetchedAt: "2026-09-14T18:03:00Z", now: new Date("2026-09-14T18:03:00Z") });
  assert.equal(response.meeting.rawProbabilityTotal, 1.03);
  assert.equal(response.meeting.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0), 100);
});

test("fails closed when the active event is missing a decision family", () => {
  assert.throws(() => buildFomcRateProbabilityResponse({ events: [{ ...events[0], markets: events[0].markets.slice(0, 3) }], fetchedAt: "2026-09-14T18:03:00Z", now: new Date("2026-09-14T18:03:00Z") }), FomcRateProbabilityError);
});

test("fails closed when the market prices are stale or not a plausible probability set", () => {
  const stale = [{ ...events[0], updatedAt: "2026-09-10T00:00:00Z", markets: events[0].markets.map((item) => ({ ...item, updatedAt: "2026-09-10T00:00:00Z" })) }];
  assert.throws(() => buildFomcRateProbabilityResponse({ events: stale, fetchedAt: "2026-09-14T18:03:00Z", now: new Date("2026-09-14T18:03:00Z") }), FomcRateProbabilityError);
  const invalid = [{ ...events[0], markets: events[0].markets.map((item) => ({ ...item, outcomePrices: "[\"0.60\",\"0.40\"]" })) }];
  assert.throws(() => buildFomcRateProbabilityResponse({ events: invalid, fetchedAt: "2026-09-14T18:03:00Z", now: new Date("2026-09-14T18:03:00Z") }), FomcRateProbabilityError);
});
