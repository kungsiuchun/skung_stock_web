import assert from "node:assert/strict";
import test from "node:test";

import { classifySpxOperationalFailure } from "../src/lib/spx-operational-health";
import { isUsableCanonicalSpxGexHeatmap, runSupervisedSpxMarketTick } from "../scripts/worker-spx-bot";

test("operational health classifies failures without persisting raw error text", () => {
  assert.equal(classifySpxOperationalFailure(new Error("canonical GEX heatmap is malformed")), "CANONICAL_GEX_UNAVAILABLE");
  assert.equal(classifySpxOperationalFailure(new Error("D1 SQLITE_ERROR")), "D1_OPERATION_FAILED");
  assert.equal(classifySpxOperationalFailure(new Error("request timeout")), "UPSTREAM_TIMEOUT");
  assert.equal(classifySpxOperationalFailure(new Error("unexpected parser issue"), "TICK_FAILED"), "TICK_FAILED");
});

test("canonical GEX validation rejects incomplete snapshots before trading can dereference them", () => {
  assert.equal(isUsableCanonicalSpxGexHeatmap(null), false);
  assert.equal(isUsableCanonicalSpxGexHeatmap({ session: {}, quote: {}, zeroDte: {}, canonical: {}, cells: [], strikeProfiles: [] }), false);
});

test("supervised tick fails visibly when its D1 health ledger binding is absent", async () => {
  const result = await runSupervisedSpxMarketTick({} as any, new Date("2026-07-16T14:30:00.000Z"));
  assert.deepEqual(result, { status: "FAILED", failureCode: "D1_OPERATION_FAILED" });
});
