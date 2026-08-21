import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { onRequest as getSpxPriceActionCompassApi } from "../functions/api/spx-price-action-compass";
import {
  fetchZeroDteSpxCurrentSession,
  normalizeZeroDteSpxOneMinuteCandles,
  ZeroDteSpxError,
} from "../functions/api/_0dtespx";
import {
  aggregateSpxOneMinutePriceActionCandles,
  buildSpxPriceActionCompassResponse,
  deriveSpxSupportResistanceZones,
  detectSpxPriceActionPatterns,
  findSpxPriceActionSwingPoints,
  projectSpxChartClientPoint,
  selectActionablePatterns,
  sortSpxPriceActionPatternsLatestFirst,
  type SpxPriceActionCandle,
  type SpxPriceActionPattern,
  type SpxPriceActionZone,
} from "../src/lib/spx-price-action-compass";

const candle = (
  index: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1000,
): SpxPriceActionCandle => ({
  time: Date.parse("2026-06-01T14:30:00Z") + index * 5 * 60 * 1000,
  date_iso: new Date(Date.parse("2026-06-01T14:30:00Z") + index * 5 * 60 * 1000).toISOString().slice(0, 10),
  open,
  high,
  low,
  close,
  volume,
});

const buildDetectorFixture = () => {
  const rows: SpxPriceActionCandle[] = [];
  for (let index = 0; index < 40; index += 1) {
    const base = 100 + Math.sin(index / 2) * 2 + index * 0.04;
    rows.push(candle(index, base, base + 1, base - 1, base + (index % 2 === 0 ? 0.25 : -0.25)));
  }

  rows.push(candle(40, 104, 104.4, 96.5, 104.1)); // bullish pin bar
  rows.push(candle(41, 105.5, 106, 102.5, 103)); // prior bearish body
  rows.push(candle(42, 102.8, 107.2, 102.4, 106.4)); // bullish engulfing
  rows.push(candle(43, 106.2, 106.8, 104.4, 105.8));
  rows.push(candle(44, 105.9, 106.4, 104.8, 106.0)); // inside bar
  rows.push(candle(45, 106, 108, 104, 106.1)); // doji

  return rows;
};

const buildZoneFixture = () => [
  candle(0, 100, 101, 99, 100),
  candle(1, 100, 105.0, 99, 101),
  candle(2, 101, 102, 98, 100),
  candle(3, 100, 104.9, 99, 101),
  candle(4, 101, 102, 97.8, 100),
  candle(5, 100, 105.1, 99, 101),
  candle(6, 101, 102, 98.1, 100),
  candle(7, 100, 103, 97.9, 101),
  candle(8, 101, 102, 99, 100),
];

const etTradingDate = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

describe("SPX Price Action Compass detector", () => {
  it("sorts Signal Monitor patterns latest-first with deterministic ties without mutating input", () => {
    const pattern = (id: string, toIndex: number, fromIndex: number, confidence: number): SpxPriceActionPattern => ({
      id, type: "DOJI", name: id, label: id, category: "candle", direction: "neutral",
      candleIndices: [toIndex], fromIndex, toIndex, price: 100, confidence, description: id,
    });
    const input = [pattern("z", 8, 8, 0.9), pattern("b", 10, 9, 0.8), pattern("a", 10, 9, 0.8), pattern("c", 10, 8, 0.99)];
    const before = input.map((item) => item.id);

    assert.deepEqual(sortSpxPriceActionPatternsLatestFirst(input).map((item) => item.id), ["a", "b", "c", "z"]);
    assert.deepEqual(
      sortSpxPriceActionPatternsLatestFirst(input.filter((item) => item.id !== "a")).map((item) => item.id),
      ["b", "c", "z"],
    );
    assert.deepEqual(input.map((item) => item.id), before);
  });

  it("projects fullscreen coordinates and clamps pointer boundaries", () => {
    assert.deepEqual(projectSpxChartClientPoint({
      clientX: 800,
      clientY: 500,
      rect: { left: 0, top: 0, width: 1600, height: 1000 },
      viewBoxWidth: 1200,
      viewBoxHeight: 750,
    }), { x: 600, y: 375, scaleX: 0.75, scaleY: 0.75 });
    assert.deepEqual(projectSpxChartClientPoint({
      clientX: -40,
      clientY: 1200,
      rect: { left: 0, top: 0, width: 1600, height: 1000 },
      viewBoxWidth: 1200,
      viewBoxHeight: 750,
    }), { x: 0, y: 750, scaleX: 0.75, scaleY: 0.75 });
  });

  it("projects client coordinates through SVG offsets and CSS scaling", () => {
    assert.deepEqual(projectSpxChartClientPoint({
      clientX: 550,
      clientY: 360,
      rect: { left: 100, top: 60, width: 900, height: 600 },
      viewBoxWidth: 1800,
      viewBoxHeight: 1200,
    }), { x: 900, y: 600, scaleX: 2, scaleY: 2 });
  });

  it("detects deterministic candle patterns from source OHLCV geometry", () => {
    const patterns = detectSpxPriceActionPatterns(buildDetectorFixture());
    const types = new Set(patterns.map((pattern) => pattern.type));

    assert.equal(types.has("PIN_BAR_BULLISH"), true);
    assert.equal(types.has("ENGULFING_BULLISH"), true);
    assert.equal(types.has("INSIDE_BAR"), true);
    assert.equal(types.has("DOJI"), true);
    assert.ok(patterns.every((pattern) => pattern.confidence >= 0 && pattern.confidence <= 1));
  });

  it("derives support and resistance zones from clustered swing touches", () => {
    const fixture = buildZoneFixture();
    const swings = findSpxPriceActionSwingPoints(fixture, 1, 1);
    const zones = deriveSpxSupportResistanceZones(fixture, { swingStrength: 1, tolerancePercent: 0.003 });

    assert.ok(swings.highs.length >= 2);
    assert.ok(swings.lows.length >= 2);
    assert.ok(zones.some((zone) => zone.type === "resistance" && Math.abs(zone.price - 105) < 0.4));
    assert.ok(zones.some((zone) => zone.type === "support" && Math.abs(zone.price - 98) < 0.4));
  });

  it("builds a stable analysis response shape", () => {
    const payload = buildSpxPriceActionCompassResponse({
      timeframe: "5m",
      candles: buildDetectorFixture(),
      source: {
        provider: "test",
        label: "Fixture",
        symbol: "SPX",
        range: "fixture",
        interval: "5m",
        fetchedAt: "2026-06-01T15:00:00.000Z",
        note: "test",
      },
    });

    assert.equal(payload.ticker, "SPX");
    assert.equal(payload.timeframe, "5m");
    assert.ok(payload.candles.length > 0);
    assert.ok(Array.isArray(payload.patterns));
    assert.ok(Array.isArray(payload.zones));
    assert.equal(typeof payload.summary.patternCounts, "object");
    assert.equal(payload.source.provider, "test");
  });
});

describe("SPX Price Action Compass API", () => {
  it("returns source, candles, patterns, zones, trend, and summary in the API response", async () => {
    const response = await getSpxPriceActionCompassApi({
      request: new Request("https://example.com/api/spx-price-action-compass?timeframe=5m"),
      env: { SPX_PRICE_ACTION_TEST_CANDLES: buildDetectorFixture() },
    });
    const payload = await response.json() as {
      ticker: string;
      timeframe: string;
      candles: SpxPriceActionCandle[];
      patterns: unknown[];
      zones: unknown[];
      trend: { direction: string; labels: unknown[] };
      summary: { latestClose: number | null; latestPattern: unknown | null };
      source: { provider: string; interval: string };
    };

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /application\/json; charset=utf-8/);
    assert.equal(payload.ticker, "SPX");
    assert.equal(payload.timeframe, "5m");
    assert.ok(payload.candles.length > 0);
    assert.ok(payload.patterns.length > 0);
    assert.ok(Array.isArray(payload.zones));
    assert.ok(Array.isArray(payload.trend.labels));
    assert.equal(typeof payload.summary.latestClose, "number");
    assert.ok(payload.summary.latestPattern);
    assert.equal(payload.source.provider, "test");
  });

  it("returns a compact dense 1-minute series for the GEX pressure overlay without pattern payload", async () => {
    const fixture = buildDetectorFixture();
    const response = await getSpxPriceActionCompassApi({
      request: new Request("https://example.com/api/spx-price-action-compass?timeframe=15m&view=price-overlay"),
      env: { SPX_PRICE_ACTION_TEST_CANDLES: fixture },
    });
    const payload = await response.json() as {
      timeframe: string;
      candles: SpxPriceActionCandle[];
      source: { provider: string; note: string };
      patterns?: unknown[];
    };

    assert.equal(response.status, 200);
    assert.equal(payload.timeframe, "1m");
    assert.equal(payload.candles.length, fixture.length);
    assert.equal(payload.patterns, undefined);
    assert.equal(payload.source.provider, "test");
    assert.match(payload.source.note, /GEX pressure overlay/);
  });

  it("selects a compact ranked actionable subset without changing detector patterns", () => {
    const candles = Array.from({ length: 100 }, (_, index) => candle(index, 100, 101, 99, 100));
    const pattern = (id: string, toIndex: number, confidence: number, direction: SpxPriceActionPattern["direction"], type: SpxPriceActionPattern["type"], price = 100): SpxPriceActionPattern => ({
      id, type, name: id, label: id, category: "candle", direction,
      candleIndices: [toIndex], fromIndex: toIndex, toIndex, price, confidence, description: id,
    });
    const patterns = [
      pattern("selected-old", 4, 0.4, "neutral", "DOJI"),
      pattern("old", 18, 0.95, "bullish", "ENGULFING_BULLISH"),
      pattern("low-confidence", 99, 0.79, "bullish", "ENGULFING_BULLISH"),
      pattern("neutral", 99, 0.99, "neutral", "DOJI"),
      pattern("duplicate-weaker", 90, 0.8, "bullish", "ENGULFING_BULLISH"),
      pattern("duplicate-winner", 96, 0.82, "bullish", "ENGULFING_BULLISH"),
      pattern("near-resistance", 94, 0.8, "bearish", "PIN_BAR_BEARISH", 105),
      pattern("third", 93, 0.8, "bullish", "PIN_BAR_BULLISH"),
      pattern("fourth", 92, 0.8, "bearish", "ENGULFING_BEARISH"),
    ];
    const zones: SpxPriceActionZone[] = [{
      id: "resistance-105", type: "resistance", price: 105, minPrice: 104.8, maxPrice: 105.2,
      strength: 4, touches: [], distanceToLastPercent: 0,
    }];
    const before = patterns.map((item) => item.id);

    const selected = selectActionablePatterns({ patterns, candles, zones, selectedPatternId: "selected-old" });

    assert.deepEqual(selected.map((item) => item.pattern.id), ["near-resistance", "duplicate-winner", "third", "selected-old"]);
    assert.equal(selected[0].confluenceZone?.id, "resistance-105");
    assert.equal(selected.some((item) => item.pattern.id === "old"), false);
    assert.equal(selected.some((item) => item.pattern.id === "low-confidence"), false);
    assert.equal(selected.some((item) => item.pattern.id === "neutral"), false);
    assert.equal(selected.some((item) => item.pattern.id === "duplicate-weaker"), false);
    assert.deepEqual(patterns.map((item) => item.id), before);
  });

  it("uses 0DTESPX for the current intraday session with a five-minute edge TTL", async () => {
    const originalFetch = globalThis.fetch;
    const now = Date.now();
    const datetime = new Date(now).toISOString();
    const sessionDate = etTradingDate();
    const calls: Array<{ url: string; authorization: string | null }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      calls.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      if (url.endsWith("/market-data/sessions")) return Response.json({ [sessionDate]: { current: true } });
      return Response.json([
        { datetime, datetimeUnix: Math.floor(now / 1000) - 2, spx: "6000.25" },
        { datetime: new Date(now - 1_000).toISOString(), datetimeUnix: Math.floor(now / 1000) - 1, spx: "6001.50" },
        { datetime: new Date(now).toISOString(), datetimeUnix: Math.floor(now / 1000), spx: "5999.75" },
      ]);
    }) as typeof fetch;
    try {
      const response = await getSpxPriceActionCompassApi({
        request: new Request("https://example.com/api/spx-price-action-compass?timeframe=1m"),
        env: { ZERO_DTE_SPX_API_TOKEN: "secret-token" },
      });
      const payload = await response.json() as { source: { provider: string; interval: string; latestSampleAt: string; status: string }; candles: SpxPriceActionCandle[] };

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "public, max-age=300");
      assert.equal(payload.source.provider, "0dtespx");
      assert.equal(payload.source.interval, "1s->1m");
      assert.equal(payload.source.status, "READY");
      assert.ok(payload.source.latestSampleAt);
      assert.equal(payload.candles.length, 1);
      assert.equal(payload.candles[0].open, 6000.25);
      assert.equal(payload.candles[0].high, 6001.5);
      assert.equal(payload.candles[0].low, 5999.75);
      assert.deepEqual(calls.map((call) => call.authorization), ["secret-token", "secret-token"]);
      assert.match(calls[1].url, new RegExp(`/market-data/historical/${sessionDate}`));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails closed with a safe 0DTESPX error when the current-session source is rate limited", async () => {
    const originalFetch = globalThis.fetch;
    const sessionDate = etTradingDate();
    globalThis.fetch = (async (input) => String(input).endsWith("/market-data/sessions")
      ? Response.json({ [sessionDate]: { current: true } })
      : Response.json({ error: "rate_limit_exceeded" }, { status: 429 })) as typeof fetch;
    try {
      const response = await getSpxPriceActionCompassApi({
        request: new Request("https://example.com/api/spx-price-action-compass?timeframe=1m"),
        env: { ZERO_DTE_SPX_API_TOKEN: "secret-token" },
      });
      const payload = await response.json() as { source: { provider: string; status: string; range: string; interval: string }; warnings: string[] };
      assert.equal(response.status, 502);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(payload.source.provider, "0dtespx");
      assert.equal(payload.source.status, "UNAVAILABLE");
      assert.equal(payload.source.range, "current RTH session");
      assert.equal(payload.source.interval, "1s->1m");
      assert.deepEqual(payload.warnings, ["ZERO_DTE_SPX_RATE_LIMITED"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("0DTESPX intraday normalization", () => {
  it("builds a minute OHLC candle from valid second prices, including a partial latest minute", () => {
    const now = Date.parse("2026-08-20T14:31:03.000Z");
    const result = normalizeZeroDteSpxOneMinuteCandles([
      { datetimeUnix: 1_787_236_260, spx: "6000" },
      { datetimeUnix: 1_787_236_261, spx: "6002" },
      { datetimeUnix: 1_787_236_262, spx: "5998" },
    ], now);
    assert.equal(result.candles.length, 1);
    assert.deepEqual(result.candles[0], {
      time: 1_787_236_260_000, date_iso: "2026-08-20", open: 6000, high: 6002, low: 5998, close: 5998, volume: 0,
    });
  });

  it("aggregates normalized 1-minute context into the requested 5-minute PA candle", () => {
    const minute = 60_000;
    const source = [
      { time: 0, date_iso: "2026-08-20", open: 100, high: 102, low: 99, close: 101, volume: 0 },
      { time: minute, date_iso: "2026-08-20", open: 101, high: 104, low: 100, close: 103, volume: 0 },
      { time: 2 * minute, date_iso: "2026-08-20", open: 103, high: 105, low: 102, close: 104, volume: 0 },
    ];
    assert.deepEqual(aggregateSpxOneMinutePriceActionCandles(source, "5m"), [{
      time: 0, date_iso: "1970-01-01", open: 100, high: 105, low: 99, close: 104, volume: 0,
    }]);
  });

  it("rejects stale and malformed 0DTESPX samples without producing fake candles", () => {
    assert.throws(
      () => normalizeZeroDteSpxOneMinuteCandles([{ datetimeUnix: 1_787_236_000, spx: "6000" }], 1_787_236_700_000),
      (error: unknown) => error instanceof ZeroDteSpxError && error.code === "ZERO_DTE_SPX_STALE",
    );
    assert.throws(
      () => normalizeZeroDteSpxOneMinuteCandles([{ datetimeUnix: "bad", spx: "n/a" }], Date.now()),
      (error: unknown) => error instanceof ZeroDteSpxError && error.code === "ZERO_DTE_SPX_RESPONSE_INVALID",
    );
  });

  it("requires a server-side token before making a 0DTESPX request", async () => {
    await assert.rejects(
      () => fetchZeroDteSpxCurrentSession(undefined),
      (error: unknown) => error instanceof ZeroDteSpxError && error.code === "ZERO_DTE_SPX_TOKEN_MISSING",
    );
  });
});
