import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { calculateTradePlan, parseWorkspaceSaved, EMPTY_WORKSPACE_SAVED, readWorkspaceRoute, workspaceHref, parseWorkspaceHistory, deriveWorkspaceEvidence, parseWorkspaceQuotes } from "../src/lib/watcher-workspace";
import { persistWorkspaceSaved, createWorkspaceClient } from "../src/hooks/use-watcher-workspace";
import { reservePublicCounter, reservePublicAiAttempt, reservePublicR2Read } from "../src/lib/public-research-budget";
import { callFreeResearchModel } from "../functions/api/research/free-model";
import { runPublicReport } from "../functions/api/research/report";
import { onRequest as middleware } from "../functions/api/_middleware";
import { onRequest as marketContextApi } from "../functions/api/market-context";
import { buildMarketContext, validateMarketContext } from "../src/lib/market-context";
import type { D1DatabaseLike } from "../src/lib/spx-recap-d1";
import type { MarketBreadthSnapshot } from "../src/lib/market-breadth";
import { quoteRowFromYahooChartResult, NativeStocksYahooClient } from "../src/lib/stocks-native-yahoo";
import { validateResearchReport } from "../src/lib/research-report";
import { buildStocksWatcherSnapshotFromNative } from "../src/lib/stocks-intelligence-watcher";

function sqliteD1() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("../migrations/0009_market_data_cache.sql", import.meta.url), "utf8"));
  const db: D1DatabaseLike = { prepare(query) {
    const stmt = sql.prepare(query); let values: any[] = [];
    const prepared = {
      bind(...params: unknown[]) { values = params; return prepared; },
      async first<T>() { return stmt.get(...values) as T || null; },
      async all<T>() { return { results: stmt.all(...values) as T[] }; },
      async run() { const result = stmt.run(...values); return { meta: { rows_read: 1, rows_written: Number(result.changes) } }; },
    }; return prepared;
  } };
  return { db, sql };
}

test("long/short scenarios use whole shares and reject invalid risk or target geometry", () => {
  const long = { entry: 100, stop: 95, target: 110, riskBudget: 103, direction: "long" as const };
  assert.deepEqual(calculateTradePlan(long), { shares: 20, actualRisk: 100, position: 2000, riskPerShare: 5, rewardRisk: 2 });
  assert.equal(calculateTradePlan({ ...long, direction: "short", stop: 105, target: 90 }).rewardRisk, 2);
  assert.equal(calculateTradePlan({ ...long, target: null }).rewardRisk, null);
  assert.equal(calculateTradePlan({ ...long, entry: 100, stop: 99.99, target: null, riskBudget: 1 }).shares, 100);
  assert.equal(calculateTradePlan({ ...long, entry: 100, stop: 99.99, target: null, riskBudget: 1 }).actualRisk, 1);
  for (const patch of [{ entry: 0 }, { stop: 100 }, { stop: 105 }, { target: 90 }, { target: NaN }, { riskBudget: 1 }, { entry: Infinity }]) assert.throws(() => calculateTradePlan({ ...long, ...patch }));
});

test("saved imports are validated as a unit; corruption never becomes empty persisted data", () => {
  assert.deepEqual(parseWorkspaceSaved(EMPTY_WORKSPACE_SAVED), EMPTY_WORKSPACE_SAVED);
  for (const value of [null, { version: 2 }, { ...EMPTY_WORKSPACE_SAVED, plans: [{}] }, { ...EMPTY_WORKSPACE_SAVED, customSymbols: ["<script>"] }, { ...EMPTY_WORKSPACE_SAVED, tags: { NVDA: "Buy" } }]) assert.throws(() => parseWorkspaceSaved(value));
});

test("workspace persistence preserves corrupt data and commits before reporting success", () => {
  let writes = 0;
  const storage = { setItem: (_key: string, _value: string) => { writes++; } };
  const blocked = persistWorkspaceSaved(storage, EMPTY_WORKSPACE_SAVED, true);
  assert.equal(blocked.saved, null); assert.equal(blocked.error, "Saved workspace is invalid. Export it or replace it before saving."); assert.equal(writes, 0);
  const replaced = persistWorkspaceSaved(storage, EMPTY_WORKSPACE_SAVED, true, true);
  assert.deepEqual(replaced.saved, EMPTY_WORKSPACE_SAVED); assert.equal(replaced.error, null); assert.equal(writes, 1);
  const failed = persistWorkspaceSaved({ setItem: () => { throw new Error("quota exceeded"); } }, EMPTY_WORKSPACE_SAVED, false);
  assert.equal(failed.saved, null); assert.equal(failed.error, "Workspace changes were not saved on this browser. Export your workspace before closing."); assert.equal(failed.detail, "quota exceeded");
});

test("workspace navigation preserves ticker, range and tab without consuming legacy SPX/Portfolio parameters", () => {
  const route = readWorkspaceRoute("#/work/stocks-intelligence-watcher?view=research&symbol=MSFT&tab=Options&range=1y");
  assert.deepEqual(readWorkspaceRoute(workspaceHref(route, { section: "plans" })), { ...route, section: "plans" });
  assert.equal(readWorkspaceRoute("#/work/finance-analyzer?symbol=AAPL").section, "research");
  assert.equal(readWorkspaceRoute("#/work/trading-agent-dashboard").tab, "Report");
  assert.equal(readWorkspaceRoute("#/work/sector-rotation").market, "rotation");
  assert.equal(readWorkspaceRoute("#/work/spx-gex-heatmap?mode=pinned&date=2026-10-23&snapshot=example&view=pressure&range=4h", "MSFT").symbol, "MSFT");
  assert.equal(readWorkspaceRoute("#/work/portfolio-backtest?v=1&asset=VTI:10000", "MSFT").section, "portfolio");
  assert.throws(() => readWorkspaceRoute("#/work/stocks-intelligence-watcher?view=bad"));
});

test("invalid OHLC bars are excluded visibly and invalidate derived metrics", () => {
  const good = { date: "2026-10-22", open: 100, high: 105, low: 98, close: 102, volume: 1000 };
  const parsed = parseWorkspaceHistory({ source: "native_yahoo", history: [good, { ...good, date: "2026-10-23", high: 80 }] });
  assert.equal(parsed.rejected, 1); assert.equal(parsed.bars.length, 1);
  assert.equal(deriveWorkspaceEvidence(parsed.bars, parsed.rejected).atr14, null);
  assert.throws(() => parseWorkspaceHistory({ history: [{ ...good, close: null }] }));
  const quote = parseWorkspaceQuotes({ source: "native_yahoo", quotes: [{ symbol: "NVDA", currency: "USD", price: 200, changePercent: null, change: null, asOf: null }] })[0];
  assert.equal(quote.changePercent, null); assert.equal(quote.asOf, null);
  const missingChange = quoteRowFromYahooChartResult("NVDA", { meta: { regularMarketPrice: 200, currency: "USD" }, timestamp: [], indicators: { quote: [{}] } });
  assert.equal(parseWorkspaceQuotes({ source: "native_yahoo", quotes: [missingChange] })[0].changePercent, null);
  assert.equal(missingChange.change, null); assert.equal(missingChange.previousClose, null); assert.equal(missingChange.volume, null);
  assert.equal(parseWorkspaceHistory({ source: "native_yahoo", history: [good, null], rejected_bar_count: 2 }).rejected, 3);
  assert.throws(() => parseWorkspaceQuotes({ source: "unknown", quotes: [missingChange] }), /source/);
  for (const currency of ["", "US", "invalid"]) assert.throws(() => parseWorkspaceQuotes({ source: "native_yahoo", quotes: [{ ...missingChange, currency }] }), /currency/);
  assert.throws(() => parseWorkspaceHistory({ source: "unknown", ticker: "NVDA", history: [good] }, "NVDA"), /source/);
  assert.throws(() => parseWorkspaceHistory({ source: "native_yahoo", ticker: "AAPL", history: [good] }, "NVDA"), /ticker/);
});

test("Refresh cancels active and queued requests and prevents late responses restoring old caches", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
  const pending: Array<{ signal: AbortSignal; resolve: (response: Response) => void }> = [];
  let immediate = false; let calls = 0;
  globalThis.fetch = ((_url, init) => {
    calls++;
    if (immediate) return Promise.resolve(Response.json({ ok: true, raw: { revision: "new" }, symbol: "NVDA", quote: { price: 200 } }));
    return new Promise<Response>(resolve => pending.push({ signal: init!.signal!, resolve }));
  }) as typeof fetch;
  try {
    const client = createWorkspaceClient();
    const one = assert.rejects(client.tool("get_quotes", { tickers: "NVDA" }), { name: "AbortError" });
    const two = assert.rejects(client.tool("get_stock_history", { ticker: "NVDA" }), { name: "AbortError" });
    const queued = assert.rejects(client.tool("get_quotes", { tickers: "AAPL" }), { name: "AbortError" });
    assert.equal(calls, 2);
    client.invalidate();
    assert.ok(pending.every(row => row.signal.aborted));
    pending.splice(0).forEach(row => row.resolve(Response.json({ ok: true, raw: { revision: "old" } })));
    await Promise.all([one, two, queued]);
    assert.equal(calls, 2);
    immediate = true;
    assert.deepEqual((await client.tool("get_quotes", { tickers: "NVDA" })).raw, { revision: "new" });
    await client.tool("get_quotes", { tickers: "NVDA" }); assert.equal(calls, 3);
    immediate = false;
    const oldSnapshot = assert.rejects(client.optionsSnapshot("NVDA"), { name: "AbortError" });
    client.invalidate();
    assert.ok(pending[0].signal.aborted);
    pending.shift()!.resolve(Response.json({ symbol: "NVDA", quote: { price: 100 } }));
    await oldSnapshot;
    immediate = true;
    assert.equal((await client.optionsSnapshot("NVDA")).quote.price, 200);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
  }
});

test("atomic counters enforce concurrent reservations, monotonic UTC resets and corrupt-state fail closed", async () => {
  const { db, sql } = sqliteD1();
  const now = new Date("2026-10-24T12:00:00Z");
  const results = await Promise.allSettled(Array.from({ length: 30 }, () => reservePublicCounter(db, "race", "2026-10-24", 10, 1, now)));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 10);
  assert.equal((JSON.parse((sql.prepare("SELECT payload_json FROM market_cache_entries WHERE cache_key = '__public_limit__:race'").get() as any).payload_json)).used, 10);
  assert.equal((await reservePublicCounter(db, "race", "2026-10-25", 10, 1, new Date("2026-10-25T12:00Z"))).used, 1);
  await assert.rejects(reservePublicCounter(db, "race", "2026-10-24", 10, 1, now));
  sql.exec("UPDATE market_cache_entries SET payload_json = '{}' WHERE cache_key = '__public_limit__:race'");
  await assert.rejects(reservePublicCounter(db, "race", "2026-10-26", 10, 1, new Date("2026-10-26T12:00Z")));
  await assert.rejects(reservePublicCounter(undefined, "test", "2026-10-24", 10));
  sql.close();
});

test("AI enforces 40/day and 10/minute, and public R2 reads use the same D1 safety allowance", async () => {
  const { db, sql } = sqliteD1();
  for (let index = 0; index < 40; index++) await reservePublicAiAttempt(db, new Date(Date.UTC(2026, 9, 24, 12, index)));
  await assert.rejects(reservePublicAiAttempt(db, new Date("2026-10-24T14:00Z")));
  for (let index = 0; index < 10; index++) await reservePublicAiAttempt(db, new Date("2026-10-25T12:00Z"));
  await assert.rejects(reservePublicAiAttempt(db, new Date("2026-10-25T12:00Z")));
  await reservePublicR2Read(db, new Date("2026-10-25T12:00Z"));
  sql.exec(`UPDATE market_cache_entries SET payload_json = '{"window":"2026-10","used":2000000}' WHERE cache_key = '__public_limit__:r2-month'`);
  for (let index = 0; index < 31; index++) await reservePublicR2Read(db, new Date("2026-10-25T12:00Z"));
  await assert.rejects(reservePublicR2Read(db, new Date("2026-10-25T12:00Z")));
  sql.close();
});

test("public model pins free routing, bounds output/time, rejects paid config and never retries provider failures", async () => {
  const { db, sql } = sqliteD1(); const original = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = (async (_url, init) => { calls++; const body = JSON.parse(init!.body as string); assert.equal(body.model, "openrouter/free"); assert.equal(body.max_tokens, 1536); assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0 }); assert.ok(init?.signal); return new Response("{}", { status: 429 }); }) as typeof fetch;
    await assert.rejects(callFreeResearchModel({ MARKET_CACHE_DB: db, OPENROUTER_API_KEY: "test-key", PUBLIC_RESEARCH_MODEL: "openai/paid" }, []), /not verified free/);
    assert.equal(calls, 0);
    await assert.rejects(callFreeResearchModel({ MARKET_CACHE_DB: db, OPENROUTER_API_KEY: "test-key", OPENROUTER_MODEL: "legacy/paid" }, []), /No retry/);
    assert.equal(calls, 1);
    await assert.rejects(callFreeResearchModel({ OPENROUTER_API_KEY: "test-key" }, [])); assert.equal(calls, 1);
  } finally { globalThis.fetch = original; sql.close(); }
});

test("reports cache only server evidence and reuse one generation across public report lenses' legacy routes", async () => {
  const { db, sql } = sqliteD1(); const original = globalThis.fetch; let models = 0;
  const quoteAsOf = "2026-10-23T20:00:00Z";
  const timestamps = Array.from({ length: 70 }, (_, i) => Math.floor(Date.parse("2026-08-01T20:00Z") / 1000) + i * 86400);
  const chart = { chart: { result: [{ meta: { regularMarketPrice: 200, regularMarketTime: Date.parse(quoteAsOf) / 1000, regularMarketPreviousClose: 198, symbol: "NVDA", currency: "USD" }, timestamp: timestamps, indicators: { quote: [{ open: timestamps.map(() => 199), high: timestamps.map(() => 202), low: timestamps.map(() => 198), close: timestamps.map(() => 200), volume: timestamps.map(() => 1000) }] } }] } };
  try {
    globalThis.fetch = (async (input, init) => {
      if (String(input).includes("openrouter.ai")) { models++; const body = JSON.parse(init!.body as string); assert.ok(!JSON.stringify(body).includes("my private thesis")); assert.equal(body.response_format.type, "json_schema"); assert.deepEqual(body.response_format.json_schema.schema.properties["zh-TW"].properties.summary.properties.sourceIds.items.enum, ["Q", "T"]); const claim = { text: "Price evidence is dated; published financials are unavailable.", sourceIds: ["Q", "T"] }; const sections = { summary: claim, support: [claim], counterchecks: [claim], risks: [claim] }; return Response.json({ choices: [{ message: { content: JSON.stringify({ "zh-TW": sections, en: sections }) }, finish_reason: "stop" }], model: "nvidia/nemotron-3.5-super-vl:free", usage: { cost: 0 } }); }
      assert.match(String(input), /yahoo\.com/); return Response.json(chart);
    }) as typeof fetch;
    const request = new Request("https://example.test/api/research/report");
    const first = await runPublicReport(request, { MARKET_CACHE_DB: db, OPENROUTER_API_KEY: "test-key", VALUATION_DATA: { get: async () => null } }, { symbol: "NVDA" });
    const second = await runPublicReport(request, { MARKET_CACHE_DB: db, OPENROUTER_API_KEY: "test-key", VALUATION_DATA: { get: async () => null } }, { symbol: "NVDA" });
    assert.equal(first.content, second.content); assert.equal(second.cache.status, "hit"); assert.equal(models, 1);
    assert.ok(first.gaps.length); assert.equal(first.sources[0].asOf, new Date(quoteAsOf).toISOString());
  } finally { globalThis.fetch = original; sql.close(); }
});

test("structured reports reject fabricated source IDs, extra fields and unsafe content", () => {
  const claim = { text: "Evidence requires a countercheck.", sourceIds: ["T"] };
  const report = { summary: claim, support: [claim], counterchecks: [claim], risks: [claim] };
  assert.ok(validateResearchReport(report, ["Q", "T"]));
  assert.throws(() => validateResearchReport({ ...report, score: 90 }, ["Q", "T"]));
  assert.throws(() => validateResearchReport({ ...report, support: [{ ...claim, sourceIds: ["F"] }] }, ["Q", "T"]));
  assert.throws(() => validateResearchReport({ ...report, summary: { ...claim, text: "![image](https://untrusted.test)" } }, ["Q", "T"]));
});

test("options bootstrap loads only quote, chain and GEX without unrelated market/report requests", async () => {
  const called: string[] = [];
  const load = async (name: string) => { called.push(name); return { text: "", raw: name === "get_quotes" ? { quotes: [{ symbol: "NVDA", price: 200, change: 1, changePercent: .5 }] } : { symbol: "NVDA", spot: 200, expiries: ["2026-10-30"], selectedExpiry: "2026-10-30", calls: [], puts: [] } }; };
  const result = await buildStocksWatcherSnapshotFromNative("NVDA", { listTools: async () => [], callTool: load, callToolText: async name => (await load(name)).text }, undefined, { surface: "options" });
  assert.equal(result.symbol, "NVDA"); assert.equal(result.gexRegime, "Unavailable");
  assert.ok(called.length <= 3); assert.ok(called.every(name => ["get_quotes", "get_options", "get_options_gex"].includes(name)));
  assert.equal(result.history.length, 0);
});

test("middleware guards each actual read once, reuses wrappers and caches before R2", async () => {
  const { db, sql } = sqliteD1(); let reads = 0; let cached: Response | null = null;
  const oldCaches = (globalThis as any).caches;
  (globalThis as any).caches = { default: { match: async () => cached?.clone(), put: async (_request: Request, response: Response) => { cached = response; } } };
  const store = { get: async () => { reads++; return { text: async () => "{}" }; } };
  const env = { MARKET_CACHE_DB: db, MARKET_BREADTH_DATA: store };
  const pending: Promise<unknown>[] = [];
  const context = { request: new Request("https://example.test/api/market-context"), env, waitUntil: (p: Promise<unknown>) => pending.push(p), next: async () => { await env.MARKET_BREADTH_DATA.get(); return new Response("ok", { headers: { "Cache-Control": "public, max-age=60" } }); } };
  try {
    await middleware(context); await Promise.all(pending); await middleware(context); assert.equal(reads, 1);
    cached = null; await middleware(context); await Promise.all(pending); assert.equal(reads, 2);
    const row = sql.prepare("SELECT payload_json FROM market_cache_entries WHERE cache_key = '__public_limit__:r2-month'").get() as any;
    assert.equal(JSON.parse(row.payload_json).used, 32);
    sql.exec(`UPDATE market_cache_entries SET payload_json = json_set(payload_json, '$.used', 2000000) WHERE cache_key = '__public_limit__:r2-month'`);
    for (let index = 0; index < 30; index++) { cached = null; await middleware(context); await Promise.all(pending); }
    cached = null; const denied = await middleware(context); assert.equal(denied.status, 429); assert.equal(reads, 32);
  } finally { (globalThis as any).caches = oldCaches; sql.close(); }
});

test("market summary excludes missing breadth, remains compact, and fails missing/invalid publication explicitly", async () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({ sector: `Sector ${i}`, windows: { sma200: { above: 5, eligible: 8, total: 10, pct: 62.5 } } }));
  const source = { snapshotId: "id", priceAsOf: "2026-10-22", holdingsAsOf: "2026-10-22", generatedAt: "2026-10-23T18:00Z", universeCount: 110, sectorPerformance: { benchmark: { symbol: "SPY", oneDay: 1 }, rows: rows.map((row, i) => ({ sector: row.sector, etf: `X${i}`, oneDay: null, oneMonth: 1 })) }, breadth: { rows }, warnings: [] } as unknown as MarketBreadthSnapshot;
  const summary = validateMarketContext(buildMarketContext(source, null));
  assert.equal(summary.participation.pct, 62.5); assert.equal(summary.participation.eligible, 88); assert.equal(summary.sectors[0].oneDay, null); assert.ok(JSON.stringify(summary).length < 30000);
  const missing = await marketContextApi({ request: new Request("https://example.test/api/market-context"), env: { MARKET_BREADTH_DATA: { get: async () => null, put: async () => undefined } } });
  assert.equal(missing.status, 404);
  assert.throws(() => validateMarketContext({ ...summary, participation: { ...summary.participation, pct: 100 } }));
});

test("quote batches isolate one failed ticker and never exceed two provider requests at a time", async () => {
  const original = globalThis.fetch; let active = 0; let peak = 0; let count = 0;
  try {
    globalThis.fetch = (async input => {
      count++; active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 3)); active--;
      if (String(input).includes("/BAD?")) return new Response("Unavailable", { status: 404 });
      return Response.json({ chart: { result: [{ meta: { symbol: decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1)!), currency: "USD", regularMarketPrice: 100, regularMarketPreviousClose: 99, regularMarketTime: 1792785600 }, timestamp: [1792785600], indicators: { quote: [{ close: [100], volume: [1000] }] } }] } });
    }) as typeof fetch;
    const client = new NativeStocksYahooClient();
    const result = await client.callTool("get_quotes", { tickers: "NVDA,BAD,MSFT" });
    const raw = result.raw as { quotes: Array<{ symbol: string }>; errors: Array<{ symbol: string }>; partial: boolean };
    assert.deepEqual(raw.quotes.map(row => row.symbol), ["NVDA", "MSFT"]); assert.equal(raw.errors[0].symbol, "BAD"); assert.equal(raw.partial, true); assert.ok(peak <= 2);
    const before = count;
    await assert.rejects(client.callTool("get_quotes", { tickers: Array.from({ length: 21 }, (_, i) => `TEST${i}`).join(",") }), /at most 20/); assert.equal(count, before);
  } finally { globalThis.fetch = original; }
});

test("concurrent R2 reads reserve bounded batches rather than writing once per read", async () => {
  const { db, sql } = sqliteD1();
  try {
    await Promise.all(Array.from({ length: 80 }, () => reservePublicR2Read(db, new Date("2026-10-24T12:00Z"))));
    const row = sql.prepare("SELECT payload_json FROM market_cache_entries WHERE cache_key = '__public_limit__:r2-month'").get() as any;
    assert.equal(JSON.parse(row.payload_json).used, 96);
  } finally { sql.close(); }
});

test("market context validates the paired pointer in exactly two reads without loading full rotation", async () => {
  const now = "2026-10-23T22:00:00.000Z";
  const summary = { schemaVersion: 1, snapshotId: "summary-id", priceAsOf: "2026-10-23", holdingsAsOf: "2026-10-23", generatedAt: now, benchmark: { symbol: "SPY", oneDay: 1 }, participation: { above: 50, eligible: 80, total: 100, pct: 62.5 }, sectors: Array.from({ length: 11 }, (_, i) => ({ etf: `X${i}`, sector: `Sector ${i}`, oneDay: null, oneMonth: 2, relativeOneMonth: null, quadrant: "Unavailable" })), warnings: [] };
  const status = { schemaVersion: 1, state: { key: "market-breadth/state/prices-a.json", updatedAt: now }, current: { releaseId: "r1", snapshotId: summary.snapshotId, snapshotKey: "market-breadth/snapshots/snapshot-a.json", stateKey: "market-breadth/state/prices-a.json", priceAsOf: summary.priceAsOf, holdingsAsOf: summary.holdingsAsOf, publishedAt: now, contextKey: "market-context/summary-a.json" }, lastAttempt: { runId: "r1", status: "READY", startedAt: now, finishedAt: now, priceAsOf: summary.priceAsOf, errorClass: null } };
  const reads: string[] = [];
  const objects = new Map([["market-breadth/status.json", JSON.stringify(status)], [status.current.contextKey, JSON.stringify(summary)]]);
  const store = { get: async (key: string) => { reads.push(key); return { text: async () => objects.get(key)! }; }, put: async () => undefined };
  const response = await marketContextApi({ request: new Request("https://example.test/api/market-context"), env: { MARKET_BREADTH_DATA: store }, now: new Date(now) });
  assert.equal(response.status, 200); assert.deepEqual(reads, ["market-breadth/status.json", "market-context/summary-a.json"]);
  objects.set(status.current.contextKey, JSON.stringify({ ...summary, snapshotId: "wrong-version" }));
  assert.equal((await marketContextApi({ request: new Request("https://example.test/api/market-context"), env: { MARKET_BREADTH_DATA: store } })).status, 502);
});
