/**
 * SWC2026 Special Battle 支援魔靈（唯讀樣本）。
 *
 * 資料來源：SWEX `GetRTPvPInfo_v3` 的 `swc_event_unit_list`。
 * 這些不是你的帳號魔靈，而是活動提供的支援魔靈；
 * 符文、神器、遺物都是活動預先配好的完整資料。
 */
import raw from "../data/swcSample.json";
import { MONSTER_MAP } from "../store";
import { parseArtifact, parseRune } from "./parse";
import {
  baseStats,
  defaultBonus,
  effectiveSetCounts,
  setSummary,
  statsForRunes,
  type BaseStats,
} from "./stats";
import type { Artifact, Monster, Rune, Stats } from "./types";

export interface SwcSampleUnit {
  /** 活動支援魔靈的 unit_id（1001…） */
  id: number;
  master: number;
  stars: number;
  level: number;
  monster?: Monster;
  runes: Rune[];
  artifacts: Artifact[];
  /** 遺物目前只保留原始資料；專案尚未建模，所以不計入面板數值 */
  relics: unknown[];
  base: BaseStats | null;
  stats: Stats | null;
  setText: string;
  /** 官方支援資料提供的符文合計（部分欄位可能為 0） */
  bonusText: string;
}

interface RawUnit {
  unit_id: number;
  unit_master_id: number;
  class?: number;
  unit_level?: number;
  runes?: unknown[];
  artifacts?: unknown[];
  relics?: unknown[];
}

interface RawSample {
  source?: string;
  collectedAt?: string;
  season?: unknown;
  units?: RawUnit[];
}

const sample = raw as RawSample;

/**
 * RTA 只吃符文 / 套裝 / 神器，建築、公會技能與 Buff 都不計。
 * 這裡用與 RTA Deck 相同的基準，讓速度可以直接互相比較。
 */
const SWC_BONUS = defaultBonus({
  towerSpd: 0,
  towerAtk: 0,
  towerHp: 0,
  towerDef: 0,
  towerCd: 0,
  elementAtk: 0,
  guildAtk: 0,
  guildHp: 0,
  guildDef: 0,
  guildCd: 0,
  leadSpd: 0,
  buffSpd: 0,
  useGuild: false,
  useElementTower: false,
  grind: true,
});

export const SWC_SAMPLE_SOURCE = sample.source ?? "SWC2026 Special Battle";
export const SWC_SAMPLE_COLLECTED_AT = sample.collectedAt ?? "";

/**
 * 活動資料把符文副屬性彙總在某幾顆符文裡（部分 slot 的主屬性 / 副屬性為 0）。
 * 這裡把官方有提供的數值整理成「符文合計」文字，避免逐顆顯示時看起來像壞掉。
 */
function runeBonusText(runes: Rune[]): string {
  const sum = {
    hp: 0, hpPct: 0, atk: 0, atkPct: 0, def: 0, defPct: 0,
    spd: 0, cr: 0, cd: 0, res: 0, acc: 0,
  };
  const add = (type: number, value: number) => {
    if (!value) return;
    if (type === 1) sum.hp += value;
    else if (type === 2) sum.hpPct += value;
    else if (type === 3) sum.atk += value;
    else if (type === 4) sum.atkPct += value;
    else if (type === 5) sum.def += value;
    else if (type === 6) sum.defPct += value;
    else if (type === 8) sum.spd += value;
    else if (type === 9) sum.cr += value;
    else if (type === 10) sum.cd += value;
    else if (type === 11) sum.res += value;
    else if (type === 12) sum.acc += value;
  };
  for (const rune of runes) {
    for (const sub of rune.subs) add(sub.t, sub.v + sub.g);
    if (rune.prefix?.t) add(rune.prefix.t, rune.prefix.v);
  }
  return [
    sum.hp ? `HP +${sum.hp.toLocaleString("en-US")}` : "",
    sum.hpPct ? `HP% +${sum.hpPct}` : "",
    sum.atk ? `ATK +${sum.atk}` : "",
    sum.atkPct ? `ATK% +${sum.atkPct}` : "",
    sum.def ? `DEF +${sum.def}` : "",
    sum.defPct ? `DEF% +${sum.defPct}` : "",
    sum.spd ? `SPD +${sum.spd}` : "",
    sum.cr ? `CR +${sum.cr}%` : "",
    sum.cd ? `CD +${sum.cd}%` : "",
    sum.res ? `RES +${sum.res}%` : "",
    sum.acc ? `ACC +${sum.acc}%` : "",
  ].filter(Boolean).join(" · ");
}

export const SWC_SAMPLE_UNITS: SwcSampleUnit[] = (sample.units ?? []).flatMap((unit) => {
  const id = Number(unit.unit_id);
  const master = Number(unit.unit_master_id);
  if (!id || !master) return [];
  const stars = Math.min(6, Math.max(1, Number(unit.class) || 6));
  const level = Math.min(40, Math.max(1, Number(unit.unit_level) || 40));
  const runes = (unit.runes ?? [])
    .map((r) => parseRune(r, id))
    .filter((r): r is Rune => !!r);
  const artifacts = (unit.artifacts ?? []).map((a) => parseArtifact(a, id));
  const monster = MONSTER_MAP.get(master);
  const base = monster ? baseStats(monster, stars, level) : null;
  const stats = base ? statsForRunes(base, runes, SWC_BONUS, true, false, artifacts) : null;
  const counts = runes.reduce<Record<number, number>>((acc, rune) => {
    acc[rune.set] = (acc[rune.set] ?? 0) + 1;
    return acc;
  }, {});
  return [{
    id,
    master,
    stars,
    level,
    monster,
    runes,
    artifacts,
    relics: Array.isArray(unit.relics) ? unit.relics : [],
    base,
    stats,
    setText: setSummary(effectiveSetCounts(counts)),
    bonusText: runeBonusText(runes),
  }];
}).sort((a, b) => (b.stats?.spd ?? 0) - (a.stats?.spd ?? 0) || a.master - b.master);

export function swcUnitName(unit: SwcSampleUnit): string {
  return unit.monster?.name ?? `支援魔靈 #${unit.master}`;
}
