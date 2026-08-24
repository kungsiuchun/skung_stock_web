import type { D1DatabaseLike } from "./spx-recap-d1";

export const SPX_RAW_RETENTION_DAYS = 30;
export const SPX_RECAP_RETENTION_DAYS = 90;
export const SPX_KV_RETENTION_SECONDS = 91 * 24 * 60 * 60;
export const SPX_RETENTION_BATCH_SIZE = 1_000;

export interface SpxRetentionResult {
  runDate: string;
  rawCutoff: string;
  recapCutoff: string;
  deleted: Record<string, number>;
  backlog: Record<string, number>;
}

const isoDaysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1_000).toISOString();
const dateDaysAgo = (now: Date, days: number) => isoDaysAgo(now, days).slice(0, 10);
const changes = (result: unknown) => Number((result as { meta?: { changes?: unknown } } | null)?.meta?.changes || 0);

const deleteExpired = async (db: D1DatabaseLike, table: string, column: string, cutoff: string) => {
  const result = await db.prepare(`
    DELETE FROM ${table}
    WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${column} < ? ORDER BY ${column} LIMIT ?)
  `).bind(cutoff, SPX_RETENTION_BATCH_SIZE).run();
  return changes(result);
};

const countExpired = async (db: D1DatabaseLike, table: string, column: string, cutoff: string) => {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} < ?`).bind(cutoff).first<{ count: number }>();
  return Number(row?.count || 0);
};

/**
 * Deletes at most one bounded batch per table. This keeps a first deployment's
 * historical cleanup below the free-tier write cliff and exposes any backlog.
 */
export const runSpxRetention = async (db: D1DatabaseLike, now = new Date()): Promise<SpxRetentionResult> => {
  const rawCutoff = isoDaysAgo(now, SPX_RAW_RETENTION_DAYS);
  const recapCutoff = dateDaysAgo(now, SPX_RECAP_RETENTION_DAYS);
  const runDate = now.toISOString().slice(0, 10);
  const deleted: Record<string, number> = {};

  // Parent deletes cascade lifecycle/outbox children after migration 0014.
  deleted.decisionRuns = await deleteExpired(db, "spx_decision_runs", "scheduled_at", rawCutoff);
  deleted.gexCollectionRuns = await deleteExpired(db, "spx_gex_collection_runs", "created_at", rawCutoff);
  deleted.operationalHealth = await deleteExpired(db, "spx_operational_health", "updated_at", rawCutoff);
  deleted.legacyAgentOutcomes = await deleteExpired(db, "spx_agent_signal_outcomes", "date", recapCutoff);
  deleted.finalSignalOutcomes = await deleteExpired(db, "spx_final_signal_outcomes", "trading_date", recapCutoff);
  deleted.recapDays = await deleteExpired(db, "spx_days", "date", recapCutoff);
  deleted.wisdomRules = await deleteExpired(db, "spx_wisdom_rules", "source_date", recapCutoff);
  deleted.retentionAudit = await deleteExpired(db, "spx_retention_audit", "run_date", recapCutoff);

  const backlog = {
    decisionRuns: await countExpired(db, "spx_decision_runs", "scheduled_at", rawCutoff),
    gexCollectionRuns: await countExpired(db, "spx_gex_collection_runs", "created_at", rawCutoff),
    recapDays: await countExpired(db, "spx_days", "date", recapCutoff),
    finalSignalOutcomes: await countExpired(db, "spx_final_signal_outcomes", "trading_date", recapCutoff),
  };

  await db.prepare(`
    INSERT INTO spx_retention_audit (run_date, executed_at, raw_cutoff, recap_cutoff, deleted_json, backlog_json, status, failure_code)
    VALUES (?, ?, ?, ?, ?, ?, 'SUCCEEDED', NULL)
    ON CONFLICT(run_date) DO UPDATE SET
      executed_at = excluded.executed_at,
      raw_cutoff = excluded.raw_cutoff,
      recap_cutoff = excluded.recap_cutoff,
      deleted_json = excluded.deleted_json,
      backlog_json = excluded.backlog_json,
      status = excluded.status,
      failure_code = NULL
  `).bind(runDate, now.toISOString(), rawCutoff, recapCutoff, JSON.stringify(deleted), JSON.stringify(backlog)).run();

  return { runDate, rawCutoff, recapCutoff, deleted, backlog };
};
