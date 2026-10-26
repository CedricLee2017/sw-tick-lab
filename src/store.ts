import { create } from "zustand";
import { del, get, set } from "idb-keyval";
import monstersJson from "./data/monsters.json";
import { PARSE_VERSION, parseAccountJSON } from "./lib/parse";
import { defaultBonus } from "./lib/stats";
import type { Account, BonusConfig, FocusEntry, Monster, Rune, Stats } from "./lib/types";

export const MONSTERS = monstersJson as unknown as Monster[];
export const MONSTER_MAP = new Map<number, Monster>(MONSTERS.map((m) => [m.id, m]));

export function monsterOf(id: number): Monster | undefined {
  return MONSTER_MAP.get(id);
}

export function monsterLabel(id: number): string {
  const m = MONSTER_MAP.get(id);
  return m ? m.name : `#${id}`;
}

export interface Loadout {
  id: string;
  name: string;
  monsterId: number;
  runeIds: number[];
  stats: Stats;
  createdAt: number;
  note?: string;
}

export interface Settings {
  bonus: BonusConfig;
  rta: boolean;
  pool: number;
  /** 配符焦點屬性（最多 5 組） */
  focus: FocusEntry[];
}

const DEFAULT_SETTINGS = (): Settings => ({ bonus: defaultBonus(), rta: false, pool: 18, focus: [] });

const ACCOUNT_KEY = "swtick:account";
const SETTINGS_KEY = "swtick:settings";
const LOADOUT_KEY = "swtick:loadouts";

interface Toast {
  id: number;
  msg: string;
  kind: "ok" | "err";
}

interface Store {
  ready: boolean;
  account: Account | null;
  runeMap: Map<number, Rune>;
  settings: Settings;
  loadouts: Loadout[];
  toasts: Toast[];
  hydrate: () => Promise<void>;
  importText: (text: string, fileName: string) => { ok: boolean; error?: string; warnings: string[] };
  clearAccount: () => Promise<void>;
  patchBonus: (patch: Partial<BonusConfig>) => void;
  setRta: (v: boolean) => void;
  setPool: (v: number) => void;
  setFocus: (focus: FocusEntry[]) => void;
  saveLoadout: (l: Omit<Loadout, "id" | "createdAt">) => void;
  removeLoadout: (id: string) => void;
  notify: (msg: string, kind?: "ok" | "err") => void;
}

let toastSeq = 1;

export const useStore = create<Store>((setState, getState) => ({
  ready: false,
  account: null,
  runeMap: new Map(),
  settings: DEFAULT_SETTINGS(),
  loadouts: [],
  toasts: [],

  hydrate: async () => {
    try {
      const [stored, settings, loadouts] = await Promise.all([
        get<Account>(ACCOUNT_KEY),
        get<Settings>(SETTINGS_KEY),
        get<Loadout[]>(LOADOUT_KEY),
      ]);
      // 舊版解析（stat/set ID 錯位、漏掉裝備符文）不可沿用，要求重新匯入
      const stale = !!stored && stored.parseVersion !== PARSE_VERSION;
      if (stale) await del(ACCOUNT_KEY);
      const acc = stale ? null : stored;
      // 舊版 settings 沒有 focus 欄位，補上預設值
      const saved = settings
        ? { ...DEFAULT_SETTINGS(), ...settings, focus: settings.focus ?? [] }
        : DEFAULT_SETTINGS();
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
        runeMap: new Map((acc?.runes ?? []).map((r) => [r.id, r])),
        settings: saved,
        loadouts: loadouts ?? [],
      });
      if (stale) getState().notify("解析規則已更新，請重新匯入 SWEX 存檔");
    } catch {
      setState({ ready: true });
    }
  },

  importText: (text, fileName) => {
    const { account, error, warnings } = parseAccountJSON(text, fileName);
    if (!account) return { ok: false, error, warnings };
    // 建築一律以全滿等計算（速度圖騰 15%、競技場 20%、屬性塔 21%、公會 20/25%）。
    // 若存檔有建築等級，可在「設定」頁按「套用存檔建築等級」覆寫。
    const prev = getState().settings;
    const settings: Settings = {
      ...prev,
      bonus: defaultBonus({ leadSpd: prev.bonus.leadSpd, buffSpd: prev.bonus.buffSpd }),
    };
    setState({
      account,
      runeMap: new Map(account.runes.map((r) => [r.id, r])),
      settings,
    });
    void set(ACCOUNT_KEY, account);
    if (settings !== prev) void set(SETTINGS_KEY, settings);
    const detectedSpeed = account.buildings.find((b) => b.id === 7);
    getState().notify(
      `已載入 ${account.units.length} 隻魔靈 / ${account.runes.length} 顆符文 · 建築以全滿等計算` +
        (detectedSpeed ? `（存檔速度圖騰 Lv.${detectedSpeed.level}，可於設定頁套用）` : ""),
    );
    return { ok: true, warnings };
  },

  clearAccount: async () => {
    setState({ account: null, runeMap: new Map() });
    await del(ACCOUNT_KEY);
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
    const settings = { ...getState().settings, pool: v };
    setState({ settings });
    void set(SETTINGS_KEY, settings);
  },

  setFocus: (focus) => {
    const settings = { ...getState().settings, focus };
    setState({ settings });
    void set(SETTINGS_KEY, settings);
  },

  saveLoadout: (l) => {
    const loadout: Loadout = { ...l, id: `lo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, createdAt: Date.now() };
    const loadouts = [loadout, ...getState().loadouts].slice(0, 60);
    setState({ loadouts });
    void set(LOADOUT_KEY, loadouts);
    getState().notify("已儲存配裝");
  },

  removeLoadout: (id) => {
    const loadouts = getState().loadouts.filter((x) => x.id !== id);
    setState({ loadouts });
    void set(LOADOUT_KEY, loadouts);
  },

  notify: (msg, kind = "ok") => {
    const id = toastSeq++;
    setState({ toasts: [...getState().toasts, { id, msg, kind }] });
    setTimeout(() => setState({ toasts: getState().toasts.filter((t) => t.id !== id) }), 3200);
  },
}));
