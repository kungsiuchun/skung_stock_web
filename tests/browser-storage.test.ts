import assert from "node:assert/strict";
import test from "node:test";
import { readBrowserJson, writeBrowserJson } from "../src/lib/browser-storage";

test("Browser storage exposes denial, malformed JSON, and quota failures without deleting data", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map([["history", "broken JSON"], ["other", "keep"]]);
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      get localStorage() { throw new DOMException("blocked", "SecurityError"); },
    } });
    assert.match(readBrowserJson("history").error!, /storage/i);
    assert.match(writeBrowserJson("history", [] )!, /not.*saved|could not.*sav/i);
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: () => { throw new DOMException("full", "QuotaExceededError"); },
    } } });
    assert.match(readBrowserJson("history").error!, /JSON/i);
    assert.equal(readBrowserJson("absent").error, null);
    assert.equal(readBrowserJson("absent").value, undefined);
    assert.ok(writeBrowserJson("history", []));
    assert.equal(values.get("history"), "broken JSON");
    assert.equal(values.get("other"), "keep");
    window.localStorage.setItem = (key, value) => { values.set(key, value); };
    assert.equal(writeBrowserJson("history", ["SPY"]), null);
    assert.deepEqual(readBrowserJson("history"), { value: ["SPY"], error: null });
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
