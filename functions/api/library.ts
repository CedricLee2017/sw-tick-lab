import type { Env } from "../../server/env";
import { bad, json, sameOrigin } from "../../server/http";
import { currentUser } from "../../server/auth";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 60;

interface LibraryItem {
  id: string;
  [key: string]: unknown;
}

interface LibraryBody {
  loadouts: LibraryItem[];
  deckFavs: LibraryItem[];
}

function keyFor(userId: number): string {
  return `library/u${userId}.json`;
}

/** 只保留帶字串 id 的物件，並限制筆數，避免被塞入奇怪的內容。 */
function cleanList(raw: unknown): LibraryItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: LibraryItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    out.push(item as LibraryItem);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function normalize(raw: unknown): LibraryBody | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as { loadouts?: unknown; deckFavs?: unknown };
  if (!Array.isArray(body.loadouts) && !Array.isArray(body.deckFavs)) return null;
  return { loadouts: cleanList(body.loadouts), deckFavs: cleanList(body.deckFavs) };
}

/**
 * GET /api/library
 * 讀取目前會員的儲存庫（配裝儲存庫 + 預設隊儲存庫）。
 * 還沒有資料時回空陣列，前端可直接合併。
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await currentUser(request, env);
  if (!user) return bad(401, "請先登入");
  if (!env.SAVES) return bad(503, "雲端儲存庫尚未設定完成");

  try {
    const object = await env.SAVES.get(keyFor(user.id));
    if (!object) return json({ loadouts: [], deckFavs: [], updatedAt: null });

    const text = await object.text();
    const data = normalize(JSON.parse(text) as unknown) ?? { loadouts: [], deckFavs: [] };
    const updatedAt = object.uploaded ? object.uploaded.getTime() : null;
    return json({ ...data, updatedAt });
  } catch (err) {
    console.error("read library failed", err instanceof Error ? err.message : err);
    return bad(502, "讀取雲端儲存庫失敗");
  }
};

/**
 * PUT /api/library
 * 覆寫目前會員的儲存庫。前端會先合併本機與雲端資料再寫回。
 */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) return bad(403, "來源不正確");

  const user = await currentUser(request, env);
  if (!user) return bad(401, "請先登入");
  if (!env.SAVES) return bad(503, "雲端儲存庫尚未設定完成");

  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > MAX_BYTES) return bad(413, "儲存庫資料過大");

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return bad(400, "格式不正確");
  }

  const data = normalize(raw);
  if (!data) return bad(400, "格式不正確");

  try {
    const body = JSON.stringify({ ...data, savedAt: Math.floor(Date.now() / 1000) });
    await env.SAVES.put(keyFor(user.id), body, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { userId: String(user.id) },
    });
    return json({ ok: true, loadouts: data.loadouts.length, deckFavs: data.deckFavs.length });
  } catch (err) {
    console.error("write library failed", err instanceof Error ? err.message : err);
    return bad(502, "儲存雲端儲存庫失敗");
  }
};
