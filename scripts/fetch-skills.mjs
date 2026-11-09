/**
 * 從 SWARFARM API 產生技能傷害資料（public/data/skills.json）
 * 用法：
 *   node scripts/fetch-skills.mjs               重新抓取全部資料
 *   node scripts/fetch-skills.mjs --effects     只補齊技能效果名稱對照（不重抓魔靈 / 技能）
 *   node scripts/fetch-skills.mjs --descriptions 只補齊完整技能說明（圖鑑用）
 *
 * 只保留傷害計算與圖鑑篩選需要的欄位，避免檔案過大：
 * - 每隻魔靈（com2us_id）對應的技能 ID
 * - 技能名稱 / 段數 / 範圍 / 被動 / 倍率公式 / 傷害技能升級 / 特殊效果
 * - 技能效果 id → 名稱 / 類型（增益、減益、其他），供魔靈圖鑑以技能篩選
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

/** 把 skill.effects 內的 effect 物件整理成圖鑑用的對照表 */
function addEffect(effectMap, effect) {
  if (!effect?.id) return;
  const id = String(effect.id);
  effectMap[id] ??= {
    id: effect.id,
    name: effect.name ?? `Effect ${effect.id}`,
    type: effect.type ?? "Neutral",
    buff: !!effect.is_buff,
  };
}

/** 只補齊既有 skills.json 缺少的效果名稱（新版效果不一定會出現在 /skill-effects/） */
async function refreshEffectsOnly() {
  const data = JSON.parse(await fs.readFile(OUT, "utf8"));
  const effectMap = { ...(data.effects ?? {}) };

  // 先抓官方效果清單（核心效果）
  const list = await getJSON(`${API}/skill-effects/?page_size=500`);
  for (const e of list.results ?? []) addEffect(effectMap, e);

  const used = new Set();
  const skillIdsByEffect = new Map();
  for (const skill of Object.values(data.skills ?? {})) {
    for (const id of skill.e ?? []) {
      used.add(id);
      if (!skillIdsByEffect.has(id)) skillIdsByEffect.set(id, skill.id);
    }
  }

  const missing = [...used].filter((id) => !effectMap[String(id)]);
  if (missing.length) {
    console.log(`缺少 ${missing.length} 個效果名稱，從技能資料補齊…`);
    // 同一個技能可能包含多個缺少的效果，先依技能分組，避免重複請求
    const bySkill = new Map();
    for (const id of missing) {
      const skillId = skillIdsByEffect.get(id);
      if (!skillId) continue;
      const group = bySkill.get(skillId) ?? [];
      group.push(id);
      bySkill.set(skillId, group);
    }
    let done = 0;
    for (const skillId of bySkill.keys()) {
      try {
        const skill = await getJSON(`${API}/skills/${skillId}/?format=json`);
        for (const entry of skill.effects ?? []) addEffect(effectMap, entry?.effect);
      } catch (err) {
        console.warn(`  技能 ${skillId} 效果讀取失敗：${err.message}`);
      }
      done++;
      if (done % 10 === 0 || done === bySkill.size) console.log(`  ${done}/${bySkill.size}`);
      await sleep(120);
    }
  }

  const stillMissing = [...used].filter((id) => !effectMap[String(id)]);
  data.effects = effectMap;
  await fs.writeFile(OUT, JSON.stringify(data), "utf8");
  console.log(
    `✅ 效果對照：${Object.keys(effectMap).length} 筆（使用中 ${used.size} 筆` +
      (stillMissing.length ? `，仍缺 ${stillMissing.join(", ")}` : "") +
      `）-> ${OUT}`,
  );
}

if (process.argv.includes("--effects")) {
  await refreshEffectsOnly();
  process.exit(0);
}

/** 補齊技能完整說明（舊版只存 240 字，圖鑑會顯示完整內容） */
async function refreshDescriptions() {
  const data = JSON.parse(await fs.readFile(OUT, "utf8"));
  const skills = await fetchAll("skills");
  const effectMap = { ...(data.effects ?? {}) };
  let changed = 0;
  let maxLen = 0;
  for (const s of skills) {
    const target = data.skills[String(s.id)];
    if (!target) continue;
    const full = s.description ?? "";
    maxLen = Math.max(maxLen, full.length);
    if (target.d !== full) {
      target.d = full;
      changed++;
    }
    for (const entry of s.effects ?? []) addEffect(effectMap, entry?.effect);
  }
  data.effects = effectMap;
  data.fetchedAt = new Date().toISOString();
  await fs.writeFile(OUT, JSON.stringify(data), "utf8");
  console.log(`✅ 更新 ${changed} 個技能說明（最長 ${maxLen} 字）-> ${OUT}`);
}

if (process.argv.includes("--descriptions")) {
  await refreshDescriptions();
  process.exit(0);
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
  /** 技能效果 id → 名稱 / 類型（魔靈圖鑑篩選用） */
  effects: {},
};

for (const s of skills) {
  const id = s.id;
  if (!id) continue;
  for (const entry of s.effects ?? []) addEffect(out.effects, entry?.effect);
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
    d: s.description ?? "",
  };
}

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(out), "utf8");
const stat = await fs.stat(OUT);
console.log(`寫入 ${path.relative(ROOT, OUT)}：${Object.keys(out.skills).length} 技能 / ${Object.keys(out.monsters).length} 魔靈 / ${(stat.size / 1024).toFixed(0)} KB`);
