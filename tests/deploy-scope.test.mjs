import assert from "node:assert/strict";
import test from "node:test";
import { deployPages } from "../scripts/deploy-site.js";

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
