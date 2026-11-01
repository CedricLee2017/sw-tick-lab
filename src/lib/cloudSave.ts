/**
 * 雲端存檔：讀取會員自己上傳到 R2 的原始 JSON。
 * 只在登入且後端有開通存檔備份（config.uploads）時使用。
 */

export interface CloudUpload {
  id: number;
  fileName: string;
  size: number;
  wizard: string;
  monsterCount: number;
  runeCount: number;
  /** Unix 秒 */
  createdAt: number;
}

export interface LatestCloudSave {
  id: number;
  fileName: string;
  wizard: string;
  createdAt: number;
  monsterCount: number;
  runeCount: number;
  text: string;
}

function decodeValue(raw: string | null): string {
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function num(raw: string | null): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** GET /api/uploads → 自己的上傳紀錄（新到舊）。未登入時回空陣列。 */
export async function listMyUploads(limit = 10): Promise<CloudUpload[]> {
  const res = await fetch(`/api/uploads?limit=${limit}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (res.status === 401) return [];
  if (!res.ok) throw new Error(`讀取雲端存檔失敗（HTTP ${res.status}）`);

  const data = (await res.json().catch(() => ({}))) as {
    uploads?: {
      id: number;
      file_name: string;
      size: number;
      wizard: string | null;
      monster_count: number | null;
      rune_count: number | null;
      created_at: number;
    }[];
  };

  return (data.uploads ?? []).map((row) => ({
    id: row.id,
    fileName: row.file_name,
    size: row.size,
    wizard: row.wizard ?? "",
    monsterCount: row.monster_count ?? 0,
    runeCount: row.rune_count ?? 0,
    createdAt: row.created_at,
  }));
}

/** GET /api/uploads/latest → 最新一筆存檔原文；沒有紀錄時回 null。 */
export async function loadLatestSave(): Promise<LatestCloudSave | null> {
  const res = await fetch("/api/uploads/latest", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (res.status === 204 || res.status === 401) return null;
  if (!res.ok) throw new Error(`讀取雲端存檔失敗（HTTP ${res.status}）`);

  const text = await res.text();
  if (!text.trim()) return null;

  return {
    id: num(res.headers.get("x-sw-upload-id")),
    fileName: decodeValue(res.headers.get("x-sw-file-name")) || "cloud-save.json",
    wizard: decodeValue(res.headers.get("x-sw-wizard")),
    createdAt: num(res.headers.get("x-sw-created-at")),
    monsterCount: num(res.headers.get("x-sw-monsters")),
    runeCount: num(res.headers.get("x-sw-runes")),
    text,
  };
}

/** 把 Unix 秒轉成在地時間字串。 */
export function formatCloudTime(seconds: number): string {
  if (!seconds) return "時間不明";
  return new Date(seconds * 1000).toLocaleString("zh-TW");
}
