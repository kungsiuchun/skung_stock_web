import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStocksWatcherTrackedWatchlist,
  getStocksWatcherRefreshState,
  listStocksWatcherRefreshStates,
  listStocksWatcherTrackedAssets,
} from "../src/lib/stocks-watcher-tracking";
import type { D1DatabaseLike } from "../src/lib/spx-recap-d1";

class TrackingMemoryD1 implements D1DatabaseLike {
  lastQuery = "";
  lastValues: unknown[] = [];

  prepare(query: string) {
    this.lastQuery = query;
    let values: unknown[] = [];
    const statement = {
      bind: (...next: unknown[]) => {
        values = next;
        this.lastValues = next;
        return statement;
      },
      first: async <T>() => {
        if (!query.includes("FROM watcher_refresh_state")) return null;
        return (values[0] === "NVDA" && values[1] === "quote"
          ? {
              symbol: "NVDA",
              dataset: "quote",
              status: "ok",
              last_attempted_at: "2026-08-10T12:00:00.000Z",
              last_successful_at: "2026-08-10T12:00:01.000Z",
              last_source_as_of: "2026-08-10T11:59:59.000Z",
              last_error_code: null,
              next_eligible_refresh: "2026-08-10T12:15:00.000Z",
              updated_at: "2026-08-10T12:00:01.000Z",
            }
          : null) as T | null;
      },
      all: async <T>() => {
        if (query.includes("FROM tracked_assets")) {
          return {
            results: [
              {
                symbol: "NVDA",
                provider_symbol: "NVDA",
                priority: 10,
                display_name: "NVIDIA",
                asset_type: "stock",
                is_active: 1,
                metadata_json: '{"gicsSector":"Information Technology","seedSet":"sp500-50-v1"}',
                created_at: "2026-08-10T00:00:00.000Z",
                updated_at: "2026-08-10T00:00:00.000Z",
              },
            ] as T[],
          };
        }
        return {
          results: [
            {
              symbol: "NVDA",
              dataset: "quote",
              status: "ok",
              last_attempted_at: "2026-08-10T12:00:00.000Z",
              last_successful_at: "2026-08-10T12:00:01.000Z",
              last_source_as_of: "2026-08-10T11:59:59.000Z",
              last_error_code: null,
              next_eligible_refresh: "2026-08-10T12:15:00.000Z",
              updated_at: "2026-08-10T12:00:01.000Z",
            },
          ] as T[],
        };
      },
      run: async () => ({}),
    };
    return statement;
  }
}

test("watcher tracking repository reads metadata without exposing market payloads", async () => {
  const db = new TrackingMemoryD1();
  const assets = await listStocksWatcherTrackedAssets(db);
  assert.deepEqual(assets, [{
    symbol: "NVDA",
    providerSymbol: "NVDA",
    priority: 10,
    displayName: "NVIDIA",
    assetType: "stock",
    isActive: true,
    metadataJson: '{"gicsSector":"Information Technology","seedSet":"sp500-50-v1"}',
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  }]);
  const watchlist = buildStocksWatcherTrackedWatchlist(assets);
  assert.deepEqual(watchlist.symbols, ["NVDA"]);
  assert.equal(watchlist.stocks[0]?.companyName, "NVIDIA");
  assert.equal(watchlist.stocks[0]?.sector, "Information Technology");
  assert.equal(Number.isNaN(watchlist.stocks[0]?.fallbackPrice), true);

  const state = await getStocksWatcherRefreshState(db, "nvda", "quote");
  assert.equal(state?.status, "ok");
  assert.equal(state?.lastErrorCode, null);
  assert.equal(state?.nextEligibleRefresh, "2026-08-10T12:15:00.000Z");
  assert.deepEqual(await listStocksWatcherRefreshStates(db, "NVDA"), [state]);

  await listStocksWatcherTrackedAssets(db, {
    activeOnly: true,
    providerSymbol: "NVDA",
    minPriority: 5,
    limit: 10,
  });
  assert.match(db.lastQuery, /provider_symbol = \?/);
  assert.match(db.lastQuery, /priority >= \?/);
  assert.match(db.lastQuery, /LIMIT \?/);
  assert.deepEqual(db.lastValues, ["NVDA", 5, 10]);
});
