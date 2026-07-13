import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTreasuryYieldCurveResponse,
  buildTreasuryYieldCurveResponseFromXml,
  parseTreasuryYieldCurveCsv,
  parseTreasuryYieldCurveXml,
  TREASURY_YIELD_CURVE_SOURCE_URL,
  TreasuryYieldCurveError,
} from "../src/lib/treasury-yield-curve";

const headers = ["Date", "1 Mo", "1.5 Mo", "2 Mo", "3 Mo", "4 Mo", "6 Mo", "1 Yr", "2 Yr", "3 Yr", "5 Yr", "7 Yr", "10 Yr", "20 Yr", "30 Yr"];
const row = (date: string, base: number) => [date, ...Array.from({ length: 14 }, (_, index) => (base + index / 100).toFixed(2))].join(",");
const csv = [
  headers.join(","),
  row("12/31/2025", 3.5),
  row("01/02/2026", 3.6),
  row("01/30/2026", 3.7),
  row("02/02/2026", 3.8),
  row("02/23/2026", 3.9),
  row("02/27/2026", 4.0),
  row("03/02/2026", 4.1),
].join("\n");

test("builds latest, week, month, and start-of-year Treasury curves from trading-day rows", () => {
  const response = buildTreasuryYieldCurveResponse(csv, "2026-03-02T22:00:00.000Z");

    assert.equal(response.asOfDate, "2026-03-02");
    assert.equal(response.sourceUrl, TREASURY_YIELD_CURVE_SOURCE_URL);
    assert.deepEqual(response.curves.map((curve) => [curve.key, curve.date]), [
    ["latest", "2026-03-02"],
    ["oneWeek", "2026-02-23"],
    ["oneMonth", "2026-02-02"],
    ["startOfYear", "2026-01-02"],
  ]);
  assert.equal(response.curves[0].points.length, 14);
  assert.equal(response.yieldRows[0].oneDayBps, 10);
  assert.equal(response.yieldRows[0].oneWeekBps, 20);
  assert.equal(response.yieldRows[0].oneMonthBps, 30);
  assert.equal(response.yieldRows[0].yearToDateBps, 50);
  assert.equal(response.spreadRows[0].label, "10Y - 2Y");
  assert.equal(response.source.url.includes("daily_treasury_yield_curve"), true);
});

test("uses the prior year's final business day for a January one-month comparison", () => {
  const januaryCsv = [headers.join(","), row("12/23/2025", 3.4), row("12/31/2025", 3.5), row("01/02/2026", 3.6), row("01/23/2026", 3.7), row("01/31/2026", 3.8)].join("\n");
  const response = buildTreasuryYieldCurveResponse(januaryCsv);
  assert.equal(response.curves.find((curve) => curve.key === "oneMonth")?.date, "2025-12-31");
});

test("fails loudly when Treasury changes a required maturity column", () => {
  const incomplete = [headers.filter((header) => header !== "30 Yr").join(","), row("03/02/2026", 4.1)].join("\n");
  assert.throws(() => parseTreasuryYieldCurveCsv(incomplete), TreasuryYieldCurveError);
});

test("fails loudly when a selected curve contains a missing maturity", () => {
  const incompleteRow = ["03/02/2026", ...Array.from({ length: 13 }, () => "4.00"), "N/A"].join(",");
  assert.throws(() => buildTreasuryYieldCurveResponse([headers.join(","), row("01/02/2026", 3.6), incompleteRow].join("\n")), TreasuryYieldCurveError);
});

test("normalizes the official Treasury XML shape without changing its source truth", () => {
  const fields = [
    ["BC_1MONTH", "3.71"], ["BC_1_5MONTH", "3.70"], ["BC_2MONTH", "3.69"], ["BC_3MONTH", "3.68"], ["BC_4MONTH", "3.67"], ["BC_6MONTH", "3.66"], ["BC_1YEAR", "3.65"], ["BC_2YEAR", "3.64"], ["BC_3YEAR", "3.63"], ["BC_5YEAR", "3.62"], ["BC_7YEAR", "3.61"], ["BC_10YEAR", "3.60"], ["BC_20YEAR", "3.59"], ["BC_30YEAR", "3.58"],
  ].map(([name, value]) => `<d:${name}>${value}</d:${name}>`).join("");
  const xml = `<feed><entry><content><m:properties><d:NEW_DATE>2026-03-02T00:00:00</d:NEW_DATE>${fields}</m:properties></content></entry></feed>`;
  assert.equal(parseTreasuryYieldCurveXml(xml)[0].yields["10Y"], 3.6);
  assert.throws(() => buildTreasuryYieldCurveResponseFromXml([xml]), TreasuryYieldCurveError);
});
