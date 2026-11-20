import { runeEfficiency } from "./stats";
import type { Rune } from "./types";

/**
 * 符文定位（Rune Standing）
 *
 * 把「幾百個點的效率曲線」壓成幾個可以直接講出口的數字：
 *  1. 精練度：Top N 符文的平均效率（0–100，100 = 每條副屬都滿值）
 *  2. 對比公會：已裝備符文的平均效率，與公會成員比較（名次 / 標準差）
 *
 * 公會資料來自公會頁匯入的 SWEX 資料，只有「已經裝在魔靈身上」的符文，
 * 沒有完整背包，所以公會比較只適用於已裝備符文；背包 Top N 只跟自己的門檻比較。
 */

/** 預設取效率最高的前 N 顆（與 SWGT 的 Top 400 對齊） */
export const STANDING_LIMIT = 400;

/** 深度 / 門檻分佈用的效率門檻（效率 100 = 每條副屬滿值） */
export const STANDING_THRESHOLDS = [90, 85, 80, 75] as const;

export interface StandingPoint {
  rune: Rune;
  /** 效率 %（含精煉，忽略固定體攻防） */
  eff: number;
}

/** 單顆符文的定位效率：含精煉、忽略固定體力 / 攻擊 / 防禦 */
export function standingEff(rune: Rune): number {
  return runeEfficiency(rune, true, { ignoreFlatAll: true }).current;
}

/** 依效率由高到低排出前 N 顆 6★ 符文（setId > 0 時只看該套裝） */
export function standingPoints(runes: Rune[], limit = STANDING_LIMIT, setId = 0): StandingPoint[] {
  return runes
    .filter((r) => r.grade === 6 && (setId <= 0 || r.set === setId))
    .map((rune) => ({ rune, eff: standingEff(rune) }))
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
  /** 精練度 = 平均效率，100 為滿值 */
  refinement: number;
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
  const top = points[0]?.eff ?? 0;
  const floor = points[count - 1]?.eff ?? 0;
  return {
    points,
    avg,
    median: mid,
    top,
    floor,
    count,
    refinement: avg,
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
  /** 自己排在成員之間的名次（1 = 最高）；自己不在名單內時仍會插入比較 */
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
