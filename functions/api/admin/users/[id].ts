import type { Env } from "../../../../server/env";
import { bad, json, sameOrigin } from "../../../../server/http";
import { adminGuard } from "../../../../server/admin";
import { toPublicUser, userById } from "../../../../server/db";

/** PATCH /api/admin/users/:id  { status?: 'active'|'disabled', role?: 'user'|'admin', tier?: 'basic'|'full' } */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!sameOrigin(request)) return bad(403, "來源不正確");
  const guard = await adminGuard(request, env);
  if ("error" in guard) return guard.error;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return bad(400, "會員編號不正確");

  let body: { status?: string; role?: string; tier?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad(400, "格式錯誤");
  }

  const status = body.status === "active" || body.status === "disabled" ? body.status : null;
  const role = body.role === "user" || body.role === "admin" ? body.role : null;
  const tier = body.tier === "basic" || body.tier === "full" ? body.tier : null;
  if (!status && !role && !tier) return bad(400, "沒有可更新的欄位");

  if (id === guard.user.id && (status === "disabled" || role === "user")) {
    return bad(400, "不能停用或降級自己的帳號");
  }

  const current = await userById(env.DB, id);
  if (!current) return bad(404, "找不到會員");

  // 管理員一律擁有完整功能；一般會員則依 tier 決定。
  const nextRole = role ?? current.role;
  const nextTier = nextRole === "admin" ? "full" : (tier ?? current.tier ?? "basic");

  await env.DB.prepare("UPDATE users SET status = ?1, role = ?2, tier = ?3 WHERE id = ?4")
    .bind(status ?? current.status, nextRole, nextTier, id)
    .run();

  const updated = await userById(env.DB, id);
  return json({ user: updated ? toPublicUser(updated) : null });
};
