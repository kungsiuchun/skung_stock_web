import { buildStocksWatcherSnapshotFromNative } from "../../src/lib/stocks-intelligence-watcher";
import { NativeStocksYahooClient, normalizeStocksWatcherSymbol } from "../../src/lib/stocks-native-yahoo";
import { resolveMarketCache } from "../../src/lib/market-data-cache";
import type { D1DatabaseLike } from "../../src/lib/spx-recap-d1";

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

const toolSymbol = (params: Record<string, unknown>) =>
  normalizeStocksWatcherSymbol(String(params.ticker || params.stock_code || params.symbol || "MARKET"));

const callNativeTool = async (tool: string, params: Record<string, unknown>, env: Env) => {
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
      load: () => buildStocksWatcherSnapshotFromNative(symbol, new NativeStocksYahooClient()),
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
