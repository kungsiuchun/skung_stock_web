import test from "node:test";
import assert from "node:assert/strict";

import { normalizeYahooFundamentals } from "../src/lib/fundamentals";

test("uses Yahoo financialData targetMeanPrice for analyst target", () => {
  const result = normalizeYahooFundamentals("AMZN", {
    summaryDetail: {
      marketCap: { fmt: "2.63T" },
      trailingPE: { fmt: "31.66" },
      fiftyTwoWeekHigh: { fmt: "278.56" },
      fiftyTwoWeekLow: { fmt: "196.00" },
    },
    defaultKeyStatistics: {
      pegRatio: { fmt: "1.83" },
      trailingEps: { fmt: "7.72" },
    },
    financialData: {
      targetMeanPrice: { fmt: "262.91" },
    },
    price: {
      longName: "Amazon.com, Inc.",
      regularMarketPrice: { fmt: "244.39" },
    },
  });

  assert.equal(result.analyst_target_price, "262.91");
  assert.equal(result.current_price, "244.39");
});

test("does not fake analyst target with current price when Yahoo target is missing", () => {
  const result = normalizeYahooFundamentals("AMZN", {
    summaryDetail: {
      trailingPE: { fmt: "31.66" },
    },
    defaultKeyStatistics: {
      trailingEps: { fmt: "7.72" },
    },
    financialData: {},
    price: {
      regularMarketPrice: { fmt: "244.39" },
    },
  });

  assert.equal(result.analyst_target_price, null);
  assert.equal(result.current_price, "244.39");
});
