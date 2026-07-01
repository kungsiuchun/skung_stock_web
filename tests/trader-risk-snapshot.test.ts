import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveTraderRiskSnapshot } from "../src/lib/trader-risk-snapshot";

test("deriveTraderRiskSnapshot calculates deterministic trader metrics", () => {
  const candles = Array.from({ length: 21 }, (_, index) => {
    const price = 100 + index;
    return {
      price,
      open: price - 1,
      high: price + 2,
      low: price - 2,
      volume: index === 20 ? 3_000_000 : 2_000_000,
    };
  });

  const snapshot = deriveTraderRiskSnapshot(candles);

  assert.equal(snapshot.source, "Yahoo Finance chart data + local deterministic calculation");
  assert.equal(snapshot.dollarVolume, 360_000_000);
  assert.equal(snapshot.relativeVolume, 1.5);
  assert.equal(snapshot.atr14, 4);
  assert.equal(Math.round(snapshot.rangePositionPct ?? 0), 91);
  assert.deepEqual(
    snapshot.bars.map((bar) => bar.label),
    ["Dollar Volume", "Relative Volume", "ATR 14", "20D Range Position"],
  );
});

test("deriveTraderRiskSnapshot reports Needs data when candles are unavailable", () => {
  const snapshot = deriveTraderRiskSnapshot([]);

  assert.equal(snapshot.dollarVolume, null);
  assert.equal(snapshot.relativeVolume, null);
  assert.equal(snapshot.atr14, null);
  assert.equal(snapshot.rangePositionPct, null);
  assert.equal(snapshot.bars[0].value, "Needs data");
});
