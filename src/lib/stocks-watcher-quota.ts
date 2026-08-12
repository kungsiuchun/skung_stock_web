import type { D1DatabaseLike } from "./spx-recap-d1";
import {
  MARKET_CACHE_D1_DAILY_READ_LIMIT,
  MARKET_CACHE_D1_DAILY_WRITE_LIMIT,
  MARKET_CACHE_D1_QUOTA_HARD_THRESHOLD,
  MARKET_CACHE_WRITE_INDEX_AMPLIFICATION,
  MAX_CACHE_PRUNE_ROWS,
  MAX_CACHE_PRUNE_READ_ROWS,
  evaluateMarketCacheD1Quota,
  type MarketCacheD1QuotaDecision,
  type MarketCacheD1QuotaObservation,
} from "./market-data-cache";

/**
 * This table is a private, application-level guard for this Worker's D1
 * operations only. It is not Cloudflare account-wide billing telemetry and
 * does not account for unguarded products sharing the same D1 database.
 */
export const STOCKS_WATCHER_DAILY_USAGE_LEDGER_TABLE = "watcher_daily_usage_ledger";

/**
 * Reservation units are intentionally conservative. A request can read the
 * cache initially, perform a stale fallback, read one upsert key, scan the
 * bounded prune window (50 indexed inner rows + 50 outer PK lookups), and
 * perform every ledger read/update needed to reserve and finalize its usage.
 */
export const STOCKS_WATCHER_QUOTA_CACHE_READ_RESERVE =
  1 + 1 + 1 + MAX_CACHE_PRUNE_READ_ROWS;
/** One upsert plus up to 50 pruned rows, each amplified by table+PK+3 indexes. */
export const STOCKS_WATCHER_QUOTA_CACHE_WRITE_RESERVE =
  (1 + MAX_CACHE_PRUNE_ROWS) * MARKET_CACHE_WRITE_INDEX_AMPLIFICATION;
/**
 * The ledger SELECT is keyed by usage_date PRIMARY KEY. Accepted existing
 * rows conservatively reserve the initial SELECT plus one target lookup for
 * each conditional UPDATE; a missing row adds the post-INSERT SELECT.
 */
export const STOCKS_WATCHER_QUOTA_LEDGER_EXISTING_READ_RESERVE = 3;
export const STOCKS_WATCHER_QUOTA_LEDGER_MISSING_READ_RESERVE = 4;
export const STOCKS_WATCHER_QUOTA_LEDGER_READ_RESERVE =
  Math.max(STOCKS_WATCHER_QUOTA_LEDGER_EXISTING_READ_RESERVE, STOCKS_WATCHER_QUOTA_LEDGER_MISSING_READ_RESERVE);
/** First INSERT row+PK index, reserve UPDATE, finalize UPDATE. */
export const STOCKS_WATCHER_QUOTA_LEDGER_WRITE_RESERVE = 4;
/** Known threshold block: one usage_date PK read and no INSERT/UPDATE. */
export const STOCKS_WATCHER_KNOWN_THRESHOLD_BLOCKED_LEDGER_READ_ROWS = 1;
/**
 * Worst blocked path includes a race loser: initial SELECT, failed reserve
 * UPDATE target lookup, and the post-failure SELECT; it still performs no
 * finalize or write.
 */
export const STOCKS_WATCHER_BLOCKED_LEDGER_READ_ROWS = 3;
export const STOCKS_WATCHER_BLOCKED_LEDGER_WRITE_ROWS = 0;
/** Workers/Pages Free request contract used only to prove blocked-path safety. */
export const STOCKS_WATCHER_FREE_REQUESTS_PER_DAY = 100_000;
export const STOCKS_WATCHER_D1_READ_HEADROOM_AT_THRESHOLD =
  MARKET_CACHE_D1_DAILY_READ_LIMIT
  - Math.floor(MARKET_CACHE_D1_DAILY_READ_LIMIT * MARKET_CACHE_D1_QUOTA_HARD_THRESHOLD);
export const STOCKS_WATCHER_QUOTA_RESERVE_ROWS_READ =
  STOCKS_WATCHER_QUOTA_CACHE_READ_RESERVE + STOCKS_WATCHER_QUOTA_LEDGER_READ_RESERVE;
export const STOCKS_WATCHER_QUOTA_RESERVE_ROWS_WRITTEN =
  STOCKS_WATCHER_QUOTA_CACHE_WRITE_RESERVE + STOCKS_WATCHER_QUOTA_LEDGER_WRITE_RESERVE;
export const STOCKS_WATCHER_QUOTA_WORST_CASE_OBSERVATION = {
  rowsRead: STOCKS_WATCHER_QUOTA_CACHE_READ_RESERVE,
  rowsWritten: 1 + MAX_CACHE_PRUNE_ROWS,
} as const;

export type StocksWatcherQuotaErrorCode =
  | "LEDGER_READ_FAILED"
  | "LEDGER_RESERVE_FAILED"
  | "LEDGER_FINALIZE_FAILED"
  | "LEDGER_INVALID_ROW"
  | "LEDGER_RESERVATION_UNKNOWN";

export class StocksWatcherQuotaError extends Error {
  readonly code: StocksWatcherQuotaErrorCode;

  constructor(code: StocksWatcherQuotaErrorCode, message = "Market data quota guard unavailable.") {
    super(message);
    this.name = "StocksWatcherQuotaError";
    this.code = code;
  }
}

interface WatcherDailyUsageLedgerRow {
  usage_date: string;
  observed_reads: number;
  reserved_reads: number;
  observed_writes: number;
  reserved_writes: number;
  updated_at: string;
}

export interface StocksWatcherQuotaReservation {
  readonly dayUtc: string;
  readonly decision: MarketCacheD1QuotaDecision;
  readonly reserved: boolean;
  /** Record cache rows and release this request's reservation exactly once. */
  finalize: (observation?: MarketCacheD1QuotaObservation) => Promise<void>;
}

const utcDay = (value: Date) => {
  if (!Number.isFinite(value.getTime())) {
    throw new StocksWatcherQuotaError("LEDGER_READ_FAILED");
  }
  return value.toISOString().slice(0, 10);
};

const asCount = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
};

const parseLedgerRow = (row: WatcherDailyUsageLedgerRow | null, dayUtc: string) => {
  if (!row || row.usage_date !== dayUtc) {
    throw new StocksWatcherQuotaError("LEDGER_INVALID_ROW");
  }
  const observedReads = asCount(Number(row.observed_reads));
  const reservedReads = asCount(Number(row.reserved_reads));
  const observedWrites = asCount(Number(row.observed_writes));
  const reservedWrites = asCount(Number(row.reserved_writes));
  if (observedReads === null || reservedReads === null || observedWrites === null || reservedWrites === null) {
    throw new StocksWatcherQuotaError("LEDGER_INVALID_ROW");
  }
  return { observedReads, reservedReads, observedWrites, reservedWrites };
};

const changesFrom = (result: unknown) => {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  const meta = record.meta;
  const fromMeta = meta && typeof meta === "object" ? (meta as Record<string, unknown>).changes : undefined;
  const value = fromMeta ?? record.changes;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const readLedgerRow = async (db: D1DatabaseLike, dayUtc: string) => {
  try {
    return await db.prepare(`
      SELECT usage_date, observed_reads, reserved_reads, observed_writes, reserved_writes, updated_at
      FROM ${STOCKS_WATCHER_DAILY_USAGE_LEDGER_TABLE}
      WHERE usage_date = ?
    `).bind(dayUtc).first<WatcherDailyUsageLedgerRow>();
  } catch {
    throw new StocksWatcherQuotaError("LEDGER_READ_FAILED");
  }
};

const blockedReservation = (dayUtc: string, row: WatcherDailyUsageLedgerRow) => {
  const parsed = parseLedgerRow(row, dayUtc);
  return evaluateMarketCacheD1Quota({
    currentUtcDay: dayUtc,
    usage: {
      dayUtc,
      rowsRead: parsed.observedReads + parsed.reservedReads,
      rowsWritten: parsed.observedWrites + parsed.reservedWrites,
    },
    rowsRead: STOCKS_WATCHER_QUOTA_RESERVE_ROWS_READ,
    rowsWritten: STOCKS_WATCHER_QUOTA_RESERVE_ROWS_WRITTEN,
  });
};

/**
 * Reserve one request's worst-case cache and ledger work atomically. The
 * conditional UPDATE is the concurrency boundary: two requests can never
 * both pass the 70% threshold for the same UTC ledger row.
 */
export const reserveStocksWatcherD1Quota = async (
  db: D1DatabaseLike,
  now = new Date(),
): Promise<StocksWatcherQuotaReservation> => {
  const dayUtc = utcDay(now);
  const updatedAt = now.toISOString();

  let row = await readLedgerRow(db, dayUtc);
  if (!row) {
    try {
      await db.prepare(`
        INSERT OR IGNORE INTO ${STOCKS_WATCHER_DAILY_USAGE_LEDGER_TABLE} (
          usage_date, observed_reads, reserved_reads, observed_writes, reserved_writes, updated_at
        ) VALUES (?, 0, 0, 0, 0, ?)
      `).bind(dayUtc, updatedAt).run();
    } catch {
      throw new StocksWatcherQuotaError("LEDGER_RESERVE_FAILED");
    }
    row = await readLedgerRow(db, dayUtc);
  }
  if (!row) throw new StocksWatcherQuotaError("LEDGER_INVALID_ROW");
  const candidate = blockedReservation(dayUtc, row);
  if (!candidate.allow) {
    return {
      dayUtc,
      decision: candidate,
      reserved: false,
      finalize: async () => undefined,
    };
  }

  let reserveResult: unknown;
  try {
    reserveResult = await db.prepare(`
      UPDATE ${STOCKS_WATCHER_DAILY_USAGE_LEDGER_TABLE}
      SET reserved_reads = reserved_reads + ?,
          reserved_writes = reserved_writes + ?,
          updated_at = ?
      WHERE usage_date = ?
        AND observed_reads + reserved_reads + ? < ?
        AND observed_writes + reserved_writes + ? < ?
    `).bind(
      STOCKS_WATCHER_QUOTA_RESERVE_ROWS_READ,
      STOCKS_WATCHER_QUOTA_RESERVE_ROWS_WRITTEN,
      updatedAt,
      dayUtc,
      STOCKS_WATCHER_QUOTA_RESERVE_ROWS_READ,
      Math.floor(MARKET_CACHE_D1_DAILY_READ_LIMIT * MARKET_CACHE_D1_QUOTA_HARD_THRESHOLD),
      STOCKS_WATCHER_QUOTA_RESERVE_ROWS_WRITTEN,
      Math.floor(MARKET_CACHE_D1_DAILY_WRITE_LIMIT * MARKET_CACHE_D1_QUOTA_HARD_THRESHOLD),
    ).run();
  } catch {
    throw new StocksWatcherQuotaError("LEDGER_RESERVE_FAILED");
  }
  const changes = changesFrom(reserveResult);
  if (changes === null) throw new StocksWatcherQuotaError("LEDGER_RESERVATION_UNKNOWN");
  if (changes !== 1) {
    const current = await readLedgerRow(db, dayUtc);
    if (!current) throw new StocksWatcherQuotaError("LEDGER_INVALID_ROW");
    const rejected = blockedReservation(dayUtc, current);
    if (rejected.allow) throw new StocksWatcherQuotaError("LEDGER_RESERVATION_UNKNOWN");
    return {
      dayUtc,
      decision: rejected,
      reserved: false,
      finalize: async () => undefined,
    };
  }

  let finalized = false;
  let finalizationStarted = false;
  const finalize = async (observation: MarketCacheD1QuotaObservation = STOCKS_WATCHER_QUOTA_WORST_CASE_OBSERVATION) => {
    if (finalized || finalizationStarted) return;
    finalizationStarted = true;
    const rowsRead = asCount(observation.rowsRead);
    const rowsWritten = asCount(observation.rowsWritten);
    if (rowsRead === null || rowsWritten === null) {
      throw new StocksWatcherQuotaError("LEDGER_FINALIZE_FAILED");
    }
    const observedReads = rowsRead + STOCKS_WATCHER_QUOTA_LEDGER_READ_RESERVE;
    const observedWrites = rowsWritten * MARKET_CACHE_WRITE_INDEX_AMPLIFICATION
      + STOCKS_WATCHER_QUOTA_LEDGER_WRITE_RESERVE;
    let result: unknown;
    try {
      result = await db.prepare(`
        UPDATE ${STOCKS_WATCHER_DAILY_USAGE_LEDGER_TABLE}
        SET observed_reads = observed_reads + ?,
            reserved_reads = MAX(0, reserved_reads - ?),
            observed_writes = observed_writes + ?,
            reserved_writes = MAX(0, reserved_writes - ?),
            updated_at = ?
        WHERE usage_date = ?
      `).bind(
        observedReads,
        STOCKS_WATCHER_QUOTA_RESERVE_ROWS_READ,
        observedWrites,
        STOCKS_WATCHER_QUOTA_RESERVE_ROWS_WRITTEN,
        new Date().toISOString(),
        dayUtc,
      ).run();
    } catch {
      throw new StocksWatcherQuotaError("LEDGER_FINALIZE_FAILED");
    }
    const finalizeChanges = changesFrom(result);
    if (finalizeChanges === null || finalizeChanges !== 1) {
      throw new StocksWatcherQuotaError("LEDGER_FINALIZE_FAILED");
    }
    finalized = true;
  };

  return { dayUtc, decision: candidate, reserved: true, finalize };
};
