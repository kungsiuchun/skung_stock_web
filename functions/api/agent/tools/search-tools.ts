/**
 * Agent Framework — Search Tools
 * Mirrors the Python blueprint's search_tools.py.
 *
 * Tools:
 *   1. search_stock_news — Fetch latest news titles/publishers for a given stock
 */

import type { ToolDefinition } from "../types";

async function handleSearchStockNews(args: Record<string, any>): Promise<Record<string, any>> {
  const symbol = (args.stock_code as string || "").toUpperCase();
  if (!symbol) return { error: "No stock_code provided" };

  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}&newsCount=5`;
  console.log(`[Tool:search_stock_news] Fetching ${url}`);

  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) return { error: `Yahoo Finance API returned ${res.status}` };

  const data = await res.json();
  const news = data.news || [];
  
  if (news.length === 0) {
    return { symbol, news: [], message: "No recent news found." };
  }

  const formattedNews = news.map((item: any) => ({
    title: item.title,
    publisher: item.publisher,
    publish_time: new Date(item.providerPublishTime * 1000).toISOString(),
    link: item.link
  }));

  return {
    symbol,
    count: formattedNews.length,
    news: formattedNews,
  };
}

const searchStockNewsTool: ToolDefinition = {
  name: "search_stock_news",
  description:
    "Search for the latest news articles related to a specific stock. Returns news titles, publishers, and timestamps. Use this to find catalysts or fundamental events affecting the stock.",
  parameters: [
    {
      name: "stock_code",
      type: "string",
      description: "Stock ticker symbol, e.g. 'AAPL', 'NVDA'",
    },
  ],
  handler: handleSearchStockNews,
  category: "search",
};

export const ALL_SEARCH_TOOLS: ToolDefinition[] = [
  searchStockNewsTool,
];
