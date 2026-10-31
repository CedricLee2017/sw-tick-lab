import type { Env } from "../../../server/env";
import { bad, json, sameOrigin, sessionCookie } from "../../../server/http";

/** POST /api/auth/logout → 清除 session cookie */
export const onRequestPost: PagesFunction<Env> = async ({ request }) => {
  if (!sameOrigin(request)) return bad(403, "來源不正確");
  return json(
    { ok: true },
    { headers: { "set-cookie": sessionCookie("", 0, new URL(request.url).protocol === "https:") } },
  );
};
