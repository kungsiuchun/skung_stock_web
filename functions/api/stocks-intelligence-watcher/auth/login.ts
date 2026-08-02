const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(init.headers || {}) } });

interface Env { GITHUB_CLIENT_ID?: string; STOCKS_WATCHER_AUTH_ORIGIN?: string; }

export async function onRequestGet(context: { request: Request; env?: Env }) {
  if (!context.env?.GITHUB_CLIENT_ID) return json({ ok: false, error: "AUTH_CONFIG_UNCONFIGURED" }, { status: 503 });
  const stateBytes = crypto.getRandomValues(new Uint8Array(32));
  let state = "";
  for (const byte of stateBytes) state += byte.toString(16).padStart(2, "0");
  const url = new URL(context.request.url);
  const redirectUri = `${context.env.STOCKS_WATCHER_AUTH_ORIGIN || url.origin}/api/stocks-intelligence-watcher/auth/callback`;
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", context.env.GITHUB_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("scope", "read:user user:email");
  authorize.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { Location: authorize.toString(), "Set-Cookie": `stocks_watcher_oauth_state=${state}; Max-Age=600; Path=/api/stocks-intelligence-watcher/auth; HttpOnly; Secure; SameSite=Lax` } });
}
