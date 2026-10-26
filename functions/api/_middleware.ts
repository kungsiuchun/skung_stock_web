import type { D1DatabaseLike } from "../../src/lib/spx-recap-d1";
import { PublicResearchLimitError, reservePublicR2Read } from "../../src/lib/public-research-budget";

interface Context {
  request: Request;
  env: Record<string, unknown> & { MARKET_CACHE_DB?: D1DatabaseLike };
  next: () => Promise<Response>;
  waitUntil: (task: Promise<unknown>) => void;
}
const guardedStores = new WeakMap<object, object>();
const guardedValues = new WeakSet<object>();
const postOnly = new Set(["/api/caption", "/api/agent/chat", "/api/finrobot", "/api/trading-agent/query", "/api/research/report", "/api/finance-dashboard/snapshot", "/api/portfolio-backtest", "/api/stocks-intelligence-watcher/auth/logout"]);
const readWrite = new Set(["/api/stocks-intelligence-watcher", "/api/stocks-intelligence-watcher/admin"]);

/** All public Pages R2 reads share one allowance, including legacy/admin read paths. */
export async function onRequest(context: Context) {
  const url = new URL(context.request.url);
  const methods = readWrite.has(url.pathname) ? ["GET", "POST"] : postOnly.has(url.pathname) ? ["POST"] : ["GET"];
  if (!methods.includes(context.request.method)) return Response.json({ error: "Unsupported HTTP method." }, { status: 405, headers: { Allow: methods.join(", "), "Cache-Control": "no-store" } });
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheable = context.request.method === "GET" && ["/api/market-context", "/api/market-breadth", "/api/sector-rotation"].includes(url.pathname) && !url.search;
  if (cacheable) {
    const hit = await cache.match(context.request);
    if (hit) return hit;
  }
  const bindings = context.env;
  for (const key of ["VALUATION_DATA", "OPTIONS_SNAPSHOT_DATA", "MARKET_BREADTH_DATA"]) {
    const store = bindings[key] as { get: (...args: unknown[]) => Promise<unknown> } | undefined;
    if (store && !guardedValues.has(store)) {
      const existing = guardedStores.get(store);
      if (existing) { bindings[key] = existing; continue; }
      const guarded = new Proxy(store, { get(target, property) {
      if (property === "get" || property === "head") return async (...args: unknown[]) => {
        await reservePublicR2Read(bindings.MARKET_CACHE_DB);
        return (target[property as "get"] as (...values: unknown[]) => Promise<unknown>).apply(target, args);
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
      } });
      guardedStores.set(store, guarded);
      guardedValues.add(guarded);
      bindings[key] = guarded;
    }
  }
  try {
    const response = await context.next();
    if (cacheable && response.status === 200 && response.headers.get("Cache-Control")?.startsWith("public")) context.waitUntil(cache.put(context.request, response.clone()));
    return response;
  } catch (error) {
    if (!(error instanceof PublicResearchLimitError)) throw error;
    return new Response(JSON.stringify({ ok: false, message: error.message, error: error.message }), { status: error.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
}
