import { normalizeYahooFundamentals } from "../../src/lib/fundamentals";
import { yahooAuthedJson, YahooDataError } from "../../src/lib/stocks-native-yahoo";
import { workspaceSymbol } from "../../src/lib/watcher-workspace";
import { BoundedBodyError } from "../../src/lib/bounded-body";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function onRequest(context: any) {
  let symbol: string;
  try { symbol = workspaceSymbol(new URL(context.request.url).searchParams.get("symbol")); }
  catch { return json({ error: "Enter a valid stock ticker." }, 400); }
  try {
    const modules = "summaryDetail,defaultKeyStatistics,financialData,price";
    const data = await yahooAuthedJson<any>(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`);
    const result = data?.quoteSummary?.result?.[0];
    if (!result) return json({ error: "No overview data found" }, 404);
    if (result.price?.symbol !== symbol) throw new YahooDataError("Yahoo fundamentals returned a mismatched stock.");
    return json(normalizeYahooFundamentals(symbol, result));
  } catch (error) {
    const status = error instanceof YahooDataError ? error.status : error instanceof BoundedBodyError && error.kind === "timeout" ? 504 : 502;
    return json({ error: error instanceof Error ? error.message : "Yahoo fundamentals unavailable." }, status);
  }
}