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
import { optimize, type OptObjective, type TopBuild } from "./optimizer";
import { roleObjective, type TeamRole } from "./teamOptimizer";
import { deckSlotSets } from "./rtaDeck";
import type { BaseStats } from "./stats";
import type { BonusConfig, Rune, Stats } from "./types";

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
  const out: RtaDeckPlanResult[] = [];
  let nodes = 0;
  let truncated = false;
  /** 前一隻的實戰速度（速度順序較快的那隻） */
  let prevSpeed: number | null = null;

  for (let i = 0; i < req.members.length; i++) {
    const member = req.members[i];
    onProgress?.({ index: i, total: req.members.length, slotId: member.slotId, label: member.label });

    const min: Partial<Record<StatKey, number>> = { ...(member.min ?? {}) };
    const max: Partial<Record<StatKey, number>> = { ...(member.max ?? {}) };
    const targetGap = Math.max(0, Math.round(member.gap || 0));

    // 不參與速度串接的格子：不繼承前一隻的速度上限
    if (!member.speedChain) prevSpeed = null;

    if (member.speedChain && prevSpeed != null) {
      const cap = prevSpeed - targetGap;
      if (cap <= 0) {
        return {
          ok: false,
          slotId: member.slotId,
          label: member.label,
          error: `「${member.label}」需要比前一隻慢 ${targetGap} 速，但前一隻只有 ${prevSpeed} 速，速度會變成 ${cap}。請降低速度差、提高前一隻的速度，或取消這隻的速度順序。`,
        };
      }
      // 後面的魔靈一定要比前一隻慢指定的速度差
      max.spd = max.spd == null ? cap : Math.min(max.spd, cap);
      if (req.gapMode === "exact") {
        min.spd = cap;
      }
    }

    // 自己的速度下限不可高於上限
    const loSpd = min.spd ?? 0;
    const hiSpd = max.spd;
    if (hiSpd != null && loSpd > hiSpd) {
      return {
        ok: false,
        slotId: member.slotId,
        label: member.label,
        error:
          req.gapMode === "exact"
            ? `「${member.label}」的速度下限是 ${loSpd}，但依速度順序只能到 ${hiSpd} 速（前一隻 ${prevSpeed} 速 − ${targetGap}）。請降低下限或改用「至少差 N 速」。`
            : `「${member.label}」的速度下限 ${loSpd} 高於速度上限 ${hiSpd}，請調整速度下限或速度差。`,
      };
    }

    const objective = member.objective ?? roleObjective(member.role);
    let chosen: TopBuild | undefined;
    let chosenNote: string | null = null;
    let lastCandidates: number[] = [];

    for (const step of LADDER) {
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
      });
      nodes += res.nodes;
      truncated = truncated || res.truncated;
      lastCandidates = res.topBuilds?.map((b) => b.stats.spd) ?? [];
      chosen = pickBest(res.topBuilds ?? []);
      if (chosen) {
        chosenNote = step.note;
        break;
      }
    }

    if (!chosen) {
      const lowHint = prevSpeed != null ? `目前速度上限是 ${max.spd} 速（前一隻 ${prevSpeed} 速 − ${targetGap}）。` : "";
      const ownHint = member.min.spd ? `速度下限是 ${member.min.spd} 速。` : "";
      return {
        ok: false,
        slotId: member.slotId,
        label: member.label,
        error: `無法為「${member.label}」找到符合條件的配裝。${lowHint}${ownHint}請放寬數值下限 / 速度差、改回「至少差 N 速」，或確認符文庫每個位置都有足夠符文。${
          lastCandidates.length > 0 ? `（最後一次搜尋找到的速度：${lastCandidates.slice(0, 5).join("、")}）` : ""
        }`,
      };
    }

    for (const id of chosen.runeIds) used.add(id);
    if (member.speedChain) prevSpeed = chosen.stats.spd;
    out.push({
      slotId: member.slotId,
      unitId: member.unitId,
      runeIds: chosen.runeIds,
      stats: chosen.stats,
      ehp: chosen.ehp,
      score: chosen.objective,
      eff: chosen.eff,
      focusFit: chosen.focusFit,
      objective,
      notes: chosenNote ? [`${member.label}：找不到原本的條件，已改為${chosenNote}。`] : [],
    });
  }

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
