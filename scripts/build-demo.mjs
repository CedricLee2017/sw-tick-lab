/**
 * 產生示範帳號：public/demo-account.json
 * 格式與 SWEX / SWOP 匯出的 JSON 相容，可直接用「載入示範帳號」匯入。
 *
 * 用法：node scripts/build-demo.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MONSTERS = JSON.parse(await fs.readFile(path.join(ROOT, "src/data/monsters.json"), "utf8"));
const OUT = path.join(ROOT, "public/demo-account.json");

/* ── 決定性亂數 ───────────────────────────────── */
let seed = 20261025;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const int = (min, max) => Math.floor(min + rand() * (max - min + 1));

/* ── 魔靈名單（全部為已覺醒的英文名） ─────────── */
const NAMES = [
  "Velajuel", "Perna", "Zaiross", "Veromos", "Tiana", "Ganymede", "Hathor", "Psamathe",
  "Vanessa", "Ethna", "Poseidon", "Okeanos", "Seara", "Rakan", "Laika", "Kumar",
  "Ritesh", "Xing Zhe", "Feng Yan", "Tesarion", "Theomars", "Akhamamir", "Sigmarus", "Verad",
  "Anavel", "Rica", "Charlotte", "Taor", "Chandra", "Shan", "Cadiz", "Craka",
  "Lydia", "Trinity", "Lucifer", "Beelzebub", "Mephisto", "Bastet",
  "Lushen", "Hwa", "Chloe", "Orion", "Verdehile", "Khmun",
];

const units = [];
for (const name of NAMES) {
  const m = MONSTERS.find((x) => x.name === name);
  if (!m) throw new Error(`找不到魔靈：${name}`);
  units.push({ m, unitId: 900000 + units.length });
}

/* ── 符文 ─────────────────────────────────────── */
const SLOT_MAIN = {
  1: { t: 3, v: 160 }, // 攻擊力 +160
  2: { t: 8, v: 42 }, // 速度 +42
  3: { t: 5, v: 160 }, // 防禦力 +160
  5: { t: 1, v: 2448 }, // 體力 +2448
};
const SLOT4_MAINS = [
  { t: 2, v: 63 }, { t: 4, v: 63 }, { t: 6, v: 63 }, { t: 2, v: 63 },
];
const SLOT6_MAINS = [
  { t: 2, v: 63 }, { t: 4, v: 63 }, { t: 6, v: 63 }, { t: 12, v: 64 }, { t: 11, v: 64 },
];

/** 每個位置 24 顆：確保迅速 / 暴走 / 意志都有足夠候選（set_id 依 sw-exporter） */
const SET_PLAN = [
  3, 3, 3, 3, 3, 3,
  13, 13, 13, 13, 13, 13,
  15, 15, 15, 15, 15,
  1, 1, 1,
  4, 4,
  5,
  6,
];

const SUB_TYPES = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
const SUB_RANGE = {
  1: [400, 1500], 2: [8, 34], 3: [25, 80], 4: [8, 34], 5: [25, 80], 6: [8, 34],
  8: [12, 24], 9: [7, 25], 10: [10, 30], 11: [8, 32], 12: [8, 32],
};
const GRIND_RANGE = {
  1: [80, 250], 2: [2, 5], 3: [6, 18], 4: [2, 5], 5: [6, 18], 6: [2, 5],
  8: [2, 5], 9: [2, 4], 10: [2, 5], 11: [2, 5], 12: [2, 5],
};

function makeSubs(mainType, forceSpeed) {
  const pool = SUB_TYPES.filter((t) => t !== mainType);
  const chosen = [];
  if (forceSpeed && mainType !== 8) {
    chosen.push(8);
    pool.splice(pool.indexOf(8), 1);
  }
  while (chosen.length < 4 && pool.length) {
    chosen.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  return chosen.map((t) => {
    const [lo, hi] = SUB_RANGE[t];
    const [glo, ghi] = GRIND_RANGE[t];
    return [t, int(lo, hi), int(glo, ghi), 0];
  });
}

const runes = [];
const slotRunes = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
let runeId = 100000;

for (let slot = 1; slot <= 6; slot++) {
  for (let i = 0; i < SET_PLAN.length; i++) {
    const set = SET_PLAN[i];
    let main;
    if (slot === 1 || slot === 2 || slot === 3 || slot === 5) main = SLOT_MAIN[slot];
    else if (slot === 4) main = SLOT4_MAINS[i % SLOT4_MAINS.length];
    else main = SLOT6_MAINS[i % SLOT6_MAINS.length];

    const forceSpeed = main.t !== 8 && (set === 3 || set === 13 || rand() < 0.45);
    const subs = makeSubs(main.t, forceSpeed);

    let prefix = [0, 0];
    if (rand() < 0.3) {
      const t = pick(SUB_TYPES.filter((x) => x !== main.t && !subs.some((s) => s[0] === x)));
      if (t) {
        const [lo, hi] = SUB_RANGE[t];
        prefix = [t, Math.max(1, Math.round(int(lo, hi) * 0.35))];
      }
    }

    const rune = {
      rune_id: ++runeId,
      slot_no: slot,
      set_id: set,
      class: 6,
      upgrade_curr: 15,
      pri_eff: [main.t, main.v],
      prefix_eff: prefix,
      sec_eff: subs,
      occupied_id: 0,
      ancient: 0,
      locked: 0,
    };
    runes.push(rune);
    slotRunes[slot].push(rune);
  }
}

/* ── 把符文裝到前 18 隻魔靈身上（每隻每個位置各一顆） ── */
for (let u = 0; u < 18; u++) {
  const unit = units[u];
  for (let slot = 1; slot <= 6; slot++) {
    // 每隻魔靈錯開取符文，讓身上的套裝有變化（3 迅速 + 2 暴走 + 1 能量之類）
    const r = slotRunes[slot][(u + slot * 4) % slotRunes[slot].length];
    r.occupied_id = unit.unitId;
    r.locked = 1;
  }
}

const unit_list = units.map(({ m, unitId }) => ({
  unit_id: unitId,
  unit_master_id: m.id,
  class: 6,
  unit_level: 40,
  stars: 6,
  rune_ids: runes.filter((r) => r.occupied_id === unitId).map((r) => r.rune_id),
  artifacts: [],
  locked: 0,
}));

const building_list = [
  { building_master_id: 7, building_level: 20 }, // 速度圖騰 15%
  { building_master_id: 8, building_level: 20 }, // 暴傷圖騰 25%
  { building_master_id: 9, building_level: 20 }, // 攻擊圖騰 20%
  { building_master_id: 10, building_level: 20 }, // 防禦圖騰 20%
  { building_master_id: 11, building_level: 20 }, // 體力圖騰 20%
  { building_master_id: 17, building_level: 20 }, // 公會攻擊 20%
  { building_master_id: 18, building_level: 20 }, // 公會暴傷 25%
  { building_master_id: 19, building_level: 20 }, // 公會體力 20%
  { building_master_id: 20, building_level: 20 }, // 公會防禦 20%
  ...([12, 13, 14, 15, 16].map((id) => ({ building_master_id: id, building_level: 20 }))),
];

const demo = {
  format: "sw-tick-lab-demo",
  version: 1,
  generatedAt: new Date().toISOString(),
  wizard_info: { wizard_name: "SWTickLab Demo", wizard_id: 20261025 },
  unit_list,
  runes,
  building_list,
};

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(demo));

const equipped = runes.filter((r) => r.occupied_id > 0).length;
console.log(`✅ demo: ${units.length} 魔靈 / ${runes.length} 符文（已裝備 ${equipped}）`);
console.log(`   ${OUT}`);
console.log(`   檔案大小 ${(JSON.stringify(demo).length / 1024).toFixed(0)} KB`);
