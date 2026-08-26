import { normalizeStocksWatcherSymbol } from "../../../src/lib/stocks-native-yahoo";
import { requestWatcherCoverage, type R2BucketLike } from "../../../src/lib/stocks-watcher-valuation-data";
import { parseCookie, isAllowedWatcherEmail, verifyWatcherSession } from "../../../src/lib/stocks-watcher-auth";
import { D1_DATABASE_BUDGETS, d1UtcResetAt } from "../../../src/lib/d1-free-tier-budget";
import { pruneExpiredMarketCacheEntries } from "../../../src/lib/market-data-cache";
import type { D1DatabaseLike } from "../../../src/lib/spx-recap-d1";

interface Env {
  VALUATION_DATA?: R2BucketLike;
  STOCKS_WATCHER_ADMIN_TOKEN?: string;
  STOCKS_WATCHER_SESSION_SECRET?: string;
  STOCKS_WATCHER_ALLOWED_EMAIL?: string;
  MARKET_CACHE_DB?: D1DatabaseLike;
  SPX_RECAP_DB?: D1DatabaseLike;
}

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), {
  ...init,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(init.headers || {}) },
});

const tokenMatches = async (received: string, expected: string) => {
  const encoder = new TextEncoder();
  const [receivedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(received)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const receivedBytes = new Uint8Array(receivedHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = receivedBytes.length ^ expectedBytes.length;
  const length = Math.max(receivedBytes.length, expectedBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (receivedBytes[index] || 0) ^ (expectedBytes[index] || 0);
  }
  return difference === 0;
};

const authorizeAdminRequest = async (request: Request, env: Env) => {
  const token = env.STOCKS_WATCHER_ADMIN_TOKEN;
  if (token) {
    const authorization = request.headers.get("Authorization");
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (match && (await tokenMatches(match[1] || "", token))) return { ok: true as const };
  }
  const session = await verifyWatcherSession(parseCookie(request, "stocks_watcher_session"), env.STOCKS_WATCHER_SESSION_SECRET);
  if (session && isAllowedWatcherEmail(session.email, env.STOCKS_WATCHER_ALLOWED_EMAIL)) return { ok: true as const };
  if (!token && (!env.STOCKS_WATCHER_SESSION_SECRET || !env.STOCKS_WATCHER_ALLOWED_EMAIL)) return { ok: false as const, status: 503, error: "ADMIN_AUTH_UNCONFIGURED" };
  return { ok: false as const, status: 401, error: "ADMIN_AUTH_REQUIRED" };
};

const utcDay = () => new Date().toISOString().slice(0, 10);

const numberOrZero = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

const quotaView = (database: keyof typeof D1_DATABASE_BUDGETS, dayUtc: string, usage: { rowsRead: unknown; rowsWritten: unknown; lastDenyReason?: unknown } | null, status: "ok" | "unavailable" | "invalid") => {
  const budget = D1_DATABASE_BUDGETS[database];
  const rowsRead = numberOrZero(usage?.rowsRead);
  const rowsWritten = numberOrZero(usage?.rowsWritten);
  return {
    database,
    status,
    dayUtc,
    budget,
    rowsRead,
    rowsWritten,
    readHeadroom: Math.max(0, budget.rowsRead - rowsRead),
    writeHeadroom: Math.max(0, budget.rowsWritten - rowsWritten),
    resetsAtUtc: d1UtcResetAt(dayUtc),
    lastDenyReason: typeof usage?.lastDenyReason === "string" ? usage.lastDenyReason : null,
  };
};

const readQuotaDiagnostics = async (env: Env) => {
  const dayUtc = utcDay();
  const market = await (async () => {
    if (!env.MARKET_CACHE_DB) return quotaView("MARKET_CACHE_DB", dayUtc, null, "unavailable");
    try {
      const row = await env.MARKET_CACHE_DB.prepare(`
        SELECT payload_json, last_refresh_error
        FROM market_cache_entries
        WHERE cache_key = ? AND scope = 'market-cache-quota'
        LIMIT 1
      `).bind(`__market_cache_refresh_quota__:${dayUtc}`).first<{ payload_json: string; last_refresh_error: string | null }>();
      if (!row) return quotaView("MARKET_CACHE_DB", dayUtc, null, "ok");
      const payload = JSON.parse(row.payload_json) as { dayUtc?: unknown; rowsRead?: unknown; rowsWritten?: unknown };
      if (payload.dayUtc !== dayUtc) return quotaView("MARKET_CACHE_DB", dayUtc, null, "invalid");
      return quotaView("MARKET_CACHE_DB", dayUtc, {
        rowsRead: payload.rowsRead,
        rowsWritten: payload.rowsWritten,
        lastDenyReason: row.last_refresh_error,
      }, "ok");
    } catch {
      return quotaView("MARKET_CACHE_DB", dayUtc, null, "unavailable");
    }
  })();
  const spx = await (async () => {
    if (!env.SPX_RECAP_DB) return quotaView("SPX_RECAP_DB", dayUtc, null, "unavailable");
    try {
      const row = await env.SPX_RECAP_DB.prepare(`
        SELECT rows_read, rows_written, last_deny_reason
        FROM spx_d1_budget_state
        WHERE utc_day = ?
        LIMIT 1
      `).bind(dayUtc).first<{ rows_read: number; rows_written: number; last_deny_reason: string | null }>();
      return quotaView("SPX_RECAP_DB", dayUtc, row ? {
        rowsRead: row.rows_read,
        rowsWritten: row.rows_written,
        lastDenyReason: row.last_deny_reason,
      } : null, "ok");
    } catch {
      return quotaView("SPX_RECAP_DB", dayUtc, null, "unavailable");
    }
  })();
  return {
    policy: {
      allocationRatio: 0.7,
      note: "These are site reservations, not Cloudflare account-wide D1 usage. External Worker or manual usage is not visible here.",
    },
    databases: [market, spx],
  };
};

export async function onRequestGet(context: { request: Request; env?: Env }) {
  const authorization = await authorizeAdminRequest(context.request, context.env || {});
  if (!authorization.ok) return json({ ok: false, error: authorization.error }, { status: authorization.status });
  return json({ ok: true, diagnostics: await readQuotaDiagnostics(context.env || {}) });
}

/**
 * Trusted automation may send Authorization: Bearer <STOCKS_WATCHER_ADMIN_TOKEN>.
 * The owner UI uses the signed HttpOnly session cookie instead; neither secret
 * is ever embedded in the public tool drawer.
 */
export async function onRequestPost(context: { request: Request; env?: Env }) {
  const authorization = await authorizeAdminRequest(context.request, context.env || {});
  if (!authorization.ok) return json({ ok: false, error: authorization.error }, { status: authorization.status });
  try {
    const body = await context.request.json() as { tool?: unknown; params?: unknown };
    if (body.tool === "prune_market_cache") {
      if (!context.env?.MARKET_CACHE_DB) return json({ ok: false, error: "MARKET_CACHE_DB_UNAVAILABLE" }, { status: 503 });
      const maintenance = await pruneExpiredMarketCacheEntries(context.env.MARKET_CACHE_DB);
      console.log(JSON.stringify({ event: "market_cache_maintenance", operation: "prune_expired", ...maintenance }));
      return json({ ok: true, tool: body.tool, maintenance });
    }
    if (body.tool !== "request_valuation_coverage") throw new Error("ADMIN_TOOL_INVALID: request_valuation_coverage or prune_market_cache is required.");
    const params = body.params && typeof body.params === "object" && !Array.isArray(body.params) ? body.params as Record<string, unknown> : {};
    const rawSymbol = String(params.symbol || params.ticker || params.stock_code || "").trim().toUpperCase();
    if (!rawSymbol) throw new Error("ADMIN_TOOL_INVALID: symbol is required.");
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(rawSymbol)) throw new Error("ADMIN_TOOL_INVALID: symbol is invalid.");
    const symbol = normalizeStocksWatcherSymbol(rawSymbol, "");
    if (!symbol || symbol !== rawSymbol) throw new Error("ADMIN_TOOL_INVALID: symbol is invalid.");
    const result = await requestWatcherCoverage(context.env?.VALUATION_DATA, symbol);
    return json({ ok: true, tool: body.tool, raw: result, text: result.status === "queued" ? `${result.symbol} queued for the next daily valuation batch.` : `${result.symbol} ${result.status.replace("_", " ")}.`, coverageStatus: result.status === "queued" ? "queued" : "published" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith("VALUATION_DATA_UNAVAILABLE:") || message.startsWith("VALUATION_DATA_CONFLICT:") ? 503 : 400;
    return json({ ok: false, error: message }, { status });
  }
}
