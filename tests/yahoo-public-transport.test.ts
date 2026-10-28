import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/api/fundamentals";

test("public fundamentals sends only cookie pairs and preserves its data/absence contract", async () => {
  const before = globalThis.fetch; let summary: any = { price: { symbol: "NVDA", longName: "NVIDIA", regularMarketPrice: { raw: 217.94 } } }; let crumbCalls = 0; let crumbText = "fixture/crumb+"; let crumbStatus = 200;
  globalThis.fetch = (async (url, init) => {
    if (String(url).includes("fc.yahoo.com")) return new Response("", { status: 404, headers: { "Set-Cookie": "A3=fixture; Expires=Wed, 28 Oct 2027 00:00:00 GMT; Path=/; Domain=.yahoo.com; Secure, B=second; Path=/" } });
    const cookie = new Headers(init?.headers).get("Cookie");
    if (cookie !== "A3=fixture; B=second") return new Response("Invalid cookie header", { status: 401 });
    if (String(url).includes("getcrumb")) { crumbCalls++; return new Response(crumbText, { status: crumbStatus }); }
    assert.ok(String(url).includes("crumb=fixture%2Fcrumb%2B"));
    return Response.json({ quoteSummary: { result: summary ? [summary] : [] } });
  }) as typeof fetch;
  const call = (symbol = "NVDA") => onRequest({ request: new Request("https://example.test/api/fundamentals?symbol=" + symbol) });
  try {
    for (const invalid of ["", "<html>provider error</html>", "too many requests", "x".repeat(257)]) {
      crumbText = invalid; assert.equal((await call()).status, 502);
    }
    crumbStatus = 429; assert.equal((await call()).status, 429);
    crumbStatus = 200; crumbText = "fixture/crumb+";
    const response = await call(); const body = await response.json() as any;
    assert.equal(response.status, 200); assert.equal(body.symbol, "NVDA"); assert.equal(body.current_price, "217.94");
    assert.equal(body.pe_ratio, null); assert.equal(crumbCalls, 6);
    summary = null; assert.equal((await call()).status, 404); assert.equal(crumbCalls, 6, "Reuse the verified session; invalid crumbs were never cached");
    summary = { price: { symbol: "AAPL" } }; assert.equal((await call()).status, 502);
    assert.equal((await call("NVDA%21")).status, 400);
  } finally { globalThis.fetch = before; }
});
