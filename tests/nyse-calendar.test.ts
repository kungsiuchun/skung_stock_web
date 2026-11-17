import assert from "node:assert/strict";
import test from "node:test";
import { getNyseSessionCloseMinuteEt, isNyseTradingDay } from "../src/lib/nyse-calendar";

test("NYSE Saturday New Year does not close the preceding Friday", () => {
  // https://www.nyse.com/trade/hours-calendars (2028 New Year's Day footnote).
  for (const date of ["2021-12-31", "2027-12-31"]) {
    assert.equal(isNyseTradingDay(date), true);
    assert.equal(getNyseSessionCloseMinuteEt(date), 16 * 60);
  }
  for (const date of ["2027-01-01", "2028-01-01", "2023-01-02", "2027-06-18", "2027-12-24"]) {
    assert.equal(isNyseTradingDay(date), false);
  }
  assert.equal(getNyseSessionCloseMinuteEt("2026-12-24"), 13 * 60);
});
