import {
  listSpxGexHeatmapDates,
  listSpxGexHeatmapSessions,
  readSpxGexHeatmap,
} from "../../src/lib/spx-gex-heatmap";
import type { D1DatabaseLike } from "../../src/lib/spx-recap-d1";
import { readSpxDecisionCockpitForGexSnapshot } from "../../src/lib/spx-decision-ledger";
import { D1SpxGexCollectionStore } from "../../src/lib/spx-gex-collection-lifecycle";

interface Env {
  SPX_RECAP_DB?: D1DatabaseLike;
}

const isValidDate = (date: string | null) => Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(date));

const parseSnapshotMinute = (value: string | null) => {
  if (!value) return null;
  const minute = Number(value);
  return Number.isInteger(minute) && minute >= 0 && minute <= 24 * 60 ? minute : null;
};

const json = (body: unknown, init: ResponseInit = {}, cacheControl = "no-store") =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cacheControl,
      ...(init.headers || {}),
    },
  });

const chooseSelectedDate = (availableDates: string[], requestedDate: string | null) => {
  if (isValidDate(requestedDate) && availableDates.includes(requestedDate!)) return requestedDate!;
  return availableDates[0] || null;
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

export async function onRequest(context: { request: Request; env: Env }) {
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
      warnings: ["SPX_RECAP_DB binding is not configured."],
    }, { status: 503 });
  }

  try {
    await context.env.SPX_RECAP_DB.prepare("SELECT 1 FROM spx_gex_intraday_snapshots LIMIT 1").first();
    const availableDates = await listSpxGexHeatmapDates(context.env.SPX_RECAP_DB);
    const selectedDate = chooseSelectedDate(availableDates, url.searchParams.get("date"));
    const sessions = selectedDate ? await listSpxGexHeatmapSessions(context.env.SPX_RECAP_DB, selectedDate) : [];
    const requestedSnapshot = parseSnapshotMinute(url.searchParams.get("snapshot"));
    const selectedSnapshot = requestedSnapshot ?? sessions[sessions.length - 1]?.snapshotMinuteEt ?? null;
    const heatmap = selectedDate ? await readSpxGexHeatmap(context.env.SPX_RECAP_DB, selectedDate, selectedSnapshot) : null;
    const [decision, collection] = await Promise.all([
      readDecisionCockpit(context.env.SPX_RECAP_DB, heatmap?.canonical?.snapshotId, warnings),
      readCollectionSlot(
        context.env.SPX_RECAP_DB,
        selectedDate && selectedSnapshot !== null ? `${selectedDate}:${selectedSnapshot}` : null,
        warnings,
      ),
    ]);

    const status = heatmap ? "READY" : "EMPTY";
    return json({
      status,
      errorCode: null,
      availableDates,
      selectedDate,
      sessions,
      selectedSnapshot: heatmap?.session || sessions.find((session) => session.snapshotMinuteEt === selectedSnapshot) || null,
      heatmap,
      decision,
      collection,
      warnings,
    }, {}, status === "READY" ? "public, max-age=15" : "no-store");
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
        warnings: [missingTable ? "SPX GEX intraday storage migration is not applied." : `D1 read failed: ${message}`],
      },
      { status: missingTable ? 503 : 500 },
    );
  }
}
