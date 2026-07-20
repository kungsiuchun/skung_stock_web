CREATE TABLE IF NOT EXISTS spx_gex_invalid_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trading_date TEXT NOT NULL,
  snapshot_minute_et INTEGER NOT NULL,
  snapshot_time_et TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  ticker TEXT NOT NULL DEFAULT 'SPX',
  spot REAL NOT NULL,
  snapshot_json TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'SNAPSHOT_JSON_MALFORMED',
    'SESSION_CONTRACT_INCOMPLETE',
    'NO_AUDITED_BLENDED_IV_CELLS'
  )),
  quarantined_at TEXT NOT NULL,
  UNIQUE (trading_date, snapshot_minute_et, payload_hash)
);

CREATE INDEX IF NOT EXISTS idx_spx_gex_invalid_snapshots_date_minute
  ON spx_gex_invalid_snapshots (trading_date DESC, snapshot_minute_et ASC);

-- Production incident remediation: preserve the normalized payload and its
-- canonical evidence before removing the invalid row from the active timeline.
INSERT OR IGNORE INTO spx_gex_invalid_snapshots (
  trading_date,
  snapshot_minute_et,
  snapshot_time_et,
  generated_at,
  ticker,
  spot,
  snapshot_json,
  snapshot_id,
  payload_hash,
  provider,
  reason_code,
  quarantined_at
)
SELECT
  trading_date,
  snapshot_minute_et,
  snapshot_time_et,
  generated_at,
  ticker,
  spot,
  snapshot_json,
  COALESCE(json_extract(snapshot_json, '$.canonical.snapshotId'), 'spx-gex:2026-07-20:570:unknown'),
  COALESCE(json_extract(snapshot_json, '$.canonical.payloadHash'), 'unknown'),
  COALESCE(json_extract(snapshot_json, '$.canonical.provider'), json_extract(snapshot_json, '$.source.provider'), 'unknown'),
  'NO_AUDITED_BLENDED_IV_CELLS',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM spx_gex_intraday_snapshots
WHERE trading_date = '2026-07-20'
  AND snapshot_minute_et = 570;

INSERT OR IGNORE INTO spx_gex_collection_events (
  slot_id,
  stage,
  attempt,
  occurred_at,
  payload_json,
  created_at
)
SELECT
  runs.slot_id,
  'FAILED',
  COALESCE((
    SELECT MAX(events.attempt) + 1
    FROM spx_gex_collection_events events
    WHERE events.slot_id = runs.slot_id
  ), 0),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  json_object(
    'error', 'GEX_SNAPSHOT_CONTRACT_INVALID',
    'reasonCode', 'NO_AUDITED_BLENDED_IV_CELLS',
    'quarantined', 1
  ),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM spx_gex_collection_runs runs
WHERE runs.slot_id = '2026-07-20:570'
  AND EXISTS (
    SELECT 1
    FROM spx_gex_invalid_snapshots invalid
    WHERE invalid.trading_date = '2026-07-20'
      AND invalid.snapshot_minute_et = 570
  );

UPDATE spx_gex_collection_runs
SET
  current_stage = 'FAILED',
  error = 'GEX_SNAPSHOT_CONTRACT_INVALID:NO_AUDITED_BLENDED_IV_CELLS',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE slot_id = '2026-07-20:570'
  AND EXISTS (
    SELECT 1
    FROM spx_gex_invalid_snapshots invalid
    WHERE invalid.trading_date = '2026-07-20'
      AND invalid.snapshot_minute_et = 570
  );

DELETE FROM spx_gex_intraday_snapshots
WHERE trading_date = '2026-07-20'
  AND snapshot_minute_et = 570
  AND EXISTS (
    SELECT 1
    FROM spx_gex_invalid_snapshots invalid
    WHERE invalid.trading_date = '2026-07-20'
      AND invalid.snapshot_minute_et = 570
  );
