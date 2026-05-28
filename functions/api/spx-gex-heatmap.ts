import {
  listSpxGexHeatmapDates,
  readSpxGexHeatmap,
} from "../../src/lib/spx-gex-heatmap";
import type { D1DatabaseLike } from "../../src/lib/spx-recap-d1";

interface Env {
  SPX_RECAP_DB?: D1DatabaseLike;
}

const isValidDate = (date: string | null) => Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(date));

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=30",
      ...(init.headers || {}),
    },
  });

const chooseSelectedDate = (availableDates: string[], requestedDate: string | null) => {
  if (isValidDate(requestedDate) && availableDates.includes(requestedDate!)) return requestedDate!;
  return availableDates[0] || null;
};

export async function onRequest(context: { request: Request; env: Env }) {
  const warnings: string[] = [];
  const url = new URL(context.request.url);

  if (!context.env.SPX_RECAP_DB) {
    return json({
      availableDates: [],
      selectedDate: null,
      heatmap: null,
      warnings: ["SPX_RECAP_DB binding is not configured."],
    });
  }

  try {
    const availableDates = await listSpxGexHeatmapDates(context.env.SPX_RECAP_DB);
    const selectedDate = chooseSelectedDate(availableDates, url.searchParams.get("date"));
    const heatmap = selectedDate ? await readSpxGexHeatmap(context.env.SPX_RECAP_DB, selectedDate) : null;

    return json({
      availableDates,
      selectedDate,
      heatmap,
      warnings,
    });
  } catch (error) {
    return json(
      {
        availableDates: [],
        selectedDate: null,
        heatmap: null,
        warnings: [`D1 read failed: ${error instanceof Error ? error.message : String(error)}`],
      },
      { status: 500 },
    );
  }
}
