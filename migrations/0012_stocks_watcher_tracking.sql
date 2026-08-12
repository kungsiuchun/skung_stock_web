-- Metadata-only Stocks Intelligence Watcher tracking.
-- This migration intentionally stores no quote, options, news, or fundamentals payloads.
CREATE TABLE IF NOT EXISTS tracked_assets (
  symbol TEXT PRIMARY KEY,
  provider_symbol TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority >= 0),
  display_name TEXT,
  asset_type TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watcher_refresh_state (
  symbol TEXT NOT NULL,
  dataset TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'never' CHECK (status IN ('never', 'ok', 'failed', 'stale')),
  last_attempted_at TEXT,
  last_successful_at TEXT,
  last_source_as_of TEXT,
  last_error_code TEXT,
  next_eligible_refresh TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (symbol, dataset),
  FOREIGN KEY (symbol) REFERENCES tracked_assets (symbol) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tracked_assets_active_symbol
  ON tracked_assets (is_active, symbol);

CREATE INDEX IF NOT EXISTS idx_tracked_assets_provider_priority
  ON tracked_assets (provider_symbol, priority, symbol);

CREATE INDEX IF NOT EXISTS idx_watcher_refresh_state_status
  ON watcher_refresh_state (status, updated_at);

CREATE INDEX IF NOT EXISTS idx_watcher_refresh_state_eligibility
  ON watcher_refresh_state (next_eligible_refresh, status);

-- The request-path prune uses this exact order and remains bounded by LIMIT.
-- 0009 remains unchanged; this index is part of the not-yet-applied 0012 set.
CREATE INDEX IF NOT EXISTS idx_market_cache_entries_expiry_cache_key
  ON market_cache_entries (expires_at, cache_key);

-- Private application-level usage ledger for the watcher cache. This is not
-- Cloudflare account-wide billing truth; it only guards this Worker's D1
-- operations against the configured daily budget.
CREATE TABLE IF NOT EXISTS watcher_daily_usage_ledger (
  usage_date TEXT PRIMARY KEY,
  observed_reads INTEGER NOT NULL DEFAULT 0 CHECK (observed_reads >= 0),
  reserved_reads INTEGER NOT NULL DEFAULT 0 CHECK (reserved_reads >= 0),
  observed_writes INTEGER NOT NULL DEFAULT 0 CHECK (observed_writes >= 0),
  reserved_writes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_writes >= 0),
  updated_at TEXT NOT NULL
);

-- Admin-curated S&P 500 seed. This is metadata only: it does not create
-- refresh jobs or persist market payloads. Re-applying the migration preserves
-- an existing asset's created_at while restoring this curated definition.
INSERT INTO tracked_assets (
  symbol, provider_symbol, priority, display_name, asset_type, is_active, metadata_json, created_at, updated_at
) VALUES
  ('MSFT', 'MSFT', 100, 'Microsoft', 'equity', 1, '{"gicsSector":"Information Technology","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('NVDA', 'NVDA', 100, 'NVIDIA', 'equity', 1, '{"gicsSector":"Information Technology","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('AAPL', 'AAPL', 100, 'Apple', 'equity', 1, '{"gicsSector":"Information Technology","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('AVGO', 'AVGO', 100, 'Broadcom', 'equity', 1, '{"gicsSector":"Information Technology","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ORCL', 'ORCL', 100, 'Oracle', 'equity', 1, '{"gicsSector":"Information Technology","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('CRM', 'CRM', 100, 'Salesforce', 'equity', 1, '{"gicsSector":"Information Technology","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ADBE', 'ADBE', 100, 'Adobe', 'equity', 1, '{"gicsSector":"Information Technology","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('AMD', 'AMD', 100, 'Advanced Micro Devices', 'equity', 1, '{"gicsSector":"Information Technology","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('QCOM', 'QCOM', 100, 'Qualcomm', 'equity', 1, '{"gicsSector":"Information Technology","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ACN', 'ACN', 100, 'Accenture', 'equity', 1, '{"gicsSector":"Information Technology","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('GOOGL', 'GOOGL', 100, 'Alphabet Class A', 'equity', 1, '{"gicsSector":"Communication Services","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('META', 'META', 100, 'Meta Platforms', 'equity', 1, '{"gicsSector":"Communication Services","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('NFLX', 'NFLX', 100, 'Netflix', 'equity', 1, '{"gicsSector":"Communication Services","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('DIS', 'DIS', 100, 'Walt Disney', 'equity', 1, '{"gicsSector":"Communication Services","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('TMUS', 'TMUS', 100, 'T-Mobile US', 'equity', 1, '{"gicsSector":"Communication Services","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('AMZN', 'AMZN', 100, 'Amazon', 'equity', 1, '{"gicsSector":"Consumer Discretionary","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('TSLA', 'TSLA', 100, 'Tesla', 'equity', 1, '{"gicsSector":"Consumer Discretionary","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('HD', 'HD', 100, 'Home Depot', 'equity', 1, '{"gicsSector":"Consumer Discretionary","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('MCD', 'MCD', 100, 'McDonald''s', 'equity', 1, '{"gicsSector":"Consumer Discretionary","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('BKNG', 'BKNG', 100, 'Booking Holdings', 'equity', 1, '{"gicsSector":"Consumer Discretionary","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('WMT', 'WMT', 100, 'Walmart', 'equity', 1, '{"gicsSector":"Consumer Staples","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('COST', 'COST', 100, 'Costco Wholesale', 'equity', 1, '{"gicsSector":"Consumer Staples","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('PG', 'PG', 100, 'Procter & Gamble', 'equity', 1, '{"gicsSector":"Consumer Staples","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('KO', 'KO', 100, 'Coca-Cola', 'equity', 1, '{"gicsSector":"Consumer Staples","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('LLY', 'LLY', 100, 'Eli Lilly', 'equity', 1, '{"gicsSector":"Health Care","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('UNH', 'UNH', 100, 'UnitedHealth Group', 'equity', 1, '{"gicsSector":"Health Care","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('JNJ', 'JNJ', 100, 'Johnson & Johnson', 'equity', 1, '{"gicsSector":"Health Care","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ABBV', 'ABBV', 100, 'AbbVie', 'equity', 1, '{"gicsSector":"Health Care","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('MRK', 'MRK', 100, 'Merck', 'equity', 1, '{"gicsSector":"Health Care","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('JPM', 'JPM', 100, 'JPMorgan Chase', 'equity', 1, '{"gicsSector":"Financials","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('V', 'V', 100, 'Visa', 'equity', 1, '{"gicsSector":"Financials","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('MA', 'MA', 100, 'Mastercard', 'equity', 1, '{"gicsSector":"Financials","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('BAC', 'BAC', 100, 'Bank of America', 'equity', 1, '{"gicsSector":"Financials","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('GS', 'GS', 100, 'Goldman Sachs', 'equity', 1, '{"gicsSector":"Financials","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('CAT', 'CAT', 100, 'Caterpillar', 'equity', 1, '{"gicsSector":"Industrials","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('GE', 'GE', 100, 'GE Aerospace', 'equity', 1, '{"gicsSector":"Industrials","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('RTX', 'RTX', 100, 'RTX', 'equity', 1, '{"gicsSector":"Industrials","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('UNP', 'UNP', 100, 'Union Pacific', 'equity', 1, '{"gicsSector":"Industrials","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('XOM', 'XOM', 100, 'Exxon Mobil', 'equity', 1, '{"gicsSector":"Energy","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('CVX', 'CVX', 100, 'Chevron', 'equity', 1, '{"gicsSector":"Energy","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('COP', 'COP', 100, 'ConocoPhillips', 'equity', 1, '{"gicsSector":"Energy","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('LIN', 'LIN', 100, 'Linde', 'equity', 1, '{"gicsSector":"Materials","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('APD', 'APD', 100, 'Air Products and Chemicals', 'equity', 1, '{"gicsSector":"Materials","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('SHW', 'SHW', 100, 'Sherwin-Williams', 'equity', 1, '{"gicsSector":"Materials","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('NEE', 'NEE', 100, 'NextEra Energy', 'equity', 1, '{"gicsSector":"Utilities","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('SO', 'SO', 100, 'Southern Company', 'equity', 1, '{"gicsSector":"Utilities","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('DUK', 'DUK', 100, 'Duke Energy', 'equity', 1, '{"gicsSector":"Utilities","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('PLD', 'PLD', 100, 'Prologis', 'equity', 1, '{"gicsSector":"Real Estate","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('AMT', 'AMT', 100, 'American Tower', 'equity', 1, '{"gicsSector":"Real Estate","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('EQIX', 'EQIX', 100, 'Equinix', 'equity', 1, '{"gicsSector":"Real Estate","seedSet":"sp500-50-v1"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(symbol) DO UPDATE SET
  provider_symbol = excluded.provider_symbol,
  priority = excluded.priority,
  display_name = excluded.display_name,
  asset_type = excluded.asset_type,
  is_active = excluded.is_active,
  metadata_json = excluded.metadata_json,
  updated_at = excluded.updated_at;
