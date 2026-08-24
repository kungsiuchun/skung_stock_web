import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SPX_SCHEDULER_LATE_GRACE_MS,
  advanceSpxGexOpeningRetryState,
  canonicalQuarterHourUtc,
  createSpxGexOpeningRetryState,
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
  const at1509 = Date.parse("2026-07-17T19:09:32.000Z");
  assert.equal(nextSchedulerAlarmAt(at1509 - 900_000, at1509), Date.parse("2026-07-17T19:15:00.000Z"));
  assert.equal(canonicalQuarterHourUtc(Date.parse("2026-07-17T19:15:23.000Z")), Date.parse("2026-07-17T19:15:00.000Z"));
});

test("scheduler executes only fresh ticks and leaves late market data missing", () => {
  const at1430 = Date.parse("2026-07-17T18:30:00.000Z");
  assert.equal(shouldRunScheduledTick(at1430, at1430 + SPX_SCHEDULER_LATE_GRACE_MS), true);
  assert.equal(shouldRunScheduledTick(at1430, at1430 + SPX_SCHEDULER_LATE_GRACE_MS + 1), false);
});

test("opening bucket retries at 09:47 and 09:50 before returning to quarter-hour scheduling", () => {
  const canonical0945 = Date.parse("2026-07-17T13:45:00.000Z");
  const retry2 = createSpxGexOpeningRetryState("2026-07-17:570", canonical0945);
  assert.deepEqual(retry2, {
    slotId: "2026-07-17:570",
    canonicalScheduledAtMs: canonical0945,
    attempt: 2,
    nextAttemptAtMs: Date.parse("2026-07-17T13:47:00.000Z"),
  });
  const retry3 = advanceSpxGexOpeningRetryState(retry2);
  assert.equal(retry3?.attempt, 3);
  assert.equal(retry3?.nextAttemptAtMs, Date.parse("2026-07-17T13:50:00.000Z"));
  assert.equal(retry3 && advanceSpxGexOpeningRetryState(retry3), null);
  assert.equal(nextSchedulerAlarmAt(canonical0945, Date.parse("2026-07-17T13:50:01.000Z")), Date.parse("2026-07-17T14:00:00.000Z"));
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
  assert.doesNotMatch(workerSource.match(/private async ensure\(\)[\s\S]*?async fetch\(/)?.[0] || "", /reconcileMissedSpxScheduledWork/);
  assert.match(workerSource, /SPX_SCHEDULER\.get/);
  assert.match(workerSource, /markOverdueScheduledSlotsFailed/);
  assert.match(workerSource, /cron_invocation_missed/);
  assert.match(workerSource, /completeDegradedDecisionRun\(env, decisionStore, run, 'cron_invocation_missed', 'PREVIEW'\)/);
  assert.match(workerSource, /openingRetryAttempt/);
  assert.match(workerSource, /createCboeOnlySpxGexDataClient/);
  assert.match(workerSource, /cachePolicy: 'force_refresh'/);
  assert.match(workerSource, /allowStaleCache: false/);
  const retryMethod = workerSource.match(/private async executeOpeningRetry[\s\S]*?\n {2}private async execute\(/)?.[0] || "";
  assert.match(retryMethod, /runSpxGexHeatmapGeneration/);
  assert.doesNotMatch(retryMethod, /runTradingAgents|dispatchSpxDecisionDelivery/);
  const ensureMethod = workerSource.match(/private async ensure\(\)[\s\S]*?async fetch\(/)?.[0] || "";
  assert.match(ensureMethod, /scheduler\.openingRetry/);
  assert.match(workerSource, /requestedAtMs % 900_000 !== 0/);
  assert.match(workerSource, /STALE_NON_QUARTER_ALARM/);
});
