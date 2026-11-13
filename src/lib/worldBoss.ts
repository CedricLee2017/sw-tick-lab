export const WORLD_BOSS_BATTLES = 3;
export const WORLD_BOSS_TEAM_SIZE = 3;

export interface WorldBossGrade {
  grade: string;
  min: number;
  color: string;
}

/** Common editable defaults (user can override in UI). Values are total damage across 3 battles. */
export const DEFAULT_WB_GRADES: WorldBossGrade[] = [
  { grade: "SSS", min: 20000000, color: "var(--gold)" },
  { grade: "SS", min: 15000000, color: "#e2e8f0" },
  { grade: "S", min: 10000000, color: "#60a5fa" },
  { grade: "A+", min: 7000000, color: "#34d399" },
  { grade: "A", min: 5000000, color: "#34d399" },
  { grade: "B", min: 3000000, color: "#a3a3a3" },
  { grade: "C", min: 1000000, color: "#a3a3a3" },
  { grade: "D", min: 0, color: "#737373" },
];

export function gradeForDamage(total: number, grades: WorldBossGrade[]): WorldBossGrade {
  const sorted = [...grades].sort((a, b) => b.min - a.min);
  return sorted.find((g) => total >= g.min) ?? sorted[sorted.length - 1] ?? { grade: "-", min: 0, color: "var(--muted)" };
}

export function damageToNextGrade(total: number, grades: WorldBossGrade[]): { next: WorldBossGrade | null; need: number } {
  const sorted = [...grades].sort((a, b) => a.min - b.min);
  const next = sorted.find((g) => g.min > total) ?? null;
  return { next, need: next ? Math.max(0, next.min - total) : 0 };
}
