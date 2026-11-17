export async function onRequestPost() {
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  for (const path of ["/api", "/api/stocks-intelligence-watcher"]) {
    headers.append("Set-Cookie", `stocks_watcher_session=; Max-Age=0; Path=${path}; HttpOnly; Secure; SameSite=Lax`);
  }
  return new Response(JSON.stringify({ ok: true }), { headers });
}
