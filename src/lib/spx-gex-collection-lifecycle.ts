import type { D1DatabaseLike } from "./spx-recap-d1";

export const SPX_GEX_COLLECTION_STAGES = [
  "SCHEDULED",
  "FETCHED",
  "NORMALIZED",
  "PERSISTED",
  "FAILED",
] as const;

export type SpxGexCollectionStage = typeof SPX_GEX_COLLECTION_STAGES[number];

export interface SpxGexCollectionSlot {
  slotId: string;
  tradingDate: string;
  snapshotMinuteEt: number;
  snapshotTimeEt: string;
  collectedMinuteEt: number;
  collectedTimeEt: string;
}

export interface SpxGexCollectionRecord {
  slotId: string;
  tradingDate: string;
  snapshotMinuteEt: number;
  collectedMinuteEt: number;
  currentStage: SpxGexCollectionStage;
  snapshotId: string | null;
  payloadHash: string | null;
  provider: string | null;
  fallbackFrom: string | null;
  error: string | null;
  updatedAt: string;
}

export interface SpxGexCollectionCoverage {
  expectedCount: number;
  dueCount: number;
  persistedCount: number;
  missingSlotIds: string[];
  missingSnapshotMinutesEt: number[];
  incompleteSlotIds: string[];
  failedSlotIds: string[];
}

interface CollectionRow {
  slot_id: string;
  trading_date: string;
  snapshot_minute_et: number;
  collected_minute_et: number;
  current_stage: SpxGexCollectionStage;
  snapshot_id: string | null;
  payload_hash: string | null;
  provider: string | null;
  fallback_from: string | null;
  error: string | null;
  updated_at: string;
}

interface AttemptRow {
  next_attempt: number;
}

const stageRank = new Map<SpxGexCollectionStage, number>([
  ["SCHEDULED", 0],
  ["FETCHED", 1],
  ["NORMALIZED", 2],
  ["PERSISTED", 3],
  ["FAILED", 4],
]);

const formatEtMinute = (minute: number) =>
  `${Math.floor(minute / 60).toString().padStart(2, "0")}:${(minute % 60).toString().padStart(2, "0")}`;

export const getExpectedSpxGexCollectionSlots = (tradingDate: string): SpxGexCollectionSlot[] => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDate)) {
    throw new Error("SPX GEX lifecycle tradingDate must use YYYY-MM-DD");
  }
  const slots: SpxGexCollectionSlot[] = [];
  for (let snapshotMinuteEt = 9 * 60 + 30; snapshotMinuteEt <= 16 * 60; snapshotMinuteEt += 15) {
    const collectedMinuteEt = snapshotMinuteEt + 15;
    slots.push({
      slotId: `${tradingDate}:${snapshotMinuteEt}`,
      tradingDate,
      snapshotMinuteEt,
      snapshotTimeEt: formatEtMinute(snapshotMinuteEt),
      collectedMinuteEt,
      collectedTimeEt: formatEtMinute(collectedMinuteEt),
    });
  }
  return slots;
};

export const validateSpxGexCollectionTransition = (
  current: SpxGexCollectionStage,
  next: SpxGexCollectionStage,
) => {
  if (current === next) return true;
  if (current === "PERSISTED") return false;
  if (next === "FAILED") return true;
  if (current === "FAILED") return next === "FETCHED";
  return (stageRank.get(next) ?? -1) === (stageRank.get(current) ?? -1) + 1;
};

export const summarizeSpxGexCollectionCoverage = (
  expected: SpxGexCollectionSlot[],
  records: SpxGexCollectionRecord[],
  asOfCollectedMinuteEt: number,
): SpxGexCollectionCoverage => {
  const bySlot = new Map(records.map((record) => [record.slotId, record]));
  const due = expected.filter((slot) => slot.collectedMinuteEt <= asOfCollectedMinuteEt);
  const missing = due.filter((slot) => !bySlot.has(slot.slotId));
  const incomplete = due.filter((slot) => bySlot.get(slot.slotId)?.currentStage !== "PERSISTED");
  return {
    expectedCount: expected.length,
    dueCount: due.length,
    persistedCount: due.filter((slot) => bySlot.get(slot.slotId)?.currentStage === "PERSISTED").length,
    missingSlotIds: missing.map((slot) => slot.slotId),
    missingSnapshotMinutesEt: missing.map((slot) => slot.snapshotMinuteEt),
    incompleteSlotIds: incomplete.map((slot) => slot.slotId),
    failedSlotIds: due.filter((slot) => bySlot.get(slot.slotId)?.currentStage === "FAILED").map((slot) => slot.slotId),
  };
};

const changesFromResult = (result: unknown) =>
  Number((result as { meta?: { changes?: unknown } } | null)?.meta?.changes || 0);

const rowToRecord = (row: CollectionRow): SpxGexCollectionRecord => ({
  slotId: row.slot_id,
  tradingDate: row.trading_date,
  snapshotMinuteEt: Number(row.snapshot_minute_et),
  collectedMinuteEt: Number(row.collected_minute_et),
  currentStage: row.current_stage,
  snapshotId: row.snapshot_id,
  payloadHash: row.payload_hash,
  provider: row.provider,
  fallbackFrom: row.fallback_from,
  error: row.error,
  updatedAt: row.updated_at,
});

export class D1SpxGexCollectionStore {
  private readonly activeAttempts = new Map<string, number>();

  constructor(private readonly db: D1DatabaseLike) {}

  async scheduleDate(tradingDate: string, at: string) {
    const statements = getExpectedSpxGexCollectionSlots(tradingDate).flatMap((slot) => [
      this.db.prepare(`
        INSERT OR IGNORE INTO spx_gex_collection_runs (
          slot_id, trading_date, snapshot_minute_et, snapshot_time_et,
          collected_minute_et, collected_time_et, current_stage, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'SCHEDULED', ?, ?)
      `).bind(
        slot.slotId,
        slot.tradingDate,
        slot.snapshotMinuteEt,
        slot.snapshotTimeEt,
        slot.collectedMinuteEt,
        slot.collectedTimeEt,
        at,
        at,
      ),
      this.db.prepare(`
        INSERT OR IGNORE INTO spx_gex_collection_events (
          slot_id, stage, attempt, occurred_at, payload_json, created_at
        ) VALUES (?, 'SCHEDULED', 0, ?, '{}', ?)
      `).bind(slot.slotId, at, at),
    ]);
    if (this.db.batch) await this.db.batch(statements);
    else for (const statement of statements) await statement.run();
  }

  async markOverdueScheduledSlotsFailed(tradingDate: string, asOfCollectedMinuteEt: number, at: string) {
    const expected = getExpectedSpxGexCollectionSlots(tradingDate);
    const records = new Map((await this.listDate(tradingDate)).map((record) => [record.slotId, record]));
    const missed = expected.filter((slot) => {
      const record = records.get(slot.slotId);
      return slot.collectedMinuteEt < asOfCollectedMinuteEt && record?.currentStage === "SCHEDULED";
    });
    for (const slot of missed) {
      await this.appendStage(slot.slotId, "FAILED", { error: "cron_invocation_missed" }, at);
    }
    return missed.map((slot) => slot.slotId);
  }

  async appendStage(
    slotId: string,
    stage: SpxGexCollectionStage,
    payload: Record<string, unknown>,
    at: string,
    attempt = 0,
  ) {
    const current = await this.getSlot(slotId);
    if (!current) throw new Error(`SPX GEX collection slot not scheduled: ${slotId}`);
    if (!validateSpxGexCollectionTransition(current.currentStage, stage)) {
      throw new Error(`Invalid SPX GEX lifecycle transition ${current.currentStage} -> ${stage} for ${slotId}`);
    }
    let effectiveAttempt = attempt || this.activeAttempts.get(slotId) || 0;
    if (current.currentStage === "FAILED" && stage === "FETCHED") {
      const next = await this.db.prepare(`
        SELECT COALESCE(MAX(attempt), 0) + 1 AS next_attempt
        FROM spx_gex_collection_events
        WHERE slot_id = ?
      `).bind(slotId).first<AttemptRow>();
      effectiveAttempt = Math.max(effectiveAttempt, Number(next?.next_attempt || 1));
      this.activeAttempts.set(slotId, effectiveAttempt);
    }
    const inserted = await this.db.prepare(`
      INSERT OR IGNORE INTO spx_gex_collection_events (
        slot_id, stage, attempt, occurred_at, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(slotId, stage, effectiveAttempt, at, JSON.stringify(payload), at).run();
    if (changesFromResult(inserted) === 0) return current;

    await this.db.prepare(`
      UPDATE spx_gex_collection_runs SET
        current_stage = ?,
        snapshot_id = COALESCE(?, snapshot_id),
        payload_hash = COALESCE(?, payload_hash),
        provider = COALESCE(?, provider),
        fallback_from = COALESCE(?, fallback_from),
        error = ?,
        updated_at = ?
      WHERE slot_id = ?
    `).bind(
      stage,
      typeof payload.snapshotId === "string" ? payload.snapshotId : null,
      typeof payload.payloadHash === "string" ? payload.payloadHash : null,
      typeof payload.provider === "string" ? payload.provider : null,
      typeof payload.fallbackFrom === "string" ? payload.fallbackFrom : null,
      stage === "FAILED" ? String(payload.error || "unknown_collection_failure") : null,
      at,
      slotId,
    ).run();
    return this.getSlot(slotId);
  }

  async getSlot(slotId: string) {
    const row = await this.db.prepare(`
      SELECT slot_id, trading_date, snapshot_minute_et, collected_minute_et, current_stage,
             snapshot_id, payload_hash, provider, fallback_from, error, updated_at
      FROM spx_gex_collection_runs WHERE slot_id = ?
    `).bind(slotId).first<CollectionRow>();
    return row ? rowToRecord(row) : null;
  }

  async listDate(tradingDate: string) {
    const result = await this.db.prepare(`
      SELECT slot_id, trading_date, snapshot_minute_et, collected_minute_et, current_stage,
             snapshot_id, payload_hash, provider, fallback_from, error, updated_at
      FROM spx_gex_collection_runs
      WHERE trading_date = ?
      ORDER BY snapshot_minute_et
    `).bind(tradingDate).all<CollectionRow>();
    return (result.results || []).map(rowToRecord);
  }
}

export async function querySpxGexCollectionCoverage(
  db: D1DatabaseLike,
  tradingDate: string,
  asOfCollectedMinuteEt: number,
) {
  const records = await new D1SpxGexCollectionStore(db).listDate(tradingDate);
  const expected = getExpectedSpxGexCollectionSlots(tradingDate);
  return {
    records,
    ...summarizeSpxGexCollectionCoverage(expected, records, asOfCollectedMinuteEt),
  };
}
