import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS,
  ROBINHOOD_OPTIONS_PROVIDER,
  ROBINHOOD_OPTIONS_SCHEMA_VERSION,
  loadRobinhoodOptionsSnapshot,
  type RobinhoodOptionsR2BucketLike,
  type RobinhoodOptionsSymbolSnapshot,
} from "../src/lib/stocks-watcher-robinhood-options";

export type InputRelease = {
  runId: string;
  scheduledForEt: string;
  startedAt: string;
  capturedAt: string;
  releaseId?: string;
  symbols: Array<Pick<RobinhoodOptionsSymbolSnapshot, "symbol" | "spot" | "contracts">>;
};

type ObjectMap = Map<string, string>;
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const bucket = "watcher-options-snapshots";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const isoNow = () => new Date().toISOString();
const sql = (value: string | number | null) => value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
function required(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`PUBLISH_CONTRACT: ${message}`); }

const getInputPath = () => {
  const index = process.argv.indexOf("--input");
  required(index >= 0 && process.argv[index + 1], "usage: tsx scripts/publish-robinhood-options-snapshot.ts --input <release.json>");
  return resolve(process.argv[index + 1]);
};
const dryRun = process.argv.includes("--dry-run");
let claimedRun: { runId: string; manifestHash: string } | null = null;

const parseInput = (inputPath: string): InputRelease => {
  const value = JSON.parse(readFileSync(inputPath, "utf8")) as Partial<InputRelease>;
  required(value && typeof value === "object", "input must be an object");
  for (const field of ["runId", "scheduledForEt", "startedAt", "capturedAt"] as const) required(typeof value[field] === "string" && value[field]!.trim(), `${field} is required`);
  required(Array.isArray(value.symbols), "symbols must be an array");
  required(value.symbols.length === ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS, `a production release must contain exactly ${ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS} symbols`);
  return value as InputRelease;
};

const run = (args: string[]) => execFileSync(npx, ["wrangler", ...args], { stdio: "inherit", env: process.env, shell: process.platform === "win32" });

type ReleaseIdentity = { input: InputRelease; releaseId: string; manifestKey: string; manifestHash: string; now: string };
export const claimRobinhoodRunSql = ({ input, releaseId, manifestKey, manifestHash, now }: ReleaseIdentity) =>
  `INSERT INTO watcher_options_snapshot_runs (run_id, provider, scheduled_for_et, started_at, captured_at, finished_at, expected_symbols, completed_symbols, eligible_contracts, failed_symbols_json, release_id, manifest_key, manifest_sha256, status, failure_code, created_at) SELECT ${sql(input.runId)}, 'robinhood_mcp', ${sql(input.scheduledForEt)}, ${sql(input.startedAt)}, ${sql(input.capturedAt)}, ${sql(now)}, ${ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS}, 0, 0, '[]', ${sql(releaseId)}, ${sql(manifestKey)}, ${sql(manifestHash)}, 'running', NULL, ${sql(now)} WHERE NOT EXISTS (SELECT 1 FROM watcher_options_snapshot_runs WHERE release_id=${sql(releaseId)} AND run_id<>${sql(input.runId)}) ON CONFLICT(run_id) DO NOTHING RETURNING run_id;`;

export const finalizeRobinhoodRunSql = (runId: string, manifestHash: string, contracts: number, now: string) =>
  `UPDATE watcher_options_snapshot_runs SET status='published', completed_symbols=${ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS}, eligible_contracts=${sql(contracts)}, finished_at=${sql(now)}, failure_code=NULL WHERE run_id=${sql(runId)} AND status='running' AND manifest_sha256=${sql(manifestHash)} RETURNING run_id;`;

export const failedRobinhoodRunSql = (input: Partial<InputRelease>, message: string, now: string, claim: typeof claimedRun = null) => {
  if (claim) return `UPDATE watcher_options_snapshot_runs SET status='failed', failure_code=${sql(message)}, finished_at=${sql(now)} WHERE run_id=${sql(claim.runId)} AND status='running' AND manifest_sha256=${sql(claim.manifestHash)};`;
  const runId = typeof input.runId === "string" && input.runId ? input.runId : `failed-${randomUUID()}`;
  return `INSERT INTO watcher_options_snapshot_runs (run_id, provider, scheduled_for_et, started_at, captured_at, finished_at, expected_symbols, completed_symbols, eligible_contracts, failed_symbols_json, release_id, manifest_key, manifest_sha256, status, failure_code, created_at) VALUES (${sql(runId)}, 'robinhood_mcp', ${sql(input.scheduledForEt || now)}, ${sql(input.startedAt || now)}, ${sql(input.capturedAt || null)}, ${sql(now)}, ${ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS}, 0, 0, '[]', NULL, NULL, NULL, 'failed', ${sql(message)}, ${sql(now)}) ON CONFLICT(run_id) DO NOTHING;`;
};

const executeSql = <T>(statement: string, directory: string, name: string): T[] => {
  const file = join(directory, name);
  writeFileSync(file, statement, "utf8");
  const output = execFileSync(npx, ["wrangler", "d1", "execute", "market-cache-db", "--remote", "--yes", "--file", file, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], env: process.env, shell: process.platform === "win32" });
  const result = JSON.parse(output) as Array<{ success: boolean; results: T[] }>;
  required(Array.isArray(result) && result.every(row => row.success && Array.isArray(row.results)), "D1 did not return a verified statement result");
  return result.flatMap(row => row.results);
};

const verifyPublishedObjects = (objects: ObjectMap) => {
  for (const [key, expected] of objects) {
    const actual = execFileSync(npx, ["wrangler", "r2", "object", "get", `${bucket}/${key}`, "--pipe", "--remote"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], env: process.env, shell: process.platform === "win32" });
    required(sha256(actual) === sha256(expected), `published object verification failed for ${key}; use a new run ID`);
  }
};

const saveFailedDiagnostic = (input: Partial<InputRelease>, error: unknown) => {
  if (dryRun) return;
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) return;
  const message = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
  const now = isoNow();
  const statement = failedRobinhoodRunSql(input, message, now, claimedRun);
  const directory = mkdtempSync(join(tmpdir(), "robinhood-options-diagnostic-"));
  try {
    const statementFile = join(directory, "diagnostic.sql");
    writeFileSync(statementFile, statement, "utf8");
    run(["d1", "execute", "market-cache-db", "--remote", "--yes", "--file", statementFile]);
  } catch { console.error("PUBLISH_DIAGNOSTIC: the failure could not be recorded; the original publish error follows."); }
  finally { rmSync(directory, { recursive: true, force: true }); }
};

export const publishRobinhoodOptionsSnapshot = async () => {
  claimedRun = null;
  const input = parseInput(getInputPath());
  const releaseId = input.releaseId || `${input.capturedAt.slice(0, 10)}-${input.runId}`.replaceAll(/[^A-Za-z0-9._-]/g, "-");
  required(/^[A-Za-z0-9._-]+$/.test(releaseId), "releaseId contains unsupported characters");
  const objects: ObjectMap = new Map();
  const snapshots = input.symbols.map((symbol) => {
    const normalized = {
      schemaVersion: ROBINHOOD_OPTIONS_SCHEMA_VERSION,
      provider: ROBINHOOD_OPTIONS_PROVIDER,
      releaseId,
      runId: input.runId,
      symbol: symbol.symbol,
      capturedAt: input.capturedAt,
      spot: symbol.spot,
      contracts: symbol.contracts,
    };
    const key = `releases/${releaseId}/symbols/${symbol.symbol}.json`;
    objects.set(key, JSON.stringify(normalized));
    return { key, symbol: symbol.symbol };
  });
  const manifest = {
    schemaVersion: ROBINHOOD_OPTIONS_SCHEMA_VERSION,
    provider: ROBINHOOD_OPTIONS_PROVIDER,
    releaseId,
    runId: input.runId,
    capturedAt: input.capturedAt,
    expectedSymbols: ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS,
    completedSymbols: ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS,
    symbols: snapshots.map(({ key, symbol }) => ({ symbol, key, sha256: sha256(objects.get(key)!), contracts: (JSON.parse(objects.get(key)!) as { contracts: unknown[] }).contracts.length })),
  };
  const manifestKey = `releases/${releaseId}/manifest.json`;
  const manifestText = JSON.stringify(manifest);
  const currentText = JSON.stringify({
    schemaVersion: ROBINHOOD_OPTIONS_SCHEMA_VERSION,
    provider: ROBINHOOD_OPTIONS_PROVIDER,
    releaseId,
    runId: input.runId,
    manifestKey,
    manifestSha256: sha256(manifestText),
    capturedAt: input.capturedAt,
    expectedSymbols: ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS,
    completedSymbols: ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS,
  });
  objects.set(manifestKey, manifestText);

  const validationObjects = new Map(objects);
  validationObjects.set("current.json", currentText);
  const memoryBucket: RobinhoodOptionsR2BucketLike = { get: async (key) => validationObjects.has(key) ? { text: async () => validationObjects.get(key)! } : null };
  const validateRelease = async () => {
    for (const entry of manifest.symbols) await loadRobinhoodOptionsSnapshot(memoryBucket, entry.symbol);
    required(new Set(manifest.symbols.map((entry) => entry.symbol)).size === ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS, "symbols must be unique after normalization");
  };

  if (dryRun) {
    await validateRelease();
    console.log(`Validated ${manifest.symbols.length}/${ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS} symbols and ${manifest.symbols.reduce((total, entry) => total + entry.contracts, 0)} contracts. Dry run did not write R2 or D1.`);
    return;
  }
  required(process.env.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN is required for publishing");
  required(process.env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID is required for publishing");
  const directory = mkdtempSync(join(tmpdir(), "robinhood-options-release-"));
  try {
    const manifestHash = sha256(manifestText);
    const claimed = executeSql<{ run_id: string }>(claimRobinhoodRunSql({ input, releaseId, manifestKey, manifestHash, now: isoNow() }), directory, "claim-run.sql");
    if (claimed.length === 0) {
      const existing = executeSql<{ status: string; release_id: string | null; manifest_key: string | null; manifest_sha256: string | null; captured_at: string | null; scheduled_for_et: string; started_at: string }>(`SELECT status, release_id, manifest_key, manifest_sha256, captured_at, scheduled_for_et, started_at FROM watcher_options_snapshot_runs WHERE run_id=${sql(input.runId)};`, directory, "existing-run.sql")[0];
      required(existing?.status === "published", "run or release ID is already reserved; use a new run ID (running/failed runs are never reclaimed)");
      required(existing.release_id === releaseId && existing.manifest_key === manifestKey && existing.manifest_sha256 === manifestHash && existing.captured_at === input.capturedAt && existing.scheduled_for_et === input.scheduledForEt && existing.started_at === input.startedAt, "published run content differs; use a new run ID");
      verifyPublishedObjects(objects);
      console.log(`Published run ${input.runId} already has identical verified immutable objects. No R2 or D1 publication writes were made; current pointers were not changed.`);
      return;
    }
    claimedRun = { runId: input.runId, manifestHash };
    // A verified published retry never reactivates data. Only a new release must
    // pass the current freshness contract before its first R2 write.
    await validateRelease();
    for (const [key, text] of objects) {
      const file = join(directory, `${sha256(key)}.json`);
      writeFileSync(file, text, "utf8");
      run(["r2", "object", "put", `${bucket}/${key}`, "--file", file, "--remote"]);
    }
    const now = isoNow();
    const totalContracts = manifest.symbols.reduce((total, entry) => total + entry.contracts, 0);
    const runStatement = (name: string, statement: string) => {
      const statementFile = join(directory, name);
      writeFileSync(statementFile, statement, "utf8");
      run(["d1", "execute", "market-cache-db", "--remote", "--yes", "--file", statementFile]);
    };
    const finalized = executeSql<{ run_id: string }>(finalizeRobinhoodRunSql(input.runId, manifestHash, totalContracts, now), directory, "publish-run.sql");
    required(finalized.length === 1, "run claim changed before publication; current pointers were not moved");
    runStatement("publish-current.sql", `INSERT INTO watcher_options_snapshot_current (singleton, run_id, release_id, manifest_key, manifest_sha256, captured_at, expected_symbols, completed_symbols, updated_at) VALUES (1, ${sql(input.runId)}, ${sql(releaseId)}, ${sql(manifestKey)}, ${sql(sha256(manifestText))}, ${sql(input.capturedAt)}, ${ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS}, ${ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS}, ${sql(now)}) ON CONFLICT(singleton) DO UPDATE SET run_id=excluded.run_id, release_id=excluded.release_id, manifest_key=excluded.manifest_key, manifest_sha256=excluded.manifest_sha256, captured_at=excluded.captured_at, expected_symbols=excluded.expected_symbols, completed_symbols=excluded.completed_symbols, updated_at=excluded.updated_at;`);
    const currentFile = join(directory, "current.json");
    writeFileSync(currentFile, currentText, "utf8");
    run(["r2", "object", "put", `${bucket}/current.json`, "--file", currentFile, "--remote"]);
    console.log(`Published Robinhood EOD release ${releaseId}: ${ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS}/${ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS} symbols, ${totalContracts} contracts.`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) publishRobinhoodOptionsSnapshot().catch((error) => {
  const input = (() => { try { return JSON.parse(readFileSync(getInputPath(), "utf8")) as Partial<InputRelease>; } catch { return {}; } })();
  saveFailedDiagnostic(input, error);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
