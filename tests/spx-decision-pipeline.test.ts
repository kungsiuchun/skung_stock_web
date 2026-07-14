import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  InMemorySpxDecisionStore,
  applyRiskGate,
  dispatchSpxDecisionDelivery,
  findMissingScheduledRuns,
  getCanonicalGexRiskDirective,
  resolveSpxDeliveryMode,
  retrySpxDelivery,
  runSpxDecisionPipeline,
  type CouncilResult,
  type MarketSnapshot,
  type SpxDecisionPipelineDependencies,
} from "../src/lib/spx-decision-pipeline";
import { buildSpxDecisionCockpitProjection } from "../src/lib/spx-decision-ledger";

const replayFixture = JSON.parse(readFileSync(
  new URL("./fixtures/spx-2026-07-13-1445-et.json", import.meta.url),
  "utf8",
));

const scheduledAt = new Date(replayFixture.scheduledAt);

const snapshot: MarketSnapshot = {
  runId: replayFixture.runId,
  scheduledAt: scheduledAt.toISOString(),
  snapshotAt: replayFixture.snapshot.snapshotAt,
  facts: replayFixture.snapshot.facts,
  sourceFreshness: replayFixture.snapshot.sourceFreshness,
  dataQuality: replayFixture.snapshot.dataQuality,
  boardDeepLink: "https://sius-ai-workshop.pages.dev/#/work/spx-gex-heatmap?date=2026-07-13&snapshot=870",
  replayGrade: "PARTIAL_NORMALIZED",
  replayEvidence: null,
  rawSnapshotAvailable: replayFixture.rawSnapshotAvailable,
};

const allHoldCouncil: CouncilResult = {
  status: "OK",
  latencyMs: 120,
  agents: replayFixture.council.map((agent: any) => ({
    ...agent,
    evidenceRefs: ["spx.last", "spx.vwap"],
    fallbackStatus: null,
    latencyMs: 30,
  })),
};

function buildDependencies(overrides: Partial<SpxDecisionPipelineDependencies> = {}) {
  const store = overrides.store || new InMemorySpxDecisionStore();
  const sent: string[] = [];
  const dependencies: SpxDecisionPipelineDependencies = {
    clock: {
      now: () => new Date("2026-07-13T18:45:40.000Z"),
    },
    marketData: {
      load: async (runId, runScheduledAt) => ({
        ...snapshot,
        runId,
        scheduledAt: runScheduledAt.toISOString(),
      }),
    },
    council: {
      analyze: async () => allHoldCouncil,
    },
    cio: {
      decide: async () => ({
        action: "HOLD",
        confidence: 65,
        thesis: "Four independent council analyses found no entry edge.",
        entry: null,
        invalidation: null,
        targets: [],
        noTradeConditions: ["Council tally remains four HOLD votes"],
        evidenceRefs: ["spx.last", "spx.vwap", "spx.ema9"],
        modelStatus: "AI",
        latencyMs: 80,
      }),
    },
    riskGate: {
      evaluate: async () => ({ disposition: "PASS", reason: "No safety veto." }),
    },
    store,
    telegram: {
      send: async (message) => {
        sent.push(message);
        return { messageId: "tg-1445" };
      },
    },
    ...overrides,
  };
  return { dependencies, store, sent };
}

test("2026-07-13 14:45 ET replay: four HOLD votes cannot become a directional trade", async () => {
  const { dependencies, store } = buildDependencies();

  const result = await runSpxDecisionPipeline({
    runId: replayFixture.runId,
    scheduledAt,
    currentPosition: "NONE",
  }, dependencies);

  assert.equal(result.finalDecision.action, "HOLD");
  assert.equal(result.run.degraded, false);
  assert.equal(store.getRun(replayFixture.runId)?.finalAction, "HOLD");
  assert.equal(replayFixture.rawSnapshotAvailable, false);
  assert.deepEqual(
    store.getLifecycle(replayFixture.runId).map((event) => event.stage),
    [
      "SCHEDULED",
      "LOCK_ACQUIRED",
      "SNAPSHOT_READY",
      "COUNCIL_COMPLETED",
      "CIO_DECIDED",
      "RISK_GATED",
      "PERSISTED",
      "DELIVERY_ATTEMPTED",
      "DELIVERED",
    ],
  );
});

test("degraded HOLD Telegram is concise, human-readable, and never leaks internal fallback codes", async () => {
  const { dependencies, sent } = buildDependencies({
    council: {
      analyze: async () => {
        throw new Error("council_qm_council_disabled");
      },
    },
  });

  await runSpxDecisionPipeline({
    runId: "degraded-message-contract",
    scheduledAt,
    currentPosition: "NONE",
  }, dependencies);

  const message = sent[0] || "";
  assert.match(message, /^⚠️ SPX｜降級觀望/m);
  assert.match(message, /議會｜Call 0 · Put 0 · 觀望 4/);
  assert.match(message, /CIO｜HOLD · 0% · 未完成/);
  assert.match(message, /計劃｜不開倉/);
  assert.match(message, /🛰️ GEX｜Canonical snapshot 缺失；本輪不引用 GEX。/);
  assert.doesNotMatch(message, /council_qm_council_disabled|Evidence none|Entry N\/A|Invalidation N\/A|Targets N\/A/);
});

test("Telegram restores the compact GEX section from the canonical Board summary", async () => {
  const gexSnapshot: MarketSnapshot = {
    ...snapshot,
    replayGrade: "NORMALIZED_CANONICAL",
    sourceFreshness: {
      ...snapshot.sourceFreshness,
      canonicalGex: {
        source: "Canonical SPX GEX Board snapshot (cboe)",
        observedAt: "2026-07-13T18:45:00.000Z",
        ageMs: 0,
        status: "OK",
      },
    },
    gexSummary: {
      spot: 7523.96,
      gammaFlipLevel: 7527.76,
      gammaStatus: "negative_gamma",
      mostLongStrike: 7575,
      mostLongGex: "+2.03B",
      mostShortStrike: 7495,
      mostShortGex: "-3.29B",
      longWalls: [
        { strike: 7575, gex: "+2.03B" },
        { strike: 7600, gex: "+1.99B" },
        { strike: 7650, gex: "+1.57B" },
      ],
      shortPockets: [
        { strike: 7495, gex: "-3.29B" },
        { strike: 7480, gex: "-1.86B" },
        { strike: 7525, gex: "-1.77B" },
      ],
      generatedAt: "2026-07-13T18:45:00.000Z",
      displayTimeLabel: "14:30 ET snapshot / collected 14:45 ET",
      snapshotTimeEt: "14:30",
      collectedTimeEt: "14:45",
      source: "Canonical D1 SPX GEX heatmap (black_scholes_exposure_engine)",
    },
  };
  const { dependencies, sent } = buildDependencies({
    marketData: {
      load: async (runId, runScheduledAt) => ({
        ...gexSnapshot,
        runId,
        scheduledAt: runScheduledAt.toISOString(),
      }),
    },
  });

  await runSpxDecisionPipeline({
    runId: "canonical-gex-message-contract",
    scheduledAt,
    currentPosition: "NONE",
  }, dependencies);

  const message = sent[0] || "";
  assert.match(message, /🛰️ GEX｜14:30 ET snapshot · 14:45 ET collected/);
  assert.match(message, /來源｜Canonical D1 · black_scholes_exposure_engine/);
  assert.match(message, /態勢｜⚠️ Negative Gamma · 波動放大/);
  assert.match(message, /Gamma Flip｜7,527\.76 · 現價在下方，偏空/);
  assert.match(message, /關鍵｜🟢 SG High 7,575 \(\+2\.03B\) · 🔴 SG Low 7,495 \(-3\.29B\)/);
  assert.match(message, /Long Walls｜7,575 \(\+2\.03B\) › 7,600 \(\+1\.99B\) › 7,650 \(\+1\.57B\)/);
  assert.match(message, /Short Pockets｜7,495 \(-3\.29B\) › 7,480 \(-1\.86B\) › 7,525 \(-1\.77B\)/);
});

test("directional Telegram keeps data-backed evidence and executable levels", async () => {
  const directionalCouncil: CouncilResult = {
    ...allHoldCouncil,
    agents: allHoldCouncil.agents.map((agent, index) => ({
      ...agent,
      decision: index < 3 ? "OPEN_CALL" : "HOLD",
    })),
  };
  const { dependencies, sent } = buildDependencies({
    council: { analyze: async () => directionalCouncil },
    cio: {
      decide: async () => ({
        action: "OPEN_CALL",
        confidence: 78,
        thesis: "SPX remains above the decision level with council confirmation.",
        entry: "7524–7528",
        invalidation: "15m close below 7518",
        targets: ["7540", "7552"],
        noTradeConditions: ["VWAP rejection persists"],
        evidenceRefs: ["spx.last", "spx.vwap"],
        modelStatus: "AI",
        latencyMs: 40,
      }),
    },
  });

  await runSpxDecisionPipeline({
    runId: "directional-message-contract",
    scheduledAt,
    currentPosition: "NONE",
  }, dependencies);

  const message = sent[0] || "";
  assert.match(message, /^🟢 SPX｜CALL 機會/m);
  assert.match(message, /議會｜Call 3 · Put 0 · 觀望 1/);
  assert.match(message, /CIO｜OPEN_CALL · 78% · 完成/);
  assert.match(message, /依據｜SPX 7,523\.96 · VWAP 7,540\.03/);
  assert.match(message, /進場｜7524–7528/);
  assert.match(message, /失效｜15m close below 7518/);
  assert.match(message, /目標｜7540 · 7552/);
  assert.match(message, /不交易｜VWAP rejection persists/);
  assert.doesNotMatch(message, /N\/A|Evidence none/);
});

test("manual preview never enqueues or sends Telegram without explicit delivery", async () => {
  const store = new InMemorySpxDecisionStore();
  let sendCalls = 0;
  const dependencies = {
    clock: { now: () => new Date("2026-07-13T18:45:40.000Z") },
    store,
    telegram: {
      send: async () => {
        sendCalls += 1;
        return { messageId: "must-not-send" };
      },
    },
  };

  assert.equal(resolveSpxDeliveryMode({ trigger: "MANUAL" }), "PREVIEW");
  assert.equal(resolveSpxDeliveryMode({ trigger: "MANUAL", explicitDelivery: true }), "SEND");
  assert.equal(resolveSpxDeliveryMode({ trigger: "SCHEDULED" }), "SEND");
  assert.equal(resolveSpxDeliveryMode({ trigger: "SCHEDULED", debugPreview: true }), "PREVIEW");

  const delivery = await dispatchSpxDecisionDelivery({
    runId: "manual-preview",
    message: "preview only",
    mode: "PREVIEW",
  }, dependencies);

  assert.equal(delivery, null);
  assert.equal(sendCalls, 0);
  assert.equal(store.getOutbox("manual-preview"), null);
});

test("each lifecycle event exposes a run record with that stage payload already persisted", async () => {
  const observed = new Map<string, ReturnType<InMemorySpxDecisionStore["getRun"]>>();
  class AuditStore extends InMemorySpxDecisionStore {
    override appendLifecycle(event: Parameters<InMemorySpxDecisionStore["appendLifecycle"]>[0]) {
      observed.set(event.stage, this.getRun(event.runId));
      return super.appendLifecycle(event);
    }
  }
  const store = new AuditStore();
  const { dependencies } = buildDependencies({ store });

  await runSpxDecisionPipeline({
    runId: "stage-payload-audit",
    scheduledAt,
    currentPosition: "NONE",
  }, dependencies);

  assert.equal(observed.get("SNAPSHOT_READY")?.snapshot?.snapshotAt, snapshot.snapshotAt);
  assert.equal(observed.get("COUNCIL_COMPLETED")?.council?.agents.length, 4);
  assert.equal(observed.get("CIO_DECIDED")?.cioDecision?.action, "HOLD");
  assert.equal(observed.get("RISK_GATED")?.riskGate?.action, "HOLD");
});

test("2026-07-13 14:45 ET replay pins the retained normalized Board evidence without claiming raw vendor replay", () => {
  const evidence = replayFixture.boardSnapshotEvidence;
  assert.equal(evidence.representedTimeEt, "14:30");
  assert.equal(evidence.collectedTimeEt, "14:45");
  assert.equal(evidence.cellCount, 480);
  assert.equal(evidence.expiryCount, 5);
  assert.equal(evidence.snapshotBytes, 551140);
  assert.equal(evidence.replayGrade, "NORMALIZED_CANONICAL");
  assert.equal(evidence.payloadHash, "fnv1a64:005c35ebfd5c5a90");
  assert.equal(replayFixture.rawSnapshotAvailable, false);
  assert.match(replayFixture.replayLimit, /not the complete Yahoo\/CBOE raw market snapshot/i);
});

test("Risk Gate can pass, veto to HOLD, or require CLOSE, but cannot create/reverse direction", () => {
  const openCall = {
    action: "OPEN_CALL" as const,
    confidence: 80,
    thesis: "Upside setup",
    entry: "above 7530",
    invalidation: "below 7510",
    targets: ["7550"],
    noTradeConditions: [],
    evidenceRefs: ["spx.last"],
    modelStatus: "AI" as const,
    latencyMs: 20,
  };

  assert.equal(applyRiskGate(openCall, { disposition: "PASS", reason: "clear" }, "NONE").action, "OPEN_CALL");
  assert.equal(applyRiskGate(openCall, { disposition: "VETO_TO_HOLD", reason: "stale data" }, "NONE").action, "HOLD");
  assert.equal(applyRiskGate(openCall, { disposition: "REQUIRE_CLOSE", reason: "position timeout" }, "PUT").action, "CLOSE");
  assert.throws(
    () => applyRiskGate(openCall, { disposition: "OPEN_PUT" as any, reason: "reverse" }, "NONE"),
    /Risk Gate cannot create directional action/,
  );
});

test("directional CIO evidence that cites stale canonical GEX is vetoed to DEGRADED HOLD", async () => {
  const staleGexSnapshot: MarketSnapshot = {
    ...snapshot,
    runId: "stale-gex-direction",
    facts: { ...snapshot.facts, "gex.gammaFlip": 7510 },
    sourceFreshness: {
      ...snapshot.sourceFreshness,
      cboeD1: {
        source: "Canonical SPX GEX Board snapshot",
        observedAt: "2026-07-13T18:00:00.000Z",
        ageMs: 45 * 60_000,
        status: "STALE",
      },
    },
    replayGrade: "NORMALIZED_CANONICAL",
    replayEvidence: {
      replayGrade: "NORMALIZED_CANONICAL",
      vendorRawPayloadsPersisted: false,
      gex: {
        snapshotId: "spx-gex:2026-07-13:870:fnv1a64:test",
        payloadHash: "fnv1a64:test",
        schemaVersion: 1,
        provider: "cboe",
        fallbackFrom: null,
        sourceTimestamp: "2026-07-13T18:00:00.000Z",
        facts: { "gex.gammaFlip": 7510 },
        dataQuality: { total: 480, priced: 428, repaired: 4, partial: 48, unpriced: 0, excluded: 0 },
      },
      normalizedSeries: {
        spx15m: [{ date: "2026-07-13T18:45:00.000Z", close: 7523.96 }],
        spx5m: [{ date: "2026-07-13T18:45:00.000Z", close: 7523.96 }],
        spxD1: [],
        spxH1: [],
        vix15m: [{ date: "2026-07-13T18:45:00.000Z", close: 16.2 }],
        vix9d: [{ date: "2026-07-13T00:00:00.000Z", close: 15.9 }],
      },
    },
  };
  const { dependencies, store } = buildDependencies({
    marketData: { load: async () => staleGexSnapshot },
    cio: {
      decide: async () => ({
        action: "OPEN_CALL",
        confidence: 82,
        thesis: "Reclaim above gamma flip.",
        entry: "above 7525",
        invalidation: "below 7510",
        targets: ["7550"],
        noTradeConditions: ["Lose gamma flip"],
        evidenceRefs: ["gex.gammaFlip"],
        modelStatus: "AI",
        latencyMs: 20,
      }),
    },
  });

  const result = await runSpxDecisionPipeline({
    runId: "stale-gex-direction",
    scheduledAt,
    currentPosition: "NONE",
  }, dependencies);

  assert.equal(result.finalDecision.action, "HOLD");
  assert.equal(result.run.riskGate?.disposition, "VETO_TO_HOLD");
  assert.equal(result.run.degraded, true);
  assert.match(result.run.degradedReason || "", /canonical_gex_stale/);
  assert.equal(store.getRun("stale-gex-direction")?.snapshot?.replayGrade, "NORMALIZED_CANONICAL");
  assert.equal(store.getRun("stale-gex-direction")?.snapshot?.replayEvidence?.gex?.payloadHash, "fnv1a64:test");
});

test("canonical GEX gate exposes missing/schema mismatch and permits a fresh fallback provider", () => {
  const directional = {
    action: "OPEN_PUT" as const,
    confidence: 70,
    thesis: "Break below gamma flip.",
    entry: "below 7500",
    invalidation: "above 7520",
    targets: ["7480"],
    noTradeConditions: [],
    evidenceRefs: ["gex.gammaFlip"],
    modelStatus: "AI",
    latencyMs: 10,
  };
  const freshFallback: MarketSnapshot = {
    ...snapshot,
    facts: { ...snapshot.facts, "gex.gammaFlip": 7510 },
    sourceFreshness: {
      ...snapshot.sourceFreshness,
      canonicalGex: {
        source: "Yahoo fallback",
        observedAt: snapshot.snapshotAt,
        ageMs: 0,
        status: "FALLBACK",
      },
    },
    replayGrade: "NORMALIZED_CANONICAL",
    replayEvidence: {
      replayGrade: "NORMALIZED_CANONICAL",
      vendorRawPayloadsPersisted: false,
      gex: {
        snapshotId: "fallback-snapshot",
        payloadHash: "fallback-hash",
        schemaVersion: 1,
        provider: "yahoo",
        fallbackFrom: "Cboe delayed",
        sourceTimestamp: snapshot.snapshotAt,
        facts: { "gex.gammaFlip": 7510 },
        dataQuality: null,
      },
      normalizedSeries: { spx15m: [], spx5m: [], spxD1: [], spxH1: [], vix15m: [], vix9d: [] },
    },
  };

  assert.equal(getCanonicalGexRiskDirective({ ...freshFallback, replayEvidence: null }, directional)?.reason, "canonical_gex_missing");
  assert.match(
    getCanonicalGexRiskDirective({
      ...freshFallback,
      replayEvidence: {
        ...freshFallback.replayEvidence!,
        gex: { ...freshFallback.replayEvidence!.gex!, schemaVersion: 2 },
      },
    }, directional)?.reason || "",
    /schema_mismatch/,
  );
  assert.equal(getCanonicalGexRiskDirective(freshFallback, directional), null);
});

test("CIO timeout fails closed to DEGRADED HOLD", async () => {
  const { dependencies } = buildDependencies({
    cio: {
      decide: async () => {
        throw new Error("CIO timed out after 8000ms");
      },
    },
  });

  const result = await runSpxDecisionPipeline({
    runId: "cio-timeout",
    scheduledAt,
    currentPosition: "NONE",
  }, dependencies);

  assert.equal(result.finalDecision.action, "HOLD");
  assert.equal(result.run.degraded, true);
  assert.match(result.run.degradedReason || "", /cio_timeout/i);
});

test("Council timeout and required market-data failure both fail closed", async () => {
  const councilTimeout = buildDependencies({
    council: {
      analyze: async () => {
        throw new Error("Council timed out after 8000ms");
      },
    },
  });
  const councilResult = await runSpxDecisionPipeline({
    runId: "council-timeout",
    scheduledAt,
    currentPosition: "NONE",
  }, councilTimeout.dependencies);
  assert.equal(councilResult.finalDecision.action, "HOLD");
  assert.match(councilResult.run.degradedReason || "", /council_timeout/i);

  const marketFailure = buildDependencies({
    marketData: {
      load: async () => {
        throw new Error("Yahoo core chart unavailable");
      },
    },
  });
  const marketResult = await runSpxDecisionPipeline({
    runId: "market-data-failure",
    scheduledAt,
    currentPosition: "NONE",
  }, marketFailure.dependencies);
  assert.equal(marketResult.finalDecision.action, "HOLD");
  assert.equal(marketResult.run.snapshot?.dataQuality.status, "BLOCK");
  assert.equal(marketResult.run.degraded, true);
});

test("invalid directional CIO evidence schema degrades to HOLD", async () => {
  const { dependencies } = buildDependencies({
    cio: {
      decide: async () => ({
        action: "OPEN_PUT",
        confidence: 90,
        thesis: "Direction not traceable to the canonical snapshot.",
        entry: "below 7520",
        invalidation: "above 7540",
        targets: ["7500"],
        noTradeConditions: [],
        evidenceRefs: ["invented.signal"],
        modelStatus: "AI",
        latencyMs: 10,
      }),
    },
  });
  const result = await runSpxDecisionPipeline({
    runId: "cio-invalid-evidence",
    scheduledAt,
    currentPosition: "NONE",
  }, dependencies);
  assert.equal(result.finalDecision.action, "HOLD");
  assert.match(result.run.degradedReason || "", /evidence_not_in_snapshot/i);
});

test("KV lock and D1 store are injectable run boundaries", async () => {
  const { dependencies, store, sent } = buildDependencies({
    lock: { acquire: async () => false },
  });
  const result = await runSpxDecisionPipeline({
    runId: "lock-denied",
    scheduledAt,
    currentPosition: "NONE",
  }, dependencies);

  assert.equal(result.finalDecision.action, "HOLD");
  assert.equal(store.getRun("lock-denied")?.degradedReason, "lock_not_acquired");
  assert.deepEqual(store.getLifecycle("lock-denied").map((event) => event.stage), ["SCHEDULED"]);
  assert.equal(sent.length, 0);
});

test("Telegram failure is queryable and retry is idempotent", async () => {
  const store = new InMemorySpxDecisionStore();
  let attempts = 0;
  const { dependencies } = buildDependencies({
    store,
    telegram: {
      send: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("telegram 502");
        return { messageId: "tg-retry-1" };
      },
    },
  });

  const result = await runSpxDecisionPipeline({
    runId: "delivery-retry",
    scheduledAt,
    currentPosition: "NONE",
  }, dependencies);

  assert.equal(result.delivery.status, "FAILED");
  assert.equal(store.getOutbox("delivery-retry")?.lastError, "telegram 502");
  assert.equal(store.getLifecycle("delivery-retry").at(-1)?.stage, "DELIVERY_FAILED");

  const retried = await retrySpxDelivery("delivery-retry", dependencies);
  assert.equal(retried.status, "DELIVERED");
  assert.equal(store.getOutbox("delivery-retry")?.telegramMessageId, "tg-retry-1");
  assert.equal(attempts, 2);

  await retrySpxDelivery("delivery-retry", dependencies);
  assert.equal(attempts, 2, "delivered outbox must not send twice");
});

test("lifecycle query identifies a missed cron slot", async () => {
  const { dependencies, store } = buildDependencies();
  await runSpxDecisionPipeline({ runId: "slot-1430", scheduledAt, currentPosition: "NONE" }, dependencies);

  assert.deepEqual(
    findMissingScheduledRuns(["slot-1430", "slot-1445"], store),
    ["slot-1445"],
  );
});

test("same run_id never sends Telegram twice", async () => {
  const { dependencies, sent } = buildDependencies();
  const input = { runId: "same-run-id", scheduledAt, currentPosition: "NONE" as const };

  await runSpxDecisionPipeline(input, dependencies);
  await runSpxDecisionPipeline(input, dependencies);

  assert.equal(sent.length, 1);
});

test("Board cockpit and Telegram projection expose the same run, CIO action, and risk result", async () => {
  const { dependencies, store, sent } = buildDependencies();
  await runSpxDecisionPipeline({ runId: "board-telegram-same-run", scheduledAt, currentPosition: "NONE" }, dependencies);
  const run = store.getRun("board-telegram-same-run");
  const outbox = store.getOutbox("board-telegram-same-run");
  assert.ok(run);
  assert.ok(outbox);

  const cockpit = buildSpxDecisionCockpitProjection(run, outbox, store.getLifecycle(run.runId));

  assert.equal(cockpit.runId, "board-telegram-same-run");
  assert.equal(cockpit.cio.action, "HOLD");
  assert.equal(cockpit.finalAction, "HOLD");
  assert.equal(cockpit.riskGate.disposition, "PASS");
  assert.deepEqual(cockpit.councilTally, { OPEN_CALL: 0, OPEN_PUT: 0, HOLD: 4 });
  assert.match(sent[0] || "", /Run｜board-telegram-same-run/);
  assert.match(sent[0] || "", /CIO｜HOLD/);
  assert.match(sent[0] || "", /風控｜PASS/);
});
