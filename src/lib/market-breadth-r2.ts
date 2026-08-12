import { validateMarketBreadthSnapshot, type MarketBreadthSnapshot } from "./market-breadth";

export const MARKET_BREADTH_STATUS_KEY = "market-breadth/status.json";
export const MARKET_BREADTH_STATE_KEYS = ["market-breadth/state/prices-a.json", "market-breadth/state/prices-b.json"] as const;
export const MARKET_BREADTH_SNAPSHOT_KEYS = ["market-breadth/snapshots/snapshot-a.json", "market-breadth/snapshots/snapshot-b.json"] as const;
export const MARKET_BREADTH_RUN_SLOTS = 64;

export type MarketBreadthAttemptStatus = "READY" | "PARTIAL" | "FAILED" | "SKIPPED";

export interface MarketBreadthAttempt {
  runId: string;
  status: MarketBreadthAttemptStatus;
  startedAt: string;
  finishedAt: string;
  priceAsOf: string | null;
  errorClass: string | null;
}

export interface MarketBreadthStatus {
  schemaVersion: 1;
  state: { key: typeof MARKET_BREADTH_STATE_KEYS[number]; updatedAt: string };
  current: null | {
    releaseId: string;
    snapshotId: string;
    snapshotKey: string;
    stateKey: string;
    priceAsOf: string;
    holdingsAsOf: string;
    publishedAt: string;
  };
  lastAttempt: MarketBreadthAttempt;
}

export interface MarketBreadthObjectBody {
  text: () => Promise<string>;
}

export interface MarketBreadthObjectStore {
  get: (key: string) => Promise<MarketBreadthObjectBody | null>;
  put: (key: string, value: string, options?: { httpMetadata?: { contentType?: string } }) => Promise<unknown>;
}

const isIso = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const isDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isString = (value: unknown) => typeof value === "string" && value.length > 0;

export const validateMarketBreadthStatus = (value: unknown): MarketBreadthStatus => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Market breadth status is invalid.");
  const status = value as Partial<MarketBreadthStatus>;
  if (status.schemaVersion !== 1 || !status.lastAttempt || typeof status.lastAttempt !== "object") throw new Error("Market breadth status schema is invalid.");
  if (!status.state || !MARKET_BREADTH_STATE_KEYS.includes(status.state.key as typeof MARKET_BREADTH_STATE_KEYS[number]) || !isIso(status.state.updatedAt)) throw new Error("Market breadth state pointer is invalid.");
  const attempt = status.lastAttempt;
  if (!isString(attempt.runId) || !["READY", "PARTIAL", "FAILED", "SKIPPED"].includes(attempt.status || "") || !isIso(attempt.startedAt) || !isIso(attempt.finishedAt)) {
    throw new Error("Market breadth last attempt is invalid.");
  }
  if (attempt.priceAsOf !== null && !isDate(attempt.priceAsOf)) throw new Error("Market breadth attempt price date is invalid.");
  if (attempt.errorClass !== null && !isString(attempt.errorClass)) throw new Error("Market breadth attempt error class is invalid.");
  if (status.current !== null) {
    const current = status.current;
    if (!current || !isString(current.releaseId) || !isString(current.snapshotId) || !isString(current.snapshotKey) || !isString(current.stateKey)
      || !isDate(current.priceAsOf) || !isDate(current.holdingsAsOf) || !isIso(current.publishedAt)) {
      throw new Error("Market breadth current release is invalid.");
    }
  }
  return status as MarketBreadthStatus;
};

export const readJsonObject = async (store: Pick<MarketBreadthObjectStore, "get">, key: string): Promise<unknown | null> => {
  const object = await store.get(key);
  if (!object) return null;
  try {
    return JSON.parse(await object.text()) as unknown;
  } catch {
    throw new Error(`MARKET_BREADTH_OBJECT_JSON_INVALID:${key}`);
  }
};

export const readMarketBreadthRelease = async (store: Pick<MarketBreadthObjectStore, "get">) => {
  const rawStatus = await readJsonObject(store, MARKET_BREADTH_STATUS_KEY);
  if (rawStatus === null) return { status: null, snapshot: null };
  const status = validateMarketBreadthStatus(rawStatus);
  if (!status.current) return { status, snapshot: null };
  const rawSnapshot = await readJsonObject(store, status.current.snapshotKey);
  if (rawSnapshot === null) throw new Error("MARKET_BREADTH_RELEASE_OBJECT_MISSING");
  const snapshot = validateMarketBreadthSnapshot(rawSnapshot);
  if (snapshot.snapshotId !== status.current.snapshotId || snapshot.priceAsOf !== status.current.priceAsOf) {
    throw new Error("MARKET_BREADTH_RELEASE_POINTER_MISMATCH");
  }
  return { status, snapshot };
};

export const publishMarketBreadthRelease = async (store: Pick<MarketBreadthObjectStore, "put">, input: {
  previousStatus: MarketBreadthStatus | null;
  releaseId: string;
  snapshot: MarketBreadthSnapshot;
  stateJson: string;
  attempt: MarketBreadthAttempt;
}) => {
  const snapshot = validateMarketBreadthSnapshot(input.snapshot);
  const stateKey = input.previousStatus?.state.key === MARKET_BREADTH_STATE_KEYS[0] ? MARKET_BREADTH_STATE_KEYS[1] : MARKET_BREADTH_STATE_KEYS[0];
  const snapshotKey = input.previousStatus?.current?.snapshotKey === MARKET_BREADTH_SNAPSHOT_KEYS[0]
    ? MARKET_BREADTH_SNAPSHOT_KEYS[1]
    : MARKET_BREADTH_SNAPSHOT_KEYS[0];
  const runKey = marketBreadthRunKey(input.attempt.runId);
  const metadata = { httpMetadata: { contentType: "application/json; charset=utf-8" } };
  const status: MarketBreadthStatus = {
    schemaVersion: 1,
    state: { key: stateKey, updatedAt: input.attempt.finishedAt },
    current: {
      releaseId: input.releaseId,
      snapshotId: snapshot.snapshotId,
      snapshotKey,
      stateKey,
      priceAsOf: snapshot.priceAsOf,
      holdingsAsOf: snapshot.holdingsAsOf,
      publishedAt: snapshot.generatedAt,
    },
    lastAttempt: input.attempt,
  };
  await store.put(stateKey, input.stateJson, metadata);
  await store.put(snapshotKey, JSON.stringify(snapshot), metadata);
  await store.put(runKey, JSON.stringify(input.attempt), metadata);
  await store.put(MARKET_BREADTH_STATUS_KEY, JSON.stringify(status), metadata);
  return status;
};

export const publishMarketBreadthAttempt = async (store: Pick<MarketBreadthObjectStore, "put">, input: {
  previousStatus: MarketBreadthStatus | null;
  attempt: MarketBreadthAttempt;
  stateJson?: string;
}) => {
  const metadata = { httpMetadata: { contentType: "application/json; charset=utf-8" } };
  const stateKey = input.previousStatus?.state.key === MARKET_BREADTH_STATE_KEYS[0] ? MARKET_BREADTH_STATE_KEYS[1] : MARKET_BREADTH_STATE_KEYS[0];
  if (input.stateJson !== undefined) await store.put(stateKey, input.stateJson, metadata);
  await store.put(marketBreadthRunKey(input.attempt.runId), JSON.stringify(input.attempt), metadata);
  const state = input.stateJson === undefined ? input.previousStatus?.state : { key: stateKey, updatedAt: input.attempt.finishedAt };
  if (!state) throw new Error("MARKET_BREADTH_STATE_POINTER_MISSING");
  const status: MarketBreadthStatus = {
    schemaVersion: 1,
    state,
    current: input.previousStatus?.current || null,
    lastAttempt: input.attempt,
  };
  await store.put(MARKET_BREADTH_STATUS_KEY, JSON.stringify(status), metadata);
  return status;
};

const marketBreadthRunKey = (runId: string) => {
  let hash = 2166136261;
  for (let index = 0; index < runId.length; index += 1) {
    hash ^= runId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `market-breadth/runs/slot-${String((hash >>> 0) % MARKET_BREADTH_RUN_SLOTS).padStart(2, "0")}.json`;
};

export const estimateMarketBreadthR2MonthlyUsage = (input: { days: number; apiRequestsPerDay: number; refreshRunsPerDay: number }) => ({
  classAOperations: input.days * input.refreshRunsPerDay * 4,
  classBOperations: input.days * input.apiRequestsPerDay * 2 + input.days * input.refreshRunsPerDay * 2,
  apiFunctionRequests: input.days * input.apiRequestsPerDay,
});
