import type { D1DatabaseLike } from "./spx-recap-d1";
import { reserveMarketCacheRefreshQuota } from "./stocks-watcher-refresh-quota";

export class PublicResearchLimitError extends Error {
  constructor(message: string, public status = 429, public retryAt?: string) { super(message); }
}

/** Fixed keys bound retention. D1 serializes each conditional increment across isolates. */
export async function reservePublicCounter(db: D1DatabaseLike | undefined, key: string, window: string, limit: number, units = 1, now = new Date()) {
  if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(units) || units < 1 || units > limit) throw new PublicResearchLimitError("Invalid usage reservation.", 503);
  if (!db) throw new PublicResearchLimitError("Usage limits cannot be verified. This feature is paused.", 503);
  // Includes this counter's indexed write and the quota guard itself.
  const budget = await reserveMarketCacheRefreshQuota(db, { cacheEntryWrites: 1, loaderRowsRead: 1 }, now);
  if (!budget.allow) throw new PublicResearchLimitError("The shared data allowance is exhausted or unavailable.", budget.reason.includes("unavailable") || budget.reason.includes("invalid") ? 503 : 429, budget.resetsAtUtc);
  let row: { payload_json: string } | null;
  try {
    row = await db.prepare(`INSERT INTO market_cache_entries
      (cache_key, scope, symbol, schema_version, payload_json, source_as_of, cached_at, expires_at, last_refresh_error, last_refresh_attempted_at)
      VALUES (?, 'public-research-limit', 'MARKET', 1, json_object('window', ?, 'used', CAST(? AS INTEGER)), NULL, ?, ?, NULL, ?)
      ON CONFLICT(cache_key) DO UPDATE SET payload_json = json_object('window', ?, 'used',
        CASE WHEN json_extract(payload_json, '$.window') < ? THEN CAST(? AS INTEGER) ELSE json_extract(payload_json, '$.used') + CAST(? AS INTEGER) END),
        cached_at = excluded.cached_at, expires_at = excluded.expires_at
      WHERE json_valid(payload_json) AND json_type(payload_json, '$.used') = 'integer'
        AND json_type(payload_json, '$.window') = 'text' AND json_extract(payload_json, '$.used') >= 0
        AND (json_extract(payload_json, '$.window') < ? OR
          (json_extract(payload_json, '$.window') = ? AND json_extract(payload_json, '$.used') + ? <= ?))
      RETURNING payload_json`).bind(`__public_limit__:${key}`, window, units, now.toISOString(),
      new Date(now.getTime() + 62 * 86400000).toISOString(), now.toISOString(), window, window, units, units, window, window, units, limit)
      .first<{ payload_json: string }>();
  } catch { throw new PublicResearchLimitError("Usage limits cannot be verified. This feature is paused.", 503); }
  if (!row) {
    let current: { payload_json: string } | null;
    try { current = await db.prepare("SELECT payload_json FROM market_cache_entries WHERE cache_key = ?").bind(`__public_limit__:${key}`).first<{ payload_json: string }>(); }
    catch { throw new PublicResearchLimitError("Usage limits cannot be verified.", 503); }
    let usage: { window?: unknown; used?: unknown } = {};
    try { const parsed = JSON.parse(current?.payload_json || "{}"); usage = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { /* Invalid stored JSON is rejected below. */ }
    if (usage.window !== window || typeof usage.used !== "number" || !Number.isInteger(usage.used) || usage.used < 0) throw new PublicResearchLimitError("Usage limit state is invalid. This feature is paused.", 503);
    const reset = new Date(window.length === 7 ? `${window}-01T00:00Z` : window.length === 10 ? `${window}T00:00Z` : `${window}:00Z`);
    if (window.length === 7) reset.setUTCMonth(reset.getUTCMonth() + 1);
    else reset.setTime(reset.getTime() + (window.length === 10 ? 86400000 : 60000));
    throw new PublicResearchLimitError(`The shared free allowance has been reached. Resets ${reset.toISOString()}.`, 429, reset.toISOString());
  }
  const value = JSON.parse(row.payload_json) as { window: string; used: number };
  if (value.window !== window || !Number.isInteger(value.used) || value.used < units || value.used > limit) {
    throw new PublicResearchLimitError("Usage limit state is invalid. This feature is paused.", 503);
  }
  return { used: value.used, limit, window };
}

export async function reservePublicAiAttempt(db: D1DatabaseLike | undefined, now = new Date()) {
  // Reserve the day first. Failed/limited attempts are deliberately not refunded.
  const day = await reservePublicCounter(db, "ai-day", now.toISOString().slice(0, 10), 40, 1, now);
  await reservePublicCounter(db, "ai-minute", now.toISOString().slice(0, 16), 10, 1, now);
  return day;
}

const r2Credits = new WeakMap<D1DatabaseLike, { month: string; remaining: number; pending: Promise<void> | null }>();
/** Reserve 32 reads atomically before spending any. Lost isolate credits are never refunded.
 * This keeps the conservative 2M/month ceiling without a D1 write for every R2 read. */
export async function reservePublicR2Read(db: D1DatabaseLike | undefined, now = new Date()) {
  if (!db) throw new PublicResearchLimitError("R2 usage limits cannot be verified. Published data is paused.", 503);
  let state = r2Credits.get(db);
  if (!state) { state = { month: "", remaining: 0, pending: null }; r2Credits.set(db, state); }
  const month = now.toISOString().slice(0, 7);
  for (;;) {
    if (state.month === month && state.remaining > 0) { state.remaining--; return; }
    if (!state.pending) {
      const current = state;
      current.pending = reservePublicCounter(db, "r2-month", month, 2_000_000, 32, now)
        .then(() => { current.month = month; current.remaining = 32; })
        .finally(() => { current.pending = null; });
    }
    await state.pending;
  }
}
