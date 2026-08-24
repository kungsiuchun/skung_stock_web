export interface SpxCacheContext {
  request: Request;
  waitUntil?: (promise: Promise<unknown>) => void;
}

import { normalizeSpxPriceActionTimeframe } from "../../src/lib/spx-price-action-compass";

/**
 * These are the complete public selection inputs for the SPX read APIs.
 *
 * Do not cache arbitrary query strings. They create unique Cache API keys
 * while the endpoint ignores them, which turns harmless tracking parameters
 * and client cache-busters into repeated D1 origin reads.
 */
const inFlightSpxEdgeRequests = new Map<string, Promise<Response>>();

export const canonicalSpxCacheRequest = (request: Request) => {
  const url = new URL(request.url);
  const canonical = new URLSearchParams();
  const keys = url.pathname.endsWith("/spx-gex-cell-detail")
    ? ["date", "snapshot", "strike", "expiry"]
    : url.pathname.endsWith("/spx-gex-heatmap")
      ? ["date", "snapshot"]
      : url.pathname.endsWith("/spx-gex-pressure")
        ? (/^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") || "") ? ["date"] : [])
        : url.pathname.endsWith("/spx-recap")
          ? ["date"]
        : [];
  for (const key of keys) {
    const value = url.searchParams.get(key);
    if (value !== null) canonical.set(key, value);
  }
  if (url.pathname.endsWith("/spx-price-action-compass")) {
    if (url.searchParams.get("view") === "price-overlay") canonical.set("view", "price-overlay");
    else canonical.set("timeframe", normalizeSpxPriceActionTimeframe(url.searchParams.get("timeframe")));
  }
  url.search = canonical.toString();
  return new Request(url.toString(), { method: "GET" });
};

export const getSpxEdgeCache = () => typeof caches === "undefined" ? null : caches.default;

export const readSpxEdgeCache = async (request: Request) => {
  const cache = getSpxEdgeCache();
  if (!cache || request.method !== "GET") return null;
  const cached = await cache.match(canonicalSpxCacheRequest(request));
  if (!cached) return null;
  const headers = new Headers(cached.headers);
  headers.set("X-SPX-Cache", "HIT");
  return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
};

export const writeSpxEdgeCache = async (context: SpxCacheContext, response: Response) => {
  const cache = getSpxEdgeCache();
  if (!cache || context.request.method !== "GET") return;
  try {
    await cache.put(canonicalSpxCacheRequest(context.request), response.clone());
  } catch {
    // Cache is an optimization only; a verified origin response remains valid.
  }
};

/** Shares one cold-cache producer per isolate and returns an independent response body to every waiter. */
export const coalesceSpxEdgeRequest = async (request: Request, producer: () => Promise<Response>) => {
  const key = canonicalSpxCacheRequest(request).url;
  const existing = inFlightSpxEdgeRequests.get(key);
  if (existing) return (await existing).clone();

  const work = producer();
  inFlightSpxEdgeRequests.set(key, work);
  try {
    return (await work).clone();
  } finally {
    inFlightSpxEdgeRequests.delete(key);
  }
};

export const resetSpxEdgeCoalescingForTests = () => inFlightSpxEdgeRequests.clear();

export const withSpxObservability = (response: Response, originMs: number) => {
  const headers = new Headers(response.headers);
  headers.set("X-SPX-Cache", "MISS");
  headers.set("X-SPX-Origin-Ms", String(Math.max(0, Math.round(originMs))));
  if (!headers.has("X-SPX-Payload-Bytes")) headers.set("X-SPX-Payload-Bytes", headers.get("Content-Length") || "unknown");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
