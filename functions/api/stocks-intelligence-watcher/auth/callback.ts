import { createWatcherSession, isAllowedWatcherEmail, parseCookie } from "../../../../src/lib/stocks-watcher-auth";

interface Env { GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string; STOCKS_WATCHER_SESSION_SECRET?: string; STOCKS_WATCHER_ALLOWED_EMAIL?: string; STOCKS_WATCHER_AUTH_ORIGIN?: string; }
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(init.headers || {}) } });

export async function onRequestGet(context: { request: Request; env?: Env }) {
  const env = context.env || {};
  const requestUrl = new URL(context.request.url);
  const stateCookie = parseCookie(context.request, "stocks_watcher_oauth_state");
  const state = requestUrl.searchParams.get("state");
  const code = requestUrl.searchParams.get("code");
  const oauthError = requestUrl.searchParams.get("error");
  if (oauthError) return json({ ok: false, error: "AUTH_PROVIDER_DENIED" }, { status: 400 });
  if (!stateCookie || !state || stateCookie !== state || !code) return json({ ok: false, error: "AUTH_STATE_INVALID" }, { status: 400 });
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.STOCKS_WATCHER_SESSION_SECRET || !env.STOCKS_WATCHER_ALLOWED_EMAIL) return json({ ok: false, error: "AUTH_CONFIG_UNCONFIGURED" }, { status: 503 });
  const redirectUri = `${env.STOCKS_WATCHER_AUTH_ORIGIN || requestUrl.origin}/api/stocks-intelligence-watcher/auth/callback`;
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: redirectUri, state }) });
  if (!tokenResponse.ok) return json({ ok: false, error: "AUTH_GITHUB_TOKEN_FAILED" }, { status: 502 });
  const tokenBody = await tokenResponse.json() as { access_token?: string };
  if (!tokenBody.access_token) return json({ ok: false, error: "AUTH_GITHUB_TOKEN_MISSING" }, { status: 502 });
  const headers = { Authorization: `Bearer ${tokenBody.access_token}`, Accept: "application/vnd.github+json" };
  const [userResponse, emailsResponse] = await Promise.all([fetch("https://api.github.com/user", { headers }), fetch("https://api.github.com/user/emails", { headers })]);
  if (!userResponse.ok || !emailsResponse.ok) return json({ ok: false, error: "AUTH_GITHUB_PROFILE_FAILED" }, { status: 502 });
  const user = await userResponse.json() as { email?: string | null };
  const emails = await emailsResponse.json() as Array<{ email?: string; verified?: boolean }>;
  const email = emails.find((entry) => entry.verified && isAllowedWatcherEmail(entry.email || "", env.STOCKS_WATCHER_ALLOWED_EMAIL))?.email || (user.email && isAllowedWatcherEmail(user.email, env.STOCKS_WATCHER_ALLOWED_EMAIL) ? user.email : null);
  if (!email) return json({ ok: false, error: "AUTH_EMAIL_NOT_ALLOWED" }, { status: 403 });
  const session = await createWatcherSession(email, env.STOCKS_WATCHER_SESSION_SECRET);
  const location = new URL("/", requestUrl.origin);
  location.hash = "/work/stocks-intelligence-watcher?auth=success";
  const responseHeaders = new Headers({ Location: location.toString() });
  responseHeaders.append("Set-Cookie", `stocks_watcher_session=${session}; Max-Age=28800; Path=/api/stocks-intelligence-watcher; HttpOnly; Secure; SameSite=Lax`);
  responseHeaders.append("Set-Cookie", "stocks_watcher_oauth_state=; Max-Age=0; Path=/api/stocks-intelligence-watcher/auth; HttpOnly; Secure; SameSite=Lax");
  return new Response(null, { status: 302, headers: responseHeaders });
}
