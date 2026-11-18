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
import { STAT_TYPES } from "./constants";
import { grindMax } from "./grind";
import { runeEfficiency, runeScore, runeScoreRaw } from "./stats";
import { matchesRuneTag, runeStatValue, tagRequiredMatches } from "./runeTags";
import type { Rune, RuneTagRule } from "./types";

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
