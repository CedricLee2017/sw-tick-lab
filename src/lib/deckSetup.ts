/**
 * 從預設隊快照回推「一鍵配隊」的設定：
 * 套裝（含 3×2）、2/4/6 主屬性，以及目前的實戰數值下限。
 */
import { SET_BY_ID, type StatKey } from "./constants";
import type { Rune, Stats } from "./types";

export interface DeckSetup {
  /** 4 件套；0 = 不指定 */
  set4: number;
  /** 2 件套（第一組） */
  set2: number;
  /** 2 件套（第二組） */
  set2b: number;
  /** 2 件套（第三組） */
  set2c: number;
  mains: Partial<Record<number, number>>;
  /** 實戰數值下限（不含速度；速度由面板速度欄位另外處理） */
  min: Partial<Record<StatKey, number>>;
}

/**
 * `stats` 請傳入與一鍵配隊引擎相同基準的實戰數值
 * （`statsForRunes(..., withSkills = true)`、`useGuild = false`）。
 */
export function deckSetupFromRunes(runes: Rune[], stats: Stats): DeckSetup {
  // 套裝：有 4 件套就用 4+2；否則用 2 件套湊成 3×2（同套裝可重複）。
  // 無形符文（25）可以用來補 1 件，這裡把它當成一個可分配的「缺 1 件」額度。
  const counts = new Map<number, number>();
  for (const r of runes) counts.set(r.set, (counts.get(r.set) ?? 0) + 1);
  let wild = counts.get(25) ?? 0;
  counts.delete(25);
  counts.delete(99);
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);

  let set4 = 0;
  let set2 = 0;
  let set2b = 0;
  let set2c = 0;
  const four = entries.find(([set, count]) => {
    if (SET_BY_ID[set]?.pieces !== 4) return false;
    return count >= 4 || (count === 3 && wild > 0);
  });
  if (four) {
    set4 = four[0];
    if (four[1] < 4) wild -= 1;
    const two = entries.find(([set, count]) => {
      if (set === set4 || SET_BY_ID[set]?.pieces !== 2) return false;
      return count >= 2 || (count === 1 && wild > 0);
    });
    if (two) {
      set2 = two[0];
      if (two[1] < 2) wild -= 1;
    }
  } else {
    const slots: number[] = [];
    for (const [set, count] of entries) {
      if (SET_BY_ID[set]?.pieces !== 2) continue;
      let pieces = count;
      if (pieces % 2 === 1 && wild > 0) {
        pieces += 1;
        wild -= 1;
      }
      for (let k = 0; k < Math.floor(pieces / 2) && slots.length < 3; k++) slots.push(set);
    }
    set2 = slots[0] ?? 0;
    set2b = slots[1] ?? 0;
    set2c = slots[2] ?? 0;
  }

  // 2 / 4 / 6 號主屬性
  const mains: Partial<Record<number, number>> = {};
  for (const r of runes) {
    if (r.slot === 2 || r.slot === 4 || r.slot === 6) mains[r.slot] = r.main.t;
  }

  // 下限：整數三圍用 floor、百分比用 round
  const min: Partial<Record<StatKey, number>> = {};
  const putInt = (key: StatKey, value: number) => {
    if (value > 0) min[key] = Math.floor(value);
  };
  const putPct = (key: StatKey, value: number) => {
    if (value > 0) min[key] = Math.round(value);
  };
  putInt("hp", stats.hp);
  putInt("atk", stats.atk);
  putInt("def", stats.def);
  putPct("cr", stats.cr);
  putPct("cd", stats.cd);
  putPct("res", stats.res);
  putPct("acc", stats.acc);

  return { set4, set2, set2b, set2c, mains, min };
}
