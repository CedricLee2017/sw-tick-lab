import type { Env } from "../../../../../server/env";
import { bad } from "../../../../../server/http";
import { adminGuard } from "../../../../../server/admin";

interface Row {
  id: number;
  object_key: string | null;
  file_name: string;
  wizard: string | null;
}

function decodeWizard(raw: string | null): string {
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** GET /api/admin/uploads/:id/download → 從 R2 串流下載原始存檔 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await adminGuard(request, env);
  if ("error" in guard) return guard.error;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return bad(400, "編號不正確");

  const row = await env.DB.prepare("SELECT id, object_key, file_name, wizard FROM uploads WHERE id = ?1 AND deleted_at IS NULL")
    .bind(id)
    .first<Row>();
  if (!row || !row.object_key) return bad(404, "找不到這個存檔");

  const object = await env.SAVES.get(row.object_key);
  if (!object) return bad(404, "檔案已不存在");

  // 下載檔名帶上玩家遊戲 ID，避免只看到一串數字。
  const wizard = decodeWizard(row.wizard).trim();
  const downloadName = (wizard ? `${wizard}-${row.file_name}` : row.file_name)
    .replace(/[\\/:*?"<>|\r\n]+/g, "_")
    .slice(0, 160);

  return new Response(object.body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      "cache-control": "no-store",
    },
  });
};
