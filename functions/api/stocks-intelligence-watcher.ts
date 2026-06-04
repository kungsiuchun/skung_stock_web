import {
  buildDemoStocksWatcherSnapshot,
  buildStocksWatcherSnapshotFromNative,
} from "../../src/lib/stocks-intelligence-watcher";
import { NativeStocksYahooClient, normalizeStocksWatcherSymbol } from "../../src/lib/stocks-native-yahoo";

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

const callNativeTool = async (tool: string, params: Record<string, unknown>) => {
  const client = new NativeStocksYahooClient();
  const result = await client.callTool(tool, params);
  return json({
    ok: true,
    tool,
    params,
    text: result.text,
    raw: result.raw,
    calledAt: new Date().toISOString(),
  });
};

export async function onRequest(context: { request: Request }) {
  const url = new URL(context.request.url);
  const symbol = normalizeSymbol(url.searchParams.get("symbol"));

  if (context.request.method === "POST") {
    try {
      const body = await context.request.json() as { tool?: unknown; params?: unknown };
      return await callNativeTool(normalizeToolName(body.tool), normalizeParams(body.params));
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
    const snapshot = await buildStocksWatcherSnapshotFromNative(symbol, new NativeStocksYahooClient());
    return json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json(
      buildDemoStocksWatcherSnapshot(symbol, `Native Yahoo data failed, using demo fallback: ${message}`),
      { status: 206 },
    );
  }
}
