import type { Env } from "../../../server/env";
import { bad } from "../../../server/http";
import { currentUser } from "../../../server/auth";

interface LatestRow {
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

/**
 * GET /api/uploads/latest
 * 回傳目前會員最新一筆未刪除的原始存檔。
 * 沒有紀錄時回 204；中繼資料放在 x-sw-* 標頭。
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await currentUser(request, env);
  if (!user) return bad(401, "請先登入");
  if (!env.SAVES) return bad(503, "雲端存檔尚未設定完成");

  try {
    const row = await env.DB.prepare(
      `SELECT id, object_key, file_name, wizard, monster_count, rune_count, created_at
       FROM uploads
       WHERE user_id = ?1 AND deleted_at IS NULL AND object_key IS NOT NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    )
      .bind(user.id)
      .first<LatestRow>();

    if (!row || !row.object_key) return new Response(null, { status: 204 });

    const object = await env.SAVES.get(row.object_key);
    if (!object) return new Response(null, { status: 204 });

    return new Response(object.body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-sw-upload-id": String(row.id),
        "x-sw-file-name": encodeHeader(row.file_name),
        "x-sw-wizard": encodeHeader(row.wizard),
        "x-sw-created-at": String(row.created_at),
        "x-sw-monsters": String(row.monster_count ?? 0),
        "x-sw-runes": String(row.rune_count ?? 0),
      },
    });
  } catch (err) {
    console.error("load latest save failed", err instanceof Error ? err.message : err);
    return bad(502, "讀取雲端存檔失敗");
  }
};
