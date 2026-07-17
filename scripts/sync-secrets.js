import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const RUNTIME_SECRET_KEYS = [
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "ADANOS_API_KEY",
  "FRED_API_KEY",
  "TELEGRAM_TOKEN",
  "TELEGRAM_CHAT_ID",
  "TG_API_ID",
  "TG_API_HASH",
  "TG_SESSION_STRING",
];

const PLATFORM_KEYS = new Set(["CF_API_TOKEN", "CF_ACCOUNT_ID", "KV_NAMESPACE_ID"]);
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

export const parseDotEnv = (content) => Object.fromEntries(
  content.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const separator = trimmed.indexOf("=");
    if (separator < 1) return [];
    return [[trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim()]];
  }),
);

export const buildCloudflareDeployEnv = (vars, inherited = process.env) => {
  const token = inherited.CLOUDFLARE_API_TOKEN || vars.CF_API_TOKEN;
  if (!token) throw new Error("Cloudflare deploy requires CLOUDFLARE_API_TOKEN or .dev.vars CF_API_TOKEN.");
  return { ...inherited, CLOUDFLARE_API_TOKEN: token };
};

export const loadDeployVars = (varsPath = path.resolve(process.cwd(), ".dev.vars")) => {
  if (!fs.existsSync(varsPath)) throw new Error(`Deploy requires ${varsPath}; it contains CF_API_TOKEN.`);
  return parseDotEnv(fs.readFileSync(varsPath, "utf8"));
};

export const syncSecrets = ({
  vars,
  projectName = process.env.CF_PAGES_PROJECT_NAME || "sius-ai-workshop",
  env = process.env,
  run = execFileSync,
} = {}) => {
  const source = vars || loadDeployVars();
  const deployEnv = buildCloudflareDeployEnv(source, env);
  const synced = [];
  for (const key of RUNTIME_SECRET_KEYS) {
    const value = source[key];
    if (!value) continue;
    if (PLATFORM_KEYS.has(key)) throw new Error(`Platform key ${key} must never be synchronized as a Pages secret.`);
    console.log(`[Sync] Pushing runtime secret: ${key}...`);
    run(npxCommand, ["wrangler", "pages", "secret", "put", key, "--project-name", projectName], {
      input: value,
      stdio: ["pipe", "inherit", "inherit"],
      env: deployEnv,
      shell: process.platform === "win32",
    });
    synced.push(key);
  }
  console.log(`[Sync] Updated ${synced.length} runtime secret(s).`);
  return { deployEnv, synced };
};

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    syncSecrets();
  } catch (error) {
    console.error(`[Sync] Failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
