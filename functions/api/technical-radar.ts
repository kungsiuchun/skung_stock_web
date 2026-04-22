import { TechnicalIndicators } from "./agent/strategies/indicators";

export async function onRequest(context: any) {
  try {
    const url = new URL(context.request.url);
    const symbol = url.searchParams.get("symbol")?.toUpperCase();
    if (!symbol) return new Response(JSON.stringify({ error: "Missing symbol param" }), { status: 400 });

    const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=60d`;
    const res = await fetch(yfUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`Yahoo returned ${res.status}`);

    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) throw new Error("No data found");

    const quote = result.indicators?.quote?.[0] || {};
    const closes: number[] = [];
    (quote.close || []).forEach((c: any) => {
      if (c !== null) closes.push(c);
    });

    if (closes.length < 30) throw new Error("Not enough data to calculate indicators");

    const currentPrice = closes[closes.length - 1];
    const ma5 = TechnicalIndicators.SMA(closes, 5);
    const ma10 = TechnicalIndicators.SMA(closes, 10);
    const ma20 = TechnicalIndicators.SMA(closes, 20);

    let maAlignment = "Mixed";
    let isBullish = false;
    let isBearish = false;
    
    if (ma5 && ma10 && ma20) {
      if (currentPrice > ma5 && ma5 > ma10 && ma10 > ma20) {
        maAlignment = "多頭排列 (Strong Bullish)";
        isBullish = true;
      } else if (currentPrice < ma5 && ma5 < ma10 && ma10 < ma20) {
        maAlignment = "空頭排列 (Strong Bearish)";
        isBearish = true;
      } else if (ma5 > ma20) {
        maAlignment = "偏多 (Weak Bullish)";
        isBullish = true;
      } else if (ma5 < ma20) {
        maAlignment = "偏空 (Weak Bearish)";
        isBearish = true;
      }
    }

    const rsi14 = TechnicalIndicators.RSI(closes, 14);
    
    let rsiSignal = "中性 (Neutral)";
    let rsiStatus = "neutral";
    if (rsi14 > 70) {
      rsiSignal = "超買 (Overbought)";
      rsiStatus = "overbought";
    } else if (rsi14 < 30) {
      rsiSignal = "超賣 (Oversold)";
      rsiStatus = "oversold";
    }

    // Position in 60d range
    const high60 = Math.max(...closes);
    const low60 = Math.min(...closes);
    const posPercent = (((currentPrice - low60) / (high60 - low60)) * 100);

    return new Response(JSON.stringify({ 
      symbol,
      ma_alignment: maAlignment,
      is_bullish: isBullish,
      is_bearish: isBearish,
      rsi_14: Number(rsi14.toFixed(2)),
      rsi_signal: rsiSignal,
      rsi_status: rsiStatus,
      position_percent: Number(posPercent.toFixed(1)),
      ma5: ma5 ? Number(ma5.toFixed(2)) : null,
      ma20: ma20 ? Number(ma20.toFixed(2)) : null
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
