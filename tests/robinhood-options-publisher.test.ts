import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { claimRobinhoodRunSql, failedRobinhoodRunSql, finalizeRobinhoodRunSql, type InputRelease } from "../scripts/publish-robinhood-options-snapshot";

const capturedAt = new Date().toISOString();
const release = { runId: "run-original", scheduledForEt: capturedAt, startedAt: capturedAt, capturedAt, symbols: [] } satisfies InputRelease;
const identity = { input: release, releaseId: "release-original", manifestKey: "releases/release-original/manifest.json", manifestHash: "a".repeat(64), now: capturedAt };
const database = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0013_robinhood_options_snapshot_status.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0014_robinhood_options_snapshot_variable_cardinality.sql", import.meta.url), "utf8"));
  return db;
};

test("atomic publication claims cannot reclaim running, failed, or another run's release", () => {
  const db = database();
  try {
    assert.equal(db.prepare(claimRobinhoodRunSql(identity)).all().length, 1);
    assert.equal(db.prepare(claimRobinhoodRunSql(identity)).all().length, 0, "concurrent same-run attempt cannot own the claim");
    assert.equal(db.prepare(claimRobinhoodRunSql({ ...identity, input: { ...release, runId: "other" } })).all().length, 0, "release ID cannot be reused by another run");
    db.exec(failedRobinhoodRunSql(release, "interrupted", capturedAt, { runId: release.runId, manifestHash: identity.manifestHash }));
    assert.equal(db.prepare(claimRobinhoodRunSql(identity)).all().length, 0, "failed/crashed attempts require a new run ID");
    assert.equal(db.prepare(claimRobinhoodRunSql({ ...identity, input: { ...release, runId: "new" }, releaseId: "new-release" })).all().length, 1);
  } finally { db.close(); }
});

test("published rows and current pointers survive retry failure diagnostics unchanged", () => {
  const db = database();
  try {
    db.exec(claimRobinhoodRunSql(identity));
    assert.equal(db.prepare(finalizeRobinhoodRunSql(release.runId, "wrong-hash", 50, capturedAt)).all().length, 0);
    assert.equal(db.prepare(finalizeRobinhoodRunSql(release.runId, identity.manifestHash, 50, capturedAt)).all().length, 1);
    db.prepare("INSERT INTO watcher_options_snapshot_current VALUES(1, ?, ?, ?, ?, ?, 20, 20, ?)").run(release.runId, identity.releaseId, identity.manifestKey, identity.manifestHash, capturedAt, capturedAt);
    const before = db.prepare("SELECT * FROM watcher_options_snapshot_runs").get();
    const pointer = db.prepare("SELECT * FROM watcher_options_snapshot_current").get();
    db.exec(failedRobinhoodRunSql({ runId: release.runId }, "invalid retry", capturedAt));
    db.exec(failedRobinhoodRunSql(release, "crash after finalize", capturedAt, { runId: release.runId, manifestHash: identity.manifestHash }));
    assert.equal(db.prepare(finalizeRobinhoodRunSql(release.runId, identity.manifestHash, 999, capturedAt)).all().length, 0);
    assert.deepEqual(db.prepare("SELECT * FROM watcher_options_snapshot_runs").get(), before);
    assert.deepEqual(db.prepare("SELECT * FROM watcher_options_snapshot_current").get(), pointer);
  } finally { db.close(); }
});

test("publisher verifies identical published retries and rejects changed or corrupt content without R2 writes", () => {
  const directory = mkdtempSync(join(tmpdir(), "robinhood-idempotency-test-"));
  try {
    const file = join(directory, "release.json");
    const symbols = Array.from({ length: 20 }, (_, index) => {
      const symbol = `T${String.fromCharCode(65 + index)}`;
      return { symbol, spot: 100, contracts: [{ symbol, expiry: capturedAt.slice(0, 10), strike: 100, callPut: "call", multiplier: 100, openInterest: 100, gamma: 0.01, impliedVolatility: 0.25, delta: 0.5, volume: 5, mark: 2, quoteUpdatedAt: capturedAt, spot: 100, capturedAt }] };
    });
    writeFileSync(file, JSON.stringify({ ...release, symbols }));
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import cp from "node:child_process";
      import { syncBuiltinESMExports } from "node:module";
      import { DatabaseSync } from "node:sqlite";
      import { readFileSync, writeFileSync } from "node:fs";
      import assert from "node:assert/strict";
      const inputFile = process.argv[1];
      const db = new DatabaseSync(":memory:");
      for (const file of ["0013_robinhood_options_snapshot_status.sql", "0014_robinhood_options_snapshot_variable_cardinality.sql"]) db.exec(readFileSync("migrations/" + file, "utf8"));
      const objects = new Map(); let puts = 0, gets = 0;
      cp.execFileSync = (_command, args) => {
        if (args[1] === "d1") {
          const statement = readFileSync(args[args.indexOf("--file") + 1], "utf8");
          const rows = db.prepare(statement).all();
          return JSON.stringify([{ success: true, results: rows }]);
        }
        if (args[1] === "r2" && args[3] === "put") { puts++; objects.set(args[4], readFileSync(args[args.indexOf("--file") + 1], "utf8")); return ""; }
        if (args[1] === "r2" && args[3] === "get") { gets++; assert.ok(objects.has(args[4])); return objects.get(args[4]); }
        throw new Error("Unexpected external command");
      };
      syncBuiltinESMExports();
      process.argv = [process.execPath, "test-runner", "--input", inputFile];
      const { publishRobinhoodOptionsSnapshot } = await import("./scripts/publish-robinhood-options-snapshot.ts");
      await publishRobinhoodOptionsSnapshot();
      const originalRow = db.prepare("SELECT * FROM watcher_options_snapshot_runs").get();
      const originalPointer = db.prepare("SELECT * FROM watcher_options_snapshot_current").get();
      const firstPuts = puts;
      const originalNow = Date.now;
      Date.now = () => originalNow() + 31 * 60 * 60 * 1000;
      await publishRobinhoodOptionsSnapshot();
      Date.now = originalNow;
      assert.equal(puts, firstPuts); assert.equal(gets, 21);
      const originalInput = readFileSync(inputFile, "utf8");
      const changed = JSON.parse(originalInput);
      changed.symbols[0].contracts[0].openInterest++;
      writeFileSync(inputFile, JSON.stringify(changed));
      await assert.rejects(publishRobinhoodOptionsSnapshot(), /published run content differs/);
      assert.equal(puts, firstPuts);
      writeFileSync(inputFile, originalInput);
      objects.set([...objects.keys()][0], "corrupted");
      await assert.rejects(publishRobinhoodOptionsSnapshot(), /published object verification failed/);
      assert.equal(puts, firstPuts);
      assert.deepEqual(db.prepare("SELECT * FROM watcher_options_snapshot_runs").get(), originalRow);
      assert.deepEqual(db.prepare("SELECT * FROM watcher_options_snapshot_current").get(), originalPointer);
      console.log("IDEMPOTENCY_VERIFIED");
      db.close();
    `, file], { encoding: "utf8", timeout: 15_000, env: { ...process.env, CLOUDFLARE_API_TOKEN: "test-only-token", CLOUDFLARE_ACCOUNT_ID: "test-only-account" } });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /IDEMPOTENCY_VERIFIED/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("failed Robinhood dry-run cannot run remote commands even when credentials exist", () => {
  const directory = mkdtempSync(join(tmpdir(), "robinhood-dry-run-test-"));
  try {
    const file = join(directory, "invalid-release.json");
    writeFileSync(file, JSON.stringify({ runId: "existing-published-run" }));
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import cp from "node:child_process";
      import { syncBuiltinESMExports } from "node:module";
      import { fileURLToPath } from "node:url";
      let calls = 0;
      cp.execFileSync = () => { calls++; throw new Error("Remote execution forbidden in this test"); };
      syncBuiltinESMExports();
      process.argv = [process.execPath, fileURLToPath(new URL("./scripts/publish-robinhood-options-snapshot.ts", import.meta.url)), "--input", process.argv[1], "--dry-run"];
      process.on("beforeExit", () => console.log("REMOTE_CALLS=" + calls));
      await import("./scripts/publish-robinhood-options-snapshot.ts");
    `, file], { encoding: "utf8", timeout: 10_000, env: { ...process.env, CLOUDFLARE_API_TOKEN: "test-only-token", CLOUDFLARE_ACCOUNT_ID: "test-only-account" } });
    assert.ifError(child.error);
    assert.equal(child.status, 1, child.stderr);
    assert.match(child.stderr, /PUBLISH_CONTRACT/);
    assert.match(child.stdout, /REMOTE_CALLS=0/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
