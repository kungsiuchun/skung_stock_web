import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSpxGexHeatmapFromMcpText,
  getSpxGexGenerationStatus,
  listSpxGexHeatmapDates,
  readSpxGexHeatmap,
  generateAndStoreSpxGexHeatmap,
  upsertSpxGexHeatmap,
  type SpxGexHeatmapModel,
  type SpxGexMcpClient,
} from "../src/lib/spx-gex-heatmap";
import { onRequest as getSpxGexHeatmapApi } from "../functions/api/spx-gex-heatmap";

describe("SPX GEX heatmap generation gate", () => {
  it("allows the 09:15 ET premarket generation slot on a trading day", () => {
    const status = getSpxGexGenerationStatus(new Date("2026-05-27T13:15:00Z"));

    assert.equal(status.etDateKey, "2026-05-27");
    assert.equal(status.isMarketOpenDay, true);
    assert.equal(status.isGenerationWindow, true);
    assert.equal(status.skipReason, null);
  });

  it("blocks generation on a full NYSE market holiday", () => {
    const status = getSpxGexGenerationStatus(new Date("2026-05-25T13:15:00Z"));

    assert.equal(status.etDateKey, "2026-05-25");
    assert.equal(status.isMarketOpenDay, false);
    assert.equal(status.isGenerationWindow, false);
    assert.equal(status.skipReason, "us_market_holiday");
  });
});

const gexText = (_expiry: string, rows: string) => `
**Snapshot:** 2026-05-27T09:14:55 **Spot:** $6,000.00
| Metric | Value |
| Net GEX | **1.25B** |
| Strike | Call GEX | Put GEX | Total |
${rows}
`.trim();

const buildSampleHeatmap = (generatedAt = "2026-05-27T13:15:30.000Z") =>
  buildSpxGexHeatmapFromMcpText({
    generatedAt,
    quoteText: "| Ticker | Last | Change | Change % |\n| SPX | $6,000.00 | +12.50 | +0.21% |",
    optionsText: "**Available expiries:** 2026-05-26, 2026-05-27, 2026-05-28, 2026-05-29, 2026-06-01, 2026-06-02",
    zeroDteText: `
**Snapshot:** 2026-05-27T09:14:55 **Session phase:** \`pre_market\` **Now (ET):** 2026-05-27 09:14
**Expiry:** 2026-05-27
**Pin level:** $6,000 (0.0%)
Flip level: $5,950 (-0.8%)
| Metric | Value |
| Net GEX | **1.50B** |
| Net DEX | **-400.00M** |
| Top call wall | $6,050 |
| Top put wall | $5,900 |
| Charm regime | \`supportive\` |
      `.trim(),
    gexByExpiryText: {
      "2026-05-27": gexText("2026-05-27", "| $6,050 | 1 | 2 | **2.00B** |\n| $6,000 | 1 | 2 | **-1.00B** |"),
      "2026-05-28": gexText("2026-05-28", "| $6,050 | 1 | 2 | **1.25B** |\n| $6,000 | 1 | 2 | **500.00M** |"),
      "2026-05-29": gexText("2026-05-29", "| $6,050 | 1 | 2 | **750.00M** |\n| $6,000 | 1 | 2 | **-250.00M** |"),
      "2026-06-01": gexText("2026-06-01", "| $6,050 | 1 | 2 | **300.00M** |\n| $6,000 | 1 | 2 | **100.00M** |"),
      "2026-06-02": gexText("2026-06-02", "| $6,050 | 1 | 2 | **-200.00M** |\n| $6,000 | 1 | 2 | **50.00M** |"),
    },
  });

const createFakeMcpClient = () => {
  const calls: string[] = [];
  const client: SpxGexMcpClient = {
    async getQuotes() {
      calls.push("get_quotes");
      return "| Ticker | Last | Change | Change % |\n| SPX | $6,000.00 | +12.50 | +0.21% |";
    },
    async getOptions() {
      calls.push("get_options");
      return "**Available expiries:** 2026-05-26, 2026-05-27, 2026-05-28, 2026-05-29, 2026-06-01, 2026-06-02";
    },
    async getOptions0Dte() {
      calls.push("get_options_0dte");
      return `
**Snapshot:** 2026-05-27T09:14:55 **Session phase:** \`pre_market\` **Now (ET):** 2026-05-27 09:14
**Expiry:** 2026-05-27
**Pin level:** $6,000 (0.0%)
Flip level: $5,950 (-0.8%)
| Metric | Value |
| Net GEX | **1.50B** |
| Net DEX | **-400.00M** |
| Top call wall | $6,050 |
| Top put wall | $5,900 |
| Charm regime | \`supportive\` |
      `.trim();
    },
    async getOptionsGex(expiry: string) {
      calls.push(`get_options_gex:${expiry}`);
      return gexText(expiry, "| $6,050 | 1 | 2 | **2.00B** |\n| $6,000 | 1 | 2 | **-1.00B** |");
    },
  };

  return { client, calls };
};

class MemoryD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly store: Map<string, Record<string, unknown>>,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async run() {
    if (this.query.includes("INSERT INTO spx_gex_heatmaps")) {
      this.store.set(String(this.values[0]), {
        date: this.values[0],
        generated_at: this.values[1],
        snapshot_at: this.values[2],
        ticker: this.values[3],
        spot: this.values[4],
        quote_json: this.values[5],
        expiries_json: this.values[6],
        strikes_json: this.values[7],
        cells_json: this.values[8],
        totals_json: this.values[9],
        zero_dte_json: this.values[10],
        source_json: this.values[11],
      });
    }

    if (this.query.includes("DELETE FROM spx_gex_heatmaps")) {
      const keepDates = [...this.store.keys()].sort().reverse().slice(0, Number(this.values[0]));
      for (const date of [...this.store.keys()]) {
        if (!keepDates.includes(date)) this.store.delete(date);
      }
    }

    return {};
  }

  async first<T = Record<string, unknown>>() {
    if (this.query.includes("SELECT * FROM spx_gex_heatmaps WHERE date = ?")) {
      return (this.store.get(String(this.values[0])) || null) as T | null;
    }
    return null;
  }

  async all<T = Record<string, unknown>>() {
    if (this.query.includes("SELECT date FROM spx_gex_heatmaps")) {
      return {
        results: [...this.store.keys()]
          .sort()
          .reverse()
          .map((date) => ({ date })) as T[],
      };
    }
    return { results: [] as T[] };
  }
}

class MemoryD1 {
  readonly store = new Map<string, Record<string, unknown>>();

  prepare(query: string) {
    return new MemoryD1Statement(this.store, query);
  }

  async batch(statements: MemoryD1Statement[]) {
    for (const statement of statements) {
      await statement.run();
    }
    return [];
  }
}

describe("SPX GEX heatmap model", () => {
  it("builds normalized JSON from MCP text and starts active expiries from the 0DTE front expiry", () => {
    const heatmap = buildSampleHeatmap();

    assert.deepEqual(heatmap.selectedExpiries, ["2026-05-27", "2026-05-28", "2026-05-29", "2026-06-01", "2026-06-02"]);
    assert.deepEqual(heatmap.strikes, [6050, 6000]);
    assert.equal(heatmap.quote.last, 6000);
    assert.equal(heatmap.zeroDte.expiry, "2026-05-27");
    assert.equal(heatmap.zeroDte.gammaFlip, 5950);
    assert.equal(heatmap.cells.find((cell) => cell.strike === 6050 && cell.expdate === "2026-05-27")?.netGex, 2_000_000_000);
    assert.equal(heatmap.cells.find((cell) => cell.strike === 6000 && cell.expdate === "2026-05-28")?.netGex, 500_000_000);
  });
});

describe("SPX GEX heatmap D1 storage", () => {
  it("stores JSON snapshots, reads them back, and retains only the latest seven trading dates", async () => {
    const db = new MemoryD1();

    for (const date of [
      "2026-05-15",
      "2026-05-18",
      "2026-05-19",
      "2026-05-20",
      "2026-05-21",
      "2026-05-22",
      "2026-05-26",
      "2026-05-27",
    ]) {
      const snapshot = buildSampleHeatmap(`${date}T13:15:30.000Z`) as SpxGexHeatmapModel;
      await upsertSpxGexHeatmap(db, date, snapshot, { retentionTradingDays: 7 });
    }

    assert.deepEqual(await listSpxGexHeatmapDates(db), [
      "2026-05-27",
      "2026-05-26",
      "2026-05-22",
      "2026-05-21",
      "2026-05-20",
      "2026-05-19",
      "2026-05-18",
    ]);
    assert.equal(await readSpxGexHeatmap(db, "2026-05-15"), null);

    const restored = await readSpxGexHeatmap(db, "2026-05-27");
    assert.equal(restored?.generatedAt, "2026-05-27T13:15:30.000Z");
    assert.equal(restored?.quote.last, 6000);
    assert.equal(restored?.cells.length, 10);
    assert.equal(restored?.zeroDte.topCallWallLevel, 6050);
  });
});

describe("SPX GEX heatmap API", () => {
  it("returns available dates, the selected JSON heatmap, and falls back to the latest date", async () => {
    const db = new MemoryD1();
    await upsertSpxGexHeatmap(db, "2026-05-26", buildSampleHeatmap("2026-05-26T13:15:30.000Z"));
    await upsertSpxGexHeatmap(db, "2026-05-27", buildSampleHeatmap("2026-05-27T13:15:30.000Z"));

    const response = await getSpxGexHeatmapApi({
      request: new Request("https://example.com/api/spx-gex-heatmap?date=2026-05-20"),
      env: { SPX_RECAP_DB: db },
    });
    const payload = (await response.json()) as {
      availableDates: string[];
      selectedDate: string;
      heatmap: SpxGexHeatmapModel;
      warnings: string[];
    };

    assert.equal(response.status, 200);
    assert.deepEqual(payload.availableDates, ["2026-05-27", "2026-05-26"]);
    assert.equal(payload.selectedDate, "2026-05-27");
    assert.equal(payload.heatmap.generatedAt, "2026-05-27T13:15:30.000Z");
    assert.deepEqual(payload.warnings, []);
  });
});

describe("SPX GEX heatmap automation runner", () => {
  it("generates once during the premarket window and skips retries when the date already exists", async () => {
    const db = new MemoryD1();
    const { client, calls } = createFakeMcpClient();

    const firstRun = await generateAndStoreSpxGexHeatmap({
      db,
      mcpClient: client,
      now: new Date("2026-05-27T13:15:00Z"),
    });
    const retryRun = await generateAndStoreSpxGexHeatmap({
      db,
      mcpClient: client,
      now: new Date("2026-05-27T13:20:00Z"),
    });

    assert.deepEqual(firstRun, { status: "generated", date: "2026-05-27" });
    assert.deepEqual(retryRun, { status: "skipped_existing", date: "2026-05-27" });
    assert.equal((await readSpxGexHeatmap(db, "2026-05-27"))?.cells.length, 10);
    assert.equal(calls.filter((call) => call === "get_quotes").length, 1);
    assert.equal(calls.filter((call) => call.startsWith("get_options_gex")).length, 5);
  });

  it("does not call the MCP client when the market is closed", async () => {
    const db = new MemoryD1();
    const { client, calls } = createFakeMcpClient();

    const result = await generateAndStoreSpxGexHeatmap({
      db,
      mcpClient: client,
      now: new Date("2026-05-25T13:15:00Z"),
    });

    assert.deepEqual(result, { status: "skipped", date: "2026-05-25", reason: "us_market_holiday" });
    assert.deepEqual(calls, []);
  });
});
