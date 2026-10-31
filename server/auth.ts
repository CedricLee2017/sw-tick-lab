import type { Env } from "./env";
import { readCookie } from "./http";
import { SESSION_COOKIE, verifySession } from "./session";
import { userById, type UserRow } from "./db";

/** 從 cookie 取出目前登入且有效的會員；未登入或停用回傳 null */
export async function currentUser(request: Request, env: Env): Promise<UserRow | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const session = await verifySession(token, env.SESSION_SECRET);
  if (!session) return null;
  const user = await userById(env.DB, session.uid);
  if (!user || user.status !== "active") return null;
  return user;
}
