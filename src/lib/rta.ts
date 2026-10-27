/** RTA（世界競技場）獨立配裝計算 */
import { addArtifactToAccum, addRuneToAccum, applySetBonuses, baseStats, defaultBonus, emptyAccum, finalizeStats, type BaseStats } from "./stats";
import type { Account, Artifact, Rune, Stats, Unit } from "./types";
import type { Monster } from "./types";

export interface RtaView {
  unit: Unit;
  base: BaseStats;
  runes: Rune[];
  artifacts: Artifact[];
  stats: Stats;
}

/** RTA 只吃符文 / 套裝 / 神器與速度隊長；不吃一般建築、競技場圖騰、Buff */
export function rtaStats(
  base: BaseStats,
  runes: Rune[],
  artifacts: Artifact[],
  leaderPct: number,
  grind = true,
): Stats {
  const bonus = defaultBonus({
    towerSpd: 0,
    towerAtk: 0,
    towerHp: 0,
    towerDef: 0,
    towerCd: 0,
    elementAtk: 0,
    guildAtk: 0,
    guildHp: 0,
    guildDef: 0,
    guildCd: 0,
    leadSpd: leaderPct,
    buffSpd: 0,
    useGuild: false,
    useElementTower: false,
    grind,
  });
  const a = emptyAccum();
  for (const r of runes) addRuneToAccum(a, r, grind);
  for (const art of artifacts) addArtifactToAccum(a, art);
  applySetBonuses(a, base);
  // RTA Tick 使用 1.5% / Tick
  return finalizeStats(base, a, bonus, true, false);
}

/** 依 RTA 裝備清單建立一隻魔靈的檢視資料 */
export function rtaView(
  account: Account,
  unit: Unit,
  monster: Monster,
  leaderPct: number,
  grind = true,
): RtaView {
  const base = baseStats(monster, unit.stars, unit.level);
  const runeMap = new Map(account.runes.map((r) => [r.id, r]));
  const artifactMap = new Map(account.artifacts.map((a) => [a.id, a]));
  const load = account.rta?.loadouts[unit.id];
  const runes = (load?.runes ?? []).map((id) => runeMap.get(id)).filter(Boolean) as Rune[];
  const artifacts = (load?.artifacts ?? []).map((id) => artifactMap.get(id)).filter(Boolean) as Artifact[];
  return {
    unit,
    base,
    runes,
    artifacts,
    stats: rtaStats(base, runes, artifacts, leaderPct, grind),
  };
}
