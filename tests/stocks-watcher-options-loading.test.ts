import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { getStocksWatcherOptionsSubTabCacheKey, getStocksWatcherOptionsSubTabToolPlan } from "../src/lib/stocks-intelligence-watcher-session";

// Execute the real React callbacks without importing browser-only CSS/chart modules.
const source = ts.createSourceFile("watcher.tsx", readFileSync(new URL("../src/components/stocks-intelligence-watcher-page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name: string, bindings: Record<string, unknown>): (...args: any[]) => any {
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer)) expression = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(expression, `Missing actual callback ${name}`);
  return runInNewContext(ts.transpile(`(${expression.getText(source)})`, { target: ts.ScriptTarget.ES2022 }), bindings);
}
function deferred() {
  let resolve!: (value: any) => void, reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const states: any[] = [], tabDataCache = { current: new Map() }, optionsSubTabRequestRef = { current: 0 };
  const pending = new Map([["2026-11-04", deferred()], ["2026-11-06", deferred()]]);
  const load = (expiry: string) => callback("loadOptionsSubTab", {
    selectedSymbol: "NVDA", currentExpiry: expiry, normalizeSymbol: (value: string) => value,
    tabDataCache, optionsSubTabRequestRef, getStocksWatcherOptionsSubTabCacheKey, getStocksWatcherOptionsSubTabToolPlan,
    runToolBundle: (plans: any[]) => pending.get(plans[0].params.expiry)!.promise,
    setSubTabPanelState: (state: unknown) => states.push(state),
  });
  return { states, tabDataCache, pending, load };
}
for (const outcome of ["success", "error", "cached-newer"] as const) test(`options ignores a superseded ${outcome} response`, async () => {
  const run = setup(), older = run.load("2026-11-04")("Chain");
  if (outcome === "cached-newer") run.tabDataCache.current.set(getStocksWatcherOptionsSubTabCacheKey("NVDA", "2026-11-06", "Chain"), { data: { expiry: "2026-11-06" } });
  const newer = run.load("2026-11-06")("Chain");
  run.pending.get("2026-11-06")!.resolve({ expiry: "2026-11-06" }); await newer;
  if (outcome === "error") run.pending.get("2026-11-04")!.reject(new Error("Old expiry failed"));
  else run.pending.get("2026-11-04")!.resolve({ expiry: "2026-11-04" });
  await older;
  assert.equal(run.states.at(-1).data?.expiry, "2026-11-06");
  assert.equal(run.states.at(-1).error, null);
  assert.equal(run.states.at(-1).loading, false);
});
test("reselecting current options expiry preserves its loaded panel and deep link", () => {
  const cleared: unknown[] = [], links: string[] = [];
  const select = callback("selectOptionsExpiry", {
    currentExpiry: "2026-11-02", activeSubTab: "Chain", normalizeExpiryDate: (value: string) => value,
    setSelectedExpiry: () => undefined, onEmbeddedExpiryChange: (value: string) => links.push(value),
    setChartSelectedExpiries: () => undefined, setChartExpiryMenuOpen: () => undefined, setChartTooltip: () => undefined,
    setSubTabPanelState: (value: unknown) => cleared.push(value),
  });
  select("2026-11-02"); assert.equal(cleared.length, 0); assert.deepEqual(links, ["2026-11-02"]);
  select("2026-11-04"); assert.equal(cleared.length, 1);
});
