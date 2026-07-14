CREATE TABLE IF NOT EXISTS market_cache_entries (
  cache_key TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  symbol TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  source_as_of TEXT,
  cached_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_refresh_error TEXT,
  last_refresh_attempted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_market_cache_entries_expiry
  ON market_cache_entries (expires_at);

CREATE INDEX IF NOT EXISTS idx_market_cache_entries_scope_symbol
  ON market_cache_entries (scope, symbol);
