# Robinhood MCP EOD Options Collector

This is an unattended, read-only Codex task specification. It is not enabled until the separate infrastructure gate approves the R2 bucket, D1 migration, task, and Pages deploy.

## Fixed run contract

- Schedule: each US equity trading day at 15:55 America/New_York.
- Universe: call the Watcher `get_watchlist` API tool; use its active `tracked_assets` symbols only. Require exactly 50 symbols.
- Source: `robinhood_mcp`; use only `get_equity_quotes`, `get_option_chains`, `get_option_instruments`, and `get_option_quotes`. Never call account, order, position, watchlist-write, or exercise tools.
- Expiries: first eight valid, active expiry dates from a tradable, non-adjusted chain.
- Contracts: page instruments for each selected expiry, retain only strikes within spot ±20%, retain `trade_value_multiplier`, then request quotes in batches of at most 20 instrument IDs.
- Rows: publish only normalized rows with finite `OI`, `gamma`, `IV`, `delta`, `volume`, `mark`, a current `quoteUpdatedAt`, and the provider multiplier. Do not invent or backfill missing fields. Record dropped-row counts in the run diagnostic; never use a dropped row in GEX.
- GEX: `gamma × OI × multiplier × spot² × 0.01`. Calls are positive and puts negative. Label every result `OI-signed GEX proxy`; never call it dealer GEX.

## Publish protocol

1. Build `releases/<releaseId>/symbols/<SYMBOL>.json` and a manifest with SHA-256 for every object.
2. Require all 50 symbols, one to eight expiries per symbol, unique `expiry:strike:callPut`, valid ±20% bounds, current quotes, and schema `1.0`.
3. Write immutable R2 objects first. Write the D1 run row as `published` and atomically upsert `watcher_options_snapshot_current` only after every validation passes.
4. Write R2 `current.json` last. Its manifest key/hash, run ID, capture time, and `50/50` counters must match D1 exactly.
5. A partial or invalid run writes only a D1 `failed` diagnostic. It never changes D1 current or R2 `current.json`.

## Required task evidence

For each run retain only D1 metadata: run ID, start/finish/capture time, expected/completed symbols, eligible contract count, failed symbols, release ID, manifest key/hash, status, and failure code. Raw contracts remain private R2 only.

Before enabling production, run NVDA, TSLA, and AMD manually and once through an unattended scheduled dry-run. Record elapsed time, pagination count, quote-batch count, contracts dropped for missing fields, and OAuth outcome. The desktop app and computer must be running for the local Codex task.
