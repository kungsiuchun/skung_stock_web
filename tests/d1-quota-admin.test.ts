import assert from "node:assert/strict";
import test from "node:test";

import { onRequestGet, onRequestPost } from "../functions/api/stocks-intelligence-watcher/admin";
import type { D1DatabaseLike } from "../src/lib/spx-recap-d1";

class DiagnosticD1 implements D1DatabaseLike {
  constructor(private readonly kind: "market" | "spx") {}

  prepare(query: string) {
    let values: unknown[] = [];
    const statement = {
      bind: (...next: unknown[]) => {
        values = next;
        return statement;
      },
      first: async <T>() => {
        if (this.kind === "market" && query.includes("SELECT payload_json")) {
          return {
            payload_json: JSON.stringify({ dayUtc: String(values[0]).split(":").at(-1), rowsRead: 321, rowsWritten: 45 }),
            last_refresh_error: null,
          } as T;
        }
        if (this.kind === "spx" && query.includes("FROM spx_d1_budget_state")) {
          return { rows_read: 654, rows_written: 78, last_deny_reason: "write_threshold_exceeded" } as T;
        }
        return null;
      },
      all: async <T>() => ({ results: [] as T[] }),
      run: async () => ({ meta: { changes: 3, rows_read: 7, rows_written: 3 } }),
    };
    return statement;
  }
}

const ownerHeaders = { Authorization: "Bearer owner-token" };

test("owner diagnostics expose only site allocations, UTC headroom, and persisted denial markers", async () => {
  const response = await onRequestGet({
    request: new Request("https://example.com/api/stocks-intelligence-watcher/admin", { headers: ownerHeaders }),
    env: {
      STOCKS_WATCHER_ADMIN_TOKEN: "owner-token",
      MARKET_CACHE_DB: new DiagnosticD1("market"),
      SPX_RECAP_DB: new DiagnosticD1("spx"),
    },
  });
  const payload = await response.json() as {
    ok: boolean;
    diagnostics: { databases: Array<{ database: string; rowsRead: number; rowsWritten: number; lastDenyReason: string | null; resetsAtUtc: string }> };
  };
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.diagnostics.databases.map((entry) => entry.database), ["MARKET_CACHE_DB", "SPX_RECAP_DB"]);
  assert.equal(payload.diagnostics.databases[0]?.rowsRead, 321);
  assert.equal(payload.diagnostics.databases[1]?.rowsWritten, 78);
  assert.equal(payload.diagnostics.databases[1]?.lastDenyReason, "write_threshold_exceeded");
  assert.match(payload.diagnostics.databases[0]?.resetsAtUtc || "", /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
});

test("owner maintenance is explicit, bounded, and unavailable to unauthenticated callers", async () => {
  const unauthorized = await onRequestPost({
    request: new Request("https://example.com/api/stocks-intelligence-watcher/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "prune_market_cache" }),
    }),
    env: { STOCKS_WATCHER_ADMIN_TOKEN: "owner-token", MARKET_CACHE_DB: new DiagnosticD1("market") },
  });
  assert.equal(unauthorized.status, 401);

  const authorized = await onRequestPost({
    request: new Request("https://example.com/api/stocks-intelligence-watcher/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ownerHeaders },
      body: JSON.stringify({ tool: "prune_market_cache" }),
    }),
    env: { STOCKS_WATCHER_ADMIN_TOKEN: "owner-token", MARKET_CACHE_DB: new DiagnosticD1("market") },
  });
  const payload = await authorized.json() as { ok: boolean; maintenance: { rowsRead: number; rowsWritten: number } };
  assert.equal(authorized.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.maintenance.rowsRead, 7);
  assert.equal(payload.maintenance.rowsWritten, 3);
});
