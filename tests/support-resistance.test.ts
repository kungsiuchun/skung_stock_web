import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveSupportResistanceAnalysis,
  findSupportResistanceSwingPoints,
  selectSupportResistanceDisplayLevels,
  type SupportResistanceCandle,
  type SupportResistanceZone,
} from "../src/lib/support-resistance";

const candle = (index: number, high = 101, low = 99, close = 100): SupportResistanceCandle => ({
  time: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
  high,
  low,
  close,
});

const clusteredFixture = () => {
  const rows = Array.from({ length: 30 }, (_, index) => candle(index));
  rows[3] = candle(3, 105, 99, 100);
  rows[9] = candle(9, 105.2, 99, 100);
  rows[15] = candle(15, 104.8, 99, 100);
  rows[6] = candle(6, 101, 95, 100);
  rows[12] = candle(12, 101, 95.1, 100);
  rows[18] = candle(18, 101, 94.9, 100);
  return rows;
};

const zone = (input: Partial<SupportResistanceZone> & Pick<SupportResistanceZone, "id" | "role" | "price" | "touchCount">): SupportResistanceZone => ({
  lowerBound: input.price - 0.2,
  upperBound: input.price + 0.2,
  lastTouchTime: "2026-01-01",
  distancePct: input.price - 100,
  touchType: input.role === "support" ? "low" : "high",
  ...input,
});

test("clusters repeated swing highs and lows into resistance and support zones", () => {
  const rows = clusteredFixture();
  const swings = findSupportResistanceSwingPoints(rows, 2);
  const analysis = deriveSupportResistanceAnalysis(rows, { swingRadius: 2, tolerancePercent: 0.005 });

  assert.ok(swings.filter((point) => point.type === "high").length >= 3);
  assert.ok(swings.filter((point) => point.type === "low").length >= 3);
  assert.ok(analysis.zones.some((item) => item.role === "resistance" && Math.abs(item.price - 105) < 0.25 && item.touchCount === 3));
  assert.ok(analysis.zones.some((item) => item.role === "support" && Math.abs(item.price - 95) < 0.25 && item.touchCount === 3));
  assert.equal(analysis.method, "swing_cluster");
  assert.equal(analysis.lookbackBars, 30);
});

test("labels a cluster containing swing highs and lows as a mixed touch zone", () => {
  const rows = Array.from({ length: 14 }, (_, index) => index < 6
    ? candle(index, 96, 94, 95)
    : candle(index, 106, 104, 105));
  rows[2] = candle(2, 100, 94, 95);
  rows[9] = candle(9, 106, 100, 105);

  const analysis = deriveSupportResistanceAnalysis(rows, {
    swingRadius: 1,
    tolerancePercent: 0.002,
    minBars: 10,
  });
  assert.ok(analysis.zones.some((item) => Math.abs(item.price - 100) < 0.01 && item.touchType === "mixed"));
});

test("filters single touches and returns no fabricated levels", () => {
  const rows = Array.from({ length: 25 }, (_, index) => candle(index, 100 + index, 98 + index, 99 + index));
  const analysis = deriveSupportResistanceAnalysis(rows, { swingRadius: 2, tolerancePercent: 0.005 });
  assert.deepEqual(analysis.zones, []);
  assert.deepEqual(analysis.displayLevels, {
    nearestSupport: null,
    majorSupport: null,
    nearestResistance: null,
    majorResistance: null,
  });
});

test("uses percentage padding instead of a fixed dollar width for cheap stocks", () => {
  const rows = Array.from({ length: 24 }, (_, index) => candle(index, 1.01, 0.99, 1));
  rows[3] = candle(3, 1.05, 0.99, 1);
  rows[9] = candle(9, 1.051, 0.99, 1);
  rows[6] = candle(6, 1.01, 0.95, 1);
  rows[12] = candle(12, 1.01, 0.951, 1);
  const analysis = deriveSupportResistanceAnalysis(rows, { swingRadius: 2, tolerancePercent: 0.005 });

  assert.ok(analysis.zones.length >= 2);
  assert.ok(analysis.zones.every((item) => item.upperBound - item.lowerBound < 0.02));
});

test("ignores invalid OHLC rows and reports insufficient valid lookback without throwing", () => {
  const rows = clusteredFixture();
  rows.push({ time: "2026-02-01", high: 90, low: 110, close: 100 });
  const analysis = deriveSupportResistanceAnalysis(rows, { swingRadius: 2, tolerancePercent: 0.005 });
  assert.equal(analysis.lookbackBars, 30);
  assert.ok(analysis.zones.length >= 2);

  const insufficient = deriveSupportResistanceAnalysis(rows.slice(0, 19), { swingRadius: 2, tolerancePercent: 0.005 });
  assert.equal(insufficient.lookbackBars, 19);
  assert.deepEqual(insufficient.zones, []);
});

test("selects nearest and major levels without duplicating a zone", () => {
  const levels = selectSupportResistanceDisplayLevels([
    zone({ id: "s-near", role: "support", price: 98, touchCount: 2, distancePct: -2 }),
    zone({ id: "s-major", role: "support", price: 95, touchCount: 5, distancePct: -5, lastTouchTime: "2026-02-01" }),
    zone({ id: "r-near", role: "resistance", price: 102, touchCount: 2, distancePct: 2 }),
    zone({ id: "r-major", role: "resistance", price: 106, touchCount: 4, distancePct: 6, lastTouchTime: "2026-02-02" }),
  ]);

  assert.equal(levels.nearestSupport?.id, "s-near");
  assert.equal(levels.majorSupport?.id, "s-major");
  assert.equal(levels.nearestResistance?.id, "r-near");
  assert.equal(levels.majorResistance?.id, "r-major");
  assert.notEqual(levels.nearestSupport?.id, levels.majorSupport?.id);
  assert.notEqual(levels.nearestResistance?.id, levels.majorResistance?.id);
});

test("keeps missing sides explicit instead of reusing another level", () => {
  const levels = selectSupportResistanceDisplayLevels([
    zone({ id: "support-only", role: "support", price: 98, touchCount: 3, distancePct: -2 }),
  ]);
  assert.equal(levels.nearestSupport?.id, "support-only");
  assert.equal(levels.majorSupport, null);
  assert.equal(levels.nearestResistance, null);
  assert.equal(levels.majorResistance, null);
});
