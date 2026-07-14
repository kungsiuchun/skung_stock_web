CREATE TABLE IF NOT EXISTS spx_gex_collection_runs (
  slot_id TEXT PRIMARY KEY,
  trading_date TEXT NOT NULL,
  snapshot_minute_et INTEGER NOT NULL,
  snapshot_time_et TEXT NOT NULL,
  collected_minute_et INTEGER NOT NULL,
  collected_time_et TEXT NOT NULL,
  current_stage TEXT NOT NULL CHECK (current_stage IN ('SCHEDULED', 'FETCHED', 'NORMALIZED', 'PERSISTED', 'FAILED')),
  snapshot_id TEXT,
  payload_hash TEXT,
  provider TEXT,
  fallback_from TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (trading_date, snapshot_minute_et)
);

CREATE INDEX IF NOT EXISTS idx_spx_gex_collection_runs_date_stage
  ON spx_gex_collection_runs (trading_date, current_stage, snapshot_minute_et);

CREATE TABLE IF NOT EXISTS spx_gex_collection_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('SCHEDULED', 'FETCHED', 'NORMALIZED', 'PERSISTED', 'FAILED')),
  attempt INTEGER NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (slot_id, stage, attempt),
  FOREIGN KEY (slot_id) REFERENCES spx_gex_collection_runs(slot_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_spx_gex_collection_events_slot
  ON spx_gex_collection_events (slot_id, id);

CREATE TRIGGER IF NOT EXISTS trg_spx_gex_collection_events_no_update
BEFORE UPDATE ON spx_gex_collection_events
BEGIN
  SELECT RAISE(ABORT, 'spx_gex_collection_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_spx_gex_collection_events_no_delete
BEFORE DELETE ON spx_gex_collection_events
BEGIN
  SELECT RAISE(ABORT, 'spx_gex_collection_events is append-only');
END;
