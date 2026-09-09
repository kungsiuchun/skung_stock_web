import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isStrictIsoDate, onRequest as getSpxPriceActionCompassApi, shouldCacheSpxPriceActionResponse } from "../functions/api/spx-price-action-compass";
import {
  fetchZeroDteSpxCurrentSession,
  normalizeZeroDteSpxOneMinuteCandles,
  resolveZeroDteSpxSession,
  ZERO_DTE_SPX_EM_LAG_TOLERANCE_MS,
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

const sessionMetadata = (startMs: number, endMs: number, flags: { current?: boolean; upcoming?: boolean } = {}) => ({
  "start-time": new Date(startMs).toISOString(),
  "end-time": new Date(endMs).toISOString(),
  "data-start-time": new Date(startMs + 60_000).toISOString(),
  "data-end-time": new Date(endMs).toISOString(),
  ...flags,
});

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
  it("requires a real YYYY-MM-DD date for price-overlay before any upstream or cache lookup", async () => {
    assert.equal(isStrictIsoDate("2026-02-28"), true);
    assert.equal(isStrictIsoDate("2026-02-30"), false);
    assert.equal(isStrictIsoDate("2026-2-08"), false);
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("must not fetch");
    }) as typeof fetch;
    try {
      for (const query of ["view=price-overlay", "view=price-overlay&date=2026-02-30"]) {
        const response = await getSpxPriceActionCompassApi({
          request: new Request(`https://example.com/api/spx-price-action-compass?${query}`),
          env: { ZERO_DTE_SPX_API_TOKEN: "secret-token" },
        });
        assert.equal(response.status, 400);
        assert.equal(response.headers.get("cache-control"), "no-store");
      }
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

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
      request: new Request("https://example.com/api/spx-price-action-compass?timeframe=15m&view=price-overlay&date=2026-08-20"),
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

  it("caches a current 0DTESPX pressure overlay only when Expected Move is ready", async () => {
    const originalFetch = globalThis.fetch;
    // Keep all three fixture seconds inside one completed minute. Date.now()
    // near a minute boundary would otherwise create two candles and make this
    // source-contract test flaky.
    const now = Math.floor((Date.now() - 60_000) / 60_000) * 60_000 + 50_000;
    const datetime = new Date(now).toISOString();
    const sessionDate = etTradingDate();
    const calls: Array<{ url: string; authorization: string | null }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      calls.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      if (url.endsWith("/market-data/sessions")) return Response.json({ [sessionDate]: sessionMetadata(now - 3_600_000, now + 3_600_000, { current: true }) });
      return Response.json([
        { datetime, datetimeUnix: Math.floor(now / 1000) - 2, spx: "6000.25", spx_expected_move: "42.5" },
        { datetime: new Date(now - 1_000).toISOString(), datetimeUnix: Math.floor(now / 1000) - 1, spx: "6001.50", spx_expected_move: "42.75" },
        { datetime: new Date(now).toISOString(), datetimeUnix: Math.floor(now / 1000), spx: "5999.75", spx_expected_move: "43" },
      ]);
    }) as typeof fetch;
    try {
      const response = await getSpxPriceActionCompassApi({
        request: new Request(`https://example.com/api/spx-price-action-compass?view=price-overlay&date=${sessionDate}`),
        env: { ZERO_DTE_SPX_API_TOKEN: "secret-token" },
      });
      const payload = await response.json() as { source: { provider: string; interval: string; latestSampleAt: string; status: string; expectedMove: { status: string; value: number; sampleAt: string; ageMs: number; lagMs: number; errorCode: string | null } }; candles: SpxPriceActionCandle[] };

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "public, max-age=60");
      assert.equal(payload.source.provider, "0dtespx");
      assert.equal(payload.source.interval, "1s->1m");
      assert.equal(payload.source.status, "READY");
      assert.ok(payload.source.latestSampleAt);
      assert.equal(payload.source.expectedMove.status, "READY");
      assert.equal(payload.source.expectedMove.value, 43);
      assert.equal(payload.source.expectedMove.sampleAt, new Date(now).toISOString());
      assert.ok(payload.source.expectedMove.ageMs >= 0 && payload.source.expectedMove.ageMs <= 10 * 60_000);
      assert.equal(payload.source.expectedMove.lagMs, 0);
      assert.equal(payload.source.expectedMove.errorCode, null);
      assert.equal(shouldCacheSpxPriceActionResponse(true, payload.source), true);
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

  it("does not cache a current 0DTESPX pressure overlay while Expected Move is unavailable", async () => {
    const originalFetch = globalThis.fetch;
    const now = Math.floor((Date.now() - 60_000) / 60_000) * 60_000 + 50_000;
    const sessionDate = etTradingDate();
    globalThis.fetch = (async (input) => String(input).endsWith("/market-data/sessions")
      ? Response.json({ [sessionDate]: sessionMetadata(now - 3_600_000, now + 3_600_000, { current: true }) })
      : Response.json([
        { datetimeUnix: Math.floor((now - 1_000) / 1_000), spx: "6000.25", spx_expected_move: "42.5" },
        { datetimeUnix: Math.floor(now / 1_000), spx: "6001.50", spx_expected_move: "bad" },
      ])) as typeof fetch;
    try {
      const response = await getSpxPriceActionCompassApi({
        request: new Request(`https://example.com/api/spx-price-action-compass?view=price-overlay&date=${sessionDate}`),
        env: { ZERO_DTE_SPX_API_TOKEN: "secret-token" },
      });
      const payload = await response.json() as { source: { provider: "0dtespx"; expectedMove: { status: "UNAVAILABLE"; value: null } } };

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(payload.source.expectedMove.status, "UNAVAILABLE");
      assert.equal(shouldCacheSpxPriceActionResponse(true, payload.source), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails closed with a safe 0DTESPX error when the current-session source is rate limited", async () => {
    const originalFetch = globalThis.fetch;
    const sessionDate = etTradingDate();
    const now = Date.now();
    globalThis.fetch = (async (input) => String(input).endsWith("/market-data/sessions")
      ? Response.json({ [sessionDate]: sessionMetadata(now - 3_600_000, now + 3_600_000, { current: true }) })
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

  it("keeps the same ET date on 0DTESPX at 15:59, 16:01, and 16:15 without regressing the final timestamp", async () => {
    const originalFetch = globalThis.fetch;
    const date = "2026-07-13";
    const startMs = Date.parse("2026-07-13T13:30:00.000Z");
    const endMs = Date.parse("2026-07-13T20:00:00.000Z");
    const samples = [
      { nowMs: Date.parse("2026-07-13T19:59:00.000Z"), current: true, latestMs: Date.parse("2026-07-13T19:59:00.000Z"), state: "LIVE", cache: "public, max-age=60" },
      { nowMs: Date.parse("2026-07-13T20:01:00.000Z"), current: false, latestMs: endMs, state: "CLOSED", cache: "public, max-age=3600" },
      { nowMs: Date.parse("2026-07-13T20:15:00.000Z"), current: false, latestMs: endMs, state: "CLOSED", cache: "public, max-age=3600" },
    ] as const;
    const latestTimes: string[] = [];
    try {
      for (const sample of samples) {
        const calls: string[] = [];
        globalThis.fetch = (async (input) => {
          const url = String(input);
          calls.push(url);
          if (url.endsWith("/market-data/sessions")) {
            return Response.json({ [date]: sessionMetadata(startMs, endMs, sample.current ? { current: true } : {}) });
          }
          if (url.includes(`/market-data/historical/${date}`)) {
            return Response.json([
              { datetime: new Date(startMs + 60_000).toISOString(), spx: 6000, spx_expected_move: 25 },
              { datetime: new Date(sample.latestMs).toISOString(), spx: 6010, spx_expected_move: 26 },
            ]);
          }
          throw new Error(`unexpected Yahoo fallback: ${url}`);
        }) as typeof fetch;
        const response = await getSpxPriceActionCompassApi({
          request: new Request(`https://example.com/api/spx-price-action-compass?view=price-overlay&date=${date}`),
          env: { ZERO_DTE_SPX_API_TOKEN: "secret-token", SPX_PRICE_ACTION_TEST_NOW_MS: sample.nowMs },
        });
        const payload = await response.json() as { source: { provider: string; sessionState: string; latestSampleAt: string; priceAgeMs: number; routingReason: string }; candles: SpxPriceActionCandle[] };
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), sample.cache);
        assert.equal(payload.source.provider, "0dtespx");
        assert.equal(payload.source.sessionState, sample.state);
        assert.match(payload.source.routingReason, /CURRENT_ET_SESSION_(LIVE|CLOSED_HISTORICAL)/);
        assert.equal(payload.candles.at(-1)?.time, sample.latestMs);
        latestTimes.push(payload.source.latestSampleAt);
        assert.deepEqual(calls.map((url) => new URL(url).hostname), ["api.0dtespx.com", "api.0dtespx.com"]);
      }
      assert.deepEqual(latestTimes, [
        "2026-07-13T19:59:00.000Z",
        "2026-07-13T20:00:00.000Z",
        "2026-07-13T20:00:00.000Z",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses provider metadata for a half-day close and never falls back to Yahoo when post-close history fails", async () => {
    const originalFetch = globalThis.fetch;
    const date = "2026-11-27";
    const startMs = Date.parse("2026-11-27T14:30:00.000Z");
    const endMs = Date.parse("2026-11-27T18:00:00.000Z");
    const nowMs = Date.parse("2026-11-27T18:15:00.000Z");
    const calls: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/market-data/sessions")) return Response.json({ [date]: sessionMetadata(startMs, endMs) });
      if (url.includes(`/market-data/historical/${date}`)) return Response.json({ error: "finalization" }, { status: 503 });
      throw new Error(`unexpected Yahoo fallback: ${url}`);
    }) as typeof fetch;
    try {
      const response = await getSpxPriceActionCompassApi({
        request: new Request(`https://example.com/api/spx-price-action-compass?view=price-overlay&date=${date}`),
        env: { ZERO_DTE_SPX_API_TOKEN: "secret-token", SPX_PRICE_ACTION_TEST_NOW_MS: nowMs },
      });
      const payload = await response.json() as { source: { provider: string; sessionState: string; sessionEndAt: string; routingReason: string }; warnings: string[] };
      assert.equal(response.status, 502);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(payload.source.provider, "0dtespx");
      assert.equal(payload.source.sessionState, "CLOSED");
      assert.equal(payload.source.sessionEndAt, new Date(endMs).toISOString());
      assert.equal(payload.source.routingReason, "CURRENT_ET_SESSION_CLOSED_HISTORICAL");
      assert.deepEqual(payload.warnings, ["ZERO_DTE_SPX_UPSTREAM_UNAVAILABLE"]);
      assert.equal(calls.length, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails closed instead of using Yahoo when today's provider session metadata is missing", async () => {
    const originalFetch = globalThis.fetch;
    const date = "2026-07-13";
    const nowMs = Date.parse("2026-07-13T20:15:00.000Z");
    const calls: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/market-data/sessions")) return Response.json({});
      throw new Error(`unexpected Yahoo fallback: ${url}`);
    }) as typeof fetch;
    try {
      const response = await getSpxPriceActionCompassApi({
        request: new Request(`https://example.com/api/spx-price-action-compass?view=price-overlay&date=${date}`),
        env: { ZERO_DTE_SPX_API_TOKEN: "secret-token", SPX_PRICE_ACTION_TEST_NOW_MS: nowMs },
      });
      const payload = await response.json() as { source: { provider: string; sessionState: string }; warnings: string[] };
      assert.equal(response.status, 502);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(payload.source.provider, "0dtespx");
      assert.equal(payload.source.sessionState, "UNAVAILABLE");
      assert.deepEqual(payload.warnings, ["ZERO_DTE_SPX_RESPONSE_INVALID"]);
      assert.equal(calls.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("marks the post-close provider race FINALIZING and refuses an incomplete final sample", async () => {
    const originalFetch = globalThis.fetch;
    const date = "2026-07-13";
    const startMs = Date.parse("2026-07-13T13:30:00.000Z");
    const endMs = Date.parse("2026-07-13T20:00:00.000Z");
    const nowMs = endMs + 60_000;
    globalThis.fetch = (async (input) => String(input).endsWith("/market-data/sessions")
      ? Response.json({ [date]: sessionMetadata(startMs, endMs, { current: true }) })
      : Response.json([{ datetime: new Date(endMs - 60_001).toISOString(), spx: 6000, spx_expected_move: 25 }])) as typeof fetch;
    try {
      const response = await getSpxPriceActionCompassApi({
        request: new Request(`https://example.com/api/spx-price-action-compass?view=price-overlay&date=${date}`),
        env: { ZERO_DTE_SPX_API_TOKEN: "secret-token", SPX_PRICE_ACTION_TEST_NOW_MS: nowMs },
      });
      const payload = await response.json() as { source: { provider: string; sessionState: string; routingReason: string }; warnings: string[] };
      assert.equal(response.status, 502);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(payload.source.provider, "0dtespx");
      assert.equal(payload.source.sessionState, "FINALIZING");
      assert.equal(payload.source.routingReason, "CURRENT_ET_SESSION_FINALIZING");
      assert.deepEqual(payload.warnings, ["ZERO_DTE_SPX_FINALIZING"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("routes pre-open and older-date 1m plus 4h/1d to Yahoo", async () => {
    const originalFetch = globalThis.fetch;
    const date = "2026-07-13";
    const olderDate = "2026-07-10";
    const startMs = Date.parse("2026-07-13T13:30:00.000Z");
    const endMs = Date.parse("2026-07-13T20:00:00.000Z");
    const nowMs = Date.parse("2026-07-13T12:00:00.000Z");
    const yahooPayload = { chart: { result: [{
      timestamp: [Math.floor(startMs / 1_000)],
      indicators: { quote: [{ open: [6000], high: [6002], low: [5998], close: [6001], volume: [10] }] },
    }] } };
    const urls: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/market-data/sessions")) return Response.json({ [date]: sessionMetadata(startMs, endMs, { upcoming: true }) });
      if (url.includes("query1.finance.yahoo.com")) return Response.json(yahooPayload);
      throw new Error(`unexpected route: ${url}`);
    }) as typeof fetch;
    try {
      const requests = [
        `view=price-overlay&date=${date}`,
        `view=price-overlay&date=${olderDate}`,
        "timeframe=4h",
        "timeframe=1d",
      ];
      for (const query of requests) {
        const response = await getSpxPriceActionCompassApi({
          request: new Request(`https://example.com/api/spx-price-action-compass?${query}`),
          env: { ZERO_DTE_SPX_API_TOKEN: "secret-token", SPX_PRICE_ACTION_TEST_NOW_MS: nowMs },
        });
        const payload = await response.json() as { source: { provider: string; sessionState?: string; routingReason: string } };
        assert.equal(response.status, 200);
        assert.equal(payload.source.provider, "yahoo");
      }
      assert.equal(urls.filter((url) => url.endsWith("/market-data/sessions")).length, 1);
      assert.equal(urls.filter((url) => url.includes("/market-data/historical/")).length, 0);
      assert.equal(urls.filter((url) => url.includes("query1.finance.yahoo.com")).length, 4);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("0DTESPX intraday normalization", () => {
  it("classifies live, finalizing, closed, upcoming, and half-day sessions from provider metadata", () => {
    const date = "2026-11-27";
    const startMs = Date.parse("2026-11-27T14:30:00.000Z");
    const endMs = Date.parse("2026-11-27T18:00:00.000Z");
    assert.equal(resolveZeroDteSpxSession({ [date]: sessionMetadata(startMs, endMs, { upcoming: true }) }, date, startMs - 1)?.state, "UPCOMING");
    assert.equal(resolveZeroDteSpxSession({ [date]: sessionMetadata(startMs, endMs, { current: true }) }, date, endMs - 1)?.state, "LIVE");
    assert.equal(resolveZeroDteSpxSession({ [date]: sessionMetadata(startMs, endMs, { current: true }) }, date, endMs + 1)?.state, "FINALIZING");
    assert.equal(resolveZeroDteSpxSession({ [date]: sessionMetadata(startMs, endMs) }, date, endMs + 1)?.state, "CLOSED");
    assert.throws(
      () => resolveZeroDteSpxSession({ [date]: sessionMetadata(startMs, endMs, { current: true, upcoming: true }) }, date, startMs),
      /ZERO_DTE_SPX_RESPONSE_INVALID/,
    );
  });

  it("accepts only missing/null newest-row EM backfill within 60,000ms", () => {
    const now = Date.parse("2026-08-20T14:31:03.001Z");
    const row = (time: number, spx: number | undefined, em: unknown, include = true) => ({
      datetime: new Date(time).toISOString(),
      ...(spx === undefined ? {} : { spx }),
      ...(include ? { spx_expected_move: em } : {}),
    });
    const acceptedMissing = normalizeZeroDteSpxOneMinuteCandles([
      row(now - ZERO_DTE_SPX_EM_LAG_TOLERANCE_MS, 6000, 25),
      row(now, 6001, undefined, false),
    ], now);
    assert.equal(acceptedMissing.expectedMove.status, "READY");
    assert.equal(acceptedMissing.expectedMove.lagMs, 60_000);

    const acceptedNull = normalizeZeroDteSpxOneMinuteCandles([
      row(now - 30_000, 6000, 25),
      row(now, 6001, null),
    ], now);
    assert.equal(acceptedNull.expectedMove.status, "READY");
    assert.equal(acceptedNull.expectedMove.sampleAt, new Date(now - 30_000).toISOString());

    const lagged = normalizeZeroDteSpxOneMinuteCandles([
      row(now - 60_001, 6000, 25),
      row(now, 6001, undefined, false),
    ], now);
    assert.equal(lagged.expectedMove.errorCode, "ZERO_DTE_SPX_EXPECTED_MOVE_LAGGED");

    const invalidNewest = normalizeZeroDteSpxOneMinuteCandles([
      row(now - 30_000, 6000, 25),
      row(now - 1, undefined, "bad"),
      row(now, 6001, undefined, false),
    ], now);
    assert.equal(invalidNewest.expectedMove.errorCode, "ZERO_DTE_SPX_EXPECTED_MOVE_INVALID");
    for (const invalidValue of [0, -1]) {
      const invalidNonPositive = normalizeZeroDteSpxOneMinuteCandles([
        row(now - 30_000, 6000, 25),
        row(now, 6001, invalidValue),
      ], now);
      assert.equal(invalidNonPositive.expectedMove.errorCode, "ZERO_DTE_SPX_EXPECTED_MOVE_INVALID");
    }

    const future = normalizeZeroDteSpxOneMinuteCandles([
      row(now, 6001, undefined, false),
      row(now + 1, undefined, 25),
    ], now);
    assert.equal(future.expectedMove.errorCode, "ZERO_DTE_SPX_EXPECTED_MOVE_FUTURE");
  });

  it("validates a completed session against data-end-time instead of wall-clock age", () => {
    const dataEndAt = "2026-07-13T20:00:00.000Z";
    const weeksLater = Date.parse("2026-08-01T20:00:00.000Z");
    const closed = normalizeZeroDteSpxOneMinuteCandles([
      { datetime: dataEndAt, spx: 6000, spx_expected_move: 25 },
    ], weeksLater, { state: "CLOSED", dataEndAt });
    assert.equal(closed.latestSampleAt, dataEndAt);
    assert.equal(closed.expectedMove.status, "READY");
    assert.ok(closed.priceAgeMs > 10 * 60_000);
    assert.throws(
      () => normalizeZeroDteSpxOneMinuteCandles([
        { datetime: "2026-07-13T19:58:59.999Z", spx: 6000 },
      ], weeksLater, { state: "CLOSED", dataEndAt }),
      (error: unknown) => error instanceof ZeroDteSpxError && error.code === "ZERO_DTE_SPX_SESSION_INCOMPLETE",
    );
  });

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
    assert.throws(
      () => normalizeZeroDteSpxOneMinuteCandles([{ datetimeUnix: 1_787_237_300, spx: "6000" }], 1_787_236_700_000),
      (error: unknown) => error instanceof ZeroDteSpxError && error.code === "ZERO_DTE_SPX_STALE",
    );
  });

  it("keeps valid SPX candles when expected move is absent or stale", () => {
    const now = Date.parse("2026-08-20T14:31:03.000Z");
    const unavailable = normalizeZeroDteSpxOneMinuteCandles([
      { datetimeUnix: Math.floor((now - 1_000) / 1_000), spx: "6000", spxExpectedMove: "0" },
      { datetimeUnix: Math.floor(now / 1_000), spx: "6001", spxExpectedMove: "bad" },
    ], now);
    assert.equal(unavailable.candles.length, 1);
    assert.deepEqual(unavailable.expectedMove, {
      status: "UNAVAILABLE", value: null, sampleAt: new Date(now).toISOString(), ageMs: 0, lagMs: 0,
      errorCode: "ZERO_DTE_SPX_EXPECTED_MOVE_INVALID",
    });

    const staleExpectedMove = normalizeZeroDteSpxOneMinuteCandles([
      { datetimeUnix: Math.floor((now - 11 * 60_000) / 1_000), spx: "5999", spxExpectedMove: "30" },
      { datetimeUnix: Math.floor(now / 1_000), spx: "6001" },
    ], now);
    assert.equal(staleExpectedMove.candles.length, 2);
    assert.equal(staleExpectedMove.expectedMove.status, "UNAVAILABLE");
    assert.equal(staleExpectedMove.expectedMove.errorCode, "ZERO_DTE_SPX_EXPECTED_MOVE_LAGGED");

    const latestInvalidExpectedMove = normalizeZeroDteSpxOneMinuteCandles([
      { datetimeUnix: Math.floor((now - 60_000) / 1_000), spx: "6000", spxExpectedMove: "30" },
      { datetimeUnix: Math.floor(now / 1_000), spx: "6001", spxExpectedMove: "bad" },
    ], now);
    assert.deepEqual(latestInvalidExpectedMove.expectedMove, {
      status: "UNAVAILABLE", value: null, sampleAt: new Date(now).toISOString(), ageMs: 0, lagMs: 0,
      errorCode: "ZERO_DTE_SPX_EXPECTED_MOVE_INVALID",
    });

    const futureExpectedMove = normalizeZeroDteSpxOneMinuteCandles([
      { datetimeUnix: Math.floor((now - 1_000) / 1_000), spx: "6000" },
      { datetimeUnix: Math.floor(now / 1_000), spx: "6001" },
      { datetimeUnix: Math.floor((now + 60_000) / 1_000), spxExpectedMove: "30" },
    ], now);
    assert.equal(futureExpectedMove.candles.length, 1);
    assert.equal(futureExpectedMove.expectedMove.status, "UNAVAILABLE");
    assert.equal(futureExpectedMove.expectedMove.errorCode, "ZERO_DTE_SPX_EXPECTED_MOVE_FUTURE");
  });

  it("requires a server-side token before making a 0DTESPX request", async () => {
    await assert.rejects(
      () => fetchZeroDteSpxCurrentSession(undefined),
      (error: unknown) => error instanceof ZeroDteSpxError && error.code === "ZERO_DTE_SPX_TOKEN_MISSING",
    );
  });
});
