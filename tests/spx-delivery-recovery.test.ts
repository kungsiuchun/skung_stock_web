import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { D1SpxDecisionStore } from "../src/lib/spx-decision-ledger";
import {
  InMemorySpxDecisionStore, dispatchSpxDecisionDelivery, retrySpxDelivery,
  type DecisionRunRecord, type SpxDecisionStore, type SpxDeliveryDependencies,
} from "../src/lib/spx-decision-pipeline";
import type { D1DatabaseLike } from "../src/lib/spx-recap-d1";

const scheduledAt = "2026-11-12T15:00:00.000Z";
const run = (runId = "original", at = scheduledAt): DecisionRunRecord => ({
  runId, scheduledAt: at, currentStage: "PERSISTED", snapshot: null, council: null,
  cioDecision: null, riskGate: null, finalDecision: null, finalAction: "HOLD", degraded: false,
  degradedReason: null, createdAt: at, updatedAt: at,
});

function sqliteStore() {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys = ON");
  sql.exec(readFileSync(new URL("../migrations/0007_spx_decision_pipeline.sql", import.meta.url), "utf8"));
  const db: D1DatabaseLike = { prepare(query) {
    const statement = sql.prepare(query); let values: any[] = [];
    const prepared = {
      bind(...params: unknown[]) { values = params; return prepared; },
      async first<T>() { return (statement.get(...values) || null) as T | null; },
      async all<T>() { return { results: statement.all(...values) as T[] }; },
      async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
    }; return prepared;
  } };
  return { sql, store: new D1SpxDecisionStore(db) };
}

const migration = () => readFileSync(new URL("../migrations/0017_spx_delivery_recovery.sql", import.meta.url), "utf8");

test("outbox migration preserves existing delivered evidence and health view", async () => {
  const { sql, store } = sqliteStore();
  try {
    await store.beginRun(run());
    await store.enqueueOutbox({ runId: "original", message: "original card", status: "DELIVERED", attemptCount: 2,
      telegramMessageId: "message-7", lastError: null, nextAttemptAt: null, createdAt: scheduledAt, updatedAt: scheduledAt });
    sql.exec(migration());
    assert.equal((await store.getOutbox("original"))?.telegramMessageId, "message-7");
    assert.equal((sql.prepare("SELECT delivery_status FROM spx_decision_run_health").get() as any).delivery_status, "DELIVERED");
    assert.deepEqual(sql.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { sql.close(); }
});

for (const kind of ["memory", "sqlite"] as const) {
  test(`${kind}: uncertain send requires delayed acknowledged manual retry and preserves original identity`, async () => {
    const fixture = kind === "sqlite" ? sqliteStore() : null;
    fixture?.sql.exec(migration());
    const store: SpxDecisionStore = fixture?.store || new InMemorySpxDecisionStore();
    let now = Date.parse(scheduledAt) + 1_000; const sent: string[] = [];
    await store.beginRun(run());
    const deps: SpxDeliveryDependencies = { clock: { now: () => new Date(now) }, store, telegram: { send: async message => {
      sent.push(message); if (sent.length === 1) throw new Error("Network response lost"); return { messageId: "recovered" };
    } } };
    try {
      assert.equal((await dispatchSpxDecisionDelivery({ runId: "original", message: "original card", mode: "SEND" }, deps))?.status, "UNKNOWN");
      assert.equal((await retrySpxDelivery("original", deps)).status, "UNKNOWN");
      assert.equal((await retrySpxDelivery("original", deps, { manual: true, acknowledgeDuplicate: true })).status, "UNKNOWN");
      assert.equal(sent.length, 1, "no retry while the sender could still be active");
      now += 61_000;
      assert.equal((await retrySpxDelivery("original", deps)).status, "UNKNOWN");
      await assert.rejects(retrySpxDelivery("original", deps, { manual: true }), /acknowledgement/);
      const recovered = await retrySpxDelivery("original", deps, { manual: true, acknowledgeDuplicate: true });
      assert.equal(recovered.status, "DELIVERED");
      assert.equal(recovered.runId, "original");
      assert.match(sent[1], /重送／可能重複/); assert.match(sent[1], /2026-11-12T15:00:00/);
      await retrySpxDelivery("original", deps, { manual: true, acknowledgeDuplicate: true });
      assert.equal(sent.length, 2);
    } finally { fixture?.sql.close(); }
  });
}

test("expired or superseded decisions are never resent, even with manual acknowledgement", async () => {
  for (const superseded of [false, true]) {
    const store = new InMemorySpxDecisionStore(); await store.beginRun(run());
    let now = Date.parse(scheduledAt) + 1_000; let sends = 0;
    const deps: SpxDeliveryDependencies = { clock: { now: () => new Date(now) }, store, telegram: { send: async () => { sends++; throw new Error("Lost receipt"); } } };
    await dispatchSpxDecisionDelivery({ runId: "original", message: "card", mode: "SEND" }, deps);
    if (superseded) { now += 120_000; store.beginRun(run("newer", new Date(now).toISOString())); }
    else now += 15 * 60_000;
    assert.equal((await retrySpxDelivery("original", deps, { manual: true, acknowledgeDuplicate: true })).status, "EXPIRED");
    assert.equal(sends, 1);
  }
});

test("a timed out transport aborts and becomes UNKNOWN with no automatic retry", async () => {
  const store = new InMemorySpxDecisionStore(); store.beginRun(run()); let signal: AbortSignal | undefined;
  const deps: SpxDeliveryDependencies = { clock: { now: () => new Date(scheduledAt) }, store, deliverySendTimeoutMs: 5,
    telegram: { send: async (_message, currentSignal) => { signal = currentSignal; return new Promise(() => {}); } } };
  assert.equal((await dispatchSpxDecisionDelivery({ runId: "original", message: "card", mode: "SEND" }, deps))?.status, "UNKNOWN");
  assert.equal(signal?.aborted, true);
  assert.equal((await retrySpxDelivery("original", deps)).attemptCount, 1);
});

test("SQLite recovery and attempt fencing prevent a late sender from overwriting a newer retry", async () => {
  const { sql, store } = sqliteStore(); sql.exec(migration());
  try {
    await store.beginRun(run());
    await store.enqueueOutbox({ runId: "original", message: "card", status: "SENDING", attemptCount: 1,
      telegramMessageId: null, lastError: null, nextAttemptAt: null, createdAt: scheduledAt, updatedAt: scheduledAt });
    await store.recoverExpiredSending("2026-11-12T15:01:01.000Z");
    assert.equal((await store.getOutbox("original"))?.status, "UNKNOWN");
    assert.equal((await store.listRetryableOutbox("2026-11-12T15:01:01.000Z")).length, 0);
    await store.markDeliveryAttempt("original", "2026-11-12T15:02:02.000Z", 1, true);
    await store.markDelivered("original", "new-attempt", "2026-11-12T15:02:03.000Z", 2);
    await store.markDelivered("original", "late-old-attempt", "2026-11-12T15:02:04.000Z", 1);
    await store.markDeliveryUnknown("original", "late old failure", "2026-11-12T15:02:05.000Z", 1);
    assert.equal((await store.getOutbox("original"))?.telegramMessageId, "new-attempt");
    assert.equal((await store.getOutbox("original"))?.status, "DELIVERED");
  } finally { sql.close(); }
});
