import type { Env } from "../../../server/env";
import { bad, json, sameOrigin } from "../../../server/http";
import { currentUser } from "../../../server/auth";
import { hashVerifier, isVerifier, newSalt, safeEqual } from "../../../server/password";

/** POST /api/auth/password  { current, next } → 修改密碼（需登入） */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) return bad(403, "來源不正確");

  const user = await currentUser(request, env);
  if (!user) return bad(401, "請先登入");

  let body: { current?: string; next?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad(400, "格式錯誤");
  }
  if (!isVerifier(body.next)) return bad(400, "新密碼格式不正確");

  if (user.password_hash && user.password_salt) {
    if (!isVerifier(body.current)) return bad(400, "請輸入目前密碼");
    const current = await hashVerifier(body.current, user.password_salt);
    if (!safeEqual(current, user.password_hash)) return bad(403, "目前密碼不正確");
  }

  const salt = newSalt();
  const hash = await hashVerifier(body.next, salt);
  await env.DB.prepare("UPDATE users SET password_hash = ?1, password_salt = ?2, password_updated_at = ?3 WHERE id = ?4")
    .bind(hash, salt, Math.floor(Date.now() / 1000), user.id)
    .run();

  return json({ ok: true });
};
