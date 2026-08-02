import { isAllowedWatcherEmail, parseCookie, verifyWatcherSession } from "../../../../src/lib/stocks-watcher-auth";

interface Env { STOCKS_WATCHER_SESSION_SECRET?: string; STOCKS_WATCHER_ALLOWED_EMAIL?: string; }
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(init.headers || {}) } });

export async function onRequestGet(context: { request: Request; env?: Env }) {
  const env = context.env || {};
  const session = await verifyWatcherSession(parseCookie(context.request, "stocks_watcher_session"), env.STOCKS_WATCHER_SESSION_SECRET);
  if (!session || !isAllowedWatcherEmail(session.email, env.STOCKS_WATCHER_ALLOWED_EMAIL)) return json({ ok: true, authenticated: false });
  return json({ ok: true, authenticated: true, user: { email: session.email, expiresAt: session.expiresAt } });
}
