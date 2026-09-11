# Stock Watcher Valuation Contract

Read this file only when changing Watcher valuation/financial publication,
coverage requests, or the `VALUATION_DATA` R2 binding.

- `VALUATION_DATA` is private R2. Releases live below
  `releases/<releaseId>/`; `current.json` is the only active pointer.
- Missing valuation or financial data remains explicit as `NOT_PUBLISHED`,
  `queued`, or `unavailable`. Never substitute Yahoo for this calculation layer.
- Add ticker coverage only through `/api/stocks-intelligence-watcher/admin` with
  `Authorization: Bearer <STOCKS_WATCHER_ADMIN_TOKEN>`. Keep the token as a Pages
  secret; never embed it in public UI. Public snapshot/tool routes are read-only.
- The ValuationCalculation daily workflow unions `coverage/universe.json` with
  its default universe and publishes only after the entire resolved universe
  validates. R2 retention and the export-size cap bound growth.
- Watcher source labels are contracts: synthetic/demo data must never be called
  native Yahoo, and unavailable upstream data must remain visibly unavailable.
