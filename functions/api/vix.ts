import { isStrictFiniteNumber, isYahooDailyBarForming } from "../../src/lib/yahoo-finance-normalizer";
import { BoundedBodyError, fetchBoundedText } from "../../src/lib/bounded-body";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8" },
});

export async function onRequest(_context: any) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/^VIX?interval=1d&range=30d`;
    const { response: res, text } = await fetchBoundedText(url, { headers: { "User-Agent": "Mozilla/5.0" } }, 512 * 1024, 10_000);
    if (!res.ok) throw new Error(`Yahoo returned ${res.status}`);
    const data = JSON.parse(text);
    const result = data?.chart?.result?.[0], timestamps = result?.timestamp, closes = result?.indicators?.quote?.[0]?.close;
    if (!Array.isArray(timestamps) || !Array.isArray(closes) || timestamps.length !== closes.length ||
      (result?.meta?.symbol !== undefined && result.meta.symbol !== "^VIX")) throw new Error("Yahoo VIX daily-close data is malformed or mismatched.");
    // This line series uses observed closes, not candles. Never invent missing OHLC.
    const points: Array<{ index: number; date: string; close: number }> = [];
    let rejected = 0, formingExcluded = false, previousDate = "";
    const today = new Date().toISOString().slice(0, 10);
    for (let index = 0; index < timestamps.length; index++) {
      const timestamp = timestamps[index], close = closes[index];
      const time = isStrictFiniteNumber(timestamp) && timestamp > 0 ? new Date(timestamp * 1000) : null;
      const date = time && Number.isFinite(time.getTime()) ? time.toISOString().slice(0, 10) : null;
      if (!date || date <= previousDate || date > today || !isStrictFiniteNumber(close) || close <= 0) { rejected++; continue; }
      previousDate = date;
      if (isYahooDailyBarForming(data, date)) { formingExcluded = true; continue; }
      points.push({ index, date, close });
    }
    const latest = points.at(-1), previous = points.at(-2);
    const quality = { partial: rejected > 0 || formingExcluded, rejected_bar_count: rejected, last_valid_date: latest?.date || null };
    if (!latest || latest.index !== timestamps.length - 1) {
      return json({ error: "Latest Yahoo VIX bar is unavailable; older data was not used as current.", ...quality }, 502);
    }
    if (!previous || previous.index !== latest.index - 1) return json({ error: "The previous Yahoo VIX close is unavailable; change was not estimated.", ...quality }, 502);
    const changePct = ((latest.close - previous.close) / previous.close) * 100;

    return json({
      value: Number(latest.close.toFixed(2)),
      change_pct: Number(changePct.toFixed(2)),
      history: points.slice(-30).map(point => Number(point.close.toFixed(2))),
      source: "Yahoo Finance daily closes",
      asOf: latest.date,
      ...quality,
    });
  } catch (error: any) {
    return json({ error: error.message }, error instanceof BoundedBodyError && error.kind === "timeout" ? 504 : 502);
  }
}
