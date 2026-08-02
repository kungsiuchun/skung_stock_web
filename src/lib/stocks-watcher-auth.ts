const encoder = new TextEncoder();

const base64UrlEncode = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const base64UrlDecode = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const hmac = async (value: string, secret: string) => {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
};

const constantTimeEqual = (left: Uint8Array, right: Uint8Array) => {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) difference |= (left[index] || 0) ^ (right[index] || 0);
  return difference === 0;
};

export interface WatcherSession { email: string; issuedAt: number; expiresAt: number; }

export const createWatcherSession = async (emailInput: string, secret: string, now = Date.now()) => {
  if (!secret) throw new Error("AUTH_CONFIG_INVALID: session secret is required.");
  const email = emailInput.trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("AUTH_INVALID: email is invalid.");
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({ email, issuedAt: now, expiresAt: now + 8 * 60 * 60 * 1000 })));
  return `${payload}.${base64UrlEncode(await hmac(payload, secret))}`;
};

export const verifyWatcherSession = async (cookieValue: string | null | undefined, secret: string | undefined, now = Date.now()): Promise<WatcherSession | null> => {
  if (!cookieValue || !secret) return null;
  const [payloadPart, signaturePart] = cookieValue.split(".");
  if (!payloadPart || !signaturePart) return null;
  let payload: WatcherSession;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart))) as WatcherSession;
    const signature = base64UrlDecode(signaturePart);
    if (!constantTimeEqual(signature, await hmac(payloadPart, secret))) return null;
  } catch { return null; }
  if (typeof payload.email !== "string" || typeof payload.issuedAt !== "number" || typeof payload.expiresAt !== "number") return null;
  if (payload.expiresAt <= now || payload.issuedAt > now + 60_000) return null;
  return { email: payload.email, issuedAt: payload.issuedAt, expiresAt: payload.expiresAt };
};

export const parseCookie = (request: Request, name: string) => {
  const header = request.headers.get("Cookie") || "";
  return header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || null;
};

export const allowedWatcherEmails = (value: string | undefined) => new Set((value || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));

export const isAllowedWatcherEmail = (email: string, allowed: string | undefined) => allowedWatcherEmails(allowed).has(email.trim().toLowerCase());
