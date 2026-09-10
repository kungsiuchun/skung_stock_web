import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCnnFearGreedPayload } from "../src/lib/fear-greed";

const validPayload = () => ({
  fear_and_greed: { score: 38.9, rating: "fear", timestamp: "2026-09-09T20:00:00.000Z", previous_close: 40.2, previous_1_week: 44.8, previous_1_month: 52.1, previous_1_year: 29.7 },
  fear_and_greed_historical: { data: [
    { x: 1_725_840_000_000, y: 35.1, rating: "fear" },
    { x: 1_725_926_400_000, y: 38.9, rating: "fear" },
  ] },
});

test("CNN Fear and Greed normalizer accepts a bounded current reading and history", () => {
  const snapshot = normalizeCnnFearGreedPayload(validPayload());
  assert.equal(snapshot.schemaVersion, "1.0");
  assert.equal(snapshot.score, 38.9);
  assert.equal(snapshot.rating, "fear");
  assert.equal(snapshot.history.length, 2);
  assert.equal(snapshot.comparisons.previousYear, 29.7);
  assert.match(snapshot.sourceUrl, /^https:\/\/www\.cnn\.com\//);
});

test("CNN Fear and Greed normalizer fails closed for an invalid score or insufficient history", () => {
  const invalidScore = validPayload();
  invalidScore.fear_and_greed.score = 101;
  assert.throws(() => normalizeCnnFearGreedPayload(invalidScore), /valid current score/i);
  const insufficient = validPayload();
  insufficient.fear_and_greed_historical.data = [insufficient.fear_and_greed_historical.data[0]];
  assert.throws(() => normalizeCnnFearGreedPayload(insufficient), /insufficient valid history/i);
});
