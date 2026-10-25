import { create } from "zustand";
import { del, get, set } from "idb-keyval";
import monstersJson from "./data/monsters.json";
import { parseAccountJSON } from "./lib/parse";
import { bonusFromBuildings, defaultBonus } from "./lib/stats";
import type { Account, BonusConfig, Monster, Rune, Stats } from "./lib/types";

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
}

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
  saveLoadout: (l: Omit<Loadout, "id" | "createdAt">) => void;
  removeLoadout: (id: string) => void;
  notify: (msg: string, kind?: "ok" | "err") => void;
}

let toastSeq = 1;

export const useStore = create<Store>((setState, getState) => ({
  ready: false,
  account: null,
  runeMap: new Map(),
  settings: { bonus: defaultBonus(), rta: false, pool: 18 },
  loadouts: [],
  toasts: [],

  hydrate: async () => {
    try {
      const [acc, settings, loadouts] = await Promise.all([
        get<Account>(ACCOUNT_KEY),
        get<Settings>(SETTINGS_KEY),
        get<Loadout[]>(LOADOUT_KEY),
      ]);
      setState({
        ready: true,
        account: acc ?? null,
        runeMap: new Map((acc?.runes ?? []).map((r) => [r.id, r])),
        settings: settings ?? { bonus: defaultBonus(), rta: false, pool: 18 },
        loadouts: loadouts ?? [],
      });
    } catch {
      setState({ ready: true });
    }
  },

  importText: (text, fileName) => {
    const { account, error, warnings } = parseAccountJSON(text, fileName);
    if (!account) return { ok: false, error, warnings };
    // 自動套用存檔中的建築等級（沒有建築資料時保留目前設定）
    const prev = getState().settings;
    const settings: Settings = account.buildings.length > 0
      ? { ...prev, bonus: bonusFromBuildings(account.buildings, prev.bonus) }
      : prev;
    setState({
      account,
      runeMap: new Map(account.runes.map((r) => [r.id, r])),
      settings,
    });
    void set(ACCOUNT_KEY, account);
    if (settings !== prev) void set(SETTINGS_KEY, settings);
    const speedTower = account.buildings.find((b) => b.id === 7);
    getState().notify(
      `已載入 ${account.units.length} 隻魔靈 / ${account.runes.length} 顆符文` +
        (speedTower ? ` · 速度圖騰 ${settings.bonus.towerSpd}%` : ""),
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
