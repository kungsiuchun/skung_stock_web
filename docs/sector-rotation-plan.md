# SPY Sector Rotation — implementation plan

## Approved outcome

Add a usable, standalone Market Lab work at `#/work/sector-rotation` for personal
research into the eleven L1 sectors of the current SPY universe. L2–L4 and
intraday signals are outside scope. The owner authorized implementation,
validation, commit, push, merge, data publication, and deployment.

## Product

1. Sector ETF rotation versus SPY: four quadrants with completed-week trails.
2. Relative-performance lines and sortable 1/3/6/12-month sector ranking.
3. Select a sector to inspect its current SPY constituents: price returns,
   relative returns versus SPY and the sector ETF, weights, drivers and drags.
4. Participation: eligible constituent counts, positive returns, outperformance,
   SMA50/SMA200 breadth, and weight concentration.
5. Responsive, keyboard-accessible layout with loading, retry, unavailable,
   stale, and explicit source/date information.

## Calculation contract

- Windows are 21/63/126/252 SPY trading sessions with identical start/end dates.
- Relative return is `(1 + asset return) / (1 + benchmark return) - 1`.
- Weekly relative price is sector ETF close / SPY close. Only completed NYSE
  weeks are eligible. Relative trend is `100 * RS / SMA10(RS)`; momentum is
  `100 * trend / SMA4(trend)`. Both axes cross at 100. Exact boundary values
  are neutral. This transparent custom model is not the proprietary JdK model.
- Daily prices are split-adjusted price returns, excluding cash dividends.
- Stock contribution is a current-SPY-weight sector-basket proxy, not exact
  attribution to the sector ETF or a historical membership portfolio.
- Missing dates/history remain unavailable and leave eligible denominators.
  Current constituents do not represent historical S&P 500 membership.

## Implementation and verification

1. Reuse the existing Market Breadth batch, dated universe, price state and R2
   binding. Validate historical adjustment continuity for split events.
2. Precompute bounded sibling rotation snapshots. Write them before the shared
   release pointer; preserve the existing breadth API's two-read contract.
3. Add a read-only rotation API that verifies release identity and retains stale
   last-good data when source refreshes fail.
4. Add the lazy-loaded page, route and Market Lab card.
5. Run deterministic math, publication/API, legacy-breadth regressions, build,
   Pages Functions bundle, and desktop/mobile interaction checks.
6. Run the authorized release gate, merge, publish the rotation dataset through
   the existing scheduled workflow, run the required paired deploy, and verify
   the production API, rendered charts, interactions and browser console.

## Completion evidence

Record local checks separately from committed/pushed, merged, deployed and
production-verified evidence. Preserve the original checkout's unrelated SPX
test change and untracked reference images. No new data provider, database,
secret, or L2–L4 classification service is required.
