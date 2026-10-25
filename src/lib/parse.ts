/** SWEX / SWOP JSON 解析（寬容格式） */
import { runeEfficiency } from "./stats";
import { RUNE_SETS, SET_BY_ID } from "./constants";
import type { Account, Artifact, Rune, Unit } from "./types";

const num = (v: unknown, d = 0): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return d;
};

const truthy = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "1" || v.toLowerCase() === "true";
  return num(v) > 0;
};

/** 清單可以是陣列，也可能是以 id 為 key 的物件（部分存檔格式） */
function list(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") return Object.values(v as Record<string, any>);
  return [];
}

const isList = (v: unknown): boolean => Array.isArray(v) || (!!v && typeof v === "object");

const STAT_NAME: Record<string, number> = {
  hp: 1, "hp%": 2, atk: 3, "atk%": 4, def: 5, "def%": 6, spd: 7, speed: 7,
  cr: 8, crate: 8, critrate: 8, "crit rate": 8, cd: 9, cdmg: 9, critdmg: 9,
  "crit dmg": 9, "crit damage": 9, res: 10, resistance: 10, acc: 11, accuracy: 11,
};

/** 屬性 type：數字 id、或 SWOP 常見的英文字串 */
function typeOf(v: unknown): number {
  const n = num(v);
  if (n) return n;
  if (typeof v === "string") {
    const k = v.trim().toLowerCase().replace(/\s+/g, " ");
    if (STAT_NAME[k]) return STAT_NAME[k];
    if (STAT_NAME[k.replace(/\s/g, "")]) return STAT_NAME[k.replace(/\s/g, "")];
  }
  return 0;
}

/** 套裝：數字 set_id、或英文 / 中文套裝名 */
function setOf(v: unknown): number {
  const n = num(v);
  if (n) return n;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    const found = RUNE_SETS.find(
      (x) => x.en.toLowerCase() === s || x.name === v.trim() || String(x.id) === s,
    );
    if (found) return found.id;
  }
  return 0;
}

/** 在 JSON 內找同時含有魔靈與符文清單的物件（容忍多層包裝） */
function findBody(root: any): any | null {
  const seen = new Set<object>();
  const queue: { node: any; depth: number }[] = [{ node: root, depth: 0 }];
  let unitsOnly: any = null;
  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    const units = node.unit_list ?? node.monsters ?? node.units;
    const runes = node.runes ?? node.rune_list ?? node.runes_list;
    if (isList(units)) {
      if (isList(runes)) return node;
      unitsOnly ??= node;
    }
    if (depth >= 3) continue;
    for (const v of Object.values(node)) {
      if (v && typeof v === "object") queue.push({ node: v, depth: depth + 1 });
    }
  }
  return unitsOnly;
}

function pair(v: unknown): { t: number; v: number } {
  if (Array.isArray(v)) return { t: typeOf(v[0]), v: num(v[1]) };
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return { t: typeOf(o.type ?? o.t ?? o.stat), v: num(o.value ?? o.v ?? o.val) };
  }
  return { t: 0, v: 0 };
}

function subs(v: unknown): Rune["subs"] {
  return list(v)
    .map((s) => {
      if (Array.isArray(s)) {
        return { t: typeOf(s[0]), v: num(s[1]), g: num(s[2]), gem: num(s[3]) };
      }
      if (s && typeof s === "object") {
        const o = s as Record<string, unknown>;
        return {
          t: typeOf(o.type ?? o.t ?? o.stat),
          v: num(o.value ?? o.v ?? o.val),
          g: num(o.grind ?? o.g ?? o.grindValue),
          gem: num(o.gem ?? o.gemstone),
        };
      }
      return { t: 0, v: 0, g: 0, gem: 0 };
    })
    .filter((s) => s.t > 0);
}


export interface ParseResult {
  account: Account | null;
  error?: string;
  warnings: string[];
}

export function parseAccountJSON(text: string, fileName = "account.json"): ParseResult {
  const warnings: string[] = [];
  let root: any;
  try {
    root = JSON.parse(text);
  } catch {
    return { account: null, error: "檔案不是有效的 JSON，請確認是 SWEX / SWOP 匯出的檔案。", warnings };
  }

  // 允許 { data: {...} }、{ account: {...} }、{ save: {...} } 等包一層，或更深層
  const body = findBody(root);
  if (!body) {
    const keys = root && typeof root === "object" ? Object.keys(root).slice(0, 8).join("、") : "";
    return {
      account: null,
      error:
        "找不到魔靈清單（unit_list / monsters / units）。請使用 SWEX / SWOP 匯出的 .json 檔案。" +
        (keys ? `（偵測到的頂層欄位：${keys}）` : ""),
      warnings,
    };
  }

  const rawUnits: any[] = list(body.unit_list ?? body.monsters ?? body.units);
  const rawRunes: any[] = list(body.runes ?? body.rune_list ?? body.runes_list);
  if (rawRunes.length === 0) {
    return { account: null, error: "找不到 runes（符文清單），這個檔案可能不完整。", warnings };
  }

  const runes: Rune[] = [];
  const seenIds = new Set<number>();
  const unknownSets = new Set<number>();
  let skippedRunes = 0;
  let duplicateRunes = 0;
  rawRunes.forEach((r: any, index: number) => {
    if (!r) return;
    const set = setOf(r.set_id ?? r.set ?? r.setName ?? r.set_name);
    const slot = num(r.slot_no ?? r.slot);
    if (!set || !slot) {
      skippedRunes++;
      return;
    }
    let id = num(r.rune_id ?? r.id);
    if (!id) id = -(index + 1);
    if (id > 0 && seenIds.has(id)) {
      duplicateRunes++;
      return;
    }
    if (id > 0) seenIds.add(id);
    if (!SET_BY_ID[set]) unknownSets.add(set);
    const grade = Math.min(6, Math.max(1, num(r.class ?? r.grade ?? r.stars, 6)));
    const rune: Rune = {
      id,
      set,
      slot,
      grade,
      level: Math.min(15, Math.max(0, num(r.upgrade_curr ?? r.level, 0))),
      main: pair(r.pri_eff ?? r.main ?? r.mainStat),
      prefix: pair(r.prefix_eff ?? r.prefix),
      subs: subs(r.sec_eff ?? r.subs ?? r.substats),
      occupied: num(r.occupied_id ?? r.occupied ?? r.equippedBy ?? r.equipped_by),
      ancient: truthy(r.ancient),
      locked: truthy(r.locked),
      eff: 0,
      effMax: 100,
    };
    rune.eff = runeEfficiency(rune).current;
    runes.push(rune);
  });

  if (skippedRunes > 0) warnings.push(`略過 ${skippedRunes} 顆缺少套裝或位置的符文。`);
  if (duplicateRunes > 0) warnings.push(`略過 ${duplicateRunes} 顆重複 ID 的符文。`);
  if (unknownSets.size > 0) {
    warnings.push(
      `未知套裝 ID：${[...unknownSets].slice(0, 8).join("、")}。符文數值仍會計算，但不會套用套裝效果。`,
    );
  }

  const runeMap = new Map(runes.map((r) => [r.id, r]));
  const occupiedMap = new Map<number, number[]>();
  for (const r of runes) {
    if (r.occupied > 0) {
      const arr = occupiedMap.get(r.occupied) ?? [];
      arr.push(r.id);
      occupiedMap.set(r.occupied, arr);
    }
  }

  const units: Unit[] = [];
  let skippedUnits = 0;
  for (const u of rawUnits) {
    if (!u) continue;
    const id = num(u.unit_id ?? u.id);
    const master = num(u.unit_master_id ?? u.master_id ?? u.masterId);
    if (!master) {
      skippedUnits++;
      continue;
    }
    let unitRunes: number[] = isList(u.rune_ids)
      ? list(u.rune_ids).map((x: unknown) => num(x)).filter(Boolean)
      : isList(u.runes)
        ? list(u.runes).map((x: any) => num(x?.rune_id ?? x?.id ?? x)).filter(Boolean)
        : [];
    unitRunes = unitRunes.filter((rid) => runeMap.has(rid));
    // 若沒有 rune_ids，用 occupied_id 反推
    if (unitRunes.length === 0 && occupiedMap.has(id)) unitRunes = occupiedMap.get(id)!;
    // 保底：以 occupied 為準（避免 rune_ids 與實際不符）
    const occ = occupiedMap.get(id);
    if (occ && occ.length > unitRunes.length) unitRunes = occ;

    units.push({
      id,
      master,
      stars: Math.min(6, Math.max(1, num(u.class ?? u.stars ?? u.star, 6))),
      level: num(u.unit_level ?? u.level, 40),
      runes: unitRunes.slice(0, 6),
      artifacts: list(u.artifacts ?? u.artifact_ids).map((a: any) => num(a?.rid ?? a?.artifact_id ?? a)).filter(Boolean),
      locked: truthy(u.locked),
    });
  }

  const rawArtifacts: any[] = list(body.artifacts ?? body.artifact_list);
  const artifacts: Artifact[] = rawArtifacts.map((a: any) => ({
    id: num(a.rid ?? a.artifact_id ?? a.id),
    type: num(a.type ?? a.artifact_type, 1),
    attr: num(a.attribute ?? a.attr),
    occupied: num(a.occupied_id ?? a.occupied),
    main: pair(a.pri_eff ?? a.main),
    subs: list(a.sec_eff)
      .map((s: any) => (Array.isArray(s) ? { t: typeOf(s[0]), v: num(s[1]) } : { t: typeOf(s?.type ?? s?.t), v: num(s?.value ?? s?.v) }))
      .filter((s) => s.t > 0),
    level: Math.min(15, num(a.level, 0)),
  }));

  const buildings = list(body.building_list ?? body.buildings)
    .map((b: any) => ({
      id: num(b.building_master_id ?? b.master_id ?? b.id),
      level: num(b.building_level ?? b.level),
    }))
    .filter((b: any) => b.id > 0);

  if (skippedUnits > 0) warnings.push(`略過 ${skippedUnits} 筆缺少 unit_master_id 的魔靈資料。`);
  if (units.length === 0) warnings.push("檔案中沒有任何魔靈。");
  if (buildings.length === 0) warnings.push("找不到建築資料，速度圖騰預設為 15%。");

  const wizard = body.wizard_info?.wizard_name ?? body.wizard_info?.wizard_id ?? "";
  const version = body.unit_list ? (body.runes?.[0]?.ancient !== undefined ? "SWEX / SWOP" : "SWEX") : "未知";

  return {
    account: {
      fileName,
      importedAt: Date.now(),
      wizard: String(wizard ?? ""),
      units,
      runes,
      artifacts,
      buildings,
      version,
    },
    warnings,
  };
}

/** 產生下載用的精簡 JSON（可再次匯入） */
export function exportAccount(account: Account): string {
  return JSON.stringify({
    format: "sw-tick-lab",
    version: 1,
    exportedAt: new Date().toISOString(),
    unit_list: account.units.map((u) => ({
      unit_id: u.id,
      unit_master_id: u.master,
      class: u.stars,
      unit_level: u.level,
      rune_ids: u.runes,
    })),
    runes: account.runes.map((r) => ({
      rune_id: r.id,
      slot_no: r.slot,
      set_id: r.set,
      class: r.grade,
      upgrade_curr: r.level,
      pri_eff: [r.main.t, r.main.v],
      prefix_eff: [r.prefix.t, r.prefix.v],
      sec_eff: r.subs.map((s) => [s.t, s.v, s.g, s.gem]),
      occupied_id: r.occupied,
      ancient: r.ancient ? 1 : 0,
    })),
    building_list: account.buildings.map((b) => ({ building_master_id: b.id, building_level: b.level })),
  });
}
