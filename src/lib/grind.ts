/**
 * 精煉（磨石）建議：依符文素質、套裝、裝備對象與目前精煉值，
 * 排出「先精煉哪一顆、精煉哪條副屬性」的順序。
 *
 * 遊戲限制：磨石只能用在同套裝的符文，而且只支援
 * 體力 / 攻擊力 / 防禦力（固定值與 %）與速度；
 * 暴擊率、暴擊傷害、效果命中、效果抵抗不能用磨石（要用寶石）。
 */
import { SET_BY_ID, STAT_TYPES } from "./constants";
import { runeEfficiency, runeScoreRaw, scoreOfStat } from "./stats";
import type { Grindstone, Rune } from "./types";

export type GrindProfile = "speed" | "score" | "damage" | "tank" | "support";

export const GRIND_PROFILES: { key: GrindProfile; label: string; desc: string }[] = [
  { key: "speed", label: "速度優先", desc: "PVP 搶一速：速度最優先，其次體力% / 防禦%" },
  { key: "score", label: "分數", desc: "輸入目標分數，列出精煉後能達標的符文與精煉方式" },
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
  score: { 8: 100, 2: 75, 6: 75, 4: 75, 1: 1, 3: 10, 5: 10 },
  damage: { 8: 55, 4: 70, 2: 20, 6: 18, 1: 3, 3: 3, 5: 3 },
  tank: { 8: 45, 2: 82, 6: 78, 4: 14, 1: 10, 5: 7, 3: 3 },
  support: { 8: 88, 2: 58, 6: 55, 4: 18, 1: 5, 5: 4, 3: 3 },
};

/** 判斷「這顆符文有幾條好副屬性」用的權重（含不能精煉的屬性） */
const SUB_VALUE_WEIGHTS: Record<GrindProfile, Record<number, number>> = {
  speed: { 8: 100, 2: 50, 6: 45, 4: 35, 9: 35, 10: 25, 11: 15, 12: 20, 1: 3, 3: 3, 5: 3 },
  score: { 8: 100, 9: 100, 10: 86, 2: 75, 6: 75, 4: 75, 11: 75, 12: 75, 1: 3, 3: 3, 5: 3 },
  damage: { 8: 55, 4: 70, 9: 60, 10: 65, 2: 20, 6: 18, 11: 10, 12: 10, 1: 3, 3: 3, 5: 3 },
  tank: { 8: 45, 2: 82, 6: 78, 11: 35, 12: 25, 4: 14, 9: 15, 10: 15, 1: 8, 3: 3, 5: 6 },
  support: { 8: 88, 2: 58, 6: 55, 12: 45, 11: 40, 4: 18, 9: 15, 10: 15, 1: 5, 3: 3, 5: 4 },
};

/** 一般（非遠古）磨石的最大加成（磨石等級：魔法 < 稀有 < 英雄 < 傳說） */
export const GRIND_MAX: Record<number, number> = {
  8: 5, // 速度
  2: 10, // 體力%
  4: 10, // 攻擊力%
  6: 10, // 防禦力%
  1: 550, // 體力
  3: 30, // 攻擊力
  5: 30, // 防禦力
};

/** 遠古磨石的最大加成（只能用在遠古符文） */
export const ANCIENT_GRIND_MAX: Record<number, number> = {
  8: 6,
  2: 12,
  4: 12,
  6: 12,
  1: 610,
  3: 34,
  5: 34,
};

/** 這顆符文實際可精煉到的上限：遠古符文用遠古磨石的上限 */
export function grindMax(t: number, ancient = false): number {
  return (ancient ? ANCIENT_GRIND_MAX[t] : GRIND_MAX[t]) ?? 0;
}

export const GRIND_GRADE_LABEL: Record<number, string> = {
  1: "普通",
  2: "魔法",
  3: "稀有",
  4: "英雄",
  5: "傳說",
};

/** 各等級磨石的最大加成（[等級][屬性]） */
const STONE_MAX_NORMAL: Record<number, Record<number, number>> = {
  1: { 8: 1, 2: 2, 4: 2, 6: 2, 1: 100, 3: 6, 5: 6 },
  2: { 8: 2, 2: 5, 4: 5, 6: 5, 1: 200, 3: 12, 5: 12 },
  3: { 8: 3, 2: 6, 4: 6, 6: 6, 1: 250, 3: 18, 5: 18 },
  4: { 8: 4, 2: 7, 4: 7, 6: 7, 1: 450, 3: 22, 5: 22 },
  5: { 8: 5, 2: 10, 4: 10, 6: 10, 1: 550, 3: 30, 5: 30 },
};
const STONE_MAX_ANCIENT: Record<number, Record<number, number>> = {
  1: { 8: 2, 2: 5, 4: 5, 6: 5, 1: 180, 3: 12, 5: 12 },
  2: { 8: 3, 2: 7, 4: 7, 6: 7, 1: 260, 3: 16, 5: 16 },
  3: { 8: 4, 2: 8, 4: 8, 6: 8, 1: 310, 3: 22, 5: 22 },
  4: { 8: 5, 2: 9, 4: 9, 6: 9, 1: 510, 3: 26, 5: 26 },
  5: { 8: 6, 2: 12, 4: 12, 6: 12, 1: 610, 3: 34, 5: 34 },
};

/** 某個等級（1 普通～5 傳說）的磨石，對這條屬性最多能加多少 */
export function grindStoneMax(stat: number, grade: number, ancient = false): number {
  const g = Math.min(5, Math.max(1, Math.round(grade)));
  return (ancient ? STONE_MAX_ANCIENT[g] : STONE_MAX_NORMAL[g])?.[stat] ?? 0;
}

/** 要把這條屬性精煉到 need，最低需要哪個等級的磨石 */
export function grindGradeFor(stat: number, need: number, ancient = false): string {
  for (let grade = 1; grade <= 5; grade += 1) {
    if (grindStoneMax(stat, grade, ancient) >= need) return GRIND_GRADE_LABEL[grade];
  }
  return "—";
}

/** 各等級磨石的最大加成（一般符文），用來說明「用哪種石頭可加多少」 */
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
  score: [13, 15, 3],
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
  /** 目前遊戲內符文分數 */
  gameScore: number;
  /** 全部可精煉屬性都精煉到傳說上限後的遊戲分數 */
  maxGameScore: number;
}

export interface GrindFilter {
  profile: GrindProfile;
  owners?: Map<number, GrindOwner>;
  /** 只考慮這些屬性；null / 空 = 全部 */
  stat?: number | number[] | null;
  /** 速度優先模式：只留下未達此接受程度的符文 */
  accept?: GrindAccept;
  /** 分數模式：只留下精煉後能達到此分數的符文 */
  targetScore?: number;
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
    const maxGrind = grindMax(s.t, rune.ancient);
    if (maxGrind <= 0) continue;
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
      grindable: grindMax(s.t, rune.ancient) > 0,
    });
  }
  // 未達標只看可用磨石精煉的屬性（速度、體 / 攻 / 防%）
  const scoredGrindable = subScores.filter((s) => s.grindable);
  const acceptScore = scoredGrindable.length ? Math.min(...scoredGrindable.map((s) => s.score)) : null;
  const speed = runeSpeed(rune);

  const gameScoreRaw = runeScoreRaw(rune);
  let maxGameScoreRaw = gameScoreRaw;
  // 只計算畫面上實際可用的精煉選項（會受屬性篩選影響）
  for (const o of options) maxGameScoreRaw += o.headroom * scoreOfStat(o.t, 1);

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
    gameScore: Math.round(gameScoreRaw),
    maxGameScore: Math.round(maxGameScoreRaw),
  };
}

export interface ScorePlanStep {
  t: number;
  label: string;
  suffix: string;
  /** 副屬性目前數值（不含精煉） */
  base: number;
  /** 目前精煉值 */
  from: number;
  /** 要精煉到的值 */
  to: number;
  /** 這一步能增加的分數 */
  gain: number;
  /** 至少需要的磨石等級 */
  grade: string;
}

/**
 * 計算「要到達目標分數，最少要精煉哪幾條、各加到多少」。
 * 依每點數值的分數效益由高到低分配（速度／爆率 3.33、暴傷 2.86、體攻防% 2.5…）。
 *
 * `caps` 可指定每條屬性「用目前持有的磨石最多能到多少（含現有精煉值）」；
 * 未提供時以該符文可用的最高等級磨石（遠古符文用遠古上限）估算。
 */
export function planScore(
  target: GrindTarget,
  targetScore: number,
  caps?: Record<number, number>,
): ScorePlanStep[] {
  let need = targetScore - target.gameScore;
  if (need <= 0) return [];
  const candidates = target.options
    .filter((o) => o.headroom > 0)
    .map((o) => {
      const cap = caps ? (caps[o.t] ?? o.grind) : o.maxGrind;
      return { o, per: scoreOfStat(o.t, 1), headroom: Math.max(0, Math.min(o.headroom, cap - o.grind)) };
    })
    .filter((c) => c.headroom > 0 && c.per > 0)
    .sort((a, b) => b.per - a.per);

  const steps: ScorePlanStep[] = [];
  for (const { o, per, headroom } of candidates) {
    if (need <= 0) break;
    const add = Math.min(headroom, Math.ceil(need / per - 1e-9));
    if (add <= 0) continue;
    const to = o.grind + add;
    steps.push({
      t: o.t,
      label: o.label,
      suffix: o.suffix,
      base: o.current,
      from: o.grind,
      to,
      gain: add * per,
      grade: grindGradeFor(o.t, to, target.rune.ancient),
    });
    need -= add * per;
  }
  return steps;
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
  // 分數：只留下精煉後能達到目標分數的符文；先列還未達標的，再列已達標的
  if (filter.profile === "score") {
    const targetScore = filter.targetScore ?? 0;
    return out
      .filter((t) => t.maxGameScore >= targetScore)
      .sort((a, b) => {
        const aMet = a.gameScore >= targetScore ? 1 : 0;
        const bMet = b.gameScore >= targetScore ? 1 : 0;
        return (
          aMet - bMet ||
          b.gameScore - a.gameScore ||
          b.maxGameScore - a.maxGameScore ||
          b.rune.grade - a.rune.grade ||
          b.effNow - a.effNow
        );
      });
  }
  out.sort((a, b) => b.rawScore - a.rawScore || b.rune.grade - a.rune.grade || b.effNow - a.effNow);
  return out;
}

/** 排列順序：預設沿用各模式的排序，或改成依「目前遊戲分數」排序 */
export type GrindSort = "default" | "score-desc" | "score-asc";

export const GRIND_SORTS: { key: GrindSort; label: string; desc: string }[] = [
  { key: "default", label: "預設排序", desc: "依模式預設（分數模式先列未達標，再依目前分數高→低）" },
  { key: "score-desc", label: "目前分數 高→低", desc: "依符文目前的遊戲分數由高到低" },
  { key: "score-asc", label: "目前分數 低→高", desc: "依符文目前的遊戲分數由低到高" },
];

/** 依指定順序排列分析結果；default 保留 analyzeGrind 原本的排序 */
export function sortGrindTargets(targets: GrindTarget[], sort: GrindSort): GrindTarget[] {
  if (sort === "default") return targets;
  const dir = sort === "score-asc" ? 1 : -1;
  return [...targets].sort(
    (a, b) =>
      (a.gameScore - b.gameScore) * dir ||
      (a.maxGameScore - b.maxGameScore) * dir ||
      b.rune.grade - a.rune.grade ||
      b.effNow - a.effNow,
  );
}

/** 目前精煉值距離各等級磨石上限還差多少（給詳細說明用） */
export function stoneGain(option: GrindOption, ancient = false): { label: string; gain: number }[] {
  return [
    { label: "魔法", gain: Math.max(0, grindStoneMax(option.t, 2, ancient) - option.grind) },
    { label: "稀有", gain: Math.max(0, grindStoneMax(option.t, 3, ancient) - option.grind) },
    { label: "英雄", gain: Math.max(0, grindStoneMax(option.t, 4, ancient) - option.grind) },
    { label: "傳說", gain: Math.max(0, grindStoneMax(option.t, 5, ancient) - option.grind) },
  ];
}

/** 這顆磨石能不能用在這顆符文上 */
function stoneFitsRune(rune: Rune, stone: Grindstone): boolean {
  if (stone.amount <= 0) return false;
  if (rune.ancient) {
    // 遠古符文只能用同套裝的遠古磨石
    return stone.ancient && !stone.immemorial && stone.set === rune.set;
  }
  // 一般符文：同套裝的一般磨石，或無形磨石（不限套裝）
  return !stone.ancient && (stone.immemorial || stone.set === rune.set);
}

/**
 * 以目前持有的磨石，這顆符文每條可精煉屬性最多能到多少（含現有精煉值）。
 * 回傳值可直接傳給 planScore 的 caps。
 */
export function grindCapsFromStock(rune: Rune, stock: Grindstone[]): Record<number, number> {
  const caps: Record<number, number> = {};
  for (const s of rune.subs) {
    const max = grindMax(s.t, rune.ancient);
    if (max <= 0) continue;
    let best = 0;
    for (const stone of stock) {
      if (stone.stat !== s.t || !stoneFitsRune(rune, stone)) continue;
      const value = grindStoneMax(s.t, stone.grade, rune.ancient);
      if (value > best) best = value;
    }
    caps[s.t] = Math.min(max, Math.max(s.g ?? 0, best));
  }
  return caps;
}

/** 符合這條精煉需求（要把精煉值加到 need）的持有磨石，依等級低到高排序 */
export function matchingGrindstones(
  rune: Rune,
  stat: number,
  need: number,
  stock: Grindstone[],
): Grindstone[] {
  if (need <= 0) return [];
  return stock
    .filter(
      (stone) =>
        stone.stat === stat &&
        stoneFitsRune(rune, stone) &&
        grindStoneMax(stat, stone.grade, rune.ancient) >= need,
    )
    .sort(
      (a, b) =>
        a.grade - b.grade ||
        Number(a.immemorial) - Number(b.immemorial) ||
        b.amount - a.amount,
    );
}

export interface GrindMaterialRow {
  /** 屬性 type id */
  t: number;
  label: string;
  /** 要精煉到的總值（含精煉） */
  need: number;
  /** 會用到的持有磨石；沒有素材時為 null */
  stone: Grindstone | null;
}

/** 把精煉計畫轉成「需要哪些磨石」；沒有素材的步驟 stone 會是 null */
export function planMaterials(
  rune: Rune,
  steps: ScorePlanStep[],
  stock: Grindstone[],
): { ok: boolean; rows: GrindMaterialRow[] } {
  const rows: GrindMaterialRow[] = steps.map((step) => ({
    t: step.t,
    label: step.label,
    need: step.to,
    stone: matchingGrindstones(rune, step.t, step.to, stock)[0] ?? null,
  }));
  return { ok: rows.every((row) => row.stone !== null), rows };
}

/**
 * 依持有素材計算精煉計畫。`reachable` 代表真的能把分數推到目標，
 * 不只是理論上精煉到傳說上限。
 */
export function planWithStock(
  target: GrindTarget,
  targetScore: number,
  stock: Grindstone[],
): { plan: ScorePlanStep[]; reachable: boolean } {
  const plan = planScore(target, targetScore, grindCapsFromStock(target.rune, stock));
  const gain = plan.reduce((sum, step) => sum + step.gain, 0);
  return { plan, reachable: target.gameScore + gain >= targetScore - 1e-6 };
}

/** 只用目前持有的磨石，這顆符文最多能到幾分 */
export function maxScoreWithStock(target: GrindTarget, stock: Grindstone[]): number {
  const caps = grindCapsFromStock(target.rune, stock);
  let raw = runeScoreRaw(target.rune);
  for (const option of target.options) {
    const cap = caps[option.t] ?? option.grind;
    const headroom = Math.max(0, Math.min(option.headroom, cap - option.grind));
    raw += headroom * scoreOfStat(option.t, 1);
  }
  return Math.round(raw);
}
