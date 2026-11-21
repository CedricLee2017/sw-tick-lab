import type { Env } from "../../../server/env";
import { bad, json, sameOrigin } from "../../../server/http";
import { currentUser } from "../../../server/auth";
import { hashSiegeToken, newSiegeToken, type SiegeTokenRow } from "../../../server/siege";

interface TokenMetaRow {
  token_prefix: string;
  created_at: number;
  last_used_at: number | null;
}

function meta(row: TokenMetaRow | null) {
  return row
    ? {
        prefix: row.token_prefix,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
      }
    : null;
}

/** GET /api/siege/token：目前會員是否已建立上傳金鑰（不回傳金鑰本身） */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await currentUser(request, env);
  if (!user) return bad(401, "請先登入");
  const row = await env.DB.prepare(
    "SELECT token_prefix, created_at, last_used_at FROM siege_tokens WHERE user_id = ?1",
  )
    .bind(user.id)
    .first<TokenMetaRow>();
  return json({ token: meta(row) });
};

/** POST /api/siege/token：建立（或重新建立）上傳金鑰；金鑰只回傳這一次 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) return bad(403, "來源不正確");
  const user = await currentUser(request, env);
  if (!user) return bad(401, "請先登入");

  const token = newSiegeToken();
  const hash = await hashSiegeToken(token);
  const prefix = token.slice(0, 12);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO siege_tokens (user_id, token_hash, token_prefix, created_at, last_used_at)
     VALUES (?1, ?2, ?3, ?4, NULL)
     ON CONFLICT(user_id) DO UPDATE SET
       token_hash = excluded.token_hash,
       token_prefix = excluded.token_prefix,
       created_at = excluded.created_at,
       last_used_at = NULL`,
  )
    .bind(user.id, hash, prefix, now)
    .run();

  return json({ ok: true, token, prefix, createdAt: now });
};

/** DELETE /api/siege/token：撤銷上傳金鑰 */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) return bad(403, "來源不正確");
  const user = await currentUser(request, env);
  if (!user) return bad(401, "請先登入");
  await env.DB.prepare("DELETE FROM siege_tokens WHERE user_id = ?1").bind(user.id).run();
  return json({ ok: true });
};

export type { SiegeTokenRow };
