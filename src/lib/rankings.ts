/**
 * 符文 / 神器排名
 *
 * 遊戲內的符文工具提示會顯示「持有數量」與每條副屬性在同組之中的名次
 * （例如「暴擊率 +9%（9/67）」），神器同理。SWEX 匯出的存檔沒有現成的排名，
 * 全部都要由玩家自己的符文／神器清單即時計算，所以這裡的排名有兩個重點：
 *
 * 1. 分組（池）：
 *    - 符文：同套裝 + 同號碼（遠古與一般分開計，因為遠古符文的精煉上限不同），
 *      跟遊戲顯示的「意志符文 (1)」一致。
 *    - 神器：同類型（屬性 / 類型）+ 同屬性（屬性神器）或同魔靈類型（類型神器）。
 * 2. 比較值：符文用「實際數值 = 原始值 + 精煉值」，神器直接用效果數值；
 *    同分並列同名次（名次 = 1 + 數值比它高的數量）。
 */
import type { Artifact, Rune } from "./types";

/** 單一條屬性的排名 */
export interface StatRank {
  /** 名次（1 = 最高） */
  rank: number;
  /** 同組之中擁有這條屬性的數量（顯示成 rank/total） */
  total: number;
}

export interface RuneRank {
  /** 與 rune.subs 同順序；null = 該條沒有可比較的對象 */
  subs: (StatRank | null)[];
  /** 同組（同套裝 + 同號碼）的符文總數，即遊戲顯示的「持有數量」 */
  pool: number;
}

export interface ArtifactRank {
  /** 與 artifact.subs 同順序 */
  subs: (StatRank | null)[];
  /** 同組神器的總數 */
  pool: number;
}

export interface RankIndex {
  runes: Map<number, RuneRank>;
  artifacts: Map<number, ArtifactRank>;
}

/** 符文分組：遠古 / 一般分開，再依套裝與號碼 */
export function runePoolKey(rune: Pick<Rune, "ancient" | "set" | "slot">): string {
  return `${rune.ancient ? "a" : "n"}:${rune.set}:${rune.slot}`;
}

/** 神器分組：屬性神器看屬性，類型神器看魔靈類型（無形 98 自成一组） */
export function artifactPoolKey(art: Pick<Artifact, "type" | "attr" | "style">): string {
  return art.type === 1 ? `1:${art.attr}` : `2:${art.style}`;
}

/** 由大到小排序後，回傳比 value 大的數量（同分不算大於） */
function countGreater(sortedDesc: readonly number[], value: number): number {
  let lo = 0;
  let hi = sortedDesc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedDesc[mid] > value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 符文的比較值：面板顯示的實際數值（含精煉） */
export const runeSubValue = (sub: Rune["subs"][number]): number => sub.v + (sub.g ?? 0);

/** 名次佔比：0 = 第一名、1 = 最後一名（用來上色 / 排序） */
export function rankPercent(rank: StatRank | null | undefined): number {
  if (!rank || rank.total <= 1) return 0;
  return (rank.rank - 1) / (rank.total - 1);
}

/** 排名色階：前 10% 金色、前 25% 綠色，其餘低調 */
export function rankTone(rank: StatRank | null | undefined): "top" | "good" | "" {
  if (!rank || rank.total < 2) return "";
  const p = rankPercent(rank);
  if (p <= 0.1) return "top";
  if (p <= 0.25) return "good";
  return "";
}

/** 平均百分位（給「副屬排名」排序用）；沒有排名資料時回傳 1（最後） */
export function averageRankPercent(ranks: (StatRank | null)[] | undefined): number {
  if (!ranks || ranks.length === 0) return 1;
  let sum = 0;
  let n = 0;
  for (const r of ranks) {
    if (!r || r.total < 2) continue;
    sum += rankPercent(r);
    n++;
  }
  return n === 0 ? 1 : sum / n;
}

/**
 * 建立整份存檔的排名索引。符文／神器各自的清單只掃一次，
 * 以 id 作為 key，讓卡片直接 O(1) 取得排名。
 */
export function buildRankIndex(runes: readonly Rune[], artifacts: readonly Artifact[]): RankIndex {
  const runePools = new Map<string, Rune[]>();
  for (const rune of runes) {
    const key = runePoolKey(rune);
    const pool = runePools.get(key);
    if (pool) pool.push(rune);
    else runePools.set(key, [rune]);
  }

  const runeRanks = new Map<number, RuneRank>();
  for (const pool of runePools.values()) {
    // 先收集每一條屬性在同組的所有數值，排序後就能用二分搜尋取名次
    const values = new Map<number, number[]>();
    for (const rune of pool) {
      for (const sub of rune.subs) {
        const list = values.get(sub.t);
        if (list) list.push(runeSubValue(sub));
        else values.set(sub.t, [runeSubValue(sub)]);
      }
    }
    for (const list of values.values()) list.sort((a, b) => b - a);

    for (const rune of pool) {
      runeRanks.set(rune.id, {
        pool: pool.length,
        subs: rune.subs.map((sub) => {
          const list = values.get(sub.t);
          if (!list || list.length === 0) return null;
          return { rank: countGreater(list, runeSubValue(sub)) + 1, total: list.length };
        }),
      });
    }
  }

  const artifactPools = new Map<string, Artifact[]>();
  for (const art of artifacts) {
    const key = artifactPoolKey(art);
    const pool = artifactPools.get(key);
    if (pool) pool.push(art);
    else artifactPools.set(key, [art]);
  }

  const artifactRanks = new Map<number, ArtifactRank>();
  for (const pool of artifactPools.values()) {
    const values = new Map<number, number[]>();
    for (const art of pool) {
      for (const sub of art.subs) {
        const list = values.get(sub.t);
        if (list) list.push(sub.v);
        else values.set(sub.t, [sub.v]);
      }
    }
    for (const list of values.values()) list.sort((a, b) => b - a);

    for (const art of pool) {
      artifactRanks.set(art.id, {
        pool: pool.length,
        subs: art.subs.map((sub) => {
          const list = values.get(sub.t);
          if (!list || list.length === 0) return null;
          return { rank: countGreater(list, sub.v) + 1, total: list.length };
        }),
      });
    }
  }

  return { runes: runeRanks, artifacts: artifactRanks };
}
