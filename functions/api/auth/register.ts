import { SESSION_TTL, type Env } from "../../../server/env";
import { bad, json, sameOrigin, sessionCookie } from "../../../server/http";
import { createUser, isAdminEmail, toPublicUser, userByEmail } from "../../../server/db";
import { hashVerifier, isVerifier, newSalt, normalizeEmail } from "../../../server/password";
import { newSession, signSession } from "../../../server/session";

/** POST /api/auth/register  { email, name, verifier } */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) return bad(403, "來源不正確");

  let body: { email?: string; name?: string; verifier?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad(400, "格式錯誤");
  }

  const email = normalizeEmail(body.email);
  if (!email) return bad(400, "Email 格式不正確");
  if (!isVerifier(body.verifier)) return bad(400, "密碼格式不正確");
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) || null : null;

  if (await userByEmail(env.DB, email)) return bad(409, "這個 Email 已經註冊過了");

  const salt = newSalt();
  const hash = await hashVerifier(body.verifier, salt);

  let user;
  try {
    user = await createUser(env.DB, { email, name, hash, salt, admin: isAdminEmail(env.ADMIN_EMAILS, email) });
  } catch {
    return bad(409, "這個 Email 已經註冊過了");
  }

  const token = await signSession(newSession(user.id), env.SESSION_SECRET);
  return json(
    { user: toPublicUser(user) },
    { status: 201, headers: { "set-cookie": sessionCookie(token, SESSION_TTL, new URL(request.url).protocol === "https:") } },
  );
};
