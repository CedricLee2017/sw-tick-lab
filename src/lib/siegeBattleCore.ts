/**
 * 據點戰對戰紀錄的共用型別與正規化。
 *
 * 這個檔案同時被前端、Cloudflare Pages Functions 與 SWEX 外掛使用，
 * 所以只能放純 JS / 型別，不要 import 任何瀏覽器或 Node 專屬 API。
 */

export interface SiegeBattle {
  /** 穩定識別碼：同一場戰鬥重複上傳時用來去重 */
  uid: string;
  /** Siege / SiegeObserver / SiegeTest / WorldGuildBattle... */
  battleType: string;
  wizardId: number;
  wizardName: string;
  guildId: number;
  guildName: string;
  oppGuildId: number;
  oppGuildName: string;
  oppWizardId: number;
  oppWizardName: string;
  battleKey: string;
  /** Unix 秒（戰鬥結束時間） */
  time: number;
  win: boolean;
  /** 公會 rating_id（4003 等；0 = 未知） */
  rank: number;
  /** 防守方三隻魔靈的 master id */
  defense: number[];
  /** 進攻方三隻魔靈的 master id */
  counter: number[];
}

export interface SiegeBattlePayload {
  command?: string;
  battleType?: string;
  battle_type?: string;
  wizard_id?: number;
  wizardId?: number;
  wizard_name?: string;
  wizardName?: string;
  guild_id?: number;
  guildId?: number;
  guild_name?: string;
  guildName?: string;
  opp_guild_id?: number;
  oppGuildId?: number;
  opp_guild_name?: string;
  oppGuildName?: string;
  opp_wizard_id?: number;
  oppWizardId?: number;
  opp_wizard_name?: string;
  oppWizardName?: string;
  battleKey?: string | number;
  battle_key?: string | number;
  battleDateTime?: number;
  battle_time?: number;
  battleStartTime?: number;
  tvalue?: number;
  /** SWGT 報告的日期字串（YYYY-MM-DD HH:mm） */
  date?: string;
  /** 我們自己的 SiegeBattle 物件（重新正規化時用） */
  time?: number;
  win_lose?: number;
  win?: boolean;
  result?: string;
  battleRank?: number;
  rank?: number | string;
  rating_id?: number;
  defense?: unknown;
  counter?: unknown;
  defense_units?: unknown;
  counter_units?: unknown;
  [key: string]: unknown;
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const text = (value: unknown): string => (value == null ? "" : String(value).trim());

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>);
  return [];
}

function unitIds(value: unknown): number[] {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>).units ?? (value as Record<string, unknown>).unit_list ?? value
    : value;
  return [...new Set(
    asArray(raw)
      .map((item) => {
        if (item && typeof item === "object") {
          const row = item as Record<string, unknown>;
          return num(row.unit_master_id ?? row.master ?? row.unit_master ?? row.id ?? row.unit_id);
        }
        return num(item);
      })
      .filter((id) => Number.isInteger(id) && id > 0),
  )].slice(0, 6);
}

function timeSeconds(value: unknown): number {
  const n = num(value);
  if (!n) return 0;
  // 有些來源是毫秒；魔靈的戰鬥時間是秒（約 1.7e9）
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

function winOf(raw: SiegeBattlePayload): boolean {
  if (raw.win_lose != null) return num(raw.win_lose) === 1;
  if (typeof raw.win === "boolean") return raw.win;
  const result = text(raw.result).toLowerCase();
  if (result) return result === "victory" || result === "win" || result === "won" || result === "1";
  return false;
}

/** 把 SWGT 3MDC / SWEX 的各種欄位名稱整理成固定格式；無法辨識時回傳 null */
export function normalizeSiegeBattle(value: unknown): SiegeBattle | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as SiegeBattlePayload;
  const defense = unitIds(raw.defense ?? raw.defense_units);
  const counter = unitIds(raw.counter ?? raw.counter_units);
  if (defense.length !== 3 || counter.length < 1) return null;

  const battleType = text(raw.battleType ?? raw.battle_type) || "Siege";
  const wizardId = num(raw.wizard_id ?? raw.wizardId);
  const wizardName = text(raw.wizard_name ?? raw.wizardName ?? raw.attacker);
  const battleKey = text(raw.battleKey ?? raw.battle_key);
  const dateText = text(raw.date);
  const parsedDate = dateText ? Date.parse(dateText.replace(" ", "T")) : Number.NaN;
  const time =
    timeSeconds(raw.battleDateTime || raw.battle_time || raw.tvalue || raw.battleStartTime || raw.time) ||
    (Number.isFinite(parsedDate) ? Math.floor(parsedDate / 1000) : 0);
  if (!wizardId && !wizardName && !battleKey && !time) return null;

  const guildId = num(raw.guild_id ?? raw.guildId);
  const oppGuildId = num(raw.opp_guild_id ?? raw.oppGuildId);
  const oppWizardId = num(raw.opp_wizard_id ?? raw.oppWizardId);
  const rank = num(raw.battleRank ?? raw.rank ?? raw.rating_id);
  const battle: SiegeBattle = {
    uid: "",
    battleType,
    wizardId,
    wizardName,
    guildId,
    guildName: text(raw.guild_name ?? raw.guildName),
    oppGuildId,
    oppGuildName: text(raw.opp_guild_name ?? raw.oppGuildName ?? raw.defenseGuild),
    oppWizardId,
    oppWizardName: text(raw.opp_wizard_name ?? raw.oppWizardName),
    battleKey,
    time,
    win: winOf(raw),
    rank,
    defense,
    counter,
  };
  battle.uid = siegeBattleUid(battle);
  return battle;
}

/** 同一場战斗的穩定 key；battle_key 優先，沒有時用時間與雙方隊伍 */
export function siegeBattleUid(battle: Omit<SiegeBattle, "uid"> | SiegeBattle): string {
  const key = battle.battleKey || String(battle.time || 0);
  return [
    battle.battleType,
    battle.wizardId,
    key,
    battle.defense.join("-"),
    battle.counter.join("-"),
  ].join("|").slice(0, 400);
}

/** 合併多個來源、依 uid 去重，新的資料優先，最後依時間新到舊排序 */
export function mergeSiegeBattles(...lists: SiegeBattle[][]): SiegeBattle[] {
  const map = new Map<string, SiegeBattle>();
  for (const list of lists) {
    for (const battle of list) {
      if (!battle || !battle.uid) continue;
      const current = map.get(battle.uid);
      if (!current || battle.time >= current.time) map.set(battle.uid, battle);
    }
  }
  return [...map.values()].sort((a, b) => (b.time || 0) - (a.time || 0));
}

/** 公會 rating_id → 常見牌位標籤（4003 = G1） */
export function siegeRankLabel(rank: number): string {
  if (rank >= 6000) return "G3";
  if (rank >= 5000) return "G2";
  if (rank >= 4000) return "G1";
  if (rank >= 3000) return "C3";
  if (rank >= 2000) return "C2";
  if (rank >= 1000) return "C1";
  return rank > 0 ? `#${rank}` : "—";
}
