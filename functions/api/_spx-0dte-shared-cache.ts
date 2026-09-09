import type { D1DatabaseLike } from "../../src/lib/spx-recap-d1";
import type { ResolvedZeroDteSpxSession, ZeroDteSpxIntradayResult } from "./_0dtespx";

export const SPX_0DTE_SHARED_REFRESH_MS = 60_000;
export const SPX_0DTE_SHARED_LEASE_MS = 55_000;
const SPX_0DTE_SHARED_RETENTION_MS = 24 * 60 * 60_000;
const SPX_0DTE_COLD_WAIT_MS = 9_000;
const SPX_0DTE_COLD_POLL_MS = 200;
const CACHE_SCOPE = "spx-0dtespx-intraday";
const CACHE_SYMBOL = "SPX";

export type SpxZeroDteSharedCacheStatus = "HIT" | "REFRESHED" | "STALE" | "BYPASSED";

export interface SpxZeroDteSharedCacheMetadata {
  status: SpxZeroDteSharedCacheStatus;
  cachedAt: string;
  ageMs: number;
  refreshAfterMs: number;
  refreshing: boolean;
  refreshError?: string;
}

export interface SpxZeroDteSharedCacheResolution {
  session: ResolvedZeroDteSpxSession;
  value: ZeroDteSpxIntradayResult | null;
  cache: SpxZeroDteSharedCacheMetadata;
}

interface StoredSnapshot {
  schemaVersion: 1;
  tradingDate: string;
  cachedAt: string;
  session: ResolvedZeroDteSpxSession;
  value: ZeroDteSpxIntradayResult | null;
}

export interface SpxZeroDteSharedLoadResult {
  session: ResolvedZeroDteSpxSession;
  value: ZeroDteSpxIntradayResult | null;
}

interface CacheRow {
  payload_json: string;
  cached_at: string;
  last_refresh_error: string | null;
}

interface ResolveOptions {
  db?: D1DatabaseLike;
  tradingDate: string;
  nowMs?: number;
  waitUntil?: (promise: Promise<unknown>) => void;
  load: () => Promise<SpxZeroDteSharedLoadResult>;
  reserveRefresh?: () => Promise<{ allow: boolean; reason: string }>;
}

export class SpxZeroDteSharedCacheError extends Error {
  constructor(readonly code: "SPX_0DTE_SHARED_CACHE_UNAVAILABLE" | "SPX_0DTE_SHARED_CACHE_BUSY" | "SPX_0DTE_SHARED_CACHE_QUOTA_BLOCKED") {
    super(code);
  }
}

const cacheKey = (tradingDate: string) => `spx-0dtespx-intraday:${CACHE_SYMBOL}:${tradingDate}`;
const leaseKey = (tradingDate: string) => `__spx-0dtespx-refresh-lease__:${tradingDate}`;

const changesFrom = (result: unknown) => {
  if (!result || typeof result !== "object") return 0;
  const record = result as Record<string, unknown>;
  const meta = record.meta && typeof record.meta === "object" ? record.meta as Record<string, unknown> : null;
  const raw = meta?.changes ?? record.changes;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
};

const parseStored = (row: CacheRow, tradingDate: string): StoredSnapshot => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payload_json);
  } catch {
    throw new SpxZeroDteSharedCacheError("SPX_0DTE_SHARED_CACHE_UNAVAILABLE");
  }
  const snapshot = parsed as Partial<StoredSnapshot>;
  if (snapshot.schemaVersion !== 1
    || snapshot.tradingDate !== tradingDate
    || typeof snapshot.cachedAt !== "string"
    || !Number.isFinite(Date.parse(snapshot.cachedAt))
    || !snapshot.session
    || snapshot.session.sessionDate !== tradingDate
    || !["UPCOMING", "LIVE", "FINALIZING", "CLOSED"].includes(snapshot.session.state || "")
    || ![snapshot.session.startAt, snapshot.session.endAt, snapshot.session.dataStartAt, snapshot.session.dataEndAt]
      .every((value) => typeof value === "string" && Number.isFinite(Date.parse(value)))
    || !("value" in snapshot)
    || (snapshot.value !== null && snapshot.value !== undefined
      && (!Array.isArray(snapshot.value.candles) || typeof snapshot.value.latestSampleAt !== "string"))
    || (snapshot.session.state !== "UPCOMING" && !snapshot.value)) {
    throw new SpxZeroDteSharedCacheError("SPX_0DTE_SHARED_CACHE_UNAVAILABLE");
  }
  return snapshot as StoredSnapshot;
};

const readStored = async (db: D1DatabaseLike, tradingDate: string) => {
  try {
    const row = await db.prepare(`
      SELECT payload_json, cached_at, last_refresh_error
      FROM market_cache_entries
      WHERE cache_key = ? AND scope = ? AND symbol = ?
      LIMIT 1
    `).bind(cacheKey(tradingDate), CACHE_SCOPE, CACHE_SYMBOL).first<CacheRow>();
    return row ? parseStored(row, tradingDate) : null;
  } catch (error) {
    if (error instanceof SpxZeroDteSharedCacheError) throw error;
    throw new SpxZeroDteSharedCacheError("SPX_0DTE_SHARED_CACHE_UNAVAILABLE");
  }
};

const claimRefreshLease = async (db: D1DatabaseLike, tradingDate: string, nowMs: number) => {
  const now = new Date(nowMs).toISOString();
  const leaseUntil = new Date(nowMs + SPX_0DTE_SHARED_LEASE_MS).toISOString();
  try {
    const result = await db.prepare(`
      INSERT INTO market_cache_entries (
        cache_key, scope, symbol, schema_version, payload_json, source_as_of,
        cached_at, expires_at, last_refresh_error, last_refresh_attempted_at
      ) VALUES (?, ?, ?, 1, '{}', NULL, ?, ?, NULL, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        cached_at = excluded.cached_at,
        expires_at = excluded.expires_at,
        last_refresh_error = NULL,
        last_refresh_attempted_at = excluded.last_refresh_attempted_at
      WHERE market_cache_entries.expires_at <= ?
    `).bind(leaseKey(tradingDate), CACHE_SCOPE, CACHE_SYMBOL, now, leaseUntil, now, now).run();
    return changesFrom(result) === 1;
  } catch {
    throw new SpxZeroDteSharedCacheError("SPX_0DTE_SHARED_CACHE_UNAVAILABLE");
  }
};

const releaseRefreshLease = async (db: D1DatabaseLike, tradingDate: string, nowMs: number) => {
  try {
    await db.prepare(`
      UPDATE market_cache_entries
      SET expires_at = ?, last_refresh_attempted_at = ?
      WHERE cache_key = ? AND scope = ?
    `).bind(
      new Date(nowMs).toISOString(),
      new Date(nowMs).toISOString(),
      leaseKey(tradingDate),
      CACHE_SCOPE,
    ).run();
  } catch {
    console.warn("spx_0dtespx_shared_cache_lease_release_failed", { tradingDate });
  }
};

const mergeIntraday = (
  previous: ZeroDteSpxIntradayResult | null,
  incoming: ZeroDteSpxIntradayResult,
): ZeroDteSpxIntradayResult => {
  const candles = new Map<number, ZeroDteSpxIntradayResult["candles"][number]>();
  for (const candle of previous?.candles || []) candles.set(candle.time, candle);
  for (const candle of incoming.candles) candles.set(candle.time, candle);

  const expectedMoves = [previous?.expectedMove, incoming.expectedMove]
    .filter((value): value is ZeroDteSpxIntradayResult["expectedMove"] => Boolean(
      value
      && typeof value.value === "number"
      && Number.isFinite(value.value)
      && value.value > 0
      && typeof value.sampleAt === "string"
      && Number.isFinite(Date.parse(value.sampleAt)),
    ))
    .sort((left, right) => Date.parse(left.sampleAt!) - Date.parse(right.sampleAt!));
  const latestPriceResult = previous
    && Date.parse(previous.latestSampleAt) > Date.parse(incoming.latestSampleAt)
    ? previous
    : incoming;

  return {
    candles: [...candles.values()].sort((left, right) => left.time - right.time),
    latestSampleAt: latestPriceResult.latestSampleAt,
    priceAgeMs: latestPriceResult.priceAgeMs,
    expectedMove: expectedMoves.at(-1) || incoming.expectedMove,
  };
};

const writeStored = async (
  db: D1DatabaseLike,
  tradingDate: string,
  loadResult: SpxZeroDteSharedLoadResult,
  nowMs: number,
) => {
  const cachedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + SPX_0DTE_SHARED_RETENTION_MS).toISOString();
  const stored: StoredSnapshot = {
    schemaVersion: 1,
    tradingDate,
    cachedAt,
    session: loadResult.session,
    value: loadResult.value,
  };
  try {
    await db.prepare(`
      INSERT INTO market_cache_entries (
        cache_key, scope, symbol, schema_version, payload_json, source_as_of,
        cached_at, expires_at, last_refresh_error, last_refresh_attempted_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        scope = excluded.scope,
        symbol = excluded.symbol,
        schema_version = excluded.schema_version,
        payload_json = excluded.payload_json,
        source_as_of = excluded.source_as_of,
        cached_at = excluded.cached_at,
        expires_at = excluded.expires_at,
        last_refresh_error = NULL,
        last_refresh_attempted_at = excluded.last_refresh_attempted_at
    `).bind(
      cacheKey(tradingDate), CACHE_SCOPE, CACHE_SYMBOL, JSON.stringify(stored),
      loadResult.value?.latestSampleAt || loadResult.session.dataStartAt, cachedAt, expiresAt, cachedAt,
    ).run();
  } catch {
    throw new SpxZeroDteSharedCacheError("SPX_0DTE_SHARED_CACHE_UNAVAILABLE");
  }
  return stored;
};

const recordRefreshError = async (db: D1DatabaseLike, tradingDate: string, nowMs: number, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await db.prepare(`
      UPDATE market_cache_entries
      SET last_refresh_error = ?, last_refresh_attempted_at = ?
      WHERE cache_key = ? AND scope = ?
    `).bind(message.slice(0, 500), new Date(nowMs).toISOString(), cacheKey(tradingDate), CACHE_SCOPE).run();
  } catch {
    console.warn("spx_0dtespx_shared_cache_error_record_failed", { tradingDate });
  }
  console.info("spx_0dtespx_shared_cache_refresh_failed", { tradingDate, errorClass: error instanceof Error ? error.name : "unknown" });
};

const metadata = (
  status: SpxZeroDteSharedCacheStatus,
  cachedAt: string,
  nowMs: number,
  refreshing: boolean,
  refreshError?: string,
): SpxZeroDteSharedCacheMetadata => ({
  status,
  cachedAt,
  ageMs: Math.max(0, nowMs - Date.parse(cachedAt)),
  refreshAfterMs: SPX_0DTE_SHARED_REFRESH_MS,
  refreshing,
  ...(refreshError ? { refreshError } : {}),
});

const refresh = async (
  options: ResolveOptions,
  previous: StoredSnapshot | null,
  nowMs: number,
) => {
  if (options.reserveRefresh) {
    const decision = await options.reserveRefresh();
    if (!decision.allow) throw new SpxZeroDteSharedCacheError("SPX_0DTE_SHARED_CACHE_QUOTA_BLOCKED");
  }
  const incoming = await options.load();
  const merged = incoming.value
    ? mergeIntraday(previous?.value || null, incoming.value)
    : null;
  return writeStored(options.db!, options.tradingDate, { session: incoming.session, value: merged }, nowMs);
};

const wait = (durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs));

export const resolveSpxZeroDteSharedCache = async (options: ResolveOptions): Promise<SpxZeroDteSharedCacheResolution> => {
  const nowMs = options.nowMs ?? Date.now();
  if (!options.db) {
    const loaded = await options.load();
    const cachedAt = new Date(nowMs).toISOString();
    return { ...loaded, cache: metadata("BYPASSED", cachedAt, nowMs, false) };
  }

  const existing = await readStored(options.db, options.tradingDate);
  if (existing && nowMs - Date.parse(existing.cachedAt) < SPX_0DTE_SHARED_REFRESH_MS) {
    return { session: existing.session, value: existing.value, cache: metadata("HIT", existing.cachedAt, nowMs, false) };
  }

  const ownsLease = await claimRefreshLease(options.db, options.tradingDate, nowMs);
  if (!ownsLease) {
    if (existing) return { session: existing.session, value: existing.value, cache: metadata("STALE", existing.cachedAt, nowMs, true) };
    const deadline = Date.now() + SPX_0DTE_COLD_WAIT_MS;
    while (Date.now() < deadline) {
      await wait(SPX_0DTE_COLD_POLL_MS);
      const winner = await readStored(options.db, options.tradingDate);
      if (winner) return { session: winner.session, value: winner.value, cache: metadata("HIT", winner.cachedAt, nowMs, false) };
    }
    throw new SpxZeroDteSharedCacheError("SPX_0DTE_SHARED_CACHE_BUSY");
  }

  const refreshWork = refresh(options, existing, nowMs);
  if (existing && options.waitUntil) {
    options.waitUntil(refreshWork.catch(async (error) => {
      await recordRefreshError(options.db!, options.tradingDate, nowMs, error);
      await releaseRefreshLease(options.db!, options.tradingDate, nowMs);
    }));
    return { session: existing.session, value: existing.value, cache: metadata("STALE", existing.cachedAt, nowMs, true) };
  }

  try {
    const updated = await refreshWork;
    return { session: updated.session, value: updated.value, cache: metadata("REFRESHED", updated.cachedAt, nowMs, false) };
  } catch (error) {
    await recordRefreshError(options.db, options.tradingDate, nowMs, error);
    await releaseRefreshLease(options.db, options.tradingDate, nowMs);
    if (existing) {
      return {
        session: existing.session,
        value: existing.value,
        cache: metadata("STALE", existing.cachedAt, nowMs, false, error instanceof Error ? error.message : String(error)),
      };
    }
    throw error;
  }
};
