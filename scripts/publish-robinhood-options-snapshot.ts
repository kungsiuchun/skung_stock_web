import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS,
  ROBINHOOD_OPTIONS_PROVIDER,
  ROBINHOOD_OPTIONS_SCHEMA_VERSION,
  loadRobinhoodOptionsSnapshot,
  type RobinhoodOptionsR2BucketLike,
  type RobinhoodOptionsSymbolSnapshot,
} from "../src/lib/stocks-watcher-robinhood-options";

type InputRelease = {
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
const required = (condition: unknown, message: string): asserts condition => { if (!condition) throw new Error(`PUBLISH_CONTRACT: ${message}`); };

const inputPath = (() => {
  const index = process.argv.indexOf("--input");
  required(index >= 0 && process.argv[index + 1], "usage: tsx scripts/publish-robinhood-options-snapshot.ts --input <release.json>");
  return resolve(process.argv[index + 1]);
})();
const dryRun = process.argv.includes("--dry-run");

const parseInput = (): InputRelease => {
  const value = JSON.parse(readFileSync(inputPath, "utf8")) as Partial<InputRelease>;
  required(value && typeof value === "object", "input must be an object");
  for (const field of ["runId", "scheduledForEt", "startedAt", "capturedAt"] as const) required(typeof value[field] === "string" && value[field]!.trim(), `${field} is required`);
  required(Array.isArray(value.symbols), "symbols must be an array");
  required(value.symbols.length === ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS, `a production release must contain exactly ${ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS} symbols`);
  return value as InputRelease;
};

const run = (args: string[]) => execFileSync(npx, ["wrangler", ...args], { stdio: "inherit", env: process.env, shell: process.platform === "win32" });

const saveFailedDiagnostic = (input: Partial<InputRelease>, error: unknown, completed = 0) => {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) return;
  const runId = typeof input.runId === "string" && input.runId ? input.runId : `failed-${randomUUID()}`;
  const message = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
  const now = isoNow();
  const statement = `INSERT OR REPLACE INTO watcher_options_snapshot_runs (run_id, provider, scheduled_for_et, started_at, captured_at, finished_at, expected_symbols, completed_symbols, eligible_contracts, failed_symbols_json, release_id, manifest_key, manifest_sha256, status, failure_code, created_at) VALUES (${sql(runId)}, 'robinhood_mcp', ${sql(input.scheduledForEt || now)}, ${sql(input.startedAt || now)}, ${sql(input.capturedAt || null)}, ${sql(now)}, ${ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS}, ${completed}, 0, ${sql(JSON.stringify(input.symbols?.map((row) => row.symbol).filter(Boolean) || []))}, NULL, NULL, NULL, 'failed', ${sql(message)}, ${sql(now)});`;
  const directory = mkdtempSync(join(tmpdir(), "robinhood-options-diagnostic-"));
  try {
    const statementFile = join(directory, "diagnostic.sql");
    writeFileSync(statementFile, statement, "utf8");
    run(["d1", "execute", "market-cache-db", "--remote", "--yes", "--file", statementFile]);
  } catch { /* Preserve original publish error. */ }
  finally { rmSync(directory, { recursive: true, force: true }); }
};

const main = async () => {
  const input = parseInput();
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
  for (const entry of manifest.symbols) await loadRobinhoodOptionsSnapshot(memoryBucket, entry.symbol);
  required(new Set(manifest.symbols.map((entry) => entry.symbol)).size === ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS, "symbols must be unique after normalization");

  if (dryRun) {
    console.log(`Validated ${manifest.symbols.length}/${ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS} symbols and ${manifest.symbols.reduce((total, entry) => total + entry.contracts, 0)} contracts. Dry run did not write R2 or D1.`);
    return;
  }
  required(process.env.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN is required for publishing");
  required(process.env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID is required for publishing");
  const directory = mkdtempSync(join(tmpdir(), "robinhood-options-release-"));
  try {
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
    runStatement("publish-run.sql", `INSERT OR REPLACE INTO watcher_options_snapshot_runs (run_id, provider, scheduled_for_et, started_at, captured_at, finished_at, expected_symbols, completed_symbols, eligible_contracts, failed_symbols_json, release_id, manifest_key, manifest_sha256, status, failure_code, created_at) VALUES (${sql(input.runId)}, 'robinhood_mcp', ${sql(input.scheduledForEt)}, ${sql(input.startedAt)}, ${sql(input.capturedAt)}, ${sql(now)}, ${ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS}, ${ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS}, ${totalContracts}, '[]', ${sql(releaseId)}, ${sql(manifestKey)}, ${sql(sha256(manifestText))}, 'published', NULL, ${sql(now)});`);
    runStatement("publish-current.sql", `INSERT INTO watcher_options_snapshot_current (singleton, run_id, release_id, manifest_key, manifest_sha256, captured_at, expected_symbols, completed_symbols, updated_at) VALUES (1, ${sql(input.runId)}, ${sql(releaseId)}, ${sql(manifestKey)}, ${sql(sha256(manifestText))}, ${sql(input.capturedAt)}, ${ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS}, ${ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS}, ${sql(now)}) ON CONFLICT(singleton) DO UPDATE SET run_id=excluded.run_id, release_id=excluded.release_id, manifest_key=excluded.manifest_key, manifest_sha256=excluded.manifest_sha256, captured_at=excluded.captured_at, expected_symbols=excluded.expected_symbols, completed_symbols=excluded.completed_symbols, updated_at=excluded.updated_at;`);
    const currentFile = join(directory, "current.json");
    writeFileSync(currentFile, currentText, "utf8");
    run(["r2", "object", "put", `${bucket}/current.json`, "--file", currentFile, "--remote"]);
    console.log(`Published Robinhood EOD release ${releaseId}: ${ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS}/${ROBINHOOD_OPTIONS_EXPECTED_SYMBOLS} symbols, ${totalContracts} contracts.`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

main().catch((error) => {
  const input = (() => { try { return JSON.parse(readFileSync(inputPath, "utf8")) as Partial<InputRelease>; } catch { return {}; } })();
  saveFailedDiagnostic(input, error);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
