# ADR 0002: Dedicated daily S&P 500 Market Breadth pipeline

- Status: Accepted
- Date: 2026-08-12

## Context

The Market Lab needs a public daily S&P 500 breadth surface built from roughly 500 constituent histories, 11 sector ETF histories, and dated membership data. This batch is materially different from the latency-sensitive SPX trading pipeline and from the 60-second shared market cache.

## Decision

- Expose the product as a standalone `#/work/market-breadth` view and `GET /api/market-breadth` normalized read contract.
- Compute the batch in GitHub Actions through `scripts/refresh-market-breadth.ts`, not in a Cloudflare scheduled Worker and not in the SPX trading Worker.
- Persist bounded normalized price state and READY snapshots in independent alternating A/B slots, keep refresh audit in a 64-slot ring, and move one atomic status pointer last in the Standard-class `market-breadth-data` R2 bucket. State and snapshot select their inactive slots independently, so a PARTIAL run cannot expose or overwrite last-good. D1 is not used.
- Use State Street daily SPY and Select Sector SPDR holdings workbooks for universe, weights, and sector membership.
- Use Massive adjusted daily aggregates for closes. `MASSIVE_API_KEY` remains a GitHub Actions secret and production requires confirmed public display rights. The approved Basic-plan credential is limited to five requests per minute and next-day EOD availability, so every Massive request is serialized with a 13-second start-to-start interval.
- Request the previous NYSE trading session, never the current New York calendar date. Run at 17:17 UTC and a deduplicated 18:47 UTC repair attempt from Tuesday through Saturday, after Massive's documented next-day EOD availability window for Stocks Flat Files and the verified production REST entitlement cutoff. The shifted weekdays ensure Friday data is collected on Saturday.
- Perform initial history collection as resumable, audited batches. Record successful custom-bars attempts per symbol and stable universe-membership fingerprint so daily workbook dates do not re-fetch legitimately short histories; failed symbols remain retryable.
- On every universe refresh, prune price series to SPY, the 11 sector ETFs, and current holdings; retain attempts only for the current membership fingerprint. Bounded object slots therefore also have bounded contents.
- Publish only after unique sector mapping, date consistency, weight, ETF history, and at least 98% constituent SMA200 coverage validation passes.
- Preserve the last READY snapshot after refresh failure and expose it as `STALE`; never create a demo or zero-filled fallback.

## Consequences

The feature requires an R2 bucket, scoped R2 S3 credentials, a Massive secret, a resumable initial backfill, and a Pages R2 binding before it can be live. These production actions remain independent approval gates.

The public API performs exactly two R2 reads: `status.json`, then its active snapshot slot. At the Workers Free ceiling of 100,000 Pages Function requests per day, this is about 6.2 million R2 Class B operations in a 31-day month, below the Standard R2 free allowance of 10 million. Two refresh attempts per day use at most 248 Class A operations per 31-day month, far below the one-million allowance. Static files remain outside Pages Functions billing.

The Sector Performance contribution is an ETF proxy, not exact constituent attribution. The API therefore publishes the reconciliation gap against SPY 1D return.
