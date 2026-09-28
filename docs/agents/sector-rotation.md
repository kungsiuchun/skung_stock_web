# SPY Sector Rotation Contract

- L1 only: eleven Select Sector SPDR ETFs versus SPY. Current SPY constituents
  provide stock participation and current-weight sector-basket driver proxies.
- Standalone route `#/work/sector-rotation`; browser reads only
  `GET /api/sector-rotation`. No visitor-triggered upstream collection.
- Reuse the Market Breadth Actions batch and `MARKET_BREADTH_DATA` R2 binding.
  No additional bucket, D1, cron Worker, secret, or data provider.
- Build rotation from the same dated universe, price state and source snapshot
  as each READY breadth publication. Sibling A/B rotation objects precede the
  shared status pointer. The legacy breadth endpoint retains two R2 reads.
- Legacy initialization must reproduce the current READY breadth snapshot from
  persisted state before attaching a rotation pointer. Never initialize from
  unmatched holdings, ahead-of-release prices or partial refresh state.
- Rotation API validates pointer identity and source snapshot/date identities.
  It preserves unresolved refresh failures through duplicate SKIPPED attempts.
  Missing/uninitialized or corrupt releases are explicit unavailable/errors.
- Windows use exact SPY session start/end dates: 21/63/126/252 sessions. Missing
  endpoint dates/history are null, never zero-filled or shifted silently.
- Model is custom, transparent and not proprietary JdK: completed NYSE weekly
  closes, ETF/SPY ratio divided by its 10-week mean, then trend divided by its
  4-week mean, both scaled to 100. Boundaries are neutral. Trails are bounded.
- Price returns use split-adjusted closes and exclude cash dividends. Current
  membership and weights are not historical point-in-time holdings or exact
  ETF attribution. These distinctions must remain visible.
- Before a new daily append, check the provider's adjusted close on the previous
  READY date. Replace histories with valid adjusted-close changes before
  publication. An unreconciled mismatch or more than 50 repairs fails explicitly
  and preserves last-good. Backfill retries an incomplete SPY trading calendar;
  persistent gaps fail before READY.
- Required checks: `npm run test:sector-rotation`,
  `npm run test:sector-rotation:uat`, `npm run test:market-breadth`,
  `npm run test:market-breadth:uat`, `npm run build`, Pages Functions bundle,
  authorized release gate and production API/DOM/console verification.
