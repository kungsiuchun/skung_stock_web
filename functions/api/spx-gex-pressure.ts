import {
  listSpxGexHeatmapDates,
  listSpxGexIntradaySnapshots,
} from "../../src/lib/spx-gex-heatmap";
import { buildSpxGexPressureMatrix } from "../../src/lib/spx-gex-pressure-matrix";
import type { D1DatabaseLike } from "../../src/lib/spx-recap-d1";

interface Env {
  SPX_RECAP_DB?: D1DatabaseLike;
}

interface Context {
  request: Request;
  env: Env;
  waitUntil?: (promise: Promise<unknown>) => void;
}

const isValidDate = (date: string | null) => Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(date));

const json = (body: unknown, init: ResponseInit = {}, cacheControl = "no-store") =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cacheControl,
      ...(init.headers || {}),
    },
  });

const getEdgeCache = () => typeof caches === "undefined" ? null : caches.default;

const cacheResponse = (context: Context, response: Response) => {
  if (context.request.method !== "GET") return;
  const edgeCache = getEdgeCache();
  if (!edgeCache) return;
  context.waitUntil?.(edgeCache.put(context.request, response.clone()).catch(() => undefined));
};

export async function onRequest(context: Context) {
  const url = new URL(context.request.url);
  const bypassCache = url.searchParams.has("_");
  const edgeCache = getEdgeCache();
  if (!bypassCache && context.request.method === "GET" && edgeCache) {
    const cached = await edgeCache.match(context.request);
    if (cached) return cached;
  }

  if (!context.env.SPX_RECAP_DB) {
    return json({
      status: "BINDING_MISSING",
      errorCode: "SPX_RECAP_DB_BINDING_MISSING",
      error: "SPX_RECAP_DB binding is not configured.",
      selectedDate: null,
      pressure: null,
      warnings: ["SPX_RECAP_DB binding is not configured."],
    }, { status: 503 });
  }

  try {
    await context.env.SPX_RECAP_DB.prepare("SELECT 1 FROM spx_gex_intraday_snapshots LIMIT 1").first();
    const dates = await listSpxGexHeatmapDates(context.env.SPX_RECAP_DB);
    const requestedDate = url.searchParams.get("date");
    const selectedDate = isValidDate(requestedDate) && dates.includes(requestedDate!) ? requestedDate! : dates[0] || null;
    const snapshots = selectedDate
      ? await listSpxGexIntradaySnapshots(context.env.SPX_RECAP_DB, selectedDate, { requireCompleteSession: true })
      : [];
    if (!selectedDate || snapshots.length === 0) {
      return json({ status: "EMPTY", errorCode: null, selectedDate, pressure: null, warnings: [] });
    }

    const pressure = buildSpxGexPressureMatrix(snapshots);
    const response = json({
      status: "READY",
      errorCode: null,
      selectedDate,
      pressure,
      warnings: pressure.warnings,
    }, {}, "public, max-age=15");
    cacheResponse(context, response);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missingTable = /no such table:\s*spx_gex_intraday_snapshots/i.test(message);
    return json({
      status: missingTable ? "STORAGE_UNAVAILABLE" : "ERROR",
      errorCode: missingTable ? "SPX_GEX_INTRADAY_TABLE_MISSING" : "SPX_GEX_PRESSURE_BUILD_FAILED",
      error: missingTable ? "SPX GEX intraday storage migration is not applied." : `SPX GEX pressure build failed: ${message}`,
      selectedDate: null,
      pressure: null,
      warnings: [missingTable ? "SPX GEX intraday storage migration is not applied." : `SPX GEX pressure build failed: ${message}`],
    }, { status: missingTable ? 503 : 500 });
  }
}
