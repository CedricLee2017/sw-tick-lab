/** 配符第一階段 → 配神器頁面的交接資料（存在同一個分頁的 sessionStorage） */
import type { DamageOptions, Skill } from "./damage";
import type { BaseStats } from "./stats";
import type { BonusConfig } from "./types";

export interface ArtifactHandoff {
  version: 1;
  createdAt: number;
  /** 魔靈 master id（MONSTER_MAP 用） */
  monsterId: number;
  base: BaseStats;
  /** 前 N 組符文；每個位置是 rune id 或 null */
  builds: (number | null)[][];
  bonus: BonusConfig;
  rta: boolean;
  skill: Skill | null;
  dmgOpts: DamageOptions;
  /** 例：傷害（Amputation Magic） */
  sortLabel: string;
  /** 第一階段符合條件的總組數 */
  total: number;
}

const KEY = "swtick:artifact-handoff";

export function saveArtifactHandoff(h: ArtifactHandoff): void {
  sessionStorage.setItem(KEY, JSON.stringify(h));
}

export function loadArtifactHandoff(): ArtifactHandoff | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const h = JSON.parse(raw) as ArtifactHandoff;
    if (h?.version !== 1 || !Array.isArray(h.builds)) return null;
    return h;
  } catch {
    return null;
  }
}

export function clearArtifactHandoff(): void {
  sessionStorage.removeItem(KEY);
}
