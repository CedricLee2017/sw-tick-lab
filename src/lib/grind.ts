/**
 * 精煉（磨石）建議：依符文素質、套裝、裝備對象與目前精煉值，
 * 排出「先精煉哪一顆、精煉哪條副屬性」的順序。
 *
 * 遊戲限制：磨石只能用在同套裝的符文，而且只支援
 * 體力 / 攻擊力 / 防禦力（固定值與 %）與速度；
 * 暴擊率、暴擊傷害、效果命中、效果抵抗不能用磨石（要用寶石）。
 */
import { SET_BY_ID, STAT_TYPES } from "./constants";
import { runeEfficiency } from "./stats";
import type { Rune } from "./types";

export type GrindProfile = "speed" | "balanced" | "damage" | "tank" | "support";

export const GRIND_PROFILES: { key: GrindProfile; label: string; desc: string }[] = [
  { key: "speed", label: "速度優先", desc: "PVP 搶一速：速度最優先，其次體力% / 防禦%" },
  { key: "balanced", label: "均衡", desc: "速度、生存與輸出平均發展" },
  { key: "damage", label: "輸出", desc: "攻擊% / 暴擊 / 暴傷為主，速度次之" },
  { key: "tank", label: "坦度", desc: "體力% / 防禦% 為主，適合坦隊與據點戰" },
  { key: "support", label: "輔助", desc: "速度、體力%、防禦% 與效果命中" },
];

/** 精煉接受程度：10 = 傳說精滿，9 / 8 各降一分 */
export type GrindAccept = 8 | 9 | 10;

export const GRIND_ACCEPT_LEVELS: { value: GrindAccept; label: string; hint: string }[] = [
  { value: 10, label: "10 分", hint: "體攻防% 13+10、速度 10+5、爆率/爆傷 13" },
  { value: 9, label: "9 分", hint: "體攻防% 12+9、速度 9+4、爆率/爆傷 12" },
  { value: 8, label: "8 分", hint: "體攻防% 11+8、速度 8+3、爆率/爆傷 11" },
];

/** 可精煉副屬性的權重（type id → 0~100） */
const WEIGHTS: Record<GrindProfile, Record<number, number>> = {
  speed: { 8: 100, 2: 44, 6: 38, 4: 28, 1: 4, 3: 3, 5: 3 },
  balanced: { 8: 70, 2: 55, 6: 50, 4: 45, 1: 6, 3: 5, 5: 5 },
  damage: { 8: 55, 4: 70, 2: 20, 6: 18, 1: 3, 3: 3, 5: 3 },
  tank: { 8: 45, 2: 82, 6: 78, 4: 14, 1: 10, 5: 7, 3: 3 },
  support: { 8: 88, 2: 58, 6: 55, 4: 18, 1: 5, 5: 4, 3: 3 },
};

/** 判斷「這顆符文有幾條好副屬性」用的權重（含不能精煉的屬性） */
const SUB_VALUE_WEIGHTS: Record<GrindProfile, Record<number, number>> = {
  speed: { 8: 100, 2: 50, 6: 45, 4: 35, 9: 35, 10: 25, 11: 15, 12: 20, 1: 3, 3: 3, 5: 3 },
  balanced: { 8: 70, 2: 55, 6: 50, 4: 45, 9: 40, 10: 40, 11: 25, 12: 25, 1: 5, 3: 4, 5: 4 },
  damage: { 8: 55, 4: 70, 9: 60, 10: 65, 2: 20, 6: 18, 11: 10, 12: 10, 1: 3, 3: 3, 5: 3 },
  tank: { 8: 45, 2: 82, 6: 78, 11: 35, 12: 25, 4: 14, 9: 15, 10: 15, 1: 8, 3: 3, 5: 6 },
  support: { 8: 88, 2: 58, 6: 55, 12: 45, 11: 40, 4: 18, 9: 15, 10: 15, 1: 5, 3: 3, 5: 4 },
};

/** 傳說磨石的最大加成（磨石等級：魔法 < 稀有 < 英雄 < 傳說） */
export const GRIND_MAX: Record<number, number> = {
  8: 5, // 速度
  2: 10, // 體力%
  4: 10, // 攻擊力%
  6: 10, // 防禦力%
  1: 550, // 體力
  3: 30, // 攻擊力
  5: 30, // 防禦力
};

/** 各等級磨石的最大加成，用來說明「用哪種石頭可加多少」 */
export const GRIND_STONE_MAX: Record<number, { magic: number; rare: number; hero: number; legend: number }> = {
  8: { magic: 2, rare: 3, hero: 4, legend: 5 },
  2: { magic: 5, rare: 6, hero: 7, legend: 10 },
  4: { magic: 5, rare: 6, hero: 7, legend: 10 },
  6: { magic: 5, rare: 6, hero: 7, legend: 10 },
  1: { magic: 200, rare: 250, hero: 450, legend: 550 },
  3: { magic: 12, rare: 18, hero: 22, legend: 30 },
  5: { magic: 12, rare: 18, hero: 22, legend: 30 },
};

const PROFILE_SETS: Record<GrindProfile, number[]> = {
  speed: [3, 15, 13],
  balanced: [13, 15, 3],
  damage: [5, 4, 8, 13],
  tank: [1, 2, 16, 13],
  support: [13, 15, 6, 7],
};

/** 只在這些屬性中計入「好副屬性」的數量 */
const VALUE_SUB_THRESHOLD = 45;

const PCT_TYPES = new Set([2, 4, 6, 9, 10, 11, 12]);

export function grindStatLabel(t: number): string {
  return STAT_TYPES[t]?.label ?? "?";
}

export function grindStatSuffix(t: number): string {
  return PCT_TYPES.has(t) ? "%" : "";
}

/**
 * 接受程度評分：每一條重要副屬性以「寶石 + 精煉」的完美總值為 10 分，
 * 每降一分 = 寶石 -1、精煉 -1（總值 -2）。
 *
 *   體力% / 攻擊力% / 防禦力%：10 分 = 13 + 10 = 23
 *   速度：10 分 = 10 + 5 = 15
 *   暴擊率 / 暴擊傷害：10 分 = 13（磨石不可用，只算寶石）
 */
const PERFECT_GEM: Record<number, number> = { 2: 13, 4: 13, 6: 13, 8: 10, 9: 13, 10: 13 };
const PERFECT_GRIND: Record<number, number> = { 2: 10, 4: 10, 6: 10, 8: 5, 9: 0, 10: 0 };
const PERFECT_TOTAL: Record<number, number> = { 2: 23, 4: 23, 6: 23, 8: 15, 9: 13, 10: 13 };

/** 這條副屬性的接受目標（寶石 + 精煉）；不列入評分的屬性回傳 null */
export function acceptTarget(t: number, accept: GrindAccept): { gem: number; grind: number; total: number } | null {
  const perfect = PERFECT_TOTAL[t];
  if (perfect == null) return null;
  const drop = 10 - accept;
  const gem = Math.max(0, (PERFECT_GEM[t] ?? 0) - drop);
  const grind = Math.max(0, (PERFECT_GRIND[t] ?? 0) - drop);
  return { gem, grind, total: perfect - 2 * drop };
}

/** 副屬性分數：10 / 9 / 8；低於 8 分回傳 7。不列入評分回傳 null */
export function subScore(t: number, current: number): number | null {
  const perfect = PERFECT_TOTAL[t];
  if (perfect == null) return null;
  let score = 10;
  while (score > 8 && current < perfect - 2 * (10 - score)) score -= 1;
  return current >= perfect - 2 * (10 - 8) ? score : 7;
}

/** 符文速度：速度副屬性（含精煉）＋ 速度 prefix */
export function runeSpeed(rune: Rune): number {
  let spd = 0;
  for (const s of rune.subs) if (s.t === 8) spd += s.v + (s.g ?? 0);
  if (rune.prefix?.t === 8) spd += rune.prefix.v;
  return spd;
}

export interface SubScoreInfo {
  t: number;
  label: string;
  suffix: string;
  /** 目前總值（數值 + 精煉） */
  current: number;
  score: number;
  /** 接受程度對應的寶石 / 精煉目標 */
  gem: number;
  grind: number;
  target: number;
  grindable: boolean;
}

export interface GrindOwner {
  name: string;
  unitId: number;
}

export interface GrindOption {
  t: number;
  label: string;
  suffix: string;
  /** 目前副屬性數值（不含精煉） */
  current: number;
  /** 目前已精煉的加成 */
  grind: number;
  /** 傳說石可加到多少 */
  maxGrind: number;
  /** 還能再加多少 */
  headroom: number;
  /** 屬性權重 0~100 */
  weight: number;
  /** 這條副屬性的推薦分（權重 × 可提升比例） */
  value: number;
}

export interface GrindTarget {
  rune: Rune;
  owner: string | null;
  ownerUnitId: number | null;
  options: GrindOption[];
  best: GrindOption;
  /** 未取整的推薦分，用來排序 */
  rawScore: number;
  /** 0~100 的顯示分數 */
  score: number;
  tier: "high" | "mid" | "low";
  effNow: number;
  /** 把最佳副屬性精煉到上限後的效率 */
  effAfter: number;
  setMatch: boolean;
  reasons: string[];
  /** 符文速度（速度副屬性含精煉 + 速度 prefix） */
  speed: number;
  /** 每條重要副屬性的接受程度分數 */
  subScores: SubScoreInfo[];
  /** 可精煉副屬性中最低的分數（沒有可評分項目時為 null） */
  acceptScore: number | null;
}

export interface GrindFilter {
  profile: GrindProfile;
  owners?: Map<number, GrindOwner>;
  /** 只考慮這些屬性；null / 空 = 全部 */
  stat?: number | number[] | null;
  /** 速度優先模式：只留下未達此接受程度的符文 */
  accept?: GrindAccept;
}

const GRADE_FACTOR = [0, 0.35, 0.5, 0.68, 0.82, 0.92, 1];

function statSet(stat: number | number[] | null | undefined): Set<number> | null {
  if (stat == null) return null;
  const arr = Array.isArray(stat) ? stat : [stat];
  const set = new Set(arr.filter((t) => GRIND_MAX[t] != null));
  return set.size ? set : null;
}

/** 分析單顆符文，回傳可精煉的副屬性（依推薦分排序） */
export function analyzeRune(
  rune: Rune,
  profile: GrindProfile,
  owner?: GrindOwner,
  onlyStat?: Set<number> | null,
  accept: GrindAccept = 10,
): GrindTarget | null {
  const weights = WEIGHTS[profile];
  const options: GrindOption[] = [];
  for (const s of rune.subs) {
    const maxGrind = GRIND_MAX[s.t];
    if (maxGrind == null) continue;
    if (onlyStat && !onlyStat.has(s.t)) continue;
    const headroom = Math.max(0, maxGrind - (s.g ?? 0));
    if (headroom <= 0) continue;
    const weight = weights[s.t] ?? 0;
    if (weight <= 0) continue;
    options.push({
      t: s.t,
      label: grindStatLabel(s.t),
      suffix: grindStatSuffix(s.t),
      current: s.v,
      grind: s.g ?? 0,
      maxGrind,
      headroom,
      weight,
      value: weight * (headroom / maxGrind),
    });
  }
  if (!options.length) return null;
  options.sort((a, b) => b.value - a.value);
  const best = options[0];

  const subScores: SubScoreInfo[] = [];
  for (const s of rune.subs) {
    const target = acceptTarget(s.t, accept);
    const sc = subScore(s.t, s.v + (s.g ?? 0));
    if (!target || sc == null) continue;
    subScores.push({
      t: s.t,
      label: grindStatLabel(s.t),
      suffix: grindStatSuffix(s.t),
      current: s.v + (s.g ?? 0),
      score: sc,
      gem: target.gem,
      grind: target.grind,
      target: target.total,
      grindable: GRIND_MAX[s.t] != null && GRIND_MAX[s.t] > 0,
    });
  }
  // 未達標只看可用磨石精煉的屬性（速度、體 / 攻 / 防%）
  const scoredGrindable = subScores.filter((s) => s.grindable);
  const acceptScore = scoredGrindable.length ? Math.min(...scoredGrindable.map((s) => s.score)) : null;
  const speed = runeSpeed(rune);

  const effNow = rune.eff;
  const effAfter = runeEfficiency(
    { ...rune, subs: rune.subs.map((s) => (s.t === best.t ? { ...s, g: best.maxGrind } : s)) },
    true,
  ).current;

  const goodSubs = rune.subs.filter((s) => (SUB_VALUE_WEIGHTS[profile][s.t] ?? 0) >= VALUE_SUB_THRESHOLD).length;
  const setMatch = PROFILE_SETS[profile].includes(rune.set);
  const gradeFactor = GRADE_FACTOR[Math.min(6, Math.max(0, rune.grade))] ?? 0.35;
  const effFactor = 0.8 + (Math.min(120, Math.max(0, effNow)) / 120) * 0.45;
  const ownerFactor = owner ? 1.12 : 0.82;
  const setFactor = setMatch ? 1.06 : 1;
  const multiFactor = 1 + Math.min(0.12, 0.04 * Math.max(0, goodSubs - 1));
  const rawScore = best.value * gradeFactor * effFactor * ownerFactor * setFactor * multiFactor;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const tier: GrindTarget["tier"] = rawScore >= 60 ? "high" : rawScore >= 35 ? "mid" : "low";

  const reasons: string[] = [];
  if (owner) reasons.push(`裝備於 ${owner.name}`);
  else reasons.push("未裝備");
  if (rune.grade >= 6) reasons.push("6★ 符文");
  else reasons.push(`${rune.grade}★ 符文（建議用較低階石頭）`);
  reasons.push(`效率 ${Math.round(effNow)}%`);
  if (setMatch) reasons.push(`套裝契合（${SET_BY_ID[rune.set]?.name ?? "?"}）`);
  if (best.grind > 0) reasons.push(`已精煉 +${best.grind}，還可再提升`);
  if (best.t === 8) reasons.push("速度是稀有資源，優先度高");
  if (goodSubs >= 3) reasons.push(`有 ${goodSubs} 條好副屬性`);

  return {
    rune,
    owner: owner?.name ?? null,
    ownerUnitId: owner?.unitId ?? null,
    options,
    best,
    rawScore,
    score,
    tier,
    effNow,
    effAfter,
    setMatch,
    reasons,
    speed,
    subScores,
    acceptScore,
  };
}

/** 分析全部符文；速度優先模式依「未達接受程度 → 符文速度」排序 */
export function analyzeGrind(runes: Rune[], filter: GrindFilter): GrindTarget[] {
  const onlyStat = statSet(filter.stat);
  const accept = filter.accept ?? 10;
  const out: GrindTarget[] = [];
  for (const rune of runes) {
    const t = analyzeRune(rune, filter.profile, filter.owners?.get(rune.id), onlyStat, accept);
    if (t) out.push(t);
  }
  // 速度優先：只留下還有可精煉屬性、而且未達接受程度的符文，依速度由高到低
  if (filter.profile === "speed") {
    return out
      .filter((t) => t.acceptScore != null && t.acceptScore < accept)
      .sort(
        (a, b) =>
          b.speed - a.speed ||
          (b.acceptScore ?? 0) - (a.acceptScore ?? 0) ||
          b.rune.grade - a.rune.grade ||
          b.effNow - a.effNow,
      );
  }
  out.sort((a, b) => b.rawScore - a.rawScore || b.rune.grade - a.rune.grade || b.effNow - a.effNow);
  return out;
}

/** 目前精煉值距離各等級磨石上限還差多少（給詳細說明用） */
export function stoneGain(option: GrindOption): { label: string; gain: number }[] {
  const max = GRIND_STONE_MAX[option.t];
  if (!max) return [];
  return [
    { label: "魔法", gain: Math.max(0, max.magic - option.grind) },
    { label: "稀有", gain: Math.max(0, max.rare - option.grind) },
    { label: "英雄", gain: Math.max(0, max.hero - option.grind) },
    { label: "傳說", gain: Math.max(0, max.legend - option.grind) },
  ];
}
