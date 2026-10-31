/**
 * 瀏覽器端密碼雜湊（PBKDF2-SHA256，21 萬次）。
 * 送到伺服器的不是密碼，而是推導出來的 verifier；伺服器再以隨機 salt 做 SHA-256。
 * 這樣免費方案的 Worker 幾乎不耗 CPU，離線破解成本仍等同 PBKDF2。
 */
const ITERATIONS = 210_000;
const SALT_PREFIX = "swtick-lab:v1:";
const TEXT = new TextEncoder();

export async function deriveVerifier(email: string, password: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", TEXT.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: TEXT.encode(`${SALT_PREFIX}${email.trim().toLowerCase()}`),
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    key,
    256,
  );
  const bytes = new Uint8Array(bits);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
