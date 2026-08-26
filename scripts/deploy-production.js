import path from "node:path";
import { fileURLToPath } from "node:url";
import { deployPages } from "./deploy-site.js";
import { deploySpx } from "./deploy-spx.js";

/**
 * The default production release is a paired deployment. The Pages API reads
 * pressure projections, while the SPX Worker writes them during collection;
 * shipping only one side makes the live matrix stale.
 */
export const deployProduction = ({
  args = process.argv.slice(2),
  deployPagesRun = deployPages,
  deploySpxRun = deploySpx,
} = {}) => {
  const pagesArgs = args.includes("--sync-secrets") ? ["--sync-secrets"] : [];
  deployPagesRun({ args: pagesArgs });
  deploySpxRun();
};

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) deployProduction();
