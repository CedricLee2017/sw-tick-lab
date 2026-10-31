import type { Env } from "./env";
import { bad } from "./http";
import { currentUser } from "./auth";
import type { UserRow } from "./db";

export async function adminGuard(request: Request, env: Env): Promise<{ user: UserRow } | { error: Response }> {
  const user = await currentUser(request, env);
  if (!user) return { error: bad(401, "請先登入") };
  if (user.role !== "admin") return { error: bad(403, "需要管理員權限") };
  return { user };
}

export function paging(url: URL, defaultLimit = 50): { limit: number; offset: number } {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? defaultLimit) || defaultLimit));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  return { limit, offset };
}
