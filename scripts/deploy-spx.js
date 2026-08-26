import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCloudflareDeployEnv, loadDeployVars } from "./sync-secrets.js";

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

export const deploySpx = ({
  vars = loadDeployVars(),
  env = process.env,
  run = execFileSync,
} = {}) => {
  const deployEnv = buildCloudflareDeployEnv(vars, env);
  run(npxCommand, ["wrangler", "deploy", "--config", "wrangler.spx.toml"], {
    stdio: "inherit",
    env: deployEnv,
    shell: process.platform === "win32",
  });
};

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) deploySpx();
