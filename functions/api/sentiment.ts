import { ALL_RETAIL_TOOLS } from "./agent/tools/retail-tools";
import { ALL_STOCK_TOOLS } from "./agent/tools/stock-tools";
import { TechnicalIndicators } from "./agent/strategies/indicators";
import {
  deriveMarketMoodProxy,
  normalizeRetailSentiment,
  unavailableSentiment,
  type SentimentApiResult,
} from "../../src/lib/market-sentiment";

const retailTool = ALL_RETAIL_TOOLS.find((tool) => tool.name === "get_retail_sentiment");
const quoteTool = ALL_STOCK_TOOLS.find((tool) => tool.name === "get_realtime_quote");
const optionsTool = ALL_STOCK_TOOLS.find((tool) => tool.name === "get_options_chain");

function jsonResponse(payload: SentimentApiResult | Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function finiteNumber(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function deriveCallPutRatio(optionsPayload: any): number | null {
  if (!optionsPayload || optionsPayload.error) return null;

  const calls = Array.isArray(optionsPayload.calls) ? optionsPayload.calls : [];
  const puts = Array.isArray(optionsPayload.puts) ? optionsPayload.puts : [];
  const callOi = calls.reduce((sum: number, leg: any) => sum + (finiteNumber(leg.open_interest) ?? finiteNumber(leg.volume) ?? 0), 0);
  const putOi = puts.reduce((sum: number, leg: any) => sum + (finiteNumber(leg.open_interest) ?? finiteNumber(leg.volume) ?? 0), 0);

  if (callOi <= 0 || putOi <= 0) return null;
  return Number((callOi / putOi).toFixed(2));
}

async function fetchTechnical(symbol: string) {
  const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=60d`;
  const res = await fetch(yfUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo technical chart returned ${res.status}`);

  const data = await res.json() as any;
  const result = data.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0] || {};
  const closes: number[] = (quote.close || []).filter((close: unknown) => Number.isFinite(Number(close))).map(Number);

  if (closes.length < 30) throw new Error("Not enough data to calculate technical proxy");

  const currentPrice = closes[closes.length - 1];
  const ma5 = TechnicalIndicators.SMA(closes, 5);
  const ma10 = TechnicalIndicators.SMA(closes, 10);
  const ma20 = TechnicalIndicators.SMA(closes, 20);
  const rsi14 = TechnicalIndicators.RSI(closes, 14);
  const high60 = Math.max(...closes);
  const low60 = Math.min(...closes);
  const positionPercent = high60 === low60 ? 50 : ((currentPrice - low60) / (high60 - low60)) * 100;

  return {
    is_bullish: Boolean(currentPrice > ma5 && ma5 > ma10 && ma10 > ma20) || Boolean(ma5 > ma20),
    is_bearish: Boolean(currentPrice < ma5 && ma5 < ma10 && ma10 < ma20) || Boolean(ma5 < ma20),
    rsi_14: Number(rsi14.toFixed(2)),
    position_percent: Number(positionPercent.toFixed(1)),
  };
}

async function fetchNews(symbol: string) {
  const fetchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}&newsCount=6`;
  const res = await fetch(fetchUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo news returned ${res.status}`);

  const data = await res.json() as any;
  return (Array.isArray(data.news) ? data.news : []).map((item: any) => ({
    title: String(item.title || ""),
  }));
}

async function tryRetailSentiment(symbol: string, env: any): Promise<SentimentApiResult> {
  if (!retailTool) {
    return unavailableSentiment(symbol, ["Retail sentiment tool is not registered."]);
  }

  try {
    const retailPayload = await retailTool.handler({ stock_code: symbol, days_back: 7 }, env);
    return normalizeRetailSentiment(retailPayload);
  } catch (error: any) {
    return unavailableSentiment(symbol, [`Retail sentiment failed: ${error?.message || "unknown error"}`]);
  }
}

export async function onRequest(context: any) {
  const url = new URL(context.request.url);
  const symbol = url.searchParams.get("symbol")?.trim().toUpperCase();

  if (!symbol) {
    return jsonResponse({ error: "Missing symbol param" }, 400);
  }

  const retail = await tryRetailSentiment(symbol, context.env);
  if (retail.sourceType === "retail") {
    return jsonResponse(retail);
  }

  const warnings = [...retail.warnings];

  const quotePromise = quoteTool
    ? quoteTool.handler({ stock_code: symbol }).catch((error: any) => {
        warnings.push(`Quote unavailable: ${error?.message || "unknown error"}`);
        return null;
      })
    : Promise.resolve(null);

  const optionsPromise = optionsTool
    ? optionsTool.handler({ stock_code: symbol }).catch((error: any) => {
        warnings.push(`Options unavailable: ${error?.message || "unknown error"}`);
        return null;
      })
    : Promise.resolve(null);

  const technicalPromise = fetchTechnical(symbol).catch((error: any) => {
    warnings.push(`Technical proxy unavailable: ${error?.message || "unknown error"}`);
    return null;
  });

  const newsPromise = fetchNews(symbol).catch((error: any) => {
    warnings.push(`News keyword proxy unavailable: ${error?.message || "unknown error"}`);
    return [];
  });

  const [quote, optionsPayload, technical, news] = await Promise.all([
    quotePromise,
    optionsPromise,
    technicalPromise,
    newsPromise,
  ]);

  const proxy = deriveMarketMoodProxy({
    symbol,
    quote: quote ? { change_pct: (quote as any).change_pct } : null,
    options: { callPutRatio: deriveCallPutRatio(optionsPayload) },
    technical,
    news,
  });

  return jsonResponse({
    ...proxy,
    warnings: [...warnings, ...proxy.warnings],
    generatedAt: new Date().toISOString(),
  });
}
