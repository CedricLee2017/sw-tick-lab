/**
 * 據點進攻建議：解析 SWGT 3MDC Battle Logs，統整進攻隊 / 防守隊 / 怪物勝率，
 * 並依 Nosna44 的實戰紀錄推薦進攻隊與防守核心。
 */

export interface SiegeMonsterInfo {
  name: string;
  icon: string;
}

export interface SiegeBattleRecord {
  battleId: number;
  attacker: string;
  date: string;
  result: string;
  rank: string;
  battleType: string;
  defenseGuild: string;
  /** 短賽季標記，例如 S22 */
  season?: string;
  /** 完整賽季名稱，例如 Season 22 - Complete */
  seasonName?: string;
  counter: number[];
  defense: number[];
}

export interface SiegeDataset {
  source: string;
  player: string;
  guild: string;
  season: string;
  /** 這份資料包含的短賽季，例如 ["S13", …, "S22"] */
  seasons?: string[];
  collectedAt: string;
  reportUrl?: string;
  dateMin: string;
  dateMax: string;
  monsters: Record<string, SiegeMonsterInfo>;
  battles: SiegeBattleRecord[];
}

export interface SiegeTeamStat {
  key: string;
  team: number[];
  battles: number;
  wins: number;
  losses: number;
  /** 以 Nosna44（進攻方）角度計算的勝率 */
  wr: number;
  lastDate: string;
  guilds: string[];
}

export interface SiegeMonsterStat {
  id: number;
  battles: number;
  wins: number;
  losses: number;
  /** 以 Nosna44（進攻方）角度計算的勝率 */
  wr: number;
}

export interface SiegePairStat {
  key: string;
  counterKey: string;
  defenseKey: string;
  counter: number[];
  defense: number[];
  battles: number;
  wins: number;
  losses: number;
  wr: number;
  lastDate: string;
  guilds: string[];
}

export interface SiegeDefensePairStat {
  key: string;
  ids: [number, number];
  battles: number;
  wins: number;
  losses: number;
  wr: number;
}

export interface SiegeGuildStat {
  guild: string;
  battles: number;
  wins: number;
  losses: number;
  wr: number;
}

export interface SiegeSeasonStat {
  season: string;
  battles: number;
  wins: number;
  losses: number;
  wr: number;
}

export interface SiegeOverallStats {
  battles: number;
  wins: number;
  losses: number;
  wr: number;
  counterTeams: number;
  defenseTeams: number;
  guilds: number;
  dateMin: string;
  dateMax: string;
}

export interface SiegeBattleAnalysis {
  overall: SiegeOverallStats;
  seasons: SiegeSeasonStat[];
  counterTeams: SiegeTeamStat[];
  defenseTeams: SiegeTeamStat[];
  pairs: SiegePairStat[];
  counterMonsters: SiegeMonsterStat[];
  defenseMonsters: SiegeMonsterStat[];
  defensePairs: SiegeDefensePairStat[];
  defenseGuilds: SiegeGuildStat[];
  losses: SiegeBattleRecord[];
}

export interface SiegeCounterCandidate {
  key: string;
  team: number[];
  battles: number;
  wins: number;
  losses: number;
  wr: number;
  lastDate: string;
  source: "exact" | "similar";
  defenseMatches: number;
  guilds: string[];
  reason: string;
}

export interface SiegeCounterAdvice {
  defense?: SiegeTeamStat;
  exactPairs: SiegePairStat[];
  similarDefenses: SiegeTeamStat[];
  similarCounters: SiegeCounterCandidate[];
  recommendations: SiegeCounterCandidate[];
  fallbackMonsters: SiegeMonsterStat[];
}

export interface SiegeDefenseSuggestion {
  key: string;
  team: number[];
  battles: number;
  wins: number;
  losses: number;
  wr: number;
  guilds: string[];
  reason: string;
  counters: SiegePairStat[];
}

export interface SiegeDefenseAdvice {
  losingDefenses: SiegeTeamStat[];
  hardDefenses: SiegeTeamStat[];
  suggestions: SiegeDefenseSuggestion[];
  coreMonsters: SiegeMonsterStat[];
  corePairs: SiegeDefensePairStat[];
  guilds: SiegeGuildStat[];
  losingBattles: SiegeBattleRecord[];
}

export interface SiegeDefenseVariant {
  monsterId: number;
  team: number[];
  battles: number;
  wins: number;
  losses: number;
  wr: number;
  guilds: string[];
  lastDate: string;
}

/** 數字化並去除重複，固定由小到大排序（用來當隊伍 key） */
export function siegeTeamKey(ids: number[]): string {
  return [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
    .sort((a, b) => a - b)
    .join("-");
}

export function siegeDateValue(date: string): number {
  const t = Date.parse(date);
  return Number.isFinite(t) ? t : 0;
}

export function siegeWinRate(wins: number, battles: number): number {
  return battles > 0 ? Math.round((wins / battles) * 1000) / 10 : 0;
}

/** 把 "Season 22 - Complete" 轉成 "S22" */
export function siegeSeasonShort(label: string): string {
  const match = label.match(/Season\s*(\d+)/i);
  return match ? `S${match[1]}` : label;
}

export function siegeSeasonSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/** 用賽季清單產生「Season 13 – Season 22」這種標題 */
export function siegeSeasonRangeLabel(seasons: string[]): string {
  const nums = seasons
    .map((s) => Number(/^S(\d+)/i.exec(s)?.[1] ?? NaN))
    .filter((n) => Number.isFinite(n));
  if (nums.length === 0) return seasons.join(" · ");
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return min === max ? `Season ${min}` : `Season ${min} – Season ${max}`;
}

export function siegeMonsterName(data: SiegeDataset | null, id: number): string {
  return data?.monsters?.[String(id)]?.name ?? `#${id}`;
}

export function siegeMonsterIcon(data: SiegeDataset | null, id: number): string {
  return data?.monsters?.[String(id)]?.icon ?? "";
}

export function siegeTeamLabel(data: SiegeDataset | null, ids: number[]): string {
  return ids.map((id) => siegeMonsterName(data, id)).join(" / ");
}

/** 兩隊共有的怪物數量 */
export function siegeOverlap(a: number[], b: number[]): number {
  const set = new Set(b);
  return a.filter((id) => set.has(id)).length;
}

function normalizeTeam(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((id) => Number.isFinite(id) && id > 0))].sort((a, b) => a - b);
}

function normalizeBattle(value: unknown): SiegeBattleRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const counter = normalizeTeam(row.counter);
  const defense = normalizeTeam(row.defense);
  if (!counter.length || !defense.length) return null;
  return {
    battleId: Number(row.battleId) || 0,
    attacker: String(row.attacker ?? ""),
    date: String(row.date ?? ""),
    result: String(row.result ?? ""),
    rank: String(row.rank ?? ""),
    battleType: String(row.battleType ?? "Siege"),
    defenseGuild: String(row.defenseGuild ?? ""),
    season: String(row.season ?? ""),
    seasonName: String(row.seasonName ?? ""),
    counter,
    defense,
  };
}

function dateRange(battles: SiegeBattleRecord[]): { dateMin: string; dateMax: string } {
  const dates = battles.map((b) => b.date).filter(Boolean).sort((a, b) => siegeDateValue(a) - siegeDateValue(b));
  return { dateMin: dates[0] ?? "", dateMax: dates[dates.length - 1] ?? "" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** 驗證並整理內建 / 匯入的 JSON */
export function normalizeSiegeDataset(raw: unknown): SiegeDataset {
  if (!raw) throw new Error("沒有讀到資料。");
  const source = Array.isArray(raw) ? { battles: raw } : (raw as Record<string, unknown>);
  if (!isRecord(source)) throw new Error("資料格式不正確。");

  const battles = (Array.isArray(source.battles) ? source.battles : [])
    .map(normalizeBattle)
    .filter((b): b is SiegeBattleRecord => !!b);
  if (battles.length === 0) throw new Error("找不到對戰紀錄（battles 是空的）。");

  const monsters: Record<string, SiegeMonsterInfo> = {};
  if (isRecord(source.monsters)) {
    for (const [id, value] of Object.entries(source.monsters)) {
      if (!isRecord(value)) continue;
      monsters[id] = {
        name: String(value.name ?? `#${id}`),
        icon: String(value.icon ?? ""),
      };
    }
  }

  const range = dateRange(battles);
  const sourceSeasons = Array.isArray(source.seasons) ? source.seasons.map(String) : [];
  const seasons = [...new Set([...sourceSeasons, ...battles.map((b) => b.season ?? "").filter(Boolean)])].sort(siegeSeasonSort);
  return {
    source: String(source.source ?? "SWGT 3MDC Battle Logs"),
    player: String(source.player ?? battles[0]?.attacker ?? "Unknown"),
    guild: String(source.guild ?? ""),
    season: String(source.season ?? (seasons.length ? siegeSeasonRangeLabel(seasons) : "")),
    seasons,
    collectedAt: String(source.collectedAt ?? new Date().toISOString()),
    reportUrl: source.reportUrl ? String(source.reportUrl) : undefined,
    dateMin: String(source.dateMin ?? range.dateMin),
    dateMax: String(source.dateMax ?? range.dateMax),
    monsters,
    battles,
  };
}

export function parseSiegeJson(text: string): SiegeDataset {
  return normalizeSiegeDataset(JSON.parse(text));
}

/** 合併同一位玩家的新舊紀錄；不同玩家則直接使用新資料 */
export function mergeSiegeDatasets(base: SiegeDataset, incoming: SiegeDataset): SiegeDataset {
  if (base.player && incoming.player && base.player !== incoming.player) return incoming;
  const monsters = { ...base.monsters, ...incoming.monsters };
  const map = new Map(base.battles.map((b) => [b.battleId, b]));
  for (const battle of incoming.battles) map.set(battle.battleId, battle);
  const battles = [...map.values()].sort((a, b) => siegeDateValue(b.date) - siegeDateValue(a.date));
  const seasons = [...new Set(battles.map((b) => b.season ?? "").filter(Boolean))].sort(siegeSeasonSort);
  const range = dateRange(battles);
  return normalizeSiegeDataset({
    source: incoming.source || base.source,
    player: incoming.player || base.player,
    guild: incoming.guild || base.guild,
    season: seasons.length ? siegeSeasonRangeLabel(seasons) : incoming.season || base.season,
    seasons,
    collectedAt: new Date().toISOString(),
    reportUrl: incoming.reportUrl || base.reportUrl,
    dateMin: range.dateMin,
    dateMax: range.dateMax,
    monsters,
    battles,
  });
}

function htmlText(el: Element | null | undefined): string {
  if (!el) return "";
  return (el.innerHTML || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 解析從 SWGT「Run Report」另存的 HTML。
 * 會讀取 Details 分頁中的每一筆對戰，不需要登入資訊。
 */
export function parseSiegeReportHtml(html: string): SiegeDataset {
  if (typeof DOMParser === "undefined") throw new Error("這個環境不支援 HTML 解析。");
  const doc = new DOMParser().parseFromString(html, "text/html");
  let rows = [...doc.querySelectorAll("#detailsTab > div.row.pr-1.pl-1.mb-1")];
  if (rows.length === 0) {
    const seen = new Set<Element>();
    for (const note of doc.querySelectorAll('[id^="DIV_MD_"]')) {
      const row = note.closest("div.row.pr-1.pl-1.mb-1");
      if (row && !seen.has(row)) {
        seen.add(row);
        rows.push(row);
      }
    }
  }
  if (rows.length === 0) throw new Error("在 HTML 中找不到對戰紀錄（Details 分頁）。");

  const monsters: Record<string, SiegeMonsterInfo> = {};
  const monster = (img: Element): number | null => {
    const a = img.closest("a");
    const match = (a?.getAttribute("href") ?? "").match(/com2usID=(\d+)/);
    const id = match ? Number(match[1]) : null;
    const name = img.getAttribute("alt") || img.getAttribute("title") || "";
    const icon = img.getAttribute("src") || "";
    if (id && !monsters[id]) monsters[id] = { name: name || `#${id}`, icon };
    return id;
  };
  const team = (el: Element | null | undefined): number[] => {
    if (!el) return [];
    return [...el.querySelectorAll("img")].map(monster).filter((id): id is number => id !== null);
  };

  const seasonLabel = (() => {
    const el = doc.querySelector("#dateRangeType") as HTMLSelectElement | null;
    return el?.selectedOptions?.[0]?.textContent?.trim() ?? "";
  })();

  const battles: SiegeBattleRecord[] = [];
  for (const row of rows) {
    const idEl = row.querySelector('[id^="DIV_MD_"]');
    const idMatch = (idEl?.id ?? "").match(/DIV_MD_\d+_(\d+)/);
    const teams = [...row.querySelectorAll(".col-7 .col-5.d-none.d-md-block")];
    const defenseEl = teams[1];
    const defenseSpans = defenseEl
      ? [...defenseEl.querySelectorAll("span")].map((s) => s.textContent?.trim() ?? "").filter(Boolean)
      : [];
    const rank = [...new Set([...row.querySelectorAll('img[class*="battleRankScaling"]')].map((img) => img.getAttribute("alt") ?? "").filter(Boolean))];
    const battle = normalizeBattle({
      battleId: idMatch ? Number(idMatch[1]) : 0,
      attacker: row.querySelector(".col-3.d-none.d-md-block span")?.textContent?.trim() ?? "",
      date: htmlText(row.querySelector('.col-3.d-none.d-md-block span[style*="#aaa"]')),
      result: htmlText(row.querySelector(".col-2.text-center.d-none.d-md-block")),
      rank: rank[0] ?? "",
      battleType: [...row.querySelectorAll(".col-2 span")].map((s) => s.textContent?.trim() ?? "").find((s) => /Siege|Guild|Labyrinth/i.test(s)) ?? "Siege",
      defenseGuild: defenseSpans.filter((s) => s !== "DEFENSE").slice(-1)[0] ?? "",
      counter: team(teams[0]),
      defense: team(teams[1]),
    });
    if (battle) battles.push(battle);
  }
  if (battles.length === 0) throw new Error("HTML 中的對戰紀錄無法解析。");
  const seasonShort = siegeSeasonShort(seasonLabel);
  for (const battle of battles) {
    battle.season = seasonShort;
    battle.seasonName = seasonLabel;
  }

  const pickSelected = (selector: string): string => {
    const el = doc.querySelector(selector) as HTMLSelectElement | null;
    return el?.selectedOptions?.[0]?.textContent?.trim() ?? "";
  };
  // 標題格式：SWGT -公會名稱- > 3MDC > Battle Logs
  const titleGuild = (doc.title.split(">")[0] ?? "").replace(/^SWGT\s*/, "").trim();
  const range = dateRange(battles);
  return normalizeSiegeDataset({
    source: "SWGT 3MDC Battle Logs (HTML import)",
    player: battles[0]?.attacker || "Unknown",
    guild: pickSelected("#guildID") || titleGuild,
    season: seasonLabel,
    seasons: seasonShort ? [seasonShort] : [],
    collectedAt: new Date().toISOString(),
    dateMin: range.dateMin,
    dateMax: range.dateMax,
    monsters,
    battles,
  });
}

let siegePromise: Promise<SiegeDataset> | null = null;

/** 內建快照：Nosna44 的 SWGT 據點戰紀錄（public/data/siege-battles-nosna44.json） */
export function loadSiegeBattles(): Promise<SiegeDataset> {
  if (!siegePromise) {
    const version = typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__.replace(/[^0-9]/g, "") : "dev";
    const url = `${import.meta.env.BASE_URL}data/siege-battles-nosna44.json?v=${version}`;
    siegePromise = fetch(url, { cache: "force-cache" })
      .then((res) => {
        if (!res.ok) throw new Error(`對戰紀錄載入失敗（${res.status}）`);
        return res.json() as Promise<unknown>;
      })
      .then(normalizeSiegeDataset)
      .catch((err) => {
        siegePromise = null;
        throw err;
      });
  }
  return siegePromise;
}

function groupTeams(dataset: SiegeDataset, side: "counter" | "defense"): SiegeTeamStat[] {
  const map = new Map<string, SiegeTeamStat>();
  for (const battle of dataset.battles) {
    const team = side === "counter" ? battle.counter : battle.defense;
    const key = siegeTeamKey(team);
    let stat = map.get(key);
    if (!stat) {
      stat = { key, team: [...team].sort((a, b) => a - b), battles: 0, wins: 0, losses: 0, wr: 0, lastDate: "", guilds: [] };
      map.set(key, stat);
    }
    stat.battles++;
    if (battle.result === "Victory") stat.wins++;
    if (side === "defense" && battle.defenseGuild && !stat.guilds.includes(battle.defenseGuild)) {
      stat.guilds.push(battle.defenseGuild);
    }
    if (!stat.lastDate || siegeDateValue(battle.date) > siegeDateValue(stat.lastDate)) stat.lastDate = battle.date;
  }
  for (const stat of map.values()) {
    stat.losses = stat.battles - stat.wins;
    stat.wr = siegeWinRate(stat.wins, stat.battles);
  }
  return [...map.values()];
}

function groupMonsters(dataset: SiegeDataset, side: "counter" | "defense"): SiegeMonsterStat[] {
  const map = new Map<number, SiegeMonsterStat>();
  for (const battle of dataset.battles) {
    const team = side === "counter" ? battle.counter : battle.defense;
    for (const id of new Set(team)) {
      let stat = map.get(id);
      if (!stat) {
        stat = { id, battles: 0, wins: 0, losses: 0, wr: 0 };
        map.set(id, stat);
      }
      stat.battles++;
      if (battle.result === "Victory") stat.wins++;
    }
  }
  for (const stat of map.values()) {
    stat.losses = stat.battles - stat.wins;
    stat.wr = siegeWinRate(stat.wins, stat.battles);
  }
  return [...map.values()];
}

function groupPairs(dataset: SiegeDataset): SiegePairStat[] {
  const map = new Map<string, SiegePairStat>();
  for (const battle of dataset.battles) {
    const counterKey = siegeTeamKey(battle.counter);
    const defenseKey = siegeTeamKey(battle.defense);
    const key = `${counterKey}|${defenseKey}`;
    let stat = map.get(key);
    if (!stat) {
      stat = {
        key,
        counterKey,
        defenseKey,
        counter: [...battle.counter].sort((a, b) => a - b),
        defense: [...battle.defense].sort((a, b) => a - b),
        battles: 0,
        wins: 0,
        losses: 0,
        wr: 0,
        lastDate: "",
        guilds: [],
      };
      map.set(key, stat);
    }
    stat.battles++;
    if (battle.result === "Victory") stat.wins++;
    if (battle.defenseGuild && !stat.guilds.includes(battle.defenseGuild)) stat.guilds.push(battle.defenseGuild);
    if (!stat.lastDate || siegeDateValue(battle.date) > siegeDateValue(stat.lastDate)) stat.lastDate = battle.date;
  }
  for (const stat of map.values()) {
    stat.losses = stat.battles - stat.wins;
    stat.wr = siegeWinRate(stat.wins, stat.battles);
  }
  return [...map.values()];
}

function groupDefensePairs(dataset: SiegeDataset): SiegeDefensePairStat[] {
  const map = new Map<string, SiegeDefensePairStat>();
  for (const battle of dataset.battles) {
    const ids = [...new Set(battle.defense)].sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}-${ids[j]}`;
        let stat = map.get(key);
        if (!stat) {
          stat = { key, ids: [ids[i], ids[j]], battles: 0, wins: 0, losses: 0, wr: 0 };
          map.set(key, stat);
        }
        stat.battles++;
        if (battle.result === "Victory") stat.wins++;
      }
    }
  }
  for (const stat of map.values()) {
    stat.losses = stat.battles - stat.wins;
    stat.wr = siegeWinRate(stat.wins, stat.battles);
  }
  return [...map.values()];
}

function groupGuilds(dataset: SiegeDataset): SiegeGuildStat[] {
  const map = new Map<string, SiegeGuildStat>();
  for (const battle of dataset.battles) {
    const guild = battle.defenseGuild || "未知公會";
    let stat = map.get(guild);
    if (!stat) {
      stat = { guild, battles: 0, wins: 0, losses: 0, wr: 0 };
      map.set(guild, stat);
    }
    stat.battles++;
    if (battle.result === "Victory") stat.wins++;
  }
  for (const stat of map.values()) {
    stat.losses = stat.battles - stat.wins;
    stat.wr = siegeWinRate(stat.wins, stat.battles);
  }
  return [...map.values()];
}

export function analyzeSiegeBattles(dataset: SiegeDataset): SiegeBattleAnalysis {
  const counterTeams = groupTeams(dataset, "counter").sort((a, b) => b.battles - a.battles || b.wr - a.wr);
  const defenseTeams = groupTeams(dataset, "defense").sort((a, b) => b.battles - a.battles || a.wr - b.wr);
  const pairs = groupPairs(dataset).sort((a, b) => b.battles - a.battles || b.wr - a.wr);
  const counterMonsters = groupMonsters(dataset, "counter").sort((a, b) => b.battles - a.battles || b.wr - a.wr);
  const defenseMonsters = groupMonsters(dataset, "defense").sort((a, b) => b.battles - a.battles || a.wr - b.wr);
  const defensePairs = groupDefensePairs(dataset).sort((a, b) => b.battles - a.battles || a.wr - b.wr);
  const defenseGuilds = groupGuilds(dataset).sort((a, b) => b.battles - a.battles || a.wr - b.wr);
  const seasonMap = new Map<string, SiegeSeasonStat>();
  for (const battle of dataset.battles) {
    const season = battle.season || "未知賽季";
    let stat = seasonMap.get(season);
    if (!stat) {
      stat = { season, battles: 0, wins: 0, losses: 0, wr: 0 };
      seasonMap.set(season, stat);
    }
    stat.battles++;
    if (battle.result === "Victory") stat.wins++;
  }
  for (const stat of seasonMap.values()) {
    stat.losses = stat.battles - stat.wins;
    stat.wr = siegeWinRate(stat.wins, stat.battles);
  }
  const seasons = [...seasonMap.values()].sort((a, b) => siegeSeasonSort(a.season, b.season));
  const wins = dataset.battles.filter((b) => b.result === "Victory").length;
  const losses = dataset.battles
    .filter((b) => b.result !== "Victory")
    .sort((a, b) => siegeDateValue(b.date) - siegeDateValue(a.date));

  return {
    overall: {
      battles: dataset.battles.length,
      wins,
      losses: dataset.battles.length - wins,
      wr: siegeWinRate(wins, dataset.battles.length),
      counterTeams: counterTeams.length,
      defenseTeams: defenseTeams.length,
      guilds: defenseGuilds.length,
      dateMin: dataset.dateMin,
      dateMax: dataset.dateMax,
    },
    seasons,
    counterTeams,
    defenseTeams,
    pairs,
    counterMonsters,
    defenseMonsters,
    defensePairs,
    defenseGuilds,
    losses,
  };
}

function groupSimilarCounters(dataset: SiegeDataset, defenseKeys: Set<string>): SiegeCounterCandidate[] {
  if (defenseKeys.size === 0) return [];
  const map = new Map<string, {
    team: number[];
    battles: number;
    wins: number;
    lastDate: string;
    defenseKeys: Set<string>;
    guilds: Set<string>;
  }>();
  for (const battle of dataset.battles) {
    const defenseKey = siegeTeamKey(battle.defense);
    if (!defenseKeys.has(defenseKey)) continue;
    const key = siegeTeamKey(battle.counter);
    let item = map.get(key);
    if (!item) {
      item = { team: [...battle.counter].sort((a, b) => a - b), battles: 0, wins: 0, lastDate: "", defenseKeys: new Set(), guilds: new Set() };
      map.set(key, item);
    }
    item.battles++;
    if (battle.result === "Victory") item.wins++;
    item.defenseKeys.add(defenseKey);
    if (battle.defenseGuild) item.guilds.add(battle.defenseGuild);
    if (!item.lastDate || siegeDateValue(battle.date) > siegeDateValue(item.lastDate)) item.lastDate = battle.date;
  }
  return [...map.entries()].map(([key, item]) => {
    const wr = siegeWinRate(item.wins, item.battles);
    return {
      key,
      team: item.team,
      battles: item.battles,
      wins: item.wins,
      losses: item.battles - item.wins,
      wr,
      lastDate: item.lastDate,
      source: "similar" as const,
      defenseMatches: item.defenseKeys.size,
      guilds: [...item.guilds],
      reason: `對 ${item.defenseKeys.size} 個相似防守隊 ${item.wins}/${item.battles} 勝（${wr}%）`,
    };
  });
}

/** 針對指定防守隊，找出直接對戰與相似防守隊的推薦進攻隊；customDefense 可傳入紀錄中沒有的自訂三隻 */
export function recommendSiegeCounters(
  dataset: SiegeDataset,
  analysis: SiegeBattleAnalysis,
  defenseKey: string,
  customDefense?: number[],
): SiegeCounterAdvice {
  const found = analysis.defenseTeams.find((d) => d.key === defenseKey);
  const defense = found ?? (customDefense?.length
    ? {
        key: defenseKey,
        team: [...customDefense].sort((a, b) => a - b),
        battles: 0,
        wins: 0,
        losses: 0,
        wr: 0,
        lastDate: "",
        guilds: [],
      }
    : undefined);
  if (!defense) {
    return { exactPairs: [], similarDefenses: [], similarCounters: [], recommendations: [], fallbackMonsters: analysis.counterMonsters.slice(0, 8) };
  }

  const exactPairs = analysis.pairs
    .filter((p) => p.defenseKey === defenseKey)
    .sort((a, b) => b.wr - a.wr || b.battles - a.battles);

  const similarDefenses = analysis.defenseTeams
    .filter((d) => d.key !== defenseKey && siegeOverlap(d.team, defense.team) >= 2)
    .sort((a, b) => siegeOverlap(b.team, defense.team) - siegeOverlap(a.team, defense.team) || b.battles - a.battles);
  const similarKeys = new Set(similarDefenses.map((d) => d.key));
  const similarCounters = groupSimilarCounters(dataset, similarKeys).sort(
    (a, b) => (b.battles >= 2 ? 1 : 0) - (a.battles >= 2 ? 1 : 0) || b.wr - a.wr || b.battles - a.battles || b.defenseMatches - a.defenseMatches,
  );

  const exact: SiegeCounterCandidate[] = exactPairs.map((p) => ({
    key: p.counterKey,
    team: p.counter,
    battles: p.battles,
    wins: p.wins,
    losses: p.losses,
    wr: p.wr,
    lastDate: p.lastDate,
    source: "exact",
    defenseMatches: 1,
    guilds: p.guilds,
    reason: `直接對戰 ${p.battles} 場，${p.wins} 勝（${p.wr}%）`,
  }));

  const exactKeys = new Set(exact.map((c) => c.key));
  const score = (c: SiegeCounterCandidate) =>
    c.wr + (c.source === "exact" ? 5 : 0) + Math.min(c.battles, 5) * 0.8 + Math.min(c.defenseMatches, 5) * 0.6;
  const recommendations = [...exact, ...similarCounters.filter((c) => !exactKeys.has(c.key))]
    .sort((a, b) => score(b) - score(a) || b.wr - a.wr || b.battles - a.battles)
    .slice(0, 8);

  let fallbackMonsters: SiegeMonsterStat[] = [];
  if (recommendations.length === 0) {
    const ids = new Set(defense.team);
    const looseBattles = dataset.battles.filter((b) => b.defense.some((id) => ids.has(id)));
    const map = new Map<number, SiegeMonsterStat>();
    for (const battle of looseBattles) {
      for (const id of new Set(battle.counter)) {
        let stat = map.get(id);
        if (!stat) {
          stat = { id, battles: 0, wins: 0, losses: 0, wr: 0 };
          map.set(id, stat);
        }
        stat.battles++;
        if (battle.result === "Victory") stat.wins++;
      }
    }
    fallbackMonsters = [...map.values()]
      .map((s) => ({ ...s, losses: s.battles - s.wins, wr: siegeWinRate(s.wins, s.battles) }))
      .sort((a, b) => b.battles - a.battles || b.wr - a.wr)
      .slice(0, 8);
    if (fallbackMonsters.length === 0) fallbackMonsters = analysis.counterMonsters.slice(0, 8);
  }

  return { defense, exactPairs, similarDefenses, similarCounters, recommendations, fallbackMonsters };
}

/** 防守建議：讓 Nosna44 失手的防守隊、防守核心怪物 / 雙人組合、對手公會 */
export function recommendSiegeDefenses(analysis: SiegeBattleAnalysis): SiegeDefenseAdvice {
  const losingDefenses = analysis.defenseTeams
    .filter((d) => d.losses > 0)
    .sort((a, b) => b.losses - a.losses || a.wr - b.wr || b.battles - a.battles);
  const hardDefenses = analysis.defenseTeams
    .filter((d) => d.battles >= 2 && d.wr < 100)
    .sort((a, b) => a.wr - b.wr || b.battles - a.battles);

  const suggestionMap = new Map<string, SiegeTeamStat>();
  for (const defense of [...losingDefenses, ...hardDefenses]) suggestionMap.set(defense.key, defense);
  const suggestions: SiegeDefenseSuggestion[] = [...suggestionMap.values()]
    .sort((a, b) => b.losses - a.losses || b.battles - a.battles || a.wr - b.wr)
    .slice(0, 6)
    .map((defense) => ({
      key: defense.key,
      team: defense.team,
      battles: defense.battles,
      wins: defense.wins,
      losses: defense.losses,
      wr: defense.wr,
      guilds: defense.guilds,
      reason: defense.losses > 0 ? `曾讓 Nosna44 失手 ${defense.losses} 次` : `Nosna44 對這隊勝率只有 ${defense.wr}%`,
      counters: analysis.pairs
        .filter((p) => p.defenseKey === defense.key)
        .sort((a, b) => b.wr - a.wr || b.battles - a.battles),
    }));

  const coreMonsters = analysis.defenseMonsters
    .filter((m) => m.battles >= 20)
    .sort((a, b) => a.wr - b.wr || b.battles - a.battles)
    .slice(0, 10);
  const pairDifficulty = (p: SiegeDefensePairStat) => p.losses * Math.sqrt(p.battles);
  const corePairs = analysis.defensePairs
    .filter((p) => p.battles >= 15)
    .sort((a, b) => pairDifficulty(b) - pairDifficulty(a) || a.wr - b.wr || b.battles - a.battles)
    .slice(0, 10);
  const guilds = analysis.defenseGuilds
    .filter((g) => g.battles >= 5)
    .sort((a, b) => a.wr - b.wr || b.battles - a.battles)
    .slice(0, 15);

  return { losingDefenses, hardDefenses, suggestions, coreMonsters, corePairs, guilds, losingBattles: analysis.losses };
}

/** 以某個防守雙人核心為中心，列出搭配的第三隻與實際對戰成績 */
export function siegeDefenseVariants(dataset: SiegeDataset, coreIds: number[]): SiegeDefenseVariant[] {
  const core = new Set(coreIds);
  const map = new Map<number, {
    team: number[];
    battles: number;
    wins: number;
    guilds: Set<string>;
    lastDate: string;
  }>();
  for (const battle of dataset.battles) {
    if (battle.defense.filter((id) => core.has(id)).length < coreIds.length) continue;
    const third = battle.defense.find((id) => !core.has(id));
    if (!third) continue;
    let item = map.get(third);
    if (!item) {
      item = { team: [...coreIds, third].sort((a, b) => a - b), battles: 0, wins: 0, guilds: new Set(), lastDate: "" };
      map.set(third, item);
    }
    item.battles++;
    if (battle.result === "Victory") item.wins++;
    if (battle.defenseGuild) item.guilds.add(battle.defenseGuild);
    if (!item.lastDate || siegeDateValue(battle.date) > siegeDateValue(item.lastDate)) item.lastDate = battle.date;
  }
  return [...map.entries()].map(([monsterId, item]) => {
    const wr = siegeWinRate(item.wins, item.battles);
    return {
      monsterId,
      team: item.team,
      battles: item.battles,
      wins: item.wins,
      losses: item.battles - item.wins,
      wr,
      guilds: [...item.guilds],
      lastDate: item.lastDate,
    };
  }).sort((a, b) => b.battles - a.battles || a.wr - b.wr);
}

/** 給頁面用的格式：MM/DD/YYYY hh:mm AM → 2026/10/29 */
export function siegeShortDate(date: string): string {
  const match = date.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? `${match[3]}/${match[1]}/${match[2]}` : date;
}
