/**
 * 符文 / 神器的「目前使用狀況」
 *
 * 賣符文之前最重要的是知道哪些還在用：
 * - 預設隊：遊戲內 deck_list 的快照，加上競技場／據點戰的防守隊（defenseDecks）
 * - RTA：account.rta.loadouts（世界競技場的獨立配裝，同一顆符文可以同時在一般與 RTA 使用）
 *
 * SWEX 匯出的存檔只有這些「快照」，沒有即時裝備狀態，所以這裡只反映匯出當下。
 */
import type { Account } from "./types";

export interface EquipUsage {
  /** 遊戲內預設隊 / 防守隊使用中 */
  deck: boolean;
  /** RTA 獨立配裝使用中 */
  rta: boolean;
}

export interface UsageIndex {
  runes: Map<number, EquipUsage>;
  artifacts: Map<number, EquipUsage>;
}

const emptyUsage = (): EquipUsage => ({ deck: false, rta: false });

/** 建立整份存檔的符文／神器使用索引（以 id 為 key） */
export function buildUsageIndex(account: Account | null | undefined): UsageIndex {
  const runes = new Map<number, EquipUsage>();
  const artifacts = new Map<number, EquipUsage>();

  const mark = (map: Map<number, EquipUsage>, id: number, kind: "deck" | "rta") => {
    if (!id) return;
    const cur = map.get(id) ?? emptyUsage();
    cur[kind] = true;
    map.set(id, cur);
  };

  if (!account) return { runes, artifacts };

  // 預設隊 + 防守隊（競技場、據點戰）
  for (const deck of [...(account.decks ?? []), ...(account.defenseDecks ?? [])]) {
    for (const equip of deck.equip ?? []) {
      for (const id of equip.runes ?? []) mark(runes, id, "deck");
      for (const id of equip.artifacts ?? []) mark(artifacts, id, "deck");
    }
  }

  // RTA 獨立配裝
  for (const loadout of Object.values(account.rta?.loadouts ?? {})) {
    for (const id of loadout.runes ?? []) mark(runes, id, "rta");
    for (const id of loadout.artifacts ?? []) mark(artifacts, id, "rta");
  }

  return { runes, artifacts };
}

/** 使用狀況的顯示文字 */
export function usageText(usage: EquipUsage | undefined): string {
  if (!usage || (!usage.deck && !usage.rta)) return "未使用";
  if (usage.deck && usage.rta) return "預設隊 + RTA";
  return usage.deck ? "預設隊" : "RTA";
}
