import { buildStocksWatcherSnapshotFromNative } from "../../src/lib/stocks-intelligence-watcher";
import { NativeStocksYahooClient, normalizeStocksWatcherSymbol } from "../../src/lib/stocks-native-yahoo";
import {
  classifyMarketCacheDataset,
  getMarketCacheD1QuotaObservation,
  getMarketCacheDatasetTtlMs,
  resolveMarketCache,
  type MarketCacheDataset,
} from "../../src/lib/market-data-cache";
import type { D1DatabaseLike } from "../../src/lib/spx-recap-d1";
import {
  reserveStocksWatcherD1Quota,
  STOCKS_WATCHER_QUOTA_WORST_CASE_OBSERVATION,
  type StocksWatcherQuotaReservation,
} from "../../src/lib/stocks-watcher-quota";
import {
  buildStocksWatcherTrackedWatchlist,
  listStocksWatcherTrackedAssets,
} from "../../src/lib/stocks-watcher-tracking";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(init.headers || {}),
    },
  });

const normalizeSymbol = (value: string | null) => {
  return normalizeStocksWatcherSymbol(value);
};

const normalizeToolName = (value: unknown) => {
  const tool = String(value || "").trim();
  if (!/^[A-Za-z0-9_./-]{1,80}$/.test(tool)) {
    throw new Error("Invalid native tool name.");
  }
  return tool;
};

const normalizeParams = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

interface Env {
  MARKET_CACHE_DB?: D1DatabaseLike;
}

interface WatcherApiObservability {
  requestId: string;
  scope: string;
  dataset: MarketCacheDataset;
  durationMs: number;
  cacheStatus: string;
  rowsRead: number;
  rowsWritten: number;
  source: "native_yahoo" | "d1_tracking";
  errorCode?: "UPSTREAM_UNAVAILABLE" | "INVALID_REQUEST";
}

const requestIdFor = (request: Request) => {
  const supplied = request.headers.get("X-Request-ID")?.trim() || "";
  if (/^[A-Za-z0-9._:-]{1,128}$/.test(supplied)) return supplied;
  try {
    return crypto.randomUUID();
  } catch {
    return `watcher-${Date.now().toString(36)}`;
  }
};

export const classifyStocksWatcherDataset = (tool: string): MarketCacheDataset => classifyMarketCacheDataset(tool);

export const datasetForTool = classifyStocksWatcherDataset;

const toolSymbol = (params: Record<string, unknown>) =>
  normalizeStocksWatcherSymbol(String(params.ticker || params.stock_code || params.symbol || "MARKET"));

const reserveQuotaForRequest = (db?: D1DatabaseLike) =>
  db ? reserveStocksWatcherD1Quota(db) : Promise.resolve<StocksWatcherQuotaReservation | null>(null);

const finalizeQuotaForRequest = async (
  reservation: StocksWatcherQuotaReservation | null,
  rowsRead: number,
  rowsWritten: number,
) => {
  if (reservation) await reservation.finalize({ rowsRead, rowsWritten });
};

const callNativeTool = async (
  tool: string,
  params: Record<string, unknown>,
  env: Env,
  requestId: string,
) => {
  const startedAt = Date.now();
  const dataset = datasetForTool(tool);
  const scope = "stocks-watcher-tool";
  let reservation: StocksWatcherQuotaReservation | null = null;
  try {
    reservation = await reserveQuotaForRequest(env.MARKET_CACHE_DB);
    const resolved = await resolveMarketCache({
      db: env.MARKET_CACHE_DB,
      scope,
      symbol: toolSymbol(params),
      params: { tool, ...params },
      dataset,
      ttlMs: getMarketCacheDatasetTtlMs(dataset),
      quotaGuard: reservation ? () => reservation!.decision : undefined,
      requestId,
      load: async () => {
        const client = new NativeStocksYahooClient();
        const result = await client.callTool(tool, params);
        return { text: result.text, raw: result.raw };
      },
    });
    const quotaObservation = getMarketCacheD1QuotaObservation(resolved.cache);
    await finalizeQuotaForRequest(reservation, quotaObservation.rowsRead, quotaObservation.rowsWritten);
    return json({
      ok: true,
      requestId,
      tool,
      params,
      text: resolved.value.text,
      raw: resolved.value.raw,
      calledAt: new Date().toISOString(),
      cache: resolved.cache,
      observability: {
        requestId,
        scope,
        dataset,
        durationMs: Date.now() - startedAt,
        cacheStatus: resolved.cache.status,
        rowsRead: resolved.cache.rowsRead,
        rowsWritten: resolved.cache.rowsWritten,
        source: "native_yahoo",
      } satisfies WatcherApiObservability,
    }, {
      headers: {
        "X-Request-ID": requestId,
        "X-Market-Dataset": dataset,
        "X-Market-Cache-TTL-Ms": String(resolved.cache.ttlMs),
      },
    });
  } catch (error) {
    if (reservation) {
      await finalizeQuotaForRequest(
        reservation,
        STOCKS_WATCHER_QUOTA_WORST_CASE_OBSERVATION.rowsRead,
        STOCKS_WATCHER_QUOTA_WORST_CASE_OBSERVATION.rowsWritten,
      );
    }
    throw error;
  }
};

/**
 * `tracked_assets` is the only public Watcher-universe authority. Deliberately
 * do not fall back to the retired static list: an unavailable D1 binding or an
 * empty/invalid curated list must remain visible as an API failure.
 */
const callTrackedWatchlist = async (env: Env, requestId: string) => {
  const startedAt = Date.now();
  const tool = "get_watchlist";
  const dataset = datasetForTool(tool);
  const scope = "stocks-watcher-tracking";
  if (!env.MARKET_CACHE_DB) {
    return json({
      ok: false,
      requestId,
      error: "Curated Watchlist unavailable: MARKET_CACHE_DB is not bound.",
      observability: {
        requestId,
        scope,
        dataset,
        durationMs: Date.now() - startedAt,
        cacheStatus: "unavailable",
        rowsRead: 0,
        rowsWritten: 0,
        source: "d1_tracking",
        errorCode: "UPSTREAM_UNAVAILABLE",
      } satisfies WatcherApiObservability,
    }, {
      status: 503,
      headers: {
        "X-Request-ID": requestId,
        "X-Market-Dataset": dataset,
        "X-Market-Cache-TTL-Ms": String(getMarketCacheDatasetTtlMs(dataset)),
      },
    });
  }

  let reservation: StocksWatcherQuotaReservation | null = null;
  try {
    reservation = await reserveQuotaForRequest(env.MARKET_CACHE_DB);
    if (!reservation?.decision.allow) throw new Error("Curated Watchlist blocked by the D1 quota guard.");
    const assets = await listStocksWatcherTrackedAssets(env.MARKET_CACHE_DB, { activeOnly: true, limit: 500 });
    if (assets.length === 0) throw new Error("Curated Watchlist has no active tracked assets.");
    const watchlist = buildStocksWatcherTrackedWatchlist(assets);
    await finalizeQuotaForRequest(reservation, 1, 0);
    return json({
      ok: true,
      requestId,
      tool,
      params: {},
      text: JSON.stringify(watchlist, null, 2),
      raw: { source: "d1_tracking", ...watchlist },
      calledAt: new Date().toISOString(),
      cache: {
        status: "bypassed",
        dataset,
        cachedAt: null,
        expiresAt: null,
        ageSeconds: null,
        ttlMs: getMarketCacheDatasetTtlMs(dataset),
        ageRatio: null,
        guard: "bypassed",
        rowRead: false,
        rowWritten: false,
        observability: { rowRead: "bypassed", rowWritten: "bypassed" },
        rowsRead: 0,
        rowsWritten: 0,
        sourceAsOf: null,
      },
      observability: {
        requestId,
        scope,
        dataset,
        durationMs: Date.now() - startedAt,
        cacheStatus: "bypassed",
        rowsRead: 1,
        rowsWritten: 0,
        source: "d1_tracking",
      } satisfies WatcherApiObservability,
    }, {
      headers: {
        "X-Request-ID": requestId,
        "X-Market-Dataset": dataset,
        "X-Market-Cache-TTL-Ms": String(getMarketCacheDatasetTtlMs(dataset)),
      },
    });
  } catch (error) {
    if (reservation) {
      await finalizeQuotaForRequest(
        reservation,
        STOCKS_WATCHER_QUOTA_WORST_CASE_OBSERVATION.rowsRead,
        STOCKS_WATCHER_QUOTA_WORST_CASE_OBSERVATION.rowsWritten,
      );
    }
    throw error;
  }
};

export async function onRequest(context: { request: Request; env?: Env }) {
  const url = new URL(context.request.url);
  const symbol = normalizeSymbol(url.searchParams.get("symbol"));
  const env = context.env || {};
  const requestId = requestIdFor(context.request);
  const startedAt = Date.now();
  const withRequestId = (init: ResponseInit = {}, extraHeaders: Record<string, string> = {}): ResponseInit => ({
    ...init,
    headers: {
      "X-Request-ID": requestId,
      ...extraHeaders,
      ...(init.headers || {}),
    },
  });

  if (context.request.method === "POST") {
    let requestedTool = "";
    let validatedTool = false;
    try {
      const body = await context.request.json() as { tool?: unknown; params?: unknown };
      const tool = normalizeToolName(body.tool);
      requestedTool = tool;
      validatedTool = true;
      if (tool === "get_watchlist") return await callTrackedWatchlist(env, requestId);
      return await callNativeTool(tool, normalizeParams(body.params), env, requestId);
    } catch (error) {
      const errorCode = validatedTool ? "UPSTREAM_UNAVAILABLE" : "INVALID_REQUEST";
      return json(
        {
          ok: false,
          requestId,
          error: error instanceof Error ? error.message : String(error),
          observability: {
            requestId,
            scope: "stocks-watcher-tool",
            dataset: datasetForTool(requestedTool),
            durationMs: Date.now() - startedAt,
            cacheStatus: "failed",
            rowsRead: 0,
            rowsWritten: 0,
            source: "native_yahoo",
            errorCode,
          } satisfies WatcherApiObservability,
        },
        withRequestId({ status: validatedTool ? 502 : 400 }, {
          "X-Market-Dataset": datasetForTool(requestedTool),
          "X-Market-Cache-TTL-Ms": String(getMarketCacheDatasetTtlMs(datasetForTool(requestedTool))),
        }),
      );
    }
  }

  try {
    const scope = "stocks-watcher-snapshot";
    // The bundle contains quote/options/history/news/earnings data; keep one
    // conservative snapshot TTL and do not claim per-dataset freshness.
    const dataset: MarketCacheDataset = "snapshot";
    let reservation: StocksWatcherQuotaReservation | null = null;
    try {
      reservation = await reserveQuotaForRequest(env.MARKET_CACHE_DB);
      const resolved = await resolveMarketCache({
        db: env.MARKET_CACHE_DB,
        scope,
        symbol,
        params: { symbol },
        dataset,
        ttlMs: getMarketCacheDatasetTtlMs(dataset),
        quotaGuard: reservation ? () => reservation!.decision : undefined,
        requestId,
        sourceAsOf: (snapshot) => snapshot.generatedAt,
        load: () => buildStocksWatcherSnapshotFromNative(symbol, new NativeStocksYahooClient()),
      });
      const quotaObservation = getMarketCacheD1QuotaObservation(resolved.cache);
      await finalizeQuotaForRequest(reservation, quotaObservation.rowsRead, quotaObservation.rowsWritten);
      return json({
        ...resolved.value,
        requestId,
        cache: resolved.cache,
        observability: {
          requestId,
          scope,
          dataset,
          durationMs: Date.now() - startedAt,
          cacheStatus: resolved.cache.status,
          rowsRead: resolved.cache.rowsRead,
          rowsWritten: resolved.cache.rowsWritten,
          source: resolved.value.source,
        } satisfies WatcherApiObservability,
      }, withRequestId({ status: resolved.cache.status === "stale" ? 206 : 200 }, {
        "X-Market-Dataset": dataset,
        "X-Market-Cache-TTL-Ms": String(resolved.cache.ttlMs),
      }));
    } catch (error) {
      if (reservation) {
        await finalizeQuotaForRequest(
          reservation,
          STOCKS_WATCHER_QUOTA_WORST_CASE_OBSERVATION.rowsRead,
          STOCKS_WATCHER_QUOTA_WORST_CASE_OBSERVATION.rowsWritten,
        );
      }
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json(
      {
        ok: false,
        requestId,
        error: message,
        observability: {
          requestId,
          scope: "stocks-watcher-snapshot",
          dataset: "snapshot",
          durationMs: Date.now() - startedAt,
          cacheStatus: "failed",
          rowsRead: 0,
          rowsWritten: 0,
          source: "native_yahoo",
          errorCode: "UPSTREAM_UNAVAILABLE",
        } satisfies WatcherApiObservability,
      },
      withRequestId({ status: 502 }, {
        "X-Market-Dataset": "snapshot",
        "X-Market-Cache-TTL-Ms": String(getMarketCacheDatasetTtlMs("snapshot")),
      }),
    );
  }
}
