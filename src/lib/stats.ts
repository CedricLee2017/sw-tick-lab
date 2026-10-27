/** 數值計算：魔靈基礎值、符文加成、套裝、建築、Tick */
import {
  BUILDINGS,
  STAT_TYPES,
  SET_BY_ID,
  STAR_MAX,
  STAR_LEVEL_CAP,
  SUB_STAT_MAX,
  type StatKey,
} from "./constants";
import type { Artifact, BonusConfig, Monster, Rune, Stats, Unit } from "./types";
import { ARTIFACT_MAIN } from "./artifacts";

const MAX_STAT_NAME: Record<number, string> = {
  1: "HP flat",
  2: "HP%",
  3: "ATK flat",
  4: "ATK%",
  5: "DEF flat",
  6: "DEF%",
  8: "SPD",
  9: "CRate",
  10: "CDmg",
  11: "RES",
  12: "ACC",
};

export interface BaseStats {
  hp: number;
  atk: number;
  def: number;
  spd: number;
  cr: number;
  cd: number;
  res: number;
  acc: number;
}

/** 依星級 / 等級換算滿等數值 */
export function baseStats(m: Monster, stars = 6, level = 40): BaseStats {
  const s = Math.min(6, Math.max(1, Math.round(stars || 6)));
  const cap = STAR_LEVEL_CAP[s - 1];
  const lvl = Math.min(cap, Math.max(1, Math.round(level || cap)));
  const mult = 1 + ((STAR_MAX[s - 1] - 1) * (lvl - 1)) / (cap - 1);
  const f = mult / STAR_MAX[5];
  return {
    hp: Math.round(m.hp * f),
    atk: Math.round(m.atk * f),
    def: Math.round(m.def * f),
    spd: m.spd,
    cr: m.cr,
    cd: m.cd,
    res: m.res,
    acc: m.acc,
  };
}

/** 符文效率（0~100+，以該星級每條副屬最大值為基準） */
export function runeEfficiency(rune: Rune, includeGrind = false): { current: number; max: number } {
  const g = `g${Math.min(6, Math.max(1, rune.grade || 6))}`;
  let cur = 0;
  let max = 0;
  const add = (t: number, v: number) => {
    const name = MAX_STAT_NAME[t];
    if (!name || !SUB_STAT_MAX[name]) return;
    cur += v;
    max += SUB_STAT_MAX[name][g];
  };
  for (const s of rune.subs) add(s.t, s.v + (includeGrind ? s.g : 0));
  if (rune.prefix?.t) add(rune.prefix.t, rune.prefix.v);
  return { current: max > 0 ? (cur / max) * 100 : 0, max: 100 };
}

export interface StatAccum {
  flatHp: number;
  flatAtk: number;
  flatDef: number;
  flatSpd: number;
  flatCr: number;
  flatCd: number;
  flatRes: number;
  flatAcc: number;
  pctHp: number;
  pctAtk: number;
  pctDef: number;
  spdSet: number;
  sets: Record<number, number>;
}

export function emptyAccum(): StatAccum {
  return {
    flatHp: 0,
    flatAtk: 0,
    flatDef: 0,
    flatSpd: 0,
    flatCr: 0,
    flatCd: 0,
    flatRes: 0,
    flatAcc: 0,
    pctHp: 0,
    pctAtk: 0,
    pctDef: 0,
    spdSet: 0,
    sets: {},
  };
}

export function addRuneToAccum(a: StatAccum, rune: Rune, grind = true) {
  const apply = (t: number, v: number) => {
    const meta = STAT_TYPES[t];
    if (!meta) return;
    if (meta.pct) {
      if (meta.key === "hp") a.pctHp += v;
      else if (meta.key === "atk") a.pctAtk += v;
      else if (meta.key === "def") a.pctDef += v;
    } else {
      if (meta.key === "hp") a.flatHp += v;
      else if (meta.key === "atk") a.flatAtk += v;
      else if (meta.key === "def") a.flatDef += v;
      else if (meta.key === "spd") a.flatSpd += v;
      else if (meta.key === "cr") a.flatCr += v;
      else if (meta.key === "cd") a.flatCd += v;
      else if (meta.key === "res") a.flatRes += v;
      else if (meta.key === "acc") a.flatAcc += v;
    }
  };
  apply(rune.main.t, rune.main.v);
  if (rune.prefix?.t) apply(rune.prefix.t, rune.prefix.v);
  for (const s of rune.subs) apply(s.t, s.v + (grind ? s.g : 0));
  a.sets[rune.set] = (a.sets[rune.set] ?? 0) + 1;
}

/** 神器主效果（固定體力 / 攻擊 / 防禦）計入累計值 */
export function addArtifactToAccum(a: StatAccum, artifact: Artifact) {
  const meta = ARTIFACT_MAIN[artifact.main.t];
  if (!meta) return;
  if (meta.key === "hp") a.flatHp += artifact.main.v;
  else if (meta.key === "atk") a.flatAtk += artifact.main.v;
  else if (meta.key === "def") a.flatDef += artifact.main.v;
}

/** 套裝加成（能量 15% HP 等） */
export function applySetBonuses(a: StatAccum, base: BaseStats) {
  for (const [idStr, count] of Object.entries(a.sets)) {
    const def = SET_BY_ID[Number(idStr)];
    if (!def || !def.stat || !def.value) continue;
    const times = def.pieces > 0 ? Math.floor(count / def.pieces) : 0;
    if (times <= 0) continue;
    const total = def.value * times;
    switch (def.stat) {
      case "hp":
        a.pctHp += total;
        break;
      case "atk":
        a.pctAtk += total;
        break;
      case "def":
        a.pctDef += total;
        break;
      case "spd":
        a.spdSet += Math.ceil((base.spd * total) / 100);
        break;
      case "cr":
        a.flatCr += total;
        break;
      case "cd":
        a.flatCd += total;
        break;
      case "acc":
        a.flatAcc += total;
        break;
      case "res":
        a.flatRes += total;
        break;
    }
  }
}

export function defaultBonus(partial: Partial<BonusConfig> = {}): BonusConfig {
  return {
    // 建築一律預設滿等（競技場圖騰 + 屬性塔 + 公會旗幟）
    towerSpd: 15,
    towerAtk: 20,
    towerHp: 20,
    towerDef: 20,
    towerCd: 25,
    elementAtk: 21,
    guildAtk: 20,
    guildHp: 20,
    guildDef: 20,
    guildCd: 25,
    leadSpd: 0,
    buffSpd: 0,
    // 與 SWOP 預設一致：一般建築全滿，公會旗幟預設不計入（可手動開啟）
    useGuild: false,
    useElementTower: true,
    grind: true,
    ...partial,
  };
}

export function tickOf(spd: number, rta = false): number {
  if (!spd || spd <= 0) return Infinity;
  const rate = rta ? 0.015 : 0.07;
  return Math.max(1, Math.ceil(100 / (spd * rate) - 1e-9));
}

/** 達到指定 tick 所需最低速度 */
export function speedForTick(tick: number, rta = false): number {
  const rate = rta ? 0.015 : 0.07;
  if (!tick || tick <= 0) return Infinity;
  return Math.ceil(100 / (tick * rate) - 1e-9);
}

/**
 * 結算面板數值。
 *
 * `withSkills = false`（預設）＝遊戲內魔靈面板：只有符文 / 套裝加成，
 * 不含召喚師技能（battle / guild）與競技場、屬性塔等實戰加成。
 *
 * `withSkills = true` ＝實戰數值：再加上一般召喚師技能、競技場圖騰、屬性塔，
 * 以及（`useGuild` 開啟時）公會技能。傷害與 EHP 一律用這個版本。
 *
 * 速度是例外：速度圖騰 / 隊長技 / 速度 Buff 是 Tick 的計算基礎，
 * 兩種版本都會計入，否則 Tick 會全部失準。
 */
export function finalizeStats(
  base: BaseStats,
  a: StatAccum,
  bonus: BonusConfig,
  rta = false,
  withSkills = false,
): Stats {
  const guild = withSkills && bonus.useGuild;
  const pctHp = a.pctHp + (withSkills ? (bonus.towerHp ?? 0) + (guild ? bonus.guildHp : 0) : 0);
  const pctAtk =
    a.pctAtk +
    (withSkills
      ? (bonus.towerAtk ?? 0) + (guild ? bonus.guildAtk : 0) + (bonus.useElementTower ? bonus.elementAtk ?? 0 : 0)
      : 0);
  const pctDef = a.pctDef + (withSkills ? (bonus.towerDef ?? 0) + (guild ? bonus.guildDef : 0) : 0);
  const pctSpd = (bonus.towerSpd ?? 0) + bonus.leadSpd + bonus.buffSpd;

  const hp = base.hp + Math.ceil((base.hp * pctHp) / 100) + a.flatHp;
  const atk = base.atk + Math.ceil((base.atk * pctAtk) / 100) + a.flatAtk;
  const def = base.def + Math.ceil((base.def * pctDef) / 100) + a.flatDef;
  const spd = base.spd + Math.ceil((base.spd * pctSpd) / 100) + a.spdSet + a.flatSpd;
  const cr = Math.min(100, base.cr + a.flatCr);
  const cd = base.cd + a.flatCd + (withSkills ? (bonus.towerCd ?? 0) + (guild ? bonus.guildCd : 0) : 0);
  const res = Math.min(100, base.res + a.flatRes);
  const acc = Math.min(100, base.acc + a.flatAcc);
  const ehp = Math.floor((hp * (1140 + 3.5 * def)) / 1000);

  return { hp, atk, def, spd, cr, cd, res, acc, ehp, tick: tickOf(spd, rta) };
}

export function statsForRunes(
  base: BaseStats,
  runes: Rune[],
  bonus: BonusConfig,
  rta = false,
  withSkills = false,
  artifacts: Artifact[] = [],
): Stats {
  const a = emptyAccum();
  for (const r of runes) addRuneToAccum(a, r, bonus.grind);
  for (const art of artifacts) addArtifactToAccum(a, art);
  applySetBonuses(a, base);
  return finalizeStats(base, a, bonus, rta, withSkills);
}

/**
 * 只算 EHP（含一般召喚師技能；`withGuild` 時再加上公會技能）。
 * 配符結果池要為每一組同時保留「含一般技能」與「含公會技能」兩種 EHP，
 * 用這個函式比完整呼叫 finalizeStats 便宜，數值與 finalizeStats(withSkills=true) 相同。
 */
export function ehpWithSkills(base: BaseStats, a: StatAccum, bonus: BonusConfig, withGuild = false): number {
  const pctHp = a.pctHp + (bonus.towerHp ?? 0) + (withGuild ? bonus.guildHp : 0);
  const pctDef = a.pctDef + (bonus.towerDef ?? 0) + (withGuild ? bonus.guildDef : 0);
  const hp = base.hp + Math.ceil((base.hp * pctHp) / 100) + a.flatHp;
  const def = base.def + Math.ceil((base.def * pctDef) / 100) + a.flatDef;
  return Math.floor((hp * (1140 + 3.5 * def)) / 1000);
}

export function setSummary(sets: Record<number, number>): string {
  return Object.entries(sets)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, c]) => `${SET_BY_ID[Number(id)]?.name ?? "?"}×${c}`)
    .join(" · ");
}

/** 依建築等級表換算加成 % */
export function buildingPct(id: number, level: number): number {
  const def = BUILDINGS[id];
  if (!def || level <= 0) return 0;
  return def.max[Math.min(def.max.length, Math.floor(level)) - 1] ?? 0;
}

/** 由帳號資料建立建築加成（競技場圖騰 + 公會旗幟） */
export function bonusFromBuildings(
  buildings: { id: number; level: number }[],
  base: Partial<BonusConfig> = {},
): BonusConfig {
  const b = defaultBonus(base);
  if (buildings.length === 0) return b;
  const levelOf = (id: number) => buildings.find((x) => x.id === id)?.level ?? 0;

  b.towerSpd = buildingPct(7, levelOf(7));
  b.towerAtk = buildingPct(9, levelOf(9));
  b.towerDef = buildingPct(10, levelOf(10));
  b.towerHp = buildingPct(11, levelOf(11));
  b.towerCd = buildingPct(8, levelOf(8));
  b.guildAtk = buildingPct(17, levelOf(17));
  b.guildCd = buildingPct(18, levelOf(18));
  b.guildHp = buildingPct(19, levelOf(19));
  b.guildDef = buildingPct(20, levelOf(20));
  b.useGuild = [17, 18, 19, 20].some((id) => levelOf(id) > 0);
  return b;
}

export function unitRunes(unit: Unit | undefined, runeMap: Map<number, Rune>): Rune[] {
  if (!unit) return [];
  return unit.runes.map((id) => runeMap.get(id)).filter(Boolean) as Rune[];
}
