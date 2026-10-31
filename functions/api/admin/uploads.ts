import type { Env } from "../../../server/env";
import { json } from "../../../server/http";
import { adminGuard, paging } from "../../../server/admin";

interface AdminUploadRow {
  id: number;
  user_id: number;
  email: string;
  file_name: string;
  size: number;
  wizard: string | null;
  monster_count: number | null;
  rune_count: number | null;
  created_at: number;
  object_key: string | null;
}

/** GET /api/admin/uploads?limit=&offset= */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await adminGuard(request, env);
  if ("error" in guard) return guard.error;

  const url = new URL(request.url);
  const { limit, offset } = paging(url);

  const [list, total, bytes] = await Promise.all([
    env.DB.prepare(
      `SELECT up.id, up.user_id, u.email, up.file_name, up.size, up.wizard, up.monster_count, up.rune_count, up.created_at, up.object_key
       FROM uploads up JOIN users u ON u.id = up.user_id
       WHERE up.deleted_at IS NULL
       ORDER BY up.created_at DESC
       LIMIT ?1 OFFSET ?2`,
    )
      .bind(limit, offset)
      .all<AdminUploadRow>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM uploads WHERE deleted_at IS NULL").first<{ n: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(size), 0) AS bytes FROM uploads WHERE deleted_at IS NULL").first<{ bytes: number }>(),
  ]);

  return json({
    uploads: list.results ?? [],
    total: total?.n ?? 0,
    totalBytes: bytes?.bytes ?? 0,
    limit,
    offset,
  });
};
