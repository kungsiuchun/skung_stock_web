import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NT_VOLATILITY_RISK_PROMPT } from "../scripts/worker-spx-bot";

const workerSource = readFileSync(new URL("../scripts/worker-spx-bot.ts", import.meta.url), "utf8");
const promptsSource = readFileSync(new URL("../scripts/prompts.ts", import.meta.url), "utf8");
const mojibakeMarkers = new RegExp(`[${[0xc3, 0xc2, 0xe2, 0xf0, 0x178].map((code) => String.fromCharCode(code)).join("")}]`);

test("Telegram trading run does not fetch low-ROI ETF fund-flow charts", () => {
  for (const symbol of ["SPY", "IWM", "XLK", "XLV"]) {
    assert.equal(
      workerSource.includes(`fetchYahooChart('${symbol}'`),
      false,
      `unexpected Yahoo fetch for ${symbol}`,
    );
  }
});

test("Telegram trading run does not fetch fake VIX 3-month context from ^VIX daily data", () => {
  assert.equal(workerSource.includes("VIX 3m chart"), false);
  assert.equal(workerSource.includes("vixQuotes3mo"), false);
  assert.equal(workerSource.includes("currentVix3m = vixQuotes3mo"), false);
});

test("NT sentiment persona does not require removed ETF flow or fake VIX3M inputs", () => {
  assert.equal(/ETF|SPY|IWM|XLK|XLV|XLY|XLI|XLP|XLU/.test(NT_VOLATILITY_RISK_PROMPT), false);
  assert.equal(/3m|3-month|VIX3M/i.test(NT_VOLATILITY_RISK_PROMPT), false);
});

test("SPX bot prompt sources stay ASCII-safe and free of mojibake markers", () => {
  assert.equal(mojibakeMarkers.test(promptsSource), false);
});
