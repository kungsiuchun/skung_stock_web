import assert from "node:assert/strict";
import test from "node:test";

import { normalizeYahooPortfolioHistory, onRequestPost } from "../functions/api/portfolio-backtest";
import { buildMarketCacheKey } from "../src/lib/market-data-cache";
import type { D1DatabaseLike } from "../src/lib/spx-recap-d1";

const chartPayload = (ticker: string, instrumentType = "ETF") => ({
  chart: {
    result: [{
      meta: {
        symbol: ticker,
        instrumentType,
        exchangeName: "NMS",
        fullExchangeName: "NasdaqGS",
        longName: `${ticker} Fund`,
        exchangeTimezoneName: "America/New_York",
      },
      timestamp: [
        Date.parse("2025-01-02T21:00:00.000Z") / 1_000,
        Date.parse("2025-01-03T21:00:00.000Z") / 1_000,
        Date.parse("2025-01-06T21:00:00.000Z") / 1_000,
      ],
      indicators: {
        quote: [{ close: [100, 101, 102] }],
        adjclose: [{ adjclose: [100, 101, 102] }],
      },
      events: { dividends: {}, splits: {} },
    }],
    error: null,
  },
});

const requestFor = (body: unknown) => new Request("http://localhost:8788/api/portfolio-backtest", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

type CacheRow = { cache_key: string; payload_json: string; source_as_of: string | null; cached_at: string; expires_at: string; last_refresh_error: string | null };
class PortfolioCacheD1 implements D1DatabaseLike {
  private readonly rows = new Map<string, CacheRow>();

  seed(ticker: string, value: unknown, expiresAt: string) {
    const key = buildMarketCacheKey("portfolio-backtest-history-v1", ticker, { end: "2025-01-06", start: "2025-01-02" });
    this.rows.set(key, { cache_key: key, payload_json: JSON.stringify(value), source_as_of: "2025-01-06", cached_at: "2025-01-06T21:00:00.000Z", expires_at: expiresAt, last_refresh_error: null });
  }

  prepare(query: string) {
    let values: unknown[] = [];
    const statement = {
      bind: (...next: unknown[]) => {
        values = next;
        return statement;
      },
      first: async <T>() => query.includes("SELECT") ? (this.rows.get(String(values[0])) || null) as T | null : null,
      all: async <T>() => ({ results: [] as T[] }),
      run: async () => {
        if (query.includes("UPDATE market_cache_entries")) {
          const [message, , key] = values;
          const row = this.rows.get(String(key));
          if (row) row.last_refresh_error = String(message);
        }
        return { meta: { changes: 1 } };
      },
    };
    return statement;
  }
}

const normalizedHistory = (ticker: string) => ({
  ticker,
  displayName: `${ticker} Fund`,
  quoteType: "ETF",
  exchange: "NMS",
  points: [
    { date: "2025-01-02", close: 100, adjustedClose: 100, dividend: 0, splitFactor: 1 },
    { date: "2025-01-03", close: 101, adjustedClose: 101, dividend: 0, splitFactor: 1 },
    { date: "2025-01-06", close: 102, adjustedClose: 102, dividend: 0, splitFactor: 1 },
  ],
});

test("rejects an invalid allocation before requesting Yahoo history", async () => {
  let fetches = 0;
  const response = await onRequestPost({
    request: requestFor({
      startingCapital: 10_000,
      positions: [{ ticker: "VTI", basisPoints: 9_999 }],
      rebalancePolicy: "none",
      dividendPolicy: "reinvest",
    }),
    env: {},
    fetcher: async () => {
      fetches += 1;
      return new Response();
    },
  });
  const body = await response.json() as { error: { code: string } };

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "INVALID_ALLOCATION");
  assert.equal(fetches, 0);
});

test("rejects an impossible calendar date before requesting Yahoo history", async () => {
  let fetches = 0;
  const response = await onRequestPost({
    request: requestFor({
      startingCapital: 10_000,
      positions: [{ ticker: "VTI", basisPoints: 10_000 }],
      startDate: "2025-02-30",
      endDate: "2025-03-03",
      rebalancePolicy: "none",
      dividendPolicy: "reinvest",
    }),
    env: {},
    fetcher: async () => {
      fetches += 1;
      return new Response();
    },
  });
  const body = await response.json() as { error: { code: string } };

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "INVALID_INPUT");
  assert.equal(fetches, 0);
});

test("returns normalized US ETF portfolio and SPY results without raw Yahoo payloads", async () => {
  const requests: string[] = [];
  const response = await onRequestPost({
    request: requestFor({
      startingCapital: 10_000,
      positions: [{ ticker: "VTI", basisPoints: 10_000 }],
      startDate: "2025-01-02",
      endDate: "2025-01-06",
      rebalancePolicy: "none",
      dividendPolicy: "reinvest",
    }),
    env: {},
    fetcher: async (input) => {
      const url = String(input);
      requests.push(url);
      const ticker = url.includes("/VTI?") ? "VTI" : "SPY";
      return new Response(JSON.stringify(chartPayload(ticker)), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const body = await response.json() as {
    data: { benchmark: string; effectiveRange: { sessionCount: number }; curve: unknown[]; dataSource: { provider: string }; warnings: string[]; excludedSessions: string[] };
    cache: { status: string };
    requestId: string;
  };

  assert.equal(response.status, 200);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((url) => url.includes("interval=1d") && url.includes("includePrePost=false") && !url.includes("events=")));
  assert.equal(body.data.benchmark, "SPY");
  assert.equal(body.data.effectiveRange.sessionCount, 3);
  assert.equal(body.data.curve.length, 3);
  assert.equal(body.data.dataSource.provider, "Yahoo Finance chart API");
  assert.deepEqual(body.data.warnings, []);
  assert.deepEqual(body.data.excludedSessions, []);
  assert.equal(body.cache.status, "bypassed");
  assert.match(body.requestId, /^[\w-]+$/);
  assert.equal("chart" in body, false);
});

test("retries Yahoo chart history through its second origin when the first origin is unavailable", async () => {
  const hosts: string[] = [];
  const userAgents: string[] = [];
  const accepts: Array<string | null> = [];
  const response = await onRequestPost({
    request: requestFor({
      startingCapital: 10_000,
      positions: [{ ticker: "VTI", basisPoints: 10_000 }],
      startDate: "2025-01-02",
      endDate: "2025-01-06",
      rebalancePolicy: "none",
      dividendPolicy: "reinvest",
    }),
    env: {},
    fetcher: async (input, init) => {
      const url = new URL(String(input));
      hosts.push(url.hostname);
      const headers = new Headers(init?.headers);
      userAgents.push(headers.get("User-Agent") || "");
      accepts.push(headers.get("Accept"));
      if (url.hostname === "query1.finance.yahoo.com") return new Response("temporarily unavailable", { status: 429 });
      const ticker = url.pathname.includes("/VTI") ? "VTI" : "SPY";
      return new Response(JSON.stringify(chartPayload(ticker)), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const body = await response.json() as { data: { benchmark: string }; cache: { status: string } };

  assert.equal(response.status, 200);
  assert.equal(body.data.benchmark, "SPY");
  assert.equal(body.cache.status, "bypassed");
  assert.equal(hosts.filter((host) => host === "query1.finance.yahoo.com").length, 2);
  assert.equal(hosts.filter((host) => host === "query2.finance.yahoo.com").length, 2);
  assert.ok(userAgents.every((userAgent) => userAgent === "Mozilla/5.0"));
  assert.ok(accepts.every((accept) => accept === null));
});

test("uses Yahoo's range chart request for a range ending at the latest completed session", async () => {
  const requests: URL[] = [];
  const response = await onRequestPost({
    request: requestFor({
      startingCapital: 10_000,
      positions: [{ ticker: "VTI", basisPoints: 10_000 }],
      startDate: "2025-01-02",
      endDate: "2025-01-06",
      rebalancePolicy: "none",
      dividendPolicy: "reinvest",
    }),
    env: {},
    now: new Date("2025-01-08T15:00:00.000Z"),
    fetcher: async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      const ticker = url.pathname.endsWith("/VTI") ? "VTI" : "SPY";
      return new Response(JSON.stringify(chartPayload(ticker)), { status: 200 });
    },
  });

  assert.equal(response.status, 200);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((url) => url.hostname === "query1.finance.yahoo.com"));
  assert.ok(requests.every((url) => url.searchParams.get("range") === "1mo"));
  assert.ok(requests.every((url) => url.searchParams.get("period1") === null && url.searchParams.get("period2") === null));
});

test("derives cash dividends from Yahoo adjusted-close factors when the chart response omits event objects", () => {
  const payload = chartPayload("VTI");
  const result = payload.chart.result[0];
  result.indicators.quote[0].close = [100, 99, 100];
  result.indicators.adjclose[0].adjclose = [99, 99, 100];
  delete (result as { events?: unknown }).events;

  const normalized = normalizeYahooPortfolioHistory({
    ticker: "VTI",
    payload,
    now: new Date("2025-01-07T22:00:00.000Z"),
  });

  assert.deepEqual(normalized.points.map((point) => point.dividend), [0, 1, 0]);
});

test("fails safely after both Yahoo chart origins return non-success responses", async () => {
  const hosts: string[] = [];
  const logs: string[] = [];
  const originalConsoleError = console.error;
  console.error = (...values: unknown[]) => { logs.push(values.map((value) => String(value)).join(" ")); };
  try {
    const response = await onRequestPost({
      request: requestFor({
        startingCapital: 10_000,
        positions: [{ ticker: "VTI", basisPoints: 10_000 }],
        startDate: "2025-01-02",
        endDate: "2025-01-06",
        rebalancePolicy: "none",
        dividendPolicy: "reinvest",
      }),
      env: {},
      now: new Date("2026-08-23T15:00:00.000Z"),
      fetcher: async (input) => {
        const url = new URL(String(input));
        hosts.push(url.hostname);
        return new Response(url.hostname === "query1.finance.yahoo.com" ? "q1-private-body" : "q2-private-body", {
          status: url.hostname === "query1.finance.yahoo.com" ? 429 : 503,
        });
      },
    });
    const body = await response.json() as { error: { code: string }; requestId: string };

    assert.equal(response.status, 502);
    assert.equal(body.error.code, "UPSTREAM_UNAVAILABLE");
    assert.match(body.requestId, /^[\w-]+$/);
    assert.equal(hosts.filter((host) => host === "query1.finance.yahoo.com").length, 2);
    assert.equal(hosts.filter((host) => host === "query2.finance.yahoo.com").length, 2);
    assert.doesNotMatch(JSON.stringify(body), /private-body/);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /query2\.finance\.yahoo\.com/);
    assert.match(logs[0], /"upstreamStatus":503/);
    assert.match(logs[0], /"upstreamAttempts":2/);
    assert.doesNotMatch(logs[0], /private-body/);
  } finally {
    console.error = originalConsoleError;
  }
});

test("uses one shared deadline when the second Yahoo chart origin hangs", async () => {
  const hosts: string[] = [];
  const response = await onRequestPost({
    request: requestFor({
      startingCapital: 10_000,
      positions: [{ ticker: "VTI", basisPoints: 10_000 }],
      startDate: "2025-01-02",
      endDate: "2025-01-06",
      rebalancePolicy: "none",
      dividendPolicy: "reinvest",
    }),
    env: {},
    now: new Date("2026-08-23T15:00:00.000Z"),
    deadlineMs: 20,
    fetcher: async (input, init) => {
      const url = new URL(String(input));
      hosts.push(url.hostname);
      if (url.hostname === "query1.finance.yahoo.com") return new Response("retry q2", { status: 429 });
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    },
  });
  const body = await response.json() as { error: { code: string } };

  assert.equal(response.status, 504);
  assert.equal(body.error.code, "REQUEST_TIMEOUT");
  assert.equal(hosts.filter((host) => host === "query1.finance.yahoo.com").length, 2);
  assert.equal(hosts.filter((host) => host === "query2.finance.yahoo.com").length, 2);
});

test("serves a stale cached history only after both Yahoo chart origins fail", async () => {
  const db = new PortfolioCacheD1();
  db.seed("VTI", normalizedHistory("VTI"), "2000-01-01T00:00:00.000Z");
  db.seed("SPY", normalizedHistory("SPY"), "2000-01-01T00:00:00.000Z");
  const hosts: string[] = [];
  const response = await onRequestPost({
    request: requestFor({
      startingCapital: 10_000,
      positions: [{ ticker: "VTI", basisPoints: 10_000 }],
      startDate: "2025-01-02",
      endDate: "2025-01-06",
      rebalancePolicy: "none",
      dividendPolicy: "reinvest",
    }),
    env: { MARKET_CACHE_DB: db },
    now: new Date("2026-08-23T15:00:00.000Z"),
    fetcher: async (input) => {
      const url = new URL(String(input));
      hosts.push(url.hostname);
      return new Response("provider error", { status: url.hostname === "query1.finance.yahoo.com" ? 429 : 503 });
    },
  });
  const body = await response.json() as { data: { warnings: string[] }; cache: { status: string } };

  assert.equal(response.status, 206);
  assert.equal(body.cache.status, "stale");
  assert.match(body.data.warnings.join(" "), /stale because a refresh failed/i);
  assert.equal(hosts.filter((host) => host === "query1.finance.yahoo.com").length, 2);
  assert.equal(hosts.filter((host) => host === "query2.finance.yahoo.com").length, 2);
});

test("verifies US ETF ticker names through the same server-side API before a backtest runs", async () => {
  const response = await onRequestPost({
    request: requestFor({ operation: "validate", tickers: ["vti", "bnd"] }),
    env: {},
    fetcher: async (input) => {
      const url = String(input);
      const ticker = url.includes("/VTI?") ? "VTI" : "BND";
      return new Response(JSON.stringify(chartPayload(ticker)));
    },
  });
  const body = await response.json() as { data: { instruments: Array<{ ticker: string; displayName: string; eligibility: string }> } };

  assert.equal(response.status, 200);
  assert.deepEqual(body.data.instruments.map((instrument) => instrument.ticker), ["VTI", "BND"]);
  assert.ok(body.data.instruments.every((instrument) => instrument.eligibility === "verified_us_etf"));
});

test("fails closed when Yahoo does not identify the selected symbol as a US-listed ETF", async () => {
  const response = await onRequestPost({
    request: requestFor({
      startingCapital: 10_000,
      positions: [{ ticker: "VTI", basisPoints: 10_000 }],
      startDate: "2025-01-02",
      endDate: "2025-01-06",
      rebalancePolicy: "none",
      dividendPolicy: "cash",
    }),
    env: {},
    fetcher: async (input) => {
      const url = String(input);
      const ticker = url.includes("/VTI?") ? "VTI" : "SPY";
      return new Response(JSON.stringify(chartPayload(ticker, ticker === "VTI" ? "EQUITY" : "ETF")), { status: 200 });
    },
  });
  const body = await response.json() as { error: { code: string; message: string } };

  assert.equal(response.status, 422);
  assert.equal(body.error.code, "INELIGIBLE_TICKER");
  assert.match(body.error.message, /US-listed ETF/);
});

test("fails closed when the provider reports an ETF on a non-US exchange", async () => {
  const response = await onRequestPost({
    request: requestFor({
      startingCapital: 10_000,
      positions: [{ ticker: "VTI", basisPoints: 10_000 }],
      startDate: "2025-01-02",
      endDate: "2025-01-06",
      rebalancePolicy: "none",
      dividendPolicy: "reinvest",
    }),
    env: {},
    fetcher: async (input) => {
      const ticker = String(input).includes("/VTI?") ? "VTI" : "SPY";
      const payload = chartPayload(ticker);
      if (ticker === "VTI") {
        payload.chart.result[0].meta.exchangeName = "LSE";
        payload.chart.result[0].meta.fullExchangeName = "London Stock Exchange";
      }
      return new Response(JSON.stringify(payload));
    },
  });
  const body = await response.json() as { error: { code: string; message: string } };

  assert.equal(response.status, 422);
  assert.equal(body.error.code, "INELIGIBLE_TICKER");
  assert.match(body.error.message, /US-listed ETF/);
});

test("rejects malformed Yahoo corporate-action events without exposing the upstream payload", async () => {
  const response = await onRequestPost({
    request: requestFor({
      startingCapital: 10_000,
      positions: [{ ticker: "VTI", basisPoints: 10_000 }],
      startDate: "2025-01-02",
      endDate: "2025-01-06",
      rebalancePolicy: "none",
      dividendPolicy: "cash",
    }),
    env: {},
    fetcher: async (input) => {
      const ticker = String(input).includes("/VTI?") ? "VTI" : "SPY";
      const payload = chartPayload(ticker);
      if (ticker === "VTI") payload.chart.result[0].events.dividends = { "1735941600": { date: 1_735_941_600, amount: -1, internalProviderDetail: "do-not-expose" } };
      return new Response(JSON.stringify(payload));
    },
  });
  const body = await response.json() as { error: { code: string; message: string }; requestId: string };

  assert.equal(response.status, 502);
  assert.equal(body.error.code, "MALFORMED_PAYLOAD");
  assert.match(body.error.message, /invalid dividend event/);
  assert.match(body.requestId, /^[\w-]+$/);
  assert.equal("chart" in body, false);
  assert.doesNotMatch(JSON.stringify(body), /do-not-expose/);
});

test("rejects duplicate and over-limit ETF selections before requesting market data", async () => {
  for (const positions of [
    [{ ticker: "VTI", basisPoints: 5_000 }, { ticker: "vti", basisPoints: 5_000 }],
    Array.from({ length: 11 }, (_, index) => ({ ticker: `ETF${index}`, basisPoints: index === 0 ? 9_990 : 1 })),
  ]) {
    let fetches = 0;
    const response = await onRequestPost({
      request: requestFor({ startingCapital: 10_000, positions, rebalancePolicy: "annual", dividendPolicy: "cash" }),
      env: {},
      fetcher: async () => {
        fetches += 1;
        return new Response();
      },
    });
    const body = await response.json() as { error: { code: string } };
    assert.equal(response.status, 400);
    assert.ok(["DUPLICATE_TICKER", "INVALID_ALLOCATION"].includes(body.error.code));
    assert.equal(fetches, 0);
  }
});

test("does not return a portfolio result when the ETF set and SPY lack two common EOD sessions", async () => {
  const spyWithNoSharedSecondSession = chartPayload("SPY");
  const series = spyWithNoSharedSecondSession.chart.result[0];
  series.timestamp = [
    Date.parse("2025-01-02T21:00:00.000Z") / 1_000,
    Date.parse("2025-01-07T21:00:00.000Z") / 1_000,
  ];
  series.indicators.quote[0].close = [100, 101];
  series.indicators.adjclose[0].adjclose = [100, 101];
  const response = await onRequestPost({
    request: requestFor({
      startingCapital: 10_000,
      positions: [{ ticker: "VTI", basisPoints: 10_000 }],
      startDate: "2025-01-02",
      endDate: "2025-01-07",
      rebalancePolicy: "none",
      dividendPolicy: "reinvest",
    }),
    env: {},
    fetcher: async (input) => new Response(JSON.stringify(String(input).includes("/SPY?") ? spyWithNoSharedSecondSession : chartPayload("VTI"))),
  });
  const body = await response.json() as { error: { code: string } };

  assert.equal(response.status, 422);
  assert.equal(body.error.code, "INSUFFICIENT_HISTORY");
});

test("returns a safe timeout error when a provider request exceeds the API deadline", async () => {
  const response = await onRequestPost({
    request: requestFor({
      startingCapital: 10_000,
      positions: [{ ticker: "VTI", basisPoints: 10_000 }],
      rebalancePolicy: "none",
      dividendPolicy: "cash",
    }),
    env: {},
    deadlineMs: 20,
    fetcher: async () => new Promise<Response>(() => {}),
  });
  const body = await response.json() as { error: { code: string } };

  assert.equal(response.status, 504);
  assert.equal(body.error.code, "REQUEST_TIMEOUT");
});

test("serves normalized completed EOD histories from the short-lived market cache without calling Yahoo", async () => {
  const db = new PortfolioCacheD1();
  db.seed("VTI", normalizedHistory("VTI"), "2100-01-01T00:00:00.000Z");
  db.seed("SPY", normalizedHistory("SPY"), "2100-01-01T00:00:00.000Z");
  let fetches = 0;
  const response = await onRequestPost({
    request: requestFor({
      startingCapital: 10_000,
      positions: [{ ticker: "VTI", basisPoints: 10_000 }],
      startDate: "2025-01-02",
      endDate: "2025-01-06",
      rebalancePolicy: "none",
      dividendPolicy: "reinvest",
    }),
    env: { MARKET_CACHE_DB: db },
    fetcher: async () => {
      fetches += 1;
      return new Response();
    },
  });
  const body = await response.json() as { data: { curve: unknown[]; warnings: string[] }; cache: { status: string; series: Array<{ status: string }> } };

  assert.equal(response.status, 200);
  assert.equal(fetches, 0);
  assert.equal(body.cache.status, "hit");
  assert.deepEqual(body.cache.series.map((entry) => entry.status), ["hit", "hit"]);
  assert.equal(body.data.curve.length, 3);
  assert.deepEqual(body.data.warnings, []);
});

test("returns a visible stale warning and 206 only when an expired normalized history cannot refresh", async () => {
  const db = new PortfolioCacheD1();
  db.seed("VTI", normalizedHistory("VTI"), "2000-01-01T00:00:00.000Z");
  db.seed("SPY", normalizedHistory("SPY"), "2000-01-01T00:00:00.000Z");
  const response = await onRequestPost({
    request: requestFor({
      startingCapital: 10_000,
      positions: [{ ticker: "VTI", basisPoints: 10_000 }],
      startDate: "2025-01-02",
      endDate: "2025-01-06",
      rebalancePolicy: "none",
      dividendPolicy: "cash",
    }),
    env: { MARKET_CACHE_DB: db },
    fetcher: async () => {
      throw new Error("provider socket detail must not reach the browser");
    },
  });
  const body = await response.json() as { data: { warnings: string[] }; cache: { status: string } };

  assert.equal(response.status, 206);
  assert.equal(body.cache.status, "stale");
  assert.match(body.data.warnings.join(" "), /stale because a refresh failed/i);
  assert.doesNotMatch(JSON.stringify(body), /socket detail/);
});
