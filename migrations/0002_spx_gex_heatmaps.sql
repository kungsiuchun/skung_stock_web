CREATE TABLE IF NOT EXISTS spx_gex_heatmaps (
  date TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  snapshot_at TEXT,
  ticker TEXT NOT NULL DEFAULT 'SPX',
  spot REAL NOT NULL,
  quote_json TEXT NOT NULL,
  expiries_json TEXT NOT NULL,
  strikes_json TEXT NOT NULL,
  cells_json TEXT NOT NULL,
  totals_json TEXT NOT NULL,
  zero_dte_json TEXT NOT NULL,
  source_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spx_gex_heatmaps_date_desc ON spx_gex_heatmaps(date DESC);
