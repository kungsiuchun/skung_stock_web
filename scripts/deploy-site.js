import { execFileSync } from "node:child_process";
import { loadDeployVars, syncSecrets } from "./sync-secrets.js";

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const vars = loadDeployVars();
const { deployEnv } = syncSecrets({ vars });
execFileSync(npxCommand, ["wrangler", "pages", "deploy", "dist", "--project-name", process.env.CF_PAGES_PROJECT_NAME || "sius-ai-workshop"], {
  stdio: "inherit",
  env: deployEnv,
});
