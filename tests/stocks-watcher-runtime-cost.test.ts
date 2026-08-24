import assert from "node:assert/strict";
import test from "node:test";

import { onRequest as stocksWatcherApi } from "../functions/api/stocks-intelligence-watcher";
import type { D1DatabaseLike } from "../src/lib/spx-recap-d1";

class TrackingOnlyD1 implements D1DatabaseLike {
  readonly queries: string[] = [];

  prepare(query: string) {
    this.queries.push(query);
    const statement = {
      bind: () => statement,
      first: async <T>() => {
        throw new Error(`Unexpected D1 first query: ${query}`);
      },
      all: async <T>() => {
        if (!query.includes("FROM tracked_assets"))
          throw new Error(`Unexpected D1 scan: ${query}`);
        return {
          results: [
            {
              symbol: "NVDA",
              provider_symbol: "NVDA",
              priority: 100,
              display_name: "NVIDIA",
              asset_type: "equity",
              is_active: 1,
              metadata_json: '{"gicsSector":"Information Technology"}',
              created_at: "2026-08-24T00:00:00.000Z",
              updated_at: "2026-08-24T00:00:00.000Z",
            },
          ] as T[],
        };
      },
      run: async () => {
        throw new Error(`Unexpected D1 write: ${query}`);
      },
    };
    return statement;
  }
}

test("watchlist performs one authoritative tracking read and no quota-ledger operation", async () => {
  const db = new TrackingOnlyD1();
  const response = await stocksWatcherApi({
    request: new Request(
      "https://example.com/api/stocks-intelligence-watcher",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "get_watchlist", params: {} }),
      },
    ),
    env: { MARKET_CACHE_DB: db },
  });

  const payload = (await response.json()) as {
    ok: boolean;
    observability: { rowsRead: number; rowsWritten: number };
  };
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.observability.rowsRead, 1);
  assert.equal(payload.observability.rowsWritten, 0);
  assert.equal(db.queries.length, 1);
});
