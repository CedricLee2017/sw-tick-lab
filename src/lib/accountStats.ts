import { useMemo } from "react";
import { MONSTER_MAP, useStore } from "../store";
import { baseStats, statsForRunes } from "./stats";
import type { Account, Artifact, BonusConfig, Monster, Rune, Stats, Unit } from "./types";

export interface UnitView {
  unit: Unit;
  monster: Monster;
  base: ReturnType<typeof baseStats>;
  runes: Rune[];
  artifacts: Artifact[];
  stats: Stats;
}

export function computeUnitView(account: Account, unit: Unit, bonus: BonusConfig, rta = false): UnitView | null {
  const monster = MONSTER_MAP.get(unit.master);
  if (!monster) return null;
  const base = baseStats(monster, unit.stars, unit.level);
  const runeMap = new Map(account.runes.map((r) => [r.id, r]));
  const runes = unit.runes.map((id) => runeMap.get(id)).filter(Boolean) as Rune[];
  const artifactMap = new Map(account.artifacts.map((a) => [a.id, a]));
  const artifacts = unit.artifacts.map((id) => artifactMap.get(id)).filter(Boolean) as Artifact[];
  return { unit, monster, base, runes, artifacts, stats: statsForRunes(base, runes, bonus, rta, false, artifacts) };
}

export interface AccountSummary {
  views: UnitView[];
  runeOwner: Map<number, number>;
  byEl: Record<number, number>;
  byNat: Record<number, number>;
  tickBuckets: { tick: number; count: number }[];
  topSpeed: UnitView[];
  sixStar: number;
  avgEff: number;
  sets: Record<number, number>;
  grades: Record<number, number>;
  slots: Record<number, number>;
}

export function summarize(account: Account, bonus: BonusConfig, rta = false): AccountSummary {
  const views = account.units
    .map((u) => computeUnitView(account, u, bonus, rta))
    .filter(Boolean) as UnitView[];

  const runeOwner = new Map<number, number>();
  for (const u of account.units) for (const rid of u.runes) runeOwner.set(rid, u.id);

  const byEl: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const byNat: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const sets: Record<number, number> = {};
  const grades: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const slots: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const v of views) {
    byEl[v.monster.el] = (byEl[v.monster.el] ?? 0) + 1;
    byNat[v.monster.nat] = (byNat[v.monster.nat] ?? 0) + 1;
  }
  for (const r of account.runes) {
    sets[r.set] = (sets[r.set] ?? 0) + 1;
    grades[r.grade] = (grades[r.grade] ?? 0) + 1;
    slots[r.slot] = (slots[r.slot] ?? 0) + 1;
  }

  const buckets = new Map<number, number>();
  for (const v of views) {
    if (!Number.isFinite(v.stats.tick)) continue;
    const t = Math.min(20, Math.max(1, v.stats.tick));
    buckets.set(t, (buckets.get(t) ?? 0) + 1);
  }
  const tickBuckets = [...buckets.entries()].map(([tick, count]) => ({ tick, count })).sort((a, b) => a.tick - b.tick);

  const avgEff = account.runes.length ? account.runes.reduce((s, r) => s + r.eff, 0) / account.runes.length : 0;

  return {
    views,
    runeOwner,
    byEl,
    byNat,
    tickBuckets,
    topSpeed: [...views].sort((a, b) => b.stats.spd - a.stats.spd).slice(0, 12),
    sixStar: account.units.filter((u) => u.stars === 6).length,
    avgEff,
    sets,
    grades,
    slots,
  };
}

export function useSummary() {
  const account = useStore((s) => s.account);
  const bonus = useStore((s) => s.settings.bonus);
  const rta = useStore((s) => s.settings.rta);
  return useMemo(() => (account ? summarize(account, bonus, rta) : null), [account, bonus, rta]);
}
