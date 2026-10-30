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
/** 描述裡「增加／填充攻擊條」的寫法；純粹吸收或削減對手攻擊條不算 */
const ATB_INCREASE = /(increase|fill|fills|charge|boost)[^.]{0,60}attack bar|attack bar[^.]{0,40}(increase|fill)/i;

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
    .filter(({ i }) => !usedSlots.has(i))
    .map(({ role }) => role);
  restSlots.forEach((role, k) => {
    const unit = restUnits[k];
    if (unit != null) roleOf[unit] = role;
  });

  // 提條 → 打手（坦克） → 輔助 → 速隊長
  const rank: Record<TeamRole, number> = { booster: 0, dps: 1, tank: 1, support: 2, speed: 3 };
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
};

export function roleSetup(role: TeamRole): RoleSetup {
  return ROLE_SETUPS[role];
}
