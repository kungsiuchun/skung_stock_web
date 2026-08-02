import { buildStocksWatcherSnapshotFromNative } from "../../src/lib/stocks-intelligence-watcher";
import type { StocksWatcherSnapshot } from "../../src/lib/stocks-intelligence-watcher";
import { NativeStocksYahooClient, normalizeStocksWatcherSymbol } from "../../src/lib/stocks-native-yahoo";
import { resolveMarketCache } from "../../src/lib/market-data-cache";
import type { D1DatabaseLike } from "../../src/lib/spx-recap-d1";
import {
  loadWatcherFinancialStatements,
  getWatcherCoverageStatus,
  loadWatcherValuationBands,
  loadWatcherValuationRelease,
  STOCKS_WATCHER_VALUATION_TOOLS,
  type R2BucketLike,
} from "../../src/lib/stocks-watcher-valuation-data";

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
}

const toolSymbol = (params: Record<string, unknown>) =>
  normalizeStocksWatcherSymbol(String(params.ticker || params.stock_code || params.symbol || "MARKET"));

export const attachPublishedWatcherData = async (snapshot: StocksWatcherSnapshot, bucket: R2BucketLike | undefined): Promise<StocksWatcherSnapshot> => {
  let release;
  try { release = await loadWatcherValuationRelease(bucket); } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...snapshot, valuationCoverage: "unavailable", warnings: [...snapshot.warnings, `valuation data unavailable: ${message}`], availableTools: [...snapshot.availableTools, ...STOCKS_WATCHER_VALUATION_TOOLS] };
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

const callNativeTool = async (tool: string, params: Record<string, unknown>, env: Env) => {
  if (tool === "get_valuation_bands") {
    const symbol = toolSymbol(params);
    try {
      const raw = await loadWatcherValuationBands(env.VALUATION_DATA, { symbol, metric: params.metric, window: params.window });
      return json({ ok: true, tool, params, text: `${raw.symbol} ${raw.metric.toUpperCase()} ${raw.window} valuation bands as of ${raw.dataAsOf}.`, raw, calledAt: new Date().toISOString(), cache: { status: "published", sourceAsOf: raw.generatedAt }, coverageStatus: "published" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const coverageStatus = message.startsWith("VALUATION_DATA_NOT_PUBLISHED:") ? await getWatcherCoverageStatus(env.VALUATION_DATA, symbol) : "unavailable";
      return json({ ok: false, tool, params, error: message, coverageStatus }, { status: message.startsWith("VALUATION_DATA_NOT_PUBLISHED:") ? 404 : 400 });
    }
  }
  if (tool === "get_financial_statements") {
    const symbol = toolSymbol(params);
    try {
      const raw = await loadWatcherFinancialStatements(env.VALUATION_DATA, { symbol, periods: params.periods });
      return json({ ok: true, tool, params, text: `${raw.symbol} financial statements through ${raw.dataAsOf}.`, raw, calledAt: new Date().toISOString(), cache: { status: "published", sourceAsOf: raw.generatedAt }, coverageStatus: "published" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const coverageStatus = message.startsWith("VALUATION_DATA_NOT_PUBLISHED:") ? await getWatcherCoverageStatus(env.VALUATION_DATA, symbol) : "unavailable";
      return json({ ok: false, tool, params, error: message, coverageStatus }, { status: message.startsWith("VALUATION_DATA_NOT_PUBLISHED:") ? 404 : 400 });
    }
  }
  const resolved = await resolveMarketCache({
    db: env.MARKET_CACHE_DB,
    scope: "stocks-watcher-tool",
    symbol: toolSymbol(params),
    params: { tool, ...params },
    load: async () => {
      const client = new NativeStocksYahooClient();
      const result = await client.callTool(tool, params);
      return { text: result.text, raw: result.raw };
    },
  });
  return json({
    ok: true,
    tool,
    params,
    text: resolved.value.text,
    raw: resolved.value.raw,
    calledAt: new Date().toISOString(),
    cache: resolved.cache,
  });
};

export async function onRequest(context: { request: Request; env?: Env }) {
  const url = new URL(context.request.url);
  const symbol = normalizeSymbol(url.searchParams.get("symbol"));
  const env = context.env || {};

  if (context.request.method === "POST") {
    try {
      const body = await context.request.json() as { tool?: unknown; params?: unknown };
      return await callNativeTool(normalizeToolName(body.tool), normalizeParams(body.params), env);
    } catch (error) {
      return json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 400 },
      );
    }
  }

  try {
    const resolved = await resolveMarketCache({
      db: env.MARKET_CACHE_DB,
      scope: "stocks-watcher-snapshot",
      symbol,
      params: { symbol },
      sourceAsOf: (snapshot) => snapshot.generatedAt,
      load: async () => {
        const snapshot = await buildStocksWatcherSnapshotFromNative(symbol, new NativeStocksYahooClient());
        return attachPublishedWatcherData(snapshot, env.VALUATION_DATA);
      },
    });
    return json({ ...resolved.value, cache: resolved.cache }, { status: resolved.cache.status === "stale" ? 206 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json(
      { ok: false, error: message },
      { status: 502 },
    );
  }
}
