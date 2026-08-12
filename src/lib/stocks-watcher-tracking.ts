import type { D1DatabaseLike } from "./spx-recap-d1";
import { normalizeStocksWatcherSymbol } from "./stocks-native-yahoo";

/** Metadata-only asset registration. Market payloads never belong in this table. */
export interface StocksWatcherTrackedAsset {
  symbol: string;
  providerSymbol: string;
  priority: number;
  displayName: string | null;
  assetType: string | null;
  isActive: boolean;
  metadataJson: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Public, metadata-only representation of the admin-curated Watcher universe. */
export interface StocksWatcherTrackedWatchlistStock {
  symbol: string;
  companyName: string;
  sector: string;
  type: "Stock" | "ETF" | "ADR" | "Index";
  /** Deliberately absent market data. Rows must be refreshed from Yahoo before display. */
  fallbackPrice: number;
  fallbackChange: number;
  fallbackChangePercent: number;
}

export type StocksWatcherRefreshStatus = "never" | "ok" | "failed" | "stale";

/** Refresh lifecycle metadata; no quote/options/news payload is stored here. */
export interface StocksWatcherRefreshState {
  symbol: string;
  dataset: string;
  status: StocksWatcherRefreshStatus;
  lastAttemptedAt: string | null;
  lastSuccessfulAt: string | null;
  lastSourceAsOf: string | null;
  lastErrorCode: string | null;
  nextEligibleRefresh: string | null;
  updatedAt: string;
}

interface TrackedAssetRow {
  symbol: string;
  provider_symbol: string;
  priority: number;
  display_name: string | null;
  asset_type: string | null;
  is_active: number;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

interface RefreshStateRow {
  symbol: string;
  dataset: string;
  status: string;
  last_attempted_at: string | null;
  last_successful_at: string | null;
  last_source_as_of: string | null;
  last_error_code: string | null;
  next_eligible_refresh: string | null;
  updated_at: string;
}

const normalizeStatus = (value: string): StocksWatcherRefreshStatus => {
  if (value === "ok" || value === "failed" || value === "stale" || value === "never") return value;
  throw new Error(`Unknown watcher refresh status: ${value}`);
};

const mapTrackedAsset = (row: TrackedAssetRow): StocksWatcherTrackedAsset => ({
  symbol: normalizeStocksWatcherSymbol(row.symbol),
  providerSymbol: row.provider_symbol,
  priority: row.priority,
  displayName: row.display_name,
  assetType: row.asset_type,
  isActive: row.is_active === 1,
  metadataJson: row.metadata_json,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapRefreshState = (row: RefreshStateRow): StocksWatcherRefreshState => ({
  symbol: normalizeStocksWatcherSymbol(row.symbol),
  dataset: row.dataset,
  status: normalizeStatus(row.status),
  lastAttemptedAt: row.last_attempted_at,
  lastSuccessfulAt: row.last_successful_at,
  lastSourceAsOf: row.last_source_as_of,
  lastErrorCode: row.last_error_code,
  nextEligibleRefresh: row.next_eligible_refresh,
  updatedAt: row.updated_at,
});

/** Read tracked asset metadata; intentionally no public write counterpart exists. */
export async function listStocksWatcherTrackedAssets(
  db: D1DatabaseLike,
  options: {
    activeOnly?: boolean;
    providerSymbol?: string;
    minPriority?: number;
    limit?: number;
  } = {},
): Promise<StocksWatcherTrackedAsset[]> {
  const clauses = ["1 = 1"];
  const values: unknown[] = [];
  if (options.activeOnly ?? true) clauses.push("is_active = 1");
  if (options.providerSymbol !== undefined) {
    const providerSymbol = options.providerSymbol.trim();
    if (!providerSymbol || providerSymbol.length > 64) throw new Error("Invalid provider symbol.");
    clauses.push("provider_symbol = ?");
    values.push(providerSymbol);
  }
  if (options.minPriority !== undefined) {
    if (!Number.isInteger(options.minPriority) || options.minPriority < 0) throw new Error("Invalid watcher priority.");
    clauses.push("priority >= ?");
    values.push(options.minPriority);
  }
  if (options.limit !== undefined && (!Number.isFinite(options.limit) || !Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error("Invalid watcher asset limit.");
  }
  const limit = options.limit === undefined ? null : Math.min(500, options.limit);
  if (limit !== null) values.push(limit);
  const result = await db.prepare(`
    SELECT symbol, provider_symbol, priority, display_name, asset_type, is_active, metadata_json, created_at, updated_at
    FROM tracked_assets
    WHERE ${clauses.join(" AND ")}
    ORDER BY priority DESC, symbol ASC
    ${limit === null ? "" : "LIMIT ?"}
  `).bind(...values).all<TrackedAssetRow>();
  return (result.results || []).map(mapTrackedAsset);
}

const trackedWatchlistType = (assetType: string | null): StocksWatcherTrackedWatchlistStock["type"] => {
  switch ((assetType || "equity").trim().toLowerCase()) {
    case "equity":
    case "stock":
      return "Stock";
    case "etf":
      return "ETF";
    case "adr":
      return "ADR";
    case "index":
      return "Index";
    default:
      throw new Error(`Unsupported tracked asset type for ${assetType || "unknown"}.`);
  }
};

const trackedWatchlistSector = (asset: StocksWatcherTrackedAsset) => {
  if (!asset.metadataJson) throw new Error(`Tracked asset ${asset.symbol} is missing metadata_json.`);
  let metadata: unknown;
  try {
    metadata = JSON.parse(asset.metadataJson);
  } catch {
    throw new Error(`Tracked asset ${asset.symbol} has invalid metadata_json.`);
  }
  const sector = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).gicsSector
    : null;
  if (typeof sector !== "string" || !sector.trim()) {
    throw new Error(`Tracked asset ${asset.symbol} is missing metadata_json.gicsSector.`);
  }
  return sector.trim();
};

/**
 * Convert active D1 metadata into the Watcher's rendered universe. This never
 * supplies prices, changes, or any synthetic market field.
 */
export const buildStocksWatcherTrackedWatchlist = (assets: StocksWatcherTrackedAsset[]) => ({
  symbols: assets.map((asset) => asset.symbol),
  stocks: assets.map((asset): StocksWatcherTrackedWatchlistStock => ({
    symbol: asset.symbol,
    companyName: asset.displayName?.trim() || asset.symbol,
    sector: trackedWatchlistSector(asset),
    type: trackedWatchlistType(asset.assetType),
    fallbackPrice: Number.NaN,
    fallbackChange: Number.NaN,
    fallbackChangePercent: Number.NaN,
  })),
});

/** Read one refresh state row; this is repository/admin-only metadata access. */
export async function getStocksWatcherRefreshState(
  db: D1DatabaseLike,
  symbol: string,
  dataset: string,
): Promise<StocksWatcherRefreshState | null> {
  const normalizedSymbol = normalizeStocksWatcherSymbol(symbol);
  const normalizedDataset = dataset.trim().toLowerCase();
  if (!normalizedDataset || normalizedDataset.length > 64) throw new Error("Invalid watcher dataset.");
  const row = await db.prepare(`
    SELECT symbol, dataset, status, last_attempted_at, last_successful_at,
      last_source_as_of, last_error_code, next_eligible_refresh, updated_at
    FROM watcher_refresh_state
    WHERE symbol = ? AND dataset = ?
  `).bind(normalizedSymbol, normalizedDataset).first<RefreshStateRow>();
  return row ? mapRefreshState(row) : null;
}

/** Read all refresh states for one symbol, without exposing cached market rows. */
export async function listStocksWatcherRefreshStates(
  db: D1DatabaseLike,
  symbol: string,
): Promise<StocksWatcherRefreshState[]> {
  const normalizedSymbol = normalizeStocksWatcherSymbol(symbol);
  const result = await db.prepare(`
    SELECT symbol, dataset, status, last_attempted_at, last_successful_at,
      last_source_as_of, last_error_code, next_eligible_refresh, updated_at
    FROM watcher_refresh_state
    WHERE symbol = ?
    ORDER BY dataset ASC
  `).bind(normalizedSymbol).all<RefreshStateRow>();
  return (result.results || []).map(mapRefreshState);
}
