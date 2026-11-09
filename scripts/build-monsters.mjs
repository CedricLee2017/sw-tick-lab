/**
 * 從 SWARFARM 公開 API 產生魔靈基礎資料（含原 5/6★ 滿等數值）
 * 產生：src/data/monsters.json
 *
 * 用法：
 *   node scripts/build-monsters.mjs           重新產生全部魔靈資料
 *   node scripts/build-monsters.mjs --leaders 只補隊長技資料（不動其他欄位）
 */
import fs from "node:fs/promises";
import path from "node:path";

const API = "https://swarfarm.com/api/v2/monsters/";
const OUT = path.resolve(import.meta.dirname, "../src/data/monsters.json");

const ELEMENTS = { Water: 1, Fire: 2, Wind: 3, Light: 4, Dark: 5 };

/** SWARFARM 的 leader_skill 是 { id, attribute, amount, area, element } 物件 */
function normalizeLead(raw) {
  const lead = raw?.skill ?? raw;
  if (!lead || !lead.attribute) return null;
  const element = typeof lead.element === "string" ? ELEMENTS[lead.element] ?? null : lead.element ?? null;
  return {
    id: lead.id ?? 0,
    attr: lead.attribute,
    amount: Number(lead.amount) || 0,
    area: lead.area ?? "General",
    element,
  };
}

async function fetchAll() {
  let url = `${API}?page=1`;
  const all = [];
  let page = 0;
  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
    const json = await res.json();
    all.push(...json.results);
    url = json.next;
    page++;
    process.stdout.write(`\r  fetched page ${page}, total ${all.length}   `);
  }
  process.stdout.write("\n");
  return all;
}

/** 只更新既有 monsters.json 的隊長技，避免重新產生時改動其他數值 */
async function patchLeaders() {
  const monsters = await fetchAll();
  const byId = new Map(monsters.map((m) => [m.com2us_id, m]));
  const data = JSON.parse(await fs.readFile(OUT, "utf8"));
  let changed = 0;
  let withLead = 0;
  for (const row of data) {
    const monster = byId.get(row.id);
    if (!monster) continue;
    const lead = normalizeLead(monster.leader_skill);
    if (lead) withLead++;
    if (JSON.stringify(row.lead ?? null) !== JSON.stringify(lead)) {
      row.lead = lead;
      changed++;
    }
  }
  await fs.writeFile(OUT, JSON.stringify(data));
  console.log(`✅ 更新 ${changed} 隻隊長技，其中 ${withLead} 隻擁有隊長技 -> ${OUT}`);
}

if (process.argv.includes("--leaders")) {
  await patchLeaders();
  process.exit(0);
}

const monsters = await fetchAll();

const cleaned = monsters
  .filter((m) => m.obtainable || m.homunculus)
  .map((m) => {
    return {
      id: m.com2us_id,
      name: m.name,
      family: m.family_id,
      el: ELEMENTS[m.element] ?? 0,
      nat: m.natural_stars,
      stars: m.base_stars,
      awk: m.awaken_level,
      awake: m.can_awaken ? 1 : 0,
      to: m.awakens_to?.com2us_id ?? 0,
      icon: m.image_filename,
      // 6★ / 40 等滿等數值（遊戲內顯示值）
      hp: m.max_lvl_hp,
      atk: m.max_lvl_attack,
      def: m.max_lvl_defense,
      spd: m.speed,
      cr: m.crit_rate,
      cd: m.crit_damage,
      res: m.resistance,
      acc: m.accuracy,
      // 還原公式用
      rawHp: m.raw_hp,
      rawAtk: m.raw_attack,
      rawDef: m.raw_defense,
      arch: m.archetype,
      lead: normalizeLead(m.leader_skill),
      // 二覺
      a2: String(m.com2us_id).slice(-2, -1) === "3" ? 1 : 0,
    };
  });

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(cleaned));

const byId = new Map(cleaned.map((m) => [m.id, m]));
const five = cleaned.filter((m) => m.nat === 5 && m.awk);
console.log(`✅ ${cleaned.length} monsters -> ${OUT}`);
console.log("sample:", JSON.stringify(five.find((m) => m.name.includes("Valkyrie")) ?? five[0], null, 2));
console.log(
  "leader areas:",
  [...new Set(cleaned.map((m) => m.lead?.area).filter(Boolean))].join(", "),
);
