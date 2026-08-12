import assert from "node:assert/strict";
import test from "node:test";
import {
  CandlestickClientTimeoutError,
  fetchCandlestickAnalysis,
  getCandlestickErrorForSelection,
} from "../src/lib/candlestick-pattern-client";

test("client deadline settles a never-resolving fetch and aborts its signal", async () => {
  let requestSignal: AbortSignal | undefined;
  const startedAt = Date.now();
  await assert.rejects(
    fetchCandlestickAnalysis({
      symbol: "AAPL",
      interval: "1d",
      timeoutMs: 25,
      fetcher: (async (_input, init) => {
        requestSignal = init?.signal as AbortSignal;
        return new Promise<Response>(() => {});
      }) as typeof fetch,
    }),
    (error) => error instanceof CandlestickClientTimeoutError,
  );
  assert.equal(requestSignal?.aborted, true);
  assert.ok(Date.now() - startedAt < 250);
});

test("external abort settles even when the fetcher ignores its signal", async () => {
  const controller = new AbortController();
  const pending = fetchCandlestickAnalysis({
    symbol: "MSFT",
    interval: "1wk",
    timeoutMs: 500,
    signal: controller.signal,
    fetcher: (async () => new Promise<Response>(() => {})) as typeof fetch,
  });
  controller.abort();
  await assert.rejects(pending, (error) => error instanceof Error && error.name === "AbortError");
});

test("client accepts explicit stale 206 responses", async () => {
  const result = await fetchCandlestickAnalysis({
    symbol: "NVDA",
    interval: "1mo",
    fetcher: (async () => new Response(JSON.stringify({
      data: { schemaVersion: "v2" },
      cache: { status: "stale" },
      requestId: "req-stale",
    }), { status: 206 })) as typeof fetch,
  });
  assert.equal(result.cache.status, "stale");
  assert.equal(result.requestId, "req-stale");
});

test("client exposes request IDs for malformed JSON and HTTP failures", async () => {
  await assert.rejects(
    fetchCandlestickAnalysis({
      symbol: "TSLA",
      interval: "1d",
      fetcher: (async () => new Response("not-json", {
        status: 502,
        headers: { "X-Request-ID": "req-json" },
      })) as typeof fetch,
    }),
    /Request ID: req-json/,
  );

  await assert.rejects(
    fetchCandlestickAnalysis({
      symbol: "TSLA",
      interval: "1d",
      fetcher: (async () => new Response(JSON.stringify({
        error: "upstream failed",
        requestId: "req-http",
      }), { status: 504 })) as typeof fetch,
    }),
    /upstream failed Request ID: req-http/,
  );
});

test("request errors only render for their exact symbol and interval", () => {
  const weeklyFailure = { symbol: "NOW", interval: "1wk" as const, message: "weekly failed" };
  assert.equal(getCandlestickErrorForSelection(weeklyFailure, "NOW", "1wk"), "weekly failed");
  assert.equal(getCandlestickErrorForSelection(weeklyFailure, "NOW", "1d"), null);
  assert.equal(getCandlestickErrorForSelection(weeklyFailure, "AAPL", "1wk"), null);
});
