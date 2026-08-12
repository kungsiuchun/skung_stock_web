import { buildStocksWatcherSnapshotFromNative, type StocksWatcherSnapshot } from "../../src/lib/stocks-intelligence-watcher";
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
import {
  loadWatcherFinancialStatements,
  getWatcherCoverageStatus,
  loadWatcherValuationBands,
  loadWatcherValuationRelease,
  STOCKS_WATCHER_VALUATION_TOOLS,
  type R2BucketLike,
} from "../../src/lib/stocks-watcher-valuation-data";
import {
  loadRobinhoodOptionsSnapshot,
  robinhoodGex,
  toRobinhoodOptionsView,
  type RobinhoodOptionsPublishedSnapshot,
  type RobinhoodOptionsR2BucketLike,
} from "../../src/lib/stocks-watcher-robinhood-options";

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
  VALUATION_DATA?: R2BucketLike;
  OPTIONS_SNAPSHOT_DATA?: RobinhoodOptionsR2BucketLike;
}

interface WatcherApiObservability {
  requestId: string;
  scope: string;
  dataset: MarketCacheDataset;
  durationMs: number;
  cacheStatus: string;
  rowsRead: number;
  rowsWritten: number;
  source: "native_yahoo" | "d1_tracking" | "robinhood_mcp";
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

const ROBINHOOD_OPTIONS_TOOLS = new Set([
  "get_options", "get_options_gex", "get_options_greeks", "get_options_pcr", "get_options_dex", "get_options_0dte", "get_options_iv_intraday", "get_options_sweeps", "get_options_mispricing", "get_options_flow_universe",
]);

type CuratedRobinhoodOptions =
  | { curated: false }
  | { curated: true; snapshot: RobinhoodOptionsPublishedSnapshot }
  | { curated: true; unavailableReason: string };

interface OptionsSnapshotCurrentRow {
  run_id: string;
  release_id: string;
  manifest_key: string;
  manifest_sha256: string;
  captured_at: string;
  expected_symbols: number;
  completed_symbols: number;
}

const assertPublishedOptionsD1Current = async (db: D1DatabaseLike, snapshot: RobinhoodOptionsPublishedSnapshot) => {
  const row = await db.prepare(`
    SELECT run_id, release_id, manifest_key, manifest_sha256, captured_at, expected_symbols, completed_symbols
    FROM watcher_options_snapshot_current WHERE singleton = 1
  `).first<OptionsSnapshotCurrentRow>();
  if (!row) throw new Error("ROBINHOOD_OPTIONS_UNAVAILABLE: D1 current manifest/status is unavailable.");
  if (row.run_id !== snapshot.runId || row.release_id !== snapshot.releaseId || row.manifest_key !== snapshot.manifest.key || row.manifest_sha256 !== snapshot.manifest.sha256 || row.captured_at !== snapshot.capturedAt || row.expected_symbols !== snapshot.manifest.expectedSymbols || row.completed_symbols !== snapshot.manifest.completedSymbols) {
    throw new Error("ROBINHOOD_OPTIONS_INVALID: D1 current manifest/status does not match the R2 release.");
  }
};

const resolveCuratedRobinhoodOptions = async (env: Env, symbol: string): Promise<CuratedRobinhoodOptions> => {
  if (!env.MARKET_CACHE_DB) return { curated: true, unavailableReason: "curated universe unavailable: MARKET_CACHE_DB is not bound" };
  const assets = await listStocksWatcherTrackedAssets(env.MARKET_CACHE_DB, { activeOnly: true, limit: 500 });
  if (!assets.some((asset) => asset.symbol === symbol)) return { curated: false };
  try {
    const snapshot = await loadRobinhoodOptionsSnapshot(env.OPTIONS_SNAPSHOT_DATA, symbol);
    await assertPublishedOptionsD1Current(env.MARKET_CACHE_DB, snapshot);
    return { curated: true, snapshot };
  } catch (error) {
    return { curated: true, unavailableReason: error instanceof Error ? error.message : String(error) };
  }
};

const publishedOptionsToolResponse = (
  tool: string,
  params: Record<string, unknown>,
  requestId: string,
  snapshot: RobinhoodOptionsPublishedSnapshot,
) => {
  const view = toRobinhoodOptionsView(snapshot);
  const selected = snapshot.contracts.filter((row) => row.expiry === (String(params.expiry || view.selectedExpiry || "")));
  const raw = tool === "get_options"
    ? {
      source: "robinhood_mcp", spot: snapshot.spot, selectedExpiry: view.selectedExpiry, expiries: view.availableExpiries,
      calls: selected.filter((row) => row.callPut === "call"), puts: selected.filter((row) => row.callPut === "put"),
      provenance: { provider: "robinhood_mcp", runId: snapshot.runId, capturedAt: snapshot.capturedAt, methodology: "OI-signed GEX proxy" },
    }
    : tool === "get_options_greeks"
      ? { source: "robinhood_mcp", rows: selected, provenance: { provider: "robinhood_mcp", runId: snapshot.runId, capturedAt: snapshot.capturedAt } }
      : tool === "get_options_pcr"
        ? { source: "robinhood_mcp", putCallOpenInterest: view.strikes.reduce((sum, row) => sum + row.putOpenInterest, 0) / Math.max(1, view.strikes.reduce((sum, row) => sum + row.callOpenInterest, 0)), provenance: { provider: "robinhood_mcp", runId: snapshot.runId, capturedAt: snapshot.capturedAt } }
        : { source: "robinhood_mcp", rows: view.strikes, contracts: selected.map((row) => ({ ...row, signedGex: row.callPut === "call" ? robinhoodGex(row) : -robinhoodGex(row) })), provenance: { provider: "robinhood_mcp", runId: snapshot.runId, capturedAt: snapshot.capturedAt, methodology: "OI-signed GEX proxy" } };
  return json({ ok: true, requestId, tool, params, text: `${snapshot.symbol} Robinhood MCP EOD options snapshot as of ${snapshot.capturedAt}. GEX is an OI-signed proxy, not dealer GEX.`, raw, calledAt: new Date().toISOString(), cache: { status: "published", sourceAsOf: snapshot.capturedAt }, observability: { requestId, scope: "stocks-watcher-options-snapshot", dataset: datasetForTool(tool), durationMs: 0, cacheStatus: "published", rowsRead: 0, rowsWritten: 0, source: "robinhood_mcp" } satisfies WatcherApiObservability });
};

export const attachPublishedWatcherData = async (snapshot: StocksWatcherSnapshot, bucket: R2BucketLike | undefined): Promise<StocksWatcherSnapshot> => {
  let release;
  try {
    release = await loadWatcherValuationRelease(bucket);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...snapshot,
      valuationCoverage: "unavailable",
      warnings: [...snapshot.warnings, `valuation data unavailable: ${message}`],
      availableTools: [...snapshot.availableTools, ...STOCKS_WATCHER_VALUATION_TOOLS],
    };
  }
  const [valuationResult, financialsResult] = await Promise.allSettled([
    loadWatcherValuationBands(bucket, { symbol: snapshot.symbol, metric: "pe", window: "3Y", release }),
    loadWatcherFinancialStatements(bucket, { symbol: snapshot.symbol, periods: 1, release }),
  ]);
  const warnings = [...snapshot.warnings];
  if (valuationResult.status === "rejected") warnings.push(`valuation data unavailable: ${valuationResult.reason instanceof Error ? valuationResult.reason.message : String(valuationResult.reason)}`);
  if (financialsResult.status === "rejected") warnings.push(`financial data unavailable: ${financialsResult.reason instanceof Error ? financialsResult.reason.message : String(financialsResult.reason)}`);
  let valuationCoverage: "published" | "queued" | "unavailable" = valuationResult.status === "fulfilled" ? "published" : "unavailable";
  if (valuationResult.status === "rejected") {
    try {
      valuationCoverage = await getWatcherCoverageStatus(bucket, snapshot.symbol);
      if (valuationCoverage === "queued") warnings.push("valuation coverage queued: this ticker will be calculated in the next daily batch.");
    } catch (error) {
      warnings.push(`valuation coverage status unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    ...snapshot,
    valuation: valuationResult.status === "fulfilled" ? valuationResult.value : null,
    financials: financialsResult.status === "fulfilled" ? financialsResult.value.quarters[0] || null : null,
    valuationCoverage,
    warnings,
    availableTools: [...snapshot.availableTools, ...STOCKS_WATCHER_VALUATION_TOOLS],
  };
};

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
    if (tool === "get_valuation_bands") {
      const symbol = toolSymbol(params);
      try {
        const raw = await loadWatcherValuationBands(env.VALUATION_DATA, { symbol, metric: params.metric, window: params.window });
        return json({ ok: true, requestId, tool, params, text: `${raw.symbol} ${raw.metric.toUpperCase()} ${raw.window} valuation bands as of ${raw.dataAsOf}.`, raw, calledAt: new Date().toISOString(), cache: { status: "published", sourceAsOf: raw.generatedAt }, coverageStatus: "published" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const coverageStatus = message.startsWith("VALUATION_DATA_NOT_PUBLISHED:") ? await getWatcherCoverageStatus(env.VALUATION_DATA, symbol) : "unavailable";
        return json({ ok: false, requestId, tool, params, error: message, coverageStatus }, { status: message.startsWith("VALUATION_DATA_NOT_PUBLISHED:") ? 404 : 400 });
      }
    }
    if (tool === "get_financial_statements") {
      const symbol = toolSymbol(params);
      try {
        const raw = await loadWatcherFinancialStatements(env.VALUATION_DATA, { symbol, periods: params.periods });
        return json({ ok: true, requestId, tool, params, text: `${raw.symbol} financial statements through ${raw.dataAsOf}.`, raw, calledAt: new Date().toISOString(), cache: { status: "published", sourceAsOf: raw.generatedAt }, coverageStatus: "published" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const coverageStatus = message.startsWith("VALUATION_DATA_NOT_PUBLISHED:") ? await getWatcherCoverageStatus(env.VALUATION_DATA, symbol) : "unavailable";
        return json({ ok: false, requestId, tool, params, error: message, coverageStatus }, { status: message.startsWith("VALUATION_DATA_NOT_PUBLISHED:") ? 404 : 400 });
      }
    }
    if (ROBINHOOD_OPTIONS_TOOLS.has(tool)) {
      const symbol = toolSymbol(params);
      const published = await resolveCuratedRobinhoodOptions(env, symbol);
      if (published.curated && "snapshot" in published) return publishedOptionsToolResponse(tool, params, requestId, published.snapshot);
      if (published.curated) {
        return json({ ok: false, requestId, tool, params, error: `ROBINHOOD_OPTIONS_UNAVAILABLE: ${published.unavailableReason}`, source: "robinhood_mcp" }, { status: 503 });
      }
    }
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
        load: async () => {
          const published = await resolveCuratedRobinhoodOptions(env, symbol);
          return attachPublishedWatcherData(
            await buildStocksWatcherSnapshotFromNative(symbol, new NativeStocksYahooClient(), published.curated
              ? ("snapshot" in published ? { snapshot: published.snapshot } : { unavailableReason: published.unavailableReason })
              : undefined),
            env.VALUATION_DATA,
          );
        },
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
