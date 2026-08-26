import type { SpxGexPressureFrame } from "./spx-gex-pressure-matrix";
import type { D1DatabaseLike } from "./spx-recap-d1";
import type { SpxGexPressureProjectionRow } from "./spx-gex-pressure-projection";

export interface SpxGexPressureFrameAudit {
  frames: SpxGexPressureFrame[];
  invalidSnapshots: [];
  projectionBytes: number;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const toFrame = (row: SpxGexPressureProjectionRow): SpxGexPressureFrame => {
  const parsed = JSON.parse(row.gex_json) as Array<{ strike: unknown; netGex: unknown }>;
  if (!Array.isArray(parsed) || parsed.some((cell) => !finite(cell.strike) || !finite(cell.netGex))) {
    throw new Error(`Invalid SPX GEX pressure projection at ${row.trading_date}:${row.snapshot_minute_et}.`);
  }
  if (!nonEmpty(row.expiry) || !nonEmpty(row.snapshot_id) || !nonEmpty(row.provider)
    || !Number.isInteger(row.snapshot_minute_et) || !Number.isInteger(row.collected_minute_et)
    || !finite(row.spot) || !finite(row.calculation_engine_version)) {
    throw new Error(`Incomplete SPX GEX pressure projection at ${row.trading_date}:${row.snapshot_minute_et}.`);
  }
  return {
    tradingDate: row.trading_date,
    snapshotMinuteEt: row.snapshot_minute_et,
    snapshotTimeEt: row.snapshot_time_et,
    collectedMinuteEt: row.collected_minute_et,
    collectedTimeEt: row.collected_time_et,
    spot: row.spot,
    expiry: row.expiry,
    calculationEngineVersion: row.calculation_engine_version,
    provider: row.provider,
    fallbackFrom: row.fallback_from,
    sourceTimestamp: row.source_timestamp,
    snapshotId: row.snapshot_id,
    gexByStrike: parsed as Array<{ strike: number; netGex: number }>,
  };
};

/** Reads only compact rows persisted alongside contract-valid canonical snapshots. */
export const listSpxGexPressureFrames = async (
  db: D1DatabaseLike,
  date: string,
): Promise<SpxGexPressureFrameAudit> => {
  const result = await db.prepare(`
    /* SPX_GEX_PRESSURE_PROJECTION */
    SELECT
      trading_date, snapshot_minute_et, snapshot_time_et,
      collected_minute_et, collected_time_et, generated_at, spot, expiry,
      calculation_engine_version, provider, fallback_from, source_timestamp,
      snapshot_id, payload_hash, gex_json
    FROM spx_gex_pressure_projections
    WHERE trading_date = ?
    ORDER BY snapshot_minute_et ASC
  `).bind(date).all<SpxGexPressureProjectionRow>();
  const rows = result.results || [];
  return {
    frames: rows.map(toFrame),
    invalidSnapshots: [],
    projectionBytes: new TextEncoder().encode(JSON.stringify(rows)).byteLength,
  };
};

export const listSpxGexPressureDates = async (db: D1DatabaseLike) => {
  const result = await db.prepare(`
    SELECT DISTINCT trading_date
    FROM spx_gex_pressure_projections
    ORDER BY trading_date DESC
  `).all<{ trading_date: string }>();
  return (result.results || []).map((row) => row.trading_date);
};
