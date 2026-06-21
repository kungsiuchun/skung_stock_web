import test from "node:test";
import assert from "node:assert/strict";

import { buildFinancialJuiceNewsWidgetSrc } from "../src/lib/financial-juice-widget";

test("builds the FinancialJuice headlines iframe URL without relying on third-party script injection", () => {
  const src = buildFinancialJuiceNewsWidgetSrc({
    container: "financialjuice-news-widget-container",
    width: "100%",
    height: "450px",
    mode: "Light",
    backColor: "ffffff",
    fontColor: "1e2329",
  });

  const url = new URL(src);
  assert.equal(url.origin, "https://feed.financialjuice.com");
  assert.equal(url.pathname, "/widgets/headlines.aspx");
  assert.equal(url.searchParams.get("wtype"), "NEWS");
  assert.equal(url.searchParams.get("mode"), "Light");
  assert.equal(url.searchParams.get("container"), "financialjuice-news-widget-container");
  assert.equal(url.searchParams.get("width"), "100%");
  assert.equal(url.searchParams.get("height"), "450px");
  assert.equal(url.searchParams.get("backC"), "ffffff");
  assert.equal(url.searchParams.get("fontC"), "1e2329");
});
