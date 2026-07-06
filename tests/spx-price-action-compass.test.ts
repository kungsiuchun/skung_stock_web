import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { onRequest as getSpxPriceActionCompassApi } from "../functions/api/spx-price-action-compass";
import {
  buildSpxPriceActionCompassResponse,
  deriveSpxSupportResistanceZones,
  detectSpxPriceActionPatterns,
  findSpxPriceActionSwingPoints,
  type SpxPriceActionCandle,
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

describe("SPX Price Action Compass detector", () => {
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
});
