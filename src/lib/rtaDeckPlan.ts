/**
 * RTA Deck 配符引擎：依速度順序逐隻配符。
 *
 * 為什麼逐隻配？
 * - RTA Deck 最多 30 隻，若用一鍵配隊的 Beam Search 一次處理 30 隻，
 *   組合數會爆掉；逐隻配＋排除已使用符文，能在可接受時間內完成 30 隻。
 * - 速度順序需要「前一隻配好後」才能算出下一隻的速度上限，因此天然適合逐隻。
 *
 * 每隻魔靈可指定 2/4/6 號最多 2 個主屬性；這裡用 optimizer 的
 * mainAlternatives 一次搜尋多個主屬性，不需要為每個組合分開跑。
 */
import type { StatKey } from "./constants";
import { ARTIFACT_MAIN } from "./artifacts";
import { optimize, scoreOf, type OptObjective, type TopBuild } from "./optimizer";
import { roleObjective, type TeamRole } from "./teamOptimizer";
import { deckSlotSets } from "./rtaDeck";
import { effectiveSetCounts, statsForRunes, type BaseStats } from "./stats";
import type { Artifact, BonusConfig, Rune, Stats } from "./types";

export interface RtaDeckPlanMember {
  slotId: string;
  unitId: number;
  master: number;
  label: string;
  base: BaseStats;
  role: TeamRole;
  sets: { set: number; count: number }[];
  /** 2/4/6 可接受的主屬性（最多 2 個） */
  mains: Partial<Record<number, number[]>>;
  min: Partial<Record<StatKey, number>>;
  max?: Partial<Record<StatKey, number>>;
  weight: number;
  /** 與前一隻的速度差（第一隻忽略） */
  gap: number;
  /** 是否參與速度串接；false = 不受前一隻速度差限制 */
  speedChain: boolean;
  objective?: OptObjective;
  /**
   * 目前遊戲中的 RTA 配裝（符文 id）。
   * 搜尋找不到符合條件的組合時，會先檢查這組配裝；
   * 若它本來就達標就直接沿用，避免「明明遊戲配得出來卻說配不到」。
   */
  seedRunes?: number[];
  /** 目前 RTA 神器（提供固定體力 / 攻擊 / 防禦加成） */
  seedArtifacts?: Artifact[];
}


export interface RtaDeckPlanRequest {
  members: RtaDeckPlanMember[];
  runes: Rune[];
  bonus: BonusConfig;
  /** 速度隊長技 %；0 = 不計 */
  leaderPct: number;
  /** 速度差模式：至少 / 剛好 */
  gapMode: "at-least" | "exact";
  pool: number;
  /** 每隻保留幾組候選（只取最佳一組） */
  topK: number;
  maxNodes: number;
  /** 每隻搜尋前額外排除的符文（已配好的會自動加入） */
  excludeRunes: number[];
  lockedRunes: number[];
}

export interface RtaDeckPlanResult {
  slotId: string;
  unitId: number;
  runeIds: number[];
  stats: Stats;
  ehp: number;
  score: number;
  eff: number;
  focusFit: number;
  objective: OptObjective;
  notes: string[];
}

export interface RtaDeckPlanProgress {
  /** 目前處理到第幾隻（0-based） */
  index: number;
  total: number;
  slotId: string;
  label: string;
}

export type RtaDeckPlanOutcome =
  | { ok: true; members: RtaDeckPlanResult[]; nodes: number; truncated: boolean; ms: number }
  | { ok: false; error: string; slotId?: string; label?: string };

const LADDER: { useMains: boolean; relaxSub: boolean; noSets: boolean; note: string | null }[] = [
  { useMains: true, relaxSub: false, noSets: false, note: null },
  { useMains: false, relaxSub: false, noSets: false, note: "不限主屬性" },
  { useMains: false, relaxSub: true, noSets: false, note: "不限主屬性、允許破套" },
  { useMains: false, relaxSub: true, noSets: true, note: "不限套裝與主屬性" },
];

const STAT_LABEL: Partial<Record<StatKey, string>> = {
  hp: "體力",
  atk: "攻擊",
  def: "防禦",
  spd: "速度",
  cr: "暴擊率",
  cd: "暴擊傷害",
  res: "抵抗",
  acc: "命中",
};

function pickBest(builds: TopBuild[]): TopBuild | undefined {
  return builds[0];
}

export function planRtaDeck(
  req: RtaDeckPlanRequest,
  onProgress?: (p: RtaDeckPlanProgress) => void,
): RtaDeckPlanOutcome {
  const t0 = Date.now();
  const used = new Set<number>(req.excludeRunes);
  const lockedSet = new Set<number>(req.lockedRunes);
  let nodes = 0;
  let truncated = false;

  /** 神器提供的固定體力 / 攻擊 / 防禦（與遊戲面板一致） */
  const artifactFlatOf = (member: RtaDeckPlanMember) => {
    const flat = { hp: 0, atk: 0, def: 0 };
    for (const art of member.seedArtifacts ?? []) {
      const key = ARTIFACT_MAIN[art.main.t]?.key;
      if (key) flat[key] += art.main.v;
    }
    return flat.hp || flat.atk || flat.def ? flat : undefined;
  };

  /**
   * 目前 RTA 配裝是否可以直接沿用。
   * 搜尋用「每位置取前 N 顆」的方式剪枝；遇到很緊的多項數值下限時，
   * 可能找不到任何組合，但玩家現在穿的這套其實就達標。
   * 這時先驗證現有配裝，符合就回傳，避免誤報「配不到」。
   */
  const seedResultOf = (
    member: RtaDeckPlanMember,
    min: Partial<Record<StatKey, number>>,
    max: Partial<Record<StatKey, number>>,
  ): RtaDeckPlanResult | null => {
    const ids = member.seedRunes ?? [];
    if (ids.length !== 6) return null;
    const byId = new Map(req.runes.map((r) => [r.id, r]));
    const list = ids.map((id) => byId.get(id)).filter((r): r is Rune => !!r);
    if (list.length !== 6) return null;
    if (new Set(list.map((r) => r.slot)).size !== 6) return null;
    for (const r of list) {
      if (used.has(r.id)) return null;
      if (lockedSet.has(r.id) && r.occupied !== member.unitId) return null;
    }
    // 指定的套裝與主屬性也要符合，不能偷偷換成別的配置
    const sets = (member.sets ?? []).filter((s) => s.set > 0 && s.count > 0);
    if (sets.length > 0) {
      const counts: Record<number, number> = {};
      for (const r of list) counts[r.set] = (counts[r.set] ?? 0) + 1;
      const eff = effectiveSetCounts(counts);
      if (sets.some((s) => (eff[s.set] ?? 0) < s.count)) return null;
    }
    for (const [slot, allowed] of Object.entries(member.mains ?? {})) {
      if (!allowed || allowed.length === 0) continue;
      const rune = list.find((r) => r.slot === Number(slot));
      if (!rune || !allowed.includes(rune.main.t)) return null;
    }

    const bonus = { ...req.bonus, leadSpd: req.leaderPct, useGuild: false, grind: true };
    const artifacts = member.seedArtifacts ?? [];
    const battle = statsForRunes(member.base, list, bonus, true, true, artifacts);
    for (const [k, v] of Object.entries(min) as [StatKey, number][]) if (battle[k] < v) return null;
    for (const [k, v] of Object.entries(max) as [StatKey, number][]) if (battle[k] > v) return null;

    const stats = statsForRunes(member.base, list, bonus, true, false, artifacts);
    const eff = list.reduce((sum, r) => sum + r.eff, 0) / 6;
    return {
      slotId: member.slotId,
      unitId: member.unitId,
      runeIds: list.map((r) => r.id),
      stats,
      ehp: stats.ehp,
      score: scoreOf(stats),
      eff,
      focusFit: 0,
      objective: member.objective ?? roleObjective(member.role),
      notes: [`${member.label}：搜尋不到更好的組合，沿用目前 RTA 配裝（已符合條件）。`],
    };
  };

  type PlanOne = { ok: true; result: RtaDeckPlanResult } | { ok: false; error: string };

  /** 為單一配裝格找配裝；spdMin / spdMax 是速度順序額外給的區間 */
  const buildMember = (
    member: RtaDeckPlanMember,
    spdMin: number | null = null,
    spdMax: number | null = null,
  ): PlanOne => {
    const min: Partial<Record<StatKey, number>> = { ...(member.min ?? {}) };
    const max: Partial<Record<StatKey, number>> = { ...(member.max ?? {}) };
    if (spdMin != null) min.spd = Math.max(min.spd ?? 0, Math.round(spdMin));
    if (spdMax != null) {
      const cap = Math.round(spdMax);
      max.spd = max.spd == null ? cap : Math.min(max.spd, cap);
    }

    const loSpd = min.spd ?? 0;
    const hiSpd = max.spd;
    if (hiSpd != null && loSpd > hiSpd) {
      return {
        ok: false,
        error: `「${member.label}」依速度順序需要 ${loSpd}～${hiSpd} 速，這個區間沒有可用的速度。請降低速度差或調整速度下限。`,
      };
    }

    const objective = member.objective ?? roleObjective(member.role);
    let chosen: TopBuild | undefined;
    let chosenNote: string | null = null;
    let seedChosen: RtaDeckPlanResult | null = null;
    let lastCandidates: number[] = [];

    for (const [stepIndex, step] of LADDER.entries()) {
      // 使用者原本就沒有限制主屬性時，不必重複跑「不限主屬性」那一階
      if (!step.useMains && !Object.keys(member.mains ?? {}).length) continue;
      const res = optimize({
        base: member.base,
        runes: req.runes,
        required: step.noSets ? [] : member.sets,
        min,
        max,
        bonus: { ...req.bonus, leadSpd: req.leaderPct, useGuild: false, grind: true },
        pool: req.pool,
        allowEquipped: true,
        targetUnit: member.unitId,
        rta: true,
        maxNodes: req.maxNodes,
        mainAlternatives: step.useMains ? member.mains : {},
        relaxSub: step.relaxSub,
        intangible: false,
        excludeRunes: [...used],
        lockedRunes: [...lockedSet],
        topK: Math.max(1, req.topK),
        objective,
        artifactFlat: artifactFlatOf(member),
      });
      nodes += res.nodes;
      truncated = truncated || res.truncated;
      lastCandidates = res.topBuilds?.map((b) => b.stats.spd) ?? [];
      chosen = pickBest(res.topBuilds ?? []);
      if (chosen) {
        chosenNote = step.note;
        break;
      }
      // 完整條件找不到時，先看目前的 RTA 配裝是否本來就達標；
      // 這樣就不會為了硬湊而先放寬套裝 / 主屬性。
      if (stepIndex === 0) {
        seedChosen = seedResultOf(member, min, max);
        if (seedChosen) break;
      }
    }

    if (seedChosen) {
      for (const id of seedChosen.runeIds) used.add(id);
      return { ok: true, result: seedChosen };
    }

    if (!chosen) {
      const rangeHint =
        loSpd > 0 && hiSpd != null
          ? `速度需求是 ${loSpd}～${hiSpd} 速。`
          : loSpd > 0
            ? `速度下限是 ${loSpd} 速。`
            : hiSpd != null
              ? `速度上限是 ${hiSpd} 速。`
              : "";
      return {
        ok: false,
        error: `無法為「${member.label}」找到符合條件的配裝。${rangeHint}請放寬數值下限 / 速度差，或確認符文庫每個位置都有足夠符文。${
          lastCandidates.length > 0 ? `（最後一次搜尋找到的速度：${lastCandidates.slice(0, 5).join("、")}）` : ""
        }`,
      };
    }

    for (const id of chosen.runeIds) used.add(id);
    return {
      ok: true,
      result: {
        slotId: member.slotId,
        unitId: member.unitId,
        runeIds: chosen.runeIds,
        stats: chosen.stats,
        ehp: chosen.ehp,
        score: chosen.score,
        eff: chosen.eff,
        focusFit: chosen.focusFit,
        objective,
        notes: chosenNote ? [`${member.label}：找不到原本的條件，已改為${chosenNote}。`] : [],
      },
    };
  };

  const results = new Map<number, RtaDeckPlanResult>();
  const chainIdx = req.members.map((_, i) => i).filter((i) => req.members[i].speedChain);
  const looseIdx = req.members.map((_, i) => i).filter((i) => !req.members[i].speedChain);
  let processed = 0;

  const runOne = (i: number, spdMin: number | null, spdMax: number | null): PlanOne => {
    const member = req.members[i];
    onProgress?.({ index: processed, total: req.members.length, slotId: member.slotId, label: member.label });
    processed++;
    return buildMember(member, spdMin, spdMax);
  };

  // 速度順序：由快到慢配。若符文真的湊不出指定速度差，仍然配裝並標註，
  // 讓使用者看得到實際差距（比整批失敗更有用）。
  let prevSpeed: number | null = null;
  for (const i of chainIdx) {
    const member = req.members[i];
    const gap = Math.max(0, Math.round(member.gap || 0));
    const cap = prevSpeed == null ? null : prevSpeed - gap;
    const exact = req.gapMode === "exact" && cap != null;
    let one = runOne(i, exact ? cap : null, cap);
    let relaxed = false;
    if (!one.ok) {
      // 「剛好差 N 速」找不到就照錯誤回報；「至少差 N 速」才放寬上限繼續配。
      if (exact) return { ok: false, slotId: member.slotId, label: member.label, error: one.error };
      one = runOne(i, null, null);
      relaxed = true;
    }
    if (!one.ok) return { ok: false, slotId: member.slotId, label: member.label, error: one.error };
    if (relaxed) {
      one.result.notes.push(
        `${member.label}：符文不足以維持指定的速度差，這個角色沒有套用速度上限。`,
      );
    }
    results.set(i, one.result);
    prevSpeed = one.result.stats.spd;
  }

  for (const i of looseIdx) {
    const one = runOne(i, null, null);
    if (!one.ok) return { ok: false, slotId: req.members[i].slotId, label: req.members[i].label, error: one.error };
    results.set(i, one.result);
  }

  const out = req.members
    .map((_, i) => results.get(i))
    .filter((r): r is RtaDeckPlanResult => !!r);
  return { ok: true, members: out, nodes, truncated, ms: Date.now() - t0 };
}

/** 給 UI 顯示目前速度差是否符合設定（配完後的檢查） */
export function speedGapIssues(
  members: { slotId: string; label: string; spd: number; gap: number }[],
  mode: "at-least" | "exact",
): { slotId: string; label: string; actual: number; expected: number; ok: boolean }[] {
  const out: { slotId: string; label: string; actual: number; expected: number; ok: boolean }[] = [];
  for (let i = 1; i < members.length; i++) {
    const prev = members[i - 1];
    const cur = members[i];
    const actual = prev.spd - cur.spd;
    const expected = Math.max(0, Math.round(cur.gap || 0));
    const ok = mode === "exact" ? actual === expected : actual >= expected;
    out.push({ slotId: cur.slotId, label: cur.label, actual, expected, ok });
  }
  return out;
}

/** 把 result 的符文轉成 set 件數（顯示用） */
export function resultSets(result: RtaDeckPlanResult, runeById: Map<number, Rune>): Record<number, number> {
  const sets: Record<number, number> = {};
  for (const id of result.runeIds) {
    const rune = runeById.get(id);
    if (!rune) continue;
    sets[rune.set] = (sets[rune.set] ?? 0) + 1;
  }
  return sets;
}

/** 與配裝格相同的套裝需求（避免 worker 與 UI 兩邊定義不同） */
export { deckSlotSets };
