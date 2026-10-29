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
  defaultBonus, finalizeStats, statsForRunes, buildsOf, ehpWithSkills,
  artifactFlat, artifactMainText, artifactSubText, artifactDamageBonus, artifactKindText, artifactTypeText,
  artifactAdditionalDamage, artifactEligible, runStage2, artifactFocusFit, artifactAutoLabels, artifactSpeedBuffPct,
  rtaStats, rtaView,
  calculateAd, artifactAdEffects, artifactAdResult, addAdEffects,
  deckContext, spdLeaderSkill, spdLeaderApplies,
  tickFor, minSpeedForTick, tickBrackets, calcUnitSpeeds, simulateTickOrder, simulateAdvanced, swiftSetBonus,
  computeFollowPlan, followSpeedRequirement, followSpeedCeiling, panelSpeed, panelExtraFor, speedBuffPct, tickWithBoost,
  optimizeTeam, runeSupply, teamSetsOf, scoreTeam, TEAM_ROLE_LABELS,
  TEAM_TEMPLATES, templateMembers, teamTemplateOf, roleObjective, objectiveOf,
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

/* ── 2b. 建築預設全滿等 ───────────────────────── */
console.log("\n[2b] 建築預設全滿等");
check("一般建築 + 屬性塔 + 公會旗幟皆為滿等", () => {
  const b = defaultBonus();
  assert.equal(b.towerSpd, 15, "速度圖騰");
  assert.equal(b.towerAtk, 20, "攻擊圖騰");
  assert.equal(b.towerHp, 20, "體力圖騰");
  assert.equal(b.towerDef, 20, "防禦圖騰");
  assert.equal(b.towerCd, 25, "暴擊傷害圖騰");
  assert.equal(b.elementAtk, 21, "屬性攻擊塔");
  assert.equal(b.guildAtk, 20, "公會攻擊");
  assert.equal(b.guildHp, 20, "公會體力");
  assert.equal(b.guildDef, 20, "公會防禦");
  assert.equal(b.guildCd, 25, "公會暴傷");
  assert.equal(b.useGuild, false, "公會技能預設不計入");
  assert.equal(b.useElementTower, true);
});
check("召喚師技能不計入面板，但計入實戰數值", () => {
  const base = { hp: 10000, atk: 1000, def: 1000, spd: 100, cr: 15, cd: 50, res: 15, acc: 0 };
  const bonus = defaultBonus({ leadSpd: 0, buffSpd: 0 });
  const acc = emptyAccum();
  const panel = finalizeStats(base, acc, bonus);
  const battle = finalizeStats(base, acc, bonus, false, true);
  // 面板＝遊戲內魔靈面板：只有符文 / 套裝，不含技能與圖騰
  assert.equal(panel.atk, 1000, "面板不應含攻擊圖騰 / 屬性塔");
  assert.equal(panel.hp, 10000);
  assert.equal(panel.def, 1000);
  assert.equal(panel.cd, 50, "面板不應含暴傷 +25");
  // 速度是 Tick 基礎，兩種版本都要有速度圖騰
  assert.equal(panel.spd, 100 + Math.ceil(100 * 0.15));
  assert.equal(battle.spd, panel.spd);
  // 實戰：競技場 20% + 屬性塔 21%
  assert.equal(battle.atk, 1000 + Math.ceil(1000 * 0.41));
  assert.equal(battle.cd, 50 + 25);
  // EHP 也要含一般技能
  const plainEhp = Math.floor((10000 * (1140 + 3.5 * 1000)) / 1000);
  assert.ok(battle.ehp > plainEhp, "實戰 EHP 應高於純面板");
  assert.equal(ehpWithSkills(base, acc, bonus), battle.ehp);
});
check("公會技能可獨立開關：只影響實戰版本", () => {
  const base = { hp: 10000, atk: 1000, def: 1000, spd: 100, cr: 15, cd: 50, res: 15, acc: 0 };
  const bonus = defaultBonus({ leadSpd: 0, buffSpd: 0 });
  const acc = emptyAccum();
  const on = finalizeStats(base, acc, { ...bonus, useGuild: true }, false, true);
  const off = finalizeStats(base, acc, { ...bonus, useGuild: false }, false, true);
  // 攻擊：競技場 20% + 屬性塔 21% + 公會 20%
  assert.equal(on.atk, 1000 + Math.ceil(1000 * 0.61));
  assert.equal(off.atk, 1000 + Math.ceil(1000 * 0.41));
  assert.equal(on.cd, 50 + 25 + 25);
  assert.equal(off.cd, 50 + 25);
  // 不管公會開關，面板永遠不含技能
  assert.equal(finalizeStats(base, acc, { ...bonus, useGuild: true }).atk, 1000);
  // 不計屬性塔時：競技場 20% + 公會 20%
  const noElem = finalizeStats(base, acc, { ...bonus, useGuild: true, useElementTower: false }, false, true);
  assert.equal(noElem.atk, 1000 + Math.ceil(1000 * 0.4));
  assert.ok(ehpWithSkills(base, acc, bonus, true) > ehpWithSkills(base, acc, bonus, false));
});
check("statsForRunes 與 finalizeStats 結果一致（公會開關）", () => {
  const base = { hp: 10000, atk: 1000, def: 1000, spd: 100, cr: 15, cd: 50, res: 15, acc: 0 };
  const bonus = defaultBonus({ leadSpd: 0, buffSpd: 0 });
  const acc = emptyAccum();
  const direct = finalizeStats(base, acc, bonus, false, true);
  const viaRunes = statsForRunes(base, [], bonus, false, true);
  assert.deepEqual(viaRunes, direct);
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
check("取得時間軸", () => {
  assert.equal(parsed.account?.summons?.length ?? 0, 44);
  const times = (parsed.account?.summons ?? []).map((s) => s.createdAt);
  assert.deepEqual(times, [...times].sort().reverse());
  assert.ok(times.every((t) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t)));
});
check("背包 / 保管箱魔靈也會列入取得記錄", () => {
  const p = parseAccountJSON(JSON.stringify({
    unit_list: [
      { unit_id: 1, unit_master_id: 17012, class: 6, unit_level: 40, create_time: "2026-01-02 03:04:05" },
    ],
    unit_storage_normal_list: [
      { unit_id: 2, unit_master_id: 17013, class: 5, unit_level: 1, create_time: "2026-01-01 00:00:00" },
    ],
    runes: [
      { rune_id: 9, set_id: 3, slot_no: 1, class: 6, upgrade_curr: 15, pri_eff: [8, 42], sec_eff: [], occupied_id: 0 },
    ],
  }), "storage.json");
  assert.equal(p.error, undefined);
  assert.equal(p.account?.summons?.length, 2);
  assert.equal(p.account?.summons?.[0]?.unitId, 1);
  assert.equal(p.account?.summons?.[1]?.unitId, 2);
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
    required: [], min: { spd: 200 }, max: {},     bonus, pool: 18, allowEquipped: true, targetUnit: 0, rta: false,
    maxNodes: 100_000, mainFilters: { 6: 5 },
  });
  const builds = buildsOf(res, p.account.runes);
  assert.ok(builds.length > 0, "固定防禦主屬性應能找到組合");
  assert.ok(builds.every((b) => b.runes[5]?.main.t === 5), "6 號位應全部是固定防禦");
  const fastest = builds.reduce((a, b) => (b.stats.spd > a.stats.spd ? b : a));
  assert.equal(fastest.stats.spd, 226, "最高速應為 226");
  assert.equal(fastest.stats.def, 1020, "固定防禦 +160 與 +160 應計入 DEF");
  assert.ok(builds.some((b) => b.runes[5]?.id === 9306), "應用到固定防禦 +160 / 34 速的符文");
});

check("rune_id 超過 32 位元（SWEX 64-bit）時仍能還原符文", () => {
  // 真實 SWEX 的 rune_id 是 64 位元等級的大數字（例如 1970289973248001），
  // 若把 id 直接塞進 Int32Array 會溢位成負數，導致畫面上每顆符文都變「未裝備」。
  const OFF = 1_970_289_973_148_000;
  const mk = (id, slot, set, mainT, mainV, spd) => ({
    rune_id: id + OFF, slot_no: slot, set_id: set, class: 6, rank: 5, upgrade_curr: 15,
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
    ],
    building_list: [],
  };
  const p = parseAccountJSON(JSON.stringify(raw), "big-id.json");
  assert.equal(p.error, undefined, p.error);
  const res = optimize({
    base: { hp: 10000, atk: 700, def: 700, spd: 100, cr: 15, cd: 50, res: 15, acc: 0 },
    runes: p.account.runes,
    required: [], min: {}, max: {}, pool: 18, allowEquipped: true, targetUnit: 0, rta: false,
    maxNodes: 100_000,
    bonus: {
      towerSpd: 0, towerAtk: 0, towerHp: 0, towerDef: 0,
      guildAtk: 0, guildHp: 0, guildDef: 0, guildCd: 0,
      leadSpd: 0, buffSpd: 0, useGuild: false, useElementTower: false, grind: true,
    },
  });
  assert.ok(res.count > 0, "大 rune_id 帳號應能找到組合");
  const b = buildsOf(res, p.account.runes, false, 1)[0];
  assert.equal(b.runes.filter(Boolean).length, 6, "6 顆符文應全部還原");
  assert.ok(b.runes.every((r) => r && r.id > OFF), "還原後的符文 id 不對");
  assert.equal(Object.values(b.sets).reduce((x, y) => x + y, 0), 6, "套裝件數應合計 6");
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
    bonus,
  pool: 18,
  allowEquipped: true,
  targetUnit: 0,
  rta: false,
  maxNodes: 3_500_000,
};

const t0 = performance.now();
const result = optimize(req);
const elapsed = Math.round(performance.now() - t0);
const resultBuilds = buildsOf(result, account.runes, false, 20);

check("找到至少一組配裝", () => {
  assert.ok(result.count > 0, "沒有任何結果");
});
for (const [i, b] of resultBuilds.entries()) {
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
console.log(`  · 共 ${result.count.toLocaleString()} 組 · 候選符文 ${result.candidates} 顆 · 節點 ${result.nodes.toLocaleString()} · ${elapsed} ms${result.truncated ? "（已達節點上限）" : ""}`);
console.log("  · 前三名：");
for (const [i, b] of resultBuilds.slice(0, 3).entries()) {
  console.log(`      ${i + 1}. ${b.stats.spd} 速 / Tick ${b.stats.tick} / HP ${b.stats.hp} / EHP ${b.stats.ehp} / 效率 ${b.eff.toFixed(1)}%`);
}

check("速度上界不低於實際最佳解", () => {
  const bound = maxSpeedBound(req);
  assert.ok(bound.speed >= resultBuilds[0].stats.spd, `上界 ${bound.speed} < 實際 ${resultBuilds[0].stats.spd}`);
  assert.ok(bound.speed < speedForTick(3), `上界 ${bound.speed} 不合理（超過 Tick 3）`);
});
check("允許破套：只強制主套 4 件", () => {
  const relaxed = optimize({
    ...req,
    required: [{ set: 13, count: 4 }, { set: 15, count: 2 }],
    relaxSub: true,
    min: { spd: 286 },
  });
  assert.ok(relaxed.count > 0, "破套模式沒有任何結果");
  for (const b of buildsOf(relaxed, account.runes, false, 50)) {
    assert.ok((b.sets[13] ?? 0) >= 4, "暴走不足 4 件");
    assert.ok(b.stats.spd >= 286);
  }
});
check("3×2 件套（能量 + 刀刃 + 意志）", () => {
  const tri = optimize({
    ...req,
    required: [{ set: 1, count: 2 }, { set: 4, count: 2 }, { set: 15, count: 2 }],
    min: {},
  });
  assert.ok(tri.count > 0, "3×2 件套沒有任何結果");
  for (const b of buildsOf(tri, account.runes, false, 50)) {
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
    min: {}, max: {}, bonus: bonus0,
    pool: 18, allowEquipped: true, targetUnit: 0, rta: false, maxNodes: 100_000,
  };
  const withInt = optimize({ ...opts, intangible: true });
  assert.ok(withInt.count > 0, "有無形時應能組成 4+2");
  const withIntBuilds = buildsOf(withInt, p.account.runes, false, 5);
  assert.equal(withIntBuilds[0].sets[5], 4, "無形沒有補足憤怒套裝");
  assert.equal(withIntBuilds[0].sets[4], 2);
  assert.equal(withIntBuilds[0].stats.cd, 90, "憤怒 +40 暴傷未套用");
  assert.equal(withIntBuilds[0].stats.cr, 27, "刀刃 +12 暴率未套用");
  const without = optimize({ ...opts, intangible: false });
  assert.equal(without.count, 0, "沒有無形時不應能組成 4+2");
});

check("主屬性篩選（#4 HP%、#6 攻擊%）", () => {
  const filtered = optimize({
    ...req,
    required: [],
    min: { spd: 180 },
    mainFilters: { 4: 2, 6: 4 },
  });
  assert.ok(filtered.count > 0, "主屬性篩選後沒有任何結果");
  for (const b of buildsOf(filtered, account.runes, false, 50)) {
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
    focus: [{ key: "hp", weight: 10 }, { key: "spd", weight: 8 }],
});
check("Focus 套用到配符：仍符合速度條件，且附上焦點契合度", () => {
  assert.ok(focusedRun.count > 0, "加上 Focus 後沒有任何結果");
  const builds = buildsOf(focusedRun, account.runes, false, 50);
  for (const b of builds) {
    assert.ok(b.stats.spd >= 286, `速度只有 ${b.stats.spd}`);
    assert.ok(typeof b.focusFit === "number", "缺少 focusFit");
    assert.ok(b.focusFit >= 0 && b.focusFit <= 100, `focusFit 超出範圍：${b.focusFit}`);
  }
  for (let i = 1; i < builds.length; i++) {
    assert.ok(builds[i - 1].score >= builds[i].score, "結果沒有依分數排序");
  }
});
console.log(`  · 無 Focus 第一名：${resultBuilds[0].stats.spd} 速 / HP ${resultBuilds[0].stats.hp} / 焦點契合 ${Math.round(focusFitOf(resultBuilds[0].stats, [{ key: "hp", weight: 10 }, { key: "spd", weight: 8 }]))}%`);
console.log(`  · 有 Focus 第一名：${buildsOf(focusedRun, account.runes, false, 1)[0].stats.spd} 速 / HP ${buildsOf(focusedRun, account.runes, false, 1)[0].stats.hp} / 焦點契合 ${Math.round(buildsOf(focusedRun, account.runes, false, 1)[0].focusFit)}%`);

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
  assert.equal(r.perHit, Math.floor(2000 * 3.6 * mit800));
  assert.equal(r.total, Math.floor(2000 * 3.6 * mit800) * 2);
  assert.ok(Math.abs(r.mitigation - mit800) < 1e-9);
});

check("暴擊 / 平均 / 技能升級 / ATK Buff", () => {
  const crit = computeSkillDamage(dmgStats, mkSkill(), { ...dmgBase, crit: "crit" });
  assert.equal(crit.perHit, Math.floor(2000 * 3.6 * 2.5 * mit800));
  const avg = computeSkillDamage(dmgStats, mkSkill(), { ...dmgBase, crit: "average" });
  assert.equal(avg.perHit, Math.floor(2000 * 3.6 * 2.5 * mit800), "CR 100% 時平均應等於必暴");
  const up = computeSkillDamage(dmgStats, mkSkill(), { ...dmgBase, skillUps: true });
  assert.equal(up.perHit, Math.floor(2000 * 3.6 * 1.25 * mit800));
  const buff = computeSkillDamage(dmgStats, mkSkill(), { ...dmgBase, atkBuff: 50, leadAtk: 25 });
  assert.equal(buff.perHit, Math.floor(2000 * 1.75 * 3.6 * mit800));
});

check("滿技與暴擊為相加（與 SWOP 相同）", () => {
  // SWOP：DMG = 基礎 × (暴擊係數 + 滿技%)；不是相乘
  const r = computeSkillDamage(dmgStats, mkSkill(), { ...dmgBase, crit: "crit", skillUps: true });
  assert.equal(r.perHit, Math.floor(2000 * 3.6 * (2.5 + 0.25) * mit800));
});

check("無視防禦 / 破防 / 烙印", () => {
  const ig = computeSkillDamage(dmgStats, mkSkill(), { ...dmgBase, ignoreDef: true });
  assert.equal(ig.mitigation, 1000 / 1140);
  assert.equal(ig.perHit, Math.floor(2000 * 3.6 * (1000 / 1140)));
  const br = computeSkillDamage(dmgStats, mkSkill(), { ...dmgBase, defBreak: true });
  const mitBreak = 1000 / (1140 + 3.5 * 800 * 0.3);
  assert.equal(br.perHit, Math.floor(2000 * 3.6 * mitBreak));
  const brand = computeSkillDamage(dmgStats, mkSkill(), { ...dmgBase, brand: true });
  assert.equal(brand.perHit, Math.floor(2000 * 3.6 * 1.25 * mit800));
});

check("風丑 S3 Amputation Magic：3 段無視防禦（與 SWOP 相同公式）", () => {
  const lushen = skillsForMonster(skillData, 13413);
  const s3 = lushen.find((s) => s.slot === 3);
  assert.equal(s3.n, "Amputation Magic");
  assert.equal(s3.hits, 3);
  assert.ok(s3.e.includes(38), "S3 應標記無視防禦");
  // 對照 SWOP：ATK 2377（含競技場 20% + 屬性塔 21%）、ATK Buff 50%、
  // 暴傷 186%（含競技場 25%）、滿技 30%、無視防禦 → SWOP DMG = 6720/段
  const r = computeSkillDamage(
    { ...dmgStats, atk: 2377, cd: 186 },
    s3,
    { ...dmgBase, crit: "crit", skillUps: true, ignoreDef: true, atkBuff: 50 },
  );
  assert.equal(r.perHit, 6720);
  assert.equal(r.total, 6720 * 3);
});


check("速度 / 目標體力% 公式", () => {
  const spdSkill = mkSkill({ f: "{ATK}*({SPD} + 155)/135", hits: 2 });
  const s = computeSkillDamage(dmgStats, spdSkill, dmgBase);
  assert.equal(s.perHit, Math.floor((2000 * (200 + 155)) / 135 * mit800));
  assert.equal(s.total, Math.floor((2000 * (200 + 155)) / 135 * mit800) * 2);
  const hpSkill = mkSkill({ f: "{ATK}*(4.1 - 1.6*{Target Current HP %})", hits: 1 });
  const h = computeSkillDamage(dmgStats, hpSkill, { ...dmgBase, enemyHpPct: 50 });
  assert.equal(h.perHit, Math.floor(2000 * (4.1 - 1.6 * 0.5) * mit800));
});

check("炸彈：不暴擊、無視防禦", () => {
  const bomb = computeSkillDamage(dmgStats, mkSkill({ f: "4.0*{ATK}", hits: 1, e: [23] }), { ...dmgBase, crit: "crit" });
  assert.equal(bomb.mitigation, 1000 / 1140);
  assert.equal(bomb.perHit, Math.floor(8000 * (1000 / 1140)));
  assert.equal(bomb.total, Math.floor(8000 * (1000 / 1140)));
  assert.equal(bomb.bomb, true);
});

/* ── 7. 神器 ────────────────────────────────────── */
console.log("\n[7] 神器");
check("神器效果 ID 對照與文字", () => {
  assert.ok(artifactSubText({ t: 200, v: 18 }).includes("攻擊力"));
  assert.ok(artifactSubText({ t: 304, v: 4 }).includes("暗屬性"));
  assert.ok(artifactSubText({ t: 218, v: 0.3 }).includes("0.3%"));
  assert.ok(artifactSubText({ t: 410, v: 9 }).includes("技能 3／4"));
  assert.equal(artifactKindText({ type: 1, attr: 2, style: 0 }).includes("火"), true);
  assert.equal(artifactKindText({ type: 2, attr: 0, style: 4 }), "支援型");
  assert.equal(artifactTypeText(2), "類型神器");
});

check("神器自動套用魔靈屬性 / 類型（含無形）", () => {
  const lushen = MONSTERS.find((m) => m.id === 13413); // 風 / 攻擊型
  assert.deepEqual(artifactAutoLabels(lushen), { attribute: "風屬性", archetype: "攻擊型" });
  const mk = (type, attr, style) => ({
    id: 1, type, attr, style, occupied: 0, main: { t: 100, v: 1500 }, subs: [], level: 15, rank: 5, stars: 5, locked: false,
  });
  assert.equal(artifactEligible(mk(1, 3, 0), lushen), true, "風屬性神器可用");
  assert.equal(artifactEligible(mk(1, 2, 0), lushen), false, "火屬性神器不可用");
  assert.equal(artifactEligible(mk(1, 98, 0), lushen), true, "無形屬性神器可用");
  assert.equal(artifactEligible(mk(2, 0, 1), lushen), true, "攻擊型神器可用");
  assert.equal(artifactEligible(mk(2, 0, 2), lushen), false, "防禦型神器不可用");
  assert.equal(artifactEligible(mk(2, 0, 98), lushen), true, "無形類型神器可用");
  assert.equal(artifactKindText(mk(1, 98, 0)), "無形");
  assert.equal(artifactKindText(mk(2, 0, 98)), "無形");
});

check("神器主效果：固定體力 / 攻擊 / 防禦", () => {
  const arts = [
    { id: 1, type: 1, attr: 1, style: 0, occupied: 0, main: { t: 100, v: 1500 }, subs: [], level: 15, rank: 5, stars: 5, locked: false },
    { id: 2, type: 2, attr: 0, style: 2, occupied: 0, main: { t: 101, v: 100 }, subs: [], level: 15, rank: 5, stars: 4, locked: false },
  ];
  assert.equal(artifactMainText(arts[0]), "體力 +1,500");
  assert.deepEqual(artifactFlat(arts), { hp: 1500, atk: 100, def: 0 });
});

check("神器副效果：技能暴傷與對屬性傷害", () => {
  const art = {
    id: 1, type: 1, attr: 1, style: 0, occupied: 0, main: { t: 100, v: 1500 },
    subs: [{ t: 402, v: 20 }, { t: 301, v: 5 }, { t: 224, v: 10 }],
    level: 15, rank: 5, stars: 5, locked: false,
  };
  const aoe = { id: 1, n: "x", slot: 3, hits: 1, aoe: true, passive: false, cool: 0, max: 0, f: "{ATK}*2", raw: "", sc: [], up: 0, e: [], d: "" };
  const single = { ...aoe, aoe: false, slot: 1 };
  const a = artifactDamageBonus([art], aoe, 1);
  assert.equal(a.cd, 20, "S3 暴傷 +20");
  assert.equal(a.dmg, 5, "對水屬性 +5");
  assert.equal(a.applied.length, 2);
  const b = artifactDamageBonus([art], single, 0);
  assert.equal(b.cd, 10, "單體技能暴傷 +10；未指定敵方屬性時不計屬性傷害");
  assert.equal(b.dmg, 0);
});

check("神器解析：字串 / 陣列主效果、已裝備合併", () => {
  const raw = {
    unit_list: [{
      unit_id: 501, unit_master_id: 17012, class: 6, unit_level: 40,
      runes: [{ rune_id: 9001, occupied_id: 501, slot_no: 1, set_id: 1, class: 6, rank: 5, upgrade_curr: 15, pri_eff: [2, 10], prefix_eff: [0, 0], sec_eff: [] }],
      artifacts: [
        { rid: 7001, occupied_id: 501, type: 1, attribute: 2, unit_style: 0, natural_rank: 5, rank: 5, level: 15, pri_effect: [100, 1500, 15, 0, 0], sec_effects: [[304, 4, 0, 0, 0], [219, 4, 0, 0, 0]] },
        { rid: 7002, occupied_id: 501, type: 2, attribute: 0, unit_style: 2, natural_rank: 4, rank: 5, level: 15, pri_effect: "101 100 15 0 0", sec_effects: [[206, 6, 0, 0, 0]] },
      ],
    }],
    runes: [],
    artifacts: [
      { rid: 7001, occupied_id: 0, type: 1, attribute: 2, natural_rank: 5, rank: 5, level: 15, pri_effect: [100, 1500, 15, 0, 0], sec_effects: [[304, 4, 0, 0, 0]] },
      { rid: 7003, occupied_id: 0, type: 1, attribute: 3, natural_rank: 4, rank: 4, level: 15, pri_effect: [102, 100, 15, 0, 0], sec_effects: [[301, 5, 0, 0, 0]] },
    ],
  };
  const p = parseAccountJSON(JSON.stringify(raw), "artifacts.json");
  assert.equal(p.error, undefined, p.error);
  const arts = p.account.artifacts;
  assert.equal(arts.length, 3);
  assert.deepEqual(p.account.units[0].artifacts, [7001, 7002]);
  const a1 = arts.find((a) => a.id === 7001);
  assert.equal(a1.occupied, 501, "已裝備神器以 unit 內的 owner 為準");
  assert.equal(a1.main.t, 100);
  assert.equal(a1.subs[0].t, 304);
  const a2 = arts.find((a) => a.id === 7002);
  assert.equal(a2.main.t, 101, "pri_effect 字串格式");
  assert.equal(a2.main.v, 100);
  assert.equal(a2.style, 2);
  assert.equal(arts.find((a) => a.id === 7003).occupied, 0);
  assert.ok(p.warnings.some((w) => w.includes("神器")));
});

check("神器主效果計入面板與 EHP", () => {
  const raw = {
    unit_list: [{
      unit_id: 501, unit_master_id: 17012, class: 6, unit_level: 40,
      runes: [{ rune_id: 9001, occupied_id: 501, slot_no: 1, set_id: 1, class: 6, rank: 5, upgrade_curr: 15, pri_eff: [2, 10], prefix_eff: [0, 0], sec_eff: [] }],
      artifacts: [
        { rid: 7001, occupied_id: 501, type: 1, attribute: 2, natural_rank: 5, rank: 5, level: 15, pri_effect: [100, 1500, 15, 0, 0], sec_effects: [] },
        { rid: 7002, occupied_id: 501, type: 2, attribute: 0, unit_style: 2, natural_rank: 4, rank: 5, level: 15, pri_effect: [101, 100, 15, 0, 0], sec_effects: [] },
      ],
    }],
    runes: [],
  };
  const p = parseAccountJSON(JSON.stringify(raw), "artifacts.json");
  const a = p.account;
  const u = a.units[0];
  const monster = MONSTERS.find((m) => m.id === u.master);
  const base = baseStats(monster, u.stars, u.level);
  const arts = u.artifacts.map((id) => a.artifacts.find((x) => x.id === id));
  const runes = u.runes.map((id) => a.runes.find((r) => r.id === id));
  const before = statsForRunes(base, runes, defaultBonus(), false, false, []);
  const after = statsForRunes(base, runes, defaultBonus(), false, false, arts);
  assert.equal(after.hp - before.hp, 1500);
  assert.equal(after.atk - before.atk, 100);
  assert.ok(after.ehp > before.ehp);
});

check("追傷：每個屬性分別無條件捨去後加總", () => {
  const art = {
    id: 9, type: 1, attr: 3, style: 0, occupied: 0, main: { t: 100, v: 1500 },
    subs: [{ t: 218, v: 0.3 }, { t: 219, v: 4 }, { t: 220, v: 4 }, { t: 221, v: 40 }],
    level: 15, rank: 5, stars: 5, locked: false,
  };
  assert.equal(artifactAdditionalDamage({ hp: 40000, atk: 3000, def: 2000, spd: 250 }, [art]), 420);
  // 33333×0.3% = 99.999 → 99（不是先加總再捨去）
  assert.equal(artifactAdditionalDamage({ hp: 33333, atk: 0, def: 0, spd: 0 }, [art]), 99);
});

check("追傷：不吃暴擊與防禦減傷，但會加在每段", () => {
  const art = {
    id: 9, type: 1, attr: 3, style: 0, occupied: 0, main: { t: 100, v: 1500 },
    subs: [{ t: 218, v: 0.3 }, { t: 219, v: 4 }, { t: 220, v: 4 }, { t: 221, v: 40 }],
    level: 15, rank: 5, stars: 5, locked: false,
  };
  const normal = computeSkillDamage(dmgStats, mkSkill(), dmgBase);
  const withAd = computeSkillDamage(dmgStats, mkSkill(), dmgBase, [art]);
  assert.equal(withAd.adPerHit, 282);
  assert.equal(withAd.basePerHit, normal.perHit);
  assert.equal(withAd.perHit, normal.perHit + 282);
  assert.equal(withAd.adTotal, 282 * 2);
  assert.equal(withAd.total, normal.perHit * 2 + 282 * 2);
  // 暴擊模式也不會放大追傷
  const crit = computeSkillDamage(dmgStats, mkSkill(), { ...dmgBase, crit: "crit" }, [art]);
  assert.equal(crit.adPerHit, 282);
});

check("神器 Focus：Min/Max 與契合度", () => {
  const art = {
    id: 1, type: 1, attr: 3, style: 0, occupied: 0, main: { t: 100, v: 1500 },
    subs: [{ t: 219, v: 10 }, { t: 402, v: 20 }], level: 15, rank: 5, stars: 5, locked: false,
  };
  assert.equal(artifactFocusFit(art, [{ effect: 219, min: 5, max: 20, weight: 10 }]), 50);
  assert.equal(artifactFocusFit(art, [{ effect: 219, min: 15, max: 20, weight: 10 }]), null);
  assert.equal(artifactFocusFit(art, [{ effect: 402, min: 0, max: 30, weight: 10 }]), 66.66666666666666);
  assert.equal(artifactFocusFit(art, []), 0);
});

check("第二階段：主屬性 / Focus 篩選、10 件神器、25 對", () => {
  const monster = MONSTERS.find((m) => m.id === 13413);
  const base = baseStats(monster, 6, 40);
  const runes = [1, 2, 3, 4, 5, 6]
    .map((slot) => account.runes.find((r) => r.slot === slot))
    .filter(Boolean);
  const build = { runes, stats: statsForRunes(base, runes, defaultBonus(), false, true), score: 0, eff: 0, sets: {} };
  const mkArt = (id, type, attr, style, main, subs) => ({
    id, type, attr, style, occupied: 0, main: { t: main, v: main === 100 ? 1500 : 100 },
    subs, level: 15, rank: 5, stars: 5, locked: false,
  });
  const arts = [];
  const vals = [5, 8, 12, 16, 20];
  for (let i = 0; i < 5; i++) {
    arts.push(mkArt(1000 + i, 1, 3, 0, 101, [{ t: 219, v: vals[i] }, { t: 218, v: 0.3 }]));
  }
  arts.push(mkArt(1005, 1, 3, 0, 102, [{ t: 402, v: 10 }]));
  for (let i = 0; i < 6; i++) {
    arts.push(mkArt(2000 + i, 2, 0, 1, [100, 101, 102][i % 3], i < 5 ? [{ t: 218, v: 0.5 }, { t: 219, v: 4 }] : [{ t: 400, v: 12 }]));
  }
  // 不適用：水屬性神器、防禦型神器
  arts.push(mkArt(3001, 1, 1, 0, 101, [{ t: 219, v: 20 }]));
  arts.push(mkArt(3002, 2, 0, 2, 100, [{ t: 218, v: 1 }]));
  const s3 = skillsForMonster(skillData, 13413).find((s) => s.slot === 3);
  const opts = {
    base, builds: [build], bonus: defaultBonus(), rta: false, monster, artifacts: arts,
    skill: s3, main1: 101, main2: 0,
    focus1: [{ effect: 219, min: 5, max: 20, weight: 10 }], focus2: [],
    dmgOpts: { ...dmgBase, useArtifacts: true, enemyEl: 0 }, perType: 5,
  };
  const out = runStage2(opts);
  assert.equal(out.type1.length, 5);
  assert.equal(out.type2.length, 5);
  assert.equal(out.candidates.length, 10);
  assert.equal(out.pairs.length, 25);
  assert.ok(out.type1.every((a) => a.main.t === 101), "主屬性 filter 應只留攻擊");
  assert.equal(out.type1[0].id, 1004, "Focus 契合度最高的神器排第一");
  assert.ok(!out.candidates.some((a) => a.id === 3001 || a.id === 3002), "不適用神器不可入選");
  assert.ok(out.pairs[0].score >= out.pairs[1].score);
  assert.equal(out.pairs[0].artifacts.length, 2);
  assert.ok(out.pairs[0].build);
  assert.ok(out.pairs[0].base > 0);
  assert.ok(out.pairs[0].focus[0] > 0);

  // Min/Max 太嚴 → 沒有候選
  const none = runStage2({ ...opts, focus1: [{ effect: 219, min: 99, max: 200, weight: 10 }] });
  assert.equal(none.type1.length, 0);
  assert.ok(none.warnings.some((w) => w.includes("Focus")));
});

check("RTA：獨立符文 / 神器、最愛魔靈與速度隊長", () => {
  const raw = {
    unit_list: [{
      unit_id: 501, unit_master_id: 13413, class: 6, unit_level: 40,
      runes: [{ rune_id: 9001, occupied_id: 501, slot_no: 1, set_id: 1, class: 6, rank: 5, upgrade_curr: 15, pri_eff: [2, 10], prefix_eff: [0, 0], sec_eff: [] }],
    }],
    runes: [
      { rune_id: 9001, occupied_id: 501, slot_no: 1, set_id: 1, class: 6, rank: 5, upgrade_curr: 15, pri_eff: [2, 10], prefix_eff: [0, 0], sec_eff: [] },
      { rune_id: 9102, occupied_id: 0, slot_no: 2, set_id: 3, class: 6, rank: 5, upgrade_curr: 15, pri_eff: [8, 42], prefix_eff: [0, 0], sec_eff: [[8, 20, 0, 5]] },
    ],
    artifacts: [{
      rid: 7001, occupied_id: 0, type: 1, attribute: 3, unit_style: 0, natural_rank: 5, rank: 5, level: 15,
      pri_effect: [100, 1500, 15, 0, 0], sec_effects: [],
    }],
    favorite_unit_list: [{ type: 1, unit_id_list: [[501]] }],
    world_arena_rune_equip_list: [{ rune_id: 9102, occupied_id: 501 }],
    world_arena_artifact_equip_list: [{ artifact_id: 7001, occupied_id: 501, artifact_type: 1, slot: 1 }],
  };
  const p = parseAccountJSON(JSON.stringify(raw), "rta.json");
  assert.equal(p.error, undefined, p.error);
  const a = p.account;
  assert.deepEqual(a.rta.favorites, [501]);
  assert.deepEqual(a.rta.loadouts[501].runes, [9102]);
  assert.deepEqual(a.rta.loadouts[501].artifacts, [7001]);
  assert.ok(p.warnings.some((w) => w.includes("RTA")));

  const m = MONSTERS.find((x) => x.id === 13413);
  const unit = a.units[0];
  const base = baseStats(m, 6, 40);
  const normal = rtaStats(base, [], [], 0, true);
  assert.equal(normal.spd, base.spd, "RTA 不套用一般速度圖騰");

  const view = rtaView(a, unit, m, 0, true);
  assert.equal(view.runes.length, 1);
  assert.equal(view.artifacts.length, 1);
  assert.equal(view.stats.spd, base.spd + 42 + 20 + 5, "RTA 符文主屬 + 副屬速度");
  assert.equal(view.stats.hp, base.hp + 1500, "RTA 神器主屬性計入面板");

  const leader = rtaStats(base, view.runes, view.artifacts, 24, true);
  assert.equal(leader.spd, base.spd + Math.ceil((base.spd * 24) / 100) + 42 + 20 + 5);
  assert.ok(leader.tick < view.stats.tick, "隊長加速後 RTA Tick 應下降");
});

check("配符 Include / Exclude / 鎖定符文", () => {
  const runes = [];
  for (let slot = 1; slot <= 6; slot++) {
    for (let k = 0; k < 2; k++) {
      runes.push({
        id: 10000 + slot * 10 + k, set: slot <= 3 ? 3 : 1, slot, grade: 6, level: 15,
        main: { t: 8, v: 40 + k }, prefix: { t: 0, v: 0 }, subs: [],
        occupied: 0, ancient: false, locked: false, eff: 50, effMax: 100,
      });
    }
  }
  const monster = MONSTERS.find((m) => m.id === 13413);
  const base = baseStats(monster, 6, 40);
  const common = {
    base, runes, required: [], min: {}, max: {}, bonus: defaultBonus(),
    pool: 2, allowEquipped: true, maxNodes: 200000,
  };
  const inc = optimize({ ...common, includeRunes: [10021] });
  assert.ok(inc.count > 0);
  const incBuilds = buildsOf(inc, runes, false, 8);
  assert.ok(incBuilds.every((b) => b.runes[1]?.id === 10021), "Include 符文必須固定在 2 號位");

  const exc = optimize({ ...common, excludeRunes: [10020] });
  const excBuilds = buildsOf(exc, runes, false, 8);
  assert.ok(excBuilds.every((b) => b.runes[1]?.id !== 10020), "Exclude 符文不可出現在結果");

  const lockedOther = optimize({ ...common, includeRunes: [10021], lockedRunes: [10021], targetUnit: 999 });
  assert.equal(lockedOther.count, 0, "鎖定在別的魔靈身上的符文不能用來配符");

  const lockedSame = optimize({ ...common, includeRunes: [10021], lockedRunes: [10021], targetUnit: 555 });
  runes.find((r) => r.id === 10021).occupied = 555;
  const lockedSame2 = optimize({ ...common, includeRunes: [10021], lockedRunes: [10021], targetUnit: 555 });
  assert.equal(lockedSame2.count, inc.count, "鎖定在目標魔靈身上的符文仍可使用");
  assert.ok(lockedSame.count >= 0);
});

check("神器追傷計算器：三圍、段數與神器效果", () => {
  const stats = { hp: 40000, atk: 3000, def: 2000, spd: 250 };
  const effects = { hp: 0.3, atk: 4, def: 4, spd: 40 };
  const r = calculateAd(stats, effects, 3);
  assert.deepEqual(r.parts, { hp: 120, atk: 120, def: 80, spd: 100 });
  assert.equal(r.perHit, 420);
  assert.equal(r.total, 1260);
  // 每個屬性分開無條件捨去
  const f = calculateAd({ hp: 33333, atk: 0, def: 0, spd: 0 }, { hp: 0.3, atk: 0, def: 0, spd: 0 }, 1);
  assert.equal(f.parts.hp, 99);

  const art = {
    id: 1, type: 1, attr: 3, style: 0, occupied: 0, main: { t: 100, v: 1500 },
    subs: [{ t: 218, v: 0.3 }, { t: 219, v: 4 }], level: 15, rank: 5, stars: 5, locked: false,
  };
  assert.deepEqual(artifactAdEffects(art), { hp: 0.3, atk: 4, def: 0, spd: 0 });
  const one = artifactAdResult(art, stats, 2);
  assert.equal(one.perHit, 240);
  assert.equal(one.total, 480);
  assert.deepEqual(addAdEffects({ hp: 1, atk: 2, def: 3, spd: 4 }, { hp: 1, atk: 1, def: 1, spd: 1 }), { hp: 2, atk: 3, def: 4, spd: 5 });
});

check("預設隊：解析 deck_list 與裝備快照", () => {
  const raw = {
    unit_list: [{
      unit_id: 501, unit_master_id: 13413, class: 6, unit_level: 40,
      runes: [{ rune_id: 9001, occupied_id: 501, slot_no: 1, set_id: 1, class: 6, rank: 5, upgrade_curr: 15, pri_eff: [2, 10], prefix_eff: [0, 0], sec_eff: [] }],
    }],
    runes: [{ rune_id: 9001, occupied_id: 501, slot_no: 1, set_id: 1, class: 6, rank: 5, upgrade_curr: 15, pri_eff: [2, 10], prefix_eff: [0, 0], sec_eff: [] }],
    deck_list: [{
      deck_type: 22, deck_seq: 3,
      unit_id_list: [501, 0, 0],
      leader_unit_id: 501,
      equip: [{ unit_id: 501, rune_id_list: [9001], artifact_id_list: [7001] }],
    }],
  };
  const p = parseAccountJSON(JSON.stringify(raw), "decks.json");
  assert.equal(p.error, undefined, p.error);
  assert.equal(p.account.decks.length, 1);
  const d = p.account.decks[0];
  assert.equal(d.type, 22);
  assert.equal(d.seq, 3);
  assert.deepEqual(d.units, [501]);
  assert.equal(d.leader, 501);
  assert.deepEqual(d.equip[0].runes, [9001]);
  assert.deepEqual(d.equip[0].artifacts, [7001]);
  assert.ok(p.warnings.some((w) => w.includes("預設隊")));
});

check("防守隊：解析競技場與據點戰防守", () => {
  const raw = {
    unit_list: [{
      unit_id: 501, unit_master_id: 13413, class: 6, unit_level: 40,
      runes: [{ rune_id: 9001, occupied_id: 501, slot_no: 1, set_id: 1, class: 6, rank: 5, upgrade_curr: 15, pri_eff: [2, 10], prefix_eff: [0, 0], sec_eff: [] }],
    }],
    runes: [{ rune_id: 9001, occupied_id: 501, slot_no: 1, set_id: 1, class: 6, rank: 5, upgrade_curr: 15, pri_eff: [2, 10], prefix_eff: [0, 0], sec_eff: [] }],
    defense_deck_info: {
      wizard_id: 1,
      unit_id_list: [501],
      battle_power: 51448,
      equip: [{ unit_id: 501, rune_id_list: [9001], artifact_id_list: [7001] }],
    },
    server_arena_defense_deck_info: {
      wizard_id: 1,
      unit_id_list: [{ unit_id: 501, pos_id: 1 }],
      equip: [{ unit_id: 501, rune_id_list: [9001], artifact_id_list: [] }],
    },
    guildsiege_defense_deck_unit_list: [
      { guild_id: 9, deck_id: 111, wizard_id: 1, unit_id_list: [501] },
      { guild_id: 9, deck_id: 222, wizard_id: 1, unit_id_list: [502] },
    ],
    guildsiege_defense_deck_equip_list: {
      222: { wizard_id: 1, deck_id: 222, equip: [{ unit_id: 502, rune_id_list: [9002], artifact_id_list: [7002] }] },
    },
  };
  const p = parseAccountJSON(JSON.stringify(raw), "defense.json");
  assert.equal(p.error, undefined, p.error);
  assert.equal(p.account.defenseDecks.length, 4);
  const [arena, server, siege1, siege2] = p.account.defenseDecks;
  assert.equal(arena.type, 100);
  assert.deepEqual(arena.units, [501]);
  assert.equal(arena.battlePower, 51448);
  assert.deepEqual(arena.equip[0].runes, [9001]);
  assert.equal(server.type, 101);
  assert.deepEqual(server.units, [501]);
  assert.equal(siege1.type, 102);
  assert.equal(siege1.seq, 1);
  assert.deepEqual(siege1.units, [501]);
  assert.equal(siege2.seq, 2);
  assert.deepEqual(siege2.units, [502]);
  assert.deepEqual(siege2.equip[0].runes, [9002]);
  assert.deepEqual(siege2.equip[0].artifacts, [7002]);
  assert.ok(p.warnings.some((w) => w.includes("防守隊")));
});

check("防守隊：沒有防守資料時不產生隊伍", () => {
  const raw = {
    unit_list: [],
    runes: [{ rune_id: 9001, occupied_id: 0, slot_no: 1, set_id: 1, class: 6, rank: 5, upgrade_curr: 15, pri_eff: [2, 10], prefix_eff: [0, 0], sec_eff: [] }],
    guildsiege_defense_deck_unit_list: [],
  };
  const p = parseAccountJSON(JSON.stringify(raw), "nodef.json");
  assert.equal(p.error, undefined, p.error);
  assert.deepEqual(p.account.defenseDecks, []);
});

check("預設隊：速度隊長技的內容與屬性範圍", () => {
  assert.equal(deckContext(1), "arena");
  assert.equal(deckContext(2), "guild");
  assert.equal(deckContext(3), "dungeon");
  assert.equal(deckContext(100), "arena");
  assert.equal(deckContext(102), "guild");

  const ereshion = spdLeaderSkill(30713);
  assert.equal(ereshion.p, 33);
  assert.equal(ereshion.a, "Arena");
  assert.equal(spdLeaderApplies(ereshion, 3, "arena"), true);
  assert.equal(spdLeaderApplies(ereshion, 3, "guild"), false);

  const seara = spdLeaderSkill(15713);
  assert.equal(seara.p, 24);
  assert.equal(spdLeaderApplies(seara, 1, "guild"), true);
  assert.equal(spdLeaderApplies(seara, 1, "dungeon"), true);

  const inugami = spdLeaderSkill(11001);
  assert.equal(inugami.a, "Element");
  assert.equal(inugami.e, "Water");
  assert.equal(spdLeaderApplies(inugami, 1, "dungeon"), true);
  assert.equal(spdLeaderApplies(inugami, 2, "dungeon"), false);

  assert.equal(spdLeaderSkill(10514), null);
});

check("Speed Tick 計算器：速度、門檻與出手順序", () => {
  // 一般 7%
  assert.equal(tickFor(130, 7), 11);
  assert.equal(tickFor(477, 7), 3);
  assert.equal(minSpeedForTick(11, 7), 130);
  // RTA 1.5%
  assert.equal(tickFor(400, 1.5), 17);
  // 討伐 4.5%
  assert.equal(tickFor(300, 4.5), 8);

  const b = tickBrackets(7, 12);
  assert.equal(b[0].tick, 1);
  assert.equal(b[0].minSpeed, minSpeedForTick(1, 7));
  assert.equal(b[1].minSpeed, minSpeedForTick(2, 7));
  assert.equal(b[1].maxSpeed, b[0].minSpeed - 1);
  for (const x of b) {
    assert.equal(tickFor(x.minSpeed, 7), x.tick);
    if (Number.isFinite(x.maxSpeed) && x.maxSpeed >= x.minSpeed) assert.equal(tickFor(x.maxSpeed, 7), x.tick);
  }

  const unit = {
    id: "a", name: "A", monsterId: 0, baseSpd: 100, runeSpd: 100,
    swift: true, buff: false, artifactPct: 0, team: "blue", priority: 1,
  };
  const plain = calcUnitSpeeds(unit, { totem: 15, lead: 0 });
  // SWGT：ceil((1 + 0.15 + 0.25) × 100 + (100 − 25))
  assert.equal(plain.normal, 215);
  assert.equal(plain.buffed, 280); // ceil(215 × 1.3)
  assert.equal(plain.debuffed, 151); // ceil(215 × 0.7)
  const withArtifact = calcUnitSpeeds({ ...unit, artifactPct: 10 }, { totem: 15, lead: 0 });
  assert.equal(withArtifact.buffed, 286); // Buff 變成 +33%

  // 迅速加成 = ceil(基礎速度 × 25%)
  assert.equal(swiftSetBonus(101), 26);
  assert.equal(swiftSetBonus(120), 30);

  // 與 SWGT 相同的輸入必須得到相同的結果（數值取自 SWGT 頁面實測）
  const swgtNormal = (baseSpd, runeSpd, swift, lead) =>
    calcUnitSpeeds({ ...unit, baseSpd, runeSpd, swift }, { totem: 15, lead }).normal;
  assert.equal(swgtNormal(101, 191, true, 33), 340); // Ereshion
  assert.equal(swgtNormal(120, 0, true, 33), 178); // Kabilla
  assert.equal(swgtNormal(104, 0, false, 33), 154); // Wind Elder Horn
  assert.equal(swgtNormal(101, 0, false, 33), 150); // Jasmine

  const order = simulateTickOrder(
    [
      { id: "fast", name: "快", spd: 200, team: "blue", priority: 1 },
      { id: "slow", name: "慢", spd: 100, team: "red", priority: 2 },
    ],
    7,
    3,
  );
  // 一個 Tick 只有一隻出手，出手後攻條歸 0（溢出不保留）
  assert.equal(order[0].id, "fast");
  assert.equal(order[0].tick, 8);
  assert.equal(order[1].id, "slow");
  assert.equal(order[1].tick, 15);
  assert.equal(order[2].id, "fast");
  assert.equal(order[2].tick, 16);
  assert.equal(order[0].turn, 1);

  // 三隻同時達標時，一 Tick 只讓攻擊條最高（或 Priority 較前）的出手
  const triple = simulateTickOrder(
    [
      { id: "a", name: "A", spd: 200, team: "blue", priority: 1 },
      { id: "b", name: "B", spd: 190, team: "blue", priority: 2 },
      { id: "c", name: "C", spd: 180, team: "blue", priority: 3 },
    ],
    7,
    3,
  );
  assert.deepEqual(triple.map((e) => [e.tick, e.id]), [[8, "a"], [9, "b"], [10, "c"]]);

  // 拉條：兩隻同速，其中一隻在 Tick 5 拉 50% 攻擊條
  const adv = simulateAdvanced(
    [
      { id: "a", name: "A", spd: 100, team: "blue", priority: 1 },
      { id: "b", name: "B", spd: 100, team: "red", priority: 2 },
    ],
    7,
    { boosts: [{ id: "x", unitId: "a", tick: 5, pct: 50 }] },
    4,
    20,
  );
  assert.equal(adv.events[0].id, "a");
  assert.equal(adv.events[0].tick, 8);
  // Tick 表顯示「出手前」的攻擊條
  assert.equal(Math.round(adv.frames[7].cells.find((c) => c.unitId === "a").ab), 106);

  // 速度增減：只在指定的那一個 Tick 生效（與 SWGT 相同）
  const modded = simulateAdvanced(
    [{ id: "a", name: "A", spd: 100, team: "blue", priority: 1 }],
    7,
    { mods: [{ id: "m", unitId: "a", tick: 1, pct: 30 }] },
    4,
    3,
  );
  assert.equal(modded.frames[0].cells[0].ab.toFixed(3), "9.100"); // 130 × 7%
  assert.equal(modded.frames[1].cells[0].ab.toFixed(3), "16.100"); // 回到 100 速
  assert.equal(modded.frames[2].cells[0].ab.toFixed(3), "23.100");

  // 正向的速度增減會被神器「速度增加效果」放大：30% × 1.1 = 33%
  const modArt = simulateAdvanced(
    [{ id: "a", name: "A", spd: 100, team: "blue", priority: 1, artifactPct: 10 }],
    7,
    { mods: [{ id: "m", unitId: "a", tick: 1, pct: 30 }] },
    4,
    2,
  );
  assert.equal(modArt.frames[0].cells[0].ab.toFixed(3), "9.310"); // 133 × 7%

  // 負向的速度增減不吃神器
  const modDown = simulateAdvanced(
    [{ id: "a", name: "A", spd: 100, team: "blue", priority: 1, artifactPct: 10 }],
    7,
    { mods: [{ id: "m", unitId: "a", tick: 1, pct: -30 }] },
    4,
    2,
  );
  assert.equal(modDown.frames[0].cells[0].ab.toFixed(3), "4.900"); // 70 × 7%

  // 額外速度：% 加進圖騰／隊長桶（乘基礎速度），固定值加進符文速度
  const addBase = {
    id: "a", name: "A", spd: 115, baseSpd: 100, runeSpd: 0, bonusPct: 15,
    team: "blue", priority: 1,
  };
  const addPct = simulateAdvanced(
    [addBase],
    7,
    { adds: [{ id: "x", unitId: "a", tick: 1, value: 30, mode: "pct" }] },
    4,
    2,
  );
  // 115 → ceil((1 + 0.45) × 100) = 145
  assert.equal(addPct.frames[0].cells[0].ab.toFixed(3), "10.150");
  assert.equal(addPct.frames[1].cells[0].ab.toFixed(3), "18.200");
  const addFlat = simulateAdvanced(
    [addBase],
    7,
    { adds: [{ id: "x", unitId: "a", tick: 1, value: 30, mode: "flat" }] },
    4,
    2,
  );
  assert.equal(addFlat.frames[0].cells[0].ab.toFixed(3), "10.150"); // ceil(115 + 30)
  assert.equal(addFlat.frames[1].cells[0].ab.toFixed(3), "18.200");
});

/* ── 13. 一鍵配隊 ─────────────────────────────── */
console.log("\n[13] 一鍵配隊（整隊符文不重複）");

// 每個位置 8 顆；1–4 號迅速（3）、5–6 號意志（15），確保套裝需求一定配得出來。
const teamRunes = [];
for (let slot = 1; slot <= 6; slot++) {
  for (let k = 0; k < 8; k++) {
    const set = slot <= 4 ? 3 : 15;
    const mainT = slot === 2 ? 8 : slot === 6 ? 2 : slot === 4 ? 4 : slot === 1 || slot === 5 ? 3 : 5;
    const mainV = slot === 2 ? 30 + k : slot === 6 ? 55 : slot === 4 ? 50 : 140;
    const sec = [[8, 5 + k * 2, 0, 0]];
    if (slot === 2) sec.push([9, 4 + k, 0, 0]);
    teamRunes.push({
      rune_id: 700000 + slot * 100 + k,
      slot_no: slot, set_id: set, class: 6, rank: 5, upgrade_curr: 15,
      pri_eff: [mainT, mainV], prefix_eff: [0, 0], sec_eff: sec,
    });
  }
}
const teamAccount = parseAccountJSON(
  JSON.stringify({ unit_list: [], runes: teamRunes, building_list: [] }),
  "team.json",
);
assert.equal(teamAccount.error, undefined, teamAccount.error);
const teamRuneList = teamAccount.account.runes;
const teamBonus = {
  towerSpd: 0, towerAtk: 0, towerHp: 0, towerDef: 0,
  guildAtk: 0, guildHp: 0, guildDef: 0, guildCd: 0,
  leadSpd: 0, buffSpd: 0, useGuild: false, useElementTower: false, grind: true,
};

const mkTeamMember = (unitId, over = {}) => ({
  unitId,
  master: 1000 + unitId,
  label: `測試魔靈 ${unitId}`,
  base: { hp: 12000, atk: 700, def: 600, spd: 100, cr: 15, cd: 50, res: 15, acc: 0 },
  role: "dps",
  weight: 10,
  sets: [{ set: 3, count: 4 }, { set: 15, count: 2 }],
  mains: {},
  min: {},
  focus: [],
  leadSpd: 0,
  ...over,
});

const teamReq = (size, over = {}) => ({
  members: Array.from({ length: size }, (_, i) => mkTeamMember(900 + i)),
  runes: teamRuneList,
  bonus: teamBonus,
  rta: false,
  pool: 7,
  topK: 20,
  beamWidth: 24,
  allowEquipped: true,
  relaxSub: false,
  intangible: false,
  excludeRunes: [],
  lockedRunes: [],
  maxNodesPerSearch: 400_000,
  diversify: true,
  alternatives: 3,
  ...over,
});

const planOf = (out) => {
  assert.equal(out.ok, true, out.ok ? "" : out.error);
  return out.plan;
};

check("3 人：每人 6 顆，整隊符文不重複", () => {
  const plan = planOf(optimizeTeam(teamReq(3)));
  assert.equal(plan.members.length, 3);
  const ids = plan.members.flatMap((m) => m.runeIds);
  assert.equal(ids.length, 18);
  assert.equal(new Set(ids).size, 18, "整隊符文不可重複");
  for (const m of plan.members) {
    assert.equal(new Set(m.runeIds).size, 6, "每人 6 顆");
    assert.equal(m.sets[3], 4, "迅速 ×4");
    assert.equal(m.sets[15], 2, "意志 ×2");
  }
  assert.ok(plan.teamScore > 0, "隊伍分數應大於 0");
});

check("4 人 / 5 人：整隊符文仍不重複", () => {
  for (const size of [4, 5]) {
    const plan = planOf(optimizeTeam(teamReq(size)));
    const ids = plan.members.flatMap((m) => m.runeIds);
    assert.equal(plan.members.length, size);
    assert.equal(ids.length, size * 6);
    assert.equal(new Set(ids).size, size * 6, `${size} 人隊伍符文不可重複`);
  }
});

check("同一輸入可重現相同結果", () => {
  const a = planOf(optimizeTeam(teamReq(3)));
  const b = planOf(optimizeTeam(teamReq(3)));
  assert.deepEqual(
    a.members.map((m) => m.runeIds),
    b.members.map((m) => m.runeIds),
  );
});

check("固定符文（includeRunes）一定會入選", () => {
  const pinned = teamRuneList.find((r) => r.slot === 2);
  const plan = planOf(
    optimizeTeam(
      teamReq(3, {
        members: [
          mkTeamMember(900, { includeRunes: [pinned.id] }),
          mkTeamMember(901),
          mkTeamMember(902),
        ],
      }),
    ),
  );
  const ids = plan.members.flatMap((m) => m.runeIds);
  assert.ok(ids.includes(pinned.id), "固定符文沒有被使用");
  assert.equal(new Set(ids).size, ids.length, "固定後仍不可重複");
});

check("數值下限不可能時回傳錯誤，而不是丟例外", () => {
  const out = optimizeTeam(
    teamReq(3, {
      members: [mkTeamMember(900, { min: { spd: 9999 } }), mkTeamMember(901), mkTeamMember(902)],
    }),
  );
  assert.equal(out.ok, false);
  assert.match(out.error, /無法為/);
  assert.equal(out.unitId, 900);
});

check("符文數量不足時回傳錯誤", () => {
  const out = optimizeTeam(teamReq(3, { runes: teamRuneList.filter((r) => r.slot !== 3) }));
  assert.equal(out.ok, false);
  assert.match(out.error, /無法為|衝突/);
});

check("主屬性不可能時會自動放寬並在結果標示", () => {
  const out = optimizeTeam(
    teamReq(3, {
      members: [
        mkTeamMember(900, { mains: { 2: 11 } }),
        mkTeamMember(901),
        mkTeamMember(902),
      ],
    }),
  );
  const plan = planOf(out);
  assert.equal(plan.members.length, 3);
  assert.ok(plan.notes.some((n) => n.includes("不限主屬性")), "應標示放寬主屬性");
});

check("topK 模式只回傳前 K 組，且依目標分數排序", () => {
  const res = optimize({
    base: { hp: 12000, atk: 700, def: 600, spd: 100, cr: 15, cd: 50, res: 15, acc: 0 },
    runes: teamRuneList,
    required: [],
    min: {},
    max: {},
    bonus: teamBonus,
    pool: 7,
    allowEquipped: true,
    targetUnit: 0,
    rta: false,
    maxNodes: 400_000,
    topK: 5,
    objective: "spd",
  });
  assert.ok(res.topBuilds, "topK 模式應回傳 topBuilds");
  assert.equal(res.topBuilds.length, 5);
  for (let i = 1; i < res.topBuilds.length; i++) {
    assert.ok(
      res.topBuilds[i - 1].objective >= res.topBuilds[i].objective,
      "topBuilds 應依目標分數由高到低",
    );
  }
  assert.ok(res.topBuilds.every((b) => b.runeIds.length === 6), "每組應有 6 顆符文");
  assert.equal(objectiveOf(res.topBuilds[0].stats, "spd"), res.topBuilds[0].stats.spd);
});

check("隊長技只影響速度目標（leadSpd 逐隻帶入）", () => {
  const noLead = planOf(optimizeTeam(teamReq(1, { members: [mkTeamMember(900, { role: "speed" })] })));
  const withLead = planOf(
    optimizeTeam(
      teamReq(1, { members: [mkTeamMember(900, { role: "speed", leadSpd: 30 })] }),
    ),
  );
  assert.ok(
    withLead.members[0].stats.spd > noLead.members[0].stats.spd,
    "速度隊長技應提高面板速度",
  );
  assert.equal(roleObjective("speed"), "spd");
  assert.equal(roleObjective("dps"), "dps");
  assert.equal(roleObjective("tank"), "tank");
  assert.equal(roleObjective("support"), "support");
});

check("隊型預設涵蓋 3 / 4 / 5 人與角色", () => {
  assert.ok(TEAM_TEMPLATES.length >= 4);
  assert.ok(TEAM_TEMPLATES.every((t) => [3, 4, 5].includes(t.size)));
  assert.ok(TEAM_TEMPLATES.some((t) => t.size === 4));
  assert.ok(TEAM_TEMPLATES.some((t) => t.size === 5));

  const speed = teamTemplateOf("guild-speed");
  const m3 = templateMembers(speed, 3);
  assert.deepEqual(m3.map((m) => m.role), ["speed", "booster", "dps"]);
  // 速隊長＋提條＋主力打手：提條先手 → 主力打手 → 速隊長
  assert.deepEqual(m3.map((m) => m.order ?? 1), [3, 1, 2]);
  assert.ok(templateMembers(teamTemplateOf("arena-4"), 4).every((m) => (m.order ?? 1) === 1));

  const m5 = templateMembers(speed, 5);
  assert.equal(m5.length, 5);
  assert.deepEqual(m5.slice(3).map((m) => m.title), ["自訂 4", "自訂 5"]);
  // 回傳的是複本，修改不應污染原始隊型
  m5[0].sets[0].count = 2;
  assert.equal(templateMembers(speed, 3)[0].sets[0].count, 4);
  assert.equal(teamTemplateOf("no-such-id").id, "custom");

  const used = new Set(TEAM_TEMPLATES.flatMap((t) => t.members.map((m) => m.role)));
  for (const role of ["speed", "booster", "dps", "tank", "support"]) {
    assert.ok(used.has(role), `隊型應包含 ${role} 角色`);
  }
  assert.ok(TEAM_ROLE_LABELS.tank.includes("坦克"));
});

check("接速：面板速度與速度強化倍率", () => {
  assert.equal(panelSpeed(111, 100), 211);
  assert.equal(panelSpeed(111, 0), null);
  assert.equal(panelExtraFor(111, 211), 100);
  assert.equal(panelExtraFor(111, 100), 0);
  assert.equal(speedBuffPct(false, 20), 0);
  assert.equal(speedBuffPct(true, 0), 30);
  assert.equal(speedBuffPct(true, 20), 36);
  assert.equal(tickWithBoost(286, 7), 5);
  assert.equal(tickWithBoost(167, 7, 30), 6);
});

check("接速：提條與速度強化會降低最低面板速度", () => {
  assert.equal(followSpeedRequirement({ targetTick: 6, ratePct: 7 }), 239);
  assert.equal(followSpeedRequirement({ targetTick: 6, ratePct: 7, boostPct: 30 }), 167);
  assert.equal(followSpeedRequirement({ targetTick: 6, ratePct: 7, buffPct: 30 }), 184);
  assert.equal(followSpeedRequirement({ targetTick: 6, ratePct: 7, boostPct: 30, buffPct: 30 }), 129);
  assert.equal(followSpeedRequirement({ targetTick: 6, ratePct: 7, boostPct: 30, buffPct: 36 }), 123);
  assert.equal(followSpeedCeiling({ targetTick: 6, ratePct: 7 }), 285);
  assert.equal(followSpeedCeiling({ targetTick: 6, ratePct: 7, boostPct: 30, buffPct: 30 }), 153);
  assert.equal(followSpeedCeiling({ targetTick: 7, ratePct: 7, boostPct: 30, buffPct: 30 }), 128);
  assert.equal(followSpeedCeiling({ targetTick: 1, ratePct: 7 }), Infinity);
});

check("接速：依攻擊順序串接前後 Tick", () => {
  const plan = computeFollowPlan([
    { order: 3, mode: "tick", baseSpd: 111, panelExtra: 0, tick: 6, boostPct: 30, speedBuff: false },
    { order: 1, mode: "tick", baseSpd: 111, panelExtra: 0, tick: 5, boostPct: 0, speedBuff: false },
    { order: 2, mode: "tick", baseSpd: 111, panelExtra: 0, tick: 0, boostPct: 30, speedBuff: true, artifactPct: 0 },
  ], 7);

  // 回傳順序與輸入相同；position 才是攻擊順序
  assert.deepEqual(plan.map((r) => r.position), [2, 0, 1]);

  const booster = plan[1];
  assert.equal(booster.anchorTick, null);
  assert.equal(booster.targetTick, null);
  assert.equal(booster.minSpeed, Infinity);
  assert.equal(booster.maxSpeed, Infinity);
  assert.equal(booster.effectiveTick, 5);

  const dps = plan[2];
  assert.equal(dps.anchorTick, 5);
  assert.equal(dps.targetTick, 6);
  assert.equal(dps.buffPct, 30);
  assert.equal(dps.minSpeed, 129);
  assert.equal(dps.maxSpeed, 153);

  const speedUnit = plan[0];
  assert.equal(speedUnit.anchorTick, 6);
  assert.equal(speedUnit.targetTick, 7);
  assert.equal(speedUnit.minSpeed, 143);
  assert.equal(speedUnit.maxSpeed, 166);
});

check("接速：面板速度、提條與實際出手 Tick", () => {
  const plan = computeFollowPlan([
    { order: 1, baseSpd: 111, panelExtra: 130, tick: 0 }, // 241 → T6
    { order: 2, baseSpd: 111, panelExtra: 32, tick: 0, boostPct: 30 }, // 143 → T7（含提條）
  ], 7);
  assert.equal(plan[0].panelSpd, 241);
  assert.equal(plan[0].panelTick, 6);
  assert.equal(plan[0].targetTick, null);
  assert.equal(plan[0].minSpeed, Infinity);
  assert.equal(plan[0].maxSpeed, Infinity);
  assert.equal(plan[0].effectiveTick, 6);
  assert.equal(plan[1].anchorTick, 6);
  assert.equal(plan[1].targetTick, 7);
  assert.equal(plan[1].panelSpd, 143);
  assert.equal(plan[1].panelTick, 7);
  assert.equal(plan[1].minSpeed, 143);
  assert.equal(plan[1].maxSpeed, 166);
  assert.equal(plan[1].met, true);
});

check("接速：第一隻沒有下限，面板速度與目標 Tick 二選一", () => {
  // 面板模式：即使有目標 Tick 也不採用；第一隻只決定起手 Tick
  const panelFirst = computeFollowPlan([
    { order: 1, mode: "panel", baseSpd: 111, panelExtra: 230, tick: 4 },
    { order: 2, mode: "panel", baseSpd: 111, panelExtra: 0, tick: 6, boostPct: 30, speedBuff: true },
  ], 7);
  assert.equal(panelFirst[0].panelSpd, 341);
  assert.equal(panelFirst[0].targetTick, null);
  assert.equal(panelFirst[0].minSpeed, Infinity);
  assert.equal(panelFirst[0].maxSpeed, Infinity);
  assert.equal(panelFirst[0].effectiveTick, 5);
  assert.equal(panelFirst[1].targetTick, 6);
  assert.equal(panelFirst[1].minSpeed, 129);
  assert.equal(panelFirst[1].maxSpeed, 153);

  // Tick 模式：忽略面板速度，改用目標 Tick
  const tickFirst = computeFollowPlan([
    { order: 1, mode: "tick", baseSpd: 111, panelExtra: 230, tick: 4 },
    { order: 2, mode: "tick", baseSpd: 111, panelExtra: 130, tick: 0 },
  ], 7);
  assert.equal(tickFirst[0].panelSpd, null);
  assert.equal(tickFirst[0].effectiveTick, 4);
  assert.equal(tickFirst[1].targetTick, 5);
  assert.equal(tickFirst[1].panelSpd, null);
  assert.equal(tickFirst[1].effectiveTick, 5);
});

check("接速：速度強化與神器「速度增加效果」", () => {
  const arts = [
    { subs: [{ t: 206, v: 20 }, { t: 206, v: 10 }] },
    { subs: [{ t: 206, v: 15 }] },
  ];
  assert.equal(artifactSpeedBuffPct(arts), 35);
  assert.equal(artifactSpeedBuffPct([]), 0);

  const plan = computeFollowPlan([
    { order: 1, baseSpd: 111, panelExtra: 130, speedBuff: true, artifactPct: 20 },
    { order: 2, baseSpd: 111, panelExtra: 12, speedBuff: true, artifactPct: 20, boostPct: 30 },
  ], 7);
  // 241 × 1.36 = 327.76 → T5
  assert.equal(plan[0].panelTick, 5);
  assert.equal(plan[1].targetTick, 6);
  assert.equal(plan[1].minSpeed, 123); // 166.67 / 1.36
  assert.equal(plan[1].panelSpd, 123);
  assert.equal(plan[1].panelTick, 6);
  assert.equal(plan[1].met, true);
});

check("runeSupply 依位置計算可用符文與鎖定", () => {
  const supply = runeSupply(teamRuneList, [900, 901, 902], [], []);
  assert.equal(supply.length, 6);
  assert.ok(supply.every((s) => s.slot >= 1 && s.slot <= 6));
  assert.ok(supply.every((s) => s.count === 8 && s.need === 3));

  const firstSlot1 = teamRuneList.find((r) => r.slot === 1);
  const locked = runeSupply(teamRuneList, [900, 901, 902], [], [firstSlot1.id]);
  const s1 = locked.find((s) => s.slot === 1);
  assert.equal(s1.count, 7, "鎖定且不屬於隊員的符文應被排除");
});

check("teamSetsOf / scoreTeam 與候選配裝一致", () => {
  const swift = teamRuneList.filter((r) => r.set === 3).slice(0, 4);
  const will = teamRuneList.filter((r) => r.set === 15).slice(0, 2);
  const byId = new Map(teamRuneList.map((r) => [r.id, r]));
  const sets = teamSetsOf([...swift, ...will].map((r) => r.id), byId, [{ set: 3, count: 4 }], false);
  assert.equal(sets[3], 4);
  assert.equal(sets[15], 2);

  const members = [mkTeamMember(900, { role: "speed", weight: 2 })];
  const score = scoreTeam(members, [
    { unitId: 900, runeIds: [], stats: { spd: 250, atk: 0, hp: 0, def: 0, cr: 0, cd: 0, res: 0, acc: 0 } },
  ]);
  assert.equal(score, 500, "scoreTeam = 權重 × 角色目標值");
});

console.log(`\n✅ 全部 ${passed} 項測試通過（配符耗時 ${elapsed} ms）\n`);
