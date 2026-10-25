import { NativeStocksYahooClient } from "../../../src/lib/stocks-native-yahoo";
import { parseWorkspaceHistory, parseWorkspaceQuotes } from "../../../src/lib/watcher-workspace";

/** Compatibility snapshot: market data never spends a model attempt. */
export async function loadDataOnlyDashboardAgent(symbol: string) {
  const client = new NativeStocksYahooClient();
  const [quotes, prices] = await Promise.all([client.callTool("get_quotes", { tickers: symbol }), client.callTool("get_stock_history", { ticker: symbol, range: "1y", interval: "1d" })]);
  const quote = parseWorkspaceQuotes(quotes.raw).find(row => row.symbol === symbol);
  if (!quote) throw new Error("Quote is unavailable.");
  const history = parseWorkspaceHistory(prices.raw);
  return { success: true, steps: [
    { type: "tool_call", tool_name: "get_realtime_quote", tool_result: JSON.stringify({ price: quote.price, change_pct: quote.changePercent, source_as_of: quote.asOf }) },
    { type: "tool_call", tool_name: "get_daily_history", tool_result: JSON.stringify({ chart_data: history.bars.map(row => ({ date_iso: row.date, price: row.close, ...row })), rejected_bar_count: history.rejected, last_valid_date: history.bars.at(-1)?.date, partial: history.rejected > 0 }) },
  ] };
}
