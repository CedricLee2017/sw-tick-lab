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
import type { BonusConfig, Monster, Rune, Stats, Unit } from "./types";

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
    towerSpd: 15,
    towerAtk: 0,
    towerHp: 0,
    towerDef: 0,
    guildAtk: 0,
    guildHp: 0,
    guildDef: 0,
    guildCd: 0,
    leadSpd: 0,
    buffSpd: 0,
    useGuild: false,
    useElementTower: false,
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

export function finalizeStats(
  base: BaseStats,
  a: StatAccum,
  bonus: BonusConfig,
  rta = false,
): Stats {
  const pctHp = a.pctHp + bonus.towerHp + (bonus.useGuild ? bonus.guildHp : 0);
  const pctAtk = a.pctAtk + bonus.towerAtk + (bonus.useGuild ? bonus.guildAtk : 0);
  const pctDef = a.pctDef + bonus.towerDef + (bonus.useGuild ? bonus.guildDef : 0);
  const pctSpd = bonus.towerSpd + bonus.leadSpd + bonus.buffSpd;

  const hp = base.hp + Math.ceil((base.hp * pctHp) / 100) + a.flatHp;
  const atk = base.atk + Math.ceil((base.atk * pctAtk) / 100) + a.flatAtk;
  const def = base.def + Math.ceil((base.def * pctDef) / 100) + a.flatDef;
  const spd = base.spd + Math.ceil((base.spd * pctSpd) / 100) + a.spdSet + a.flatSpd;
  const cr = Math.min(100, base.cr + a.flatCr);
  const cd = base.cd + a.flatCd + (bonus.useGuild ? bonus.guildCd : 0);
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
): Stats {
  const a = emptyAccum();
  for (const r of runes) addRuneToAccum(a, r, bonus.grind);
  applySetBonuses(a, base);
  return finalizeStats(base, a, bonus, rta);
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
