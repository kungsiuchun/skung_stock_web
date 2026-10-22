import assert from "node:assert/strict";
import test from "node:test";
import { newsArticlesFromResult, quotesFromResult } from "../src/components/stocks-intelligence-watcher-view-model";
import { getStocksWatcherTopTabToolPlan } from "../src/lib/stocks-intelligence-watcher-session";

test("Newsroom retains all twelve headlines, orders publication dates, and deduplicates article links", () => {
  const news = Array.from({ length: 12 }, (_, index) => ({
    title: `Article ${index + 1}`,
    publisher: "Fixture publisher",
    link: `https://example.com/news/${index + 1}`,
    publishedAt: `2026-10-${String(index + 1).padStart(2, "0")}T12:00:00Z`,
  }));
  const parsed = newsArticlesFromResult({ tool: "pre_event_brief", params: { ticker: "NVDA" }, text: "raw report", raw: { news: [...news, news[11]] } });
  assert.equal(parsed.articles.length, 12);
  assert.equal(parsed.articles[0].title, "Article 12");
  assert.equal(parsed.articles[11].title, "Article 1");
  assert.equal(parsed.omittedCount, 0);
});

test("Opening News requests article context, not an automatic universe-wide briefing", () => {
  assert.deepEqual(getStocksWatcherTopTabToolPlan("News", "nvda"), [{ name: "pre_event_brief", params: { ticker: "NVDA" } }]);
});

test("The native morning briefing quote field is recognized instead of falling through to raw text", () => {
  const rows = quotesFromResult({ tool: "morning_briefing", params: {}, text: "Markdown table", raw: { briefingQuotes: [
    { symbol: "TSLA", name: "Tesla", price: 373.71, change: 5.65, changePercent: 1.54, volume: 30_760_000 },
  ] } });
  assert.equal(rows[0]?.symbol, "TSLA");
  assert.equal(rows[0]?.changePercent, 1.54);
});

test("Unsafe links and absent metadata do not become fake sources or publication dates", () => {
  const parsed = newsArticlesFromResult({ tool: "pre_event_brief", params: {}, text: "", raw: { news: [
    { title: "Unsafe story", link: "javascript:alert(1)", publisher: {}, publishedAt: "2026-02-30T12:00:00Z" },
    { title: "Missing metadata", link: "https://user:password@example.com/story", publishedAt: "not-a-date" },
    null, { title: {} },
  ] } });
  assert.equal(parsed.articles.length, 2);
  assert.deepEqual(parsed.articles.map(row => [row.link, row.publisher, row.publishedAt]), [[null, null, null], [null, null, null]]);
  assert.equal(parsed.omittedCount, 2);
});

test("Unsupported or failed news payloads are distinguishable from a genuinely empty array", () => {
  const result = { tool: "pre_event_brief", params: {}, text: "", raw: { news: [] } };
  assert.equal(newsArticlesFromResult(result).articles.length, 0);
  assert.throws(() => newsArticlesFromResult({ ...result, raw: { news: {} } }), /structured news/);
  assert.throws(() => newsArticlesFromResult({ ...result, error: "Provider refused the request" }), /Provider refused/);
});
