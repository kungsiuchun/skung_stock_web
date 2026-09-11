# Market Data Cache Contract

Read this file only when changing `MARKET_CACHE_DB`, Watcher/Finance Analyzer
snapshot caching, or migration `0009_market_data_cache.sql`.

- Watcher and Finance Analyzer use the optional `MARKET_CACHE_DB` D1 binding as
  a 60-second shared market snapshot cache.
- Keep it separate from `SPX_RECAP_DB`, which is an SPX decision/audit ledger.
- Production binds `MARKET_CACHE_DB` to `market-cache-db`
  (`c629da02-21ce-4b1c-87f2-59ba54be922e`). Apply only migration `0009` to it;
  never apply the shared SPX migration sequence.
- Without the binding, report `cache.status="bypassed"`; never claim a hit.
- Expired entries may appear only as visibly stale data with the refresh failure
  reason. Curated Watcher `get_watchlist` is stricter: an unavailable or empty
  expired refresh fails closed and never serves a stale list.
- Do not recreate demo fallbacks for market-source failures.
- Reserve the shared D1 safety budget atomically only before a refresh/write.
  Cache hits and other read-only paths consume no reservation. Include the
  guard's D1 work and bounded maintenance, fail closed at the 70% threshold or
  when reservation cannot be verified, and never claim an account-wide limit.
