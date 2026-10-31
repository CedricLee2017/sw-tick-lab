import type { Env } from "../../../../server/env";
import { bad, sameOrigin } from "../../../../server/http";
import { adminGuard } from "../../../../server/admin";

/** DELETE /api/admin/uploads/:id → 刪除 R2 檔案並標記 D1 */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!sameOrigin(request)) return bad(403, "來源不正確");
  const guard = await adminGuard(request, env);
  if ("error" in guard) return guard.error;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return bad(400, "編號不正確");

  const row = await env.DB.prepare("SELECT id, object_key FROM uploads WHERE id = ?1 AND deleted_at IS NULL")
    .bind(id)
    .first<{ id: number; object_key: string | null }>();
  if (!row) return bad(404, "找不到這個存檔");

  if (row.object_key) await env.SAVES.delete(row.object_key);
  await env.DB.prepare("UPDATE uploads SET deleted_at = ?1 WHERE id = ?2")
    .bind(Math.floor(Date.now() / 1000), id)
    .run();

  return new Response(null, { status: 204 });
};
