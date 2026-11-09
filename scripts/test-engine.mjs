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
  runeScore, runeScoreRaw, scoreOfStat, runeEfficiency,
  grindMax, grindStoneMax, grindGradeFor, grindCapsFromStock, matchingGrindstones,
  analyzeRune, planScore, planMaterials, planWithStock, maxScoreWithStock,
  defaultBonus, finalizeStats, statsForRunes, buildsOf, ehpWithSkills,
  artifactFlat, artifactMainText, artifactSubText, artifactDamageBonus, artifactKindText, artifactTypeText,
  artifactAdditionalDamage, artifactEligible, runStage2, artifactFocusFit, artifactAutoLabels, artifactSpeedBuffPct,
  rtaStats, rtaView,
  calculateAd, artifactAdEffects, artifactAdResult, addAdEffects,
  deckContext, spdLeaderSkill, spdLeaderApplies,
  tickFor, minSpeedForTick, tickBrackets, calcUnitSpeeds, simulateTickOrder, simulateAdvanced, swiftSetBonus,
  computeFollowPlan, mirrorTimeline, followSpeedAgainstOpponent, opponentAttackBar,
  panelSpeed, panelExtraFor, battleSpeedForPanelExtra, leadBonus, speedBuffPct, tickWithBoost, tickForSpeed, tickAfterBoost,
  optimizeTeam, runeSupply, teamSetsOf, scoreTeam, TEAM_ROLE_LABELS,
  TEAM_TEMPLATES, templateMembers, teamTemplateOf, roleObjective, objectiveOf,
  autoAssignRoles, roleSetup, hasAtbBoost,
  deckSetupFromRunes, normalizeRequiredSets, mergeLibrary,
  analyzeSiege, createSiegeState, createSiegeTowers, siegeScoreIncrement, siegeSecondsToWin,
  formatSiegeDuration, importSiegeJSON, exportSiegeJSON, SIEGE_MAP_VERSION,
  setTowerSwords, otherSiegeGuild, siegeSwordOwner,
  EMPTY_SKILL_FILTER, matchesSkill, buildBestiary, effectGroups,
  EMPTY_LEADER_FILTER, matchesLeader, isLeaderFilterActive,
  analyzeSiegeBattles, recommendSiegeCounters, recommendSiegeDefenses, siegeDefenseVariants,
  normalizeSiegeDataset, mergeSiegeDatasets, siegeSeasonShort, siegeTeamKey, siegeOverlap, siegeWinRate,
} = engine;

/** 技能資料（判斷提條技能用） */
const SKILLS = JSON.parse(await fs.readFile(path.join(ROOT, "public/data/skills.json"), "utf8"));
/** Nosna44 的 SWGT 據點戰紀錄 */
const SIEGE_BATTLES = JSON.parse(await fs.readFile(path.join(ROOT, "public/data/siege-battles-nosna44.json"), "utf8"));

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

check("面板速度不含圖騰 / 隊長 / Buff，戰鬥速度才含", () => {
  const base = { hp: 10000, atk: 1000, def: 1000, spd: 100, cr: 15, cd: 50, res: 15, acc: 0 };
  const bonus = defaultBonus({ towerSpd: 15, leadSpd: 28, buffSpd: 30 });
  const s = finalizeStats(base, emptyAccum(), bonus, false, false);
  assert.equal(s.panelSpd, 100);
  assert.equal(s.spd, 100 + Math.ceil((100 * (15 + 28 + 30)) / 100));
  assert.equal(s.tick, tickOf(s.spd));
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

check("遊戲符文分數：暴擊率與速度同為 30% 上限", () => {
  // 實際案例：吸血 4 號、暴傷 +80%、固有暴擊率 +6%，
  // 副屬性 防禦% 29、速度 15、體力% 20、攻擊% 24（含精煉）→ 遊戲顯示 253 分。
  const rune = {
    id: 1, set: 11, slot: 4, grade: 6, level: 15,
    main: { t: 10, v: 80 },
    prefix: { t: 9, v: 6 },
    subs: [
      { t: 6, v: 20, g: 9, gem: 0 },
      { t: 8, v: 10, g: 5, gem: 0 },
      { t: 2, v: 11, g: 9, gem: 0 },
      { t: 4, v: 14, g: 10, gem: 0 },
    ],
    occupied: 0, ancient: false, locked: false, eff: 0, effMax: 100,
  };
  assert.equal(scoreOfStat(9, 6), 20, "暴擊率 6% 應為 20 分（6★ 上限 30%）");
  assert.equal(scoreOfStat(8, 15), 50, "速度 15 應為 50 分");
  assert.equal(scoreOfStat(10, 7), 20, "暴擊傷害 7% 應為 20 分（6★ 上限 35%）");
  assert.equal(scoreOfStat(2, 8), 20, "體力% 8% 應為 20 分（6★ 上限 40%）");
  assert.ok(Math.abs(scoreOfStat(1, 100) - 1.8666667) < 1e-4, "固定體力 100 應約 1.867 分");
  assert.equal(runeScore(rune), 253, "總分應與遊戲顯示的 253 分一致");
  assert.equal(Math.round(runeScoreRaw(rune)), 253);
});

check("精煉石素材：解析一般 / 無形 / 遠古磨石並合併數量", () => {
  const raw = {
    unit_list: [],
    runes: [{
      rune_id: 1, slot_no: 1, set_id: 1, class: 6, rank: 5, upgrade_curr: 15,
      pri_eff: [3, 160], prefix_eff: [0, 0], sec_eff: [],
    }],
    rune_craft_item_list: [
      { craft_type: 2, craft_type_id: 210805, amount: 4 }, // 一般：set 21 / 速度 / 傳說
      { craft_type: 2, craft_type_id: 210805, amount: 2 }, // 同種合併
      { craft_type: 4, craft_type_id: 990305, amount: 8 }, // 無形：固定攻擊 / 傳說
      { craft_type: 6, craft_type_id: 10214, amount: 5 },  // 遠古：set 1 / 體力% / 英雄 (14 - 10)
      { craft_type: 1, craft_type_id: 210905, amount: 9 }, // 寶石，不列入磨石
    ],
  };
  const p = parseAccountJSON(JSON.stringify(raw), "stones.json");
  assert.equal(p.error, undefined, p.error);
  const list = p.account.grindstones;
  assert.equal(list.length, 3);
  const normal = list.find((g) => !g.ancient && !g.immemorial);
  assert.deepEqual(
    { set: normal.set, stat: normal.stat, grade: normal.grade, amount: normal.amount },
    { set: 21, stat: 8, grade: 5, amount: 6 },
  );
  const immemorial = list.find((g) => g.immemorial);
  assert.deepEqual(
    { set: immemorial.set, stat: immemorial.stat, grade: immemorial.grade, ancient: immemorial.ancient },
    { set: 99, stat: 3, grade: 5, ancient: false },
  );
  const ancient = list.find((g) => g.ancient);
  assert.deepEqual(
    { set: ancient.set, stat: ancient.stat, grade: ancient.grade, amount: ancient.amount },
    { set: 1, stat: 2, grade: 4, amount: 5 },
  );
});

check("持有磨石：只列出真的能精煉到目標分數的符文", () => {
  const rune = {
    id: 777, set: 11, slot: 4, grade: 6, level: 15,
    main: { t: 10, v: 80 },
    prefix: { t: 9, v: 6 },
    subs: [
      { t: 6, v: 20, g: 9, gem: 0 },
      { t: 8, v: 10, g: 5, gem: 0 },
      { t: 2, v: 11, g: 9, gem: 0 },
      { t: 4, v: 14, g: 8, gem: 0 },
    ],
    occupied: 0, ancient: false, locked: false, eff: 0, effMax: 100,
  };
  const target = analyzeRune(rune, "score");
  assert.equal(target.gameScore, 248);
  // 沒有限制素材時，用傳說上限可以補 1% 攻擊到 250。
  assert.ok(planScore(target, 250).length > 0);

  const heroAtk = { set: 11, stat: 4, grade: 4, ancient: false, immemorial: false, amount: 3 };
  const legendAtk = { set: 11, stat: 4, grade: 5, ancient: false, immemorial: false, amount: 2 };
  const immemorialAtk = { set: 99, stat: 4, grade: 5, ancient: false, immemorial: true, amount: 2 };
  assert.equal(planWithStock(target, 250, [heroAtk]).reachable, false, "英雄磨石最大 7，補不到 8 以上");
  assert.equal(planWithStock(target, 250, [legendAtk]).reachable, true, "傳說磨石可以補到 10");
  assert.equal(planWithStock(target, 250, [immemorialAtk]).reachable, true, "無形磨石可用在任何一般套裝");
  assert.equal(maxScoreWithStock(target, [heroAtk]), 248, "英雄磨石無法再提升");
  assert.equal(maxScoreWithStock(target, [legendAtk]), 253, "傳說攻擊% 可把分數推到 253");
  assert.equal(maxScoreWithStock(target, [immemorialAtk]), 253, "無形傳說石同樣可到 253");

  const mats = planMaterials(target.rune, planWithStock(target, 250, [legendAtk]).plan, [legendAtk]);
  assert.equal(mats.ok, true);
  assert.equal(mats.rows[0].stone.grade, 5);

  // 遠古符文只能用遠古磨石；一般磨石不能用。
  const ancientRune = { ...rune, ancient: true };
  assert.equal(matchingGrindstones(ancientRune, 2, 12, [{ ...legendAtk, stat: 2 }]).length, 0);
  const ancientStone = { set: 11, stat: 2, grade: 5, ancient: true, immemorial: false, amount: 1 };
  assert.equal(matchingGrindstones(ancientRune, 2, 12, [ancientStone]).length, 1);
  assert.equal(grindMax(2, false), 10);
  assert.equal(grindMax(2, true), 12);
  assert.equal(grindStoneMax(2, 5, true), 12);
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
check("3×2 件套（祝福 + 刀刃 + 意志）", () => {
  const tri = optimize({
    ...req,
    required: [{ set: 1, count: 2 }, { set: 4, count: 2 }, { set: 15, count: 2 }],
    min: {},
  });
  assert.ok(tri.count > 0, "3×2 件套沒有任何結果");
  for (const b of buildsOf(tri, account.runes, false, 50)) {
    assert.ok((b.sets[1] ?? 0) >= 2, "祝福不足 2 件");
    assert.ok((b.sets[4] ?? 0) >= 2, "刀刃不足 2 件");
    assert.ok((b.sets[15] ?? 0) >= 2, "意志不足 2 件");
    assert.equal(Object.values(b.sets).reduce((s, c) => s + c, 0), 6);
  }
});

/* ── 4c. 3×2 套裝與預設隊回推 ─────────────────── */
console.log("\n[4c] 3×2 套裝與預設隊回推");

const deckBonus = {
  towerSpd: 0, towerAtk: 0, towerHp: 0, towerDef: 0,
  guildAtk: 0, guildHp: 0, guildDef: 0, guildCd: 0,
  leadSpd: 0, buffSpd: 0, useGuild: false, useElementTower: false, grind: true,
};
const deckBase = { hp: 10000, atk: 700, def: 700, spd: 100, cr: 15, cd: 50, res: 15, acc: 0 };

/** 用 SWEX 格式建立測試符文（id, 位置, 套裝, 主屬性 type, 主屬性值） */
const deckRunes = (specs) => {
  const raw = {
    unit_list: [],
    runes: specs.map(([id, slot, set, mainT, mainV]) => ({
      rune_id: id, slot_no: slot, set_id: set, class: 6, rank: 5, upgrade_curr: 15,
      pri_eff: [mainT, mainV], prefix_eff: [0, 0], sec_eff: [],
    })),
    building_list: [],
  };
  const p = parseAccountJSON(JSON.stringify(raw), "deck-setup.json");
  assert.equal(p.error, undefined, p.error);
  return p.account.runes;
};

check("normalizeRequiredSets：重複套裝會合併件數", () => {
  const merged = normalizeRequiredSets([
    { set: 15, count: 2 }, { set: 15, count: 2 }, { set: 16, count: 2 },
    { set: 0, count: 4 }, { set: 3, count: 0 },
  ]).sort((a, b) => a.set - b.set);
  assert.deepEqual(merged, [{ set: 15, count: 4 }, { set: 16, count: 2 }]);
});

check("同一套裝 3×2（意志 ×3）可組成 6 件", () => {
  const runes = deckRunes([1, 2, 3, 4, 5, 6].map((slot, i) => [
    9610 + i, slot, 15, slot === 2 ? 8 : 1, slot === 2 ? 42 : 500,
  ]));
  const res = optimize({
    base: deckBase, runes,
    required: [{ set: 15, count: 2 }, { set: 15, count: 2 }, { set: 15, count: 2 }],
    min: {}, max: {}, bonus: deckBonus,
    pool: 18, allowEquipped: true, targetUnit: 0, rta: false, maxNodes: 100_000,
  });
  assert.ok(res.count > 0, "意志 ×3 沒有任何結果");
  assert.equal(buildsOf(res, runes, false, 1)[0].sets[15], 6, "意志應為 6 件");
});

check("預設隊回推：保護 ×4 + 意志 ×2 → 3×2 套裝", () => {
  const runes = deckRunes([
    [9701, 1, 16, 1, 2448],
    [9702, 2, 16, 8, 42],
    [9703, 3, 16, 1, 2448],
    [9704, 4, 16, 2, 63],
    [9705, 5, 15, 1, 2448],
    [9706, 6, 15, 2, 63],
  ]);
  const stats = statsForRunes(deckBase, runes, deckBonus, false, true);
  const setup = deckSetupFromRunes(runes, stats);
  assert.equal(setup.set4, 0, "保護是 2 件套，不應變成 4 件套");
  assert.deepEqual([setup.set2, setup.set2b, setup.set2c], [16, 16, 15], "應帶入保護、保護、意志");
  assert.deepEqual(setup.mains, { 2: 8, 4: 2, 6: 2 }, "2/4/6 主屬性回推錯誤");
  assert.equal(setup.min.hp, Math.floor(stats.hp), "HP 下限應等於目前實戰 HP");
  assert.equal(setup.min.res, Math.round(stats.res), "抵抗下限應等於目前抗性");
  assert.equal(setup.min.spd, undefined, "速度不應寫進數值下限");
});

check("預設隊回推：4 件套 + 2 件套", () => {
  const runes = deckRunes([
    [9711, 1, 3, 1, 2448],
    [9712, 2, 3, 8, 42],
    [9713, 3, 3, 1, 2448],
    [9714, 4, 3, 2, 63],
    [9715, 5, 15, 1, 2448],
    [9716, 6, 15, 2, 63],
  ]);
  const stats = statsForRunes(deckBase, runes, deckBonus, false, true);
  const setup = deckSetupFromRunes(runes, stats);
  assert.equal(setup.set4, 3, "應回推迅速 4 件套");
  assert.equal(setup.set2, 15, "應回推意志 2 件套");
  assert.equal(setup.set2b, 0);
  assert.equal(setup.set2c, 0);
});

check("預設隊回推：6 件同套裝 → 3×2 同套裝", () => {
  const runes = deckRunes([1, 2, 3, 4, 5, 6].map((slot, i) => [
    9721 + i, slot, 15, slot === 2 ? 8 : 1, slot === 2 ? 42 : 500,
  ]));
  const stats = statsForRunes(deckBase, runes, deckBonus, false, true);
  const setup = deckSetupFromRunes(runes, stats);
  assert.equal(setup.set4, 0);
  assert.deepEqual([setup.set2, setup.set2b, setup.set2c], [15, 15, 15]);
});

check("預設隊回推的下限可以用來重新配符", () => {
  const runes = deckRunes([
    [9731, 1, 16, 1, 2448],
    [9732, 2, 16, 8, 42],
    [9733, 3, 16, 1, 2448],
    [9734, 4, 16, 2, 63],
    [9735, 5, 15, 1, 2448],
    [9736, 6, 15, 2, 63],
  ]);
  const stats = statsForRunes(deckBase, runes, deckBonus, false, true);
  const setup = deckSetupFromRunes(runes, stats);
  const res = optimize({
    base: deckBase, runes,
    required: [
      { set: setup.set2, count: 2 },
      { set: setup.set2b, count: 2 },
      { set: setup.set2c, count: 2 },
    ],
    min: setup.min, max: {}, bonus: deckBonus, mainFilters: setup.mains,
    pool: 18, allowEquipped: true, targetUnit: 0, rta: false, maxNodes: 100_000,
  });
  assert.ok(res.count > 0, "依回推下限重新配符沒有任何結果");
  const b = buildsOf(res, runes, false, 1)[0];
  assert.ok(b.stats.hp >= setup.min.hp, "HP 低於目前");
  assert.ok(b.stats.res >= setup.min.res, "抵抗低於目前");
  assert.equal(b.sets[16], 4);
  assert.equal(b.sets[15], 2);
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

check("topK：先滿足速度下限，再依目標（綜合）排序", () => {
  // 面板額外 40 速；沒有圖騰 / 隊長 / 強化時，戰鬥速度下限就是 100 + 40。
  const minSpd = battleSpeedForPanelExtra(100, 40, 0);
  const res = optimize({
    base: { hp: 12000, atk: 700, def: 600, spd: 100, cr: 15, cd: 50, res: 15, acc: 0 },
    runes: teamRuneList,
    required: [],
    min: { spd: minSpd },
    max: {},
    bonus: teamBonus,
    pool: 7,
    allowEquipped: true,
    targetUnit: 0,
    rta: false,
    maxNodes: 400_000,
    topK: 5,
    objective: "support",
  });
  assert.equal(res.topBuilds.length, 5);
  for (const b of res.topBuilds) {
    assert.ok(b.stats.spd >= minSpd, `速度 ${b.stats.spd} 低於下限 ${minSpd}`);
    assert.ok(b.stats.panelSpd - 100 >= 40, `面板額外速度只有 ${b.stats.panelSpd - 100}`);
  }
  for (let i = 1; i < res.topBuilds.length; i++) {
    assert.ok(
      objectiveOf(res.topBuilds[i - 1].stats, "support") >=
        objectiveOf(res.topBuilds[i].stats, "support"),
      "符合下限後應依綜合目標由高到低排序",
    );
  }
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

check("優先順序：第 1 優先的魔靈拿到個人最佳（字典序）", () => {
  const plan = planOf(
    optimizeTeam(
      teamReq(3, {
        members: [
          mkTeamMember(900, { priority: 1 }),
          mkTeamMember(901, { priority: 2 }),
          mkTeamMember(902, { priority: 3 }),
        ],
      }),
    ),
  );
  assert.equal(plan.members[0].priority, 1);
  assert.ok(plan.members[0].norm > 0.999, `優先 1 應拿到個人最佳，實際 ${plan.members[0].norm}`);
  const ids = plan.members.flatMap((m) => m.runeIds);
  assert.equal(new Set(ids).size, ids.length, "優先順序模式下符文仍不可重複");
});

check("技能傷害目標：分數等於技能傷害，優先 1 會最大化它", () => {
  // Kaito S3 的公式：ATK × (SPD + 192) / 41（同時吃攻擊與速度）
  const skill = {
    id: 999001, n: "測試技能", slot: 3, hits: 1, aoe: false, passive: false,
    cool: 4, max: 5, f: "{ATK}*({SPD} + 192)/41", raw: "", sc: [], up: 0, e: [], d: "",
  };
  const opts = {
    crit: "average", skillUps: true, enemyDef: 0, enemyMaxHp: 0, enemyHpPct: 100,
    enemySpd: 0, selfHpPct: 100, atkBuff: 0, leadAtk: 0, defBreak: false, brand: false,
    ignoreDef: false, aliveEnemies: 1, alliesAlive: 4, useGuild: false, enemyEl: 0,
    useArtifacts: false,
  };
  const plan = planOf(
    optimizeTeam(
      teamReq(3, {
        members: [
          mkTeamMember(900, { priority: 1, objective: "skill", skillObjective: { skill, opts } }),
          mkTeamMember(901),
          mkTeamMember(902),
        ],
      }),
    ),
  );
  const m = plan.members[0];
  assert.equal(m.objective, "skill");
  const dmg = computeSkillDamage(m.stats, skill, opts).total;
  assert.ok(dmg > 0, "技能傷害應大於 0");
  assert.ok(Math.abs(m.score - dmg) < 1e-6, `分數 ${m.score} 應等於技能傷害 ${dmg}`);
  assert.ok(m.norm > 0.999, `優先 1 應拿到技能傷害最佳，實際 ${m.norm}`);
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

check("一鍵配隊：依技能自動判定角色與出手順序", () => {
  // 風忍（唯一速度隊長技）／風武（剩餘）／風格（基礎速度最高且有提條技能）
  const units = [
    { master: 13513, element: 3, baseSpd: 107 },
    { master: 16913, element: 3, baseSpd: 103 },
    { master: 11513, element: 3, baseSpd: 111 },
  ];
  assert.equal(hasAtbBoost(SKILLS, 11513), true, "風格 S3 應判定為提條技能");
  assert.equal(hasAtbBoost(SKILLS, 13513), false, "風忍只有吸收對手攻擊條，不算提條");
  assert.equal(hasAtbBoost(SKILLS, 16913), false);

  const out = autoAssignRoles({ units, slots: ["speed", "booster", "dps"], context: "guild", skillData: SKILLS });
  assert.ok(out);
  assert.equal(out.leadPct, 30, "風忍速度隊長技 30% 應自動帶入");
  assert.equal(out.leaderIndex, 0);
  assert.equal(out.boosterIndex, 2);
  assert.deepEqual(out.assignments.map((a) => a.role), ["speed", "dps", "booster"]);
  // 出手順序：提條 1 → 打手 2 → 速隊長 3
  const byOrder = [...out.assignments].sort((a, b) => a.order - b.order);
  assert.deepEqual(byOrder.map((a) => a.role), ["booster", "dps", "speed"]);
  assert.ok(out.assignments.every((a) => a.leadPct == null), "全員同屬性時都吃得到隊長技");

  // 三坦／自訂隊型維持原設定，不自動改角色
  assert.equal(autoAssignRoles({ units, slots: ["tank", "tank", "tank"], context: "guild", skillData: SKILLS }), null);
});

check("一鍵配隊：角色預設配裝", () => {
  const booster = roleSetup("booster");
  assert.deepEqual(
    [booster.set4, booster.set2, booster.mains[2], booster.mains[4], booster.mains[6]],
    [3, 15, 8, 2, 2],
    "提條＝迅速＋意志、速體體",
  );
  for (const role of ["speed", "dps"]) {
    const s = roleSetup(role);
    assert.deepEqual(
      [s.set4, s.set2, s.mains[2], s.mains[4], s.mains[6], s.min.cr],
      [3, 4, 8, 10, 4, 100],
      `${role}＝迅速＋刀刃、速傷攻、暴率 100%`,
    );
  }
});

check("面板速度下限換算：圖騰 / 隊長 / 強化會另外計入戰鬥速度", () => {
  // 一鍵配隊的「面板速度（額外）」下限：使用者輸入 200 就是要符文多 200 速，
  // 不能讓速度圖騰 / 隊長 / Buff 把不足的符文速度補掉。
  assert.equal(battleSpeedForPanelExtra(100, 200, 0), 300);
  assert.equal(battleSpeedForPanelExtra(100, 200, 15), 315);
  assert.equal(battleSpeedForPanelExtra(60, 200, 15), 269); // 60 × 15% = 9 → 269
  assert.equal(battleSpeedForPanelExtra(111, 230, 45), 391); // 隊長 30 + 圖騰 15
  assert.equal(battleSpeedForPanelExtra(100, 0, 15), 115);
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
  assert.equal(opponentAttackBar({ tick: 6, ratePct: 7, opponentSpeed: 391 }), 164.22);
  // 提條角出手後才吃到提條：391 風格（T4）之後，291 的風武士是 T5 而不是 T4
  assert.equal(tickAfterBoost({ speed: 291, ratePct: 7, boostPct: 30, buffPct: 30, buffStartTick: 4 }), 5);
  // 288 雖然 T5 就滿 100%，但攻擊條仍低於同速鏡像風格（136.85%）→ 會被插隊
  assert.equal(tickAfterBoost({ speed: 288, ratePct: 7, boostPct: 30, buffPct: 30, buffStartTick: 4 }), 5);
  assert.ok(288 * 0.07 * 5.3 + 30 < opponentAttackBar({ tick: 5, ratePct: 7, opponentSpeed: 391 }));
});

check("接速：鏡像對手的攻擊條就是門檻", () => {
  // 風格 391 → T4；提條 30%、速度強化 30%
  assert.equal(followSpeedAgainstOpponent({ targetTick: 5, ratePct: 7, opponentSpeed: 391, boostPct: 30, buffPct: 30, buffStartTick: 4 }), 289);
  assert.equal(followSpeedAgainstOpponent({ targetTick: 6, ratePct: 7, opponentSpeed: 391, boostPct: 30, buffPct: 30, buffStartTick: 4 }), 291);
  // 風格 341 → T5 的情況
  assert.equal(followSpeedAgainstOpponent({ targetTick: 6, ratePct: 7, opponentSpeed: 341, boostPct: 30, buffPct: 30, buffStartTick: 5 }), 257);
  assert.equal(followSpeedAgainstOpponent({ targetTick: 7, ratePct: 7, opponentSpeed: 341, boostPct: 30, buffPct: 30, buffStartTick: 5 }), 258);
  // 沒有提條 / 速度強化：同速度只能打平，門檻就是對手速度
  assert.equal(followSpeedAgainstOpponent({ targetTick: 6, ratePct: 7, opponentSpeed: 341 }), 341);
  // 神器放大 Buff → 門檻下降
  assert.equal(followSpeedAgainstOpponent({ targetTick: 5, ratePct: 7, opponentSpeed: 391, boostPct: 30, buffPct: 36, buffStartTick: 4 }), 285);
});

check("接速：起手沒有下限，之後每隻都要贏過鏡像對手", () => {
  const plan = computeFollowPlan([
    { order: 1, baseSpd: 111, panelExtra: 280 }, // 391 → T4
    { order: 2, baseSpd: 103, panelExtra: 188, boostPct: 30, speedBuff: true }, // 291
    { order: 3, baseSpd: 107, panelExtra: 184, boostPct: 30, speedBuff: true }, // 291
  ], 7);

  assert.equal(plan[0].position, 0);
  assert.equal(plan[0].panelTick, 4);
  assert.equal(plan[0].targetTick, null);
  assert.equal(plan[0].minSpeed, Infinity);
  assert.equal(plan[0].met, null);

  assert.equal(plan[1].anchorTick, 4);
  assert.equal(plan[1].targetTick, 5);
  assert.equal(plan[1].opponentSpeed, 391);
  assert.equal(Math.round(plan[1].opponentAb * 100) / 100, 136.85);
  assert.equal(plan[1].minSpeed, 289);
  assert.equal(Math.round(plan[1].myAb * 10) / 10, 138);
  assert.equal(plan[1].met, true);
  assert.equal(plan[1].panelTick, 5);

  assert.equal(plan[2].anchorTick, 5);
  assert.equal(plan[2].targetTick, 6);
  assert.equal(plan[2].opponentAb.toFixed(2), "164.22");
  assert.equal(plan[2].minSpeed, 291);
  assert.equal(plan[2].myAb.toFixed(3), "164.442");
  assert.equal(plan[2].met, true);
  // 兩隻都夠快，第一時間都是 T5；實際誰先出手由攻擊條 / 順序決定（見鏡像順序測試）
  assert.equal(plan[2].panelTick, 5);
  assert.equal(plan[2].effectiveTick, 5);
});

check("接速：速度隊長技以基礎速度計算，每隻可個別覆寫", () => {
  assert.equal(leadBonus(111, 0), 0);
  assert.equal(leadBonus(111, 30), 34); // 33.3 → 34
  assert.equal(leadBonus(103, 30), 31);
  assert.equal(leadBonus(107, 30), 33); // 32.1 → 33
  assert.equal(panelSpeed(111, 230, 30), 375);
  assert.equal(panelExtraFor(111, 375, 30), 230);
  assert.equal(panelExtraFor(103, 289, 30), 155);

  const plan = computeFollowPlan([
    { order: 1, baseSpd: 111, panelExtra: 246, leadPct: 30 }, // 111 + 34 + 246 = 391 → T4
    { order: 2, baseSpd: 103, panelExtra: 155, leadPct: 30, boostPct: 30, speedBuff: true }, // 289
    { order: 3, baseSpd: 107, panelExtra: 184, leadPct: 0, boostPct: 30, speedBuff: true }, // 291（這隻不吃隊長技）
  ], 7);

  assert.equal(plan[0].leadPct, 30);
  assert.equal(plan[0].leadFlat, 34);
  assert.equal(plan[0].panelSpd, 391);
  assert.equal(plan[0].panelTick, 4);

  assert.equal(plan[1].leadFlat, 31);
  assert.equal(plan[1].panelSpd, 289);
  assert.equal(plan[1].minSpeed, 289);
  assert.equal(plan[1].met, true);
  assert.equal(plan[1].panelTick, 5);

  assert.equal(plan[2].leadPct, 0);
  assert.equal(plan[2].leadFlat, 0);
  assert.equal(plan[2].panelSpd, 291);
  assert.equal(plan[2].minSpeed, 291);
  assert.equal(plan[2].met, true);
});

check("接速：目標 Tick 依攻擊順序串接，不是用最早滿 100% 的 Tick", () => {
  // 風格 341 → T5；兩隻 291 都「最早」在 T5 滿 100%，但實際要接 T6、T7
  const plan = computeFollowPlan([
    { order: 1, baseSpd: 111, panelExtra: 230 },
    { order: 2, baseSpd: 103, panelExtra: 188, boostPct: 30, speedBuff: true },
    { order: 3, baseSpd: 107, panelExtra: 184, boostPct: 30, speedBuff: true },
  ], 7);
  assert.equal(plan[0].panelTick, 5);
  assert.equal(plan[1].targetTick, 6);
  assert.equal(plan[1].panelTick, 5);
  assert.equal(plan[2].targetTick, 7);
  assert.equal(plan[1].minSpeed, 257);
  assert.equal(plan[2].minSpeed, 258);
  assert.equal(plan[1].met, true);
  assert.equal(plan[2].met, true);

  const steps = mirrorTimeline(plan, 7, 10);
  assert.deepEqual(steps.slice(0, 4).map((s) => [s.tick, s.team, s.index]), [
    [5, "ally", 0],
    [6, "ally", 1],
    [7, "ally", 2],
    [8, "opponent", 0],
  ]);
});

check("接速：面板速度、提條與實際出手 Tick", () => {
  const plan = computeFollowPlan([
    { order: 1, baseSpd: 111, panelExtra: 130, tick: 0 }, // 241 → T6
    { order: 2, baseSpd: 111, panelExtra: 60, tick: 0, boostPct: 30, speedBuff: true, artifactPct: 20 }, // 171
  ], 7);
  assert.equal(plan[0].panelSpd, 241);
  assert.equal(plan[0].panelTick, 6);
  assert.equal(plan[0].targetTick, null);
  assert.equal(plan[0].minSpeed, Infinity);
  assert.equal(plan[0].effectiveTick, 6);
  assert.equal(plan[1].anchorTick, 6);
  assert.equal(plan[1].targetTick, 7);
  assert.equal(plan[1].panelSpd, 171);
  assert.equal(plan[1].opponentAb.toFixed(2), "118.09");
  assert.equal(plan[1].minSpeed, 171);
  assert.equal(plan[1].panelTick, 7);
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
  assert.equal(panelFirst[0].effectiveTick, 5);
  assert.equal(panelFirst[1].targetTick, 6);
  assert.equal(panelFirst[1].opponentSpeed, 341);
  assert.equal(panelFirst[1].minSpeed, 257);
  assert.equal(panelFirst[1].panelSpd, null);
  assert.equal(panelFirst[1].myAb, null);
  assert.equal(panelFirst[1].met, null);

  // Tick 模式：忽略面板速度，改用目標 Tick；鏡像對手速度可另外指定
  const tickFirst = computeFollowPlan([
    { order: 1, mode: "tick", baseSpd: 111, panelExtra: 230, tick: 4 },
    { order: 2, mode: "tick", baseSpd: 111, panelExtra: 130, tick: 0 },
  ], 7, { opponentSpeed: 300 });
  assert.equal(tickFirst[0].panelSpd, null);
  assert.equal(tickFirst[0].effectiveTick, 4);
  assert.equal(tickFirst[1].targetTick, 5);
  assert.equal(tickFirst[1].opponentSpeed, 300);
  assert.equal(tickFirst[1].minSpeed, 300);
  assert.equal(tickFirst[1].panelSpd, null);
  assert.equal(tickFirst[1].effectiveTick, 5);
});

check("接速：鏡像出手順序，對手插不進來", () => {
  const plan = computeFollowPlan([
    { order: 1, baseSpd: 111, panelExtra: 280 },
    { order: 2, baseSpd: 103, panelExtra: 188, boostPct: 30, speedBuff: true },
    { order: 3, baseSpd: 107, panelExtra: 184, boostPct: 30, speedBuff: true },
  ], 7);
  const steps = mirrorTimeline(plan, 7, 8);
  assert.deepEqual(steps.slice(0, 4).map((s) => [s.tick, s.team, s.index]), [
    [4, "ally", 0],
    [5, "ally", 1],
    [6, "ally", 2],
    [7, "opponent", 0],
  ]);

  // 不夠快：對手風格 T5 就會插隊
  const slow = computeFollowPlan([
    { order: 1, baseSpd: 111, panelExtra: 280 },
    { order: 2, baseSpd: 103, panelExtra: 155, boostPct: 30, speedBuff: true }, // 258
    { order: 3, baseSpd: 107, panelExtra: 151, boostPct: 30, speedBuff: true }, // 258
  ], 7);
  const slowSteps = mirrorTimeline(slow, 7, 6);
  const firstOpp = slowSteps.find((s) => s.team === "opponent");
  assert.deepEqual([firstOpp.tick, firstOpp.team, firstOpp.index], [5, "opponent", 0]);
  assert.equal(slow[1].met, false);
});

check("接速：速度強化與神器「速度增加效果」", () => {
  const arts = [
    { subs: [{ t: 206, v: 20 }, { t: 206, v: 10 }] },
    { subs: [{ t: 206, v: 15 }] },
  ];
  assert.equal(artifactSpeedBuffPct(arts), 35);
  assert.equal(artifactSpeedBuffPct([]), 0);

  const plan = computeFollowPlan([
    { order: 1, baseSpd: 111, panelExtra: 280, speedBuff: true, artifactPct: 20 }, // 391 → T4（起手不吃自己的 Buff）
    { order: 2, baseSpd: 107, panelExtra: 184, speedBuff: true, artifactPct: 20, boostPct: 30 }, // 291
  ], 7);
  assert.equal(plan[0].panelTick, 4);
  assert.equal(plan[0].buffPct, 0, "起手不會吃到自己的速度強化");
  assert.equal(plan[1].targetTick, 5);
  assert.equal(plan[1].buffPct, 36);
  assert.equal(plan[1].minSpeed, 285);
  assert.equal(plan[1].panelSpd, 291);
  assert.equal(plan[1].panelTick, 5);
  assert.equal(plan[1].met, true);
});

check("接速：鏡像模擬與 Tick 模擬一致（同速防守風格）", () => {
  const rate = 7;
  const mods = [];
  for (let tick = 5; tick <= 14; tick++) {
    mods.push({ id: `k-${tick}`, unitId: "kaito", tick, pct: 30 });
    mods.push({ id: `o-${tick}`, unitId: "orochi", tick, pct: 30 });
  }
  const units = [
    { id: "bernard", name: "BernardA", team: "blue", priority: 1, spd: 391 },
    { id: "kaito", name: "KaitoA", team: "blue", priority: 2, spd: 291 },
    { id: "orochi", name: "OrochiA", team: "blue", priority: 3, spd: 291 },
    { id: "dbernard", name: "BernardD", team: "red", priority: 1, spd: 391 },
    { id: "dkaito", name: "KaitoD", team: "red", priority: 2, spd: 291 },
    { id: "dorochi", name: "OrochiD", team: "red", priority: 3, spd: 291 },
  ];
  const sim = simulateAdvanced(
    units,
    rate,
    {
      boosts: [
        { id: "kb", unitId: "kaito", tick: 5, pct: 30 },
        { id: "ob", unitId: "orochi", tick: 5, pct: 30 },
      ],
      mods,
    },
    4,
    10,
  );
  // 同速時進攻方先動；之後風武士、風忍都在防守風格之前出手
  assert.deepEqual(sim.events.map((e) => [e.name, e.tick]), [
    ["BernardA", 4],
    ["KaitoA", 5],
    ["OrochiA", 6],
    ["BernardD", 7],
  ]);
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

/* ── 14. 儲存庫跨裝置合併 ─────────────────────── */
console.log("\n[14] 儲存庫跨裝置合併");
const libItem = (id, name, updatedAt) => ({ id, name, createdAt: 100, updatedAt });

check("同一 id：雲端較新會覆蓋本機（修改跨裝置同步）", () => {
  const local = [libItem("dk_1", "舊名稱", 100)];
  const remote = [libItem("dk_1", "手機改的新名稱", 200)];
  const r = mergeLibrary(local, remote, 150);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].name, "手機改的新名稱");
  assert.equal(r.changed, true);
  assert.equal(r.push, false, "雲端已是最新，不需要再上傳");
});

check("同一 id：本機較新會保留並上傳", () => {
  const local = [libItem("dk_1", "電腦剛改的", 300)];
  const remote = [libItem("dk_1", "雲端舊的", 200)];
  const r = mergeLibrary(local, remote, 150);
  assert.equal(r.items[0].name, "電腦剛改的");
  assert.equal(r.changed, false);
  assert.equal(r.push, true);
});

check("雲端獨有的項目會補進本機", () => {
  const r = mergeLibrary([], [libItem("dk_2", "手機新增", 200)], 150);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].id, "dk_2");
  assert.equal(r.changed, true);
  assert.equal(r.push, false);
});

check("上次同步後才新增的本機項目會保留並上傳", () => {
  const r = mergeLibrary([libItem("dk_3", "電腦新增", 300)], [], 200);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].id, "dk_3");
  assert.equal(r.push, true);
});

check("上次同步前就存在、雲端已刪除的本機項目會移除", () => {
  const r = mergeLibrary([libItem("dk_4", "手機已刪除", 100)], [], 200);
  assert.equal(r.items.length, 0, "不應把別台刪除的項目復活");
  assert.equal(r.changed, true);
  assert.equal(r.push, false);
});

check("第一次同步（沒有同步紀錄）保留全部本機資料", () => {
  const r = mergeLibrary([libItem("dk_5", "本機舊資料", 100)], [], 0);
  assert.equal(r.items.length, 1);
  assert.equal(r.push, true);
});

check("修改時間相同時保留本機，並回寫一次讓兩邊一致", () => {
  const r = mergeLibrary([libItem("dk_6", "本機", 200)], [libItem("dk_6", "雲端", 200)], 150);
  assert.equal(r.items[0].name, "本機");
  assert.equal(r.push, true);
});

/* ── 15. 據點戰錦標賽模擬器 ─────────────────────── */
console.log("\n[15] 據點戰錦標賽模擬器");

check("預設地圖：藍紅各 13 座、各 12 座連線、24 分/分", () => {
  const state = createSiegeState();
  const a = analyzeSiege(state.towers, state.stats);
  assert.equal(a.Blue.total, 13);
  assert.equal(a.Blue.towerTotal, 12);
  assert.equal(a.Blue.connectedTowers, 12);
  assert.equal(a.Blue.increment, 24);
  assert.equal(a.Red.connectedTowers, 12);
  assert.equal(a.Red.increment, 24);
  assert.equal(Object.keys(a.connected).length, 26);
});

check("換色後只保留同色連線路徑", () => {
  const towers = createSiegeTowers();
  towers.find((t) => t.id === 11).color = "Red";
  const a = analyzeSiege(towers);
  assert.equal(a.Blue.connectedTowers, 11, "11 被切掉後藍隊只剩 11 座");
  assert.equal(a.Blue.increment, 22);
  assert.equal(a.Red.connectedTowers, 12, "紅隊本營在另一半，不受影響");
  assert.equal(a.Red.increment, 24);
  assert.equal(a.connected[10], true, "10 還是從藍隊本營連得到");
  assert.equal(a.connected[8], true);
  assert.notEqual(a.connected[11], true, "11 雖然是紅隊，但連不到紅隊本營");

  const towers2 = createSiegeTowers();
  towers2.find((t) => t.id === 37).color = "Blue";
  const b = analyzeSiege(towers2);
  assert.equal(b.Red.connectedTowers, 11, "37 被切掉後紅隊只剩 11 座");
  assert.equal(b.Red.increment, 22);
  assert.equal(b.Blue.connectedTowers, 12, "藍隊本營在另一半，不受影響");
  assert.notEqual(b.connected[37], true, "37 連不到紅隊本營");
});

check("得分公式：13 座 +20、特殊塔每座 +10%", () => {
  assert.equal(siegeScoreIncrement(12), 24);
  assert.equal(siegeScoreIncrement(13), 46);
  assert.equal(siegeScoreIncrement(10, 2), 24);
  assert.equal(siegeScoreIncrement(0), 0);
});

check("勝利時間：20,000 分、∞ 與格式", () => {
  assert.equal(siegeSecondsToWin(0, 24), 50000);
  assert.equal(siegeSecondsToWin(20000, 24), Infinity);
  assert.equal(siegeSecondsToWin(0, 0), Infinity);
  assert.equal(formatSiegeDuration(50000), "13h 53m 20s");
  assert.equal(formatSiegeDuration(Infinity), "∞");
  assert.equal(formatSiegeDuration(900001), "∞");
});

check("匯出後可再匯入，並相容 SWGT 陣列格式", () => {
  const state = createSiegeState();
  state.stats.guildMatchScore = 12345;
  const t11 = state.towers.find((t) => t.id === 11);
  t11.color = "Red";
  t11.pingNumber = 3;
  t11.memo = '"主力"';
  const text = exportSiegeJSON(state);
  const parsed = JSON.parse(text);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed[0].source, "siegeTournamentSimulator");
  assert.equal(parsed[0].map_version, SIEGE_MAP_VERSION);

  const r = importSiegeJSON(text);
  assert.equal(r.ok, true);
  assert.equal(r.state.stats.guildMatchScore, 12345);
  const back = r.state.towers.find((t) => t.id === 11);
  assert.equal(back.color, "Red");
  assert.equal(back.pingNumber, 3);
  assert.equal(back.memo, "主力", "匯入時會移除雙引號");
});

check("舊版或缺少欄位的存檔會套用目前地圖並夾住數值", () => {
  const r = importSiegeJSON(JSON.stringify([{
    map_version: "2020-01-01",
    siege_map_data: [
      { id: 0, color: "Red" },
      { id: 1, color: "Blue", hpPercentage: 999, pingNumber: 9, memo: "x".repeat(200) },
    ],
    siegeMapStatsData: { guildMatchScore: 99999, oppGuild1MatchScore: -5 },
  }]));
  assert.equal(r.ok, true);
  assert.ok(r.warning.includes("2020-01-01"));
  assert.equal(r.state.towers.length, 26);
  const t1 = r.state.towers.find((t) => t.id === 1);
  assert.equal(t1.hpPercentage, 100);
  assert.equal(t1.pingNumber, 5);
  assert.equal(t1.memo.length, 100);
  assert.equal(r.state.stats.guildMatchScore, 20000);
  assert.equal(r.state.stats.oppGuild1MatchScore, 0);
  assert.equal(r.state.towers.find((t) => t.id === 0).color, "Red");
});

check("無效的 JSON 會回報錯誤", () => {
  assert.equal(importSiegeJSON("{").ok, false);
  assert.equal(importSiegeJSON(JSON.stringify({ foo: 1 })).ok, false);
});

check("劍數：0–4 記錄進度，5 自動爆塔", () => {
  const t4 = createSiegeTowers().find((t) => t.id === 4);
  assert.equal(t4.swords, 0);
  assert.equal(otherSiegeGuild("Blue"), "Red");
  assert.equal(siegeSwordOwner(t4), "Red");

  const progress = setTowerSwords(t4, 3);
  assert.equal(progress.swords, 3);
  assert.equal(progress.color, "Blue");
  assert.equal(progress.hpPercentage, 100);

  const captured = setTowerSwords(t4, 5);
  assert.equal(captured.swords, 0);
  assert.equal(captured.color, "Red", "5 劍會變成進攻方顏色");
  assert.equal(captured.hpPercentage, 100);
  assert.equal(captured.pingNumber, 0);
  assert.equal(captured.prohibit, false);

  const clamped = setTowerSwords(t4, 99);
  assert.equal(clamped.color, "Red", "超過 5 也視為爆塔");
  assert.equal(clamped.swords, 0);
  assert.equal(setTowerSwords(t4, -3).swords, 0);
});

check("匯出／匯入會保留劍數；5 劍存檔會直接爆塔", () => {
  const state = createSiegeState();
  state.towers.find((t) => t.id === 38).swords = 4;
  const text = exportSiegeJSON(state);
  const back = importSiegeJSON(text);
  assert.equal(back.ok, true);
  assert.equal(back.state.towers.find((t) => t.id === 38).swords, 4);

  const captured = importSiegeJSON(JSON.stringify([{
    siege_map_data: [{ id: 0, color: "Blue", swords: 5 }],
    siegeMapStatsData: {},
  }]));
  assert.equal(captured.ok, true);
  const hq = captured.state.towers.find((t) => t.id === 0);
  assert.equal(hq.color, "Red");
  assert.equal(hq.swords, 0);
  assert.equal(hq.hpPercentage, 0, "本營沒有 HP 條");

  const old = importSiegeJSON(JSON.stringify([{ siege_map_data: [{ id: 1, color: "Blue" }] }]));
  assert.equal(old.state.towers.find((t) => t.id === 1).swords, 0, "舊存檔沒有 swords 時預設 0");
});

check("圖鑑：技能條件（位置 / 效果 / 段數 / 冷卻）", () => {
  const skill = {
    id: 1,
    n: "Test Skill",
    slot: 2,
    hits: 2,
    aoe: true,
    passive: false,
    cool: 3,
    max: 5,
    f: "1.0*{ATK}",
    raw: "[]",
    sc: ["ATK"],
    up: 0,
    e: [28, 20],
    d: "Attacks all enemies and decreases their Defense.",
  };
  assert.equal(matchesSkill(skill, EMPTY_SKILL_FILTER), true);
  assert.equal(matchesSkill(skill, { ...EMPTY_SKILL_FILTER, q: "decreases" }), true);
  assert.equal(matchesSkill(skill, { ...EMPTY_SKILL_FILTER, q: "heal" }), false);
  assert.equal(matchesSkill(skill, { ...EMPTY_SKILL_FILTER, slot: 1 }), false);
  assert.equal(matchesSkill(skill, { ...EMPTY_SKILL_FILTER, slot: 2 }), true);
  assert.equal(matchesSkill(skill, { ...EMPTY_SKILL_FILTER, kind: "passive" }), false);
  assert.equal(matchesSkill(skill, { ...EMPTY_SKILL_FILTER, aoe: "yes" }), true);
  assert.equal(matchesSkill(skill, { ...EMPTY_SKILL_FILTER, aoe: "no" }), false);
  assert.equal(matchesSkill(skill, { ...EMPTY_SKILL_FILTER, effects: [28], effectMode: "any" }), true);
  assert.equal(matchesSkill(skill, { ...EMPTY_SKILL_FILTER, effects: [28, 35], effectMode: "all" }), false);
  assert.equal(matchesSkill(skill, { ...EMPTY_SKILL_FILTER, effects: [28, 20], effectMode: "all" }), true);
  assert.equal(matchesSkill(skill, { ...EMPTY_SKILL_FILTER, minHits: 3 }), false);
  assert.equal(matchesSkill(skill, { ...EMPTY_SKILL_FILTER, maxCool: 2 }), false);
  assert.equal(matchesSkill(skill, { ...EMPTY_SKILL_FILTER, maxCool: 3 }), true);
  assert.equal(matchesSkill(skill, { ...EMPTY_SKILL_FILTER, scale: "DEF" }), false);
});

check("圖鑑：全魔靈索引與技能效果分組", () => {
  const lushen = MONSTERS.find((m) => m.name === "Lushen");
  assert.ok(lushen, "應找到 Lushen");
  const all = buildBestiary(SKILLS, MONSTERS);
  assert.equal(all.length, MONSTERS.length);
  const lushenEntry = all.find((e) => e.monster.id === lushen.id);
  assert.ok(lushenEntry && lushenEntry.skills.length >= 3);

  const stun = all.filter((e) =>
    e.skills.some((s) => matchesSkill(s, { ...EMPTY_SKILL_FILTER, effects: [28] })),
  );
  assert.ok(stun.length > 300, `Stun 魔靈數量應大於 300，實際 ${stun.length}`);

  const groups = effectGroups(SKILLS, MONSTERS);
  assert.ok(groups.some((g) => g.type === "Buff"));
  assert.ok(groups.some((g) => g.type === "Debuff"));
  const stunOption = groups.flatMap((g) => g.items).find((i) => i.name === "Stun");
  assert.ok(stunOption && stunOption.count > 300);
});

check("圖鑑：隊長技篩選（類型 / 範圍 / 屬性 / 數值）", () => {
  const lead = { id: 167, attr: "Attack Speed", amount: 33, area: "Arena", element: null };
  assert.equal(matchesLeader(lead, EMPTY_LEADER_FILTER), true);
  assert.equal(matchesLeader(null, EMPTY_LEADER_FILTER), true);
  assert.equal(matchesLeader(null, { ...EMPTY_LEADER_FILTER, only: true }), false);
  assert.equal(matchesLeader(lead, { ...EMPTY_LEADER_FILTER, only: true }), true);
  assert.equal(matchesLeader(lead, { ...EMPTY_LEADER_FILTER, attr: "Attack Speed" }), true);
  assert.equal(matchesLeader(lead, { ...EMPTY_LEADER_FILTER, attr: "HP" }), false);
  assert.equal(matchesLeader(lead, { ...EMPTY_LEADER_FILTER, area: "Arena" }), true);
  assert.equal(matchesLeader(lead, { ...EMPTY_LEADER_FILTER, area: "Guild" }), false);
  assert.equal(matchesLeader(lead, { ...EMPTY_LEADER_FILTER, element: -1 }), true);
  assert.equal(matchesLeader(lead, { ...EMPTY_LEADER_FILTER, element: 1 }), false);
  const fireLead = { ...lead, element: 2 };
  assert.equal(matchesLeader(fireLead, { ...EMPTY_LEADER_FILTER, element: 2 }), true);
  assert.equal(matchesLeader(fireLead, { ...EMPTY_LEADER_FILTER, element: -1 }), false);
  assert.equal(matchesLeader(fireLead, { ...EMPTY_LEADER_FILTER, minAmount: 34 }), false);
  assert.equal(matchesLeader(fireLead, { ...EMPTY_LEADER_FILTER, minAmount: 33 }), true);
  assert.equal(isLeaderFilterActive(EMPTY_LEADER_FILTER), false);
  assert.equal(isLeaderFilterActive({ ...EMPTY_LEADER_FILTER, only: true }), true);
});

check("圖鑑：隊長技資料（Lushen / 競技場速度隊長）", () => {
  const lushen = MONSTERS.find((m) => m.name === "Lushen");
  assert.ok(lushen?.lead, "Lushen 應有隊長技");
  assert.equal(lushen.lead.attr, "Attack Power");
  assert.equal(lushen.lead.amount, 33);
  assert.equal(lushen.lead.area, "Dungeon");

  const speedArena = MONSTERS.filter((m) =>
    matchesLeader(m.lead, { ...EMPTY_LEADER_FILTER, attr: "Attack Speed", area: "Arena" }),
  );
  assert.ok(speedArena.length > 10, `競技場速度隊長應超過 10 隻，實際 ${speedArena.length}`);
});

check("據點進攻：Nosna44 近 10 季 2324 場、2264 勝、勝率 97.4%", () => {
  const data = normalizeSiegeDataset(SIEGE_BATTLES);
  const analysis = analyzeSiegeBattles(data);
  assert.equal(data.battles.length, 2324);
  assert.equal(analysis.overall.wins, 2264);
  assert.equal(analysis.overall.losses, 60);
  assert.equal(analysis.overall.wr, 97.4);
  assert.equal(analysis.counterTeams.length, 418);
  assert.equal(analysis.defenseTeams.length, 979);
  assert.equal(analysis.losses.length, 60);
  assert.equal(analysis.seasons.length, 10);
  assert.equal(analysis.seasons[0].season, "S13");
  assert.equal(analysis.seasons[9].season, "S22");
});

check("據點進攻：推薦進攻隊（Sylvia / Daphnis / Wind Qilin Slasher）", () => {
  const data = normalizeSiegeDataset(SIEGE_BATTLES);
  const analysis = analyzeSiegeBattles(data);
  const key = siegeTeamKey([20115, 21112, 32913]);
  const advice = recommendSiegeCounters(data, analysis, key);
  assert.ok(advice.defense, "應找到防守隊");
  assert.equal(advice.defense.battles, 16);
  assert.equal(advice.defense.wins, 15);
  assert.equal(advice.exactPairs.length, 4);
  const top = advice.recommendations[0];
  assert.ok(top, "應有推薦進攻隊");
  const names = top.team.map((id) => data.monsters[String(id)]?.name).sort().join(" / ");
  assert.equal(names, "Bellenus / Eladriel / Moogwang");
  assert.equal(top.battles, 8);
  assert.equal(top.wins, 8);
  assert.equal(top.wr, 100);
  assert.equal(top.source, "exact");
});

check("據點防守：Eshir + Fiona 為十季最強核心", () => {
  const data = normalizeSiegeDataset(SIEGE_BATTLES);
  const analysis = analyzeSiegeBattles(data);
  const advice = recommendSiegeDefenses(analysis);
  assert.equal(advice.losingBattles.length, 60);
  const top = advice.corePairs[0];
  assert.deepEqual([...top.ids].sort((a, b) => a - b), [14034, 29715]);
  assert.equal(top.battles, 119);
  assert.equal(top.losses, 4);
  assert.equal(top.wr, 96.6);

  const variants = siegeDefenseVariants(data, top.ids);
  const vritra = variants.find((v) => v.monsterId === 28515);
  assert.ok(vritra);
  assert.equal(vritra.battles, 34);
  assert.equal(vritra.wins, 31);
  const emily = variants.find((v) => v.monsterId !== 28515 && v.wr === 91.7);
  assert.ok(emily);
  assert.equal(emily.battles, 12);
});

check("據點進攻：無效資料會回報錯誤", () => {
  assert.throws(() => normalizeSiegeDataset({ battles: [] }), /找不到對戰紀錄/);
  assert.equal(siegeOverlap([1, 2, 3], [2, 3, 4]), 2);
  assert.equal(siegeWinRate(224, 227), 98.7);
});

check("據點進攻：十季賽季統計與賽季標記", () => {
  const data = normalizeSiegeDataset(SIEGE_BATTLES);
  const analysis = analyzeSiegeBattles(data);
  assert.equal(analysis.seasons.length, 10);
  const s20 = analysis.seasons.find((s) => s.season === "S20");
  const s18 = analysis.seasons.find((s) => s.season === "S18");
  assert.ok(s20 && s18);
  assert.equal(s20.battles, 227);
  assert.equal(s20.wr, 99.6);
  assert.equal(s18.wr, 95.2);
  assert.equal(siegeSeasonShort("Season 22 - Complete"), "S22");
  assert.equal(data.battles[0].season, "S22");
  assert.equal(data.seasons?.length, 10);
});

check("據點進攻：合併新賽季資料（battleId 去重）", () => {
  const base = normalizeSiegeDataset(SIEGE_BATTLES);
  const sample = { ...base.battles[0], battleId: 999999999, season: "S23", seasonName: "Season 23 - Complete" };
  const incoming = normalizeSiegeDataset({
    ...base,
    season: "Season 23 - Complete",
    seasons: ["S23"],
    battles: [sample],
    collectedAt: new Date().toISOString(),
  });
  const merged = mergeSiegeDatasets(base, incoming);
  assert.equal(merged.battles.length, base.battles.length + 1);
  assert.ok(merged.seasons?.includes("S23"));
  assert.equal(merged.season, "Season 13 – Season 23");
  assert.equal(merged.battles.find((b) => b.battleId === 999999999)?.season, "S23");
});

console.log(`\n✅ 全部 ${passed} 項測試通過（配符耗時 ${elapsed} ms）\n`);
