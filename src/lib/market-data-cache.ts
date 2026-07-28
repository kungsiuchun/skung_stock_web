import type { D1DatabaseLike } from "./spx-recap-d1";

export const MARKET_CACHE_TTL_MS = 60_000;
const MARKET_CACHE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export type MarketCacheStatus = "hit" | "refreshed" | "stale" | "bypassed";

export interface MarketCacheMetadata {
  status: MarketCacheStatus;
  cachedAt: string;
  expiresAt: string;
  ageSeconds: number;
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

const metadataFromRow = (row: MarketCacheRow, status: MarketCacheStatus, now: Date, refreshError?: string): MarketCacheMetadata => ({
  status,
  cachedAt: row.cached_at,
  expiresAt: row.expires_at,
  ageSeconds: Math.max(0, Math.floor((now.getTime() - Date.parse(row.cached_at)) / 1_000)),
  sourceAsOf: row.source_as_of,
  ...(refreshError ? { refreshError } : {}),
});

const readRow = async (db: D1DatabaseLike, cacheKey: string) =>
  db.prepare("SELECT cache_key, payload_json, source_as_of, cached_at, expires_at, last_refresh_error FROM market_cache_entries WHERE cache_key = ?")
    .bind(cacheKey)
    .first<MarketCacheRow>();

const writeSuccess = async <T>(db: D1DatabaseLike, input: {
  cacheKey: string;
  scope: string;
  symbol: string;
  value: T;
  sourceAsOf?: string | null;
  now: Date;
}) => {
  const cachedAt = input.now.toISOString();
  const expiresAt = new Date(input.now.getTime() + MARKET_CACHE_TTL_MS).toISOString();
  await db.prepare(`
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
  await db.prepare("DELETE FROM market_cache_entries WHERE cached_at < ?")
    .bind(new Date(input.now.getTime() - MARKET_CACHE_RETENTION_MS).toISOString())
    .run();

  return { cachedAt, expiresAt };
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
      cachedAt: at.toISOString(),
      expiresAt: at.toISOString(),
      ageSeconds: 0,
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
    const cache = metadataFromRow(existing, "hit", initialNow);
    log({ status: cache.status, ageSeconds: cache.ageSeconds, totalMs: Date.now() - startedAt });
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
      }), cacheWriteMaxMs, null);
      const cache: MarketCacheMetadata = {
        status: "refreshed",
        cachedAt: written.cachedAt,
        expiresAt: written.expiresAt,
        ageSeconds: 0,
        sourceAsOf: options.sourceAsOf?.(value) || null,
      };
      log({ status: cache.status, upstreamMs: Date.now() - upstreamStartedAt, totalMs: Date.now() - startedAt });
      return { value, cache };
    } catch (error) {
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
      if (stale) {
        let recordErrorClass: string | undefined;
        try {
          await runPhase("record-error", () => recordRefreshError(options.db!, cacheKey, failedAt, message), d1PhaseCapMs, null);
        } catch (recordError) {
          recordErrorClass = recordError instanceof Error ? recordError.name : "unknown";
        }
        const cache = metadataFromRow(stale, "stale", failedAt, message);
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
