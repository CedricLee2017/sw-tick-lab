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
  hp: 1, "hp%": 2, atk: 3, "atk%": 4, def: 5, "def%": 6,
  spd: 8, speed: 8, cr: 9, crate: 9, critrate: 9, "crit rate": 9,
  cd: 10, cdmg: 10, critdmg: 10, "crit dmg": 10, "crit damage": 10,
  res: 11, resistance: 11, acc: 12, accuracy: 12,
};

/** 屬性 type：數字 id、或 SWOP 常見的英文字串（對應 sw-exporter mapping.js） */
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

function subs(v: unknown, grindFirst = false): Rune["subs"] {
  return list(v)
    .map((s) => {
      if (Array.isArray(s)) {
        // 兩種匯出格式的欄位順序不同：
        //   SWEX / 遊戲原始：[屬性, 數值, 寶石(0/1), 精煉值]
        //   SWOP / 舊版匯出：[屬性, 數值, 精煉值, 寶石]
        // 由 parseAccountJSON 依整份檔案的數值分佈判斷後傳入 grindFirst。
        const a = num(s[2]);
        const b = num(s[3]);
        return grindFirst
          ? { t: typeOf(s[0]), v: num(s[1]), g: a, gem: b }
          : { t: typeOf(s[0]), v: num(s[1]), gem: a, g: b };
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

/** 解析規則版本：SWEX v1.1.0 的 stat/set ID、裝備符文合併、遠古星級、精煉值 */
export const PARSE_VERSION = 3;

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

  // SWEX v1.1.0 的裝備中符文只會出現在 unit_list[].runes（top-level 只有未裝備符文），
  // 因此兩邊都要收集，並以 rune_id 去重。owner 用來補上 occupied_id（部分格式為 0）。
  const runeSources: { r: any; owner: number }[] = [];
  for (const r of rawRunes) runeSources.push({ r, owner: 0 });
  let nestedRunes = 0;
  for (const u of rawUnits) {
    if (!u || typeof u !== "object") continue;
    const uid = num(u.unit_id ?? u.id);
    for (const r of list(u.runes)) {
      if (!r || typeof r !== "object") continue;
      if (!num(r.rune_id ?? r.id)) continue;
      runeSources.push({ r, owner: uid });
      nestedRunes++;
    }
  }
  if (runeSources.length === 0) {
    return { account: null, error: "找不到 runes（符文清單），這個檔案可能不完整。", warnings };
  }

  // 判斷 sec_eff 的精煉欄位在第 3 欄（SWOP 舊格式）還是第 4 欄（SWEX 原始格式）。
  // 寶石標記只會是 0/1，因此「大於 1 的值」出現在哪一欄就是精煉值。
  let thirdBig = 0;
  let fourthBig = 0;
  for (const { r } of runeSources) {
    for (const s of list(r.sec_eff ?? r.subs ?? r.substats)) {
      if (!Array.isArray(s)) continue;
      if (num(s[2]) > 1) thirdBig++;
      if (num(s[3]) > 1) fourthBig++;
    }
  }
  const grindFirst = thirdBig > fourthBig;

  const runes: Rune[] = [];
  const idToRune = new Map<number, Rune>();
  const seenIds = new Set<number>();
  const unknownSets = new Set<number>();
  let skippedRunes = 0;
  let duplicateRunes = 0;
  for (const { r, owner } of runeSources) {
    if (!r) continue;
    const set = setOf(r.set_id ?? r.set ?? r.setName ?? r.set_name);
    const slot = num(r.slot_no ?? r.slot);
    if (!set || !slot) {
      skippedRunes++;
      continue;
    }
    let id = num(r.rune_id ?? r.id);
    if (!id) id = -(runes.length + skippedRunes + 1);
    if (id > 0 && seenIds.has(id)) {
      duplicateRunes++;
      const existing = idToRune.get(id);
      if (existing && owner && !existing.occupied) existing.occupied = owner;
      continue;
    }
    if (id > 0) seenIds.add(id);
    if (!SET_BY_ID[set]) unknownSets.add(set);
    // 遠古符文：class / rank 會 +10（例如 class 16 = 遠古 6★、rank 15 = 遠古傳說）
    const rawClass = num(r.class ?? r.stars ?? r.grade, 6);
    const rawRank = num(r.rank, 0);
    const ancient = truthy(r.ancient) || rawClass > 10 || rawRank > 10;
    const grade = Math.min(6, Math.max(1, rawClass > 10 ? rawClass - 10 : rawClass));
    const rune: Rune = {
      id,
      set,
      slot,
      grade,
      level: Math.min(15, Math.max(0, num(r.upgrade_curr ?? r.level, 0))),
      main: pair(r.pri_eff ?? r.main ?? r.mainStat),
      prefix: pair(r.prefix_eff ?? r.prefix),
      subs: subs(r.sec_eff ?? r.subs ?? r.substats, grindFirst),
      occupied: num(r.occupied_id ?? r.occupied ?? r.equippedBy ?? r.equipped_by) || owner,
      ancient,
      locked: truthy(r.locked),
      eff: 0,
      effMax: 100,
    };
    rune.eff = runeEfficiency(rune, true).current;
    runes.push(rune);
    if (id > 0) idToRune.set(id, rune);
  }

  if (nestedRunes > 0) {
    // 只作為除錯資訊，不影響使用
    warnings.push(`已從魔靈身上補齊裝備中的符文 ${nestedRunes} 顆（總計 ${runes.length} 顆）。`);
  }
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

  const rawBuildings = list(body.building_list ?? body.buildings).filter(
    (b: any) => b && typeof b === "object" && num(b.building_master_id ?? b.master_id ?? b.id) > 0,
  );
  // SWEX v1.1.0 的 building_list 只有位置，沒有等級；此時不可把圖騰加成覆蓋成 0%。
  const levelsKnown = rawBuildings.some(
    (b: any) => b.building_level !== undefined || b.level !== undefined,
  );
  const buildings = levelsKnown
    ? rawBuildings
        .map((b: any) => ({
          id: num(b.building_master_id ?? b.master_id ?? b.id),
          level: num(b.building_level ?? b.level),
        }))
        .filter((b: any) => b.id > 0)
    : [];

  if (skippedUnits > 0) warnings.push(`略過 ${skippedUnits} 筆缺少 unit_master_id 的魔靈資料。`);
  if (units.length === 0) warnings.push("檔案中沒有任何魔靈。");
  if (rawBuildings.length > 0 && !levelsKnown) {
    warnings.push(
      `此匯出檔的 ${rawBuildings.length} 筆建築資料沒有等級欄位，無法自動套用圖騰。` +
        "速度圖騰暫用預設 15%，請到「設定」確認實際等級。",
    );
  } else if (rawBuildings.length === 0) {
    warnings.push("找不到建築資料，速度圖騰預設為 15%。");
  }

  const wizard = body.wizard_info?.wizard_name ?? body.wizard_info?.wizard_id ?? "";
  const version = body.unit_list ? (body.runes?.[0]?.ancient !== undefined ? "SWEX / SWOP" : "SWEX") : "未知";

  return {
    account: {
      fileName,
      importedAt: Date.now(),
      parseVersion: PARSE_VERSION,
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
      sec_eff: r.subs.map((s) => [s.t, s.v, s.gem, s.g]),
      occupied_id: r.occupied,
      ancient: r.ancient ? 1 : 0,
    })),
    building_list: account.buildings.map((b) => ({ building_master_id: b.id, building_level: b.level })),
  });
}
