import type { Env } from "../../../server/env";
import { json } from "../../../server/http";
import { adminGuard, paging } from "../../../server/admin";

interface AdminUserRow {
  id: number;
  email: string;
  name: string | null;
  role: string;
  status: string;
  created_at: number;
  last_login_at: number | null;
  uploads: number;
}

/** GET /api/admin/users?q=&limit=&offset= */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await adminGuard(request, env);
  if ("error" in guard) return guard.error;

  const url = new URL(request.url);
  const { limit, offset } = paging(url);
  const q = (url.searchParams.get("q") ?? "").trim();

  const where = q ? "WHERE (u.email LIKE ?1 OR u.name LIKE ?1)" : "";
  const params = q ? [`%${q}%`] : [];
  const listSql = `SELECT u.id, u.email, u.name, u.role, u.status, u.created_at, u.last_login_at,
      (SELECT COUNT(*) FROM uploads up WHERE up.user_id = u.id AND up.deleted_at IS NULL) AS uploads
    FROM users u ${where}
    ORDER BY u.created_at DESC
    LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`;
  const totalSql = `SELECT COUNT(*) AS n FROM users u ${where}`;

  const [list, total] = await Promise.all([
    env.DB.prepare(listSql).bind(...params, limit, offset).all<AdminUserRow>(),
    env.DB.prepare(totalSql).bind(...params).first<{ n: number }>(),
  ]);

  return json({ users: list.results ?? [], total: total?.n ?? 0, limit, offset });
};
