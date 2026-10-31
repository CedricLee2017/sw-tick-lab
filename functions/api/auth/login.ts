import { SESSION_TTL, type Env } from "../../../server/env";
import { bad, clientIp, json, sameOrigin, sessionCookie } from "../../../server/http";
import { toPublicUser, userByEmail } from "../../../server/db";
import { hashVerifier, isVerifier, normalizeEmail, safeEqual } from "../../../server/password";
import { newSession, signSession } from "../../../server/session";

const MAX_ATTEMPTS = 10;
const WINDOW_SECONDS = 15 * 60;

/** POST /api/auth/login  { email, verifier } */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) return bad(403, "來源不正確");

  let body: { email?: string; verifier?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad(400, "格式錯誤");
  }

  const email = normalizeEmail(body.email);
  if (!email || !isVerifier(body.verifier)) return bad(400, "請輸入 Email 與密碼");

  const now = Math.floor(Date.now() / 1000);
  const key = `login:${clientIp(request)}:${email}`;
  const attempt = await env.DB.prepare("SELECT count, reset_at FROM login_attempts WHERE key = ?1").bind(key).first<{ count: number; reset_at: number }>();
  if (attempt && attempt.reset_at > now && attempt.count >= MAX_ATTEMPTS) {
    const wait = Math.ceil((attempt.reset_at - now) / 60);
    return bad(429, `嘗試次數過多，請 ${wait} 分鐘後再試`);
  }

  const fail = async () => {
    const resetAt = attempt && attempt.reset_at > now ? attempt.reset_at : now + WINDOW_SECONDS;
    const count = attempt && attempt.reset_at > now ? attempt.count + 1 : 1;
    await env.DB.prepare(
      "INSERT INTO login_attempts (key, count, reset_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at",
    )
      .bind(key, count, resetAt)
      .run();
    return bad(401, "Email 或密碼不正確");
  };

  const user = await userByEmail(env.DB, email);
  if (!user || !user.password_hash || !user.password_salt) return fail();
  if (user.status !== "active") return bad(403, "這個帳號已被停用");

  const hash = await hashVerifier(body.verifier, user.password_salt);
  if (!safeEqual(hash, user.password_hash)) return fail();

  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_attempts WHERE key = ?1").bind(key),
    env.DB.prepare("UPDATE users SET last_login_at = ?1 WHERE id = ?2").bind(now, user.id),
  ]);

  const token = await signSession(newSession(user.id), env.SESSION_SECRET);
  return json(
    { user: toPublicUser({ ...user, last_login_at: now }) },
    { headers: { "set-cookie": sessionCookie(token, SESSION_TTL, new URL(request.url).protocol === "https:") } },
  );
};
