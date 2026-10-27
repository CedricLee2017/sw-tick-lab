/** 第二階段：神器最佳化（符文組合已由第一階段篩選） */
import { artifactAdditionalDamage, artifactEligible } from "./artifacts";
import { computeSkillDamage, type DamageOptions, type Skill } from "./damage";
import type { Build } from "./optimizer";
import { statsForRunes, type BaseStats } from "./stats";
import type { Artifact, BonusConfig, Monster, Rune, Stats } from "./types";

export type Stage2Mode = "skill" | "add";

export interface Stage2SkillInput {
  skill: Skill;
  /** 相對權重 1–10 */
  weight: number;
}

export interface Stage2SkillLine {
  skill: Skill;
  weight: number;
  base: number;
  ad: number;
  total: number;
}

export interface Stage2Pair {
  artifacts: [Artifact, Artifact];
  /** 這對神器搭配的最佳符文組合（來自第一階段前 500 組） */
  build: Build;
  stats: Stats;
  /** 這個模式的排序分數（招式傷害或追傷） */
  score: number;
  /** 加權招式傷害（不含追傷） */
  base: number;
  /** 加權追傷 */
  ad: number;
  /** 加權總傷害 */
  total: number;
  lines: Stage2SkillLine[];
}

export interface Stage2Output {
  mode: Stage2Mode;
  /** 實際參與運算的 10 件神器（屬性 5 + 類型 5，可能更少） */
  candidates: Artifact[];
  type1: Artifact[];
  type2: Artifact[];
  /** 25 對神器（每對都已搭配前 500 組中最好的符文） */
  pairs: Stage2Pair[];
  builds: number;
  ms: number;
  warnings: string[];
}

export interface Stage2Request {
  base: BaseStats;
  /** 第一階段目前排序的前 500 組 */
  builds: Build[];
  bonus: BonusConfig;
  rta: boolean;
  monster: Monster;
  artifacts: Artifact[];
  skills: Stage2SkillInput[];
  mode: Stage2Mode;
  /** 屬性神器主屬性：0 不限、100 HP、101 ATK、102 DEF */
  main1: number;
  /** 類型神器主屬性：0 不限、100 HP、101 ATK、102 DEF */
  main2: number;
  dmgOpts: DamageOptions;
  /** 每種類型最多取幾件（預設 5，共 10 件 / 25 對） */
  perType?: number;
}

const runesOf = (build: Build): Rune[] => build.runes.filter((r): r is Rune => !!r);

const weightedAverage = (values: number[], weights: number[]): number => {
  let sum = 0;
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] * weights[i];
    total += weights[i];
  }
  return total > 0 ? sum / total : 0;
};

/**
 * 先依招式 / 追傷分數，從符合屬性、類型與主屬性的神器中，
 * 各挑出前 N 件（預設 5 件）；再對 5×5 對神器 × 前 500 組符文做完整運算。
 */
export function runStage2(req: Stage2Request): Stage2Output {
  const t0 = Date.now();
  const warnings: string[] = [];
  const perType = Math.max(1, req.perType ?? 5);
  const builds = req.builds;
  const skills = req.skills.filter((s) => s && s.weight > 0);
  const opts: DamageOptions = { ...req.dmgOpts, useArtifacts: true };
  const weights = skills.map((s) => s.weight);

  const output = (args: Partial<Stage2Output>): Stage2Output => ({
    mode: req.mode,
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
    warnings.push("第一階段沒有可用的符文組合，請先完成配符。");
    return output({});
  }
  if (skills.length === 0) {
    warnings.push("請至少選擇 1 招技能並設定比重大於 0。");
    return output({});
  }

  const mainOk = (art: Artifact, main: number) => main === 0 || art.main.t === main;
  const type1All = req.artifacts.filter(
    (a) => a.type === 1 && artifactEligible(a, req.monster) && mainOk(a, req.main1),
  );
  const type2All = req.artifacts.filter(
    (a) => a.type === 2 && artifactEligible(a, req.monster) && mainOk(a, req.main2),
  );
  if (type1All.length === 0) warnings.push("沒有符合屬性 / 主屬性的屬性神器。");
  if (type2All.length === 0) warnings.push("沒有符合類型 / 主屬性的類型神器。");
  if (type1All.length === 0 || type2All.length === 0) {
    return output({ warnings, candidates: [...type1All.slice(0, perType), ...type2All.slice(0, perType)] });
  }

  /** 用前、中、後三組代表符文，避免只針對單一配置挑神器 */
  const repBuilds = [...new Set([builds[0], builds[Math.floor(builds.length / 2)], builds[builds.length - 1]])];
  const repRunes = repBuilds.map(runesOf);
  const weightedHits = weightedAverage(skills.map((s) => Math.max(1, s.skill.hits || 1)), weights);

  const scoreArtifact = (art: Artifact, rep: number): number => {
    const stats = statsForRunes(req.base, repRunes[rep], req.bonus, req.rta, true, [art]);
    if (req.mode === "add") {
      return artifactAdditionalDamage(stats, [art]) * weightedHits;
    }
    const damages = skills.map((s) => computeSkillDamage(stats, s.skill, opts, [art]).baseTotal);
    return weightedAverage(damages, weights);
  };

  const rank = (list: Artifact[]): Artifact[] => {
    const scored = list.map((art) => {
      let score = 0;
      for (let i = 0; i < repRunes.length; i++) score += scoreArtifact(art, i);
      score /= repRunes.length;
      return { art, score };
    });
    scored.sort((a, b) => b.score - a.score || b.art.main.v - a.art.main.v || a.art.id - b.art.id);
    return scored.slice(0, perType).map((x) => x.art);
  };

  const type1 = rank(type1All);
  const type2 = rank(type2All);
  const candidates = [...type1, ...type2];

  const pairs: Stage2Pair[] = [];
  for (const a1 of type1) {
    for (const a2 of type2) {
      let best: Stage2Pair | null = null;
      for (const build of builds) {
        const runes = runesOf(build);
        const stats = statsForRunes(req.base, runes, req.bonus, req.rta, true, [a1, a2]);
        const lines: Stage2SkillLine[] = skills.map((s) => {
          const r = computeSkillDamage(stats, s.skill, opts, [a1, a2]);
          return { skill: s.skill, weight: s.weight, base: r.baseTotal, ad: r.adTotal, total: r.total };
        });
        const base = weightedAverage(lines.map((l) => l.base), weights);
        const ad = weightedAverage(lines.map((l) => l.ad), weights);
        const total = weightedAverage(lines.map((l) => l.total), weights);
        const score = req.mode === "skill" ? base : ad;
        if (!best || score > best.score) {
          best = { artifacts: [a1, a2], build, stats, score, base, ad, total, lines };
        }
      }
      if (best) pairs.push(best);
    }
  }

  pairs.sort((a, b) => b.score - a.score || b.total - a.total);
  return output({ candidates, type1, type2, pairs, warnings });
}
