import {
  MARKET_CACHE_D1_DAILY_READ_LIMIT,
  MARKET_CACHE_D1_DAILY_WRITE_LIMIT,
  MARKET_CACHE_D1_QUOTA_HARD_THRESHOLD,
  MARKET_CACHE_WRITE_INDEX_AMPLIFICATION,
  MAX_CACHE_PRUNE_READ_ROWS,
  MAX_CACHE_PRUNE_ROWS,
  evaluateMarketCacheD1Quota,
  type MarketCacheD1QuotaDecision,
} from "./market-data-cache";
import type { D1DatabaseLike } from "./spx-recap-d1";

export const STOCKS_WATCHER_CACHE_REFRESH_READ_RESERVE = 3 + MAX_CACHE_PRUNE_READ_ROWS;
export const STOCKS_WATCHER_CACHE_REFRESH_WRITE_RESERVE = (2 + MAX_CACHE_PRUNE_ROWS) * MARKET_CACHE_WRITE_INDEX_AMPLIFICATION;
export const STOCKS_WATCHER_TRACKED_ASSET_READ_RESERVE = 500;
export const STOCKS_WATCHER_SNAPSHOT_LOADER_READ_RESERVE = STOCKS_WATCHER_TRACKED_ASSET_READ_RESERVE + 1;

const utcDay = (now: Date) => now.toISOString().slice(0, 10);

const unavailableDecision = (dayUtc: string): MarketCacheD1QuotaDecision =>
  evaluateMarketCacheD1Quota({
    currentUtcDay: dayUtc,
    usage: {
      dayUtc,
      rowsRead: MARKET_CACHE_D1_DAILY_READ_LIMIT,
      rowsWritten: MARKET_CACHE_D1_DAILY_WRITE_LIMIT,
    },
  });

export const reserveStocksWatcherCacheRefreshQuota = async (
  db: D1DatabaseLike,
  options: { loaderRowsRead?: number } = {},
  now = new Date(),
): Promise<MarketCacheD1QuotaDecision> => {
  const dayUtc = utcDay(now);
  const loaderRowsRead = options.loaderRowsRead ?? 0;
  if (!Number.isInteger(loaderRowsRead) || loaderRowsRead < 0) return unavailableDecision(dayUtc);
  const rowsReadReserve = STOCKS_WATCHER_CACHE_REFRESH_READ_RESERVE + loaderRowsRead;
  const readThreshold = Math.floor(MARKET_CACHE_D1_DAILY_READ_LIMIT * MARKET_CACHE_D1_QUOTA_HARD_THRESHOLD);
  const writeThreshold = Math.floor(MARKET_CACHE_D1_DAILY_WRITE_LIMIT * MARKET_CACHE_D1_QUOTA_HARD_THRESHOLD);
  const cachedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 48 * 60 * 60_000).toISOString();
  const cacheKey = `__stocks_watcher_refresh_quota__:${dayUtc}`;
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
      ) VALUES (?, 'stocks-watcher-quota', 'MARKET', 1, ?, NULL, ?, ?, NULL, ?)
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
    return unavailableDecision(dayUtc);
  }
  if (!row) return unavailableDecision(dayUtc);
  try {
    const usage = JSON.parse(row.payload_json) as { dayUtc?: unknown; rowsRead?: unknown; rowsWritten?: unknown };
    if (usage.dayUtc !== dayUtc || typeof usage.rowsRead !== "number" || typeof usage.rowsWritten !== "number") {
      return unavailableDecision(dayUtc);
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
    return unavailableDecision(dayUtc);
  }
};
