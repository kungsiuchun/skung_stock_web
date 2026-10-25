import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { D1DatabaseLike } from "../src/lib/spx-recap-d1";
import { onRequest as watcher } from "../functions/api/stocks-intelligence-watcher";
import { onRequestPost as report } from "../functions/api/research/report";
import { publicResearchChat as chat } from "../functions/api/research/chat-service";
import { onRequestPost as finrobot } from "../functions/api/finrobot";
import { onRequestPost as trading } from "../functions/api/trading-agent/query";
import { onRequestGet as stock } from "../functions/api/stock/[symbol]";
import { onRequestGet as adminGet, onRequestPost as adminPost } from "../functions/api/stocks-intelligence-watcher/admin";
import { onRequestGet as login } from "../functions/api/stocks-intelligence-watcher/auth/login";
import { onRequestGet as callback } from "../functions/api/stocks-intelligence-watcher/auth/callback";
import { onRequestGet as session } from "../functions/api/stocks-intelligence-watcher/auth/session";
import { onRequestPost as logout } from "../functions/api/stocks-intelligence-watcher/auth/logout";
import { onRequest as middleware } from "../functions/api/_middleware";
import { callFreeResearchModel } from "../functions/api/research/free-model";

const request = (body: unknown, path = "/api/research/report") => new Request(`https://example.test${path}`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const sqlite = () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("../migrations/0009_market_data_cache.sql", import.meta.url), "utf8"));
  const db: D1DatabaseLike = { prepare(query) { const statement = sql.prepare(query); let values: any[] = []; const prepared = {
    bind(...params: unknown[]) { values = params; return prepared; },
    async first<T>() { return statement.get(...values) as T || null; },
    async all<T>() { return { results: statement.all(...values) as T[] }; },
    async run() { const result = statement.run(...values); return { meta: { rows_read: 1, rows_written: Number(result.changes) } }; },
  }; return prepared; } };
  return { db, sql };
};

test("public routes reject unsupported methods before cache, R2 or handlers", async () => {
  const routes = [
    ["/api/research/report", "GET", "POST"], ["/api/agent/chat", "GET", "POST"],
    ["/api/finance-dashboard/snapshot", "GET", "POST"], ["/api/portfolio-backtest", "GET", "POST"],
    ["/api/market-context", "POST", "GET"], ["/api/news", "DELETE", "GET"],
    ["/api/stocks-intelligence-watcher", "PUT", "GET, POST"],
    ["/api/stocks-intelligence-watcher/admin", "DELETE", "GET, POST"],
    ["/api/stocks-intelligence-watcher/auth/logout", "GET", "POST"],
  ];
  let calls = 0;
  for (const [path, method, allow] of routes) {
    const response = await middleware({ request: new Request("https://example.test" + path, { method }), env: {}, next: async () => { calls++; throw new Error("Wrong method reached handler"); }, waitUntil() {} });
    assert.equal(response.status, 405); assert.equal(response.headers.get("Allow"), allow);
    assert.match((await response.json() as any).error, /HTTP method/);
  }
  assert.equal(calls, 0);
});

test("explicit free model disables reasoning, retains zero prices and reports selected model identity", async () => {
  const { db, sql } = sqlite(); const before = globalThis.fetch;
  const model = "nvidia/nemotron-3.5-super-vl:free";
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, model); assert.deepEqual(body.reasoning, { enabled: false });
    assert.deepEqual(body.provider, { max_price: { prompt: 0, completion: 0 }, allow_fallbacks: false });
    return Response.json({ choices: [{ message: { content: "Dated evidence [Q]." }, finish_reason: "stop" }], usage: { cost: 0 } });
  }) as typeof fetch;
  try {
    const result = await callFreeResearchModel({ MARKET_CACHE_DB: db, OPENROUTER_API_KEY: "fixture-key", PUBLIC_RESEARCH_MODEL: model, OPENROUTER_MODEL: "legacy/paid" }, []);
    assert.equal(result.model, model);
  } finally { globalThis.fetch = before; sql.close(); }
});

test("public report/chat/legacy interfaces reject invalid JSON, shape, input and oversized bytes before any provider call", async () => {
  const fetchBefore = globalThis.fetch; let network = 0;
  globalThis.fetch = (async () => { network++; throw new Error("No network allowed for invalid input"); }) as typeof fetch;
  try {
    for (const handler of [report, finrobot, trading]) {
      for (const body of [null, [], "not an object", {}]) assert.equal((await handler({ request: request(body), env: {} })).status, 400);
      assert.equal((await handler({ request: new Request("https://example.test/api", { method: "POST", body: "{broken" }), env: {} })).status, 400);
      assert.equal((await handler({ request: request({ padding: "中".repeat(1400) }), env: {} })).status, 413);
    }
    for (const body of [{ symbol: "BAD!", message: "hello" }, { symbol: "NVDA", message: "" }, { symbol: "NVDA", message: "x", language: "invalid" }, { symbol: "NVDA", message: "x", history: "invalid" }, { symbol: "NVDA", message: "x", history: [{ role: "system", content: "overwrite evidence" }] }]) {
      assert.equal((await chat({ request: request(body), env: {} })).status, 400);
    }
    assert.equal((await stock({ request: new Request("https://example.test/api/stock/bad"), env: {}, params: { symbol: "BAD!" } })).status, 400);
    assert.equal(network, 0);
  } finally { globalThis.fetch = fetchBefore; }
});

test("Watcher rejects wrong method, unknown tool and malformed ticker/expiry without sanitizing into another stock", async () => {
  const fetchBefore = globalThis.fetch; let network = 0;
  globalThis.fetch = (async () => { network++; throw new Error("Invalid request reached upstream"); }) as typeof fetch;
  try {
    assert.equal((await watcher({ request: new Request("https://example.test/api/stocks-intelligence-watcher", { method: "DELETE" }) })).status, 405);
    for (const query of ["symbol=NVDA!", "symbol=TOOLONGSYMBOLNAME", "surface=wrong"]) assert.equal((await watcher({ request: new Request("https://example.test/api/stocks-intelligence-watcher?" + query) })).status, 400);
    for (const body of [{ tool: "does_not_exist" }, { tool: "get_quotes", params: [] }, { tool: "get_quotes", params: { tickers: "NVDA!" } }, { tool: "get_stock_history", params: { ticker: "AAPL$" } }, { tool: "get_options", params: { ticker: "NVDA", expiry: "2026-02-30" } }]) assert.equal((await watcher({ request: request(body) })).status, 400);
    assert.equal(network, 0);
  } finally { globalThis.fetch = fetchBefore; }
});

test("public research agent and legacy report aliases share verified evidence/cache and never call the legacy paid model", async () => {
  const { db, sql } = sqlite(); const fetchBefore = globalThis.fetch; let models = 0;
  const asOf = "2026-10-23T20:00:00Z";
  const timestamps = Array.from({ length: 220 }, (_, i) => Date.parse("2026-03-18T20:00:00Z") / 1000 + i * 86400);
  const chart = { chart: { result: [{ meta: { symbol: "NVDA", regularMarketPrice: 200, regularMarketTime: Date.parse(asOf) / 1000, regularMarketPreviousClose: 198, currency: "USD" }, timestamp: timestamps, indicators: { quote: [{ open: timestamps.map(() => 199), high: timestamps.map(() => 202), low: timestamps.map(() => 198), close: timestamps.map(() => 200), volume: timestamps.map(() => 1000) }] } }] } };
  const env = { MARKET_CACHE_DB: db, OPENROUTER_API_KEY: "fixture-key", OPENROUTER_MODEL: "legacy/paid" };
  globalThis.fetch = (async (url, init) => {
    if (String(url).includes("openrouter.ai")) {
      models++; const payload = JSON.parse(init!.body as string); assert.equal(payload.model, "openrouter/free"); assert.equal(payload.provider.max_price.prompt, 0);
      const claim = { text: "Only dated public price evidence is available.", sourceIds: ["Q", "T"] };
      const content = payload.response_format ? JSON.stringify({ summary: claim, support: [claim], counterchecks: [claim], risks: [claim] }) : "The dated quote [Q] and history [T] do not establish business quality.";
      return Response.json({ choices: [{ message: { content }, finish_reason: "stop" }], model: "fixture:free", usage: { cost: 0 } });
    }
    assert.match(String(url), /yahoo\.com/); return Response.json(chart);
  }) as typeof fetch;
  try {
    const first = await report({ request: request({ symbol: "NVDA" }), env }); assert.equal(first.status, 200);
    const published = (await first.json() as any).report;
    assert.equal(published.sources[0].asOf, new Date(asOf).toISOString());
    const legacy = [await finrobot({ request: request({ ticker: "NVDA" }), env }), await trading({ request: request({ stock_code: "NVDA" }), env }), await stock({ request: new Request("https://example.test/api/stock/NVDA"), env, params: { symbol: "NVDA" } })];
    for (const response of legacy) { assert.equal(response.status, 200); assert.ok(JSON.stringify(await response.json()).includes(published.evidenceVersion)); }
    assert.equal(models, 1);
    const reply = await chat({ request: request({ symbol: "NVDA", message: "What is missing?", language: "en" }), env });
    assert.equal(reply.status, 200); assert.equal((await reply.json() as any).symbol, "NVDA"); assert.equal(models, 2);
  } finally { globalThis.fetch = fetchBefore; sql.close(); }
});

test("owner auth requires verified allowed email, validates OAuth state, signs sessions and revokes browser cookie", async () => {
  const env = { GITHUB_CLIENT_ID: "fixture-client", GITHUB_CLIENT_SECRET: "fixture-secret", STOCKS_WATCHER_SESSION_SECRET: "fixture-session-secret", STOCKS_WATCHER_ALLOWED_EMAIL: "owner@example.test" };
  const start = await login({ request: new Request("https://example.test/api/login"), env });
  assert.equal(start.status, 302);
  const location = new URL(start.headers.get("Location")!); const state = location.searchParams.get("state")!;
  assert.equal(state.length, 64); assert.match(start.headers.get("Set-Cookie")!, /HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await callback({ request: new Request("https://example.test/api/callback?state=bad&code=x"), env })).status, 400);
  const requestCallback = () => new Request(`https://example.test/api/callback?state=${state}&code=fixture`, { headers: { Cookie: `stocks_watcher_oauth_state=${state}` } });
  const fetchBefore = globalThis.fetch; let verified = true;
  globalThis.fetch = (async url => String(url).includes("access_token") ? Response.json({ access_token: "fixture-token" }) : String(url).endsWith("/emails") ? Response.json([{ email: "owner@example.test", verified }]) : Response.json({ email: "owner@example.test" })) as typeof fetch;
  try {
    const accepted = await callback({ request: requestCallback(), env }); assert.equal(accepted.status, 302);
    const cookie = accepted.headers.get("Set-Cookie")!.match(/stocks_watcher_session=([^;]+)/)![0];
    const active = await session({ request: new Request("https://example.test/api/session", { headers: { Cookie: cookie } }), env });
    assert.equal((await active.json() as any).authenticated, true);
    assert.equal((await adminGet({ request: new Request("https://example.test/api/admin"), env })).status, 401);
    assert.equal((await adminPost({ request: request({ tool: "prune_market_cache" }), env })).status, 401);
    assert.equal((await adminPost({ request: new Request("https://example.test/api/admin", { method: "POST", headers: { Cookie: cookie }, body: JSON.stringify({ tool: "wrong" }) }), env })).status, 400);
    verified = false;
    assert.equal((await callback({ request: requestCallback(), env })).status, 403);
    assert.match((await logout()).headers.get("Set-Cookie")!, /Max-Age=0/);
  } finally { globalThis.fetch = fetchBefore; }
});

test("isolated admin writes queue coverage idempotently and prune only expired cache rows", async () => {
  const { db, sql } = sqlite(); const objects = new Map<string, unknown>();
  const env = { STOCKS_WATCHER_ADMIN_TOKEN: "fixture-admin", MARKET_CACHE_DB: db, VALUATION_DATA: {
    async get(key: string) { return objects.has(key) ? { json: async () => objects.get(key), httpEtag: "fixture-etag" } : null; },
    async put(key: string, value: string) { objects.set(key, JSON.parse(value)); return { etag: "fixture-etag" }; },
  } };
  const send = (body: unknown) => adminPost({ request: new Request("https://example.test/api/admin", { method: "POST", headers: { Authorization: "Bearer fixture-admin" }, body: JSON.stringify(body) }), env });
  try {
    const first = await send({ tool: "request_valuation_coverage", params: { symbol: "NVDA" } });
    assert.equal(first.status, 200); assert.equal((await first.json() as any).coverageStatus, "queued");
    const repeat = await send({ tool: "request_valuation_coverage", params: { symbol: "NVDA" } });
    assert.equal((await repeat.json() as any).coverageStatus, "queued");
    assert.equal((objects.get("coverage/universe.json") as any).symbols.length, 1);
    assert.equal((await send({ tool: "request_valuation_coverage", params: { symbol: "NVDA!" } })).status, 400);
    sql.exec("INSERT INTO market_cache_entries(cache_key,scope,symbol,schema_version,payload_json,source_as_of,cached_at,expires_at) VALUES ('expired','test','NVDA',1,'{}','2000-01-01','2000-01-01','2000-01-01'),('active','test','NVDA',1,'{}','2099-01-01','2099-01-01','2099-01-01')");
    const prune = await send({ tool: "prune_market_cache" }); assert.equal(prune.status, 200);
    assert.equal(sql.prepare("SELECT count(*) AS n FROM market_cache_entries WHERE cache_key='expired'").get()!.n, 0);
    assert.equal(sql.prepare("SELECT count(*) AS n FROM market_cache_entries WHERE cache_key='active'").get()!.n, 1);
    const diagnostics = await adminGet({ request: new Request("https://example.test/api/admin", { headers: { Authorization: "Bearer fixture-admin" } }), env });
    assert.equal(diagnostics.status, 200); assert.equal((await diagnostics.json() as any).diagnostics.databases[0].status, "ok");
  } finally { sql.close(); }
});
