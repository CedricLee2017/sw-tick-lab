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
  /** 精煉（磨石）加成，實際數值 = v + g */
  g: number;
  /** 寶石（變換）標記，>0 表示這條副屬性是用寶石洗出來的 */
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

/** 神器副效果（200–226 / 300–309 / 400–411） */
export interface ArtifactSub {
  /** 效果 id */
  t: number;
  /** 效果數值（% 或 % of stat） */
  v: number;
  /** 強化次數（+3/+6/+9/+12 加到這條的次數） */
  up?: number;
  /** 轉換次數 */
  roll?: number;
  /** 遊戲原始第 5 欄（目前用途未知，保留原值） */
  extra?: number;
}

export interface Artifact {
  id: number;
  /** 1 = 屬性神器（attribute）、2 = 類型神器（archetype） */
  type: number;
  /** type 1：屬性 1–5、98 特殊；type 2：0 */
  attr: number;
  /** type 2 的魔靈類型（unit_style）1 攻擊 / 2 防禦 / 3 體力 / 4 支援 / 98 特殊 */
  style: number;
  occupied: number;
  /** 主效果：100 體力 / 101 攻擊 / 102 防禦 */
  main: { t: number; v: number };
  subs: ArtifactSub[];
  level: number;
  /** 品質 1 普通–5 傳說 */
  rank: number;
  /** 原始星級（4 / 5） */
  stars: number;
  locked: boolean;
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

/**
 * 魔靈取得記錄：SWEX / SWOP 匯出檔沒有逐筆召喚 API，
 * 這裡以每隻魔靈的 create_time（取得時間）與 source 建立時間軸。
 * 包含背包 / 保管箱中的魔靈。
 */
export interface SummonRecord {
  unitId: number;
  master: number;
  /** 取得當下的星級（unit class） */
  stars: number;
  level: number;
  /** 遊戲回傳的 create_time，格式 YYYY-MM-DD HH:mm:ss */
  createdAt: string;
  /** 遊戲回傳的 source 代碼（用途未公開，保留原始值） */
  source: number;
}

/** RTA（世界競技場）獨立配裝：同一顆符文可以同時出現在一般與 RTA 配裝中 */
export interface RtaLoadout {
  runes: number[];
  artifacts: number[];
}

export interface RtaData {
  loadouts: Record<number, RtaLoadout>;
  /** favorite_unit_list type 1（我的最愛）的 unit_id */
  favorites: number[];
  runeSync: number;
}

/** 遊戲內的預設隊（deck_list） */
export interface DeckEquip {
  unit: number;
  runes: number[];
  artifacts: number[];
}

export interface Deck {
  /** deck_type（遊戲內分類）；防守隊使用 100+ 的內部代碼 */
  type: number;
  /** deck_seq（該分類中的第幾隊） */
  seq: number;
  units: number[];
  leader: number;
  equip: DeckEquip[];
  /** 防守隊的戰力（競技場防守會有） */
  battlePower?: number;
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
  /** RTA 獨立配裝與最愛魔靈（舊存檔可能沒有） */
  rta?: RtaData;
  /** 預設隊（deck_list） */
  decks?: Deck[];
  /** 防守隊（競技場 / 據點戰等） */
  defenseDecks?: Deck[];
  /** 魔靈取得記錄（舊存檔可能沒有；需重新匯入） */
  summons?: SummonRecord[];
}

export interface BonusConfig {
  /** 速度圖騰 % */
  towerSpd: number;
  /** 攻擊/體力/防禦圖騰 %（競技場） */
  towerAtk: number;
  towerHp: number;
  towerDef: number;
  /** 暴擊傷害圖騰 %（競技場） */
  towerCd: number;
  /** 屬性攻擊塔 %（依魔靈屬性，滿等皆 21） */
  elementAtk: number;
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
