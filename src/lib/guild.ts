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
  /** 來自公會名單（member_info_list）的資料；只有隊伍資料時可能沒有 */
  roster?: GuildRosterEntry;
}

/** 公會名單上的一位成員 */
export interface GuildRosterEntry {
  wizardId: number;
  name: string;
  guildId: number;
  level: number;
  /** 遊戲內職位（1 = 會長） */
  grade: number;
  lastLogin?: number;
  join?: number;
}

export interface GuildData {
  importedAt: number;
  /** 匯入的檔案名稱（方便辨認這次資料從哪來） */
  files: string[];
  members: GuildMember[];
  /** 名單上出現的公會（名稱） */
  guilds: { id: number; name: string }[];
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
/** 公會頁會用到的 API；FullLogger 裡沒有這些就代表這次沒抓到公會資料 */
export const GUILD_COMMANDS = [
  "GetGuildTestDeckDetail",
  "GetGuildTestDeckList",
  "GetGuildSiegeDefenseDeckListAlly",
  "GetGuildSiegeMatchupInfo",
];

export interface GuildBlock {
  command: string;
  response: any;
}

/** 把已解析好的 block 組成成員 / 隊伍 / 魔靈 */
function ingestBlocks(
  blocks: GuildBlock[],
  files: string[],
  warnings: string[],
  importedAt: number,
): GuildParseResult {
  const names = new Map<number, string>();
  const decks = new Map<string, DeckDraft>();
  const roster = new Map<number, GuildRosterEntry>();
  const wizards = new Map<number, GuildRosterEntry>();
  const guilds = new Map<number, string>();

  const addRoster = (target: Map<number, GuildRosterEntry>, raw: any, withGrade: boolean) => {
    const wizardId = num(raw?.wizard_id);
    if (!wizardId) return;
    const name = String(raw?.wizard_name ?? "");
    if (name) names.set(wizardId, name);
    const guildId = num(raw?.guild_id);
    if (guildId && raw?.guild_name) guilds.set(guildId, String(raw.guild_name));
    const existing = target.get(wizardId) ?? roster.get(wizardId);
    target.set(wizardId, {
      wizardId,
      name: name || existing?.name || "",
      guildId: guildId || existing?.guildId || 0,
      level: num(raw?.wizard_level) || existing?.level || 0,
      grade: withGrade ? num(raw?.grade) : existing?.grade ?? 0,
      lastLogin: num(raw?.last_login_timestamp) || existing?.lastLogin,
      join: num(raw?.join_timestamp) || existing?.join,
    });
  };

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

  for (const { response } of blocks) {
    const r = response;
    if (!r || typeof r !== "object") continue;

    // 成員名稱：對戰資訊 / 測試隊伍清單 / 隊伍詳情都會帶
    for (const g of asArray<any>(r.guild_list)) {
      const id = num(g?.guild_id);
      if (id && g?.guild_name) guilds.set(id, String(g.guild_name));
    }
    for (const w of asArray<any>(r.member_info_list)) addRoster(roster, w, true);
    for (const w of asArray<any>(r.wizard_info_list)) {
      addRoster(wizards, w, false);
      const id = num(w?.wizard_id);
      if (id && w?.wizard_name) names.set(id, String(w.wizard_name));
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

  // 組成成員 → 隊伍 → 魔靈（名單上的成員即使沒有隊伍也會列出）
  const rosterList = roster.size > 0 ? [...roster.values()] : [...wizards.values()];
  const byMember = new Map<number, GuildMember>();
  const ensure = (wizardId: number): GuildMember => {
    let member = byMember.get(wizardId);
    if (!member) {
      const entry = roster.get(wizardId) ?? wizards.get(wizardId);
      member = {
        wizardId,
        name: names.get(wizardId) || entry?.name || `#${wizardId}`,
        decks: [],
        roster: entry,
      };
      byMember.set(wizardId, member);
    }
    return member;
  };
  for (const entry of rosterList) ensure(entry.wizardId);

  for (const draft of decks.values()) {
    if (draft.units.size === 0) continue;
    for (const unit of draft.units.values()) {
      const member = ensure(unit.wizardId);
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
    data: { importedAt, files, members, guilds: [...guilds].map(([id, name]) => ({ id, name })) },
    warnings,
    blocks: blocks.length,
  };
}

/**
 * 解析公會資料。可接受：
 *  - SWEX FullLogger 拆出來的 `{ command, request, response }`
 *  - 多個 block 的陣列
 *  - `{ blocks: [...] }`（extract-guild 腳本產生的格式）
 *  - 直接貼上的 response
 * `extraBlocks` 是已經解析好的 block（例如直接讀 full_log.txt）。
 */
export function parseGuildData(
  inputs: { name: string; text: string }[],
  importedAt = Date.now(),
  extraBlocks: GuildBlock[] = [],
): GuildParseResult {
  const warnings: string[] = [];
  const blocks: GuildBlock[] = [...extraBlocks];

  for (const input of inputs) {
    let root: unknown;
    try {
      root = JSON.parse(input.text.replace(/^\uFEFF/, ""));
    } catch {
      warnings.push(`${input.name}：不是有效的 JSON，已略過`);
      continue;
    }
    collectBlocks(root, blocks);
  }

  return ingestBlocks(blocks, inputs.map((i) => i.name), warnings, importedAt);
}

/**
 * 逐行解析 SWEX FullLogger 的 `full_log.txt`，只留下公會相關的 block。
 * 邊讀邊解析，不會一次把整份（可達上百 MB）載入記憶體。
 */
export async function readGuildLogFile(
  file: File,
  onProgress?: (readBytes: number, totalBytes: number, found: number) => void,
): Promise<{ blocks: GuildBlock[]; commands: Record<string, number> }> {
  const wanted = new Set(GUILD_COMMANDS);
  const blocks: GuildBlock[] = [];
  const commands: Record<string, number> = {};
  const decoder = new TextDecoder();
  const reader = file.stream().getReader();
  let buf = "";
  let command = "";
  let state = "none";
  let read = 0;

  const handleLine = (line: string) => {
    if (line.startsWith("API Command: ")) {
      command = line.slice("API Command: ".length).split(" - ", 1)[0].trim();
      state = "cmd";
      return;
    }
    if (line.startsWith("Request:")) {
      state = "req";
      return;
    }
    if (line.startsWith("Response:")) {
      state = "resp";
      return;
    }
    if (state === "resp" && line.trim()) {
      state = "done";
      if (wanted.has(command)) {
        try {
          blocks.push({ command, response: JSON.parse(line) });
          commands[command] = (commands[command] ?? 0) + 1;
        } catch {
          /* 單一行壞掉就略過 */
        }
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    read += value?.byteLength ?? 0;
    buf += decoder.decode(value, { stream: true });
    let idx = buf.indexOf("\n");
    while (idx >= 0) {
      handleLine(buf.slice(0, idx).replace(/\r$/, ""));
      buf = buf.slice(idx + 1);
      idx = buf.indexOf("\n");
    }
    onProgress?.(read, file.size, blocks.length);
  }
  if (buf.trim()) handleLine(buf.replace(/\r$/, ""));
  onProgress?.(file.size, file.size, blocks.length);
  return { blocks, commands };
}

/** 已經讀成字串的 FullLogger（例如使用者把 log 貼進來） */
export function readGuildLogText(text: string): { blocks: GuildBlock[]; commands: Record<string, number> } {
  const wanted = new Set(GUILD_COMMANDS);
  const blocks: GuildBlock[] = [];
  const commands: Record<string, number> = {};
  let command = "";
  let state = "none";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("API Command: ")) {
      command = line.slice("API Command: ".length).split(" - ", 1)[0].trim();
      state = "cmd";
      continue;
    }
    if (line.startsWith("Request:")) {
      state = "req";
      continue;
    }
    if (line.startsWith("Response:")) {
      state = "resp";
      continue;
    }
    if (state === "resp" && line.trim()) {
      state = "done";
      if (wanted.has(command)) {
        try {
          blocks.push({ command, response: JSON.parse(line) });
          commands[command] = (commands[command] ?? 0) + 1;
        } catch {
          /* 略過 */
        }
      }
    }
  }
  return { blocks, commands };
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

export function guildMemberSummaries(data: GuildData | null, rows: GuildUnitRow[]): GuildMemberSummary[] {
  const map = new Map<number, GuildMemberSummary>();
  for (const member of data?.members ?? []) {
    map.set(member.wizardId, { member, decks: member.decks.length, units: 0, artifacts: 0, fastest: 0, avgEff: 0 });
  }
  for (const row of rows) {
    let s = map.get(row.member.wizardId);
    if (!s) {
      s = { member: row.member, decks: row.member.decks.length, units: 0, artifacts: 0, fastest: 0, avgEff: 0 };
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
  // 有隊伍資料的排前面（最快速度高到低），只有名單資料的排後面（會長優先）
  return [...map.values()].sort((a, b) => {
    if (a.units === 0 && b.units > 0) return 1;
    if (b.units === 0 && a.units > 0) return -1;
    if (a.units === 0 && b.units === 0) {
      const ga = a.member.roster?.grade ?? 9;
      const gb = b.member.roster?.grade ?? 9;
      return ga - gb || a.member.name.localeCompare(b.member.name, "zh-TW");
    }
    return b.fastest - a.fastest || a.member.name.localeCompare(b.member.name, "zh-TW");
  });
}
