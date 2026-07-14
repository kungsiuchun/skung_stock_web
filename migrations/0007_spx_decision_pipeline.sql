CREATE TABLE IF NOT EXISTS spx_decision_runs (
  run_id TEXT PRIMARY KEY,
  scheduled_at TEXT NOT NULL,
  current_stage TEXT NOT NULL CHECK (current_stage IN (
    'SCHEDULED',
    'LOCK_ACQUIRED',
    'SNAPSHOT_READY',
    'COUNCIL_COMPLETED',
    'CIO_DECIDED',
    'RISK_GATED',
    'PERSISTED',
    'DELIVERY_ATTEMPTED',
    'DELIVERED',
    'DELIVERY_FAILED'
  )),
  snapshot_at TEXT,
  snapshot_json TEXT,
  source_freshness_json TEXT,
  data_quality_json TEXT,
  replay_grade TEXT CHECK (replay_grade IS NULL OR replay_grade IN ('NORMALIZED_CANONICAL', 'PARTIAL_NORMALIZED', 'UNAVAILABLE')),
  gex_snapshot_id TEXT,
  gex_payload_hash TEXT,
  council_json TEXT,
  cio_decision_json TEXT,
  risk_gate_json TEXT,
  final_decision_json TEXT,
  final_action TEXT CHECK (final_action IS NULL OR final_action IN ('OPEN_CALL', 'OPEN_PUT', 'HOLD', 'CLOSE')),
  degraded INTEGER NOT NULL DEFAULT 0 CHECK (degraded IN (0, 1)),
  degraded_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spx_decision_runs_scheduled_at
  ON spx_decision_runs (scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_spx_decision_runs_stage
  ON spx_decision_runs (current_stage, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_spx_decision_runs_gex_snapshot
  ON spx_decision_runs (gex_snapshot_id);

CREATE TABLE IF NOT EXISTS spx_run_lifecycle_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN (
    'SCHEDULED',
    'LOCK_ACQUIRED',
    'SNAPSHOT_READY',
    'COUNCIL_COMPLETED',
    'CIO_DECIDED',
    'RISK_GATED',
    'PERSISTED',
    'DELIVERY_ATTEMPTED',
    'DELIVERED',
    'DELIVERY_FAILED'
  )),
  stage_rank INTEGER NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL,
  latency_ms INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (run_id, stage, attempt),
  FOREIGN KEY (run_id) REFERENCES spx_decision_runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_spx_run_lifecycle_events_run
  ON spx_run_lifecycle_events (run_id, id);

CREATE INDEX IF NOT EXISTS idx_spx_run_lifecycle_events_stage_time
  ON spx_run_lifecycle_events (stage, occurred_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_spx_run_lifecycle_events_no_update
BEFORE UPDATE ON spx_run_lifecycle_events
BEGIN
  SELECT RAISE(ABORT, 'spx_run_lifecycle_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_spx_run_lifecycle_events_no_delete
BEFORE DELETE ON spx_run_lifecycle_events
BEGIN
  SELECT RAISE(ABORT, 'spx_run_lifecycle_events is append-only');
END;

CREATE TABLE IF NOT EXISTS spx_delivery_outbox (
  run_id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SENDING', 'FAILED', 'DELIVERED')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  telegram_message_id TEXT,
  last_error TEXT,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES spx_decision_runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_spx_delivery_outbox_retry
  ON spx_delivery_outbox (status, next_attempt_at);

CREATE VIEW IF NOT EXISTS spx_decision_run_health AS
SELECT
  r.run_id,
  r.scheduled_at,
  r.current_stage,
  r.final_action,
  r.degraded,
  r.degraded_reason,
  r.replay_grade,
  r.gex_snapshot_id,
  r.gex_payload_hash,
  o.status AS delivery_status,
  o.attempt_count AS delivery_attempt_count,
  o.telegram_message_id,
  o.last_error AS delivery_error,
  MAX(CASE WHEN e.stage = 'SCHEDULED' THEN 1 ELSE 0 END) AS has_scheduled,
  MAX(CASE WHEN e.stage = 'LOCK_ACQUIRED' THEN 1 ELSE 0 END) AS has_lock_acquired,
  MAX(CASE WHEN e.stage = 'SNAPSHOT_READY' THEN 1 ELSE 0 END) AS has_snapshot_ready,
  MAX(CASE WHEN e.stage = 'COUNCIL_COMPLETED' THEN 1 ELSE 0 END) AS has_council_completed,
  MAX(CASE WHEN e.stage = 'CIO_DECIDED' THEN 1 ELSE 0 END) AS has_cio_decided,
  MAX(CASE WHEN e.stage = 'RISK_GATED' THEN 1 ELSE 0 END) AS has_risk_gated,
  MAX(CASE WHEN e.stage = 'PERSISTED' THEN 1 ELSE 0 END) AS has_persisted,
  MAX(CASE WHEN e.stage = 'DELIVERY_ATTEMPTED' THEN 1 ELSE 0 END) AS has_delivery_attempted,
  MAX(CASE WHEN e.stage = 'DELIVERED' THEN 1 ELSE 0 END) AS has_delivered,
  MAX(CASE WHEN e.stage = 'DELIVERY_FAILED' THEN 1 ELSE 0 END) AS has_delivery_failed
FROM spx_decision_runs r
LEFT JOIN spx_run_lifecycle_events e ON e.run_id = r.run_id
LEFT JOIN spx_delivery_outbox o ON o.run_id = r.run_id
GROUP BY r.run_id;
