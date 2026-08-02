import { normalizeStocksWatcherSymbol } from "../../../src/lib/stocks-native-yahoo";
import { requestWatcherCoverage, type R2BucketLike } from "../../../src/lib/stocks-watcher-valuation-data";
import { parseCookie, isAllowedWatcherEmail, verifyWatcherSession } from "../../../src/lib/stocks-watcher-auth";

interface Env {
  VALUATION_DATA?: R2BucketLike;
  STOCKS_WATCHER_ADMIN_TOKEN?: string;
  STOCKS_WATCHER_SESSION_SECRET?: string;
  STOCKS_WATCHER_ALLOWED_EMAIL?: string;
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
    if (body.tool !== "request_valuation_coverage") throw new Error("ADMIN_TOOL_INVALID: request_valuation_coverage is required.");
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
