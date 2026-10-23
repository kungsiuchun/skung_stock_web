import assert from "node:assert/strict";
import test from "node:test";
import { getSpxDisplayExpiryDelay, projectSpxDisplaySource } from "../src/lib/spx-display-freshness";
import { resolveSpxGexExpectedMoveOverlay, resolveSpxGexZeroDteSpotContext } from "../src/lib/spx-gex-pressure-matrix";

const live = (sampleAt: string) => ({
  provider: "0dtespx", sessionState: "LIVE" as const, status: "READY" as const,
  sessionDate: sampleAt.slice(0, 10), latestSampleAt: sampleAt,
  expectedMove: { status: "READY" as const, sampleAt, value: 25, errorCode: null },
});

test("loaded 15:59 and early-close 12:59 sources age locally after network polling stops", () => {
  for (const sample of ["2026-10-22T19:59:00Z", "2026-11-27T17:59:00Z"]) {
    const source = live(sample);
    const at = Date.parse(sample);
    assert.equal(projectSpxDisplaySource(source, at + 60_000).status, "READY");
    assert.equal(getSpxDisplayExpiryDelay(source, at + 60_000), 540_001);
    assert.equal(projectSpxDisplaySource(source, at + 600_000).status, "READY");
    const stale = projectSpxDisplaySource(source, at + 600_001);
    assert.equal(stale.status, "STALE");
    assert.equal(stale.expectedMove.status, "STALE");
    assert.equal(source.status, "READY", "Display projection must not rewrite provider evidence");
    const spot = { price: 6000, timeEt: "15:59", minuteEt: 959, time: at };
    assert.equal(resolveSpxGexZeroDteSpotContext(stale, source.sessionDate, spot), null, "Overview cannot keep a LIVE spot after freshness expiry");
    const em = resolveSpxGexExpectedMoveOverlay({ source: stale, selectedDate: source.sessionDate, currentTradingDate: source.sessionDate, nowMs: at + 600_001 });
    assert.equal(em.expectedMove, 25, "Expired EM remains explicit stale context");
    assert.match(em.warning!, /stale/);
    assert.equal(getSpxDisplayExpiryDelay(stale, at + 600_001), null);
  }
});

test("completed and historical source contracts do not become live or expire from wall-clock age", () => {
  const closed = { ...live("2026-10-22T20:00:00Z"), sessionState: "CLOSED" as const };
  const later = Date.parse("2026-10-23T15:00:00Z");
  assert.equal(projectSpxDisplaySource(closed, later).status, "READY");
  assert.equal(getSpxDisplayExpiryDelay(closed, later), null);
  const historical = { ...closed, provider: "yahoo" };
  assert.equal(projectSpxDisplaySource(historical, later), historical);
  assert.equal(getSpxDisplayExpiryDelay(historical, later), null);
});

test("freshness rejects missing, malformed, old and excessive future samples without extending the ceiling", () => {
  const now = Date.parse("2026-10-22T19:59:00Z");
  for (const latestSampleAt of [null, undefined, "bad", new Date(now - 600_001).toISOString(), new Date(now + 5001).toISOString()]) {
    assert.equal(projectSpxDisplaySource({ ...live(new Date(now).toISOString()), latestSampleAt }, now).status, "STALE");
  }
  assert.equal(projectSpxDisplaySource(live(new Date(now + 5000).toISOString()), now).status, "READY");
  const source = live(new Date(now).toISOString());
  for (const sampleAt of [null, "bad", new Date(now - 600_001).toISOString()]) {
    const projected = projectSpxDisplaySource({ ...source, expectedMove: { ...source.expectedMove, sampleAt } }, now);
    assert.equal(projected.status, "READY");
    assert.equal(projected.expectedMove.status, "STALE");
  }
});
