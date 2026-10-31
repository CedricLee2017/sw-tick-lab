/**
 * Google ID token 驗證（Google Identity Services 前端登入）。
 * 只做一次性驗證，之後用我們自己的 HMAC session cookie。
 */
const TEXT = new TextEncoder();
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const JWKS_TTL = 60 * 60; // 1 小時

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

interface Jwk extends JsonWebKey {
  kid?: string;
  alg?: string;
}

let jwksCache: { keys: Jwk[]; at: number } | null = null;

function b64urlBytes(value: string): Uint8Array {
  const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlBytes(value))) as T;
}

async function loadJwks(): Promise<Jwk[]> {
  const now = Date.now() / 1000;
  if (jwksCache && now - jwksCache.at < JWKS_TTL) return jwksCache.keys;

  // 先看邊緣快取，避免每個 colo 都打 Google
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(JWKS_URL);
  let resp = await cache.match(cacheKey);
  if (!resp) {
    resp = await fetch(JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (resp.ok) await cache.put(cacheKey, new Response(resp.clone().body, resp));
  }
  if (!resp.ok) throw new Error("jwks fetch failed");
  const data = (await resp.json()) as { keys?: Jwk[] };
  const keys = data.keys ?? [];
  if (keys.length === 0) throw new Error("jwks empty");
  jwksCache = { keys, at: now };
  return keys;
}

/** 驗證失敗會丟出錯誤；成功回傳 Google 帳號資料 */
export async function verifyGoogleIdToken(credential: string, clientId: string): Promise<GoogleProfile> {
  const parts = credential.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [rawHeader, rawPayload, rawSig] = parts;

  const header = b64urlJson<{ alg?: string; kid?: string }>(rawHeader);
  if (header.alg !== "RS256" || !header.kid) throw new Error("unsupported alg");

  const keys = await loadJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("unknown key");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlBytes(rawSig),
    TEXT.encode(`${rawHeader}.${rawPayload}`),
  );
  if (!ok) throw new Error("bad signature");

  const claims = b64urlJson<{
    iss?: string;
    aud?: string;
    sub?: string;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
    picture?: string;
    exp?: number;
    iat?: number;
  }>(rawPayload);

  if (claims.iss !== "accounts.google.com" && claims.iss !== "https://accounts.google.com") {
    throw new Error("bad issuer");
  }
  if (claims.aud !== clientId) throw new Error("bad audience");
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw new Error("expired");
  if (!claims.sub || !claims.email) throw new Error("missing claims");

  return {
    sub: claims.sub,
    email: claims.email.toLowerCase(),
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    name: claims.name,
    picture: claims.picture,
  };
}
