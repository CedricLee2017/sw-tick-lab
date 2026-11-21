/**
 * 據點戰紀錄匯入：
 * - SWGT 3MDC 外掛存下來的 `3MDC-*.json`（單場或陣列）
 * - SWGT / SW Tick Lab 的 `{ battles: [...] }` JSON
 * - SWEX FullLogger 的 full_log.txt（BattleGuildSiegeStart_v2 + 對戰摘要）
 *
 * 只處理「自己的進攻紀錄」；觀戰紀錄（SiegeObserver）之後可再擴充。
 */
import { del, get, set } from "idb-keyval";
import {
  mergeSiegeBattles,
  normalizeSiegeBattle,
  type SiegeBattle,
} from "./siegeBattleCore";

export interface SiegeLogParseResult {
  battles: SiegeBattle[];
  commands: Record<string, number>;
  blocks: number;
}

const LOCAL_KEY = "swtick:siege-battles:v1";

const asArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>);
  return [];
};

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const text = (value: unknown): string => (value == null ? "" : String(value).trim());

function collectBattleObjects(value: unknown, out: SiegeBattle[], depth = 0, seen = new Set<unknown>()): void {
  if (depth > 8 || !value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectBattleObjects(item, out, depth + 1, seen);
    return;
  }
  const row = value as Record<string, unknown>;
  // 3MDC / 我們自己的格式
  if (
    row.command === "3MDCBattleLog" ||
    row.battleType != null ||
    row.battle_type != null ||
    (row.defense != null && row.counter != null)
  ) {
    const battle = normalizeSiegeBattle(row);
    if (battle) {
      out.push(battle);
      return;
    }
  }
  // 常見包裝：{ battles: [...] } / { response: {...} } / { data: {...} }
  for (const key of ["battles", "response", "request", "data", "log_list", "items"]) {
    if (key in row) collectBattleObjects(row[key], out, depth + 1, seen);
  }
  // 最後才掃其他欄位，避免把符文 / 魔靈清單整份展開
  const skip = new Set([
    "runes", "artifacts", "unit_list", "guildsiege_my_unit_list", "guildsiege_opp_unit_list",
    "wizard_info", "guild", "decks", "members", "monsters", "units", "stats", "raw",
  ]);
  for (const [key, child] of Object.entries(row)) {
    if (skip.has(key) || key in { battles: 1, response: 1, request: 1, data: 1, log_list: 1, items: 1 }) continue;
    if (child && typeof child === "object") collectBattleObjects(child, out, depth + 1, seen);
  }
}

/** 解析 JSON 檔（3MDC 單場、陣列、SWGT 報告或我們的備份） */
export function parseSiegeJson(textValue: string): SiegeBattle[] {
  let root: unknown;
  try {
    root = JSON.parse(textValue.replace(/^\uFEFF/, ""));
  } catch {
    return [];
  }
  const out: SiegeBattle[] = [];
  collectBattleObjects(root, out);
  return mergeSiegeBattles(out);
}

interface PendingBattle extends SiegeBattle {
  /** 已經由結果或摘要比對到勝負 */
  resolved: boolean;
}

interface SiegeLogBlock {
  command: string;
  request?: any;
  response?: any;
}

/**
 * 逐行解析 SWEX full_log.txt 的據點戰區塊。
 * 會把 `BattleGuildSiegeStart_v2`（雙方隊伍）與
 * `getGuildSiegeMatchBattleLogSummary_v2` / `BattleGuildSiegeResult`（勝負）配對。
 */
class SiegeLogParser {
  readonly battles = new Map<string, SiegeBattle>();
  readonly commands: Record<string, number> = {};
  private readonly guildNames = new Map<number, string>();
  private readonly guildRatings = new Map<number, number>();
  private readonly wizardGuild = new Map<number, number>();
  private readonly wizardNames = new Map<number, string>();
  private readonly pending: PendingBattle[] = [];
  blocks = 0;

  ingest(block: SiegeLogBlock): void {
    this.blocks++;
    const command = block.response?.command || block.request?.command || block.command;
    if (!command) return;
    this.commands[command] = (this.commands[command] ?? 0) + 1;

    if (command === "BattleGuildSiegeStart_v2" && block.response) {
      this.startBattle(block.response);
      return;
    }
    if (command === "BattleGuildSiegeResult") {
      this.finishBattle(block.request, block.response);
      return;
    }
    if (command === "getGuildSiegeMatchBattleLogSummary_v2" && block.response) {
      this.ingestSummary(block.response);
      return;
    }
    if ((command === "GetGuildSiegeMatchupInfo" || command === "GetGuildSiegeMatchupInfoForFinished") && block.response) {
      this.ingestMatchup(block.response);
      return;
    }
    if (command === "GetGuildSiegeRankingInfo" && block.response) {
      this.ingestRanking(block.response);
      return;
    }
    if (command === "SetGuildSiegeBattleReplayData" && block.request) {
      this.ingestReplay(block.request, block.response);
    }
  }

  result(): SiegeBattle[] {
    // 只剩已配到勝負的；沒有結果的不匯入，避免把中離 / 未完成戰鬥算進去
    for (const battle of this.pending) this.remember(battle);
    return [...this.battles.values()].sort((a, b) => (b.time || 0) - (a.time || 0));
  }

  private remember(battle: SiegeBattle & { resolved?: boolean }): void {
    if (!battle.resolved) return;
    const normalized = normalizeSiegeBattle(battle);
    if (!normalized) return;
    this.battles.set(normalized.uid, normalized);
  }

  private ingestMatchup(resp: any): void {
    this.ingestGuilds(resp);
    const match = resp.match_info;
    if (!match) return;
    const rating = num(match.rating_id);
    const myGuild = num(match.guild_id);
    if (myGuild && rating) this.guildRatings.set(myGuild, rating);
    for (const guild of asArray(resp.guild_list)) {
      const row = guild as any;
      const id = num(row.guild_id);
      if (id) {
        if (row.guild_name) this.guildNames.set(id, String(row.guild_name));
        const r = num(row.rating_id);
        if (r) this.guildRatings.set(id, r);
      }
    }
    for (const wizard of asArray(resp.wizard_info_list)) {
      const row = wizard as any;
      const id = num(row.wizard_id);
      const gid = num(row.guild_id);
      if (id) {
        if (row.wizard_name) this.wizardNames.set(id, String(row.wizard_name));
        if (gid) this.wizardGuild.set(id, gid);
      }
    }
  }

  private ingestRanking(resp: any): void {
    const info = resp.guildsiege_ranking_info;
    if (!info) return;
    const gid = num(info.guild_id);
    const rating = num(info.rating_id);
    if (gid && rating) this.guildRatings.set(gid, rating);
  }

  private ingestGuilds(resp: any): void {
    for (const wizard of asArray(resp.wizard_info_list)) {
      const row = wizard as any;
      const id = num(row.wizard_id);
      const gid = num(row.guild_id);
      if (id) {
        if (row.wizard_name) this.wizardNames.set(id, String(row.wizard_name));
        if (gid) this.wizardGuild.set(id, gid);
      }
      if (gid && row.guild_name) this.guildNames.set(gid, String(row.guild_name));
    }
    for (const guild of asArray(resp.guild_list)) {
      const row = guild as any;
      const id = num(row.guild_id);
      if (id) {
        if (row.guild_name) this.guildNames.set(id, String(row.guild_name));
        const r = num(row.rating_id);
        if (r) this.guildRatings.set(id, r);
      }
    }
  }

  private startBattle(resp: any): void {
    this.ingestGuilds(resp);
    const wizardId = num(resp.wizard_info?.wizard_id);
    const wizardName = text(resp.wizard_info?.wizard_name);
    if (wizardId && wizardName) this.wizardNames.set(wizardId, wizardName);

    const counter = asArray(resp.guildsiege_my_unit_list)
      .map((unit: any) => num(unit?.unit_master_id))
      .filter((id) => id > 0);
    const oppRows = asArray(resp.guildsiege_opp_unit_list) as any[];
    const defense = oppRows
      .map((unit: any) => num(unit?.unit_info?.unit_master_id))
      .filter((id) => id > 0);
    if (counter.length !== 3 || defense.length !== 3) return;

    const oppWizardId = num(oppRows[0]?.unit_info?.wizard_id);
    const guildId = this.wizardGuild.get(wizardId) ?? 0;
    const oppGuildId = this.wizardGuild.get(oppWizardId) ?? 0;
    const rank = this.guildRatings.get(guildId) ?? 0;
    const time = num(resp.tvalue);
    const battle: PendingBattle = {
      uid: "",
      battleType: "Siege",
      wizardId,
      wizardName,
      guildId,
      guildName: this.guildNames.get(guildId) ?? "",
      oppGuildId,
      oppGuildName: this.guildNames.get(oppGuildId) ?? "",
      oppWizardId,
      oppWizardName: this.wizardNames.get(oppWizardId) ?? "",
      battleKey: text(resp.battle_key),
      time,
      win: false,
      rank,
      defense,
      counter,
      resolved: false,
    };
    battle.uid = `${battle.battleType}|${battle.wizardId}|${battle.battleKey || battle.time}|${battle.defense.join("-")}|${battle.counter.join("-")}`;
    this.pending.push(battle);
  }

  private finishBattle(req: any, resp: any): void {
    const battleKey = text(req?.battle_key ?? resp?.battle_key);
    const wizardId = num(req?.wizard_id ?? resp?.wizard_id);
    if (!battleKey) return;
    const battle = [...this.pending]
      .reverse()
      .find((item) => !item.resolved && item.battleKey === battleKey && (!wizardId || item.wizardId === wizardId));
    if (!battle) return;
    battle.win = num(req?.win_lose) === 1;
    battle.time = num(resp?.tvalue) || battle.time || Math.floor(Date.now() / 1000);
    battle.resolved = true;
    this.remember(battle);
  }

  private ingestSummary(resp: any): void {
    this.ingestGuilds(resp);
    const logs = asArray(resp.wizard_battle_log_list);
    if (logs.length === 0) return;
    for (const raw of logs) {
      const row = raw as any;
      // log_type 1 = 自己進攻；2 = 自己被攻擊
      if (num(row.log_type) !== 1) continue;
      const wizardId = num(row.wizard_id);
      const time = num(row.log_timestamp);
      if (!wizardId || !time) continue;
      const win = num(row.win_lose) === 1;
      const candidates = this.pending
        .filter((item) => !item.resolved && item.wizardId === wizardId && (!item.time || item.time <= time + 5))
        .sort((a, b) => b.time - a.time);
      const battle = candidates[0];
      if (!battle) continue;
      battle.win = win;
      battle.time = time;
      battle.oppWizardId = num(row.opp_wizard_id) || battle.oppWizardId;
      battle.oppGuildId = num(row.opp_guild_id) || battle.oppGuildId;
      battle.oppWizardName = this.wizardNames.get(battle.oppWizardId) ?? battle.oppWizardName;
      battle.oppGuildName = this.guildNames.get(battle.oppGuildId) ?? battle.oppGuildName;
      battle.resolved = true;
      this.remember(battle);
    }
  }

  private ingestReplay(req: any, resp: any): void {
    const info = req.battle_info;
    if (!info) return;
    // 只有同公會的測試戰才會是 guild_id == opp_guild_id
    if (num(info.guild_id) !== num(info.opp_guild_id)) return;
    const wizardId = num(info.wizard_id);
    const oppWizardId = num(info.opp_wizard_id);
    const counter = asArray(info.unit_list?.[0]).map((id) => num(id)).filter((id) => id > 0);
    const defense = asArray(info.opp_unit_list?.[0]).map((id) => num(id)).filter((id) => id > 0);
    if (counter.length !== 3 || defense.length !== 3) return;
    const win = num(info.result_list?.[0]) === 1;
    const time = num(resp?.tvalue) || Math.floor(Date.now() / 1000);
    this.remember({
      uid: "",
      battleType: "SiegeTest",
      wizardId,
      wizardName: text(info.wizard_name) || this.wizardNames.get(wizardId) || "",
      guildId: num(info.guild_id),
      guildName: text(info.guild_name) || this.guildNames.get(num(info.guild_id)) || "",
      oppGuildId: num(info.opp_guild_id),
      oppGuildName: text(info.opp_guild_name) || this.guildNames.get(num(info.opp_guild_id)) || "",
      oppWizardId,
      oppWizardName: text(info.opp_wizard_name) || this.wizardNames.get(oppWizardId) || "",
      battleKey: text(req.battle_key),
      time,
      win,
      rank: this.guildRatings.get(num(info.guild_id)) ?? 0,
      defense,
      counter,
      resolved: true,
    } as PendingBattle);
  }
}

/** 已經讀成字串的 FullLogger（例如貼上或較小的檔案） */
export function parseSiegeLogText(textValue: string): SiegeLogParseResult {
  const parser = new SiegeLogParser();
  let command = "";
  let request: any;
  let response: any;
  let state: "none" | "cmd" | "req" | "resp" | "done" = "none";

  const flush = () => {
    if (!command) return;
    if (request || response) parser.ingest({ command, request, response });
    command = "";
    request = undefined;
    response = undefined;
    state = "none";
  };

  for (const rawLine of textValue.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("API Command: ")) {
      flush();
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
    if (!line.trim()) continue;
    try {
      if (state === "req") {
        request = JSON.parse(line);
        state = "done";
      } else if (state === "resp") {
        response = JSON.parse(line);
        state = "done";
      }
    } catch {
      // 單行壞掉就略過，不影響其他區塊
    }
  }
  flush();
  return { battles: parser.result(), commands: parser.commands, blocks: parser.blocks };
}

/** 逐行讀取 full_log.txt，避免一次載入上百 MB */
export async function readSiegeLogFile(
  file: File,
  onProgress?: (readBytes: number, totalBytes: number, found: number) => void,
): Promise<SiegeLogParseResult> {
  const parser = new SiegeLogParser();
  let command = "";
  let request: any;
  let response: any;
  let state: "none" | "cmd" | "req" | "resp" | "done" = "none";
  let read = 0;

  const flush = () => {
    if (!command) return;
    if (request || response) parser.ingest({ command, request, response });
    command = "";
    request = undefined;
    response = undefined;
    state = "none";
  };

  const handleLine = (rawLine: string) => {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("API Command: ")) {
      flush();
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
    if (!line.trim()) return;
    try {
      if (state === "req") {
        request = JSON.parse(line);
        state = "done";
      } else if (state === "resp") {
        response = JSON.parse(line);
        state = "done";
      }
    } catch {
      // 略過壞行
    }
  };

  const decoder = new TextDecoder();
  const reader = file.stream().getReader();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    read += value?.byteLength ?? 0;
    buf += decoder.decode(value, { stream: true });
    let idx = buf.indexOf("\n");
    while (idx >= 0) {
      handleLine(buf.slice(0, idx));
      buf = buf.slice(idx + 1);
      idx = buf.indexOf("\n");
    }
    onProgress?.(read, file.size, parser.battles.size);
  }
  if (buf.trim()) handleLine(buf);
  flush();
  onProgress?.(file.size, file.size, parser.battles.size);
  return { battles: parser.result(), commands: parser.commands, blocks: parser.blocks };
}

// ── 本機暫存（未登入或不想上傳時使用） ─────────────────────

export async function loadLocalSiegeBattles(): Promise<SiegeBattle[]> {
  try {
    const stored = await get<SiegeBattle[]>(LOCAL_KEY);
    if (!Array.isArray(stored)) return [];
    return mergeSiegeBattles(stored.filter((row) => row && row.uid));
  } catch {
    return [];
  }
}

export async function saveLocalSiegeBattles(battles: SiegeBattle[]): Promise<void> {
  await set(LOCAL_KEY, mergeSiegeBattles(battles));
}

export async function clearLocalSiegeBattles(): Promise<void> {
  await del(LOCAL_KEY);
}
