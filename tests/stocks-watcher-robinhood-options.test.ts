import assert from "node:assert/strict";
import test from "node:test";
import {
  ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS,
  loadRobinhoodOptionsSnapshot,
  robinhoodGex,
  toRobinhoodOptionsToolPayload,
  toRobinhoodOptionsView,
  type RobinhoodOptionsR2BucketLike,
} from "../src/lib/stocks-watcher-robinhood-options";
import { normalizeOptionsVisualModel, optionsExpiryMatchesRequest } from "../src/lib/stocks-watcher-options-visual";

const hash = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))).map((item) => item.toString(16).padStart(2, "0")).join("");
const now = new Date().toISOString();
const symbols = Array.from({ length: ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS }, (_, index) => `T${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`);

const fixtureExpiries = ["2026-08-21", "2026-08-24", "2026-08-28", "2026-08-31", "2026-09-02", "2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25"];

const makeBucket = async (overrides: { missingIv?: boolean; staleQuote?: boolean; duplicate?: boolean; manifestHash?: string; completedSymbols?: number; multiExpiry?: boolean; expiryCount?: number } = {}) => {
  const releaseId = "2026-08-12-eod";
  const runId = "run-123";
  const objects = new Map<string, string>();
  const entries: { symbol: string; key: string; sha256: string; contracts: number }[] = [];
  for (const symbol of symbols) {
    const selectedExpiries = overrides.expiryCount !== undefined
      ? fixtureExpiries.slice(0, overrides.expiryCount)
      : overrides.multiExpiry
        ? [fixtureExpiries[0], fixtureExpiries[2]]
        : [fixtureExpiries[0]];
    const contracts = selectedExpiries.map((expiry, index) => {
      const legacyLaterPut = overrides.expiryCount === undefined && overrides.multiExpiry && index === 1;
      return {
        symbol,
        expiry,
        strike: legacyLaterPut ? 105 : 100 + index,
        callPut: index % 2 === 0 ? "call" as const : "put" as const,
        multiplier: 100,
        openInterest: legacyLaterPut ? 80 : 100 - index,
        gamma: legacyLaterPut ? 0.02 : 0.01 + index * 0.001,
        impliedVolatility: overrides.missingIv && symbol === "TAA" && index === 0 ? null : 0.25,
        delta: index % 2 === 0 ? 0.5 : -0.4,
        volume: legacyLaterPut ? 20 : 12 + index,
        mark: 3.2,
        quoteUpdatedAt: overrides.staleQuote && symbol === "TAA" && index === 0 ? "2026-08-01T00:00:00.000Z" : now,
        spot: 100,
        capturedAt: now,
      };
    });
    const publishedContracts = overrides.duplicate && symbol === "TAA" ? [contracts[0], contracts[0]] : contracts;
    const key = `releases/${releaseId}/symbols/${symbol}.json`;
    const text = JSON.stringify({ schemaVersion: "1.0", provider: "robinhood_mcp", releaseId, runId, symbol, capturedAt: now, spot: 100, contracts: publishedContracts });
    objects.set(key, text);
    entries.push({ symbol, key, sha256: await hash(text), contracts: publishedContracts.length });
  }
  const manifestKey = `releases/${releaseId}/manifest.json`;
  const manifest = JSON.stringify({ schemaVersion: "1.0", provider: "robinhood_mcp", releaseId, runId, capturedAt: now, expectedSymbols: ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS, completedSymbols: overrides.completedSymbols ?? ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS, symbols: entries });
  objects.set(manifestKey, manifest);
  objects.set("current.json", JSON.stringify({ schemaVersion: "1.0", provider: "robinhood_mcp", releaseId, runId, manifestKey, manifestSha256: overrides.manifestHash ?? await hash(manifest), capturedAt: now, expectedSymbols: ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS, completedSymbols: overrides.completedSymbols ?? ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS }));
  const bucket: RobinhoodOptionsR2BucketLike = { get: async (key) => objects.has(key) ? { text: async () => objects.get(key)! } : null };
  return bucket;
};

test("valid immutable 20-symbol release produces OI-signed GEX rows", async () => {
  const snapshot = await loadRobinhoodOptionsSnapshot(await makeBucket(), "TAA");
  const contract = snapshot.contracts[0];
  assert.equal(robinhoodGex(contract), 10_000);
  const view = toRobinhoodOptionsView(snapshot);
  assert.deepEqual(view.availableExpiries, ["2026-08-21"]);
  assert.equal(view.strikes[0]?.netGex, 10_000);
  assert.equal(view.expiryRows[0]?.netGex, 10_000);
  assert.equal(view.expiryRows[0]?.netDex, 500_000);
  assert.equal(snapshot.manifest.completedSymbols, ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS);
});

test("accepts one to eight expiries and rejects a ninth expiry", async () => {
  const snapshot = await loadRobinhoodOptionsSnapshot(await makeBucket({ expiryCount: 8 }), "TAA");
  assert.deepEqual(toRobinhoodOptionsView(snapshot).availableExpiries, fixtureExpiries.slice(0, 8));
  await assert.rejects(
    () => makeBucket({ expiryCount: 9 }).then((bucket) => loadRobinhoodOptionsSnapshot(bucket, "TAA")),
    /ROBINHOOD_OPTIONS_INVALID: symbol snapshot must contain one to 8 expiries/,
  );
});

test("missing IV, stale quote, duplicate contracts, partial run, and manifest hash mismatch fail closed", async () => {
  for (const input of [{ missingIv: true }, { staleQuote: true }, { duplicate: true }, { completedSymbols: ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS - 1 }, { manifestHash: "0".repeat(64) }]) {
    await assert.rejects(() => makeBucket(input).then((bucket) => loadRobinhoodOptionsSnapshot(bucket, "TAA")), /ROBINHOOD_OPTIONS_(INVALID|STALE)/);
  }
});

test("provider-neutral visual model renders Robinhood direct payloads without Yahoo-only wrappers", () => {
  const capturedAt = "2026-08-18T22:59:27.540Z";
  const chainRaw = {
    source: "robinhood_mcp",
    spot: 219.74,
    selectedExpiry: "2026-08-21",
    expiries: ["2026-08-21", "2026-08-28"],
    calls: [{ strike: 220, openInterest: 1_200, volume: 420, impliedVolatility: 0.42, gamma: 0.031, delta: 0.54, mark: 5.2, multiplier: 100, quoteUpdatedAt: capturedAt }],
    puts: [{ strike: 220, openInterest: 900, volume: 610, impliedVolatility: 0.46, gamma: 0.029, delta: -0.46, mark: 4.8, multiplier: 100, quoteUpdatedAt: capturedAt }],
    provenance: { provider: "robinhood_mcp", capturedAt, runId: "rh-eod-2026-08-18", methodology: "OI-signed GEX proxy" },
  };
  const exposureRaw = {
    source: "robinhood_mcp",
    exposures: [{
      strike: 220,
      callOpenInterest: 1_200,
      putOpenInterest: 900,
      callVolume: 420,
      putVolume: 610,
      callGex: 179_680_000,
      putGex: -126_120_000,
      netGex: 53_560_000,
      callDex: 1_423_915_200,
      putDex: -909_304_800,
      netDex: 514_610_400,
      callIv: 42,
      putIv: 46,
      avgIv: 44,
    }],
    provenance: chainRaw.provenance,
  };

  const model = normalizeOptionsVisualModel({ chainRaw, exposureRaw, now: Date.parse("2026-08-19T01:00:00.000Z") });

  assert.equal(model.provider, "robinhood_mcp");
  assert.equal(model.expiry, "2026-08-21");
  assert.equal(model.freshness, "fresh");
  assert.deepEqual(model.capabilities, {
    chain: true,
    openInterest: true,
    volume: true,
    gex: true,
    dex: true,
    greeks: true,
    ivSmile: true,
  });
  assert.deepEqual(model.strikeRows[0], exposureRaw.exposures[0]);
});

test("Robinhood expiry view follows the requested expiry instead of reusing the front expiry", async () => {
  const snapshot = await loadRobinhoodOptionsSnapshot(await makeBucket({ multiExpiry: true }), "TAA");
  const view = toRobinhoodOptionsView(snapshot, "2026-08-28");

  assert.equal(view.selectedExpiry, "2026-08-28");
  assert.deepEqual(view.availableExpiries, ["2026-08-21", "2026-08-28"]);
  assert.equal(view.strikes[0]?.strike, 105);
  assert.equal(view.strikes[0]?.putOpenInterest, 80);
  assert.ok((view.strikes[0]?.netGex || 0) < 0);
  assert.ok((view.expiryRows.find((row) => row.expiry === "2026-08-28")?.netGex || 0) < 0);
  assert.ok((view.expiryRows.find((row) => row.expiry === "2026-08-28")?.netDex || 0) < 0);
});

test("provider-neutral expiry guard rejects a response labelled with another expiry", () => {
  assert.equal(optionsExpiryMatchesRequest({ chain: { selectedExpiry: "2026-08-21" } }, "2026-08-21"), true);
  assert.equal(optionsExpiryMatchesRequest({ chain: { selectedExpiry: "2026-08-21" } }, "2026-08-24"), false);
  assert.equal(optionsExpiryMatchesRequest({ calls: [], puts: [], selectedExpiry: "2026-08-24" }, "2026-08-24"), true);
  assert.equal(optionsExpiryMatchesRequest(null, "2026-08-24"), false);
});

test("provider-neutral visual model preserves missing and stale evidence instead of zero-filling", () => {
  const capturedAt = "2026-08-16T20:00:00.000Z";
  const model = normalizeOptionsVisualModel({
    chainRaw: {
      chain: {
        spot: 100,
        selectedExpiry: "2026-08-21",
        expiries: ["2026-08-21"],
        calls: [{ strike: 100, volume: 12 }],
        puts: [{ strike: 100, volume: 9 }],
      },
      provenance: { provider: "native_yahoo", capturedAt, methodology: "Yahoo option chain" },
    },
    exposureRaw: null,
    now: Date.parse("2026-08-19T01:00:00.000Z"),
  });

  assert.equal(model.freshness, "stale");
  assert.equal(model.capabilities.volume, true);
  assert.equal(model.capabilities.openInterest, false);
  assert.equal(model.capabilities.gex, false);
  assert.equal(model.strikeRows.length, 0);
  assert.match(model.unavailableReasons.openInterest || "", /open interest/i);
  assert.match(model.unavailableReasons.gex || "", /GEX/i);
});

test("Robinhood tool adapter emits native visual contracts and explicit unsupported states", async () => {
  const snapshot = await loadRobinhoodOptionsSnapshot(await makeBucket({ multiExpiry: true }), "TAA");
  const chain = toRobinhoodOptionsToolPayload(snapshot, "get_options", { expiry: "2026-08-28" });
  const gex = toRobinhoodOptionsToolPayload(snapshot, "get_options_gex", { expiry: "2026-08-28" });
  const dex = toRobinhoodOptionsToolPayload(snapshot, "get_options_dex", { expiry: "2026-08-28" });
  const iv = toRobinhoodOptionsToolPayload(snapshot, "get_options_iv_intraday", { expiry: "2026-08-28" });
  const flow = toRobinhoodOptionsToolPayload(snapshot, "get_options_flow_universe", {});
  const sweeps = toRobinhoodOptionsToolPayload(snapshot, "get_options_sweeps", {});

  assert.equal((chain.raw.chain as { selectedExpiry: string }).selectedExpiry, "2026-08-28");
  assert.equal((chain.raw.chain as { puts: unknown[] }).puts.length, 1);
  assert.equal((gex.raw.exposures as { netGex: number }[])[0]?.netGex < 0, true);
  assert.equal((dex.raw.exposures as { netDex: number }[])[0]?.netDex < 0, true);
  assert.equal(iv.raw.metric, "eod_iv_smile");
  assert.equal(iv.raw.timeSeries, false);
  assert.equal(flow.raw.supported, false);
  assert.match(String(flow.raw.unavailableReason), /tape-level options flow/i);
  assert.equal(sweeps.raw.supported, false);
  assert.match(String(sweeps.raw.unavailableReason), /sweep detection/i);
  assert.match(chain.text, /Robinhood MCP EOD/i);
  assert.match(gex.text, /OI-signed proxy, not dealer GEX/i);
});
