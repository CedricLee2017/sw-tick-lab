import { SESSION_TTL } from "./env";

const TEXT = new TextEncoder();
export const SESSION_COOKIE = "swtick_session";

export interface SessionPayload {
  uid: number;
  exp: number;
  v: 1;
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array {
  const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", TEXT.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** 簽發 `payload.signature` 的 session token（HMAC-SHA256） */
export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = b64url(TEXT.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, TEXT.encode(body)));
  return `${body}.${b64url(sig)}`;
}

/** 驗證 session token；過期、簽章不符或格式錯誤都回傳 null */
export async function verifySession(token: string, secret: string): Promise<SessionPayload | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify("HMAC", key, b64urlDecode(sig), TEXT.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as SessionPayload;
    if (!payload || typeof payload.uid !== "number" || typeof payload.exp !== "number") return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function newSession(uid: number): SessionPayload {
  return { uid, exp: Math.floor(Date.now() / 1000) + SESSION_TTL, v: 1 };
}
