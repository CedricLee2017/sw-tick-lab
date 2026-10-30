/**
 * 一鍵配隊引擎。
 *
 * 問題：從同一個符文庫替 3～5 隻魔靈各配 6 顆符文，且整隊符文不能重複。
 * 逐隻配符（貪心）會出現「先配的魔靈搶走關鍵符文、後面只能撿剩的」，
 * 因此這裡分成三個階段：
 *
 *   1. 候選生成：每隻魔靈各自產生 Top-K 組配裝（optimizer.ts 的 topK 模式）。
 *   2. 聯合挑選：Beam Search，在「符文不重複」的前提下挑出整隊總分最高的組合。
 *   3. 局部改良：逐隻替換成其他候選，把 Beam 少掉的分數補回來。
 *
 * 模組本身是純函式，可在 Web Worker / Node 測試中執行。
 */
import type { StatKey } from "./constants";
import {
  normalizeFocus,
  objectiveOf,
  optimize,
  type OptObjective,
  type OptRequest,
  type SkillObjective,
  type TopBuild,
} from "./optimizer";
import type { BaseStats } from "./stats";
import type { BonusConfig, FocusEntry, Rune, Stats } from "./types";

export type TeamRole = "speed" | "booster" | "dps" | "tank" | "support";

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  speed: "速隊長／一速",
  booster: "提條",
  dps: "打手",
  tank: "坦克",
  support: "輔助",
};

/** 預設目標：一速看速度、打手看期望傷害、坦克看 EHP、輔助看綜合 */
export function roleObjective(role: TeamRole): OptObjective {
  switch (role) {
    case "speed":
    case "booster":
      return "spd";
    case "dps":
      return "dps";
    case "tank":
      return "tank";
    default:
      return "support";
  }
}

export interface TeamMemberSpec {
  /** 帳號內的實際魔靈 id（同一隻魔靈可能有多份） */
  unitId: number;
  /** 魔靈 master id */
  master: number;
  /** 顯示名稱（錯誤訊息用） */
  label?: string;
  /** 星級 / 等級換算後的基礎值 */
  base: BaseStats;
  role: TeamRole;
  /** 隊伍評分權重 1–10 */
  weight: number;
  /** 需求套裝（4 件 + 2 件等） */
  sets: { set: number; count: number }[];
  /** 2 / 4 / 6 號主屬性 type id */
  mains: Partial<Record<number, number>>;
  /** 數值下限（實戰數值；速度下限請直接給 min.spd） */
  min: Partial<Record<StatKey, number>>;
  /** 焦點屬性（影響候選符文挑選） */
  focus: FocusEntry[];
  /** 這隻固定使用的符文 id（每個位置最多一顆） */
  includeRunes?: number[];
  /** 隊長技給這隻魔靈的速度 %（由頁面依屬性 / 內容判斷） */
  leadSpd: number;
  /** 覆寫搜尋目標；省略時依角色決定 */
  objective?: OptObjective;
  /** 指定技能傷害為搜尋目標（會覆寫 objective） */
  skillObjective?: SkillObjective;
  /**
   * 優先順序：1 = 最優先。設定後改用「字典序」最大化：
   * 先讓第 1 優先的魔靈拿到最高分，再在相同分數下最大化第 2 優先，依此類推。
   * 0 / 未設定 = 不指定（排在已指定之後，依權重決定）。
   */
  priority?: number;
}

export interface TeamRequest {
  members: TeamMemberSpec[];
  runes: Rune[];
  bonus: BonusConfig;
  rta: boolean;
  /** 每個位置候選符文上限（6–15，建議 10–12） */
  pool: number;
  /** 每隻魔靈保留幾組候選配裝 */
  topK: number;
  /** Beam 寬度 */
  beamWidth: number;
  allowEquipped: boolean;
  relaxSub: boolean;
  intangible: boolean;
  excludeRunes: number[];
  lockedRunes: number[];
  /** 每次搜尋的節點上限 */
  maxNodesPerSearch?: number;
  /** 是否做第二輪多樣性候選（預設 true） */
  diversify?: boolean;
  /** 回傳幾組替代隊伍（預設 3） */
  alternatives?: number;
}

export interface TeamBuild {
  unitId: number;
  master: number;
  role: TeamRole;
  runeIds: number[];
  /** 面板數值（速度已含圖騰 / 隊長 / Buff） */
  stats: Stats;
  /** 實戰 EHP（含一般召喚師技能，不含公會） */
  ehp: number;
  sets: Record<number, number>;
  /** 這組配裝的原始目標分數 */
  score: number;
  /** 相對「這隻魔靈的個人最佳」的百分比（0–1） */
  norm: number;
  weight: number;
  /** weight × norm */
  contribution: number;
  eff: number;
  focusFit: number;
  /** 這隻魔靈使用的搜尋目標 */
  objective: OptObjective;
  /** 優先順序（1 = 最優先；0 = 未指定） */
  priority: number;
  /** 技能傷害目標時顯示用 */
  skillName?: string;
}

export interface TeamPlan {
  members: TeamBuild[];
  teamScore: number;
  /** 平均符文效率 */
  totalEff: number;
  /** 所有候選搜尋的節點總數 */
  nodes: number;
  searchMs: number;
  truncated: boolean;
  alternatives: TeamPlan[];
  /** 每隻魔靈的候選數（診斷用） */
  candidates: number[];
  /** 因符文庫不足而自動放寬條件時的說明 */
  notes: string[];
}

export interface TeamProgress {
  stage: "candidates" | "search" | "refine";
  /** 目前處理到第幾隻（0-based） */
  member: number;
  total: number;
}

export type TeamOutcome =
  | { ok: true; plan: TeamPlan }
  | { ok: false; error: string; unitId?: number };

interface Candidate {
  member: number;
  unitId: number;
  runeIds: number[];
  stats: Stats;
  ehp: number;
  value: number;
  score: number;
  eff: number;
  fit: number;
  weight: number;
  norm: number;
  contribution: number;
  sets: Record<number, number>;
}

interface SearchResult {
  builds: TopBuild[];
  nodes: number;
  truncated: boolean;
}

interface State {
  picks: (Candidate | null)[];
  used: Set<number>;
  total: number;
  eff: number;
  spd: number;
  /** 依優先順序排列的個人最佳 %（字典序比較用） */
  keys: number[];
}

const INTANGIBLE_ID = 25;

/** 把候選配裝的符文 id 轉成套裝件數（含無形補套裝） */
export function teamSetsOf(
  runeIds: number[],
  runeById: Map<number, Rune>,
  required: { set: number; count: number }[],
  intangible: boolean,
): Record<number, number> {
  const sets: Record<number, number> = {};
  for (const id of runeIds) {
    const r = runeById.get(id);
    if (r) sets[r.set] = (sets[r.set] ?? 0) + 1;
  }
  if (intangible) {
    let wild = sets[INTANGIBLE_ID] ?? 0;
    for (const rs of required) {
      const have = sets[rs.set] ?? 0;
      if (have < rs.count && wild > 0 && rs.count - have === 1) {
        sets[rs.set] = have + 1;
        wild--;
      }
    }
  }
  return sets;
}

interface SearchOverride {
  /** 覆寫套裝需求（空陣列 = 完全不限套裝） */
  sets?: { set: number; count: number }[];
  /** 覆寫 2 / 4 / 6 號主屬性（空物件 = 不限） */
  mains?: Partial<Record<number, number>>;
  /** 覆寫「允許破套」 */
  relaxSub?: boolean;
}

function searchOnce(
  req: TeamRequest,
  spec: TeamMemberSpec,
  excludeExtra: number[],
  k: number,
  over: SearchOverride = {},
): SearchResult {
  const objective: OptObjective = spec.skillObjective
    ? "skill"
    : (spec.objective ?? roleObjective(spec.role));
  const sets = over.sets ?? spec.sets;
  const optReq: OptRequest = {
    base: spec.base,
    runes: req.runes,
    required: sets.filter((s) => s.set > 0 && s.count > 0),
    min: spec.min,
    max: {},
    // 隊伍模式固定不含公會技能；速度隊長技由 spec.leadSpd 逐隻帶入
    bonus: { ...req.bonus, leadSpd: spec.leadSpd, useGuild: false, grind: true },
    pool: req.pool,
    allowEquipped: req.allowEquipped,
    targetUnit: spec.unitId,
    rta: req.rta,
    maxNodes: req.maxNodesPerSearch ?? 4_000_000,
    mainFilters: over.mains ?? spec.mains,
    relaxSub: over.relaxSub ?? req.relaxSub,
    intangible: req.intangible,
    focus: normalizeFocus(spec.focus),
    excludeRunes: [...new Set([...req.excludeRunes, ...excludeExtra])],
    includeRunes: spec.includeRunes ?? [],
    lockedRunes: req.lockedRunes,
    topK: Math.max(1, Math.round(k)),
    objective,
    skillObjective: spec.skillObjective,
  };
  const res = optimize(optReq);
  return {
    builds: res.topBuilds ?? [],
    nodes: res.nodes,
    truncated: res.truncated,
  };
}

function dedupeBuilds(list: TopBuild[]): TopBuild[] {
  const seen = new Set<string>();
  const out: TopBuild[] = [];
  for (const b of list) {
    const key = b.runeIds.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

/** 取每隻魔靈 top 5 組用到的符文，用來判斷「大家都在搶」的符文 */
function contendedRunes(lists: TopBuild[][], member: number): number[] {
  const usage = new Map<number, Set<number>>();
  lists.forEach((list, i) => {
    for (const b of list.slice(0, 5)) {
      for (const id of b.runeIds) {
        if (!usage.has(id)) usage.set(id, new Set());
        usage.get(id)!.add(i);
      }
    }
  });
  const own = new Set<number>();
  for (const b of lists[member].slice(0, 5)) for (const id of b.runeIds) own.add(id);
  return [...own]
    .filter((id) => (usage.get(id)?.size ?? 0) >= 2)
    .sort((a, b) => (usage.get(b)?.size ?? 0) - (usage.get(a)?.size ?? 0))
    .slice(0, 2);
}

function toCandidate(
  b: TopBuild,
  member: number,
  spec: TeamMemberSpec,
  runeById: Map<number, Rune>,
  required: { set: number; count: number }[],
  intangible: boolean,
): Candidate {
  return {
    member,
    unitId: spec.unitId,
    runeIds: b.runeIds,
    stats: b.stats,
    ehp: b.ehp,
    value: b.objective,
    score: b.score,
    eff: b.eff,
    fit: b.focusFit,
    weight: Math.max(1, Math.min(10, spec.weight || 1)),
    norm: 1,
    contribution: 0,
    sets: teamSetsOf(b.runeIds, runeById, required, intangible),
  };
}

/** Beam Search + 局部改良 */
export function optimizeTeam(
  req: TeamRequest,
  onProgress?: (p: TeamProgress) => void,
): TeamOutcome {
  const t0 = Date.now();
  const members = req.members;
  const n = members.length;
  if (n < 1) return { ok: false, error: "請至少選擇 1 隻魔靈" };
  if (n > 5) return { ok: false, error: "一隊最多 5 隻魔靈" };

  const runeById = new Map(req.runes.map((r) => [r.id, r]));
  const topK = Math.max(4, Math.min(300, Math.round(req.topK || 60)));
  const diversify = req.diversify !== false;
  const firstK = diversify ? Math.max(4, Math.round(topK * 0.6)) : topK;

  // ── 優先順序（字典序）──
  // 有設定 priority（>0）時，先最大化第 1 優先魔靈的個人最佳 %，
  // 分數相同時再最大化第 2 優先，依此類推；最後才比加權總分。
  const priorityMode = members.some((m) => (m.priority ?? 0) > 0);
  const rankOf = new Array<number>(n).fill(0);
  if (priorityMode) {
    const byPriority = members
      .map((_, i) => i)
      .sort((a, b) => {
        const pa = members[a].priority ?? 0;
        const pb = members[b].priority ?? 0;
        const ra = pa > 0 ? pa : Number.MAX_SAFE_INTEGER;
        const rb = pb > 0 ? pb : Number.MAX_SAFE_INTEGER;
        return ra - rb || (members[b].weight || 1) - (members[a].weight || 1) || a - b;
      });
    byPriority.forEach((mi, rank) => { rankOf[mi] = rank; });
  }
  const cmpState = (a: State, b: State): number => {
    if (priorityMode) {
      for (let k = 0; k < n; k++) {
        const d = a.keys[k] - b.keys[k];
        if (d !== 0) return d;
      }
    }
    return a.total - b.total || a.eff - b.eff || a.spd - b.spd;
  };

  // ── Stage A：每隻魔靈的候選配裝 ──
  const firstLists: TopBuild[][] = [];
  /** 每隻魔靈最後停在放寬階梯的第幾階（第二輪、補位都要沿用） */
  const overrideIdx: number[] = [];
  /** 顯示用：哪些魔靈因為符文庫不足而放寬了條件 */
  const notes: string[] = [];
  let nodes = 0;
  let truncated = false;

  // 找不到符合條件的配裝時，依序放寬「主屬性 → 破套 → 套裝」，
  // 至少讓整隊能配出來，並在結果頁說明放寬了什麼。
  const ladder: { over: SearchOverride; note: string | null }[] = [
    { over: {}, note: null },
    { over: { mains: {} }, note: "不限主屬性" },
    { over: { mains: {}, relaxSub: true }, note: "不限主屬性、允許破套" },
    { over: { mains: {}, sets: [], relaxSub: true }, note: "不限套裝與主屬性" },
  ];

  /** 從指定階梯開始往下試，直到找到候選為止 */
  const runLadder = (i: number, exclude: number[], k: number, startAt = 0) => {
    let idx = Math.max(0, Math.min(ladder.length - 1, startAt));
    let r = searchOnce(req, members[i], exclude, k, ladder[idx].over);
    nodes += r.nodes;
    truncated = truncated || r.truncated;
    while (r.builds.length === 0 && idx + 1 < ladder.length) {
      idx++;
      r = searchOnce(req, members[i], exclude, k, ladder[idx].over);
      nodes += r.nodes;
      truncated = truncated || r.truncated;
    }
    return { r, idx };
  };

  for (let i = 0; i < n; i++) {
    onProgress?.({ stage: "candidates", member: i, total: n });
    const { r, idx } = runLadder(i, [], firstK);
    overrideIdx.push(idx);
    firstLists.push(r.builds);
    if (idx > 0 && r.builds.length > 0) {
      notes.push(
        `${members[i].label ?? `魔靈 ${i + 1}`}：找不到原本的條件，已改為${ladder[idx].note}。`,
      );
    }
    if (r.builds.length === 0) {
      return {
        ok: false,
        error: `無法為「${members[i].label ?? `魔靈 ${i + 1}`}」找到符合條件的配裝，即使不限套裝與主屬性也一樣。請檢查 Tick / 數值下限、排除與鎖定符文，或確認符文庫每個位置都有足夠符文。`,
        unitId: members[i].unitId,
      };
    }
  }

  // 第二輪：排除「與其他魔靈重疊」的符文，補足多樣性
  const finalLists: TopBuild[][] = firstLists.map((l) => [...l]);
  if (diversify && firstK < topK) {
    // 其他魔靈目前最好的一組通常會用掉同樣的熱門符文；
    // 先把這些符文排除，才可能產生「換一顆速度符文」之類的替代配裝。
    const bestRunes = firstLists.map((l) => new Set(l[0]?.runeIds ?? []));
    for (let i = 0; i < n; i++) {
      const extra = new Set<number>(contendedRunes(firstLists, i));
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        for (const id of bestRunes[j]) extra.add(id);
      }
      if (extra.size === 0) continue;
      onProgress?.({ stage: "candidates", member: i, total: n });
      const { r } = runLadder(i, [...extra], topK - firstK, overrideIdx[i]);
      finalLists[i] = dedupeBuilds([...finalLists[i], ...r.builds]);
    }
  }

  const cands: Candidate[][] = finalLists.map((list, i) =>
    list.map((b) =>
      toCandidate(
        b,
        i,
        members[i],
        runeById,
        members[i].sets.filter((s) => s.set > 0 && s.count > 0),
        req.intangible,
      ),
    ),
  );

  // 正規化：每隻魔靈除以自己的最佳分數，避免「打手數字大、輔助被忽略」
  const bestRaw = cands.map((list) => list.reduce((m, c) => Math.max(m, c.value), 0));
  for (const list of cands) {
    for (const c of list) {
      c.norm = bestRaw[c.member] > 0 ? c.value / bestRaw[c.member] : 0;
      c.contribution = c.weight * c.norm;
    }
  }

  const candidates = cands.map((l) => l.length);
  const width = Math.max(4, Math.min(512, Math.round(req.beamWidth || 48)));
  const altCount = Math.max(1, Math.min(10, Math.round(req.alternatives ?? 3)));

  // 最難配的先處理（候選最少），可以更早剪掉不可能的分支；
  // 有優先順序時，先處理高優先的魔靈，字典序比較才有意義。
  const order = members
    .map((_, i) => i)
    .sort((a, b) => {
      if (priorityMode && rankOf[a] !== rankOf[b]) return rankOf[a] - rankOf[b];
      return cands[a].length - cands[b].length || members[b].weight - members[a].weight;
    });

  // ── Stage B：Beam Search ──
  let states: State[] = [
    {
      picks: new Array<Candidate | null>(n).fill(null),
      used: new Set<number>(),
      total: 0,
      eff: 0,
      spd: 0,
      keys: new Array<number>(n).fill(0),
    },
  ];

  const extend = (mi: number, from: State[], list: Candidate[]): State[] => {
    const next: State[] = [];
    for (const st of from) {
      for (const c of list) {
        let conflict = false;
        for (const id of c.runeIds) {
          if (st.used.has(id)) {
            conflict = true;
            break;
          }
        }
        if (conflict) continue;
        const used = new Set(st.used);
        for (const id of c.runeIds) used.add(id);
        const picks = st.picks.slice();
        picks[mi] = c;
        const keys = st.keys.slice();
        keys[rankOf[mi]] = c.norm;
        next.push({
          picks,
          used,
          keys,
          total: st.total + c.contribution,
          eff: st.eff + c.eff,
          spd: st.spd + c.stats.spd,
        });
      }
    }
    return next;
  };

  const requiredOf = (i: number) => members[i].sets.filter((s) => s.set > 0 && s.count > 0);

  for (const mi of order) {
    onProgress?.({ stage: "search", member: mi, total: n });
    let next = extend(mi, states, cands[mi]);

    // 候選全是同一批熱門符文時（例如 3 隻同型坦克），Beam 可能全部衝突。
    // 這時以目前最佳狀態為底，重新搜尋「完全避開已用符文」的配裝補位；
    // 只是後備方案，一般情況仍以 Beam 的聯合挑選為準。
    for (let attempt = 0; next.length === 0 && attempt < 4; attempt++) {
      const key = (c: Candidate) => c.runeIds.join(",");
      const have = new Set(cands[mi].map(key));
      let added = false;
      for (const baseState of states.slice(0, 12)) {
        const { r } = runLadder(mi, [...baseState.used], Math.max(8, topK), overrideIdx[mi]);
        const fresh = r.builds
          .map((b) => toCandidate(b, mi, members[mi], runeById, requiredOf(mi), req.intangible))
          .filter((c) => !c.runeIds.some((id) => baseState.used.has(id)) && !have.has(key(c)));
        if (fresh.length === 0) continue;
        for (const c of fresh) {
          c.norm = bestRaw[mi] > 0 ? Math.min(1, c.value / bestRaw[mi]) : 0;
          c.contribution = c.weight * c.norm;
          cands[mi].push(c);
          have.add(key(c));
        }
        added = true;
        break;
      }
      if (!added) break;
      next = extend(mi, states, cands[mi]);
    }

    if (next.length === 0) {
      return {
        ok: false,
        error: `符文衝突：第 ${mi + 1} 隻（${members[mi].label ?? "魔靈"}）找不到不重複的可用符文。請放寬套裝 / Tick 條件、增加候選數，或先排除部分符文。`,
        unitId: members[mi].unitId,
      };
    }
    next.sort((a, b) => cmpState(b, a));
    states = next.slice(0, width);
  }

  // ── Stage C：局部改良（1-opt） ──
  const refine = (state: State): State => {
    let best = state;
    for (let pass = 0; pass < 2; pass++) {
      let improved = false;
      for (let i = 0; i < n; i++) {
        const current = best.picks[i];
        if (!current) continue;
        const usedOthers = new Set<number>();
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          for (const id of best.picks[j]?.runeIds ?? []) usedOthers.add(id);
        }
        let bestCand = current;
        let bestState = best;
        for (const c of cands[i]) {
          if (c === current) continue;
          if (c.runeIds.some((id) => usedOthers.has(id))) continue;
          const keys = best.keys.slice();
          keys[rankOf[i]] = c.norm;
          const trial: State = {
            picks: best.picks,
            used: best.used,
            keys,
            total: best.total - current.contribution + c.contribution,
            eff: best.eff - current.eff + c.eff,
            spd: best.spd - current.stats.spd + c.stats.spd,
          };
          if (cmpState(trial, bestState) > 0) {
            bestState = trial;
            bestCand = c;
          }
        }
        if (bestCand !== current) {
          const picks = best.picks.slice();
          picks[i] = bestCand;
          const used = new Set<number>();
          for (const p of picks) for (const id of p?.runeIds ?? []) used.add(id);
          best = { ...bestState, picks, used };
          improved = true;
        }
      }
      if (!improved) break;
    }
    return best;
  };

  onProgress?.({ stage: "refine", member: n - 1, total: n });
  const refined = states.map(refine);
  refined.sort((a, b) => cmpState(b, a));

  // 去重（不同 Beam 狀態可能被改良成同一隊）
  const seen = new Set<string>();
  const unique: State[] = [];
  for (const st of refined) {
    const key = st.picks
      .map((p) => p?.runeIds.join(",") ?? "")
      .join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(st);
  }

  const elapsed = Date.now() - t0;
  const plans = unique.slice(0, altCount).map((st) => toPlan(st, members));
  const top = plans[0];
  if (!top) return { ok: false, error: "找不到可行的隊伍配置" };

  const alternatives = plans.slice(1).map((p) => ({
    ...p,
    nodes,
    searchMs: elapsed,
    truncated,
    candidates,
    notes,
  }));

  return {
    ok: true,
    plan: {
      ...top,
      alternatives,
      nodes,
      searchMs: elapsed,
      truncated,
      candidates,
      notes,
      teamScore: top.teamScore,
    },
  };
}

function toPlan(state: State, members: TeamMemberSpec[]): TeamPlan {
  const builds: TeamBuild[] = [];
  let totalEff = 0;
  for (let i = 0; i < members.length; i++) {
    const c = state.picks[i];
    if (!c) continue;
    totalEff += c.eff;
    builds.push({
      unitId: members[i].unitId,
      master: members[i].master,
      role: members[i].role,
      runeIds: c.runeIds,
      stats: c.stats,
      ehp: c.ehp,
      sets: c.sets,
      score: c.value,
      norm: c.norm,
      weight: c.weight,
      contribution: c.contribution,
      eff: c.eff,
      focusFit: c.fit,
      objective: members[i].skillObjective ? "skill" : (members[i].objective ?? roleObjective(members[i].role)),
      priority: members[i].priority ?? 0,
      skillName: members[i].skillObjective?.skill.n,
    });
  }
  return {
    members: builds,
    teamScore: state.total,
    totalEff: builds.length > 0 ? totalEff / builds.length : 0,
    nodes: 0,
    searchMs: 0,
    truncated: false,
    alternatives: [],
    candidates: [],
    notes: [],
  };
}

/** 檢查每個位置的可用符文是否足夠（開跑前的預檢） */
export function runeSupply(
  runes: Rune[],
  teamUnitIds: number[],
  excludeRunes: number[],
  lockedRunes: number[],
  need = teamUnitIds.length,
): { slot: number; count: number; need: number }[] {
  const exclude = new Set(excludeRunes);
  const locked = new Set(lockedRunes);
  const team = new Set(teamUnitIds);
  const out: { slot: number; count: number; need: number }[] = [];
  for (let slot = 1; slot <= 6; slot++) {
    let count = 0;
    for (const r of runes) {
      if (r.slot !== slot) continue;
      if (exclude.has(r.id)) continue;
      if (locked.has(r.id) && !team.has(r.occupied)) continue;
      count++;
    }
    out.push({ slot, count, need });
  }
  return out;
}

/** 把每隻魔靈的目標分數換算成「個人最佳百分比」，供 UI 顯示 */
export function planDeltas(plan: TeamPlan, plans: TeamPlan[]): number[] {
  return plan.members.map((m) => {
    let best = m.norm;
    for (const p of plans) {
      const x = p.members.find((y) => y.unitId === m.unitId);
      if (x) best = Math.max(best, x.norm);
    }
    return best > 0 ? m.norm / best : 1;
  });
}

/** 供測試 / 除錯：直接用一組符文 id 算隊伍分數（不含搜尋） */
export function scoreTeam(
  members: TeamMemberSpec[],
  picks: { unitId: number; runeIds: number[]; stats: Stats }[],
): number {
  return members.reduce((sum, m) => {
    const p = picks.find((x) => x.unitId === m.unitId);
    if (!p) return sum;
    const objective = m.skillObjective ? "skill" : (m.objective ?? roleObjective(m.role));
    return sum + m.weight * objectiveOf(p.stats, objective, m.skillObjective);
  }, 0);
}
