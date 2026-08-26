import type { D1DatabaseLike } from "./spx-recap-d1";
import {
  D1_DATABASE_BUDGETS,
  D1_FREE_TIER_DAILY_LIMITS,
  evaluateD1Budget,
} from "./d1-free-tier-budget";

export const MARKET_CACHE_TTL_MS = 60_000;
export const MARKET_CACHE_70_PERCENT_GUARD = 0.7;
export const MARKET_CACHE_DATASET_TTL_MS = {
  quote: 60_000,
  options: 15 * 60_000,
  history: 15 * 60_000,
  intraday: 15 * 60_000,
  news: 15 * 60_000,
  fundamentals: 24 * 60 * 60_000,
  earnings: 24 * 60 * 60_000,
  /** Bundled snapshots use the conservative quote TTL; they are not per-dataset caches. */
  snapshot: 60_000,
} as const;
/** Stable alias for callers that want to document the dataset contract. */
export const MARKET_CACHE_DATASET_TTL_CONTRACT = MARKET_CACHE_DATASET_TTL_MS;

export type MarketCacheDataset = keyof typeof MARKET_CACHE_DATASET_TTL_MS;
export type MarketCacheGuard = "fresh" | "near_expiry" | "stale" | "bypassed";
export type MarketCacheRowReadState = "bypassed" | "miss" | "hit" | "failed";
export type MarketCacheRowWriteState = "bypassed" | "written" | "failed";

/** Site-owned allocation inside the Cloudflare Free daily limit. */
export const MARKET_CACHE_D1_DAILY_READ_LIMIT = D1_DATABASE_BUDGETS.MARKET_CACHE_DB.rowsRead;
export const MARKET_CACHE_D1_DAILY_WRITE_LIMIT = D1_DATABASE_BUDGETS.MARKET_CACHE_DB.rowsWritten;
/** Allocations already include the 70% site policy; do not apply it twice. */
export const MARKET_CACHE_D1_QUOTA_HARD_THRESHOLD = 1;
export const MARKET_CACHE_D1_FREE_READ_LIMIT_PER_DAY = D1_FREE_TIER_DAILY_LIMITS.rowsRead;
export const MARKET_CACHE_D1_FREE_WRITE_LIMIT_PER_DAY = D1_FREE_TIER_DAILY_LIMITS.rowsWritten;
export const MARKET_CACHE_D1_HARD_THRESHOLD = MARKET_CACHE_D1_QUOTA_HARD_THRESHOLD;

/** Maximum number of expired cache rows pruned by one request-path refresh. */
export const MAX_CACHE_PRUNE_ROWS = 50;
/**
 * Worst-case rows read by the bounded prune DELETE: the indexed inner
 * expiry scan can yield 50 keys and the outer DELETE can perform one bounded
 * primary-key lookup for each yielded key.
 */
export const MAX_CACHE_PRUNE_READ_ROWS = MAX_CACHE_PRUNE_ROWS * 2;
/** Retention cleanup is bounded maintenance, not work for every cache refresh. */
export const MARKET_CACHE_PRUNE_INTERVAL_MS = 15 * 60_000;
/** market_cache_entries has one table write plus its PK and three secondary indexes. */
export const MARKET_CACHE_WRITE_INDEX_AMPLIFICATION = 5;

export interface MarketCacheD1QuotaUsage {
  dayUtc: string;
  rowsRead: number;
  rowsWritten: number;
}

export interface MarketCacheD1QuotaDecision {
  allow: boolean;
  blocked: boolean;
  reason: "within_budget" | "utc_day_reset" | "read_threshold_exceeded" | "write_threshold_exceeded" | "read_limit_exhausted" | "write_limit_exhausted" | "invalid_observation" | "quota_state_invalid" | "quota_store_unavailable";
  currentDayUtc: string;
  usageDayUtc: string;
  dayReset: boolean;
  observedRowsRead: number;
  observedRowsWritten: number;
  projectedRowsRead: number;
  projectedRowsWritten: number;
  readRemaining: number;
  writeRemaining: number;
  readHeadroom: number;
  writeHeadroom: number;
  resetsAtUtc: string;
  remaining: { rowsRead: number; rowsWritten: number };
  headroom: { rowsRead: number; rowsWritten: number };
  blockedDimensions: Array<"read" | "write">;
}

export interface MarketCacheD1QuotaInput {
  currentUtcDay?: string | Date;
  currentDayUtc?: string | Date;
  usage?: MarketCacheD1QuotaUsage;
  aggregatedUsage?: MarketCacheD1QuotaUsage;
  rowsRead?: number;
  rowsWritten?: number;
  observedRowsRead?: number;
  observedRowsWritten?: number;
}

export interface MarketCacheD1QuotaObservation {
  rowsRead: number;
  rowsWritten: number;
}

/**
 * Evaluate the projected D1 row budget for the current UTC day. This is a pure
 * guard: callers provide the aggregated usage and the rows observed by the
 * current operation; no scheduler or persistence is hidden here.
 */
export const evaluateMarketCacheD1Quota = (input: MarketCacheD1QuotaInput): MarketCacheD1QuotaDecision => {
  const evaluated = evaluateD1Budget({
    database: "MARKET_CACHE_DB",
    currentUtcDay: input.currentUtcDay || input.currentDayUtc,
    usage: input.usage || input.aggregatedUsage,
    rowsRead: input.rowsRead ?? input.observedRowsRead,
    rowsWritten: input.rowsWritten ?? input.observedRowsWritten,
  });
  const reason = evaluated.reason;
  const readRemaining = evaluated.readHeadroom;
  const writeRemaining = evaluated.writeHeadroom;
  return {
    allow: evaluated.allow,
    blocked: evaluated.blocked,
    reason,
    currentDayUtc: evaluated.currentDayUtc,
    usageDayUtc: evaluated.usageDayUtc,
    dayReset: evaluated.dayReset,
    observedRowsRead: evaluated.observedRowsRead,
    observedRowsWritten: evaluated.observedRowsWritten,
    projectedRowsRead: evaluated.projectedRowsRead,
    projectedRowsWritten: evaluated.projectedRowsWritten,
    readRemaining,
    writeRemaining,
    readHeadroom: evaluated.readHeadroom,
    writeHeadroom: evaluated.writeHeadroom,
    resetsAtUtc: evaluated.resetsAtUtc,
    remaining: { rowsRead: readRemaining, rowsWritten: writeRemaining },
    headroom: { rowsRead: evaluated.readHeadroom, rowsWritten: evaluated.writeHeadroom },
    blockedDimensions: evaluated.blockedDimensions,
  };
};

export const checkMarketCacheD1Quota = evaluateMarketCacheD1Quota;
export const evaluateDailyD1QuotaGuard = evaluateMarketCacheD1Quota;

/** Classify individual native tools; bundled snapshots are classified separately by the API. */
export const classifyMarketCacheDataset = (value: string): MarketCacheDataset => {
  const normalized = value.trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (normalized === "snapshot" || normalized.includes("snapshot")) return "snapshot";
  if (/option|gex|greek|\biv\b|pcr|\bdex\b|sweep|0dte|zero_dte/.test(normalized)) return "options";
  if (/intraday/.test(normalized)) return "intraday";
  if (/history|historical|chart/.test(normalized)) return "history";
  if (/news|brief|headline/.test(normalized)) return "news";
  if (/fundamental|financial|stats|beta|holder/.test(normalized)) return "fundamentals";
  if (/earning/.test(normalized)) return "earnings";
  return "quote";
};

export const getMarketCacheD1QuotaObservation = (metadata: Pick<MarketCacheMetadata, "rowsRead" | "rowsWritten">): MarketCacheD1QuotaObservation => ({
  rowsRead: metadata.rowsRead,
  rowsWritten: metadata.rowsWritten,
});

/** Return a positive per-call TTL while preserving the historical 60-second default. */
export const resolveMarketCacheTtlMs = (
  dataset?: MarketCacheDataset,
  ttlMs?: number,
) => {
  if (typeof ttlMs === "number" && Number.isFinite(ttlMs) && ttlMs > 0) return Math.floor(ttlMs);
  return dataset ? MARKET_CACHE_DATASET_TTL_MS[dataset] : MARKET_CACHE_TTL_MS;
};
export const getMarketCacheDatasetTtlMs = (dataset: MarketCacheDataset) => MARKET_CACHE_DATASET_TTL_MS[dataset];

export const getMarketCacheAgeRatio = (cachedAt: string, expiresAt: string, now = new Date()) => {
  const start = Date.parse(cachedAt);
  const end = Date.parse(expiresAt);
  const at = now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1;
  return Math.max(0, (at - start) / (end - start));
};

export const getMarketCacheFreshnessGuard = (
  cachedAt: string,
  expiresAt: string,
  now = new Date(),
): MarketCacheGuard => {
  const ageRatio = getMarketCacheAgeRatio(cachedAt, expiresAt, now);
  if (ageRatio >= 1) return "stale";
  return ageRatio >= MARKET_CACHE_70_PERCENT_GUARD ? "near_expiry" : "fresh";
};

/** A caller can use this guard before trusting an entry for a long operation. */
export const isMarketCacheWithin70PercentGuard = (
  cachedAt: string,
  expiresAt: string,
  now = new Date(),
) => getMarketCacheAgeRatio(cachedAt, expiresAt, now) < MARKET_CACHE_70_PERCENT_GUARD;

/** Alias kept intentionally explicit for API/Worker call sites. */
export const isMarketCacheNearExpiry = (
  cachedAt: string,
  expiresAt: string,
  now = new Date(),
) => !isMarketCacheWithin70PercentGuard(cachedAt, expiresAt, now);
const MARKET_CACHE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export type MarketCacheStatus = "hit" | "refreshed" | "stale" | "bypassed";

export interface MarketCacheMetadata {
  status: MarketCacheStatus;
  dataset?: MarketCacheDataset;
  cachedAt: string;
  expiresAt: string;
  ageSeconds: number;
  ttlMs: number;
  ageRatio: number;
  guard: MarketCacheGuard;
  rowRead: boolean;
  rowWritten: boolean;
  observability: {
    rowRead: MarketCacheRowReadState;
    rowWritten: MarketCacheRowWriteState;
  };
  rowsRead: number;
  rowsWritten: number;
  sourceAsOf?: string | null;
  refreshError?: string;
}

interface MarketCacheRow {
  cache_key: string;
  payload_json: string;
  source_as_of: string | null;
  cached_at: string;
  expires_at: string;
  last_refresh_error: string | null;
}

export interface MarketCacheResolution<T> {
  value: T;
  cache: MarketCacheMetadata;
}

export interface ResolveMarketCacheOptions<T> {
  db?: D1DatabaseLike;
  scope: string;
  symbol: string;
  params?: Record<string, unknown>;
  dataset?: MarketCacheDataset;
  /** Optional per-call TTL in milliseconds. It overrides the dataset default. */
  ttlMs?: number;
  quotaGuard?: () => MarketCacheD1QuotaDecision;
  refreshQuotaGuard?: () => Promise<MarketCacheD1QuotaDecision>;
  allowStaleOnRefreshError?: boolean;
  force?: boolean;
  sourceAsOf?: (value: T) => string | null | undefined;
  load: () => Promise<T>;
  now?: () => Date;
  deadlineMs?: number;
  requestId?: string;
  signal?: AbortSignal;
}

export class MarketCacheTimeoutError extends Error {
  constructor(
    public readonly phase: string,
    public readonly timeoutMs: number,
  ) {
    super(`Market cache ${phase} exceeded ${timeoutMs}ms.`);
    this.name = "MarketCacheTimeoutError";
  }
}

export class MarketCacheQuotaExceededError extends Error {
  constructor(public readonly decision: MarketCacheD1QuotaDecision) {
    super(`Market cache D1 quota guard blocked refresh: ${decision.reason}.`);
    this.name = "MarketCacheQuotaExceededError";
  }
}

const inFlight = new Map<string, Promise<MarketCacheResolution<unknown>>>();

const stableJson = (value: unknown): string => {
  if (value === undefined) return '"__undefined"';
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
};

export const buildMarketCacheKey = (scope: string, symbol: string, params: Record<string, unknown> = {}) =>
  `${scope}:${symbol.trim().toUpperCase()}:${stableJson(params)}`;

const parseRow = <T>(row: MarketCacheRow): T => {
  try {
    return JSON.parse(row.payload_json) as T;
  } catch (error) {
    throw new Error(`Market cache payload is corrupt for ${row.cache_key}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const metadataFromRow = (
  row: MarketCacheRow,
  status: MarketCacheStatus,
  now: Date,
  dataset: MarketCacheDataset | undefined,
  ttlMs: number,
  rowRead: MarketCacheRowReadState,
  rowWritten: MarketCacheRowWriteState,
  refreshError?: string,
  rowsReadOverride?: number,
  rowsWrittenOverride?: number,
): MarketCacheMetadata => ({
  status,
  dataset,
  cachedAt: row.cached_at,
  expiresAt: row.expires_at,
  ageSeconds: Math.max(0, Math.floor((now.getTime() - Date.parse(row.cached_at)) / 1_000)),
  ttlMs,
  ageRatio: getMarketCacheAgeRatio(row.cached_at, row.expires_at, now),
  guard: getMarketCacheFreshnessGuard(row.cached_at, row.expires_at, now),
  rowRead: rowRead !== "bypassed" && rowRead !== "failed",
  rowWritten: rowWritten === "written",
  observability: { rowRead, rowWritten },
  rowsRead: rowsReadOverride ?? (rowRead === "bypassed" ? 0 : 1),
  rowsWritten: rowsWrittenOverride ?? (rowWritten === "written" || rowWritten === "failed" ? 1 : 0),
  sourceAsOf: row.source_as_of,
  ...(refreshError ? { refreshError } : {}),
});

const readRow = async (db: D1DatabaseLike, cacheKey: string) =>
  db.prepare("SELECT cache_key, payload_json, source_as_of, cached_at, expires_at, last_refresh_error FROM market_cache_entries WHERE cache_key = ?")
    .bind(cacheKey)
    .first<MarketCacheRow>();

const metaNumberFrom = (result: unknown, key: string) => {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  const meta = record.meta;
  const fromMeta = meta && typeof meta === "object" ? (meta as Record<string, unknown>)[key] : undefined;
  const value = fromMeta ?? record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return null;
};

const changesFrom = (result: unknown) => metaNumberFrom(result, "changes");
const rowsReadFrom = (result: unknown) => metaNumberFrom(result, "rows_read") ?? metaNumberFrom(result, "rowsRead");
const rowsWrittenFrom = (result: unknown) => metaNumberFrom(result, "rows_written") ?? metaNumberFrom(result, "rowsWritten");

const writeSuccess = async <T>(db: D1DatabaseLike, input: {
  cacheKey: string;
  scope: string;
  symbol: string;
  value: T;
  sourceAsOf?: string | null;
  now: Date;
  ttlMs: number;
}) => {
  const cachedAt = input.now.toISOString();
  const expiresAt = new Date(input.now.getTime() + input.ttlMs).toISOString();
  const upsertResult = await db.prepare(`
    INSERT INTO market_cache_entries (
      cache_key, scope, symbol, schema_version, payload_json, source_as_of, cached_at, expires_at, last_refresh_error, last_refresh_attempted_at
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
    input.cacheKey,
    input.scope,
    input.symbol.trim().toUpperCase(),
    JSON.stringify(input.value),
    input.sourceAsOf || null,
    cachedAt,
    expiresAt,
    cachedAt,
  ).run();
  const upsertRowsRead = Math.max(1, Math.floor(rowsReadFrom(upsertResult) ?? 1));
  return { cachedAt, expiresAt, prunedRows: 0, rowsRead: upsertRowsRead };
};

/**
 * Explicit, bounded maintenance. It is deliberately not called by public
 * request paths: an edge-isolate-local timer cannot enforce a global cadence.
 */
export const pruneExpiredMarketCacheEntries = async (
  db: D1DatabaseLike,
  now = new Date(),
) => {
  const result = await db.prepare(`
    DELETE FROM market_cache_entries
    WHERE cache_key IN (
      SELECT cache_key
      FROM market_cache_entries
      WHERE expires_at < ?
      ORDER BY expires_at ASC, cache_key ASC
      LIMIT ?
    )
  `).bind(
    new Date(now.getTime() - MARKET_CACHE_RETENTION_MS).toISOString(),
    MAX_CACHE_PRUNE_ROWS,
  ).run();
  const rowsRead = rowsReadFrom(result) ?? MAX_CACHE_PRUNE_READ_ROWS;
  const rowsWritten = rowsWrittenFrom(result) ?? changesFrom(result) ?? MAX_CACHE_PRUNE_ROWS;
  return {
    rowsRead: Math.min(MAX_CACHE_PRUNE_READ_ROWS, Math.max(0, Math.floor(rowsRead))),
    rowsWritten: Math.min(MAX_CACHE_PRUNE_ROWS, Math.max(0, Math.floor(rowsWritten))),
  };
};

const recordRefreshError = async (db: D1DatabaseLike, cacheKey: string, now: Date, error: string) => {
  await db.prepare("UPDATE market_cache_entries SET last_refresh_error = ?, last_refresh_attempted_at = ? WHERE cache_key = ?")
    .bind(error.slice(0, 1_000), now.toISOString(), cacheKey)
    .run();
};

const logCache = (input: Record<string, unknown>) => console.log(JSON.stringify({ event: "market_cache", ...input }));

export async function resolveMarketCache<T>(options: ResolveMarketCacheOptions<T>): Promise<MarketCacheResolution<T>> {
  const now = options.now || (() => new Date());
  const cacheKey = buildMarketCacheKey(options.scope, options.symbol, options.params);
  const ttlMs = resolveMarketCacheTtlMs(options.dataset, options.ttlMs);
  if (options.quotaGuard) {
    const decision = options.quotaGuard();
    if (!decision.allow) throw new MarketCacheQuotaExceededError(decision);
  }
  const startedAt = Date.now();
  const deadlineMs = options.deadlineMs && options.deadlineMs > 0 ? Math.floor(options.deadlineMs) : null;
  const deadlineAt = deadlineMs === null ? null : startedAt + deadlineMs;
  const d1PhaseCapMs = deadlineMs === null ? undefined : Math.min(2_000, Math.max(25, Math.floor(deadlineMs / 4)));
  const staleReserveMs = deadlineMs === null ? 0 : Math.min(2_000, Math.max(25, Math.floor(deadlineMs / 5)));
  const phaseMs: Record<string, number> = {};

  const runPhase = async <R>(
    phase: string,
    operation: () => Promise<R>,
    maxMs?: number,
    phaseSignal: AbortSignal | null | undefined = options.signal,
  ): Promise<R> => {
    const phaseStartedAt = Date.now();
    const signal = phaseSignal === null ? undefined : phaseSignal;
    const remainingMs = deadlineAt === null ? null : deadlineAt - phaseStartedAt;
    if (remainingMs !== null && remainingMs <= 0) {
      throw new MarketCacheTimeoutError(phase, deadlineMs!);
    }
    const timeoutMs = remainingMs === null ? null : Math.max(1, Math.min(remainingMs, maxMs ?? remainingMs));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;
    try {
      if (signal?.aborted) {
        const error = new Error("Market cache request was aborted.");
        error.name = "AbortError";
        throw error;
      }
      const racers: Promise<R>[] = [operation()];
      if (timeoutMs !== null) {
        racers.push(new Promise<R>((_, reject) => {
          timeout = setTimeout(() => reject(new MarketCacheTimeoutError(phase, timeoutMs)), timeoutMs);
        }));
      }
      if (signal) {
        racers.push(new Promise<R>((_, reject) => {
          abortHandler = () => {
            const error = new Error("Market cache request was aborted.");
            error.name = "AbortError";
            reject(error);
          };
          signal.addEventListener("abort", abortHandler, { once: true });
          if (signal.aborted) abortHandler();
        }));
      }
      return await Promise.race(racers);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (abortHandler) signal?.removeEventListener("abort", abortHandler);
      phaseMs[phase] = (phaseMs[phase] || 0) + (Date.now() - phaseStartedAt);
    }
  };

  const log = (input: Record<string, unknown>) => logCache({
    requestId: options.requestId,
    scope: options.scope,
    symbol: options.symbol,
    dataset: options.dataset || "default",
    ttlMs,
    phaseMs,
    ...input,
  });
  const failureFields = (error: unknown) => ({
    errorClass: error instanceof Error ? error.name : "unknown",
    ...(error instanceof MarketCacheTimeoutError ? { timeoutPhase: error.phase, timeoutMs: error.timeoutMs } : {}),
  });

  if (!options.db) {
    let value: T;
    try {
      value = await runPhase("upstream", options.load);
    } catch (error) {
      log({ status: "failed", totalMs: Date.now() - startedAt, ...failureFields(error) });
      throw error;
    }
    const at = now();
    const cache = {
      status: "bypassed" as const,
      dataset: options.dataset,
      cachedAt: at.toISOString(),
      expiresAt: at.toISOString(),
      ageSeconds: 0,
      ttlMs,
      ageRatio: 0,
      guard: "bypassed" as const,
      rowRead: false,
      rowWritten: false,
      observability: { rowRead: "bypassed" as const, rowWritten: "bypassed" as const },
      rowsRead: 0,
      rowsWritten: 0,
      sourceAsOf: options.sourceAsOf?.(value) || null,
    };
    log({ status: cache.status, totalMs: Date.now() - startedAt });
    return { value, cache };
  }

  const initialNow = now();
  let existing: MarketCacheRow | null;
  try {
    existing = await runPhase("cache-read", () => readRow(options.db!, cacheKey), d1PhaseCapMs);
  } catch (error) {
    log({ status: "failed", totalMs: Date.now() - startedAt, ...failureFields(error) });
    throw error;
  }
  if (!options.force && existing && Date.parse(existing.expires_at) > initialNow.getTime()) {
    const cache = metadataFromRow(existing, "hit", initialNow, options.dataset, ttlMs, "hit", "bypassed");
    log({
      status: cache.status,
      ageSeconds: cache.ageSeconds,
      totalMs: Date.now() - startedAt,
      rowsRead: cache.rowsRead,
      rowsWritten: cache.rowsWritten,
    });
    return { value: parseRow<T>(existing), cache };
  }

  const pending = inFlight.get(cacheKey) as Promise<MarketCacheResolution<T>> | undefined;
  if (pending) {
    try {
      const resolved = await runPhase("inflight-wait", () => pending);
      log({ status: resolved.cache.status, coalesced: true, totalMs: Date.now() - startedAt });
      return resolved;
    } catch (error) {
      log({ status: "failed", coalesced: true, totalMs: Date.now() - startedAt, ...failureFields(error) });
      throw error;
    }
  }

  const refresh = (async (): Promise<MarketCacheResolution<T>> => {
    const upstreamStartedAt = Date.now();
    try {
      const decision = options.refreshQuotaGuard
        ? await runPhase("quota-guard", options.refreshQuotaGuard, d1PhaseCapMs, null)
        : options.quotaGuard?.();
      if (decision && !decision.allow) {
        log({
          status: "quota_blocked",
          quotaReason: decision.reason,
          projectedRowsRead: decision.projectedRowsRead,
          projectedRowsWritten: decision.projectedRowsWritten,
          resetsAtUtc: decision.resetsAtUtc,
        });
        throw new MarketCacheQuotaExceededError(decision);
      }
      const upstreamMaxMs = deadlineAt === null
        ? undefined
        : Math.max(1, deadlineAt - Date.now() - staleReserveMs);
      const value = await runPhase("upstream", options.load, upstreamMaxMs, null);
      const refreshedAt = now();
      const cacheWriteMaxMs = deadlineAt === null
        ? d1PhaseCapMs
        : Math.max(1, Math.min(d1PhaseCapMs!, deadlineAt - Date.now() - staleReserveMs));
      const written = await runPhase("cache-write", () => writeSuccess(options.db!, {
        cacheKey,
        scope: options.scope,
        symbol: options.symbol,
        value,
        sourceAsOf: options.sourceAsOf?.(value) || null,
        now: refreshedAt,
        ttlMs,
      }), cacheWriteMaxMs, null);
      const cache: MarketCacheMetadata = {
        status: "refreshed",
        dataset: options.dataset,
        cachedAt: written.cachedAt,
        expiresAt: written.expiresAt,
        ageSeconds: 0,
        ttlMs,
        ageRatio: 0,
        guard: "fresh",
        rowRead: true,
        rowWritten: true,
         observability: { rowRead: existing ? "hit" : "miss", rowWritten: "written" },
          rowsRead: 1 + written.rowsRead,
         rowsWritten: 1 + written.prunedRows,
        sourceAsOf: options.sourceAsOf?.(value) || null,
      };
      log({
        status: cache.status,
        upstreamMs: Date.now() - upstreamStartedAt,
        totalMs: Date.now() - startedAt,
        rowsRead: cache.rowsRead,
        rowsWritten: cache.rowsWritten,
      });
      return { value, cache };
    } catch (error) {
      if (error instanceof MarketCacheQuotaExceededError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const failedAt = now();
      let stale = existing;
      if (!stale) {
        try {
          stale = await runPhase("stale-read", () => readRow(options.db!, cacheKey), d1PhaseCapMs, null);
        } catch (fallbackError) {
          log({
            status: "failed",
            upstreamMs: Date.now() - upstreamStartedAt,
            totalMs: Date.now() - startedAt,
            originalErrorClass: error instanceof Error ? error.name : "unknown",
            originalFailurePhase: error instanceof MarketCacheTimeoutError ? error.phase : undefined,
            fallbackErrorClass: fallbackError instanceof Error ? fallbackError.name : "unknown",
            fallbackFailurePhase: fallbackError instanceof MarketCacheTimeoutError ? fallbackError.phase : undefined,
          });
          throw fallbackError;
        }
      }
      if (stale && options.allowStaleOnRefreshError !== false) {
        let recordErrorClass: string | undefined;
        try {
          await runPhase("record-error", () => recordRefreshError(options.db!, cacheKey, failedAt, message), d1PhaseCapMs, null);
        } catch (recordError) {
          recordErrorClass = recordError instanceof Error ? recordError.name : "unknown";
        }
        const cache = metadataFromRow(
          stale,
          "stale",
          failedAt,
          options.dataset,
          ttlMs,
          "hit",
          "failed",
          message,
          existing ? 2 : 3,
          1,
        );
        log({ status: cache.status, ageSeconds: cache.ageSeconds, upstreamMs: Date.now() - upstreamStartedAt, totalMs: Date.now() - startedAt, ...failureFields(error), recordErrorClass });
        return { value: parseRow<T>(stale), cache };
      }
      log({ status: "failed", upstreamMs: Date.now() - upstreamStartedAt, totalMs: Date.now() - startedAt, ...failureFields(error) });
      throw error;
    } finally {
      inFlight.delete(cacheKey);
    }
  })();

  inFlight.set(cacheKey, refresh as Promise<MarketCacheResolution<unknown>>);
  try {
    return await runPhase("refresh-wait", () => refresh);
  } catch (error) {
    log({ status: "failed", waitOnly: true, totalMs: Date.now() - startedAt, ...failureFields(error) });
    throw error;
  }
}
