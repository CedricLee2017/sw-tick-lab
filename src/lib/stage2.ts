/** 神器最佳化（以固定的目前符文組合為基礎） */
import {
  ARTIFACT_EFFECT_MAX,
  artifactEligible,
  artifactSubValue,
} from "./artifacts";
import { computeSkillDamage, type DamageOptions, type Skill } from "./damage";
import type { Build } from "./optimizer";
import { statsForRunes, type BaseStats } from "./stats";
import type { Artifact, BonusConfig, Monster, Rune, Stats } from "./types";

/** 神器副效果 Focus：符合 Min/Max 才納入候選；weight 用於契合度排序 */
export interface Stage2Focus {
  effect: number;
  min: number;
  max: number;
  /** 相對權重 1–10 */
  weight: number;
}

export interface Stage2Pair {
  artifacts: [Artifact, Artifact];
  /** 使用的符文組合（目前裝備或收藏） */
  build: Build;
  stats: Stats;
  /** 招式傷害（單一技能，含段數） */
  score: number;
  base: number;
  hits: number;
  /** 兩件神器各自的 Focus 契合度（0–100；未設定 Focus 時為 0） */
  focus: [number, number];
}

export interface Stage2Output {
  /** 實際參與運算的 10 件神器（屬性 5 + 類型 5，可能更少） */
  candidates: Artifact[];
  type1: Artifact[];
  type2: Artifact[];
  pairs: Stage2Pair[];
  builds: number;
  ms: number;
  warnings: string[];
}

export interface Stage2Request {
  base: BaseStats;
  /** 要套用神器的符文組合（配神器頁固定為目前 1 組） */
  builds: Build[];
  bonus: BonusConfig;
  rta: boolean;
  monster: Monster;
  artifacts: Artifact[];
  /** 傷害面板目前選的技能 */
  skill: Skill;
  /** 屬性神器主屬性：0 不限、100 HP、101 ATK、102 DEF */
  main1: number;
  /** 類型神器主屬性：0 不限、100 HP、101 ATK、102 DEF */
  main2: number;
  /** 屬性神器副效果 Focus（最多 5 條） */
  focus1: Stage2Focus[];
  /** 類型神器副效果 Focus（最多 5 條） */
  focus2: Stage2Focus[];
  dmgOpts: DamageOptions;
  /** 每種類型最多取幾件（預設 5，共 10 件 / 25 對） */
  perType?: number;
}

const runesOf = (build: Build): Rune[] => build.runes.filter((r): r is Rune => !!r);

const cleanFocus = (list: Stage2Focus[]): Stage2Focus[] =>
  list
    .filter((f) => f && f.effect > 0 && f.weight > 0)
    .map((f) => ({
      effect: f.effect,
      min: Math.max(0, Number(f.min) || 0),
      max: Math.max(0, Number(f.max) || 0),
      weight: Math.max(1, Math.min(10, Math.round(f.weight))),
    }))
    .slice(0, 5);

/**
 * 神器是否符合 Focus 的 Min/Max；符合時回傳 0–100 的契合度。
 * 契合度 = Σ(權重 × 數值/該效果上限) / Σ權重。
 */
export function artifactFocusFit(art: Artifact, focus: Stage2Focus[]): number | null {
  const rows = cleanFocus(focus);
  if (rows.length === 0) return 0;
  let sum = 0;
  let totalWeight = 0;
  for (const f of rows) {
    const v = artifactSubValue(art, f.effect);
    if (v <= 0 || v < f.min - 1e-9 || v > f.max + 1e-9) return null;
    const max = ARTIFACT_EFFECT_MAX[f.effect] ?? 1;
    sum += f.weight * Math.min(1, Math.max(0, v / max));
    totalWeight += f.weight;
  }
  return totalWeight > 0 ? (sum / totalWeight) * 100 : 0;
}

/**
 * 先依魔靈屬性 / 類型、主屬性與 Focus Min/Max 篩選神器，
 * 各挑出前 N 件（預設 5 件）；再對 5×5 對神器 × 前 500 組符文做完整運算。
 */
export function runStage2(req: Stage2Request): Stage2Output {
  const t0 = Date.now();
  const warnings: string[] = [];
  const perType = Math.max(1, req.perType ?? 5);
  const builds = req.builds;
  const opts: DamageOptions = { ...req.dmgOpts, useArtifacts: true };
  const focus1 = cleanFocus(req.focus1);
  const focus2 = cleanFocus(req.focus2);

  const output = (args: Partial<Stage2Output>): Stage2Output => ({
    candidates: [],
    type1: [],
    type2: [],
    pairs: [],
    builds: builds.length,
    ms: Date.now() - t0,
    warnings,
    ...args,
  });

  if (builds.length === 0) {
    warnings.push("沒有可用的符文組合，請先選擇魔靈或收藏配裝。");
    return output({});
  }
  if (!req.skill) {
    warnings.push("請先在傷害面板選擇一招技能，才能計算神器效果。");
    return output({});
  }

  const mainOk = (art: Artifact, main: number) => main === 0 || art.main.t === main;
  const type1All = req.artifacts.filter(
    (a) => a.type === 1 && artifactEligible(a, req.monster) && mainOk(a, req.main1),
  );
  const type2All = req.artifacts.filter(
    (a) => a.type === 2 && artifactEligible(a, req.monster) && mainOk(a, req.main2),
  );

  /** 用前、中、後三組代表符文，避免只針對單一配置挑神器 */
  const repBuilds = [...new Set([builds[0], builds[Math.floor(builds.length / 2)], builds[builds.length - 1]])];
  const repRunes = repBuilds.map(runesOf);

  const skillScore = (art: Artifact, stats: Stats): number =>
    computeSkillDamage(stats, req.skill, opts, [art]).baseTotal;

  const rank = (list: Artifact[], focus: Stage2Focus[]): { art: Artifact; fit: number }[] => {
    const scored = list
      .map((art) => {
        const fit = artifactFocusFit(art, focus);
        if (fit === null) return null;
        let score = 0;
        for (const runes of repRunes) {
          const stats = statsForRunes(req.base, runes, req.bonus, req.rta, true, [art]);
          score += skillScore(art, stats);
        }
        return { art, fit, score: score / repRunes.length };
      })
      .filter((x): x is { art: Artifact; fit: number; score: number } => !!x);
    // 有設定 Focus 時，先依契合度挑前 5 件（同分再比傷害 / 追傷）；沒有 Focus 才只看分數。
    scored.sort((a, b) =>
      focus.length > 0
        ? b.fit - a.fit || b.score - a.score || b.art.main.v - a.art.main.v
        : b.score - a.score || b.art.main.v - a.art.main.v || a.art.id - b.art.id,
    );
    return scored.slice(0, perType).map(({ art, fit }) => ({ art, fit }));
  };

  const ranked1 = rank(type1All, focus1);
  const ranked2 = rank(type2All, focus2);
  const type1 = ranked1.map((x) => x.art);
  const type2 = ranked2.map((x) => x.art);
  const focusOf = new Map<number, number>();
  for (const x of [...ranked1, ...ranked2]) focusOf.set(x.art.id, x.fit);

  if (type1.length === 0) {
    warnings.push(
      focus1.length > 0
        ? "屬性神器沒有符合屬性 / 主屬性 / Focus Min-Max 的候選。"
        : "沒有符合屬性 / 主屬性的屬性神器。",
    );
  }
  if (type2.length === 0) {
    warnings.push(
      focus2.length > 0
        ? "類型神器沒有符合類型 / 主屬性 / Focus Min-Max 的候選。"
        : "沒有符合類型 / 主屬性的類型神器。",
    );
  }
  const candidates = [...type1, ...type2];
  if (type1.length === 0 || type2.length === 0) return output({ candidates, type1, type2 });

  const pairs: Stage2Pair[] = [];
  for (const a1 of type1) {
    for (const a2 of type2) {
      let best: Stage2Pair | null = null;
      for (const build of builds) {
        const runes = runesOf(build);
        const stats = statsForRunes(req.base, runes, req.bonus, req.rta, true, [a1, a2]);
        const r = computeSkillDamage(stats, req.skill, opts, [a1, a2]);
        const score = r.baseTotal;
        const focus: [number, number] = [focusOf.get(a1.id) ?? 0, focusOf.get(a2.id) ?? 0];
        if (!best || score > best.score) {
          best = {
            artifacts: [a1, a2],
            build,
            stats,
            score,
            base: r.baseTotal,
            hits: r.hits,
            focus,
          };
        }
      }
      if (best) pairs.push(best);
    }
  }

  pairs.sort((a, b) => b.score - a.score);
  return output({ candidates, type1, type2, pairs, warnings });
}
