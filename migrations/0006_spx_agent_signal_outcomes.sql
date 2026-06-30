CREATE TABLE IF NOT EXISTS spx_agent_signal_outcomes (
  run_id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  time_et TEXT NOT NULL,
  agent_key TEXT NOT NULL CHECK (agent_key IN ('QM', 'CM', 'NT', 'PA')),
  decision TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  rule_verdict TEXT NOT NULL,
  data_quality_json TEXT NOT NULL DEFAULT '{}',
  entry_spx REAL NOT NULL,
  outcome_5m REAL,
  outcome_15m REAL,
  outcome_30m REAL,
  success_15m INTEGER CHECK (success_15m IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spx_agent_outcomes_date_agent
  ON spx_agent_signal_outcomes(date, agent_key);

CREATE INDEX IF NOT EXISTS idx_spx_agent_outcomes_success
  ON spx_agent_signal_outcomes(agent_key, success_15m);
