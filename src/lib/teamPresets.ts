/**
 * 玩家自訂的「一鍵配隊隊型」：把目前隊伍的定位稱呼、出手順序、套裝、
 * 速度條件與面板要求存成一組，之後可以從隊型下拉選單直接套用。
 *
 * 只存在這台裝置（IndexedDB），不會影響配隊引擎的計算。
 */
import { create } from "zustand";
import { get, set } from "idb-keyval";
import type { DeckContext } from "./deckSpeed";
import type { TeamMemberTemplate, TeamTemplate } from "./teamTemplates";
import type { TeamRole } from "./teamOptimizer";
import type { StatKey } from "./constants";
import type { FocusEntry } from "./types";

const STORAGE_KEY = "swtick:team-presets";
const MAX_TEMPLATES = 30;
const MAX_NAME = 24;
const MAX_DESC = 80;

const TEAM_ROLES: TeamRole[] = ["speed", "booster", "dps", "tank", "support", "free"];
const CONTENTS: DeckContext[] = ["arena", "guild", "dungeon"];
const OBJECTIVES = ["role", "skill", "spd", "atk", "def", "hp", "dps", "tank", "support", "score"] as const;
const STAT_KEYS: StatKey[] = ["hp", "atk", "def", "spd", "cr", "cd", "res", "acc"];

export interface CustomTeamTemplate extends TeamTemplate {
  createdAt: number;
  updatedAt: number;
}

interface TeamPresetState {
  templates: CustomTeamTemplate[];
  ready: boolean;
  hydrate: () => Promise<void>;
  /** 同名會直接覆寫；名稱空白時回傳 null */
  save: (values: Omit<TeamTemplate, "id"> & { id?: string }) => CustomTeamTemplate | null;
  remove: (id: string) => void;
}

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const isRole = (value: unknown): value is TeamRole =>
  typeof value === "string" && (TEAM_ROLES as string[]).includes(value);

const isContent = (value: unknown): value is DeckContext =>
  typeof value === "string" && (CONTENTS as string[]).includes(value);

const isObjective = (value: unknown): value is NonNullable<TeamMemberTemplate["objective"]> =>
  typeof value === "string" && (OBJECTIVES as readonly string[]).includes(value);

const isStatKey = (value: string): value is StatKey => (STAT_KEYS as string[]).includes(value);

function cleanSets(raw: unknown): { set: number; count: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { set: number; count: number }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as { set?: unknown; count?: unknown };
    const set = clampInt(r.set, 0, 300, 0);
    const count = clampInt(r.count, 0, 6, 0);
    if (set <= 0 || count <= 0) continue;
    out.push({ set, count });
    if (out.length >= 3) break;
  }
  return out;
}

function cleanMains(raw: unknown): Partial<Record<number, number>> {
  const mains: Partial<Record<number, number>> = {};
  if (!raw || typeof raw !== "object") return mains;
  for (const [slot, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = Number(slot);
    const v = clampInt(value, 0, 100, 0);
    if ((k === 2 || k === 4 || k === 6) && v > 0) mains[k] = v;
  }
  return mains;
}

function cleanMin(raw: unknown): Partial<Record<StatKey, number>> {
  const min: Partial<Record<StatKey, number>> = {};
  if (!raw || typeof raw !== "object") return min;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isStatKey(key)) continue;
    const v = clampInt(value, 0, 100000, 0);
    if (v > 0) min[key] = v;
  }
  return min;
}

function cleanFocus(raw: unknown): FocusEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is FocusEntry => !!f && typeof f === "object" && typeof (f as FocusEntry).key === "string")
    .slice(0, 8)
    .map((f) => ({ key: f.key, weight: clampInt(f.weight, 1, 10, 5) }));
}

function cleanMember(raw: unknown, index: number): TeamMemberTemplate {
  const m = (raw && typeof raw === "object" ? raw : {}) as Partial<TeamMemberTemplate>;
  const title =
    typeof m.title === "string" && m.title.trim() ? m.title.trim().slice(0, 20) : `自訂 ${index + 1}`;
  const skillSlot = clampInt(m.skillSlot, 0, 4, 0);
  return {
    role: isRole(m.role) ? m.role : "support",
    title,
    weight: clampInt(m.weight, 1, 10, 8),
    sets: cleanSets(m.sets),
    mains: cleanMains(m.mains),
    min: cleanMin(m.min),
    tick: clampInt(m.tick, 0, 20, 0),
    focus: cleanFocus(m.focus),
    objective: isObjective(m.objective) ? m.objective : undefined,
    order: clampInt(m.order, 1, 10, index + 1),
    boostPct: clampInt(m.boostPct, 0, 100, 0),
    speedBuff: !!m.speedBuff,
    artifactPct: clampInt(m.artifactPct, 0, 100, 0),
    speedMode: m.speedMode === "tick" ? "tick" : "panel",
    panelExtra: clampInt(m.panelExtra, 0, 500, 0),
    priority: clampInt(m.priority, 0, 5, 0),
    skillSlot,
  };
}

function cleanTemplate(raw: unknown): CustomTeamTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<CustomTeamTemplate>;
  const name = typeof t.name === "string" ? t.name.trim().slice(0, MAX_NAME) : "";
  if (typeof t.id !== "string" || !t.id || !name) return null;
  const size = t.size === 4 || t.size === 5 ? t.size : 3;
  const members = Array.isArray(t.members) ? t.members.slice(0, size).map(cleanMember) : [];
  while (members.length < size) members.push(cleanMember({}, members.length));
  return {
    id: t.id,
    name,
    desc: typeof t.desc === "string" ? t.desc.trim().slice(0, MAX_DESC) : "",
    size,
    content: isContent(t.content) ? t.content : "guild",
    members,
    createdAt: Number(t.createdAt) || 0,
    updatedAt: Number(t.updatedAt) || Number(t.createdAt) || 0,
  };
}

function sanitize(raw: unknown): CustomTeamTemplate[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomTeamTemplate[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const clean = cleanTemplate(item);
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    out.push(clean);
    if (out.length >= MAX_TEMPLATES) break;
  }
  return out;
}

export const useTeamPresets = create<TeamPresetState>((setState, getState) => ({
  templates: [],
  ready: false,

  hydrate: async () => {
    try {
      const raw = await get<unknown>(STORAGE_KEY);
      setState({ templates: sanitize(raw), ready: true });
    } catch {
      setState({ ready: true });
    }
  },

  save: (values) => {
    const name = values.name.trim().slice(0, MAX_NAME);
    if (!name) return null;

    const size: 3 | 4 | 5 = values.size === 4 || values.size === 5 ? values.size : 3;
    const members = values.members.slice(0, size).map(cleanMember);
    while (members.length < size) members.push(cleanMember({}, members.length));

    const now = Date.now();
    const clean = {
      ...values,
      name,
      desc: values.desc.trim().slice(0, MAX_DESC),
      size,
      content: isContent(values.content) ? values.content : "guild",
      members,
    };

    const existing = getState().templates.find((t) => t.name === name);
    let saved: CustomTeamTemplate;
    let templates: CustomTeamTemplate[];
    if (existing) {
      saved = { ...existing, ...clean, id: existing.id, updatedAt: now };
      templates = getState().templates.map((t) => (t.id === saved.id ? saved : t));
    } else {
      saved = {
        ...clean,
        id: `tt_${now}_${Math.random().toString(36).slice(2, 6)}`,
        createdAt: now,
        updatedAt: now,
      };
      templates = [saved, ...getState().templates].slice(0, MAX_TEMPLATES);
    }

    setState({ templates });
    void set(STORAGE_KEY, templates);
    return saved;
  },

  remove: (id) => {
    const templates = getState().templates.filter((t) => t.id !== id);
    setState({ templates });
    void set(STORAGE_KEY, templates);
  },
}));
