import {
  validatePortfolioBacktestRequest,
  type PortfolioDividendPolicy,
  type PortfolioPositionInput,
  type PortfolioRebalancePolicy,
} from "./portfolio-backtest";

export interface PortfolioBacktestShareConfigV1 {
  version: 1;
  startingCapital: number;
  startDate: string;
  endDate: string;
  rebalancePolicy: PortfolioRebalancePolicy;
  dividendPolicy: PortfolioDividendPolicy;
  positions: PortfolioPositionInput[];
}

const ROUTE = "#/work/portfolio-backtest";
const ALLOWED_KEYS = new Set(["v", "capital", "start", "end", "rebalance", "dividend", "asset"]);
const SINGLE_VALUE_KEYS = ["v", "capital", "start", "end", "rebalance", "dividend"] as const;
const compareTickers = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const canonicalCapitalText = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) throw new Error("Shared starting capital is invalid.");
  return String(value);
};
const parseCanonicalCapital = (text: string) => {
  const value = Number(text);
  if (!text || !Number.isFinite(value) || value <= 0 || canonicalCapitalText(value) !== text) {
    throw new Error("Shared starting capital is invalid.");
  }
  return value;
};

const validate = (config: PortfolioBacktestShareConfigV1): PortfolioBacktestShareConfigV1 => {
  if (config.version !== 1) throw new Error("Unsupported shared backtest setup version.");
  if (!config.startDate || !config.endDate) throw new Error("Shared backtest setup requires a complete date range.");
  const normalized = {
    ...config,
    positions: config.positions.map((position) => ({
      ...position,
      ticker: position.ticker.trim().toUpperCase(),
    })),
  };
  validatePortfolioBacktestRequest({
    startingCapital: normalized.startingCapital,
    positions: normalized.positions,
    requestedStart: normalized.startDate,
    requestedEnd: normalized.endDate,
    rebalancePolicy: normalized.rebalancePolicy,
    dividendPolicy: normalized.dividendPolicy,
  });
  return normalized;
};

export const decodePortfolioBacktestShareConfig = (hash: string): PortfolioBacktestShareConfigV1 | null => {
  const question = hash.indexOf("?");
  if (question < 0 || hash.slice(question + 1).length === 0) return null;
  if (hash.slice(0, question) !== ROUTE) return null;

  const params = new URLSearchParams(hash.slice(question + 1));
  for (const key of params.keys()) {
    if (!ALLOWED_KEYS.has(key)) throw new Error(`Unsupported shared backtest parameter: ${key}.`);
  }
  for (const key of SINGLE_VALUE_KEYS) {
    if (params.getAll(key).length !== 1) throw new Error(`Shared backtest parameter ${key} must appear exactly once.`);
  }
  if (params.get("v") !== "1") throw new Error("Unsupported shared backtest setup version.");

  const capitalText = params.get("capital") || "";
  const assets = params.getAll("asset");
  const positions = assets.map((asset) => {
    const match = /^([A-Za-z0-9.^-]{1,16}):(\d+)$/.exec(asset);
    if (!match) throw new Error(`Shared ETF allocation is invalid: ${asset}.`);
    return { ticker: match[1].toUpperCase(), basisPoints: Number(match[2]) };
  });

  return validate({
    version: 1,
    startingCapital: parseCanonicalCapital(capitalText),
    startDate: params.get("start") || "",
    endDate: params.get("end") || "",
    rebalancePolicy: (params.get("rebalance") || "") as PortfolioRebalancePolicy,
    dividendPolicy: (params.get("dividend") || "") as PortfolioDividendPolicy,
    positions,
  });
};

export const encodePortfolioBacktestShareConfig = (input: PortfolioBacktestShareConfigV1): string => {
  const config = validate(input);
  const params = new URLSearchParams();
  params.set("v", "1");
  params.set("capital", canonicalCapitalText(config.startingCapital));
  params.set("start", config.startDate);
  params.set("end", config.endDate);
  params.set("rebalance", config.rebalancePolicy);
  params.set("dividend", config.dividendPolicy);
  for (const position of [...config.positions].sort((left, right) => compareTickers(left.ticker, right.ticker))) {
    params.append("asset", `${position.ticker}:${position.basisPoints}`);
  }
  return `${ROUTE}?${params.toString().replace(/%3A/g, ":")}`;
};
