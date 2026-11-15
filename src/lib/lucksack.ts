/** Lucksack（RTA 數據網站）對照：抓取 Guardian 3 的套裝 / 主屬 / 神器使用率並比對自己的配裝 */
import { artifactSubText } from "./artifacts";
import { SET_BY_ID, STAT_TYPES } from "./constants";
import type { Artifact, Rune } from "./types";

/** Lucksack 的套裝 id → 英文名稱（來源：他們的 JS 常數） */
const LUCK_SET_NAME: Record<number, string> = {
  1: "Energy",
  2: "Fatal",
  3: "Blade",
  4: "Rage",
  5: "Swift",
  6: "Focus",
  7: "Guard",
  8: "Endure",
  9: "Violent",
  10: "Will",
  11: "Nemesis",
  12: "Shield",
  13: "Revenge",
  14: "Despair",
  15: "Vampire",
  16: "Destroy",
  17: "Fight",
  18: "Determination",
  19: "Enhance",
  20: "Accuracy",
  21: "Tolerance",
  22: "Intangible",
  23: "Seal",
};

/** 我們的套裝 id（SWEX）←→ Lucksack 套裝 id，用英文名稱對照 */
const OUR_SET_BY_EN = new Map<string, number>();
for (const set of Object.values(SET_BY_ID)) OUR_SET_BY_EN.set(set.en.toLowerCase(), set.id);

/** Lucksack 套裝 id → 我們的套裝 id（對不到回傳 0） */
export function luckSetToOurs(luckId: number): number {
  const name = LUCK_SET_NAME[luckId];
  return name ? OUR_SET_BY_EN.get(name.toLowerCase()) ?? 0 : 0;
}

export interface LuckRuneSet {
  primary_set: number;
  secondary_set: number | null;
  tertiary_set: number | null;
  count: number;
  pickrate: number;
  winrate: number;
}

export interface LuckSlotStat {
  slot_two: number;
  slot_four: number;
  slot_six: number;
  count: number;
  pickrate: number;
  winrate: number;
}

export interface LuckEffect {
  effect_id: number;
  count: number;
  pickrate: number;
  winrate: number;
}

export interface LuckStats {
  rune_sets?: LuckRuneSet[];
  slot_stats?: LuckSlotStat[];
  artifact_type?: LuckEffect[];
  artifact_arch?: LuckEffect[];
}

export interface LuckSummary {
  battle_count: number;
  pick_count: number;
  win_count: number;
  ban_count: number;
  lead_count: number;
  pick_rate: number;
  win_rate: number;
  ban_rate: number;
  lead_rate: number;
}

export interface LuckMonster {
  slug: string;
  id: number;
  name: string;
  com2usName?: string;
  element?: string;
  naturalStars?: number;
}

export interface LuckMonsterData {
  monster: LuckMonster;
  summary: LuckSummary | null;
  stats: LuckStats;
}

export interface LuckCatalogEntry {
  id: number;
  slug: string;
  name: string;
  el: number;
  nat: number;
}

const ELEMENT_NAME: Record<number, string> = { 1: "Water", 2: "Fire", 3: "Wind", 4: "Light", 5: "Dark" };

const API_BASE = "/api/lucksack";

/** 預設只看 Guardian 3（Lucksack 的 rank id = 16） */
export const GUARDIAN3_RANK = 16;
export const GUARDIAN3_LABEL = "Guardian 3";

const CATALOG_KEY = "swtick:lucksack:catalog";
const CATALOG_TTL = 1000 * 60 * 60 * 24 * 7;
const MONSTER_TTL = 1000 * 60 * 60 * 6;
const monsterKey = (slug: string, season: number, rank: number) => `swtick:lucksack:m:${slug}:${season}:${rank}`;

function readLocal<T>(key: string, ttl: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; data: T };
    if (!parsed?.at || Date.now() - parsed.at > ttl) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeLocal(key: string, data: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* 容量不足時忽略，下次重新抓 */
  }
}

/** 目前的 RTA 賽季（Lucksack 的 seasons 表） */
export async function loadLuckSeason(): Promise<number | null> {
  try {
    const res = await fetch(`${API_BASE}?seasons=1`);
    if (!res.ok) return null;
    const data = (await res.json()) as { current?: number | null };
    return typeof data.current === "number" ? data.current : null;
  } catch {
    return null;
  }
}

/** 魔靈目錄（id / slug / 名稱 / 屬性），用來把我們的魔靈對到 Lucksack 的頁面 */
export async function loadLuckCatalog(): Promise<LuckCatalogEntry[]> {
  const cached = readLocal<LuckCatalogEntry[]>(CATALOG_KEY, CATALOG_TTL);
  if (cached && cached.length > 0) return cached;
  const res = await fetch(`${API_BASE}?catalog=1`);
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const data = (await res.json()) as LuckCatalogEntry[];
  if (Array.isArray(data) && data.length > 0) writeLocal(CATALOG_KEY, data);
  return Array.isArray(data) ? data : [];
}

/** 用我們的魔靈（com2us id + 名稱 + 屬性）找出 Lucksack 的 slug */
export function resolveLuckSlug(
  monster: { id: number; name: string; el: number },
  catalog: LuckCatalogEntry[],
): string | null {
  const byId = catalog.find((c) => c.id === monster.id);
  if (byId) return byId.slug;
  const name = monster.name.trim().toLowerCase();
  const elName = ELEMENT_NAME[monster.el];
  const byName = catalog.filter((c) => c.name.trim().toLowerCase() === name);
  const exact = byName.find((c) => elName && ELEMENT_NAME[c.el] === elName);
  return (exact ?? byName[0])?.slug ?? null;
}

const memCache = new Map<string, LuckMonsterData>();

/** 抓一隻魔靈在指定賽季 / 牌位的統計（含 localStorage 快取） */
export async function loadLuckMonster(
  slug: string,
  season: number,
  rank = GUARDIAN3_RANK,
): Promise<LuckMonsterData> {
  const key = monsterKey(slug, season, rank);
  const mem = memCache.get(key);
  if (mem) return mem;
  const cached = readLocal<LuckMonsterData>(key, MONSTER_TTL);
  if (cached) {
    memCache.set(key, cached);
    return cached;
  }
  const res = await fetch(`${API_BASE}?slug=${encodeURIComponent(slug)}&season=${season}&rank=${rank}`);
  if (!res.ok) throw new Error(`lucksack ${res.status}`);
  const data = (await res.json()) as LuckMonsterData;
  memCache.set(key, data);
  writeLocal(key, data);
  return data;
}

// ── 配裝比對 ──────────────────────────────────────────────

export interface ComboPart {
  id: number;
  count: number;
  name: string;
}

/** 6 顆符文的套裝組合（依件數、再依 id 排序），只保留 2 件以上 */
export function runeCombo(runes: Rune[]): ComboPart[] {
  const counts = new Map<number, number>();
  for (const r of runes) counts.set(r.set, (counts.get(r.set) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([id, count]) => ({ id, count, name: SET_BY_ID[id]?.name ?? `套裝 ${id}` }))
    .sort((a, b) => b.count - a.count || a.id - b.id);
}

export function comboText(parts: ComboPart[]): string {
  return parts.length === 0 ? "無套裝" : parts.map((p) => `${p.name}×${p.count}`).join(" + ");
}

function comboKey(parts: ComboPart[]): string {
  return parts.map((p) => `${p.id}x${p.count}`).sort().join(",");
}

/** Lucksack 的套裝列 → 我們的套裝組合 */
export function luckCombo(row: LuckRuneSet): ComboPart[] {
  const out: ComboPart[] = [];
  for (const luckId of [row.primary_set, row.secondary_set, row.tertiary_set]) {
    if (!luckId) continue;
    const id = luckSetToOurs(luckId);
    if (!id) continue;
    const pieces = SET_BY_ID[id]?.pieces ?? 2;
    out.push({ id, count: pieces, name: SET_BY_ID[id]?.name ?? `套裝 ${id}` });
  }
  return out.sort((a, b) => b.count - a.count || a.id - b.id);
}

export function luckComboText(row: LuckRuneSet): string {
  return comboText(luckCombo(row));
}

/** 神器效果文字（縮短版） */
export interface ArtifactCheck {
  artifactId: number;
  effectId: number;
  label: string;
  pickrate: number | null;
  ok: boolean;
}

export interface BuildCheck {
  /** 套裝 */
  combo: ComboPart[];
  comboLabel: string;
  setMatch: LuckRuneSet | null;
  setTop: LuckRuneSet | null;
  setPickrate: number;
  setOk: boolean;
  /** 主屬性 2 / 4 / 6 */
  mainIds: number[];
  mainLabel: string;
  mainMatch: LuckSlotStat | null;
  mainTop: LuckSlotStat | null;
  mainPickrate: number;
  mainOk: boolean;
  /** 神器 */
  artifacts: ArtifactCheck[];
  artifactTotal: number;
  artifactGood: number;
  artifactOk: boolean;
  /** Lucksack 沒有任何套裝 / 主屬性統計（樣本太少） */
  insufficient: boolean;
  /** 0–100 符合度（資料不足時為 0，介面顯示 —） */
  score: number;
  warnings: string[];
}

export const MAIN_SLOTS = [2, 4, 6] as const;

function statLabel(id: number): string {
  return STAT_TYPES[id]?.label ?? `屬性 ${id}`;
}

function mainLabelOf(ids: number[]): string {
  return ids.map((id) => (id ? statLabel(id) : "—")).join(" / ");
}

/**
 * 把一隻魔靈的 RTA 配裝跟 Lucksack 的 Guardian 3 統計比較。
 * 套裝與主屬性看是否為主流組合（或使用率），神器看每條效果是否常見。
 */
export function compareBuild(
  runes: Rune[],
  artifacts: Artifact[],
  data: LuckMonsterData | null | undefined,
): BuildCheck | null {
  if (!data) return null;
  const stats = data.stats ?? {};
  const setList = [...(stats.rune_sets ?? [])].sort((a, b) => b.pickrate - a.pickrate);
  const slotList = [...(stats.slot_stats ?? [])].sort((a, b) => b.pickrate - a.pickrate);

  // 套裝
  const combo = runeCombo(runes);
  const key = comboKey(combo);
  const setMatch = combo.length > 0 ? setList.find((row) => comboKey(luckCombo(row)) === key) ?? null : null;
  const setTop = setList[0] ?? null;
  const setPickrate = setMatch?.pickrate ?? 0;
  const setOk = !!setMatch && setPickrate >= 0.05;

  // 主屬性（2 / 4 / 6）
  const bySlot = new Map(runes.map((r) => [r.slot, r]));
  const mainIds = MAIN_SLOTS.map((slot) => bySlot.get(slot)?.main.t ?? 0);
  const complete = runes.length >= 6;
  const mainKey = mainIds.join("-");
  const mainMatch =
    complete ? slotList.find((row) => [row.slot_two, row.slot_four, row.slot_six].join("-") === mainKey) ?? null : null;
  const mainTop = slotList[0] ?? null;
  const mainPickrate = mainMatch?.pickrate ?? 0;
  const mainOk = complete && !!mainMatch && mainPickrate >= 0.05;

  // 神器：屬性神器比 artifact_type、類型神器比 artifact_arch
  const typeMap = new Map((stats.artifact_type ?? []).map((e) => [e.effect_id, e]));
  const archMap = new Map((stats.artifact_arch ?? []).map((e) => [e.effect_id, e]));
  const checks: ArtifactCheck[] = [];
  for (const art of artifacts) {
    const table = art.type === 2 ? archMap : typeMap;
    for (const sub of art.subs) {
      const hit = table.get(sub.t);
      const pickrate = hit ? hit.pickrate : null;
      checks.push({
        artifactId: art.id,
        effectId: sub.t,
        label: artifactSubText(sub),
        pickrate,
        ok: pickrate != null && pickrate >= 0.01,
      });
    }
  }
  const artifactTotal = checks.length;
  const artifactGood = checks.filter((c) => c.ok).length;
  const artifactOk = artifactTotal === 0 || artifactGood === artifactTotal;

  // 樣本太少的魔靈官方不提供套裝 / 主屬統計，只能看神器
  const insufficient = setList.length === 0 && slotList.length === 0;

  // 警告
  const warnings: string[] = [];
  if (runes.length === 0) {
    warnings.push("這隻魔靈沒有 RTA 符文配置");
  } else if (runes.length < 6) {
    warnings.push(`RTA 符文只裝了 ${runes.length}/6 顆`);
  }
  if (setTop) {
    if (!setMatch) {
      warnings.push(`套裝「${comboText(combo)}」不是 Guardian 3 熱門組合（最常見：${luckComboText(setTop)}，${(setTop.pickrate * 100).toFixed(1)}%）`);
    } else if (!setOk) {
      warnings.push(`套裝「${comboText(combo)}」只有 ${(setPickrate * 100).toFixed(1)}% 玩家使用（最常見：${luckComboText(setTop)}）`);
    }
  }
  if (mainTop && complete) {
    if (!mainMatch) {
      warnings.push(`主屬性 ${mainLabelOf(mainIds)} 不是 Guardian 3 熱門（最常見：${mainLabelOf([mainTop.slot_two, mainTop.slot_four, mainTop.slot_six])}，${(mainTop.pickrate * 100).toFixed(1)}%）`);
    } else if (!mainOk) {
      warnings.push(`主屬性 ${mainLabelOf(mainIds)} 只有 ${(mainPickrate * 100).toFixed(1)}% 玩家使用`);
    }
  }
  const seen = new Set<number>();
  for (const c of checks) {
    if (c.ok || seen.has(c.effectId)) continue;
    seen.add(c.effectId);
    warnings.push(
      c.pickrate == null
        ? `神器效果「${c.label}」在 Guardian 3 資料中沒有出現`
        : `神器效果「${c.label}」只有 ${(c.pickrate * 100).toFixed(1)}% 玩家使用`,
    );
  }

  // 符合度：套裝 / 主屬 / 神器各 1/3
  const setScore = setOk ? Math.min(1, setPickrate / 0.5) : 0;
  const mainScore = mainOk ? Math.min(1, mainPickrate / 0.4) : 0;
  const artScore = artifactTotal === 0 ? 1 : artifactGood / artifactTotal;
  const score = insufficient ? 0 : Math.round(((setScore + mainScore + artScore) / 3) * 100);

  return {
    combo,
    comboLabel: comboText(combo),
    setMatch,
    setTop,
    setPickrate,
    setOk,
    mainIds,
    mainLabel: mainLabelOf(mainIds),
    mainMatch,
    mainTop,
    mainPickrate,
    mainOk,
    artifacts: checks,
    artifactTotal,
    artifactGood,
    artifactOk,
    insufficient,
    score,
    warnings,
  };
}

/** 主屬性列的文字，例如「速度 / 暴擊傷害 / 體力%」 */
export function slotStatText(row: LuckSlotStat): string {
  return mainLabelOf([row.slot_two, row.slot_four, row.slot_six]);
}
