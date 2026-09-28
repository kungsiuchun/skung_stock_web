import {
  MARKET_BREADTH_STATUS_KEY,
  SECTOR_ROTATION_SNAPSHOT_KEYS,
  publishMarketBreadthAttempt,
  readJsonObject,
  validateMarketBreadthStatus,
  type MarketBreadthAttempt,
  type MarketBreadthObjectStore,
  type MarketBreadthStatus,
} from "./market-breadth-r2";
import { validateSectorRotationSnapshot, type SectorRotationSnapshot } from "./sector-rotation";

export { SECTOR_ROTATION_SNAPSHOT_KEYS } from "./market-breadth-r2";

const assertSourcePointer = (snapshot: SectorRotationSnapshot, current: MarketBreadthStatus["current"]) => {
  if (!current || snapshot.sourceSnapshotId !== current.snapshotId || snapshot.priceAsOf !== current.priceAsOf
    || snapshot.holdingsAsOf !== current.holdingsAsOf || snapshot.generatedAt !== current.publishedAt) {
    throw new Error("SECTOR_ROTATION_SOURCE_POINTER_MISMATCH");
  }
};

// The published API reads the shared release pointer and one precomputed object.
// It never reads price state, holdings workbooks, or a market-data provider.
export const readSectorRotationRelease = async (store: Pick<MarketBreadthObjectStore, "get">) => {
  const rawStatus = await readJsonObject(store, MARKET_BREADTH_STATUS_KEY);
  if (rawStatus === null) return { status: null, snapshot: null };
  const status = validateMarketBreadthStatus(rawStatus);
  if (!status.current?.rotationKey) return { status, snapshot: null };
  const rawSnapshot = await readJsonObject(store, status.current.rotationKey);
  if (rawSnapshot === null) throw new Error("SECTOR_ROTATION_RELEASE_OBJECT_MISSING");
  const snapshot = validateSectorRotationSnapshot(rawSnapshot);
  assertSourcePointer(snapshot, status.current);
  if (snapshot.snapshotId !== status.current.rotationSnapshotId) {
    throw new Error("SECTOR_ROTATION_RELEASE_POINTER_MISMATCH");
  }
  return { status, snapshot };
};

// Bootstrap only attaches a derived object to an already verified READY source.
// It preserves the source publication time and any unresolved refresh failure.
export const publishSectorRotationForCurrentRelease = async (store: Pick<MarketBreadthObjectStore, "put">, input: {
  previousStatus: MarketBreadthStatus;
  snapshot: SectorRotationSnapshot;
  attempt: MarketBreadthAttempt;
}) => {
  const status = validateMarketBreadthStatus(input.previousStatus);
  const snapshot = validateSectorRotationSnapshot(input.snapshot);
  assertSourcePointer(snapshot, status.current);
  if (status.current?.rotationKey) throw new Error("SECTOR_ROTATION_RELEASE_ALREADY_INITIALIZED");
  if (input.attempt.status !== "SKIPPED") throw new Error("SECTOR_ROTATION_BOOTSTRAP_ATTEMPT_INVALID");
  const rotationKey = SECTOR_ROTATION_SNAPSHOT_KEYS[0];
  await store.put(rotationKey, JSON.stringify(snapshot), { httpMetadata: { contentType: "application/json; charset=utf-8" } });
  return publishMarketBreadthAttempt(store, {
    previousStatus: {
      ...status,
      current: { ...status.current!, rotationKey, rotationSnapshotId: snapshot.snapshotId },
    },
    attempt: input.attempt,
  });
};
