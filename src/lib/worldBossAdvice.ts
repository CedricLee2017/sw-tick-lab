/**
 * 世界王配裝建議
 *
 * 1. 選角：水屬性魔靈，優先順序為「原五 > 二覺 > 原四 > 其他」，
 *    同一層級再以技能升級次數（各技能等級 - 1 的總和）由多至少排序。
 * 2. 配符：
 *    - 2/6 位主屬性依魔靈類型決定：攻擊型攻擊%、體力型體力%、防禦型防禦%；
 *      支援型依基本體力／防禦力混搭。
 *    - 4 號位可用爆傷或爆率；攻擊型優先爆傷，爆率會盡量控制在 100% 以下。
 *    - 選符以配合類型的面板數值為主，遊戲符文分數（◆）作為次要加分。
 *    - 盡量三組 2 件套（2+2+2）；速度不計分，爆率／爆傷只作 4 號位與次要加分。
 * 3. 神器：每隻配一件屬性神器 + 一件類型神器，主效果與追加傷害優先配合該魔靈的主屬性。
 * 4. 分配：以「符文分數總和」做平衡分配，每次把下一組符文配給目前總分最低的魔靈，
 *    令 60 隻的符文總分盡量接近，不會集中在少數幾隻。
 *
 * 這裡只產生「建議」，不會改動存檔；同一顆符文 / 神器最多只會被建議給一隻魔靈。
 */
import { RUNE_SETS, SET_BY_ID, STAT_TYPES } from "./constants";
import { ARTIFACT_EFFECTS } from "./artifacts";
import { baseStats, runeScore, statsForRunes } from "./stats";
import type { Account, Artifact, BonusConfig, Monster, Rune, Stats, Unit } from "./types";

export type WbFocus = "hp" | "atk" | "def";
/** 2/4/6 位可能出現的主屬性（4 號位可以是爆率 / 爆傷） */
export type WbMainStat = WbFocus | "cr" | "cd";

/** 魔靈類型中文 */
export const WB_ARCH_LABEL: Record<string, string> = {
  Attack: "攻擊型",
  Defense: "防禦型",
  HP: "體力型",
  Support: "支援型",
  Material: "素材",
};

/** 選角優先級：0 原五、1 二覺、2 原四、3 其他 */
export const WB_TIER_LABEL = ["原五", "二覺", "原四", "其他"];

export interface WbSetCount {
  set: number;
  count: number;
}

export interface WbMonsterPlan {
  unit: Unit;
  monster: Monster;
  /** 這隻魔靈主要堆疊的面板屬性（支援型取體力 / 防禦力較高者） */
  focus: WbFocus;
  focusLabel: string;
  /** 實際配到的 2/4/6 主屬性 */
  mainPlan: Record<number, WbMainStat>;
  /** 0 原五、1 二覺、2 原四、3 其他 */
  tier: number;
  /** 技能升級總次數；undefined = 舊存檔沒有技能資料 */
  skillUps?: number;
  /** 建議的 6 顆符文（依位置排序） */
  runes: Rune[];
  /** 6 顆符文的遊戲分數（◆）總和 */
  runeScoreTotal: number;
  /** 建議的 0–2 件神器 */
  artifacts: Artifact[];
  /** 套裝件數，例如 祝福 ×2、鬥志 ×2、意志 ×2 */
  sets: WbSetCount[];
  /** 魔靈基礎數值（依星級 / 等級換算） */
  base: ReturnType<typeof baseStats>;
  /** 依建議配裝算出的面板 */
  stats: Stats;
  /** 主屬性面板值（給「依面板排序」用） */
  focusValue: number;
}

export interface WbPlanOptions {
  /** 要挑幾隻（預設 60） */
  count: number;
  /** 只挑水屬性（預設 true） */
  waterOnly?: boolean;
  /** 應用程式內排除的符文 id（不會被建議使用） */
  excludedRunes?: readonly number[];
  /** 建築 / 公會等加成設定 */
  bonus: BonusConfig;
  /** 只用目前未裝備的符文（避免拆掉現有配裝） */
  freeOnly?: boolean;
  /** 由 unit_master_id 取得魔靈資料 */
  monsterOf: (master: number) => Monster | undefined;
}

/** 2 件套（排除無形 25，因為它只能補 1 件，不適合當 2+2+2 的一組） */
const TWO_PIECE_SETS = RUNE_SETS.filter((s) => s.pieces === 2 && s.id !== 25).map((s) => s.id);

const ARCH_STYLE: Record<string, number> = { Attack: 1, Defense: 2, HP: 3, Support: 4 };
const MAIN_SLOTS = [2, 4, 6] as const;
const CR_PENALTY = 0.05;

/** 體力 / 攻擊 / 防禦三圍的相對權重 */
interface WbStatWeights {
  hp: number;
  atk: number;
  def: number;
}

interface WbProfile {
  focus: WbFocus;
  /** 副屬 / 固有屬 / 套裝加成用：三圍的相對比重 */
  weights: WbStatWeights;
  /** 2/4/6 位的首選主屬性（4 號位實際可以是爆傷／爆率） */
  mainPlan: Record<number, WbMainStat>;
  /** 4 號位各主屬性的比重（爆率 / 爆傷可透過這裡調整） */
  slot4Weight: Partial<Record<WbMainStat, number>>;
}

export const FOCUS_LABEL: Record<WbFocus, string> = { hp: "體力", atk: "攻擊力", def: "防禦力" };
export const WB_MAIN_LABEL: Record<WbMainStat, string> = {
  hp: "體力",
  atk: "攻擊力",
  def: "防禦力",
  cr: "暴擊率",
  cd: "暴擊傷害",
};

/**
 * 依魔靈類型與基本三圍建立配裝方向。
 * 支援型用「基本體力 vs 基本防禦」決定 2/4/6 要幾多條體力%、幾多條防禦%，
 * 兩者接近時就會混搭（例如 2/4 體力%、6 防禦%）。
 */
function profileFor(monster: Monster, base: { hp: number; atk: number; def: number }): WbProfile {
  if (monster.arch === "Attack") {
    return {
      focus: "atk",
      weights: { hp: 0.15, atk: 1, def: 0.15 },
      mainPlan: { 2: "atk", 4: "cd", 6: "atk" },
      slot4Weight: { atk: 1, cd: 0.9, cr: 0.75 },
    };
  }
  if (monster.arch === "Defense") {
    return {
      focus: "def",
      weights: { hp: 0.35, atk: 0.1, def: 1 },
      mainPlan: { 2: "def", 4: "def", 6: "def" },
      slot4Weight: { def: 1, cd: 0.35, cr: 0.3 },
    };
  }
  if (monster.arch === "Support") {
    // 基本體力遠大於基本防禦，用 8 倍把防禦拉近同一尺度再比較。
    const hpWeight = base.hp / (base.hp + base.def * 8);
    const defWeight = 1 - hpWeight;
    const hpSlots = Math.min(3, Math.max(0, Math.round(3 * hpWeight)));
    const mainPlan: Record<number, WbMainStat> = {};
    MAIN_SLOTS.forEach((slot, i) => {
      mainPlan[slot] = i < hpSlots ? "hp" : "def";
    });
    return {
      focus: hpWeight >= defWeight ? "hp" : "def",
      weights: { hp: hpWeight, atk: 0.05, def: defWeight },
      mainPlan,
      // 支援型的 4 號位可以體 / 防，亦可以用爆傷 / 爆率（比重較低）
      slot4Weight: { hp: 1, def: 1, cd: 0.25, cr: 0.2 },
    };
  }
  // 體力型 / 素材 / 其他
  return {
    focus: "hp",
    weights: { hp: 1, atk: 0.1, def: 0.35 },
    mainPlan: { 2: "hp", 4: "hp", 6: "hp" },
    slot4Weight: { hp: 1, cd: 0.35, cr: 0.3 },
  };
}

/** 選角優先級：原五 > 二覺 > 原四 > 其他 */
function tierOf(monster: Monster): number {
  if (monster.nat === 5) return 0;
  if ((monster.awk ?? 0) >= 2) return 1;
  if (monster.nat === 4) return 2;
  return 3;
}

/**
 * 符文的配裝分數：
 * 1. 主屬性：2/6 位只計建議的主屬性；4 號位可以攻擊/體力/防禦% 或爆傷/爆率%。
 * 2. 副屬 / 固有屬性：依三圍權重計分，數值會除以該魔靈的基礎值，
 *    令體力%、攻擊%、防禦% 可以在同一尺度比較。
 * 3. 遊戲符文分數（◆）：作為次要加分（0–300 分 → 0–0.3）。
 */
function runePoints(
  rune: Rune,
  profile: WbProfile,
  base: { hp: number; atk: number; def: number },
  gameScore: number,
): number {
  const { weights, mainPlan, slot4Weight } = profile;
  let points = 0;

  const add = (t: number, v: number, weight?: number) => {
    const meta = STAT_TYPES[t];
    if (!meta) return;
    const key = meta.key;
    if (key !== "hp" && key !== "atk" && key !== "def") return;
    const w = weight ?? weights[key];
    if (w <= 0) return;
    const baseValue = base[key];
    const amount = meta.pct ? (v / 100) * baseValue : v;
    points += (amount / baseValue) * w;
  };

  const mainMeta = STAT_TYPES[rune.main.t];
  if (mainMeta) {
    const key = mainMeta.key;
    if (rune.slot === 2 || rune.slot === 4 || rune.slot === 6) {
      if (rune.slot === 4) {
        // 4 號位：攻擊/體力/防禦% 與爆傷/爆率% 都可以，其他主屬性扣分
        const w =
          key === "hp" || key === "atk" || key === "def" || key === "cr" || key === "cd"
            ? slot4Weight[key] ?? 0
            : 0;
        if (w > 0) {
          if (key === "hp" || key === "atk" || key === "def") add(rune.main.t, rune.main.v, w);
          else points += (rune.main.v / 100) * w;
        } else {
          points -= 0.35;
        }
      } else if (key === mainPlan[rune.slot]) {
        // 2/6 位：只有建議的主屬性才有分數
        add(rune.main.t, rune.main.v, 1);
      } else {
        points -= 0.35;
      }
    } else {
      add(rune.main.t, rune.main.v);
    }
  }
  if (rune.prefix?.t) add(rune.prefix.t, rune.prefix.v);
  for (const sub of rune.subs) add(sub.t, sub.v + (sub.g ?? 0));

  // 遊戲分數作為次要加分，避免完全忽略符文整體質素
  points += gameScore / 1000;
  return points;
}

/** 一條符文的爆擊率貢獻（主屬 + 固有 + 副屬） */
function rawCrOf(rune: Rune): number {
  let cr = 0;
  const add = (t: number, v: number) => {
    if (STAT_TYPES[t]?.key === "cr") cr += v;
  };
  add(rune.main.t, rune.main.v);
  if (rune.prefix?.t) add(rune.prefix.t, rune.prefix.v);
  for (const sub of rune.subs) add(sub.t, sub.v + (sub.g ?? 0));
  return cr;
}

/** 一個 2 件套加成換算成配裝分數（只計體力 / 攻擊 / 防禦套裝） */
function setBonusPoints(setId: number, weights: WbStatWeights): number {
  const def = SET_BY_ID[setId];
  if (!def || def.pieces !== 2 || !def.stat) return 0;
  const key = def.stat;
  if (key !== "hp" && key !== "atk" && key !== "def") return 0;
  return ((def.value ?? 0) / 100) * weights[key];
}

/** 神器：主效果與追加傷害優先配合該魔靈的三圍權重 */
function artifactPoints(
  artifact: Artifact,
  profile: WbProfile,
  base: { hp: number; atk: number; def: number },
): number {
  const { weights } = profile;
  let points = 0;

  const mainKey = artifact.main.t === 100 ? "hp" : artifact.main.t === 101 ? "atk" : artifact.main.t === 102 ? "def" : "";
  if (mainKey) points += (artifact.main.v / base[mainKey]) * weights[mainKey];

  for (const sub of artifact.subs) {
    const def = ARTIFACT_EFFECTS[sub.t];
    if (!def) continue;
    const key = sub.t === 218 ? "hp" : sub.t === 219 ? "atk" : sub.t === 220 ? "def" : "";
    if (key) points += (sub.v / 100) * weights[key];
    // 速度在世界王沒有意義，速度追傷（221）直接不計
    else if (sub.t !== 221 && (def.kind === "dmg" || def.kind === "def")) points += sub.v / 1000;
  }
  return points;
}

/** 實際配到的 2/4/6 主屬性（給卡片顯示） */
function actualMainPlan(runes: Rune[], profile: WbProfile): Record<number, WbMainStat> {
  const out: Record<number, WbMainStat> = { ...profile.mainPlan };
  for (const slot of MAIN_SLOTS) {
    const rune = runes.find((r) => r.slot === slot);
    const key = rune ? STAT_TYPES[rune.main.t]?.key : undefined;
    if (key === "hp" || key === "atk" || key === "def" || key === "cr" || key === "cd") out[slot] = key;
  }
  return out;
}

interface DraftMonster {
  unit: Unit;
  monster: Monster;
  tier: number;
  skillUps?: number;
  base: ReturnType<typeof baseStats>;
  profile: WbProfile;
  priority: number;
  remainingSlots: Set<number>;
  runes: Rune[];
  totalScore: number;
  cr: number;
  points: Map<number, number>;
  bySetSlot: Map<string, Rune[]>;
  bySlot: Map<number, Rune[]>;
}

/**
 * 建立世界王建議。
 * 符文用「最低總分優先」的平衡分配：每次由目前符文總分最低的魔靈拿下一組 2 件套，
 * 令 60 隻的總分盡量接近；同一顆符文 / 神器最多只會被建議給一隻魔靈。
 */
export function buildWorldBossPlan(account: Account, opts: WbPlanOptions): WbMonsterPlan[] {
  const excluded = new Set(opts.excludedRunes ?? []);
  const runePool = account.runes.filter(
    (r) => !excluded.has(r.id) && (!opts.freeOnly || r.occupied === 0),
  );

  // ── 選角 ───────────────────────────────────────────
  const pickedUnits = account.units
    .map((unit) => {
      const monster = opts.monsterOf(unit.master);
      return monster ? { unit, monster, tier: tierOf(monster), skillUps: unit.skillUps } : null;
    })
    .filter((x): x is { unit: Unit; monster: Monster; tier: number; skillUps: number | undefined } => !!x)
    .filter((x) => !opts.waterOnly || x.monster.el === 1)
    .sort((a, b) => {
      const aSkill = a.skillUps ?? 0;
      const bSkill = b.skillUps ?? 0;
      return (
        a.tier - b.tier ||
        bSkill - aSkill ||
        b.monster.nat - a.monster.nat ||
        b.unit.stars - a.unit.stars ||
        b.unit.level - a.unit.level
      );
    })
    .slice(0, Math.max(0, Math.floor(opts.count)));

  const gameScores = new Map<number, number>();
  const crScores = new Map<number, number>();
  for (const rune of runePool) {
    gameScores.set(rune.id, runeScore(rune));
    crScores.set(rune.id, rawCrOf(rune));
  }

  // 每隻魔靈先計一次「每顆符文對它值多少分」，之後分配時直接查表
  const drafts: DraftMonster[] = pickedUnits.map(({ unit, monster, tier, skillUps }, priority) => {
    const base = baseStats(monster, unit.stars, unit.level);
    const profile = profileFor(monster, base);
    const points = new Map<number, number>();
    const bySetSlot = new Map<string, Rune[]>();
    const bySlot = new Map<number, Rune[]>();
    for (const rune of runePool) {
      points.set(rune.id, runePoints(rune, profile, base, gameScores.get(rune.id) ?? 0));
      const setKey = `${rune.set}:${rune.slot}`;
      const setList = bySetSlot.get(setKey);
      if (setList) setList.push(rune);
      else bySetSlot.set(setKey, [rune]);
      const slotList = bySlot.get(rune.slot);
      if (slotList) slotList.push(rune);
      else bySlot.set(rune.slot, [rune]);
    }
    const byPoints = (a: Rune, b: Rune) => {
      const diff = (points.get(b.id) ?? 0) - (points.get(a.id) ?? 0);
      return Math.abs(diff) > 1e-9 ? diff : (gameScores.get(b.id) ?? 0) - (gameScores.get(a.id) ?? 0);
    };
    for (const list of bySetSlot.values()) list.sort(byPoints);
    for (const list of bySlot.values()) list.sort(byPoints);
    return {
      unit,
      monster,
      tier,
      skillUps,
      base,
      profile,
      priority,
      remainingSlots: new Set([1, 2, 3, 4, 5, 6]),
      runes: [],
      totalScore: 0,
      cr: 0,
      points,
      bySetSlot,
      bySlot,
    };
  });

  const usedRunes = new Set<number>();

  // ── 平衡分配：每次由總分最低的魔靈拿下一組（通常是 2 件套） ──
  while (true) {
    let draft: DraftMonster | null = null;
    for (const d of drafts) {
      if (d.remainingSlots.size === 0) continue;
      if (
        !draft ||
        d.totalScore < draft.totalScore ||
        (d.totalScore === draft.totalScore && d.priority < draft.priority)
      ) {
        draft = d;
      }
    }
    if (!draft) break;

    const slots = [...draft.remainingSlots];
    const bestAt = (key: string): Rune | undefined => {
      const list = draft.bySetSlot.get(key);
      if (!list) return undefined;
      for (const rune of list) if (!usedRunes.has(rune.id)) return rune;
      return undefined;
    };

    let bestPair: { a: Rune; b: Rune; score: number } | null = null;
    for (const setId of TWO_PIECE_SETS) {
      const bonus = setBonusPoints(setId, draft.profile.weights);
      for (let i = 0; i < slots.length; i++) {
        const a = bestAt(`${setId}:${slots[i]}`);
        if (!a) continue;
        for (let j = i + 1; j < slots.length; j++) {
          const b = bestAt(`${setId}:${slots[j]}`);
          if (!b) continue;
          const projectedCr =
            draft.base.cr + draft.cr + (crScores.get(a.id) ?? 0) + (crScores.get(b.id) ?? 0);
          const over = Math.max(0, projectedCr - 100);
          const score =
            (draft.points.get(a.id) ?? 0) +
            (draft.points.get(b.id) ?? 0) +
            bonus -
            over * CR_PENALTY;
          if (!bestPair || score > bestPair.score) bestPair = { a, b, score };
        }
      }
    }

    if (bestPair) {
      const { a, b } = bestPair;
      draft.runes.push(a, b);
      draft.remainingSlots.delete(a.slot);
      draft.remainingSlots.delete(b.slot);
      usedRunes.add(a.id);
      usedRunes.add(b.id);
      draft.totalScore += (gameScores.get(a.id) ?? 0) + (gameScores.get(b.id) ?? 0);
      draft.cr += (crScores.get(a.id) ?? 0) + (crScores.get(b.id) ?? 0);
      continue;
    }

    // 真的湊不到 2 件套時，補該位置最好的單顆符文
    let bestSingle: { rune: Rune; score: number } | null = null;
    for (const slot of slots) {
      for (const rune of draft.bySlot.get(slot) ?? []) {
        if (usedRunes.has(rune.id)) continue;
        const projectedCr = draft.base.cr + draft.cr + (crScores.get(rune.id) ?? 0);
        const over = Math.max(0, projectedCr - 100);
        const score = (draft.points.get(rune.id) ?? 0) - over * CR_PENALTY;
        if (!bestSingle || score > bestSingle.score) bestSingle = { rune, score };
      }
    }
    if (!bestSingle) {
      // 沒有可用符文，避免無限迴圈
      draft.remainingSlots.clear();
      continue;
    }
    draft.runes.push(bestSingle.rune);
    draft.remainingSlots.delete(bestSingle.rune.slot);
    usedRunes.add(bestSingle.rune.id);
    draft.totalScore += gameScores.get(bestSingle.rune.id) ?? 0;
    draft.cr += crScores.get(bestSingle.rune.id) ?? 0;
  }

  // ── 神器：一件屬性神器 + 一件類型神器（跟選角優先級分配） ──
  const usedArtifacts = new Set<number>();
  const plans: WbMonsterPlan[] = [];
  for (const draft of drafts) {
    const { unit, monster, base, profile } = draft;
    const styleId = ARCH_STYLE[monster.arch ?? ""] ?? 0;
    const pickArtifact = (filter: (art: Artifact) => boolean): Artifact | undefined => {
      let best: Artifact | undefined;
      let bestScore = -Infinity;
      for (const art of account.artifacts) {
        if (usedArtifacts.has(art.id) || !filter(art)) continue;
        const score = artifactPoints(art, profile, base);
        if (score > bestScore) {
          bestScore = score;
          best = art;
        }
      }
      if (best) usedArtifacts.add(best.id);
      return best;
    };
    const artifacts: Artifact[] = [];
    const attrArtifact = pickArtifact((a) => a.type === 1 && (a.attr === monster.el || a.attr === 98));
    if (attrArtifact) artifacts.push(attrArtifact);
    const typeArtifact = pickArtifact(
      (a) => a.type === 2 && (a.style === styleId || a.style === 98),
    );
    if (typeArtifact) artifacts.push(typeArtifact);

    const runes = [...draft.runes].sort((a, b) => a.slot - b.slot);
    const setCount = new Map<number, number>();
    for (const rune of runes) setCount.set(rune.set, (setCount.get(rune.set) ?? 0) + 1);
    const sets = [...setCount.entries()]
      .map(([set, count]) => ({ set, count }))
      .sort((a, b) => b.count - a.count || a.set - b.set);

    const stats = statsForRunes(base, runes, opts.bonus, false, true, artifacts);

    plans.push({
      unit,
      monster,
      focus: profile.focus,
      focusLabel: FOCUS_LABEL[profile.focus],
      mainPlan: actualMainPlan(runes, profile),
      tier: draft.tier,
      skillUps: draft.skillUps,
      runes,
      runeScoreTotal: draft.totalScore,
      artifacts,
      sets,
      base,
      stats,
      focusValue: stats[profile.focus],
    });
  }

  return plans;
}
