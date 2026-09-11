# S&P 500 Market Breadth Contract

Read this file only for the market-breadth UI, API, refresh script, workflow, or
its R2 objects.

- Standalone route: `#/work/market-breadth`; browser reads only
  `GET /api/market-breadth`.
- `.github/workflows/refresh-market-breadth.yml` requests the previous NYSE
  session at 17:17 and 18:47 UTC Tuesday-Saturday. There is no scheduled
  Cloudflare Worker.
- `scripts/refresh-market-breadth.ts` writes inactive A/B state and snapshot
  slots, a 64-slot-ring run record, then moves `market-breadth/status.json` last.
  Secrets exist only on the final workflow step.
- `MARKET_BREADTH_DATA` binds only to the Standard-class
  `market-breadth-data` R2 bucket. This feature has no D1 migration and must not
  use `MARKET_CACHE_DB` or `SPX_RECAP_DB`.
- State Street SPY and 11 Select Sector SPDR daily workbooks own the dated
  universe, weights, and unique sector mapping. Massive adjusted daily
  aggregates own prices. `MASSIVE_API_KEY` is Actions-only; production requires
  confirmed public display rights.
- Backfill is resumable. Write successful symbol state before its attempt marker
  under a stable membership fingerprint. Provider failures stay retryable; do
  not re-fetch legitimately short histories on later workbook dates.
- Every universe refresh prunes departed ticker series and obsolete membership
  attempt scopes. A/B slots without content pruning are not bounded storage.
- READY requires complete sector ETF history and at least 98% constituent SMA200
  coverage. Missing history is unavailable, never below or zero-filled.
- A failed refresh keeps the last READY snapshot plus an independent unresolved
  failure pointer. A later duplicate SKIPPED attempt cannot clear STALE; only a
  successful READY publish clears the safe error class. No demo fallback.
- Every State Street and Massive request needs an abort deadline shorter than
  the GitHub job timeout; persist hangs as `PROVIDER_TIMEOUT`.
- Pages performs exactly two R2 reads per request. Preserve that invariant.
- Regression: `npm run test:market-breadth`,
  `npm run test:market-breadth:uat`, `npm run build`, and a local Pages Functions
  bundle check.
- Resource creation, S3 credentials, GitHub secrets, production backfill,
  workflow enablement, and Pages deploy are independent approval gates.
