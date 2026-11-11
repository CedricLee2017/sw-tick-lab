import type { Env } from "../../../server/env";
import { bad, sameOrigin } from "../../../server/http";
import { currentUser } from "../../../server/auth";

interface Row {
  id: number;
  object_key: string | null;
  file_name: string;
  wizard: string | null;
  monster_count: number | null;
  rune_count: number | null;
  created_at: number;
}

/** 標頭值統一 encodeURIComponent，避免中文／換行讓 Response header 出錯。 */
function encodeHeader(raw: string | null): string {
  return encodeURIComponent(raw ?? "");
}

function decodeHeader(raw: string | null): string {
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * GET /api/uploads/:id
 * 回傳目前會員自己某一筆上傳的原始存檔。
 * 只能讀自己的紀錄；找不到或已刪除回 404。
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const user = await currentUser(request, env);
  if (!user) return bad(401, "請先登入");
  if (!env.SAVES) return bad(503, "雲端存檔尚未設定完成");

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return bad(400, "編號不正確");

  try {
    const row = await env.DB.prepare(
      `SELECT id, object_key, file_name, wizard, monster_count, rune_count, created_at
       FROM uploads
       WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL AND object_key IS NOT NULL`,
    )
      .bind(id, user.id)
      .first<Row>();

    if (!row || !row.object_key) return bad(404, "找不到這個存檔");

    const object = await env.SAVES.get(row.object_key);
    if (!object) return bad(404, "檔案已不存在");

    const name = decodeHeader(row.file_name) || "cloud-save.json";
    return new Response(object.body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "x-sw-upload-id": String(row.id),
        "x-sw-file-name": encodeHeader(row.file_name),
        "x-sw-wizard": encodeHeader(row.wizard),
        "x-sw-created-at": String(row.created_at),
        "x-sw-monsters": String(row.monster_count ?? 0),
        "x-sw-runes": String(row.rune_count ?? 0),
      },
    });
  } catch (err) {
    console.error("load cloud save failed", err instanceof Error ? err.message : err);
    return bad(502, "讀取雲端存檔失敗");
  }
};

/**
 * DELETE /api/uploads/:id
 * 手動刪除自己的某一筆雲端存檔：先刪 R2 檔案，再把 D1 紀錄標記為已刪除。
 * 本機已載入的存檔不受影響。
 */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!sameOrigin(request)) return bad(403, "來源不正確");

  const user = await currentUser(request, env);
  if (!user) return bad(401, "請先登入");

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return bad(400, "編號不正確");

  try {
    const row = await env.DB.prepare(
      "SELECT id, object_key FROM uploads WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL",
    )
      .bind(id, user.id)
      .first<{ id: number; object_key: string | null }>();
    if (!row) return bad(404, "找不到這個存檔");

    if (row.object_key && env.SAVES) await env.SAVES.delete(row.object_key);

    await env.DB.prepare("UPDATE uploads SET deleted_at = ?1 WHERE id = ?2 AND user_id = ?3")
      .bind(Math.floor(Date.now() / 1000), id, user.id)
      .run();

    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("delete cloud save failed", err instanceof Error ? err.message : err);
    return bad(502, "刪除雲端存檔失敗，請稍後再試");
  }
};
