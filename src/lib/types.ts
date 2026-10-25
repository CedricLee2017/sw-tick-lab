/** 資料型別 */
import type { StatKey } from "./constants";

/** 焦點屬性：weight 1~10，越高越優先抽入該屬性的符文 */
export interface FocusEntry {
  key: StatKey;
  weight: number;
}

export interface Monster {
  id: number;
  name: string;
  el: number;
  nat: number;
  awk: number;
  icon: string;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  cr: number;
  cd: number;
  res: number;
  acc: number;
  arch?: string;
  a2?: number;
}

export interface RuneSub {
  t: number;
  v: number;
  g: number;
  gem: number;
}

export interface Rune {
  id: number;
  set: number;
  slot: number;
  grade: number;
  level: number;
  main: { t: number; v: number };
  prefix: { t: number; v: number };
  subs: RuneSub[];
  occupied: number;
  ancient: boolean;
  locked: boolean;
  eff: number;
  effMax: number;
}

export interface Artifact {
  id: number;
  type: number; // 1 = 屬性, 2 = 類型
  attr: number;
  occupied: number;
  main: { t: number; v: number };
  subs: { t: number; v: number }[];
  level: number;
}

export interface Unit {
  id: number;
  master: number;
  stars: number;
  level: number;
  runes: number[];
  artifacts: number[];
  locked: boolean;
}

export interface Account {
  fileName: string;
  importedAt: number;
  /** 解析規則版本；舊快取會在新版載入時要求重新匯入 */
  parseVersion?: number;
  wizard: string;
  units: Unit[];
  runes: Rune[];
  artifacts: Artifact[];
  buildings: { id: number; level: number }[];
  version: string;
}

export interface BonusConfig {
  /** 速度圖騰 % */
  towerSpd: number;
  /** 攻擊/體力/防禦圖騰 %（競技場） */
  towerAtk: number;
  towerHp: number;
  towerDef: number;
  /** 公會旗幟 % */
  guildAtk: number;
  guildHp: number;
  guildDef: number;
  guildCd: number;
  /** 隊長技 % */
  leadSpd: number;
  /** 速度 Buff %（通常 30） */
  buffSpd: number;
  /** 是否計入公會旗幟 */
  useGuild: boolean;
  /** 是否計入屬性塔 */
  useElementTower: boolean;
  /** 磨石 */
  grind: boolean;
}

export interface Stats {
  hp: number;
  atk: number;
  def: number;
  spd: number;
  cr: number;
  cd: number;
  res: number;
  acc: number;
  ehp: number;
  tick: number;
}
