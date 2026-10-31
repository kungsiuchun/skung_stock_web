# SPX Decision, GEX, Worker, and Telegram Contract

Read this file only for SPX decision runs, Council/CIO, Risk Gate, canonical GEX,
the scheduler Durable Object, D1 ledger, or Telegram delivery.

## Authority and persistence

- One immutable `run_id` flows through Market Snapshot -> Council analysis ->
  CIO decision -> Risk Gate -> D1 Decision Ledger -> Telegram Outbox.
- Only CIO may create `OPEN_CALL`, `OPEN_PUT`, `HOLD`, or `CLOSE`. Never add a
  post-CIO directional override. Deterministic/model/data fallback is explicit
  `DEGRADED HOLD`; it cannot manufacture direction.
- Persist lifecycle evidence in `spx_decision_runs`, append-only
  `spx_run_lifecycle_events`, and `spx_delivery_outbox` from migration `0007`.
- Diagnostics support `run_id`, `retry_run_id`, and `lifecycle_date`. Telegram
  succeeds only when a `message_id` is persisted; logs prove nothing.
- Manual/debug runs are preview-only unless `deliver` is explicit. Scheduled
  cron runs remain SEND. A message ID proves transport, not readability.

## Telegram output

- Degraded/HOLD text is human-readable Traditional Chinese, omits non-applicable
  entry/invalidation/target fields, and never leaks internal fallback codes.
- Escape HTML once at the send choke point; never trust model text or duplicate
  caller-level escaping.
- The compact card shows optional UAT label, SPX price/final Risk-Gated action,
  scheduled ET/underlying, canonical GEX, Council tally and QM/CM/NT/PA order,
  concise CIO plan, risk/data warning, run ID, and Board link.
- Count invalid agents as INVALID, never HOLD.
- GEX comes only from the canonical Board `SpxGexTelegramSummary` persisted in
  `MarketSnapshot`. Never re-fetch or recalculate it in the formatter. If absent,
  say the canonical snapshot is missing.

## Council and CIO model contract

- Both use `openai/gpt-5-mini`, no temperature, and
  `reasoning.effort="minimal"`.
- Every structured request is Azure-only: `order` and `only` are `azure`,
  `allow_fallbacks=false`, `require_parameters=true`, with at most one retry
  against the same provider. No cross-model/provider fallback.
- Azure wire format is `response_format: { type: "json_object" }`; the Worker
  still strictly validates the full schema, evidence references, confidence,
  and no-extra-fields rules.
- Accept Azure endpoint variants only. Other resolved providers are fail-closed
  `UNAPPROVED_PROVIDER`; HTTP 404 is `PROVIDER_UNAVAILABLE`.
- Council: `max_completion_tokens=1024`, 45-second attempt timeout, shared
  100-second deadline, 8KB role projection. CIO: 1536 tokens and its established
  timeout profile.
- Confidence is 1-100; zero is reserved for pipeline invalid/degraded results.
  Every claim, including HOLD conflicts, cites exact snapshot fact keys.
- Persist safe requested/resolved model/provider, usage, cost, latency, finish
  reason, response hash, routing/generation/error-shape metadata and canonical
  `contractError`; never persist raw prompt/output/error text.
- Keep `UPSTREAM_ERROR`, `MISSING_CHOICE`, `EMPTY_CONTENT`, `OUTPUT_NOT_JSON`,
  `SCHEMA_INVALID`, and 400 contract failures distinct. Humanize them for
  Telegram without leaking codes.

## Canonical GEX and scheduling

- `generatedAt` is ISO; display text belongs in `displayTimeLabel`.
- Evidence uses immutable `snapshotId`, schema version, provider/fallback data,
  source timestamp, normalized payload hash, and
  `replayGrade=NORMALIZED_CANONICAL`. Raw Yahoo/CBOE payloads are not persisted.
- Migration `0008` owns collection lifecycle: SCHEDULED -> FETCHED -> NORMALIZED
  -> PERSISTED or explicit FAILED.
- Veto directional CIO output to `DEGRADED HOLD` when canonical GEX is missing,
  schema-mismatched, or older than 35 minutes.
- `SPX_SCHEDULER` Durable Object owns 15-minute market alarms. Cron only wakes
  and re-arms it. Record late/absent ticks as `cron_invocation_missed`; never
  backfill a decision with later data.
- GEX API status is READY, EMPTY, or ERROR. Missing D1/table is 503, read failure
  is 500, and only READY may be cached. Missing URL `snapshot` remains null.
- Pressure API reads compact guarded D1 projections, never whole-day snapshot
  JSON. Browser reads share one serial lane with 8-second attempts and one 300ms
  retry only for timeout/transport or 502/503/504; every terminal path releases
  the lane.

## Local verification

- Recap metrics summarize retained structured callouts. SPX direction points
  are not broker fills, option returns or returns after costs. Callout win rate
  excludes flat closes; keep that distinction separate from the 15-minute proxy.
  Missing/blank prices and points remain unavailable, never zero or flat closes.

- Board request/navigation/playback state is owned by
  `src/hooks/use-spx-gex-board.ts`; Board response validation lives in
  `src/lib/spx-board-response.ts`. Presentation must not cast arbitrary JSON
  directly into market models. EMPTY, transport, HTTP, non-JSON, malformed JSON,
  and invalid response contracts remain distinct.
- The overview compares canonical snapshot price with canonical levels. Its
  session-pressure summary explicitly names both comparison times, independently
  of the pinned GEX frame. Price charts disclose their own last-candle time and
  remain independent of the replay minute. Only verified LIVE price context may
  animate as live; a delayed canonical quote must not pulse.
- Dated Yahoo chart reads exclude ET sessions after the requested date; dated
  price-overlay reads include only that session. A rolling provider range that
  does not cover the date produces an explicit empty result, never newer prices.
- Technical response details and linked decision-run evidence are expandable;
  unavailable/stale data and snapshot quality remain visible. Per-cell evidence
  remains available through the exposure table.
- The pressure component owns price-overlay refresh independently of Compass:
  healthy current-session reads refresh every 60 seconds during NYSE hours,
  including the early-close calendar. Recovery is limited to three reads per
  failed sequence, even when an HTML/invalid response has no provider identity;
  the overlay has its own explicit retry. Initial requests settle before timers
  may refresh them. Historical and closed sessions require manual price retry.
- A display-only expiry clock keeps Compass and pressure spot/EM source states,
  overview context and live pulse in agreement after network polling stops.
  It preserves the 10-minute stale ceiling and 5-second future-skew tolerance.
- Yahoo intraday bars retain timestamps. Four-hour candles aggregate within each
  ET NYSE session from 09:30, never across trading dates; session extension and
  aggregation share the NYSE regular/early-close calendar.
- Daily chart labels use the candle's trading `date_iso` directly. Only intraday
  labels convert the timestamp to ET; UTC-midnight daily bars must not shift to
  the previous ET date. Timeframe selection waits for the Board session to settle.
- Latest-GEX automatic failures/EMPTY reads stop after three attempts per ET
  date; manual snapshot retry resets that budget. Full holidays do not poll;
  canonical GEX retains its 15-minute collection window after regular or early
  close. An automatic refresh never interrupts a pending snapshot request.

- `npm run dev:spx-uat` uses the isolated `.wrangler/spx-uat` fixture.
- `npm run test:spx-board:uat` verifies the compact overview, date/timeframe
  cancellation, fault classification, bounded retry, and explicit recovery.
- `npm run dev:spx-live` proxies only the production GEX GET route read-only.
- Vite is strict port 5173; Pages is 8788.
