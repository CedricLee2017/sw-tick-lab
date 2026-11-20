/**
 * RTA Deck：常用魔靈池（最多 80 隻）＋ 30 個配裝格。
 *
 * 這裡只放型別、預設值與本機儲存；實際配符在 rtaDeckPlan.ts / worker 執行。
 * 資料依遊戲存檔（accountGameKey）分開保存，切換存檔不會混在一起。
 */
import type { StatKey } from "./constants";
import { roleSetup } from "./teamRoles";
import type { TeamRole } from "./teamOptimizer";
import type { Stats } from "./types";

export const RTA_DECK_VERSION = 1;
export const RTA_POOL_MAX = 80;
export const RTA_SLOTS_MAX = 30;
export const RTA_DECK_STORAGE_PREFIX = "swtick:rta-deck:v1:";

/** 2 / 4 / 6 號可接受的主屬性（最多 2 個；空陣列 = 不限） */
export type RtaMainChoices = Record<2 | 4 | 6, number[]>;

export interface RtaDeckSlot {
  id: string;
  /** 帳號內的 unit id；null = 尚未選擇 */
  unitId: number | null;
  /** 配符目標（影響候選排序與預設套裝） */
  role: TeamRole;
  /** 4 件套；0 = 不指定 */
  set4: number;
  /** 2 件套（第一組） */
  set2: number;
  /** 2 件套（第二組；set4 = 0 時可用來組 3×2） */
  set2b: number;
  /** 2 件套（第三組；set4 = 0 時可用來組 3×2） */
  set2c: number;
  mains: RtaMainChoices;
  /** 面板 / 實戰數值下限 */
  min: Partial<Record<StatKey, number>>;
  /** 隊伍評分權重 1–10 */
  weight: number;
  /** 與「前一隻（速度順序較快）」的速度差；第一隻不使用 */
  gap: number;
  /** 是否啟用速度順序（關閉 = 這隻不列入速度串接） */
  inOrder: boolean;
}

export interface RtaDeckResult {
  slotId: string;
  runeIds: number[];
  stats: Stats;
  ehp: number;
  score: number;
  eff: number;
  focusFit: number;
  /** 搜尋目標（顯示用） */
  objective: string;
  /** 因符文庫不足而放寬條件時的說明 */
  notes: string[];
}

/** RTA Deck 的配裝目標：速度是限制條件，預設用「符文水準」把效率最大化 */
export type RtaDeckObjective = "eff" | "score" | "spd" | "support" | "dps" | "tank";

export const RTA_DECK_OBJECTIVES: { value: RtaDeckObjective; label: string; hint: string }[] = [
  { value: "eff", label: "符文水準", hint: "在速度順序與下限內，挑符文效率（水準）最高的組合" },
  { value: "score", label: "面板評分", hint: "綜合面板評分（速度權重較高）" },
  { value: "spd", label: "速度優先", hint: "盡量配快，再用速度差限制後面的角色" },
  { value: "support", label: "綜合", hint: "體力、防禦、速度、命中等綜合表現" },
  { value: "dps", label: "傷害", hint: "攻擊、暴擊與暴傷的期望傷害" },
  { value: "tank", label: "坦度", hint: "體力與防禦的 EHP" },
];

export interface RtaDeckState {
  version: number;
  /** 常用魔靈池（unit id，最多 80） */
  pool: number[];
  /** 30 個配裝格 */
  slots: RtaDeckSlot[];
  /** 速度順序（slot id；只影響有啟用 inOrder 的格子） */
  speedOrder: string[];
  /** 是否計入速度隊長技 */
  leaderOn: boolean;
  /** 速度隊長技 %（手動套用到所有魔靈時使用） */
  leaderPct: number;
  /**
   * 指定哪一隻常用魔靈是速度隊長（unit id）。
   * 用該魔靈的隊長技資料與屬性判斷誰吃得到加成；null = 使用 leaderPct 手動套用。
   */
  leaderUnitId: number | null;
  /** 戰鬥速度模擬用的速度建築 %（RTA 實際上不計；預設 0） */
  towerSpd: number;
  /**
   * 常用魔靈池的戰鬥速度手動調整（以 unit id 為 key，值是加在計算值上的差異）。
   * 只影響速度面板與排序，不影響配符。
   */
  speedAdjust: Record<number, number>;
  /** 速度差模式：至少差 N 速 / 剛好差 N 速 */
  gapMode: "at-least" | "exact";
  /** 配裝目標；預設符文評分（速度只當限制條件） */
  objective: RtaDeckObjective;
  /** 最近一次的配符結果（依 slot id） */
  results: Record<string, RtaDeckResult>;
  updatedAt: number;
}

export const emptyMains = (): RtaMainChoices => ({ 2: [], 4: [], 6: [] });

let slotSeq = 1;
export function newSlotId(): string {
  return `rs_${Date.now().toString(36)}_${slotSeq++}_${Math.random().toString(36).slice(2, 6)}`;
}

export function createDeckSlot(unitId: number | null = null, role: TeamRole = "free"): RtaDeckSlot {
  const setup = roleSetup(role);
  return {
    id: newSlotId(),
    unitId,
    role,
    set4: setup.set4,
    set2: setup.set2,
    set2b: 0,
    set2c: 0,
    mains: {
      2: setup.mains[2] ? [setup.mains[2] as number] : [],
      4: setup.mains[4] ? [setup.mains[4] as number] : [],
      6: setup.mains[6] ? [setup.mains[6] as number] : [],
    },
    min: { ...setup.min },
    weight: setup.weight,
    gap: 1,
    inOrder: true,
  };
}

export function createEmptyDeck(): RtaDeckState {
  return {
    version: RTA_DECK_VERSION,
    pool: [],
    slots: [],
    speedOrder: [],
    leaderOn: false,
    leaderPct: 24,
    leaderUnitId: null,
    towerSpd: 0,
    speedAdjust: {},
    gapMode: "at-least",
    objective: "eff",
    results: {},
    updatedAt: Date.now(),
  };
}

/** 2 / 4 / 6 主屬性清單（與配符頁相同的 SWEX type id） */
export const RTA_MAIN_OPTIONS: Record<2 | 4 | 6, { v: number; label: string }[]> = {
  2: [
    { v: 0, label: "不限" }, { v: 8, label: "速度" },
    { v: 1, label: "固定體力" }, { v: 2, label: "體力%" },
    { v: 3, label: "固定攻擊" }, { v: 4, label: "攻擊%" },
    { v: 5, label: "固定防禦" }, { v: 6, label: "防禦%" },
  ],
  4: [
    { v: 0, label: "不限" }, { v: 9, label: "暴擊率" }, { v: 10, label: "暴擊傷害" },
    { v: 1, label: "固定體力" }, { v: 2, label: "體力%" },
    { v: 3, label: "固定攻擊" }, { v: 4, label: "攻擊%" },
    { v: 5, label: "固定防禦" }, { v: 6, label: "防禦%" },
  ],
  6: [
    { v: 0, label: "不限" },
    { v: 1, label: "固定體力" }, { v: 2, label: "體力%" },
    { v: 3, label: "固定攻擊" }, { v: 4, label: "攻擊%" },
    { v: 5, label: "固定防禦" }, { v: 6, label: "防禦%" },
    { v: 12, label: "效果命中" }, { v: 11, label: "效果抵抗" },
  ],
};

/** 把配裝格轉成引擎需要的套裝件數 */
export function deckSlotSets(slot: RtaDeckSlot): { set: number; count: number }[] {
  const out: { set: number; count: number }[] = [];
  if (slot.set4 > 0) {
    out.push({ set: slot.set4, count: 4 });
    if (slot.set2 > 0) out.push({ set: slot.set2, count: 2 });
  } else {
    for (const set of [slot.set2, slot.set2b, slot.set2c]) {
      if (set > 0) out.push({ set, count: 2 });
    }
  }
  return out;
}

/** 把配裝格的主屬性清單去掉重複與 0，最多保留 2 個 */
export function deckSlotMains(slot: RtaDeckSlot): Partial<Record<number, number[]>> {
  const out: Partial<Record<number, number[]>> = {};
  for (const n of [2, 4, 6] as const) {
    const list = [...new Set((slot.mains[n] ?? []).filter((v) => v > 0))].slice(0, 2);
    if (list.length > 0) out[n] = list;
  }
  return out;
}

/** 切換定位時，若使用者還沒改過主屬性 / 套裝，帶入該定位的預設值 */
export function applyRoleDefaults(slot: RtaDeckSlot, role: TeamRole): RtaDeckSlot {
  const setup = roleSetup(role);
  return {
    ...slot,
    role,
    set4: setup.set4,
    set2: setup.set2,
    set2b: 0,
    set2c: 0,
    mains: {
      2: setup.mains[2] ? [setup.mains[2] as number] : [],
      4: setup.mains[4] ? [setup.mains[4] as number] : [],
      6: setup.mains[6] ? [setup.mains[6] as number] : [],
    },
    min: { ...setup.min },
    weight: setup.weight,
  };
}

const STAT_KEYS: StatKey[] = ["hp", "atk", "def", "spd", "cr", "cd", "res", "acc"];
const ROLES: TeamRole[] = ["speed", "booster", "dps", "tank", "support", "free"];

const int = (value: unknown, min: number, max: number, fallback = 0): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

function cleanSlot(raw: unknown, usedIds: Set<number>): RtaDeckSlot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<RtaDeckSlot>;
  const id = typeof r.id === "string" && r.id ? r.id : newSlotId();
  const unitId = Number(r.unitId);
  // 同一隻魔靈不能重複佔用兩個格子
  const uid = Number.isInteger(unitId) && unitId !== 0 && !usedIds.has(unitId) ? unitId : null;
  if (uid != null) usedIds.add(uid);
  const role = ROLES.includes(r.role as TeamRole) ? (r.role as TeamRole) : "free";
  const mains = r.mains && typeof r.mains === "object" ? r.mains : emptyMains();
  const cleanMain = (n: 2 | 4 | 6) =>
    [...new Set((Array.isArray(mains[n]) ? mains[n] : []).map((v) => int(v, 0, 99)).filter((v) => v > 0))].slice(0, 2);
  const min: Partial<Record<StatKey, number>> = {};
  for (const key of STAT_KEYS) {
    const v = int((r.min as Partial<Record<StatKey, number>> | undefined)?.[key], 0, 1_000_000);
    if (v > 0) min[key] = v;
  }
  return {
    id,
    unitId: uid,
    role,
    set4: int(r.set4, 0, 200),
    set2: int(r.set2, 0, 200),
    set2b: int(r.set2b, 0, 200),
    set2c: int(r.set2c, 0, 200),
    mains: { 2: cleanMain(2), 4: cleanMain(4), 6: cleanMain(6) },
    min,
    weight: int(r.weight, 1, 10, 1),
    gap: int(r.gap, 0, 999, 1),
    inOrder: r.inOrder !== false,
  };
}

/** 讀取本機資料；壞資料會被忽略，避免整頁壞掉 */
export function loadRtaDeck(storageKey: string): RtaDeckState {
  if (typeof localStorage === "undefined") return createEmptyDeck();
  try {
    const text = localStorage.getItem(storageKey);
    if (!text) return createEmptyDeck();
    const raw = JSON.parse(text) as Partial<RtaDeckState>;
    const pool = [...new Set((Array.isArray(raw.pool) ? raw.pool : []).map((v) => Number(v)).filter((v) => Number.isInteger(v) && v !== 0))].slice(0, RTA_POOL_MAX);
    const seen = new Set<number>();
    const slots = (Array.isArray(raw.slots) ? raw.slots : [])
      .map((s) => cleanSlot(s, seen))
      .filter((s): s is RtaDeckSlot => !!s)
      .slice(0, RTA_SLOTS_MAX);
    const slotIds = new Set(slots.map((s) => s.id));
    const order = (Array.isArray(raw.speedOrder) ? raw.speedOrder : [])
      .filter((id): id is string => typeof id === "string" && slotIds.has(id));
    for (const slot of slots) if (!order.includes(slot.id)) order.push(slot.id);
    // 舊結果只保留仍存在的格子，避免參照到已刪除的配裝
    const results: Record<string, RtaDeckResult> = {};
    if (raw.results && typeof raw.results === "object") {
      for (const [id, value] of Object.entries(raw.results)) {
        if (!slotIds.has(id) || !value || typeof value !== "object") continue;
        const v = value as RtaDeckResult;
        if (!Array.isArray(v.runeIds) || !v.stats) continue;
        results[id] = v;
      }
    }
    // 常用魔靈池的手動戰鬥速度（unit id → 調整值）
    const speedAdjust: Record<number, number> = {};
    if (raw.speedAdjust && typeof raw.speedAdjust === "object") {
      for (const [key, value] of Object.entries(raw.speedAdjust)) {
        const uid = Number(key);
        const n = int(value, -999, 999, 0);
        if (Number.isInteger(uid) && uid !== 0 && n !== 0) speedAdjust[uid] = n;
      }
    }
    // 舊版把速度隊長存在配裝格（leaderSlotId），換成 unit id
    const legacy = raw as Partial<RtaDeckState> & { leaderSlotId?: unknown };
    const legacyUnitId =
      typeof legacy.leaderSlotId === "string"
        ? slots.find((s) => s.id === legacy.leaderSlotId)?.unitId ?? null
        : null;
    const rawLeaderUnit = Number(raw.leaderUnitId);
    const leaderUnitId =
      Number.isInteger(rawLeaderUnit) && rawLeaderUnit !== 0 ? rawLeaderUnit : legacyUnitId;
    return {
      version: RTA_DECK_VERSION,
      pool,
      slots,
      speedOrder: order,
      leaderOn: raw.leaderOn === true,
      leaderPct: int(raw.leaderPct, 0, 50, 24),
      leaderUnitId,
      towerSpd: int(raw.towerSpd, 0, 50, 0),
      speedAdjust,
      gapMode: raw.gapMode === "exact" ? "exact" : "at-least",
      objective: RTA_DECK_OBJECTIVES.some((o) => o.value === raw.objective)
        ? (raw.objective as RtaDeckObjective)
        : "eff",
      results,
      updatedAt: Number(raw.updatedAt) || Date.now(),
    };
  } catch {
    return createEmptyDeck();
  }
}

export function saveRtaDeck(storageKey: string, deck: RtaDeckState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey, JSON.stringify({ ...deck, updatedAt: Date.now() }));
  } catch {
    // 忽略容量不足等錯誤；下一次操作會再嘗試
  }
}

/** 移除格子後同步速度順序與結果 */
export function removeSlotFromDeck(deck: RtaDeckState, slotId: string): RtaDeckState {
  const results = { ...deck.results };
  delete results[slotId];
  return {
    ...deck,
    slots: deck.slots.filter((s) => s.id !== slotId),
    speedOrder: deck.speedOrder.filter((id) => id !== slotId),
    results,
    updatedAt: Date.now(),
  };
}

/** 依速度順序把格子排好；未在順序中的格子接在最後 */
export function orderedSlots(deck: RtaDeckState): RtaDeckSlot[] {
  const byId = new Map(deck.slots.map((s) => [s.id, s]));
  const out: RtaDeckSlot[] = [];
  for (const id of deck.speedOrder) {
    const slot = byId.get(id);
    if (slot) {
      out.push(slot);
      byId.delete(id);
    }
  }
  for (const slot of deck.slots) if (byId.has(slot.id)) out.push(slot);
  return out;
}
