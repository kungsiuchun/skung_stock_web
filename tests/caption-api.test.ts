import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet, onRequestPost } from "../functions/api/caption";
import { createWatcherSession } from "../src/lib/stocks-watcher-auth";
import { onRequest as middleware } from "../functions/api/_middleware";

const authEnv = { STOCKS_WATCHER_SESSION_SECRET: "test-caption-session-secret", STOCKS_WATCHER_ALLOWED_EMAIL: "owner@example.test" };
const ownerCookie = async (email = "owner@example.test") => `stocks_watcher_session=${await createWatcherSession(email, authEnv.STOCKS_WATCHER_SESSION_SECRET)}`;

test("Caption availability traverses the deployed method middleware and retains owner authentication", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "caches");
  Object.defineProperty(globalThis, "caches", { configurable: true, value: { default: {} } });
  let calls = 0;
  const env = { ...authEnv, image_caption_ai: { run: async () => { calls++; return { answer: "caption" }; } } };
  try {
    for (const [cookie, expected] of [[null, 401], [await ownerCookie(), 200]] as const) {
      const request = new Request("https://example.test/api/caption", { headers: cookie ? { Cookie: cookie } : {} });
      const response = await middleware({ request, env, next: () => onRequestGet({ request, env }), waitUntil() {} });
      assert.equal(response.status, expected);
    }
    assert.equal(calls, 0);
  } finally {
    if (previous) Object.defineProperty(globalThis, "caches", previous); else Reflect.deleteProperty(globalThis, "caches");
  }
});

test("caption requires an allowlisted owner before reading an image or calling AI", async () => {
  let reads = 0, calls = 0;
  const ai = { run: async () => { calls++; return "caption"; } };
  for (const [cookie, env, status] of [
    [null, {}, 503],
    [null, authEnv, 401],
    ["stocks_watcher_session=tampered", authEnv, 401],
    [await ownerCookie("stranger@example.test"), authEnv, 403],
  ] as const) {
    const request = new Request("http://localhost/api/caption", { method: "POST", headers: cookie ? { Cookie: cookie, Origin: "http://localhost" } : { Origin: "http://localhost" } });
    request.formData = async () => { reads++; return new FormData(); };
    const response = await onRequestPost({ request, env: { ...env, image_caption_ai: ai } });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal(reads, 0); assert.equal(calls, 0);
});

test("caption availability verifies owner and binding without calling AI", async () => {
  let calls = 0;
  const request = new Request("http://localhost/api/caption", { headers: { Cookie: await ownerCookie() } });
  const missing = await onRequestGet({ request, env: authEnv });
  assert.equal(missing.status, 503);
  const available = await onRequestGet({ request, env: { ...authEnv, image_caption_ai: { run: async () => { calls++; return "caption"; } } } });
  assert.equal(available.status, 200);
  assert.deepEqual(await available.json(), { available: true });
  assert.equal(calls, 0);
  const crossSite = await onRequestPost({ request: new Request("http://localhost/api/caption", { method: "POST", headers: { Cookie: await ownerCookie(), Origin: "https://other.example" } }), env: authEnv });
  assert.equal(crossSite.status, 403);
});

test("caption API enforces upload limits before invoking AI", async () => {
  let calls = 0;
  const env = { ...authEnv, image_caption_ai: { run: async () => { calls++; return { answer: "caption" }; } } };
  for (const [file, status] of [
    [new File(["image"], "image.txt", { type: "text/plain" }), 415],
    [new File([], "empty.png", { type: "image/png" }), 400],
    [new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.jpg", { type: "image/jpeg" }), 413],
    [new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" }), 200],
  ] as const) {
    const form = new FormData(); form.append("image", file);
    const before = calls;
    const response = await onRequestPost({ request: new Request("http://localhost/api/caption", { method: "POST", headers: { Cookie: await ownerCookie(), Origin: "http://localhost" }, body: form }), env });
    assert.equal(response.status, status);
    assert.equal(calls - before, status === 200 ? 1 : 0);
  }
});

test("caption sends the supported Moondream image contract and rejects empty provider output", async () => {
  const form = new FormData();
  const bytes = new Uint8Array(100_000).fill(137);
  form.append("image", new File([bytes], "image.png", { type: "image/png" }));
  const request = () => new Request("http://localhost/api/caption", { method: "POST", headers: { Cookie: cookie, Origin: "http://localhost" }, body: form });
  const cookie = await ownerCookie();
  let output: unknown = { answer: "  A quiet horizon.  " };
  const env = { ...authEnv, image_caption_ai: { async run(model: string, inputs: Record<string, unknown>) {
    assert.equal(model, "@cf/moondream/moondream3.1-9B-A2B");
    assert.equal(inputs.task, "query"); assert.equal(inputs.reasoning, false); assert.equal(inputs.stream, false);
    assert.equal(inputs.max_tokens, 50);
    assert.equal(inputs.image, `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`);
    return output;
  } } };
  const valid = await onRequestPost({ request: request(), env });
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { success: true, result: "A quiet horizon." });
  output = { result: { answer: "An image through a lens." }, usage: { total_tokens: 20 } };
  const wrapped = await onRequestPost({ request: request(), env });
  assert.equal(wrapped.status, 200);
  assert.deepEqual(await wrapped.json(), { success: true, result: "An image through a lens." });
  for (output of [null, {}, { answer: " " }, "old-model-output"]) {
    assert.equal((await onRequestPost({ request: request(), env })).status, 502);
  }
});
