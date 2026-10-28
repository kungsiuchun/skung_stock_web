import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { BoundedBodyError, readBoundedText, fetchBoundedText } from "../src/lib/bounded-body";
import { validateMarketContext } from "../src/lib/market-context";
import { MARKET_BREADTH_SECTORS } from "../src/lib/market-breadth";
import { validateMarketBreadthStatus, MARKET_BREADTH_STATE_KEYS } from "../src/lib/market-breadth-r2";
import { callResearchModel } from "../functions/api/research/model";
import { loadResearchEvidence, projectResearchTechnicals, researchNarrativeEvidence, readResearchBody, onRequestPost as report } from "../functions/api/research/report";
import { publicResearchChat as chat } from "../functions/api/research/chat-service";
import { onRequestPost as admin } from "../functions/api/stocks-intelligence-watcher/admin";
import { onRequest as watcher } from "../functions/api/stocks-intelligence-watcher";
import { renderResearchDataFacts, renderResearchReport, researchReportSchema, validateResearchClaim, validateResearchReport } from "../src/lib/research-report";
import { deriveWorkspaceEvidence } from "../src/lib/watcher-workspace";
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

test("research range facts distinguish an inside close from a percentage below the range", () => {
  const bars = Array.from({ length: 20 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, "0")}`, open: 211, high: 243.37, low: 210.18, close: 210.96, volume: 100 }));
  const technical = projectResearchTechnicals(deriveWorkspaceEvidence(bars), 210.96, "USD");
  const range = technical.dailyRange20;
  assert.equal(range.closeRelation, "inside_observed_range");
  assert.ok(Math.abs(range.positionPercentFromLow! - 2.3501054534504) < .00001);
  assert.ok(Math.abs(range.priceAboveLow! - .78) < .000001);
  assert.ok(Math.abs(range.priceBelowHigh! - 32.41) < .000001);
  assert.ok(!("rangePositionPct" in technical)); assert.ok(!("bars" in technical));
  const claim = { text: "The dated close is near the lower end of its observed range.", sourceIds: ["T"] };
  const content = renderResearchReport({ summary: claim, support: [claim], counterchecks: [claim], risks: [claim] }, { symbol: "NVDA", language: "en", quote: 220, currency: "USD", quoteAsOf: "2026-10-21T15:00Z", priceAsOf: "2026-10-20", range20: range, gaps: [] });
  assert.match(content, /Verified quote: USD 220/); assert.match(content, /last close 210.96 is inside the range/); assert.match(content, /position from low 2.35%/);
  const missing = projectResearchTechnicals(deriveWorkspaceEvidence(bars.slice(0, 10)), 210.96, "USD").dailyRange20;
  assert.equal(missing.closeRelation, "unavailable"); assert.equal(missing.positionPercentFromLow, null);
  const flat = bars.map(row => ({ ...row, open: 100, high: 100, low: 100, close: 100 }));
  const flatRange = projectResearchTechnicals(deriveWorkspaceEvidence(flat), 100, "USD").dailyRange20;
  assert.equal(flatRange.closeRelation, "inside_observed_range"); assert.equal(flatRange.positionPercentFromLow, null); assert.equal(flatRange.priceAboveLow, 0);
  assert.throws(() => projectResearchTechnicals(deriveWorkspaceEvidence(bars), 200, "USD"), /outside/);
});

test("qualitative interpretation rejects numeric restatements without rejecting ordinary words", () => {
  const claim = (text: string) => ({ text, sourceIds: ["T"] });
  for (const text of ["Price is 2.35% below its range.", "Price is ２．３５％ below its range.", "The filing is two months old.", "資料落後兩個月。", "現金流為一百億元。", "The statement is as of July.", "Revenue grew ٢ percent.", "營收增長百分之二。", "There is a two-month reporting lag.", "Revenue rose twenty percent.", "Revenue rose twenty-five percent.", "Revenue rose one million.", "Quarter Ⅲ was stronger."])
    assert.throws(() => validateResearchClaim(claim(text), ["T"], true), /qualitative/);
  for (const text of ["數據一致，但一般解讀仍需核對。", "營運現金流較前一季下降。", "營運現金流較上一季度下降。", "One concern is missing cash-flow context.", "May remain uncertain without dated financials."])
    assert.equal(validateResearchClaim(claim(text), ["T"], true).text, text);
});

test("structured prose limits match runtime lengths and keep one claim in each section", () => {
  const claim = { text: "甲".repeat(80), sourceIds: ["T"] };
  assert.ok(validateResearchClaim(claim, ["T"], true));
  assert.throws(() => validateResearchClaim({ ...claim, text: "甲".repeat(81) }, ["T"], true));
  assert.ok(validateResearchClaim({ ...claim, text: "a".repeat(320) }, ["T"], true, 320));
  assert.throws(() => validateResearchClaim({ ...claim, text: "a".repeat(321) }, ["T"], true, 320));
  const schema = researchReportSchema(["T"], true);
  assert.equal(schema.properties.summary.properties.text.maxLength, 80);
  assert.equal(schema.properties.support.maxItems, 1);
  assert.equal(researchReportSchema(["T"], true, 320).properties.summary.properties.text.maxLength, 320);
  const sections = { summary: claim, support: [claim], counterchecks: [claim], risks: [claim] };
  assert.ok(validateResearchReport(sections, ["T"], true));
  assert.throws(() => validateResearchReport({ ...sections, risks: [claim, claim] }, ["T"], true));
});

test("program facts preserve zero and unavailable financial currency instead of assuming quote currency", () => {
  const content = renderResearchDataFacts({ symbol: "NVDA", language: "en", quote: 210.96, currency: "USD", quoteAsOf: "2026-10-23T20:00Z", priceAsOf: "2026-10-23", gaps: [],
    quarters: [{ date: "2026-07-26", currency: null, revenue: 0, netIncome: null, operatingCashFlow: 100, freeCashFlow: -10, eps: null }] });
  assert.match(content, /revenue 0 \(currency unavailable\)/); assert.match(content, /net income Unavailable/);
  assert.match(content, /operating cash flow 100 \(currency unavailable\)/); assert.ok(!content.includes("revenue USD"));
  const input = { symbol: "NVDA", quote: { asOf: "2026-10-23T20:00Z", changePercent: 0 },
    technical: { dailyRange20: { closeRelation: "unavailable", dailyClose: 100, priceAboveLow: null, priceBelowHigh: null }, sma20: null, sma50: null, sma200: null, relativeVolume: null, invalidBarCount: 0 },
    financials: { financialSource: { dataAsOf: "2026-07-26" }, quarters: [{ currency: null, revenue: 200 }, { currency: "USD", revenue: 100 }] }, sources: [] } as unknown as Parameters<typeof researchNarrativeEvidence>[0];
  assert.equal(researchNarrativeEvidence(input).financialEvidence.versusPreviousPublishedQuarter.revenue, "unavailable");
  input.financials!.quarters[0].currency = "USD";
  assert.equal(researchNarrativeEvidence(input).financialEvidence.versusPreviousPublishedQuarter.revenue, "higher");
});

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
    const env = { MARKET_CACHE_DB: db, OPENROUTER_API_KEY: "fixture-only", PUBLIC_RESEARCH_MODEL: "openrouter/free", VALUATION_DATA: { get: async () => null } };
    let expired = false; let modelCalls = 0;
    globalThis.fetch = (async url => {
      if (String(url).includes("openrouter.ai")) {
        modelCalls++;
        if (expired) return new Response("Quota reached", { status: 429 });
        const sections = { summary: claim, support: [claim], counterchecks: [claim], risks: [claim] };
        return mode === "report-envelope" ? new Response("{broken") : envelope(mode === "chat-content" ? "{broken" : JSON.stringify({ "zh-TW": sections, en: sections }));
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
    await assert.rejects(callResearchModel({ ...env, PUBLIC_RESEARCH_MODEL: "invented/model:free" }, []), /not approved/); assert.equal(calls, 0);
    for (const invalid of [{ model: "paid/provider", usage: { cost: 0 } }, { usage: { cost: 0 } }, { model, usage: {} }, { model, usage: { cost: "0" } }, { model, usage: { cost: 1 } }, { model, usage: { cost: null } }, { model, usage: { cost: 0, cost_details: { upstream_inference_cost: 1 } } }]) {
      payload = invalid; await assert.rejects(callResearchModel(env, []), /unverified|reserved budget/);
    }
    payload = { model, usage: { cost: 0, cost_details: { upstream_inference_cost: null } } };
    assert.equal((await callResearchModel(env, [])).model, model); assert.equal(calls, 8);
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
