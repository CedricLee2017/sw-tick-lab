import type { Env } from "../../server/env";
import { bad, json } from "../../server/http";

/**
 * Lucksack（RTA 數據網站）代理。
 *
 *   GET /api/lucksack?seasons=1                 → { current: 39, seasons: [...] }
 *   GET /api/lucksack?catalog=1                 → [{ id, slug, name, el, nat }, ...]
 *   GET /api/lucksack?slug=ashour&season=39&rank=16
 *       → { monster, summary, stats }
 *
 * 他們的 API 有 Cloudflare WAF，沒有瀏覽器標頭會直接 403，
 * 所以這裡補上 Origin / Referer / Sec-Fetch-* 再轉發，並用邊緣快取降低請求量。
 */

const API = "https://api.lucksack.gg";
const STATIC = "https://static.lucksack.gg";

const UPSTREAM_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://lucksack.gg",
  Referer: "https://lucksack.gg/",
  "Sec-Fetch-Site": "same-site",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
};

const ELEMENT_ID: Record<string, number> = { Water: 1, Fire: 2, Wind: 3, Light: 4, Dark: 5 };

interface FetchOk {
  ok: true;
  data: unknown;
}
interface FetchErr {
  ok: false;
  status: number;
}
type FetchResult = FetchOk | FetchErr;

/** 透過邊緣快取抓 JSON；`ttl` 秒內不重複向 Lucksack 要資料 */
async function fetchJson(url: string, ttl: number): Promise<FetchResult> {
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(url, { method: "GET" });
  const cached = await cache.match(key);
  if (cached) {
    try {
      return { ok: true, data: await cached.json() };
    } catch {
      /* 快取壞掉就重新抓 */
    }
  }
  const res = await fetch(url, { headers: UPSTREAM_HEADERS });
  if (!res.ok) return { ok: false, status: res.status };
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, status: 502 };
  }
  const stored = new Response(text, {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${ttl}` },
  });
  await cache.put(key, stored);
  return { ok: true, data };
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 魔靈目錄只留前端需要的欄位，順便縮小傳輸量 */
interface CatalogRow {
  com2us_id?: string | number;
  slug?: string;
  slabel?: string;
  label?: string;
  name?: string;
  element?: string;
  natural_stars?: number;
  searchable?: boolean;
}

export const onRequestGet: PagesFunction<Env> = async ({ request }) => {
  const url = new URL(request.url);
  const params = url.searchParams;

  // 賽季：前端用這支決定目前賽季編號
  if (params.has("seasons")) {
    const res = await fetchJson(`${API}/seasons`, 60 * 60 * 12);
    if (!res.ok) return bad(502, `Lucksack 賽季資料讀取失敗（${res.status}）`);
    const rows = Array.isArray(res.data) ? (res.data as { season_number?: number | null; is_active?: boolean; season_name?: string }[]) : [];
    const active = rows.find((s) => s.is_active);
    const seasons = rows
      .filter((s) => typeof s.season_number === "number" && s.season_number > 0)
      .map((s) => ({ number: s.season_number as number, name: s.season_name ?? `Season ${s.season_number}`, active: !!s.is_active }));
    return json({ current: active?.season_number ?? seasons[0]?.number ?? null, seasons });
  }

  // 魔靈目錄（id → slug / 名稱 / 屬性）
  if (params.has("catalog")) {
    const res = await fetchJson(`${STATIC}/data/monsters_catalog.json`, 60 * 60 * 24);
    if (!res.ok) return bad(502, `Lucksack 魔靈目錄讀取失敗（${res.status}）`);
    const rows = Array.isArray(res.data) ? (res.data as CatalogRow[]) : [];
    const catalog = rows
      .filter((r) => r.searchable !== false && r.slug && r.com2us_id != null)
      .map((r) => ({
        id: Number(r.com2us_id),
        slug: String(r.slug),
        name: String(r.slabel ?? r.name ?? r.label ?? "").replace(/\s*\(.*\)\s*$/, ""),
        el: ELEMENT_ID[String(r.element ?? "")] ?? 0,
        nat: Number(r.natural_stars ?? 0),
      }))
      .filter((r) => Number.isFinite(r.id) && r.id > 0);
    return json(catalog, { headers: { "cache-control": "public, max-age=86400" } });
  }

  // 單一魔靈：先由 slug 取得 Lucksack 實際使用的 monster id，再抓 summary / stats
  const slug = (params.get("slug") ?? "").trim().toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return bad(400, "slug 格式不正確");
  const season = clampInt(params.get("season"), 39, 1, 999);
  const rank = clampInt(params.get("rank"), 16, 0, 999);

  const info = await fetchJson(`${STATIC}/data/monsters/${slug}.json`, 60 * 60 * 24);
  if (!info.ok) return bad(502, `Lucksack 找不到魔靈資料（${info.status}）`);
  const raw = info.data as {
    com2us_id?: number;
    com2us_name?: string;
    name?: string;
    element?: string;
    natural_stars?: number;
  };
  const id = Number(raw.com2us_id ?? 0);
  if (!Number.isFinite(id) || id <= 0) return bad(502, "Lucksack 魔靈資料格式不正確");

  const [summary, stats] = await Promise.all([
    fetchJson(`${API}/monsters/${id}/summary?season=${season}&rank=${rank}`, 60 * 60 * 3),
    fetchJson(`${API}/monsters/${id}/stats?season=${season}&rank=${rank}`, 60 * 60 * 3),
  ]);
  if (!stats.ok) return bad(502, `Lucksack 統計資料讀取失敗（${stats.status}）`);

  return json({
    monster: {
      slug,
      id,
      name: raw.name ?? raw.com2us_name ?? slug,
      com2usName: raw.com2us_name ?? null,
      element: raw.element ?? null,
      naturalStars: raw.natural_stars ?? null,
    },
    summary: summary.ok ? summary.data : null,
    stats: stats.data,
  });
};
