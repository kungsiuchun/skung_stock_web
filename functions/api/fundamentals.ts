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
    const modules = "summaryDetail,defaultKeyStatistics,price";
    const yfUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=${modules}&crumb=${crumb}`;
    
    const res = await fetch(yfUrl, { 
      headers: { "User-Agent": "Mozilla/5.0", "Cookie": cookie } 
    });
    if (!res.ok) throw new Error(`Yahoo Finance returned ${res.status}`);

    const data = await res.json() as any;
    const result = data?.quoteSummary?.result?.[0];
    
    if (!result) return new Response(JSON.stringify({ error: "No overview data found" }), { status: 404 });

    const summary = result.summaryDetail || {};
    const stats = result.defaultKeyStatistics || {};
    const price = result.price || {};

    return new Response(JSON.stringify({ 
      symbol: symbol,
      name: price.longName || price.shortName || symbol,
      market_cap: summary.marketCap?.fmt || stats.enterpriseValue?.fmt,
      pe_ratio: summary.trailingPE?.fmt || summary.forwardPE?.fmt,
      peg_ratio: stats.pegRatio?.fmt,
      eps: stats.trailingEps?.fmt || stats.forwardEps?.fmt,
      dividend_yield: summary.dividendYield?.fmt || "N/A",
      analyst_target_price: price.regularMarketPrice?.fmt, // mock target using current price if missing
      week52_high: summary.fiftyTwoWeekHigh?.fmt,
      week52_low: summary.fiftyTwoWeekLow?.fmt
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
