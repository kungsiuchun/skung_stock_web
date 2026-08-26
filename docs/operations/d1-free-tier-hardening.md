# D1 Free Tier Hardening Runbook

## Site allocation

Cloudflare Workers Free allows 5,000,000 D1 rows read and 100,000 rows written per UTC day. This application reserves only 70% of that account-level limit:

| Binding | Site allocation | Purpose |
| --- | ---: | --- |
| `SPX_RECAP_DB` | 2,500,000 reads / 50,000 writes | SPX GEX collection, Board, Pressure Matrix, decision data |
| `MARKET_CACHE_DB` | 1,000,000 reads / 20,000 writes | Watcher, Finance Dashboard, Candlestick, and Backtest cache refreshes |

The remaining 30% is deliberately unallocated for Cloudflare metering variance and traffic outside these code paths. A site guard deny is `D1_SAFETY_CUTOFF`, not proof that Cloudflare has exhausted the account Free tier. The guard cannot see manual D1 use or another Worker outside this site.

All counters reset at `00:00 UTC`. API failures expose the UTC reset time. A quota-store failure is `D1_QUOTA_STORE_UNAVAILABLE` and fails closed; it must never be relabelled as a read-limit exhaustion.

## Runtime boundaries

- Market-cache refresh reservations occur only after a cache miss or expiry. A cache hit reserves nothing.
- Watcher reserves its actual bounded tracked-universe scan (maximum 20 rows), instead of a fixed 500-row scan or fixed 260-write request estimate.
- Public Market Cache refresh paths do not run retention cleanup. Owner maintenance deletes at most 50 expired rows per pass.
- Pressure Matrix reads `spx_gex_pressure_projections`; it does not scan `snapshot_json.cells` at request time. Canonical snapshot validation and invalid-snapshot quarantine remain the write-time contract.
- SPX origin reads and the GEX scheduler reserve bounded `SPX_RECAP_DB` work before the expensive path runs. Edge-cache hits do not reserve.
- SPY breadth remains R2-only and Robinhood options remain R2-led; neither is moved into Market Cache D1 by this change.

## Owner diagnostics and maintenance

`GET /api/stocks-intelligence-watcher/admin` requires the existing owner session or `Authorization: Bearer <STOCKS_WATCHER_ADMIN_TOKEN>`. It returns the current UTC-day site allocation, reserved usage, headroom, reset time, and the last persisted denial marker for both D1 bindings.

Run bounded cache maintenance from the same owner-authenticated endpoint only at a low fixed cadence, for example every six hours:

```json
{ "tool": "prune_market_cache" }
```

The result reports the bounded D1 rows read and written. Do not add a request-path prune or an isolate-local timer; neither gives a reliable global cadence.

## Release prerequisites

This change is PR-only until separately approved. Before any production deployment:

1. Apply `migrations/0016_spx_gex_pressure_projection.sql` to `spx-recap-db`.
2. Do not apply the shared SPX migration sequence to `market-cache-db`; it continues to use only `migrations/0009_market_data_cache.sql`.
3. Deploy Pages only after migration success, then verify the Pressure Matrix is `READY` and the owner diagnostics shows both bindings as `ok`.
4. Check structured `d1_budget_reservation` and `market_cache` logs for database, operation, reservation, actual cache metadata, status, and deny reason. Logs must never contain tokens or upstream payloads.
