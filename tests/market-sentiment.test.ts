import test from "node:test";
import assert from "node:assert/strict";

import { ALL_RETAIL_TOOLS } from "../functions/api/agent/tools/retail-tools";
import {
  deriveMarketMoodProxy,
  normalizeRetailSentiment,
  type SentimentApiResult,
} from "../src/lib/market-sentiment";

const retailTool = ALL_RETAIL_TOOLS.find((tool) => tool.name === "get_retail_sentiment");

test("retail sentiment returns unavailable data instead of demo fallback without ADANOS_API_KEY", async () => {
  assert.ok(retailTool);

  const result = await retailTool.handler({ stock_code: "AMZN", days_back: 7 }, {});

  assert.equal(result.symbol, "AMZN");
  assert.equal(result.coverage, "0/3");
  assert.equal(result.average_bullish_pct, null);
  assert.deepEqual(result.sources, []);
  assert.equal(result.sourceType, "unavailable");
});

test("normalizes usable retail sentiment into the public sentiment API shape", () => {
  const result = normalizeRetailSentiment({
    symbol: "AMZN",
    coverage: "2/3",
    average_bullish_pct: "61.5",
    sources: [
      { platform: "Reddit", bullish_pct: 64, activity_count: 120 },
      { platform: "X.com", bullish_pct: 59, activity_count: 340 },
    ],
  });

  assert.equal(result.sourceType, "retail");
  assert.equal(result.score, 62);
  assert.equal(result.coverage, "2/3");
  assert.equal(result.components.length, 2);
  assert.match(result.sourceLabel, /Reddit/);
});

test("proxy formula is stable for bullish bearish and neutral fixtures", () => {
  const bullish = deriveMarketMoodProxy({
    symbol: "BULL",
    quote: { change_pct: 3.2 },
    options: { callPutRatio: 1.45 },
    technical: { is_bullish: true, is_bearish: false, rsi_14: 58, position_percent: 78 },
    news: [
      { title: "BULL shares rally after strong growth outlook" },
      { title: "Analyst upgrades BULL on positive demand" },
    ],
  });

  const bearish = deriveMarketMoodProxy({
    symbol: "BEAR",
    quote: { change_pct: -4.1 },
    options: { callPutRatio: 0.55 },
    technical: { is_bullish: false, is_bearish: true, rsi_14: 34, position_percent: 18 },
    news: [
      { title: "BEAR falls after weak guidance" },
      { title: "Downgrade cites margin risk" },
    ],
  });

  const neutral = deriveMarketMoodProxy({
    symbol: "MID",
    quote: { change_pct: 0.1 },
    options: { callPutRatio: 1 },
    technical: { is_bullish: false, is_bearish: false, rsi_14: 50, position_percent: 50 },
    news: [{ title: "MID reports quarterly update" }],
  });

  assert.equal(bullish.sourceType, "proxy");
  assert.equal(bullish.score, 78);
  assert.equal(bearish.score, 23);
  assert.equal(neutral.score, 50);
  assert.equal(bullish.components.length, 4);
  assert.ok(bullish.warnings.some((warning) => warning.includes("Proxy")));
});

test("unavailable result has no directional score", () => {
  const result: SentimentApiResult = deriveMarketMoodProxy({
    symbol: "MISS",
    quote: null,
    options: null,
    technical: null,
    news: [],
  });

  assert.equal(result.score, null);
  assert.equal(result.sourceType, "unavailable");
  assert.equal(result.components.length, 0);
});
