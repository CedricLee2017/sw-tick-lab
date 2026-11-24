/**
 * 一鍵配隊：依魔靈技能與基礎速度自動判定角色、出手順序與預設配裝。
 *
 * 判定規則（與「速隊長＋提條＋打手」隊型一致）：
 *   1. 有速度隊長技的魔靈 → 速隊長，隊長技 % 直接帶入。
 *   2. 剩下有「增加攻擊條」技能、基礎速度最高的 → 提條。
 *   3. 其餘依隊型剩下的角色（打手／輔助）補滿。
 *   4. 出手順序固定：提條 → 打手 → 輔助 → 速隊長。
 *
 * 隊型本身沒有速隊長或提條（例如三坦、自訂）時回傳 null，維持原本設定。
 */
import type { StatKey } from "./constants";
import type { SkillData } from "./damage";
import { SPD_LEADERS, spdLeaderApplies, type DeckContext } from "./deckSpeed";
import type { TeamRole } from "./teamOptimizer";
import type { FocusEntry } from "./types";

export interface RoleUnit {
  /** 魔靈 master id */
  master: number;
  /** 屬性 1–5 */
  element: number;
  /** 基礎速度 */
  baseSpd: number;
}

export interface RoleAssignment {
  /** 頁面上的成員索引 */
  unitIndex: number;
  role: TeamRole;
  /** 出手順序；1 = 最先 */
  order: number;
  /** 速度隊長技覆寫：null = 跟隨全隊，0 = 這隻吃不到 */
  leadPct: number | null;
}

export interface RoleOutcome {
  assignments: RoleAssignment[];
  /** 全隊速度隊長技 %（0 = 沒有） */
  leadPct: number;
  leaderIndex: number | null;
  boosterIndex: number | null;
}

export interface RoleSetup {
  title: string;
  weight: number;
  /** 4 件套；0 = 不指定 */
  set4: number;
  /** 2 件套；0 = 不指定 */
  set2: number;
  mains: Partial<Record<number, number>>;
  min: Partial<Record<StatKey, number>>;
  tick: number;
  focus: FocusEntry[];
}

/** SWARFARM 特殊效果 id：17 = 增加攻擊條 */
const ATB_EFFECT = 17;
/** SWARFARM 特殊效果 id：5 = 增加攻擊速度（速度強化 +30%） */
const SPEED_BUFF_EFFECT = 5;
/** 描述裡「增加／填充攻擊條」的寫法；純粹吸收或削減對手攻擊條不算 */
const ATB_INCREASE = /(increase|fill|fills|charge|boost)[^.]{0,60}attack bar|attack bar[^.]{0,40}(increase|fill)/i;
/** 技能是否作用在隊友（全隊／單一隊友），而不是只加自己的攻擊條 */
const ALLY_TARGET = /\b(all allies|allies|ally|team)\b/i;
/** 從技能描述抓攻擊條 %（前後兩種語序都支援） */
const ATB_PCT_PATTERNS = [
  /attack (?:bar|gauge)s?[^.%]{0,60}?(\d{1,3})\s*%/i,
  /(\d{1,3})\s*%[^.%]{0,30}?attack (?:bar|gauge)/i,
];

export interface BoosterBoost {
  /** 提供給隊友的攻擊條 %（0 = 沒有提條） */
  pct: number;
  /** 是否有速度強化（+30%） */
  speedBuff: boolean;
}

function atbPctOf(text: string): number {
  for (const re of ATB_PCT_PATTERNS) {
    const m = text.match(re);
    if (m) return Math.max(0, Math.min(100, Number(m[1]) || 0));
  }
  // 「Fills up the Attack Bar」沒有寫 % 時視為 100%
  if (/fills? up? (?:the )?attack (?:bar|gauge)|attack (?:bar|gauge)[^.]{0,20}fills? up/i.test(text)) {
    return 100;
  }
  return 0;
}

/**
 * 讀取提條魔靈的技能，算出他能給隊友的提條 % 與速度強化。
 * 只看主動技能、且技能要作用在隊友身上；自己加速／自己補攻擊條不列入。
 */
export function boosterBoostOf(data: SkillData | null, master: number): BoosterBoost | null {
  if (!data || !master) return null;
  const ids = data.monsters[String(master)] ?? [];
  let pct = 0;
  let speedBuff = false;
  for (const id of ids) {
    const skill = data.skills[String(id)];
    if (!skill || skill.passive) continue;
    const desc = skill.d ?? "";
    if (!ALLY_TARGET.test(desc)) continue;
    if (skill.e?.includes(SPEED_BUFF_EFFECT)) speedBuff = true;
    if (skill.e?.includes(ATB_EFFECT)) pct = Math.max(pct, atbPctOf(desc));
  }
  return pct > 0 || speedBuff ? { pct, speedBuff } : null;
}

/** 這隻魔靈是否有增加攻擊條的技能（含自身或全隊） */
export function hasAtbBoost(data: SkillData | null, master: number): boolean {
  if (!data || !master) return false;
  const ids = data.monsters[String(master)] ?? [];
  for (const id of ids) {
    const skill = data.skills[String(id)];
    if (!skill || skill.passive) continue;
    if (!skill.e?.includes(ATB_EFFECT)) continue;
    if (ATB_INCREASE.test(skill.d ?? "")) return true;
  }
  return false;
}

/** 目前隊伍裡速度隊長技 % 最高、且適用於這個內容的魔靈（同 % 取較前面者） */
function leaderOf(units: RoleUnit[], context: DeckContext): { index: number; pct: number; master: number } | null {
  let best: { index: number; pct: number; master: number } | null = null;
  units.forEach((u, i) => {
    const skill = SPD_LEADERS[String(u.master)];
    if (!skill || skill.p <= 0) return;
    // 例如競技場專用隊長技不會在據點戰生效
    if (!spdLeaderApplies(skill, u.element, context)) return;
    if (!best || skill.p > best.pct) best = { index: i, pct: skill.p, master: u.master };
  });
  return best;
}

/** 最快的那一隻（排除指定索引） */
function fastest(units: RoleUnit[], exclude: Set<number>): number | null {
  let pick: number | null = null;
  units.forEach((u, i) => {
    if (exclude.has(i)) return;
    if (pick == null || u.baseSpd > units[pick].baseSpd) pick = i;
  });
  return pick;
}

export function autoAssignRoles(args: {
  units: RoleUnit[];
  /** 隊型每個位置預設的角色（自動判定前的樣子） */
  slots: TeamRole[];
  context: DeckContext;
  skillData: SkillData | null;
}): RoleOutcome | null {
  const { units, slots, context, skillData } = args;
  const n = units.length;
  if (n === 0 || slots.length !== n) return null;

  const speedSlot = slots.indexOf("speed");
  const boosterSlot = slots.indexOf("booster");
  // 三坦、自訂等沒有速隊長／提條的隊型不自動改角色
  if (speedSlot < 0 && boosterSlot < 0) return null;

  const leader = leaderOf(units, context);
  const roleOf: (TeamRole | null)[] = new Array(n).fill(null);
  const usedSlots = new Set<number>();
  let leaderIndex: number | null = null;
  let boosterIndex: number | null = null;

  if (leader && speedSlot >= 0) {
    leaderIndex = leader.index;
    roleOf[leader.index] = "speed";
    usedSlots.add(speedSlot);
  }

  if (boosterSlot >= 0) {
    const exclude = new Set<number>();
    if (leaderIndex != null) exclude.add(leaderIndex);
    const candidates = units
      .map((u, i) => ({ u, i }))
      .filter(({ u, i }) => !exclude.has(i) && hasAtbBoost(skillData, u.master))
      .sort((a, b) => b.u.baseSpd - a.u.baseSpd || a.i - b.i);
    // 沒有提條技能時，退而用剩下最快的那一隻（一速仍可先出手）
    const pick = candidates[0]?.i ?? fastest(units, exclude);
    if (pick != null) {
      boosterIndex = pick;
      roleOf[pick] = "booster";
      usedSlots.add(boosterSlot);
    }
  }

  // 其餘魔靈依基礎速度補進剩下的位置
  const restUnits = units
    .map((u, i) => ({ u, i }))
    .filter(({ i }) => roleOf[i] == null)
    .sort((a, b) => b.u.baseSpd - a.u.baseSpd || a.i - b.i)
    .map(({ i }) => i);
  const restSlots = slots
    .map((role, i) => ({ role, i }))
    .filter(({ role, i }) => role !== "free" && !usedSlots.has(i))
    .map(({ role }) => role);
  restSlots.forEach((role, k) => {
    const unit = restUnits[k];
    if (unit != null) roleOf[unit] = role;
  });

  // 提條 → 打手（坦克） → 輔助 → 速隊長
  const rank: Record<TeamRole, number> = { booster: 0, dps: 1, tank: 1, support: 2, speed: 3, free: 4 };
  const ordered = units
    .map((u, i) => ({ i, role: roleOf[i] }))
    .filter((x): x is { i: number; role: TeamRole } => x.role != null)
    .sort(
      (a, b) =>
        rank[a.role] - rank[b.role] ||
        units[b.i].baseSpd - units[a.i].baseSpd ||
        a.i - b.i,
    );
  const orderOf = new Map<number, number>();
  ordered.forEach((x, k) => orderOf.set(x.i, k + 1));

  const leaderSkill = leader ? SPD_LEADERS[String(leader.master)] : null;
  const assignments: RoleAssignment[] = [];
  units.forEach((u, i) => {
    const role = roleOf[i];
    if (!role) return;
    const applies = !!leaderSkill && spdLeaderApplies(leaderSkill, u.element, context);
    assignments.push({
      unitIndex: i,
      role,
      order: orderOf.get(i) ?? i + 1,
      leadPct: leaderSkill && !applies ? 0 : null,
    });
  });

  return {
    assignments,
    leadPct: leader?.pct ?? 0,
    leaderIndex,
    boosterIndex,
  };
}

/** 各角色的預設配裝（自動判定角色時直接套用） */
export const ROLE_SETUPS: Record<TeamRole, RoleSetup> = {
  speed: {
    title: "速隊長",
    weight: 10,
    set4: 3,
    set2: 4,
    mains: { 2: 8, 4: 10, 6: 4 },
    min: { cr: 100 },
    tick: 5,
    focus: [
      { key: "spd", weight: 10 },
      { key: "cr", weight: 8 },
      { key: "cd", weight: 8 },
      { key: "atk", weight: 8 },
    ],
  },
  booster: {
    title: "提條",
    weight: 10,
    set4: 3,
    set2: 15,
    mains: { 2: 8, 4: 2, 6: 2 },
    min: {},
    tick: 5,
    focus: [{ key: "spd", weight: 10 }],
  },
  dps: {
    title: "打手",
    weight: 10,
    set4: 3,
    set2: 4,
    mains: { 2: 8, 4: 10, 6: 4 },
    min: { cr: 100 },
    tick: 0,
    focus: [
      { key: "atk", weight: 10 },
      { key: "cr", weight: 10 },
      { key: "cd", weight: 10 },
    ],
  },
  tank: {
    title: "坦克",
    weight: 10,
    set4: 13,
    set2: 15,
    mains: { 2: 2, 4: 2, 6: 2 },
    min: { res: 100 },
    tick: 5,
    focus: [
      { key: "hp", weight: 10 },
      { key: "def", weight: 10 },
      { key: "res", weight: 10 },
      { key: "spd", weight: 10 },
    ],
  },
  support: {
    title: "輔助",
    weight: 8,
    set4: 13,
    set2: 15,
    mains: { 2: 8, 4: 2, 6: 2 },
    min: {},
    tick: 0,
    focus: [
      { key: "spd", weight: 10 },
      { key: "hp", weight: 8 },
      { key: "acc", weight: 8 },
      { key: "res", weight: 6 },
    ],
  },
  free: {
    title: "自由",
    weight: 1,
    set4: 0,
    set2: 0,
    mains: {},
    min: {},
    tick: 0,
    focus: [],
  },
};

export function roleSetup(role: TeamRole): RoleSetup {
  return ROLE_SETUPS[role];
}

/** 內建「預設定位」：選一次就把整組套裝 / 主屬性 / 下限 / Tick / 焦點填入 */
export interface BuiltinRolePreset {
  id: string;
  name: string;
  role: TeamRole;
  weight: number;
  /** 4 件套；0 = 不指定 */
  set4: number;
  /** 2 件套；0 = 不指定 */
  set2: number;
  mains: Partial<Record<number, number>>;
  min: Partial<Record<StatKey, number>>;
  /** 目標 Tick（T5） */
  tick: number;
  speedMode: "panel" | "tick";
  focus: FocusEntry[];
  /**
   * 接速打手：套用後會即時讀取同隊「提條輔助」的技能，
   * 自動帶入提條 % 與速度強化。
   */
  autoBoost?: boolean;
}

/**
 * T5 防後手系列：暴走 ×4＋意志 ×2、目標 Tick 5（含速隊長與建築加成）。
 * 焦點比重會直接帶入，用家套用後仍可自行調整任何欄位。
 */
export const BUILTIN_ROLE_PRESETS: BuiltinRolePreset[] = [
  {
    id: "t5-anti-late-cd",
    name: "T5 防後手爆傷",
    role: "dps",
    weight: 10,
    set4: 13,
    set2: 15,
    mains: { 2: 4, 4: 10, 6: 4 },
    min: { cr: 100 },
    tick: 5,
    speedMode: "tick",
    focus: [
      { key: "hp", weight: 6 },
      { key: "atk", weight: 6 },
      { key: "def", weight: 6 },
      { key: "spd", weight: 6 },
      { key: "cr", weight: 10 },
    ],
  },
  {
    id: "t5-anti-late-cr",
    name: "T5 防後手爆率追傷",
    role: "dps",
    weight: 10,
    set4: 13,
    set2: 15,
    mains: { 2: 2, 4: 9, 6: 2 },
    min: { cr: 100 },
    tick: 5,
    speedMode: "tick",
    focus: [
      { key: "hp", weight: 6 },
      { key: "atk", weight: 6 },
      { key: "def", weight: 6 },
      { key: "spd", weight: 6 },
    ],
  },
  {
    id: "t5-anti-late-hp",
    name: "T5 防後手純追傷",
    role: "tank",
    weight: 10,
    set4: 13,
    set2: 15,
    mains: { 2: 2, 4: 2, 6: 2 },
    min: {},
    tick: 5,
    speedMode: "tick",
    focus: [
      { key: "hp", weight: 10 },
      { key: "atk", weight: 6 },
      { key: "def", weight: 6 },
      { key: "spd", weight: 6 },
    ],
  },
  {
    id: "t5-violent-will-res100",
    name: "T5 暴意百抗輔助",
    role: "support",
    weight: 10,
    set4: 13,
    set2: 15,
    mains: { 2: 2, 4: 2, 6: 2 },
    min: { res: 100 },
    tick: 5,
    speedMode: "tick",
    focus: [
      { key: "hp", weight: 6 },
      { key: "def", weight: 6 },
      { key: "spd", weight: 6 },
      { key: "res", weight: 10 },
    ],
  },
  {
    id: "t5-violent-will-res70",
    name: "T5 暴意70抗輔助",
    role: "support",
    weight: 10,
    set4: 13,
    set2: 15,
    mains: { 2: 2, 4: 2, 6: 2 },
    min: { res: 70 },
    tick: 5,
    speedMode: "tick",
    focus: [
      { key: "hp", weight: 6 },
      { key: "def", weight: 6 },
      { key: "spd", weight: 6 },
      { key: "res", weight: 10 },
    ],
  },
  {
    id: "atb-booster",
    name: "提條輔助",
    role: "booster",
    weight: 10,
    set4: 3, // 迅速
    set2: 0, // 不限
    mains: { 2: 8, 4: 2 }, // 2 號速度、4 號體力%，6 號不限
    min: {},
    tick: 0,
    speedMode: "panel",
    focus: [{ key: "spd", weight: 10 }],
  },
  {
    id: "speed-tuned-cd-cr100",
    name: "接速百爆傷害打手",
    role: "dps",
    weight: 10,
    set4: 0,
    set2: 0,
    mains: { 2: 8, 4: 10, 6: 4 }, // 2 速、4 爆傷、6 攻擊%
    min: { cr: 100 },
    tick: 0,
    speedMode: "panel",
    focus: [
      { key: "spd", weight: 10 },
      { key: "cr", weight: 10 },
      { key: "atk", weight: 10 },
      { key: "cd", weight: 10 },
      { key: "hp", weight: 5 },
    ],
    autoBoost: true,
  },
  {
    id: "speed-tuned-cd-atk",
    name: "接速無爆率傷害打手",
    role: "dps",
    weight: 10,
    set4: 0,
    set2: 0,
    mains: { 2: 8, 4: 10, 6: 4 }, // 2 速、4 爆傷、6 攻擊%
    min: {},
    tick: 0,
    speedMode: "panel",
    focus: [
      { key: "spd", weight: 10 },
      { key: "atk", weight: 10 },
      { key: "cd", weight: 10 },
      { key: "hp", weight: 5 },
    ],
    autoBoost: true,
  },
  {
    id: "speed-tuned-cd-hp",
    name: "接速無爆率坦打手",
    role: "dps",
    weight: 10,
    set4: 0,
    set2: 0,
    mains: { 2: 8, 4: 10, 6: 2 }, // 2 速、4 爆傷、6 體力%
    min: {},
    tick: 0,
    speedMode: "panel",
    focus: [
      { key: "spd", weight: 10 },
      { key: "atk", weight: 10 },
      { key: "cd", weight: 10 },
      { key: "hp", weight: 5 },
    ],
    autoBoost: true,
  },
];
