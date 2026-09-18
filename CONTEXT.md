# Context Glossary

## Stock Watcher valuation coverage

Stock Watcher reads valuation bands and quarterly financials from private R2 through same-domain Pages Functions. Python ValuationCalculation remains the only calculation source of truth.

Coverage writes are owner-only and API-only: GitHub OAuth establishes a signed HttpOnly session for the `request_valuation_coverage` admin route, while the Watcher dashboard deliberately exposes no Coverage request panel. The canonical `pages.dev` host cannot take a Cloudflare Access self-hosted application in this setup, so OAuth is the explicit replacement gate; a future custom host may add Access defense in depth. The existing bearer token is retained only for trusted server-to-server automation. Queued tickers are picked up by the next daily batch; public visitors never trigger calculation or Yahoo fallback data.

## Personal Portfolio

The public portfolio uses the “Siu — Code & Camera” identity: warm paper, ink, and burnt orange; serif headlines with readable sans-serif body text. The homepage introduces Siu as a data analyst and creative developer, then offers three paths: Market Lab, Photography, and About & résumé.

Portfolio styles are scoped to the portfolio shell. Trading tools retain their existing layouts, routes, API contracts, source labels, and data behavior. Tool modules load on demand rather than with the homepage.

The landing page retains Siu's particle portrait. Canvas enhances an always-present portrait image; a pause control, reduced-motion preference, and offscreen/hidden-page suspension bound its motion. No Three.js or WebGL dependency is required.

## About Page

The About Page presents SIU as the subject. Professional facts are transcribed from the owner-supplied `docs/SiuChunKung_Resume.pdf` into `src/config/profile.ts`. The identical downloadable copy is served at `public/docs/SiuChunKung_Resume.pdf`; update both copies together when the owner supplies a replacement.

Experience, skills, education, and certifications are readable without waiting for an animation or entering terminal commands. The recognizable résumé-build terminal plays once, offers pause/show-all/replay, and immediately shows its complete state for reduced-motion visitors.

The Nikon D3500 remains supporting evidence for Siu's visual practice, with a compact static image and a direct link to photography. It does not gate the résumé behind a camera scan or a long scroll sequence.

The About Page remains an independent view. English is the primary portfolio language, with small Traditional Chinese or Cantonese accents for personal texture.

## Photography

The photo journal presents only the owner's local photographs from `public/image`; external stock images are not represented as Siu's photography. A finite, scrollable gallery and category filters replace the drag-only canvas. Native modal viewing preserves image proportions, supports previous/next buttons and arrow keys, and restores focus on close. Descriptions should reflect observed image contents; do not infer unverified locations or dates.

## Creative Developer

SIU's portfolio identity is a creative developer: code is used to build tools, the camera is used to shape visual language, and AI or market systems are treated as experiments.

## Work Gallery

The Work Gallery is the primary portfolio view for apps and systems SIU built or replicated with AI agents.

The Work Gallery should lead with live, usable demos rather than static explanations.

The Work Gallery may include concise build notes, but those notes support the working product instead of replacing it.

AI Vision is not the main portfolio navigation concept; AI-built work belongs under the Work Gallery.

## Work Item

A Work Item is an individual app, dashboard, tool, or system in the Work Gallery.

A Work Item should explain what was built, what workflow inspired it, and what the visitor can try.

## Settle Up

Settle Up is a Work Item that turns a real group-expense spreadsheet workflow into a modern bill-splitting app.

Settle Up should preserve the core expense concepts: payer, amount, participants, net balance, and settlement transfers.

Settle Up should not look like a spreadsheet clone; the spreadsheet is a workflow reference, not a visual design.

## SPX GEX Heatmap

SPX GEX Heatmap is a Work Item that turns a premarket SPX options gamma workflow into a date-selectable visual map.

SPX GEX Heatmap should show retained JSON snapshots as a live product surface, not stored raw HTML.

SPX GEX Heatmap should treat seven trading days as the retention window, so weekends and NYSE full holidays do not consume retention slots.

## SPX Telegram Trading Council

SPX Telegram Trading Council is the scheduled SPX alert surface that converts live market data, option gamma context, 0DTE rules, and agent roles into one readable trading decision.

SPX Telegram Trading Council should show professional, data-backed summaries. It should never expose raw model JSON, parser debris, tool payloads, or internal contract fields as user-facing analysis.

SPX Telegram Trading Council treats neutral as a rule-backed no-trade decision. Neutral is not an acceptable fallback for malformed model output unless the visible reason names the missing or conflicting data.

## CIO AI Agent

CIO AI Agent is the final SPX Telegram Trading Council decision maker that synthesizes market data, four SPX Data Agents, and 0DTE governance into one SPX level advisory.

CIO AI Agent decides from SPX price levels and market context. It does not select option contracts, route broker orders, or apply bid/ask execution gates.

## SPX Data Agent

SPX Data Agent is a role-specific evidence module inside the SPX Telegram Trading Council.

An SPX Data Agent should contribute direction, confidence, evidence, and blocking risk. It is not a free-form transcript.

## 0DTE Rule Engine

0DTE Rule Engine is the SPX Telegram Trading Council governance layer that separates hard blocks from soft warnings and advisory notes.

0DTE Rule Engine hard blocks prevent new directional SPX advisories. Soft warnings reduce confidence or change risk language, but they are not automatic HOLD decisions.

## SPX Market Data Quality

SPX Market Data Quality is the per-run freshness and completeness summary for the SPX Telegram Trading Council.

Required SPX price feeds can block a new advisory when missing. Optional context such as CBOE GEX, PCR, VIX, D1, or H1 can warn and reduce confidence without automatically forcing HOLD.

## Agent Calibration

Agent Calibration is the historical 15-minute outcome weighting for SPX Data Agents.

Agent Calibration starts every agent at equal weight and only adjusts after enough SPX outcome samples exist. It calibrates the council; it does not replace the CIO AI Agent.

## CBOE Chain Cache

CBOE Chain Cache is the 24-hour D1 cache of normalized SPX option chains from the CBOE delayed feed.

CBOE Chain Cache stores reusable upstream option-chain inputs for Worker jobs. It is not the SPX GEX Heatmap snapshot and should not be treated as the visual replay source.

SPX GEX Heatmap snapshots remain the retained intraday product surface for browsing and replay.

## Stocks Intelligence Watcher

Stocks Intelligence Watcher is a Work Item that turns the Stocks Intelligence MCP ticker workflow into a dense live ticker terminal.

Stocks Intelligence Watcher should lead with a usable watchlist, search, favorites, options expiry table, and OI/volume/GEX strike views rather than a static explanation.

Stocks Intelligence Watcher uses a repo-native Yahoo backend; the browser receives only normalized JSON from the Pages Function.

In Stocks Intelligence Watcher, an expiry row is a selectable expiration summary row. Clicking it changes the right-side Options panel to that expiration's OI, volume, GEX, DEX, Greeks, P/C, or chain data.

In the desktop Chart Options view, the K-line remains on the left while the Net GEX-by-strike profile on the right shares its local price coordinates. The profile has no separate vertical scrollbar; its spot-nearest guide and aggregated strike rows remain aligned through page scrolling and Chart rerenders.

On mobile, the Chart Options panels stack and the GEX profile uses a readable flow list.

Contract rows belong in the Chain tab or strike drilldown. They are not the left-side expiry selector.

## S&P 500 Market Breadth

S&P 500 Market Breadth is a standalone Market Lab Work Item at `#/work/market-breadth`.

It publishes one latest daily snapshot with three panels: sector ETF performance and proxy contribution, the percentage of current SPY holdings above SMA5/20/50/100/200, and the change in each sector ETF's SMA200 over 5/20/50/100/200 trading sessions.

The SPY universe, weights, and one-sector-only membership mapping come from the dated State Street SPY and Select Sector SPDR holdings workbooks. Split-adjusted EOD prices come from Massive under an account with public display rights.

The production Massive credential has Basic-plan EOD recency and a five-requests-per-minute limit. GitHub Actions therefore serializes Massive calls at a 13-second minimum interval and requests the previous NYSE trading session after the next-day EOD publication window; it never treats a same-day HTTP 403 as a holiday or silently relabels previous-day data as current-day data.

Missing constituent history is unavailable and excluded from the eligible breadth denominator. It is never converted to zero or treated as below a moving average.

GitHub Actions owns the batch computation and writes bounded normalized objects to the dedicated Standard-class `market-breadth-data` R2 bucket. Price state and READY snapshots use independent A/B slots, refresh audit uses a 64-slot ring, and the status pointer always moves last. Pages owns a read-only R2 API. The feature uses no D1 and no scheduled Cloudflare Worker, and must not share `MARKET_CACHE_DB`, `SPX_RECAP_DB`, or the SPX trading Worker.

A failed refresh preserves the last READY snapshot and makes the public API report `STALE` with a safe error class. No source failure may create demo data or overwrite the last-good snapshot.

## US ETF Portfolio Backtester

US ETF Portfolio Backtester is a standalone Market Lab Work Item at `#/work/portfolio-backtest`.

It compares a visitor-defined USD allocation of one to ten US-listed ETFs with SPY through a read-only EOD historical simulation. The browser submits the configuration only; the Pages Function validates ETF eligibility, retrieves and normalizes history server-side, and returns a versioned result without raw provider payloads.

Every portfolio must allocate exactly 10,000 whole basis points. SPY is the fixed benchmark. Rebalancing may be none, monthly, quarterly, or annual and always occurs on the last shared completed EOD session of that period.

Dividend policy is explicit. `reinvest` uses Yahoo's split- and dividend-adjusted close for total-return compounding. `cash` uses Yahoo's split-adjusted close plus dividend events held as zero-yield cash. Do not apply split factors to Yahoo chart closes a second time: that manufactures a false split gain.

The feature is EOD-only. It exposes requested and effective common date ranges, source-as-of, cache state, warnings, and unavailable states. Missing, malformed, ineligible, or insufficient common history fails closed; it never returns demo, zero-filled, partial-portfolio, or forecast output.
