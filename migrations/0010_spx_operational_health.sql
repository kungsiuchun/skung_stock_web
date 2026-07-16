CREATE TABLE IF NOT EXISTS spx_operational_health (
  tick_id TEXT NOT NULL,
  job TEXT NOT NULL CHECK (job IN ('MARKET_TICK', 'GEX_COLLECTION', 'TRADING', 'STALE_RECOVERY')),
  run_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('STARTED', 'SUCCEEDED', 'FAILED', 'RECOVERED')),
  stage TEXT NOT NULL,
  failure_code TEXT,
  alert_sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tick_id, job)
);

CREATE INDEX IF NOT EXISTS idx_spx_operational_health_recent
  ON spx_operational_health (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_spx_operational_health_alerts
  ON spx_operational_health (job, alert_sent_at DESC);
