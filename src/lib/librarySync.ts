/**
 * 儲存庫同步：把「配裝儲存庫」與「預設隊儲存庫」跟著帳號走。
 * 存在 R2 的 library/u{userId}.json，沒有另外開 D1 資料表。
 *
 * 合併規則：
 * - 同一個 id 以 `updatedAt`（沒有時用 `createdAt`）較新的一方為準。
 * - 雲端有、本機沒有的項目直接補進來。
 * - 本機有、雲端沒有的項目：
 *   - 建立/更新時間晚於上次同步 → 視為本機新資料，保留並上傳。
 *   - 早於上次同步 → 視為在別台裝置被刪除，本機也移除。
 * 這樣「修改」與「刪除」都能跨裝置同步，而不會用舊資料蓋掉新資料。
 */
import type { DeckFav, Loadout } from "../store";

export interface LibraryPayload {
  loadouts: Loadout[];
  deckFavs: DeckFav[];
}

export interface PulledLibrary extends LibraryPayload {
  /** 雲端檔案最後上傳時間（ms）；沒有資料時為 null */
  updatedAt: number | null;
}

interface LibraryResponse {
  loadouts?: Loadout[];
  deckFavs?: DeckFav[];
  updatedAt?: number | null;
}

export interface MergeResult<T> {
  items: T[];
  /** 本機資料需要更新（雲端有較新版本，或本機項目已被別台刪除） */
  changed: boolean;
  /** 雲端需要更新（本機有較新版本，或有雲端沒有的新項目） */
  push: boolean;
}

const MAX_ITEMS = 60;

const itemTime = (x: { createdAt?: number; updatedAt?: number }): number =>
  Math.max(0, Number(x.updatedAt ?? x.createdAt ?? 0) || 0);

/**
 * 依 id 合併本機與雲端儲存庫。
 *
 * @param lastSyncAt 上次成功同步的時間；第一次同步可傳雲端 `updatedAt`，
 *                   沒有雲端資料時傳 0（全部保留本機資料）。
 */
export function mergeLibrary<T extends { id: string; createdAt?: number; updatedAt?: number }>(
  local: T[],
  remote: T[],
  lastSyncAt: number,
): MergeResult<T> {
  const remoteById = new Map<string, T>();
  for (const item of remote) {
    if (!item || typeof item.id !== "string" || !item.id || remoteById.has(item.id)) continue;
    remoteById.set(item.id, item);
  }

  const out: T[] = [];
  const seen = new Set<string>();
  let changed = false;
  let push = false;

  const add = (item: T): boolean => {
    if (seen.has(item.id)) return true;
    seen.add(item.id);
    out.push(item);
    return out.length < MAX_ITEMS;
  };

  // 先照本機順序排；同一 id 由較新的一方勝出
  for (const l of local) {
    if (!l || typeof l.id !== "string" || !l.id || seen.has(l.id)) continue;
    const r = remoteById.get(l.id);
    if (r) {
      if (itemTime(r) > itemTime(l)) {
        changed = true;
        if (!add(r)) break;
      } else {
        if (itemTime(l) > itemTime(r)) push = true;
        if (!add(l)) break;
      }
      continue;
    }
    // 雲端沒有這個 id
    if (lastSyncAt <= 0 || itemTime(l) > lastSyncAt) {
      // 上次同步後才建立 / 更新 → 本機新資料
      push = true;
      if (!add(l)) break;
    } else {
      // 上次同步時已經存在，現在雲端沒有 → 別台刪除了
      changed = true;
    }
  }

  // 雲端獨有的項目接在後面
  for (const r of remote) {
    if (!r || typeof r.id !== "string" || !r.id || seen.has(r.id)) continue;
    changed = true;
    if (!add(r)) break;
  }

  // 即使上面的旗標沒觸發，內容或順序不同也回寫一次
  if (!push) push = JSON.stringify(out) !== JSON.stringify(remote.slice(0, MAX_ITEMS));
  return { items: out, changed, push };
}

/** GET /api/library */
export async function pullLibrary(): Promise<PulledLibrary> {
  const res = await fetch("/api/library", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`讀取雲端儲存庫失敗（HTTP ${res.status}）`);

  const data = (await res.json().catch(() => ({}))) as LibraryResponse;
  return {
    loadouts: Array.isArray(data.loadouts) ? data.loadouts : [],
    deckFavs: Array.isArray(data.deckFavs) ? data.deckFavs : [],
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : null,
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
