/**
 * 世界王配裝建議
 *
 * 1. 選角：水屬性魔靈，優先順序為「原五 > 二覺 > 原四 > 其他」，
 *    同一層級再以技能升級次數（各技能等級 - 1 的總和）由多至少排序。
 * 2. 配符：
 *    - 2/4/6 位主屬性依魔靈類型與基本數值決定：
 *        攻擊型 → 攻擊力% ×3
 *        體力型 → 體力% ×3
 *        防禦型 → 防禦力% ×3
 *        支援型 → 依基本體力／防禦力混搭（例如 2/4 體力%、6 防禦力%）
 *    - 選符以「配合類型的面板數值」為主，遊戲符文分數（◆）作為次要加分；
 *      兩顆同分時，攻擊型優先副屬攻擊%、支援型優先體力／防禦%。
 *    - 盡量三組 2 件套（2+2+2）；速度、暴擊率、暴擊傷害完全不計分。
 * 3. 神器：每隻配一件屬性神器 + 一件類型神器，主效果與追加傷害優先配合該魔靈的主屬性。
 *
 * 這裡只產生「建議」，不會改動存檔；同一顆符文 / 神器最多只會被建議給一隻魔靈。
 */
import { RUNE_SETS, SET_BY_ID, STAT_TYPES } from "./constants";
import { ARTIFACT_EFFECTS } from "./artifacts";
import { baseStats, runeScore, statsForRunes } from "./stats";
import type { Account, Artifact, BonusConfig, Monster, Rune, Stats, Unit } from "./types";

export type WbFocus = "hp" | "atk" | "def";

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
  /** 2/4/6 位建議主屬性 */
  mainPlan: Record<number, WbFocus>;
  /** 0 原五、1 二覺、2 原四、3 其他 */
  tier: number;
  /** 技能升級總次數；undefined = 舊存檔沒有技能資料 */
  skillUps?: number;
  /** 建議的 6 顆符文（依位置排序） */
  runes: Rune[];
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
  /** 2/4/6 位建議主屬性 */
  mainPlan: Record<number, WbFocus>;
}

export const FOCUS_LABEL: Record<WbFocus, string> = { hp: "體力", atk: "攻擊力", def: "防禦力" };

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
      mainPlan: { 2: "atk", 4: "atk", 6: "atk" },
    };
  }
  if (monster.arch === "Defense") {
    return {
      focus: "def",
      weights: { hp: 0.35, atk: 0.1, def: 1 },
      mainPlan: { 2: "def", 4: "def", 6: "def" },
    };
  }
  if (monster.arch === "Support") {
    // 基本體力遠大於基本防禦，用 8 倍把防禦拉近同一尺度再比較。
    const hpWeight = base.hp / (base.hp + base.def * 8);
    const defWeight = 1 - hpWeight;
    const hpSlots = Math.min(3, Math.max(0, Math.round(3 * hpWeight)));
    const mainPlan: Record<number, WbFocus> = {};
    MAIN_SLOTS.forEach((slot, i) => {
      mainPlan[slot] = i < hpSlots ? "hp" : "def";
    });
    return {
      focus: hpWeight >= defWeight ? "hp" : "def",
      weights: { hp: hpWeight, atk: 0.05, def: defWeight },
      mainPlan,
    };
  }
  // 體力型 / 素材 / 其他
  return {
    focus: "hp",
    weights: { hp: 1, atk: 0.1, def: 0.35 },
    mainPlan: { 2: "hp", 4: "hp", 6: "hp" },
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
 * 1. 主屬性：2/4/6 位只計「該位置建議的主屬性」，其他主屬性不給分；
 *    1/3/5 位主屬性固定，依三圍權重計分。
 * 2. 副屬 / 固有屬性：依三圍權重計分，數值會除以該魔靈的基礎值，
 *    令體力%、攻擊%、防禦% 可以在同一尺度比較。
 * 3. 遊戲符文分數（◆）：作為次要加分（0–300 分 → 0–0.3）。
 */
function runePoints(
  rune: Rune,
  profile: WbProfile,
  base: { hp: number; atk: number; def: number },
): number {
  const { weights, mainPlan } = profile;
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

  if (STAT_TYPES[rune.main.t]) {
    if (rune.slot === 2 || rune.slot === 4 || rune.slot === 6) {
      // 2/4/6 位：只有建議的主屬性才有分數；其他主屬性扣分，確保優先攻擊/體力/防禦%
      if (STAT_TYPES[rune.main.t].key === mainPlan[rune.slot]) add(rune.main.t, rune.main.v, 1);
      else points -= 0.35;
    } else {
      add(rune.main.t, rune.main.v);
    }
  }
  if (rune.prefix?.t) add(rune.prefix.t, rune.prefix.v);
  for (const sub of rune.subs) add(sub.t, sub.v + (sub.g ?? 0));

  // 遊戲分數作為次要加分，避免完全忽略符文整體質素
  points += runeScore(rune) / 1000;
  return points;
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

/**
 * 建立世界王建議：選角 → 逐隻配 6 顆符文（2+2+2）與 2 件神器。
 * 高優先級魔靈先配，會拿到當下最好的符文；整份計畫不會重複使用同一顆符文 / 神器。
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

  const usedRunes = new Set<number>();
  const usedArtifacts = new Set<number>();
  const plans: WbMonsterPlan[] = [];

  for (const { unit, monster, tier, skillUps } of pickedUnits) {
    const base = baseStats(monster, unit.stars, unit.level);
    const profile = profileFor(monster, base);
    const { focus, weights } = profile;

    // 這隻魔靈眼中，每顆未使用符文的價值
    const points = new Map<number, number>();
    const bySetSlot = new Map<string, Rune[]>();
    const bySlot = new Map<number, Rune[]>();
    for (const rune of runePool) {
      if (usedRunes.has(rune.id)) continue;
      points.set(rune.id, runePoints(rune, profile, base));
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
      return Math.abs(diff) > 1e-9 ? diff : runeScore(b) - runeScore(a);
    };
    for (const list of bySetSlot.values()) list.sort(byPoints);
    for (const list of bySlot.values()) list.sort(byPoints);

    const bestAt = (key: string): Rune | undefined => {
      const list = bySetSlot.get(key);
      if (!list) return undefined;
      for (const rune of list) if (!usedRunes.has(rune.id)) return rune;
      return undefined;
    };

    // ── 2+2+2：每次挑一組 2 件套，直到 6 個位置補滿 ──
    const remaining = new Set([1, 2, 3, 4, 5, 6]);
    const runes: Rune[] = [];
    for (let pair = 0; pair < 3 && remaining.size >= 2; pair++) {
      const slots = [...remaining];
      let best: { a: Rune; b: Rune; score: number } | null = null;
      for (const setId of TWO_PIECE_SETS) {
        const bonus = setBonusPoints(setId, weights);
        for (let i = 0; i < slots.length; i++) {
          const a = bestAt(`${setId}:${slots[i]}`);
          if (!a) continue;
          for (let j = i + 1; j < slots.length; j++) {
            const b = bestAt(`${setId}:${slots[j]}`);
            if (!b) continue;
            const score = (points.get(a.id) ?? 0) + (points.get(b.id) ?? 0) + bonus;
            if (!best || score > best.score) best = { a, b, score };
          }
        }
      }
      if (!best) break;
      runes.push(best.a, best.b);
      usedRunes.add(best.a.id);
      usedRunes.add(best.b.id);
      remaining.delete(best.a.slot);
      remaining.delete(best.b.slot);
    }
    // 真的湊不到三組 2 件套時，剩餘位置直接用該位置最好的符文（不計套裝）
    for (const slot of remaining) {
      const rune = bySlot.get(slot)?.find((r) => !usedRunes.has(r.id));
      if (!rune) continue;
      runes.push(rune);
      usedRunes.add(rune.id);
    }
    runes.sort((a, b) => a.slot - b.slot);

    // ── 神器：一件屬性神器 + 一件類型神器 ─────────────
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

    const setCount = new Map<number, number>();
    for (const rune of runes) setCount.set(rune.set, (setCount.get(rune.set) ?? 0) + 1);
    const sets = [...setCount.entries()]
      .map(([set, count]) => ({ set, count }))
      .sort((a, b) => b.count - a.count || a.set - b.set);

    const stats = statsForRunes(base, runes, opts.bonus, false, true, artifacts);

    plans.push({
      unit,
      monster,
      focus,
      focusLabel: FOCUS_LABEL[focus],
      mainPlan: profile.mainPlan,
      tier,
      skillUps,
      runes,
      artifacts,
      sets,
      base,
      stats,
      focusValue: stats[focus],
    });
  }

  return plans;
}
