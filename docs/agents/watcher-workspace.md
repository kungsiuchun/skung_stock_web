# Watcher workspace contract

- Entry: `#/work/stocks-intelligence-watcher`. The shared shell owns Today,
  Markets, Research, Plans, Portfolio and SPX / Advanced. The portfolio's Market
  Lab shows one Watcher entry; personal portfolio pages and utilities remain separate.
- English interface, dark by default, optional light mode. Reports default to
  Traditional Chinese, with English available. Avoid black-box buy scores and
  invented price targets. Source dates, gaps and manual invalidation stay visible.
- Preserve legacy Finance, Trading Agent, Breadth, Rotation, Rates, Portfolio and
  SPX routes. Workspace hash parameters preserve symbol, tab, range and expiry.
  Portfolio's v1 share parser and SPX's replay parameters retain their own contracts.

## Data and costs

- First stock entry uses POST Watcher tools for curated watchlist, quotes and
  daily history, plus the compact market summary. A selected quote outside the
  initial quote response may use a fifth request. Each quote batch has at most
  twenty unique tickers and two concurrent Yahoo requests. Browser stock data is
  refreshed explicitly; changing chart range uses the loaded year of history.
- Financials, news, options and market detail load on demand. Existing options
  expiry preload remains capped at eight with concurrency two; the workspace
  session cache survives tab changes. Do not trigger the paid SPX council from
  browsing. Published Robinhood EOD remains canonical, with labelled Yahoo fallback.
- Options initialization uses the bounded `surface=options` Watcher snapshot:
  quote, chain and observed GEX only. Missing GEX never generates synthetic
  strikes or completion values. Full legacy snapshot cache identity is versioned
  separately so pre-change synthetic rows cannot survive the transition.
- `GET /api/market-context` reads the shared status pointer and a <=30KB A/B
  summary. `publishMarketBreadthRelease` writes it alongside breadth/rotation
  before the pointer moves. A missing summary is explicitly unavailable until a
  producer publishes it; never fabricate it or fetch full rotation for the home view.
- `functions/api/_middleware.ts` guards the three public R2 bindings. Reserve
  thirty-two read credits atomically in existing MARKET_CACHE_DB before spending
  any, with a shared two-million-credit UTC-month ceiling. Credits expire locally
  at month rollover and are never refunded on isolate loss. This conservative
  reservation avoids a D1 write per read. Edge cache hits precede R2 operations.
- Guard work consumes the existing MARKET_CACHE_DB site allocation of one million
  rows read / twenty thousand indexed row writes per UTC day. It does not multiply
  the allocation by seventy percent again or claim to meter the Cloudflare account.
  SPX_RECAP_DB keeps its separate allocation. Platform/other-project account usage
  remains outside this application guard. No new bucket, database, Worker or cron.

## Public research

- `POST /api/research/report`: symbol + lens (`swing`, `quality`, `risk`) + language
  (`zh-TW`, `en`). The server assembles quote, validated daily technicals and
  available published financials. Client prices, private notes and saved plans
  never become shared report evidence. Reports disclose absent news/options/events.
- Public chat and legacy FinRobot / Trading Agent / stock analysis endpoints share
  the same service. Finance snapshot loading is data-only. Public social sentiment
  does not call Adanos, and the Alpha Vantage credential fallback has been removed.
- Only `openrouter/free` or explicitly free models, zero-price provider bounds, no provider fallback, one
  request, 1,536 output-token cap and forty-five-second timeout. Paid model
  configuration stops generation. Reserve at most forty attempts/day and ten/minute
  atomically, including failed attempts; missing/corrupt quota state fails closed.
- Public model policy uses `PUBLIC_RESEARCH_MODEL` (default `openrouter/free`).
  The legacy `OPENROUTER_MODEL` belongs to other flows and cannot select or disable
  the public model. Do not synchronize or modify production secrets for this split.
- Requested and returned model identities must match the checked-in verified-free
  catalog in `free-research-models.ts`; a `:free` suffix alone is insufficient.
  Each response must report numeric zero cost. Missing proof rejects the output.
  Refresh that catalog from the official model API when selecting another model;
  there is no runtime catalog polling or automatic provider substitution.
- The configuration selects `google/gemma-4-31b-it:free`, with reasoning disabled
  and temperature zero. This endpoint declares JSON mode rather than native
  constrained JSON Schema; its complete dynamic schema is supplied in the trusted
  system message and every result still passes strict server validation. Other
  schema-capable paths retain native JSON Schema. Provider routing requires all
  requested parameters, with zero prices and no fallback. Capability metadata
  alone does not prove a successful live response.
- Owner OAuth accepts only verified allowlisted GitHub emails. Provider exchanges
  have bounded deadlines; malformed/provider failures return explicit JSON errors.
- Reports validate a structured summary/support/counterchecks/risks contract and
  source IDs before rendering. Cache identity includes evidence hash, symbol, lens,
  bilingual bundle and prompt version. Never relabel a cached report's source timestamp;
  stale reports are not a fallback when regeneration fails. Chat is not shared-cached.
- Program-rendered facts own prices, dates, range position, technical metrics
  and published financial amounts. Range position is 0% at the low and 100% at
  the high, never a percentage below the range. Model input projects qualitative
  relationships; generated prose is qualitative and rejects digits, percentages
  and common quantified amounts/durations after Unicode normalization. These
  bounded checks do not prove every semantic interpretation: actual outputs
  still require numerical/source review during acceptance.
- Report prompt version 7 and theme scope version 3 exclude earlier numerical
  prose. Chat returns facts separately and never adds those figures to model
  history; the browser renders them in a source disclosure.
- Each stock/lens generation prepares both report languages from identical public
  evidence. Both must validate before the shared bundle is cached. The public
  response still contains only the requested language; switching language reuses
  that bundle while its evidence identity remains the same. A partly valid bundle
  is rejected, never published. Chat and theme reports keep their own contracts.
- Minimal model receipts record the schema fingerprint, format, model/provider,
  generation ID, finish reason and zero-cost/token metadata. They do not log
  prompts, questions, report prose or private conversation history.
- Schema and runtime limits enforce one claim per report section, at most eighty
  characters for Chinese or three hundred and twenty for English. Chat has its
  own bounded claim length. The provider's token ceiling remains unchanged;
  overlong or incomplete responses are rejected, never truncated into success.

## Local plans and verification

- `watcher-workspace-v1` stores versioned tags, custom symbols and up to two hundred
  manual plans. Import validates the whole payload and requires explicit replacement.
  Corrupt storage is preserved until the user explicitly replaces it. Never persist
  empty hydration over existing data or claim failed persistence succeeded.
- Long stops are below entry; short stops are above. Optional targets must be on
  the reward side. Whole shares floor risk budget / stop distance; show position,
  scenario risk and reward/risk. No broker order, monitoring or guaranteed stop fill.
- Run `npm run test:watcher-workspace`, affected Watcher/Finance/Breadth/Rotation/
  Portfolio tests, lint, `npm run build` and a local Pages Functions bundle check.
  Check 390/768/1440px, dark/light, keyboard, ticker supersession, back/refresh,
  legacy shares, missing sources, quota rejection and corrupt local storage.
- The full gate includes runtime cache-cost regressions, Portfolio API tests and
  `test:finance-agent-public-smoke`, which mocks providers while executing the
  public and legacy research routes. The separate legacy tool-source smoke
  requires credentials and is not an offline CI gate.
- Commit, push, merge, workflow execution, external resource creation and production
  deployment each require their own explicit authority. Local completion is not
  production verification.
