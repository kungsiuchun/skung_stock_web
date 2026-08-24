import assert from "node:assert/strict";
import test from "node:test";

import { onRequest } from "../functions/api/spx-recap";

test("SPX recap API exposes retention metadata and clamps analytics to retained dates", async () => {
  const values: Record<string, string> = {
    "spx_memory_2026-06-01": JSON.stringify({ actionLog: [] }),
    "spx_memory_2026-08-20": JSON.stringify({ actionLog: [] }),
  };
  const response = await onRequest({
    request: new Request("https://local.test/api/spx-recap?from=2020-01-01&to=2030-01-01"),
    env: {
      SPX_MEMORY: {
        async get(key: string) { return values[key] || null; },
        async list() {
          return { keys: Object.keys(values).map((name) => ({ name })), list_complete: true };
        },
      },
    },
  });
  const body = await response.json() as any;
  assert.deepEqual(body.retention, { rawDays: 30, recapDays: 90, availableDateLimit: 90 });
  assert.deepEqual(body.performance, { label: "SPX direction proxy · not option P&L", buckets: [] });
  assert.equal(body.selectedDate, "2026-08-20");
  assert.deepEqual(body.analytics.days.map((day: { date: string }) => day.date), ["2026-06-01", "2026-08-20"]);
});
