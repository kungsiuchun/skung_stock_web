import { MarketCacheQuotaExceededError, MarketCacheTimeoutError, resolveMarketCache } from "../../src/lib/market-data-cache";
import { CNN_FEAR_GREED_GRAPH_URL, normalizeCnnFearGreedPayload } from "../../src/lib/fear-greed";
import { reserveMarketCacheRefreshQuota } from "../../src/lib/stocks-watcher-refresh-quota";
import type { D1DatabaseLike } from "../../src/lib/spx-recap-d1";

interface Env {
  MARKET_CACHE_DB?: D1DatabaseLike;
}

const FEAR_GREED_TTL_MS = 15 * 60_000;
const FEAR_GREED_DEADLINE_MS = 10_000;

const json = (body: unknown, status = 200, requestId?: string) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(requestId ? { "X-Request-ID": requestId } : {}),
  },
});

const errorStatus = (error: unknown) => {
  if (error instanceof MarketCacheQuotaExceededError) return 429;
  if (error instanceof MarketCacheTimeoutError) return 504;
  return 502;
};

export async function onRequestGet(context: { request: Request; env: Env; deadlineMs?: number }) {
  const requestId = crypto.randomUUID();
  const deadlineMs = context.deadlineMs ?? FEAR_GREED_DEADLINE_MS;
  try {
    const resolved = await resolveMarketCache({
      db: context.env.MARKET_CACHE_DB,
      scope: "cnn-fear-greed-v1",
      symbol: "US",
      params: { source: "cnn", history: "1y" },
      dataset: "news",
      ttlMs: FEAR_GREED_TTL_MS,
      deadlineMs,
      requestId,
      signal: context.request.signal,
      sourceAsOf: (value) => value.asOf,
      refreshQuotaGuard: context.env.MARKET_CACHE_DB
        ? () => reserveMarketCacheRefreshQuota(context.env.MARKET_CACHE_DB!, { operation: "cnn_fear_greed" })
        : undefined,
      load: async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.min(8_000, Math.max(1, deadlineMs - 2_000)));
        try {
          const response = await fetch(CNN_FEAR_GREED_GRAPH_URL, {
            // CNN returns 418 to anonymous Worker fetches. This identifies the
            // server honestly; it does not impersonate a browser or client.
            headers: {
              Accept: "application/json",
              "User-Agent": "SiusAIWorkshop/1.0 (+https://sius-ai-workshop.pages.dev)",
            },
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`CNN Fear & Greed request returned HTTP ${response.status}.`);
          let payload: unknown;
          try {
            payload = await response.json();
          } catch {
            throw new Error("CNN Fear & Greed response was not valid JSON.");
          }
          return normalizeCnnFearGreedPayload(payload);
        } finally {
          clearTimeout(timeout);
        }
      },
    });
    console.log(JSON.stringify({
      event: "cnn_fear_greed",
      requestId,
      cacheStatus: resolved.cache.status,
      sourceAsOf: resolved.value.asOf,
      score: resolved.value.score,
      rating: resolved.value.rating,
    }));
    return json({ data: resolved.value, cache: resolved.cache, requestId }, resolved.cache.status === "stale" ? 206 : 200, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({
      event: "cnn_fear_greed",
      requestId,
      status: "failed",
      errorClass: error instanceof Error ? error.name : "unknown",
      ...(error instanceof MarketCacheTimeoutError ? { timeoutPhase: error.phase, timeoutMs: error.timeoutMs } : {}),
    }));
    return json({
      error: message,
      errorCode: error instanceof MarketCacheQuotaExceededError ? "D1_SAFETY_CUTOFF" : "CNN_FEAR_GREED_UNAVAILABLE",
      requestId,
    }, errorStatus(error), requestId);
  }
}
