import assert from "node:assert/strict";
import test from "node:test";
import { decodePortfolioBacktestShareConfig, encodePortfolioBacktestShareConfig, type PortfolioBacktestShareConfigV1 } from "../src/lib/portfolio-backtest-share";

const valid: PortfolioBacktestShareConfigV1 = {
  version: 1,
  startingCapital: 10_000,
  startDate: "2021-01-01",
  endDate: "2026-10-15",
  rebalancePolicy: "quarterly",
  dividendPolicy: "reinvest",
  positions: [
    { ticker: "VTI", basisPoints: 6_000 },
    { ticker: "BND", basisPoints: 4_000 },
  ],
};

test("round trips a canonical v1 setup without results or provider state", () => {
  const encoded = encodePortfolioBacktestShareConfig(valid);
  assert.equal(encoded, "#/work/portfolio-backtest?v=1&capital=10000&start=2021-01-01&end=2026-10-15&rebalance=quarterly&dividend=reinvest&asset=BND:4000&asset=VTI:6000");
  assert.deepEqual(decodePortfolioBacktestShareConfig(encoded), { ...valid, positions: [valid.positions[1], valid.positions[0]] });
  assert.equal(decodePortfolioBacktestShareConfig("#/work/portfolio-backtest"), null);
});

test("rejects invalid shared setups as one unit", () => {
  const route = "#/work/portfolio-backtest";
  const cases = [
    `${route}?v=2&capital=10000&start=2021-01-01&end=2026-10-15&rebalance=quarterly&dividend=reinvest&asset=VTI:10000`,
    `${route}?v=1&capital=10000&start=2021-01-01&end=2026-10-15&rebalance=quarterly&dividend=reinvest&asset=VTI:5000&asset=VTI:5000`,
    `${route}?v=1&capital=10000&start=2021-01-01&end=2026-10-15&rebalance=quarterly&dividend=reinvest&asset=VTI:1000&asset=BND:1000&asset=VEA:1000&asset=VWO:1000&asset=VNQ:1000&asset=TIP:1000&asset=GLD:1000&asset=DBC:1000&asset=IJS:1000&asset=IJH:500&asset=SHY:500`,
    `${route}?v=1&capital=10000&start=2021-01-01&end=2026-10-15&rebalance=quarterly&dividend=reinvest&asset=VTI:9999`,
    `${route}?v=1&capital=10000&start=2026-10-16&end=2026-10-15&rebalance=quarterly&dividend=reinvest&asset=VTI:10000`,
    `${route}?v=1&capital=10000&start=2021-01-01&end=2026-10-15&rebalance=weekly&dividend=reinvest&asset=VTI:10000`,
    `${route}?v=1&capital=10000&start=2021-01-01&end=2026-10-15&rebalance=quarterly&dividend=spend&asset=VTI:10000`,
    `${route}?v=1&capital=10000&capital=20000&start=2021-01-01&end=2026-10-15&rebalance=quarterly&dividend=reinvest&asset=VTI:10000`,
  ];
  for (const value of cases) assert.throws(() => decodePortfolioBacktestShareConfig(value));
  assert.equal(decodePortfolioBacktestShareConfig(`${route}-other?v=1&capital=10000&start=2021-01-01&end=2026-10-15&rebalance=quarterly&dividend=reinvest&asset=VTI:10000`), null);
});
