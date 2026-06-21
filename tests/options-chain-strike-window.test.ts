import assert from "node:assert/strict";
import test from "node:test";

import { selectOptionLegsNearUnderlying } from "../functions/api/agent/tools/stock-tools";

test("options chain window is selected around underlying price before truncation", () => {
  const lowToHighStrikes = Array.from({ length: 25 }, (_, index) => ({
    strike: 200 + index * 2.5,
    openInterest: 100 + index,
  }));

  const selected = selectOptionLegsNearUnderlying(lowToHighStrikes, 244, 8);
  const strikes = selected.map((leg) => leg.strike);

  assert.deepEqual(strikes, [235, 237.5, 240, 242.5, 245, 247.5, 250, 252.5]);
  assert.equal(strikes.includes(200), false);
  assert.equal(strikes.includes(222.5), false);
});

test("options chain falls back to source order only when spot is unavailable", () => {
  const legs = [200, 202.5, 205].map((strike) => ({ strike }));

  assert.deepEqual(selectOptionLegsNearUnderlying(legs, undefined, 2), [
    { strike: 200 },
    { strike: 202.5 },
  ]);
});
