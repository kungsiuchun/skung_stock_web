import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MARKET_BREADTH_SECTORS, type PriceBar, type SectorUniverse } from "../src/lib/market-breadth";
import { isNyseTradingDay } from "../src/lib/nyse-calendar";
import {
  buildSectorRotationSnapshot,
  calculateSectorRotationSnapshotId,
  classifySectorRotationQuadrant,
  completedNyseWeekCloseDate,
  validateSectorRotationSnapshot,
  type SectorRotationSnapshot,
} from "../src/lib/sector-rotation";

const datesEnding = (end: string, count = 420) => {
  const cursor = new Date(`${end}T00:00:00.000Z`);
  const dates: string[] = [];
  while (dates.length < count) {
    const date = cursor.toISOString().slice(0, 10);
    if (isNyseTradingDay(date)) dates.unshift(date);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates;
};

const fixture = (priceAsOf = "2026-09-25", count = 420) => {
  const dates = datesEnding(priceAsOf, count);
  const sectorWeights = MARKET_BREADTH_SECTORS.map((sector, index) => ({
    ...sector, weightPct: index === 10 ? 10 : 9, holdingCount: 2,
  }));
  const holdings = sectorWeights.flatMap((sector, index) => [0.6, 0.4].map((ratio, member) => ({
    ticker: `TEST${index}-${member}`, name: `Test ${index}-${member}`, sector: sector.sector,
    sectorEtf: sector.etf, weightPct: ratio * sector.weightPct,
  })));
  const universe: SectorUniverse = {
    holdingsAsOf: "2026-09-24", sectorWeights, holdings, universeCount: holdings.length, totalWeightPct: 100,
  };
  const priceSeries = new Map<string, PriceBar[]>([
    ["SPY", dates.map((date) => ({ date, close: 100 }))],
    ...MARKET_BREADTH_SECTORS.map((sector) => [sector.etf, dates.map((date) => ({ date, close: 50 }))] as [string, PriceBar[]]),
    ...holdings.map((holding) => [holding.ticker, dates.map((date) => ({ date, close: 20 }))] as [string, PriceBar[]]),
  ]);
  const input = { universe, priceSeries, priceAsOf, generatedAt: "2026-09-26T12:00:00.000Z", sourceSnapshotId: "market-breadth-v1-fixture" };
  return { input, dates, build: () => buildSectorRotationSnapshot(input) };
};
const withValidIdentity = (snapshot: SectorRotationSnapshot) => ({ ...snapshot, snapshotId: calculateSectorRotationSnapshotId(snapshot) });

describe("SPY sector rotation calculations", () => {
  it("keeps proportional split-adjusted series neutral with zero relative returns", () => {
    const { input, build } = fixture();
    for (const bars of input.priceSeries.values()) bars.forEach((bar, index) => { bar.close *= 1 + index / 1000; });
    const snapshot = build();
    assert.equal(snapshot.sectors.length, 11);
    assert.equal(snapshot.coverage.availableSectorRotations, 11);
    for (const sector of snapshot.sectors) {
      assert.equal(sector.rotation.quadrant, "Neutral");
      assert.equal(sector.rotation.rsRatio, 100);
      assert.equal(sector.rotation.rsMomentum, 100);
      assert.equal(sector.rotation.trail.length, 12);
      assert.deepEqual(Object.values(sector.relativeToSpy), [0, 0, 0, 0]);
      assert.equal(sector.performance.twelveMonths.length, 253);
      assert.equal(sector.performance.twelveMonths[0].relativeValue, 100);
      assert.equal(sector.performance.twelveMonths[252].relativeValue, 100);
      assert.equal(sector.breadth.sma50.pct, 100);
      assert.equal(sector.breadth.sma200.pct, 100);
    }
    assert.equal(snapshot.model.proprietaryJdkModel, false);
    assert.match(snapshot.model.pricePolicy, /dividends excluded/);
    assert.equal(validateSectorRotationSnapshot(JSON.parse(JSON.stringify(snapshot))).snapshotId, snapshot.snapshotId);
  });

  it("uses exact 21/63/126/252 shared SPY sessions for price and relative returns", () => {
    const { input, build, dates } = fixture();
    const stock = input.priceSeries.get("TEST0-0")!;
    stock[stock.length - 22].close = 10;
    stock[stock.length - 64].close = 8;
    stock[stock.length - 127].close = 5;
    stock[stock.length - 253].close = 4;
    const spy = input.priceSeries.get("SPY")!;
    spy[spy.length - 1].close = 110;
    const snapshot = build();
    const holding = snapshot.holdings[0];
    assert.deepEqual(holding.returns, { oneMonth: 100, threeMonths: 150, sixMonths: 300, twelveMonths: 400 });
    assert.equal(snapshot.benchmark.returns.oneMonth, 10);
    assert.equal(holding.relativeToSpy.oneMonth, 81.818182);
    assert.equal(holding.relativeToSector.oneMonth, 100);
    assert.equal(holding.sectorWeightPct, 60);
    assert.equal(holding.spyWeightPct, 5.3999999999999995);
    assert.equal(holding.contributionProxy.oneMonth, 60);
    assert.equal(snapshot.sectors[0].performance.oneMonth[0].date, dates[dates.length - 22]);
  });

  it("measures carrying stocks with current sector weights rather than return rank", () => {
    const { input, build } = fixture();
    input.priceSeries.get("TEST0-0")![419].close = 22;
    input.priceSeries.get("TEST0-1")![419].close = 24;
    input.priceSeries.get("SPY")![419].close = 102;
    input.priceSeries.get("XLC")![419].close = 52.5;
    const snapshot = build();
    const [first, second] = snapshot.holdings;
    assert.equal(first.returns.oneMonth, 10);
    assert.equal(second.returns.oneMonth, 20);
    assert.equal(first.contributionProxy.oneMonth, 6);
    assert.equal(second.contributionProxy.oneMonth, 8);
    assert.equal(first.relativeToSpy.oneMonth, 7.843137);
    assert.equal(first.relativeToSector.oneMonth, 4.761905);
    assert.deepEqual(snapshot.sectors[0].breadth.positiveReturn.oneMonth, { above: 2, eligible: 2, total: 2, pct: 100 });
    assert.equal(snapshot.sectors[0].breadth.outperformingSpy.oneMonth.pct, 100);
  });

  it("normalizes exact constituent weights when the published sector aggregate is rounded", () => {
    const { input, build } = fixture();
    const oldWeight = input.universe.holdings[0].weightPct;
    const delta = 0.000048;
    input.universe.holdings[0].weightPct = oldWeight + delta;
    input.universe.holdings[2].weightPct -= delta;
    // Public source aggregates use four decimal places; holding weights use six.
    input.priceSeries.get("TEST0-0")![419].close = 22;
    const snapshot = build();
    const firstSector = snapshot.holdings.filter((holding) => holding.sector === snapshot.sectors[0].sector);
    assert.equal(snapshot.sectors[0].weightPct, 9);
    assert.equal(firstSector[0].sectorWeightPct, 60.000213);
    assert.equal(firstSector[1].sectorWeightPct, 39.999787);
    assert.equal(firstSector.reduce((sum, holding) => sum + holding.sectorWeightPct, 0), 100);
    assert.equal(firstSector[0].contributionProxy.oneMonth, 6.000021);
    const invalid = fixture();
    invalid.input.universe.holdings[0].weightPct += 0.00006;
    assert.throws(invalid.build, /sector weights/);
  });

  it("does not count missing constituent sessions as zero or shorten the window", () => {
    const { input, build } = fixture();
    const stock = input.priceSeries.get("TEST0-0")!;
    stock.splice(410, 1);
    const snapshot = build();
    assert.deepEqual(Object.values(snapshot.holdings[0].returns), [null, null, null, null]);
    assert.equal(snapshot.holdings[0].contributionProxy.oneMonth, null);
    assert.equal(snapshot.holdings[0].aboveSma50, null);
    assert.deepEqual(snapshot.sectors[0].breadth.positiveReturn.oneMonth, { above: 0, eligible: 1, total: 2, pct: 0 });
    assert.equal(snapshot.coverage.eligibleByWindow.oneMonth, 21);
    assert.equal(snapshot.coverage.currentPriceCount, 22);
  });

  it("keeps short history unavailable and permits dated holdings older than prices", () => {
    const { input, build } = fixture();
    input.priceSeries.set("TEST0-0", input.priceSeries.get("TEST0-0")!.slice(-100));
    const snapshot = build();
    assert.equal(snapshot.holdings[0].returns.oneMonth, 0);
    assert.equal(snapshot.holdings[0].returns.threeMonths, 0);
    assert.equal(snapshot.holdings[0].returns.sixMonths, null);
    assert.equal(snapshot.holdings[0].returns.twelveMonths, null);
    assert.equal(snapshot.holdings[0].aboveSma200, null);
    assert.equal(snapshot.holdingsAsOf, "2026-09-24");
    assert.equal(snapshot.priceAsOf, "2026-09-25");
    assert.equal(snapshot.coverage.eligibleByWindow.twelveMonths, 21);
  });

  it("samples only completed NYSE weeks, including Good Friday and cross-year holidays", () => {
    assert.equal(completedNyseWeekCloseDate("2026-09-23"), "2026-09-18");
    assert.equal(completedNyseWeekCloseDate("2026-09-24"), "2026-09-18");
    assert.equal(completedNyseWeekCloseDate("2026-09-25"), "2026-09-25");
    assert.equal(completedNyseWeekCloseDate("2026-04-02"), "2026-04-02");
    assert.equal(completedNyseWeekCloseDate("2026-04-03"), "2026-04-02");
    assert.equal(completedNyseWeekCloseDate("2026-12-24"), "2026-12-24");
    const holiday = fixture("2026-04-02").build().sectors[0].rotation;
    assert.equal(holiday.asOf, "2026-04-02");
    assert.equal(holiday.trail[holiday.trail.length - 2].date, "2026-03-27");
    const midweek = fixture("2026-09-23").build().sectors[0].rotation;
    assert.equal(midweek.asOf, "2026-09-18");
  });

  it("breaks the rotation tail on weekly gaps instead of joining disconnected points", () => {
    const { input, build } = fixture();
    input.priceSeries.set("XLC", input.priceSeries.get("XLC")!.filter((bar) => bar.date !== "2026-09-18"));
    const snapshot = build();
    assert.equal(snapshot.sectors[0].rotation.quadrant, "Unavailable");
    assert.deepEqual(snapshot.sectors[0].rotation.trail, []);
    assert.equal(snapshot.sectors[0].returns.oneMonth, null);
    assert.deepEqual(snapshot.sectors[0].performance.oneMonth, []);
    assert.equal(snapshot.coverage.availableSectorRotations, 10);
  });

  it("requires 13 consecutive completed weeks and 253 sessions for twelve-month returns", () => {
    const snapshot = fixture("2026-09-25", 55).build();
    assert.equal(snapshot.sectors[0].rotation.quadrant, "Unavailable");
    assert.equal(snapshot.sectors[0].returns.oneMonth, 0);
    assert.equal(snapshot.sectors[0].returns.threeMonths, null);
    assert.deepEqual(snapshot.sectors[0].performance.twelveMonths, []);
  });

  it("defines all four quadrants and treats either neutral axis explicitly", () => {
    assert.equal(classifySectorRotationQuadrant(101, 101), "Leading");
    assert.equal(classifySectorRotationQuadrant(101, 99), "Weakening");
    assert.equal(classifySectorRotationQuadrant(99, 99), "Lagging");
    assert.equal(classifySectorRotationQuadrant(99, 101), "Improving");
    assert.equal(classifySectorRotationQuadrant(100, 101), "Neutral");
    assert.equal(classifySectorRotationQuadrant(99, 100), "Neutral");
    assert.equal(classifySectorRotationQuadrant(100.0000005, 101), "Neutral");
    assert.equal(classifySectorRotationQuadrant(null, null), "Unavailable");
    assert.throws(() => classifySectorRotationQuadrant(Number.NaN, 101), /Invalid/);
  });

  it("calculates the declared 10-week ratio and 4-week momentum for every quadrant", () => {
    const paths = [
      { values: [...Array(10).fill(1), 1.1, 1.3, 1.8], quadrant: "Leading" },
      { values: Array.from({ length: 13 }, (_, index) => index + 1), quadrant: "Weakening" },
      { values: Array.from({ length: 13 }, (_, index) => 13 - index), quadrant: "Lagging" },
      { values: [...Array(10).fill(1), 0.5, 0.6, 0.8], quadrant: "Improving" },
    ];
    const { input, build, dates } = fixture();
    const completedDates = dates.filter((date) => completedNyseWeekCloseDate(date) === date).slice(-13);
    for (let sector = 0; sector < paths.length; sector += 1) {
      const history = input.priceSeries.get(MARKET_BREADTH_SECTORS[sector].etf)!;
      paths[sector].values.forEach((value, index) => { history.find((bar) => bar.date === completedDates[index])!.close = 100 * value; });
    }
    const snapshot = build();
    paths.forEach(({ values, quadrant }, index) => {
      const mean = (rows: number[]) => rows.reduce((sum, value) => sum + value, 0) / rows.length;
      const ratios = [9, 10, 11, 12].map((end) => 100 * values[end] / mean(values.slice(end - 9, end + 1)));
      const expectedRatio = Math.round(ratios[3] * 1_000_000) / 1_000_000;
      const expectedMomentum = Math.round(100 * ratios[3] / mean(ratios) * 1_000_000) / 1_000_000;
      assert.equal(snapshot.sectors[index].rotation.rsRatio, expectedRatio);
      assert.equal(snapshot.sectors[index].rotation.rsMomentum, expectedMomentum);
      assert.equal(snapshot.sectors[index].rotation.quadrant, quadrant);
    });
  });

  it("accepts already split-adjusted prices without inferring or applying a split again", () => {
    const { input, build } = fixture();
    input.priceSeries.get("TEST0-0")!.forEach((bar) => { bar.close = 50; });
    const snapshot = build();
    assert.equal(snapshot.holdings[0].returns.oneMonth, 0);
    assert.equal(snapshot.holdings[0].aboveSma50, false);
    assert.equal(snapshot.holdings[0].aboveSma200, false);
    assert.match(snapshot.model.pricePolicy, /Split-adjusted/);
  });

  it("fails invalid input bars, duplicate membership, missing SPY sessions, and missing current SPY", () => {
    for (const mutate of [
      (input: ReturnType<typeof fixture>["input"]) => { input.priceSeries.get("TEST0-0")![0].close = Number.NaN; },
      (input: ReturnType<typeof fixture>["input"]) => { input.priceSeries.get("TEST0-0")!.push({ date: "2026-09-26", close: 10 }); },
      (input: ReturnType<typeof fixture>["input"]) => { input.priceSeries.get("TEST0-0")!.push(input.priceSeries.get("TEST0-0")![0]); },
      (input: ReturnType<typeof fixture>["input"]) => { input.universe.holdings[1].ticker = input.universe.holdings[0].ticker; },
      (input: ReturnType<typeof fixture>["input"]) => { input.priceSeries.get("SPY")!.splice(410, 1); },
      (input: ReturnType<typeof fixture>["input"]) => { input.priceSeries.get("SPY")!.pop(); },
    ]) {
      const { input, build } = fixture(); mutate(input); assert.throws(build);
    }
  });
});

describe("sector rotation executable validation", () => {
  it("publishes only the latest twelve completed weeks and rejects longer public trails", () => {
    const { build, dates } = fixture();
    const snapshot = build();
    const completedDates = dates.filter((date) => completedNyseWeekCloseDate(date) === date);
    for (const sector of snapshot.sectors) {
      assert.deepEqual(sector.rotation.trail.map((point) => point.date), completedDates.slice(-12));
    }
    const oversized = structuredClone(snapshot);
    oversized.sectors[0].rotation.trail.unshift({
      date: completedDates[completedDates.length - 13], rsRatio: 100, rsMomentum: 100, quadrant: "Neutral",
    });
    assert.throws(() => validateSectorRotationSnapshot(withValidIdentity(oversized)), /invalid rotation state/);
  });

  it("rejects malformed values even with a freshly calculated content identity", () => {
    const snapshot = fixture().build();
    const mutations: Array<(copy: SectorRotationSnapshot) => void> = [
      (copy) => { copy.sectors[0].returns.oneMonth = Number.POSITIVE_INFINITY; },
      (copy) => { copy.sectors[0].rotation.rsRatio = Number.NaN; },
      (copy) => { copy.holdings[1].ticker = copy.holdings[0].ticker; },
      (copy) => { copy.holdings[0].sector = "Unknown"; },
      (copy) => { copy.sectors[0].breadth.sma200.eligible = 3; },
      (copy) => { copy.sectors[0].breadth.positiveReturn.oneMonth.pct = 50; },
      (copy) => { copy.holdings[0].contributionProxy.oneMonth = 1; },
      (copy) => { copy.coverage.eligibleByWindow.oneMonth -= 1; },
      (copy) => { copy.sectors[0].rotation.trail.push(copy.sectors[0].rotation.trail[0]); },
      (copy) => { copy.sectors[0].performance.oneMonth[1].date = copy.sectors[0].performance.oneMonth[0].date; },
      (copy) => { copy.sectors[0].performance.oneMonth[0].date = "2026-08-20"; },
      (copy) => { copy.sectors[0].performance.oneMonth.push(copy.sectors[0].performance.oneMonth[0]); },
      (copy) => { copy.sourceSnapshotId = ""; },
      (copy) => { copy.sectors[0].rotation.trail[0].rsMomentum = Number.POSITIVE_INFINITY; },
    ];
    for (const mutate of mutations) {
      const copy = structuredClone(snapshot); mutate(copy);
      assert.throws(() => validateSectorRotationSnapshot(withValidIdentity(copy)));
    }
    const changed = structuredClone(snapshot); changed.generatedAt = "2026-09-27T12:00:00.000Z";
    assert.throws(() => validateSectorRotationSnapshot(changed), /payload identity/);
    assert.throws(() => validateSectorRotationSnapshot(null));
  });

  it("validates immutable snapshots delivered with independent API status and freshness", () => {
    const snapshot = fixture().build();
    const delivered = { ...snapshot, status: "READY", freshness: { status: "STALE", reason: "LATEST_REFRESH_FAILED" } };
    assert.equal(validateSectorRotationSnapshot(delivered).snapshotId, snapshot.snapshotId);
    const unknownExtra = { ...snapshot, unknownExtra: "changes the immutable content" };
    assert.throws(() => validateSectorRotationSnapshot(unknownExtra), /payload identity/);
  });
});
