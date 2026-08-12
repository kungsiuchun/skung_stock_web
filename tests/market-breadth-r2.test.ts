import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { onRequest as getMarketBreadthApi } from "../functions/api/market-breadth";
import {
  MARKET_BREADTH_STATUS_KEY,
  MARKET_BREADTH_STATE_KEYS,
  MARKET_BREADTH_SNAPSHOT_KEYS,
  estimateMarketBreadthR2MonthlyUsage,
  publishMarketBreadthAttempt,
  publishMarketBreadthRelease,
  type MarketBreadthObjectStore,
} from "../src/lib/market-breadth-r2";
import { buildBreadthCell, calculateMarketBreadthSnapshotId, type MarketBreadthSnapshot } from "../src/lib/market-breadth";
import { toMassiveTicker } from "../src/lib/market-breadth-sources";
import { pruneMarketBreadthStateForUniverse, runGitHubMarketBreadthRefresh, type PersistedMarketBreadthState } from "../scripts/refresh-market-breadth";

const snapshot = (): MarketBreadthSnapshot => {
  const value: MarketBreadthSnapshot = ({
  schemaVersion: 1,
  snapshotId: "market-breadth-v1-2026-08-11-deadbeef",
  generatedAt: "2026-08-11T23:30:00.000Z",
  holdingsAsOf: "2026-08-11",
  priceAsOf: "2026-08-11",
  universeCount: 503,
  sectorPerformance: {
    benchmark: { symbol: "SPY", oneDay: 1, oneWeek: 2, oneMonth: 3, threeMonths: 4, yearToDate: 5 },
    rows: SECTORS.map(({ sector, etf }) => ({ sector, etf, weightPct: 100 / 11, contribution1dPctPoints: 0.09, oneDay: 1, oneWeek: 2, oneMonth: 3, threeMonths: 4, yearToDate: 5 })),
    proxyContribution1dPctPoints: 1,
    reconciliationGapPctPoints: 0,
  },
  breadth: { rows: SECTORS.map(({ sector }) => ({ sector, holdingCount: 1, windows: Object.fromEntries([5, 20, 50, 100, 200].map((period) => [`sma${period}`, { above: 1, eligible: 1, total: 1, pct: 100 }])) as never })) },
  sma200Slope: { rows: SECTORS.map(({ sector, etf }) => ({ sector, etf, windows: { session5: 1, session20: 2, session50: 3, session100: 4, session200: 5 } })) },
  coverage: { currentPriceCount: 503, constituent200DayCount: 503, constituent200DayPct: 100, totalConstituents: 503, sectorEtf400DayCount: 11, totalSectorEtfs: 11 },
  sources: [
    { id: "state-street", provider: "State Street", label: "Holdings", url: "https://example.com/state-street", role: "Universe" },
    { id: "massive", provider: "Massive", label: "Adjusted closes", url: "https://example.com/massive", role: "Prices" },
  ],
    warnings: [],
  });
  value.snapshotId = calculateMarketBreadthSnapshotId(value);
  return value;
};

class MemoryObjectStore implements MarketBreadthObjectStore {
  objects = new Map<string, string>();
  writes: string[] = [];
  reads = 0;
  async get(key: string) {
    this.reads += 1;
    const value = this.objects.get(key);
    return value === undefined ? null : { text: async () => value };
  }
  async put(key: string, value: string) {
    this.writes.push(key);
    this.objects.set(key, value);
  }
}

class FailingObjectStore extends MemoryObjectStore {
  constructor(private readonly failKey: string) { super(); }
  override async put(key: string, value: string) {
    if (key === this.failKey) throw new Error("simulated put failure");
    return super.put(key, value);
  }
}

const status = (current: null | { snapshotKey: string } = { snapshotKey: MARKET_BREADTH_SNAPSHOT_KEYS[0] }) => ({
  schemaVersion: 1,
  state: { key: MARKET_BREADTH_STATE_KEYS[0], updatedAt: "2026-08-11T23:30:00.000Z" },
  current: current && { ...current, releaseId: "r1", snapshotId: snapshot().snapshotId, stateKey: "market-breadth/state/prices-v1.json", priceAsOf: "2026-08-11", holdingsAsOf: "2026-08-11", publishedAt: "2026-08-11T23:30:00.000Z" },
  lastAttempt: { runId: "run-1", status: "READY", startedAt: "2026-08-11T23:29:00.000Z", finishedAt: "2026-08-11T23:30:00.000Z", priceAsOf: "2026-08-11", errorClass: null },
});

describe("Market Breadth R2 architecture", () => {
  it("stays inside Cloudflare free limits even at the Pages Functions free request ceiling", () => {
    const usage = estimateMarketBreadthR2MonthlyUsage({ days: 31, apiRequestsPerDay: 100_000, refreshRunsPerDay: 2 });
    assert.deepEqual(usage, { classAOperations: 248, classBOperations: 6_200_124, apiFunctionRequests: 3_100_000 });
    assert.equal(usage.classAOperations < 1_000_000, true);
    assert.equal(usage.classBOperations < 10_000_000, true);
  });

  it("publishes release objects before atomically moving the status pointer", async () => {
    const store = new MemoryObjectStore();
    await publishMarketBreadthRelease(store, {
      previousStatus: null,
      releaseId: "r1",
      snapshot: snapshot(),
      stateJson: "{\"schemaVersion\":1}",
      attempt: status().lastAttempt,
    });
    assert.deepEqual(store.writes, [
      MARKET_BREADTH_STATE_KEYS[0],
      MARKET_BREADTH_SNAPSHOT_KEYS[0],
      "market-breadth/runs/slot-60.json",
      MARKET_BREADTH_STATUS_KEY,
    ]);
  });

  it("keeps the old state/status pointer when a later READY object upload fails", async () => {
    const store = new FailingObjectStore(MARKET_BREADTH_SNAPSHOT_KEYS[1]);
    const oldStatus = status();
    store.objects.set(MARKET_BREADTH_STATUS_KEY, JSON.stringify(oldStatus));
    await assert.rejects(() => publishMarketBreadthRelease(store, {
      previousStatus: oldStatus,
      releaseId: "r2",
      snapshot: snapshot(),
      stateJson: "{\"schemaVersion\":1,\"new\":true}",
      attempt: { ...oldStatus.lastAttempt, runId: "run-2" },
    }), /simulated put failure/);
    assert.equal(store.objects.get(MARKET_BREADTH_STATUS_KEY), JSON.stringify(oldStatus));
    assert.equal(oldStatus.state.key, MARKET_BREADTH_STATE_KEYS[0]);
    assert.equal(store.objects.has(MARKET_BREADTH_STATE_KEYS[1]), true);
  });

  it("does not overwrite last-good after READY, PARTIAL, then failed READY publish", async () => {
    const store = new FailingObjectStore(MARKET_BREADTH_SNAPSHOT_KEYS[1]);
    const first = await publishMarketBreadthRelease(store, {
      previousStatus: null,
      releaseId: "r1",
      snapshot: snapshot(),
      stateJson: "{\"state\":\"ready-a\"}",
      attempt: status().lastAttempt,
    });
    const partialAttempt = { ...first.lastAttempt, runId: "run-partial", status: "PARTIAL" as const, finishedAt: "2026-08-12T22:47:00.000Z", errorClass: "BACKFILL_INCOMPLETE" };
    const partial = await publishMarketBreadthAttempt(store, { previousStatus: first, attempt: partialAttempt, stateJson: "{\"state\":\"partial-b\"}" });
    const lastGoodJson = store.objects.get(MARKET_BREADTH_SNAPSHOT_KEYS[0]);
    await assert.rejects(() => publishMarketBreadthRelease(store, {
      previousStatus: partial,
      releaseId: "r2",
      snapshot: { ...snapshot(), generatedAt: "2026-08-12T23:32:00.000Z" },
      stateJson: "{\"state\":\"ready-a2\"}",
      attempt: { ...partialAttempt, runId: "run-ready-2", status: "READY", finishedAt: "2026-08-12T23:32:00.000Z", errorClass: null },
    }), /simulated put failure/);
    assert.equal(store.objects.get(MARKET_BREADTH_STATUS_KEY), JSON.stringify(partial));
    assert.equal(store.objects.get(MARKET_BREADTH_SNAPSHOT_KEYS[0]), lastGoodJson);
    assert.equal(partial.current?.snapshotKey, MARKET_BREADTH_SNAPSHOT_KEYS[0]);
  });

  it("persists partial initial-backfill progress for the next GitHub Actions run", async () => {
    const store = new MemoryObjectStore();
    const universe = {
      holdingsAsOf: "2026-08-11",
      holdings: SECTORS.map(({ sector, etf }, index) => ({ ticker: `TEST${index}`, name: `Test ${index}`, weightPct: index === 10 ? 10 : 9, sector, sectorEtf: etf })),
      sectorWeights: SECTORS.map(({ sector, etf }, index) => ({ sector, etf, weightPct: index === 10 ? 10 : 9, holdingCount: 1 })),
      universeCount: 11,
      totalWeightPct: 100,
    };
    const result = await runGitHubMarketBreadthRefresh({
      store,
      mode: "BACKFILL",
      now: new Date("2026-08-11T22:47:00.000Z"),
      backfillBatchSize: 1,
      client: {
        fetchUniverse: async () => universe,
        fetchDailySummary: async () => new Map(),
        fetchCustomBars: async () => Array.from({ length: 420 }, (_, index) => ({ date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10), close: 100 + index })),
      },
    });
    assert.equal(result.status, "PARTIAL");
    const persistedState = JSON.parse(store.objects.get(MARKET_BREADTH_STATE_KEYS[0]) || "{}") as { series?: Record<string, unknown[]>; attempts?: Record<string, string[]> };
    assert.equal(persistedState.series?.SPY?.length, 420);
    assert.deepEqual(Object.values(persistedState.attempts || {}), [["SPY"]]);
    const persistedStatus = JSON.parse(store.objects.get(MARKET_BREADTH_STATUS_KEY) || "{}") as { current?: unknown; lastAttempt?: { status?: string } };
    assert.equal(persistedStatus.current, null);
    assert.equal(persistedStatus.lastAttempt?.status, "PARTIAL");
  });

  it("prunes departed symbols and old membership attempt scopes", () => {
    const universe = {
      holdingsAsOf: "2026-08-12",
      holdings: [{ ticker: "AAPL", name: "Apple", weightPct: 100, sector: "Information Technology", sectorEtf: "XLK" }],
      sectorWeights: SECTORS.map(({ sector, etf }, index) => ({ sector, etf, weightPct: index === 7 ? 100 : 0, holdingCount: index === 7 ? 1 : 0 })),
      universeCount: 1,
      totalWeightPct: 100,
    };
    const state: PersistedMarketBreadthState = {
      schemaVersion: 1,
      universe: null,
      series: { SPY: [], AAPL: [], DEPARTED: [], XLK: [] },
      attempts: { "old-scope": ["DEPARTED"] },
      latestSnapshot: null,
      updatedAt: "2026-08-12T00:00:00.000Z",
    };
    pruneMarketBreadthStateForUniverse(state, universe);
    assert.equal("DEPARTED" in state.series, false);
    assert.equal("AAPL" in state.series, true);
    assert.equal("SPY" in state.series, true);
    assert.deepEqual(state.attempts, {});
  });

  it("serves a READY snapshot using exactly two R2 reads", async () => {
    const store = new MemoryObjectStore();
    store.objects.set(MARKET_BREADTH_STATUS_KEY, JSON.stringify(status()));
    store.objects.set(MARKET_BREADTH_SNAPSHOT_KEYS[0], JSON.stringify(snapshot()));
    const response = await getMarketBreadthApi({ request: new Request("https://example.com/api/market-breadth"), env: { MARKET_BREADTH_DATA: store }, now: new Date("2026-08-12T00:00:00.000Z") });
    assert.equal(response.status, 200);
    assert.equal(store.reads, 2);
    const payload = await response.json() as { status: string; snapshotId: string };
    assert.equal(payload.status, "READY");
    assert.equal(payload.snapshotId, snapshot().snapshotId);
  });

  it("returns EMPTY without inventing data and rejects non-GET methods", async () => {
    const store = new MemoryObjectStore();
    store.objects.set(MARKET_BREADTH_STATUS_KEY, JSON.stringify(status(null)));
    const empty = await getMarketBreadthApi({ request: new Request("https://example.com/api/market-breadth"), env: { MARKET_BREADTH_DATA: store } });
    assert.equal(empty.status, 404);
    const method = await getMarketBreadthApi({ request: new Request("https://example.com/api/market-breadth", { method: "POST" }), env: { MARKET_BREADTH_DATA: store } });
    assert.equal(method.status, 405);
  });

  it("returns 503 when the R2 binding is absent", async () => {
    const response = await getMarketBreadthApi({ request: new Request("https://example.com/api/market-breadth"), env: {} });
    assert.equal(response.status, 503);
  });

  it("preserves last-good and marks it STALE after a failed attempt", async () => {
    const store = new MemoryObjectStore();
    const failedStatus = status();
    failedStatus.lastAttempt = { ...failedStatus.lastAttempt, status: "FAILED", finishedAt: "2026-08-11T23:45:00.000Z", errorClass: "PROVIDER_UNAVAILABLE" };
    store.objects.set(MARKET_BREADTH_STATUS_KEY, JSON.stringify(failedStatus));
    store.objects.set(MARKET_BREADTH_SNAPSHOT_KEYS[0], JSON.stringify(snapshot()));
    const response = await getMarketBreadthApi({ request: new Request("https://example.com/api/market-breadth"), env: { MARKET_BREADTH_DATA: store }, now: new Date("2026-08-12T00:00:00.000Z") });
    const payload = await response.json() as { freshness: { status: string; errorClass: string }; snapshotId: string };
    assert.equal(response.status, 200);
    assert.equal(payload.freshness.status, "STALE");
    assert.equal(payload.freshness.errorClass, "PROVIDER_UNAVAILABLE");
    assert.equal(payload.snapshotId, snapshot().snapshotId);
  });

  it("rejects shallow-but-empty snapshot rows", async () => {
    const store = new MemoryObjectStore();
    store.objects.set(MARKET_BREADTH_STATUS_KEY, JSON.stringify(status()));
    store.objects.set(MARKET_BREADTH_SNAPSHOT_KEYS[0], JSON.stringify({ ...snapshot(), breadth: { rows: Array.from({ length: 11 }, () => ({})) } }));
    const response = await getMarketBreadthApi({ request: new Request("https://example.com/api/market-breadth"), env: { MARKET_BREADTH_DATA: store } });
    assert.equal(response.status, 500);
  });

  it("rejects a payload whose snapshotId hash was not recomputed", async () => {
    const store = new MemoryObjectStore();
    const tampered = snapshot();
    tampered.warnings = ["tampered after publication"];
    store.objects.set(MARKET_BREADTH_STATUS_KEY, JSON.stringify(status()));
    store.objects.set(MARKET_BREADTH_SNAPSHOT_KEYS[0], JSON.stringify(tampered));
    const response = await getMarketBreadthApi({ request: new Request("https://example.com/api/market-breadth"), env: { MARKET_BREADTH_DATA: store } });
    assert.equal(response.status, 500);
  });

  it("exposes provider and R2 secrets only to the final publish step", () => {
    const workflow = readFileSync(new URL("../.github/workflows/refresh-market-breadth.yml", import.meta.url), "utf8");
    const beforeSteps = workflow.slice(0, workflow.indexOf("    steps:"));
    assert.doesNotMatch(beforeSteps, /MASSIVE_API_KEY|R2_ACCESS_KEY|R2_SECRET/);
    assert.match(workflow, /Compute and atomically publish[\s\S]*MASSIVE_API_KEY:[\s\S]*MARKET_BREADTH_R2_SECRET_ACCESS_KEY:/);
  });
});

describe("Market Breadth audit regressions", () => {
  it("uses Massive's dot notation for share classes", () => {
    assert.equal(toMassiveTicker("BRK-B"), "BRK.B");
    assert.equal(toMassiveTicker("BF-B"), "BF.B");
    assert.equal(toMassiveTicker("AAPL"), "AAPL");
  });

  it("excludes a constituent whose last bar is stale from the eligible denominator", () => {
    const cell = buildBreadthCell([
      [{ date: "2026-08-08", close: 1 }, { date: "2026-08-11", close: 2 }],
      [{ date: "2026-08-07", close: 1 }, { date: "2026-08-10", close: 2 }],
    ], 2, "2026-08-11");
    assert.deepEqual(cell, { above: 1, eligible: 1, total: 2, pct: 100 });
  });
});

const SECTORS = [
  ["Communication Services", "XLC"], ["Consumer Discretionary", "XLY"], ["Consumer Staples", "XLP"],
  ["Energy", "XLE"], ["Financials", "XLF"], ["Health Care", "XLV"], ["Industrials", "XLI"],
  ["Information Technology", "XLK"], ["Materials", "XLB"], ["Real Estate", "XLRE"], ["Utilities", "XLU"],
].map(([sector, etf]) => ({ sector, etf }));
