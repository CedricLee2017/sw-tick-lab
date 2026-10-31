/** 密碼雜湊：瀏覽器端先做 PBKDF2，伺服器再用隨機 salt 做一次 SHA-256 */
const TEXT = new TextEncoder();

function b64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function newSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return b64(bytes);
}

export async function hashVerifier(verifier: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", TEXT.encode(`${salt}:${verifier}`));
  return b64(new Uint8Array(digest));
}

/** 固定時間比較，避免用長度 / 內容差異推測密碼 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 5 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/** 瀏覽器 PBKDF2 32 bytes → base64 為 44 字元（允許省略 padding） */
export function isVerifier(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Za-z0-9+/]{43}=?$/.test(raw);
}
