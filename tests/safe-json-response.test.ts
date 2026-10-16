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
