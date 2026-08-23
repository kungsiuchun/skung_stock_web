export const PORTFOLIO_BACKTEST_SCHEMA_VERSION = "v1" as const;
export const PORTFOLIO_BACKTEST_BENCHMARK = "SPY" as const;
export const MAX_PORTFOLIO_POSITIONS = 10;
export const TOTAL_ALLOCATION_BASIS_POINTS = 10_000;

export type PortfolioRebalancePolicy = "none" | "monthly" | "quarterly" | "annual";
export type PortfolioDividendPolicy = "reinvest" | "cash";

export interface PortfolioPositionInput {
  ticker: string;
  basisPoints: number;
}

export interface PortfolioHistoricalPoint {
  date: string;
  /** Split-adjusted closing price. */
  close: number;
  /** Split- and dividend-adjusted closing price for total-return simulation. */
  adjustedClose: number;
  /** Cash distribution per share payable on this EOD session. */
  dividend: number;
  /** Share multiplier for a split effective on this EOD session. */
  splitFactor: number;
}

export interface PortfolioHistoricalSeries {
  ticker: string;
  displayName: string;
  quoteType: string;
  exchange: string;
  points: PortfolioHistoricalPoint[];
}

export interface PortfolioBacktestInput {
  startingCapital: number;
  positions: PortfolioPositionInput[];
  histories: PortfolioHistoricalSeries[];
  rebalancePolicy: PortfolioRebalancePolicy;
  dividendPolicy: PortfolioDividendPolicy;
  requestedStart?: string;
  requestedEnd?: string;
}

export interface PortfolioBacktestMetricSet {
  endingValue: number;
  cumulativeReturn: number;
  cagr: number | null;
  annualizedVolatility: number | null;
  sharpeRatio: number | null;
  maxDrawdown: number;
}

export interface PortfolioCurvePoint {
  date: string;
  portfolioValue: number;
  portfolioIndexed: number;
  benchmarkValue: number;
  benchmarkIndexed: number;
}

export interface PortfolioPositionResult {
  ticker: string;
  displayName: string;
  targetWeightPct: number;
  endingWeightPct: number;
  endingValue: number;
  cashDividendValue: number;
}

export interface PortfolioBacktestResult {
  schemaVersion: typeof PORTFOLIO_BACKTEST_SCHEMA_VERSION;
  benchmark: typeof PORTFOLIO_BACKTEST_BENCHMARK;
  dataSource: { provider: "Yahoo Finance chart API"; role: "US ETF and SPY completed EOD history" };
  requestedRange: { start: string; end: string };
  effectiveRange: { start: string; end: string; sessionCount: number };
  startingCapital: number;
  rebalancePolicy: PortfolioRebalancePolicy;
  dividendPolicy: PortfolioDividendPolicy;
  sourceAsOf: string;
  curve: PortfolioCurvePoint[];
  metrics: PortfolioBacktestMetricSet;
  benchmarkMetrics: PortfolioBacktestMetricSet;
  endingValue: number;
  benchmarkEndingValue: number;
  excessCumulativeReturn: number;
  positions: PortfolioPositionResult[];
  rebalancedOn: string[];
  /** Partial-session results are never produced, so successful runs exclude none. */
  excludedSessions: string[];
  warnings: string[];
  methodologyVersion: typeof PORTFOLIO_BACKTEST_SCHEMA_VERSION;
}

export type PortfolioBacktestErrorCode =
  | "INVALID_ALLOCATION"
  | "INVALID_INPUT"
  | "DUPLICATE_TICKER"
  | "MISSING_HISTORY"
  | "MALFORMED_HISTORY"
  | "INSUFFICIENT_HISTORY";

export class PortfolioBacktestError extends Error {
  constructor(public readonly code: PortfolioBacktestErrorCode, message: string) {
    super(message);
    this.name = "PortfolioBacktestError";
  }
}

type Holding = {
  ticker: string;
  basisPoints: number;
  shares: number;
  cash: number;
  cashDividendValue: number;
};

type BasketRun = {
  values: number[];
  holdings: Holding[];
  rebalancedOn: string[];
};

const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const dateKey = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const normalizedTicker = (value: string) => value.trim().toUpperCase();
const periodKey = (date: string, policy: Exclude<PortfolioRebalancePolicy, "none">) => {
  const [year, month] = date.split("-").map(Number);
  if (policy === "monthly") return `${year}-${String(month).padStart(2, "0")}`;
  if (policy === "quarterly") return `${year}-Q${Math.ceil(month / 3)}`;
  return String(year);
};

const round = (value: number, decimals = 8) => Number(value.toFixed(decimals));

export const validatePortfolioBacktestRequest = (input: Pick<PortfolioBacktestInput, "startingCapital" | "positions" | "rebalancePolicy" | "dividendPolicy" | "requestedStart" | "requestedEnd">) => {
  if (!numeric(input.startingCapital) || input.startingCapital <= 0) {
    throw new PortfolioBacktestError("INVALID_INPUT", "Starting capital must be a positive finite USD amount.");
  }
  if (!Array.isArray(input.positions) || input.positions.length === 0 || input.positions.length > MAX_PORTFOLIO_POSITIONS) {
    throw new PortfolioBacktestError("INVALID_ALLOCATION", `Portfolio requires between 1 and ${MAX_PORTFOLIO_POSITIONS} positions.`);
  }
  if (!["none", "monthly", "quarterly", "annual"].includes(input.rebalancePolicy)
    || !["reinvest", "cash"].includes(input.dividendPolicy)) {
    throw new PortfolioBacktestError("INVALID_INPUT", "Unsupported rebalancing or dividend policy.");
  }
  if (input.requestedStart && !dateKey(input.requestedStart) || input.requestedEnd && !dateKey(input.requestedEnd)
    || input.requestedStart && input.requestedEnd && input.requestedStart > input.requestedEnd) {
    throw new PortfolioBacktestError("INVALID_INPUT", "Requested date range must use YYYY-MM-DD and be chronological.");
  }
  const tickers = new Set<string>();
  let totalBasisPoints = 0;
  for (const position of input.positions) {
    const ticker = normalizedTicker(position.ticker);
    if (!/^[A-Z0-9.^-]{1,16}$/.test(ticker) || !Number.isInteger(position.basisPoints) || position.basisPoints <= 0) {
      throw new PortfolioBacktestError("INVALID_ALLOCATION", "Each portfolio position needs a valid ticker and positive whole basis-point weight.");
    }
    if (tickers.has(ticker)) throw new PortfolioBacktestError("DUPLICATE_TICKER", `Duplicate portfolio ticker: ${ticker}.`);
    tickers.add(ticker);
    totalBasisPoints += position.basisPoints;
  }
  if (totalBasisPoints !== TOTAL_ALLOCATION_BASIS_POINTS) {
    throw new PortfolioBacktestError("INVALID_ALLOCATION", "Portfolio weights must total exactly 10,000 basis points (100.00%).");
  }
};

const pointsFor = (series: PortfolioHistoricalSeries, requestedStart?: string, requestedEnd?: string) => {
  if (!series || !Array.isArray(series.points)) {
    throw new PortfolioBacktestError("MISSING_HISTORY", "A required portfolio history is missing.");
  }
  const result = new Map<string, PortfolioHistoricalPoint>();
  for (const point of series.points) {
    if (!dateKey(point.date) || !numeric(point.close) || point.close <= 0
      || !numeric(point.adjustedClose) || point.adjustedClose <= 0
      || !numeric(point.dividend) || point.dividend < 0
      || !numeric(point.splitFactor) || point.splitFactor <= 0) {
      throw new PortfolioBacktestError("MALFORMED_HISTORY", `History for ${series.ticker} contains invalid EOD data.`);
    }
    if (requestedStart && point.date < requestedStart || requestedEnd && point.date > requestedEnd) continue;
    if (result.has(point.date)) throw new PortfolioBacktestError("MALFORMED_HISTORY", `History for ${series.ticker} contains duplicate EOD sessions.`);
    result.set(point.date, point);
  }
  if (result.size === 0) throw new PortfolioBacktestError("INSUFFICIENT_HISTORY", `No EOD history is available for ${series.ticker} in the requested range.`);
  return result;
};

const priceFor = (point: PortfolioHistoricalPoint, dividendPolicy: PortfolioDividendPolicy) =>
  dividendPolicy === "reinvest" ? point.adjustedClose : point.close;

const basketValue = (holdings: Holding[], points: Map<string, PortfolioHistoricalPoint>, dividendPolicy: PortfolioDividendPolicy) =>
  holdings.reduce((sum, holding) => sum + holding.cash + holding.shares * priceFor(points.get(holding.ticker)!, dividendPolicy), 0);

const shouldRebalance = (index: number, dates: string[], policy: PortfolioRebalancePolicy) => {
  if (policy === "none" || index === 0) return false;
  const current = dates[index];
  const next = dates[index + 1];
  return !next || periodKey(current, policy) !== periodKey(next, policy);
};

const runBasket = (input: {
  dates: string[];
  pointsByTicker: Map<string, Map<string, PortfolioHistoricalPoint>>;
  allocations: PortfolioPositionInput[];
  startingCapital: number;
  dividendPolicy: PortfolioDividendPolicy;
  rebalancePolicy: PortfolioRebalancePolicy;
}): BasketRun => {
  const holdings: Holding[] = input.allocations.map((allocation) => {
    const ticker = normalizedTicker(allocation.ticker);
    const initialPoint = input.pointsByTicker.get(ticker)!.get(input.dates[0])!;
    const initialValue = input.startingCapital * allocation.basisPoints / TOTAL_ALLOCATION_BASIS_POINTS;
    return { ticker, basisPoints: allocation.basisPoints, shares: initialValue / priceFor(initialPoint, input.dividendPolicy), cash: 0, cashDividendValue: 0 };
  });
  const values = [input.startingCapital];
  const rebalancedOn: string[] = [];

  for (let index = 1; index < input.dates.length; index += 1) {
    const date = input.dates[index];
    for (const holding of holdings) {
      const point = input.pointsByTicker.get(holding.ticker)!.get(date)!;
      if (input.dividendPolicy === "cash") {
        // Yahoo chart close values are already split-adjusted. Applying the
        // split event to shares again would manufacture a second split gain.
        const dividendValue = holding.shares * point.dividend;
        holding.cash += dividendValue;
        holding.cashDividendValue += dividendValue;
      }
    }
    if (shouldRebalance(index, input.dates, input.rebalancePolicy)) {
      const totalValue = basketValue(holdings, new Map(holdings.map((holding) => [holding.ticker, input.pointsByTicker.get(holding.ticker)!.get(date)!])), input.dividendPolicy);
      for (const holding of holdings) {
        const point = input.pointsByTicker.get(holding.ticker)!.get(date)!;
        holding.shares = totalValue * holding.basisPoints / TOTAL_ALLOCATION_BASIS_POINTS / priceFor(point, input.dividendPolicy);
        holding.cash = 0;
      }
      rebalancedOn.push(date);
    }
    const points = new Map(holdings.map((holding) => [holding.ticker, input.pointsByTicker.get(holding.ticker)!.get(date)!]));
    values.push(basketValue(holdings, points, input.dividendPolicy));
  }
  return { values, holdings, rebalancedOn };
};

const sampleStdDev = (values: number[]) => {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
};

const metricsFor = (values: number[], dates: string[]): PortfolioBacktestMetricSet => {
  const endingValue = values[values.length - 1];
  const cumulativeReturn = endingValue / values[0] - 1;
  const days = (Date.parse(`${dates[dates.length - 1]}T00:00:00.000Z`) - Date.parse(`${dates[0]}T00:00:00.000Z`)) / 86_400_000;
  const years = days / 365.2425;
  const cagr = years >= 1 ? (endingValue / values[0]) ** (1 / years) - 1 : null;
  const returns = values.slice(1).map((value, index) => value / values[index] - 1);
  const standardDeviation = returns.length >= 20 ? sampleStdDev(returns) : null;
  const annualizedVolatility = standardDeviation === null ? null : standardDeviation * Math.sqrt(252);
  const meanDailyReturn = returns.length === 0 ? null : returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const sharpeRatio = annualizedVolatility && annualizedVolatility > 0 && meanDailyReturn !== null
    ? meanDailyReturn * 252 / annualizedVolatility
    : null;
  let peak = values[0];
  let maxDrawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    maxDrawdown = Math.min(maxDrawdown, value / peak - 1);
  }
  return { endingValue: round(endingValue), cumulativeReturn: round(cumulativeReturn), cagr: cagr === null ? null : round(cagr), annualizedVolatility: annualizedVolatility === null ? null : round(annualizedVolatility), sharpeRatio: sharpeRatio === null ? null : round(sharpeRatio), maxDrawdown: round(maxDrawdown) };
};

export const simulatePortfolioBacktest = (input: PortfolioBacktestInput): PortfolioBacktestResult => {
  validatePortfolioBacktestRequest(input);
  const seriesByTicker = new Map<string, PortfolioHistoricalSeries>();
  for (const series of input.histories) {
    const ticker = normalizedTicker(series.ticker);
    if (seriesByTicker.has(ticker)) throw new PortfolioBacktestError("MALFORMED_HISTORY", `Duplicate history supplied for ${ticker}.`);
    seriesByTicker.set(ticker, { ...series, ticker });
  }
  const requestedTickers = [...input.positions.map((position) => normalizedTicker(position.ticker)), PORTFOLIO_BACKTEST_BENCHMARK];
  const pointsByTicker = new Map<string, Map<string, PortfolioHistoricalPoint>>();
  for (const ticker of new Set(requestedTickers)) {
    const series = seriesByTicker.get(ticker);
    if (!series) throw new PortfolioBacktestError("MISSING_HISTORY", `Required history for ${ticker} was not supplied.`);
    pointsByTicker.set(ticker, pointsFor(series, input.requestedStart, input.requestedEnd));
  }
  const uniqueTickers = [...new Set(requestedTickers)];
  const firstDates = uniqueTickers.map((ticker) => [...pointsByTicker.get(ticker)!.keys()].sort()[0]);
  const lastDates = uniqueTickers.map((ticker) => {
    const dates = [...pointsByTicker.get(ticker)!.keys()].sort();
    return dates[dates.length - 1];
  });
  const sortedFirstDates = [...firstDates].sort();
  const effectiveStart = sortedFirstDates[sortedFirstDates.length - 1];
  const effectiveEnd = [...lastDates].sort()[0];
  if (effectiveStart > effectiveEnd) {
    throw new PortfolioBacktestError("INSUFFICIENT_HISTORY", "The portfolio and SPY do not share a completed EOD history range.");
  }
  const dates = [...new Set(uniqueTickers.flatMap((ticker) => [...pointsByTicker.get(ticker)!.keys()]))]
    .filter((date) => date >= effectiveStart && date <= effectiveEnd)
    .sort();
  const incompleteTicker = uniqueTickers.find((ticker) => dates.some((date) => !pointsByTicker.get(ticker)!.has(date)));
  if (incompleteTicker) {
    throw new PortfolioBacktestError("INSUFFICIENT_HISTORY", `Completed EOD history for ${incompleteTicker} is incomplete inside the shared portfolio range.`);
  }
  if (dates.length < 2) {
    throw new PortfolioBacktestError("INSUFFICIENT_HISTORY", "The portfolio and SPY require at least two common completed EOD sessions.");
  }
  const portfolio = runBasket({ dates, pointsByTicker, allocations: input.positions, startingCapital: input.startingCapital, dividendPolicy: input.dividendPolicy, rebalancePolicy: input.rebalancePolicy });
  const benchmark = runBasket({ dates, pointsByTicker, allocations: [{ ticker: PORTFOLIO_BACKTEST_BENCHMARK, basisPoints: TOTAL_ALLOCATION_BASIS_POINTS }], startingCapital: input.startingCapital, dividendPolicy: input.dividendPolicy, rebalancePolicy: input.rebalancePolicy });
  const metrics = metricsFor(portfolio.values, dates);
  const benchmarkMetrics = metricsFor(benchmark.values, dates);
  const endingValue = metrics.endingValue;
  const benchmarkEndingValue = benchmarkMetrics.endingValue;
  const finalDate = dates[dates.length - 1];
  const positionResults = portfolio.holdings.map((holding) => {
    const point = pointsByTicker.get(holding.ticker)!.get(finalDate)!;
    const endingValueForPosition = holding.shares * priceFor(point, input.dividendPolicy) + holding.cash;
    return {
      ticker: holding.ticker,
      displayName: seriesByTicker.get(holding.ticker)!.displayName,
      targetWeightPct: round(holding.basisPoints / 100),
      endingWeightPct: round(endingValueForPosition / endingValue * 100),
      endingValue: round(endingValueForPosition),
      cashDividendValue: round(holding.cashDividendValue),
    };
  });
  return {
    schemaVersion: PORTFOLIO_BACKTEST_SCHEMA_VERSION,
    benchmark: PORTFOLIO_BACKTEST_BENCHMARK,
    dataSource: { provider: "Yahoo Finance chart API", role: "US ETF and SPY completed EOD history" },
    requestedRange: { start: input.requestedStart || dates[0], end: input.requestedEnd || finalDate },
    effectiveRange: { start: dates[0], end: finalDate, sessionCount: dates.length },
    startingCapital: input.startingCapital,
    rebalancePolicy: input.rebalancePolicy,
    dividendPolicy: input.dividendPolicy,
    sourceAsOf: finalDate,
    curve: dates.map((date, index) => ({ date, portfolioValue: round(portfolio.values[index]), portfolioIndexed: round(portfolio.values[index] / input.startingCapital * 100), benchmarkValue: round(benchmark.values[index]), benchmarkIndexed: round(benchmark.values[index] / input.startingCapital * 100) })),
    metrics,
    benchmarkMetrics,
    endingValue,
    benchmarkEndingValue,
    excessCumulativeReturn: round(metrics.cumulativeReturn - benchmarkMetrics.cumulativeReturn),
    positions: positionResults,
    rebalancedOn: portfolio.rebalancedOn,
    excludedSessions: [],
    warnings: [],
    methodologyVersion: PORTFOLIO_BACKTEST_SCHEMA_VERSION,
  };
};
