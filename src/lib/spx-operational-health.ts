import type { D1DatabaseLike } from "./spx-recap-d1";

export const SPX_OPERATIONAL_JOBS = ["MARKET_TICK", "GEX_COLLECTION", "TRADING", "STALE_RECOVERY"] as const;
export type SpxOperationalJob = typeof SPX_OPERATIONAL_JOBS[number];
export type SpxOperationalStatus = "STARTED" | "SUCCEEDED" | "FAILED" | "RECOVERED";

export interface SpxOperationalHealthRecord {
  tickId: string;
  job: SpxOperationalJob;
  runId: string | null;
  status: SpxOperationalStatus;
  stage: string;
  failureCode: string | null;
  alertSentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface HealthRow {
  tick_id: string;
  job: SpxOperationalJob;
  run_id: string | null;
  status: SpxOperationalStatus;
  stage: string;
  failure_code: string | null;
  alert_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

const rowToRecord = (row: HealthRow): SpxOperationalHealthRecord => ({
  tickId: row.tick_id,
  job: row.job,
  runId: row.run_id,
  status: row.status,
  stage: row.stage,
  failureCode: row.failure_code,
  alertSentAt: row.alert_sent_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const classifySpxOperationalFailure = (error: unknown, fallback = "UNEXPECTED_RUNTIME") => {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/canonical.*gex|heatmap|gex/i.test(message)) return "CANONICAL_GEX_UNAVAILABLE";
  if (/d1|sqlite|database/i.test(message)) return "D1_OPERATION_FAILED";
  if (/timeout|abort/i.test(message)) return "UPSTREAM_TIMEOUT";
  return fallback;
};

export class D1SpxOperationalHealthStore {
  constructor(private readonly db: D1DatabaseLike) {}

  async begin(input: Pick<SpxOperationalHealthRecord, "tickId" | "job" | "runId" | "stage">, at: string) {
    await this.db.prepare(`
      INSERT OR REPLACE INTO spx_operational_health (
        tick_id, job, run_id, status, stage, failure_code, alert_sent_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'STARTED', ?, NULL, NULL, COALESCE((SELECT created_at FROM spx_operational_health WHERE tick_id = ? AND job = ?), ?), ?)
    `).bind(input.tickId, input.job, input.runId, input.stage, input.tickId, input.job, at, at).run();
  }

  async finish(input: Pick<SpxOperationalHealthRecord, "tickId" | "job" | "runId"> & {
    status: Exclude<SpxOperationalStatus, "STARTED">;
    stage: string;
    failureCode?: string | null;
  }, at: string) {
    await this.db.prepare(`
      UPDATE spx_operational_health
      SET run_id = COALESCE(?, run_id), status = ?, stage = ?, failure_code = ?, updated_at = ?
      WHERE tick_id = ? AND job = ?
    `).bind(input.runId, input.status, input.stage, input.failureCode || null, at, input.tickId, input.job).run();
  }

  async listRecent(limit = 20) {
    const result = await this.db.prepare(`
      SELECT tick_id, job, run_id, status, stage, failure_code, alert_sent_at, created_at, updated_at
      FROM spx_operational_health ORDER BY updated_at DESC LIMIT ?
    `).bind(Math.max(1, Math.min(limit, 100))).all<HealthRow>();
    return (result.results || []).map(rowToRecord);
  }

  async hasRecentAlert(job: SpxOperationalJob, cutoff: string) {
    return Boolean(await this.db.prepare(`
      SELECT tick_id FROM spx_operational_health
      WHERE job = ? AND alert_sent_at IS NOT NULL AND alert_sent_at >= ? LIMIT 1
    `).bind(job, cutoff).first<{ tick_id: string }>());
  }

  async markAlertSent(tickId: string, job: SpxOperationalJob, at: string) {
    await this.db.prepare(`
      UPDATE spx_operational_health SET alert_sent_at = ?, updated_at = ?
      WHERE tick_id = ? AND job = ?
    `).bind(at, at, tickId, job).run();
  }
}
