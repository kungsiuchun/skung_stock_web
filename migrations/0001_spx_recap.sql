CREATE TABLE IF NOT EXISTS spx_days (
  date TEXT PRIMARY KEY,
  total_callouts INTEGER NOT NULL DEFAULT 0,
  trades_taken INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  flat_closes INTEGER NOT NULL DEFAULT 0,
  win_rate REAL,
  total_pnl_points REAL NOT NULL DEFAULT 0,
  defensive_holds INTEGER NOT NULL DEFAULT 0,
  ic_events INTEGER NOT NULL DEFAULT 0,
  first_callout_at TEXT,
  last_callout_at TEXT,
  source_updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spx_callouts (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  time_et TEXT NOT NULL,
  timestamp_text TEXT,
  price REAL,
  action TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  pnl REAL,
  status TEXT NOT NULL CHECK (status IN ('win', 'loss', 'flat', 'defense', 'ic', 'entry', 'pending')),
  event_type TEXT NOT NULL CHECK (event_type IN ('entry', 'exit', 'defense', 'ic', 'hold', 'unknown')),
  position_side TEXT NOT NULL CHECK (position_side IN ('CALL', 'PUT', 'IC', 'NONE')),
  related_entry_id TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (date, ordinal),
  FOREIGN KEY (date) REFERENCES spx_days(date) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS spx_audits (
  date TEXT PRIMARY KEY,
  report TEXT NOT NULL,
  learned_rules_json TEXT NOT NULL DEFAULT '[]',
  action_log_size INTEGER,
  generated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (date) REFERENCES spx_days(date) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS spx_wisdom_rules (
  id TEXT PRIMARY KEY,
  source_date TEXT NOT NULL,
  rule_hash TEXT NOT NULL,
  rule_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_date, rule_hash)
);

CREATE INDEX IF NOT EXISTS idx_spx_callouts_date_ordinal ON spx_callouts(date, ordinal);
CREATE INDEX IF NOT EXISTS idx_spx_callouts_date_status ON spx_callouts(date, status);
CREATE INDEX IF NOT EXISTS idx_spx_days_date_desc ON spx_days(date DESC);
CREATE INDEX IF NOT EXISTS idx_spx_wisdom_rules_source_date_desc ON spx_wisdom_rules(source_date DESC);
