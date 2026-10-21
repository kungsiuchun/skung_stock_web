import assert from "node:assert/strict";
import test from "node:test";
import { serializePortfolioBacktestCsv } from "../src/lib/portfolio-backtest-csv";

const result: Parameters<typeof serializePortfolioBacktestCsv>[0] = {
  curve: [
    { date: "2025-01-02", portfolioValue: 10000, benchmarkValue: 10000, portfolioIndexed: 100, benchmarkIndexed: 100 },
    { date: "2025-01-03", portfolioValue: 10012.345678, benchmarkValue: 9999.9, portfolioIndexed: 100.12345678, benchmarkIndexed: 99.999 },
  ],
  rebalancePolicy: "quarterly",
  dividendPolicy: "cash",
  sourceAsOf: "2025-01-03",
  methodologyVersion: "v1",
  warnings: [],
};

test("exports completed curve values unchanged with explicit units, policy and freshness", () => {
  const before = JSON.stringify(result);
  const csv = serializePortfolioBacktestCsv(result, "refreshed");
  assert.equal(csv, [
    "date,portfolio_value_usd,spy_value_usd,portfolio_index_base_100,spy_index_base_100,rebalance_policy,dividend_policy,source_as_of,cache_status,methodology_version,warnings",
    '"2025-01-02",10000,10000,100,100,"quarterly","cash","2025-01-03","refreshed","v1",""',
    '"2025-01-03",10012.345678,9999.9,100.12345678,99.999,"quarterly","cash","2025-01-03","refreshed","v1",""',
    "",
  ].join("\r\n"));
  assert.equal(JSON.stringify(result), before, "export must not mutate or recalculate results");
});

test("keeps stale data warnings and escapes CSV delimiters, quotes and newlines", () => {
  const csv = serializePortfolioBacktestCsv({ ...result, warnings: ['Provider failed, showing "cached" data.\nRetry before relying on it.'] }, "stale");
  assert.match(csv, /"stale","v1","Provider failed, showing ""cached"" data\.\nRetry before relying on it\."/);
});

test("neutralizes spreadsheet formulas in text without altering numeric cells", () => {
  for (const prefix of ["=", "+", "-", "@", "\t", "\r", "\n", " =", " \t@", "\uFEFF="]) {
    const csv = serializePortfolioBacktestCsv({ ...result, warnings: [`${prefix}UNTRUSTED()`] }, "hit");
    assert.ok(csv.includes(`"'${prefix}UNTRUSTED()"`));
  }
  const csv = serializePortfolioBacktestCsv({ ...result, curve: [{ ...result.curve[0], portfolioValue: -1 }] }, "hit");
  assert.ok(csv.includes(",-1,"), "numeric values must not be turned into spreadsheet strings");
  assert.throws(() => serializePortfolioBacktestCsv({ ...result, curve: [{ ...result.curve[0], portfolioValue: Number.NaN }] }, "hit"), /non-finite/);
});
