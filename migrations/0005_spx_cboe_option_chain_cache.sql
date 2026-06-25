CREATE TABLE IF NOT EXISTS spx_cboe_option_chain_cache (
  cache_key TEXT PRIMARY KEY,
  trading_date TEXT NOT NULL,
  collected_minute_et INTEGER NOT NULL,
  source_timestamp TEXT,
  spot REAL NOT NULL,
  chains_json TEXT NOT NULL,
  pcr_value REAL,
  raw_bytes INTEGER,
  normalized_bytes INTEGER,
  fetch_ms INTEGER,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spx_cboe_cache_date_minute
  ON spx_cboe_option_chain_cache(trading_date, collected_minute_et);

CREATE INDEX IF NOT EXISTS idx_spx_cboe_cache_expires_at
  ON spx_cboe_option_chain_cache(expires_at);
