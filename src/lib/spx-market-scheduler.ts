export const SPX_SCHEDULER_STORAGE_KEY = "spx-market-scheduler";
export const SPX_SCHEDULER_LATE_GRACE_MS = 2 * 60_000;
export const SPX_GEX_OPENING_SNAPSHOT_MINUTE_ET = 9 * 60 + 30;
export const SPX_GEX_OPENING_COLLECTION_MINUTE_ET = 9 * 60 + 45;

export interface SpxGexOpeningRetryState {
  slotId: string;
  canonicalScheduledAtMs: number;
  attempt: 2 | 3;
  nextAttemptAtMs: number;
}

export interface SpxSchedulerState {
  nextAlarmAt: number | null;
  lastStartedAt: number | null;
  lastSucceededAt: number | null;
  lastFailureCode: string | null;
  lastFailureAt: number | null;
  openingRetry: SpxGexOpeningRetryState | null;
}

export const EMPTY_SPX_SCHEDULER_STATE: SpxSchedulerState = {
  nextAlarmAt: null,
  lastStartedAt: null,
  lastSucceededAt: null,
  lastFailureCode: null,
  lastFailureAt: null,
  openingRetry: null,
};

export const createSpxGexOpeningRetryState = (
  slotId: string,
  canonicalScheduledAtMs: number,
): SpxGexOpeningRetryState => ({
  slotId,
  canonicalScheduledAtMs,
  attempt: 2,
  nextAttemptAtMs: canonicalScheduledAtMs + 2 * 60_000,
});

export const advanceSpxGexOpeningRetryState = (
  state: SpxGexOpeningRetryState,
): SpxGexOpeningRetryState | null => state.attempt === 2
  ? {
    ...state,
    attempt: 3,
    nextAttemptAtMs: state.canonicalScheduledAtMs + 5 * 60_000,
  }
  : null;

export const nextQuarterHourUtc = (nowMs: number) => (Math.floor(nowMs / 900_000) + 1) * 900_000;
export const canonicalQuarterHourUtc = (timestampMs: number) => Math.floor(timestampMs / 900_000) * 900_000;

export const shouldRunScheduledTick = (scheduledAtMs: number, nowMs: number) =>
  nowMs - scheduledAtMs <= SPX_SCHEDULER_LATE_GRACE_MS;

export const nextSchedulerAlarmAt = (scheduledAtMs: number, nowMs: number) =>
  Math.max(scheduledAtMs + 900_000, nextQuarterHourUtc(nowMs));

export const dueMissingRunIds = (expectedRunIds: string[], nowMs: number) => expectedRunIds.filter((runId) => {
  const separator = runId.lastIndexOf("-");
  const scheduledAtMs = Number(runId.slice(separator + 1));
  return Number.isFinite(scheduledAtMs) && scheduledAtMs < nowMs;
});
