import assert from "node:assert/strict";
import test from "node:test";

import {
  D1_DATABASE_BUDGETS,
  D1_FREE_TIER_DAILY_LIMITS,
  D1_SITE_GUARD_RATIO,
  evaluateD1Budget,
  simulateD1DailyCosts,
} from "../src/lib/d1-free-tier-budget";

test("the two database allocations exactly consume the approved 70 percent site envelope", () => {
  const allocatedRead = D1_DATABASE_BUDGETS.MARKET_CACHE_DB.rowsRead + D1_DATABASE_BUDGETS.SPX_RECAP_DB.rowsRead;
  const allocatedWrites = D1_DATABASE_BUDGETS.MARKET_CACHE_DB.rowsWritten + D1_DATABASE_BUDGETS.SPX_RECAP_DB.rowsWritten;
  assert.equal(allocatedRead, D1_FREE_TIER_DAILY_LIMITS.rowsRead * D1_SITE_GUARD_RATIO);
  assert.equal(allocatedWrites, D1_FREE_TIER_DAILY_LIMITS.rowsWritten * D1_SITE_GUARD_RATIO);
});

test("budget cutoff reports its actual constrained dimension and UTC reset", () => {
  const writeBlocked = evaluateD1Budget({
    database: "MARKET_CACHE_DB",
    currentUtcDay: "2026-08-25",
    usage: { dayUtc: "2026-08-25", rowsRead: 100, rowsWritten: 19_999 },
    rowsRead: 1,
    rowsWritten: 1,
  });
  assert.equal(writeBlocked.allow, false);
  assert.equal(writeBlocked.reason, "write_threshold_exceeded");
  assert.deepEqual(writeBlocked.blockedDimensions, ["write"]);
  assert.equal(writeBlocked.resetsAtUtc, "2026-08-26T00:00:00.000Z");

  const reset = evaluateD1Budget({
    database: "SPX_RECAP_DB",
    currentUtcDay: "2026-08-26",
    usage: { dayUtc: "2026-08-25", rowsRead: 2_500_000, rowsWritten: 50_000 },
    rowsRead: 40,
    rowsWritten: 10,
  });
  assert.equal(reset.allow, true);
  assert.equal(reset.reason, "utc_day_reset");
  assert.equal(reset.projectedRowsRead, 40);
  assert.equal(reset.projectedRowsWritten, 10);
});

test("390-minute pressure and heatmap, Watcher, Robinhood EOD, and scheduler stay below both allocations", () => {
  const simulation = simulateD1DailyCosts();
  assert.ok(simulation.totals.SPX_RECAP_DB.rowsRead < D1_DATABASE_BUDGETS.SPX_RECAP_DB.rowsRead);
  assert.ok(simulation.totals.SPX_RECAP_DB.rowsWritten < D1_DATABASE_BUDGETS.SPX_RECAP_DB.rowsWritten);
  assert.ok(simulation.totals.MARKET_CACHE_DB.rowsRead < D1_DATABASE_BUDGETS.MARKET_CACHE_DB.rowsRead);
  assert.ok(simulation.totals.MARKET_CACHE_DB.rowsWritten < D1_DATABASE_BUDGETS.MARKET_CACHE_DB.rowsWritten);
  assert.ok(simulation.total.rowsRead < D1_FREE_TIER_DAILY_LIMITS.rowsRead * D1_SITE_GUARD_RATIO);
  assert.ok(simulation.total.rowsWritten < D1_FREE_TIER_DAILY_LIMITS.rowsWritten * D1_SITE_GUARD_RATIO);
});
