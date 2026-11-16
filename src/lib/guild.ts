/** 公會資料：解析 SWEX 公會相關 API（隊友防守隊伍 / 公會測試隊伍）並比較成員的符文與神器 */
import { del, get, set } from "idb-keyval";
import { MONSTER_MAP } from "../store";
import { parseArtifact, parseRune } from "./parse";
import { baseStats, defaultBonus, runeEfficiency, statsForRunes } from "./stats";
import type { Artifact, Rune, Stats } from "./types";

export type GuildDeckSource = "test" | "siege";

export interface GuildUnit {
  /** wizard:deck:unit */
  key: string;
  unitId: number;
  master: number;
  stars: number;
  level: number;
  wizardId: number;
  deckId: number;
  source: GuildDeckSource;
  runes: Rune[];
  artifacts: Artifact[];
}

export interface GuildDeck {
  id: number;
  source: GuildDeckSource;
  desc?: string;
  units: GuildUnit[];
}

export interface GuildMember {
  wizardId: number;
  name: string;
  decks: GuildDeck[];
}

export interface GuildData {
  importedAt: number;
  /** 匯入的檔案名稱（方便辨認這次資料從哪來） */
  files: string[];
  members: GuildMember[];
}

export interface GuildParseResult {
  data: GuildData;
  warnings: string[];
  /** 解析到的 block 數（除錯用） */
  blocks: number;
}

const GUILD_KEY = "swtick:guild";

const asArray = <T,>(v: unknown): T[] => {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === "object") return Object.values(v as Record<string, T>);
  return [];
};

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** 公會成員的數值只算符文 / 套裝 / 神器（不含建築與隊長技，才能互相比較） */
const GUILD_BONUS = defaultBonus({
  towerSpd: 0,
  towerAtk: 0,
  towerHp: 0,
  towerDef: 0,
  towerCd: 0,
  elementAtk: 0,
  guildAtk: 0,
  guildHp: 0,
  guildDef: 0,
  guildCd: 0,
  useGuild: false,
  useElementTower: false,
  grind: true,
});

/** 魔靈面板（符文 + 套裝 + 神器，含精煉） */
export function guildUnitStats(unit: GuildUnit): Stats | null {
  const monster = MONSTER_MAP.get(unit.master);
  if (!monster) return null;
  const base = baseStats(monster, unit.stars, unit.level);
  return statsForRunes(base, unit.runes, GUILD_BONUS, false, false, unit.artifacts);
}

/** 這隻魔靈的符文平均效率 */
export function guildUnitEff(unit: GuildUnit): number {
  if (unit.runes.length === 0) return 0;
  return unit.runes.reduce((s, r) => s + runeEfficiency(r, true).current, 0) / unit.runes.length;
}

/** 把各種可能的 JSON 形狀攤平成 { command, response } 清單 */
function collectBlocks(node: unknown, out: { command: string; response: any }[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectBlocks(item, out);
    return;
  }
  const o = node as Record<string, any>;
  if (Array.isArray(o.blocks)) {
    collectBlocks(o.blocks, out);
    return;
  }
  if (o.command && (o.response || o.request)) {
    out.push({ command: String(o.command), response: o.response ?? o });
    return;
  }
  if (o.response && typeof o.response === "object") {
    out.push({ command: "", response: o.response });
    return;
  }
  out.push({ command: "", response: o });
}

interface DeckDraft {
  id: number;
  source: GuildDeckSource;
  desc?: string;
  units: Map<number, GuildUnit>;
}

function makeUnit(
  raw: any,
  wizardId: number,
  deckId: number,
  source: GuildDeckSource,
): GuildUnit | null {
  const unitId = num(raw?.unit_id ?? raw?.id);
  const master = num(raw?.unit_master_id ?? raw?.master ?? raw?.unit_master);
  if (!unitId || !master) return null;
  const runes = asArray<any>(raw.runes)
    .map((r) => parseRune(r, unitId))
    .filter((r): r is Rune => !!r);
  const artifacts = asArray<any>(raw.artifacts).map((a) => parseArtifact(a, unitId));
  return {
    key: `${wizardId}:${deckId}:${unitId}`,
    unitId,
    master,
    stars: Math.min(6, Math.max(1, num(raw.class ?? raw.stars) || 6)),
    level: Math.min(40, Math.max(1, num(raw.unit_level ?? raw.level) || 40)),
    wizardId,
    deckId,
    source,
    runes,
    artifacts,
  };
}

/**
 * 解析公會資料。可接受：
 *  - SWEX FullLogger 拆出來的 `{ command, request, response }`
 *  - 多個 block 的陣列
 *  - `{ blocks: [...] }`（extract-guild 腳本產生的格式）
 *  - 直接貼上的 response
 */
export function parseGuildData(
  inputs: { name: string; text: string }[],
  importedAt = Date.now(),
): GuildParseResult {
  const names = new Map<number, string>();
  const decks = new Map<string, DeckDraft>();
  const warnings: string[] = [];
  let blocks = 0;

  const upsertDeck = (id: number, source: GuildDeckSource, desc?: string): DeckDraft | null => {
    if (!id) return null;
    const key = `${source}:${id}`;
    let draft = decks.get(key);
    if (!draft) {
      draft = { id, source, desc, units: new Map() };
      decks.set(key, draft);
    } else if (!draft.desc && desc) {
      draft.desc = desc;
    }
    return draft;
  };

  for (const input of inputs) {
    let root: unknown;
    try {
      root = JSON.parse(input.text.replace(/^\uFEFF/, ""));
    } catch {
      warnings.push(`${input.name}：不是有效的 JSON，已略過`);
      continue;
    }
    const list: { command: string; response: any }[] = [];
    collectBlocks(root, list);
    blocks += list.length;

    for (const { response } of list) {
      const r = response;
      if (!r || typeof r !== "object") continue;

      // 成員名稱：對戰資訊 / 測試隊伍清單 / 隊伍詳情都會帶
      for (const w of asArray<any>(r.wizard_info_list)) {
        const id = num(w?.wizard_id);
        if (id) names.set(id, String(w?.wizard_name ?? names.get(id) ?? ""));
      }
      for (const w of asArray<any>(r.member_info_list)) {
        const id = num(w?.wizard_id);
        if (id) names.set(id, String(w?.wizard_name ?? names.get(id) ?? ""));
      }
      for (const d of asArray<any>(r.deck_list)) {
        const id = num(d?.wizard_id);
        if (id && d?.wizard_name) names.set(id, String(d.wizard_name));
      }

      // 公會測試隊伍：一隊一隊的完整資料（有符文與神器）
      const info = r.deck_info;
      if (info && Array.isArray(r.deck_unit_info)) {
        const wizardId = num(info.wizard_id);
        const deckId = num(info.deck_id ?? info.deck_number);
        if (wizardId && deckId) {
          if (info.wizard_name) names.set(wizardId, String(info.wizard_name));
          const draft = upsertDeck(deckId, "test", info.desc ? String(info.desc) : undefined);
          if (draft) {
            for (const raw of r.deck_unit_info) {
              const unit = makeUnit(raw, wizardId, deckId, "test");
              if (unit) draft.units.set(unit.unitId, unit);
            }
          }
        }
      }

      // 據點戰：公會隊友的防守隊伍
      if (r.defense_deck_list && typeof r.defense_deck_list === "object") {
        for (const deck of asArray<any>(r.defense_deck_list)) {
          const deckId = num(deck?.deck_id);
          const units = asArray<any>(deck?.target_unit_info ?? deck?.unit_info);
          const wizardId = num(units[0]?.wizard_id);
          if (!deckId || !wizardId) continue;
          const draft = upsertDeck(deckId, "siege", `據點戰防守（#${wizardId}）`);
          if (!draft) continue;
          for (const raw of units) {
            const unit = makeUnit(raw, num(raw?.wizard_id) || wizardId, deckId, "siege");
            if (unit) draft.units.set(unit.unitId, unit);
          }
        }
      }
    }
  }

  // 組成成員 → 隊伍 → 魔靈
  const byMember = new Map<number, GuildMember>();
  for (const draft of decks.values()) {
    if (draft.units.size === 0) continue;
    const units = [...draft.units.values()];
    for (const unit of units) {
      let member = byMember.get(unit.wizardId);
      if (!member) {
        member = { wizardId: unit.wizardId, name: names.get(unit.wizardId) || `#${unit.wizardId}`, decks: [] };
        byMember.set(unit.wizardId, member);
      }
      let deck = member.decks.find((d) => d.id === draft.id);
      if (!deck) {
        deck = { id: draft.id, source: draft.source, desc: draft.desc, units: [] };
        member.decks.push(deck);
      }
      deck.units.push(unit);
    }
  }

  const members = [...byMember.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-TW"));
  if (members.length === 0) {
    warnings.push(
      "沒有解析到任何成員資料。請匯入含 GetGuildTestDeckDetail（公會測試隊伍）或 GetGuildSiegeDefenseDeckListAlly（隊友防守）的 JSON。",
    );
  }
  const noName = members.filter((m) => m.name.startsWith("#"));
  if (noName.length > 0) {
    warnings.push(`有 ${noName.length} 位成員沒有名稱（只匯入隊伍詳情時常見），會顯示 wizard id。`);
  }

  return {
    data: { importedAt, files: inputs.map((i) => i.name), members },
    warnings,
    blocks,
  };
}

// ── 本機儲存（放在 IndexedDB，跟帳號存檔分開） ─────────────

export async function loadGuildData(): Promise<GuildData | null> {
  try {
    const data = await get<GuildData>(GUILD_KEY);
    return data && Array.isArray(data.members) ? data : null;
  } catch {
    return null;
  }
}

export async function saveGuildData(data: GuildData): Promise<void> {
  await set(GUILD_KEY, data);
}

export async function clearGuildData(): Promise<void> {
  await del(GUILD_KEY);
}

// ── 統計與比較 ───────────────────────────────────────────

export interface GuildUnitRow {
  member: GuildMember;
  deck: GuildDeck;
  unit: GuildUnit;
  stats: Stats | null;
  eff: number;
}

/** 攤平成「成員 × 魔靈」的清單，方便排序與比較 */
export function guildUnitRows(data: GuildData | null): GuildUnitRow[] {
  if (!data) return [];
  const rows: GuildUnitRow[] = [];
  for (const member of data.members) {
    for (const deck of member.decks) {
      for (const unit of deck.units) {
        rows.push({ member, deck, unit, stats: guildUnitStats(unit), eff: guildUnitEff(unit) });
      }
    }
  }
  return rows;
}

/** 同魔靈比較用：只留下有 2 位以上成員使用的魔靈（同一位成員的重複裝備只算一次） */
export function compareGroups(rows: GuildUnitRow[]): { master: number; rows: GuildUnitRow[] }[] {
  const byMaster = new Map<number, GuildUnitRow[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    const dedupeKey = `${row.member.wizardId}:${row.unit.unitId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const list = byMaster.get(row.unit.master);
    if (list) list.push(row);
    else byMaster.set(row.unit.master, [row]);
  }
  return [...byMaster.entries()]
    .map(([master, list]) => ({ master, rows: list }))
    .filter((g) => new Set(g.rows.map((r) => r.member.wizardId)).size >= 2)
    .sort((a, b) => b.rows.length - a.rows.length);
}

/** 成員摘要：隊伍數、魔靈數、最快速度、平均效率 */
export interface GuildMemberSummary {
  member: GuildMember;
  decks: number;
  units: number;
  artifacts: number;
  fastest: number;
  avgEff: number;
}

export function guildMemberSummaries(rows: GuildUnitRow[]): GuildMemberSummary[] {
  const map = new Map<number, GuildMemberSummary>();
  for (const row of rows) {
    let s = map.get(row.member.wizardId);
    if (!s) {
      s = { member: row.member, decks: 0, units: 0, artifacts: 0, fastest: 0, avgEff: 0 };
      map.set(row.member.wizardId, s);
    }
    s.units++;
    s.artifacts += row.unit.artifacts.length;
    s.fastest = Math.max(s.fastest, row.stats?.spd ?? 0);
    s.avgEff += row.eff;
  }
  for (const s of map.values()) {
    s.decks = s.member.decks.length;
    s.avgEff = s.units > 0 ? s.avgEff / s.units : 0;
  }
  return [...map.values()].sort((a, b) => b.fastest - a.fastest || a.member.name.localeCompare(b.member.name, "zh-TW"));
}
