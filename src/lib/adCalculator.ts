/** 神器追傷（Additional Damage）計算 */
import type { Artifact } from "./types";

export interface AdStats {
  hp: number;
  atk: number;
  def: number;
  spd: number;
}

/** 追傷係數（百分比數字，例如 0.3 / 4 / 40） */
export interface AdEffects {
  hp: number;
  atk: number;
  def: number;
  spd: number;
}

export interface AdResult {
  /** 各屬性實際追加的傷害（已個別無條件捨去） */
  parts: AdEffects;
  /** 每段追傷 */
  perHit: number;
  /** 總追傷 = 每段 × 段數 */
  total: number;
  hits: number;
}

export const ZERO_AD: AdEffects = { hp: 0, atk: 0, def: 0, spd: 0 };

/**
 * 神器上的追傷效果（218–221）；同一件可能有多條，直接加總。
 * 回傳的是百分比數字（未除以 100）。
 */
export function artifactAdEffects(art: Artifact): AdEffects {
  const out: AdEffects = { ...ZERO_AD };
  for (const s of art.subs) {
    if (s.t === 218) out.hp += s.v;
    else if (s.t === 219) out.atk += s.v;
    else if (s.t === 220) out.def += s.v;
    else if (s.t === 221) out.spd += s.v;
  }
  return out;
}

export function hasAdEffect(art: Artifact): boolean {
  return art.subs.some((s) => s.t >= 218 && s.t <= 221 && s.v > 0);
}

export function addAdEffects(a: AdEffects, b: AdEffects): AdEffects {
  return { hp: a.hp + b.hp, atk: a.atk + b.atk, def: a.def + b.def, spd: a.spd + b.spd };
}

export function adEffectTotal(e: AdEffects): number {
  return e.hp + e.atk + e.def + e.spd;
}

/** AD/段 = floor(HP×h%) + floor(ATK×a%) + floor(DEF×d%) + floor(SPD×s%) */
export function calculateAd(stats: AdStats, effects: AdEffects, hits = 1): AdResult {
  const parts: AdEffects = {
    hp: Math.floor((stats.hp * effects.hp) / 100),
    atk: Math.floor((stats.atk * effects.atk) / 100),
    def: Math.floor((stats.def * effects.def) / 100),
    spd: Math.floor((stats.spd * effects.spd) / 100),
  };
  const perHit = parts.hp + parts.atk + parts.def + parts.spd;
  const count = Math.max(1, Math.round(hits) || 1);
  return { parts, perHit, total: perHit * count, hits: count };
}

/** 單件神器在指定三圍下的追傷（不考慮主屬性） */
export function artifactAdResult(art: Artifact, stats: AdStats, hits = 1): AdResult {
  return calculateAd(stats, artifactAdEffects(art), hits);
}
