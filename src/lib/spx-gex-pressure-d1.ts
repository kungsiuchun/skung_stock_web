import {
  SPX_GEX_SNAPSHOT_SCHEMA_VERSION,
  type SpxGexInvalidSnapshotReasonCode,
  type SpxGexInvalidSnapshotSummary,
} from "./spx-gex-heatmap";
import type { SpxGexPressureFrame } from "./spx-gex-pressure-matrix";
import type { D1DatabaseLike } from "./spx-recap-d1";

const BLENDED_IV_MODEL = "black_scholes_gamma_exposure_blended_iv";

interface D1SpxGexPressureProjectionRow {
  trading_date: string;
  snapshot_minute_et: number;
  snapshot_time_et: string;
  json_is_valid: number;
  session_trading_date: unknown;
  session_snapshot_minute_et: unknown;
  session_snapshot_time_et: unknown;
  session_collected_minute_et: unknown;
  session_collected_time_et: unknown;
  session_generated_at: unknown;
  session_spot: unknown;
  canonical_schema_version: unknown;
  canonical_replay_grade: unknown;
  canonical_snapshot_id: unknown;
  canonical_payload_hash: unknown;
  provider: unknown;
  fallback_from: unknown;
  source_timestamp: unknown;
  calculation_engine_version: unknown;
  expiry: unknown;
  audited_cell_count: number;
  gex_json: string;
}

export interface SpxGexPressureFrameAudit {
  frames: SpxGexPressureFrame[];
  invalidSnapshots: SpxGexInvalidSnapshotSummary[];
  projectionBytes: number;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const sessionContractIsComplete = (row: D1SpxGexPressureProjectionRow) => (
  typeof row.session_trading_date === "string"
  && /^\d{4}-\d{2}-\d{2}$/.test(row.session_trading_date)
  && Number.isInteger(row.session_snapshot_minute_et)
  && typeof row.session_snapshot_time_et === "string"
  && /^\d{2}:\d{2}$/.test(row.session_snapshot_time_et)
  && Number.isInteger(row.session_collected_minute_et)
  && typeof row.session_collected_time_et === "string"
  && /^\d{2}:\d{2}$/.test(row.session_collected_time_et)
  && typeof row.session_generated_at === "string"
  && Number.isFinite(Date.parse(row.session_generated_at))
  && finite(row.session_spot)
  && row.canonical_schema_version === SPX_GEX_SNAPSHOT_SCHEMA_VERSION
  && row.canonical_replay_grade === "NORMALIZED_CANONICAL"
  && nonEmptyString(row.canonical_snapshot_id)
  && nonEmptyString(row.canonical_payload_hash)
);

const invalidReason = (row: D1SpxGexPressureProjectionRow): SpxGexInvalidSnapshotReasonCode | null => {
  if (Number(row.json_is_valid) !== 1) return "SNAPSHOT_JSON_MALFORMED";
  if (!sessionContractIsComplete(row)) return "SESSION_CONTRACT_INCOMPLETE";
  return Number(row.audited_cell_count) > 0 ? null : "NO_AUDITED_BLENDED_IV_CELLS";
};

export const listSpxGexPressureFrames = async (
  db: D1DatabaseLike,
  date: string,
): Promise<SpxGexPressureFrameAudit> => {
  const result = await db.prepare(`
    /* SPX_GEX_PRESSURE_PROJECTION */
    WITH guarded AS (
      SELECT
        trading_date,
        snapshot_minute_et,
        snapshot_time_et,
        json_valid(snapshot_json) AS json_is_valid,
        CASE WHEN json_valid(snapshot_json) THEN snapshot_json ELSE '{}' END AS doc
      FROM spx_gex_intraday_snapshots
      WHERE trading_date = ?
    )
    SELECT
      trading_date,
      snapshot_minute_et,
      snapshot_time_et,
      json_is_valid,
      json_extract(doc, '$.session.tradingDate') AS session_trading_date,
      json_extract(doc, '$.session.snapshotMinuteEt') AS session_snapshot_minute_et,
      json_extract(doc, '$.session.snapshotTimeEt') AS session_snapshot_time_et,
      json_extract(doc, '$.session.collectedMinuteEt') AS session_collected_minute_et,
      json_extract(doc, '$.session.collectedTimeEt') AS session_collected_time_et,
      json_extract(doc, '$.session.generatedAt') AS session_generated_at,
      json_extract(doc, '$.session.spot') AS session_spot,
      json_extract(doc, '$.canonical.schemaVersion') AS canonical_schema_version,
      json_extract(doc, '$.canonical.replayGrade') AS canonical_replay_grade,
      json_extract(doc, '$.canonical.snapshotId') AS canonical_snapshot_id,
      json_extract(doc, '$.canonical.payloadHash') AS canonical_payload_hash,
      COALESCE(json_extract(doc, '$.canonical.provider'), json_extract(doc, '$.source.provider'), 'unknown') AS provider,
      COALESCE(json_extract(doc, '$.canonical.fallbackFrom'), json_extract(doc, '$.source.fallbackFrom')) AS fallback_from,
      COALESCE(json_extract(doc, '$.canonical.sourceTimestamp'), json_extract(doc, '$.source.sourceTimestamp')) AS source_timestamp,
      COALESCE(json_extract(doc, '$.source.calculationEngineVersion'), json_extract(doc, '$.canonical.calculationEngineVersion'), 1) AS calculation_engine_version,
      COALESCE(json_extract(doc, '$.zeroDte.expiry'), json_extract(doc, '$.selectedExpiries[0]')) AS expiry,
      (
        SELECT COUNT(*)
        FROM json_each(doc, '$.cells') AS cell
        WHERE json_extract(CASE WHEN cell.type = 'object' THEN cell.value ELSE '{}' END, '$.model') = '${BLENDED_IV_MODEL}'
          AND json_type(CASE WHEN cell.type = 'object' THEN cell.value ELSE '{}' END, '$.netGex') IN ('integer', 'real')
          AND json_type(CASE WHEN cell.type = 'object' THEN cell.value ELSE '{}' END, '$.callIv') IN ('integer', 'real')
          AND json_type(CASE WHEN cell.type = 'object' THEN cell.value ELSE '{}' END, '$.putIv') IN ('integer', 'real')
          AND json_type(CASE WHEN cell.type = 'object' THEN cell.value ELSE '{}' END, '$.gammaIv') IN ('integer', 'real')
      ) AS audited_cell_count,
      COALESCE((
        SELECT json_group_array(json_object(
          'strike', json_extract(CASE WHEN cell.type = 'object' THEN cell.value ELSE '{}' END, '$.strike'),
          'netGex', json_extract(CASE WHEN cell.type = 'object' THEN cell.value ELSE '{}' END, '$.netGex')
        ))
        FROM json_each(doc, '$.cells') AS cell
        WHERE json_extract(CASE WHEN cell.type = 'object' THEN cell.value ELSE '{}' END, '$.expdate') = COALESCE(json_extract(doc, '$.zeroDte.expiry'), json_extract(doc, '$.selectedExpiries[0]'))
          AND json_type(CASE WHEN cell.type = 'object' THEN cell.value ELSE '{}' END, '$.strike') IN ('integer', 'real')
          AND json_type(CASE WHEN cell.type = 'object' THEN cell.value ELSE '{}' END, '$.netGex') IN ('integer', 'real')
      ), '[]') AS gex_json
    FROM guarded
    ORDER BY snapshot_minute_et ASC
  `).bind(date).all<D1SpxGexPressureProjectionRow>();

  const rows = result.results || [];
  const frames: SpxGexPressureFrame[] = [];
  const invalidSnapshots: SpxGexInvalidSnapshotSummary[] = [];
  for (const row of rows) {
    const reasonCode = invalidReason(row);
    if (reasonCode) {
      invalidSnapshots.push({
        snapshotMinuteEt: Number(row.snapshot_minute_et),
        snapshotTimeEt: row.snapshot_time_et,
        reasonCode,
      });
      continue;
    }
    const parsedGex = JSON.parse(row.gex_json) as Array<{ strike: unknown; netGex: unknown }>;
    if (!Array.isArray(parsedGex) || parsedGex.some((cell) => !finite(cell.strike) || !finite(cell.netGex))) {
      throw new Error(`Invalid SPX GEX pressure projection at ${date}:${row.snapshot_minute_et}.`);
    }
    frames.push({
      tradingDate: row.session_trading_date as string,
      snapshotMinuteEt: row.session_snapshot_minute_et as number,
      snapshotTimeEt: row.session_snapshot_time_et as string,
      collectedMinuteEt: row.session_collected_minute_et as number,
      collectedTimeEt: row.session_collected_time_et as string,
      spot: row.session_spot as number,
      expiry: nonEmptyString(row.expiry) ? row.expiry : "",
      calculationEngineVersion: finite(row.calculation_engine_version) ? row.calculation_engine_version : 1,
      provider: nonEmptyString(row.provider) ? row.provider : "unknown",
      fallbackFrom: nonEmptyString(row.fallback_from) ? row.fallback_from : null,
      sourceTimestamp: nonEmptyString(row.source_timestamp) ? row.source_timestamp : null,
      snapshotId: row.canonical_snapshot_id as string,
      gexByStrike: parsedGex as Array<{ strike: number; netGex: number }>,
    });
  }
  return {
    frames,
    invalidSnapshots,
    projectionBytes: new TextEncoder().encode(JSON.stringify(rows)).byteLength,
  };
};
