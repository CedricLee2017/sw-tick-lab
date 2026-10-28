/** 速度隊長技資料（來源：Swarfarm 怪物資料，只保留 Attack Speed 隊長技） */
import spdLeadersJson from "../data/spdLeaders.json";

export interface SpdLeaderSkill {
  /** 速度加成 % */
  p: number;
  /** 適用範圍：General / Element / Arena / Guild / Dungeon */
  a: "General" | "Element" | "Arena" | "Guild" | "Dungeon";
  /** Element 範圍時對應的屬性（英文） */
  e: string | null;
}

export const SPD_LEADERS = spdLeadersJson as unknown as Record<string, SpdLeaderSkill>;

const ELEMENT_NAME: Record<number, string> = {
  1: "Water",
  2: "Fire",
  3: "Wind",
  4: "Light",
  5: "Dark",
};

export type DeckContext = "arena" | "guild" | "dungeon";

/** 依預設隊類型判斷隊長技的適用內容 */
export function deckContext(type: number): DeckContext {
  // 競技場、競技場防守、混沌（RTA）
  if (type === 1 || type === 23 || type === 100 || type === 101) return "arena";
  // 公會戰（進攻）、據點戰（進攻）、據點戰防守
  if (type === 2 || type === 22 || type === 102) return "guild";
  return "dungeon";
}

export function spdLeaderSkill(master: number): SpdLeaderSkill | null {
  return SPD_LEADERS[String(master)] ?? null;
}

/** 這隻魔靈（屬性 element）是否符合隊長技的範圍 */
export function spdLeaderApplies(skill: SpdLeaderSkill, element: number, context: DeckContext): boolean {
  if (skill.a === "Element") return ELEMENT_NAME[element] === skill.e;
  if (skill.a === "Arena") return context === "arena";
  if (skill.a === "Guild") return context === "guild";
  if (skill.a === "Dungeon") return context === "dungeon";
  return true;
}

export const DECK_CONTEXT_LABEL: Record<DeckContext, string> = {
  arena: "競技場",
  guild: "公會戰／據點戰",
  dungeon: "副本",
};

/** 隊長技適用範圍的顯示文字 */
export const SPD_AREA_LABEL: Record<string, string> = {
  General: "全內容",
  Element: "同屬性隊友",
  Arena: "競技場",
  Guild: "公會戰／據點戰",
  Dungeon: "副本",
};
