UPDATE tracked_assets SET is_active = 0, updated_at = CURRENT_TIMESTAMP;
UPDATE tracked_assets
SET priority = 200,
    is_active = 1,
    metadata_json = json_set(COALESCE(metadata_json, '{}'), '$.seedSet', 'large-cap-20-v1'),
    updated_at = CURRENT_TIMESTAMP
WHERE symbol IN (
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'AVGO', 'ORCL',
  'TSLA', 'WMT', 'LLY', 'JPM', 'V', 'MA', 'XOM', 'COST', 'NFLX', 'HD',
  'BAC', 'UNH'
);
