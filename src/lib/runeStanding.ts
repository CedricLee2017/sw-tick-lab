import { grindMax, grindStoneMax } from "./grind";
import { runeEfficiency } from "./stats";
import type { Rune } from "./types";

/**
 * 符文定位（Rune Standing）
 *
 * 不看符分、也不看「每條都滿值」的理論上限，只做三件事：
 *  1. 效率：每條副屬的值 ÷ 該屬性的最大值（固定體力 / 攻擊 / 防禦不計）
 *  2. 精煉：Top N 裡有多少顆「英雄精滿」「傳說精滿」
 *  3. 公會：已裝備符文的平均效率，與成員比較
 */

/** 預設取效率最高的前 N 顆（與 SWGT 的 Top 400 對齊） */
export const STANDING_LIMIT = 400;

/** 門檻分佈用的效率門檻 */
export const STANDING_THRESHOLDS = [90, 85, 80, 75] as const;

export interface StandingPoint {
  rune: Rune;
  /** 效率 %（含精煉，忽略固定體攻防） */
  eff: number;
  /** 英雄級磨石已精滿（可精煉的副屬都到英雄上限） */
  heroDone: boolean;
  /** 傳說級磨石已精滿 */
  legendDone: boolean;
  /** 完全沒有精煉過（可精煉的副屬全部還是 0） */
  untouched: boolean;
  /** 全部用英雄磨石精滿後的效率 */
  effHero: number;
  /** 全部用傳說磨石精滿後的效率 */
  effLegend: number;
}

/** 單顆符文的定位效率：含精煉、忽略固定體力 / 攻擊 / 防禦 */
export function standingEff(rune: Rune): number {
  return runeEfficiency(rune, true, { ignoreFlatAll: true }).current;
}

/** 一顆符文的精煉狀態：英雄 / 傳說是否精滿、精滿後效率 */
export function grindState(rune: Rune): {
  heroDone: boolean;
  legendDone: boolean;
  untouched: boolean;
  grindable: number;
  effHero: number;
  effLegend: number;
} {
  let heroDone = true;
  let legendDone = true;
  let grindable = 0;
  let grinded = 0;
  let anyGrind = false;

  const withGrind = (cap: (t: number) => number) =>
    rune.subs.map((s) => {
      const max = grindMax(s.t, rune.ancient);
      if (max <= 0) return s;
      return { ...s, g: Math.max(s.g ?? 0, cap(s.t)) };
    });

  for (const s of rune.subs) {
    const max = grindMax(s.t, rune.ancient);
    if (max <= 0) continue;
    grindable += 1;
    const g = s.g ?? 0;
    if (g > 0) anyGrind = true;
    grinded += g > 0 ? 1 : 0;
    if (g < grindStoneMax(s.t, 4, rune.ancient)) heroDone = false;
    if (g < grindStoneMax(s.t, 5, rune.ancient)) legendDone = false;
  }

  const opts = { ignoreFlatAll: true } as const;
  const effHero = runeEfficiency({ ...rune, subs: withGrind((t) => grindStoneMax(t, 4, rune.ancient)) }, true, opts).current;
  const effLegend = runeEfficiency({ ...rune, subs: withGrind((t) => grindStoneMax(t, 5, rune.ancient)) }, true, opts).current;

  return {
    // 沒有可精煉的副屬時視為已滿（沒有東西可以補）
    heroDone: grindable === 0 ? true : heroDone,
    legendDone: grindable === 0 ? true : legendDone,
    untouched: grindable > 0 && !anyGrind,
    grindable,
    effHero,
    effLegend,
  };
}

/** 依效率由高到低排出前 N 顆 6★ 符文（setId > 0 時只看該套裝） */
export function standingPoints(runes: Rune[], limit = STANDING_LIMIT, setId = 0): StandingPoint[] {
  return runes
    .filter((r) => r.grade === 6 && (setId <= 0 || r.set === setId))
    .map((rune) => {
      const state = grindState(rune);
      return {
        rune,
        eff: standingEff(rune),
        heroDone: state.heroDone,
        legendDone: state.legendDone,
        untouched: state.untouched,
        effHero: state.effHero,
        effLegend: state.effLegend,
      };
    })
    .sort((a, b) => b.eff - a.eff || b.rune.id - a.rune.id)
    .slice(0, Math.max(1, limit));
}

export interface StandingSummary {
  points: StandingPoint[];
  /** 前 N 顆的平均效率 */
  avg: number;
  /** 中位數 */
  median: number;
  /** 最高 / 最低（第 N 名） */
  top: number;
  floor: number;
  /** 樣本數（可能少於 N） */
  count: number;
  /** 英雄 / 傳說精滿的顆數 */
  heroDone: number;
  legendDone: number;
  /** 完全沒精煉過的顆數 */
  untouched: number;
  /** 全部精滿（傳說）後的平均效率 */
  avgIfLegend: number;
  /** 全部精滿可以多幾點效率 */
  gainLegend: number;
  thresholds: { t: number; count: number; pct: number }[];
}

export function summarizeStanding(points: StandingPoint[]): StandingSummary {
  const count = points.length;
  const avg = count ? points.reduce((s, p) => s + p.eff, 0) / count : 0;
  const mid =
    count === 0
      ? 0
      : count % 2 === 0
        ? (points[count / 2 - 1].eff + points[count / 2].eff) / 2
        : points[(count - 1) / 2].eff;
  const avgIfLegend = count ? points.reduce((s, p) => s + p.effLegend, 0) / count : 0;
  return {
    points,
    avg,
    median: mid,
    top: points[0]?.eff ?? 0,
    floor: points[count - 1]?.eff ?? 0,
    count,
    heroDone: points.filter((p) => p.heroDone).length,
    legendDone: points.filter((p) => p.legendDone).length,
    untouched: points.filter((p) => p.untouched).length,
    avgIfLegend,
    gainLegend: Math.max(0, avgIfLegend - avg),
    thresholds: STANDING_THRESHOLDS.map((t) => {
      const n = points.filter((p) => p.eff >= t).length;
      return { t, count: n, pct: count ? (n / count) * 100 : 0 };
    }),
  };
}

export interface MemberStanding {
  name: string;
  /** 該成員已裝備符文的平均效率 */
  value: number;
  runes: number;
}

export interface GuildStanding {
  members: MemberStanding[];
  avg: number;
  sd: number;
  min: number;
  max: number;
  /** 自己排在成員之間的名次（1 = 最高） */
  rank: number;
  /** 贏過幾成成員（0–100） */
  percentile: number;
  /** 自己與公會平均的差距（效率點） */
  delta: number;
  /** 相差幾個標準差 */
  z: number;
}

/** 把成員的已裝備符文整理成「每人一個平均效率」，再排出名次 */
export function guildStanding(
  members: { name: string; runes: Rune[] }[],
  ownValue: number | null,
): GuildStanding | null {
  const rows: MemberStanding[] = members
    .filter((m) => m.runes.length > 0)
    .map((m) => ({
      name: m.name,
      value: m.runes.reduce((s, r) => s + standingEff(r), 0) / m.runes.length,
      runes: m.runes.length,
    }))
    .sort((a, b) => b.value - a.value);
  if (rows.length === 0) return null;

  const avg = rows.reduce((s, m) => s + m.value, 0) / rows.length;
  const variance = rows.reduce((s, m) => s + (m.value - avg) ** 2, 0) / rows.length;
  const sd = Math.sqrt(variance);
  const own = ownValue ?? avg;
  const better = rows.filter((m) => m.value > own).length;

  return {
    members: rows,
    avg,
    sd,
    min: rows[rows.length - 1].value,
    max: rows[0].value,
    rank: better + 1,
    percentile: rows.length ? ((rows.length - better) / rows.length) * 100 : 0,
    delta: own - avg,
    z: sd > 0 ? (own - avg) / sd : 0,
  };
}
