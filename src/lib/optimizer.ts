/** 配符運算引擎（分支定界） */
import { SUB_STAT_MAX, STAT_TYPES, SET_BY_ID, type StatKey } from "./constants";
import {
  addRuneToAccum,
  applySetBonuses,
  emptyAccum,
  finalizeStats,
  tickOf,
  type BaseStats,
  type StatAccum,
} from "./stats";
import type { BonusConfig, Rune, Stats } from "./types";

export type Objective = "spd" | "ehp" | "hp" | "atk" | "def" | "eff" | "score";

export const OBJECTIVE_LABEL: Record<Objective, string> = {
  spd: "速度優先",
  ehp: "有效體力 (EHP)",
  hp: "體力優先",
  atk: "攻擊力優先",
  def: "防禦力優先",
  eff: "符文效率",
  score: "綜合評分",
};

export interface OptRequest {
  base: BaseStats;
  runes: Rune[];
  required: { set: number; count: number }[];
  min: Partial<Record<StatKey, number>>;
  max: Partial<Record<StatKey, number>>;
  objective: Objective;
  bonus: BonusConfig;
  limit: number;
  pool: number;
  allowEquipped: boolean;
  targetUnit?: number;
  rta?: boolean;
  maxNodes?: number;
  /** 指定每個位置的主屬性 type id（2/4/6），0 或未設定代表不限 */
  mainFilters?: Partial<Record<number, number>>;
  /** 允許破套：副套裝（2 件）只作優先，不強制剛好 2 件 */
  relaxSub?: boolean;
}

export interface Build {
  runes: (Rune | null)[];
  stats: Stats;
  score: number;
  eff: number;
  sets: Record<number, number>;
}

export interface OptResult {
  builds: Build[];
  nodes: number;
  truncated: boolean;
  candidates: number;
  ms: number;
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

const OBJ_WEIGHT: Record<Objective, Partial<Record<StatKey, number>>> = {
  spd: { spd: 10 },
  ehp: { hp: 4, def: 3 },
  hp: { hp: 8 },
  atk: { atk: 8 },
  def: { def: 8 },
  eff: {},
  score: { spd: 6, hp: 2, atk: 2, def: 2, cr: 2, cd: 1, acc: 1.5, res: 1 },
};

const MAX_STAT_NAME: Record<number, string> = {
  1: "HP flat",
  2: "HP%",
  3: "ATK flat",
  4: "ATK%",
  5: "DEF flat",
  6: "DEF%",
  7: "SPD",
  8: "CRate",
  9: "CDmg",
  10: "RES",
  11: "ACC",
};

export function scoreOf(stats: Stats, eff: number, objective: Objective): number {
  if (objective === "eff") return eff;
  const w = OBJ_WEIGHT[objective];
  let s = 0;
  for (const k of Object.keys(w) as StatKey[]) s += (w[k] ?? 0) * (stats[k] / NORM[k]);
  if (objective === "ehp") s += stats.ehp / 80;
  return s;
}

function runeValue(rune: Rune, w: Record<StatKey, number>): number {
  let v = 0;
  const add = (t: number, value: number, mult = 1) => {
    const k = STAT_TYPES[t]?.key;
    if (!k) return;
    const name = MAX_STAT_NAME[t];
    const maxV = name ? (SUB_STAT_MAX[name]?.[`g${Math.min(6, Math.max(1, rune.grade))}`] ?? 1) : 1;
    v += w[k] * (value / Math.max(1, maxV)) * mult;
  };
  add(rune.main.t, rune.main.v, 2.2);
  if (rune.prefix?.t) add(rune.prefix.t, rune.prefix.v, 0.7);
  for (const s of rune.subs) add(s.t, s.v + s.g, 1);
  return v;
}

const FLAT_KEYS = ["flatHp", "flatAtk", "flatDef", "flatSpd", "flatCr", "flatCd", "flatRes", "flatAcc"] as const;
const PCT_KEYS = ["pctHp", "pctAtk", "pctDef"] as const;

/** 單顆符文提供的速度（含磨石） */
export function runeSpeed(rune: Rune): number {
  let v = 0;
  const add = (t: number, value: number) => {
    if (t === 7) v += value;
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
}

export function optimize(req: OptRequest): OptResult {
  const t0 = Date.now();
  const {
    base,
    required,
    min,
    max,
    objective,
    bonus,
    limit = 20,
    pool = 18,
    allowEquipped = true,
    targetUnit = 0,
    rta = false,
    maxNodes = 3_500_000,
    mainFilters = {},
    relaxSub = false,
  } = req;

  const allRequired = required.filter((r) => r.count > 0);
  const requiredSets = relaxSub ? allRequired.filter((r) => r.count >= 4) : allRequired;
  const softIds = new Set(relaxSub ? allRequired.filter((r) => r.count < 4).map((r) => r.set) : []);
  const requiredIds = new Set(requiredSets.map((r) => r.set));
  const anySet = requiredSets.length === 0;
  const requiredTotal = requiredSets.reduce((s, r) => s + r.count, 0);
  /** 需求件數剛好佔滿六格時，就只能用指定套裝 */
  const strictSets = !anySet && requiredTotal >= 6;

  // 啟發式權重
  const w: Record<StatKey, number> = { hp: 0.15, atk: 0.15, def: 0.15, spd: 0.3, cr: 0.15, cd: 0.1, res: 0.1, acc: 0.15 };
  for (const k of Object.keys(OBJ_WEIGHT[objective]) as StatKey[]) w[k] += (OBJ_WEIGHT[objective][k] ?? 0) * 0.5;
  for (const k of Object.keys(min) as StatKey[]) w[k] += 4;
  if (objective === "eff") for (const k of Object.keys(w) as StatKey[]) w[k] += 0.35;

  // 每個位置候選
  const slots: { slot: number; list: Cand[] }[] = [];
  const maxCand = Math.min(40, Math.max(pool, 18) + 8);
  const speedTarget = min.spd ?? 0;
  for (let slot = 1; slot <= 6; slot++) {
    let list = req.runes.filter((r) => r.slot === slot);
    const mainT = mainFilters[slot] ?? 0;
    if (mainT) list = list.filter((r) => r.main.t === mainT);
    if (!allowEquipped) list = list.filter((r) => r.occupied === 0 || r.occupied === targetUnit);
    if (strictSets) list = list.filter((r) => requiredIds.has(r.set));
    const scored = list
      .map((r) => ({ r, v: runeValue(r, w) + r.eff * 0.02, spd: runeSpeed(r) }))
      .sort((a, b) => b.v - a.v);

    // 候選不能只看加權分數：保留各指定套裝與最高速符文，
    // 否則真實帳號（每位置數百顆）可能漏掉唯一能達標的組合。
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
    for (const id of requiredIds) addTop(scored.filter((x) => x.r.set === id), 8);
    for (const id of softIds) addTop(scored.filter((x) => x.r.set === id), 6);
    addTop([...scored].sort((a, b) => b.spd - a.spd), 10);
    addTop(scored, maxCand);
    const picked = [...keep.values()].slice(0, maxCand);
    if (speedTarget > 0) {
      // 先搜尋速度最高的組合，較早找到可行解，後續剪枝才有效
      const speedOf = new Map(scored.map((x) => [x.r.id, x.spd]));
      picked.sort((a, b) => (speedOf.get(b.id) ?? 0) - (speedOf.get(a.id) ?? 0));
    } else {
      picked.sort((a, b) => runeValue(b, w) - runeValue(a, w));
    }

    slots.push({
      slot,
      list: picked.map((rune) => {
        const d = emptyAccum();
        addRuneToAccum(d, rune, bonus.grind);
        return { rune, d, eff: rune.eff };
      }),
    });
  }

  if (slots.some((s) => s.list.length === 0)) {
    return { builds: [], nodes: 0, truncated: false, candidates: 0, ms: 0 };
  }

  // 運算順序：2 → 4 → 6 → 1 → 3 → 5
  const order = [2, 4, 6, 1, 3, 5];
  const seq = order.map((n) => slots[n - 1]);
  const candidates = seq.reduce((a, s) => a + s.list.length, 0);

  // 後綴最大值
  const suf: Record<string, number[]> = {};
  for (const k of [...FLAT_KEYS, ...PCT_KEYS]) suf[k] = new Array(7).fill(0);
  const sufEff = new Array(7).fill(0);
  const sufSet: Record<number, number[]> = {};
  for (const id of requiredIds) sufSet[id] = new Array(7).fill(0);

  for (let d = 5; d >= 0; d--) {
    const mx: Record<string, number> = {};
    let mxEff = 0;
    for (const c of seq[d].list) {
      for (const k of [...FLAT_KEYS, ...PCT_KEYS]) mx[k] = Math.max(mx[k] ?? 0, (c.d as any)[k]);
      mxEff = Math.max(mxEff, c.eff);
    }
    for (const k of [...FLAT_KEYS, ...PCT_KEYS]) suf[k][d] = suf[k][d + 1] + (mx[k] ?? 0);
    sufEff[d] = sufEff[d + 1] + mxEff;
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

  const results: Build[] = [];
  const acc = emptyAccum();
  const chosen: (Rune | null)[] = new Array(7).fill(null);
  let nodes = 0;
  let accEff = 0;
  let truncated = false;

  const worst = () => (results.length < limit ? -Infinity : results[results.length - 1].score);

  const push = (b: Build) => {
    if (results.length < limit) {
      results.push(b);
      results.sort((x, y) => y.score - x.score);
    } else if (b.score > results[results.length - 1].score) {
      results[results.length - 1] = b;
      results.sort((x, y) => y.score - x.score);
    }
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
    if (truncated) return;

    if (depth === 6) {
      // 最後仍要驗證套裝件數（深度 5 的可行性檢查只能保證「還來得及」）
      for (const rs of requiredSets) {
        if ((acc.sets[rs.set] ?? 0) < rs.count) return;
      }
      const a: StatAccum = { ...acc, sets: { ...acc.sets } };
      applySetBonuses(a, base);
      const stats = finalizeStats(base, a, bonus, rta);
      for (const [k, v] of minEntries) if (stats[k] < v) return;
      for (const [k, v] of maxEntries) if (stats[k] > v) return;
      const eff = accEff / 6;
      push({ runes: chosen.slice(1), stats, score: scoreOf(stats, eff, objective), eff, sets: { ...acc.sets } });
      return;
    }

    const remain = 6 - depth;
    // 套裝可行性
    for (const rs of requiredSets) {
      const have = acc.sets[rs.set] ?? 0;
      const need = rs.count - have;
      if (need > remain) return;
      if (need > (sufSet[rs.set]?.[depth] ?? 0)) return;
    }

    // 下限（已達成）與上限（樂觀）
    const optStats = optimistic(depth);
    for (const [k, v] of minEntries) if (optStats[k] < v) return;
    if (maxEntries.length) {
      const lowStats = finalizeStats(base, acc, bonus, rta);
      for (const [k, v] of maxEntries) if (lowStats[k] > v) return;
    }
    const bound = objective === "eff" ? (accEff + sufEff[depth]) / 6 : scoreOf(optStats, 0, objective);
    if (results.length >= limit && bound <= worst()) return;

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
      chosen[seq[depth].slot] = cand.rune;

      dfs(depth + 1);

      chosen[seq[depth].slot] = null;
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

      if (truncated) return;
    }
  };

  dfs(0);

  return { builds: results, nodes, truncated, candidates, ms: Date.now() - t0 };
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
}): { speed: number; tick: number; perSlot: number[]; missingSlots: number[] } {
  const requiredSets = req.required.filter((r) => (req.relaxSub ? r.count >= 4 : r.count > 0));
  const requiredTotal = requiredSets.reduce((s, r) => s + r.count, 0);
  const strict = requiredSets.length > 0 && requiredTotal >= 6;
  const ids = new Set(requiredSets.map((r) => r.set));
  const allowEquipped = req.allowEquipped ?? true;
  const targetUnit = req.targetUnit ?? 0;
  const mainFilters = req.mainFilters ?? {};

  const perSlot: number[] = [];
  const missingSlots: number[] = [];
  /** 每個位置：任意符文的最高速、各指定套裝的最高速、迅速最高速 */
  const slotData: { any: number; bySet: Map<number, number>; swift: number }[] = [];
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
    for (const r of list) {
      const spd = runeSpeed(r);
      any = Math.max(any, spd);
      if (r.set === 3) swift = Math.max(swift, spd);
      if (ids.has(r.set)) bySet.set(r.set, Math.max(bySet.get(r.set) ?? 0, spd));
    }
    if (list.length === 0) missingSlots.push(slot);
    perSlot.push(any);
    slotData.push({ any, bySet, swift });
  }

  let flat = 0;
  let setSpd = 0;
  if (strict) {
    // 六格都必須來自指定套裝（只取每個位置該套裝的最高速）
    for (const s of slotData) flat += Math.max(0, ...[...ids].map((id) => s.bySet.get(id) ?? 0));
    slotData.forEach((s, i) => {
      if (![...ids].some((id) => s.bySet.has(id)) && !missingSlots.includes(i + 1)) missingSlots.push(i + 1);
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
