/**
 * 抓取 Lucksack（RTA 數據）Guardian 3 的統計，存成靜態檔給網站使用。
 *
 *   node scripts/fetch-lucksack.mjs             # 全魔靈（約 10–20 分鐘）
 *   node scripts/fetch-lucksack.mjs --limit 30  # 只抓前 30 隻（測試用）
 *   node scripts/fetch-lucksack.mjs --season 39 --rank 16
 *
 * 產出：public/data/lucksack.json
 *
 * 為什麼要存下來：Lucksack 的 API 有 Cloudflare WAF（沒有瀏覽器標頭會 403），
 * 而且一次開很多魔靈很容易被擋。RTA 數據兩星期才需要更新一次，所以由這支腳本
 * 慢慢抓、精簡後存進 repo，網站直接讀 static 檔，不需要每次即時查詢。
 * 有新魔靈還沒收錄時，網站會退回 `/api/lucksack` 代理即時查。
 */
import fs from "node:fs/promises";
import path from "node:path";

const API = "https://api.lucksack.gg";
const STATIC = "https://static.lucksack.gg";
const OUT = path.resolve(import.meta.dirname, "../public/data/lucksack.json");

/** Lucksack 的 Guardian 3 rank id */
const DEFAULT_RANK = 16;
/** 神器效果使用率低於這個值就不收錄（未收錄 = 幾乎沒人用） */
const EFFECT_CUT = 0.002;
const CONCURRENCY = 3;

const HEADERS = {
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

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const RANK = argOf("rank", DEFAULT_RANK);
const LIMIT = argOf("limit", 0);
const SEASON_ARG = argOf("season", 0);

const round = (v) => Math.round((Number(v) || 0) * 10000) / 10000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 抓 JSON：204 / 404 視為沒有資料，其他錯誤重試 */
async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 204 || res.status === 404) return null;
      if (res.ok) {
        const text = await res.text();
        if (!text.trim()) return null;
        return JSON.parse(text);
      }
      // 403（WAF）或 5xx 等一下再試
      await sleep(700 * (i + 1) + Math.random() * 400);
    } catch {
      await sleep(700 * (i + 1));
    }
  }
  return null;
}

console.log("讀取 Lucksack 賽季與魔靈目錄…");
const seasons = await getJson(`${API}/seasons`);
const activeSeason = Array.isArray(seasons) ? seasons.find((s) => s.is_active) : null;
const SEASON = SEASON_ARG || Number(activeSeason?.season_number ?? 0);
if (!SEASON) throw new Error("讀不到目前賽季，請用 --season 指定");
console.log(`  賽季 ${SEASON} · rank ${RANK}`);

const catalog = await getJson(`${STATIC}/data/monsters_catalog.json`);
if (!Array.isArray(catalog)) throw new Error("讀不到魔靈目錄");
const monsters = catalog.filter((c) => c.searchable !== false && c.slug && c.com2us_id != null);
const targets = LIMIT > 0 ? monsters.slice(0, LIMIT) : monsters;
console.log(`  魔靈 ${targets.length} 隻`);

const roundStats = (stats) => {
  if (!stats || typeof stats !== "object") return null;
  const sets = (stats.rune_sets ?? []).slice(0, 6).map((s) => [
    s.primary_set,
    s.secondary_set ?? 0,
    s.tertiary_set ?? 0,
    round(s.pickrate),
    round(s.winrate),
  ]);
  const mains = (stats.slot_stats ?? []).slice(0, 5).map((s) => [
    s.slot_two,
    s.slot_four,
    s.slot_six,
    round(s.pickrate),
    round(s.winrate),
  ]);
  const effects = (rows) =>
    (rows ?? [])
      .filter((e) => (Number(e.pickrate) || 0) >= EFFECT_CUT)
      .slice(0, 24)
      .map((e) => [e.effect_id, round(e.pickrate)]);
  return { sets, mains, arts: effects(stats.artifact_type), arch: effects(stats.artifact_arch) };
};

const out = new Map();
let done = 0;
let failed = 0;
const queue = [...targets];

async function worker() {
  while (queue.length > 0) {
    const row = queue.shift();
    if (!row) continue;
    const slug = String(row.slug);
    const info = await getJson(`${STATIC}/data/monsters/${slug}.json`);
    const id = Number(info?.com2us_id ?? 0);
    if (!id) {
      failed++;
    } else {
      const [summary, stats] = await Promise.all([
        getJson(`${API}/monsters/${id}/summary?season=${SEASON}&rank=${RANK}`),
        getJson(`${API}/monsters/${id}/stats?season=${SEASON}&rank=${RANK}`),
      ]);
      const trimmed = roundStats(stats);
      const hasStats =
        trimmed && (trimmed.sets.length > 0 || trimmed.mains.length > 0 || trimmed.arts.length > 0 || trimmed.arch.length > 0);
      if (summary || hasStats) {
        out.set(id, {
          id,
          cid: Number(row.com2us_id),
          slug,
          name: String(row.slabel ?? row.name ?? row.label ?? slug),
          el: elementId(row.element),
          nat: Number(row.natural_stars) || 0,
          pick: round(summary?.pick_rate ?? 0),
          win: round(summary?.win_rate ?? 0),
          games: Number(summary?.battle_count ?? 0),
          ...(trimmed ?? { sets: [], mains: [], arts: [], arch: [] }),
        });
      } else {
        failed++;
      }
    }
    done++;
    if (done % 50 === 0) console.log(`  ${done}/${targets.length}（收錄 ${out.size}、失敗 ${failed}）`);
  }
}

function elementId(name) {
  return { Water: 1, Fire: 2, Wind: 3, Light: 4, Dark: 5 }[String(name ?? "")] ?? 0;
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

const data = {
  source: "lucksack.gg",
  season: SEASON,
  rank: RANK,
  rankGroup: "Guardian 3",
  effectCut: EFFECT_CUT,
  updatedAt: new Date().toISOString(),
  monsters: [...out.values()].sort((a, b) => a.id - b.id),
};
await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(data));
const bytes = (await fs.stat(OUT)).size;
console.log(`完成：${data.monsters.length} 隻 → ${path.relative(process.cwd(), OUT)}（${(bytes / 1024).toFixed(0)} KB）`);
