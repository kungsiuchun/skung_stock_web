import { normalizeYahooFundamentals } from "../../src/lib/fundamentals";
import { yahooAuthedJson, YahooDataError } from "../../src/lib/stocks-native-yahoo";
import { workspaceSymbol } from "../../src/lib/watcher-workspace";
import { BoundedBodyError } from "../../src/lib/bounded-body";
import { readFreshWatcherTool, watcherQuotaFailure } from "./stocks-intelligence-watcher";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function onRequest(context: any) {
  let symbol: string;
  try { symbol = workspaceSymbol(new URL(context.request.url).searchParams.get("symbol")); }
  catch { return json({ error: "Enter a valid stock ticker." }, 400); }
  try {
    if (context.env?.MARKET_CACHE_DB) {
      const result = await readFreshWatcherTool("get_stock_stats", { ticker: symbol }, context.env, crypto.randomUUID());
      const raw = result.raw as { quote: { asOf: string }; summary: { price?: { symbol?: string } } };
      if (!raw.summary?.price) return json({ error: "No overview data found" }, 404);
      if (raw.summary.price.symbol !== symbol) throw new YahooDataError("Yahoo fundamentals returned a mismatched stock.");
      const quotes = await readFreshWatcherTool("get_quotes", { tickers: symbol }, context.env, crypto.randomUUID());
      const quote = (quotes.raw as { quotes: Array<{ symbol: string; price: number; asOf: string }> }).quotes.find(row => row.symbol === symbol);
      if (!quote || !Number.isFinite(quote.price) || quote.price <= 0 || !Number.isFinite(Date.parse(quote.asOf))) throw new YahooDataError("Yahoo fundamentals quote is unavailable.");
      return json({ ...normalizeYahooFundamentals(symbol, raw.summary), current_price: String(quote.price), source: "native_yahoo", sourceAsOf: quote.asOf, fundamentalsAsOf: raw.quote.asOf, cache: result.cache, quoteCache: quotes.cache });
    }
    const modules = "summaryDetail,defaultKeyStatistics,financialData,price";
    const data = await yahooAuthedJson<any>(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`);
    const result = data?.quoteSummary?.result?.[0];
    if (!result) return json({ error: "No overview data found" }, 404);
    if (result.price?.symbol !== symbol) throw new YahooDataError("Yahoo fundamentals returned a mismatched stock.");
    return json(normalizeYahooFundamentals(symbol, result));
  } catch (error) {
    const quota = watcherQuotaFailure(error);
    if (quota) return json({ error: quota.error, quota: quota.quota }, quota.status);
    const status = error instanceof YahooDataError ? error.status : error instanceof BoundedBodyError && error.kind === "timeout" ? 504 : 502;
    return json({ error: error instanceof Error ? error.message : "Yahoo fundamentals unavailable." }, status);
  }
}
