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

  if (!options.db) {
    const value = await options.load();
    const at = now();
    const cache = {
      status: "bypassed" as const,
      cachedAt: at.toISOString(),
      expiresAt: at.toISOString(),
      ageSeconds: 0,
      sourceAsOf: options.sourceAsOf?.(value) || null,
    };
    logCache({ scope: options.scope, symbol: options.symbol, status: cache.status, totalMs: Date.now() - startedAt });
    return { value, cache };
  }

  const initialNow = now();
  const existing = await readRow(options.db, cacheKey);
  if (!options.force && existing && Date.parse(existing.expires_at) > initialNow.getTime()) {
    const cache = metadataFromRow(existing, "hit", initialNow);
    logCache({ scope: options.scope, symbol: options.symbol, status: cache.status, ageSeconds: cache.ageSeconds, totalMs: Date.now() - startedAt });
    return { value: parseRow<T>(existing), cache };
  }

  const pending = inFlight.get(cacheKey) as Promise<MarketCacheResolution<T>> | undefined;
  if (pending) return pending;

  const refresh = (async (): Promise<MarketCacheResolution<T>> => {
    const upstreamStartedAt = Date.now();
    try {
      const value = await options.load();
      const refreshedAt = now();
      const written = await writeSuccess(options.db!, {
        cacheKey,
        scope: options.scope,
        symbol: options.symbol,
        value,
        sourceAsOf: options.sourceAsOf?.(value) || null,
        now: refreshedAt,
      });
      const cache: MarketCacheMetadata = {
        status: "refreshed",
        cachedAt: written.cachedAt,
        expiresAt: written.expiresAt,
        ageSeconds: 0,
        sourceAsOf: options.sourceAsOf?.(value) || null,
      };
      logCache({ scope: options.scope, symbol: options.symbol, status: cache.status, upstreamMs: Date.now() - upstreamStartedAt, totalMs: Date.now() - startedAt });
      return { value, cache };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedAt = now();
      const stale = await readRow(options.db!, cacheKey);
      if (stale) {
        await recordRefreshError(options.db!, cacheKey, failedAt, message);
        const cache = metadataFromRow(stale, "stale", failedAt, message);
        logCache({ scope: options.scope, symbol: options.symbol, status: cache.status, ageSeconds: cache.ageSeconds, upstreamMs: Date.now() - upstreamStartedAt, totalMs: Date.now() - startedAt, errorClass: error instanceof Error ? error.name : "unknown" });
        return { value: parseRow<T>(stale), cache };
      }
      logCache({ scope: options.scope, symbol: options.symbol, status: "failed", upstreamMs: Date.now() - upstreamStartedAt, totalMs: Date.now() - startedAt, errorClass: error instanceof Error ? error.name : "unknown" });
      throw error;
    } finally {
      inFlight.delete(cacheKey);
    }
  })();

  inFlight.set(cacheKey, refresh as Promise<MarketCacheResolution<unknown>>);
  return refresh;
}
