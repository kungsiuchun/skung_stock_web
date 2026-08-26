import {
  listSpxGexHeatmapDates,
  listSpxGexHeatmapSessions,
  readSpxGexHeatmap,
} from "../../src/lib/spx-gex-heatmap";
import type { SpxGexHeatmapCell, SpxGexHeatmapModel } from "../../src/lib/spx-gex-heatmap";
import type { D1DatabaseLike } from "../../src/lib/spx-recap-d1";
import { readSpxDecisionCockpitForGexSnapshot } from "../../src/lib/spx-decision-ledger";
import { D1SpxGexCollectionStore, querySpxGexCollectionCoverage } from "../../src/lib/spx-gex-collection-lifecycle";
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

const parseSnapshotMinute = (value: string | null) => {
  if (!value) return null;
  const minute = Number(value);
  return Number.isInteger(minute) && minute >= 0 && minute <= 24 * 60 ? minute : null;
};

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

const compactCell = (cell: SpxGexHeatmapCell) => ({
  strike: cell.strike,
  expdate: cell.expdate,
  netGex: cell.netGex,
  callGex: cell.callGex,
  putGex: cell.putGex,
  netDex: cell.netDex,
  netVex: cell.netVex,
  netCex: cell.netCex,
  pricingQuality: cell.pricingQuality,
  callIvSource: cell.callIvSource,
  putIvSource: cell.putIvSource,
  inactiveSeries: cell.inactiveSeries,
});

const compactHeatmap = (heatmap: SpxGexHeatmapModel) => ({
  ...heatmap,
  cells: heatmap.cells.map(compactCell),
});

const chooseSelectedDate = (availableDates: string[], requestedDate: string | null) => {
  if (isValidDate(requestedDate)) return requestedDate!;
  return availableDates[0] || null;
};

const currentEtClock = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return { tradingDate: `${parts.year}-${parts.month}-${parts.day}`, minuteEt: Number(parts.hour) * 60 + Number(parts.minute) };
};

const readCollectionHealth = async (db: D1DatabaseLike, tradingDate: string | null, warnings: string[]) => {
  if (!tradingDate) return null;
  try {
    const clock = currentEtClock();
    const health = await querySpxGexCollectionCoverage(db, tradingDate, tradingDate === clock.tradingDate ? clock.minuteEt : 24 * 60);
    const latest = health.records.at(-1) || null;
    return {
      dueSlots: health.dueCount,
      persistedSlots: health.persistedCount,
      missingSnapshotMinutesEt: health.missingSnapshotMinutesEt,
      incompleteSlotIds: health.incompleteSlotIds,
      failedSlotIds: health.failedSlotIds,
      provider: latest?.provider || null,
      fallbackFrom: latest?.fallbackFrom || null,
      stage: latest?.currentStage || null,
      failure: latest?.error || null,
      updatedAt: latest?.updatedAt || null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table:\s*spx_gex_collection_runs/i.test(message)) {
      warnings.push("GEX collection lifecycle migration is not applied yet.");
      return null;
    }
    throw error;
  }
};

const readCollectionSlot = async (
  db: D1DatabaseLike,
  slotId: string | null,
  warnings: string[],
) => {
  if (!slotId) return null;
  try {
    return await new D1SpxGexCollectionStore(db).getSlot(slotId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table:\s*spx_gex_collection_runs/i.test(message)) {
      warnings.push("GEX collection lifecycle migration is not applied yet.");
      return null;
    }
    throw error;
  }
};

const readCollectionAttempts = async (
  db: D1DatabaseLike,
  tradingDate: string | null,
  warnings: string[],
) => {
  if (!tradingDate) return [];
  try {
    return await new D1SpxGexCollectionStore(db).listAttemptsForDate(tradingDate, 3);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table:\s*spx_gex_collection_(?:runs|events)/i.test(message)) {
      warnings.push("GEX collection lifecycle migration is not applied yet.");
      return [];
    }
    throw error;
  }
};

const readDecisionCockpit = async (
  db: D1DatabaseLike,
  snapshotId: string | undefined,
  warnings: string[],
) => {
  try {
    return await readSpxDecisionCockpitForGexSnapshot(db, snapshotId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table:\s*(spx_decision_run_health|spx_decision_runs|spx_delivery_outbox|spx_run_lifecycle_events)/i.test(message)) {
      warnings.push("SPX decision pipeline migration is not applied yet.");
      return null;
    }
    throw error;
  }
};

async function onRequestUncached(context: Context) {
  const startedAt = Date.now();
  const warnings: string[] = [];
  const url = new URL(context.request.url);

  if (!context.env.SPX_RECAP_DB) {
    return json({
      status: "BINDING_MISSING",
      errorCode: "SPX_RECAP_DB_BINDING_MISSING",
      error: "SPX_RECAP_DB binding is not configured.",
      availableDates: [],
      selectedDate: null,
      sessions: [],
      selectedSnapshot: null,
      heatmap: null,
      decision: null,
      collection: null,
      collectionAttempts: [],
      warnings: ["SPX_RECAP_DB binding is not configured."],
    }, { status: 503 });
  }

  try {
    // Keep this explicit preflight: the date-list helper intentionally maps a
    // missing table to an empty list, while the public API must fail closed.
    await context.env.SPX_RECAP_DB.prepare("SELECT 1 FROM spx_gex_intraday_snapshots LIMIT 1").first();
    const budgetBlocked = await reserveSpxApiBudget(context.env.SPX_RECAP_DB, {
      operation: "gex_heatmap",
      rowsRead: 120,
      rowsWritten: 10,
    });
    if (budgetBlocked) return budgetBlocked;
    const availableDates = await listSpxGexHeatmapDates(context.env.SPX_RECAP_DB);
    const selectedDate = chooseSelectedDate(availableDates, url.searchParams.get("date"));
    const sessions = selectedDate ? await listSpxGexHeatmapSessions(context.env.SPX_RECAP_DB, selectedDate) : [];
    const requestedSnapshot = parseSnapshotMinute(url.searchParams.get("snapshot"));
    const selectedSnapshot = requestedSnapshot ?? sessions[sessions.length - 1]?.snapshotMinuteEt ?? null;
    const heatmap = selectedDate ? await readSpxGexHeatmap(context.env.SPX_RECAP_DB, selectedDate, selectedSnapshot) : null;
    const [decision, collection, collectionHealth, collectionAttempts] = await Promise.all([
      readDecisionCockpit(context.env.SPX_RECAP_DB, heatmap?.canonical?.snapshotId, warnings),
      readCollectionSlot(
        context.env.SPX_RECAP_DB,
        selectedDate && selectedSnapshot !== null ? `${selectedDate}:${selectedSnapshot}` : null,
        warnings,
      ),
      readCollectionHealth(context.env.SPX_RECAP_DB, selectedDate, warnings),
      readCollectionAttempts(context.env.SPX_RECAP_DB, selectedDate, warnings),
    ]);

    const status = heatmap ? "READY" : "EMPTY";
    const response = withSpxObservability(json({
      status,
      errorCode: null,
      availableDates,
      selectedDate,
      sessions,
      selectedSnapshot: heatmap?.session || sessions.find((session) => session.snapshotMinuteEt === selectedSnapshot) || null,
      heatmap: heatmap ? compactHeatmap(heatmap) : null,
      decision,
      collection,
      collectionAttempts,
      collectionHealth,
      warnings: [...new Set(warnings)],
    }, {}, status === "READY" ? SPX_GEX_EDGE_CACHE_CONTROL : "no-store"), Date.now() - startedAt);
    if (status === "READY") await writeSpxEdgeCache(context, response);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missingTable = /no such table:\s*spx_gex_intraday_snapshots/i.test(message);
    return json(
      {
        status: missingTable ? "STORAGE_UNAVAILABLE" : "ERROR",
        errorCode: missingTable ? "SPX_GEX_INTRADAY_TABLE_MISSING" : "SPX_GEX_D1_READ_FAILED",
        error: missingTable
          ? "SPX GEX intraday storage migration is not applied."
          : `D1 read failed: ${message}`,
        availableDates: [],
        selectedDate: null,
        sessions: [],
        selectedSnapshot: null,
        heatmap: null,
        decision: null,
        collection: null,
        collectionAttempts: [],
        warnings: [missingTable ? "SPX GEX intraday storage migration is not applied." : `D1 read failed: ${message}`],
      },
      { status: missingTable ? 503 : 500 },
    );
  }
}

export async function onRequest(context: Context) {
  const cached = await readSpxEdgeCache(context.request);
  if (cached) return cached;
  return coalesceSpxEdgeRequest(context.request, () => onRequestUncached(context));
}
