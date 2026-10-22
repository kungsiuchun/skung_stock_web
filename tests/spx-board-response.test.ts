import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSpxBoardResponse, emptySpxBoard } from "../src/lib/spx-board-response";
import { SafeJsonResponseError } from "../src/lib/safe-json-response";
import { buildSpxGexUatFixture } from "../src/lib/spx-gex-uat-fixture";
import { onRequest as heatmapApi } from "../functions/api/spx-gex-heatmap";
import { writeSpxEdgeCache } from "../functions/api/_spx-edge-cache";
import { runSpxRequest, SpxRequestTimeoutError } from "../src/lib/spx-request-lane";

const model = buildSpxGexUatFixture();
const ready = () => ({ ...emptySpxBoard, status: "READY", selectedDate: model.session!.tradingDate, selectedSnapshot: model.session, sessions: [model.session], heatmap: structuredClone(model) });

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
