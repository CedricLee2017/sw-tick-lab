/** SWEX / SWOP JSON 解析（寬容格式） */
import { runeEfficiency } from "./stats";
import type { Account, Artifact, Rune, Unit } from "./types";

const num = (v: unknown, d = 0): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return d;
};

function pair(v: unknown): { t: number; v: number } {
  if (Array.isArray(v)) return { t: num(v[0]), v: num(v[1]) };
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return { t: num(o.type ?? o.t), v: num(o.value ?? o.v) };
  }
  return { t: 0, v: 0 };
}

function subs(v: unknown): Rune["subs"] {
  if (!Array.isArray(v)) return [];
  return v
    .map((s) => {
      if (Array.isArray(s)) {
        return { t: num(s[0]), v: num(s[1]), g: num(s[2]), gem: num(s[3]) };
      }
      if (s && typeof s === "object") {
        const o = s as Record<string, unknown>;
        return {
          t: num(o.type ?? o.t),
          v: num(o.value ?? o.v),
          g: num(o.grind ?? o.g),
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

  // 允許 { data: {...} } 或 { account: {...} } 包一層
  const candidates = [root, root?.data, root?.account, root?.player].filter(Boolean);
  const body = candidates.find((c) => Array.isArray(c.unit_list) || Array.isArray(c.monsters));
  if (!body) {
    return {
      account: null,
      error: "找不到 unit_list（魔靈清單）。請使用 SWEX / SWOP 匯出的 .json 檔案。",
      warnings,
    };
  }

  const rawUnits: any[] = body.unit_list ?? body.monsters ?? [];
  const rawRunes: any[] = body.runes ?? body.rune_list ?? [];
  if (!Array.isArray(rawRunes) || rawRunes.length === 0) {
    return { account: null, error: "找不到 runes（符文清單），這個檔案可能不完整。", warnings };
  }

  const runes: Rune[] = [];
  for (const r of rawRunes) {
    if (!r) continue;
    const set = num(r.set_id ?? r.set);
    const slot = num(r.slot_no ?? r.slot);
    if (!set || !slot) continue;
    const grade = Math.min(6, Math.max(1, num(r.class ?? r.grade, 6)));
    const rune: Rune = {
      id: num(r.rune_id ?? r.id),
      set,
      slot,
      grade,
      level: Math.min(15, Math.max(0, num(r.upgrade_curr ?? r.level, 0))),
      main: pair(r.pri_eff ?? r.main),
      prefix: pair(r.prefix_eff ?? r.prefix),
      subs: subs(r.sec_eff ?? r.subs),
      occupied: num(r.occupied_id ?? r.occupied),
      ancient: !!num(r.ancient),
      locked: !!num(r.locked),
      eff: 0,
      effMax: 100,
    };
    rune.eff = runeEfficiency(rune).current;
    runes.push(rune);
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
  for (const u of rawUnits) {
    if (!u) continue;
    const id = num(u.unit_id ?? u.id);
    const master = num(u.unit_master_id ?? u.master_id);
    if (!master) continue;
    let unitRunes: number[] = Array.isArray(u.rune_ids)
      ? u.rune_ids.map((x: unknown) => num(x)).filter(Boolean)
      : Array.isArray(u.runes)
        ? u.runes.map((x: any) => num(x?.rune_id ?? x?.id ?? x)).filter(Boolean)
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
      stars: Math.min(6, Math.max(1, num(u.class ?? u.stars, 6))),
      level: num(u.unit_level ?? u.level, 40),
      runes: unitRunes.slice(0, 6),
      artifacts: (u.artifacts ?? []).map((a: any) => num(a?.rid ?? a?.artifact_id ?? a)).filter(Boolean),
      locked: !!num(u.locked),
    });
  }

  const rawArtifacts: any[] = body.artifacts ?? body.artifact_list ?? [];
  const artifacts: Artifact[] = rawArtifacts.map((a: any) => ({
    id: num(a.rid ?? a.artifact_id ?? a.id),
    type: num(a.type ?? a.artifact_type, 1),
    attr: num(a.attribute ?? a.attr),
    occupied: num(a.occupied_id ?? a.occupied),
    main: pair(a.pri_eff ?? a.main),
    subs: Array.isArray(a.sec_eff)
      ? a.sec_eff.map((s: any) => (Array.isArray(s) ? { t: num(s[0]), v: num(s[1]) } : { t: num(s?.type), v: num(s?.value) }))
      : [],
    level: Math.min(15, num(a.level, 0)),
  }));

  const buildings = (body.building_list ?? body.buildings ?? [])
    .map((b: any) => ({
      id: num(b.building_master_id ?? b.id),
      level: num(b.building_level ?? b.level),
    }))
    .filter((b: any) => b.id > 0);

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
