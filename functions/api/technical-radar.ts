import { TechnicalIndicators } from "./agent/strategies/indicators";
import {
  filterYahooFormingDailyBars,
  getYahooLatestBar,
  normalizeYahooChartResult,
  reportYahooChartValidation,
  yahooChartQuality,
} from "../../src/lib/yahoo-finance-normalizer";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8" },
});

export async function onRequest(context: any) {
  try {
    const url = new URL(context.request.url);
    const symbol = url.searchParams.get("symbol")?.toUpperCase();
    if (!symbol) return json({ error: "Missing symbol param" }, 400);

    const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=60d`;
    const res = await fetch(yfUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`Yahoo returned ${res.status}`);

    const data = await res.json();
    const normalized = normalizeYahooChartResult(data);
    reportYahooChartValidation(symbol, normalized);
    if (normalized.malformedPayload) return json({ error: "Yahoo technical chart data is unavailable.", ...yahooChartQuality(normalized) }, 502);

    const completed = filterYahooFormingDailyBars(data, normalized.bars);
    const latestBar = getYahooLatestBar(data, normalized);
    const quality = yahooChartQuality(normalized, completed.partialBarExcluded, completed.bars.at(-1)?.date || null);
    if (!latestBar || completed.bars.at(-1)?.index !== latestBar.index) {
      return json({ error: "Latest Yahoo technical bar is unavailable; older data was not used as current.", ...quality }, 502);
    }

    const closes = completed.bars.map((bar) => bar.close);
    if (closes.length < 30) return json({ error: "Not enough data to calculate indicators", ...quality }, 502);

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

    const high60 = Math.max(...closes);
    const low60 = Math.min(...closes);
    if (high60 === low60) {
      return json({ error: "價格區間為零，無法計算技術位置；技術摘要暫不可用。", ...quality }, 502);
    }
    const posPercent = (((currentPrice - low60) / (high60 - low60)) * 100);

    return json({
      symbol,
      ma_alignment: maAlignment,
      is_bullish: isBullish,
      is_bearish: isBearish,
      rsi_14: Number(rsi14.toFixed(2)),
      rsi_signal: rsiSignal,
      rsi_status: rsiStatus,
      position_percent: Number(posPercent.toFixed(1)),
      ma5: ma5 ? Number(ma5.toFixed(2)) : null,
      ma20: ma20 ? Number(ma20.toFixed(2)) : null,
      ...quality,
    });
  } catch (error: any) {
    return json({ error: error.message }, 500);
  }
}
