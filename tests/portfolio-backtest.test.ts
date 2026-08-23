import assert from "node:assert/strict";
import test from "node:test";

import {
  PortfolioBacktestError,
  simulatePortfolioBacktest,
  type PortfolioHistoricalSeries,
} from "../src/lib/portfolio-backtest";

const series = (ticker: string, rows: Array<{
  date: string;
  close: number;
  adjustedClose?: number;
  dividend?: number;
  splitFactor?: number;
}>): PortfolioHistoricalSeries => ({
  ticker,
  displayName: `${ticker} ETF`,
  quoteType: "ETF",
  exchange: "NMS",
  points: rows.map((row) => ({
    adjustedClose: row.adjustedClose ?? row.close,
    dividend: row.dividend ?? 0,
    splitFactor: row.splitFactor ?? 1,
    ...row,
  })),
});

test("simulates cash dividends and reinvested dividends as distinct historical outcomes", () => {
  const histories = [
    series("VTI", [
      { date: "2025-01-02", close: 100 },
      { date: "2025-01-03", close: 100, adjustedClose: 101, dividend: 1 },
      { date: "2025-01-06", close: 110, adjustedClose: 111.1 },
    ]),
    series("SPY", [
      { date: "2025-01-02", close: 100 },
      { date: "2025-01-03", close: 100 },
      { date: "2025-01-06", close: 100 },
    ]),
  ];

  const base = {
    startingCapital: 100,
    positions: [{ ticker: "VTI", basisPoints: 10_000 }],
    histories,
    rebalancePolicy: "none" as const,
  };

  const cash = simulatePortfolioBacktest({ ...base, dividendPolicy: "cash" });
  const reinvested = simulatePortfolioBacktest({ ...base, dividendPolicy: "reinvest" });

  assert.equal(cash.endingValue, 111);
  assert.equal(cash.positions[0].cashDividendValue, 1);
  assert.equal(reinvested.endingValue, 111.1);
  assert.equal(reinvested.positions[0].cashDividendValue, 0);
  assert.equal(reinvested.benchmarkEndingValue, 100);
});

test("rebalances only on the final completed common session of the selected month", () => {
  const histories = [
    series("AAA", [
      { date: "2025-01-29", close: 100 },
      { date: "2025-01-31", close: 200 },
      { date: "2025-02-03", close: 100 },
    ]),
    series("BBB", [
      { date: "2025-01-29", close: 100 },
      { date: "2025-01-31", close: 50 },
      { date: "2025-02-03", close: 100 },
    ]),
    series("SPY", [
      { date: "2025-01-29", close: 100 },
      { date: "2025-01-31", close: 100 },
      { date: "2025-02-03", close: 100 },
    ]),
  ];

  const input = {
    startingCapital: 100,
    positions: [
      { ticker: "AAA", basisPoints: 5_000 },
      { ticker: "BBB", basisPoints: 5_000 },
    ],
    histories,
    dividendPolicy: "cash" as const,
  };

  assert.equal(simulatePortfolioBacktest({ ...input, rebalancePolicy: "none" }).endingValue, 100);
  const monthly = simulatePortfolioBacktest({ ...input, rebalancePolicy: "monthly" });
  assert.equal(monthly.endingValue, 156.25);
  assert.deepEqual(monthly.rebalancedOn, ["2025-01-31", "2025-02-03"]);
});

test("does not double-count split events when cash-policy closes are already split-adjusted", () => {
  const result = simulatePortfolioBacktest({
    startingCapital: 100,
    positions: [{ ticker: "VTI", basisPoints: 10_000 }],
    histories: [
      series("VTI", [
        { date: "2025-01-02", close: 50 },
        { date: "2025-01-03", close: 50, splitFactor: 2 },
        { date: "2025-01-06", close: 60 },
      ]),
      series("SPY", [
        { date: "2025-01-02", close: 100 },
        { date: "2025-01-03", close: 100 },
        { date: "2025-01-06", close: 100 },
      ]),
    ],
    rebalancePolicy: "none",
    dividendPolicy: "cash",
  });

  assert.equal(result.endingValue, 120);
});

test("fails closed when the portfolio does not allocate exactly 10,000 basis points", () => {
  assert.throws(
    () => simulatePortfolioBacktest({
      startingCapital: 100,
      positions: [{ ticker: "VTI", basisPoints: 9_999 }],
      histories: [
        series("VTI", [{ date: "2025-01-02", close: 100 }, { date: "2025-01-03", close: 101 }]),
        series("SPY", [{ date: "2025-01-02", close: 100 }, { date: "2025-01-03", close: 101 }]),
      ],
      rebalancePolicy: "none",
      dividendPolicy: "reinvest",
    }),
    (error) => error instanceof PortfolioBacktestError && error.code === "INVALID_ALLOCATION",
  );
});

test("rejects invalid calendar dates instead of letting JavaScript normalize them", () => {
  assert.throws(
    () => simulatePortfolioBacktest({
      startingCapital: 100,
      positions: [{ ticker: "VTI", basisPoints: 10_000 }],
      histories: [
        series("VTI", [{ date: "2025-01-02", close: 100 }, { date: "2025-01-03", close: 101 }]),
        series("SPY", [{ date: "2025-01-02", close: 100 }, { date: "2025-01-03", close: 101 }]),
      ],
      requestedStart: "2025-02-30",
      rebalancePolicy: "none",
      dividendPolicy: "reinvest",
    }),
    (error) => error instanceof PortfolioBacktestError && error.code === "INVALID_INPUT",
  );
});

test("fails closed when a selected security has a missing completed EOD session inside the common range", () => {
  assert.throws(
    () => simulatePortfolioBacktest({
      startingCapital: 100,
      positions: [{ ticker: "VTI", basisPoints: 10_000 }],
      histories: [
        series("VTI", [
          { date: "2025-01-02", close: 100 },
          { date: "2025-01-03", close: 101 },
          { date: "2025-01-06", close: 102 },
        ]),
        series("SPY", [
          { date: "2025-01-02", close: 100 },
          { date: "2025-01-06", close: 102 },
        ]),
      ],
      rebalancePolicy: "none",
      dividendPolicy: "reinvest",
    }),
    (error) => error instanceof PortfolioBacktestError && error.code === "INSUFFICIENT_HISTORY",
  );
});

test("uses the final shared EOD session for quarterly and annual rebalancing without look-ahead", () => {
  const dates = ["2024-12-30", "2024-12-31", "2025-01-02", "2025-03-31", "2025-04-01", "2025-06-30", "2025-07-01", "2025-09-30", "2025-10-01", "2025-12-31"];
  const histories = [
    series("AAA", dates.map((date, index) => ({ date, close: 100 + index * 10 }))),
    series("BBB", dates.map((date, index) => ({ date, close: 100 - index * 4 }))),
    series("SPY", dates.map((date) => ({ date, close: 100 }))),
  ];
  const input = {
    startingCapital: 100,
    positions: [{ ticker: "AAA", basisPoints: 5_000 }, { ticker: "BBB", basisPoints: 5_000 }],
    histories,
    dividendPolicy: "cash" as const,
  };

  assert.deepEqual(simulatePortfolioBacktest({ ...input, rebalancePolicy: "quarterly" }).rebalancedOn, ["2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"]);
  assert.deepEqual(simulatePortfolioBacktest({ ...input, rebalancePolicy: "annual" }).rebalancedOn, ["2024-12-31", "2025-12-31"]);
});

test("reports unavailable risk metrics only at their defined thresholds and normalizes both curves to 100", () => {
  const early = simulatePortfolioBacktest({
    startingCapital: 100,
    positions: [{ ticker: "VTI", basisPoints: 10_000 }],
    histories: [
      series("VTI", [{ date: "2025-01-02", close: 100 }, { date: "2025-01-03", close: 110 }]),
      series("SPY", [{ date: "2025-01-02", close: 200 }, { date: "2025-01-03", close: 220 }]),
    ],
    rebalancePolicy: "none",
    dividendPolicy: "reinvest",
  });
  assert.equal(early.metrics.cagr, null);
  assert.equal(early.metrics.annualizedVolatility, null);
  assert.equal(early.metrics.sharpeRatio, null);
  assert.deepEqual(early.curve.map((point) => [point.portfolioIndexed, point.benchmarkIndexed]), [[100, 100], [110, 110]]);

  const dates = [...Array.from({ length: 20 }, (_, index) => `2024-01-${String(index + 2).padStart(2, "0")}`), "2025-01-02"];
  const vtiPrices = [100, 120, 108, ...Array.from({ length: 17 }, () => 108), 132];
  const measured = simulatePortfolioBacktest({
    startingCapital: 100,
    positions: [{ ticker: "VTI", basisPoints: 10_000 }],
    histories: [
      series("VTI", dates.map((date, index) => ({ date, close: vtiPrices[index] }))),
      series("SPY", dates.map((date, index) => ({ date, close: 200 + index }))),
    ],
    rebalancePolicy: "none",
    dividendPolicy: "reinvest",
  });
  assert.ok(measured.metrics.cagr !== null && measured.metrics.cagr > 0.31 && measured.metrics.cagr < 0.33);
  assert.ok(measured.metrics.annualizedVolatility !== null && measured.metrics.annualizedVolatility > 0);
  assert.ok(measured.metrics.sharpeRatio !== null);
  assert.equal(measured.metrics.maxDrawdown, -0.1);

  const zeroVolatility = simulatePortfolioBacktest({
    startingCapital: 100,
    positions: [{ ticker: "VTI", basisPoints: 10_000 }],
    histories: [series("VTI", dates.map((date) => ({ date, close: 100 }))), series("SPY", dates.map((date) => ({ date, close: 100 })))],
    rebalancePolicy: "none",
    dividendPolicy: "reinvest",
  });
  assert.equal(zeroVolatility.metrics.annualizedVolatility, 0);
  assert.equal(zeroVolatility.metrics.sharpeRatio, null);
});
