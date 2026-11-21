import type { Env } from "../../../server/env";
import { bad, json, sameOrigin } from "../../../server/http";
import { currentUser } from "../../../server/auth";
import { normalizeBattleList, siegeUploader } from "../../../server/siege";
import type { SiegeBattle } from "../../../src/lib/siegeBattleCore";

const MAX_BODY = 1_500_000;
const MAX_BATCH = 500;

interface BattleRow {
  battle_uid: string;
  battle_type: string;
  wizard_id: number | null;
  wizard_name: string | null;
  guild_id: number | null;
  guild_name: string | null;
  opp_guild_id: number | null;
  opp_guild_name: string | null;
  opp_wizard_id: number | null;
  opp_wizard_name: string | null;
  battle_key: string | null;
  battle_time: number;
  win: number;
  battle_rank: number | null;
  defense_units: string;
  counter_units: string;
  user_id: number;
}

function units(raw: string): number[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
  } catch {
    return [];
  }
}

function rowToBattle(row: BattleRow): SiegeBattle {
  return {
    uid: row.battle_uid,
    battleType: row.battle_type,
    wizardId: Number(row.wizard_id ?? 0),
    wizardName: row.wizard_name ?? "",
    guildId: Number(row.guild_id ?? 0),
    guildName: row.guild_name ?? "",
    oppGuildId: Number(row.opp_guild_id ?? 0),
    oppGuildName: row.opp_guild_name ?? "",
    oppWizardId: Number(row.opp_wizard_id ?? 0),
    oppWizardName: row.opp_wizard_name ?? "",
    battleKey: row.battle_key ?? "",
    time: Number(row.battle_time ?? 0),
    win: Number(row.win) === 1,
    rank: Number(row.battle_rank ?? 0),
    defense: units(row.defense_units),
    counter: units(row.counter_units),
  };
}

/**
 * GET /api/siege/battles?scope=mine|guild&guild=公會名稱&limit=200&offset=0
 * 需要登入 cookie；guild scope 只會回傳自己上傳過的公會，或存檔公會名稱相符的紀錄。
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await currentUser(request, env);
  if (!user) return bad(401, "請先登入");

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") === "guild" ? "guild" : "mine";
  const guild = (url.searchParams.get("guild") ?? "").trim().slice(0, 80);
  const rawLimit = Number(url.searchParams.get("limit") ?? 200);
  const limit = Number.isFinite(rawLimit) ? Math.min(1000, Math.max(1, Math.floor(rawLimit))) : 200;
  const rawOffset = Number(url.searchParams.get("offset") ?? 0);
  const offset = Number.isFinite(rawOffset) ? Math.min(100_000, Math.max(0, Math.floor(rawOffset))) : 0;

  let where = "user_id = ?1";
  let binds: unknown[] = [user.id];
  let allowedGuild = "";

  if (scope === "guild") {
    if (guild) {
      const owns = await env.DB.prepare(
        `SELECT 1 AS ok FROM siege_battles
         WHERE user_id = ?1 AND (guild_name = ?2 OR opp_guild_name = ?2) LIMIT 1`,
      )
        .bind(user.id, guild)
        .first<{ ok: number }>();
      if (owns?.ok) allowedGuild = guild;
      else {
        const saved = await env.DB.prepare(
          `SELECT 1 AS ok FROM uploads WHERE user_id = ?1 AND guild = ?2 AND deleted_at IS NULL LIMIT 1`,
        )
          .bind(user.id, guild)
          .first<{ ok: number }>();
        if (saved?.ok) allowedGuild = guild;
      }
    }

    if (allowedGuild) {
      // 自己的進攻紀錄（guild_name）與別人打我們防守的紀錄（opp_guild_name）都要看到
      where = "(guild_name = ?1 OR opp_guild_name = ?1)";
      binds = [allowedGuild];
    } else {
      // 沒有指定公會時：用自己上傳過的公會 id / 名稱，讓同公會成員的上傳也能看到
      where = `(guild_id IN (
                  SELECT DISTINCT guild_id FROM siege_battles
                  WHERE user_id = ?1 AND guild_id IS NOT NULL AND guild_id <> 0
                )
                OR guild_name IN (
                  SELECT DISTINCT guild_name FROM siege_battles
                  WHERE user_id = ?1 AND guild_name IS NOT NULL AND guild_name <> ''
                ))`;
      binds = [user.id];
    }
  }

  try {
    const rows = await env.DB.prepare(
      `SELECT battle_uid, battle_type, wizard_id, wizard_name, guild_id, guild_name,
              opp_guild_id, opp_guild_name, opp_wizard_id, opp_wizard_name,
              battle_key, battle_time, win, battle_rank, defense_units, counter_units, user_id
       FROM siege_battles
       WHERE ${where}
       ORDER BY battle_time DESC, id DESC
       LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
    )
      .bind(...binds, limit, offset)
      .all<BattleRow>();

    const battles = (rows.results ?? []).map(rowToBattle);
    return json({
      battles,
      hasMore: battles.length === limit,
      scope,
      guild: allowedGuild,
    });
  } catch (err) {
    console.error("list siege battles failed", err instanceof Error ? err.message : err);
    return bad(502, "讀取據點戰紀錄失敗");
  }
};

/**
 * POST /api/siege/battles
 * 接受 SWEX 外掛自動上傳（Authorization: Bearer <token>）或網站內登入 cookie。
 * Body：單場 3MDC 物件、陣列，或 `{ battles: [...] }`。
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) return bad(403, "來源不正確");

  const uploader = await siegeUploader(request, env);
  if (!uploader) return bad(401, "上傳金鑰無效或尚未登入");

  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > MAX_BODY) return bad(413, "本次上傳資料過大");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad(400, "不是有效的 JSON");
  }

  const battles = normalizeBattleList(body);
  if (battles.length === 0) return bad(400, "沒有有效的據點戰紀錄（需要三隻防守＋至少一隻進攻）");
  if (battles.length > MAX_BATCH) return bad(413, `一次最多 ${MAX_BATCH} 場`);

  const now = Math.floor(Date.now() / 1000);
  const statements = battles.map((battle) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO siege_battles
        (battle_uid, user_id, battle_type, wizard_id, wizard_name, guild_id, guild_name,
         opp_guild_id, opp_guild_name, opp_wizard_id, opp_wizard_name,
         battle_key, battle_time, win, battle_rank, defense_units, counter_units, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`,
    ).bind(
      battle.uid,
      uploader.userId,
      battle.battleType,
      battle.wizardId || null,
      battle.wizardName || null,
      battle.guildId || null,
      battle.guildName || null,
      battle.oppGuildId || null,
      battle.oppGuildName || null,
      battle.oppWizardId || null,
      battle.oppWizardName || null,
      battle.battleKey || null,
      battle.time || now,
      battle.win ? 1 : 0,
      battle.rank || null,
      JSON.stringify(battle.defense),
      JSON.stringify(battle.counter),
      now,
    ),
  );

  try {
    let inserted = 0;
    // D1 batch 太長容易撞限制；50 場一批
    for (let i = 0; i < statements.length; i += 50) {
      const results = await env.DB.batch(statements.slice(i, i + 50));
      for (const result of results) {
        inserted += Number((result.meta as { changes?: number } | undefined)?.changes ?? 0);
      }
    }
    return json({ ok: true, received: battles.length, inserted, duplicates: battles.length - inserted });
  } catch (err) {
    console.error("upload siege battles failed", err instanceof Error ? err.message : err);
    return bad(502, "儲存據點戰紀錄失敗，請稍後再試");
  }
};
