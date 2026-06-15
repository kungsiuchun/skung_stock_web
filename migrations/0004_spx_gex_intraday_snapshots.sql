CREATE TABLE IF NOT EXISTS spx_gex_intraday_snapshots (
  trading_date TEXT NOT NULL,
  snapshot_minute_et INTEGER NOT NULL,
  snapshot_time_et TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  ticker TEXT NOT NULL DEFAULT 'SPX',
  spot REAL NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (trading_date, snapshot_minute_et)
);

CREATE INDEX IF NOT EXISTS idx_spx_gex_intraday_date_desc
  ON spx_gex_intraday_snapshots(trading_date DESC, snapshot_minute_et DESC);
