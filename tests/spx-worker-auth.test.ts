import assert from "node:assert/strict";
import test from "node:test";
import worker from "../scripts/worker-spx-bot";
import { authorizeSpxWorkerRequest } from "../src/lib/spx-worker-auth";

test("SPX Worker accepts only a configured independent bearer, with no query/chat ID fallback", async () => {
  const secret = "independent-test-secret";
  const req = (suffix = "", bearer?: string) => new Request(`https://spx.example.test/${suffix}`, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
  assert.equal(await authorizeSpxWorkerRequest(req("", secret), secret), null);
  for (const request of [req(), req("?token=" + secret), req("", "public-chat-id"), req("", "wrong"), req("?token=old-secret", secret)]) {
    assert.equal((await authorizeSpxWorkerRequest(request, secret))?.status, 401);
  }
  for (const absent of [undefined, "", " "]) assert.equal((await authorizeSpxWorkerRequest(req("", secret), absent))?.status, 503);
});

test("unauthorized Worker requests stop before any data/model/Telegram side effect", async () => {
  let effects = 0;
  const env = new Proxy({ WEBHOOK_SECRET: "independent-test-secret", TELEGRAM_CHAT_ID: "public-chat-id" }, {
    get(target, key) { if (key in target) return target[key as keyof typeof target]; effects++; throw new Error("Protected effect accessed before authorization"); },
  });
  for (const suffix of ["?token=independent-test-secret&probe_llm", "?token=public-chat-id&deliver", "?audit", "?retry_run_id=run-123"]) {
    const response = await worker.fetch(new Request(`https://spx.example.test/${suffix}`), env as any, { waitUntil() { effects++; } });
    assert.equal(response.status, 401);
  }
  assert.equal(effects, 0);
  const accepted = await worker.fetch(new Request("https://spx.example.test/?run_id=test-run", { headers: { Authorization: "Bearer independent-test-secret" } }), { WEBHOOK_SECRET: "independent-test-secret" } as any, {});
  assert.equal(accepted.status, 503);
  assert.match(await accepted.text(), /SPX_RECAP_DB unavailable/);
});

test("manual Telegram retry requires POST and explicit duplicate acknowledgement", async () => {
  const headers = { Authorization: "Bearer independent-test-secret", "Content-Type": "application/json" };
  const env = { WEBHOOK_SECRET: "independent-test-secret" } as any;
  const url = "https://spx.example.test/?retry_run_id=test-run";
  assert.equal((await worker.fetch(new Request(url, { headers }), env, {})).status, 405);
  for (const body of [{}, { acknowledgeDuplicate: false }]) assert.equal((await worker.fetch(new Request(url, { method: "POST", headers, body: JSON.stringify(body) }), env, {})).status, 400);
});
