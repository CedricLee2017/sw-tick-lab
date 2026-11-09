/**
 * 玩家自訂的「預設定位」：把常用的套裝、主屬性、下限、Tick 與焦點存成一組，
 * 之後在一鍵配隊的「定位」下拉選單選一次就自動填入。
 *
 * 只存在這台裝置（IndexedDB），不會影響配符引擎的計算。
 */
import { create } from "zustand";
import { get, set } from "idb-keyval";
import type { StatKey } from "./constants";
import type { TeamRole } from "./teamOptimizer";
import type { FocusEntry } from "./types";

const STORAGE_KEY = "swtick:role-presets";
const MAX_PRESETS = 40;
const MAX_NAME = 20;

const TEAM_ROLES: TeamRole[] = ["speed", "booster", "dps", "tank", "support"];

/** 與一鍵配隊頁的「目標」選項一致；分開定義避免 lib 反向依賴頁面。 */
export const PRESET_OBJECTIVES = ["role", "skill", "spd", "atk", "def", "hp", "dps", "tank", "support", "score"] as const;
export type PresetObjective = (typeof PRESET_OBJECTIVES)[number];

/** 一組預設定位會覆寫的欄位 */
export interface RolePresetValues {
  role: TeamRole;
  weight: number;
  /** 4 件套；0 = 不指定 */
  set4: number;
  /** 2 件套（第一組）；0 = 不指定 */
  set2: number;
  /** 2 件套（第二組）；set4 = 0 時可用來組 3×2 */
  set2b?: number;
  /** 2 件套（第三組）；set4 = 0 時可用來組 3×2 */
  set2c?: number;
  mains: Partial<Record<number, number>>;
  min: Partial<Record<StatKey, number>>;
  tick: number;
  focus: FocusEntry[];
  objective: PresetObjective;
  speedMode: "panel" | "tick";
}

export interface RolePreset extends RolePresetValues {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

interface RolePresetState {
  presets: RolePreset[];
  ready: boolean;
  hydrate: () => Promise<void>;
  /** 同名會直接覆寫；名稱空白時回傳 null */
  save: (name: string, values: RolePresetValues) => RolePreset | null;
  remove: (id: string) => void;
}

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const isRole = (value: unknown): value is TeamRole =>
  typeof value === "string" && (TEAM_ROLES as string[]).includes(value);

const isObjective = (value: unknown): value is PresetObjective =>
  typeof value === "string" && (PRESET_OBJECTIVES as readonly string[]).includes(value);

/** 深度複製並限制數值範圍，避免壞資料讓引擎算出奇怪的結果。 */
function cleanValues(values: RolePresetValues): RolePresetValues {
  const mains: Partial<Record<number, number>> = {};
  for (const [slot, main] of Object.entries(values.mains ?? {})) {
    const key = Number(slot);
    const v = Number(main);
    if (!Number.isInteger(key) || !Number.isFinite(v) || v <= 0) continue;
    mains[key] = v;
  }

  const min: Partial<Record<StatKey, number>> = {};
  for (const [key, raw] of Object.entries(values.min ?? {})) {
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) continue;
    min[key as StatKey] = clampInt(v, 0, 100000, 0);
  }

  const focus = (values.focus ?? [])
    .filter((f): f is FocusEntry => !!f && typeof f.key === "string")
    .slice(0, 8)
    .map((f) => ({ key: f.key, weight: clampInt(f.weight, 1, 10, 5) }));

  return {
    role: isRole(values.role) ? values.role : "dps",
    weight: clampInt(values.weight, 1, 10, 10),
    set4: clampInt(values.set4, 0, 200, 0),
    set2: clampInt(values.set2, 0, 200, 0),
    set2b: clampInt(values.set2b, 0, 200, 0),
    set2c: clampInt(values.set2c, 0, 200, 0),
    mains,
    min,
    tick: clampInt(values.tick, 0, 20, 0),
    focus,
    objective: isObjective(values.objective) ? values.objective : "role",
    speedMode: values.speedMode === "tick" ? "tick" : "panel",
  };
}

function sanitize(raw: unknown): RolePreset[] {
  if (!Array.isArray(raw)) return [];
  const out: RolePreset[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Partial<RolePreset>;
    const name = typeof r.name === "string" ? r.name.trim().slice(0, MAX_NAME) : "";
    if (typeof r.id !== "string" || !r.id || !name || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({
      ...cleanValues(r as RolePresetValues),
      id: r.id,
      name,
      createdAt: Number(r.createdAt) || 0,
      updatedAt: Number(r.updatedAt) || Number(r.createdAt) || 0,
    });
    if (out.length >= MAX_PRESETS) break;
  }
  return out;
}

export const useRolePresets = create<RolePresetState>((setState, getState) => ({
  presets: [],
  ready: false,

  hydrate: async () => {
    try {
      const raw = await get<unknown>(STORAGE_KEY);
      setState({ presets: sanitize(raw), ready: true });
    } catch {
      setState({ ready: true });
    }
  },

  save: (name, values) => {
    const trimmed = name.trim().slice(0, MAX_NAME);
    if (!trimmed) return null;

    const now = Date.now();
    const clean = cleanValues(values);
    const existing = getState().presets.find((p) => p.name === trimmed);
    let saved: RolePreset;
    let presets: RolePreset[];

    if (existing) {
      saved = { ...existing, ...clean, name: trimmed, updatedAt: now };
      presets = getState().presets.map((p) => (p.id === saved.id ? saved : p));
    } else {
      saved = {
        ...clean,
        id: `rp_${now}_${Math.random().toString(36).slice(2, 6)}`,
        name: trimmed,
        createdAt: now,
        updatedAt: now,
      };
      presets = [saved, ...getState().presets].slice(0, MAX_PRESETS);
    }

    setState({ presets });
    void set(STORAGE_KEY, presets);
    return saved;
  },

  remove: (id) => {
    const presets = getState().presets.filter((p) => p.id !== id);
    setState({ presets });
    void set(STORAGE_KEY, presets);
  },
}));
