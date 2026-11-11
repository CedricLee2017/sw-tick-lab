import type { Env } from "../../server/env";
import { bad, json, sameOrigin } from "../../server/http";
import { currentUser } from "../../server/auth";

const MAX_BYTES = 25 * 1024 * 1024;
const DAILY_LIMIT = 30;

function safeName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "save.json";
  // 保留中文與空白，只清掉路徑／控制字元；開頭的點避免變成隱藏檔或 ".."。
  const cleaned = base
    .replace(/[\u0000-\u001f<>:"|?*]+/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  const withExt = cleaned.toLowerCase().endsWith(".json") ? cleaned : `${cleaned || "save"}.json`;
  return withExt.slice(0, 120);
}

/** 標頭值由前端 encodeURIComponent 送出；舊版沒解碼就直接存進 D1。 */
function decodeHeader(raw: string | null): string {
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** 保留中文，只去掉 R2 key 不能出現的路徑／控制字元。 */
function safeSegment(raw: string): string {
  return raw.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 60);
}

function stamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

interface MyUploadRow {
  id: number;
  file_name: string;
  size: number;
  wizard: string | null;
  monster_count: number | null;
  rune_count: number | null;
  created_at: number;
}

/**
 * GET /api/uploads?limit=&offset=
 * 目前登入會員自己的上傳紀錄（新到舊），用來顯示「雲端存檔」。
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await currentUser(request, env);
  if (!user) return bad(401, "請先登入");

  const url = new URL(request.url);
  const raw = Number(url.searchParams.get("limit") ?? 10);
  const limit = Number.isFinite(raw) ? Math.min(30, Math.max(1, Math.floor(raw))) : 10;
  const rawOffset = Number(url.searchParams.get("offset") ?? 0);
  const offset = Number.isFinite(rawOffset) ? Math.min(100_000, Math.max(0, Math.floor(rawOffset))) : 0;

  try {
    const rows = await env.DB.prepare(
      `SELECT id, file_name, size, wizard, monster_count, rune_count, created_at
       FROM uploads
       WHERE user_id = ?1 AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT ?2 OFFSET ?3`,
    )
      .bind(user.id, limit, offset)
      .all<MyUploadRow>();

    return json({
      uploads: (rows.results ?? []).map((row) => ({
        ...row,
        wizard: decodeHeader(row.wizard),
      })),
    });
  } catch (err) {
    console.error("list uploads failed", err instanceof Error ? err.message : err);
    return bad(502, "讀取雲端存檔失敗");
  }
};

/**
 * POST /api/uploads
 * 把原始 JSON 串流寫進 R2，並在 D1 記一筆。
 * 選填標頭：x-sw-file-name / x-sw-wizard / x-sw-monsters / x-sw-runes
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) return bad(403, "來源不正確");

  const user = await currentUser(request, env);
  if (!user) return bad(401, "請先登入");
  if (!env.SAVES) return bad(503, "上傳服務尚未設定完成");

  const size = Number(request.headers.get("content-length") ?? 0);
  if (!size) return bad(411, "缺少檔案大小");
  if (size > MAX_BYTES) return bad(413, `檔案超過 ${Math.round(MAX_BYTES / 1024 / 1024)}MB`);
  if (!request.body) return bad(400, "沒有檔案內容");

  const since = Math.floor(Date.now() / 1000) - 86400;
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM uploads WHERE user_id = ?1 AND created_at >= ?2 AND deleted_at IS NULL")
    .bind(user.id, since)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= DAILY_LIMIT) return bad(429, "今天上傳次數已達上限，請明天再試");

  let name = "save.json";
  try {
    name = safeName(decodeURIComponent(request.headers.get("x-sw-file-name") ?? "save.json"));
  } catch {
    /* 保留預設檔名 */
  }

  const now = Math.floor(Date.now() / 1000);
  const wizard = decodeHeader(request.headers.get("x-sw-wizard")).trim().slice(0, 80) || null;
  const who = wizard ? `${safeSegment(wizard)}-` : "";
  const key = `saves/u${user.id}/${who}${stamp()}-${name}`;
  const monsters = Number(request.headers.get("x-sw-monsters") ?? 0) || null;
  const runes = Number(request.headers.get("x-sw-runes") ?? 0) || null;

  try {
    await env.SAVES.put(key, request.body, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { userId: String(user.id), fileName: name },
    });

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO uploads (user_id, file_id, object_key, storage, file_name, size, wizard, monster_count, rune_count, created_at)
         VALUES (?1, NULL, ?2, 'r2', ?3, ?4, ?5, ?6, ?7, ?8)`,
      ).bind(user.id, key, name, size, wizard, monsters, runes, now),
      env.DB.prepare("UPDATE users SET consent_at = COALESCE(consent_at, ?1) WHERE id = ?2").bind(now, user.id),
    ]);

    return json({ ok: true, key, name });
  } catch (err) {
    console.error("upload failed", err instanceof Error ? err.message : err);
    return bad(502, "存檔上傳失敗，請稍後再試");
  }
};
