import { readSpxGexHeatmap } from "../../src/lib/spx-gex-heatmap";
import type { D1DatabaseLike } from "../../src/lib/spx-recap-d1";
import { readSpxEdgeCache, withSpxObservability, writeSpxEdgeCache } from "./_spx-edge-cache";

interface Context {
  request: Request;
  env: { SPX_RECAP_DB?: D1DatabaseLike };
  waitUntil?: (promise: Promise<unknown>) => void;
}

const json = (body: unknown, init: ResponseInit = {}, cacheControl = "no-store") => {
  const text = JSON.stringify(body);
  return new Response(text, {
    ...init,
    headers: { "Content-Type": "application/json", "Cache-Control": cacheControl, "X-SPX-Payload-Bytes": String(new TextEncoder().encode(text).byteLength), ...(init.headers || {}) },
  });
};

const validDate = (value: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

export async function onRequest(context: Context) {
  const startedAt = Date.now();
  const url = new URL(context.request.url);
  const date = url.searchParams.get("date");
  const snapshotMinuteEt = Number(url.searchParams.get("snapshot"));
  const strike = Number(url.searchParams.get("strike"));
  const expdate = url.searchParams.get("expiry");
  if (!validDate(date) || !Number.isInteger(snapshotMinuteEt) || !Number.isFinite(strike) || !expdate) {
    return json({ status: "ERROR", errorCode: "INVALID_CELL_SELECTION", error: "date, snapshot, strike, and expiry are required.", detail: null }, { status: 400 });
  }
  if (!context.env.SPX_RECAP_DB) {
    return json({ status: "BINDING_MISSING", errorCode: "SPX_RECAP_DB_BINDING_MISSING", error: "SPX_RECAP_DB binding is not configured.", detail: null }, { status: 503 });
  }
  const cached = await readSpxEdgeCache(context.request);
  if (cached) return cached;
  try {
    const heatmap = await readSpxGexHeatmap(context.env.SPX_RECAP_DB, date!, snapshotMinuteEt);
    const detail = heatmap?.cells.find((cell) => cell.strike === strike && cell.expdate === expdate) || null;
    const response = withSpxObservability(json({
      status: detail ? "READY" : "EMPTY",
      errorCode: null,
      detail,
    }, {}, detail ? "public, max-age=15" : "no-store"), Date.now() - startedAt);
    if (detail) writeSpxEdgeCache(context, response);
    return response;
  } catch (error) {
    return json({
      status: "ERROR",
      errorCode: "SPX_GEX_CELL_DETAIL_READ_FAILED",
      error: error instanceof Error ? error.message : String(error),
      detail: null,
    }, { status: 500 });
  }
}
