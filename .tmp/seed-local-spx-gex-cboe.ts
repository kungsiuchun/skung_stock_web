import { writeFile } from "node:fs/promises";
import { CboeSpxGexDataClient } from "../src/lib/spx-gex-cboe";
import { buildSpxGexHeatmapFromOptionChains } from "../src/lib/spx-gex-heatmap";

const generatedAt = "2026-06-24T14:00:00.000Z";

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

const client = new CboeSpxGexDataClient({
  now: () => new Date(generatedAt),
});
const quoteText = await client.getQuotes();
const frontChain = await client.getOptionsChain();
const selectedExpiries = frontChain.expiries.slice(0, 5);
const chains = await Promise.all(selectedExpiries.map((expiry) => client.getOptionsChain(expiry)));
const heatmap = buildSpxGexHeatmapFromOptionChains({
  generatedAt,
  quoteText,
  chains,
  selectedExpiries,
  maxStrikes: 20,
});

if (!heatmap.session) {
  throw new Error("Generated heatmap is missing session metadata.");
}

if (heatmap.cells.length >= 3) {
  heatmap.cells[0] = {
    ...heatmap.cells[0],
    netGex: null,
    callGex: null,
    putGex: null,
    callOpenInterest: null,
    putOpenInterest: null,
    callEffectiveOpenInterest: null,
    putEffectiveOpenInterest: null,
    callIv: null,
    putIv: null,
    gammaIv: null,
    model: undefined,
    missingReasons: ["local smoke sentinel missing"],
  };
  heatmap.cells[1] = { ...heatmap.cells[1], netGex: 0, callGex: 0, putGex: 0 };
  heatmap.cells[2] = { ...heatmap.cells[2], netGex: 0.4, callGex: 0.4, putGex: 0 };
}

const now = new Date().toISOString();
const sql = `
INSERT INTO spx_gex_intraday_snapshots (
  trading_date, snapshot_minute_et, snapshot_time_et, generated_at, ticker, spot,
  snapshot_json, created_at, updated_at
)
VALUES (
  ${sqlString(heatmap.session.tradingDate)},
  ${heatmap.session.snapshotMinuteEt},
  ${sqlString(heatmap.session.snapshotTimeEt)},
  ${sqlString(heatmap.generatedAt)},
  ${sqlString(heatmap.ticker)},
  ${heatmap.quote.last},
  ${sqlString(JSON.stringify(heatmap))},
  ${sqlString(now)},
  ${sqlString(now)}
)
ON CONFLICT(trading_date, snapshot_minute_et) DO UPDATE SET
  snapshot_time_et = excluded.snapshot_time_et,
  generated_at = excluded.generated_at,
  ticker = excluded.ticker,
  spot = excluded.spot,
  snapshot_json = excluded.snapshot_json,
  updated_at = excluded.updated_at;
`;

await writeFile(".tmp/seed-local-spx-gex-cboe.sql", sql.trimStart());
console.log(JSON.stringify({
  sqlPath: ".tmp/seed-local-spx-gex-cboe.sql",
  tradingDate: heatmap.session.tradingDate,
  snapshotMinuteEt: heatmap.session.snapshotMinuteEt,
  source: heatmap.source.note,
  selectedExpiries,
  strikes: heatmap.strikes.length,
  cells: heatmap.cells.length,
}, null, 2));
