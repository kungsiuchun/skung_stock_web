import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonResponse, SafeJsonResponseError } from "../src/lib/safe-json-response";

test("parses a successful JSON response", async () => {
  assert.deepEqual(await parseJsonResponse<{ ok: boolean }>(new Response('{"ok":true}', {
    status: 200,
    headers: { "content-type": "application/json" },
  }), "/api/example"), { ok: true });
});

test("rejects empty, HTML, and invalid JSON responses with actionable context", async () => {
  const cases = [
    new Response("", { status: 200, headers: { "content-type": "application/json" } }),
    new Response("<html>offline</html>", { status: 502, headers: { "content-type": "text/html" } }),
    new Response("{bad", { status: 200, headers: { "content-type": "application/json" } }),
  ];
  for (const response of cases) {
    await assert.rejects(() => parseJsonResponse(response, "/api/example"), SafeJsonResponseError);
  }
});

test("turns a JSON HTTP failure into a readable service error", async () => {
  await assert.rejects(
    () => parseJsonResponse(new Response('{"error":{"message":"Published snapshot is unavailable."}}', {
      status: 503,
      headers: { "content-type": "application/json" },
    }), "/api/example"),
    (error: unknown) => error instanceof SafeJsonResponseError
      && error.httpStatus === 503
      && error.message.includes("Published snapshot is unavailable"),
  );
});

test("malformed JSON never exposes response fragments or native parser errors", async () => {
  await assert.rejects(
    () => parseJsonResponse(new Response('{"private-provider-fragment":broken}', {
      headers: { "content-type": "application/json", "cf-ray": "test-ray" },
    }), "/api/example"),
    (error: unknown) => error instanceof SafeJsonResponseError
      && error.message.includes("Ray test-ray")
      && error.message.includes("Retry the request")
      && !/private-provider-fragment|Unexpected token|position|JSON\.parse/.test(error.message),
  );
});

test("accepts stale JSON 206 while rejecting actual HTTP failures", async () => {
  const response = new Response('{"data":{"stale":true}}', {
    status: 206,
    headers: { "content-type": "application/json" },
  });
  await assert.rejects(() => parseJsonResponse(new Response('{"error":"unavailable"}', {
    status: 503,
    headers: { "content-type": "application/json" },
  }), "/api/example"), SafeJsonResponseError);
  assert.deepEqual(
    await parseJsonResponse<{ data: { stale: boolean } }>(response, "/api/example"),
    { data: { stale: true } },
  );
});

test("supports stale panel payloads and preserves JSON errors for panel status checks", async () => {
  const stale = await parseJsonResponse<{ data: { status: string } }>(new Response('{"data":{"status":"stale"}}', {
    status: 206,
    headers: { "content-type": "application/json" },
  }), "/api/stocks-watcher-macro", { allowHttpError: true });
  assert.deepEqual(stale, { data: { status: "stale" } });

  const failure = await parseJsonResponse<{ error: string }>(new Response('{"error":"Treasury source unavailable."}', {
    status: 502,
    headers: { "content-type": "application/json" },
  }), "/api/treasury-yield-curve", { allowHttpError: true });
  assert.deepEqual(failure, { error: "Treasury source unavailable." });
});
