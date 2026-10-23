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

export async function onRequest(_context: any) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/^VIX?interval=1d&range=30d`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`Yahoo returned ${res.status}`);

    const data = await res.json();
    const normalized = normalizeYahooChartResult(data);
    reportYahooChartValidation("^VIX", normalized);
    if (normalized.malformedPayload) return json({ error: "Yahoo VIX chart data is unavailable.", ...yahooChartQuality(normalized) }, 502);

    const completed = filterYahooFormingDailyBars(data, normalized.bars);
    const latestBar = getYahooLatestBar(data, normalized);
    const quality = yahooChartQuality(normalized, completed.partialBarExcluded, completed.bars.at(-1)?.date || null);
    if (!latestBar || completed.bars.at(-1)?.index !== latestBar.index) {
      return json({ error: "Latest Yahoo VIX bar is unavailable; older data was not used as current.", ...quality }, 502);
    }

    const validCloses = completed.bars.map((bar) => bar.close);
    if (validCloses.length < 2) return json({ error: "Not enough data to calculate change", ...quality }, 502);

    const currentValue = validCloses[validCloses.length - 1];
    const prevValue = validCloses[validCloses.length - 2];
    const changePct = ((currentValue - prevValue) / prevValue) * 100;

    return json({
      value: Number(currentValue.toFixed(2)),
      change_pct: Number(changePct.toFixed(2)),
      history: validCloses.slice(-30).map((value) => Number(value.toFixed(2))),
      ...quality,
    });
  } catch (error: any) {
    return json({ error: error.message }, 500);
  }
}
