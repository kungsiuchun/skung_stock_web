import {
  listSpxGexInvalidSnapshotDates,
  listSpxGexInvalidSnapshots,
} from "../../src/lib/spx-gex-heatmap";
import { listSpxGexPressureDates, listSpxGexPressureFrames } from "../../src/lib/spx-gex-pressure-d1";
import { buildSpxGexPressureMatrixFromFrames } from "../../src/lib/spx-gex-pressure-matrix";
import type { D1DatabaseLike } from "../../src/lib/spx-recap-d1";
import { D1SpxGexCollectionStore } from "../../src/lib/spx-gex-collection-lifecycle";
import { coalesceSpxEdgeRequest, readSpxEdgeCache, withSpxObservability, writeSpxEdgeCache } from "./_spx-edge-cache";
import { reserveSpxApiBudget } from "./_spx-d1-budget";

interface Env {
  SPX_RECAP_DB?: D1DatabaseLike;
}

interface Context {
  request: Request;
  env: Env;
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** GEX snapshots are collected every 15 minutes; a one-minute edge TTL is safely below that cadence. */
const SPX_GEX_EDGE_CACHE_CONTROL = "public, max-age=60";

const isValidDate = (date: string | null) => Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(date));

const json = (body: unknown, init: ResponseInit = {}, cacheControl = "no-store") => {
  const text = JSON.stringify(body);
  return new Response(text, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cacheControl,
      "X-SPX-Payload-Bytes": String(new TextEncoder().encode(text).byteLength),
      ...(init.headers || {}),
    },
  });
};

async function onRequestUncached(context: Context) {
  const startedAt = Date.now();
  const url = new URL(context.request.url);

  if (!context.env.SPX_RECAP_DB) {
    return json({
      status: "BINDING_MISSING",
      errorCode: "SPX_RECAP_DB_BINDING_MISSING",
      error: "SPX_RECAP_DB binding is not configured.",
      selectedDate: null,
      pressure: null,
      invalidSnapshots: [],
      collectionAttempts: [],
      warnings: ["SPX_RECAP_DB binding is not configured."],
    }, { status: 503 });
  }

  try {
    // Keep this explicit preflight: the date-list helper intentionally maps a
    // missing table to an empty list, while the public API must fail closed.
    await context.env.SPX_RECAP_DB.prepare("SELECT 1 FROM spx_gex_pressure_projections LIMIT 1").first();
    const budgetBlocked = await reserveSpxApiBudget(context.env.SPX_RECAP_DB, {
      operation: "pressure_matrix",
      rowsRead: 40,
      rowsWritten: 10,
    });
    if (budgetBlocked) return budgetBlocked;
    const [activeDates, invalidDates] = await Promise.all([
      listSpxGexPressureDates(context.env.SPX_RECAP_DB),
      listSpxGexInvalidSnapshotDates(context.env.SPX_RECAP_DB),
    ]);
    const dates = [...new Set([...activeDates, ...invalidDates])].sort().reverse();
    const requestedDate = url.searchParams.get("date");
    const unavailableRequestedDate = isValidDate(requestedDate) && !dates.includes(requestedDate!);
    const selectedDate = unavailableRequestedDate ? requestedDate! : isValidDate(requestedDate) ? requestedDate! : dates[0] || null;
    if (unavailableRequestedDate) {
      return json({
        status: "EMPTY",
        errorCode: "SPX_GEX_PRESSURE_DATE_UNAVAILABLE",
        selectedDate,
        pressure: null,
        invalidSnapshots: [],
        collectionAttempts: [],
        warnings: [`SPX GEX pressure is unavailable for ${selectedDate}.`],
      });
    }
    const [audit, quarantinedSnapshots, collectionAttempts] = selectedDate
      ? await Promise.all([
        listSpxGexPressureFrames(context.env.SPX_RECAP_DB, selectedDate),
        listSpxGexInvalidSnapshots(context.env.SPX_RECAP_DB, selectedDate),
        new D1SpxGexCollectionStore(context.env.SPX_RECAP_DB).listAttemptsForDate(selectedDate, 3),
      ])
      : [{ frames: [], invalidSnapshots: [], projectionBytes: 0 }, [], []];
    const validSnapshotMinutes = new Set(audit.frames.map((frame) => frame.snapshotMinuteEt));
    const invalidSnapshots = [...audit.invalidSnapshots, ...quarantinedSnapshots]
      .filter((snapshot) => !validSnapshotMinutes.has(snapshot.snapshotMinuteEt))
      .filter((snapshot, index, all) => all.findIndex((candidate) =>
        candidate.snapshotMinuteEt === snapshot.snapshotMinuteEt
        && candidate.reasonCode === snapshot.reasonCode) === index)
      .sort((a, b) => a.snapshotMinuteEt - b.snapshotMinuteEt);
    if (!selectedDate) {
      return json({ status: "EMPTY", errorCode: null, selectedDate, pressure: null, invalidSnapshots: [], collectionAttempts, warnings: [] });
    }
    if (audit.frames.length === 0 && invalidSnapshots.length > 0) {
      return json({
        status: "ERROR",
        errorCode: "SPX_GEX_PRESSURE_NO_VALID_SNAPSHOTS",
        error: "SPX GEX pressure has no contract-valid snapshots for the selected date.",
        selectedDate,
        pressure: null,
        invalidSnapshots,
        collectionAttempts,
        warnings: ["All persisted SPX GEX snapshots failed the pressure data contract."],
      }, { status: 500 });
    }
    if (audit.frames.length === 0) {
      return json({ status: "EMPTY", errorCode: null, selectedDate, pressure: null, invalidSnapshots: [], collectionAttempts, warnings: [] });
    }

    const builtPressure = buildSpxGexPressureMatrixFromFrames(audit.frames);
    const invalidWarnings = invalidSnapshots.map((snapshot) =>
      `${snapshot.snapshotTimeEt} snapshot did not pass the pressure data contract and was excluded.`);
    const pressure = { ...builtPressure, warnings: [...builtPressure.warnings, ...invalidWarnings] };
    const status = invalidSnapshots.length > 0 ? "DEGRADED" : "READY";
    const response = withSpxObservability(json({
      status,
      errorCode: null,
      selectedDate,
      pressure,
      invalidSnapshots,
      collectionAttempts,
      warnings: pressure.warnings,
    }, {
      headers: {
        "X-SPX-Frame-Count": String(audit.frames.length),
        "X-SPX-Projection-Bytes": String(audit.projectionBytes),
      },
    }, SPX_GEX_EDGE_CACHE_CONTROL), Date.now() - startedAt);
    await writeSpxEdgeCache(context, response);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missingTable = /no such table:\s*(spx_gex_intraday_snapshots|spx_gex_pressure_projections)/i.test(message);
    return json({
      status: missingTable ? "STORAGE_UNAVAILABLE" : "ERROR",
      errorCode: missingTable ? "SPX_GEX_INTRADAY_TABLE_MISSING" : "SPX_GEX_PRESSURE_BUILD_FAILED",
      error: missingTable ? "SPX GEX intraday storage migration is not applied." : `SPX GEX pressure build failed: ${message}`,
      selectedDate: null,
      pressure: null,
      invalidSnapshots: [],
      collectionAttempts: [],
      warnings: [missingTable ? "SPX GEX intraday storage migration is not applied." : `SPX GEX pressure build failed: ${message}`],
    }, { status: missingTable ? 503 : 500 });
  }
}

export async function onRequest(context: Context) {
  const cached = await readSpxEdgeCache(context.request);
  if (cached) return cached;
  return coalesceSpxEdgeRequest(context.request, () => onRequestUncached(context));
}
