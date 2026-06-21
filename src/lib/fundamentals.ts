type YahooFmtValue = {
  fmt?: string;
  raw?: unknown;
};

const formattedValue = (value: YahooFmtValue | undefined): string | null => {
  if (!value) return null;
  if (typeof value.fmt === "string" && value.fmt.trim()) return value.fmt;
  if (value.raw === null || value.raw === undefined) return null;
  return String(value.raw);
};

export interface NormalizedFundamentals {
  symbol: string;
  name: string;
  market_cap: string | null;
  pe_ratio: string | null;
  peg_ratio: string | null;
  eps: string | null;
  dividend_yield: string | null;
  analyst_target_price: string | null;
  current_price: string | null;
  week52_high: string | null;
  week52_low: string | null;
}

export function normalizeYahooFundamentals(symbol: string, result: any): NormalizedFundamentals {
  const summary = result?.summaryDetail || {};
  const stats = result?.defaultKeyStatistics || {};
  const financialData = result?.financialData || {};
  const price = result?.price || {};

  return {
    symbol,
    name: price.longName || price.shortName || symbol,
    market_cap: formattedValue(summary.marketCap) || formattedValue(stats.enterpriseValue),
    pe_ratio: formattedValue(summary.trailingPE) || formattedValue(summary.forwardPE),
    peg_ratio: formattedValue(stats.pegRatio),
    eps: formattedValue(stats.trailingEps) || formattedValue(stats.forwardEps),
    dividend_yield: formattedValue(summary.dividendYield) || "N/A",
    analyst_target_price: formattedValue(financialData.targetMeanPrice),
    current_price: formattedValue(price.regularMarketPrice),
    week52_high: formattedValue(summary.fiftyTwoWeekHigh),
    week52_low: formattedValue(summary.fiftyTwoWeekLow),
  };
}
