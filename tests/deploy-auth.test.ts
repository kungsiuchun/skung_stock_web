import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCloudflareDeployEnv, RUNTIME_SECRET_KEYS, syncSecrets } from "../scripts/sync-secrets.js";

describe("Cloudflare deploy credential boundary", () => {
  it("maps CF_API_TOKEN to Wrangler auth without treating it as an app secret", () => {
    const env = buildCloudflareDeployEnv({ CF_API_TOKEN: "deploy-token" }, {});
    assert.equal(env.CLOUDFLARE_API_TOKEN, "deploy-token");
    assert.equal(RUNTIME_SECRET_KEYS.includes("CF_API_TOKEN"), false);
    assert.equal(RUNTIME_SECRET_KEYS.includes("CF_ACCOUNT_ID"), false);
    assert.equal(RUNTIME_SECRET_KEYS.includes("KV_NAMESPACE_ID"), false);
  });

  it("fails fast before any sync when Cloudflare auth is absent", () => {
    let calls = 0;
    assert.throws(() => syncSecrets({ vars: { OPENROUTER_API_KEY: "runtime" }, env: {}, run: () => { calls += 1; } }), /Cloudflare deploy requires/);
    assert.equal(calls, 0);
  });

  it("syncs only allowlisted runtime secrets with the deploy auth environment", () => {
    const calls: Array<{ args: string[]; env: Record<string, string> }> = [];
    const result = syncSecrets({
      vars: { CF_API_TOKEN: "deploy-token", OPENROUTER_API_KEY: "runtime", CF_ACCOUNT_ID: "account" },
      env: {},
      run: (_command, args, options) => calls.push({ args, env: options.env }),
    });
    assert.deepEqual(result.synced, ["OPENROUTER_API_KEY"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.includes("CF_API_TOKEN"), false);
    assert.equal(calls[0].env.CLOUDFLARE_API_TOKEN, "deploy-token");
  });
});
