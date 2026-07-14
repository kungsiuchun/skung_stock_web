import assert from "node:assert/strict";
import test from "node:test";

import {
  DASHBOARD_LOADING_PHASES,
  getNextDashboardLoadingPhase,
} from "../src/lib/finance-dashboard-loading";

test("dashboard loading phases advance in source order and stop at synthesis", () => {
  assert.deepEqual(DASHBOARD_LOADING_PHASES, ["market", "options", "quant", "synthesis"]);
  assert.equal(getNextDashboardLoadingPhase("market"), "options");
  assert.equal(getNextDashboardLoadingPhase("options"), "quant");
  assert.equal(getNextDashboardLoadingPhase("quant"), "synthesis");
  assert.equal(getNextDashboardLoadingPhase("synthesis"), "synthesis");
});
