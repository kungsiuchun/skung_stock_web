# Quant Strategy Research Audit

## Verdict

The repository previously contained eleven strategy classes but no strategy test
coverage, no backtest, no transaction-cost model, and no chronological
out-of-sample validation. They were therefore **not hedge-fund standard** and
must not be marketed as validated alpha.

`financial_expert` is a fundamental/options analysis framework. It is excluded
from this audit and is not a twelfth quant strategy.

All strategy output is research-only. `liveTradingEligible` is hard-coded to
`false`; only a future declared dataset and a passing walk-forward gate can
change the research label. This audit does not authorize live trading,
leverage, shorting, production deployment, or personalised advice.

## What changed

- `research-policy.ts` declares the exact eleven-strategy universe and separates
  `RESEARCH_CANDIDATE` from `DISCRETIONARY_FRAMEWORK`.
- `research.ts` provides deterministic rules, historical-bar validation,
  next-open execution, one-way costs, cost sensitivity, performance metrics,
  time-ordered train/validation/test windows, correlation, and a portfolio
  view containing only research candidates.
- `engine.ts` preserves the existing response contract but adds `researchStatus`.
  Dragon Head, Emotion Cycle, Chan Theory, and Wave Theory are forced to
  `WAIT`; a narrative label cannot manufacture a tradable BUY.
- `scripts/quant-strategy-audit.ts` reads a declared OHLCV dataset and produces
  a reproducible JSON research artifact. It fails loudly on malformed,
  unordered, or undeclared data.

## Research contract

| Item | Implemented rule |
| --- | --- |
| Signal timing | Signal is computed only from the close at `t`; it executes at the next session open `t+1`. |
| Price return | Position return is open-to-open (`t+1` to `t+2`); no same-close fill is allowed. |
| Cost model | One-way 7 bps: 1 bp commission + 1 bp spread + 5 bp slippage. Every entry and exit pays cost. |
| Cost sensitivity | Each strategy is rerun at half, base, and double costs. |
| Data validation | Bars require unique strictly ascending ISO dates, finite non-negative OHLCV, positive prices, and `high >= low`. Invalid inputs throw. |
| Parameter handling | Rules are fixed. Walk-forward has `parameterSelection: none_fixed_rules`; no test-period tuning is permitted. |
| Split | Chronological 50% train / 25% validation / 25% test, with a 65-bar warmup retained before each window. |
| Required history | At least 569 daily bars: 65 warmup plus four 126-observation blocks. Less data fails instead of emitting a weak conclusion. |
| Benchmark | Buy-and-hold open-to-open over the same evaluated observations. |
| Portfolio | Equal-weight daily return across only `RESEARCH_CANDIDATE` strategies; discretionary frameworks are excluded. |

The current Yahoo request path fetches only 60 daily bars. That is insufficient
for this framework and cannot be used to claim a passing result.

## Predeclared institutional research gate

These are project gates, not an industry certification:

| Test-only condition | Threshold |
| --- | --- |
| Test observations | At least 126 |
| Completed trades | At least 8 |
| Cost-adjusted Sharpe | At least 0.50 |
| Maximum drawdown | At most 20% |
| Excess CAGR vs benchmark | Positive |
| Annualized turnover | At most 24x |

The report returns one of `NOT_ELIGIBLE`, `INSUFFICIENT_EVIDENCE`, `FAIL`, or
`PASS`. `PASS` means only that this repository's gate passed on the declared
dataset. It is not a hedge-fund certification and is not permission to trade.

## Strategy inventory and disposition

Universe is deliberately **undeclared** until a point-in-time universe is
provided in the audit input. The old endpoint accepts arbitrary Yahoo symbols,
so it has no survivorship-safe universe, liquidity screen, delisting history,
or corporate-action assurance. Daily OHLCV is the only supported granularity.

| Strategy | Deterministic definition / intended holding | Current disposition | Main data and model risk | Regime / correlation expectation |
| --- | --- | --- | --- | --- |
| `bull_trend` | Close > MA5 > MA10 > MA20 and RSI(14) < 70; long while condition remains. | Research candidate; not evaluated. | Split-adjusted prices, gaps and trend crowding. | Bull regime; highly correlated with golden-cross and breakout. |
| `ma_golden_cross` | MA5 crosses from <= MA10 to > MA10 while MA10 > MA20; long until next signal is absent. | Research candidate; not evaluated. | Whipsaw, parameter sensitivity, delayed entry. | Bull/transition; correlated with bull trend. |
| `shrink_pullback` | Strong MA alignment, close 0–1.5% above MA20, volume <= 80% prior 20-day average. | Research candidate; not evaluated. | Volume adjustments and false support. | Trend continuation; correlated with bull trend. |
| `box_oscillation` | 40-day range >= 8%, close in bottom quartile, MA10/MA20 within 3%. | Research candidate; not evaluated. | Range breakouts and low capacity near support. | Sideways; diversifies trend rules only if genuinely non-trending. |
| `volume_breakout` | Close > prior 20-day high and volume >= 1.5x prior 20-day average. | Research candidate; not evaluated. | Opening gaps, false breakouts, event liquidity. | Bull/event-driven; correlated with trend rules. |
| `dragon_head` | Requires sector leadership and cross-sectional relative strength; single-stock OHLCV is insufficient. | **Downgraded: discretionary framework.** Forced `WAIT`. | Missing point-in-time sector constituents, ADV and ranking data. | Momentum-like but unmeasurable under current data contract. |
| `emotion_cycle` | Original rule depends on news and market emotion. | **Downgraded: discretionary framework.** Forced `WAIT`. | No timestamped, revision-safe sentiment or breadth dataset. | Contrarian; correlation claim is unsupported until data exists. |
| `chan_theory` | Original central-structure and divergence wording has no unique testable rule. | **Downgraded: discretionary framework.** Forced `WAIT`. | Subjective segmentation and post-hoc labelling. | Unknown; do not assign alpha or diversification. |
| `wave_theory` | Original wave counts are discretionary; Fibonacci proximity alone is not a wave model. | **Downgraded: discretionary framework.** Forced `WAIT`. | Multiple valid counts and hindsight bias. | Unknown; do not assign alpha or diversification. |
| `one_yang_three_yin` | 1.5% first bullish candle, three contained lower-volume bearish candles, then volume-confirmed break above first high. | Research candidate; not evaluated. | Sparse pattern count and corporate-action distortion. | Trend continuation; likely correlated with breakout. |
| `bottom_volume` | >=20% drawdown from prior 60-day high, bullish reversal close, volume >=2.5x prior 20-day average. | Research candidate; not evaluated. | Delisting/survivorship bias and crash-tail exposure. | Bear/reversal; potentially diversifying but requires a complete universe. |

## SPY diagnostic baseline — 2026-07-14

This is a deliberately narrow, free-data diagnostic. It is not a hedge-fund
claim: `SPY` is one ETF, not a point-in-time constituent universe, and Yahoo
may revise history. The script excludes Yahoo's newest daily bar so an
in-progress close cannot leak into the result. The output captures the exact
normalized bars and SHA-256, then accepts its own report as a future `--input`
to reproduce that snapshot without re-fetching Yahoo.

| Field | Recorded value |
| --- | --- |
| Raw provider | Yahoo Finance Chart API diagnostic snapshot |
| Universe | SPY only; single-ETF baseline |
| Data range | 2021-07-14 through 2026-07-10 |
| Retrieval | 2026-07-14T05:48:01.726Z |
| Normalized-bar SHA-256 | `4bf302f7eeec3888809a36127f84b328bda1fc1e4e4f17fc4f8959c8ce932de8` |
| Test window | 2025-04-10 through 2026-07-10 |
| Result | 0 `PASS`, 7 `FAIL`, 4 `NOT_ELIGIBLE` |

All figures below are **test-window, cost-adjusted** results. `Excess CAGR` is
against buy-and-hold SPY over the same window; turnover is annualized. The
full artifact also contains volatility, Sortino, Calmar, win rate, profit
factor, exposure, average holding days, cost sensitivity, and daily records.

| Strategy | Gate | CAGR | Sharpe | Max DD | Trades | Turnover | Excess CAGR | Worst regime |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| bull_trend | FAIL | 4.69% | 1.01 | 3.91% | 25 | 40.26x | -37.29% | BULL |
| ma_golden_cross | FAIL | 1.05% | 0.90 | 0.66% | 10 | 16.10x | -40.93% | BEAR |
| shrink_pullback | FAIL | 0.07% | 0.14 | 0.34% | 3 | 4.83x | -41.91% | BEAR |
| box_oscillation | FAIL | 7.87% | 1.07 | 0.32% | 2 | 3.22x | -34.11% | SIDEWAYS |
| volume_breakout | FAIL | 0.00% | 0.00 | 0.00% | 0 | 0.00x | -41.98% | BEAR |
| dragon_head | NOT_ELIGIBLE | 0.00% | 0.00 | 0.00% | 0 | 0.00x | -41.98% | BEAR |
| emotion_cycle | NOT_ELIGIBLE | 0.00% | 0.00 | 0.00% | 0 | 0.00x | -41.98% | BEAR |
| chan_theory | NOT_ELIGIBLE | 0.00% | 0.00 | 0.00% | 0 | 0.00x | -41.98% | BEAR |
| wave_theory | NOT_ELIGIBLE | 0.00% | 0.00 | 0.00% | 0 | 0.00x | -41.98% | BEAR |
| one_yang_three_yin | FAIL | 0.00% | 0.00 | 0.00% | 0 | 0.00x | -41.98% | BEAR |
| bottom_volume | FAIL | 0.00% | 0.00 | 0.00% | 0 | 0.00x | -41.98% | BEAR |

The candidate portfolio also fails despite good-looking risk ratios: it has
1.97% CAGR, 1.28% annualized volatility, 1.53 Sharpe, 2.36 Sortino, 0.59%
maximum drawdown, 3.34 Calmar, 65.52% win rate, 3.29 profit factor, 9.09x
turnover, 3.56% average exposure, 2.34 average holding days, and 29 completed
exposure episodes. Its 41.98% benchmark CAGR produces **-40.01% excess CAGR**.
That fails the gate; a low-volatility strategy that misses the benchmark by 40
percentage points is not institutional-quality alpha.

This baseline replaces the previous “not yet run” state, but it does not close
the point-in-time, delisting, capacity, or universe-quality gaps below.

## Required data before an empirical claim

An input dataset must state its source and universe and contain a consistent,
split-adjusted daily OHLCV series. To remove the remaining hard blockers, it
also needs:

- point-in-time constituent history, including delisted names, before any
  cross-sectional or universe-level claim;
- verified split/dividend adjustment policy and source timestamps;
- a liquidity field such as ADV, quoted spread, and realistic market-impact
  assumptions before capacity claims;
- trading calendar, exchange, currency, borrow availability, and short/long
  authority before a portfolio or short-side extension;
- timestamped, revision-safe sentiment/breadth data before re-opening Emotion
  Cycle; and point-in-time sector data before re-opening Dragon Head.

Free data can be used only when these properties are documented. A convenient
unadjusted download is not a source of truth.

## Reproducible audit command

Prepare a JSON input with a source declaration; do not invent one:

```json
{
  "dataSource": "provider, retrieval date, adjustment policy, and point-in-time limitations",
  "universe": "declared universe and inclusion rules",
  "config": { "commissionBps": 1, "spreadBps": 1, "slippageBps": 5 },
  "bars": [
    { "date": "2024-01-02", "open": 100, "high": 102, "low": 99, "close": 101, "volume": 1000000 }
  ]
}
```

Run the audit and retain both the input and output artifacts:

```powershell
npm.cmd run quant:audit -- --input <ohlcv-input.json> --output .tmp\quant-strategy-report.json *>&1 |
  Tee-Object .tmp\quant-strategy-audit.log
```

For a free, explicitly non-certifying single-ETF diagnostic, use Yahoo only
with an acknowledgement flag. The command excludes the newest provider bar and
saves normalized bars inside the report; replay that report rather than
re-fetching a mutable live snapshot:

```powershell
npm.cmd run quant:audit -- --yahoo-symbol SPY --range 5y --accept-yahoo-diagnostic `
  --output .tmp\quant-strategy-spy-5y.json
npm.cmd run quant:audit -- --input .tmp\quant-strategy-spy-5y.json `
  --output .tmp\quant-strategy-spy-5y-replay.json
```

The script records source declaration, universe, data range, fixed-rule
random-seed status (`null`), exact configuration, normalized-bar SHA-256 and
bars, strategy reports, walk-forward windows, gate failures, correlations, and
candidate portfolio metrics. A non-zero exit is evidence of invalid research
input and must not be replaced with a fallback result.

## Remaining non-code decision gates

Pause before claiming deployable strategy quality when any of these is missing:

1. Accepted maximum drawdown and capital base.
2. Market, exchange, currency, trade horizon, and long/short mandate.
3. Point-in-time/delisted/corporate-action historical data authority.
4. Capacity assumptions and permission to use real trading data.

Until then, the correct output is a research report with explicit failures,
not an investment recommendation.
