import { execFileSync } from "node:child_process";
import { buildCloudflareDeployEnv, loadDeployVars } from "./sync-secrets.js";

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const deployEnv = buildCloudflareDeployEnv(loadDeployVars());
execFileSync(npxCommand, ["wrangler", "deploy", "--config", "wrangler.spx.toml"], {
  stdio: "inherit",
  env: deployEnv,
});
