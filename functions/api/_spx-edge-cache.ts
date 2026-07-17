export interface SpxCacheContext {
  request: Request;
  waitUntil?: (promise: Promise<unknown>) => void;
}

const VOLATILE_QUERY_KEYS = new Set(["_", "refresh", "cacheBust"]);

export const canonicalSpxCacheRequest = (request: Request) => {
  const url = new URL(request.url);
  for (const key of VOLATILE_QUERY_KEYS) url.searchParams.delete(key);
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

export const writeSpxEdgeCache = (context: SpxCacheContext, response: Response) => {
  const cache = getSpxEdgeCache();
  if (!cache || context.request.method !== "GET") return;
  context.waitUntil?.(cache.put(canonicalSpxCacheRequest(context.request), response.clone()).catch(() => undefined));
};

export const withSpxObservability = (response: Response, originMs: number) => {
  const headers = new Headers(response.headers);
  headers.set("X-SPX-Cache", "MISS");
  headers.set("X-SPX-Origin-Ms", String(Math.max(0, Math.round(originMs))));
  if (!headers.has("X-SPX-Payload-Bytes")) headers.set("X-SPX-Payload-Bytes", headers.get("Content-Length") || "unknown");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
