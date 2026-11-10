import { create } from "zustand";
import { del, get, set } from "idb-keyval";
import monstersJson from "./data/monsters.json";
import { PARSE_VERSION, parseAccountJSON } from "./lib/parse";
import { defaultBonus } from "./lib/stats";
import { useAuth } from "./lib/auth";
import { mergeLibrary, pullLibrary, pushLibrary } from "./lib/librarySync";
import type { Account, BonusConfig, FocusEntry, Monster, Rune, Stats, Unit } from "./lib/types";

export const MONSTERS = monstersJson as unknown as Monster[];
export const MONSTER_MAP = new Map<number, Monster>(MONSTERS.map((m) => [m.id, m]));

export function monsterOf(id: number): Monster | undefined {
  return MONSTER_MAP.get(id);
}

export function monsterLabel(id: number): string {
  const m = MONSTER_MAP.get(id);
  return m ? m.name : `#${id}`;
}

/** 魔靈的顯示名稱：有自訂名稱時優先使用，否則用圖鑑名稱 */
export function unitLabel(unit: Pick<Unit, "master" | "name">): string {
  const custom = unit.name?.trim();
  return custom || monsterLabel(unit.master);
}

/** 依 unit id 取得顯示名稱；找不到（例如舊收藏沒有 unitId）時退回魔靈圖鑑名稱 */
export function unitLabelById(
  units: Pick<Unit, "id" | "master" | "name">[],
  unitId: number | undefined,
  master: number,
): string {
  const unit = unitId != null ? units.find((u) => u.id === unitId) : undefined;
  return unit ? unitLabel(unit) : monsterLabel(master);
}

/**
 * 產生不重複的魔靈名稱：第一次使用圖鑑原名，之後依序加上 2、3、4…
 * 例如「水仙人」→「水仙人2」→「水仙人3」。
 */
export function nextUnitName(master: number, units: Pick<Unit, "master" | "name">[], base?: string): string {
  const name = base?.trim() || monsterLabel(master);
  const used = new Set(units.map((u) => unitLabel(u)));
  if (!used.has(name)) return name;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${name}${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${name}${used.size + 1}`;
}

export interface Loadout {
  id: string;
  name: string;
  monsterId: number;
  /** 儲存時的 unit_id（同一隻魔靈可能有多份，舊資料可能沒有） */
  unitId?: number;
  runeIds: number[];
  stats: Stats;
  createdAt: number;
  /** 最後修改時間；舊資料沒有時會退回 createdAt */
  updatedAt?: number;
  note?: string;
}

/** 預設隊儲存庫：整隊快照中的一隻魔靈 */
export interface DeckFavUnit {
  unitId: number;
  master: number;
  runeIds: number[];
  artifactIds: number[];
}

/** 預設隊儲存庫：整隊快照 */
export interface DeckFav {
  id: string;
  name: string;
  /** 預設隊類型（含防守隊 100–102） */
  type: number;
  seq: number;
  units: DeckFavUnit[];
  battlePower?: number;
  createdAt: number;
  /** 最後修改時間；舊資料沒有時會退回 createdAt */
  updatedAt?: number;
  note?: string;
}

export interface Settings {
  bonus: BonusConfig;
  rta: boolean;
  pool: number;
  /** 配符焦點屬性（最多 5 組） */
  focus: FocusEntry[];
  /** 應用程式內鎖定的符文：只能留在目前裝備的魔靈，不能被其他角色配符使用 */
  lockedRunes: number[];
  /** 配符時排除的符文 */
  excludedRunes: number[];
  /** 配符時固定要使用的符文 */
  includedRunes: number[];
  /** 配神器時排除的神器（儲存庫可一鍵把整隻魔靈或整隊的神器排除） */
  excludedArtifacts: number[];
}

export type RuneFlag = "locked" | "excluded" | "included";

const RUNE_FLAG_KEY: Record<RuneFlag, "lockedRunes" | "excludedRunes" | "includedRunes"> = {
  locked: "lockedRunes",
  excluded: "excludedRunes",
  included: "includedRunes",
};

const DEFAULT_SETTINGS = (): Settings => ({
  bonus: defaultBonus(),
  rta: false,
  pool: 15,
  focus: [],
  lockedRunes: [],
  excludedRunes: [],
  includedRunes: [],
  excludedArtifacts: [],
});

const ACCOUNT_KEY = "swtick:account";
const SETTINGS_KEY = "swtick:settings";
const LOADOUT_KEY = "swtick:loadouts";
const DECK_FAV_KEY = "swtick:deckfavorites";
/** 已儲存的存檔清單（只存檔名 / 數量等資訊，內容另外放） */
const SAVES_KEY = "swtick:saves";
/** 目前載入的存檔 id */
const CURRENT_SAVE_KEY = "swtick:current-save";
const saveKey = (id: string) => `swtick:save:${id}`;
/** 這台裝置的本機資料屬於哪個會員，用來避免換帳號時把別人的資料帶過去 */
const OWNER_KEY = "swtick:owner";
/** 每個會員上次成功同步儲存庫的時間（用來判斷雲端缺少的項目是「新資料」還是「已刪除」） */
const lastSyncKey = (userId: number) => `swtick:library-sync:${userId}`;

/** 存檔清單的顯示資料，從解析後的帳號產生 */
function savedMeta(id: string, account: Account): SavedAccount {
  return {
    id,
    fileName: account.fileName,
    wizard: account.wizard,
    importedAt: account.importedAt,
    units: account.units.length,
    runes: account.runes.length,
    artifacts: account.artifacts.length,
    parseVersion: account.parseVersion,
  };
}

function newSaveId(): string {
  return `sv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 存檔清單一律新到舊 */
function sortSaves(list: SavedAccount[]): SavedAccount[] {
  return [...list].sort((a, b) => b.importedAt - a.importedAt);
}

/**
 * 切換 / 匯入存檔時重置只對前一份存檔有意義的設定。
 * 符文鎖定、排除、固定都是符文 id，換存檔後會指到不存在的符文。
 */
function settingsForNewAccount(prev: Settings): Settings {
  return {
    ...prev,
    bonus: defaultBonus({ leadSpd: prev.bonus.leadSpd, buffSpd: prev.bonus.buffSpd }),
    lockedRunes: [],
    excludedRunes: [],
    includedRunes: [],
    excludedArtifacts: [],
  };
}

interface Toast {
  id: number;
  msg: string;
  kind: "ok" | "err";
}

export interface LibrarySyncResult {
  ok: boolean;
  error?: string;
  /** 這次是否把雲端資料合併進本機 */
  pulled?: boolean;
  /** 這次是否把本機資料上傳到雲端 */
  pushed?: boolean;
}

/** 本機已儲存的存檔（每一份上傳過的 JSON 各一筆） */
export interface SavedAccount {
  id: string;
  fileName: string;
  wizard: string;
  importedAt: number;
  units: number;
  runes: number;
  artifacts: number;
  /** 解析規則版本；舊版存檔要重新匯入才能讀取 */
  parseVersion?: number;
}

interface Store {
  ready: boolean;
  account: Account | null;
  /** 這台裝置已儲存的存檔清單（新到舊） */
  saves: SavedAccount[];
  /** 目前載入的存檔 id；沒有載入任何存檔時為 null */
  currentSaveId: string | null;
  runeMap: Map<number, Rune>;
  settings: Settings;
  loadouts: Loadout[];
  /** 預設隊儲存庫（整隊快照） */
  deckFavs: DeckFav[];
  toasts: Toast[];
  hydrate: () => Promise<void>;
  importText: (text: string, fileName: string) => Promise<{ ok: boolean; error?: string; warnings: string[] }>;
  /** 切換到另一份已儲存的存檔 */
  switchSave: (id: string) => Promise<boolean>;
  /** 刪除一份已儲存的存檔；刪除目前這份時會自動載入下一份 */
  removeSave: (id: string) => Promise<boolean>;
  /** 取消目前載入的存檔；opts.all 會同時刪除所有已儲存的存檔 */
  clearAccount: (opts?: { all?: boolean }) => Promise<void>;
  patchBonus: (patch: Partial<BonusConfig>) => void;
  setRta: (v: boolean) => void;
  setPool: (v: number) => void;
  setFocus: (focus: FocusEntry[]) => void;
  /** 切換單顆符文的鎖定 / 排除 / 固定 */
  toggleRuneFlag: (kind: RuneFlag, id: number) => void;
  /** 一次設定多顆符文的鎖定 / 排除 / 固定 */
  setRuneFlag: (kind: RuneFlag, ids: number[], on: boolean) => void;
  /** 一次設定多件神器是否排除（配神器時不會選用） */
  setArtifactExcluded: (ids: number[], on: boolean) => void;
  /** 將收藏配裝的符文「上符」到指定魔靈（只修改本工具的本機資料） */
  equipRunes: (unitId: number, runeIds: number[]) => number;
  /** 一次將整隊符文上符；同一顆符文只會分配給一隻魔靈 */
  equipTeam: (assignments: { unitId: number; runeIds: number[] }[]) => number;
  /** 新增自訂魔靈（沒有實際擁有，用來試配符／配隊）；回傳新 unit id，失敗回傳 null */
  addCustomUnit: (master: number, stars: number, level: number, name?: string) => number | null;
  /** 修改魔靈的顯示名稱（空白 = 還原成圖鑑名稱） */
  renameUnit: (unitId: number, name: string) => boolean;
  /** 移除自訂魔靈，並釋放它身上的符文 */
  removeCustomUnit: (unitId: number) => boolean;
  saveLoadout: (l: Omit<Loadout, "id" | "createdAt">) => void;
  removeLoadout: (id: string) => void;
  /** 儲存整隊預設隊到預設隊儲存庫 */
  saveDeckFav: (d: Omit<DeckFav, "id" | "createdAt">, opts?: { silent?: boolean }) => void;
  removeDeckFav: (id: string) => void;
  /** 登入後把本機與雲端儲存庫合併（以 updatedAt 較新者為準），必要時回寫雲端 */
  syncLibrary: () => Promise<LibrarySyncResult>;
  /** 換帳號時清掉前一個會員留在這台裝置的存檔與儲存庫 */
  resetForNewAccount: () => Promise<void>;
  notify: (msg: string, kind?: "ok" | "err") => void;
}

let toastSeq = 1;
/** 同時間只跑一次儲存庫同步，避免自動同步與手動同步互相覆蓋 */
let librarySyncPromise: Promise<LibrarySyncResult> | null = null;
/** 儲存庫上傳依序執行，確保刪除 / 修改一定先送到雲端再拉取 */
let libraryPushChain: Promise<void> = Promise.resolve();

export const useStore = create<Store>((setState, getState) => ({
  ready: false,
  account: null,
  saves: [],
  currentSaveId: null,
  runeMap: new Map(),
  settings: DEFAULT_SETTINGS(),
  loadouts: [],
  deckFavs: [],
  toasts: [],

  hydrate: async () => {
    try {
      const [storedSaves, storedCurrent, settings, loadouts, deckFavs] = await Promise.all([
        get<SavedAccount[]>(SAVES_KEY),
        get<string>(CURRENT_SAVE_KEY),
        get<Settings>(SETTINGS_KEY),
        get<Loadout[]>(LOADOUT_KEY),
        get<DeckFav[]>(DECK_FAV_KEY),
      ]);
      let saves = sortSaves(Array.isArray(storedSaves) ? storedSaves : []);
      let currentId = typeof storedCurrent === "string" ? storedCurrent : null;
      let acc: Account | null = null;
      // 舊版解析（stat/set ID 錯位、漏掉裝備符文）不可沿用，要求重新匯入
      let stale = false;

      if (currentId) {
        const stored = await get<Account>(saveKey(currentId));
        if (stored?.parseVersion === PARSE_VERSION) acc = stored;
        else stale = !!stored;
        if (!acc) currentId = null;
      }

      // 舊版只有一份存檔：搬進新的多存檔清單，原本的資料不會不見
      if (!acc && !currentId) {
        const legacy = await get<Account>(ACCOUNT_KEY);
        if (legacy) {
          if (legacy.parseVersion === PARSE_VERSION) {
            const id = newSaveId();
            acc = legacy;
            currentId = id;
            saves = sortSaves([
              savedMeta(id, legacy),
              ...saves.filter((s) => s.fileName.toLowerCase() !== legacy.fileName.toLowerCase()),
            ]);
            await Promise.all([set(saveKey(id), legacy), set(SAVES_KEY, saves), set(CURRENT_SAVE_KEY, id)]);
          } else {
            stale = true;
          }
          await del(ACCOUNT_KEY);
        }
      }

      // 目前存檔沒有對應的清單資料時補回來（例如清單被清掉但內容還在）
      if (acc && currentId && !saves.some((s) => s.id === currentId)) {
        saves = sortSaves([savedMeta(currentId, acc), ...saves]);
        void set(SAVES_KEY, saves);
      }

      // 舊版 settings 沒有 focus 欄位，補上預設值
      const saved = settings
        ? {
            ...DEFAULT_SETTINGS(),
            ...settings,
            focus: settings.focus ?? [],
            lockedRunes: settings.lockedRunes ?? [],
            excludedRunes: settings.excludedRunes ?? [],
            includedRunes: settings.includedRunes ?? [],
            excludedArtifacts: settings.excludedArtifacts ?? [],
          }
        : DEFAULT_SETTINGS();
      // 候選符文上限已改為 15 顆，舊設定若存了 18 要在載入時收斂
      saved.pool = Math.min(15, Math.max(6, Math.round(saved.pool ?? 15)));
      // v2 起建築預設全滿等（含暴擊傷害圖騰、屬性攻擊塔）。舊設定沒有
      // elementAtk 欄位，代表建築仍是 0%，直接升級為滿等（保留隊長技 / Buff）。
      if (settings && (settings.bonus as Partial<BonusConfig> | undefined)?.elementAtk === undefined) {
        saved.bonus = defaultBonus({
          leadSpd: settings.bonus?.leadSpd ?? 0,
          buffSpd: settings.bonus?.buffSpd ?? 0,
          grind: settings.bonus?.grind ?? true,
        });
        void set(SETTINGS_KEY, saved);
      }
      setState({
        ready: true,
        account: acc ?? null,
        saves,
        currentSaveId: currentId,
        runeMap: new Map((acc?.runes ?? []).map((r) => [r.id, r])),
        settings: saved,
        loadouts: loadouts ?? [],
        deckFavs: deckFavs ?? [],
      });
      if (stale) getState().notify("解析規則已更新，請重新匯入 SWEX 存檔");
    } catch {
      setState({ ready: true });
    }
  },

  importText: async (text, fileName) => {
    const parsed = parseAccountJSON(text, fileName);
    const { error, warnings } = parsed;
    if (!parsed.account) return { ok: false, error, warnings };
    let account = parsed.account;
    const state = getState();
    // 同名檔案視為同一份存檔（重新上傳會更新它，不會多一筆）
    const existing = state.saves.find((s) => s.fileName.toLowerCase() === fileName.toLowerCase());

    // 重新匯入同一份存檔時保留先前新增的自訂魔靈（清空配裝，避免參照到舊存檔的符文）
    let keptCustom: Unit[] = [];
    if (existing) {
      const previous = state.currentSaveId === existing.id ? state.account : await get<Account>(saveKey(existing.id));
      keptCustom = (previous?.units ?? []).filter((u) => u.custom);
    }
    if (keptCustom.length) {
      const used = new Set(account.units.map((u) => u.id));
      let nextId = -1;
      const carried = keptCustom.map((u) => {
        while (used.has(nextId)) nextId--;
        const id = nextId;
        used.add(id);
        nextId--;
        return { ...u, id, runes: [], artifacts: [] };
      });
      account = { ...account, units: [...account.units, ...carried] };
    }

    const id = existing?.id ?? newSaveId();
    // 建築一律以全滿等計算（速度圖騰 15%、競技場 20%、屬性塔 21%、公會 20/25%）。
    // 若存檔有建築等級，可在「設定」頁按「套用存檔建築等級」覆寫。
    const prev = state.settings;
    const settings = settingsForNewAccount(prev);
    const saves = sortSaves([savedMeta(id, account), ...state.saves.filter((s) => s.id !== id)]);
    setState({
      account,
      saves,
      currentSaveId: id,
      runeMap: new Map(account.runes.map((r) => [r.id, r])),
      settings,
    });
    // 寫入本機失敗（例如瀏覽器儲存空間不足）時要讓使用者知道，
    // 否則重新整理後會回到舊存檔，看起來就像「匯入沒有更新」。
    try {
      await Promise.all([set(saveKey(id), account), set(SAVES_KEY, saves), set(CURRENT_SAVE_KEY, id)]);
    } catch {
      getState().notify("存檔已載入，但無法寫入瀏覽器儲存空間；重新整理後可能回到舊存檔", "err");
    }
    if (settings !== prev) void set(SETTINGS_KEY, settings).catch(() => undefined);
    const detectedSpeed = account.buildings.find((b) => b.id === 7);
    getState().notify(
      `已載入 ${account.units.length} 隻魔靈 / ${account.runes.length} 顆符文 / ${account.artifacts.length} 件神器 · 建築以全滿等計算` +
        (detectedSpeed ? `（存檔速度圖騰 Lv.${detectedSpeed.level}，可於設定頁套用）` : "") +
        (keptCustom.length ? `；已保留 ${keptCustom.length} 隻自訂魔靈（配裝清空）` : ""),
    );
    return { ok: true, warnings };
  },

  switchSave: async (id) => {
    const state = getState();
    const meta = state.saves.find((s) => s.id === id);
    if (!meta) return false;
    if (state.currentSaveId === id && state.account) return true;
    const account = await get<Account>(saveKey(id));
    if (!account) {
      getState().notify("找不到這份存檔，請重新上傳 JSON", "err");
      return false;
    }
    if (account.parseVersion !== PARSE_VERSION) {
      getState().notify("這份存檔是舊版解析規則，請重新上傳同名 JSON 更新", "err");
      return false;
    }
    // 離開前先把目前這份存檔的數量更新到清單（新增自訂魔靈後會變動）
    const current = state.account && state.currentSaveId
      ? state.saves.map((s) => (s.id === state.currentSaveId ? savedMeta(s.id, state.account!) : s))
      : state.saves;
    const settings = settingsForNewAccount(state.settings);
    setState({
      account,
      saves: current,
      currentSaveId: id,
      runeMap: new Map(account.runes.map((r) => [r.id, r])),
      settings,
    });
    void set(SAVES_KEY, current);
    void set(CURRENT_SAVE_KEY, id);
    void set(SETTINGS_KEY, settings);
    getState().notify(`已切換存檔：${account.fileName}`);
    return true;
  },

  removeSave: async (id) => {
    const state = getState();
    if (!state.saves.some((s) => s.id === id)) return false;
    const saves = state.saves.filter((s) => s.id !== id);
    const isCurrent = state.currentSaveId === id;
    const settings = settingsForNewAccount(state.settings);
    setState({
      saves,
      ...(isCurrent
        ? { account: null, currentSaveId: null, runeMap: new Map(), settings }
        : {}),
    });
    await Promise.all([del(saveKey(id)), set(SAVES_KEY, saves)]);
    if (isCurrent) {
      void set(SETTINGS_KEY, settings);
      await del(CURRENT_SAVE_KEY);
      // 刪掉目前這份時，自動接續載入最新的一份，不用再手動選
      if (saves.length > 0) await getState().switchSave(saves[0].id);
    }
    getState().notify("已刪除存檔");
    return true;
  },

  clearAccount: async (opts) => {
    const state = getState();
    const settings = settingsForNewAccount(state.settings);
    setState({
      account: null,
      runeMap: new Map(),
      settings,
      currentSaveId: null,
      saves: opts?.all ? [] : state.saves,
    });
    void set(SETTINGS_KEY, settings);
    await del(CURRENT_SAVE_KEY);
    await del(ACCOUNT_KEY);
    if (opts?.all) {
      await set(SAVES_KEY, []);
      await Promise.all(state.saves.map((s) => del(saveKey(s.id))));
    }
  },

  patchBonus: (patch) => {
    const settings = { ...getState().settings, bonus: { ...getState().settings.bonus, ...patch } };
    setState({ settings });
    void set(SETTINGS_KEY, settings);
  },

  setRta: (v) => {
    const settings = { ...getState().settings, rta: v };
    setState({ settings });
    void set(SETTINGS_KEY, settings);
  },

  setPool: (v) => {
    const settings = { ...getState().settings, pool: Math.min(15, Math.max(6, Math.round(v))) };
    setState({ settings });
    void set(SETTINGS_KEY, settings);
  },

  setFocus: (focus) => {
    const settings = { ...getState().settings, focus };
    setState({ settings });
    void set(SETTINGS_KEY, settings);
  },

  toggleRuneFlag: (kind, id) => {
    const current = getState().settings[RUNE_FLAG_KEY[kind]];
    getState().setRuneFlag(kind, [id], !current.includes(id));
  },

  setRuneFlag: (kind, ids, on) => {
    if (ids.length === 0) return;
    const settings = { ...getState().settings };
    const key = RUNE_FLAG_KEY[kind];
    const next = new Set(settings[key]);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    settings[key] = [...next];
    // include 與 exclude 互斥；鎖定則可與兩者並存
    if (kind === "included" && on) settings.excludedRunes = settings.excludedRunes.filter((id) => !ids.includes(id));
    if (kind === "excluded" && on) settings.includedRunes = settings.includedRunes.filter((id) => !ids.includes(id));
    setState({ settings });
    void set(SETTINGS_KEY, settings);
  },

  setArtifactExcluded: (ids, on) => {
    if (ids.length === 0) return;
    const settings = { ...getState().settings };
    const next = new Set(settings.excludedArtifacts);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    settings.excludedArtifacts = [...next];
    setState({ settings });
    void set(SETTINGS_KEY, settings);
  },

  equipRunes: (unitId, runeIds) => {
    const account = getState().account;
    if (!account) return 0;
    const unit = account.units.find((u) => u.id === unitId);
    if (!unit) return 0;

    const runeById = new Map(account.runes.map((r) => [r.id, { ...r }]));
    // 同位置只取一顆，避免舊資料重複
    const bySlot = new Map<number, number>();
    for (const id of runeIds) {
      const r = runeById.get(id);
      if (!r || !r.slot || bySlot.has(r.slot)) continue;
      bySlot.set(r.slot, id);
    }
    const chosen = [...bySlot.values()];
    if (chosen.length === 0) return 0;
    const chosenSet = new Set(chosen);

    // 先把目標魔靈身上不在新組合裡的符文釋放
    for (const rid of unit.runes) {
      if (chosenSet.has(rid)) continue;
      const r = runeById.get(rid);
      if (r) r.occupied = 0;
    }
    // 再從所有魔靈身上移除這批符文，並設定新的擁有者
    const units = account.units.map((u) => ({
      ...u,
      runes: u.id === unitId
        ? chosen.slice().sort((a, b) => (runeById.get(a)?.slot ?? 9) - (runeById.get(b)?.slot ?? 9))
        : u.runes.filter((id) => !chosenSet.has(id)),
    }));
    for (const id of chosen) {
      const r = runeById.get(id);
      if (r) r.occupied = unitId;
    }

    const next: Account = { ...account, units, runes: [...runeById.values()] };
    setState({ account: next, runeMap: new Map(next.runes.map((r) => [r.id, r])) });
    void set(ACCOUNT_KEY, next);
    return chosen.length;
  },

  equipTeam: (assignments) => {
    const account = getState().account;
    if (!account) return 0;
    const runeById = new Map(account.runes.map((r) => [r.id, { ...r }]));
    const unitById = new Map(account.units.map((u) => [u.id, u]));
    const chosen = new Set<number>();
    const byUnit = new Map<number, number[]>();
    const owner = new Map<number, number>();

    for (const a of assignments) {
      if (!unitById.has(a.unitId)) continue;
      const slots = new Set<number>();
      const ids: number[] = [];
      for (const id of a.runeIds) {
        const r = runeById.get(id);
        if (!r || !r.slot) continue;
        // 同一顆符文只能給一隻魔靈；同一位置也只能有一顆
        if (chosen.has(id) || slots.has(r.slot)) continue;
        chosen.add(id);
        slots.add(r.slot);
        ids.push(id);
        owner.set(id, a.unitId);
      }
      ids.sort((x, y) => (runeById.get(x)?.slot ?? 9) - (runeById.get(y)?.slot ?? 9));
      byUnit.set(a.unitId, ids);
    }
    if (chosen.size === 0) return 0;

    // 先釋放目標魔靈原本穿著、但不在新組合裡的符文
    for (const uid of byUnit.keys()) {
      for (const id of unitById.get(uid)?.runes ?? []) {
        if (chosen.has(id)) continue;
        const r = runeById.get(id);
        if (r) r.occupied = 0;
      }
    }

    const units = account.units.map((u) => {
      const ids = byUnit.get(u.id);
      if (ids) return { ...u, runes: ids };
      return { ...u, runes: u.runes.filter((id) => !chosen.has(id)) };
    });
    for (const [id, uid] of owner) {
      const r = runeById.get(id);
      if (r) r.occupied = uid;
    }

    const next: Account = { ...account, units, runes: [...runeById.values()] };
    setState({ account: next, runeMap: new Map(next.runes.map((r) => [r.id, r])) });
    void set(ACCOUNT_KEY, next);
    return chosen.size;
  },

  addCustomUnit: (master, stars, level, name) => {
    const account = getState().account;
    if (!account) return null;
    const monster = MONSTER_MAP.get(master);
    if (!monster) return null;
    // 自訂魔靈使用負數 id，避免和存檔內的 unit id 衝突
    const used = new Set(account.units.map((u) => u.id));
    let id = -1;
    while (used.has(id)) id--;
    // 重複魔靈自動在名稱後面加數字（水仙人 → 水仙人2 → 水仙人3…）
    const displayName = name?.trim() || nextUnitName(master, account.units);
    const unit: Unit = {
      id,
      master,
      stars: Math.min(6, Math.max(1, Math.round(stars || 6))),
      level: Math.min(40, Math.max(1, Math.round(level || 40))),
      runes: [],
      artifacts: [],
      locked: false,
      custom: true,
      name: displayName,
    };
    const next: Account = { ...account, units: [...account.units, unit] };
    setState({ account: next });
    void set(ACCOUNT_KEY, next);
    getState().notify(`已新增 ${displayName}（自訂魔靈）`);
    return id;
  },

  renameUnit: (unitId, name) => {
    const account = getState().account;
    if (!account) return false;
    const unit = account.units.find((u) => u.id === unitId);
    if (!unit) return false;
    const trimmed = name.trim();
    // 空白或與圖鑑名稱相同時不儲存自訂名稱，維持抓到新資料時的自動名稱
    const nextName = !trimmed || trimmed === monsterLabel(unit.master) ? undefined : trimmed;
    if ((unit.name ?? undefined) === nextName) return true;
    const units = account.units.map((u) => (u.id === unitId ? { ...u, name: nextName } : u));
    const next: Account = { ...account, units };
    setState({ account: next });
    void set(ACCOUNT_KEY, next);
    getState().notify(nextName ? `已將魔靈改名為 ${nextName}` : `已還原名稱為 ${monsterLabel(unit.master)}`);
    return true;
  },

  removeCustomUnit: (unitId) => {
    const account = getState().account;
    if (!account) return false;
    const unit = account.units.find((u) => u.id === unitId);
    if (!unit?.custom) return false;
    const runeById = new Map(account.runes.map((r) => [r.id, { ...r }]));
    for (const id of unit.runes) {
      const r = runeById.get(id);
      if (r && r.occupied === unitId) r.occupied = 0;
    }
    const next: Account = {
      ...account,
      units: account.units.filter((u) => u.id !== unitId),
      runes: [...runeById.values()],
    };
    setState({ account: next, runeMap: new Map(next.runes.map((r) => [r.id, r])) });
    void set(ACCOUNT_KEY, next);
    getState().notify(`已移除自訂魔靈 ${unitLabel(unit)}`);
    return true;
  },

  saveLoadout: (l) => {
    const now = Date.now();
    const loadout: Loadout = {
      ...l,
      id: `lo_${now}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: now,
      updatedAt: now,
    };
    const loadouts = [loadout, ...getState().loadouts].slice(0, 60);
    setState({ loadouts });
    void set(LOADOUT_KEY, loadouts);
    scheduleLibraryPush();
    getState().notify("已儲存配裝");
  },

  saveDeckFav: (d, opts) => {
    // 同類型、同序號且隊員完全相同視為同一組，直接覆蓋更新
    const signature = (x: { type: number; seq: number; units: { unitId: number }[] }) =>
      `${x.type}|${x.seq}|${x.units.map((u) => u.unitId).join(",")}`;
    const sig = signature(d);
    const prev = getState().deckFavs;
    const existing = prev.find((x) => signature(x) === sig);
    const now = Date.now();
    const fav: DeckFav = {
      ...d,
      id: existing?.id ?? `dk_${now}_${Math.random().toString(36).slice(2, 7)}`,
      // 建立時間保留第一次儲存的時間；修改時間另外記錄，雲端合併才不會用舊資料蓋新資料
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const deckFavs = [fav, ...prev.filter((x) => x.id !== fav.id)].slice(0, 60);
    setState({ deckFavs });
    void set(DECK_FAV_KEY, deckFavs);
    scheduleLibraryPush();
    if (!opts?.silent) getState().notify(existing ? "已更新預設隊" : "已儲存預設隊");
  },

  removeLoadout: (id) => {
    const loadouts = getState().loadouts.filter((x) => x.id !== id);
    setState({ loadouts });
    void set(LOADOUT_KEY, loadouts);
    // 刪除要立刻上傳，避免自動同步先拉到舊資料又把它復活
    void pushLibraryNow().catch((err) => console.warn("儲存庫刪除上傳失敗", err));
  },

  removeDeckFav: (id) => {
    const deckFavs = getState().deckFavs.filter((x) => x.id !== id);
    setState({ deckFavs });
    void set(DECK_FAV_KEY, deckFavs);
    void pushLibraryNow().catch((err) => console.warn("儲存庫刪除上傳失敗", err));
  },

  syncLibrary: () => {
    if (librarySyncPromise) return librarySyncPromise;

    librarySyncPromise = (async (): Promise<LibrarySyncResult> => {
      const { user, config } = useAuth.getState();
      if (!user || !config?.uploads) {
        return { ok: false, error: "尚未登入或雲端儲存庫未啟用" };
      }

      try {
        await ensureOwner(user.id);
        // 先把已排隊的本機變更（尤其是刪除）送上去，再拉雲端，避免舊資料復活
        await libraryPushChain.catch(() => {});
        const local = { loadouts: getState().loadouts, deckFavs: getState().deckFavs };
        const remote = await pullLibrary();

        // 第一次同步（這台裝置還沒有同步紀錄）用雲端的上傳時間當基準：
        // 比它舊、且雲端已經沒有的本機項目，視為在別台被刪除。
        const savedLastSync = await get<number>(lastSyncKey(user.id));
        const lastSyncAt = typeof savedLastSync === "number" && savedLastSync > 0
          ? savedLastSync
          : (remote.updatedAt ?? 0);

        const mergedLoadouts = mergeLibrary(local.loadouts, remote.loadouts, lastSyncAt);
        const mergedDecks = mergeLibrary(local.deckFavs, remote.deckFavs, lastSyncAt);
        const loadouts = mergedLoadouts.items;
        const deckFavs = mergedDecks.items;
        const changed = mergedLoadouts.changed || mergedDecks.changed;
        const needsPush = mergedLoadouts.push || mergedDecks.push;

        if (changed) {
          setState({ loadouts, deckFavs });
          void set(LOADOUT_KEY, loadouts);
          void set(DECK_FAV_KEY, deckFavs);
        }

        if (needsPush) await pushLibrary({ loadouts, deckFavs });

        // 只有成功完成（含必要時的上傳）才更新同步時間
        await set(lastSyncKey(user.id), Date.now());
        return { ok: true, pulled: changed, pushed: needsPush };
      } catch (err) {
        const message = err instanceof Error ? err.message : "儲存庫同步失敗";
        console.warn("儲存庫同步失敗", err);
        return { ok: false, error: message };
      }
    })();

    void librarySyncPromise.finally(() => {
      librarySyncPromise = null;
    });
    return librarySyncPromise;
  },

  resetForNewAccount: async () => {
    const state = getState();
    const settings = settingsForNewAccount(state.settings);
    setState({
      account: null,
      runeMap: new Map(),
      settings,
      loadouts: [],
      deckFavs: [],
      saves: [],
      currentSaveId: null,
    });
    void set(SETTINGS_KEY, settings);
    await Promise.all([
      del(ACCOUNT_KEY),
      del(LOADOUT_KEY),
      del(DECK_FAV_KEY),
      del(SAVES_KEY),
      del(CURRENT_SAVE_KEY),
      ...state.saves.map((s) => del(saveKey(s.id))),
    ]);
  },

  notify: (msg, kind = "ok") => {
    const id = toastSeq++;
    setState({ toasts: [...getState().toasts, { id, msg, kind }] });
    setTimeout(() => setState({ toasts: getState().toasts.filter((t) => t.id !== id) }), 3200);
  },
}));

/** 儲存庫變更後延遲回寫雲端，避免連續操作打出多次請求。 */
let libraryPushTimer: ReturnType<typeof setTimeout> | null = null;

/** 立即把目前本機儲存庫排進上傳佇列；會依序執行，不會互相覆蓋。 */
function pushLibraryNow(): Promise<void> {
  const { user, config } = useAuth.getState();
  if (!user || !config?.uploads) return Promise.resolve();
  libraryPushChain = libraryPushChain.catch(() => {}).then(() => {
    const { loadouts, deckFavs } = useStore.getState();
    return pushLibrary({ loadouts, deckFavs });
  });
  return libraryPushChain;
}

function scheduleLibraryPush(delay = 1200): void {
  const { user, config } = useAuth.getState();
  if (!user || !config?.uploads) return;
  if (libraryPushTimer) clearTimeout(libraryPushTimer);
  libraryPushTimer = setTimeout(() => {
    libraryPushTimer = null;
    void pushLibraryNow().catch((err) => console.warn("儲存庫上傳失敗", err));
  }, delay);
}

let ownerCheckedFor: number | null = null;
let ownerPromise: Promise<boolean> | null = null;

/**
 * 確認這台裝置的本機資料屬於目前登入的會員。
 * 換帳號時先清掉前一個會員的存檔與儲存庫，避免把別人的資料同步到新帳號。
 * 同一個會員只會檢查一次；回傳 true 代表剛剛清空過本機資料。
 */
export function ensureOwner(userId: number): Promise<boolean> {
  if (ownerCheckedFor === userId && ownerPromise) return ownerPromise;
  ownerCheckedFor = userId;
  ownerPromise = (async () => {
    const owner = await get<number>(OWNER_KEY);
    const switched = typeof owner === "number" && owner !== userId;
    if (switched) await useStore.getState().resetForNewAccount();
    if (owner !== userId) await set(OWNER_KEY, userId);
    return switched;
  })().catch((err) => {
    console.warn("無法確認本機資料擁有者", err);
    return false;
  });
  return ownerPromise;
}
