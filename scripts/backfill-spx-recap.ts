import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type DailyMemory,
  type NormalizedRecapDay,
  type AuditPayload,
  normalizeRecapDay,
  parseAuditPayload,
  stableHash,
  toDateKey,
} from "../src/lib/spx-recap-normalizer";

const DATABASE_NAME = "spx-recap-db";
const WRANGLER_BIN = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dryRun = args.includes("--dry-run") || !apply;
const local = args.includes("--local");

const getArgValue = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const fromDate = getArgValue("--from");
const toDate = getArgValue("--to");

const quoteArg = (value: string) => `"${value.replace(/"/g, '\\"')}"`;
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const runWrangler = (wranglerArgs: string[]) => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return execSync([WRANGLER_BIN, ...wranglerArgs].map(quoteArg).join(" "), {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch (error) {
      lastError = error;
      if (attempt < 3) sleep(700 * attempt);
    }
  }

  throw lastError;
};

const readNamespaceId = () => {
  const config = readFileSync("wrangler.spx.toml", "utf8");
  const match = config.match(/\[\[kv_namespaces\]\]\s+binding\s*=\s*"SPX_MEMORY"\s+id\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error("Cannot find SPX_MEMORY namespace id in wrangler.spx.toml");
  return match[1];
};

const sqlString = (value: string | null | undefined) => {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
};

const sqlNumber = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "NULL";
  return String(Number(value));
};

const daySql = (day: NormalizedRecapDay, updatedAt: string) => {
  const { summary } = day;
  return `
INSERT INTO spx_days (
  date, total_callouts, trades_taken, wins, losses, flat_closes, win_rate,
  total_pnl_points, defensive_holds, ic_events, first_callout_at, last_callout_at,
  source_updated_at, created_at, updated_at
) VALUES (
  ${sqlString(day.date)}, ${summary.totalCallouts}, ${summary.tradesTaken}, ${summary.wins},
  ${summary.losses}, ${summary.flatCloses}, ${sqlNumber(summary.winRate)}, ${summary.totalPnlPoints},
  ${summary.defensiveHolds}, ${summary.icEvents}, ${sqlString(day.firstCalloutAt)}, ${sqlString(day.lastCalloutAt)},
  ${sqlString(updatedAt)}, ${sqlString(updatedAt)}, ${sqlString(updatedAt)}
)
ON CONFLICT(date) DO UPDATE SET
  total_callouts = excluded.total_callouts,
  trades_taken = excluded.trades_taken,
  wins = excluded.wins,
  losses = excluded.losses,
  flat_closes = excluded.flat_closes,
  win_rate = excluded.win_rate,
  total_pnl_points = excluded.total_pnl_points,
  defensive_holds = excluded.defensive_holds,
  ic_events = excluded.ic_events,
  first_callout_at = excluded.first_callout_at,
  last_callout_at = excluded.last_callout_at,
  source_updated_at = excluded.source_updated_at,
  updated_at = excluded.updated_at;
DELETE FROM spx_callouts WHERE date = ${sqlString(day.date)};`;
};

const calloutSql = (day: NormalizedRecapDay, updatedAt: string) =>
  day.timeline
    .map(
      (item) => `
INSERT INTO spx_callouts (
  id, date, ordinal, time_et, timestamp_text, price, action, reasoning, pnl,
  status, event_type, position_side, related_entry_id, raw_json, created_at, updated_at
) VALUES (
  ${sqlString(item.id)}, ${sqlString(item.date)}, ${item.ordinal}, ${sqlString(item.time)},
  ${sqlString(item.timestamp)}, ${sqlNumber(item.price)}, ${sqlString(item.action)}, ${sqlString(item.reasoning)},
  ${sqlNumber(item.pnl)}, ${sqlString(item.status)}, ${sqlString(item.eventType)}, ${sqlString(item.positionSide)},
  ${sqlString(item.relatedEntryId)}, ${sqlString(item.rawJson)}, ${sqlString(updatedAt)}, ${sqlString(updatedAt)}
);`,
    )
    .join("\n");

const auditSql = (audit: AuditPayload | null, updatedAt: string) => {
  if (!audit) return "";

  const lines = [
    `
INSERT INTO spx_audits (
  date, report, learned_rules_json, action_log_size, generated_at, created_at, updated_at
) VALUES (
  ${sqlString(audit.date)}, ${sqlString(audit.report)}, ${sqlString(JSON.stringify(audit.learnedRules))},
  ${sqlNumber(audit.actionLogSize)}, ${sqlString(audit.generatedAt)}, ${sqlString(updatedAt)}, ${sqlString(updatedAt)}
)
ON CONFLICT(date) DO UPDATE SET
  report = excluded.report,
  learned_rules_json = excluded.learned_rules_json,
  action_log_size = excluded.action_log_size,
  generated_at = excluded.generated_at,
  updated_at = excluded.updated_at;`,
  ];

  for (const rule of audit.learnedRules) {
    const ruleHash = stableHash(rule);
    lines.push(`
INSERT INTO spx_wisdom_rules (id, source_date, rule_hash, rule_text, created_at, updated_at)
VALUES (
  ${sqlString(`${audit.date}-${ruleHash}`)}, ${sqlString(audit.date)}, ${sqlString(ruleHash)},
  ${sqlString(rule)}, ${sqlString(updatedAt)}, ${sqlString(updatedAt)}
)
ON CONFLICT(source_date, rule_hash) DO UPDATE SET
  rule_text = excluded.rule_text,
  updated_at = excluded.updated_at;`);
  }

  return lines.join("\n");
};

const buildSql = (day: NormalizedRecapDay, audit: AuditPayload | null) => {
  const updatedAt = new Date().toISOString();
  return [
    daySql(day, updatedAt),
    calloutSql(day, updatedAt),
    auditSql(audit, updatedAt),
  ].join("\n");
};

const namespaceId = readNamespaceId();
const rawKeys = runWrangler(["kv", "key", "list", "--namespace-id", namespaceId, "--prefix", "spx_memory_", "--remote"]);
const keys = JSON.parse(rawKeys) as { name: string }[];
const dates = keys
  .map((key) => toDateKey(key.name))
  .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
  .filter((date) => (!fromDate || date >= fromDate) && (!toDate || date <= toDate))
  .sort();

if (dates.length === 0) {
  console.log("[SPX Backfill] No matching SPX memory keys.");
  process.exit(0);
}

const tempDir = mkdtempSync(join(tmpdir(), "spx-recap-backfill-"));

try {
  for (const date of dates) {
    const memoryRaw = runWrangler(["kv", "key", "get", `spx_memory_${date}`, "--namespace-id", namespaceId, "--text", "--remote"]);
    const auditRaw = (() => {
      try {
        return runWrangler(["kv", "key", "get", `spx_audit_${date}`, "--namespace-id", namespaceId, "--text", "--remote"]);
      } catch {
        return null;
      }
    })();

    const memory = JSON.parse(memoryRaw) as DailyMemory;
    const day = normalizeRecapDay(date, memory);
    const audit = parseAuditPayload(auditRaw, date);

    console.log(
      `[SPX Backfill] ${dryRun ? "DRY" : "APPLY"} ${date}: callouts=${day.summary.totalCallouts}, trades=${day.summary.tradesTaken}, wins=${day.summary.wins}, losses=${day.summary.losses}, defense=${day.summary.defensiveHolds}, pnl=${day.summary.totalPnlPoints}`,
    );

    if (!apply) continue;

    const sqlPath = join(tempDir, `spx-recap-${date}.sql`);
    writeFileSync(sqlPath, buildSql(day, audit), "utf8");
    runWrangler(["d1", "execute", DATABASE_NAME, local ? "--local" : "--remote", "--file", sqlPath]);
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
