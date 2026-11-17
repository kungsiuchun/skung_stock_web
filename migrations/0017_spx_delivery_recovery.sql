-- Preserve delivery evidence while admitting explicit uncertain/expired outcomes.
DROP VIEW IF EXISTS spx_decision_run_health;
ALTER TABLE spx_delivery_outbox RENAME TO spx_delivery_outbox_before_recovery;

CREATE TABLE spx_delivery_outbox (
  run_id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SENDING', 'FAILED', 'DELIVERED', 'UNKNOWN', 'EXPIRED')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  telegram_message_id TEXT,
  last_error TEXT,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES spx_decision_runs(run_id) ON DELETE CASCADE
);
INSERT INTO spx_delivery_outbox SELECT * FROM spx_delivery_outbox_before_recovery;
DROP TABLE spx_delivery_outbox_before_recovery;
CREATE INDEX idx_spx_delivery_outbox_retry ON spx_delivery_outbox (status, next_attempt_at);
CREATE INDEX idx_spx_delivery_outbox_lease ON spx_delivery_outbox (status, updated_at);

CREATE VIEW spx_decision_run_health AS
SELECT
  r.run_id, r.scheduled_at, r.current_stage, r.final_action, r.degraded, r.degraded_reason,
  r.replay_grade, r.gex_snapshot_id, r.gex_payload_hash,
  o.status AS delivery_status, o.attempt_count AS delivery_attempt_count,
  o.telegram_message_id, o.last_error AS delivery_error,
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
