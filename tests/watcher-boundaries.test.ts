import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { BoundedBodyError, readBoundedText, fetchBoundedText } from "../src/lib/bounded-body";
import { validateMarketContext } from "../src/lib/market-context";
import { MARKET_BREADTH_SECTORS } from "../src/lib/market-breadth";
import { validateMarketBreadthStatus, MARKET_BREADTH_STATE_KEYS } from "../src/lib/market-breadth-r2";
import { callFreeResearchModel } from "../functions/api/research/free-model";
import { loadResearchEvidence, readResearchBody, onRequestPost as report } from "../functions/api/research/report";
import { publicResearchChat as chat } from "../functions/api/research/chat-service";
import { onRequestPost as admin } from "../functions/api/stocks-intelligence-watcher/admin";
import { onRequest as watcher } from "../functions/api/stocks-intelligence-watcher";
import { validateResearchClaim } from "../src/lib/research-report";
import type { D1DatabaseLike } from "../src/lib/spx-recap-d1";
import { NativeStocksYahooClient } from "../src/lib/stocks-native-yahoo";

const model = "nvidia/nemotron-3.5-super-vl:free";
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
const request = (tool: string, params: Record<string, unknown>) => new Request("https://example.test/api/stocks-intelligence-watcher", { method: "POST", body: JSON.stringify({ tool, params }) });

test("options reject wrong provider identities and keep missing sweep ratios distinct from genuine zero", async () => {
  const before = globalThis.fetch;
  let symbol = "AAPL", expiry = "2026-10-30", spot: number | null = 200;
  const chain = () => ({ optionChain: { result: [{ quote: { symbol, regularMarketPrice: spot }, expirationDates: [Date.parse(expiry) / 1000], options: [{ expirationDate: Date.parse(expiry) / 1000, calls: [{ strike: 180, openInterest: null, volume: 10 }], puts: [{ strike: 180, openInterest: 20, volume: null }, { strike: 185, openInterest: 20, volume: 0 }] }] }] } });
  globalThis.fetch = (async url => {
    if (String(url).startsWith("https://fc.yahoo.com")) return new Response("", { headers: { "set-cookie": "fixture-only" } });
    if (String(url).includes("/getcrumb")) return new Response("fixture-crumb");
    if (String(url).includes("/finance/options/")) return Response.json(chain());
    throw new Error("Unexpected mock route");
  }) as typeof fetch;
  try {
    const client = new NativeStocksYahooClient();
    await assert.rejects(client.callTool("get_options_sweeps", { ticker: "NVDA" }), /identity/);
    symbol = "NVDA";
    await assert.rejects(client.callTool("get_options", { ticker: "NVDA", expiry: "2026-11-06" }), /expiration/);
    spot = null;
    await assert.rejects(client.callTool("get_options", { ticker: "NVDA" }), /price/);
    spot = 200;
    const result = await client.callTool("get_options_sweeps", { ticker: "NVDA" });
    const rows = result.text.split("\n").filter(line => /^\| [CP] \|/.test(line)).map(line => line.split("|").map(cell => cell.trim()));
    assert.equal(rows.find(row => row[1] === "C")![5], "n/a");
    assert.equal(rows.find(row => row[1] === "P" && row[2] === "180")![5], "n/a");
    assert.equal(rows.find(row => row[2] === "185")![5], "0");
  } finally { globalThis.fetch = before; }
});

test("bounded reads cancel chunked oversized bodies before consuming them and retain split UTF-8", async () => {
  let pulls = 0, cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024)); }, cancel() { cancelled = true; } });
  await assert.rejects(readBoundedText(new Response(stream), 1500), error => error instanceof BoundedBodyError && error.kind === "size");
  assert.ok(cancelled); assert.ok(pulls < 10);
  const bytes = new TextEncoder().encode("中😀");
  const split = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.slice(0, 2)); controller.enqueue(bytes.slice(2)); controller.close(); } });
  assert.equal(await readBoundedText(new Response(split), bytes.length), "中😀");
  let headerCancelled = false;
  await assert.rejects(readBoundedText(new Response(new ReadableStream({ cancel() { headerCancelled = true; } }), { headers: { "Content-Length": "9000" } }), 1000), BoundedBodyError);
  assert.ok(headerCancelled);
  let invalidCancelled = false;
  const invalid = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([255])); }, cancel() { invalidCancelled = true; } });
  await assert.rejects(readBoundedText(new Response(invalid), 1000));
  assert.ok(invalidCancelled); assert.equal(invalid.locked, false);
});

test("body and upstream header deadlines reject stalled I/O without retries", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => undefined); }, cancel() { cancelled = true; } });
  await assert.rejects(readBoundedText(new Response(stream), 1000, 15), error => error instanceof BoundedBodyError && error.kind === "timeout");
  assert.ok(cancelled);
  const before = globalThis.fetch; let calls = 0;
  globalThis.fetch = ((_url, init) => { calls++; return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })); }) as typeof fetch;
  try { await assert.rejects(fetchBoundedText("https://upstream.example.test", {}, 1000, 15), error => error instanceof BoundedBodyError && error.kind === "timeout"); assert.equal(calls, 1); }
  finally { globalThis.fetch = before; }
});

test("public JSON limits reject actual chunked bytes, invalid UTF-8 and non-object JSON", async () => {
  const response = await watcher({ request: new Request("https://example.test/api", { method: "POST", body: JSON.stringify({ tool: "unknown", padding: "中".repeat(12000) }) }) });
  assert.equal(response.status, 413);
  await assert.rejects(readResearchBody(new Request("https://example.test", { method: "POST", body: new Uint8Array([255]) })), (error: any) => error.status === 400);
  await assert.rejects(readResearchBody(new Request("https://example.test", { method: "POST", body: "[]" })), (error: any) => error.status === 400);
});

test("market context, release and attempt dates accept a real leap day and reject impossible calendars", () => {
  const date = "2024-02-29";
  const context = { schemaVersion: 1, snapshotId: "fixture", priceAsOf: date, holdingsAsOf: date, generatedAt: date + "T23:00:00Z", benchmark: { symbol: "SPY", oneDay: 0 }, participation: { above: 3, eligible: 10, total: 10, pct: 30 }, sectors: MARKET_BREADTH_SECTORS.map(row => ({ ...row, oneDay: null, oneMonth: null, relativeOneMonth: null, quadrant: "Unavailable" })), warnings: [] };
  assert.equal(validateMarketContext(context).priceAsOf, date);
  const attempt = { runId: "fixture", status: "READY", startedAt: date + "T20:00:00Z", finishedAt: date + "T21:00:00Z", priceAsOf: date, errorClass: null };
  const status = { schemaVersion: 1, state: { key: MARKET_BREADTH_STATE_KEYS[0], updatedAt: date + "T21:00:00Z" }, current: { releaseId: "fixture", snapshotId: "fixture", snapshotKey: "snapshot", stateKey: "state", priceAsOf: date, holdingsAsOf: date, publishedAt: date + "T21:00:00Z" }, lastAttempt: attempt };
  assert.ok(validateMarketBreadthStatus(status));
  for (const invalid of ["2026-99-99", "2026-02-30", "2025-02-29"]) {
    assert.throws(() => validateMarketContext({ ...context, priceAsOf: invalid }));
    assert.throws(() => validateMarketContext({ ...context, holdingsAsOf: invalid }));
    assert.throws(() => validateMarketBreadthStatus({ ...status, current: { ...status.current, priceAsOf: invalid } }));
    assert.throws(() => validateMarketBreadthStatus({ ...status, lastAttempt: { ...attempt, priceAsOf: invalid } }));
    assert.throws(() => validateMarketContext({ ...context, generatedAt: invalid + "T20:00:00Z" }));
    assert.throws(() => validateMarketBreadthStatus({ ...status, state: { ...status.state, updatedAt: invalid + "T20:00:00Z" } }));
    assert.throws(() => validateMarketBreadthStatus({ ...status, current: { ...status.current, publishedAt: invalid + "T20:00:00Z" } }));
    assert.throws(() => validateMarketBreadthStatus({ ...status, lastAttempt: { ...attempt, startedAt: invalid + "T20:00:00Z" } }));
  }
});

test("valid client requests distinguish oversized/timed-out upstreams from request body failures", async () => {
  const before = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response("x", { headers: { "Content-Length": String(2 * 1024 * 1024 + 1) } })) as typeof fetch;
    assert.equal((await watcher({ request: request("get_stock_history", { ticker: "NVDA" }) })).status, 502);
    globalThis.fetch = (async () => { throw new BoundedBodyError("timeout"); }) as typeof fetch;
    assert.equal((await watcher({ request: request("get_stock_history", { ticker: "NVDA" }) })).status, 504);
    const corruptRegistry = { get: async (key: string) => key === "coverage/universe.json" ? { json: async () => JSON.parse("{broken") } : null, put: async () => { throw new Error("Corrupt publication must not be overwritten"); } };
    const response = await admin({ request: new Request("https://example.test/api/admin", { method: "POST", headers: { Authorization: "Bearer fixture-admin" }, body: JSON.stringify({ tool: "request_valuation_coverage", params: { symbol: "NVDA" } }) }), env: { STOCKS_WATCHER_ADMIN_TOKEN: "fixture-admin", VALUATION_DATA: corruptRegistry } });
    assert.equal(response.status, 502);
  } finally { globalThis.fetch = before; }
});

test("malformed model JSON stays upstream failure and expired reports retain provider quota classification", async () => {
  const before = globalThis.fetch;
  const times = Array.from({ length: 70 }, (_, i) => Date.parse("2026-08-01T20:00:00Z") / 1000 + i * 86400);
  const chart = { chart: { result: [{ meta: { symbol: "NVDA", regularMarketPrice: 200, regularMarketTime: times.at(-1), regularMarketPreviousClose: 198, currency: "USD" }, timestamp: times, indicators: { quote: [{ open: times.map(() => 199), high: times.map(() => 202), low: times.map(() => 198), close: times.map(() => 200), volume: times.map(() => 1000) }] } }] } };
  const claim = { text: "Observed dated evidence.", sourceIds: ["Q", "T"] };
  const body = () => new Request("https://example.test/api/research/report", { method: "POST", body: JSON.stringify({ symbol: "NVDA", message: "Which evidence is missing?" }) });
  const envelope = (content: string) => Response.json({ model, usage: { cost: 0 }, choices: [{ finish_reason: "stop", message: { content } }] });
  for (const mode of ["chat-content", "report-envelope", "expired"]) {
    const { db, sql } = sqlite();
    const env = { MARKET_CACHE_DB: db, OPENROUTER_API_KEY: "fixture-only", VALUATION_DATA: { get: async () => null } };
    let expired = false; let modelCalls = 0;
    globalThis.fetch = (async url => {
      if (String(url).includes("openrouter.ai")) {
        modelCalls++;
        if (expired) return new Response("Quota reached", { status: 429 });
        return mode === "report-envelope" ? new Response("{broken") : envelope(mode === "chat-content" ? "{broken" : JSON.stringify({ summary: claim, support: [claim], counterchecks: [claim], risks: [claim] }));
      }
      if (String(url).includes("/v8/finance/chart/")) return Response.json(chart);
      throw new Error("Unexpected mock route");
    }) as typeof fetch;
    try {
      const response = mode === "chat-content" ? await chat({ request: body(), env }) : await report({ request: body(), env });
      assert.equal(response.status, mode === "expired" ? 200 : 502);
      if (mode === "expired") {
        sql.prepare("UPDATE market_cache_entries SET expires_at='2000-01-01T00:00:00Z' WHERE scope='research-report-v2'").run();
        expired = true;
        assert.equal((await report({ request: body(), env })).status, 429);
      }
      assert.equal(modelCalls, mode === "expired" ? 2 : 1);
    } finally { globalThis.fetch = before; sql.close(); }
  }
});

test("free models must prove a verified returned identity and numeric zero costs, including upstream fees", async () => {
  const { db, sql } = sqlite(); const before = globalThis.fetch; let calls = 0;
  const env = { MARKET_CACHE_DB: db, OPENROUTER_API_KEY: "fixture-key", PUBLIC_RESEARCH_MODEL: model };
  let payload: any;
  globalThis.fetch = (async () => { calls++; return Response.json({ choices: [{ message: { content: "answer" }, finish_reason: "stop" }], ...payload }); }) as typeof fetch;
  try {
    await assert.rejects(callFreeResearchModel({ ...env, PUBLIC_RESEARCH_MODEL: "invented/model:free" }, []), /not verified free/); assert.equal(calls, 0);
    for (const invalid of [{ model: "paid/provider", usage: { cost: 0 } }, { usage: { cost: 0 } }, { model, usage: {} }, { model, usage: { cost: "0" } }, { model, usage: { cost: 1 } }, { model, usage: { cost: null } }, { model, usage: { cost: 0, cost_details: { upstream_inference_cost: 1 } } }]) {
      payload = invalid; await assert.rejects(callFreeResearchModel(env, []), /unverified|zero cost/);
    }
    payload = { model, usage: { cost: 0, cost_details: { upstream_inference_cost: null } } };
    assert.equal((await callFreeResearchModel(env, [])).model, model); assert.equal(calls, 8);
  } finally { globalThis.fetch = before; sql.close(); }
});

test("research claims reject fabricated inline citations, URLs, HTML and extra output fields", () => {
  assert.ok(validateResearchClaim({ text: "Observed quote is dated.", sourceIds: ["Q"] }, ["Q", "T"]));
  for (const text of ["Invented facts [F]", "Look at https://example.test", "<b>answer</b>", "[link](//example.test)"]) assert.throws(() => validateResearchClaim({ text, sourceIds: ["Q"] }, ["Q", "T"]));
  assert.throws(() => validateResearchClaim({ text: "answer", sourceIds: ["Q"], score: 90 } as any, ["Q"]));
});

test("publication failures preserve input/absence/upstream HTTP categories and never call Yahoo or a model", async () => {
  const before = globalThis.fetch; let network = 0;
  globalThis.fetch = (async () => { network++; throw new Error("Unexpected external request"); }) as typeof fetch;
  try {
    for (const tool of ["get_financial_statements", "get_valuation_bands"]) {
      const malformed = { get: async () => ({ json: async () => JSON.parse("{broken") }) };
      assert.equal((await watcher({ request: request(tool, { symbol: "NVDA" }), env: { VALUATION_DATA: malformed } })).status, 502);
      assert.equal((await watcher({ request: request(tool, { symbol: "NVDA" }) })).status, 503);
      assert.equal((await watcher({ request: request(tool, { symbol: "NVDA" }), env: { VALUATION_DATA: { get: async () => null } } })).status, 404);
    }
    assert.equal((await watcher({ request: request("get_valuation_bands", { symbol: "NVDA", metric: "invalid" }) })).status, 400);
    for (const params of [{ ticker: "NVDA", range: "invalid" }, { ticker: "NVDA", interval: "invalid" }, { ticker: "NVDA", range: null }]) assert.equal((await watcher({ request: request("get_stock_history", params) })).status, 400);
    assert.equal(network, 0);
  } finally { globalThis.fetch = before; }
});

test("financial quota and operational denials cannot become an optional report gap", async () => {
  const before = globalThis.fetch;
  const times = Array.from({ length: 70 }, (_, i) => Date.parse("2026-08-01T20:00:00Z") / 1000 + i * 86400);
  const chart = { chart: { result: [{ meta: { symbol: "NVDA", regularMarketPrice: 200, regularMarketTime: Date.parse("2026-10-23T20:00:00Z") / 1000, regularMarketPreviousClose: 198, currency: "USD" }, timestamp: times, indicators: { quote: [{ open: times.map(() => 199), high: times.map(() => 202), low: times.map(() => 198), close: times.map(() => 200), volume: times.map(() => 1000) }] } }] } };
  let models = 0;
  globalThis.fetch = (async url => { if (String(url).includes("openrouter")) { models++; throw new Error("No model allowed"); } return Response.json(chart); }) as typeof fetch;
  try {
    const { PublicResearchLimitError } = await import("../src/lib/public-research-budget");
    for (const status of [429, 503]) {
      const { db, sql } = sqlite();
      try { await assert.rejects(loadResearchEvidence(new Request("https://example.test"), { MARKET_CACHE_DB: db, VALUATION_DATA: { get: async () => { throw new PublicResearchLimitError("Fixture safety denial", status, "2026-11-01T00:00:00Z"); } } }, "NVDA"), (error: any) => error.status === status && error.retryAt === "2026-11-01T00:00:00Z"); }
      finally { sql.close(); }
    }
    assert.equal(models, 0);
  } finally { globalThis.fetch = before; }
});
