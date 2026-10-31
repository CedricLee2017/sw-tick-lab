import type { Env } from "../../../../../server/env";
import { bad } from "../../../../../server/http";
import { adminGuard } from "../../../../../server/admin";

interface Row {
  id: number;
  object_key: string | null;
  file_name: string;
}

/** GET /api/admin/uploads/:id/download → 從 R2 串流下載原始存檔 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await adminGuard(request, env);
  if ("error" in guard) return guard.error;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return bad(400, "編號不正確");

  const row = await env.DB.prepare("SELECT id, object_key, file_name FROM uploads WHERE id = ?1 AND deleted_at IS NULL")
    .bind(id)
    .first<Row>();
  if (!row || !row.object_key) return bad(404, "找不到這個存檔");

  const object = await env.SAVES.get(row.object_key);
  if (!object) return bad(404, "檔案已不存在");

  return new Response(object.body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      "cache-control": "no-store",
    },
  });
};
