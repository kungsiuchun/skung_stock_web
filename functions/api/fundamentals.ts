import { normalizeYahooFundamentals } from "../../src/lib/fundamentals";

export async function onRequest(context: any) {
  try {
    const url = new URL(context.request.url);
    const symbol = url.searchParams.get("symbol")?.toUpperCase();
    if (!symbol) return new Response(JSON.stringify({ error: "Missing symbol param" }), { status: 400 });

    // 1. Get Cookie
    const fcRes = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const cookie = fcRes.headers.get("set-cookie") || "";

    // 2. Get Crumb
    const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": "Mozilla/5.0", "Cookie": cookie }
    });
    if (!crumbRes.ok) throw new Error("Failed to get crumb");
    const crumb = (await crumbRes.text()).trim();

    // 3. Fetch Data
    const modules = "summaryDetail,defaultKeyStatistics,financialData,price";
    const yfUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=${modules}&crumb=${crumb}`;
    
    const res = await fetch(yfUrl, { 
      headers: { "User-Agent": "Mozilla/5.0", "Cookie": cookie } 
    });
    if (!res.ok) throw new Error(`Yahoo Finance returned ${res.status}`);

    const data = await res.json() as any;
    const result = data?.quoteSummary?.result?.[0];
    
    if (!result) return new Response(JSON.stringify({ error: "No overview data found" }), { status: 404 });

    return new Response(JSON.stringify(normalizeYahooFundamentals(symbol, result)), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
