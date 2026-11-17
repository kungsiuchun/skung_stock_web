/** Only server-to-server credentials belong here. Browser owners use Pages OAuth. */
export async function authorizeSpxWorkerRequest(request: Request, secret: string | undefined): Promise<Response | null> {
  const headers = { "Cache-Control": "no-store" };
  if (!secret?.trim()) return Response.json({ error: "SPX worker authentication is not configured." }, { status: 503, headers });
  if (new URL(request.url).searchParams.has("token")) return Response.json({ error: "Query-string credentials are not accepted. Use the Authorization header." }, { status: 401, headers });
  const bearer = /^Bearer ([^\s]+)$/i.exec(request.headers.get("Authorization") || "")?.[1];
  if (!bearer) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const encoder = new TextEncoder();
  const [expected, received] = await Promise.all([secret, bearer].map(value => crypto.subtle.digest("SHA-256", encoder.encode(value))));
  const a = new Uint8Array(expected), b = new Uint8Array(received);
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0 ? null : Response.json({ error: "Unauthorized" }, { status: 401, headers });
}
