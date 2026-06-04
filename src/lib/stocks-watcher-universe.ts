export type StocksWatcherAssetType = "Stock" | "ETF" | "ADR" | "Index";

export interface StocksWatcherUniverseStock {
  symbol: string;
  companyName: string;
  sector: string;
  type: StocksWatcherAssetType;
  fallbackPrice: number;
  fallbackChange: number;
  fallbackChangePercent: number;
}

export const STOCKS_WATCHER_UNIVERSE: StocksWatcherUniverseStock[] = [
  { symbol: "NVDA", companyName: "NVIDIA Corporation", sector: "Semiconductors", type: "Stock", fallbackPrice: 211.14, fallbackChange: -3.11, fallbackChangePercent: -1.45 },
  { symbol: "GOOG", companyName: "Alphabet Inc. Class C", sector: "Communication Services", type: "Stock", fallbackPrice: 376.43, fallbackChange: -9.69, fallbackChangePercent: -2.51 },
  { symbol: "GOOGL", companyName: "Alphabet Inc. Class A", sector: "Communication Services", type: "Stock", fallbackPrice: 380.34, fallbackChange: -9.79, fallbackChangePercent: -2.51 },
  { symbol: "AAPL", companyName: "Apple Inc.", sector: "Technology", type: "Stock", fallbackPrice: 312.06, fallbackChange: -0.45, fallbackChangePercent: -0.14 },
  { symbol: "MSFT", companyName: "Microsoft Corporation", sector: "Technology", type: "Stock", fallbackPrice: 450.24, fallbackChange: 23.25, fallbackChangePercent: 5.45 },
  { symbol: "AMZN", companyName: "Amazon.com Inc.", sector: "Consumer Discretionary", type: "Stock", fallbackPrice: 270.64, fallbackChange: -3.36, fallbackChangePercent: -1.23 },
  { symbol: "AVGO", companyName: "Broadcom Inc.", sector: "Semiconductors", type: "Stock", fallbackPrice: 446.77, fallbackChange: 20.19, fallbackChangePercent: 4.73 },
  { symbol: "TSM", companyName: "Taiwan Semiconductor Manufacturing Company", sector: "Semiconductors", type: "ADR", fallbackPrice: 418.45, fallbackChange: -6.41, fallbackChangePercent: -1.51 },
  { symbol: "TSLA", companyName: "Tesla Inc.", sector: "Consumer Discretionary", type: "Stock", fallbackPrice: 435.79, fallbackChange: -6.31, fallbackChangePercent: -1.43 },
  { symbol: "META", companyName: "Meta Platforms Inc.", sector: "Communication Services", type: "Stock", fallbackPrice: 632.51, fallbackChange: -2.78, fallbackChangePercent: -0.44 },
  { symbol: "MU", companyName: "Micron Technology Inc.", sector: "Semiconductors", type: "Stock", fallbackPrice: 971, fallbackChange: 47.48, fallbackChangePercent: 5.14 },
  { symbol: "BRK-B", companyName: "Berkshire Hathaway Inc.", sector: "Financials", type: "Stock", fallbackPrice: 474.48, fallbackChange: -2.94, fallbackChangePercent: -0.62 },
  { symbol: "LLY", companyName: "Eli Lilly and Company", sector: "Health Care", type: "Stock", fallbackPrice: 1105, fallbackChange: -21.8, fallbackChangePercent: -1.93 },
  { symbol: "WMT", companyName: "Walmart Inc.", sector: "Consumer Staples", type: "Stock", fallbackPrice: 115.75, fallbackChange: -3.15, fallbackChangePercent: -2.65 },
  { symbol: "AMD", companyName: "Advanced Micro Devices Inc.", sector: "Semiconductors", type: "Stock", fallbackPrice: 516.1, fallbackChange: -1.99, fallbackChangePercent: -0.38 },
  { symbol: "JPM", companyName: "JPMorgan Chase & Co.", sector: "Financials", type: "Stock", fallbackPrice: 299.31, fallbackChange: 2.58, fallbackChangePercent: 0.87 },
  { symbol: "V", companyName: "Visa Inc.", sector: "Financials", type: "Stock", fallbackPrice: 326.36, fallbackChange: 1.41, fallbackChangePercent: 0.43 },
  { symbol: "XOM", companyName: "Exxon Mobil Corporation", sector: "Energy", type: "Stock", fallbackPrice: 145.26, fallbackChange: -1.7, fallbackChangePercent: -1.16 },
  { symbol: "INTC", companyName: "Intel Corporation", sector: "Semiconductors", type: "Stock", fallbackPrice: 114.68, fallbackChange: -6.21, fallbackChangePercent: -5.14 },
  { symbol: "JNJ", companyName: "Johnson & Johnson", sector: "Health Care", type: "Stock", fallbackPrice: 225.33, fallbackChange: -5.47, fallbackChangePercent: -2.37 },
  { symbol: "ORCL", companyName: "Oracle Corporation", sector: "Technology", type: "Stock", fallbackPrice: 225.78, fallbackChange: 22.08, fallbackChangePercent: 10.84 },
  { symbol: "CSCO", companyName: "Cisco Systems Inc.", sector: "Technology", type: "Stock", fallbackPrice: 120.42, fallbackChange: 1.78, fallbackChangePercent: 1.5 },
  { symbol: "COST", companyName: "Costco Wholesale Corporation", sector: "Consumer Staples", type: "Stock", fallbackPrice: 956.32, fallbackChange: -38.88, fallbackChangePercent: -3.91 },
  { symbol: "MA", companyName: "Mastercard Incorporated", sector: "Financials", type: "Stock", fallbackPrice: 493.98, fallbackChange: 0.23, fallbackChangePercent: 0.05 },
  { symbol: "CAT", companyName: "Caterpillar Inc.", sector: "Industrials", type: "Stock", fallbackPrice: 875.87, fallbackChange: -11.8, fallbackChangePercent: -1.33 },
  { symbol: "LRCX", companyName: "Lam Research Corporation", sector: "Semiconductors", type: "Stock", fallbackPrice: 318.18, fallbackChange: 0.18, fallbackChangePercent: 0.06 },
  { symbol: "QCOM", companyName: "QUALCOMM Incorporated", sector: "Semiconductors", type: "Stock", fallbackPrice: 188.5, fallbackChange: 1.1, fallbackChangePercent: 0.59 },
  { symbol: "ASML", companyName: "ASML Holding N.V.", sector: "Semiconductors", type: "ADR", fallbackPrice: 1035.4, fallbackChange: 8.2, fallbackChangePercent: 0.8 },
  { symbol: "NFLX", companyName: "Netflix Inc.", sector: "Communication Services", type: "Stock", fallbackPrice: 1240.6, fallbackChange: -10.4, fallbackChangePercent: -0.83 },
  { symbol: "CRM", companyName: "Salesforce Inc.", sector: "Technology", type: "Stock", fallbackPrice: 289.2, fallbackChange: 3.4, fallbackChangePercent: 1.19 },
  { symbol: "ADBE", companyName: "Adobe Inc.", sector: "Technology", type: "Stock", fallbackPrice: 422.8, fallbackChange: -2.6, fallbackChangePercent: -0.61 },
  { symbol: "NOW", companyName: "ServiceNow Inc.", sector: "Technology", type: "Stock", fallbackPrice: 975.9, fallbackChange: 5.3, fallbackChangePercent: 0.55 },
  { symbol: "SHOP", companyName: "Shopify Inc.", sector: "Technology", type: "Stock", fallbackPrice: 118.4, fallbackChange: 1.7, fallbackChangePercent: 1.46 },
  { symbol: "PLTR", companyName: "Palantir Technologies Inc.", sector: "Technology", type: "Stock", fallbackPrice: 72.6, fallbackChange: -0.8, fallbackChangePercent: -1.09 },
  { symbol: "UBER", companyName: "Uber Technologies Inc.", sector: "Industrials", type: "Stock", fallbackPrice: 92.3, fallbackChange: 0.9, fallbackChangePercent: 0.98 },
  { symbol: "PFE", companyName: "Pfizer Inc.", sector: "Health Care", type: "Stock", fallbackPrice: 28.7, fallbackChange: -0.2, fallbackChangePercent: -0.69 },
  { symbol: "MRK", companyName: "Merck & Co. Inc.", sector: "Health Care", type: "Stock", fallbackPrice: 86.4, fallbackChange: 0.3, fallbackChangePercent: 0.35 },
  { symbol: "TMO", companyName: "Thermo Fisher Scientific Inc.", sector: "Health Care", type: "Stock", fallbackPrice: 485.5, fallbackChange: -4.1, fallbackChangePercent: -0.84 },
  { symbol: "HD", companyName: "The Home Depot Inc.", sector: "Consumer Discretionary", type: "Stock", fallbackPrice: 392.8, fallbackChange: 2.2, fallbackChangePercent: 0.56 },
  { symbol: "MCD", companyName: "McDonald's Corporation", sector: "Consumer Discretionary", type: "Stock", fallbackPrice: 291.7, fallbackChange: -1.4, fallbackChangePercent: -0.48 },
  { symbol: "KO", companyName: "The Coca-Cola Company", sector: "Consumer Staples", type: "Stock", fallbackPrice: 73.2, fallbackChange: 0.1, fallbackChangePercent: 0.14 },
  { symbol: "PEP", companyName: "PepsiCo Inc.", sector: "Consumer Staples", type: "Stock", fallbackPrice: 177.1, fallbackChange: -0.6, fallbackChangePercent: -0.34 },
  { symbol: "BAC", companyName: "Bank of America Corporation", sector: "Financials", type: "Stock", fallbackPrice: 45.8, fallbackChange: 0.4, fallbackChangePercent: 0.88 },
  { symbol: "GS", companyName: "The Goldman Sachs Group Inc.", sector: "Financials", type: "Stock", fallbackPrice: 625.6, fallbackChange: 6.8, fallbackChangePercent: 1.1 },
  { symbol: "CVX", companyName: "Chevron Corporation", sector: "Energy", type: "Stock", fallbackPrice: 158.4, fallbackChange: -0.9, fallbackChangePercent: -0.57 },
  { symbol: "SLB", companyName: "Schlumberger Limited", sector: "Energy", type: "Stock", fallbackPrice: 42.3, fallbackChange: 0.5, fallbackChangePercent: 1.2 },
  { symbol: "QQQI", companyName: "NEOS Nasdaq-100 High Income ETF", sector: "Income ETFs", type: "ETF", fallbackPrice: 50.42, fallbackChange: 0.18, fallbackChangePercent: 0.36 },
  { symbol: "FEPI", companyName: "REX FANG & Innovation Equity Premium Income ETF", sector: "Income ETFs", type: "ETF", fallbackPrice: 55.18, fallbackChange: -0.22, fallbackChangePercent: -0.4 },
  { symbol: "NTSX", companyName: "WisdomTree U.S. Efficient Core Fund", sector: "Asset Allocation", type: "ETF", fallbackPrice: 45.76, fallbackChange: 0.11, fallbackChangePercent: 0.24 },
  { symbol: "IREN", companyName: "IREN Limited", sector: "Crypto Infrastructure", type: "Stock", fallbackPrice: 64.05, fallbackChange: -3.79, fallbackChangePercent: -0.53 },
  { symbol: "SPX", companyName: "S&P 500 Index", sector: "Indexes", type: "Index", fallbackPrice: 7550, fallbackChange: 0, fallbackChangePercent: 0 },
];

export const STOCKS_WATCHER_SYMBOLS = STOCKS_WATCHER_UNIVERSE.map((stock) => stock.symbol);
export const STOCKS_WATCHER_QUOTE_SYMBOLS = STOCKS_WATCHER_SYMBOLS.slice(0, 12);

export const getStocksWatcherUniverseStock = (symbol: string) =>
  STOCKS_WATCHER_UNIVERSE.find((stock) => stock.symbol === symbol.trim().toUpperCase());

export const getStocksWatcherUniverseSectors = () =>
  Array.from(new Set(STOCKS_WATCHER_UNIVERSE.map((stock) => stock.sector))).sort();

export const getStocksWatcherUniverseTypes = () =>
  Array.from(new Set(STOCKS_WATCHER_UNIVERSE.map((stock) => stock.type))).sort();
