import type { Env } from "../../../server/env";
import { bad, json, readCookie } from "../../../server/http";
import { toPublicUser, userById } from "../../../server/db";
import { SESSION_COOKIE, verifySession } from "../../../server/session";

/** GET /api/auth/me → 目前的會員資料（未登入回 401） */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return bad(401, "未登入");

  const session = await verifySession(token, env.SESSION_SECRET);
  if (!session) return bad(401, "登入已過期，請重新登入");

  const user = await userById(env.DB, session.uid);
  if (!user) return bad(401, "找不到會員資料");
  if (user.status !== "active") return bad(403, "這個帳號已被停用");

  return json({ user: toPublicUser(user) });
};
