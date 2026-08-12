import assert from "node:assert/strict";
import test from "node:test";
import {
  loadRobinhoodOptionsSnapshot,
  robinhoodGex,
  toRobinhoodOptionsView,
  type RobinhoodOptionsR2BucketLike,
} from "../src/lib/stocks-watcher-robinhood-options";

const hash = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))).map((item) => item.toString(16).padStart(2, "0")).join("");
const now = new Date().toISOString();
const symbols = Array.from({ length: 50 }, (_, index) => `T${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`);

const makeBucket = async (overrides: { missingIv?: boolean; staleQuote?: boolean; duplicate?: boolean; manifestHash?: string; completedSymbols?: number } = {}) => {
  const releaseId = "2026-08-12-eod";
  const runId = "run-123";
  const objects = new Map<string, string>();
  const entries: { symbol: string; key: string; sha256: string; contracts: number }[] = [];
  for (const symbol of symbols) {
    const contract = { symbol, expiry: "2026-08-21", strike: 100, callPut: "call", multiplier: 100, openInterest: 100, gamma: 0.01, impliedVolatility: overrides.missingIv && symbol === "TAA" ? null : 0.25, delta: 0.5, volume: 12, mark: 3.2, quoteUpdatedAt: overrides.staleQuote && symbol === "TAA" ? "2026-08-01T00:00:00.000Z" : now, spot: 100, capturedAt: now };
    const contracts = overrides.duplicate && symbol === "TAA" ? [contract, contract] : [contract];
    const key = `releases/${releaseId}/symbols/${symbol}.json`;
    const text = JSON.stringify({ schemaVersion: "1.0", provider: "robinhood_mcp", releaseId, runId, symbol, capturedAt: now, spot: 100, contracts });
    objects.set(key, text);
    entries.push({ symbol, key, sha256: await hash(text), contracts: contracts.length });
  }
  const manifestKey = `releases/${releaseId}/manifest.json`;
  const manifest = JSON.stringify({ schemaVersion: "1.0", provider: "robinhood_mcp", releaseId, runId, capturedAt: now, expectedSymbols: 50, completedSymbols: overrides.completedSymbols ?? 50, symbols: entries });
  objects.set(manifestKey, manifest);
  objects.set("current.json", JSON.stringify({ schemaVersion: "1.0", provider: "robinhood_mcp", releaseId, runId, manifestKey, manifestSha256: overrides.manifestHash ?? await hash(manifest), capturedAt: now, expectedSymbols: 50, completedSymbols: overrides.completedSymbols ?? 50 }));
  const bucket: RobinhoodOptionsR2BucketLike = { get: async (key) => objects.has(key) ? { text: async () => objects.get(key)! } : null };
  return bucket;
};

test("valid immutable 50-symbol release produces OI-signed GEX rows", async () => {
  const snapshot = await loadRobinhoodOptionsSnapshot(await makeBucket(), "TAA");
  const contract = snapshot.contracts[0];
  assert.equal(robinhoodGex(contract), 10_000);
  const view = toRobinhoodOptionsView(snapshot);
  assert.deepEqual(view.availableExpiries, ["2026-08-21"]);
  assert.equal(view.strikes[0]?.netGex, 10_000);
  assert.equal(snapshot.manifest.completedSymbols, 50);
});

test("missing IV, stale quote, duplicate contracts, partial run, and manifest hash mismatch fail closed", async () => {
  for (const input of [{ missingIv: true }, { staleQuote: true }, { duplicate: true }, { completedSymbols: 49 }, { manifestHash: "0".repeat(64) }]) {
    await assert.rejects(() => makeBucket(input).then((bucket) => loadRobinhoodOptionsSnapshot(bucket, "TAA")), /ROBINHOOD_OPTIONS_(INVALID|STALE)/);
  }
});
