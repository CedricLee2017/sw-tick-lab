/** SWEX / SWOP JSON 解析（寬容格式） */
import { runeEfficiency } from "./stats";
import { RUNE_SETS, SET_BY_ID } from "./constants";
import type { Account, Artifact, ArtifactSub, Deck, DeckEquip, Rune, RtaData, RtaLoadout, SummonRecord, Unit } from "./types";

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

/** 神器主效果：SWEX 原始格式是陣列，部分備份格式是 "102 100 15 0 0" 字串 */
function artifactMain(v: unknown): { t: number; v: number } {
  if (typeof v === "string") {
    const parts = v.trim().split(/\s+/);
    return { t: num(parts[0]), v: num(parts[1]) };
  }
  return pair(v);
}

function artifactSubs(v: unknown): ArtifactSub[] {
  return list(v)
    .map((s): ArtifactSub => {
      if (Array.isArray(s)) {
        // [效果 id, 數值, 強化次數, 轉換次數, 未知欄位]
        return { t: num(s[0]), v: num(s[1]), up: num(s[2]), roll: num(s[3]), extra: num(s[4]) };
      }
      if (s && typeof s === "object") {
        const o = s as Record<string, unknown>;
        return {
          t: num(o.type ?? o.t ?? o.effect ?? o.effect_id),
          v: num(o.value ?? o.v ?? o.val),
          up: num(o.upgrade ?? o.up ?? o.upgrade_count),
          roll: num(o.reroll ?? o.roll ?? o.reroll_count),
        };
      }
      return { t: 0, v: 0 };
    })
    .filter((s) => s.t > 0);
}

/** 預設隊 / 防守隊的裝備快照 */
function deckEquip(v: unknown): DeckEquip[] {
  return list(v)
    .map((e: any): DeckEquip => ({
      unit: num(e?.unit_id ?? e?.unit),
      runes: list(e?.rune_id_list ?? e?.runes).map((x: unknown) => num(x)).filter(Boolean),
      artifacts: list(e?.artifact_id_list ?? e?.artifacts).map((x: unknown) => num(x)).filter(Boolean),
    }))
    .filter((e: DeckEquip) => e.unit > 0);
}

function artifactOf(a: any, owner = 0): Artifact {
  return {
    id: num(a.rid ?? a.artifact_id ?? a.id),
    type: num(a.type ?? a.artifact_type, 1),
    attr: num(a.attribute ?? a.attr),
    style: num(a.unit_style ?? a.style),
    occupied: num(a.occupied_id ?? a.occupied) || owner,
    main: artifactMain(a.pri_effect ?? a.pri_eff ?? a.main),
    subs: artifactSubs(a.sec_effects ?? a.sec_eff ?? a.subs),
    level: Math.min(15, Math.max(0, num(a.level ?? a.upgrade_curr, 0))),
    rank: num(a.rank, 0),
    stars: num(a.natural_rank ?? a.class, 5),
    locked: truthy(a.locked),
  };
}


export interface ParseResult {
  account: Account | null;
  error?: string;
  warnings: string[];
}

/** 解析規則版本：SWEX v1.1.0 的 stat/set ID、裝備符文合併、遠古星級、精煉值、取得時間軸 */
export const PARSE_VERSION = 8;

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

  // 神器：頂層 artifacts 只有未裝備的（occupied_id = 0）；已裝備的只會出現在 unit.artifacts。
  // 兩邊以 rid 合併，並以 unit.artifacts 內的 owner 為準。
  const artifactMap = new Map<number, Artifact>();
  const nestedArtifactOwner = new Map<number, number>();
  let nestedArtifacts = 0;
  let duplicateArtifacts = 0;
  for (const a of list(body.artifacts ?? body.artifact_list)) {
    if (!a || typeof a !== "object") continue;
    const art = artifactOf(a);
    if (!art.id) continue;
    if (artifactMap.has(art.id)) duplicateArtifacts++;
    artifactMap.set(art.id, art);
  }
  for (const u of rawUnits) {
    if (!u || typeof u !== "object") continue;
    const uid = num(u.unit_id ?? u.id);
    for (const a of list(u.artifacts ?? u.artifact_ids)) {
      const aid = typeof a === "object" ? num(a?.rid ?? a?.artifact_id ?? a?.id) : num(a);
      if (!aid) continue;
      nestedArtifacts++;
      if (uid) nestedArtifactOwner.set(aid, uid);
      if (a && typeof a === "object") {
        const art = artifactOf(a, uid);
        if (art.id) artifactMap.set(art.id, art);
      }
    }
  }
  for (const [aid, uid] of nestedArtifactOwner) {
    const art = artifactMap.get(aid);
    if (art && !art.occupied) art.occupied = uid;
  }
  const artifacts = [...artifactMap.values()];
  const artifactOccupied = new Map<number, number[]>();
  for (const a of artifacts) {
    if (a.occupied > 0) {
      const arr = artifactOccupied.get(a.occupied) ?? [];
      arr.push(a.id);
      artifactOccupied.set(a.occupied, arr);
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

    const nestedIds = list(u.artifacts ?? u.artifact_ids)
      .map((a: any) => num(a?.rid ?? a?.artifact_id ?? a))
      .filter(Boolean);
    const unitArtifacts = [...new Set([...nestedIds, ...(artifactOccupied.get(id) ?? [])])]
      .filter((aid) => artifactMap.has(aid))
      .slice(0, 2);

    units.push({
      id,
      master,
      stars: Math.min(6, Math.max(1, num(u.class ?? u.stars ?? u.star, 6))),
      level: num(u.unit_level ?? u.level, 40),
      runes: unitRunes.slice(0, 6),
      artifacts: unitArtifacts,
      locked: truthy(u.locked),
    });
  }

  // 魔靈取得時間軸：Unit 只保留最終狀態，但每隻魔靈都有 create_time。
  // 一般魔靈在 unit_list，背包 / 保管箱的在另外的清單，兩邊都要收。
  const summons: SummonRecord[] = [];
  const summonSeen = new Set<number>();
  const summonSources = [
    ...rawUnits,
    ...list(body.unit_storage_normal_list),
    ...list(body.unit_storage_awaken_list),
    ...list(body.unit_depository_list),
  ];
  for (const u of summonSources) {
    if (!u || typeof u !== "object") continue;
    const unitId = num(u.unit_id ?? u.id);
    const master = num(u.unit_master_id ?? u.master_id ?? u.masterId);
    let createdAt = "";
    if (typeof u.create_time === "string") createdAt = u.create_time.trim();
    else if (num(u.create_time) > 0) {
      // 數字 timestamp 已經是絕對時間，保留 Z 讓顯示端不再套用伺服器時區。
      createdAt = new Date(num(u.create_time) * 1000).toISOString();
    }
    if (!master || !/^\d{4}-\d{2}-\d{2}/.test(createdAt)) continue;
    if (unitId && summonSeen.has(unitId)) continue;
    if (unitId) summonSeen.add(unitId);
    summons.push({
      unitId,
      master,
      stars: Math.min(6, Math.max(1, num(u.class ?? u.stars ?? u.star, 6))),
      level: num(u.unit_level ?? u.level, 1),
      createdAt,
      source: num(u.source),
    });
  }
  summons.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (summons.length > 0) {
    warnings.push(`魔靈取得記錄：${summons.length} 筆（含背包 / 保管箱）。`);
  }

  if (nestedArtifacts > 0) {
    const equipped = artifacts.filter((a) => a.occupied > 0).length;
    warnings.push(`已從魔靈身上補齊裝備中的神器 ${equipped} 件（總計 ${artifacts.length} 件）。`);
  }
  if (duplicateArtifacts > 0) warnings.push(`略過 ${duplicateArtifacts} 件重複 ID 的神器。`);

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

  // RTA（世界競技場）：一般與 RTA 共用符文 / 神器庫，但裝備配置是兩套獨立清單。
  //   world_arena_rune_equip_list      → rune_id / occupied_id
  //   world_arena_artifact_equip_list  → artifact_id / occupied_id
  // favorite_unit_list type 1        → 我的最愛魔靈
  const favoriteGroups = list(body.favorite_unit_list);
  const favType1 = favoriteGroups.find((g: any) => num(g?.type) === 1);
  const favorites = [
    ...new Set(
      list(favType1?.unit_id_list)
        .flatMap((x: any) => list(x).map((v: unknown) => num(v)))
        .filter(Boolean),
    ),
  ];
  const rtaLoadouts: Record<number, RtaLoadout> = {};
  let rtaRunes = 0;
  let rtaArtifacts = 0;
  for (const m of list(body.world_arena_rune_equip_list)) {
    const uid = num(m?.occupied_id);
    const rid = num(m?.rune_id);
    if (!uid || !rid) continue;
    (rtaLoadouts[uid] ??= { runes: [], artifacts: [] }).runes.push(rid);
    rtaRunes++;
  }
  for (const m of list(body.world_arena_artifact_equip_list)) {
    const uid = num(m?.occupied_id);
    const aid = num(m?.artifact_id);
    if (!uid || !aid) continue;
    (rtaLoadouts[uid] ??= { runes: [], artifacts: [] }).artifacts.push(aid);
    rtaArtifacts++;
  }
  const rta: RtaData | undefined =
    favorites.length > 0 || rtaRunes > 0 || rtaArtifacts > 0
      ? {
          loadouts: rtaLoadouts,
          favorites: favorites.filter((id) => units.some((u) => u.id === id)),
          runeSync: num(body.world_arena_rune_equip_sync),
        }
      : undefined;
  if (rta) {
    warnings.push(
      `RTA：最愛 ${rta.favorites.length} 隻、RTA 符文 ${rtaRunes} 顆、RTA 神器 ${rtaArtifacts} 件。`,
    );
    if (rta.favorites.length > 0 && rtaRunes === 0) warnings.push("此存檔有最愛魔靈，但沒有 RTA 符文配置資料。");
  }

  // 預設隊（deck_list）：遊戲內各內容的隊伍快照；equip 內含每隻魔靈的符文 / 神器配置。
  const decks: Deck[] = list(body.deck_list)
    .map((d: any): Deck => ({
      type: num(d?.deck_type),
      seq: num(d?.deck_seq),
      units: list(d?.unit_id_list).map((x: unknown) => num(x)).filter(Boolean),
      leader: num(d?.leader_unit_id),
      equip: deckEquip(d?.equip),
    }))
    .filter((d: Deck) => d.type > 0);
  if (decks.length > 0) warnings.push(`預設隊：找到 ${decks.length} 組。`);

  // 專為防守而設的隊伍：
  //   defense_deck_info                 競技場防守（本機）
  //   server_arena_defense_deck_info    競技場防守（伺服器）
  //   guildsiege_defense_deck_*         據點戰防守（多隊）
  const defenseDecks: Deck[] = [];
  const addDefense = (deck: Deck | null) => { if (deck && deck.units.length > 0) defenseDecks.push(deck); };
  const arenaDefense = body.defense_deck_info;
  if (arenaDefense && typeof arenaDefense === "object") {
    addDefense({
      type: 100,
      seq: 1,
      units: list(arenaDefense.unit_id_list).map((x: unknown) => num(x)).filter(Boolean),
      leader: 0,
      equip: deckEquip(arenaDefense.equip),
      battlePower: num(arenaDefense.battle_power),
    });
  }
  const serverArena = body.server_arena_defense_deck_info;
  if (serverArena && typeof serverArena === "object") {
    addDefense({
      type: 101,
      seq: 1,
      units: list(serverArena.unit_id_list)
        .map((x: any) => (x && typeof x === "object" ? num(x.unit_id) : num(x)))
        .filter(Boolean),
      leader: 0,
      equip: deckEquip(serverArena.equip),
    });
  }
  const siegeList = list(body.guildsiege_defense_deck_unit_list);
  const siegeEquip = body.guildsiege_defense_deck_equip_list ?? {};
  siegeList.forEach((d: any, index: number) => {
    const deckId = num(d?.deck_id);
    const eq = deckId ? (siegeEquip[String(deckId)] ?? siegeEquip[deckId]) : undefined;
    addDefense({
      type: 102,
      seq: index + 1,
      units: list(d?.unit_id_list).map((x: unknown) => num(x)).filter(Boolean),
      leader: 0,
      equip: deckEquip(eq?.equip ?? d?.equip),
    });
  });
  if (defenseDecks.length > 0) warnings.push(`防守隊：找到 ${defenseDecks.length} 組。`);

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
      rta,
      decks,
      defenseDecks,
      summons,
    },
    warnings,
  };
}

/** 產生下載用的精簡 JSON（可再次匯入） */
export function exportAccount(account: Account): string {
  const summonMap = new Map((account.summons ?? []).map((s) => [s.unitId, s]));
  const unitIds = new Set(account.units.map((u) => u.id));
  return JSON.stringify({
    format: "sw-tick-lab",
    version: 1,
    exportedAt: new Date().toISOString(),
    unit_list: account.units.map((u) => ({
      unit_id: u.id,
      unit_master_id: u.master,
      class: u.stars,
      unit_level: u.level,
      create_time: summonMap.get(u.id)?.createdAt,
      source: summonMap.get(u.id)?.source,
      rune_ids: u.runes,
      artifact_ids: u.artifacts,
    })),
    // 背包 / 保管箱中的魔靈不在 account.units，另外輸出才能保留取得時間軸。
    unit_storage_normal_list: (account.summons ?? [])
      .filter((s) => !unitIds.has(s.unitId))
      .map((s) => ({
        unit_id: s.unitId,
        unit_master_id: s.master,
        class: s.stars,
        unit_level: s.level,
        create_time: s.createdAt,
        source: s.source,
        rune_ids: [],
        artifacts: [],
      })),
    artifacts: account.artifacts.map((a) => ({
      rid: a.id,
      type: a.type,
      attribute: a.attr,
      unit_style: a.style,
      occupied_id: a.occupied,
      natural_rank: a.stars,
      rank: a.rank,
      level: a.level,
      pri_effect: [a.main.t, a.main.v, a.level, 0, 0],
      sec_effects: a.subs.map((s) => [s.t, s.v, s.up ?? 0, s.roll ?? 0, s.extra ?? 0]),
      locked: a.locked ? 1 : 0,
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
    favorite_unit_list: account.rta
      ? [{ type: 1, unit_id_list: [account.rta.favorites] }]
      : [],
    world_arena_rune_equip_list: account.rta
      ? Object.entries(account.rta.loadouts).flatMap(([uid, l]) =>
          l.runes.map((rune_id) => ({ rune_id, occupied_id: Number(uid) })),
        )
      : [],
    world_arena_artifact_equip_list: account.rta
      ? Object.entries(account.rta.loadouts).flatMap(([uid, l]) =>
          l.artifacts.map((artifact_id) => ({ artifact_id, occupied_id: Number(uid) })),
        )
      : [],
    world_arena_rune_equip_sync: account.rta?.runeSync ?? 0,
    deck_list: (account.decks ?? []).map((d) => ({
      deck_type: d.type,
      deck_seq: d.seq,
      unit_id_list: d.units,
      leader_unit_id: d.leader,
      equip: d.equip.map((e) => ({
        unit_id: e.unit,
        rune_id_list: e.runes,
        artifact_id_list: e.artifacts,
      })),
    })),
  });
}
