/**
 * 據點戰錦標賽模擬器（Siege Tournament Simulator）
 *
 * 地圖與計分規則參考 SWGT 的 Siege Tournament Simulator：
 * - 每分鐘得分 = 連線到本營的塔數 × 2；連線塔數 ≥ 13 時再 +20
 * - 特殊塔每座再 +10%（本工具保留參數，介面目前不使用）
 * - 先到 20,000 分者獲勝
 *
 * 塔與塔之間的連線是固定的（map_version 2026-10-31），
 * 佔領顏色改變時只會影響「連到本營」的判定。
 */

export type SiegeGuild = "Blue" | "Red";
export type SiegeShape = "Shield" | "Circle";

export const SIEGE_MAP_VERSION = "2026-10-31";
export const SIEGE_SOURCE = "siegeTournamentSimulator";
export const SIEGE_TARGET_SCORE = 20000;

export interface SiegeTower {
  id: number;
  shape: SiegeShape;
  /** 0 = 本營，1–12 = 一般塔 */
  slot: number;
  connections: number[];
  isHQ: boolean;
  color: SiegeGuild;
  /** 0 = 無樣式，1–5 = 目標 T1–T5 */
  pingNumber: number;
  prohibit: boolean;
  memo: string;
  showProgressBar: boolean;
  defenseCount: number;
  /** 0–100 */
  hpPercentage: number;
  buildingSeconds: string;
  /** 敵方在這座塔上的攻擊進度（劍數）0–4；1 = 種劍 */
  swords: number;
}

export interface SiegeStats {
  guildMatchScore: number;
  oppGuild1MatchScore: number;
  lastUpdatedDateTime?: string;
}

export interface SiegeState {
  stats: SiegeStats;
  towers: SiegeTower[];
}

export interface SiegeGuildAnalysis {
  color: SiegeGuild;
  /** 含本營 */
  total: number;
  /** 一般塔總數（不含本營） */
  towerTotal: number;
  /** 連到本營的塔 ID（含本營） */
  connectedIds: number[];
  /** 連到本營的一般塔數（不含本營） */
  connectedTowers: number;
  /** 每分鐘得分 */
  increment: number;
  /** 距離 20,000 分還需要的秒數；Infinity 表示不會到 */
  secondsToWin: number;
}

export interface SiegeAnalysis {
  Blue: SiegeGuildAnalysis;
  Red: SiegeGuildAnalysis;
  /** 每座塔是否連到自己的本營（本營本身永遠是 true） */
  connected: Record<number, boolean>;
}

interface SiegeTemplate {
  id: number;
  shape: SiegeShape;
  slot: number;
  isHQ: boolean;
  connections: number[];
  x: number;
  y: number;
}

const POSITIONS: Record<string, [number, number]> = {
  "Shield-HQ": [128, 457],
  "Shield-1": [131, 320],
  "Shield-2": [246, 390],
  "Shield-3": [340, 481],
  "Shield-4": [189, 195],
  "Shield-5": [280, 269],
  "Shield-6": [357, 337],
  "Shield-7": [441, 412],
  "Shield-8": [515, 487],
  "Shield-9": [399, 230],
  "Shield-10": [488, 308],
  "Shield-11": [573, 395],
  "Shield-12": [687, 366],
  "Circle-HQ": [818, 59],
  "Circle-1": [816, 179],
  "Circle-2": [708, 112],
  "Circle-3": [615, 39],
  "Circle-4": [816, 313],
  "Circle-5": [716, 256],
  "Circle-6": [654, 191],
  "Circle-7": [569, 126],
  "Circle-8": [483, 56],
  "Circle-9": [587, 262],
  "Circle-10": [516, 198],
  "Circle-11": [439, 133],
  "Circle-12": [325, 161],
};

/** 地圖拓撲：id、形狀、編號、是否本營、連線 */
const RAW: [number, SiegeShape, number, boolean, number[]][] = [
  [0, "Shield", 0, true, [1, 2, 3]],
  [1, "Shield", 1, false, [0, 2, 4, 5]],
  [2, "Shield", 2, false, [0, 1, 3, 5, 6, 7]],
  [3, "Shield", 3, false, [0, 2, 7, 8]],
  [4, "Shield", 4, false, [1, 5, 38]],
  [5, "Shield", 5, false, [1, 2, 4, 9, 6, 38]],
  [6, "Shield", 6, false, [2, 5, 7, 9]],
  [7, "Shield", 7, false, [2, 3, 6, 8, 10]],
  [8, "Shield", 8, false, [3, 7, 10, 11]],
  [9, "Shield", 9, false, [5, 6, 10, 36, 38]],
  [10, "Shield", 10, false, [7, 8, 9, 11, 12, 35]],
  [11, "Shield", 11, false, [8, 10, 12]],
  [12, "Shield", 12, false, [10, 11, 30, 31, 35]],
  [26, "Circle", 0, true, [27, 28, 29]],
  [27, "Circle", 1, false, [26, 28, 30, 31]],
  [28, "Circle", 2, false, [26, 27, 31, 32, 33, 29]],
  [29, "Circle", 3, false, [26, 28, 33, 34]],
  [30, "Circle", 4, false, [27, 12, 31]],
  [31, "Circle", 5, false, [28, 27, 30, 12, 35, 32]],
  [32, "Circle", 6, false, [28, 31, 35, 33]],
  [33, "Circle", 7, false, [29, 28, 32, 36, 34]],
  [34, "Circle", 8, false, [29, 33, 37]],
  [35, "Circle", 9, false, [32, 31, 12, 10, 36]],
  [36, "Circle", 10, false, [34, 33, 35, 9, 38, 37]],
  [37, "Circle", 11, false, [34, 36, 38]],
  [38, "Circle", 12, false, [4, 5, 9, 36, 37]],
];

export const SIEGE_TEMPLATES: SiegeTemplate[] = RAW.map(([id, shape, slot, isHQ, connections]) => {
  const [x, y] = POSITIONS[`${shape}-${slot === 0 ? "HQ" : slot}`];
  return { id, shape, slot, isHQ, connections, x, y };
});

export const SIEGE_TEMPLATE_BY_ID = new Map(SIEGE_TEMPLATES.map((t) => [t.id, t]));

export function siegeTowerName(tower: Pick<SiegeTower, "shape" | "slot" | "isHQ">): string {
  if (tower.isHQ) return tower.shape === "Shield" ? "藍方本營" : "紅方本營";
  const shape = tower.shape === "Shield" ? "盾塔" : "圓塔";
  return `${shape} ${tower.slot}`;
}

/** 新地圖：盾方（藍）13 座、圓方（紅）13 座，全部滿血、無樣式。 */
export function createSiegeTowers(): SiegeTower[] {
  return SIEGE_TEMPLATES.map(({ id, shape, slot, isHQ, connections }) => ({
    id,
    shape,
    slot,
    isHQ,
    connections: [...connections],
    color: shape === "Shield" ? "Blue" : "Red",
    pingNumber: 0,
    prohibit: false,
    memo: "",
    showProgressBar: !isHQ,
    defenseCount: isHQ ? 0 : 5,
    hpPercentage: isHQ ? 0 : 100,
    buildingSeconds: "",
    swords: 0,
  }));
}

export function createSiegeState(): SiegeState {
  return {
    stats: { guildMatchScore: 0, oppGuild1MatchScore: 0 },
    towers: createSiegeTowers(),
  };
}

export function defaultSiegeTower(id: number): SiegeTower | undefined {
  return createSiegeTowers().find((t) => t.id === id);
}

/** 每分鐘得分（特殊塔每座 +10%，與 SWGT 相同，無條件捨去）。 */
export function siegeScoreIncrement(connectedTowers: number, specialTowers = 0): number {
  const towers = Math.max(0, Math.floor(connectedTowers));
  let score = towers * 2;
  if (towers >= 13) score += 20;
  if (specialTowers > 0) score += score * specialTowers * 0.1;
  return Math.floor(score);
}

/** 距離目標分數的秒數；0 或超過 900,000 秒（約 10.4 天）視為不會到達。 */
export function siegeSecondsToWin(score: number, increment: number, target = SIEGE_TARGET_SCORE): number {
  const need = target - score;
  if (increment <= 0 || need <= 0) return Infinity;
  const seconds = (need * 60) / increment;
  return seconds > 900_000 ? Infinity : seconds;
}

/** 例：50000 → "13h 53m 20s"；Infinity → "∞"。 */
export function formatSiegeDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 900_000) return "∞";
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(hrs)}h ${two(mins)}m ${two(secs)}s`;
}

function blankAnalysis(color: SiegeGuild, total: number): SiegeGuildAnalysis {
  return {
    color,
    total,
    towerTotal: total - 1,
    connectedIds: [],
    connectedTowers: 0,
    increment: 0,
    secondsToWin: Infinity,
  };
}

/** 從本營沿著「同顏色」的塔遞迴，算出每隊連線塔數與每分鐘得分。 */
export function analyzeSiege(towers: SiegeTower[], stats?: SiegeStats): SiegeAnalysis {
  const byId = new Map(towers.map((t) => [t.id, t]));
  const analysis: SiegeAnalysis = {
    Blue: blankAnalysis("Blue", towers.filter((t) => t.shape === "Shield").length),
    Red: blankAnalysis("Red", towers.filter((t) => t.shape === "Circle").length),
    connected: {},
  };

  for (const color of ["Blue", "Red"] as const) {
    const seen = new Set<number>();
    const connectedIds = new Set<number>();

    const walk = (id: number) => {
      if (seen.has(id)) return;
      seen.add(id);
      const tower = byId.get(id);
      if (!tower || tower.color !== color) return;
      connectedIds.add(id);
      for (const next of tower.connections) walk(next);
    };

    for (const hq of towers.filter((t) => t.isHQ && t.color === color)) walk(hq.id);
    for (const id of connectedIds) analysis.connected[id] = true;

    const entry = analysis[color];
    entry.connectedIds = [...connectedIds].sort((a, b) => a - b);
    entry.connectedTowers = Math.max(0, connectedIds.size - 1);
    entry.increment = siegeScoreIncrement(entry.connectedTowers);
    const score = color === "Blue" ? stats?.guildMatchScore ?? 0 : stats?.oppGuild1MatchScore ?? 0;
    entry.secondsToWin = siegeSecondsToWin(score, entry.increment);
  }

  return analysis;
}

export function clampInt(value: unknown, min: number, max: number, fallback = min): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function otherSiegeGuild(color: SiegeGuild): SiegeGuild {
  return color === "Blue" ? "Red" : "Blue";
}

/** 這座塔目前是哪一方在進攻（劍數的擁有者）。 */
export function siegeSwordOwner(tower: Pick<SiegeTower, "color">): SiegeGuild {
  return otherSiegeGuild(tower.color);
}

/**
 * 設定敵方在這座塔上的劍數。
 * 0–4 只記錄進度；5 代表爆塔：塔會變成進攻方顏色、劍數歸零、HP / 防守重置。
 */
export function setTowerSwords(tower: SiegeTower, swords: number): SiegeTower {
  const next = clampInt(swords, 0, 5, 0);
  if (next < 5) return { ...tower, swords: next };
  return {
    ...tower,
    color: otherSiegeGuild(tower.color),
    swords: 0,
    hpPercentage: tower.isHQ ? 0 : 100,
    defenseCount: tower.isHQ ? 0 : 5,
    showProgressBar: !tower.isHQ,
    buildingSeconds: "",
    pingNumber: 0,
    prohibit: false,
  };
}

function normalizeTower(input: unknown, template: SiegeTemplate, base: SiegeTower): SiegeTower {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const color = raw.color === "Blue" || raw.color === "Red" ? raw.color : base.color;
  const memo = typeof raw.memo === "string" ? raw.memo.replace(/"/g, "").slice(0, 100) : "";
  const tower: SiegeTower = {
    ...base,
    connections: [...template.connections],
    color,
    pingNumber: clampInt(raw.pingNumber, 0, 5, 0),
    prohibit: raw.prohibit === true,
    memo,
    showProgressBar: template.isHQ ? false : raw.showProgressBar !== false,
    defenseCount: template.isHQ ? 0 : clampInt(raw.defenseCount, 0, 5, 5),
    hpPercentage: template.isHQ ? 0 : clampInt(raw.hpPercentage, 0, 100, 100),
    buildingSeconds: typeof raw.buildingSeconds === "string" ? raw.buildingSeconds.slice(0, 20) : "",
    swords: 0,
  };
  return setTowerSwords(tower, clampInt(raw.swords, 0, 5, 0));
}

export interface SiegeImportResult {
  ok: boolean;
  state?: SiegeState;
  error?: string;
  /** 來源檔案的 map_version 與目前地圖不同時提供提示 */
  warning?: string;
}

/**
 * 匯入 SWGT 模擬器或本工具的 JSON。
 * 接受三種形式：SWGT 的 `[ { siege_map_data, siegeMapStatsData } ]`、
 * 單一物件、或本工具的 `{ towers, stats }`。
 */
export function importSiegeJSON(text: string): SiegeImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "JSON 格式錯誤，無法解析" };
  }

  let root: unknown = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!root || typeof root !== "object") return { ok: false, error: "檔案內容不是模擬器存檔" };
  let obj = root as Record<string, unknown>;

  // 允許 { data: ... } 之類的單層包裝
  if (!Array.isArray(obj.siege_map_data) && !Array.isArray(obj.towers) && obj.data && typeof obj.data === "object") {
    obj = obj.data as Record<string, unknown>;
  }

  const rawTowers = Array.isArray(obj.siege_map_data)
    ? obj.siege_map_data
    : Array.isArray(obj.towers)
      ? obj.towers
      : null;
  if (!rawTowers) return { ok: false, error: "找不到地圖資料（siege_map_data）" };

  const byId = new Map<number, unknown>();
  for (const item of rawTowers) {
    if (!item || typeof item !== "object") continue;
    const id = clampInt((item as Record<string, unknown>).id, -1, 9999, -1);
    if (SIEGE_TEMPLATE_BY_ID.has(id)) byId.set(id, item);
  }
  if (byId.size === 0) return { ok: false, error: "地圖資料沒有任何可辨識的塔" };

  const base = createSiegeTowers();
  const towers = base.map((b) => {
    const template = SIEGE_TEMPLATE_BY_ID.get(b.id)!;
    return normalizeTower(byId.get(b.id), template, b);
  });

  const rawStats = (obj.siegeMapStatsData ?? obj.stats ?? {}) as Record<string, unknown>;
  const stats: SiegeStats = {
    guildMatchScore: clampInt(rawStats.guildMatchScore, 0, SIEGE_TARGET_SCORE, 0),
    oppGuild1MatchScore: clampInt(rawStats.oppGuild1MatchScore, 0, SIEGE_TARGET_SCORE, 0),
  };
  if (typeof rawStats.lastUpdatedDateTime === "string") stats.lastUpdatedDateTime = rawStats.lastUpdatedDateTime.slice(0, 40);

  const version = typeof obj.map_version === "string" ? obj.map_version : "";
  const warning = version && version !== SIEGE_MAP_VERSION
    ? `存檔地圖版本為 ${version}，目前已 2026-10-31 地圖重新套用塔的連線。`
    : undefined;

  return { ok: true, state: { stats, towers }, warning };
}

/** 匯出成 SWGT 可直接匯入的格式（外層為陣列）。 */
export function exportSiegeJSON(state: SiegeState): string {
  const payload = {
    time_stamp: Date.now(),
    version: 2,
    map_version: SIEGE_MAP_VERSION,
    source: SIEGE_SOURCE,
    siegeMapStatsData: {
      ...state.stats,
      guildMatchScore: Math.round(state.stats.guildMatchScore),
      oppGuild1MatchScore: Math.round(state.stats.oppGuild1MatchScore),
    },
    siege_map_data: state.towers.map((t) => ({
      id: t.id,
      connections: t.connections,
      isHQ: t.isHQ,
      shape: t.shape,
      color: t.color,
      pingNumber: t.pingNumber,
      prohibit: t.prohibit,
      memo: t.memo,
      showProgressBar: t.showProgressBar,
      defenseCount: t.defenseCount,
      hpPercentage: t.hpPercentage,
      buildingSeconds: t.buildingSeconds,
      swords: t.swords,
    })),
  };
  return JSON.stringify([payload]);
}

export const SIEGE_STORAGE_KEY = "swtick:siege-sim:v1";

export function loadSiegeState(): SiegeState {
  try {
    const raw = window.localStorage.getItem(SIEGE_STORAGE_KEY);
    if (!raw) return createSiegeState();
    const result = importSiegeJSON(raw);
    return result.ok && result.state ? result.state : createSiegeState();
  } catch {
    return createSiegeState();
  }
}

export function saveSiegeState(state: SiegeState): void {
  try {
    window.localStorage.setItem(SIEGE_STORAGE_KEY, exportSiegeJSON(state));
  } catch {
    /* 私密瀏覽或容量不足時忽略 */
  }
}
