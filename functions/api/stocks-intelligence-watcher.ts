import {
  buildDemoStocksWatcherSnapshot,
  buildStocksWatcherSnapshotFromMcp,
} from "../../src/lib/stocks-intelligence-watcher";
import { StocksMcpSseClient } from "../../src/lib/stocks-mcp-sse-client";

interface Env {
  MCP_BEARER_TOKEN?: string;
  STOCKS_MCP_SERVER_BASE?: string;
}

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
  const symbol = (value || "TSLA").trim().toUpperCase().replace(/[^A-Z0-9.^-]/g, "");
  return symbol.slice(0, 12) || "TSLA";
};

export async function onRequest(context: { request: Request; env: Env }) {
  const url = new URL(context.request.url);
  const symbol = normalizeSymbol(url.searchParams.get("symbol"));

  if (!context.env.MCP_BEARER_TOKEN) {
    return json(buildDemoStocksWatcherSnapshot(symbol, "MCP_BEARER_TOKEN is not configured for Pages Functions."));
  }

  try {
    const client = new StocksMcpSseClient(
      context.env.MCP_BEARER_TOKEN,
      context.env.STOCKS_MCP_SERVER_BASE || undefined,
    );
    try {
      const snapshot = await buildStocksWatcherSnapshotFromMcp(symbol, client);
      return json(snapshot);
    } finally {
      await client.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json(
      buildDemoStocksWatcherSnapshot(symbol, `Stocks Intelligence MCP failed, using demo fallback: ${message}`),
      { status: 206 },
    );
  }
}
