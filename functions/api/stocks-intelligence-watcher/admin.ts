import { normalizeStocksWatcherSymbol } from "../../../src/lib/stocks-native-yahoo";
import { requestWatcherCoverage, type R2BucketLike } from "../../../src/lib/stocks-watcher-valuation-data";

interface Env {
  VALUATION_DATA?: R2BucketLike;
  STOCKS_WATCHER_ADMIN_TOKEN?: string;
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

const authorizeAdminRequest = async (request: Request, token: string | undefined) => {
  if (!token) return { ok: false as const, status: 503, error: "ADMIN_AUTH_UNCONFIGURED" };
  const authorization = request.headers.get("Authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false as const, status: 401, error: "ADMIN_AUTH_REQUIRED" };
  const suppliedToken = match[1] || "";
  if (!suppliedToken || !(await tokenMatches(suppliedToken, token))) return { ok: false as const, status: 401, error: "ADMIN_AUTH_REQUIRED" };
  return { ok: true as const };
};

/**
 * Admin clients must send Authorization: Bearer <STOCKS_WATCHER_ADMIN_TOKEN>.
 * The token is a Pages secret and must never be embedded in the public UI.
 */
export async function onRequestPost(context: { request: Request; env?: Env }) {
  const authorization = await authorizeAdminRequest(context.request, context.env?.STOCKS_WATCHER_ADMIN_TOKEN);
  if (!authorization.ok) return json({ ok: false, error: authorization.error }, { status: authorization.status });
  try {
    const body = await context.request.json() as { tool?: unknown; params?: unknown };
    if (body.tool !== "request_valuation_coverage") throw new Error("ADMIN_TOOL_INVALID: request_valuation_coverage is required.");
    const params = body.params && typeof body.params === "object" && !Array.isArray(body.params) ? body.params as Record<string, unknown> : {};
    const symbol = normalizeStocksWatcherSymbol(String(params.symbol || params.ticker || params.stock_code || ""), "");
    if (!symbol) throw new Error("ADMIN_TOOL_INVALID: symbol is required.");
    const result = await requestWatcherCoverage(context.env?.VALUATION_DATA, symbol);
    return json({ ok: true, tool: body.tool, raw: result, text: result.status === "queued" ? `${result.symbol} queued for the next daily valuation batch.` : `${result.symbol} ${result.status.replace("_", " ")}.`, coverageStatus: result.status === "queued" ? "queued" : "published" });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
