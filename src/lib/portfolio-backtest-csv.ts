import type { PortfolioBacktestResult } from "./portfolio-backtest";

const csvCell = (value: string | number): string => {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot export a non-finite backtest value.");
    return String(value);
  }
  // Spreadsheet applications can execute formulas even in quoted string cells.
  const literal = /^\s*[=+\-@]|^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${literal.replace(/"/g, '""')}"`;
};

export const serializePortfolioBacktestCsv = (result: Pick<PortfolioBacktestResult, "curve" | "rebalancePolicy" | "dividendPolicy" | "sourceAsOf" | "methodologyVersion" | "warnings">, cacheStatus: string): string => {
  const header = "date,portfolio_value_usd,spy_value_usd,portfolio_index_base_100,spy_index_base_100,rebalance_policy,dividend_policy,source_as_of,cache_status,methodology_version,warnings";
  const rows = result.curve.map((point) => [
    point.date, point.portfolioValue, point.benchmarkValue, point.portfolioIndexed, point.benchmarkIndexed,
    result.rebalancePolicy, result.dividendPolicy, result.sourceAsOf, cacheStatus, result.methodologyVersion,
    result.warnings.join(" | "),
  ].map(csvCell).join(","));
  return `${[header, ...rows].join("\r\n")}\r\n`;
};
