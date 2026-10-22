import assert from "node:assert/strict";
import { it } from "node:test";
import { buildSpxFailureDetails, emptySpxBoard, formatSpxFailureDetails, parseSpxBoardResponse } from "../src/lib/spx-board-response";
import { SafeJsonResponseError } from "../src/lib/safe-json-response";
import { buildSpxGexUatFixture } from "../src/lib/spx-gex-uat-fixture";
import { buildSpxGexPressureMatrixFromFrames, getSpxGexPressureRecoveryDelay } from "../src/lib/spx-gex-pressure-matrix";
import { buildSpxPriceActionCompassResponse } from "../src/lib/spx-price-action-compass";
import { onRequest as heatmapApi } from "../functions/api/spx-gex-heatmap";
import { writeSpxEdgeCache } from "../functions/api/_spx-edge-cache";
import { runSpxRequest, SpxRequestTimeoutError } from "../src/lib/spx-request-lane";

const model = buildSpxGexUatFixture();
const ready = () => ({ ...emptySpxBoard, status: "READY", selectedDate: model.session!.tradingDate, selectedSnapshot: model.session, sessions: [model.session], heatmap: structuredClone(model) });
const pressureReady = () => ({
  status: "READY" as const,
  errorCode: null,
  selectedDate: "2026-07-13",
  pressure: buildSpxGexPressureMatrixFromFrames([
    { tradingDate: "2026-07-13", snapshotMinuteEt: 570, snapshotTimeEt: "09:30", collectedMinuteEt: 585, collectedTimeEt: "09:45", spot: 7523, expiry: "2026-07-13", calculationEngineVersion: 2, provider: "d1", fallbackFrom: null, sourceTimestamp: "2026-07-13T13:45:00.000Z", snapshotId: "snapshot-570", gexByStrike: [{ strike: 7520, netGex: 10 }] },
    { tradingDate: "2026-07-13", snapshotMinuteEt: 585, snapshotTimeEt: "09:45", collectedMinuteEt: 600, collectedTimeEt: "10:00", spot: 7525, expiry: "2026-07-13", calculationEngineVersion: 2, provider: "d1", fallbackFrom: null, sourceTimestamp: "2026-07-13T14:00:00.000Z", snapshotId: "snapshot-585", gexByStrike: [{ strike: 7520, netGex: 30 }] },
  ], { includeAvailableStrikes: true }),
  invalidSnapshots: [],
  collectionAttempts: [],
  warnings: [],
});

it("classifies an abort-aware fetch timeout before its abort rejection and retries once", async () => {
  let attempts=0;
  await assert.rejects(runSpxRequest(signal => new Promise<Response>((_resolve,reject)=>{
    attempts++;
    signal.addEventListener("abort",()=>reject(new DOMException("fetch aborted","AbortError")),{once:true});
  }),{attemptTimeoutMs:5,retryDelaysMs:[1]}),e=>e instanceof SpxRequestTimeoutError);
  assert.equal(attempts,2);
  assert.equal((await runSpxRequest(async()=>Response.json({ready:true}))).status,200,"timeout must release the lane");
});

it("classifies empty, HTML and malformed JSON separately from a JSON schema failure", async () => {
  const cases = [
    [new Response("", {headers:{"content-type":"application/json"}}), "EMPTY_RESPONSE"],
    [new Response("<html>unavailable</html>", {status:503,headers:{"content-type":"text/html"}}), "NON_JSON_RESPONSE"],
    [new Response('{"status":', {headers:{"content-type":"application/json"}}), "INVALID_JSON"],
    [Response.json({status:"READY"}), "SCHEMA_INVALID"],
    [Response.json(null), "SCHEMA_INVALID"],
    [Response.json({...ready(), heatmap:{}}), "SCHEMA_INVALID"],
    [Response.json({...ready(), decision:{}}), "SCHEMA_INVALID"],
  ] as const;
  for (const [response, code] of cases) await assert.rejects(parseSpxBoardResponse(response, "/api/spx-gex-heatmap", "heatmap"), e => e instanceof SafeJsonResponseError && e.code === code);
  assert.deepEqual(await parseSpxBoardResponse(Response.json(emptySpxBoard), "/api/spx-gex-heatmap", "heatmap"), emptySpxBoard);
  assert.equal((await parseSpxBoardResponse<{status:string}>(Response.json(ready()), "/api/spx-gex-heatmap", "heatmap")).status, "READY");
});

it("rejects inconsistent snapshot identity and bad numeric values before rendering", async () => {
  const mismatched = ready();
  mismatched.selectedDate = "2026-07-14";
  await assert.rejects(parseSpxBoardResponse(Response.json(mismatched), "/api/spx-gex-heatmap", "heatmap"), /contract/);
  const bad = ready();
  (bad.heatmap.quote as unknown as {last:unknown}).last = "7523";
  await assert.rejects(parseSpxBoardResponse(Response.json(bad), "/api/spx-gex-heatmap", "heatmap"), /contract/);
});

it("rejects malformed nested pressure and Compass fields at the shared boundary", async () => {
  const pressure = pressureReady();
  assert.ok(pressure.pressure.movers.length > 0);
  const missingRank = structuredClone(pressure);
  delete (missingRank.pressure.movers[0] as unknown as Record<string, unknown>).rank;
  await assert.rejects(parseSpxBoardResponse(Response.json(missingRank), "/api/spx-gex-pressure?date=2026-07-13", "pressure"), error => error instanceof SafeJsonResponseError && error.code === "SCHEMA_INVALID");

  const compass = buildSpxPriceActionCompassResponse({
    timeframe: "5m",
    candles: Array.from({ length: 6 }, (_, index) => ({ time: Date.parse("2026-07-13T14:00:00.000Z") + index * 300_000, date_iso: "2026-07-13", open: 100, high: 101, low: 99, close: 100, volume: 10 })),
    source: { provider: "test", label: "Fixture", symbol: "SPX", range: "fixture", interval: "5m", fetchedAt: "2026-07-13T15:00:00.000Z", note: "test" },
  });
  const invalidPattern = { id: "invalid", type: "DOJI", name: "Doji", label: "Doji", category: "candle", direction: "neutral", candleIndices: [2], fromIndex: 2, toIndex: 2, price: 100, confidence: 2, description: "invalid" };
  const malformedCompass = { ...compass, patterns: [...compass.patterns, invalidPattern], summary: { ...compass.summary, latestPattern: invalidPattern } };
  await assert.rejects(parseSpxBoardResponse(Response.json(malformedCompass), "/api/spx-price-action-compass?timeframe=5m", "compass"), error => error instanceof SafeJsonResponseError && error.code === "SCHEMA_INVALID");
});

it("stops automatic pressure recovery after the explicit attempt budget", () => {
  assert.deepEqual([0, 1, 2].map(getSpxGexPressureRecoveryDelay), [3_000, 15_000, 60_000]);
  assert.equal(getSpxGexPressureRecoveryDelay(3), null);
  assert.equal(getSpxGexPressureRecoveryDelay(-1), null);
});

it("formats diagnostics from safe response identity without raw error text", () => {
  const details = buildSpxFailureDetails({
    error: new SafeJsonResponseError("secret upstream payload", 503, "text/html", "ray-123", "NON_JSON_RESPONSE"),
    requestUrl: "/api/spx-gex-pressure?date=2026-07-13",
    fallbackCode: "TRANSPORT_ERROR",
  });
  assert.equal(formatSpxFailureDetails(details), "HTTP 503 · CODE NON_JSON_RESPONSE · REQUEST /api/spx-gex-pressure?date=2026-07-13 · RAY ray-123");
  assert.doesNotMatch(formatSpxFailureDetails(details), /secret upstream payload/);
});

it("turns an outer heatmap edge failure into a non-cacheable JSON 503", async () => {
  const clone = Response.prototype.clone;
  const log = console.error;
  const logged: unknown[] = [];
  Response.prototype.clone = () => { throw new Error("injected clone failure"); };
  console.error = (...args) => { logged.push(args); };
  try {
    const response = await heatmapApi({request:new Request("https://example.com/api/spx-gex-heatmap"),env:{}});
    assert.equal(response.status,503);
    assert.equal(response.headers.get("cache-control"),"no-store");
    assert.match(response.headers.get("content-type")!,/application\/json/);
    assert.equal((await response.json() as {errorCode:string}).errorCode,"SPX_GEX_HEATMAP_EDGE_FAILED");
    assert.equal(logged.length,1);
  } finally { Response.prototype.clone = clone; console.error = log; }
});

it("contains optional cache acquisition failures without an unhandled rejection", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis,"caches");
  const log = console.error;
  const logged: unknown[] = [];
  Object.defineProperty(globalThis,"caches",{configurable:true,get(){throw new Error("cache unavailable");}});
  console.error=(...args)=>{logged.push(args);};
  try {
    await writeSpxEdgeCache({request:new Request("https://example.com/api/spx-gex-heatmap")},Response.json({status:"READY"}));
    assert.equal(logged.length,1);
  } finally { console.error=log; if(descriptor)Object.defineProperty(globalThis,"caches",descriptor); else Reflect.deleteProperty(globalThis,"caches"); }
});
