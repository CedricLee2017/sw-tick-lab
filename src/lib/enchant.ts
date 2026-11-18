/**
 * 精魔（Enchanted Gem，寶石變換）建議。
 *
 * 找出「換掉一條副屬性之後，會符合某個自行分類」的符文：
 *   1. 目前不符合分類，而且只差一條屬性（一顆寶石只能換一條副屬性）。
 *   2. 被換掉的副屬性不能是目前算進分類門檻的那一條，否則換完仍然少一條。
 *   3. 新屬性不能是主屬性、不能和現有副屬性／固有屬性重複，也不能用低於門檻的寶石硬湊。
 *   4. 已經用寶石轉過一次的符文，只能再轉同一條副屬性（遊戲規則）。
 *   5. 位置不可能出現的屬性也不能轉：1 號位沒有防禦力／防禦力%、3 號位沒有攻擊力／攻擊力%。
 *
 * 數值以「6★ 傳說寶石最大值」估算；預設再假設精魔後會把新副屬性精煉到傳說上限
 * （體攻防% / 速度可精煉，暴率 / 暴傷 / 抵抗 / 命中不可精煉）。
 * 實際數值會依寶石與磨石等級、骰值而較低。
 */
import { SET_BY_ID, STAT_TYPES } from "./constants";
import { GRIND_GRADE_LABEL, grindMax, grindStoneMax, matchingGrindstones } from "./grind";
import { runeEfficiency, runeScore, runeScoreRaw } from "./stats";
import { matchesRuneTag, runeStatValue, tagRequiredMatches } from "./runeTags";
import type { EnchantGem, Grindstone, Rune, RuneTagRule } from "./types";

/** 6★ 傳說寶石的最大值（一般符文） */
const GEM_MAX: Record<number, number> = {
  1: 580, // 體力
  2: 13, // 體力%
  3: 40, // 攻擊力
  4: 13, // 攻擊力%
  5: 40, // 防禦力
  6: 13, // 防禦力%
  8: 10, // 速度
  9: 9, // 暴擊率
  10: 10, // 暴擊傷害
  11: 11, // 效果抵抗
  12: 11, // 效果命中
};

/** 遠古符文只能使用遠古寶石，最大值較高 */
const GEM_MAX_ANCIENT: Record<number, number> = {
  1: 640,
  2: 15,
  3: 44,
  4: 15,
  5: 44,
  6: 15,
  8: 11,
  9: 10,
  10: 12,
  11: 13,
  12: 13,
};

/** 這顆符文能用寶石轉出的最大值（遠古符文用遠古寶石上限） */
export function gemMaxValue(t: number, ancient = false): number {
  return (ancient ? GEM_MAX_ANCIENT[t] : GEM_MAX[t]) ?? 0;
}

/** 6★ 寶石各等級的最大加成（1 普通 / 2 魔法 / 3 稀有 / 4 英雄 / 5 傳說） */
const GEM_MAX_BY_GRADE: Record<number, Record<number, number>> = {
  1: { 1: 150, 2: 4, 3: 12, 4: 4, 5: 12, 6: 4, 8: 3, 9: 3, 10: 4, 11: 4, 12: 4 },
  2: { 1: 220, 2: 7, 3: 16, 4: 7, 5: 16, 6: 7, 8: 4, 9: 4, 10: 5, 11: 6, 12: 6 },
  3: { 1: 310, 2: 9, 3: 23, 4: 9, 5: 23, 6: 9, 8: 6, 9: 5, 10: 6, 11: 8, 12: 8 },
  4: { 1: 420, 2: 11, 3: 30, 4: 11, 5: 30, 6: 11, 8: 8, 9: 7, 10: 8, 11: 9, 12: 9 },
  5: GEM_MAX,
};

/** 遠古寶石各等級的最大加成 */
const ANCIENT_GEM_MAX_BY_GRADE: Record<number, Record<number, number>> = {
  1: { 1: 210, 2: 6, 3: 16, 4: 6, 5: 16, 6: 6, 8: 4, 9: 4, 10: 6, 11: 6, 12: 6 },
  2: { 1: 280, 2: 9, 3: 20, 4: 9, 5: 20, 6: 9, 8: 5, 9: 5, 10: 7, 11: 8, 12: 8 },
  3: { 1: 370, 2: 11, 3: 27, 4: 11, 5: 27, 6: 11, 8: 7, 9: 6, 10: 8, 11: 10, 12: 10 },
  4: { 1: 480, 2: 13, 3: 34, 4: 13, 5: 34, 6: 13, 8: 9, 9: 8, 10: 10, 11: 11, 12: 11 },
  5: GEM_MAX_ANCIENT,
};

/** 某個等級（1 普通～5 傳說）的 6★ 寶石對這條屬性最多能加多少 */
export function gemStoneMax(stat: number, grade: number, ancient = false): number {
  const g = Math.min(5, Math.max(1, Math.round(grade)));
  return (ancient ? ANCIENT_GEM_MAX_BY_GRADE[g] : GEM_MAX_BY_GRADE[g])?.[stat] ?? 0;
}

/** 精魔後新副屬性可再精煉的上限；不能精煉的屬性（暴率 / 暴傷 / 抵抗 / 命中）回傳 0 */
export function enchantGrindMax(t: number, ancient = false): number {
  return grindMax(t, ancient);
}

/**
 * 各位置「不會出現」的屬性：1 號位沒有防禦力 / 防禦力%，3 號位沒有攻擊力 / 攻擊力%。
 * 這是符文的掉落規則，寶石也無法轉出這些組合，所以精魔建議要先排除。
 */
const SLOT_BLOCKED_STATS: Record<number, readonly number[]> = {
  1: [5, 6], // 防禦力、防禦力%
  3: [3, 4], // 攻擊力、攻擊力%
};

/** 這個位置能不能有某條屬性（主屬性、副屬性、固有屬性、精魔都一樣） */
export function slotAllowsStat(slot: number, t: number): boolean {
  return !(SLOT_BLOCKED_STATS[slot] ?? []).includes(t);
}

export function enchantStatLabel(t: number): string {
  return STAT_TYPES[t]?.label ?? `屬性 ${t}`;
}

export function enchantStatSuffix(t: number): string {
  const meta = STAT_TYPES[t];
  if (!meta) return "";
  // 固定值（1 / 3 / 5）不加 %，其餘（含暴率 / 暴傷 / 抵抗 / 命中）都是百分比
  return meta.pct || ["cr", "cd", "res", "acc"].includes(meta.key) ? "%" : "";
}

export interface EnchantOwner {
  name: string;
  unitId: number;
}

/** 一種可行的精魔方式 */
export interface EnchantOption {
  /** 被換掉的副屬性在 rune.subs 的索引 */
  fromIndex: number;
  fromT: number;
  fromLabel: string;
  /** 原本的實際數值（含精煉） */
  fromValue: number;
  /** 這條是不是之前用寶石轉出來的（遊戲只允許再轉同一條） */
  alreadyGem: boolean;
  toT: number;
  toLabel: string;
  /** 以 6★ 傳說寶石最大值估算的寶石本身數值 */
  toGem: number;
  /** 精魔後假設再精煉的加成上限（不可精煉為 0） */
  toGrind: number;
  /** 寶石＋精煉的合計估算值 */
  toValue: number;
  /** 分類要求的門檻（新屬性至少要這麼多） */
  need: number;
  /** 精魔後符合的分類 */
  rules: RuneTagRule[];
  /** 精魔後的效率（含精煉） */
  effAfter: number;
  /** 精魔後的遊戲分數 */
  scoreAfter: number;
}

export interface EnchantTarget {
  rune: Rune;
  owner?: EnchantOwner;
  /** 目前效率（含精煉） */
  effNow: number;
  /** 目前遊戲分數 */
  scoreNow: number;
  /** 所有可行的精魔方式，依精魔後效率排序 */
  options: EnchantOption[];
  /** 精魔後能符合的分類 id */
  ruleIds: string[];
  /** 所有方式中最好的精魔後效率 */
  bestEff: number;
  /** 所有方式中最好的精魔後分數 */
  bestScore: number;
}

function sortedGemSources(rune: Rune): number[] {
  const converted: number[] = [];
  rune.subs.forEach((s, i) => {
    if ((s.gem ?? 0) > 0) converted.push(i);
  });
  // 已經轉過寶石的符文，只能再換同一條副屬性
  if (converted.length > 0) return converted;
  return rune.subs.map((_, i) => i);
}

/** 把一條副屬性換成指定屬性後的新符文（不動主屬性與固有屬性；grind 為假設的精煉值） */
export function projectRune(
  rune: Rune,
  fromIndex: number,
  toT: number,
  gemValue: number,
  grind = 0,
): Rune {
  return {
    ...rune,
    subs: rune.subs.map((s, i) =>
      i === fromIndex ? { t: toT, v: gemValue, g: grind, gem: 1 } : { ...s },
    ),
  };
}

export interface EnchantOptions {
  /** 假設精魔後把新副屬性精煉到上限（預設 true；關閉則只計算寶石本身數值） */
  includeGrind?: boolean;
}

/**
 * 分析所有符文：回傳「精魔一次後就能符合某個啟用中分類」的清單。
 * 只處理 enabled 的分類；套裝不符、已符合、差超過一條的符文都不會列入。
 */
export function analyzeEnchant(
  runes: Rune[],
  rules: RuneTagRule[],
  owners?: Map<number, EnchantOwner>,
  opts: EnchantOptions = {},
): EnchantTarget[] {
  const includeGrind = opts.includeGrind !== false;
  const active = rules.filter((rule) => rule.enabled);
  if (active.length === 0) return [];

  const out: EnchantTarget[] = [];
  for (const rune of runes) {
    const sources = sortedGemSources(rune);
    if (sources.length === 0) continue;
    const hasMain = rune.main?.t > 0;
    const byKey = new Map<string, EnchantOption>();

    for (const rule of active) {
      if (rule.sets.length > 0 && !rule.sets.includes(rune.set)) continue;
      // 已經符合的分類不需要精魔
      if (matchesRuneTag(rule, rune)) continue;
      const need = tagRequiredMatches(rule);
      if (need <= 0) continue;

      const matchedTypes = new Set<number>();
      for (const s of rule.stats) {
        if (runeStatValue(rune, s.t) >= s.min) matchedTypes.add(s.t);
      }
      // 一顆寶石只能多一條，差 2 條以上就不可能一次補齊
      if (matchedTypes.size !== need - 1) continue;

      for (const target of rule.stats) {
        if (runeStatValue(rune, target.t) >= target.min) continue;
        // 已經有這條副屬性（數值不足）不能覆蓋成同樣屬性；固有屬性也不能重複
        if (rune.subs.some((s) => s.t === target.t)) continue;
        if (rune.prefix?.t === target.t) continue;
        if (hasMain && rune.main.t === target.t) continue;
        // 1 號位沒有防禦力／防禦%、3 號位沒有攻擊力／攻擊力%，寶石也轉不出來
        if (!slotAllowsStat(rune.slot, target.t)) continue;
        const toGem = gemMaxValue(target.t, rune.ancient);
        const toGrind = includeGrind ? enchantGrindMax(target.t, rune.ancient) : 0;
        const toValue = toGem + toGrind;
        // 寶石＋（可選的）精煉上限也達不到門檻就不列
        if (toValue < target.min) continue;

        for (const index of sources) {
          const source = rune.subs[index];
          if (!source || source.t === target.t) continue;
          // 換掉目前算進門檻的屬性，補回來的還是同一條數量，不會達標
          if (matchedTypes.has(source.t)) continue;

          const key = `${index}:${target.t}`;
          let option = byKey.get(key);
          if (!option) {
            const projected = projectRune(rune, index, target.t, toGem, toGrind);
            // 用實際的規則判斷一次，避免 minMatch / 固有屬性等邊界情況
            if (!matchesRuneTag(rule, projected)) continue;
            option = {
              fromIndex: index,
              fromT: source.t,
              fromLabel: enchantStatLabel(source.t),
              fromValue: source.v + (source.g ?? 0),
              alreadyGem: (source.gem ?? 0) > 0,
              toT: target.t,
              toLabel: enchantStatLabel(target.t),
              toGem,
              toGrind,
              toValue,
              need: target.min,
              rules: [],
              effAfter: runeEfficiency(projected, true).current,
              scoreAfter: runeScore(projected, true),
            };
            byKey.set(key, option);
          }
          if (!option.rules.some((r) => r.id === rule.id)) option.rules.push(rule);
        }
      }
    }

    if (byKey.size === 0) continue;
    const options = [...byKey.values()].sort(
      (a, b) => b.effAfter - a.effAfter || b.scoreAfter - a.scoreAfter || a.fromIndex - b.fromIndex,
    );
    out.push({
      rune,
      owner: owners?.get(rune.id),
      effNow: runeEfficiency(rune, true).current,
      scoreNow: runeScore(rune, true),
      options,
      ruleIds: [...new Set(options.flatMap((o) => o.rules.map((r) => r.id)))],
      bestEff: Math.max(...options.map((o) => o.effAfter)),
      bestScore: Math.max(...options.map((o) => o.scoreAfter)),
    });
  }
  return out;
}

/* ───────────────────────── 分數模式（精魔＋精煉到上限） ───────────────────────── */

/** 把所有「可精煉」的副屬性拉到該星級／遠古的上限（其他屬性不動） */
export function maxGrindRune(rune: Rune): Rune {
  const ancient = !!rune.ancient;
  return {
    ...rune,
    subs: rune.subs.map((s) => {
      const max = grindMax(s.t, ancient);
      return max > 0 && (s.g ?? 0) < max ? { ...s, g: max } : { ...s };
    }),
  };
}

/** 分數模式的一種精魔方式 */
export interface EnchantScoreOption {
  /** 被換掉的副屬性在 rune.subs 的索引 */
  fromIndex: number;
  fromT: number;
  fromLabel: string;
  /** 原本的實際數值（含精煉） */
  fromValue: number;
  /** 這條是不是之前用寶石轉出來的（遊戲只允許再轉同一條） */
  alreadyGem: boolean;
  toT: number;
  toLabel: string;
  /** 6★ 傳說寶石（遠古用遠古上限）的數值 */
  toGem: number;
  /** 精魔後可再精煉的上限（不可精煉為 0） */
  toGrind: number;
  /** 寶石＋精煉的合計估算值 */
  toValue: number;
  /** 精魔後、其他可精煉副屬性也拉到上限的遊戲分數 */
  scoreAfter: number;
  /** 這個選項能讓分數增加多少（相對目前分數） */
  gain: number;
  /** 精魔後的符文效率（同樣假設精煉到上限） */
  effAfter: number;
  /** 精魔後仍有精煉空間的副屬性（不含新轉出來的那條） */
  grindPlan: { t: number; label: string; from: number; to: number }[];
}

export interface EnchantScoreTarget {
  rune: Rune;
  owner?: EnchantOwner;
  /** 目前遊戲分數（含目前精煉） */
  scoreNow: number;
  /** 不精魔、只把現有可精煉副屬性拉到上限的分數 */
  maxNow: number;
  /** 精魔＋精煉到上限後能達到的最高分數 */
  maxScore: number;
  /** 達到 maxScore 的精魔方式；不需要精魔（maxNow 已是最佳）時為 undefined */
  best?: EnchantScoreOption;
  /** 所有精魔方式，依精魔後分數排序 */
  options: EnchantScoreOption[];
  /** maxScore − scoreNow */
  gain: number;
}

/** 精魔後的分數（新屬性用寶石上限，其餘副屬性精煉到上限） */
function scoreAfterEnchant(
  rune: Rune,
  index: number,
  toT: number,
  toGem: number,
  toGrind: number,
): { rune: Rune; score: number; eff: number } {
  const projected = maxGrindRune(projectRune(rune, index, toT, toGem, toGrind));
  return {
    rune: projected,
    score: Math.round(runeScoreRaw(projected, true)),
    eff: runeEfficiency(projected, true).current,
  };
}

/**
 * 分數模式：找出「精魔一次＋精煉到上限」後能達到目標分數的符文。
 *
 * 和分類模式不同，這裡不要求符合任何自行分類，會枚舉所有合法的
 * 「換掉一條副屬性 → 轉成另一個屬性」（位置限制、重複屬性、只能再轉同一條等規則都照遊戲）。
 * 分數＝副屬性＋固有屬性（含精煉），不含主屬性與套裝；MAX 假設其他可精煉副屬性也拉滿。
 */
export function analyzeEnchantScore(
  runes: Rune[],
  owners?: Map<number, EnchantOwner>,
): EnchantScoreTarget[] {
  const stats = Object.keys(STAT_TYPES).map(Number);
  const out: EnchantScoreTarget[] = [];

  for (const rune of runes) {
    const sources = sortedGemSources(rune);
    if (sources.length === 0) continue;
    const hasMain = rune.main?.t > 0;
    const ancient = !!rune.ancient;

    const maxed = maxGrindRune(rune);
    const scoreNow = Math.round(runeScoreRaw(rune, true));
    const maxNow = Math.round(runeScoreRaw(maxed, true));

    const byKey = new Map<string, EnchantScoreOption>();
    for (const index of sources) {
      const source = rune.subs[index];
      if (!source) continue;
      for (const t of stats) {
        if (t === source.t) continue;
        // 新屬性不能和其他副屬性、主屬性、固有屬性重複
        if (rune.subs.some((s, i) => i !== index && s.t === t)) continue;
        if (hasMain && rune.main.t === t) continue;
        if (rune.prefix?.t === t) continue;
        if (!slotAllowsStat(rune.slot, t)) continue;
        const toGem = gemMaxValue(t, ancient);
        if (toGem <= 0) continue;
        const toGrind = enchantGrindMax(t, ancient);
        const key = `${index}:${t}`;
        if (byKey.has(key)) continue;

        const after = scoreAfterEnchant(rune, index, t, toGem, toGrind);
        // 精魔後不會比「只精煉到上限」更高，就不列為精魔選項
        if (after.score <= maxNow) continue;

        const grindPlan = rune.subs
          .map((s, i) => ({ s, i }))
          .filter(({ s, i }) => i !== index && grindMax(s.t, ancient) > 0 && (s.g ?? 0) < grindMax(s.t, ancient))
          .map(({ s }) => ({
            t: s.t,
            label: enchantStatLabel(s.t),
            from: s.v + (s.g ?? 0),
            to: s.v + grindMax(s.t, ancient),
          }));

        byKey.set(key, {
          fromIndex: index,
          fromT: source.t,
          fromLabel: enchantStatLabel(source.t),
          fromValue: source.v + (source.g ?? 0),
          alreadyGem: (source.gem ?? 0) > 0,
          toT: t,
          toLabel: enchantStatLabel(t),
          toGem,
          toGrind,
          toValue: toGem + toGrind,
          scoreAfter: after.score,
          gain: after.score - scoreNow,
          effAfter: after.eff,
          grindPlan,
        });
      }
    }

    const options = [...byKey.values()].sort(
      (a, b) => b.scoreAfter - a.scoreAfter || b.gain - a.gain || a.fromIndex - b.fromIndex,
    );
    const top = options[0];
    const maxScore = Math.max(maxNow, top?.scoreAfter ?? 0);
    out.push({
      rune,
      owner: owners?.get(rune.id),
      scoreNow,
      maxNow,
      maxScore,
      best: top && top.scoreAfter > maxNow ? top : undefined,
      options,
      gain: maxScore - scoreNow,
    });
  }

  return out;
}

export type EnchantScoreSort = "max-desc" | "now-desc" | "gain-desc" | "eff-desc";

export const ENCHANT_SCORE_SORTS: { key: EnchantScoreSort; label: string; desc: string }[] = [
  { key: "max-desc", label: "MAX 分數 高→低", desc: "精魔＋精煉到上限後的分數由高到低" },
  { key: "now-desc", label: "目前分數 高→低", desc: "目前遊戲分數由高到低" },
  { key: "gain-desc", label: "提升幅度 大→小", desc: "精魔後能增加的分數由多到少" },
  { key: "eff-desc", label: "精魔後效率 高→低", desc: "精魔後符文效率由高到低" },
];

export function sortEnchantScoreTargets(
  list: EnchantScoreTarget[],
  sort: EnchantScoreSort,
): EnchantScoreTarget[] {
  return [...list].sort((a, b) => {
    if (sort === "now-desc") return b.scoreNow - a.scoreNow || b.maxScore - a.maxScore;
    if (sort === "gain-desc") return b.gain - a.gain || b.maxScore - a.maxScore;
    if (sort === "eff-desc") {
      return (
        (b.best?.effAfter ?? 0) - (a.best?.effAfter ?? 0) ||
        b.maxScore - a.maxScore ||
        b.scoreNow - a.scoreNow
      );
    }
    return b.maxScore - a.maxScore || b.scoreNow - a.scoreNow || b.gain - a.gain;
  });
}

export type EnchantSort = "eff-desc" | "eff-asc" | "score-desc" | "score-asc" | "ready-desc";

export const ENCHANT_SORTS: { key: EnchantSort; label: string; desc: string }[] = [
  { key: "eff-desc", label: "效率 高→低", desc: "精魔後的符文效率由高到低" },
  { key: "eff-asc", label: "效率 低→高", desc: "精魔後的符文效率由低到高" },
  { key: "score-desc", label: "分數 高→低", desc: "精魔後的遊戲分數由高到低" },
  { key: "score-asc", label: "分數 低→高", desc: "精魔後的遊戲分數由低到高" },
  { key: "ready-desc", label: "最接近達標", desc: "精魔後效率提升最多、目前分數最高的排前面" },
];

/** 依效率 / 分數排序；同值時效率高的優先 */
export function sortEnchantTargets(list: EnchantTarget[], sort: EnchantSort): EnchantTarget[] {
  return [...list].sort((a, b) => {
    if (sort === "eff-asc") return a.bestEff - b.bestEff || b.bestScore - a.bestScore;
    if (sort === "score-desc") return b.bestScore - a.bestScore || b.bestEff - a.bestEff;
    if (sort === "score-asc") return a.bestScore - b.bestScore || b.bestEff - a.bestEff;
    if (sort === "ready-desc") {
      const ga = a.bestEff - a.effNow;
      const gb = b.bestEff - b.effNow;
      return gb - ga || b.effNow - a.effNow;
    }
    return b.bestEff - a.bestEff || b.bestScore - a.bestScore;
  });
}

/* ───────────────────────── 持有精魔石＋精煉石素材 ───────────────────────── */

/** 主屬性篩選的選項順序（1/3/5 固定值，2/4/6 百分比，8 速度，9–12 特殊） */
export const ENCHANT_MAIN_STATS = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12];

export const GEM_GRADE_LABEL: Record<number, string> = {
  1: "普通",
  2: "魔法",
  3: "稀有",
  4: "英雄",
  5: "傳說",
};

/** 持有素材：精魔用的寶石＋精魔後精煉用的磨石 */
export interface EnchantStock {
  gems: EnchantGem[];
  grindstones: Grindstone[];
}

/** 這顆寶石能不能用在這顆符文上（遠古 / 無形 / 同套裝規則，和磨石一致） */
export function gemFitsRune(rune: Rune, gem: EnchantGem): boolean {
  if (gem.amount <= 0) return false;
  if (rune.ancient) return gem.ancient && !gem.immemorial && gem.set === rune.set;
  return !gem.ancient && (gem.immemorial || gem.set === rune.set);
}

/** 持有、可用於這顆符文、且能精魔出指定屬性的寶石；等級高的優先 */
export function matchingEnchantGems(rune: Rune, stat: number, gems: EnchantGem[]): EnchantGem[] {
  return gems
    .filter((gem) => gem.stat === stat && gemFitsRune(rune, gem))
    .sort(
      (a, b) =>
        b.grade - a.grade ||
        Number(b.immemorial) - Number(a.immemorial) ||
        b.amount - a.amount ||
        a.set - b.set,
    );
}

/** 卡片上顯示的持有寶石文字，例如「迅速 效果抵抗寶石 ×2（傳說）」 */
export function heldGemLabel(rune: Rune, stat: number, gems: EnchantGem[]): string {
  const gem = matchingEnchantGems(rune, stat, gems)[0];
  if (!gem) return "";
  const set = gem.immemorial ? "無形" : SET_BY_ID[gem.set]?.name ?? `套裝 ${gem.set}`;
  const grade = GEM_GRADE_LABEL[gem.grade] ?? `${gem.grade} 級`;
  return `${set} ${enchantStatLabel(stat)}寶石 ×${gem.amount}（${grade}${gem.ancient ? "・遠古" : ""}）`;
}

/** 持有、可用於這顆符文且屬性正確的磨石；等級高的優先 */
function matchingGrindForEnchant(rune: Rune, stat: number, stock: EnchantStock): Grindstone[] {
  // need = 1：只要有能精煉這條屬性的磨石即可；等級只影響精煉上限，不影響能否使用
  return [...matchingGrindstones(rune, stat, 1, stock.grindstones)].sort(
    (a, b) => b.grade - a.grade || b.amount - a.amount,
  );
}

/** 一種精魔方式需要的素材是否都真的持有：寶石一定要有，需要精煉時還要有磨石 */
function hasEnchantMaterials(rune: Rune, toT: number, toGrind: number, stock: EnchantStock): boolean {
  if (matchingEnchantGems(rune, toT, stock.gems).length === 0) return false;
  // 暴率 / 暴傷 / 抵抗 / 命中不能精煉，不需要磨石
  if (toGrind <= 0) return true;
  return matchingGrindForEnchant(rune, toT, stock).length > 0;
}

/** 持有寶石對這條屬性能轉出的最大值（套裝規則正確、等級最高的那顆） */
export function gemValueFromStock(rune: Rune, stat: number, stock: EnchantStock): number {
  let best = 0;
  for (const gem of stock.gems) {
    if (gem.stat !== stat || !gemFitsRune(rune, gem)) continue;
    best = Math.max(best, gemStoneMax(stat, gem.grade, rune.ancient));
  }
  return best;
}

/** 持有磨石對這條屬性能精煉到的最大值（不超過該符文／遠古上限） */
export function grindValueFromStock(rune: Rune, stat: number, stock: EnchantStock): number {
  let best = 0;
  for (const stone of stock.grindstones) {
    // 磨石與寶石的套裝規則相同（gemFitsRune 只看欄位，可共用）
    if (stone.stat !== stat || !gemFitsRune(rune, stone)) continue;
    best = Math.max(best, grindStoneMax(stat, stone.grade, rune.ancient));
  }
  return Math.min(best, grindMax(stat, rune.ancient));
}

/** 把符文所有可精煉副屬拉到「持有磨石」的上限；已精煉得更高的保留原值 */
function grindRuneWithStock(rune: Rune, stock: EnchantStock): Rune {
  return {
    ...rune,
    subs: rune.subs.map((s) => ({ ...s, g: Math.max(s.g ?? 0, grindValueFromStock(rune, s.t, stock)) })),
  };
}

/** 卡片上顯示的持有素材：寶石＋（需要精煉時）磨石，含等級可加的最大值 */
export function heldMaterialsLabel(rune: Rune, toT: number, toGrind: number, stock: EnchantStock): string {
  const parts: string[] = [];
  const gem = matchingEnchantGems(rune, toT, stock.gems)[0];
  if (gem) {
    const set = gem.immemorial ? "無形" : SET_BY_ID[gem.set]?.name ?? `套裝 ${gem.set}`;
    const grade = GEM_GRADE_LABEL[gem.grade] ?? `${gem.grade} 級`;
    parts.push(
      `${set} ${enchantStatLabel(toT)}寶石 ×${gem.amount}（${grade} +${gemStoneMax(toT, gem.grade, rune.ancient)}${gem.ancient ? "・遠古" : ""}）`,
    );
  }
  if (toGrind > 0) {
    const stone = matchingGrindForEnchant(rune, toT, stock)[0];
    if (stone) {
      const set = stone.immemorial ? "無形" : SET_BY_ID[stone.set]?.name ?? `套裝 ${stone.set}`;
      const grade = GRIND_GRADE_LABEL[stone.grade] ?? `${stone.grade} 級`;
      parts.push(
        `${set} ${enchantStatLabel(toT)}磨石 ×${stone.amount}（${grade} +${grindStoneMax(toT, stone.grade, rune.ancient)}${stone.ancient ? "・遠古" : ""}）`,
      );
    }
  }
  return parts.join(" · ");
}

/** 只用持有素材（寶石等級＋磨石等級），這顆符文精魔＋精滿後最多能到幾分 */
export function maxScoreWithEnchantStock(target: EnchantScoreTarget, stock: EnchantStock): number {
  const rune = target.rune;
  let best = Math.round(runeScoreRaw(grindRuneWithStock(rune, stock), true));
  for (const o of target.options) {
    const gem = gemValueFromStock(rune, o.toT, stock);
    if (gem <= 0) continue;
    const grind = grindValueFromStock(rune, o.toT, stock);
    const projected = grindRuneWithStock(projectRune(rune, o.fromIndex, o.toT, gem, grind), stock);
    best = Math.max(best, Math.round(runeScoreRaw(projected, true)));
  }
  return best;
}

/** 分類模式：只保留「真的持有寶石＋磨石」的精魔方式；沒有完整素材時回傳 null */
export function filterEnchantByStock(target: EnchantTarget, stock: EnchantStock): EnchantTarget | null {
  const options = target.options.filter((o) => hasEnchantMaterials(target.rune, o.toT, o.toGrind, stock));
  if (options.length === 0) return null;
  return {
    ...target,
    options,
    ruleIds: [...new Set(options.flatMap((o) => o.rules.map((r) => r.id)))],
    bestEff: Math.max(...options.map((o) => o.effAfter)),
    bestScore: Math.max(...options.map((o) => o.scoreAfter)),
  };
}

/**
 * 分數模式：素材齊全才留下，並把分數／效率從「傳說上限估算」改成
 * 「用持有的寶石等級＋磨石等級精滿」的實際可達值。
 */
export function filterEnchantScoreByStock(
  target: EnchantScoreTarget,
  stock: EnchantStock,
): EnchantScoreTarget | null {
  const rune = target.rune;
  const maxNow = Math.round(runeScoreRaw(grindRuneWithStock(rune, stock), true));
  const options: EnchantScoreOption[] = [];

  for (const o of target.options) {
    const gem = gemValueFromStock(rune, o.toT, stock);
    const grind = grindValueFromStock(rune, o.toT, stock);
    if (gem <= 0 || (o.toGrind > 0 && grind <= 0)) continue;
    const projected = grindRuneWithStock(projectRune(rune, o.fromIndex, o.toT, gem, grind), stock);
    const scoreAfter = Math.round(runeScoreRaw(projected, true));
    // 用持有素材反而沒有純精煉高，就不算精魔選項
    if (scoreAfter <= maxNow) continue;
    const grindPlan = rune.subs
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => i !== o.fromIndex && grindValueFromStock(rune, s.t, stock) > (s.g ?? 0))
      .map(({ s }) => ({
        t: s.t,
        label: enchantStatLabel(s.t),
        from: s.v + (s.g ?? 0),
        to: s.v + grindValueFromStock(rune, s.t, stock),
      }));
    options.push({
      ...o,
      toGem: gem,
      toGrind: grind,
      toValue: gem + grind,
      scoreAfter,
      gain: scoreAfter - target.scoreNow,
      effAfter: runeEfficiency(projected, true).current,
      grindPlan,
    });
  }

  options.sort((a, b) => b.scoreAfter - a.scoreAfter || b.gain - a.gain || a.fromIndex - b.fromIndex);
  const top = options[0];
  // 素材不足或只精煉就已是最佳，不列入「持有素材」清單
  if (!top) return null;
  return {
    ...target,
    maxNow,
    options,
    best: top,
    maxScore: top.scoreAfter,
    gain: top.scoreAfter - target.scoreNow,
  };
}
