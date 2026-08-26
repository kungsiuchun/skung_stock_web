import {
  MARKET_CACHE_D1_DAILY_READ_LIMIT,
  MARKET_CACHE_D1_DAILY_WRITE_LIMIT,
  MARKET_CACHE_D1_QUOTA_HARD_THRESHOLD,
  MARKET_CACHE_WRITE_INDEX_AMPLIFICATION,
  evaluateMarketCacheD1Quota,
  type MarketCacheD1QuotaDecision,
} from "./market-data-cache";
import type { D1DatabaseLike } from "./spx-recap-d1";

/** Cache read + quota reservation + indexed cache write. Public paths never prune. */
export const STOCKS_WATCHER_CACHE_REFRESH_READ_RESERVE = 3;
/** The quota row and cache upsert are separate indexed writes. */
export const STOCKS_WATCHER_CACHE_REFRESH_WRITE_RESERVE = 2 * MARKET_CACHE_WRITE_INDEX_AMPLIFICATION;
/** The production curated universe is explicitly capped at twenty active assets. */
export const STOCKS_WATCHER_TRACKED_ASSET_READ_RESERVE = 20;
export const STOCKS_WATCHER_SNAPSHOT_LOADER_READ_RESERVE = STOCKS_WATCHER_TRACKED_ASSET_READ_RESERVE + 1;

const utcDay = (now: Date) => now.toISOString().slice(0, 10);

const blockedDecision = (
  dayUtc: string,
  reason: "quota_state_invalid" | "quota_store_unavailable",
): MarketCacheD1QuotaDecision => {
  const base = evaluateMarketCacheD1Quota({
    currentUtcDay: dayUtc,
    usage: {
      dayUtc,
      rowsRead: 0,
      rowsWritten: 0,
    },
  });
  return { ...base, allow: false, blocked: true, reason };
};

const decisionFromStoredUsage = (
  dayUtc: string,
  payloadJson: string,
): MarketCacheD1QuotaDecision => {
  try {
    const usage = JSON.parse(payloadJson) as { dayUtc?: unknown; rowsRead?: unknown; rowsWritten?: unknown };
    if (usage.dayUtc !== dayUtc || typeof usage.rowsRead !== "number" || typeof usage.rowsWritten !== "number") {
      return blockedDecision(dayUtc, "quota_state_invalid");
    }
    return evaluateMarketCacheD1Quota({
      currentUtcDay: dayUtc,
      usage: { dayUtc, rowsRead: usage.rowsRead, rowsWritten: usage.rowsWritten },
    });
  } catch {
    return blockedDecision(dayUtc, "quota_state_invalid");
  }
};

export interface MarketCacheRefreshQuotaOptions {
  /** Additional bounded reads performed by the refresh loader itself. */
  loaderRowsRead?: number;
  operation?: string;
}

/**
 * Atomic site-wide MARKET_CACHE_DB reservation. The row deliberately covers
 * every cache-backed public feature, so Watcher cannot consume a private
 * budget while Finance Dashboard or Backtest consumes the same database.
 */
export const reserveMarketCacheRefreshQuota = async (
  db: D1DatabaseLike,
  options: MarketCacheRefreshQuotaOptions = {},
  now = new Date(),
): Promise<MarketCacheD1QuotaDecision> => {
  const dayUtc = utcDay(now);
  const loaderRowsRead = options.loaderRowsRead ?? 0;
  if (!Number.isInteger(loaderRowsRead) || loaderRowsRead < 0) return blockedDecision(dayUtc, "quota_state_invalid");
  const rowsReadReserve = STOCKS_WATCHER_CACHE_REFRESH_READ_RESERVE + loaderRowsRead;
  const readThreshold = Math.floor(MARKET_CACHE_D1_DAILY_READ_LIMIT * MARKET_CACHE_D1_QUOTA_HARD_THRESHOLD);
  const writeThreshold = Math.floor(MARKET_CACHE_D1_DAILY_WRITE_LIMIT * MARKET_CACHE_D1_QUOTA_HARD_THRESHOLD);
  const cachedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 48 * 60 * 60_000).toISOString();
  const cacheKey = `__market_cache_refresh_quota__:${dayUtc}`;
  const initialPayload = JSON.stringify({
    dayUtc,
    rowsRead: rowsReadReserve,
    rowsWritten: STOCKS_WATCHER_CACHE_REFRESH_WRITE_RESERVE,
  });
  let row: { payload_json: string } | null;
  try {
    row = await db.prepare(`
      INSERT INTO market_cache_entries (
        cache_key, scope, symbol, schema_version, payload_json, source_as_of, cached_at, expires_at, last_refresh_error, last_refresh_attempted_at
      ) VALUES (?, 'market-cache-quota', 'MARKET', 1, ?, NULL, ?, ?, NULL, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        payload_json = json_object(
          'dayUtc', ?,
          'rowsRead', MIN(CAST(json_extract(market_cache_entries.payload_json, '$.rowsRead') AS INTEGER) + ?, ?),
          'rowsWritten', MIN(CAST(json_extract(market_cache_entries.payload_json, '$.rowsWritten') AS INTEGER) + ?, ?)
        ),
        cached_at = ?,
        expires_at = ?,
        last_refresh_error = NULL,
        last_refresh_attempted_at = ?
      WHERE json_valid(market_cache_entries.payload_json)
        AND json_extract(market_cache_entries.payload_json, '$.dayUtc') = ?
        AND json_type(market_cache_entries.payload_json, '$.rowsRead') = 'integer'
        AND json_type(market_cache_entries.payload_json, '$.rowsWritten') = 'integer'
        AND CAST(json_extract(market_cache_entries.payload_json, '$.rowsRead') AS INTEGER) >= 0
        AND CAST(json_extract(market_cache_entries.payload_json, '$.rowsWritten') AS INTEGER) >= 0
        AND CAST(json_extract(market_cache_entries.payload_json, '$.rowsRead') AS INTEGER) < ?
        AND CAST(json_extract(market_cache_entries.payload_json, '$.rowsWritten') AS INTEGER) < ?
      RETURNING payload_json
    `).bind(
      cacheKey,
      initialPayload,
      cachedAt,
      expiresAt,
      cachedAt,
      dayUtc,
      rowsReadReserve,
      readThreshold,
      STOCKS_WATCHER_CACHE_REFRESH_WRITE_RESERVE,
      writeThreshold,
      cachedAt,
      expiresAt,
      cachedAt,
      dayUtc,
      readThreshold,
      writeThreshold,
    ).first<{ payload_json: string }>();
  } catch {
    return blockedDecision(dayUtc, "quota_store_unavailable");
  }
  if (!row) {
    try {
      const current = await db.prepare(`
        SELECT payload_json
        FROM market_cache_entries
        WHERE cache_key = ? AND scope = 'market-cache-quota'
        LIMIT 1
      `).bind(cacheKey).first<{ payload_json: string }>();
      return current
        ? decisionFromStoredUsage(dayUtc, current.payload_json)
        : blockedDecision(dayUtc, "quota_state_invalid");
    } catch {
      return blockedDecision(dayUtc, "quota_store_unavailable");
    }
  }
  try {
    const usage = JSON.parse(row.payload_json) as { dayUtc?: unknown; rowsRead?: unknown; rowsWritten?: unknown };
    if (usage.dayUtc !== dayUtc || typeof usage.rowsRead !== "number" || typeof usage.rowsWritten !== "number") {
      return blockedDecision(dayUtc, "quota_state_invalid");
    }
    return evaluateMarketCacheD1Quota({
      currentUtcDay: dayUtc,
      usage: {
        dayUtc,
        rowsRead: usage.rowsRead - rowsReadReserve,
        rowsWritten: usage.rowsWritten - STOCKS_WATCHER_CACHE_REFRESH_WRITE_RESERVE,
      },
      rowsRead: rowsReadReserve,
      rowsWritten: STOCKS_WATCHER_CACHE_REFRESH_WRITE_RESERVE,
    });
  } catch {
    return blockedDecision(dayUtc, "quota_state_invalid");
  }
};

/** Watcher needs the bounded twenty-asset tracking query before its refresh. */
export const reserveStocksWatcherCacheRefreshQuota = (
  db: D1DatabaseLike,
  options: { loaderRowsRead?: number } = {},
  now = new Date(),
) => reserveMarketCacheRefreshQuota(db, {
  loaderRowsRead: options.loaderRowsRead,
  operation: "stocks_watcher",
}, now);
