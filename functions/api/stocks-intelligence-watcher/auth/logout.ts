export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", "Set-Cookie": "stocks_watcher_session=; Max-Age=0; Path=/api/stocks-intelligence-watcher; HttpOnly; Secure; SameSite=Lax", "Cache-Control": "no-store" } });
}
