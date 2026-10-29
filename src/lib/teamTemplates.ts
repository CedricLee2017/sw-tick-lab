/** 「一鍵配隊」的隊型預設：先決定隊型，再套用到 3～5 隻魔靈 */
import type { StatKey } from "./constants";
import type { DeckContext } from "./deckSpeed";
import type { OptObjective } from "./optimizer";
import type { FocusEntry } from "./types";
import type { TeamRole } from "./teamOptimizer";

export interface TeamMemberTemplate {
  role: TeamRole;
  /** 卡片上的角色名稱，例如「速隊長」「提條」「主力打手」 */
  title: string;
  weight: number;
  sets: { set: number; count: number }[];
  mains: Partial<Record<number, number>>;
  min: Partial<Record<StatKey, number>>;
  /** 目標 Tick；0 = 不限 */
  tick: number;
  focus: FocusEntry[];
  objective?: OptObjective;
  /** 攻擊順序；1 = 最先，省略時為 1 */
  order?: number;
  /** 預設會收到的提條 % */
  boostPct?: number;
  /** 預設是否有速度強化 */
  speedBuff?: boolean;
  /** 預設神器「速度增加效果 +%」 */
  artifactPct?: number;
}

export interface TeamTemplate {
  id: string;
  name: string;
  desc: string;
  size: 3 | 4 | 5;
  content: DeckContext;
  members: TeamMemberTemplate[];
}

const SPEED_MAIN = { 2: 8 }; // 2 號速度

const SPEED_UNIT: TeamMemberTemplate = {
  role: "speed",
  title: "速隊長",
  weight: 10,
  sets: [{ set: 3, count: 4 }, { set: 15, count: 2 }],
  mains: { ...SPEED_MAIN },
  min: {},
  tick: 5,
  focus: [{ key: "spd", weight: 10 }],
};

const BOOSTER: TeamMemberTemplate = {
  role: "booster",
  title: "提條",
  weight: 10,
  sets: [{ set: 3, count: 4 }, { set: 15, count: 2 }],
  mains: { ...SPEED_MAIN },
  min: {},
  tick: 5,
  focus: [{ key: "spd", weight: 10 }],
};

const DPS_VIOLENT: TeamMemberTemplate = {
  role: "dps",
  title: "主力打手",
  weight: 10,
  sets: [{ set: 13, count: 4 }, { set: 4, count: 2 }],
  mains: { 2: 8, 4: 10, 6: 4 },
  min: {},
  tick: 0,
  focus: [
    { key: "atk", weight: 10 },
    { key: "cr", weight: 10 },
    { key: "cd", weight: 10 },
  ],
};

const DPS_RAGE: TeamMemberTemplate = {
  role: "dps",
  title: "副打手",
  weight: 10,
  sets: [{ set: 5, count: 4 }, { set: 4, count: 2 }],
  mains: { 2: 4, 4: 10, 6: 4 },
  min: {},
  tick: 0,
  focus: [
    { key: "atk", weight: 10 },
    { key: "cr", weight: 10 },
    { key: "cd", weight: 10 },
  ],
};

const TANK: TeamMemberTemplate = {
  role: "tank",
  title: "T5 百抗坦克",
  weight: 10,
  sets: [{ set: 13, count: 4 }, { set: 15, count: 2 }],
  mains: { 2: 2, 4: 2, 6: 2 },
  min: { res: 100 },
  tick: 5,
  focus: [
    { key: "hp", weight: 10 },
    { key: "def", weight: 10 },
    { key: "res", weight: 10 },
    { key: "spd", weight: 10 },
  ],
};

const SUPPORT: TeamMemberTemplate = {
  role: "support",
  title: "輔助",
  weight: 8,
  sets: [{ set: 13, count: 4 }, { set: 15, count: 2 }],
  mains: { 2: 8, 4: 2, 6: 2 },
  min: {},
  tick: 0,
  focus: [
    { key: "spd", weight: 10 },
    { key: "hp", weight: 8 },
    { key: "acc", weight: 8 },
    { key: "res", weight: 6 },
  ],
};

const EMPTY: TeamMemberTemplate = {
  role: "support",
  title: "自訂",
  weight: 8,
  sets: [],
  mains: {},
  min: {},
  tick: 0,
  focus: [],
};

export const TEAM_TEMPLATES: TeamTemplate[] = [
  {
    id: "guild-speed",
    name: "3 人 · 速隊長＋提條＋主力打手",
    desc: "公會戰／據點戰進攻：兩隻迅速一速搶先手，暴走打手負責輸出。",
    size: 3,
    content: "guild",
    members: [
      // 預設攻擊順序：提條先手 → 主力打手 → 速隊長
      { ...SPEED_UNIT, order: 3 },
      { ...BOOSTER, order: 1 },
      { ...DPS_VIOLENT, order: 2 },
    ],
  },
  {
    id: "siege-tank",
    name: "3 人 · T5 百抗坦克 ×3",
    desc: "據點戰防守：三隻暴走意志、抵抗 100%、目標 Tick 5 的坦克。",
    size: 3,
    content: "guild",
    members: [
      { ...TANK, title: "坦克 1" },
      { ...TANK, title: "坦克 2" },
      { ...TANK, title: "坦克 3" },
    ],
  },
  {
    id: "arena-4",
    name: "4 人 · 競技場 速隊長／提條／打手／輔助",
    desc: "競技場進攻：一速＋提條開場，主力打手輸出，輔助補控場／生存。",
    size: 4,
    content: "arena",
    members: [SPEED_UNIT, BOOSTER, DPS_VIOLENT, SUPPORT],
  },
  {
    id: "rta-5",
    name: "5 人 · RTA 速隊長／提條／雙打手／輔助",
    desc: "RTA 五隻配置：兩隻打手分摊符文壓力，輔助補速度與生存。",
    size: 5,
    content: "arena",
    members: [SPEED_UNIT, BOOSTER, DPS_VIOLENT, DPS_RAGE, SUPPORT],
  },
  {
    id: "custom",
    name: "自訂隊型",
    desc: "不套用任何套裝與主屬性，自己設定每隻魔靈的需求。",
    size: 3,
    content: "guild",
    members: [
      { ...EMPTY, title: "自訂 1" },
      { ...EMPTY, title: "自訂 2" },
      { ...EMPTY, title: "自訂 3" },
    ],
  },
];

export function teamTemplateOf(id: string): TeamTemplate {
  return TEAM_TEMPLATES.find((t) => t.id === id) ?? TEAM_TEMPLATES[TEAM_TEMPLATES.length - 1];
}

/** 依隊型與人數產生每隻魔靈的預設需求（人數與隊型不同時補「自訂」） */
export function templateMembers(template: TeamTemplate, size: 3 | 4 | 5): TeamMemberTemplate[] {
  const out = template.members.slice(0, size).map((m) => ({ ...m, sets: m.sets.map((s) => ({ ...s })), focus: m.focus.map((f) => ({ ...f })) }));
  while (out.length < size) {
    out.push({ ...EMPTY, title: `自訂 ${out.length + 1}`, sets: [], mains: {}, focus: [] });
  }
  return out;
}
