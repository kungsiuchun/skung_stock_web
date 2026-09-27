import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { onRequest as getSectorRotationApi } from "../functions/api/sector-rotation";
import { onRequest as getMarketBreadthApi } from "../functions/api/market-breadth";
import { buildSectorRotationForBreadthState, runGitHubMarketBreadthRefresh, type PersistedMarketBreadthState } from "../scripts/refresh-market-breadth";
import { MARKET_BREADTH_SECTORS, buildMarketBreadthSnapshot, type PriceBar, type SectorUniverse } from "../src/lib/market-breadth";
import {
  MARKET_BREADTH_STATUS_KEY,
  MARKET_BREADTH_STATE_KEYS,
  MARKET_BREADTH_SNAPSHOT_KEYS,
  publishMarketBreadthAttempt,
  publishMarketBreadthRelease,
  validateMarketBreadthStatus,
  type MarketBreadthObjectStore,
} from "../src/lib/market-breadth-r2";
import { buildSectorRotationSnapshot } from "../src/lib/sector-rotation";
import { SECTOR_ROTATION_SNAPSHOT_KEYS, publishSectorRotationForCurrentRelease } from "../src/lib/sector-rotation-r2";
import { isNyseTradingDay } from "../src/lib/nyse-calendar";
import { MarketBreadthSourceError } from "../src/lib/market-breadth-sources";

class MemoryObjectStore implements MarketBreadthObjectStore {
  objects = new Map<string, string>();
  reads: string[] = [];
  writes: string[] = [];
  failKey: string | null = null;
  async get(key: string) {
    this.reads.push(key);
    const value = this.objects.get(key);
    return value === undefined ? null : { text: async () => value };
  }
  async put(key: string, value: string) {
    if (key === this.failKey) throw new Error("simulated rotation upload failure");
    this.writes.push(key);
    this.objects.set(key, value);
  }
}

const fixture = (priceAsOf = "2026-08-11", generatedAt = "2026-08-11T23:30:00.000Z") => {
  const dates: string[] = [];
  const cursor = new Date(`${priceAsOf}T12:00:00.000Z`);
  while (dates.length < 420) {
    const date = cursor.toISOString().slice(0, 10);
    if (isNyseTradingDay(date)) dates.unshift(date);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  const universe: SectorUniverse = {
    holdingsAsOf: priceAsOf,
    holdings: MARKET_BREADTH_SECTORS.map(({ sector, etf }, index) => ({ ticker: `TEST${index}`, name: `Company ${index}`, weightPct: 100 / 11, sector, sectorEtf: etf })),
    sectorWeights: MARKET_BREADTH_SECTORS.map(({ sector, etf }) => ({ sector, etf, weightPct: 100 / 11, holdingCount: 1 })),
    universeCount: 11,
    totalWeightPct: 100,
  };
  const symbols = ["SPY", ...MARKET_BREADTH_SECTORS.map(({ etf }) => etf), ...universe.holdings.map(({ ticker }) => ticker)];
  const priceSeries = new Map(symbols.map((symbol, symbolIndex) => [symbol, dates.map((date, index) => ({ date, close: 100 * Math.exp(index * (0.0003 + symbolIndex * 0.00002)) }))]));
  const snapshot = buildMarketBreadthSnapshot({ generatedAt, priceAsOf, universe, priceSeries });
  const rotation = buildSectorRotationSnapshot({ generatedAt, priceAsOf, universe, priceSeries, sourceSnapshotId: snapshot.snapshotId });
  const state: PersistedMarketBreadthState = { schemaVersion: 1, universe, series: Object.fromEntries(priceSeries), attempts: {}, latestSnapshot: snapshot, updatedAt: generatedAt };
  const attempt = { runId: "run-ready", status: "READY" as const, startedAt: generatedAt, finishedAt: generatedAt, priceAsOf, errorClass: null };
  return { universe, priceSeries, snapshot, rotation, state, attempt };
};

const publishFixture = async (store: MemoryObjectStore, includeRotation = true) => {
  const data = fixture();
  const status = await publishMarketBreadthRelease(store, {
    previousStatus: null,
    releaseId: "release-1",
    snapshot: data.snapshot,
    ...(includeRotation ? { rotationSnapshot: data.rotation } : {}),
    stateJson: JSON.stringify(data.state),
    attempt: data.attempt,
  });
  return { ...data, status };
};

const api = (store: MemoryObjectStore) => getSectorRotationApi({ request: new Request("https://example.com/api/sector-rotation"), env: { MARKET_BREADTH_DATA: store }, now: new Date("2026-08-12T00:00:00.000Z") });

const noProviderClient = {
  fetchUniverse: async (): Promise<SectorUniverse> => { throw new Error("Bootstrap must not fetch holdings."); },
  fetchDailySummary: async (): Promise<Map<string, PriceBar>> => { throw new Error("Bootstrap must not fetch prices."); },
  fetchCustomBars: async (): Promise<PriceBar[]> => { throw new Error("Bootstrap must not fetch history."); },
};

describe("Sector rotation shared release publication", () => {
  it("writes both inactive snapshots before moving the shared READY pointer", async () => {
    const store = new MemoryObjectStore();
    const { status, rotation } = await publishFixture(store);
    assert.deepEqual(store.writes.slice(0, 3), [MARKET_BREADTH_STATE_KEYS[0], MARKET_BREADTH_SNAPSHOT_KEYS[0], SECTOR_ROTATION_SNAPSHOT_KEYS[0]]);
    assert.equal(store.writes[store.writes.length - 1], MARKET_BREADTH_STATUS_KEY);
    assert.equal(status.current?.rotationSnapshotId, rotation.snapshotId);
    const second = await publishMarketBreadthRelease(store, { previousStatus: status, releaseId: "release-2", snapshot: fixture().snapshot, rotationSnapshot: fixture().rotation, stateJson: "{}", attempt: fixture().attempt });
    assert.equal(second.current?.rotationKey, SECTOR_ROTATION_SNAPSHOT_KEYS[1]);
    assert.equal(second.current?.snapshotKey, MARKET_BREADTH_SNAPSHOT_KEYS[1]);
  });

  it("keeps the previous pointer and rotation object when the next rotation upload fails", async () => {
    const store = new MemoryObjectStore();
    const { status, snapshot, rotation, state, attempt } = await publishFixture(store);
    const previousPointer = store.objects.get(MARKET_BREADTH_STATUS_KEY);
    const previousRotation = store.objects.get(SECTOR_ROTATION_SNAPSHOT_KEYS[0]);
    store.failKey = SECTOR_ROTATION_SNAPSHOT_KEYS[1];
    await assert.rejects(() => publishMarketBreadthRelease(store, { previousStatus: status, releaseId: "release-2", snapshot, rotationSnapshot: rotation, stateJson: JSON.stringify(state), attempt }), /simulated rotation upload failure/);
    assert.equal(store.objects.get(MARKET_BREADTH_STATUS_KEY), previousPointer);
    assert.equal(store.objects.get(SECTOR_ROTATION_SNAPSHOT_KEYS[0]), previousRotation);
    assert.equal((await api(store)).status, 200);
  });

  it("rejects source identity mismatches before uploading any release objects", async () => {
    const store = new MemoryObjectStore();
    const data = fixture();
    const mismatched = buildSectorRotationSnapshot({ universe: data.universe, priceSeries: data.priceSeries, priceAsOf: data.snapshot.priceAsOf, generatedAt: data.snapshot.generatedAt, sourceSnapshotId: "market-breadth-v1-2026-08-11-deadbeef" });
    await assert.rejects(() => publishMarketBreadthRelease(store, { previousStatus: null, releaseId: "bad-release", snapshot: data.snapshot, rotationSnapshot: mismatched, stateJson: JSON.stringify(data.state), attempt: data.attempt }), /SOURCE_POINTER_MISMATCH/);
    assert.deepEqual(store.writes, []);
  });
});

describe("Sector rotation API", () => {
  it("serves READY with exactly two R2 reads and preserves the breadth API", async () => {
    const store = new MemoryObjectStore();
    const { rotation } = await publishFixture(store);
    store.reads = [];
    const response = await api(store);
    assert.equal(response.status, 200);
    assert.deepEqual(store.reads, [MARKET_BREADTH_STATUS_KEY, SECTOR_ROTATION_SNAPSHOT_KEYS[0]]);
    const body = await response.json() as { snapshotId: string; status: string; freshness: { status: string } };
    assert.equal(body.snapshotId, rotation.snapshotId);
    assert.equal(body.status, "READY");
    assert.equal(body.freshness.status, "FRESH");
    store.reads = [];
    assert.equal((await getMarketBreadthApi({ request: new Request("https://example.com/api/market-breadth"), env: { MARKET_BREADTH_DATA: store } })).status, 200);
    assert.deepEqual(store.reads, [MARKET_BREADTH_STATUS_KEY, MARKET_BREADTH_SNAPSHOT_KEYS[0]]);
  });

  it("returns explicit EMPTY for legacy or absent releases and validates optional pointer fields", async () => {
    const store = new MemoryObjectStore();
    assert.equal((await api(store)).status, 404);
    const { status } = await publishFixture(store, false);
    assert.equal(validateMarketBreadthStatus(status).current?.rotationKey, undefined);
    assert.equal((await api(store)).status, 404);
    assert.throws(() => validateMarketBreadthStatus({ ...status, current: { ...status.current, rotationKey: SECTOR_ROTATION_SNAPSHOT_KEYS[0] } }), /pointer is invalid/);
    assert.throws(() => validateMarketBreadthStatus({ ...status, current: { ...status.current, rotationKey: "arbitrary/prices.json", rotationSnapshotId: "invalid" } }), /pointer is invalid/);
  });

  it("rejects missing, corrupt, and mismatched pointed objects with safe errors", async () => {
    for (const mutation of ["missing", "json", "payload", "source", "holdings", "price", "generation", "rotation-id"] as const) {
      const store = new MemoryObjectStore();
      const { status } = await publishFixture(store);
      if (mutation === "missing") store.objects.delete(SECTOR_ROTATION_SNAPSHOT_KEYS[0]);
      if (mutation === "json") store.objects.set(SECTOR_ROTATION_SNAPSHOT_KEYS[0], "{broken");
      if (mutation === "payload") {
        const object = JSON.parse(store.objects.get(SECTOR_ROTATION_SNAPSHOT_KEYS[0])!);
        object.warnings = ["tampered"];
        store.objects.set(SECTOR_ROTATION_SNAPSHOT_KEYS[0], JSON.stringify(object));
      }
      const current = { ...status.current! };
      if (mutation === "source") current.snapshotId = "market-breadth-v1-2026-08-11-deadbeef";
      if (mutation === "holdings") current.holdingsAsOf = "2026-08-10";
      if (mutation === "price") current.priceAsOf = "2026-08-10";
      if (mutation === "generation") current.publishedAt = "2026-08-11T23:31:00.000Z";
      if (mutation === "rotation-id") current.rotationSnapshotId = "sector-rotation-v1-2026-08-11-deadbeef";
      store.objects.set(MARKET_BREADTH_STATUS_KEY, JSON.stringify({ ...status, current }));
      const response = await api(store);
      assert.equal(response.status, 500, mutation);
      const body = await response.json() as { errorCode: string };
      assert.equal(body.errorCode, "SECTOR_ROTATION_READ_FAILED");
    }
  });

  it("preserves a safe unresolved failure across subsequent duplicate attempts", async () => {
    const store = new MemoryObjectStore();
    const { status } = await publishFixture(store);
    const failed = await publishMarketBreadthAttempt(store, { previousStatus: status, attempt: { ...status.lastAttempt, runId: "run-failed", status: "FAILED", finishedAt: "2026-08-11T23:45:00.000Z", errorClass: "PROVIDER_REJECTED" } });
    const skipped = await publishMarketBreadthAttempt(store, { previousStatus: failed, attempt: { ...failed.lastAttempt, runId: "run-skipped", status: "SKIPPED", finishedAt: "2026-08-12T17:17:00.000Z", errorClass: null } });
    assert.equal(skipped.current?.rotationSnapshotId, status.current?.rotationSnapshotId);
    const response = await api(store);
    const body = await response.json() as { freshness: { status: string; errorClass: string } };
    assert.equal(response.status, 200);
    assert.equal(body.freshness.status, "STALE");
    assert.equal(body.freshness.errorClass, "PROVIDER_REJECTED");
  });

  it("rejects unsupported methods and reports a missing storage binding", async () => {
    assert.equal((await getSectorRotationApi({ request: new Request("https://example.com/api/sector-rotation", { method: "POST" }), env: {} })).status, 405);
    assert.equal((await getSectorRotationApi({ request: new Request("https://example.com/api/sector-rotation"), env: {} })).status, 503);
  });
});

describe("Sector rotation production bootstrap", () => {
  it("recovers paired AUTO publication after both daily attempts miss a SPY session", async () => {
    const store = new MemoryObjectStore();
    const oldData = fixture("2026-08-10", "2026-08-10T23:30:00.000Z");
    const previous = await publishMarketBreadthRelease(store, { previousStatus: null, releaseId: "release-old", snapshot: oldData.snapshot, rotationSnapshot: oldData.rotation, stateJson: JSON.stringify(oldData.state), attempt: oldData.attempt });
    const missingDate = "2026-08-11";
    const requestedDate = "2026-08-12";
    const customCalls: string[] = [];
    const client = {
      fetchUniverse: async () => ({ ...oldData.universe, holdingsAsOf: missingDate }),
      fetchDailySummary: async (date: string) => {
        if (date === missingDate) throw new MarketBreadthSourceError("PROVIDER_UNAVAILABLE", "Missed daily summary");
        return new Map([...oldData.priceSeries].map(([symbol, bars]) => [symbol, date === oldData.snapshot.priceAsOf ? bars.at(-1)! : { date, close: bars.at(-1)!.close * 1.02 }]));
      },
      fetchCustomBars: async (symbol: string) => {
        customCalls.push(symbol);
        const history = oldData.priceSeries.get(symbol)!;
        return [...history, { date: missingDate, close: history.at(-1)!.close * 1.01 }, { date: requestedDate, close: history.at(-1)!.close * 1.02 }];
      },
    };
    for (const hour of ["17:17", "18:47"]) {
      const result = await runGitHubMarketBreadthRefresh({ store, mode: "AUTO", now: new Date(`2026-08-12T${hour}:00.000Z`), client });
      assert.equal(result.status, "FAILED");
      assert.equal(result.reason, "PROVIDER_UNAVAILABLE");
    }
    assert.deepEqual(customCalls, []);
    const failedStatus = validateMarketBreadthStatus(JSON.parse(store.objects.get(MARKET_BREADTH_STATUS_KEY)!));
    assert.deepEqual(failedStatus.current, previous.current);
    const recovered = await runGitHubMarketBreadthRefresh({ store, mode: "AUTO", now: new Date("2026-08-13T17:17:00.000Z"), client });
    assert.equal(recovered.status, "READY");
    assert.deepEqual(customCalls, ["SPY"]);
    const published = validateMarketBreadthStatus(JSON.parse(store.objects.get(MARKET_BREADTH_STATUS_KEY)!));
    assert.equal(published.current?.priceAsOf, requestedDate);
    assert.equal(published.unresolvedFailure, null);
    const state = JSON.parse(store.objects.get(published.state.key)!) as PersistedMarketBreadthState;
    assert.equal(state.series.SPY.length, 420);
    assert.ok(state.series.SPY.some((bar) => bar.date === missingDate));
    const body = await (await api(store)).json() as { priceAsOf: string; freshness: { status: string } };
    assert.equal(body.priceAsOf, requestedDate);
    assert.equal(body.freshness.status, "FRESH");
    assert.equal((await getMarketBreadthApi({ request: new Request("https://example.com/api/market-breadth"), env: { MARKET_BREADTH_DATA: store } })).status, 200);
  });

  it("keeps last-good paired snapshots when custom SPY history still has a session gap", async () => {
    const store = new MemoryObjectStore();
    const oldData = fixture("2026-08-10", "2026-08-10T23:30:00.000Z");
    const previous = await publishMarketBreadthRelease(store, { previousStatus: null, releaseId: "release-old", snapshot: oldData.snapshot, rotationSnapshot: oldData.rotation, stateJson: JSON.stringify(oldData.state), attempt: oldData.attempt });
    const result = await runGitHubMarketBreadthRefresh({
      store, mode: "AUTO", now: new Date("2026-08-13T17:17:00.000Z"), client: {
        fetchUniverse: async () => oldData.universe,
        fetchDailySummary: async (date) => new Map([...oldData.priceSeries].map(([symbol, bars]) => [symbol, { date, close: bars.at(-1)!.close }])),
        fetchCustomBars: async (symbol) => [...oldData.priceSeries.get(symbol)!, { date: "2026-08-12", close: oldData.priceSeries.get(symbol)!.at(-1)!.close }],
      },
    });
    assert.equal(result.status, "FAILED");
    assert.equal(result.reason, "ADJUSTMENT_HISTORY_INVALID");
    const published = validateMarketBreadthStatus(JSON.parse(store.objects.get(MARKET_BREADTH_STATUS_KEY)!));
    assert.deepEqual(published.current, previous.current);
    const body = await (await api(store)).json() as { snapshotId: string; freshness: { status: string } };
    assert.equal(body.snapshotId, oldData.rotation.snapshotId);
    assert.equal(body.freshness.status, "STALE");
  });

  it("materializes a duplicate READY source without provider calls or advancing its publication time", async () => {
    const store = new MemoryObjectStore();
    const { status, rotation, state } = await publishFixture(store, false);
    for (const bars of Object.values(state.series)) bars.push({ date: "2026-08-12", close: bars[bars.length - 1].close * 1.05 });
    store.objects.set(status.state.key, JSON.stringify(state));
    const result = await runGitHubMarketBreadthRefresh({ store, mode: "DAILY", now: new Date("2026-08-12T18:00:00.000Z"), client: noProviderClient });
    assert.equal(result.status, "SKIPPED");
    const published = validateMarketBreadthStatus(JSON.parse(store.objects.get(MARKET_BREADTH_STATUS_KEY)!));
    assert.equal(published.current?.snapshotId, status.current?.snapshotId);
    assert.equal(published.current?.publishedAt, status.current?.publishedAt);
    assert.equal(published.current?.rotationSnapshotId, rotation.snapshotId);
    assert.equal((await api(store)).status, 200);
  });

  it("keeps a previous unresolved failure STALE when bootstrapping a matching duplicate source", async () => {
    const store = new MemoryObjectStore();
    const { status } = await publishFixture(store, false);
    await publishMarketBreadthAttempt(store, { previousStatus: status, attempt: { ...status.lastAttempt, runId: "failed", status: "FAILED", finishedAt: "2026-08-11T23:45:00.000Z", errorClass: "PROVIDER_TIMEOUT" } });
    const result = await runGitHubMarketBreadthRefresh({ store, mode: "DAILY", now: new Date("2026-08-12T18:00:00.000Z"), client: noProviderClient });
    assert.equal(result.status, "SKIPPED");
    const body = await (await api(store)).json() as { freshness: { status: string; errorClass: string } };
    assert.equal(body.freshness.status, "STALE");
    assert.equal(body.freshness.errorClass, "PROVIDER_TIMEOUT");
  });

  it("refuses advanced membership or changed source prices and preserves the last READY pointer", async () => {
    for (const mutation of ["membership", "prices", "source-id"] as const) {
      const store = new MemoryObjectStore();
      const { state, status } = await publishFixture(store, false);
      if (mutation === "membership") state.universe!.holdingsAsOf = "2026-08-12";
      if (mutation === "prices") state.series.SPY[state.series.SPY.length - 1].close *= 2;
      if (mutation === "source-id") state.latestSnapshot = fixture("2026-08-11", "2026-08-11T23:31:00.000Z").snapshot;
      store.objects.set(status.state.key, JSON.stringify(state));
      const result = await runGitHubMarketBreadthRefresh({ store, mode: "DAILY", now: new Date("2026-08-12T18:00:00.000Z"), client: noProviderClient });
      assert.equal(result.status, "FAILED", mutation);
      assert.equal(result.reason, "SECTOR_ROTATION_BOOTSTRAP_SOURCE_MISMATCH");
      const published = validateMarketBreadthStatus(JSON.parse(store.objects.get(MARKET_BREADTH_STATUS_KEY)!));
      assert.deepEqual(published.current, status.current);
      assert.equal(published.unresolvedFailure?.status, "FAILED");
      assert.equal(store.objects.has(SECTOR_ROTATION_SNAPSHOT_KEYS[0]), false);
    }
  });

  it("requires reproducible source state and forbids replacing an initialized rotation", async () => {
    const data = fixture();
    assert.equal(buildSectorRotationForBreadthState(data.state, data.snapshot).snapshotId, data.rotation.snapshotId);
    const store = new MemoryObjectStore();
    const { status, rotation } = await publishFixture(store);
    await assert.rejects(() => publishSectorRotationForCurrentRelease(store, { previousStatus: status, snapshot: rotation, attempt: { ...status.lastAttempt, status: "SKIPPED" } }), /ALREADY_INITIALIZED/);
  });

  it("records paired publication failures while serving the previous READY rotation", async () => {
    const store = new MemoryObjectStore();
    const oldData = fixture("2026-08-10", "2026-08-10T23:30:00.000Z");
    const previous = await publishMarketBreadthRelease(store, { previousStatus: null, releaseId: "release-old", snapshot: oldData.snapshot, rotationSnapshot: oldData.rotation, stateJson: JSON.stringify(oldData.state), attempt: oldData.attempt });
    store.failKey = SECTOR_ROTATION_SNAPSHOT_KEYS[1];
    const requestedUniverse = { ...oldData.universe, holdingsAsOf: "2026-08-11" };
    const result = await runGitHubMarketBreadthRefresh({
      store, mode: "DAILY", now: new Date("2026-08-12T18:00:00.000Z"), client: {
        fetchUniverse: async () => requestedUniverse,
        fetchDailySummary: async (date) => new Map([...oldData.priceSeries].map(([symbol, bars]) => [symbol, date === "2026-08-10" ? bars[bars.length - 1] : { date, close: bars[bars.length - 1].close * 1.01 }])),
        fetchCustomBars: async () => { throw new Error("Unexpected history request"); },
      },
    });
    assert.equal(result.status, "FAILED");
    assert.equal(result.reason, "PAIRED_PUBLICATION_FAILED");
    const published = validateMarketBreadthStatus(JSON.parse(store.objects.get(MARKET_BREADTH_STATUS_KEY)!));
    assert.deepEqual(published.current, previous.current);
    const body = await (await api(store)).json() as { snapshotId: string; freshness: { status: string; errorClass: string } };
    assert.equal(body.snapshotId, oldData.rotation.snapshotId);
    assert.equal(body.freshness.status, "STALE");
    assert.equal(body.freshness.errorClass, "PAIRED_PUBLICATION_FAILED");
  });
});
