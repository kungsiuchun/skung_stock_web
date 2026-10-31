import assert from "node:assert/strict";
import test from "node:test";

import { buildFomcRateProbabilityResponse, formatFomcMarketDeadline, FomcRateProbabilityError } from "../src/lib/fomc-rate-probability";

for (const [close, date, zone] of [["2026-12-10T04:59:00Z", "Dec 9, 2026", "EST"], ["2026-07-30T03:59:00Z", "Jul 29, 2026", "EDT"]]) {
  test(`market deadline uses the New York date and ${zone}, not its UTC day`, () => {
    const label = formatFomcMarketDeadline(close);
    assert.ok(label.includes(date));
    assert.match(label, /11:59\s+PM/);
    assert.ok(label.endsWith(zone));
  });
}
test("invalid market deadline fails rather than substituting a meeting date", () => {
  assert.throws(() => formatFomcMarketDeadline("not-a-timestamp"), FomcRateProbabilityError);
});

const market = (question: string, yesPrice: string, updatedAt = "2026-09-14T18:02:00Z") => ({ question, outcomes: '["Yes","No"]', outcomePrices: `["${yesPrice}","0.50"]`, active: true, closed: false, updatedAt });
const events = [
  { title: "Fed Decision in September?", slug: "fed-decision-in-september", endDate: "2026-09-16T17:59:00Z", updatedAt: "2026-09-14T18:01:00Z", volume: "1200", active: true, closed: false, markets: [market("Will the Fed decrease interest rates by 25 bps after the September 2026 meeting?", "0.10"), market("Will the Fed decrease interest rates by 50+ bps after the September 2026 meeting?", "0.02"), market("Will there be no change in Fed interest rates after the September 2026 meeting?", "0.58"), market("Will the Fed increase interest rates by 25 bps after the September 2026 meeting?", "0.25"), market("Will the Fed increase interest rates by 50+ bps after the September 2026 meeting?", "0.05")] },
  { title: "Fed Decision in October?", slug: "fed-decision-in-october", endDate: "2026-10-28T17:59:00Z", updatedAt: "2026-09-14T18:01:00Z", volume: "300", active: true, closed: false, markets: [market("Will the Fed decrease interest rates by 25 bps after the October 2026 meeting?", "0.20"), market("Will there be no change in Fed interest rates after the October 2026 meeting?", "0.50"), market("Will the Fed increase interest rates by 25 bps after the October 2026 meeting?", "0.30")] },
];

test("selects the nearest active FOMC decision and groups Cut / Hold / Hike", () => {
  const response = buildFomcRateProbabilityResponse({ events, fetchedAt: "2026-09-14T18:03:00Z", now: new Date("2026-09-14T18:03:00Z") });
  assert.equal(response.meeting.eventSlug, "fed-decision-in-september");
  assert.equal(response.meeting.date, "2026-09-16");
  assert.equal(response.meeting.dateBasis, "market_close_utc");
  assert.deepEqual(response.meeting.outcomes, [{ key: "cut", label: "Cut", probability: 12 }, { key: "hold", label: "Hold", probability: 58 }, { key: "hike", label: "Hike", probability: 30 }]);
  assert.equal(response.meeting.noHikeProbability, 70);
  assert.equal(response.meeting.observedAt, "2026-09-14T18:02:00Z");
});

test("normalizes a small mutually-exclusive market pricing discrepancy without hiding it", () => {
  const response = buildFomcRateProbabilityResponse({ events: [{ ...events[0], markets: [market("Will the Fed decrease interest rates by 25 bps after the September 2026 meeting?", "0.11"), market("Will there be no change in Fed interest rates after the September 2026 meeting?", "0.61"), market("Will the Fed increase interest rates by 25 bps after the September 2026 meeting?", "0.31")] }], fetchedAt: "2026-09-14T18:03:00Z", now: new Date("2026-09-14T18:03:00Z") });
  assert.equal(response.meeting.rawProbabilityTotal, 1.03);
  assert.equal(response.meeting.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0), 100);
});

test("blank volume and Yes prices are missing values, while numeric zero remains valid", () => {
  const build = (event: typeof events[number]) => buildFomcRateProbabilityResponse({ events: [event], fetchedAt: "2026-09-14T18:03:00Z", now: new Date("2026-09-14T18:03:00Z") });
  for (const blank of ["", " ", "\t"]) {
    assert.throws(() => build({ ...events[0], volume: blank }), /event volume is invalid/);
    assert.throws(() => build({ ...events[0], markets: events[0].markets.map((row, index) => index === 0 ? { ...row, outcomePrices: JSON.stringify([blank, "1"]) } : row) }), /Yes price is invalid/);
  }
  const zero = build({ ...events[1], volume: "0", markets: [market("Will the Fed decrease interest rates?", "0"), market("Will there be no change in Fed interest rates?", "1"), market("Will the Fed increase interest rates?", "0")] });
  assert.equal(zero.meeting.volume, 0);
  assert.deepEqual(zero.meeting.outcomes.map(row => row.probability), [0, 100, 0]);
});

test("offset deadlines retain their source timestamp but expose a canonical UTC legacy date", () => {
  const response = buildFomcRateProbabilityResponse({ events: [{ ...events[0], title: "Fed Decision in December?", slug: "fed-decision-in-december", endDate: "2026-12-09T23:59:00-05:00", markets: events[0].markets.map(row => ({ ...row, question: row.question.replaceAll("September", "December") })) }], fetchedAt: "2026-09-14T18:03:00Z", now: new Date("2026-09-14T18:03:00Z") });
  assert.equal(response.meeting.closesAt, "2026-12-09T23:59:00-05:00");
  assert.equal(response.meeting.date, "2026-12-10");
  assert.equal(response.meeting.dateBasis, "market_close_utc");
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

test("fails closed when any contributing market is stale", () => {
  const mixedFreshness = [{
    ...events[0],
    updatedAt: "2026-09-14T18:02:30Z",
    markets: events[0].markets.map((item, index) => index === 0
      ? { ...item, updatedAt: "2026-09-12T00:00:00Z" }
      : { ...item, updatedAt: `2026-09-14T18:0${index}:00Z` }),
  }];
  assert.throws(
    () => buildFomcRateProbabilityResponse({ events: mixedFreshness, fetchedAt: "2026-09-14T18:03:00Z", now: new Date("2026-09-14T18:03:00Z") }),
    /prices are stale/,
  );
});

test("uses the oldest contributing market update as the observation time", () => {
  const mixedFreshness = [{
    ...events[0],
    updatedAt: "2026-09-14T18:02:30Z",
    markets: events[0].markets.map((item, index) => ({ ...item, updatedAt: `2026-09-14T17:5${index}:00Z` })),
  }];
  const response = buildFomcRateProbabilityResponse({ events: mixedFreshness, fetchedAt: "2026-09-14T18:03:00Z", now: new Date("2026-09-14T18:03:00Z") });
  assert.equal(response.meeting.observedAt, "2026-09-14T17:50:00Z");
});
