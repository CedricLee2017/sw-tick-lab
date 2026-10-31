import { SESSION_TTL, type Env } from "../../../server/env";
import { bad, json, sameOrigin, sessionCookie } from "../../../server/http";
import { isAdminEmail, toPublicUser, upsertUser } from "../../../server/db";
import { verifyGoogleIdToken } from "../../../server/google";
import { newSession, signSession } from "../../../server/session";

/** POST /api/auth/google  { credential } → 驗證 Google ID token 並建立 session cookie */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) return bad(403, "來源不正確");

  if (!env.GOOGLE_CLIENT_ID) return bad(503, "登入服務尚未設定（缺少 GOOGLE_CLIENT_ID）");
  if (!env.SESSION_SECRET) return bad(503, "登入服務尚未設定（缺少 SESSION_SECRET）");

  let body: { credential?: string };
  try {
    body = (await request.json()) as { credential?: string };
  } catch {
    return bad(400, "格式錯誤");
  }
  if (!body.credential) return bad(400, "缺少 Google 登入憑證");

  let profile;
  try {
    profile = await verifyGoogleIdToken(body.credential, env.GOOGLE_CLIENT_ID);
  } catch {
    return bad(401, "Google 登入驗證失敗，請重新登入");
  }
  if (!profile.emailVerified) return bad(403, "這個 Google 帳號的 Email 尚未驗證");

  const user = await upsertUser(env.DB, profile, isAdminEmail(env.ADMIN_EMAILS, profile.email));
  if (user.status !== "active") return bad(403, "這個帳號已被停用");

  const token = await signSession(newSession(user.id), env.SESSION_SECRET);
  return json(
    { user: toPublicUser(user) },
    {
      headers: {
        "set-cookie": sessionCookie(token, SESSION_TTL, new URL(request.url).protocol === "https:"),
      },
    },
  );
};
