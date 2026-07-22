import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeCandlestickBars,
  buildCandlestickPatternData,
  CANDLESTICK_PATTERN_RULES,
  deriveTrendContext,
  type CandlestickBar,
} from "../src/lib/candlestick-patterns";

const toBars = (rows: Array<[number, number, number, number]>): CandlestickBar[] => rows.map(
  ([open, high, low, close], index) => ({
    time: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    open,
    high,
    low,
    close,
    volume: 1_000 + index,
  }),
);

const fixtures: Record<string, CandlestickBar[]> = {
  bullish_engulfing: toBars([
    [10, 11, 7.5, 8],
    [7, 12, 6.5, 11],
  ]),
  morning_star: toBars([
    [10, 11, 7.5, 8],
    [7, 7, 6, 6.5],
    [7.2, 10, 7.1, 9.5],
  ]),
  piercing_line: toBars([
    [10, 11, 7.5, 8],
    [7, 10, 6.8, 9.5],
  ]),
  confirmed_hammer_family: toBars([
    [13, 13.5, 11.5, 12],
    [12, 12.5, 10.5, 11],
    [11, 11.5, 9.5, 10],
    [8, 9, 6, 9],
    [9, 10.5, 8.8, 10],
  ]),
  three_white_soldiers: toBars([
    [8, 10.5, 7.5, 10],
    [9, 11.5, 8.5, 11],
    [10, 12.5, 9.5, 12],
  ]),
  bearish_engulfing: toBars([
    [8, 10.5, 7.5, 10],
    [11, 11.5, 6.5, 7],
  ]),
  evening_star: toBars([
    [8, 10.5, 7.5, 10],
    [11, 12, 11, 11.5],
    [10.8, 10.9, 8, 8.5],
  ]),
  dark_cloud_cover: toBars([
    [8, 10.5, 7.5, 10],
    [11, 11.5, 8.2, 8.5],
  ]),
  hanging_man: toBars([
    [7, 8.5, 6.5, 8],
    [8, 9.5, 7.5, 9],
    [9, 10.5, 8.5, 10],
    [10, 11, 8, 11],
    [10, 10.2, 8.8, 9],
  ]),
  shooting_star: toBars([
    [7, 8.5, 6.5, 8],
    [8, 9.5, 7.5, 9],
    [9, 10.5, 8.5, 10],
    [10, 14, 10, 11],
    [10, 10.2, 8.8, 9],
  ]),
  three_black_crows: toBars([
    [12, 12.5, 9.5, 10],
    [11, 11.5, 8.5, 9],
    [10, 10.5, 7.5, 8],
  ]),
  doji: toBars([
    [10, 11, 9, 10.005],
  ]),
};

test("the curated registry contains exactly twelve explicit pattern families", () => {
  assert.equal(CANDLESTICK_PATTERN_RULES.length, 12);
  assert.deepEqual(new Set(CANDLESTICK_PATTERN_RULES.map((rule) => rule.id)), new Set(Object.keys(fixtures)));
});

for (const [id, bars] of Object.entries(fixtures)) {
  test(`recognises the fixed ${id} fixture`, () => {
    const analysis = analyzeCandlestickBars(bars);
    assert.ok(analysis.latestMatches.some((match) => match.id === id), `${id} should finish on the latest completed bar`);
  });
}

test("only latest-bar matches determine the current pattern bias", () => {
  const oldBullish = fixtures.bullish_engulfing;
  const laterNeutral = toBars([[20, 21, 19, 20.5]])[0];
  laterNeutral.time = "2026-01-03";
  const analysis = analyzeCandlestickBars([...oldBullish, laterNeutral]);

  assert.ok(analysis.recentMatches.some((match) => match.id === "bullish_engulfing"));
  assert.equal(analysis.latestMatches.some((match) => match.id === "bullish_engulfing"), false);
  assert.equal(analysis.patternBias, "neutral");
});

test("trend context separates rising, falling, flat, and insufficient histories", () => {
  const trendBars = (direction: -1 | 0 | 1) => Array.from({ length: 30 }, (_, index) => {
    const close = 100 + direction * index;
    return {
      time: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      open: close - 0.2,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1_000,
    } satisfies CandlestickBar;
  });

  assert.equal(deriveTrendContext(trendBars(1)), "bullish");
  assert.equal(deriveTrendContext(trendBars(-1)), "bearish");
  assert.equal(deriveTrendContext(trendBars(0)), "neutral");
  assert.equal(deriveTrendContext(trendBars(1).slice(0, 24)), "unavailable");
});

test("Yahoo normalization rejects invalid rows and excludes a forming daily bar", () => {
  const dates = ["2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17", "2026-07-20", "2026-07-21"];
  const timestamps = dates.map((date) => Date.parse(`${date}T13:30:00.000Z`) / 1_000);
  const payload = {
    chart: {
      result: [{
        meta: {
          exchangeTimezoneName: "America/New_York",
          currentTradingPeriod: { regular: { end: Date.parse("2026-07-21T20:00:00.000Z") / 1_000 } },
        },
        timestamp: [...timestamps, Date.parse("2026-07-13T13:30:00.000Z") / 1_000],
        indicators: { quote: [{
          open: [10, 11, 12, 13, 14, 15, 20],
          high: [11, 12, 13, 14, 15, 16, 19],
          low: [9, 10, 11, 12, 13, 14, 18],
          close: [10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 20],
          volume: [100, 110, 120, 130, 140, 150, 200],
        }] },
      }],
      error: null,
    },
  };

  const result = buildCandlestickPatternData({
    symbol: "aapl",
    interval: "1d",
    payload,
    now: new Date("2026-07-21T18:00:00.000Z"),
  });

  assert.equal(result.symbol, "AAPL");
  assert.equal(result.rejectedBarCount, 1);
  assert.equal(result.partialBarExcluded, true);
  assert.equal(result.sourceAsOf, "2026-07-20");
  assert.equal(result.bars.length, 5);
});

test("Yahoo normalization fails closed for malformed or insufficient data", () => {
  assert.throws(
    () => buildCandlestickPatternData({ symbol: "AAPL", interval: "1d", payload: {}, now: new Date() }),
    /did not return chart data/,
  );
  assert.throws(
    () => buildCandlestickPatternData({
      symbol: "AAPL",
      interval: "1d",
      payload: { chart: { result: [{ timestamp: [], indicators: { quote: [{}] } }] } },
      now: new Date(),
    }),
    /malformed OHLCV payload/,
  );
});

test("Yahoo normalization removes every row in the current weekly or monthly bucket", () => {
  const makePayload = (dates: string[]) => ({
    chart: {
      result: [{
        meta: { exchangeTimezoneName: "America/New_York" },
        timestamp: dates.map((date) => Date.parse(`${date}T13:30:00.000Z`) / 1_000),
        indicators: { quote: [{
          open: dates.map((_, index) => 10 + index),
          high: dates.map((_, index) => 11 + index),
          low: dates.map((_, index) => 9 + index),
          close: dates.map((_, index) => 10.5 + index),
          volume: dates.map((_, index) => 100 + index),
        }] },
      }],
    },
  });
  const now = new Date("2026-07-21T18:00:00.000Z");
  const weekly = buildCandlestickPatternData({
    symbol: "AAPL",
    interval: "1wk",
    payload: makePayload(["2026-06-15", "2026-06-22", "2026-06-29", "2026-07-06", "2026-07-13", "2026-07-20", "2026-07-21"]),
    now,
  });
  const monthly = buildCandlestickPatternData({
    symbol: "AAPL",
    interval: "1mo",
    payload: makePayload(["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-07-21"]),
    now,
  });

  assert.equal(weekly.sourceAsOf, "2026-07-13");
  assert.equal(weekly.bars.some((bar) => bar.time >= "2026-07-20"), false);
  assert.equal(weekly.partialBarExcluded, true);
  assert.equal(monthly.sourceAsOf, "2026-06-01");
  assert.equal(monthly.bars.some((bar) => bar.time.startsWith("2026-07")), false);
  assert.equal(monthly.partialBarExcluded, true);
});
