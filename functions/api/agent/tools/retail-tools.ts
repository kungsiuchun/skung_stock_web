/**
 * Agent Framework — Retail Tools
 * Natively ports the Adanos Retail Sentiment Client from Python FinRobot
 */

import type { ToolDefinition } from "../types";

const PLATFORMS = [
  { key: "reddit", label: "Reddit", path: "/reddit/stocks/v1/compare", label_count: "Mentions", field_count: "mentions" },
  { key: "x", label: "X.com", path: "/x/stocks/v1/compare", label_count: "Mentions", field_count: "mentions" },
  { key: "polymarket", label: "Polymarket", path: "/polymarket/stocks/v1/compare", label_count: "Trades", field_count: "trade_count" },
] as const;

async function handleGetRetailSentiment(args: Record<string, any>, env?: any): Promise<Record<string, any>> {
  const ticker = (args.stock_code as string || "").toUpperCase();
  const days = args.days_back || 7;

  if (!ticker) return { error: "No stock_code provided" };
  
  const apiKey = env?.ADANOS_API_KEY;
  const results: any[] = [];
  let bullishPcts: number[] = [];

  if (apiKey) {
    for (const plat of PLATFORMS) {
      try {
        const url = `https://api.adanos.org${plat.path}?tickers=${ticker}&days=${days}`;
        const res = await fetch(url, { headers: { "X-API-Key": apiKey } });
        
        if (!res.ok) {
          console.warn(`[Adanos] Failed ${plat.label}: ${res.status}`);
          continue;
        }
        
        const payload = await res.json() as any;
        const stockData = (payload.stocks || []).find((s: any) => s.ticker === ticker);
        
        if (stockData) {
          const buzz = stockData.buzz_score || 0;
          const bullPct = stockData.bullish_pct !== undefined ? stockData.bullish_pct : null;
          const activity = stockData[plat.field_count] || 0;
          const trend = stockData.trend || "n/a";
          
          if (bullPct !== null) bullishPcts.push(bullPct);
          
          results.push({
            platform: plat.label,
            buzz_score: buzz,
            bullish_pct: bullPct,
            activity_type: plat.label_count,
            activity_count: activity,
            trend: trend
          });
        }
      } catch (err: any) {
        console.warn(`[Adanos] Error fetching ${plat.label}:`, err);
      }
    }
  } else {
    console.warn("[Adanos] No API Key - retail sentiment unavailable.");
  }

  const avgBullish = bullishPcts.length > 0 ? (bullishPcts.reduce((a,b)=>a+b,0)/bullishPcts.length).toFixed(1) : null;

  return {
    symbol: ticker,
    period_days: days,
    coverage: `${results.length}/${PLATFORMS.length}`,
    average_bullish_pct: avgBullish,
    sources: results,
    sourceType: results.length > 0 ? "retail" : "unavailable",
  };
}

const getRetailSentimentTool: ToolDefinition = {
  name: "get_retail_sentiment",
  description: "Fetch structured retail sentiment snapshots for a stock across Reddit, X.com, and Polymarket. Returns bullish percentages, buzz scores, and activity trends. Used to proxy retail behavior and expectations.",
  parameters: [
    {
      name: "stock_code",
      type: "string",
      description: "Stock ticker symbol, e.g. 'AAPL'",
    },
    {
      name: "days_back",
      type: "integer",
      description: "Number of days back to look for sentiment data (default 7).",
      required: false,
      default: 7,
    }
  ],
  handler: handleGetRetailSentiment,
  category: "market",
};

export const ALL_RETAIL_TOOLS: ToolDefinition[] = [
  getRetailSentimentTool,
];
