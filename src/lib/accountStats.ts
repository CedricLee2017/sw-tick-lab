import { useMemo } from "react";
import { MONSTER_MAP, useStore } from "../store";
import { baseStats, runeEfficiency, runeScore, statsForRunes } from "./stats";
import type { Account, Artifact, BonusConfig, Monster, Rune, Stats, Unit } from "./types";

/** 總覽「高速符文」的速度門檻 */
export const SPEED_THRESHOLDS = [30, 28, 27] as const;

/** 總覽「最高效率符文」只看 6 星，且效率不計固定體力 / 攻擊 / 防禦 */
export const TOP_EFF_LIMIT = 100;
export const TOP_EFF_SET_IDS = { violent: 13, will: 15, swift: 3 } as const;
export type TopEffKey = "all" | keyof typeof TOP_EFF_SET_IDS;

export interface RuneEffEntry {
  rune: Rune;
  /** 效率：含精煉，分子與分母都不計固定體力 / 攻擊 / 防禦 */
  eff: number;
  /** 符文速度：速度副屬性（含精煉）＋ 速度固有屬性 */
  spd: number;
}

export interface RuneScoreEntry {
  rune: Rune;
  /** 遊戲符文分數（含精煉） */
  score: number;
  /** 符文速度：速度副屬性（含精煉）＋ 速度固有屬性 */
  spd: number;
}

export interface SpeedThresholdCount {
  threshold: number;
  all: number;
  /** 暴走 / 意志 / 迅速各自的數量 */
  sets: Record<number, number>;
}

/** 符文速度：速度副屬性（含精煉）＋ 速度固有屬性 */
export function runeSpeed(rune: Rune): number {
  let spd = 0;
  for (const s of rune.subs) if (s.t === 8) spd += s.v + (s.g ?? 0);
  if (rune.prefix?.t === 8) spd += rune.prefix.v;
  return spd;
}

export interface UnitView {
  unit: Unit;
  monster: Monster;
  base: ReturnType<typeof baseStats>;
  runes: Rune[];
  artifacts: Artifact[];
  stats: Stats;
}

export function computeUnitView(account: Account, unit: Unit, bonus: BonusConfig, rta = false): UnitView | null {
  const monster = MONSTER_MAP.get(unit.master);
  if (!monster) return null;
  const base = baseStats(monster, unit.stars, unit.level);
  const runeMap = new Map(account.runes.map((r) => [r.id, r]));
  const runes = unit.runes.map((id) => runeMap.get(id)).filter(Boolean) as Rune[];
  const artifactMap = new Map(account.artifacts.map((a) => [a.id, a]));
  const artifacts = unit.artifacts.map((id) => artifactMap.get(id)).filter(Boolean) as Artifact[];
  return { unit, monster, base, runes, artifacts, stats: statsForRunes(base, runes, bonus, rta, false, artifacts) };
}

export interface AccountSummary {
  views: UnitView[];
  runeOwner: Map<number, number>;
  byEl: Record<number, number>;
  byNat: Record<number, number>;
  topSpeed: UnitView[];
  sixStar: number;
  avgEff: number;
  sets: Record<number, number>;
  grades: Record<number, number>;
  slots: Record<number, number>;
  /** 速度達門檻的符文數量（全部與暴走 / 意志 / 迅速） */
  speedCounts: SpeedThresholdCount[];
  /** 6 星符文效率 Top 100（全部與暴走 / 意志 / 迅速） */
  topEff: Record<TopEffKey, RuneEffEntry[]>;
  /** 遊戲符文分數 Top 100（全部星級） */
  topScore: RuneScoreEntry[];
  /** 所有 6 星滿等魔靈（重複也保留） */
  maxLevel6: UnitView[];
}

export function summarize(account: Account, bonus: BonusConfig, rta = false): AccountSummary {
  const views = account.units
    .map((u) => computeUnitView(account, u, bonus, rta))
    .filter(Boolean) as UnitView[];

  const runeOwner = new Map<number, number>();
  for (const u of account.units) for (const rid of u.runes) runeOwner.set(rid, u.id);

  const byEl: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const byNat: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const sets: Record<number, number> = {};
  const grades: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const slots: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const v of views) {
    byEl[v.monster.el] = (byEl[v.monster.el] ?? 0) + 1;
    byNat[v.monster.nat] = (byNat[v.monster.nat] ?? 0) + 1;
  }
  for (const r of account.runes) {
    sets[r.set] = (sets[r.set] ?? 0) + 1;
    grades[r.grade] = (grades[r.grade] ?? 0) + 1;
    slots[r.slot] = (slots[r.slot] ?? 0) + 1;
  }

  const avgEff = account.runes.length ? account.runes.reduce((s, r) => s + r.eff, 0) / account.runes.length : 0;

  // 高速符文：速度副屬性（含精煉）＋ 速度固有屬性
  const speedCounts: SpeedThresholdCount[] = SPEED_THRESHOLDS.map((threshold) => {
    const sets: Record<number, number> = { [TOP_EFF_SET_IDS.violent]: 0, [TOP_EFF_SET_IDS.will]: 0, [TOP_EFF_SET_IDS.swift]: 0 };
    let all = 0;
    for (const r of account.runes) {
      if (runeSpeed(r) < threshold) continue;
      all += 1;
      if (sets[r.set] != null) sets[r.set] += 1;
    }
    return { threshold, all, sets };
  });

  // 6 星符文效率排行（不計固定體力 / 攻擊 / 防禦）
  const effPool: RuneEffEntry[] = account.runes
    .filter((r) => r.grade === 6)
    .map((r) => ({ rune: r, eff: runeEfficiency(r, true, { ignoreFlatAll: true }).current, spd: runeSpeed(r) }));
  const effSorted = [...effPool].sort((a, b) => b.eff - a.eff || b.rune.id - a.rune.id);
  const topEff = {
    all: effSorted.slice(0, TOP_EFF_LIMIT),
    violent: effSorted.filter((e) => e.rune.set === TOP_EFF_SET_IDS.violent).slice(0, TOP_EFF_LIMIT),
    will: effSorted.filter((e) => e.rune.set === TOP_EFF_SET_IDS.will).slice(0, TOP_EFF_LIMIT),
    swift: effSorted.filter((e) => e.rune.set === TOP_EFF_SET_IDS.swift).slice(0, TOP_EFF_LIMIT),
  } as Record<TopEffKey, RuneEffEntry[]>;

  // 遊戲符文分數 Top 100（含精煉；不限制星級，讓 5★ 神符也能排進來）
  const topScore: RuneScoreEntry[] = [...account.runes]
    .map((r) => ({ rune: r, score: runeScore(r, true), spd: runeSpeed(r) }))
    .sort((a, b) => b.score - a.score || b.rune.id - a.rune.id)
    .slice(0, TOP_EFF_LIMIT);

  // 6 星滿等（Lv40）；重複的魔靈各自保留
  const maxLevel6 = views
    .filter((v) => v.unit.stars === 6 && v.unit.level >= 40)
    .sort((a, b) => a.unit.master - b.unit.master || a.unit.id - b.unit.id);

  return {
    views,
    runeOwner,
    byEl,
    byNat,
    topSpeed: [...views].sort((a, b) => (b.stats.panelSpd ?? b.stats.spd) - (a.stats.panelSpd ?? a.stats.spd)).slice(0, 12),
    sixStar: account.units.filter((u) => u.stars === 6).length,
    avgEff,
    sets,
    grades,
    slots,
    speedCounts,
    topEff,
    topScore,
    maxLevel6,
  };
}

export function useSummary() {
  const account = useStore((s) => s.account);
  const bonus = useStore((s) => s.settings.bonus);
  const rta = useStore((s) => s.settings.rta);
  return useMemo(() => (account ? summarize(account, bonus, rta) : null), [account, bonus, rta]);
}
