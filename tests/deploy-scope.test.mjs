import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { deployPages } from "../scripts/deploy-site.js";
import { deployProduction } from "../scripts/deploy-production.js";
import { deploySpx } from "../scripts/deploy-spx.js";
import { buildCloudflareDeployEnv } from "../scripts/sync-secrets.js";

const deployVars = {
  CF_ACCOUNT_ID: "test-account",
  CF_API_TOKEN_2: "test-token",
};

test("Pages deploy does not synchronize runtime secrets by default", () => {
  const calls = [];
  deployPages({
    args: [],
    vars: deployVars,
    env: {},
    run: (...args) => calls.push(args),
    sync: () => { throw new Error("secret synchronization must be explicit"); },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], ["wrangler", "pages", "deploy", "dist", "--project-name", "sius-ai-workshop", "--branch", "main"]);
});

test("Pages secret synchronization requires the explicit flag", () => {
  const calls = [];
  let syncCalls = 0;
  deployPages({
    args: ["--sync-secrets"],
    vars: deployVars,
    env: {},
    run: (...args) => calls.push(args),
    sync: () => {
      syncCalls += 1;
      return { deployEnv: { TEST_DEPLOY: "1" } };
    },
  });

  assert.equal(syncCalls, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].env.TEST_DEPLOY, "1");
});

test("configured replacement Cloudflare token wins over a stale inherited shell token", () => {
  const env = buildCloudflareDeployEnv(deployVars, {
    CLOUDFLARE_API_TOKEN: "stale-token",
    CLOUDFLARE_ACCOUNT_ID: "inherited-account",
  });
  assert.equal(env.CLOUDFLARE_API_TOKEN, "test-token");
  assert.equal(env.CLOUDFLARE_ACCOUNT_ID, "inherited-account");
});

test("SPX Worker deploy uses the configured Cloudflare deployment environment", () => {
  const calls = [];
  deploySpx({
    vars: deployVars,
    env: { CLOUDFLARE_API_TOKEN: "stale-token" },
    run: (...args) => calls.push(args),
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], ["wrangler", "deploy", "--config", "wrangler.spx.toml"]);
  assert.equal(calls[0][2].env.CLOUDFLARE_API_TOKEN, "test-token");
});

test("production deploy invokes Pages before the SPX scheduler Worker", () => {
  const calls = [];
  deployProduction({
    deployPagesRun: (options) => calls.push(["pages", options.args]),
    deploySpxRun: () => calls.push(["spx"]),
  });

  assert.deepEqual(calls, [
    ["pages", []],
    ["spx"],
  ]);
});

test("production deploy forwards explicit Pages secret synchronization before the SPX Worker", () => {
  const calls = [];
  deployProduction({
    args: ["--sync-secrets"],
    deployPagesRun: (options) => calls.push(["pages", options.args]),
    deploySpxRun: () => calls.push(["spx"]),
  });

  assert.deepEqual(calls, [
    ["pages", ["--sync-secrets"]],
    ["spx"],
  ]);
});

test("default deploy command uses the paired production release", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts.deploy, "npm run deploy:production");
  assert.equal(packageJson.scripts["deploy:production"], "node scripts/deploy-production.js");
  assert.equal(packageJson.scripts["deploy:all"], "npm run deploy:production -- --sync-secrets");
});
