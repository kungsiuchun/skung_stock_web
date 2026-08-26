-- Runtime readers use this compact table instead of scanning snapshot_json.cells.
CREATE TABLE IF NOT EXISTS spx_gex_pressure_projections (
  trading_date TEXT NOT NULL,
  snapshot_minute_et INTEGER NOT NULL,
  snapshot_time_et TEXT NOT NULL,
  collected_minute_et INTEGER NOT NULL,
  collected_time_et TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  spot REAL NOT NULL,
  expiry TEXT NOT NULL,
  calculation_engine_version INTEGER NOT NULL,
  provider TEXT NOT NULL,
  fallback_from TEXT,
  source_timestamp TEXT,
  snapshot_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  gex_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (trading_date, snapshot_minute_et)
);

CREATE INDEX IF NOT EXISTS idx_spx_gex_pressure_projection_date_minute
  ON spx_gex_pressure_projections (trading_date, snapshot_minute_et);

-- Site-owned 70% allocation state (2.5M reads / 50k writes) for SPX_RECAP_DB.
-- This is not Cloudflare account-level usage and must never be presented as a
-- Cloudflare Free-tier exhaustion signal.
CREATE TABLE IF NOT EXISTS spx_d1_budget_state (
  utc_day TEXT PRIMARY KEY,
  rows_read INTEGER NOT NULL,
  rows_written INTEGER NOT NULL,
  last_operation TEXT NOT NULL,
  last_deny_reason TEXT,
  updated_at TEXT NOT NULL
);

-- One-time backfill. Invalid historical snapshots remain absent from this
-- table and continue to be represented by the existing quarantine ledger.
INSERT OR REPLACE INTO spx_gex_pressure_projections (
  trading_date, snapshot_minute_et, snapshot_time_et,
  collected_minute_et, collected_time_et, generated_at, spot, expiry,
  calculation_engine_version, provider, fallback_from, source_timestamp,
  snapshot_id, payload_hash, gex_json, created_at, updated_at
)
SELECT
  snapshot.trading_date,
  snapshot.snapshot_minute_et,
  json_extract(snapshot.snapshot_json, '$.session.snapshotTimeEt'),
  json_extract(snapshot.snapshot_json, '$.session.collectedMinuteEt'),
  json_extract(snapshot.snapshot_json, '$.session.collectedTimeEt'),
  json_extract(snapshot.snapshot_json, '$.session.generatedAt'),
  json_extract(snapshot.snapshot_json, '$.session.spot'),
  json_extract(snapshot.snapshot_json, '$.zeroDte.expiry'),
  COALESCE(json_extract(snapshot.snapshot_json, '$.source.calculationEngineVersion'), 1),
  json_extract(snapshot.snapshot_json, '$.canonical.provider'),
  json_extract(snapshot.snapshot_json, '$.canonical.fallbackFrom'),
  json_extract(snapshot.snapshot_json, '$.canonical.sourceTimestamp'),
  json_extract(snapshot.snapshot_json, '$.canonical.snapshotId'),
  json_extract(snapshot.snapshot_json, '$.canonical.payloadHash'),
  COALESCE((
    SELECT json_group_array(json_object(
      'strike', json_extract(cell.value, '$.strike'),
      'netGex', json_extract(cell.value, '$.netGex')
    ))
    FROM json_each(snapshot.snapshot_json, '$.cells') AS cell
    WHERE json_extract(cell.value, '$.expdate') = json_extract(snapshot.snapshot_json, '$.zeroDte.expiry')
      AND json_type(cell.value, '$.strike') IN ('integer', 'real')
      AND json_type(cell.value, '$.netGex') IN ('integer', 'real')
  ), '[]'),
  snapshot.generated_at,
  snapshot.generated_at
FROM spx_gex_intraday_snapshots AS snapshot
WHERE json_valid(snapshot.snapshot_json)
  AND json_extract(snapshot.snapshot_json, '$.canonical.schemaVersion') = 1
  AND json_extract(snapshot.snapshot_json, '$.canonical.replayGrade') = 'NORMALIZED_CANONICAL'
  AND json_type(snapshot.snapshot_json, '$.canonical.snapshotId') = 'text'
  AND json_type(snapshot.snapshot_json, '$.canonical.payloadHash') = 'text'
  AND json_type(snapshot.snapshot_json, '$.session.snapshotMinuteEt') = 'integer'
  AND json_type(snapshot.snapshot_json, '$.session.collectedMinuteEt') = 'integer'
  AND json_type(snapshot.snapshot_json, '$.session.spot') IN ('integer', 'real')
  AND EXISTS (
    SELECT 1
    FROM json_each(snapshot.snapshot_json, '$.cells') AS audited
    WHERE json_extract(audited.value, '$.model') = 'black_scholes_gamma_exposure_blended_iv'
      AND json_type(audited.value, '$.netGex') IN ('integer', 'real')
      AND json_type(audited.value, '$.callIv') IN ('integer', 'real')
      AND json_type(audited.value, '$.putIv') IN ('integer', 'real')
      AND json_type(audited.value, '$.gammaIv') IN ('integer', 'real')
  );

CREATE TRIGGER IF NOT EXISTS trg_spx_gex_pressure_projection_delete
AFTER DELETE ON spx_gex_intraday_snapshots
BEGIN
  DELETE FROM spx_gex_pressure_projections
  WHERE trading_date = OLD.trading_date
    AND snapshot_minute_et = OLD.snapshot_minute_et;
END;
