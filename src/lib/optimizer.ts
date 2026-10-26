/** 配符運算引擎（分支定界） */
import { SPD_TYPE, SUB_STAT_MAX, STAT_TYPES, SET_BY_ID, type StatKey } from "./constants";
import {
  addRuneToAccum,
  applySetBonuses,
  emptyAccum,
  finalizeStats,
  tickOf,
  type BaseStats,
  type StatAccum,
} from "./stats";
import type { BonusConfig, FocusEntry, Rune, Stats } from "./types";

/** Focus 區塊最多可選幾組屬性 */
export const FOCUS_LIMIT = 5;

export const FOCUS_OPTIONS: { key: StatKey; label: string }[] = [
  { key: "hp", label: "體力 HP" },
  { key: "atk", label: "攻擊 ATK" },
  { key: "def", label: "防禦 DEF" },
  { key: "spd", label: "速度 SPD" },
  { key: "cr", label: "暴擊率 CR" },
  { key: "cd", label: "暴擊傷害 CD" },
  { key: "res", label: "效果抵抗 RES" },
  { key: "acc", label: "效果命中 ACC" },
];

/** 焦點契合度的參考值（達到即視為 100%） */
const FOCUS_REF: Record<StatKey, number> = {
  hp: 40000,
  atk: 3000,
  def: 2500,
  spd: 280,
  cr: 100,
  cd: 250,
  res: 100,
  acc: 100,
};

/** 清掉重複 / 超量 / 非法比重，確保最多 5 組 */
export function normalizeFocus(focus: FocusEntry[] | undefined): FocusEntry[] {
  const out: FocusEntry[] = [];
  const seen = new Set<StatKey>();
  for (const f of focus ?? []) {
    if (!f || !FOCUS_OPTIONS.some((o) => o.key === f.key) || seen.has(f.key)) continue;
    const weight = Math.max(1, Math.min(10, Math.round(Number(f.weight) || 1)));
    seen.add(f.key);
    out.push({ key: f.key, weight });
    if (out.length >= FOCUS_LIMIT) break;
  }
  return out;
}

/** 這組配裝對焦點屬性的契合度（0~100%，依比重加權） */
export function focusFitOf(stats: Stats, focus: FocusEntry[] | undefined): number {
  const list = focus ?? [];
  if (list.length === 0) return 0;
  let sum = 0;
  let total = 0;
  for (const f of list) {
    const ref = FOCUS_REF[f.key] || 1;
    sum += f.weight * Math.min(1, Math.max(0, stats[f.key] / ref));
    total += f.weight;
  }
  return total > 0 ? (sum / total) * 100 : 0;
}

export interface OptRequest {
  base: BaseStats;
  runes: Rune[];
  required: { set: number; count: number }[];
  min: Partial<Record<StatKey, number>>;
  max: Partial<Record<StatKey, number>>;
  bonus: BonusConfig;
  pool: number;
  allowEquipped: boolean;
  targetUnit?: number;
  rta?: boolean;
  maxNodes?: number;
  /** 指定每個位置的主屬性 type id（2/4/6），0 或未設定代表不限 */
  mainFilters?: Partial<Record<number, number>>;
  /** 允許破套：副套裝（2 件）只作優先，不強制剛好 2 件 */
  relaxSub?: boolean;
  /** 允許使用 1 顆無形符文補足缺少的 1 件套裝 */
  intangible?: boolean;
  /** 焦點屬性：數值越高的符文越優先進入候選池（最多 5 組） */
  focus?: FocusEntry[];
}

export interface Build {
  runes: (Rune | null)[];
  stats: Stats;
  score: number;
  eff: number;
  sets: Record<number, number>;
  /** 焦點契合度 0~100% */
  focusFit?: number;
}

export interface OptResult {
  /** 符合條件的組合總數 */
  count: number;
  /** 每組 6 顆符文的密集索引（長度 count×6，依位置 1..6；-1 表示沒有符文） */
  runeIdx: Int32Array;
  /**
   * 密集索引 → 符文 id。
   * SWEX 的 rune_id 是 64 位元等級的大數字（例如 1.97e15），超過 Int32 範圍，
   * 直接存進 Int32Array 會溢位成負數、導致還原時找不到符文，所以只存索引。
   */
  runeTable: Float64Array;
  /** 每組面板數值（長度 count×8，順序同 STAT_KEYS） */
  statValues: Float32Array;
  /** 每組綜合評分（含焦點加分） */
  scores: Float32Array;
  /** 每組符文效率平均 */
  effs: Float32Array;
  /** 每組焦點契合度（沒有 FOCUS 時為 0） */
  focusFits: Float32Array;
  /** 依綜合評分由高到低排序的索引 */
  order: Int32Array;
  /** 需求套裝（還原無形符文補套裝後的件數用） */
  requiredSets: { set: number; count: number }[];
  /** 是否使用無形符文補套裝 */
  intangible: boolean;
  nodes: number;
  /** 達到節點上限，搜尋被中斷（結果可能不完整） */
  truncated: boolean;
  /** 結果超過記憶體安全上限，只保留前面部分 */
  overflow: boolean;
  candidates: number;
  /** 候選符文的完整組合空間（各位置候選數相乘），用來判斷「算完」需要多少節點 */
  space: number;
  ms: number;
}

/** 面板數值在 statValues 裡的順序 */
export const STAT_KEYS: StatKey[] = ["hp", "atk", "def", "spd", "cr", "cd", "res", "acc"];

/** 結果最多保留幾組（避免幾百萬組把瀏覽器記憶體吃光） */
export const MAX_RESULTS = 2_000_000;

const EMPTY_RESULT = (
  requiredSets: { set: number; count: number }[] = [],
  intangible = false,
): OptResult => ({
  count: 0,
  runeIdx: new Int32Array(0),
  runeTable: new Float64Array(0),
  statValues: new Float32Array(0),
  scores: new Float32Array(0),
  effs: new Float32Array(0),
  focusFits: new Float32Array(0),
  order: new Int32Array(0),
  requiredSets,
  intangible,
  nodes: 0,
  truncated: false,
  overflow: false,
  candidates: 0,
  space: 0,
  ms: 0,
});

/** 從結果取出第 i 組的面板數值 */
export function statsAt(res: OptResult, i: number, rta = false): Stats {
  const o = i * 8;
  const hp = res.statValues[o];
  const atk = res.statValues[o + 1];
  const def = res.statValues[o + 2];
  const spd = res.statValues[o + 3];
  return {
    hp,
    atk,
    def,
    spd,
    cr: res.statValues[o + 4],
    cd: res.statValues[o + 5],
    res: res.statValues[o + 6],
    acc: res.statValues[o + 7],
    ehp: Math.floor((hp * (1140 + 3.5 * def)) / 1000),
    tick: tickOf(spd, rta),
  };
}

/** 把壓縮結果的第 i 組還原成 Build（只在使用時才建立物件） */
export function buildAt(
  res: OptResult,
  i: number,
  runeById: Map<number, Rune>,
  rta = false,
): Build {
  const runes: (Rune | null)[] = [];
  const sets: Record<number, number> = {};
  const base = i * 6;
  for (let k = 0; k < 6; k++) {
    const idx = res.runeIdx[base + k];
    const r = idx >= 0 ? (runeById.get(res.runeTable[idx]) ?? null) : null;
    runes.push(r);
    if (r) sets[r.set] = (sets[r.set] ?? 0) + 1;
  }
  // 無形符文：把缺少的 1 件補到需求套裝上（與引擎計算時的套裝加成一致）
  if (res.intangible) {
    let wild = sets[25] ?? 0;
    for (const rs of res.requiredSets) {
      const have = sets[rs.set] ?? 0;
      if (have < rs.count && wild > 0 && rs.count - have === 1) {
        sets[rs.set] = have + 1;
        wild--;
      }
    }
  }
  return {
    runes,
    stats: statsAt(res, i, rta),
    score: res.scores[i],
    eff: res.effs[i],
    sets,
    focusFit: res.focusFits[i],
  };
}

/** 一次還原多組（測試與匯出用；UI 只還原目前頁面） */
export function buildsOf(res: OptResult, runes: Rune[], rta = false, max = res.count): Build[] {
  const runeById = new Map(runes.map((r) => [r.id, r]));
  const n = Math.min(res.count, max);
  const out: Build[] = new Array(n);
  for (let k = 0; k < n; k++) out[k] = buildAt(res, res.order[k], runeById, rta);
  return out;
}

const NORM: Record<StatKey, number> = {
  hp: 9000,
  atk: 900,
  def: 900,
  spd: 160,
  cr: 60,
  cd: 100,
  res: 70,
  acc: 70,
};

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

/**
 * 綜合評分：只當作「沒有指定排序時的預設順序」與搜尋剪枝用的啟發值。
 * 真正的排序在結果產生之後才由 UI 依使用者選的欄位決定。
 */
export const SCORE_WEIGHT: Partial<Record<StatKey, number>> = {
  spd: 6, hp: 2, atk: 2, def: 2, cr: 2, cd: 1, acc: 1.5, res: 1,
};

export function scoreOf(stats: Stats): number {
  let s = 0;
  for (const k of Object.keys(SCORE_WEIGHT) as StatKey[]) s += (SCORE_WEIGHT[k] ?? 0) * (stats[k] / NORM[k]);
  return s;
}

export function runeValue(rune: Rune, w: Record<StatKey, number>, focus?: Map<StatKey, number>): number {
  let v = 0;
  const add = (t: number, value: number, mult = 1) => {
    const k = STAT_TYPES[t]?.key;
    if (!k) return;
    const name = MAX_STAT_NAME[t];
    const maxV = name ? (SUB_STAT_MAX[name]?.[`g${Math.min(6, Math.max(1, rune.grade))}`] ?? 1) : 1;
    const norm = value / Math.max(1, maxV);
    v += w[k] * norm * mult;
    // 焦點：同一條屬性再加權，讓高相關符文優先進入候選池
    const fw = focus?.get(k);
    if (fw) v += (fw / 10) * norm * mult * 1.6;
  };
  add(rune.main.t, rune.main.v, 2.2);
  if (rune.prefix?.t) add(rune.prefix.t, rune.prefix.v, 0.7);
  for (const s of rune.subs) add(s.t, s.v + s.g, 1);
  return v;
}

const FLAT_KEYS = ["flatHp", "flatAtk", "flatDef", "flatSpd", "flatCr", "flatCd", "flatRes", "flatAcc"] as const;
const PCT_KEYS = ["pctHp", "pctAtk", "pctDef"] as const;

/** 單顆符文提供的速度（含精煉） */
export function runeSpeed(rune: Rune): number {
  let v = 0;
  const add = (t: number, value: number) => {
    if (t === SPD_TYPE) v += value;
  };
  add(rune.main.t, rune.main.v);
  add(rune.prefix.t, rune.prefix.v);
  for (const s of rune.subs) add(s.t, s.v + s.g);
  return v;
}

interface Cand {
  rune: Rune;
  d: StatAccum;
  eff: number;
  /** 符文 id 在 runeTable 的密集索引（id 本身可能超過 Int32） */
  idx: number;
}

export function optimize(req: OptRequest): OptResult {
  const t0 = Date.now();
  const {
    base,
    required,
    min,
    max,
    bonus,
    pool = 18,
    allowEquipped = true,
    targetUnit = 0,
    rta = false,
    maxNodes = 3_500_000,
    mainFilters = {},
    relaxSub = false,
    intangible = false,
    focus = [],
  } = req;

  const INTANGIBLE_ID = 25;

  const focusList = normalizeFocus(focus);
  const focusWeight = new Map<StatKey, number>();
  for (const f of focusList) focusWeight.set(f.key, f.weight);
  /** 焦點契合度對最終分數的加分上限（只用來小幅調整同分排序） */
  const FOCUS_BONUS = 2;

  const allRequired = required.filter((r) => r.count > 0);
  const requiredSets = relaxSub ? allRequired.filter((r) => r.count >= 4) : allRequired;
  const softIds = new Set(relaxSub ? allRequired.filter((r) => r.count < 4).map((r) => r.set) : []);
  const requiredIds = new Set(requiredSets.map((r) => r.set));
  const anySet = requiredSets.length === 0;
  const requiredTotal = requiredSets.reduce((s, r) => s + r.count, 0);
  /** 需求件數剛好佔滿六格時，就只能用指定套裝 */
  const strictSets = !anySet && requiredTotal >= 6;

  // 啟發式權重：只用來決定「哪些符文先進入候選池」，不影響最終排序
  const w: Record<StatKey, number> = { hp: 0.15, atk: 0.15, def: 0.15, spd: 0.3, cr: 0.15, cd: 0.1, res: 0.1, acc: 0.15 };
  for (const k of Object.keys(SCORE_WEIGHT) as StatKey[]) w[k] += (SCORE_WEIGHT[k] ?? 0) * 0.5;
  for (const k of Object.keys(min) as StatKey[]) w[k] += 4;

  /**
   * 候選排序權重：
   * - 有設定 FOCUS 時，完全以 FOCUS 比重決定（沒被焦點的屬性權重為 0），
   *   這樣每個位置挑出來的就是「最符合焦點」的 18 顆。
   * - 沒有 FOCUS 時才退回通用綜合權重。
   */
  const focusRank = focusList.length > 0;
  const wRank: Record<StatKey, number> = focusRank
    ? { hp: 0, atk: 0, def: 0, spd: 0, cr: 0, cd: 0, res: 0, acc: 0 }
    : w;
  if (focusRank) for (const f of focusList) wRank[f.key] = f.weight;
  const rankValue = (r: Rune) => runeValue(r, wRank, focusRank ? undefined : focusWeight) + r.eff * 0.01;

  // 每個位置候選：上限 15 顆（15⁶ = 11,390,625 組，一次「完整」預算就能全部算完）
  // 符文 id 可能超過 32 位元（SWEX 是 64-bit），所以結果只存「密集索引」，還原時再查表
  const runeTable: number[] = [];
  const denseOf = new Map<number, number>();
  const dense = (r: Rune) => {
    let i = denseOf.get(r.id);
    if (i === undefined) {
      i = runeTable.length;
      denseOf.set(r.id, i);
      runeTable.push(r.id);
    }
    return i;
  };
  const slots: { slot: number; list: Cand[] }[] = [];
  const maxCand = Math.min(15, Math.max(6, pool));
  const speedTarget = min.spd ?? 0;
  for (let slot = 1; slot <= 6; slot++) {
    let list = req.runes.filter((r) => r.slot === slot);
    const mainT = mainFilters[slot] ?? 0;
    if (mainT) list = list.filter((r) => r.main.t === mainT);
    if (!allowEquipped) list = list.filter((r) => r.occupied === 0 || r.occupied === targetUnit);
    if (strictSets) list = list.filter((r) => requiredIds.has(r.set) || (intangible && r.set === INTANGIBLE_ID));
    const scored = list
      .map((r) => ({ r, v: rankValue(r), spd: runeSpeed(r) }))
      .sort((a, b) => b.v - a.v);

    // 名額有限（18 顆），先保留「維持可行」的少量符文，其餘全部給 FOCUS 排序。
    // 不保留的話，真實帳號可能湊不出指定套裝或達不到速度下限。
    const keep = new Map<number, Rune>();
    const addTop = (arr: { r: Rune }[], n: number) => {
      let added = 0;
      for (const x of arr) {
        if (added >= n) break;
        if (keep.has(x.r.id)) continue;
        keep.set(x.r.id, x.r);
        added++;
      }
    };
    for (const id of requiredIds) addTop(scored.filter((x) => x.r.set === id), 4);
    for (const id of softIds) addTop(scored.filter((x) => x.r.set === id), 2);
    if (speedTarget > 0) addTop([...scored].sort((a, b) => b.spd - a.spd), 5);
    addTop(scored, maxCand);
    const picked = [...keep.values()].slice(0, maxCand);
    if (speedTarget > 0) {
      // 先搜尋速度最高的組合，較早找到可行解，後續剪枝才有效
      const speedOf = new Map(scored.map((x) => [x.r.id, x.spd]));
      picked.sort((a, b) => (speedOf.get(b.id) ?? 0) - (speedOf.get(a.id) ?? 0));
    } else {
      picked.sort((a, b) => rankValue(b) - rankValue(a));
    }

    slots.push({
      slot,
      list: picked.map((rune) => {
        const d = emptyAccum();
        addRuneToAccum(d, rune, bonus.grind);
        return { rune, d, eff: rune.eff, idx: dense(rune) };
      }),
    });
  }

  /** 完整組合空間：各位置候選數相乘（判斷「全部算完」需要多少節點） */
  const space = slots.reduce((a, s) => a * s.list.length, 1);

  if (slots.some((s) => s.list.length === 0)) {
    return EMPTY_RESULT(requiredSets, intangible);
  }

  // 運算順序：2 → 4 → 6 → 1 → 3 → 5
  const order = [2, 4, 6, 1, 3, 5];
  const seq = order.map((n) => slots[n - 1]);
  const candidates = seq.reduce((a, s) => a + s.list.length, 0);

  // 後綴最大值
  const suf: Record<string, number[]> = {};
  for (const k of [...FLAT_KEYS, ...PCT_KEYS]) suf[k] = new Array(7).fill(0);
  const sufSet: Record<number, number[]> = {};
  for (const id of requiredIds) sufSet[id] = new Array(7).fill(0);

  for (let d = 5; d >= 0; d--) {
    const mx: Record<string, number> = {};
    for (const c of seq[d].list) {
      for (const k of [...FLAT_KEYS, ...PCT_KEYS]) mx[k] = Math.max(mx[k] ?? 0, (c.d as any)[k]);
    }
    for (const k of [...FLAT_KEYS, ...PCT_KEYS]) suf[k][d] = suf[k][d + 1] + (mx[k] ?? 0);
    for (const id of requiredIds) sufSet[id][d] = sufSet[id][d + 1] + (seq[d].list.some((c) => c.rune.set === id) ? 1 : 0);
  }

  // 樂觀套裝加成（上界）
  const maxSetPct = { hp: 0, atk: 0, def: 0 };
  const maxSetFlat: Record<string, number> = { flatCr: 0, flatCd: 0, flatAcc: 0, flatRes: 0 };
  const spdSets: { pieces: number; value: number; amount: number }[] = [];
  for (const def of Object.values(SET_BY_ID)) {
    if (!def.stat || !def.value) continue;
    if (strictSets && !requiredIds.has(def.id)) continue;
    if (def.stat === "spd") {
      spdSets.push({ pieces: Math.max(1, def.pieces), value: def.value, amount: Math.ceil((base.spd * def.value) / 100) });
      continue;
    }
    const per = def.value / Math.max(1, def.pieces);
    if (def.stat === "hp" || def.stat === "atk" || def.stat === "def") maxSetPct[def.stat] = Math.max(maxSetPct[def.stat], per);
    else {
      const key = `flat${def.stat[0].toUpperCase()}${def.stat.slice(1)}`;
      maxSetFlat[key] = Math.max(maxSetFlat[key] ?? 0, per);
    }
  }

  // 限制條件
  const minEntries = Object.entries(min).filter(([, v]) => typeof v === "number" && Number.isFinite(v)) as [StatKey, number][];
  const maxEntries = Object.entries(max).filter(([, v]) => typeof v === "number" && Number.isFinite(v)) as [StatKey, number][];

  const acc = emptyAccum();
  /** 目前選到的符文在 runeTable 的密集索引（0 號位置不用） */
  const chosenIdx: number[] = new Array(7).fill(-1);
  let nodes = 0;
  let accEff = 0;
  let truncated = false;
  let overflow = false;

  // ── 結果池：保留「所有」符合條件的組合，但用 typed array 分塊儲存 ──
  // 一個 Build 物件約 700 bytes，上百萬組會吃掉近 1 GB；
  // 這裡只存「符文索引 + 面板數值 + 分數」，需要顯示時才用 buildAt() 還原。
  const CHUNK = 16384;
  type Chunk = {
    ids: Int32Array;
    stats: Float32Array;
    scores: Float32Array;
    effs: Float32Array;
    fits: Float32Array;
    n: number;
  };
  const chunks: Chunk[] = [];
  let cur: Chunk | null = null;
  let count = 0;
  const push = (idx: number[], stats: Stats, score: number, eff: number, fit: number) => {
    if (count >= MAX_RESULTS) {
      // 結果池滿了就停止搜尋，但這不代表「搜尋被中斷」：空間可能已經全部算完
      overflow = true;
      return;
    }
    if (!cur || cur.n >= CHUNK) {
      cur = {
        ids: new Int32Array(CHUNK * 6),
        stats: new Float32Array(CHUNK * 8),
        scores: new Float32Array(CHUNK),
        effs: new Float32Array(CHUNK),
        fits: new Float32Array(CHUNK),
        n: 0,
      };
      chunks.push(cur);
    }
    const k = cur.n++;
    const ib = k * 6;
    for (let s = 0; s < 6; s++) cur.ids[ib + s] = idx[s + 1];
    const o = k * 8;
    cur.stats[o] = stats.hp;
    cur.stats[o + 1] = stats.atk;
    cur.stats[o + 2] = stats.def;
    cur.stats[o + 3] = stats.spd;
    cur.stats[o + 4] = stats.cr;
    cur.stats[o + 5] = stats.cd;
    cur.stats[o + 6] = stats.res;
    cur.stats[o + 7] = stats.acc;
    cur.scores[k] = score;
    cur.effs[k] = eff;
    cur.fits[k] = fit;
    count++;
  };

  const optimistic = (depth: number): Stats => {
    const remain = 6 - depth;
    let extraSetSpd = 0;
    for (const s of spdSets) {
      extraSetSpd = Math.max(extraSetSpd, Math.ceil(remain / s.pieces) * s.amount);
    }
    const opt: StatAccum = {
      flatHp: acc.flatHp + suf.flatHp[depth],
      flatAtk: acc.flatAtk + suf.flatAtk[depth],
      flatDef: acc.flatDef + suf.flatDef[depth],
      flatSpd: acc.flatSpd + suf.flatSpd[depth],
      flatCr: acc.flatCr + suf.flatCr[depth] + maxSetFlat.flatCr * remain,
      flatCd: acc.flatCd + suf.flatCd[depth] + maxSetFlat.flatCd * remain,
      flatRes: acc.flatRes + suf.flatRes[depth] + maxSetFlat.flatRes * remain,
      flatAcc: acc.flatAcc + suf.flatAcc[depth] + maxSetFlat.flatAcc * remain,
      pctHp: acc.pctHp + suf.pctHp[depth] + maxSetPct.hp * remain,
      pctAtk: acc.pctAtk + suf.pctAtk[depth] + maxSetPct.atk * remain,
      pctDef: acc.pctDef + suf.pctDef[depth] + maxSetPct.def * remain,
      spdSet: acc.spdSet + extraSetSpd,
      sets: acc.sets,
    };
    return finalizeStats(base, opt, bonus, rta);
  };

  const dfs = (depth: number) => {
    if (truncated || overflow) return;

    if (depth === 6) {
      // 最後仍要驗證套裝件數（深度 5 的可行性檢查只能保證「還來得及」）
      const wild = intangible ? (acc.sets[INTANGIBLE_ID] ?? 0) : 0;
      let short = 0;
      for (const rs of requiredSets) short += Math.max(0, rs.count - (acc.sets[rs.set] ?? 0));
      if (short > wild) return;
      const a: StatAccum = { ...acc, sets: { ...acc.sets } };
      // 把無形符文補到缺 1 件的套裝上（依序），讓套裝加成正確
      let w = wild;
      for (const rs of requiredSets) {
        const have = a.sets[rs.set] ?? 0;
        if (have < rs.count && w > 0 && rs.count - have === 1) {
          a.sets[rs.set] = have + 1;
          w--;
        }
      }
      applySetBonuses(a, base);
      const stats = finalizeStats(base, a, bonus, rta);
      for (const [k, v] of minEntries) if (stats[k] < v) return;
      for (const [k, v] of maxEntries) if (stats[k] > v) return;
      const eff = accEff / 6;
      const fit = focusFitOf(stats, focusList);
      push(
        chosenIdx,
        stats,
        scoreOf(stats) + (focusList.length ? (fit / 100) * FOCUS_BONUS : 0),
        eff,
        fit,
      );
      return;
    }

    const remain = 6 - depth;
    // 套裝可行性
    for (const rs of requiredSets) {
      const have = acc.sets[rs.set] ?? 0;
      const need = rs.count - have;
      if (need > remain) return;
      if (!intangible && need > (sufSet[rs.set]?.[depth] ?? 0)) return;
    }

    // 下限（已達成）與上限（樂觀）
    const optStats = optimistic(depth);
    for (const [k, v] of minEntries) if (optStats[k] < v) return;
    if (maxEntries.length) {
      const lowStats = finalizeStats(base, acc, bonus, rta);
      for (const [k, v] of maxEntries) if (lowStats[k] > v) return;
    }
    // 保留所有可行組合，不做分數上界剪枝。

    for (const cand of seq[depth].list) {
      nodes++;
      if (nodes > maxNodes) {
        truncated = true;
        return;
      }
      const dlt = cand.d;
      acc.flatHp += dlt.flatHp;
      acc.flatAtk += dlt.flatAtk;
      acc.flatDef += dlt.flatDef;
      acc.flatSpd += dlt.flatSpd;
      acc.flatCr += dlt.flatCr;
      acc.flatCd += dlt.flatCd;
      acc.flatRes += dlt.flatRes;
      acc.flatAcc += dlt.flatAcc;
      acc.pctHp += dlt.pctHp;
      acc.pctAtk += dlt.pctAtk;
      acc.pctDef += dlt.pctDef;
      const setId = cand.rune.set;
      acc.sets[setId] = (acc.sets[setId] ?? 0) + 1;
      accEff += cand.eff;
      chosenIdx[seq[depth].slot] = cand.idx;

      dfs(depth + 1);

      chosenIdx[seq[depth].slot] = -1;
      accEff -= cand.eff;
      acc.sets[setId] -= 1;
      if (acc.sets[setId] <= 0) delete acc.sets[setId];
      acc.flatHp -= dlt.flatHp;
      acc.flatAtk -= dlt.flatAtk;
      acc.flatDef -= dlt.flatDef;
      acc.flatSpd -= dlt.flatSpd;
      acc.flatCr -= dlt.flatCr;
      acc.flatCd -= dlt.flatCd;
      acc.flatRes -= dlt.flatRes;
      acc.flatAcc -= dlt.flatAcc;
      acc.pctHp -= dlt.pctHp;
      acc.pctAtk -= dlt.pctAtk;
      acc.pctDef -= dlt.pctDef;

      if (truncated || overflow) return;
    }
  };

  dfs(0);

  // 合併分塊，排序留到最後一次做（UI 每頁只還原 30 組）
  const runeIdx = new Int32Array(count * 6);
  const statValues = new Float32Array(count * 8);
  const scores = new Float32Array(count);
  const effs = new Float32Array(count);
  const focusFits = new Float32Array(count);
  let off = 0;
  for (const c of chunks) {
    runeIdx.set(c.ids.subarray(0, c.n * 6), off * 6);
    statValues.set(c.stats.subarray(0, c.n * 8), off * 8);
    scores.set(c.scores.subarray(0, c.n), off);
    effs.set(c.effs.subarray(0, c.n), off);
    focusFits.set(c.fits.subarray(0, c.n), off);
    off += c.n;
  }
  const rank = new Int32Array(count);
  for (let i = 0; i < count; i++) rank[i] = i;
  rank.sort((a, b) => scores[b] - scores[a] || a - b);

  return {
    count,
    runeIdx,
    runeTable: Float64Array.from(runeTable),
    statValues,
    scores,
    effs,
    focusFits,
    order: rank,
    requiredSets,
    intangible,
    nodes,
    truncated,
    overflow,
    candidates,
    space,
    ms: Date.now() - t0,
  };
}

/** tick → 所需總速度 / 符文速度 */
export function speedNeededForTick(
  tick: number,
  baseSpd: number,
  bonus: BonusConfig,
  rta = false,
): { target: number; runeSpeed: number; combat: number } {
  const rate = rta ? 0.015 : 0.07;
  const target = Math.ceil(100 / (tick * rate) - 1e-9);
  const pct = bonus.towerSpd + bonus.leadSpd + bonus.buffSpd;
  const extra = Math.ceil((baseSpd * pct) / 100);
  return { target, runeSpeed: Math.max(0, target - baseSpd - extra), combat: target };
}

/**
 * 目前符文「理論上」能達到的最高速度（上界，不考慮其他副屬性下限）。
 * 用來在配符前就告訴使用者：這個 Tick 是否根本不可能。
 */
export function maxSpeedBound(req: {
  base: BaseStats;
  runes: Rune[];
  required: { set: number; count: number }[];
  bonus: BonusConfig;
  rta?: boolean;
  allowEquipped?: boolean;
  targetUnit?: number;
  mainFilters?: Partial<Record<number, number>>;
  relaxSub?: boolean;
  intangible?: boolean;
}): { speed: number; tick: number; perSlot: number[]; missingSlots: number[] } {
  const requiredSets = req.required.filter((r) => (req.relaxSub ? r.count >= 4 : r.count > 0));
  const requiredTotal = requiredSets.reduce((s, r) => s + r.count, 0);
  const strict = requiredSets.length > 0 && requiredTotal >= 6;
  const ids = new Set(requiredSets.map((r) => r.set));
  const allowEquipped = req.allowEquipped ?? true;
  const targetUnit = req.targetUnit ?? 0;
  const mainFilters = req.mainFilters ?? {};
  const intangible = req.intangible ?? false;

  const perSlot: number[] = [];
  const missingSlots: number[] = [];
  /** 每個位置：任意符文的最高速、各指定套裝的最高速、迅速最高速、無形最高速 */
  const slotData: { any: number; bySet: Map<number, number>; swift: number; intang: number }[] = [];
  for (let slot = 1; slot <= 6; slot++) {
    const mainT = mainFilters[slot] ?? 0;
    const list = req.runes.filter(
      (r) =>
        r.slot === slot &&
        (!mainT || r.main.t === mainT) &&
        (allowEquipped || r.occupied === 0 || r.occupied === targetUnit),
    );
    const bySet = new Map<number, number>();
    let any = 0;
    let swift = 0;
    let intang = 0;
    for (const r of list) {
      const spd = runeSpeed(r);
      any = Math.max(any, spd);
      if (r.set === 3) swift = Math.max(swift, spd);
      if (r.set === 25) intang = Math.max(intang, spd);
      if (ids.has(r.set)) bySet.set(r.set, Math.max(bySet.get(r.set) ?? 0, spd));
    }
    if (list.length === 0) missingSlots.push(slot);
    perSlot.push(any);
    slotData.push({ any, bySet, swift, intang });
  }

  let flat = 0;
  let setSpd = 0;
  if (strict) {
    // 六格都必須來自指定套裝（只取每個位置該套裝的最高速）
    const requiredMax: number[] = [];
    for (const s of slotData) {
      const rm = Math.max(0, ...[...ids].map((id) => s.bySet.get(id) ?? 0));
      requiredMax.push(rm);
      flat += rm;
    }
    if (intangible) {
      // 無形可補 1 件：取「最能提升速度」的那一格替換
      let best = 0;
      for (let i = 0; i < slotData.length; i++) best = Math.max(best, slotData[i].intang - requiredMax[i]);
      flat += Math.max(0, best);
    }
    slotData.forEach((s, i) => {
      const hasReq = [...ids].some((id) => s.bySet.has(id));
      const hasInt = intangible && s.intang > 0;
      if (!hasReq && !hasInt && !missingSlots.includes(i + 1)) missingSlots.push(i + 1);
    });
    if (requiredSets.some((r) => r.set === 3 && r.count >= 4)) {
      setSpd = Math.ceil((req.base.spd * 25) / 100);
    }
  } else if (requiredSets.length > 0) {
    // 例：主套 4 件 + 破套。先取每位置最高速，再挑損失最小的位置換成指定套裝。
    flat = slotData.reduce((s, x) => s + x.any, 0);
    for (const rs of requiredSets) {
      const losses: { loss: number; slot: number }[] = [];
      slotData.forEach((s, i) => {
        const v = s.bySet.get(rs.set);
        if (v === undefined) return;
        losses.push({ loss: s.any - v, slot: i + 1 });
      });
      losses.sort((a, b) => a.loss - b.loss);
      const take = Math.min(rs.count, losses.length);
      flat -= losses.slice(0, take).reduce((s, x) => s + x.loss, 0);
      if (rs.set === 3 && rs.count >= 4) setSpd = Math.ceil((req.base.spd * 25) / 100);
    }
  } else {
    flat = slotData.reduce((s, x) => s + x.any, 0);
    if (slotData.filter((s) => s.swift > 0).length >= 4) {
      setSpd = Math.ceil((req.base.spd * 25) / 100);
    }
  }

  const pct = req.bonus.towerSpd + req.bonus.leadSpd + req.bonus.buffSpd;
  const speed = req.base.spd + Math.ceil((req.base.spd * pct) / 100) + flat + setSpd;
  return { speed, tick: tickOf(speed, req.rta), perSlot, missingSlots };
}

export function tickTable(from = 1, to = 20, rta = false): { tick: number; speed: number }[] {
  const rate = rta ? 0.015 : 0.07;
  const out = [];
  for (let t = from; t <= to; t++) out.push({ tick: t, speed: Math.ceil(100 / (t * rate) - 1e-9) });
  return out;
}

export function tickInfo(spd: number, rta = false) {
  const rate = rta ? 0.015 : 0.07;
  const tick = spd > 0 ? Math.max(1, Math.ceil(100 / (spd * rate) - 1e-9)) : Infinity;
  const nextTick = Number.isFinite(tick) && tick > 1 ? tick - 1 : 0;
  const need = nextTick > 0 ? Math.ceil(100 / (nextTick * rate) - 1e-9) : 0;
  return {
    tick,
    nextTick,
    /** 再快一階所需的面板速度（已是 Tick 1 時為 0） */
    need,
    /** 距離下一階還差多少速度 */
    next: Math.max(0, need - spd),
    pct: Number.isFinite(tick) ? Math.min(100, spd * rate * tick) : 0,
  };
}

/** 回合順序模擬（含拉條 / 插隊） */
export function simulateOrder(
  units: { id: string; name: string; spd: number; color?: string }[],
  turns = 6,
  rta = false,
): { tick: number; id: string; turn: number }[] {
  const rate = rta ? 0.015 : 0.07;
  const state = units.map((u) => ({ ...u, atb: 0, turns: 0 }));
  const out: { tick: number; id: string; turn: number }[] = [];
  let tick = 0;
  while (out.length < turns && tick < 500) {
    tick++;
    for (const s of state) s.atb += s.spd * rate;
    // 同一 tick 內速度高者先動
    const ready = state.filter((s) => s.atb >= 100 - 1e-9).sort((a, b) => b.spd - a.spd);
    for (const s of ready) {
      if (s.atb < 100 - 1e-9) continue;
      s.atb = 0;
      s.turns++;
      out.push({ tick, id: s.id, turn: s.turns });
      if (out.length >= turns) break;
    }
  }
  return out;
}
