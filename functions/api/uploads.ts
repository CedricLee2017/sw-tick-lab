import type { Env } from "../../server/env";
import { bad, json, sameOrigin } from "../../server/http";
import { currentUser } from "../../server/auth";
import { driveConfigured, uploadToDrive } from "../../server/drive";

const MAX_BYTES = 25 * 1024 * 1024;
const DAILY_LIMIT = 30;

function safeName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "save.json";
  const cleaned = base.replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "");
  const withExt = cleaned.toLowerCase().endsWith(".json") ? cleaned : `${cleaned || "save"}.json`;
  return withExt.slice(0, 120);
}

function stamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

/**
 * POST /api/uploads
 * 直接把原始 JSON 當 body 串流到 Google Drive（不在 Worker 解析存檔）。
 * 選填標頭：x-sw-file-name / x-sw-wizard / x-sw-monsters / x-sw-runes
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) return bad(403, "來源不正確");

  const user = await currentUser(request, env);
  if (!user) return bad(401, "請先登入");
  if (!driveConfigured(env)) return bad(503, "上傳服務尚未設定完成");

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
    const raw = decodeURIComponent(request.headers.get("x-sw-file-name") ?? "save.json");
    name = safeName(raw);
  } catch {
    /* 保留預設檔名 */
  }

  const driveName = `${stamp()}_u${user.id}_${name}`;
  const now = Math.floor(Date.now() / 1000);
  const wizard = (request.headers.get("x-sw-wizard") ?? "").slice(0, 80) || null;
  const monsters = Number(request.headers.get("x-sw-monsters") ?? 0) || null;
  const runes = Number(request.headers.get("x-sw-runes") ?? 0) || null;

  try {
    const file = await uploadToDrive(env, {
      name: driveName,
      size,
      body: request.body,
      contentType: "application/json",
    });

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO uploads (user_id, file_id, file_name, size, wizard, monster_count, rune_count, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      ).bind(user.id, file.id, file.name, size, wizard, monsters, runes, now),
      env.DB.prepare("UPDATE users SET consent_at = COALESCE(consent_at, ?1) WHERE id = ?2").bind(now, user.id),
    ]);

    return json({ ok: true, fileId: file.id, name: file.name });
  } catch (err) {
    console.error("upload failed", err instanceof Error ? err.message : err);
    return bad(502, "上傳到 Google Drive 失敗，請稍後再試");
  }
};
