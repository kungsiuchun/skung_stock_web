import { execFileSync } from "node:child_process";
import { buildCloudflareDeployEnv, loadDeployVars, syncSecrets } from "./sync-secrets.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

export const deployPages = ({
  args = process.argv.slice(2),
  vars = loadDeployVars(),
  env = process.env,
  run = execFileSync,
  sync = syncSecrets,
} = {}) => {
  const syncRuntimeSecrets = args.includes("--sync-secrets");
  const deployEnv = syncRuntimeSecrets
    ? sync({ vars, env }).deployEnv
    : buildCloudflareDeployEnv(vars, env);

  run(npxCommand, [
    "wrangler", "pages", "deploy", "dist",
    "--project-name", env.CF_PAGES_PROJECT_NAME || "sius-ai-workshop",
    "--branch", env.CF_PAGES_BRANCH || "main",
  ], {
    stdio: "inherit",
    env: deployEnv,
    shell: process.platform === "win32",
  });
};

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) deployPages();
