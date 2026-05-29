import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDemoStocksWatcherSnapshot,
  buildStocksWatcherSnapshotFromMcp,
  type StocksWatcherMcpClient,
} from "../src/lib/stocks-intelligence-watcher";

class FakeStocksMcpClient implements StocksWatcherMcpClient {
  async listTools() {
    return [
      {
        name: "get_quotes",
        description: "Get latest quotes.",
        inputSchema: { properties: { tickers: { type: "string" } }, required: ["tickers"] },
      },
      {
        name: "get_options",
        description: "Get options chain.",
        inputSchema: { properties: { ticker: { type: "string" } }, required: ["ticker"] },
      },
    ];
  }

  async callToolText(name: string) {
    if (name === "get_quotes") {
      return `
| Ticker | Last | Change | Change % |
| TSLA | $442.10 | +1.74 | +0.40% |
`;
    }

    if (name === "get_options") {
      return `
**Available expiries:** 2026-05-29, 2026-06-01, 2026-06-05
| Exp | OI | Str | Volume | Type |
| 2026-05-29 | 426k | 440 | 98.4k | C |
| 2026-06-01 | 56k | 405 | 17.5k | C |
`;
    }

    if (name === "get_options_gex" || name === "get_options_0dte") {
      return `
| Strike | Call GEX | Put GEX | Net GEX |
| $440 | 12.8M | -3.0M | 9.8M |
| $450 | 35.0M | -4.0M | 31.0M |
`;
    }

    if (name === "get_intraday") {
      return `
| Time | Price |
| 2026-05-28 09:30 | 438.10 |
| 2026-05-28 10:00 | 439.40 |
| 2026-05-28 10:30 | 442.10 |
| 2026-05-28 11:00 | 441.70 |
`;
    }

    if (name === "get_stock_history") {
      return "| Date | Close |\n| 2026-05-27 | 440.36 |";
    }

    if (name === "market_breadth") {
      return "US breadth: advancers led decliners.";
    }

    if (name === "basket_relative_strength") {
      return "TSLA leads the watchlist.";
    }

    throw new Error(`Unexpected tool ${name}`);
  }
}

test("demo snapshot is deterministic enough for the watcher shell", () => {
  const snapshot = buildDemoStocksWatcherSnapshot("TSLA", "fallback");

  assert.equal(snapshot.symbol, "TSLA");
  assert.equal(snapshot.source, "demo_fallback");
  assert.ok(snapshot.expiries.length >= 20);
  assert.ok(snapshot.strikes.length >= 20);
  assert.ok(snapshot.warnings.includes("fallback"));
});

test("MCP snapshot parses quotes, options, GEX, and tools/list metadata", async () => {
  const snapshot = await buildStocksWatcherSnapshotFromMcp("TSLA", new FakeStocksMcpClient());

  assert.equal(snapshot.source, "stocks_intelligence_mcp");
  assert.equal(snapshot.quote.price, 442.1);
  assert.equal(snapshot.availableTools.length, 2);
  assert.ok(snapshot.expiries.some((row) => row.openInterest === 426_000));
  assert.ok(snapshot.strikes.some((row) => row.strike === 440 && row.callGex === 12_800_000));
  assert.ok(snapshot.toolRuns.some((run) => run.name === "market_breadth" && run.status === "ok"));
});

test("MCP snapshot records a failed optional tool without blocking core ticker data", async () => {
  const client = new FakeStocksMcpClient();
  const originalCallToolText = client.callToolText.bind(client);
  client.callToolText = async (name, args) => {
    if (name === "basket_relative_strength") throw new Error("relative strength unavailable");
    return originalCallToolText(name, args);
  };

  const snapshot = await buildStocksWatcherSnapshotFromMcp("TSLA", client);

  assert.equal(snapshot.source, "stocks_intelligence_mcp");
  assert.equal(snapshot.quote.price, 442.1);
  assert.ok(snapshot.toolRuns.some((run) => run.name === "basket_relative_strength" && run.status === "failed"));
});
