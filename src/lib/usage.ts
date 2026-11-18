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

/** 符文被預設隊／RTA 使用的次數 */
export interface RuneUseCount {
  /** 預設隊 + 防守隊中的使用次數 */
  deck: number;
  /** RTA 獨立配裝中的使用次數 */
  rta: number;
  /** 合計（用於排序：最常用 → 最不常用） */
  total: number;
}

/**
 * 計算每顆符文在預設隊／防守隊與 RTA 配裝中出現的次數。
 * 同一顆符文出現在多隊或多個 RTA 配裝會累加；和 buildUsageIndex 相同，
 * 只反映匯出當下的快照。
 */
export function buildRuneUseCounts(account: Account | null | undefined): Map<number, RuneUseCount> {
  const map = new Map<number, RuneUseCount>();
  const add = (id: number, kind: "deck" | "rta") => {
    if (!id) return;
    const cur = map.get(id) ?? { deck: 0, rta: 0, total: 0 };
    cur[kind] += 1;
    cur.total += 1;
    map.set(id, cur);
  };

  if (!account) return map;
  for (const deck of [...(account.decks ?? []), ...(account.defenseDecks ?? [])]) {
    for (const equip of deck.equip ?? []) for (const id of equip.runes ?? []) add(id, "deck");
  }
  for (const loadout of Object.values(account.rta?.loadouts ?? {})) {
    for (const id of loadout.runes ?? []) add(id, "rta");
  }
  return map;
}

/** 「常用符文」方向的排序方式 */
export type CommonSort = "uses-desc" | "uses-asc" | "now-asc" | "now-desc" | "target-desc" | "target-asc";

export const COMMON_SORTS: { key: CommonSort; label: string; desc: string }[] = [
  { key: "uses-desc", label: "使用次數 多→少", desc: "依預設隊 / RTA 使用次數由多到少（預設）" },
  { key: "uses-asc", label: "使用次數 少→多", desc: "使用次數由少到多" },
  { key: "now-asc", label: "目前分數 低→高", desc: "目前遊戲分數由低到高" },
  { key: "now-desc", label: "目前分數 高→低", desc: "目前遊戲分數由高到低" },
  { key: "target-desc", label: "目標分數 高→低", desc: "精煉 / 精魔＋精煉後可達分數由高到低" },
  { key: "target-asc", label: "目標分數 低→高", desc: "精煉 / 精魔＋精煉後可達分數由低到高" },
];

/** 使用狀況的顯示文字 */
export function usageText(usage: EquipUsage | undefined): string {
  if (!usage || (!usage.deck && !usage.rta)) return "未使用";
  if (usage.deck && usage.rta) return "預設隊 + RTA";
  return usage.deck ? "預設隊" : "RTA";
}
