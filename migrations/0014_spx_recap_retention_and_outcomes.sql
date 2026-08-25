-- Retention is an explicit operational exception to the append-only event log.
-- Updates remain forbidden; only the scheduled retention job may prune expired parents.
DROP TRIGGER IF EXISTS trg_spx_run_lifecycle_events_no_delete;
DROP TRIGGER IF EXISTS trg_spx_gex_collection_events_no_delete;

CREATE TABLE IF NOT EXISTS spx_final_signal_outcomes (
  run_id TEXT PRIMARY KEY,
  trading_date TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('OPEN_CALL', 'OPEN_PUT')),
  regime TEXT NOT NULL,
  entry_at TEXT NOT NULL,
  entry_spx REAL NOT NULL,
  entry_zone_low REAL NOT NULL,
  entry_zone_high REAL NOT NULL,
  outcome_5m REAL,
  outcome_15m REAL,
  outcome_30m REAL,
  mae_30m REAL,
  mfe_30m REAL,
  success_15m INTEGER CHECK (success_15m IN (0, 1)),
  source TEXT NOT NULL CHECK (source = '0dtespx'),
  outcome_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (outcome_status IN ('PENDING', 'READY', 'UNAVAILABLE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spx_final_signal_outcomes_calibration
  ON spx_final_signal_outcomes (trading_date, action, regime, success_15m);

CREATE INDEX IF NOT EXISTS idx_spx_final_signal_outcomes_pending
  ON spx_final_signal_outcomes (outcome_status, entry_at);

CREATE TABLE IF NOT EXISTS spx_retention_audit (
  run_date TEXT PRIMARY KEY,
  executed_at TEXT NOT NULL,
  raw_cutoff TEXT NOT NULL,
  recap_cutoff TEXT NOT NULL,
  deleted_json TEXT NOT NULL,
  backlog_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED')),
  failure_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_spx_retention_audit_executed
  ON spx_retention_audit (executed_at DESC);
