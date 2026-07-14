import type { D1DatabaseLike } from "./spx-recap-d1";
import {
  SPX_LIFECYCLE_STAGES,
  type CioDecision,
  type CouncilResult,
  type DecisionRunRecord,
  type LifecycleEvent,
  type MarketSnapshot,
  type OutboxRecord,
  type RiskGateResult,
  type SpxDecisionAction,
  type SpxDecisionStore,
  type SpxLifecycleStage,
} from "./spx-decision-pipeline";

interface DecisionRunRow {
  run_id: string;
  scheduled_at: string;
  current_stage: SpxLifecycleStage;
  snapshot_json: string | null;
  council_json: string | null;
  cio_decision_json: string | null;
  risk_gate_json: string | null;
  final_decision_json: string | null;
  final_action: SpxDecisionAction | null;
  degraded: number;
  degraded_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface LifecycleEventRow {
  run_id: string;
  stage: SpxLifecycleStage;
  occurred_at: string;
  attempt: number;
  latency_ms: number | null;
  payload_json: string;
}

interface OutboxRow {
  run_id: string;
  message: string;
  status: OutboxRecord["status"];
  attempt_count: number;
  telegram_message_id: string | null;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LifecycleCoverageResult {
  missingRunIds: string[];
  incompleteRunIds: string[];
  deliveryFailedRunIds: string[];
}

export interface SpxDecisionCockpitProjection {
  runId: string;
  scheduledAt: string;
  currentStage: SpxLifecycleStage;
  councilTally: { OPEN_CALL: number; OPEN_PUT: number; HOLD: number };
  cio: {
    action: SpxDecisionAction | null;
    confidence: number;
    modelStatus: string;
  };
  riskGate: {
    disposition: RiskGateResult["disposition"] | "NOT_RUN";
    reason: string;
    action: SpxDecisionAction | null;
  };
  finalAction: SpxDecisionAction | null;
  degraded: boolean;
  degradedReason: string | null;
  replayGrade: MarketSnapshot["replayGrade"];
  delivery: {
    status: OutboxRecord["status"] | "NOT_QUEUED";
    attemptCount: number;
    telegramMessageId: string | null;
    error: string | null;
  };
  lifecycle: Array<Pick<LifecycleEvent, "stage" | "occurredAt" | "latencyMs" | "attempt">>;
}

const stageRank = new Map<string, number>(SPX_LIFECYCLE_STAGES.map((stage, index) => [stage, index]));

const parseJson = <T>(value: string | null, fallback: T, field: string): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid persisted ${field} JSON: ${message}`);
  }
};

const changesFromResult = (result: unknown) => {
  const meta = (result as { meta?: { changes?: unknown } } | null)?.meta;
  return Number(meta?.changes || 0);
};

const rowToRun = (row: DecisionRunRow): DecisionRunRecord => ({
  runId: row.run_id,
  scheduledAt: row.scheduled_at,
  currentStage: row.current_stage,
  snapshot: parseJson<MarketSnapshot | null>(row.snapshot_json, null, "snapshot_json"),
  council: parseJson<CouncilResult | null>(row.council_json, null, "council_json"),
  cioDecision: parseJson<CioDecision | null>(row.cio_decision_json, null, "cio_decision_json"),
  riskGate: parseJson<RiskGateResult | null>(row.risk_gate_json, null, "risk_gate_json"),
  finalDecision: parseJson<CioDecision | null>(row.final_decision_json, null, "final_decision_json"),
  finalAction: row.final_action,
  degraded: Boolean(row.degraded),
  degradedReason: row.degraded_reason,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToLifecycle = (row: LifecycleEventRow): LifecycleEvent => ({
  runId: row.run_id,
  stage: row.stage,
  occurredAt: row.occurred_at,
  attempt: Number(row.attempt || 0),
  latencyMs: row.latency_ms === null || row.latency_ms === undefined ? null : Number(row.latency_ms),
  payload: parseJson<Record<string, unknown>>(row.payload_json, {}, "lifecycle payload_json"),
});

const rowToOutbox = (row: OutboxRow): OutboxRecord => ({
  runId: row.run_id,
  message: row.message,
  status: row.status,
  attemptCount: Number(row.attempt_count || 0),
  telegramMessageId: row.telegram_message_id,
  lastError: row.last_error,
  nextAttemptAt: row.next_attempt_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const buildSpxDecisionCockpitProjection = (
  run: DecisionRunRecord,
  outbox: OutboxRecord | null,
  lifecycle: LifecycleEvent[],
): SpxDecisionCockpitProjection => {
  const councilTally = { OPEN_CALL: 0, OPEN_PUT: 0, HOLD: 0 };
  for (const agent of run.council?.agents || []) councilTally[agent.decision] += 1;
  return {
    runId: run.runId,
    scheduledAt: run.scheduledAt,
    currentStage: run.currentStage,
    councilTally,
    cio: {
      action: run.cioDecision?.action || null,
      confidence: run.cioDecision?.confidence || 0,
      modelStatus: run.cioDecision?.modelStatus || "NOT_RUN",
    },
    riskGate: {
      disposition: run.riskGate?.disposition || "NOT_RUN",
      reason: run.riskGate?.reason || "Risk Gate not run.",
      action: run.riskGate?.action || null,
    },
    finalAction: run.finalAction,
    degraded: run.degraded,
    degradedReason: run.degradedReason,
    replayGrade: run.snapshot?.replayGrade || "UNAVAILABLE",
    delivery: {
      status: outbox?.status || "NOT_QUEUED",
      attemptCount: outbox?.attemptCount || 0,
      telegramMessageId: outbox?.telegramMessageId || null,
      error: outbox?.lastError || null,
    },
    lifecycle: lifecycle.map(({ stage, occurredAt, latencyMs, attempt }) => ({ stage, occurredAt, latencyMs, attempt })),
  };
};

export class D1SpxDecisionStore implements SpxDecisionStore {
  constructor(private readonly db: D1DatabaseLike) {}

  async beginRun(record: DecisionRunRecord) {
    const result = await this.db.prepare(`
      INSERT OR IGNORE INTO spx_decision_runs (
        run_id, scheduled_at, current_stage, degraded, degraded_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      record.runId,
      record.scheduledAt,
      record.currentStage,
      record.degraded ? 1 : 0,
      record.degradedReason,
      record.createdAt,
      record.updatedAt,
    ).run();
    return changesFromResult(result) > 0;
  }

  async appendLifecycle(event: LifecycleEvent) {
    const inserted = await this.db.prepare(`
      INSERT OR IGNORE INTO spx_run_lifecycle_events (
        run_id, stage, stage_rank, attempt, occurred_at, latency_ms, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      event.runId,
      event.stage,
      stageRank.get(event.stage) ?? 0,
      event.attempt,
      event.occurredAt,
      event.latencyMs,
      JSON.stringify(event.payload),
      event.occurredAt,
    ).run();

    if (changesFromResult(inserted) > 0) {
      await this.db.prepare(`
        UPDATE spx_decision_runs
        SET current_stage = ?, updated_at = ?
        WHERE run_id = ?
      `).bind(event.stage, event.occurredAt, event.runId).run();
    }
  }

  async persistDecision(record: DecisionRunRecord) {
    await this.db.prepare(`
      UPDATE spx_decision_runs SET
        current_stage = ?,
        snapshot_at = ?,
        snapshot_json = ?,
        source_freshness_json = ?,
        data_quality_json = ?,
        replay_grade = ?,
        gex_snapshot_id = ?,
        gex_payload_hash = ?,
        council_json = ?,
        cio_decision_json = ?,
        risk_gate_json = ?,
        final_decision_json = ?,
        final_action = ?,
        degraded = ?,
        degraded_reason = ?,
        updated_at = ?
      WHERE run_id = ?
    `).bind(
      record.currentStage,
      record.snapshot?.snapshotAt || null,
      record.snapshot ? JSON.stringify(record.snapshot) : null,
      record.snapshot ? JSON.stringify(record.snapshot.sourceFreshness) : null,
      record.snapshot ? JSON.stringify(record.snapshot.dataQuality) : null,
      record.snapshot?.replayGrade || null,
      record.snapshot?.replayEvidence?.gex?.snapshotId || null,
      record.snapshot?.replayEvidence?.gex?.payloadHash || null,
      record.council ? JSON.stringify(record.council) : null,
      record.cioDecision ? JSON.stringify(record.cioDecision) : null,
      record.riskGate ? JSON.stringify(record.riskGate) : null,
      record.finalDecision ? JSON.stringify(record.finalDecision) : null,
      record.finalAction,
      record.degraded ? 1 : 0,
      record.degradedReason,
      record.updatedAt,
      record.runId,
    ).run();
  }

  async getRun(runId: string) {
    const row = await this.db.prepare(`
      SELECT run_id, scheduled_at, current_stage, snapshot_json, council_json,
             cio_decision_json, risk_gate_json, final_decision_json, final_action,
             degraded, degraded_reason, created_at, updated_at
      FROM spx_decision_runs
      WHERE run_id = ?
    `).bind(runId).first<DecisionRunRow>();
    return row ? rowToRun(row) : null;
  }

  async getLifecycle(runId: string) {
    const result = await this.db.prepare(`
      SELECT run_id, stage, occurred_at, attempt, latency_ms, payload_json
      FROM spx_run_lifecycle_events
      WHERE run_id = ?
      ORDER BY id
    `).bind(runId).all<LifecycleEventRow>();
    return (result.results || []).map(rowToLifecycle);
  }

  async enqueueOutbox(record: OutboxRecord) {
    await this.db.prepare(`
      INSERT OR IGNORE INTO spx_delivery_outbox (
        run_id, message, status, attempt_count, telegram_message_id, last_error,
        next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      record.runId,
      record.message,
      record.status,
      record.attemptCount,
      record.telegramMessageId,
      record.lastError,
      record.nextAttemptAt,
      record.createdAt,
      record.updatedAt,
    ).run();
  }

  async getOutbox(runId: string) {
    const row = await this.db.prepare(`
      SELECT run_id, message, status, attempt_count, telegram_message_id, last_error,
             next_attempt_at, created_at, updated_at
      FROM spx_delivery_outbox
      WHERE run_id = ?
    `).bind(runId).first<OutboxRow>();
    return row ? rowToOutbox(row) : null;
  }

  async markDeliveryAttempt(runId: string, at: string) {
    const result = await this.db.prepare(`
      UPDATE spx_delivery_outbox
      SET status = 'SENDING', attempt_count = attempt_count + 1, updated_at = ?
      WHERE run_id = ? AND status IN ('PENDING', 'FAILED')
    `).bind(at, runId).run();
    if (changesFromResult(result) === 0) {
      const existing = await this.requireOutbox(runId);
      if (existing.status === 'DELIVERED') return existing;
      throw new Error(`outbox delivery already in progress for run ${runId}`);
    }
    return this.requireOutbox(runId);
  }

  async markDeliveryFailed(runId: string, error: string, nextAttemptAt: string, at: string) {
    await this.db.prepare(`
      UPDATE spx_delivery_outbox
      SET status = 'FAILED', last_error = ?, next_attempt_at = ?, updated_at = ?
      WHERE run_id = ? AND status != 'DELIVERED'
    `).bind(error, nextAttemptAt, at, runId).run();
    return this.requireOutbox(runId);
  }

  async markDelivered(runId: string, telegramMessageId: string, at: string) {
    await this.db.prepare(`
      UPDATE spx_delivery_outbox
      SET status = 'DELIVERED', telegram_message_id = ?, last_error = NULL,
          next_attempt_at = NULL, updated_at = ?
      WHERE run_id = ?
    `).bind(telegramMessageId, at, runId).run();
    return this.requireOutbox(runId);
  }

  async hasRun(runId: string) {
    return Boolean(await this.db.prepare(`
      SELECT run_id FROM spx_decision_runs WHERE run_id = ?
    `).bind(runId).first<{ run_id: string }>());
  }

  async listRetryableOutbox(at: string, limit = 5) {
    const result = await this.db.prepare(`
      SELECT run_id, message, status, attempt_count, telegram_message_id, last_error,
             next_attempt_at, created_at, updated_at
      FROM spx_delivery_outbox
      WHERE status IN ('PENDING', 'FAILED')
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY created_at
      LIMIT ?
    `).bind(at, Math.max(1, Math.min(25, limit))).all<OutboxRow>();
    return (result.results || []).map(rowToOutbox);
  }

  private async requireOutbox(runId: string) {
    const record = await this.getOutbox(runId);
    if (!record) throw new Error(`outbox not found for run ${runId}`);
    return record;
  }
}

export async function readSpxDecisionCockpitForGexSnapshot(
  db: D1DatabaseLike,
  gexSnapshotId: string | null | undefined,
): Promise<SpxDecisionCockpitProjection | null> {
  if (!gexSnapshotId) return null;
  const matched = await db.prepare(`
    SELECT run_id
    FROM spx_decision_run_health
    WHERE gex_snapshot_id = ?
    ORDER BY scheduled_at DESC
    LIMIT 1
  `).bind(gexSnapshotId).first<{ run_id: string }>();
  if (!matched) return null;
  const store = new D1SpxDecisionStore(db);
  const [run, outbox, lifecycle] = await Promise.all([
    store.getRun(matched.run_id),
    store.getOutbox(matched.run_id),
    store.getLifecycle(matched.run_id),
  ]);
  return run ? buildSpxDecisionCockpitProjection(run, outbox, lifecycle) : null;
}

export async function queryLifecycleCoverage(
  db: D1DatabaseLike,
  expectedRunIds: string[],
): Promise<LifecycleCoverageResult> {
  if (expectedRunIds.length === 0) {
    return { missingRunIds: [], incompleteRunIds: [], deliveryFailedRunIds: [] };
  }

  const rows: Array<{ run_id: string; current_stage: string; delivery_status: string | null }> = [];
  for (let offset = 0; offset < expectedRunIds.length; offset += 75) {
    const batch = expectedRunIds.slice(offset, offset + 75);
    const placeholders = batch.map(() => "?").join(", ");
    const result = await db.prepare(`
      SELECT run_id, current_stage, delivery_status
      FROM spx_decision_run_health
      WHERE run_id IN (${placeholders})
    `).bind(...batch).all<{ run_id: string; current_stage: string; delivery_status: string | null }>();
    rows.push(...(result.results || []));
  }

  const byRunId = new Map(rows.map((row) => [row.run_id, row]));
  return {
    missingRunIds: expectedRunIds.filter((runId) => !byRunId.has(runId)),
    incompleteRunIds: expectedRunIds.filter((runId) => {
      const row = byRunId.get(runId);
      return Boolean(row && row.current_stage !== "DELIVERED" && row.current_stage !== "DELIVERY_FAILED");
    }),
    deliveryFailedRunIds: expectedRunIds.filter((runId) => byRunId.get(runId)?.delivery_status === "FAILED"),
  };
}
