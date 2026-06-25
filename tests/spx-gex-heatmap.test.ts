import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSpxGexHeatmapFromOptionChains,
  buildSpxGexHeatmapFromToolText,
  calculateBlackScholesExposures,
  classifySpxGexStructureTags,
  formatSpxGexCompactExposure,
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
import { deriveNativeOptionExposureLevels } from "../src/lib/stocks-native-yahoo";
import {
  CboeSpxGexDataClient,
  FallbackSpxGexDataClient,
  parseCboeOptionSymbol,
  parseCboeSpxOptionsPayload,
} from "../src/lib/spx-gex-cboe";
import { onRequest as getSpxGexHeatmapApi } from "../functions/api/spx-gex-heatmap";

describe("SPX GEX intraday generation gate", () => {
  it("collects a 15-minute delayed feed from 09:45 through 16:15 ET on a trading day", () => {
    const tooEarly = getSpxGexGenerationStatus(new Date("2026-05-27T13:30:00Z"));
    const open = getSpxGexGenerationStatus(new Date("2026-05-27T13:45:00Z"));
    const mid = getSpxGexGenerationStatus(new Date("2026-05-27T17:30:00Z"));
    const close = getSpxGexGenerationStatus(new Date("2026-05-27T20:15:00Z"));
    const outside = getSpxGexGenerationStatus(new Date("2026-05-27T20:30:00Z"));

    assert.equal(tooEarly.snapshotTimeEt, "09:15");
    assert.equal(tooEarly.isGenerationWindow, false);
    assert.equal(open.etDateKey, "2026-05-27");
    assert.equal(open.snapshotMinuteEt, 9 * 60 + 30);
    assert.equal(open.snapshotTimeEt, "09:30");
    assert.equal(open.collectedMinuteEt, 9 * 60 + 45);
    assert.equal(open.collectedTimeEt, "09:45");
    assert.equal(open.isGenerationWindow, true);
    assert.equal(mid.isGenerationWindow, true);
    assert.equal(mid.snapshotTimeEt, "13:15");
    assert.equal(close.snapshotTimeEt, "16:00");
    assert.equal(close.collectedTimeEt, "16:15");
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

  it("blocks generation on Juneteenth", () => {
    const status = getSpxGexGenerationStatus(new Date("2026-06-19T13:45:00Z"));

    assert.equal(status.etDateKey, "2026-06-19");
    assert.equal(status.snapshotTimeEt, "09:30");
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

  it("uses a blended gamma IV so 0DTE side-IV skew does not zero out upside call gamma", () => {
    const exposure = calculateBlackScholesExposures({
      spot: 7475.79,
      strike: 7550,
      yearsToExpiry: 2.75 / (365 * 24),
      callOpenInterest: 5254,
      putOpenInterest: 3497,
      callIv: 0.0846,
      putIv: 0.1485,
      gammaIv: (0.0846 + 0.1485) / 2,
    });

    assert.ok(exposure.callGex > Math.abs(exposure.putGex));
    assert.ok(exposure.netGex > 0);
  });

  it("keeps Yahoo rows with missing open interest as no-data instead of volume-proxy zero", () => {
    const heatmap = buildSpxGexHeatmapFromOptionChains({
      generatedAt: "2026-06-22T18:15:07.000Z",
      chains: [buildMissingOpenInterestChain()],
      selectedExpiries: ["2026-06-22"],
      maxStrikes: 1,
    });
    const cell = heatmap.cells[0];

    assert.ok(cell);
    assert.equal(cell.netGex, null);
    assert.equal(cell.callEffectiveOpenInterest, null);
    assert.equal(cell.putEffectiveOpenInterest, null);
    assert.equal(cell.callOpenInterestStatus, "missing");
    assert.equal(cell.putOpenInterestStatus, "missing");
    assert.deepEqual(cell.missingReasons, ["missing call open interest", "missing put open interest"]);
    assert.equal(cell.model, undefined);
    assert.equal(heatmap.zeroDte.netGex, null);
    assert.equal(heatmap.zeroDte.pinLevel, null);
  });

  it("treats reported zero open interest as true zero with audited inputs", () => {
    const heatmap = buildSpxGexHeatmapFromOptionChains({
      generatedAt: "2026-06-22T18:15:07.000Z",
      chains: [buildZeroOpenInterestChain()],
      selectedExpiries: ["2026-06-22"],
      maxStrikes: 1,
    });
    const cell = heatmap.cells[0];

    assert.ok(cell);
    assert.equal(cell.netGex, 0);
    assert.equal(cell.callEffectiveOpenInterest, 0);
    assert.equal(cell.putEffectiveOpenInterest, 0);
    assert.equal(cell.callOpenInterestStatus, "reported");
    assert.equal(cell.putOpenInterestStatus, "reported");
    assert.deepEqual(cell.missingReasons, []);
    assert.equal(cell.model, "black_scholes_gamma_exposure_blended_iv");
    assert.equal(heatmap.zeroDte.netGex, 0);
    assert.equal(heatmap.zeroDte.pinLevel, null);
    assert.equal(heatmap.zeroDte.topCallWallLevel, null);
    assert.equal(heatmap.zeroDte.topPutWallLevel, null);
    assert.deepEqual(heatmap.strikeProfiles.flatMap((row) => row.tags), []);
  });

  it("repairs reported zero IV from a valid bid/ask mid and marks the cell as repaired", () => {
    const heatmap = buildSpxGexHeatmapFromOptionChains({
      generatedAt: "2026-06-22T18:15:07.000Z",
      chains: [buildZeroIvRepairableChain()],
      selectedExpiries: ["2026-06-22"],
      maxStrikes: 1,
    });
    const cell = heatmap.cells[0];

    assert.ok(cell);
    assert.equal(typeof cell.netGex, "number");
    assert.equal(Number.isFinite(cell.netGex), true);
    assert.equal(cell.callIvSource, "repaired_from_mid");
    assert.equal(cell.putIvSource, "reported");
    assert.equal(cell.pricingQuality, "repaired");
    assert.equal(cell.callIvStatus, "reported");
    assert.ok(Number(cell.callIv) > 0);
    assert.ok(cell.repairNotes?.some((note) => note.includes("call IV repaired from bid/ask mid")));
    assert.deepEqual(cell.missingReasons, []);
  });

  it("excludes a zero-IV OTM near-zero leg as zero gamma and keeps the priced side", () => {
    const heatmap = buildSpxGexHeatmapFromOptionChains({
      generatedAt: "2026-06-22T18:15:07.000Z",
      chains: [buildZeroIvLowTimeValueChain()],
      selectedExpiries: ["2026-06-22"],
      maxStrikes: 1,
    });
    const cell = heatmap.cells[0];

    assert.ok(cell);
    assert.equal(typeof cell.netGex, "number");
    assert.equal(Number.isFinite(cell.netGex), true);
    assert.equal(cell.callGex, 0);
    assert.ok(Number(cell.putGex) < 0);
    assert.equal(cell.callIvSource, "excluded_low_time_value");
    assert.equal(cell.putIvSource, "reported");
    assert.equal(cell.pricingQuality, "partial");
    assert.ok(cell.missingReasons?.some((reason) => reason === "excluded call IV"));
  });

  it("keeps zero IV with no safe price repair as unpriced instead of fabricating GEX", () => {
    const heatmap = buildSpxGexHeatmapFromOptionChains({
      generatedAt: "2026-06-22T18:15:07.000Z",
      chains: [buildZeroIvUnpricedChain()],
      selectedExpiries: ["2026-06-22"],
      maxStrikes: 1,
    });
    const cell = heatmap.cells[0];

    assert.ok(cell);
    assert.equal(cell.netGex, null);
    assert.equal(cell.callIvSource, "unpriced");
    assert.equal(cell.putIvSource, "reported");
    assert.equal(cell.pricingQuality, "unpriced");
    assert.ok(cell.missingReasons?.some((reason) => reason === "unpriced call IV"));
    assert.equal(cell.model, undefined);
  });

  it("formats tiny non-zero exposure as a threshold, not a misleading display zero", () => {
    assert.equal(formatSpxGexCompactExposure(0.4), "<1");
    assert.equal(formatSpxGexCompactExposure(0.4, { signed: true }), "+<1");
    assert.equal(formatSpxGexCompactExposure(-0.4, { signed: true }), ">-1");
    assert.equal(formatSpxGexCompactExposure(null), "n/a");
  });

  it("derives native pin, call wall, put wall, and gamma flip independently from finite Yahoo rows", () => {
    const rows = [
      { strike: 7450, callGex: 200_000, putGex: -5_000_000, netGex: -4_800_000 },
      { strike: 7475, callGex: 8_000_000, putGex: -2_000_000, netGex: 6_000_000 },
      { strike: 7500, callGex: 1_000_000, putGex: -900_000, netGex: 100_000 },
      { strike: 7525, callGex: 6_000_000, putGex: -1_000_000, netGex: 5_000_000 },
    ];

    const levels = deriveNativeOptionExposureLevels(rows, 7475);

    assert.equal(levels.pin?.strike, 7475);
    assert.equal(levels.callWall?.strike, 7475);
    assert.equal(levels.putWall?.strike, 7450);
    assert.equal(levels.gammaFlip, 7461.11);
  });
});

describe("SPX GEX Cboe delayed source adapter", () => {
  it("normalizes Cboe OCC-style symbols into expiry, side, and strike", () => {
    assert.deepEqual(parseCboeOptionSymbol("SPX260624C07365000"), {
      root: "SPX",
      expiry: "2026-06-24",
      side: "C",
      strike: 7365,
    });
    assert.deepEqual(parseCboeOptionSymbol("SPX260717P00200000"), {
      root: "SPX",
      expiry: "2026-07-17",
      side: "P",
      strike: 200,
    });
    assert.equal(parseCboeOptionSymbol("BROKEN"), null);
  });

  it("preserves reported zero separately from missing fields when mapping raw Cboe JSON", () => {
    const chains = parseCboeSpxOptionsPayload(buildCboeFixturePayload(), { todayEt: "2026-06-24" });
    const front = chains.find((chain) => chain.selectedExpiry === "2026-06-24");
    const call = front?.calls.find((leg) => leg.strike === 7365);
    const put = front?.puts.find((leg) => leg.strike === 7365);

    assert.ok(front);
    assert.equal(front.source?.label, "Cboe delayed");
    assert.equal(call?.openInterest, 0);
    assert.equal(call?.volume, 0);
    assert.equal(call?.bid, 0);
    assert.equal(call?.impliedVolatility, 12.5);
    assert.equal(put?.openInterest, null);
    assert.equal(put?.volume, null);
    assert.equal(put?.impliedVolatility, 13.1);
  });

  it("selects the current ET front expiry instead of an expired Cboe row", async () => {
    const client = new CboeSpxGexDataClient({
      fetchJson: async () => buildCboeFixturePayload(),
      now: () => new Date("2026-06-24T14:00:00Z"),
    });

    const chain = await client.getOptionsChain();

    assert.equal(chain.selectedExpiry, "2026-06-24");
    assert.deepEqual(chain.expiries.slice(0, 2), ["2026-06-24", "2026-06-25"]);
    assert.equal(chain.spot, 7365.46);
    assert.equal(chain.calls.length, 1);
    assert.equal(chain.puts.length, 1);
  });

  it("accepts Cboe SPXW weekly option roots as SPX contracts", () => {
    const chains = parseCboeSpxOptionsPayload({
      timestamp: "2026-06-24 05:12:52",
      data: {
        symbol: "SPX",
        current_price: 7365.46,
        options: [
          cboeOption("SPXW260624C07365000", { open_interest: 10, volume: 2, iv: 0.12 }),
          cboeOption("SPXW260624P07365000", { open_interest: 11, volume: 3, iv: 0.13 }),
        ],
      },
    }, { todayEt: "2026-06-24" });

    assert.equal(chains[0]?.selectedExpiry, "2026-06-24");
    assert.equal(chains[0]?.calls[0]?.contractSymbol, "SPXW260624C07365000");
    assert.equal(chains[0]?.puts[0]?.contractSymbol, "SPXW260624P07365000");
  });

  it("marks Cboe as the heatmap source label and keeps source-specific timestamp text", async () => {
    const client = new CboeSpxGexDataClient({
      fetchJson: async () => buildDenseCboePayload(),
      now: () => new Date("2026-06-24T14:00:00Z"),
    });
    const front = await client.getOptionsChain();
    const chains = await Promise.all(front.expiries.slice(0, 5).map((expiry) => client.getOptionsChain(expiry)));
    const heatmap = buildSpxGexHeatmapFromOptionChains({
      generatedAt: "2026-06-24T14:00:00.000Z",
      quoteText: await client.getQuotes(),
      chains,
      selectedExpiries: front.expiries.slice(0, 5),
      maxStrikes: 5,
    });

    assert.ok(heatmap.source.note.includes("Cboe delayed"));
    assert.ok(heatmap.source.note.includes("2026-06-24 05:12:52"));
    assert.equal(heatmap.selectedExpiries[0], "2026-06-24");
  });

  it("falls back to Yahoo-compatible data when Cboe selection fails", async () => {
    const fallbackChain = buildOptionChain("2026-06-24", 7365.46);
    const client = new FallbackSpxGexDataClient({
      primary: {
        async getQuotes() { throw new Error("primary quote should not be used after selection failure"); },
        async getOptions() { throw new Error("primary options should not be used after selection failure"); },
        async getOptions0Dte() { throw new Error("primary 0dte should not be used after selection failure"); },
        async getOptionsGex() { throw new Error("primary gex should not be used after selection failure"); },
        async getOptionsChain() { throw new Error("Cboe unavailable"); },
      },
      fallback: {
        async getQuotes() { return "| Ticker | Last | Change | Change % |\n| SPX | $7,365.46 | n/a | n/a |"; },
        async getOptions() { return ""; },
        async getOptions0Dte() { return ""; },
        async getOptionsGex() { return ""; },
        async getOptionsChain() { return { ...fallbackChain, source: { provider: "yahoo", label: "Yahoo delayed fallback" } }; },
      },
    });

    const chain = await client.getOptionsChain();
    const quoteText = await client.getQuotes();

    assert.equal(chain.source?.label, "Yahoo delayed fallback");
    assert.ok(quoteText.includes("SPX"));
  });

  it("does not call Yahoo market context when Cboe delayed source is healthy", async () => {
    const client = new FallbackSpxGexDataClient({
      primary: new CboeSpxGexDataClient({
        fetchJson: async () => buildDenseCboePayload(),
        now: () => new Date("2026-06-24T14:00:00Z"),
      }),
      fallback: {
        async getQuotes() { throw new Error("fallback quote should not be used"); },
        async getOptions() { throw new Error("fallback options should not be used"); },
        async getOptions0Dte() { throw new Error("fallback 0dte should not be used"); },
        async getOptionsGex() { throw new Error("fallback gex should not be used"); },
        async getOptionsChain() { throw new Error("fallback chain should not be used"); },
        async getMarketContext() { throw new Error("Yahoo market context should not be called for healthy Cboe"); },
      },
    });

    const chain = await client.getOptionsChain();
    const context = await client.getMarketContext();

    assert.equal(chain.source?.label, "Cboe delayed");
    assert.deepEqual(context.warnings, [
      "Cboe delayed source selected; Yahoo market context skipped to keep heatmap generation independent of Yahoo crumb/4xx failures.",
    ]);
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

const buildSideSkewChain = (): SpxGexOptionChain => ({
  symbol: "SPX",
  spot: 7475.79,
  expiries: ["2026-06-22"],
  selectedExpiry: "2026-06-22",
  calls: [{
    contractSymbol: "SPX20260622C7550",
    strike: 7550,
    lastPrice: 1,
    bid: 1,
    ask: 2,
    volume: 53041,
    openInterest: 5254,
    impliedVolatility: 8.46,
  }],
  puts: [{
    contractSymbol: "SPX20260622P7550",
    strike: 7550,
    lastPrice: 1,
    bid: 1,
    ask: 2,
    volume: 2557,
    openInterest: 3497,
    impliedVolatility: 14.85,
  }],
});

const buildMissingOpenInterestChain = (): SpxGexOptionChain => ({
  symbol: "SPX",
  spot: 7475.79,
  expiries: ["2026-06-22"],
  selectedExpiry: "2026-06-22",
  calls: [{
    contractSymbol: "SPX20260622C7475",
    strike: 7475,
    lastPrice: 12,
    bid: 11,
    ask: 12.5,
    volume: 1550,
    impliedVolatility: 12.1,
  }],
  puts: [{
    contractSymbol: "SPX20260622P7475",
    strike: 7475,
    lastPrice: 10,
    bid: 9,
    ask: 10.5,
    volume: 1440,
    impliedVolatility: 13.4,
  }],
} as SpxGexOptionChain);

const buildZeroOpenInterestChain = (): SpxGexOptionChain => ({
  symbol: "SPX",
  spot: 7475.79,
  expiries: ["2026-06-22"],
  selectedExpiry: "2026-06-22",
  calls: [{
    contractSymbol: "SPX20260622C7475",
    strike: 7475,
    lastPrice: 12,
    bid: 11,
    ask: 12.5,
    volume: 1550,
    openInterest: 0,
    impliedVolatility: 12.1,
  }],
  puts: [{
    contractSymbol: "SPX20260622P7475",
    strike: 7475,
    lastPrice: 10,
    bid: 9,
    ask: 10.5,
    volume: 1440,
    openInterest: 0,
    impliedVolatility: 13.4,
  }],
});

const buildZeroIvRepairableChain = (): SpxGexOptionChain => ({
  symbol: "SPX",
  spot: 7475,
  expiries: ["2026-06-22"],
  selectedExpiry: "2026-06-22",
  calls: [{
    contractSymbol: "SPX20260622C7475",
    strike: 7475,
    lastPrice: 31,
    bid: 30,
    ask: 32,
    volume: 1550,
    openInterest: 800,
    impliedVolatility: 0,
  }],
  puts: [{
    contractSymbol: "SPX20260622P7475",
    strike: 7475,
    lastPrice: 28,
    bid: 27,
    ask: 29,
    volume: 1440,
    openInterest: 900,
    impliedVolatility: 12.5,
  }],
});

const buildZeroIvLowTimeValueChain = (): SpxGexOptionChain => ({
  symbol: "SPX",
  spot: 7475,
  expiries: ["2026-06-22"],
  selectedExpiry: "2026-06-22",
  calls: [{
    contractSymbol: "SPX20260622C7600",
    strike: 7600,
    lastPrice: 0,
    bid: 0,
    ask: 0.05,
    volume: 120,
    openInterest: 500,
    impliedVolatility: 0,
  }],
  puts: [{
    contractSymbol: "SPX20260622P7600",
    strike: 7600,
    lastPrice: 124,
    bid: 123,
    ask: 125,
    volume: 240,
    openInterest: 700,
    impliedVolatility: 15,
  }],
});

const buildZeroIvUnpricedChain = (): SpxGexOptionChain => ({
  symbol: "SPX",
  spot: 7475,
  expiries: ["2026-06-22"],
  selectedExpiry: "2026-06-22",
  calls: [{
    contractSymbol: "SPX20260622C7475",
    strike: 7475,
    lastPrice: 9,
    bid: 0,
    ask: 80,
    volume: 1550,
    openInterest: 800,
    impliedVolatility: 0,
  }],
  puts: [{
    contractSymbol: "SPX20260622P7475",
    strike: 7475,
    lastPrice: 28,
    bid: 27,
    ask: 29,
    volume: 1440,
    openInterest: 900,
    impliedVolatility: 12.5,
  }],
});

const cboeOption = (
  option: string,
  fields: Record<string, unknown>,
) => ({
  option,
  bid: 1,
  ask: 2,
  iv: 0.12,
  open_interest: 100,
  volume: 10,
  last_trade_price: 1.5,
  ...fields,
});

const buildCboeFixturePayload = () => ({
  timestamp: "2026-06-24 05:12:52",
  data: {
    symbol: "SPX",
    current_price: 7365.46,
    price_change: -12.34,
    price_change_percent: -0.17,
    options: [
      cboeOption("SPX260623C07365000", { open_interest: 10, volume: 2, iv: 0.111 }),
      cboeOption("SPX260624C07365000", { bid: 0, open_interest: 0, volume: 0, iv: 0.125, last_trade_price: 7.1 }),
      cboeOption("SPX260624P07365000", { open_interest: undefined, volume: undefined, iv: 0.131, last_trade_price: 8.2 }),
      cboeOption("SPX260625C07365000", { open_interest: 5, volume: 1, iv: 0.14 }),
      cboeOption("SPX260625P07365000", { open_interest: 6, volume: 1, iv: 0.15 }),
    ],
  },
});

const buildDenseCboePayload = () => {
  const denseExpiries = ["2026-06-24", "2026-06-25", "2026-06-26", "2026-06-29", "2026-06-30"];
  const denseStrikes = [7325, 7350, 7365, 7375, 7400];
  const options = denseExpiries.flatMap((expiry, expiryIndex) => {
    const yymmdd = expiry.slice(2).replaceAll("-", "");
    return denseStrikes.flatMap((strike, strikeIndex) => {
      const encodedStrike = String(strike * 1000).padStart(8, "0");
      return [
        cboeOption(`SPX${yymmdd}C${encodedStrike}`, {
          open_interest: 1000 + expiryIndex * 100 + strikeIndex,
          volume: 100 + strikeIndex,
          iv: 0.12 + strikeIndex / 100,
        }),
        cboeOption(`SPX${yymmdd}P${encodedStrike}`, {
          open_interest: 1200 + expiryIndex * 100 + strikeIndex,
          volume: 90 + strikeIndex,
          iv: 0.14 + strikeIndex / 100,
        }),
      ];
    });
  });
  return {
    timestamp: "2026-06-24 05:12:52",
    data: {
      symbol: "SPX",
      current_price: 7365.46,
      price_change: -12.34,
      price_change_percent: -0.17,
      options,
    },
  };
};

const buildStructuredHeatmap = (generatedAt = "2026-05-27T13:45:00.000Z", spot = 6000) =>
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
    const atTheMoneyCell = heatmap.cells.find((cell) => cell.expdate === expiries[0] && cell.strike === 6000);

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
    assert.ok(heatmap.source.note.includes("blended per-strike IV"));
    assert.ok(heatmap.source.note.includes("raw call/put IV retained for audit"));
    assert.ok(atTheMoneyCell);
    assert.equal(atTheMoneyCell.callIv, 0.2);
    assert.equal(atTheMoneyCell.putIv, 0.22);
    assert.equal(atTheMoneyCell.callIvPercent, 20);
    assert.equal(atTheMoneyCell.putIvPercent, 22);
    assert.equal(atTheMoneyCell.gammaIvPercent, 21);
    assert.equal(atTheMoneyCell.gammaIv, 0.21);
    assert.equal(atTheMoneyCell.avgIv, 21);
    assert.equal(atTheMoneyCell.callEffectiveOpenInterest, 7000);
    assert.equal(atTheMoneyCell.putEffectiveOpenInterest, 7400);
    assert.equal(atTheMoneyCell.callOpenInterest, 7000);
    assert.equal(atTheMoneyCell.putOpenInterest, 7400);
    assert.equal(atTheMoneyCell.callVolume, 1050);
    assert.equal(atTheMoneyCell.putVolume, 920);
    assert.equal(atTheMoneyCell.contractMultiplier, 100);
    assert.equal(atTheMoneyCell.riskFreeRate, 0.04);
    assert.equal(atTheMoneyCell.model, "black_scholes_gamma_exposure_blended_iv");
    assert.equal(atTheMoneyCell.calculationTimestamp, "2026-05-27T13:45:00.000Z");
    assert.equal(Number.isFinite(atTheMoneyCell.yearsToExpiry), true);
    assert.equal(Number.isFinite(atTheMoneyCell.dteHours), true);
    assert.equal(atTheMoneyCell.netGex, Number(atTheMoneyCell.callGex || 0) + Number(atTheMoneyCell.putGex || 0));
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
      const includeSnapshotJson = this.query.includes("snapshot_json");
      return {
        results: [...this.db.intraday.values()]
          .filter((row) => row.trading_date === date)
          .sort((a, b) => Number(a.snapshot_minute_et) - Number(b.snapshot_minute_et))
          .map((row) => ({
            trading_date: row.trading_date,
            snapshot_minute_et: row.snapshot_minute_et,
            snapshot_time_et: row.snapshot_time_et,
            generated_at: row.generated_at,
            spot: row.spot,
            ...(includeSnapshotJson ? { snapshot_json: row.snapshot_json } : {}),
          })) as T[],
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

const seedLegacyHeatmapRow = (db: MemoryD1, date: string, heatmap: SpxGexHeatmapModel) => {
  db.legacy.set(date, {
    date,
    generated_at: heatmap.generatedAt,
    snapshot_at: heatmap.snapshot,
    ticker: heatmap.ticker,
    spot: heatmap.quote.last,
    quote_json: JSON.stringify(heatmap.quote),
    expiries_json: JSON.stringify(heatmap.selectedExpiries),
    strikes_json: JSON.stringify(heatmap.strikes),
    cells_json: JSON.stringify(heatmap.cells),
    totals_json: JSON.stringify(heatmap.totals),
    zero_dte_json: JSON.stringify(heatmap.zeroDte),
    interpretation_json: JSON.stringify(heatmap.premarketInterpretation),
    source_json: JSON.stringify(heatmap.source),
  });
};

describe("SPX GEX intraday D1 storage", () => {
  it("stores multiple snapshots per date, reads latest or selected slot, and retains seven trading dates", async () => {
    const db = new MemoryD1();
    await upsertSpxGexHeatmap(db, "2026-05-27", buildStructuredHeatmap("2026-05-27T13:45:00.000Z", 6000), { retentionTradingDays: 7 });
    await upsertSpxGexHeatmap(db, "2026-05-27", buildStructuredHeatmap("2026-05-27T14:00:00.000Z", 6010), { retentionTradingDays: 7 });

    for (const date of ["2026-05-18", "2026-05-19", "2026-05-20", "2026-05-21", "2026-05-22", "2026-05-26", "2026-05-28"]) {
      await upsertSpxGexHeatmap(db, date, buildStructuredHeatmap(`${date}T13:45:00.000Z`), { retentionTradingDays: 7 });
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
    const restoredFirstSlot = await readSpxGexHeatmap(db, "2026-05-27", 9 * 60 + 30);
    const restoredAuditCell = restoredFirstSlot?.cells.find((cell) => cell.expdate === expiries[0] && cell.strike === 6000);
    assert.equal(restoredFirstSlot?.quote.last, 6000);
    assert.equal(restoredAuditCell?.callIvPercent, 20);
    assert.equal(restoredAuditCell?.putIvPercent, 22);
    assert.equal(restoredAuditCell?.gammaIvPercent, 21);
    assert.equal(restoredAuditCell?.callEffectiveOpenInterest, 7000);
    assert.equal(restoredAuditCell?.putEffectiveOpenInterest, 7400);
    assert.equal(restoredAuditCell?.model, "black_scholes_gamma_exposure_blended_iv");
    assert.equal(await readSpxGexHeatmap(db, "2026-05-18"), null);
    assert.equal(db.legacy.size, 0);
  });

  it("recomputes audit-capable side-IV intraday snapshots with blended gamma IV at read time", async () => {
    const db = new MemoryD1();
    const heatmap = buildSpxGexHeatmapFromOptionChains({
      generatedAt: "2026-06-22T18:15:07.000Z",
      chains: [buildSideSkewChain()],
      selectedExpiries: ["2026-06-22"],
      maxStrikes: 1,
    });
    const storedCell = heatmap.cells[0];
    assert.ok(storedCell);
    Object.assign(storedCell, {
      callGex: 4,
      putGex: -3_538_819,
      netGex: -3_538_815,
      gammaIv: undefined,
      gammaIvPercent: undefined,
      model: "black_scholes_gamma_exposure",
    });
    heatmap.source.note = `${heatmap.source.note} New snapshots retain per-cell IV/OI/DTE audit inputs; legacy snapshots may not.`;
    await upsertSpxGexHeatmap(db, "2026-06-22", heatmap, { retentionTradingDays: 7 });

    const restored = await readSpxGexHeatmap(db, "2026-06-22", 14 * 60);
    const restoredCell = restored?.cells[0];

    assert.ok(restoredCell);
    assert.equal(restoredCell.model, "black_scholes_gamma_exposure_blended_iv");
    assert.equal(restoredCell.gammaIvPercent, 11.66);
    assert.ok(Number(restoredCell.callGex) > Math.abs(Number(restoredCell.putGex)));
    assert.ok(Number(restoredCell.netGex) > 0);
    assert.equal(restored?.totals[0]?.netGex, restoredCell.netGex);
    assert.equal(restored?.zeroDte.netGex, restoredCell.netGex);
    assert.ok(!restored?.source.note.includes("legacy"));
  });

  it("does not fall back to the legacy daily table when no audited intraday snapshot exists", async () => {
    const db = new MemoryD1();
    const legacy = buildLegacyHeatmap("2026-05-27T13:15:00.000Z");
    seedLegacyHeatmapRow(db, "2026-05-27", legacy);

    const restored = await readSpxGexHeatmap(db, "2026-05-27");

    assert.equal(restored, null);
    assert.deepEqual(await listSpxGexHeatmapDates(db), []);
    assert.deepEqual(await listSpxGexHeatmapSessions(db, "2026-05-27"), []);
  });
});

describe("SPX GEX heatmap API", () => {
  it("returns dates, sessions, selected latest snapshot, and supports explicit snapshot selection", async () => {
    const db = new MemoryD1();
    await upsertSpxGexHeatmap(db, "2026-05-27", buildStructuredHeatmap("2026-05-27T13:45:00.000Z", 6000));
    await upsertSpxGexHeatmap(db, "2026-05-27", buildStructuredHeatmap("2026-05-27T14:00:00.000Z", 6010));
    await upsertSpxGexHeatmap(db, "2026-05-28", buildStructuredHeatmap("2026-05-28T14:15:00.000Z", 6020));

    const latestResponse = await getSpxGexHeatmapApi({
      request: new Request("https://example.com/api/spx-gex-heatmap?date=2026-05-27"),
      env: { SPX_RECAP_DB: db },
    });
    const latestPayload = (await latestResponse.json()) as {
      selectedDate: string;
      sessions: Array<{ snapshotMinuteEt: number; collectedTimeEt: string }>;
      selectedSnapshot: { snapshotMinuteEt: number; collectedTimeEt: string };
      heatmap: SpxGexHeatmapModel;
    };

    assert.equal(latestResponse.status, 200);
    assert.equal(latestPayload.selectedDate, "2026-05-27");
    assert.equal(latestPayload.sessions.length, 2);
    assert.equal(latestPayload.selectedSnapshot.snapshotMinuteEt, 9 * 60 + 45);
    assert.equal(latestPayload.selectedSnapshot.collectedTimeEt, "10:00");
    assert.equal(latestPayload.heatmap.quote.last, 6010);

    const selectedResponse = await getSpxGexHeatmapApi({
      request: new Request("https://example.com/api/spx-gex-heatmap?date=2026-05-27&snapshot=570"),
      env: { SPX_RECAP_DB: db },
    });
    const selectedPayload = (await selectedResponse.json()) as { heatmap: SpxGexHeatmapModel };

    assert.equal(selectedPayload.heatmap.quote.last, 6000);

    const defaultResponse = await getSpxGexHeatmapApi({
      request: new Request("https://example.com/api/spx-gex-heatmap"),
      env: { SPX_RECAP_DB: db },
    });
    const defaultPayload = (await defaultResponse.json()) as {
      selectedDate: string;
      selectedSnapshot: { snapshotMinuteEt: number };
      heatmap: SpxGexHeatmapModel;
    };

    assert.equal(defaultPayload.selectedDate, "2026-05-28");
    assert.equal(defaultPayload.selectedSnapshot.snapshotMinuteEt, 10 * 60);
    assert.equal(defaultPayload.heatmap.quote.last, 6020);
  });

  it("returns no data instead of legacy fallback when only daily legacy rows exist", async () => {
    const db = new MemoryD1();
    seedLegacyHeatmapRow(db, "2026-05-27", buildLegacyHeatmap("2026-05-27T13:15:00.000Z"));

    const response = await getSpxGexHeatmapApi({
      request: new Request("https://example.com/api/spx-gex-heatmap?date=2026-05-27"),
      env: { SPX_RECAP_DB: db },
    });
    const payload = (await response.json()) as {
      availableDates: string[];
      selectedDate: string | null;
      sessions: unknown[];
      selectedSnapshot: unknown | null;
      heatmap: SpxGexHeatmapModel | null;
    };

    assert.equal(response.status, 200);
    assert.deepEqual(payload.availableDates, []);
    assert.equal(payload.selectedDate, null);
    assert.deepEqual(payload.sessions, []);
    assert.equal(payload.selectedSnapshot, null);
    assert.equal(payload.heatmap, null);
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
      now: new Date("2026-05-27T13:45:00Z"),
    });
    const sameSlot = await generateAndStoreSpxGexHeatmap({
      db,
      dataClient: client,
      now: new Date("2026-05-27T13:45:00Z"),
    });
    const nextSlot = await generateAndStoreSpxGexHeatmap({
      db,
      dataClient: client,
      now: new Date("2026-05-27T14:00:00Z"),
    });

    assert.deepEqual(firstRun, { status: "generated", date: "2026-05-27", snapshotMinuteEt: 570, snapshotTimeEt: "09:30", collectedMinuteEt: 585, collectedTimeEt: "09:45" });
    assert.deepEqual(sameSlot, { status: "skipped_existing", date: "2026-05-27", snapshotMinuteEt: 570, snapshotTimeEt: "09:30", collectedMinuteEt: 585, collectedTimeEt: "09:45" });
    assert.deepEqual(nextSlot, { status: "generated", date: "2026-05-27", snapshotMinuteEt: 585, snapshotTimeEt: "09:45", collectedMinuteEt: 600, collectedTimeEt: "10:00" });
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

  it("does not call the data client on Juneteenth", async () => {
    const db = new MemoryD1();
    const { client, calls } = createFakeDataClient();

    const result = await generateAndStoreSpxGexHeatmap({
      db,
      dataClient: client,
      now: new Date("2026-06-19T13:45:00Z"),
    });

    assert.deepEqual(result, { status: "skipped", date: "2026-06-19", reason: "us_market_holiday" });
    assert.deepEqual(calls, []);
  });
});
