import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SPX_SCHEDULER_LATE_GRACE_MS,
  dueMissingRunIds,
  nextQuarterHourUtc,
  nextSchedulerAlarmAt,
  shouldRunScheduledTick,
} from "../src/lib/spx-market-scheduler";

const workerSource = readFileSync(new URL("../scripts/worker-spx-bot.ts", import.meta.url), "utf8");

test("scheduler computes the next quarter-hour without drift", () => {
  const at1430 = Date.parse("2026-07-17T18:30:00.000Z");
  assert.equal(nextQuarterHourUtc(at1430), Date.parse("2026-07-17T18:45:00.000Z"));
  assert.equal(nextSchedulerAlarmAt(at1430, at1430 + 5_000), Date.parse("2026-07-17T18:45:00.000Z"));
  assert.equal(nextSchedulerAlarmAt(at1430, Date.parse("2026-07-17T18:48:00.000Z")), Date.parse("2026-07-17T19:00:00.000Z"));
});

test("scheduler executes only fresh ticks and leaves late market data missing", () => {
  const at1430 = Date.parse("2026-07-17T18:30:00.000Z");
  assert.equal(shouldRunScheduledTick(at1430, at1430 + SPX_SCHEDULER_LATE_GRACE_MS), true);
  assert.equal(shouldRunScheduledTick(at1430, at1430 + SPX_SCHEDULER_LATE_GRACE_MS + 1), false);
});

test("watchdog identifies only decision runs already due", () => {
  const at1415 = Date.parse("2026-07-17T18:15:00.000Z");
  const at1430 = Date.parse("2026-07-17T18:30:00.000Z");
  const at1445 = Date.parse("2026-07-17T18:45:00.000Z");
  const ids = [`2026-07-17-${at1415}`, `2026-07-17-${at1430}`, `2026-07-17-${at1445}`];
  assert.deepEqual(dueMissingRunIds(ids, at1445), ids.slice(0, 2));
});

test("worker uses the DO alarm as the market clock and preserves fail-closed missed-slot semantics", () => {
  assert.match(workerSource, /export class SpxMarketScheduler/);
  assert.match(workerSource, /async alarm\(\)/);
  assert.match(workerSource, /async ensure\(\)/);
  assert.match(workerSource, /SPX_SCHEDULER\.get/);
  assert.match(workerSource, /markOverdueScheduledSlotsFailed/);
  assert.match(workerSource, /cron_invocation_missed/);
  assert.match(workerSource, /completeDegradedDecisionRun\(env, decisionStore, run, 'cron_invocation_missed', 'PREVIEW'\)/);
});
