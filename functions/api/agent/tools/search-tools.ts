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

async function handleSearchMarketNews(args: Record<string, any>): Promise<Record<string, any>> {
  const query = (args.query as string || "").trim();
  const newsCount = Math.min(Math.max(Number(args.news_count || 10), 1), 20);
  if (!query) return { error: "No query provided" };

  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=${newsCount}`;
  console.log(`[Tool:search_market_news] Fetching ${url}`);

  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) return { error: `Yahoo Finance API returned ${res.status}` };

  const data = await res.json();
  const news = data.news || [];
  const quotes = data.quotes || [];

  const formattedNews = news.map((item: any) => ({
    title: item.title,
    publisher: item.publisher,
    publish_time: item.providerPublishTime
      ? new Date(item.providerPublishTime * 1000).toISOString()
      : null,
    link: item.link,
  }));

  const formattedQuotes = quotes.slice(0, 10).map((item: any) => ({
    symbol: item.symbol,
    shortname: item.shortname,
    longname: item.longname,
    exchange: item.exchange,
    quote_type: item.quoteType,
  }));

  return {
    query,
    count: formattedNews.length,
    news: formattedNews,
    related_quotes: formattedQuotes,
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

const searchMarketNewsTool: ToolDefinition = {
  name: "search_market_news",
  description:
    "Search Yahoo Finance for a free-text market theme, supply-chain topic, sector, company, or ticker. Returns recent news and related quotes. Use this for theme research such as AI semiconductor, CPO, robotics, power equipment, or innovative drug supply chains.",
  parameters: [
    {
      name: "query",
      type: "string",
      description: "Free-text market query, e.g. 'AI semiconductor supply chain', 'CPO optical interconnect', 'robotics actuator'.",
    },
    {
      name: "news_count",
      type: "integer",
      description: "Number of news results to request, from 1 to 20.",
      required: false,
      default: 10,
    },
  ],
  handler: handleSearchMarketNews,
  category: "search",
};

export const ALL_SEARCH_TOOLS: ToolDefinition[] = [
  searchStockNewsTool,
  searchMarketNewsTool,
];
