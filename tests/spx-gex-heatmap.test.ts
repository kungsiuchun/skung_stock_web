import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSpxGexHeatmapFromOptionChains,
  buildSpxGexHeatmapFromToolText,
  calculateBlackScholesExposures,
  classifySpxGexStructureTags,
  generateAndStoreSpxGexHeatmap,
  getSpxGexGenerationStatus,
  listSpxGexHeatmapDates,
  listSpxGexHeatmapSessions,
  readSpxGexHeatmap,
  upsertSpxGexHeatmap,
  type SpxGexDataClient,
  type SpxGexHeatmapModel,
  type SpxGexOptionChain,
  type SpxGexStrikeProfile,
} from "../src/lib/spx-gex-heatmap";
import { onRequest as getSpxGexHeatmapApi } from "../functions/api/spx-gex-heatmap";

describe("SPX GEX intraday generation gate", () => {
  it("allows every 15-minute slot from 09:15 through 16:00 ET on a trading day", () => {
    const open = getSpxGexGenerationStatus(new Date("2026-05-27T13:15:00Z"));
    const mid = getSpxGexGenerationStatus(new Date("2026-05-27T17:30:00Z"));
    const close = getSpxGexGenerationStatus(new Date("2026-05-27T20:00:00Z"));
    const outside = getSpxGexGenerationStatus(new Date("2026-05-27T20:15:00Z"));

    assert.equal(open.etDateKey, "2026-05-27");
    assert.equal(open.snapshotMinuteEt, 9 * 60 + 15);
    assert.equal(open.isGenerationWindow, true);
    assert.equal(mid.isGenerationWindow, true);
    assert.equal(close.snapshotTimeEt, "16:00");
    assert.equal(close.isGenerationWindow, true);
    assert.equal(outside.isGenerationWindow, false);
  });

  it("blocks generation on a full NYSE market holiday", () => {
    const status = getSpxGexGenerationStatus(new Date("2026-05-25T13:15:00Z"));

    assert.equal(status.etDateKey, "2026-05-25");
    assert.equal(status.isMarketOpenDay, false);
    assert.equal(status.isGenerationWindow, false);
    assert.equal(status.skipReason, "us_market_holiday");
  });
});

describe("SPX GEX Black-Scholes exposure model", () => {
  it("produces finite GEX, DEX, VEX, and CEX values even at the 0DTE floor", () => {
    const exposure = calculateBlackScholesExposures({
      spot: 6000,
      strike: 6000,
      yearsToExpiry: 0,
      callOpenInterest: 10_000,
      putOpenInterest: 12_000,
      callIv: 0.18,
      putIv: 0.2,
    });

    assert.equal(Number.isFinite(exposure.netGex), true);
    assert.equal(Number.isFinite(exposure.netDex), true);
    assert.equal(Number.isFinite(exposure.netVex), true);
    assert.equal(Number.isFinite(exposure.netCex), true);
    assert.ok(exposure.callGex > 0);
    assert.ok(exposure.putGex < 0);
  });
});

const expiries = ["2026-05-27", "2026-05-28", "2026-05-29", "2026-06-01", "2026-06-02"];
const strikes = [5900, 5950, 6000, 6050, 6100];

const buildOptionChain = (expiry: string, spot = 6000, multiplier = 1): SpxGexOptionChain => ({
  symbol: "SPX",
  spot,
  expiries,
  selectedExpiry: expiry,
  calls: strikes.map((strike, index) => ({
    contractSymbol: `SPX${expiry.replaceAll("-", "")}C${strike}`,
    strike,
    lastPrice: Math.max(1, spot - strike + 25),
    bid: 1,
    ask: 2,
    volume: Math.round((900 + index * 75) * multiplier),
    openInterest: Math.round((index === 3 ? 22_000 : 4_000 + index * 1_500) * multiplier),
    impliedVolatility: 18 + index,
  })),
  puts: strikes.map((strike, index) => ({
    contractSymbol: `SPX${expiry.replaceAll("-", "")}P${strike}`,
    strike,
    lastPrice: Math.max(1, strike - spot + 25),
    bid: 1,
    ask: 2,
    volume: Math.round((800 + index * 60) * multiplier),
    openInterest: Math.round((index === 0 ? 24_000 : 5_000 + index * 1_200) * multiplier),
    impliedVolatility: 20 + index,
  })),
});

const buildStructuredHeatmap = (generatedAt = "2026-05-27T13:15:00.000Z", spot = 6000) =>
  buildSpxGexHeatmapFromOptionChains({
    generatedAt,
    quoteText: `| Ticker | Last | Change | Change % |\n| SPX | $${spot.toFixed(2)} | +12.50 | +0.21% |`,
    chains: expiries.map((expiry, index) => buildOptionChain(expiry, spot, 1 + index * 0.1)),
    selectedExpiries: expiries,
    maxStrikes: 5,
  });

type StructureFixtureRow = Omit<SpxGexStrikeProfile, "tags" | "dominantExpiry"> & { dominantExpiry?: string | null };

const structureRow = (row: StructureFixtureRow): Omit<SpxGexStrikeProfile, "tags"> => ({
  dominantExpiry: null,
  ...row,
});

const labelsFor = (profiles: SpxGexStrikeProfile[]) =>
  profiles.flatMap((row) => row.tags.map((tag) => tag.label));

const labelAt = (profiles: SpxGexStrikeProfile[], strike: number) =>
  profiles.find((row) => row.strike === strike)?.tags[0]?.label || "";

const gexText = (_expiry: string, rows: string) => `
**Snapshot:** 2026-05-27T09:14:55 **Spot:** $6,000.00
| Metric | Value |
| Net GEX | **1.25B** |
| Strike | Call GEX | Put GEX | Total |
${rows}
`.trim();

const legacyZeroDteText = `
**Snapshot:** 2026-05-27T09:14:55 **Session phase:** \`pre_market\` **Now (ET):** 2026-05-27 09:14
**Expiry:** 2026-05-27
**Pin level:** $6,000 (0.0%)
Flip level: $5,950 (-0.8%)
| Metric | Value |
| Net GEX | **1.50B** |
| Net DEX | **-400.00M** |
| Top call wall | $6,050 |
| Top put wall | $5,900 |
| Charm regime | \`supportive\` |
`.trim();

const buildLegacyHeatmap = (generatedAt = "2026-05-27T13:15:00.000Z") =>
  buildSpxGexHeatmapFromToolText({
    generatedAt,
    quoteText: "| Ticker | Last | Change | Change % |\n| SPX | $6,000.00 | +12.50 | +0.21% |",
    optionsText: "**Available expiries:** 2026-05-27, 2026-05-28, 2026-05-29, 2026-06-01, 2026-06-02",
    zeroDteText: legacyZeroDteText,
    gexByExpiryText: {
      "2026-05-27": gexText("2026-05-27", "| $6,050 | 1 | 2 | **2.00B** |\n| $6,000 | 1 | 2 | **-1.00B** |"),
      "2026-05-28": gexText("2026-05-28", "| $6,050 | 1 | 2 | **1.25B** |\n| $6,000 | 1 | 2 | **500.00M** |"),
      "2026-05-29": gexText("2026-05-29", "| $6,050 | 1 | 2 | **750.00M** |\n| $6,000 | 1 | 2 | **-250.00M** |"),
      "2026-06-01": gexText("2026-06-01", "| $6,050 | 1 | 2 | **300.00M** |\n| $6,000 | 1 | 2 | **100.00M** |"),
      "2026-06-02": gexText("2026-06-02", "| $6,050 | 1 | 2 | **-200.00M** |\n| $6,000 | 1 | 2 | **50.00M** |"),
    },
  });

describe("SPX GEX exposure board model", () => {
  it("classifies professional-style primary structure labels with ranked, testable rules", () => {
    const profiles = classifySpxGexStructureTags([
      structureRow({ strike: 6060, netGex: 1_200_000_000, callGex: 1_450_000_000, putGex: -250_000_000, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 8_000, totalVolume: 3_000 }),
      structureRow({ strike: 6050, netGex: 5_000_000_000, callGex: 6_200_000_000, putGex: -1_200_000_000, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 50_000, totalVolume: 7_500 }),
      structureRow({ strike: 6040, netGex: 300_000_000, callGex: 440_000_000, putGex: -140_000_000, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 3_000, totalVolume: 1_200 }),
      structureRow({ strike: 6020, netGex: 800_000_000, callGex: 930_000_000, putGex: -130_000_000, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 12_000, totalVolume: 2_200 }),
      structureRow({ strike: 6000, netGex: 100_000_000, callGex: 300_000_000, putGex: -200_000_000, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 60_000, totalVolume: 10_000 }),
      structureRow({ strike: 5960, netGex: -1_400_000_000, callGex: 200_000_000, putGex: -1_600_000_000, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 25_000, totalVolume: 3_500 }),
      structureRow({ strike: 5940, netGex: 20_000_000, callGex: 40_000_000, putGex: -20_000_000, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 500, totalVolume: 200 }),
    ], 6000, {
      pinLevel: 6000,
      gammaFlip: 5940,
      topCallWallLevel: 6050,
      topPutWallLevel: 5960,
    });

    assert.deepEqual(labelsFor(profiles).sort(), [
      "Air Gap",
      "Big call wall · gamma ceiling",
      "Lower Shelf",
      "Minor resistance",
      "NOW / OI spike / pin zone",
      "Resistance zone",
      "Upper Shelf",
    ].sort());
    assert.equal(labelAt(profiles, 6050), "Big call wall · gamma ceiling");
    assert.equal(labelAt(profiles, 6000), "NOW / OI spike / pin zone");
    assert.equal(profiles.every((row) => row.tags.length <= 1), true);
  });

  it("does not mark every positive NetGEX strike above spot as Resistance zone", () => {
    const productionLikeProfiles = [
      structureRow({ strike: 7610, netGex: 223_501_893, callGex: 932_653_255, putGex: -709_151_361, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 7_879, totalVolume: 2_100 }),
      structureRow({ strike: 7605, netGex: 402_869_636, callGex: 1_441_864_441, putGex: -1_038_994_805, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 13_268, totalVolume: 2_600 }),
      structureRow({ strike: 7600, netGex: 12_787_655_875, callGex: 13_443_621_205, putGex: -655_965_332, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 62_010, totalVolume: 9_000 }),
      structureRow({ strike: 7595, netGex: 2_077_872_173, callGex: 2_256_386_093, putGex: -178_513_920, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 10_759, totalVolume: 3_000 }),
      structureRow({ strike: 7590, netGex: 1_951_620_216, callGex: 2_138_821_231, putGex: -187_201_016, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 8_827, totalVolume: 2_800 }),
      structureRow({ strike: 7585, netGex: 919_156_460, callGex: 1_063_248_485, putGex: -144_092_026, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 3_266, totalVolume: 1_300 }),
      structureRow({ strike: 7580, netGex: 3_201_291_145, callGex: 3_832_132_312, putGex: -630_841_168, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 9_327, totalVolume: 3_200 }),
      structureRow({ strike: 7575, netGex: 5_415_502_982, callGex: 7_144_427_868, putGex: -1_728_924_886, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 20_028, totalVolume: 5_000 }),
      structureRow({ strike: 7570, netGex: 5_990_142_995, callGex: 6_490_895_072, putGex: -500_752_076, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 5_161, totalVolume: 2_400 }),
      structureRow({ strike: 7545, netGex: -301_600_279, callGex: 517_105_335, putGex: -818_705_614, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 5_242, totalVolume: 1_400 }),
      structureRow({ strike: 7535, netGex: 16_831_523, callGex: 1_411_161_037, putGex: -1_394_329_513, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 13_239, totalVolume: 2_900 }),
      structureRow({ strike: 7500, netGex: -3_400_000_000, callGex: 1_200_000_000, putGex: -4_600_000_000, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 31_000, totalVolume: 4_500 }),
    ];
    const profiles = classifySpxGexStructureTags(productionLikeProfiles, 7570.12, {
      pinLevel: 7600,
      gammaFlip: 7545.18,
      topCallWallLevel: 7600,
      topPutWallLevel: 7500,
    });

    const resistanceLabels = labelsFor(profiles).filter((label) => label === "Resistance zone");
    const positiveAboveCount = productionLikeProfiles.filter((row) => row.strike > 7570.12 && row.netGex > 0).length;

    assert.equal(positiveAboveCount, 8);
    assert.equal(resistanceLabels.length <= 1, true);
    assert.equal(profiles.every((row) => row.tags.length <= 1), true);
    assert.equal(labelAt(profiles, 7600), "Big call wall · gamma ceiling");
    assert.equal(labelsFor(profiles).includes("Pin Zone"), false);
  });

  it("builds a professional exposure board with matrix cells, structure tags, DEX, VEX, and CEX", () => {
    const heatmap = buildStructuredHeatmap();

    assert.deepEqual(heatmap.selectedExpiries, expiries);
    assert.equal(heatmap.cells.length, expiries.length * strikes.length);
    assert.equal(heatmap.strikeProfiles.length, strikes.length);
    assert.equal(heatmap.zeroDte.charmRegime, "black_scholes_approx");
    assert.equal(typeof heatmap.zeroDte.netVex, "number");
    assert.equal(typeof heatmap.zeroDte.netCex, "number");
    assert.ok(heatmap.strikeProfiles.some((row) => row.tags.some((tag) => tag.type === "big_call_wall")));
    assert.ok(heatmap.strikeProfiles.some((row) => row.tags.some((tag) => tag.type === "lower_shelf")));
    assert.ok(heatmap.strikeProfiles.some((row) => row.tags.some((tag) => tag.type === "now")));
    assert.ok(heatmap.strikeProfiles.every((row) => row.tags.length <= 1));
    assert.ok(heatmap.source.note.includes("Black-Scholes"));
  });

  it("keeps dense SPX strike coverage near spot instead of collapsing to a sparse mock-table", () => {
    const denseStrikes = Array.from({ length: 121 }, (_, index) => 5700 + index * 5);
    const denseChains = expiries.map((expiry) => ({
      ...buildOptionChain(expiry),
      calls: denseStrikes.map((strike, index) => ({
        contractSymbol: `SPX${expiry.replaceAll("-", "")}C${strike}`,
        strike,
        lastPrice: Math.max(1, 6000 - strike + 25),
        bid: 1,
        ask: 2,
        volume: 200 + index,
        openInterest: 1000 + index * 5,
        impliedVolatility: 18 + (index % 8),
      })),
      puts: denseStrikes.map((strike, index) => ({
        contractSymbol: `SPX${expiry.replaceAll("-", "")}P${strike}`,
        strike,
        lastPrice: Math.max(1, strike - 6000 + 25),
        bid: 1,
        ask: 2,
        volume: 180 + index,
        openInterest: 900 + index * 4,
        impliedVolatility: 20 + (index % 8),
      })),
    }));

    const heatmap = buildSpxGexHeatmapFromOptionChains({
      generatedAt: "2026-05-27T13:15:00.000Z",
      chains: denseChains,
      selectedExpiries: expiries,
    });

    assert.equal(heatmap.strikes.length, 96);
    assert.equal(heatmap.cells.length, 96 * expiries.length);
    assert.ok(heatmap.strikes.includes(6000));
  });
});

class MemoryD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly db: MemoryD1,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async run() {
    if (this.query.includes("INSERT INTO spx_gex_intraday_snapshots")) {
      const key = `${this.values[0]}:${this.values[1]}`;
      this.db.intraday.set(key, {
        trading_date: this.values[0],
        snapshot_minute_et: this.values[1],
        snapshot_time_et: this.values[2],
        generated_at: this.values[3],
        ticker: this.values[4],
        spot: this.values[5],
        snapshot_json: this.values[6],
      });
    }

    if (this.query.includes("DELETE FROM spx_gex_intraday_snapshots")) {
      const keepDates = Array.from(new Set([...this.db.intraday.values()].map((row) => String(row.trading_date))))
        .sort()
        .reverse()
        .slice(0, Number(this.values[0]));
      for (const [key, row] of [...this.db.intraday.entries()]) {
        if (!keepDates.includes(String(row.trading_date))) this.db.intraday.delete(key);
      }
    }

    if (this.query.includes("INSERT INTO spx_gex_heatmaps")) {
      this.db.legacy.set(String(this.values[0]), {
        date: this.values[0],
        generated_at: this.values[1],
        snapshot_at: this.values[2],
        ticker: this.values[3],
        spot: this.values[4],
        quote_json: this.values[5],
        expiries_json: this.values[6],
        strikes_json: this.values[7],
        cells_json: this.values[8],
        totals_json: this.values[9],
        zero_dte_json: this.values[10],
        interpretation_json: this.query.includes("interpretation_json") ? this.values[11] : null,
        source_json: this.query.includes("interpretation_json") ? this.values[12] : this.values[11],
      });
    }

    if (this.query.includes("DELETE FROM spx_gex_heatmaps")) {
      const keepDates = [...this.db.legacy.keys()].sort().reverse().slice(0, Number(this.values[0]));
      for (const date of [...this.db.legacy.keys()]) {
        if (!keepDates.includes(date)) this.db.legacy.delete(date);
      }
    }

    return {};
  }

  async first<T = Record<string, unknown>>() {
    if (this.query.includes("FROM spx_gex_intraday_snapshots")) {
      const date = String(this.values[0]);
      if (this.query.includes("snapshot_minute_et = ?")) {
        return (this.db.intraday.get(`${date}:${this.values[1]}`) || null) as T | null;
      }
      const rows = [...this.db.intraday.values()]
        .filter((row) => row.trading_date === date)
        .sort((a, b) => Number(b.snapshot_minute_et) - Number(a.snapshot_minute_et));
      return (rows[0] || null) as T | null;
    }

    if (this.query.includes("SELECT * FROM spx_gex_heatmaps WHERE date = ?")) {
      return (this.db.legacy.get(String(this.values[0])) || null) as T | null;
    }

    return null;
  }

  async all<T = Record<string, unknown>>() {
    if (this.query.includes("SELECT DISTINCT trading_date")) {
      return {
        results: Array.from(new Set([...this.db.intraday.values()].map((row) => String(row.trading_date))))
          .sort()
          .reverse()
          .map((trading_date) => ({ trading_date })) as T[],
      };
    }

    if (this.query.includes("FROM spx_gex_intraday_snapshots") && this.query.includes("WHERE trading_date = ?")) {
      const date = String(this.values[0]);
      return {
        results: [...this.db.intraday.values()]
          .filter((row) => row.trading_date === date)
          .sort((a, b) => Number(a.snapshot_minute_et) - Number(b.snapshot_minute_et)) as T[],
      };
    }

    if (this.query.includes("SELECT date FROM spx_gex_heatmaps")) {
      return {
        results: [...this.db.legacy.keys()].sort().reverse().map((date) => ({ date })) as T[],
      };
    }

    return { results: [] as T[] };
  }
}

class MemoryD1 {
  readonly intraday = new Map<string, Record<string, unknown>>();
  readonly legacy = new Map<string, Record<string, unknown>>();

  prepare(query: string) {
    return new MemoryD1Statement(this, query);
  }

  async batch(statements: MemoryD1Statement[]) {
    for (const statement of statements) await statement.run();
    return [];
  }
}

describe("SPX GEX intraday D1 storage", () => {
  it("stores multiple snapshots per date, reads latest or selected slot, and retains seven trading dates", async () => {
    const db = new MemoryD1();
    await upsertSpxGexHeatmap(db, "2026-05-27", buildStructuredHeatmap("2026-05-27T13:15:00.000Z", 6000), { retentionTradingDays: 7 });
    await upsertSpxGexHeatmap(db, "2026-05-27", buildStructuredHeatmap("2026-05-27T13:30:00.000Z", 6010), { retentionTradingDays: 7 });

    for (const date of ["2026-05-18", "2026-05-19", "2026-05-20", "2026-05-21", "2026-05-22", "2026-05-26", "2026-05-28"]) {
      await upsertSpxGexHeatmap(db, date, buildStructuredHeatmap(`${date}T13:15:00.000Z`), { retentionTradingDays: 7 });
    }

    assert.deepEqual(await listSpxGexHeatmapDates(db), [
      "2026-05-28",
      "2026-05-27",
      "2026-05-26",
      "2026-05-22",
      "2026-05-21",
      "2026-05-20",
      "2026-05-19",
    ]);
    assert.equal((await listSpxGexHeatmapSessions(db, "2026-05-27")).length, 2);
    assert.equal((await readSpxGexHeatmap(db, "2026-05-27"))?.quote.last, 6010);
    assert.equal((await readSpxGexHeatmap(db, "2026-05-27", 9 * 60 + 15))?.quote.last, 6000);
    assert.equal(await readSpxGexHeatmap(db, "2026-05-18"), null);
  });

  it("falls back to the legacy daily table when no intraday snapshot exists", async () => {
    const db = new MemoryD1();
    const legacy = buildLegacyHeatmap("2026-05-27T13:15:00.000Z");
    await upsertSpxGexHeatmap(db, "2026-05-27", legacy);
    db.intraday.clear();

    const restored = await readSpxGexHeatmap(db, "2026-05-27");

    assert.equal(restored?.quote.last, 6000);
    assert.equal(restored?.source.gexTool, "get_options_gex");
    assert.ok((await listSpxGexHeatmapSessions(db, "2026-05-27")).length === 1);
  });
});

describe("SPX GEX heatmap API", () => {
  it("returns dates, sessions, selected latest snapshot, and supports explicit snapshot selection", async () => {
    const db = new MemoryD1();
    await upsertSpxGexHeatmap(db, "2026-05-27", buildStructuredHeatmap("2026-05-27T13:15:00.000Z", 6000));
    await upsertSpxGexHeatmap(db, "2026-05-27", buildStructuredHeatmap("2026-05-27T13:30:00.000Z", 6010));

    const latestResponse = await getSpxGexHeatmapApi({
      request: new Request("https://example.com/api/spx-gex-heatmap?date=2026-05-27"),
      env: { SPX_RECAP_DB: db },
    });
    const latestPayload = (await latestResponse.json()) as {
      selectedDate: string;
      sessions: Array<{ snapshotMinuteEt: number }>;
      selectedSnapshot: { snapshotMinuteEt: number };
      heatmap: SpxGexHeatmapModel;
    };

    assert.equal(latestResponse.status, 200);
    assert.equal(latestPayload.selectedDate, "2026-05-27");
    assert.equal(latestPayload.sessions.length, 2);
    assert.equal(latestPayload.selectedSnapshot.snapshotMinuteEt, 9 * 60 + 30);
    assert.equal(latestPayload.heatmap.quote.last, 6010);

    const selectedResponse = await getSpxGexHeatmapApi({
      request: new Request("https://example.com/api/spx-gex-heatmap?date=2026-05-27&snapshot=555"),
      env: { SPX_RECAP_DB: db },
    });
    const selectedPayload = (await selectedResponse.json()) as { heatmap: SpxGexHeatmapModel };

    assert.equal(selectedPayload.heatmap.quote.last, 6000);
  });
});

const createFakeDataClient = () => {
  const calls: string[] = [];
  const client: SpxGexDataClient = {
    async getQuotes() {
      calls.push("get_quotes");
      return "| Ticker | Last | Change | Change % |\n| SPX | $6,000.00 | +12.50 | +0.21% |";
    },
    async getOptions() {
      calls.push("get_options");
      return `**Available expiries:** ${expiries.join(", ")}`;
    },
    async getOptions0Dte() {
      calls.push("get_options_0dte");
      return legacyZeroDteText;
    },
    async getOptionsGex(expiry: string) {
      calls.push(`get_options_gex:${expiry}`);
      return gexText(expiry, "| $6,050 | 1 | 2 | **2.00B** |\n| $6,000 | 1 | 2 | **-1.00B** |");
    },
    async getOptionsChain(expiry?: string) {
      calls.push(`get_options_chain:${expiry || "front"}`);
      return buildOptionChain(expiry || expiries[0]);
    },
    async getMarketContext() {
      calls.push("get_market_context");
      return {
        macroRegime: "risk_off",
        breadth: { advancers: 2, universeCount: 5, avgChange: -0.65 },
        flow: { topTicker: "NVDA", proxyFlow: -125_000_000, changePercent: -1.2 },
        latestHeadline: "Futures slip before the open",
        warnings: [],
      };
    },
  };

  return { client, calls };
};

describe("SPX GEX intraday automation runner", () => {
  it("generates once per 15-minute slot and skips only the same slot", async () => {
    const db = new MemoryD1();
    const { client, calls } = createFakeDataClient();

    const firstRun = await generateAndStoreSpxGexHeatmap({
      db,
      dataClient: client,
      now: new Date("2026-05-27T13:15:00Z"),
    });
    const sameSlot = await generateAndStoreSpxGexHeatmap({
      db,
      dataClient: client,
      now: new Date("2026-05-27T13:15:00Z"),
    });
    const nextSlot = await generateAndStoreSpxGexHeatmap({
      db,
      dataClient: client,
      now: new Date("2026-05-27T13:30:00Z"),
    });

    assert.deepEqual(firstRun, { status: "generated", date: "2026-05-27", snapshotMinuteEt: 555, snapshotTimeEt: "09:15" });
    assert.deepEqual(sameSlot, { status: "skipped_existing", date: "2026-05-27", snapshotMinuteEt: 555, snapshotTimeEt: "09:15" });
    assert.deepEqual(nextSlot, { status: "generated", date: "2026-05-27", snapshotMinuteEt: 570, snapshotTimeEt: "09:30" });
    assert.equal((await listSpxGexHeatmapSessions(db, "2026-05-27")).length, 2);
    assert.equal(calls.filter((call) => call === "get_quotes").length, 2);
    assert.equal(calls.filter((call) => call.startsWith("get_options_chain")).length, 12);
  });

  it("does not call the data client when the market is closed", async () => {
    const db = new MemoryD1();
    const { client, calls } = createFakeDataClient();

    const result = await generateAndStoreSpxGexHeatmap({
      db,
      dataClient: client,
      now: new Date("2026-05-25T13:15:00Z"),
    });

    assert.deepEqual(result, { status: "skipped", date: "2026-05-25", reason: "us_market_holiday" });
    assert.deepEqual(calls, []);
  });
});
