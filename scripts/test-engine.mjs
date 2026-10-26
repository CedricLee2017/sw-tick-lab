/**
 * 配符引擎 / Tick 公式自動測試
 * 用法：npm test
 *
 * 會先用 rolldown 把 src/lib 的純邏輯打包到 .tmp/engine.mjs，再用 Node 執行。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const BUNDLE = path.join(ROOT, ".tmp/engine.mjs");

await fs.mkdir(path.dirname(BUNDLE), { recursive: true });
const build = spawnSync(
  process.execPath,
  [
    path.join(ROOT, "node_modules/rolldown/bin/cli.mjs"),
    "scripts/engine-entry.ts",
    "--platform", "node",
    "--format", "esm",
    "--file", BUNDLE,
    "--logLevel", "warn",
  ],
  { cwd: ROOT, stdio: "inherit" },
);
if (build.status !== 0) throw new Error("rolldown bundle 失敗");

const engine = await import(`${pathToFileURL(BUNDLE).href}?t=${Date.now()}`);
const {
  tickOf, speedForTick, tickInfo, speedNeededForTick, simulateOrder, optimize, maxSpeedBound,
  baseStats, bonusFromBuildings, parseAccountJSON, MONSTERS, runeSpeed,
  emptyAccum, addRuneToAccum, runeValue, computeSkillDamage, skillsForMonster,
} = engine;

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

/* ── 1. Tick 公式 ─────────────────────────────── */
console.log("\n[1] Tick 公式");
check("Tick 5 = 286 速", () => {
  assert.equal(speedForTick(5), 286);
  assert.equal(tickOf(286), 5);
  assert.equal(tickOf(285), 6);
});
check("Tick 6 / 7 門檻", () => {
  assert.equal(speedForTick(6), 239);
  assert.equal(speedForTick(7), 205);
  assert.equal(tickOf(239), 6);
  assert.equal(tickOf(205), 7);
});
check("RTA 模式（0.015%）", () => {
  assert.equal(speedForTick(5, true), 1334);
  assert.equal(tickOf(1334, true), 5);
});
check("tickInfo 顯示下一階還差多少", () => {
  const info = tickInfo(280);
  assert.equal(info.tick, 6);
  assert.equal(info.need, 286);
  assert.equal(info.next, 6);
});

/* ── 2. 速度反推 ─────────────────────────────── */
console.log("\n[2] 速度反推（建築 + 隊長技）");
const bonus43 = {
  towerSpd: 15, towerAtk: 0, towerHp: 0, towerDef: 0,
  guildAtk: 0, guildHp: 0, guildDef: 0, guildCd: 0,
  leadSpd: 28, buffSpd: 0, useGuild: false, useElementTower: false, grind: true,
};
check("基礎 100 + 圖騰 15% + 隊長 28% → 符文需 143 速", () => {
  const need = speedNeededForTick(5, 100, bonus43);
  assert.equal(need.target, 286);
  assert.equal(need.runeSpeed, 143);
});
check("基礎速 114（Perna）→ 符文需 122 速", () => {
  const need = speedNeededForTick(5, 114, bonus43);
  assert.equal(need.target, 286);
  assert.equal(need.runeSpeed, 122);
});
check("加入 Buff 30% 後需求下降", () => {
  const need = speedNeededForTick(5, 100, { ...bonus43, buffSpd: 30 });
  assert.equal(need.runeSpeed, 113);
});

/* ── 3. 示範帳號解析 ─────────────────────────── */
console.log("\n[3] 示範帳號");
const demoPath = path.join(ROOT, "public/demo-account.json");
const demoText = await fs.readFile(demoPath, "utf8");
const parsed = parseAccountJSON(demoText, "demo-account.json");
check("解析成功", () => {
  assert.equal(parsed.error, undefined);
  assert.ok(parsed.account);
  assert.equal(parsed.account.units.length, 44);
  assert.equal(parsed.account.runes.length, 144);
  assert.ok(parsed.account.buildings.length >= 9);
});
const account = parsed.account;
check("自動偵測速度圖騰 15%", () => {
  const b = bonusFromBuildings(account.buildings, { leadSpd: 28 });
  assert.equal(b.towerSpd, 15);
  assert.equal(b.leadSpd, 28);
  assert.equal(b.useGuild, true);
});
check("符文都有 6 個位置", () => {
  const slots = new Set(account.runes.map((r) => r.slot));
  assert.deepEqual([...slots].sort(), [1, 2, 3, 4, 5, 6]);
});
check("容忍多層包裝 / 物件索引 / 字串屬性", () => {
  const wrapped = JSON.stringify({
    save: {
      data: {
        unit_list: {
          1: { unit_id: 11, unit_master_id: 17012, stars: 6, level: 40, runes: { 0: { rune_id: 101 } } },
        },
        runes: {
          101: {
            id: 101, set: "Swift", slot: 1, grade: 6, level: 15,
            main: { type: "SPD", value: 42 },
            prefix: { type: "HP%", value: 8 },
            subs: [{ type: "CRate", value: 10 }, { t: 11, v: 8, g: 2 }],
          },
        },
        buildings: { 7: { building_master_id: 7, building_level: 15 } },
      },
    },
  });
  const p = parseAccountJSON(wrapped, "wrapped.json");
  assert.equal(p.error, undefined, p.error);
  assert.equal(p.account.units.length, 1);
  assert.equal(p.account.units[0].stars, 6);
  assert.deepEqual(p.account.units[0].runes, [101]);
  assert.equal(p.account.runes.length, 1);
  assert.equal(p.account.runes[0].set, 3);
  assert.equal(p.account.runes[0].main.t, 8);
  assert.equal(p.account.runes[0].main.v, 42);
  assert.equal(p.account.runes[0].prefix.t, 2);
  assert.equal(p.account.runes[0].subs[0].t, 9);
  assert.equal(p.account.runes[0].subs[1].g, 2);
  assert.deepEqual(p.account.buildings, [{ id: 7, level: 15 }]);
});

check("SWEX v1.1.0：合併裝備符文、遠古 class/rank、無建築等級", () => {
  const raw = {
    unit_list: [
      {
        unit_id: 501,
        unit_master_id: 17012,
        class: 6,
        unit_level: 40,
        runes: [
          {
            rune_id: 9001, occupied_id: 501, slot_no: 2, set_id: 13, class: 6, rank: 5, upgrade_curr: 15,
            pri_eff: [8, 42], prefix_eff: [0, 0], sec_eff: [[8, 10, 0, 4], [12, 8, 0, 0]],
          },
          {
            rune_id: 9002, occupied_id: 501, slot_no: 6, set_id: 15, class: 16, rank: 15, upgrade_curr: 15,
            pri_eff: [12, 48], prefix_eff: [11, 6], sec_eff: [],
          },
        ],
      },
    ],
    runes: [
      {
        rune_id: 9003, occupied_id: 0, slot_no: 4, set_id: 13, class: 6, rank: 5, upgrade_curr: 15,
        pri_eff: [9, 58], prefix_eff: [0, 0], sec_eff: [[8, 5, 0, 0]],
      },
    ],
    building_list: [{ building_master_id: 7, building_id: 1 }, { building_master_id: 9, building_id: 2 }],
  };
  const p = parseAccountJSON(JSON.stringify(raw), "swex.json");
  assert.equal(p.error, undefined, p.error);
  assert.equal(p.account.runes.length, 3, "裝備中的符文沒有被合併");
  assert.deepEqual(p.account.units[0].runes, [9001, 9002]);
  const r1 = p.account.runes.find((r) => r.id === 9001);
  assert.equal(r1.main.t, 8);
  assert.equal(r1.subs[0].t, 8);
  assert.equal(r1.subs[1].t, 12);
  assert.equal(r1.subs[0].g, 4, "精煉值應讀取 sec_eff 第 4 欄");
  assert.equal(runeSpeed(r1), 56, "速度應包含主屬性 42 與精煉 +4");
  assert.equal(r1.set, 13);
  const r2 = p.account.runes.find((r) => r.id === 9002);
  assert.equal(r2.grade, 6, "遠古符文星級應為 class - 10");
  assert.equal(r2.ancient, true);
  assert.equal(r2.occupied, 501);
  assert.equal(p.account.buildings.length, 0, "沒有等級時不應假造 0 等建築");
  assert.ok(p.warnings.some((w) => w.includes("沒有等級欄位")), "應提示建築沒有等級");
});

check("精煉（磨石）數值完整計入：速度 28 + 5 = 33、防禦 12 + 10 = 22", () => {
  const raw = {
    unit_list: [],
    runes: [
      {
        rune_id: 9100, occupied_id: 0, slot_no: 4, set_id: 3, class: 6, rank: 5, upgrade_curr: 15,
        pri_eff: [2, 63], prefix_eff: [10, 4],
        sec_eff: [[4, 8, 0, 10], [9, 5, 0, 0], [6, 12, 1, 10], [8, 28, 0, 5]],
      },
    ],
    building_list: [],
  };
  const p = parseAccountJSON(JSON.stringify(raw), "grind.json");
  assert.equal(p.error, undefined, p.error);
  const r = p.account.runes[0];
  const spd = r.subs.find((s) => s.t === 8);
  const def = r.subs.find((s) => s.t === 6);
  assert.equal(spd.v, 28);
  assert.equal(spd.g, 5, "速度精煉應為 +5");
  assert.equal(spd.gem, 0);
  assert.equal(def.g, 10, "防禦精煉應為 +10");
  assert.equal(def.gem, 1, "第 3 欄是寶石標記");
  assert.equal(runeSpeed(r), 33, "速度合計應為 33");
  assert.ok(r.eff > 0);
});

check("固定體力/攻擊/防禦主屬性會計入面板與符文價值", () => {
  const mk = (id, t, v) => ({
    rune_id: id, slot_no: 2, set_id: 1, class: 6, rank: 5, upgrade_curr: 15,
    pri_eff: [t, v], prefix_eff: [0, 0], sec_eff: [],
  });
  const raw = {
    unit_list: [],
    runes: [mk(9201, 1, 2448), mk(9203, 3, 160), mk(9205, 5, 160)],
    building_list: [],
  };
  const p = parseAccountJSON(JSON.stringify(raw), "flat.json");
  assert.equal(p.error, undefined, p.error);
  const a = emptyAccum();
  for (const r of p.account.runes) addRuneToAccum(a, r, true);
  assert.equal(a.flatHp, 2448, "固定體力主屬性未計入");
  assert.equal(a.flatAtk, 160, "固定攻擊主屬性未計入");
  assert.equal(a.flatDef, 160, "固定防禦主屬性未計入");
  const w = { hp: 1, atk: 1, def: 1, spd: 1, cr: 1, cd: 1, res: 1, acc: 1 };
  for (const r of p.account.runes) {
    assert.ok(runeValue(r, w) > 0, `主屬性 type ${r.main.t} 沒有被計分`);
  }
});

check("主屬性『固定防禦』能找到固定值主屬性符文，並計入 DEF", () => {
  const mk = (id, slot, set, mainT, mainV, spd) => ({
    rune_id: id, slot_no: slot, set_id: set, class: 6, rank: 5, upgrade_curr: 15,
    pri_eff: [mainT, mainV], prefix_eff: [0, 0],
    sec_eff: spd ? [[8, spd, 0, 0]] : [],
  });
  const raw = {
    unit_list: [],
    runes: [
      mk(9301, 1, 4, 3, 160, 10),
      mk(9302, 2, 15, 8, 42, 10),
      mk(9303, 3, 1, 5, 160, 10),
      mk(9304, 4, 6, 2, 63, 10),
      mk(9305, 5, 7, 1, 2448, 10),
      mk(9306, 6, 17, 5, 160, 34),
      mk(9307, 6, 18, 6, 63, 20),
    ],
    building_list: [],
  };
  const p = parseAccountJSON(JSON.stringify(raw), "flat-opt.json");
  assert.equal(p.error, undefined, p.error);
  const bonus = {
    towerSpd: 0, towerAtk: 0, towerHp: 0, towerDef: 0,
    guildAtk: 0, guildHp: 0, guildDef: 0, guildCd: 0,
    leadSpd: 0, buffSpd: 0, useGuild: false, useElementTower: false, grind: true,
  };
  const res = optimize({
    base: { hp: 10000, atk: 700, def: 700, spd: 100, cr: 15, cd: 50, res: 15, acc: 0 },
    runes: p.account.runes,
    required: [], min: { spd: 200 }, max: {}, objective: "spd",
    bonus, limit: 5, pool: 18, allowEquipped: true, targetUnit: 0, rta: false,
    maxNodes: 100_000, mainFilters: { 6: 5 },
  });
  assert.ok(res.builds.length > 0, "固定防禦主屬性應能找到組合");
  assert.ok(res.builds.every((b) => b.runes[5]?.main.t === 5), "6 號位應全部是固定防禦");
  assert.equal(res.builds[0].stats.spd, 226);
  assert.equal(res.builds[0].stats.def, 1020, "固定防禦 +160 與 +160 應計入 DEF");
  assert.ok(res.builds.some((b) => b.runes[5]?.id === 9306), "應用到固定防禦 +160 / 34 速的符文");
});

/* ── 4. 一鍵配符 ─────────────────────────────── */
console.log("\n[4] 一鍵配符（迅速 ×4 + 意志 ×2，目標 Tick 5）");
const velajuel = MONSTERS.find((m) => m.id === 17012);
assert.ok(velajuel, "找不到 Velajuel");
const base = baseStats(velajuel, 6, 40);
const bonus = bonusFromBuildings(account.buildings, { leadSpd: 28 });
const req = {
  base,
  runes: account.runes,
  required: [{ set: 3, count: 4 }, { set: 15, count: 2 }],
  min: { spd: 286 },
  max: {},
  objective: "spd",
  bonus,
  limit: 5,
  pool: 18,
  allowEquipped: true,
  targetUnit: 0,
  rta: false,
  maxNodes: 3_500_000,
};

const t0 = performance.now();
const result = optimize(req);
const elapsed = Math.round(performance.now() - t0);

check("找到至少一組配裝", () => {
  assert.ok(result.builds.length > 0, "沒有任何結果");
});
for (const [i, b] of result.builds.entries()) {
  check(`第 ${i + 1} 組：速度 ${b.stats.spd} / Tick ${b.stats.tick}、套裝符合`, () => {
    assert.ok(b.stats.spd >= 286, `速度只有 ${b.stats.spd}`);
    assert.ok(b.stats.tick <= 5, `Tick 為 ${b.stats.tick}`);
    assert.equal(b.runes.filter(Boolean).length, 6);
    assert.ok((b.sets[3] ?? 0) >= 4, "迅速不足 4 件");
    assert.ok((b.sets[15] ?? 0) >= 2, "意志不足 2 件");
    const slots = b.runes.filter(Boolean).map((r) => r.slot).sort();
    assert.deepEqual(slots, [1, 2, 3, 4, 5, 6], "位置重複或缺漏");
  });
}
console.log(`  · 候選符文 ${result.candidates} 顆 · 節點 ${result.nodes.toLocaleString()} · ${elapsed} ms${result.truncated ? "（已達節點上限）" : ""}`);
console.log("  · 前三名：");
for (const [i, b] of result.builds.slice(0, 3).entries()) {
  console.log(`      ${i + 1}. ${b.stats.spd} 速 / Tick ${b.stats.tick} / HP ${b.stats.hp} / EHP ${b.stats.ehp} / 效率 ${b.eff.toFixed(1)}%`);
}

check("速度上界不低於實際最佳解", () => {
  const bound = maxSpeedBound(req);
  assert.ok(bound.speed >= result.builds[0].stats.spd, `上界 ${bound.speed} < 實際 ${result.builds[0].stats.spd}`);
  assert.ok(bound.speed < speedForTick(3), `上界 ${bound.speed} 不合理（超過 Tick 3）`);
});
check("允許破套：只強制主套 4 件", () => {
  const relaxed = optimize({
    ...req,
    required: [{ set: 13, count: 4 }, { set: 15, count: 2 }],
    relaxSub: true,
    min: { spd: 286 },
    objective: "spd",
    limit: 5,
  });
  assert.ok(relaxed.builds.length > 0, "破套模式沒有任何結果");
  for (const b of relaxed.builds) {
    assert.ok((b.sets[13] ?? 0) >= 4, "暴走不足 4 件");
    assert.ok(b.stats.spd >= 286);
  }
});
check("3×2 件套（能量 + 刀刃 + 意志）", () => {
  const tri = optimize({
    ...req,
    required: [{ set: 1, count: 2 }, { set: 4, count: 2 }, { set: 15, count: 2 }],
    min: {},
    objective: "score",
    limit: 5,
  });
  assert.ok(tri.builds.length > 0, "3×2 件套沒有任何結果");
  for (const b of tri.builds) {
    assert.ok((b.sets[1] ?? 0) >= 2, "能量不足 2 件");
    assert.ok((b.sets[4] ?? 0) >= 2, "刀刃不足 2 件");
    assert.ok((b.sets[15] ?? 0) >= 2, "意志不足 2 件");
    assert.equal(Object.values(b.sets).reduce((s, c) => s + c, 0), 6);
  }
});

check("無形符文補足缺少的套裝", () => {
  const mk = (id, slot, set, mainT, mainV, spd) => ({
    rune_id: id, slot_no: slot, set_id: set, class: 6, rank: 5, upgrade_curr: 15,
    pri_eff: [mainT, mainV], prefix_eff: [0, 0],
    sec_eff: spd ? [[8, spd, 0, 0]] : [],
  });
  const raw = {
    unit_list: [],
    runes: [
      mk(9401, 1, 5, 3, 160, 10),
      mk(9402, 2, 5, 8, 42, 10),
      mk(9403, 3, 5, 5, 160, 10),
      mk(9404, 4, 4, 2, 63, 10),
      mk(9405, 5, 4, 1, 2448, 10),
      mk(9406, 6, 25, 6, 63, 10),
    ],
    building_list: [],
  };
  const p = parseAccountJSON(JSON.stringify(raw), "intangible.json");
  assert.equal(p.error, undefined, p.error);
  const bonus0 = {
    towerSpd: 0, towerAtk: 0, towerHp: 0, towerDef: 0,
    guildAtk: 0, guildHp: 0, guildDef: 0, guildCd: 0,
    leadSpd: 0, buffSpd: 0, useGuild: false, useElementTower: false, grind: true,
  };
  const opts = {
    base: { hp: 10000, atk: 700, def: 700, spd: 100, cr: 15, cd: 50, res: 15, acc: 0 },
    runes: p.account.runes,
    required: [{ set: 5, count: 4 }, { set: 4, count: 2 }],
    min: {}, max: {}, objective: "score", bonus: bonus0,
    limit: 5, pool: 18, allowEquipped: true, targetUnit: 0, rta: false, maxNodes: 100_000,
  };
  const withInt = optimize({ ...opts, intangible: true });
  assert.ok(withInt.builds.length > 0, "有無形時應能組成 4+2");
  assert.equal(withInt.builds[0].sets[5], 4, "無形沒有補足憤怒套裝");
  assert.equal(withInt.builds[0].sets[4], 2);
  assert.equal(withInt.builds[0].stats.cd, 90, "憤怒 +40 暴傷未套用");
  assert.equal(withInt.builds[0].stats.cr, 27, "刀刃 +12 暴率未套用");
  const without = optimize({ ...opts, intangible: false });
  assert.equal(without.builds.length, 0, "沒有無形時不應能組成 4+2");
});

check("主屬性篩選（#4 HP%、#6 攻擊%）", () => {
  const filtered = optimize({
    ...req,
    required: [],
    min: { spd: 180 },
    mainFilters: { 4: 2, 6: 4 },
    limit: 3,
  });
  assert.ok(filtered.builds.length > 0, "主屬性篩選後沒有任何結果");
  for (const b of filtered.builds) {
    assert.equal(b.runes[3].main.t, 2, "#4 不是 HP% 主屬性");
    assert.equal(b.runes[5].main.t, 4, "#6 不是攻擊%主屬性");
    assert.ok(b.stats.spd >= 180);
  }
});

/* ── 4b. Focus 焦點屬性 ───────────────────────── */
console.log("\n[4b] Focus 焦點屬性加權");
const { normalizeFocus, focusFitOf, FOCUS_LIMIT } = engine;

check("normalizeFocus：最多 5 組、去重、比重限制 1~10", () => {
  assert.equal(FOCUS_LIMIT, 5);
  const list = normalizeFocus([
    { key: "hp", weight: 99 },
    { key: "hp", weight: 3 },
    { key: "atk", weight: 0 },
    { key: "def", weight: 5 },
    { key: "spd", weight: 6 },
    { key: "cr", weight: 7 },
    { key: "cd", weight: 8 },
    { key: "res", weight: 9 },
  ]);
  assert.equal(list.length, 5, "沒有裁切成 5 組");
  assert.deepEqual(list.map((f) => f.key), ["hp", "atk", "def", "spd", "cr"]);
  assert.equal(list[0].weight, 10, "比重沒有上限 10");
  assert.equal(list[1].weight, 1, "比重沒有下限 1");
});

check("focusFitOf：依比重加權（HP 100%、SPD 50% → 75%）", () => {
  const stats = { hp: 40000, atk: 0, def: 0, spd: 140, cr: 0, cd: 0, res: 0, acc: 0 };
  const fit = focusFitOf(stats, [{ key: "hp", weight: 5 }, { key: "spd", weight: 5 }]);
  assert.equal(Math.round(fit), 75);
  assert.equal(focusFitOf(stats, []), 0);
});

check("焦點權重會把高 HP 符文排到高速度符文前面", () => {
  const w = { hp: 0.15, atk: 0.15, def: 0.15, spd: 0.3, cr: 0.15, cd: 0.1, res: 0.1, acc: 0.15 };
  const mk = (id, subs) => ({
    id, set: 1, slot: 1, grade: 6, level: 15,
    main: { t: 3, v: 160 }, prefix: { t: 0, v: 0 }, subs,
    occupied: 0, ancient: false, locked: false, eff: 60, effMax: 100,
  });
  const speedRune = mk(1, [{ t: 8, v: 25, g: 0, gem: 0 }]);
  const hpRune = mk(2, [{ t: 2, v: 40, g: 0, gem: 0 }]);
  assert.ok(runeValue(speedRune, w) > runeValue(hpRune, w), "未加焦點時應以速度優先");
  const focus = new Map([["hp", 10]]);
  assert.ok(runeValue(hpRune, w, focus) > runeValue(speedRune, w, focus), "焦點 HP 沒有提高 HP 符文排序");
});

const focusedRun = optimize({
  ...req,
  min: { spd: 286 },
  objective: "spd",
  focus: [{ key: "hp", weight: 10 }, { key: "spd", weight: 8 }],
});
check("Focus 套用到配符：仍符合速度條件，且附上焦點契合度", () => {
  assert.ok(focusedRun.builds.length > 0, "加上 Focus 後沒有任何結果");
  for (const b of focusedRun.builds) {
    assert.ok(b.stats.spd >= 286, `速度只有 ${b.stats.spd}`);
    assert.ok(typeof b.focusFit === "number", "缺少 focusFit");
    assert.ok(b.focusFit >= 0 && b.focusFit <= 100, `focusFit 超出範圍：${b.focusFit}`);
  }
  for (let i = 1; i < focusedRun.builds.length; i++) {
    assert.ok(focusedRun.builds[i - 1].score >= focusedRun.builds[i].score, "結果沒有依分數排序");
  }
});
console.log(`  · 無 Focus 第一名：${result.builds[0].stats.spd} 速 / HP ${result.builds[0].stats.hp} / 焦點契合 ${Math.round(focusFitOf(result.builds[0].stats, [{ key: "hp", weight: 10 }, { key: "spd", weight: 8 }]))}%`);
console.log(`  · 有 Focus 第一名：${focusedRun.builds[0].stats.spd} 速 / HP ${focusedRun.builds[0].stats.hp} / 焦點契合 ${Math.round(focusedRun.builds[0].focusFit)}%`);

/* ── 5. 出手順序 ─────────────────────────────── */
console.log("\n[5] 出手順序模擬");
check("286 速比 285 速先出手", () => {
  const order = simulateOrder([
    { id: "fast", name: "286", spd: 286 },
    { id: "slow", name: "285", spd: 285 },
  ], 4);
  assert.equal(order[0].id, "fast");
  assert.equal(order[0].tick, 5);
  assert.equal(order.find((o) => o.id === "slow").tick, 6);
});

/* ── 6. 技能傷害估算 ─────────────────────────── */
console.log("\n[6] 技能傷害估算");
const skillData = JSON.parse(await fs.readFile(path.join(ROOT, "public/data/skills.json"), "utf8"));
check("技能資料涵蓋全部魔靈，且能列出風 Ciri 的技能", () => {
  const missing = MONSTERS.filter((m) => !skillData.monsters[String(m.id)]);
  assert.equal(missing.length, 0, `缺少 ${missing.length} 隻魔靈的技能對應`);
  const ciri = skillsForMonster(skillData, 29313);
  assert.ok(ciri.length >= 3, `風 Ciri 只有 ${ciri.length} 個技能`);
  assert.deepEqual(ciri.slice(0, 3).map((s) => s.slot), [1, 2, 3]);
  assert.equal(ciri[0].n, "Slash");
});
const dmgStats = { hp: 30000, atk: 2000, def: 800, spd: 200, cr: 100, cd: 150, res: 0, acc: 0, ehp: 0, tick: 1 };
const dmgBase = {
  crit: "normal", skillUps: false, enemyDef: 800, enemyMaxHp: 30000, enemyHpPct: 100,
  enemySpd: 100, selfHpPct: 100, atkBuff: 0, leadAtk: 0, defBreak: false, brand: false,
  ignoreDef: false, aliveEnemies: 1, alliesAlive: 4,
};
const mkSkill = (over = {}) => ({
  id: 1, n: "Test", slot: 1, hits: 2, aoe: false, passive: false, cool: 0, max: 5,
  f: "3.6*{ATK}", raw: "", sc: ["ATK"], up: 25, e: [], d: "", ...over,
});
const mit800 = 1000 / (1140 + 3.5 * 800);

check("倍率公式 + 防禦減傷 + 段數", () => {
  const r = computeSkillDamage(dmgStats, mkSkill(), dmgBase);
  assert.equal(r.perHit, Math.round(2000 * 3.6 * mit800));
  assert.equal(r.total, Math.round(2000 * 3.6 * mit800) * 2);
  assert.ok(Math.abs(r.mitigation - mit800) < 1e-9);
});

check("暴擊 / 平均 / 技能升級 / ATK Buff", () => {
  const crit = computeSkillDamage(dmgStats, mkSkill(), { ...dmgBase, crit: "crit" });
  assert.equal(crit.perHit, Math.round(2000 * 3.6 * 2.5 * mit800));
  const avg = computeSkillDamage(dmgStats, mkSkill(), { ...dmgBase, crit: "average" });
  assert.equal(avg.perHit, Math.round(2000 * 3.6 * 2.5 * mit800), "CR 100% 時平均應等於必暴");
  const up = computeSkillDamage(dmgStats, mkSkill(), { ...dmgBase, skillUps: true });
  assert.equal(up.perHit, Math.round(2000 * 3.6 * 1.25 * mit800));
  const buff = computeSkillDamage(dmgStats, mkSkill(), { ...dmgBase, atkBuff: 50, leadAtk: 25 });
  assert.equal(buff.perHit, Math.round(2000 * 1.75 * 3.6 * mit800));
});

check("無視防禦 / 破防 / 烙印", () => {
  const ig = computeSkillDamage(dmgStats, mkSkill(), { ...dmgBase, ignoreDef: true });
  assert.equal(ig.mitigation, 1000 / 1140);
  assert.equal(ig.perHit, Math.round(2000 * 3.6 * (1000 / 1140)));
  const br = computeSkillDamage(dmgStats, mkSkill(), { ...dmgBase, defBreak: true });
  const mitBreak = 1000 / (1140 + 3.5 * 800 * 0.3);
  assert.equal(br.perHit, Math.round(2000 * 3.6 * mitBreak));
  const brand = computeSkillDamage(dmgStats, mkSkill(), { ...dmgBase, brand: true });
  assert.equal(brand.perHit, Math.round(2000 * 3.6 * 1.25 * mit800));
});

check("速度 / 目標體力% 公式", () => {
  const spdSkill = mkSkill({ f: "{ATK}*({SPD} + 155)/135", hits: 2 });
  const s = computeSkillDamage(dmgStats, spdSkill, dmgBase);
  assert.equal(s.perHit, Math.round((2000 * (200 + 155)) / 135 * mit800));
  assert.equal(s.total, Math.round((2000 * (200 + 155)) / 135 * mit800) * 2);
  const hpSkill = mkSkill({ f: "{ATK}*(4.1 - 1.6*{Target Current HP %})", hits: 1 });
  const h = computeSkillDamage(dmgStats, hpSkill, { ...dmgBase, enemyHpPct: 50 });
  assert.equal(h.perHit, Math.round(2000 * (4.1 - 1.6 * 0.5) * mit800));
});

check("炸彈：不暴擊、無視防禦", () => {
  const bomb = computeSkillDamage(dmgStats, mkSkill({ f: "4.0*{ATK}", hits: 1, e: [23] }), { ...dmgBase, crit: "crit" });
  assert.equal(bomb.mitigation, 1000 / 1140);
  assert.equal(bomb.perHit, Math.round(8000 * (1000 / 1140)));
  assert.equal(bomb.total, Math.round(8000 * (1000 / 1140)));
  assert.equal(bomb.bomb, true);
});

console.log(`\n✅ 全部 ${passed} 項測試通過（配符耗時 ${elapsed} ms）\n`);
