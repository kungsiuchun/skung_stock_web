-- Metadata only. Raw option contracts live exclusively in the private R2 release.
CREATE TABLE IF NOT EXISTS watcher_options_snapshot_runs (
  run_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider = 'robinhood_mcp'),
  scheduled_for_et TEXT NOT NULL,
  started_at TEXT NOT NULL,
  captured_at TEXT,
  finished_at TEXT NOT NULL,
  expected_symbols INTEGER NOT NULL CHECK (expected_symbols = 50),
  completed_symbols INTEGER NOT NULL CHECK (completed_symbols >= 0 AND completed_symbols <= 50),
  eligible_contracts INTEGER NOT NULL DEFAULT 0 CHECK (eligible_contracts >= 0),
  failed_symbols_json TEXT NOT NULL,
  release_id TEXT,
  manifest_key TEXT,
  manifest_sha256 TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'failed', 'published')),
  failure_code TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watcher_options_snapshot_current (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  run_id TEXT NOT NULL REFERENCES watcher_options_snapshot_runs(run_id),
  release_id TEXT NOT NULL,
  manifest_key TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  expected_symbols INTEGER NOT NULL CHECK (expected_symbols = 50),
  completed_symbols INTEGER NOT NULL CHECK (completed_symbols = 50),
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_watcher_options_snapshot_runs_status_finished
  ON watcher_options_snapshot_runs(status, finished_at DESC);
