/**
 * 從 SWARFARM API 產生技能傷害資料（public/data/skills.json）
 * 用法：node scripts/fetch-skills.mjs
 *
 * 只保留傷害計算需要的欄位，避免檔案過大：
 * - 每隻魔靈（com2us_id）對應的技能 ID
 * - 技能名稱 / 段數 / 範圍 / 被動 / 倍率公式 / 傷害技能升級 / 特殊效果
 */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public/data/skills.json");
const API = "https://swarfarm.com/api/v2";
const PAGE_SIZE = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "sw-tick-lab/1.0 (skill data builder)" },
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      if (i === tries - 1) throw err;
      await sleep(800 * (i + 1));
    }
  }
}

async function fetchAll(endpoint) {
  const first = await getJSON(`${API}/${endpoint}/?page=1&page_size=${PAGE_SIZE}`);
  const pages = Math.ceil(first.count / PAGE_SIZE);
  const results = [...first.results];
  console.log(`${endpoint}: ${first.count} 筆 / ${pages} 頁`);
  for (let page = 2; page <= pages; page++) {
    const data = await getJSON(`${API}/${endpoint}/?page=${page}&page_size=${PAGE_SIZE}`);
    results.push(...data.results);
    if (page % 5 === 0 || page === pages) console.log(`  ${endpoint} ${page}/${pages}`);
    await sleep(120);
  }
  return results;
}

const monsters = await fetchAll("monsters");
const skills = await fetchAll("skills");

const monsterSkills = {};
for (const m of monsters) {
  if (!m || !m.com2us_id) continue;
  const ids = (m.skills ?? []).filter((id) => Number.isFinite(Number(id)));
  if (ids.length) monsterSkills[String(m.com2us_id)] = ids;
}

const out = {
  source: "SWARFARM API v2",
  fetchedAt: new Date().toISOString(),
  monsters: monsterSkills,
  skills: {},
};

for (const s of skills) {
  const id = s.id;
  if (!id) continue;
  const dmgUp = (s.upgrades ?? [])
    .filter((u) => typeof u?.effect === "string" && /^Damage \+/.test(u.effect))
    .reduce((sum, u) => sum + (Number(u.amount) || 0), 0);
  const effects = (s.effects ?? []).map((e) => e?.effect?.id).filter((x) => Number.isFinite(x));
  out.skills[String(id)] = {
    id,
    n: s.name ?? "",
    slot: s.slot ?? 0,
    hits: s.hits ?? 1,
    aoe: !!s.aoe,
    passive: !!s.passive,
    cool: s.cooltime ?? 0,
    max: s.max_level ?? 1,
    f: s.multiplier_formula ?? "",
    raw: s.multiplier_formula_raw ?? "[]",
    sc: s.scales_with ?? [],
    up: dmgUp,
    e: [...new Set(effects)],
    d: (s.description ?? "").slice(0, 240),
  };
}

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(out), "utf8");
const stat = await fs.stat(OUT);
console.log(`寫入 ${path.relative(ROOT, OUT)}：${Object.keys(out.skills).length} 技能 / ${Object.keys(out.monsters).length} 魔靈 / ${(stat.size / 1024).toFixed(0)} KB`);
