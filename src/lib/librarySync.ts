/**
 * 儲存庫同步：把「配裝儲存庫」與「預設隊儲存庫」跟著帳號走。
 * 存在 R2 的 library/u{userId}.json，沒有另外開 D1 資料表。
 */
import type { DeckFav, Loadout } from "../store";

export interface LibraryPayload {
  loadouts: Loadout[];
  deckFavs: DeckFav[];
}

interface LibraryResponse {
  loadouts?: Loadout[];
  deckFavs?: DeckFav[];
  updatedAt?: number | null;
}

const MAX_ITEMS = 60;

/** 依 id 取聯集：本機優先（保留本機順序），雲端獨有的接在後面。 */
export function mergeLibrary<T extends { id: string }>(local: T[], remote: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of local) {
    if (!item || typeof item.id !== "string" || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= MAX_ITEMS) return out;
  }
  for (const item of remote) {
    if (!item || typeof item.id !== "string" || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** GET /api/library */
export async function pullLibrary(): Promise<{ loadouts: Loadout[]; deckFavs: DeckFav[] }> {
  const res = await fetch("/api/library", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`讀取雲端儲存庫失敗（HTTP ${res.status}）`);

  const data = (await res.json().catch(() => ({}))) as LibraryResponse;
  return {
    loadouts: Array.isArray(data.loadouts) ? data.loadouts : [],
    deckFavs: Array.isArray(data.deckFavs) ? data.deckFavs : [],
  };
}

/** PUT /api/library */
export async function pushLibrary(payload: LibraryPayload): Promise<void> {
  const res = await fetch("/api/library", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      loadouts: payload.loadouts.slice(0, MAX_ITEMS),
      deckFavs: payload.deckFavs.slice(0, MAX_ITEMS),
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `儲存雲端儲存庫失敗（HTTP ${res.status}）`);
  }
}
