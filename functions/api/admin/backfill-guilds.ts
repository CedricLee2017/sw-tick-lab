import type { Env } from "../../../server/env";
import { bad, json, sameOrigin } from "../../../server/http";
import { adminGuard } from "../../../server/admin";

/** 一次最多補幾筆，避免單次請求讀太多 R2 檔案而逾時 */
const MAX_FILES = 10;

interface MissingRow {
  id: number;
  object_key: string | null;
}

function decodeJsonString(raw: string): string {
  try {
    return String(JSON.parse(`"${raw}"`)).trim();
  } catch {
    return raw.trim();
  }
}

/**
 * 從原始存檔文字抓公會名稱，不整份 JSON.parse（存檔可能 20MB 以上）。
 * 依序嘗試：
 *   1. guild.guild_info.name（SWEX / SWOP 完整資料）
 *   2. dimension_arena_user_info.guild_name（次元競技場的玩家資訊）
 *   3. 任何 guild_name 欄位（較舊的格式）
 */
function extractGuildName(text: string): string {
  const patterns = [
    /"guild_info"\s*:\s*\{[\s\S]{0,2000}?"name"\s*:\s*"((?:[^"\\]|\\.)*)"/,
    /"dimension_arena_user_info"\s*:\s*\{[\s\S]{0,1000}?"guild_name"\s*:\s*"((?:[^"\\]|\\.)*)"/,
    /"guild_name"\s*:\s*"((?:[^"\\]|\\.)*)"/,
  ];
  for (const re of patterns) {
    const match = re.exec(text);
    if (match?.[1]) {
      const name = decodeJsonString(match[1]).slice(0, 80);
      if (name) return name;
    }
  }
  return "";
}

/**
 * POST /api/admin/backfill-guilds  { limit?: number }
 * 補齊舊上傳紀錄的公會名稱：讀 R2 原始 JSON、抓公會名稱後寫回 D1。
 * 只處理 guild IS NULL 且有 object_key 的紀錄；找不到公會時寫入空字串，避免重複掃描。
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) return bad(403, "來源不正確");

  const guard = await adminGuard(request, env);
  if ("error" in guard) return guard.error;
  if (!env.SAVES) return bad(503, "存檔服務尚未設定完成");

  let limit = 5;
  try {
    const body = (await request.json()) as { limit?: number };
    const raw = Number(body?.limit);
    if (Number.isFinite(raw)) limit = Math.min(MAX_FILES, Math.max(1, Math.floor(raw)));
  } catch {
    /* 沒有 body 時用預設值 */
  }

  try {
    const rows = await env.DB.prepare(
      `SELECT id, object_key FROM uploads
       WHERE deleted_at IS NULL AND guild IS NULL AND object_key IS NOT NULL
       ORDER BY created_at DESC, id DESC
       LIMIT ?1`,
    )
      .bind(limit)
      .all<MissingRow>();

    let updated = 0;
    for (const row of rows.results ?? []) {
      if (!row.object_key) continue;
      let name = "";
      try {
        const object = await env.SAVES.get(row.object_key);
        if (object) name = extractGuildName(await object.text());
      } catch (err) {
        console.error("read save for guild failed", row.id, err instanceof Error ? err.message : err);
        continue;
      }
      try {
        await env.DB.prepare("UPDATE uploads SET guild = ?1 WHERE id = ?2").bind(name, row.id).run();
        updated++;
      } catch (err) {
        console.error("update guild failed", row.id, err instanceof Error ? err.message : err);
      }
    }

    const remaining = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM uploads WHERE deleted_at IS NULL AND guild IS NULL AND object_key IS NOT NULL",
    ).first<{ n: number }>();

    return json({ ok: true, updated, remaining: remaining?.n ?? 0 });
  } catch (err) {
    console.error("backfill guilds failed", err instanceof Error ? err.message : err);
    return bad(502, "補齊公會名稱失敗，請稍後再試");
  }
};
