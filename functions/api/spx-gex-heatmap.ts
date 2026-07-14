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

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=15",
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
      availableDates: [],
      selectedDate: null,
      sessions: [],
      selectedSnapshot: null,
      heatmap: null,
      decision: null,
      collection: null,
      warnings: ["SPX_RECAP_DB binding is not configured."],
    });
  }

  try {
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

    return json({
      availableDates,
      selectedDate,
      sessions,
      selectedSnapshot: heatmap?.session || sessions.find((session) => session.snapshotMinuteEt === selectedSnapshot) || null,
      heatmap,
      decision,
      collection,
      warnings,
    });
  } catch (error) {
    return json(
      {
        availableDates: [],
        selectedDate: null,
        sessions: [],
        selectedSnapshot: null,
        heatmap: null,
        decision: null,
        collection: null,
        warnings: [`D1 read failed: ${error instanceof Error ? error.message : String(error)}`],
      },
      { status: 500 },
    );
  }
}
