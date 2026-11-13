import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  AlertTriangle, Check, ChevronDown, ChevronUp, Copy, Gauge, Layers, Loader2, Lock, Pin, Plus, RotateCcw, Save, Search,
  Shirt, Trash2, Users, Wand2, Zap,
} from "lucide-react";
import { monsterLabel, unitLabel, useLibrary, useStore, type DeckFav, type DeckFavUnit } from "../store";
import { useSummary, type UnitView } from "../lib/accountStats";
import { MonsterIcon, Modal, NumberInput, RuneCard, RuneBoard, StatRows, TickBadge, fmt, ArtifactCard } from "../components/ui";
import { FocusEditor } from "../components/FocusEditor";
import { MonsterPickerModal, sortMonsterEntries } from "../components/MonsterPicker";
import { RUNE_SETS, SET_BY_ID, type StatKey } from "../lib/constants";
import { setSummary, speedForTick, statsForRunes } from "../lib/stats";
import { deckSetupFromRunes } from "../lib/deckSetup";
import {
  DECK_CONTEXT_LABEL, deckContext, type DeckContext,
} from "../lib/deckSpeed";
import { deckTypeLabel } from "../lib/deckTypes";
import { artifactSpeedBuffPct } from "../lib/artifacts";
import { loadSkillData, skillsForMonster, type DamageOptions, type Skill, type SkillData } from "../lib/damage";
import { autoAssignRoles, roleSetup, type RoleUnit } from "../lib/teamRoles";
import { battleSpeedForPanelExtra, computeFollowPlan, leadBonus, mirrorTimeline, orderSafeFloorSpeeds, panelExtraFor } from "../lib/teamSpeed";
import {
  TEAM_ROLE_LABELS, roleObjective, runeSupply, teamSetsOf,
  type TeamBuild, type TeamMemberSpec, type TeamPlan, type TeamProgress, type TeamRequest, type TeamRole,
} from "../lib/teamOptimizer";
import { normalizeFocus, type OptRequest, type TopBuild } from "../lib/optimizer";
import { TEAM_TEMPLATES, teamTemplateOf, templateMembers, type TeamMemberTemplate, type TeamTemplate } from "../lib/teamTemplates";
import { useTeamPresets } from "../lib/teamPresets";
import { useRolePresets, type RolePreset } from "../lib/rolePresets";
import type { FocusEntry } from "../lib/types";

/** 每隻魔靈的搜尋目標 */
type ObjectiveMode = "role" | "skill" | "spd" | "atk" | "def" | "hp" | "dps" | "tank" | "support" | "score";

const OBJECTIVE_LABELS: Record<ObjectiveMode, string> = {
  role: "依定位",
  skill: "技能傷害",
  spd: "速度",
  atk: "攻擊",
  def: "防禦",
  hp: "體力",
  dps: "傷害期望",
  tank: "坦度 EHP",
  support: "綜合",
  score: "符文評分",
};

const MIN_LABELS: Record<StatKey, string> = {
  hp: "體力",
  atk: "攻擊",
  def: "防禦",
  spd: "速度",
  cr: "暴率",
  cd: "暴傷",
  res: "抵抗",
  acc: "命中",
};

/** 技能傷害目標固定使用的傷害選項（只用來排序，與實際對手無關） */
const TEAM_DAMAGE_OPTS: DamageOptions = {
  crit: "average",
  skillUps: true,
  enemyDef: 0,
  enemyMaxHp: 0,
  enemyHpPct: 100,
  enemySpd: 0,
  selfHpPct: 100,
  atkBuff: 0,
  leadAtk: 0,
  defBreak: false,
  brand: false,
  ignoreDef: false,
  aliveEnemies: 1,
  alliesAlive: 4,
  useGuild: false,
  enemyEl: 0,
  useArtifacts: false,
};

/**
 * 技能傷害目標的預設技能：優先挑 S1～S3 裡有倍率公式的技能並取最高階，
 * 讓「多數魔靈的第 3 技」成為預設（S4 常是覺醒被動 / 特殊技）。
 */
function defaultAttackSkill(skills: Skill[]): Skill | undefined {
  if (skills.length === 0) return undefined;
  const active = skills.filter((s) => s.slot <= 3);
  const pool = active.length > 0 ? active : skills;
  return [...pool].sort((a, b) => b.slot - a.slot || a.id - b.id)[0];
}

/** 每隻魔靈在頁面上的設定（尚未轉成引擎需求） */
interface MemberDraft {
  unitId: number;
  role: TeamRole;
  /** 套用的自訂定位（預設定位）id；沒有套用時為 undefined */
  presetId?: string;
  title: string;
  weight: number;
  /** 優先順序：1 = 最優先；0 = 不指定（依權重） */
  priority: number;
  /** 搜尋目標：依角色 / 技能傷害 / 速度 / 傷害 / 坦度 / 綜合 / 評分 */
  objectiveMode: ObjectiveMode;
  /** 技能傷害目標的技能 id；0 = 自動選最後一招（通常是 S3） */
  skillId: number;
  /** 技能傷害目標的技能欄位（S1～S4）；0 = 沒有指定，套用隊型時用來跨魔靈對應技能 */
  skillSlot: number;
  /** 4 件套；0 = 不指定 */
  set4: number;
  /** 2 件套（第一組）；0 = 不指定 */
  set2: number;
  /** 2 件套（第二組）；set4 = 0 時可用來組 3×2 */
  set2b: number;
  /** 2 件套（第三組）；set4 = 0 時可用來組 3×2 */
  set2c: number;
  mains: Partial<Record<number, number>>;
  min: Partial<Record<StatKey, number>>;
  /** 數值上限（實戰數值；0 / 未設定 = 不限） */
  max: Partial<Record<StatKey, number>>;
  /** 目標 Tick；0 = 不限（只在「目標 Tick」模式生效） */
  tick: number;
  /** 速度條件：面板速度或目標 Tick（二選一，預設面板速度） */
  speedMode: "panel" | "tick";
  /** 面板額外速度（基礎速度以外）；0 = 不指定，面板速度會覆寫目標 Tick */
  panelExtra: number;
  /** 面板額外速度上限；0 = 不限 */
  panelExtraMax: number;
  /** 攻擊順序；1 = 最先 */
  order: number;
  /** 這隻魔靈會收到的提條 % */
  boostPct: number;
  /** 是否有速度強化（+30%，神器可放大） */
  speedBuff: boolean;
  /** 神器「速度增加效果 +%」 */
  artifactPct: number;
  /** 速度隊長技 %；null = 跟隨全隊數值，0 = 這隻不吃隊長技 */
  leadPct: number | null;
  focus: FocusEntry[];
  /** 使用者按「固定這隻」後鎖住的符文 */
  includeRunes: number[];
}

type Size = 3 | 4 | 5;
type BudgetKey = "fast" | "standard" | "full";
type OwnedUnit = UnitView & { _dup: boolean };

const BUDGETS: Record<BudgetKey, { label: string; pool: number; topK: number; beam: number; nodes: number; hint: string }> = {
  fast: { label: "快速", pool: 9, topK: 36, beam: 28, nodes: 2_000_000, hint: "約 0.5–1 秒" },
  standard: { label: "標準", pool: 10, topK: 60, beam: 48, nodes: 4_000_000, hint: "約 1–3 秒" },
  full: { label: "完整", pool: 12, topK: 90, beam: 72, nodes: 8_000_000, hint: "約 3–8 秒" },
};

const FOUR_SETS = RUNE_SETS.filter((s) => s.pieces === 4);
const TWO_SETS = RUNE_SETS.filter((s) => s.pieces === 2 && s.id !== 25 && s.id !== 99);

/** 數值上限 / 下限的錯誤訊息用 */
const STAT_LABEL_ZH: Record<StatKey, string> = {
  hp: "體力",
  atk: "攻擊",
  def: "防禦",
  spd: "速度",
  cr: "暴率",
  cd: "暴傷",
  res: "抵抗",
  acc: "命中",
};

/** 2/4/6 號主屬性（與配符頁相同的 SWEX type id） */
const MAIN_OPTIONS: Record<number, { v: number; label: string }[]> = {
  2: [
    { v: 0, label: "不限" }, { v: 8, label: "速度" },
    { v: 1, label: "固定體力" }, { v: 2, label: "體力%" },
    { v: 3, label: "固定攻擊" }, { v: 4, label: "攻擊%" },
    { v: 5, label: "固定防禦" }, { v: 6, label: "防禦%" },
  ],
  4: [
    { v: 0, label: "不限" }, { v: 9, label: "暴擊率" }, { v: 10, label: "暴擊傷害" },
    { v: 1, label: "固定體力" }, { v: 2, label: "體力%" },
    { v: 3, label: "固定攻擊" }, { v: 4, label: "攻擊%" },
    { v: 5, label: "固定防禦" }, { v: 6, label: "防禦%" },
  ],
  6: [
    { v: 0, label: "不限" },
    { v: 1, label: "固定體力" }, { v: 2, label: "體力%" },
    { v: 3, label: "固定攻擊" }, { v: 4, label: "攻擊%" },
    { v: 5, label: "固定防禦" }, { v: 6, label: "防禦%" },
    { v: 12, label: "效果命中" }, { v: 11, label: "效果抵抗" },
  ],
};

function draftFromTemplate(t: TeamMemberTemplate, unitId = 0): MemberDraft {
  const set4 = t.sets.find((s) => s.count >= 4)?.set ?? 0;
  const twos = t.sets.filter((s) => s.set > 0 && s.count < 4);
  return {
    unitId,
    role: t.role,
    title: t.title,
    weight: t.weight,
    priority: t.priority ?? 0,
    objectiveMode: t.objective ?? "role",
    skillId: 0,
    skillSlot: t.skillSlot ?? 0,
    set4,
    set2: twos[0]?.set ?? 0,
    set2b: set4 ? 0 : twos[1]?.set ?? 0,
    set2c: set4 ? 0 : twos[2]?.set ?? 0,
    mains: { ...t.mains },
    min: { ...t.min },
    max: {},
    tick: t.tick,
    // 面板速度與目標 Tick 二選一；隊型可指定要哪一種
    speedMode: t.speedMode === "tick" ? "tick" : "panel",
    panelExtra: t.panelExtra ?? 0,
    panelExtraMax: 0,
    order: t.order ?? 1,
    boostPct: t.boostPct ?? 0,
    speedBuff: t.speedBuff ?? false,
    artifactPct: t.artifactPct ?? 0,
    leadPct: null,
    focus: t.focus.map((f) => ({ ...f })),
    includeRunes: [],
  };
}

function initialMembers(): MemberDraft[] {
  return templateMembers(teamTemplateOf("guild-speed"), 3).map((t) => draftFromTemplate(t));
}

/** 單隻「重置」後的空白設定：保留魔靈，其餘全部回到預設（定位＝自由） */
function blankMember(unitId = 0): MemberDraft {
  return {
    unitId,
    role: "free",
    presetId: undefined,
    title: TEAM_ROLE_LABELS.free,
    weight: 1,
    priority: 0,
    objectiveMode: "role",
    skillId: 0,
    skillSlot: 0,
    set4: 0,
    set2: 0,
    set2b: 0,
    set2c: 0,
    mains: {},
    min: {},
    max: {},
    tick: 0,
    speedMode: "panel",
    panelExtra: 0,
    panelExtraMax: 0,
    order: 1,
    boostPct: 0,
    speedBuff: false,
    artifactPct: 0,
    leadPct: null,
    focus: [],
    includeRunes: [],
  };
}

const STORAGE_KEY = "swtick:team-opt:v1";
const CONTEXTS: DeckContext[] = ["arena", "guild", "dungeon"];
const BUDGET_KEYS: BudgetKey[] = ["fast", "standard", "full"];
/** 結果頁一次顯示幾組替代隊伍 */
const RESULT_PAGE_SIZE = 10;
/** 表格檢視一頁幾組 */
const TABLE_PAGE_SIZE = 10;

/**
 * 表格檢視時每隻魔靈的專屬顏色（最多 15 隻，全部不重複）。
 * 只用在「一鍵配隊 → 表格」的欄位分組，讓一眼就能看出數值屬於哪一隻。
 */
const MEMBER_ACCENTS: { c: string; rgb: string }[] = [
  { c: "#f2c65c", rgb: "242, 198, 92" },
  { c: "#5aa9ff", rgb: "90, 169, 255" },
  { c: "#43d98a", rgb: "67, 217, 138" },
  { c: "#c084fc", rgb: "192, 132, 252" },
  { c: "#ff9f5a", rgb: "255, 159, 90" },
  { c: "#ff7ac6", rgb: "255, 122, 198" },
  { c: "#4de2e8", rgb: "77, 226, 232" },
  { c: "#b9e35c", rgb: "185, 227, 92" },
  { c: "#ff8a80", rgb: "255, 138, 128" },
  { c: "#8f9bff", rgb: "143, 155, 255" },
  { c: "#5ce0b8", rgb: "92, 224, 184" },
  { c: "#ffd166", rgb: "255, 209, 102" },
  { c: "#7bd0ff", rgb: "123, 208, 255" },
  { c: "#e8a0ff", rgb: "232, 160, 255" },
  { c: "#a3e635", rgb: "163, 230, 53" },
];
const memberAccent = (index: number) => MEMBER_ACCENTS[index % MEMBER_ACCENTS.length];
/** 把魔靈代表色傳給 CSS（--mc = "r, g, b"；--mc-c = 主要色碼） */
const accentVars = (index: number): CSSProperties => {
  const a = memberAccent(index);
  return { "--mc": a.rgb, "--mc-c": a.c } as CSSProperties;
};
/** 表格篩選最多 4 個條件 */
const MAX_TABLE_FILTERS = 4;
/** 可選的回傳隊伍數（1 組主結果 + 其他替代） */
const RESULT_COUNTS = [5, 10, 20, 50, 100] as const;

/** 表格檢視可顯示 / 篩選 / 排序的面板數值 */
type TableStatKey = "panelSpd" | "spd" | "hp" | "atk" | "def" | "cr" | "cd" | "res" | "acc" | "ehp";
const TABLE_STATS: { key: TableStatKey; label: string; pct?: boolean }[] = [
  { key: "panelSpd", label: "面板速" },
  { key: "spd", label: "戰鬥速" },
  { key: "hp", label: "體力" },
  { key: "atk", label: "攻擊" },
  { key: "def", label: "防禦" },
  { key: "cr", label: "暴率", pct: true },
  { key: "cd", label: "暴傷", pct: true },
  { key: "res", label: "抵抗", pct: true },
  { key: "acc", label: "命中", pct: true },
  { key: "ehp", label: "EHP" },
];
const TABLE_STAT_LABEL: Record<TableStatKey, string> = Object.fromEntries(
  TABLE_STATS.map((s) => [s.key, s.label]),
) as Record<TableStatKey, string>;

interface TableFilter {
  member: number;
  stat: TableStatKey;
  min?: number;
  max?: number;
}
interface TableSort {
  member: number | null;
  stat: TableStatKey | "score";
  dir: "asc" | "desc";
}

/** 表格顯示 / 篩選 / 排序用的數值（面板速優先使用 panelSpd） */
function tableStatValue(m: TeamBuild, key: TableStatKey): number {
  if (key === "ehp") return m.ehp;
  if (key === "panelSpd") return m.stats.panelSpd ?? m.stats.spd;
  return m.stats[key];
}

function tableStatText(value: number, stat: TableStatKey): string {
  if (stat === "cr" || stat === "cd" || stat === "res" || stat === "acc") return `${Math.round(value)}%`;
  if (stat === "hp" || stat === "atk" || stat === "def" || stat === "ehp") return fmt(value);
  return String(Math.round(value));
}

/** 一次配幾隊（每隊 3～5 人，合計最多 15 隻） */
type TeamCount = 1 | 2 | 3;
/** 配隊方式：整隊聯合挑選，或逐隻配＋排除（SWOP 流程） */
type OptimizeMode = "team" | "sequential";

/** 逐隻模式找不到結果時的放寬順序（與整隊引擎相同） */
const SEQ_LADDER: { mains: boolean; relaxSub: boolean; noSets: boolean; note: string | null }[] = [
  { mains: false, relaxSub: false, noSets: false, note: null },
  { mains: true, relaxSub: false, noSets: false, note: "找不到原本的條件，已改為不限主屬性。" },
  { mains: true, relaxSub: true, noSets: false, note: "找不到原本的條件，已改為不限主屬性、允許破套。" },
  { mains: true, relaxSub: true, noSets: true, note: "找不到原本的條件，已改為不限套裝與主屬性。" },
];

/** 頁面關掉 / 換頁再回來（或重新整理）時要保留的設定與結果 */
interface SavedState {
  templateId: string;
  size: Size;
  teams: TeamCount;
  content: DeckContext;
  members: MemberDraft[];
  /** 每隊的速度隊長技 %（長度 3，用不到的隊伍保留 0） */
  leadPcts: number[];
  budgetKey: BudgetKey;
  /** 要顯示幾組隊伍（含主結果） */
  resultCount: number;
  /** team = 整隊聯合配；sequential = 逐隻配＋排除 */
  optMode: OptimizeMode;
  oppSpd: number;
  plan: TeamPlan | null;
  altIndex: number;
  /** 存檔版本（account.importedAt）；換帳號時舊結果會作廢 */
  importedAt: number | null;
}

const clampPct = (n: unknown): number => Math.max(0, Math.min(50, Number(n) || 0));

function loadSaved(): SavedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedState> & { leadPct?: number };
    const templateId = typeof v.templateId === "string" && v.templateId ? v.templateId : "guild-speed";
    const size: Size = v.size === 4 || v.size === 5 ? v.size : 3;
    const teams: TeamCount = v.teams === 2 || v.teams === 3 ? v.teams : 1;
    const content: DeckContext = CONTEXTS.includes(v.content as DeckContext) ? (v.content as DeckContext) : "guild";
    const budgetKey: BudgetKey = BUDGET_KEYS.includes(v.budgetKey as BudgetKey) ? (v.budgetKey as BudgetKey) : "standard";
    const resultCount = RESULT_COUNTS.includes(v.resultCount as (typeof RESULT_COUNTS)[number])
      ? (v.resultCount as number)
      : 20;
    const optMode: OptimizeMode = v.optMode === "sequential" ? "sequential" : "team";
    const total = teams * size;
    const slots = templateMembers(teamTemplateOf(templateId), size);
    const fallback = Array.from({ length: total }, (_, i) => draftFromTemplate(slots[i % size]));
    const members =
      Array.isArray(v.members) && v.members.length > 0
        ? v.members.slice(0, total).map((m, i) => ({ ...fallback[i], ...(m as MemberDraft) }))
        : fallback;
    while (members.length < total) members.push(draftFromTemplate(slots[members.length % size]));
    // 舊版只有單一 leadPct，升級成每隊一組
    const leadPcts = Array.isArray(v.leadPcts)
      ? [0, 1, 2].map((i) => clampPct(v.leadPcts![i] ?? 0))
      : [clampPct(v.leadPct), 0, 0];
    const plan =
      v.plan && Array.isArray(v.plan.members) && Array.isArray(v.plan.alternatives) ? (v.plan as TeamPlan) : null;
    const altIndex = plan && typeof v.altIndex === "number" ? Math.max(0, Math.min(plan.alternatives.length, Math.round(v.altIndex))) : 0;
    return {
      templateId,
      size,
      teams,
      content,
      members,
      leadPcts,
      budgetKey,
      resultCount,
      optMode,
      oppSpd: typeof v.oppSpd === "number" ? v.oppSpd : 0,
      plan,
      altIndex,
      importedAt: typeof v.importedAt === "number" ? v.importedAt : null,
    };
  } catch {
    return null;
  }
}

export default function TeamOptimizerPage() {
  const account = useStore((s) => s.account);
  const runeMap = useStore((s) => s.runeMap);
  const settings = useStore((s) => s.settings);
  const summary = useSummary();
  const notify = useStore((s) => s.notify);
  const saveDeckFav = useStore((s) => s.saveDeckFav);
  const { deckFavs } = useLibrary();
  const equipTeam = useStore((s) => s.equipTeam);
  const setRuneFlag = useStore((s) => s.setRuneFlag);

  const bonus = settings.bonus;
  const rta = settings.rta;

  const [saved] = useState(loadSaved);
  const [templateId, setTemplateId] = useState(saved?.templateId ?? "guild-speed");
  const [size, setSize] = useState<Size>(saved?.size ?? 3);
  /** 一次配幾隊；每隊 size 隻 */
  const [teams, setTeams] = useState<TeamCount>(saved?.teams ?? 1);
  const [content, setContent] = useState<DeckContext>(saved?.content ?? "guild");
  const [members, setMembers] = useState<MemberDraft[]>(saved?.members ?? initialMembers);
  /** 每隊的速度隊長技 %；個別成員可在卡片上覆寫 */
  const [leadPcts, setLeadPcts] = useState<number[]>(saved?.leadPcts ?? [0, 0, 0]);
  const [budgetKey, setBudgetKey] = useState<BudgetKey>(saved?.budgetKey ?? "standard");
  const [resultCount, setResultCount] = useState<number>(saved?.resultCount ?? 20);
  const [optMode, setOptMode] = useState<OptimizeMode>(saved?.optMode ?? "team");
  /** 結果顯示方式：卡片或表格 */
  const [resultView, setResultView] = useState<"cards" | "table">("cards");
  /** 表格篩選 / 排序 / 分頁 */
  const [tableFilters, setTableFilters] = useState<TableFilter[]>([]);
  const [tableSort, setTableSort] = useState<TableSort>({ member: null, stat: "score", dir: "desc" });
  const [tablePage, setTablePage] = useState(0);
  const [filterMember, setFilterMember] = useState(0);
  const [filterStat, setFilterStat] = useState<TableStatKey>("panelSpd");
  const [filterMin, setFilterMin] = useState("");
  const [filterMax, setFilterMax] = useState("");

  /** 逐隻配＋排除：目前已選的配裝（null = 尚未選） */
  const [seqPicks, setSeqPicks] = useState<(TopBuild | null)[]>(() => {
    const total = (saved?.members ?? initialMembers()).length;
    if (saved?.optMode === "sequential" && saved.plan?.members.length === total) {
      return saved.plan.members.map((m) => ({
        runeIds: m.runeIds,
        stats: m.stats,
        ehp: m.ehp,
        objective: m.score,
        score: m.score,
        eff: m.eff,
        focusFit: m.focusFit,
      }));
    }
    return Array.from({ length: total }, () => null);
  });
  /** 正在配第幾隻（0-based）；等於成員數 = 已完成 */
  const [seqIndex, setSeqIndex] = useState(() => {
    const total = (saved?.members ?? initialMembers()).length;
    return saved?.optMode === "sequential" && saved.plan?.members.length === total ? total : 0;
  });
  const [seqCandidates, setSeqCandidates] = useState<TopBuild[]>([]);
  const [seqRunning, setSeqRunning] = useState(false);
  const [seqError, setSeqError] = useState<string | null>(null);
  const [seqNote, setSeqNote] = useState<string | null>(null);
  const [seqPage, setSeqPage] = useState(0);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<TeamProgress | null>(null);
  const [plan, setPlan] = useState<TeamPlan | null>(saved?.plan ?? null);
  const [altIndex, setAltIndex] = useState(saved?.altIndex ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [pickerIndex, setPickerIndex] = useState(-1);
  const [deckOpen, setDeckOpen] = useState(false);
  const [pinDeckRunes, setPinDeckRunes] = useState(false);
  /** 從預設隊載入時，把目前的套裝、主屬性與面板下限一起帶入 */
  const [importDeckSetup, setImportDeckSetup] = useState(true);
  /** 鏡像對手（防守提條角）速度；0 = 自動使用起手速度 */
  const [oppSpd, setOppSpd] = useState(saved?.oppSpd ?? 0);
  /** 手機版：展開中的隊員設定（桌機一律全部顯示） */
  const [openMembers, setOpenMembers] = useState<Set<number>>(() => new Set([0]));
  /** 手機版：展開中的配隊結果（以 unitId 為 key） */
  const [openResults, setOpenResults] = useState<Set<number>>(() => new Set());
  /** 手機版：接速檢查是否展開 */
  const [openFollow, setOpenFollow] = useState(false);

  const toggleMemberOpen = (index: number) =>
    setOpenMembers((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const toggleResultOpen = (unitId: number) =>
    setOpenResults((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });

  /** 清空逐隻配＋排除的進度（改設定、換隊型或重新開始時） */
  const resetSequence = (length = members.length) => {
    seqWorkerRef.current?.terminate();
    seqWorkerRef.current = null;
    seqRunIdRef.current++;
    setSeqPicks(Array.from({ length }, () => null));
    setSeqIndex(0);
    setSeqCandidates([]);
    setSeqRunning(false);
    setSeqError(null);
    setSeqNote(null);
    setSeqPage(0);
  };

  /** 玩家自訂的預設定位 */
  const presets = useRolePresets((s) => s.presets);
  const presetsReady = useRolePresets((s) => s.ready);
  const hydratePresets = useRolePresets((s) => s.hydrate);
  const saveRolePreset = useRolePresets((s) => s.save);
  const removeRolePreset = useRolePresets((s) => s.remove);
  const [presetModal, setPresetModal] = useState<{ index: number; name: string } | null>(null);

  /** 玩家自訂的隊型（存在這台裝置的 IndexedDB） */
  const customTemplates = useTeamPresets((s) => s.templates);
  const teamPresetsReady = useTeamPresets((s) => s.ready);
  const hydrateTeamPresets = useTeamPresets((s) => s.hydrate);
  const saveTeamPreset = useTeamPresets((s) => s.save);
  const removeTeamPreset = useTeamPresets((s) => s.remove);
  const [teamPresetModal, setTeamPresetModal] = useState<{ name: string; desc: string } | null>(null);

  useEffect(() => {
    void hydratePresets();
    void hydrateTeamPresets();
  }, [hydratePresets, hydrateTeamPresets]);

  const allTemplates = useMemo<TeamTemplate[]>(
    () => [...TEAM_TEMPLATES, ...customTemplates],
    [customTemplates],
  );
  const templateOf = (id: string) => allTemplates.find((t) => t.id === id) ?? teamTemplateOf(id);

  // 自訂隊型被刪除（或換裝置）時，回到內建自訂隊型，避免下拉選單空白
  useEffect(() => {
    if (!teamPresetsReady) return;
    if (!allTemplates.some((t) => t.id === templateId)) setTemplateId("custom");
  }, [teamPresetsReady, allTemplates, templateId]);

  // 預設定位被刪除時，正在使用它的成員回到內建定位（要等讀取完成才判斷，避免誤清）
  useEffect(() => {
    if (!presetsReady) return;
    const ids = new Set(presets.map((p) => p.id));
    setMembers((prev) => {
      if (!prev.some((m) => m.presetId && !ids.has(m.presetId))) return prev;
      return prev.map((m) =>
        m.presetId && !ids.has(m.presetId)
          ? { ...m, presetId: undefined, title: TEAM_ROLE_LABELS[m.role] }
          : m,
      );
    });
  }, [presets, presetsReady]);

  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);
  /** 逐隻模式的單隻配符 Worker（optimizer.worker） */
  const seqWorkerRef = useRef<Worker | null>(null);
  const seqRunIdRef = useRef(0);
  /** 技能資料（判斷提條技能用）；載入後快取，之後切換隊型不必再等 */
  const skillRef = useRef<SkillData | null>(null);
  /** 技能下拉選單用（與 skillRef 同步） */
  const [skillData, setSkillData] = useState<SkillData | null>(null);

  const template = templateOf(templateId);
  const activeCustomTemplate = customTemplates.find((t) => t.id === templateId);
  const budget = BUDGETS[budgetKey];

  // 換帳號時清掉舊結果與已不存在的魔靈（上符只會改 account，不會改 importedAt）
  const importedAtRef = useRef<number | null>(saved?.importedAt ?? null);
  useEffect(() => {
    if (account && importedAtRef.current !== account.importedAt) {
      importedAtRef.current = account.importedAt;
      setPlan(null);
      setError(null);
      resetSequence();
    }
    setMembers((prev) => {
      if (!summary) return prev;
      const ids = new Set(summary.views.map((v) => v.unit.id));
      return prev.map((m) => (m.unitId && !ids.has(m.unitId) ? { ...m, unitId: 0, includeRunes: [], panelExtra: 0 } : m));
    });
  }, [account, summary]);

  // 設定與結果存到瀏覽器：跳去其他頁面再回來、或重新整理都不會不見
  useEffect(() => {
    const data: SavedState = {
      templateId, size, teams, content, members, leadPcts, budgetKey, resultCount, optMode, oppSpd, plan, altIndex,
      importedAt: account?.importedAt ?? null,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* 忽略儲存失敗（例如容量不足） */
    }
  }, [templateId, size, teams, content, members, leadPcts, budgetKey, resultCount, optMode, oppSpd, plan, altIndex, account?.importedAt]);

  // 表格篩選 / 排序變動或換了結果時回到第 1 頁
  useEffect(() => {
    setTablePage(0);
  }, [tableFilters, tableSort, plan]);

  // 隊長技全部由數值欄位決定，不再依魔靈自動判斷

  // 技能資料先預載：從儲存庫載入預設隊時要用它判斷哪隻是提條角
  useEffect(() => {
    let alive = true;
    loadSkillData()
      .then((d) => { if (alive) { skillRef.current = d; setSkillData(d); } })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    seqWorkerRef.current?.terminate();
    seqWorkerRef.current = null;
  }, []);

  const viewOf = (unitId: number): UnitView | undefined =>
    summary?.views.find((v) => v.unit.id === unitId);

  /** 顯示名稱：優先使用魔靈的自訂名稱（重複魔靈會加上數字） */
  const nameOf = (unitId: number, master: number): string => {
    const u = viewOf(unitId)?.unit;
    return u ? unitLabel(u) : monsterLabel(master);
  };

  /** 技能資料只有第一次需要下載／解析 */
  const ensureSkills = async (): Promise<SkillData | null> => {
    if (skillRef.current) return skillRef.current;
    try {
      const d = await loadSkillData();
      skillRef.current = d;
      return d;
    } catch {
      return null;
    }
  };

  /** 依魔靈技能自動安排角色、出手順序與預設配裝；隊型不含速隊長／提條時回傳 null */
  const withAutoRoles = (
    drafts: MemberDraft[],
    ctx: DeckContext,
    slots: TeamRole[],
    skillData: SkillData | null,
  ): { members: MemberDraft[]; leadPct: number } | null => {
    if (!summary || drafts.some((d) => !d.unitId)) return null;
    const units: RoleUnit[] = [];
    for (const d of drafts) {
      const v = viewOf(d.unitId);
      if (!v) return null;
      units.push({ master: v.monster.id, element: v.monster.el, baseSpd: v.base.spd });
    }
    const outcome = autoAssignRoles({ units, slots, context: ctx, skillData });
    if (!outcome) return null;
    const byIndex = new Map(outcome.assignments.map((a) => [a.unitIndex, a]));
    const next = drafts.map((d, i) => {
      const a = byIndex.get(i);
      if (!a) return d;
      const setup = roleSetup(a.role);
      return {
        ...d,
        role: a.role,
        presetId: undefined,
        title: setup.title,
        weight: setup.weight,
        set4: setup.set4,
        set2: setup.set2,
        set2b: 0,
        set2c: 0,
        mains: { ...setup.mains },
        min: { ...setup.min },
        max: {},
        tick: setup.tick,
        order: a.order,
        leadPct: a.leadPct,
        focus: setup.focus.map((f) => ({ ...f })),
      };
    });
    return { members: next, leadPct: outcome.leadPct };
  };

  /** 通知列用的角色摘要（依出手順序） */
  const roleSummary = (list: MemberDraft[]) =>
    [...list]
      .sort((a, b) => a.order - b.order)
      .map((m) => {
        const v = viewOf(m.unitId);
        return `${TEAM_ROLE_LABELS[m.role]} ${v ? unitLabel(v.unit) : "？"}`;
      })
      .join("、");

  const applyTemplate = async (id: string, nextSize?: Size) => {
    const t = templateOf(id);
    const isCustom = customTemplates.some((c) => c.id === id);
    const s = nextSize ?? size;
    const slots = templateMembers(t, s);
    const skills = await ensureSkills();

    /** 自訂隊型以使用者設定的定位、順序與配裝為準，只保留自動判定的隊長技 */
    const mergeCustomMember = (m: MemberDraft, d: MemberDraft): MemberDraft => ({
      ...m,
      role: d.role,
      presetId: undefined,
      title: d.title,
      weight: d.weight,
      priority: d.priority,
      set4: d.set4,
      set2: d.set2,
      set2b: d.set2b,
      set2c: d.set2c,
      mains: { ...d.mains },
      min: { ...d.min },
      max: { ...d.max },
      tick: d.tick,
      speedMode: d.speedMode,
      panelExtra: d.panelExtra,
      panelExtraMax: d.panelExtraMax,
      objectiveMode: d.objectiveMode,
      skillId: d.skillId,
      skillSlot: d.skillSlot,
      order: d.order,
      boostPct: d.boostPct,
      speedBuff: d.speedBuff,
      focus: d.focus.map((f) => ({ ...f })),
    });

    const nextMembers: MemberDraft[] = [];
    const nextLead = [...leadPcts];
    for (let team = 0; team < teams; team++) {
      const start = team * s;
      const drafts = slots.map((tm, k) => {
        const existing = members[start + k];
        const d = draftFromTemplate(tm, existing?.unitId ?? 0);
        // 神器速度增加效果是跟著魔靈走的，換隊型時保留已自動帶入的數值
        if (existing?.unitId && existing.unitId === d.unitId) d.artifactPct = existing.artifactPct;
        // 隊型指定技能欄位時，依目前選到的魔靈換算成實際技能 id
        if (d.unitId && d.skillSlot && skills) {
          const v = viewOf(d.unitId);
          const sk = v ? skillsForMonster(skills, v.monster.id).find((x) => x.slot === d.skillSlot) : undefined;
          if (sk) d.skillId = sk.id;
        }
        return d;
      });
      const auto = withAutoRoles(drafts, t.content, slots.map((tm) => tm.role), skills);
      if (auto) {
        nextMembers.push(...auto.members.map((m, k) => (isCustom ? mergeCustomMember(m, drafts[k]) : m)));
        nextLead[team] = auto.leadPct;
      } else {
        nextMembers.push(...drafts);
      }
    }

    setTemplateId(id);
    setSize(s);
    setContent(t.content);
    setLeadPcts(nextLead);
    setMembers(nextMembers);
    setPlan(null);
    setError(null);
    resetSequence(teams * s);
    notify(
      teams > 1
        ? `已套用隊型到 ${teams} 隊（共 ${teams * s} 隻）${nextLead.some((p) => p > 0) ? `，速度隊長技 ${nextLead.slice(0, teams).map((p) => `${p}%`).join(" / ")}` : ""}`
        : `已依技能安排定位：${roleSummary(nextMembers)}${nextLead[0] > 0 ? `（速度隊長技 +${nextLead[0]}%）` : ""}`,
    );
  };

  /** 改變隊數 / 每隊人數：保留每一隊已選的魔靈，不足的用隊型預設補滿 */
  const changeShape = (nextTeams: TeamCount, nextSize: Size) => {
    const prevSize = size;
    const defaults = templateMembers(templateOf(templateId), nextSize);
    setMembers((prev) => {
      const next: MemberDraft[] = [];
      for (let t = 0; t < nextTeams; t++) {
        const kept = prev
          .slice(t * prevSize, (t + 1) * prevSize)
          .slice(0, nextSize)
          .map((m) => ({ ...m, order: Math.max(1, Math.min(nextSize, m.order)) }));
        while (kept.length < nextSize) kept.push(draftFromTemplate(defaults[kept.length % nextSize]));
        next.push(...kept);
      }
      return next;
    });
    setTeams(nextTeams);
    setSize(nextSize);
    setPlan(null);
    setError(null);
    resetSequence(nextTeams * nextSize);
  };

  /** 只重新安排某一隊的定位（依技能） */
  const autoAssignTeam = async (team: number) => {
    const start = team * size;
    const drafts = members.slice(start, start + size).map((m) => ({ ...m }));
    if (drafts.length === 0 || drafts.some((m) => !m.unitId)) {
      return notify(`第 ${team + 1} 隊還有位置未選擇魔靈`, "err");
    }
    const skills = await ensureSkills();
    const auto = withAutoRoles(drafts, content, drafts.map((m) => m.role), skills);
    if (!auto) return notify("這個隊型沒有速隊長或提條，無法自動安排定位", "err");
    setMembers((prev) => prev.map((m, i) => (i >= start && i < start + size ? auto.members[i - start] : m)));
    setLeadPcts((prev) => prev.map((p, k) => (k === team ? auto.leadPct : p)));
    setPlan(null);
    resetSequence();
    notify(`已依技能安排第 ${team + 1} 隊的定位：${roleSummary(auto.members)}`);
  };

  /** 從預設隊快照回推一鍵配隊的設定（套裝／主屬性／數值下限） */
  const deckSetupOf = (v: UnitView, du: DeckFavUnit) => {
    const runes = (du.runeIds ?? [])
      .map((id) => runeMap.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r);
    const artifactMap = new Map((account?.artifacts ?? []).map((a) => [a.id, a]));
    const artifacts = (du.artifactIds ?? [])
      .map((id) => artifactMap.get(id))
      .filter((a): a is NonNullable<typeof a> => !!a);
    // 用實戰數值（不含公會）當下限，和一鍵配隊引擎的比較基準一致
    const stats = statsForRunes(v.base, runes, { ...bonus, leadSpd: 0, useGuild: false }, rta, true, artifacts);
    return deckSetupFromRunes(runes, stats);
  };

  /** 從預設隊儲存庫載入整隊（可選擇固定當時的符文），並依技能自動安排角色 */
  const loadDeck = async (d: DeckFav) => {
    if (!summary) return;
    if (d.units.length === 0) return notify("這組預設隊沒有隊員", "err");

    const deckUnits = d.units.slice(0, 5);
    const nextSize = Math.min(5, Math.max(3, deckUnits.length)) as Size;
    const byUnit = new Map(summary.views.map((v) => [v.unit.id, v]));
    const byMaster = new Map<number, UnitView>();
    for (const v of summary.views) if (!byMaster.has(v.monster.id)) byMaster.set(v.monster.id, v);

    const t = templateOf(templateId);
    const slots = templateMembers(t, nextSize);
    let matched = 0;
    const next = slots.map((tm, i) => {
      const du = deckUnits[i];
      const v = du ? byUnit.get(du.unitId) ?? byMaster.get(du.master) : undefined;
      const draft = draftFromTemplate(tm, v?.unit.id ?? 0);
      if (v) {
        matched++;
        draft.artifactPct = artifactSpeedBuffPct(v.artifacts);
        if (pinDeckRunes && du) {
          draft.includeRunes = du.runeIds.filter((id) => runeMap.has(id));
        }
      }
      return draft;
    });
    if (matched === 0) {
      notify("這組預設隊的魔靈不在目前帳號中，無法載入", "err");
      return;
    }

    // 類型 0 是工具自己的自訂配隊，沒有內容資訊，保留目前選擇
    const ctx = d.type === 0 ? content : deckContext(d.type);
    const skills = await ensureSkills();
    const auto = withAutoRoles(next, ctx, slots.map((tm) => tm.role), skills);
    const leadPct = auto?.leadPct ?? 0;

    const finalMembers = (auto ? auto.members : next).map((m, i) => {
      if (!importDeckSetup) return m;
      const v = m.unitId ? byUnit.get(m.unitId) : undefined;
      const du = deckUnits[i];
      if (!v || !du) return m;
      const setup = deckSetupOf(v, du);
      return {
        ...m,
        set4: setup.set4,
        set2: setup.set2,
        set2b: setup.set2b,
        set2c: setup.set2c,
        mains: setup.mains,
        min: setup.min,
        max: {},
        panelExtraMax: 0,
      };
    });

    setSize(nextSize);
    setTeams(1);
    setContent(ctx);
    setLeadPcts((prev) => [leadPct, prev[1], prev[2]]);
    setMembers(finalMembers);
    setPlan(null);
    setError(null);
    resetSequence(finalMembers.length);
    setDeckOpen(false);
    const roleText = auto
      ? `；自動角色：${roleSummary(finalMembers)}${leadPct > 0 ? `（速度隊長技 +${leadPct}%）` : ""}`
      : "";
    const setupText = importDeckSetup ? "；已帶入套裝、主屬性與數值下限" : "";
    notify(
      `已載入${deckTypeLabel(d.type)}第 ${d.seq} 隊（${matched} 隻${d.units.length > 5 ? "，超過 5 隻只取前 5 隻" : ""}${matched < deckUnits.length ? `，${deckUnits.length - matched} 隻不在目前帳號` : ""}）${roleText}${setupText}`,
      matched < deckUnits.length ? "err" : "ok",
    );
  };

  /**
   * 把「接速下限」套用成面板速度。
   * 後面的成員需要更高速度才不會被插隊，所以由後往前推：前面的成員至少要比
   * 後一位快 1 點，這樣才不會出現「Celestara 的下限比 Nicki 高 → 後面的先出手」。
   * team / upToOrder 有值時只處理指定隊伍、指定順序以前的成員（單隻套用時用）。
   */
  const applyFollowFloors = (team?: number, upToOrder?: number) => {
    const next = members.map((m) => ({ ...m }));
    let changed = 0;
    followInfo.forEach((info, t) => {
      if (team != null && t !== team) return;
      const rows = info.ordered
        .filter((r) => upToOrder == null || Math.max(1, Math.round(members[r.index]?.order || 1)) <= upToOrder)
        .map((r) => {
          const m = members[r.index];
          const v = m ? viewOf(m.unitId) : undefined;
          if (!m || !v) return null;
          const lead = Math.max(0, m.leadPct ?? leadPcts[t] ?? 0);
          const isOpener = r.position === 0;
          // 起手只有面板速度時，用它當「不要為了順序被調慢」的基準
          const current =
            isOpener && m.speedMode === "panel" && m.panelExtra > 0
              ? v.base.spd + leadBonus(v.base.spd, lead) + m.panelExtra
              : null;
          return {
            index: r.index,
            order: Math.max(1, Math.round(m.order || 1)),
            floor: isOpener || !Number.isFinite(r.minSpeed) ? null : r.minSpeed,
            current,
          };
        })
        .filter((r): r is { index: number; order: number; floor: number | null; current: number | null } => !!r);
      const targets = orderSafeFloorSpeeds(rows);
      targets.forEach((speed, i) => {
        const m = next[i];
        const v = m ? viewOf(m.unitId) : undefined;
        if (!m || !v) return;
        // 目標 Tick 模式是由 Tick 決定速度，不覆寫使用者的設定
        if (m.speedMode === "tick") return;
        const lead = Math.max(0, m.leadPct ?? leadPcts[t] ?? 0);
        const panelExtra = Math.max(0, panelExtraFor(v.base.spd, speed, lead));
        if (m.panelExtra !== panelExtra || m.speedMode !== "panel") {
          next[i] = { ...m, speedMode: "panel", panelExtra };
          changed++;
        }
      });
    });
    if (changed > 0) {
      setMembers(next);
      setPlan(null);
      resetSequence();
    }
    return changed;
  };

  /** 把某一隻的面板速度設成接速下限，並同步調快前面出手的隊友 */
  const applyFollowFloor = (index: number) => {
    const row = followRowOf(index);
    const m = members[index];
    const v = m ? viewOf(m.unitId) : undefined;
    if (!row || !v || !Number.isFinite(row.minSpeed)) {
      notify("這一隻目前沒有可套用的接速下限", "err");
      return;
    }
    const team = Math.min(teams - 1, Math.floor(index / size));
    const changed = applyFollowFloors(team, Math.max(1, Math.round(m.order || 1)));
    notify(
      changed > 0
        ? `已套用接速下限${changed > 1 ? `（含前面 ${changed - 1} 隻一起調快）` : ""}，維持攻擊順序`
        : "目前速度已符合接速下限",
      changed > 0 ? "ok" : "err",
    );
  };

  /** 一次把每一隊的面板速度設成接速下限（自動維持攻擊順序） */
  const applyAllFollow = () => {
    const changed = applyFollowFloors();
    notify(
      changed > 0
        ? `已套用 ${changed} 隻的接速下限（前面的成員會自動調快，維持攻擊順序）`
        : "目前速度都已符合接速下限與攻擊順序",
      changed > 0 ? "ok" : "err",
    );
  };

  /** 手動改到定位相關的欄位時，視為偏離原本的預設定位 */
  const PRESET_FIELDS: (keyof MemberDraft)[] = [
    "role", "weight", "set4", "set2", "set2b", "set2c", "mains", "min", "max", "tick", "focus", "objectiveMode", "speedMode", "panelExtraMax",
  ];

  const updateMember = (i: number, patch: Partial<MemberDraft>) => {
    setMembers((prev) =>
      prev.map((m, j) => {
        if (j !== i) return m;
        // 手動改到定位相關欄位時，視為偏離原本的預設定位，名稱回到內建定位
        const drifted = !!m.presetId && !patch.presetId && PRESET_FIELDS.some((key) => key in patch);
        return {
          ...m,
          ...patch,
          ...(drifted ? { presetId: undefined, title: TEAM_ROLE_LABELS[m.role] } : {}),
        };
      }),
    );
    setPlan(null);
    resetSequence();
  };

  /** 重置單一成員：保留目前選的魔靈，其餘設定全部清空並改成「自由」 */
  const resetMember = (i: number) => {
    const m = members[i];
    if (!m) return;
    const v = viewOf(m.unitId);
    setMembers((prev) => prev.map((x, j) => (j === i ? blankMember(x.unitId) : x)));
    setPlan(null);
    resetSequence();
    notify(`已重置 ${v ? unitLabel(v.unit) : "這隻魔靈"} 的所有設定（定位：自由）`);
  };
  const applyRolePreset = (i: number, preset: RolePreset) => {
    updateMember(i, {
      presetId: preset.id,
      title: preset.name,
      role: preset.role,
      weight: preset.weight,
      set4: preset.set4,
      set2: preset.set2,
      set2b: preset.set2b ?? 0,
      set2c: preset.set2c ?? 0,
      mains: { ...preset.mains },
      min: { ...preset.min },
      max: {},
      panelExtraMax: 0,
      tick: preset.tick,
      focus: preset.focus.map((f) => ({ ...f })),
      objectiveMode: preset.objective,
      speedMode: preset.speedMode,
    });
    notify(`已套用定位「${preset.name}」`);
  };

  /** 把目前這一隻的設定存成預設定位；同名會覆寫 */
  const submitRolePreset = () => {
    if (!presetModal) return;
    const member = members[presetModal.index];
    if (!member) return;
    const saved = saveRolePreset(presetModal.name, {
      role: member.role,
      weight: member.weight,
      set4: member.set4,
      set2: member.set2,
      set2b: member.set2b,
      set2c: member.set2c,
      mains: { ...member.mains },
      min: { ...member.min },
      tick: member.tick,
      focus: member.focus.map((f) => ({ ...f })),
      objective: member.objectiveMode,
      speedMode: member.speedMode,
    });
    if (!saved) return notify("請先輸入定位名稱", "err");
    updateMember(presetModal.index, { presetId: saved.id, title: saved.name });
    setPresetModal(null);
    notify(`已儲存定位「${saved.name}」，之後可從「定位」選單直接套用`);
  };

  /** 把目前這一隻的設定轉成可儲存的隊型成員 */
  const memberToTemplate = (m: MemberDraft): TeamMemberTemplate => {
    const v = m.unitId ? viewOf(m.unitId) : undefined;
    const skills = v && skillData ? skillsForMonster(skillData, v.monster.id) : [];
    const skillSlot =
      m.skillSlot || (m.objectiveMode === "skill" ? skills.find((s) => s.id === m.skillId)?.slot ?? 0 : 0);
    const twos = m.set4 ? [m.set2] : [m.set2, m.set2b, m.set2c];
    return {
      role: m.role,
      title: m.title,
      weight: m.weight,
      sets: m.set4
        ? [{ set: m.set4, count: 4 }, ...(m.set2 ? [{ set: m.set2, count: 2 }] : [])]
        : twos.filter((id) => id > 0).map((set) => ({ set, count: 2 })),
      mains: { ...m.mains },
      min: { ...m.min },
      tick: m.tick,
      focus: m.focus.map((f) => ({ ...f })),
      objective: m.objectiveMode === "role" ? undefined : m.objectiveMode,
      order: m.order,
      boostPct: m.boostPct,
      speedBuff: m.speedBuff,
      artifactPct: m.artifactPct,
      speedMode: m.speedMode,
      panelExtra: m.panelExtra,
      skillSlot,
      priority: m.priority,
    };
  };

  /** 把目前第一隊的設定存成自訂隊型 */
  const submitTeamPreset = () => {
    if (!teamPresetModal) return;
    const name = teamPresetModal.name.trim();
    if (!name) return notify("請先輸入隊型名稱", "err");
    const saved = saveTeamPreset({
      name,
      desc: teamPresetModal.desc.trim(),
      size,
      content,
      members: members.slice(0, size).map(memberToTemplate),
    });
    if (!saved) return notify("隊型名稱不能空白", "err");
    setTemplateId(saved.id);
    setTeamPresetModal(null);
    notify(`已儲存隊型「${saved.name}」（${size} 隻），之後可從隊型選單直接套用`, "ok");
  };

  const deleteTeamPreset = (id: string) => {
    const t = customTemplates.find((c) => c.id === id);
    removeTeamPreset(id);
    if (templateId === id) setTemplateId("custom");
    notify(`已刪除隊型「${t?.name ?? ""}」`);
  };

  /** 把這一隻提供的提條 % 與速度強化帶入「同一隊」後面出手的成員（來源自己不套用） */
  const propagateBoost = (index: number) => {
    const src = members[index];
    if (!src) return;
    const team = teamOfIndex(index);
    const later = members.map((m, j) => j !== index && teamOfIndex(j) === team && m.order > src.order);
    const count = later.filter(Boolean).length;
    if (count === 0) return notify("後面沒有其他出手成員", "err");
    setMembers((prev) =>
      prev.map((m, j) => {
        if (j === index) return { ...m, boostPct: 0, speedBuff: false };
        return later[j] ? { ...m, boostPct: src.boostPct, speedBuff: src.speedBuff } : m;
      }),
    );
    setPlan(null);
    resetSequence();
    notify(
      src.boostPct > 0 || src.speedBuff
        ? `已把提條 ${src.boostPct}%${src.speedBuff ? " 與速度強化" : ""} 帶入後面 ${count} 隻（來源自身不套用）`
        : `已清除後面 ${count} 隻的提條與速度強化`,
    );
  };

  const patchMin = (i: number, key: StatKey, value: number) => {
    setMembers((prev) =>
      prev.map((m, j) => {
        if (j !== i) return m;
        const min = { ...m.min };
        if (value > 0) min[key] = value;
        else delete min[key];
        return m.presetId
          ? { ...m, min, presetId: undefined, title: TEAM_ROLE_LABELS[m.role] }
          : { ...m, min };
      }),
    );
    setPlan(null);
    resetSequence();
  };

  const patchMax = (i: number, key: StatKey, value: number) => {
    setMembers((prev) =>
      prev.map((m, j) => {
        if (j !== i) return m;
        const max = { ...m.max };
        if (value > 0) max[key] = value;
        else delete max[key];
        return m.presetId
          ? { ...m, max, presetId: undefined, title: TEAM_ROLE_LABELS[m.role] }
          : { ...m, max };
      }),
    );
    setPlan(null);
    resetSequence();
  };

  /** 每隻所屬的隊伍（0-based；成員依隊伍順序排列） */
  const teamOfIndex = (index: number) => Math.min(teams - 1, Math.floor(index / size));

  /** 每隻實際套用的速度隊長技 %（卡片留空 = 跟隨該隊數值） */
  const leadPctOf = (index: number) => {
    const m = members[index];
    if (!m) return 0;
    return Math.max(0, m.leadPct ?? leadPcts[teamOfIndex(index)] ?? 0);
  };

  const selected = members.filter((m) => m.unitId > 0);
  const teamIds = selected.map((m) => m.unitId);

  /** 即時接速試算：每隊各自依攻擊順序串接，並以鏡像對手在該 Tick 的攻擊條當門檻 */
  const followInfo = useMemo(() => {
    const rate = rta ? 1.5 : 7;
    return Array.from({ length: teams }, (_, t) => {
      const rows = computeFollowPlan(
        members
          .map((m, index) => ({ m, index }))
          .filter(({ index }) => Math.floor(index / size) === t)
          .map(({ m, index }) => {
            const v = viewOf(m.unitId);
            return {
              index,
              order: m.order,
              mode: (m.speedMode === "tick" ? "tick" : "panel") as "tick" | "panel",
              baseSpd: v?.base.spd ?? 0,
              panelExtra: m.panelExtra,
              tick: m.tick,
              boostPct: m.boostPct,
              speedBuff: m.speedBuff,
              artifactPct: m.artifactPct,
              leadPct: Math.max(0, m.leadPct ?? leadPcts[t] ?? 0),
              currentSpd: v?.stats.spd ?? 0,
            };
          }),
        rate,
        { opponentSpeed: oppSpd },
      );

      const all = mirrorTimeline(rows, rate, 16);
      const firstOppIndex = all.findIndex((s) => s.team === "opponent");
      const steps = firstOppIndex >= 0 ? all.slice(0, firstOppIndex + 1) : all.slice(0, 6);
      const opener = rows.find((r) => r.position === 0);
      const ticks = rows.filter((r) => r.position > 0 && r.targetTick != null).map((r) => r.targetTick as number);
      const lastTick = ticks.length ? Math.max(...ticks) : null;
      const failing = rows.filter((r) => r.position > 0 && r.met === false);
      const firstOpp = steps.find((s) => s.team === "opponent") ?? null;

      let verdict: "idle" | "safe" | "cut" = "idle";
      if (rows.some((r) => r.position > 0)) {
        if (failing.length) verdict = "cut";
        else if (firstOpp && lastTick != null && firstOpp.tick <= lastTick) verdict = "cut";
        else verdict = "safe";
      }

      return {
        rows,
        steps,
        verdict,
        failing,
        firstOpp,
        lastTick,
        autoOpp: opener?.panelSpd ?? opener?.currentSpd ?? 0,
        ordered: [...rows].sort((a, b) => a.position - b.position),
      };
    });
  }, [members, teams, size, summary, rta, oppSpd, leadPcts]);

  /** 用全域索引找接速資料（套用下限用） */
  const followRowOf = (index: number) => {
    for (const info of followInfo) {
      const row = info.rows.find((r) => r.index === index);
      if (row) return row;
    }
    return undefined;
  };

  /**
   * 面板速度與攻擊順序衝突：後面的成員速度反而比前面高。
   * 只比較有設定面板速度的成員（單位一致），讓使用者在開跑前就看到問題。
   */
  const orderConflicts = useMemo(() => {
    const out: {
      team: number;
      earlier: number;
      later: number;
      earlierOrder: number;
      laterOrder: number;
      earlierSpd: number;
      laterSpd: number;
    }[] = [];
    followInfo.forEach((info, team) => {
      const rows = info.ordered
        .map((r) => {
          const m = members[r.index];
          const spd = r.panelSpd;
          return m && spd != null ? { index: r.index, order: Math.max(1, Math.round(m.order || 1)), spd } : null;
        })
        .filter((r): r is { index: number; order: number; spd: number } => !!r);
      for (let a = 0; a < rows.length; a++) {
        for (let b = a + 1; b < rows.length; b++) {
          if (rows[a].order === rows[b].order) continue;
          if (rows[a].spd > rows[b].spd) continue;
          out.push({
            team,
            earlier: rows[a].index,
            later: rows[b].index,
            earlierOrder: rows[a].order,
            laterOrder: rows[b].order,
            earlierSpd: rows[a].spd,
            laterSpd: rows[b].spd,
          });
        }
      }
    });
    return out;
  }, [followInfo, members]);

  /** 全域「包括」符文：分配給目前裝備它的隊員（不在隊上的忽略） */
  const globalIncludes = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const id of settings.includedRunes) {
      const r = runeMap.get(id);
      if (!r || !r.occupied) continue;
      const arr = m.get(r.occupied) ?? [];
      arr.push(id);
      m.set(r.occupied, arr);
    }
    return m;
  }, [settings.includedRunes, runeMap]);

  const ignoredIncludes = useMemo(
    () =>
      settings.includedRunes.filter((id) => {
        const r = runeMap.get(id);
        return !r || !teamIds.includes(r.occupied);
      }),
    [settings.includedRunes, runeMap, teamIds],
  );

  const supply = useMemo(
    () =>
      runeSupply(
        account?.runes ?? [],
        teamIds,
        settings.excludedRunes,
        settings.lockedRunes,
        members.length,
      ),
    [account, teamIds, members.length, settings.excludedRunes, settings.lockedRunes],
  );

  const owned = useMemo(() => {
    if (!summary) return [] as OwnedUnit[];
    const dup = new Map<number, number>();
    for (const v of summary.views) dup.set(v.monster.id, (dup.get(v.monster.id) ?? 0) + 1);
    return sortMonsterEntries(summary.views.map((v): OwnedUnit => ({ ...v, _dup: (dup.get(v.monster.id) ?? 0) > 1 })));
  }, [summary]);

  /** 把單一成員草案轉成引擎需求 */
  const specAt = (i: number): TeamMemberSpec | null => {
    const m = members[i];
    if (!m) return null;
    const v = viewOf(m.unitId);
    if (!v) return null;
    const sets: { set: number; count: number }[] = [];
    if (m.set4) {
      sets.push({ set: m.set4, count: 4 });
      if (m.set2 && m.set2 !== m.set4) sets.push({ set: m.set2, count: 2 });
    } else {
      // 4 件套不指定時，可用三個 2 件套組成 3×2；重複的套裝由引擎合併件數
      if (m.set2) sets.push({ set: m.set2, count: 2 });
      if (m.set2b) sets.push({ set: m.set2b, count: 2 });
      if (m.set2c) sets.push({ set: m.set2c, count: 2 });
    }

    const min: Partial<Record<StatKey, number>> = { ...m.min };
    // 面板速度 / 目標 Tick 二選一；面板輸入的是「基礎速度與隊長技以外的額外速度」。
    // 引擎的 min.spd 比對的是戰鬥速度（含圖騰 / 隊長 / 速度強化），
    // 因此先把面板額外速度換算成戰鬥速度，否則圖騰 / Buff 會把不足的速度補掉。
    const battleSpdMin =
      m.speedMode !== "tick" && m.panelExtra > 0
        ? battleSpeedForPanelExtra(
            v.base.spd,
            m.panelExtra,
            bonus.towerSpd + leadPctOf(i) + bonus.buffSpd,
          )
        : 0;
    if (battleSpdMin > 0) min.spd = battleSpdMin;
    else if (m.speedMode === "tick" && m.tick > 0) min.spd = speedForTick(m.tick, rta);
    else delete min.spd;

    // 數值上限：和下限一樣用實戰數值；速度上限另外用「面板額外速度」換算
    const max: Partial<Record<StatKey, number>> = { ...m.max };
    for (const k of Object.keys(max) as StatKey[]) if (!max[k] || max[k]! <= 0) delete max[k];
    if (m.panelExtraMax > 0) {
      const battleSpdMax = battleSpeedForPanelExtra(
        v.base.spd,
        m.panelExtraMax,
        bonus.towerSpd + leadPctOf(i) + bonus.buffSpd,
      );
      max.spd = max.spd == null ? battleSpdMax : Math.min(max.spd, battleSpdMax);
    }

    const bySlot = new Map<number, number>();
    for (const id of [...m.includeRunes, ...(globalIncludes.get(m.unitId) ?? [])]) {
      const r = runeMap.get(id);
      if (!r || bySlot.has(r.slot)) continue;
      bySlot.set(r.slot, id);
    }

    // 技能傷害目標：優先使用指定技能；隊型用技能欄位（S1～S4）跨魔靈對應
    const skills = skillData ? skillsForMonster(skillData, v.monster.id) : [];
    const slotSkill = m.skillSlot ? skills.find((s) => s.slot === m.skillSlot) : undefined;
    const skill =
      m.objectiveMode === "skill"
        ? (slotSkill ?? skills.find((s) => s.id === m.skillId) ?? defaultAttackSkill(skills))
        : undefined;

    return {
      unitId: m.unitId,
      master: v.monster.id,
      label: unitLabel(v.unit),
      base: v.base,
      role: m.role,
      weight: m.weight,
      priority: m.priority,
      order: m.order,
      sets,
      mains: m.mains,
      min,
      max,
      focus: m.focus,
      includeRunes: [...bySlot.values()],
      leadSpd: leadPctOf(i),
      objective: skill
        ? "skill"
        : m.objectiveMode === "role"
          ? roleObjective(m.role)
          : m.objectiveMode,
      skillObjective: skill ? { skill, opts: TEAM_DAMAGE_OPTS } : undefined,
    };
  };

  /** 把草案轉成引擎需求 */
  const buildRequest = (): TeamRequest | null => {
    if (!account || !summary) return null;
    const specs: TeamMemberSpec[] = [];
    for (let i = 0; i < members.length; i++) {
      const spec = specAt(i);
      if (!spec) return null;
      specs.push(spec);
    }
    return {
      members: specs,
      runes: account.runes,
      bonus: { ...bonus, leadSpd: 0 },
      rta,
      pool: budget.pool,
      topK: budget.topK,
      allowEquipped: true,
      relaxSub: false,
      intangible: false,
      excludeRunes: settings.excludedRunes,
      lockedRunes: settings.lockedRunes,
      maxNodesPerSearch: budget.nodes,
      diversify: true,
      // 結果數量＝回傳的隊伍總數（主結果 + 替代）
      alternatives: resultCount,
      beamWidth: Math.max(budget.beam, resultCount),
      teamSize: size,
    };
  };

  /** 逐隻配＋排除：把已選的候選配裝轉成整隊結果（沿用既有結果卡片） */
  const planFromSequence = (picks: (TopBuild | null)[]): TeamPlan | null => {
    const builds: TeamBuild[] = [];
    let totalEff = 0;
    let totalScore = 0;
    for (let i = 0; i < members.length; i++) {
      const b = picks[i];
      const spec = specAt(i);
      if (!b || !spec) return null;
      const weight = Math.max(1, Math.min(10, spec.weight || 1));
      const sets = teamSetsOf(
        b.runeIds,
        runeMap,
        spec.sets.filter((s) => s.set > 0 && s.count > 0),
        false,
      );
      totalEff += b.eff;
      totalScore += weight;
      builds.push({
        unitId: spec.unitId,
        master: spec.master,
        role: spec.role,
        runeIds: b.runeIds,
        stats: b.stats,
        ehp: b.ehp,
        sets,
        score: b.objective,
        norm: 1,
        weight,
        contribution: weight,
        eff: b.eff,
        focusFit: b.focusFit,
        objective: spec.skillObjective ? "skill" : (spec.objective ?? roleObjective(spec.role)),
        priority: spec.priority ?? 0,
        order: spec.order ?? 1,
        skillName: spec.skillObjective?.skill.n,
      });
    }
    return {
      members: builds,
      teamScore: totalScore,
      totalEff: builds.length > 0 ? totalEff / builds.length : 0,
      nodes: 0,
      searchMs: 0,
      truncated: false,
      alternatives: [],
      candidates: builds.map(() => 1),
      notes: [
        "逐隻配＋排除模式：依序為每隻挑選候選配裝，已選的符文會自動排除，不會分配給後面的魔靈。",
      ],
    };
  };

  /** 逐隻配＋排除：建立單隻配符需求；stage 是找不到結果時的放寬階梯 */
  const buildSeqRequest = (
    index: number,
    picks: (TopBuild | null)[],
    stage: number,
  ): { req?: OptRequest; error?: string } => {
    const spec = specAt(index);
    if (!spec) return { error: "無法建立這隻魔靈的配符需求，請重新選擇魔靈。" };
    const used = new Set<number>(settings.excludedRunes);
    for (const p of picks) {
      if (!p) continue;
      for (const id of p.runeIds) used.add(id);
    }
    const conflict = (spec.includeRunes ?? []).filter((id) => used.has(id));
    if (conflict.length > 0) {
      return {
        error: `${spec.label ?? "魔靈"} 的「包括」符文已被前面的魔靈使用，請先解除該符文，或不要固定這顆符文。`,
      };
    }
    const relax = SEQ_LADDER[Math.max(0, Math.min(SEQ_LADDER.length - 1, stage))];
    return {
      req: {
        base: spec.base,
        runes: account?.runes ?? [],
        required: relax.noSets ? [] : spec.sets.filter((s) => s.set > 0 && s.count > 0),
        min: spec.min,
        max: spec.max ?? {},
        bonus: { ...bonus, leadSpd: spec.leadSpd, useGuild: false, grind: true },
        pool: budget.pool,
        allowEquipped: true,
        targetUnit: spec.unitId,
        rta,
        maxNodes: budget.nodes,
        mainFilters: relax.mains ? {} : spec.mains,
        relaxSub: relax.relaxSub,
        intangible: false,
        focus: normalizeFocus(spec.focus),
        excludeRunes: [...used],
        includeRunes: spec.includeRunes ?? [],
        lockedRunes: settings.lockedRunes,
        topK: Math.max(1, Math.min(300, resultCount)),
        objective: spec.skillObjective ? "skill" : (spec.objective ?? roleObjective(spec.role)),
        skillObjective: spec.skillObjective,
      },
    };
  };

  /** 逐隻配＋排除：執行某一隻的候選搜尋（找不到就自動往下放寬） */
  const runSeqStage = (index: number, picks: (TopBuild | null)[], stage: number) => {
    const built = buildSeqRequest(index, picks, stage);
    if (!built.req) {
      setSeqRunning(false);
      setSeqError(built.error ?? "無法建立配符需求。");
      return;
    }
    seqWorkerRef.current?.terminate();
    let worker: Worker;
    try {
      worker = new Worker(new URL("../lib/optimizer.worker.ts", import.meta.url), { type: "module" });
    } catch {
      setSeqRunning(false);
      setSeqError("瀏覽器無法啟動配符運算模組，請重新整理頁面或改用 Chrome / Edge。");
      return;
    }
    seqWorkerRef.current = worker;
    const id = ++seqRunIdRef.current;
    setSeqRunning(true);
    setSeqError(null);
    setSeqCandidates([]);
    setSeqNote(stage > 0 ? SEQ_LADDER[stage].note : null);

    const timer = window.setTimeout(() => {
      if (seqWorkerRef.current !== worker) return;
      worker.terminate();
      seqWorkerRef.current = null;
      setSeqRunning(false);
      setSeqError("單隻配符超過 60 秒，已停止。請把預算改成「快速」、放寬條件，或減少結果數量。");
    }, 60_000);

    const done = () => {
      window.clearTimeout(timer);
      worker.terminate();
      if (seqWorkerRef.current === worker) seqWorkerRef.current = null;
    };

    worker.onmessage = (e: MessageEvent<{
      id: number;
      res?: { topBuilds?: TopBuild[] };
      error?: string;
    }>) => {
      if (e.data.id !== id) return;
      if (e.data.error) {
        done();
        setSeqRunning(false);
        setSeqError(e.data.error);
        return;
      }
      const builds = e.data.res?.topBuilds ?? [];
      if (builds.length === 0 && stage < SEQ_LADDER.length - 1) {
        done();
        runSeqStage(index, picks, stage + 1);
        return;
      }
      done();
      setSeqRunning(false);
      if (builds.length === 0) {
        setSeqError(
          `「${members[index]?.title ?? `第 ${index + 1} 隻`}」找不到符合條件的配裝，即使不限套裝與主屬性也一樣。請放寬數值上下限、解除排除 / 鎖定，或確認每個位置都有足夠符文。`,
        );
        return;
      }
      setSeqCandidates(builds);
      setSeqNote(stage > 0 ? SEQ_LADDER[stage].note : null);
      setSeqPage(0);
    };
    worker.onerror = (ev) => {
      console.error("sequential optimizer worker error", ev);
      done();
      setSeqRunning(false);
      setSeqError("配符運算模組載入失敗（可能是網站剛更新）。請按 Ctrl + F5 重新整理後再試。");
    };
    worker.postMessage({ id, req: built.req });
  };

  /** 從指定的一隻開始逐隻配；index 之後的選擇會先清空 */
  const startSeqAt = (index: number, picks: (TopBuild | null)[] = seqPicks) => {
    if (!account) return notify("請先匯入存檔", "err");
    if (members.length !== teams * size) return notify("隊伍人數不一致，請重新選擇", "err");
    if (members.some((m) => !m.unitId)) return notify("還有位置未選擇魔靈", "err");
    if (new Set(members.map((m) => m.unitId)).size !== members.length) {
      return notify("同一隻魔靈不能重複加入隊伍", "err");
    }
    if (index < 0 || index >= members.length) return;
    const cleared = picks.map((p, i) => (i < index ? p : null));
    setSeqPicks(cleared);
    setSeqIndex(index);
    setSeqPage(0);
    setPlan(null);
    setAltIndex(0);
    runSeqStage(index, cleared, 0);
  };

  /** 採用目前這隻的某一組候選，排除它的符文後自動配下一隻 */
  const chooseSeqBuild = (build: TopBuild) => {
    const picks = seqPicks.map((p, i) => (i < seqIndex ? p : i === seqIndex ? build : null));
    setSeqPicks(picks);
    setSeqCandidates([]);
    setSeqPage(0);
    const next = seqIndex + 1;
    if (next < members.length) {
      setSeqIndex(next);
      setPlan(null);
      runSeqStage(next, picks, 0);
      return;
    }
    setSeqIndex(next);
    const plan = planFromSequence(picks);
    if (plan) {
      setPlan(plan);
      setAltIndex(0);
      setOpenResults(new Set(plan.members.slice(0, 1).map((m) => m.unitId)));
      notify(`逐隻配完成：已為 ${plan.members.length} 隻魔靈選好符文`);
    } else {
      setSeqError("無法組合逐隻配結果，請重新整理頁面後再試。");
    }
  };

  /** 回到某一隻重配（該隻與後面已選的都會清空） */
  const goSeqTo = (index: number) => {
    const picks = seqPicks.map((p, i) => (i < index ? p : null));
    setSeqPicks(picks);
    setSeqIndex(index);
    setPlan(null);
    setAltIndex(0);
    runSeqStage(index, picks, 0);
  };

  const switchMode = (mode: OptimizeMode) => {
    if (mode === optMode) return;
    workerRef.current?.terminate();
    workerRef.current = null;
    setRunning(false);
    setProgress(null);
    setOptMode(mode);
    setPlan(null);
    setAltIndex(0);
    setError(null);
    resetSequence();
  };

  const cancelSeq = () => {
    seqWorkerRef.current?.terminate();
    seqWorkerRef.current = null;
    setSeqRunning(false);
  };

  const runPrimary = () => {
    if (optMode === "team") run();
    else startSeqAt(0, Array.from({ length: members.length }, () => null));
  };

  const addTableFilter = () => {
    if (tableFilters.length >= MAX_TABLE_FILTERS) {
      return notify(`表格篩選最多 ${MAX_TABLE_FILTERS} 個條件，請先移除其中一個`, "err");
    }
    const min = filterMin.trim() === "" ? undefined : Number(filterMin);
    const max = filterMax.trim() === "" ? undefined : Number(filterMax);
    if (min == null && max == null) return notify("請先輸入下限或上限", "err");
    if ((min != null && !Number.isFinite(min)) || (max != null && !Number.isFinite(max))) {
      return notify("篩選數值格式不正確", "err");
    }
    if (min != null && max != null && min > max) return notify("篩選下限不可高於上限", "err");
    const member = Math.min(filterMember, Math.max(0, (plan?.members.length ?? 1) - 1));
    setTableFilters((prev) => [...prev, { member, stat: filterStat, min, max }]);
    setFilterMin("");
    setFilterMax("");
  };

  const removeTableFilter = (index: number) => {
    setTableFilters((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleHeaderSort = (member: number, stat: TableStatKey) => {
    setTableSort((prev) =>
      prev.member === member && prev.stat === stat
        ? { ...prev, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { member, stat, dir: "desc" },
    );
  };

  const run = () => {
    if (!account) return notify("請先匯入存檔", "err");
    if (members.length !== teams * size) return notify("隊伍人數不一致，請重新選擇", "err");
    if (members.some((m) => !m.unitId)) return notify("還有位置未選擇魔靈", "err");
    if (new Set(members.map((m) => m.unitId)).size !== members.length) {
      return notify("同一隻魔靈不能重複加入隊伍", "err");
    }
    const bad = supply.find((s) => s.count < s.need);
    if (bad) {
      return notify(
        `位置 ${bad.slot} 可用符文只有 ${bad.count} 顆，不足 ${bad.need} 隻使用。請先解除排除 / 鎖定，或放寬條件。`,
        "err",
      );
    }
    const req = buildRequest();
    if (!req) return notify("無法建立配隊需求，請重新整理頁面", "err");
    for (const spec of req.members) {
      for (const k of Object.keys(spec.min) as StatKey[]) {
        const lo = spec.min[k] ?? 0;
        const hi = spec.max?.[k];
        if (hi != null && lo > hi) {
          return notify(`${spec.label ?? "魔靈"} 的${STAT_LABEL_ZH[k]}下限高於上限，請調整數值上限。`, "err");
        }
      }
    }

    workerRef.current?.terminate();
    let worker: Worker;
    try {
      worker = new Worker(new URL("../lib/teamOptimizer.worker.ts", import.meta.url), { type: "module" });
    } catch {
      return setError("瀏覽器無法啟動配隊運算模組，請重新整理頁面或改用 Chrome / Edge。");
    }
    workerRef.current = worker;
    const id = ++runIdRef.current;

    setRunning(true);
    setError(null);
    setPlan(null);
    setAltIndex(0);
    setProgress({ stage: "candidates", member: 0, total: members.length });

    const timer = window.setTimeout(() => {
      if (workerRef.current !== worker) return;
      worker.terminate();
      workerRef.current = null;
      setRunning(false);
      setProgress(null);
      setError("配隊運算超過 90 秒，已停止。請把搜尋預算改成「快速」、放寬條件，或減少隊伍數／人數。");
    }, 90_000);

    const done = () => {
      window.clearTimeout(timer);
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      setRunning(false);
      setProgress(null);
    };

    worker.onmessage = (e: MessageEvent<{
      id: number;
      progress?: TeamProgress;
      out?: { ok: true; plan: TeamPlan } | { ok: false; error: string; unitId?: number };
      error?: string;
    }>) => {
      if (e.data.id !== id) return;
      if (e.data.progress) {
        setProgress(e.data.progress);
        return;
      }
      if (e.data.error) {
        setError(e.data.error);
        done();
        return;
      }
      const out = e.data.out;
      if (!out) {
        setError("配隊運算沒有回傳結果，請重新整理頁面再試。");
        done();
        return;
      }
      if (!out.ok) {
        setError(out.error);
        done();
        return;
      }
      setPlan(out.plan);
      setAltIndex(0);
      setOpenResults(new Set(out.plan.members.slice(0, 1).map((m) => m.unitId)));
      // 手機版：按下配隊後收合設定、直接帶到結果，省掉再往下滑一長段
      if (window.matchMedia("(max-width: 820px)").matches) {
        setOpenMembers(new Set());
        window.setTimeout(() => {
          document.getElementById("team-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 80);
      }
      done();
    };
    worker.onerror = (ev) => {
      console.error("team optimizer worker error", ev);
      setError("配隊運算模組載入失敗（可能是網站剛更新）。請按 Ctrl + F5 重新整理後再試。");
      done();
    };

    worker.postMessage({ id, req });
  };

  const cancel = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setRunning(false);
    setProgress(null);
  };

  const activePlan = plan ? (altIndex === 0 ? plan : plan.alternatives[altIndex - 1] ?? plan) : null;

  /** 所有回傳的隊伍（主結果 + 替代），結果頁分頁瀏覽 */
  const allPlans = plan ? [plan, ...plan.alternatives] : [];
  const resultPageCount = Math.max(1, Math.ceil(allPlans.length / RESULT_PAGE_SIZE));
  const resultPage = Math.min(resultPageCount - 1, Math.floor(altIndex / RESULT_PAGE_SIZE));
  const resultPageStart = resultPage * RESULT_PAGE_SIZE;
  const pagePlans = allPlans.slice(resultPageStart, resultPageStart + RESULT_PAGE_SIZE);

  const pinMember = (unitId: number) => {
    const b = activePlan?.members.find((m) => m.unitId === unitId);
    if (!b) return;
    setMembers((prev) => prev.map((m) => (m.unitId === unitId ? { ...m, includeRunes: b.runeIds } : m)));
    setPlan(null);
    setAltIndex(0);
    resetSequence();
    notify(`已固定 ${nameOf(b.unitId, b.master)} 的 6 顆符文，按「一鍵配隊」會重新配其他魔靈`);
  };

  const unpinMember = (unitId: number) => {
    setMembers((prev) => prev.map((m) => (m.unitId === unitId ? { ...m, includeRunes: [] } : m)));
    setPlan(null);
    resetSequence();
  };

  const equipPlan = () => {
    if (!activePlan) return;
    const n = equipTeam(activePlan.members.map((m) => ({ unitId: m.unitId, runeIds: m.runeIds })));
    notify(
      n > 0
        ? `已將 ${n} 顆符文上符到整隊（僅本機模擬，不會修改遊戲存檔）`
        : "上符失敗：沒有可用的符文",
      n > 0 ? "ok" : "err",
    );
  };

  const lockPlan = () => {
    if (!activePlan) return;
    const ids = activePlan.members.flatMap((m) => m.runeIds);
    setRuneFlag("locked", ids, true);
    notify(`已鎖定整隊 ${ids.length} 顆符文，其他魔靈配符時不會使用`);
  };

  const savePlan = () => {
    if (!activePlan) return;
    for (let t = 0; t < teams; t++) {
      const builds = activePlan.members.slice(t * size, (t + 1) * size);
      if (builds.length === 0) continue;
      saveDeckFav(
        {
          name: `一鍵配隊 · 第 ${t + 1} 隊 · ${builds.map((m) => nameOf(m.unitId, m.master)).join(" / ")}`,
          type: 0,
          seq: 1,
          units: builds.map((m) => {
            const u = account?.units.find((x) => x.id === m.unitId);
            return { unitId: m.unitId, master: m.master, runeIds: m.runeIds, artifactIds: u?.artifacts ?? [] };
          }),
        },
        { silent: true },
      );
    }
    notify(teams > 1 ? `已儲存 ${teams} 隊到儲存庫` : "已儲存到儲存庫");
  };

  const copyPlan = () => {
    if (!activePlan) return;
    const lines = activePlan.members.map((m, i) => {
      const sets = setSummary(m.sets);
      const head = teams > 1 && i % size === 0 ? `\n[第 ${Math.floor(i / size) + 1} 隊]\n` : "";
      return `${head}${nameOf(m.unitId, m.master)}  戰鬥 SPD ${m.stats.spd}（面板 ${m.stats.panelSpd ?? m.stats.spd}）(T${m.stats.tick})  HP ${fmt(m.stats.hp)}  DEF ${fmt(m.stats.def)}  EHP ${fmt(m.ehp)}  ${sets}  符文 ${m.runeIds.join(", ")}`;
    });
    void navigator.clipboard?.writeText(lines.join("\n").trim());
    notify(teams > 1 ? `已複製 ${teams} 隊配裝清單` : "已複製整隊配裝清單");
  };

  if (!account) {
    return <div className="empty"><Users size={40} /><div>尚未匯入存檔</div></div>;
  }

  const totalWeight = members.reduce((s, m) => s + Math.max(1, m.weight), 0);

  /** 每一隊自己的速度順序（結果頁顯示用；同速時依攻擊順序） */
  const planSpeedOrders: TeamPlan["members"][] = activePlan
    ? Array.from({ length: teams }, (_, t) =>
        [...activePlan.members.slice(t * size, (t + 1) * size)].sort(
          (a, b) => b.stats.spd - a.stats.spd || a.order - b.order,
        ),
      )
    : [];

  /** 逐隻模式的候選分頁與已排除符文 */
  const seqPageCount = Math.max(1, Math.ceil(seqCandidates.length / RESULT_PAGE_SIZE));
  const seqPageSafe = Math.min(seqPage, seqPageCount - 1);
  const seqPageStart = seqPageSafe * RESULT_PAGE_SIZE;
  const seqPageBuilds = seqCandidates.slice(seqPageStart, seqPageStart + RESULT_PAGE_SIZE);
  const seqUsedRunes = new Set<number>(seqPicks.flatMap((p) => p?.runeIds ?? []));
  const seqCurrent = members[seqIndex];
  const seqCurrentView = seqCurrent ? viewOf(seqCurrent.unitId) : undefined;

  /** 表格檢視：套用篩選、排序後再分頁（每頁 10 組） */
  const tableRows = allPlans
    .map((p, index) => ({ p, index }))
    .filter(({ p }) =>
      tableFilters.every((f) => {
        const m = p.members[f.member];
        if (!m) return false;
        const v = tableStatValue(m, f.stat);
        return (f.min == null || v >= f.min) && (f.max == null || v <= f.max);
      }),
    );
  const sortValueOf = (p: TeamPlan): number => {
    if (tableSort.member == null || tableSort.stat === "score") return p.teamScore;
    const m = p.members[tableSort.member];
    return m ? tableStatValue(m, tableSort.stat) : 0;
  };
  tableRows.sort((a, b) => {
    const d = sortValueOf(a.p) - sortValueOf(b.p);
    if (d !== 0) return tableSort.dir === "asc" ? d : -d;
    return b.p.teamScore - a.p.teamScore;
  });
  const tablePageCount = Math.max(1, Math.ceil(tableRows.length / TABLE_PAGE_SIZE));
  const tablePageSafe = Math.min(tablePage, tablePageCount - 1);
  const tablePageStart = tablePageSafe * TABLE_PAGE_SIZE;
  const tablePageRows = tableRows.slice(tablePageStart, tablePageStart + TABLE_PAGE_SIZE);

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 14 }}>
        <div>
          <div className="card-title row" style={{ gap: 7 }}>
            <Zap size={15} className="gold" /> 一鍵配隊
          </div>
          <div className="card-sub team-page-sub">
            每隊 3～5 隻、最多 3 隊（合計 15 隻），再一次配好所有隊伍的符文；同一顆符文不會重複分配給兩隻魔靈。RTA 用 1 隊 5 隻，混沌 PVE 可用 2～3 隊。
            「逐隻配＋排除」會先配第 1 隻，選好一組後自動排除它的符文，再配下一隻（SWOP 流程）。
          </div>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="tiny dim">模式</span>
          <button
            type="button"
            className={`chip ${optMode === "team" ? "gold" : "muted"}`}
            style={{ cursor: "pointer" }}
            onClick={() => switchMode("team")}
          >
            整隊一起配
          </button>
          <button
            type="button"
            className={`chip ${optMode === "sequential" ? "gold" : "muted"}`}
            style={{ cursor: "pointer" }}
            onClick={() => switchMode("sequential")}
          >
            逐隻配＋排除
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setDeckOpen(true)}>
            <Layers size={13} /> 從儲存庫載入
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={runPrimary}
            disabled={running || seqRunning || members.some((m) => !m.unitId)}
            title={optMode === "team" ? "不用滑到頁面底部，直接開始配隊" : "從第 1 隻開始逐隻配＋排除"}
          >
            {running || seqRunning ? <Loader2 size={13} className="spin" /> : <Wand2 size={13} />}
            {optMode === "team" ? "開始配隊" : "開始逐隻配"}
          </button>
          {activePlan && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => document.getElementById("team-result")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              <Check size={13} /> 看結果
            </button>
          )}
          <span className="chip gold">符文衝突 0</span>
          <span className="chip muted">隊長技：速度</span>
          <span className="chip muted">{rta ? "RTA Tick 1.5%" : "一般 Tick 7%"}</span>
        </div>
      </div>

      {/* 隊型 / 人數 / 隊長 / 預算 */}
      <div className="card card-pad" style={{ marginBottom: 12 }}>
        <div className="row between wrap" style={{ gap: 10 }}>
          <div>
            <div className="card-title row" style={{ gap: 7 }}><Layers size={14} className="gold" /> 隊型</div>
            <div className="tiny dim team-template-desc" style={{ marginTop: 3, maxWidth: 620 }}>{template.desc}</div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="tiny dim">隊伍數</span>
            {([1, 2, 3] as TeamCount[]).map((n) => (
              <button key={n} type="button" className={`chip ${teams === n ? "gold" : "muted"}`} style={{ cursor: "pointer" }} onClick={() => changeShape(n, size)}>
                {n} 隊
              </button>
            ))}
            <span className="tiny dim" style={{ marginLeft: 6 }}>每隊</span>
            {([3, 4, 5] as Size[]).map((n) => (
              <button key={n} type="button" className={`chip ${size === n ? "gold" : "muted"}`} style={{ cursor: "pointer" }} onClick={() => changeShape(teams, n)}>
                {n} 隻
              </button>
            ))}
            <span className="chip muted">共 {teams * size} 隻</span>
          </div>
        </div>

        <div className="row wrap form-selects" style={{ gap: 8, marginTop: 10 }}>
          <select className="select" style={{ minWidth: 300 }} value={templateId} onChange={(e) => void applyTemplate(e.target.value)}>
            <optgroup label="內建隊型">
              {TEAM_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </optgroup>
            {customTemplates.length > 0 && (
              <optgroup label="我的隊型">
                {customTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </optgroup>
            )}
          </select>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setTeamPresetModal({ name: "", desc: "" })}
            title="把目前這一隊的定位稱呼、出手順序、套裝、速度條件與面板要求存成隊型"
          >
            <Plus size={12} /> 新增隊型
          </button>
          {activeCustomTemplate && (
            <button
              type="button"
              className="btn btn-sm btn-ghost btn-icon"
              title={`刪除隊型「${activeCustomTemplate.name}」`}
              onClick={() => deleteTeamPreset(activeCustomTemplate.id)}
            >
              <Trash2 size={12} />
            </button>
          )}
          <select className="select" style={{ width: 180 }} value={content} onChange={(e) => { setContent(e.target.value as DeckContext); setPlan(null); resetSequence(); }}>
            {(["arena", "guild", "dungeon"] as DeckContext[]).map((c) => <option key={c} value={c}>{DECK_CONTEXT_LABEL[c]}</option>)}
          </select>
          <select className="select" style={{ width: 170 }} value={budgetKey} onChange={(e) => { setBudgetKey(e.target.value as BudgetKey); if (optMode === "sequential") resetSequence(); }}>
            {(Object.keys(BUDGETS) as BudgetKey[]).map((k) => <option key={k} value={k}>預算：{BUDGETS[k].label}（{BUDGETS[k].hint}）</option>)}
          </select>
          <select
            className="select"
            style={{ width: 150 }}
            value={resultCount}
            onChange={(e) => {
              setResultCount(Number(e.target.value));
              setPlan(null);
              setAltIndex(0);
              if (optMode === "sequential") resetSequence();
            }}
            title={
              optMode === "team"
                ? "一次回傳並可切換瀏覽的隊伍數量；數量越多，運算時間越長"
                : "逐隻配時，每一隻要列出幾組候選配裝；數量越多，運算時間越長"
            }
          >
            {RESULT_COUNTS.map((n) => (
              <option key={n} value={n}>
                {optMode === "team" ? "結果" : "候選"}：{n} 組{optMode === "team" ? "隊伍" : "配裝"}
              </option>
            ))}
          </select>
        </div>
        <div className="tiny dim team-help" style={{ marginTop: 6 }}>
          自訂隊型會保存這台裝置的第一隊設定（定位稱呼、出手順序、套裝 3×2／主屬性、面板速度或 Tick、面板下限、目標技能）；不綁定魔靈，套用時再選隊員。
          「結果」可一次產生 5～100 組隊伍，翻頁瀏覽後再挑一組上符；數量越多，運算時間越長。
          「逐隻配＋排除」模式則把這個數量當成單隻魔靈的候選配裝數。
        </div>

        <div className="row wrap team-help" style={{ gap: 8, marginTop: 8 }}>
          <span className="tiny" style={{ color: "var(--gold, #f2c65c)" }}>
            速度隊長技 % 改成每隊各自設定（在下方每一隊的標題列），每隻也能在卡片上個別覆寫，留空 = 跟隨該隊。
          </span>
          {rta && <span className="tiny dim">RTA 模式：Tick 以 1.5% 計算，且不含一般建築</span>}
        </div>
      </div>

      {/* 隊伍成員（依隊伍分組） */}
      <div className="team-member-grid">
        {members.map((m, i) => {
          const v = viewOf(m.unitId);
          const pinned = m.includeRunes.length > 0;
          const teamIndex = Math.floor(i / size);
          const isTeamStart = i === teamIndex * size;
          const laterCount = members.filter((x, j) => j !== i && Math.floor(j / size) === teamIndex && x.order > m.order).length;
          const skills = skillData && v ? skillsForMonster(skillData, v.monster.id) : [];
          const effSkill = (m.skillSlot ? skills.find((s) => s.slot === m.skillSlot) : undefined) ??
            skills.find((s) => s.id === m.skillId) ?? defaultAttackSkill(skills);
          const appliedPreset = presets.find((p) => p.id === m.presetId);
          return (
            <Fragment key={i}>
              {isTeamStart && (
                <div className="team-group-head" style={{ gridColumn: "1 / -1" }}>
                  <div className="row between wrap" style={{ gap: 8 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="team-group-title">{teams > 1 ? `第 ${teamIndex + 1} 隊` : "隊伍設定"}</span>
                      <span className="tiny dim">{size} 隻</span>
                    </div>
                    <div className="row wrap" style={{ gap: 8 }}>
                      <label className="row" style={{ gap: 6 }}>
                        <span className="tiny dim">速度隊長技 %</span>
                        <NumberInput
                          className="input mono"
                          style={{ width: 72 }}
                          min={0}
                          max={50}
                          value={leadPcts[teamIndex] ?? 0}
                          onChange={(pct) => {
                            const next = Math.max(0, Math.min(50, pct));
                            setLeadPcts((prev) => prev.map((p, k) => (k === teamIndex ? next : p)));
                            setPlan(null);
                            resetSequence();
                          }}
                          title="這一隊的速度隊長技加成，以每隻的基礎速度計算；0 = 沒有隊長技"
                        />
                      </label>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => void autoAssignTeam(teamIndex)} title="依魔靈技能重新安排這一隊的速隊長、提條與出手順序">
                        <Users size={12} /> 依技能安排定位
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <div className={`card card-pad team-member ${pinned ? "pinned" : ""}`}>
              <div className="row between" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 8, minWidth: 0 }}>
                  <MonsterIcon id={v?.monster.id ?? 0} size={38} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {v ? unitLabel(v.unit) : "尚未選擇"}
                    </div>
                    <div className="tiny dim">{m.title}</div>
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPickerIndex(i)}>
                    <Search size={12} /> {v ? "更換" : "選擇"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost team-collapse-toggle"
                    onClick={() => resetMember(i)}
                    title="重置這隻的所有設定（套裝、主屬性、上下限、Focus、定位改為自由）"
                  >
                    <RotateCcw size={12} /> 重置
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost team-collapse-toggle"
                    aria-expanded={openMembers.has(i)}
                    onClick={() => toggleMemberOpen(i)}
                    title={openMembers.has(i) ? "收合這隻的設定" : "展開這隻的設定"}
                  >
                    {openMembers.has(i) ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    {openMembers.has(i) ? "收合" : "設定"}
                  </button>
                </div>
              </div>

              {v && (
                <div className="row wrap tiny dim" style={{ gap: 6, marginTop: 6 }}>
                  <span>目前 戰鬥 SPD <b className="gold">{v.stats.spd}</b>（面板 {v.stats.panelSpd ?? v.stats.spd}）</span>
                  <span>基礎 {v.base.spd}</span>
                  {m.speedMode !== "tick" && m.panelExtra > 0 && (
                    <span>
                      面板{" "}
                      <b className="gold">
                        {v.base.spd + leadBonus(v.base.spd, leadPctOf(i)) + m.panelExtra}
                      </b>
                      {leadPctOf(i) > 0 && (
                        <span className="dim">
                          （{v.base.spd} + 隊長 {leadBonus(v.base.spd, leadPctOf(i))} + 額外{" "}
                          {m.panelExtra}）
                        </span>
                      )}
                    </span>
                  )}
                  {m.speedMode !== "tick" && m.panelExtra === 0 && m.tick > 0 && (
                    <span className="chip muted" title="目前是面板速度模式，目標 Tick 不會套用；切換成「目標 Tick」才會使用">Tick T{m.tick} 未套用</span>
                  )}
                  <span>T{v.stats.tick}</span>
                  <span>{v.runes.length}/6 符文</span>
                  {leadPctOf(i) > 0 && <span className="chip gold">隊長 +{leadPctOf(i)}%</span>}
                  {pinned && <span className="chip green"><Pin size={10} /> 已固定</span>}
                </div>
              )}

              <div className={`team-member-fields ${openMembers.has(i) ? "open" : ""}`}>
              <div className="team-fields">
                <label>
                  <span>定位</span>
                  <select
                    className="select"
                    value={appliedPreset ? `preset:${appliedPreset.id}` : `role:${m.role}`}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value.startsWith("preset:")) {
                        const preset = presets.find((p) => p.id === value.slice(7));
                        if (preset) applyRolePreset(i, preset);
                        return;
                      }
                      const role = value.slice(5) as TeamRole;
                      updateMember(i, { role, presetId: undefined, title: TEAM_ROLE_LABELS[role] });
                    }}
                    title="內建定位之外，也可以把常用的套裝／主屬性存成「我的定位」"
                  >
                    <optgroup label="內建定位">
                      {(Object.keys(TEAM_ROLE_LABELS) as TeamRole[]).map((r) => (
                        <option key={r} value={`role:${r}`}>{TEAM_ROLE_LABELS[r]}</option>
                      ))}
                    </optgroup>
                    {presets.length > 0 && (
                      <optgroup label="我的定位">
                        {presets.map((p) => <option key={p.id} value={`preset:${p.id}`}>{p.name}</option>)}
                      </optgroup>
                    )}
                  </select>
                  <button
                    type="button"
                    className="preset-save"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setPresetModal({ index: i, name: appliedPreset?.name ?? "" });
                    }}
                    title="把這隻目前的套裝、主屬性、下限與 Tick 存成我的定位"
                  >
                    <Save size={11} /> 把目前設定存成定位
                  </button>
                </label>
                <label>
                  <span>定位稱呼</span>
                  <input
                    className="input"
                    value={m.title}
                    maxLength={20}
                    placeholder="例如：一速打手"
                    onChange={(e) => updateMember(i, { title: e.target.value })}
                    title="顯示在卡片上的角色名稱；儲存自訂隊型時會一起保存"
                  />
                </label>
                <label>
                  <span>權重</span>
                  <NumberInput className="input mono" min={1} max={10} value={m.weight} onChange={(v) => updateMember(i, { weight: Math.max(1, Math.min(10, v)) })} />
                </label>
                <label>
                  <span>優先順序</span>
                  <select
                    className="select"
                    value={m.priority}
                    onChange={(e) => updateMember(i, { priority: Number(e.target.value) || 0 })}
                    title="1 = 最優先。設定後會先讓第 1 優先的魔靈拿到最高目標分數，再依序最大化其他魔靈；所有符文仍不可重複。"
                  >
                    <option value={0}>不指定</option>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label>
                  <span>目標</span>
                  <select
                    className="select"
                    value={m.objectiveMode}
                    onChange={(e) => updateMember(i, { objectiveMode: e.target.value as ObjectiveMode })}
                    title="技能傷害：以選定技能的傷害當作搜尋目標；攻擊 / 防禦 / 體力：直接最大化該面板數值"
                  >
                    {(Object.keys(OBJECTIVE_LABELS) as ObjectiveMode[]).map((k) => (
                      <option key={k} value={k}>{OBJECTIVE_LABELS[k]}</option>
                    ))}
                  </select>
                </label>
                {m.objectiveMode === "skill" && (
                  <label style={{ gridColumn: "1 / -1" }}>
                    <span>技能傷害目標</span>
                    <select
                      className="select"
                      value={effSkill?.id ?? 0}
                      onChange={(e) => {
                        const id = Number(e.target.value) || 0;
                        updateMember(i, { skillId: id, skillSlot: skills.find((s) => s.id === id)?.slot ?? 0 });
                      }}
                      disabled={skills.length === 0}
                      title={skills.length === 0 ? "技能資料載入中…" : "選擇要用來最大化的技能"}
                    >
                      {skills.length === 0 ? (
                        <option value={0}>{v ? "技能資料載入中…" : "請先選擇魔靈"}</option>
                      ) : (
                        skills.map((s) => <option key={s.id} value={s.id}>S{s.slot} · {s.n}</option>)
                      )}
                    </select>
                  </label>
                )}
                <div className="team-mode">
                  <span>速度條件</span>
                  <div className="seg" role="radiogroup" aria-label={`第 ${i + 1} 隻速度條件`}>
                    <label className={`seg-item ${m.speedMode !== "tick" ? "on" : ""}`}>
                      <input
                        type="radio"
                        name={`speed-mode-${i}`}
                        checked={m.speedMode !== "tick"}
                        onChange={() => updateMember(i, { speedMode: "panel" })}
                      />
                      面板速度
                    </label>
                    <label className={`seg-item ${m.speedMode === "tick" ? "on" : ""}`}>
                      <input
                        type="radio"
                        name={`speed-mode-${i}`}
                        checked={m.speedMode === "tick"}
                        onChange={() => updateMember(i, { speedMode: "tick" })}
                      />
                      目標 Tick
                    </label>
                  </div>
                </div>
                {m.speedMode !== "tick" ? (
                  <label>
                    <span>面板速度（額外）</span>
                    <input
                      className="input mono"
                      type="number"
                      min={0}
                      value={m.panelExtra || ""}
                      placeholder={v ? `基礎 ${v.base.spd}` : "基礎 ?"}
                      onChange={(e) => updateMember(i, { panelExtra: Math.max(0, Number(e.target.value) || 0) })}
                      title={
                        v
                          ? `基礎速度 ${v.base.spd} + 隊長技 ${leadBonus(v.base.spd, leadPctOf(i))} + 額外速度；例如要 391 就輸入 ${Math.max(0, 391 - v.base.spd - leadBonus(v.base.spd, leadPctOf(i)))}。下限以「額外速度」為準，速度圖騰 / 強化會另外計入戰鬥速度。`
                          : "輸入基礎速度與隊長技以外的額外速度（下限以此為準）"
                      }
                    />
                  </label>
                ) : (
                  <label>
                    <span>目標 Tick</span>
                    <NumberInput className="input mono" min={0} max={20} value={m.tick} onChange={(v) => updateMember(i, { tick: Math.max(0, Math.min(20, v)) })} title="0 = 不限；此模式不採用面板速度" />
                  </label>
                )}
                <label>
                  <span>面板速度上限（額外）</span>
                  <NumberInput
                    className="input mono"
                    min={0}
                    max={500}
                    value={m.panelExtraMax}
                    onChange={(v) => updateMember(i, { panelExtraMax: Math.max(0, v) })}
                    title="0 = 不限；和上面的面板速度用同一種單位（基礎速度與隊長技以外的額外速度）"
                  />
                </label>
                <label>
                  <span>攻擊順序</span>
                  <div className="order-stepper">
                    <NumberInput
                      className="input mono"
                      min={1}
                      max={10}
                      value={m.order}
                      onChange={(v) => updateMember(i, { order: Math.max(1, Math.min(10, v)) })}
                      title="1 = 最先出手；接速以鏡像對手的攻擊條為門檻"
                    />
                    <span className="order-stepper-btns">
                      <button
                        type="button"
                        className="order-step"
                        aria-label="攻擊順序往前"
                        title="往前一位"
                        onClick={() => updateMember(i, { order: Math.max(1, m.order - 1) })}
                      >
                        <ChevronUp size={13} />
                      </button>
                      <button
                        type="button"
                        className="order-step"
                        aria-label="攻擊順序往後"
                        title="往後一位"
                        onClick={() => updateMember(i, { order: Math.min(10, m.order + 1) })}
                      >
                        <ChevronDown size={13} />
                      </button>
                    </span>
                  </div>
                </label>
                <label>
                  <span>提條 %</span>
                  <NumberInput className="input mono" min={0} max={100} value={m.boostPct} onChange={(v) => updateMember(i, { boostPct: Math.max(0, Math.min(100, v)) })} title="這隻魔靈會收到的攻擊條 %（例如 風格 S3 全隊 +30）" />
                </label>
                <label>
                  <span>隊長技 %</span>
                  <input
                    className="input mono"
                    type="number"
                    min={0}
                    max={50}
                    value={m.leadPct ?? ""}
                    placeholder={`第 ${teamIndex + 1} 隊 ${leadPcts[teamIndex] ?? 0}`}
                    onChange={(e) =>
                      updateMember(i, {
                        leadPct:
                          e.target.value === ""
                            ? null
                            : Math.max(0, Math.min(50, Number(e.target.value) || 0)),
                      })
                    }
                    title="速度隊長技加成（以這隻的基礎速度計算）；留空 = 跟隨全隊，輸入 0 = 這隻不吃隊長技"
                  />
                </label>
                <label>
                  <span>速度強化</span>
                  <select className="select" value={m.speedBuff ? "on" : "off"} onChange={(e) => updateMember(i, { speedBuff: e.target.value === "on" })}>
                    <option value="off">無</option>
                    <option value="on">有（+30%）</option>
                  </select>
                </label>
                <label>
                  <span>神器速度 +%</span>
                  <NumberInput
                    className="input mono"
                    min={0}
                    max={100}
                    value={m.artifactPct}
                    onChange={(v) => updateMember(i, { artifactPct: Math.max(0, Math.min(100, v)) })}
                    title="神器「速度增加效果 +%」（效果 206）；只有啟用速度強化時才會放大 Buff"
                  />
                </label>
                <label>
                  <span>抵抗下限</span>
                  <NumberInput className="input mono" min={0} max={100} value={m.min.res ?? 0} onChange={(v) => patchMin(i, "res", Math.max(0, Math.min(100, v)))} />
                </label>
                <label>
                  <span>暴率下限</span>
                  <NumberInput className="input mono" min={0} max={100} value={m.min.cr ?? 0} onChange={(v) => patchMin(i, "cr", Math.max(0, Math.min(100, v)))} />
                </label>
              </div>

              {laterCount > 0 && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => propagateBoost(i)}
                  title="把這隻當成提條來源：數值複製到後面出手的成員，這隻自己不會套用"
                >
                  <Zap size={12} /> 提條／強化帶入後續 {laterCount} 隻
                </button>
              )}

              <details className="team-advanced">
                <summary>套裝 / 主屬性</summary>
                <div className="team-mode" style={{ marginBottom: 8 }}>
                  <span>套裝模式</span>
                  <div className="seg" role="radiogroup" aria-label={`第 ${i + 1} 隻套裝模式`}>
                    <label className={`seg-item ${m.set4 !== 0 ? "on" : ""}`}>
                      <input
                        type="radio"
                        name={`set-mode-${i}`}
                        checked={m.set4 !== 0}
                        onChange={() =>
                          updateMember(i, {
                            set4: m.set4 || FOUR_SETS[0]?.id || 0,
                            set2b: 0,
                            set2c: 0,
                            ...(m.set2 === (m.set4 || FOUR_SETS[0]?.id) ? { set2: 0 } : {}),
                          })
                        }
                      />
                      4 + 2
                    </label>
                    <label className={`seg-item ${m.set4 === 0 ? "on" : ""}`}>
                      <input
                        type="radio"
                        name={`set-mode-${i}`}
                        checked={m.set4 === 0}
                        onChange={() => updateMember(i, { set4: 0 })}
                      />
                      3 × 2（三個 2 件套）
                    </label>
                  </div>
                </div>
                <div className="team-fields">
                  <label>
                    <span>4 件套</span>
                    <select className="select" value={m.set4} onChange={(e) => {
                      const set4 = Number(e.target.value);
                      updateMember(i, {
                        set4,
                        set2b: 0,
                        set2c: 0,
                        ...(set4 === m.set2 ? { set2: 0 } : {}),
                      });
                    }}>
                      <option value={0}>不指定</option>
                      {FOUR_SETS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </label>
                  {m.set4 === 0 ? (
                    <>
                      {([
                        ["set2", "2 件套 ①"],
                        ["set2b", "2 件套 ②"],
                        ["set2c", "2 件套 ③"],
                      ] as const).map(([key, label]) => (
                        <label key={key}>
                          <span>{label}</span>
                          <select
                            className="select"
                            value={m[key]}
                            onChange={(e) => updateMember(i, { [key]: Number(e.target.value) })}
                          >
                            <option value={0}>不指定</option>
                            {TWO_SETS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </label>
                      ))}
                    </>
                  ) : (
                    <label>
                      <span>2 件套</span>
                      <select className="select" value={m.set2} onChange={(e) => {
                        const set2 = Number(e.target.value);
                        updateMember(i, { set2, ...(set2 === m.set4 ? { set4: 0 } : {}) });
                      }}>
                        <option value={0}>不指定</option>
                        {TWO_SETS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </label>
                  )}
                  {([2, 4, 6] as number[]).map((slot) => (
                    <label key={slot}>
                      <span>{slot} 號主屬性</span>
                      <select className="select" value={m.mains[slot] ?? 0} onChange={(e) => {
                        const mains = { ...m.mains };
                        const v2 = Number(e.target.value);
                        if (v2) mains[slot] = v2; else delete mains[slot];
                        updateMember(i, { mains });
                      }}>
                        {MAIN_OPTIONS[slot].map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                {m.set4 === 0 && (
                  <div className="tiny dim" style={{ marginTop: 4 }}>
                    3×2 可以只選 1～3 組，同一套裝也能重複選：例如 ①保護 ②意志 ③意志＝保護 ×2＋意志 ×4；三個都選保護＝保護 ×6。
                  </div>
                )}
                <div className="tiny dim" style={{ marginTop: 8 }}>
                  數值下限（0 = 不限；從預設隊載入時會自動帶入目前面板）
                </div>
                <div className="team-fields">
                  {([
                    ["hp", "體力"],
                    ["atk", "攻擊"],
                    ["def", "防禦"],
                    ["cr", "暴率"],
                    ["cd", "暴傷"],
                    ["res", "抵抗"],
                    ["acc", "命中"],
                  ] as [StatKey, string][]).map(([key, label]) => (
                    <label key={key}>
                      <span>{label}下限</span>
                      <NumberInput
                        className="input mono"
                        min={0}
                        max={key === "cr" || key === "res" || key === "acc" ? 100 : 100000}
                        value={m.min[key] ?? 0}
                        onChange={(v) => patchMin(i, key, Math.max(0, v))}
                      />
                    </label>
                  ))}
                </div>
                <div className="tiny dim" style={{ marginTop: 8 }}>
                  數值上限（0 = 不限；實戰數值，速度用上面的「面板速度上限」）
                </div>
                <div className="team-fields">
                  {([
                    ["hp", "體力"],
                    ["atk", "攻擊"],
                    ["def", "防禦"],
                    ["cr", "暴率"],
                    ["cd", "暴傷"],
                    ["res", "抵抗"],
                    ["acc", "命中"],
                  ] as [StatKey, string][]).map(([key, label]) => (
                    <label key={key}>
                      <span>{label}上限</span>
                      <NumberInput
                        className="input mono"
                        min={0}
                        max={key === "cr" || key === "res" || key === "acc" ? 100 : 100000}
                        value={m.max[key] ?? 0}
                        onChange={(v) => patchMax(i, key, Math.max(0, v))}
                      />
                    </label>
                  ))}
                </div>
              </details>

              <FocusEditor
                value={m.focus}
                onChange={(focus) => updateMember(i, { focus })}
              />
              {(pinned || m.includeRunes.length > 0) && (
                <div className="tiny dim" style={{ marginTop: 4 }}>
                  已固定 {m.includeRunes.length} 顆符文
                </div>
              )}

              {pinned && (
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => unpinMember(m.unitId)}>
                    <Pin size={12} /> 解除固定
                  </button>
                </div>
              )}
              </div>
              </div>
            </Fragment>
          );
        })}
      </div>

      {/* 即時接速 */}
      {/* 即時接速：鏡像防守 */}
      <div className="card card-pad" style={{ marginTop: 12 }}>
        <div className="row between wrap" style={{ gap: 8 }}>
          <div>
            <div className="card-title row" style={{ gap: 7 }}>
              <Gauge size={14} className="gold" /> 接速：鏡像防守檢查
            </div>
            <div className="tiny dim team-follow-desc" style={{ marginTop: 3, maxWidth: 780 }}>
              提條角先出手後，對手的防守提條角仍會繼續累積攻擊條（可以溢出 100%）。只要接速成員在輪到它的 Tick 攻擊條高過對手，就不會被插隊；攻擊條相同時進攻方先動。預設對手＝和你起手同速的鏡像防守。提條與速度強化都在起手之後才生效。
            </div>
            {orderConflicts.length > 0 && (
              <div className="tiny" style={{ color: "var(--red)", marginTop: 5, lineHeight: 1.7 }}>
                <AlertTriangle size={12} /> 攻擊順序衝突：
                {orderConflicts.slice(0, 3).map((c) => {
                  const a = viewOf(members[c.earlier]?.unitId ?? 0);
                  const b = viewOf(members[c.later]?.unitId ?? 0);
                  return `${a ? unitLabel(a.unit) : `#${c.earlier + 1}`}（順序 ${c.earlierOrder}，${c.earlierSpd}）沒有比 ${b ? unitLabel(b.unit) : `#${c.later + 1}`}（順序 ${c.laterOrder}，${c.laterSpd}）快`;
                }).join("；")}
                。後面的接速下限較高時，請按「修正順序」把前面的成員一起調快。
              </div>
            )}
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            <label className="row" style={{ gap: 5 }}>
              <span className="tiny dim">鏡像對手速度</span>
              <input
                className="input mono"
                style={{ width: 88 }}
                type="number"
                min={0}
                value={oppSpd || ""}
                placeholder={followInfo[0]?.autoOpp ? String(followInfo[0].autoOpp) : "同起手"}
                onChange={(e) => setOppSpd(Math.max(0, Number(e.target.value) || 0))}
                title="0 / 留空 = 使用起手提條角的同速鏡像"
              />
            </label>
            <span className="chip muted">每 Tick {rta ? "1.5%" : "7%"}</span>
            <button type="button" className="btn btn-sm" onClick={applyAllFollow}>
              <Gauge size={12} /> 全部套用接速
            </button>
            {orderConflicts.length > 0 && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={applyAllFollow}
                title="把前面出手的成員一起調快，讓速度順序符合攻擊順序"
              >
                <Wand2 size={12} /> 修正順序
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm btn-ghost team-collapse-toggle"
              aria-expanded={openFollow}
              onClick={() => setOpenFollow((v) => !v)}
            >
              {openFollow ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {openFollow ? "收合檢查" : "展開檢查"}
            </button>
          </div>
        </div>

        <div className={`team-follow-body ${openFollow ? "open" : ""}`}>
        {followInfo.map((info, t) => (
          <div key={t} className={teams > 1 ? "team-follow" : undefined}>
            {teams > 1 && (
              <div className="row between wrap" style={{ gap: 8, marginTop: 14, paddingTop: 10, borderTop: "1px dashed var(--line-soft)" }}>
                <span className="team-group-title">第 {t + 1} 隊</span>
                <span className="tiny dim">速度隊長技 {leadPcts[t] ?? 0}%</span>
              </div>
            )}

            {info.steps.length > 0 && (
              <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
                <span className="tiny dim">鏡像預測：</span>
                {info.steps.map((s, i) => {
                  const v = viewOf(members[s.index]?.unitId ?? 0);
                  const name = v ? unitLabel(v.unit) : `#${s.index + 1}`;
                  return (
                    <span
                      key={`${s.tick}-${s.team}-${s.index}-${i}`}
                      className={`chip ${s.team === "ally" ? "green" : "red"}`}
                      title={`T${s.tick} 出手時攻擊條 ${s.ab}%`}
                    >
                      T{s.tick} {s.team === "ally" ? "你" : "對手"} {name}
                    </span>
                  );
                })}
                {info.verdict === "safe" && <span className="chip green">✓ 對手插不進來</span>}
                {info.verdict === "cut" &&
                  (info.failing.length > 0 ? (
                    <span className="chip red">
                      ✗{" "}
                      {info.failing
                        .map((f) => {
                          const v = viewOf(members[f.index]?.unitId ?? 0);
                          return `${v ? unitLabel(v.unit) : `#${f.index + 1}`}（T${f.targetTick}）`;
                        })
                        .join("、")}{" "}
                      會被插隊
                    </span>
                  ) : (
                    <span className="chip red">✗ 對手會在 T{info.firstOpp?.tick} 插隊</span>
                  ))}
              </div>
            )}

            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(235px, 1fr))", gap: 8, marginTop: 10 }}>
              {info.ordered.map((r) => {
                const v = viewOf(members[r.index]?.unitId ?? 0);
                const isOpener = r.position === 0;
                const hasTarget = r.targetTick != null;
                const hasSpeed = r.panelSpd != null || r.currentSpd != null;
                const statusClass = isOpener
                  ? "green"
                  : !hasTarget
                    ? "muted"
                    : r.met == null
                      ? "muted"
                      : r.met
                        ? "green"
                        : "red";
                const statusText = isOpener
                  ? "起手"
                  : !hasTarget
                    ? "無接速下限"
                    : r.met == null
                      ? "未設速度"
                      : r.met
                        ? "安全"
                        : "會被插隊";
                return (
                  <div key={r.index} className="team-result-member" style={{ padding: 9 }}>
                    <div className="row between" style={{ gap: 6 }}>
                      <span className="chip gold">順序 {r.position + 1}</span>
                      <span className={`chip ${statusClass}`}>{statusText}</span>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 12.5, marginTop: 6 }}>
                      {v ? unitLabel(v.unit) : "尚未選擇"}
                    </div>
                    <div className="row wrap tiny dim" style={{ gap: 6, marginTop: 4 }}>
                      <span>{isOpener ? `起手 T${r.effectiveTick ?? "—"}` : `對齊 T${r.targetTick}`}</span>
                      {!isOpener && <span>提條 {r.boostPct}%</span>}
                      {r.buffPct > 0 && <span className="gold">強化 +{Math.round(r.buffPct * 10) / 10}%</span>}
                    </div>

                    {isOpener ? (
                      <div className="row between wrap" style={{ gap: 6, marginTop: 8 }}>
                        <span className="tiny dim">沒有接速下限</span>
                        <span className="chip muted">
                          {r.panelSpd != null
                            ? `面板 ${r.panelSpd}（${v ? v.base.spd : "—"}${r.leadFlat > 0 ? ` + ${r.leadFlat}` : ""} + 額外 ${Math.max(0, r.panelSpd - (v?.base.spd ?? 0) - r.leadFlat)}）→ T${r.panelTick ?? "—"}`
                            : r.currentSpd != null
                              ? `目前 ${r.currentSpd} → T${r.currentTick ?? "—"}`
                              : "尚未設定速度"}
                        </span>
                      </div>
                    ) : (
                      <>
                        <div className="row between wrap" style={{ gap: 6, marginTop: 7 }}>
                          <span className="tiny dim">
                            最低速度{" "}
                            <b className={hasTarget ? "gold mono" : "muted mono"}>
                              {hasTarget && Number.isFinite(r.minSpeed) ? r.minSpeed : "—"}
                            </b>
                            {hasTarget && v && Number.isFinite(r.minSpeed) && (
                              <span className="dim mono">
                                {" "}
                                （{v.base.spd}
                                {r.leadFlat > 0 ? ` + 隊長 ${r.leadFlat}` : ""} + 額外{" "}
                                {Math.max(0, r.minSpeed - v.base.spd - r.leadFlat)}）
                              </span>
                            )}
                          </span>
                          <span className="tiny dim">
                            對手攻擊條 <b className="mono">{r.opponentAb ? `${r.opponentAb.toFixed(1)}%` : "—"}</b>
                          </span>
                        </div>
                        <div className="row between" style={{ gap: 6, marginTop: 6 }}>
                          <span className="tiny dim">
                            我方 T{r.targetTick}{" "}
                            <b className={r.met ? "green mono" : hasSpeed ? "red mono" : "muted mono"}>
                              {r.myAb != null ? `${r.myAb.toFixed(1)}%` : "—"}
                            </b>
                          </span>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            disabled={!hasTarget || !v || !Number.isFinite(r.minSpeed)}
                            onClick={() => applyFollowFloor(r.index)}
                            title="把面板速度設成不被鏡像對手插隊的最低值"
                          >
                            套用下限
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        </div>
      </div>

      {/* 供給檢查 + 執行 */}
      <div className="card card-pad" style={{ marginTop: 12 }}>
        <div className="row between wrap" style={{ gap: 8 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="tiny dim">符文供給（每位置可用 / 需求）：</span>
            {supply.map((s) => (
              <span key={s.slot} className={`chip ${s.count >= s.need ? "muted" : "red"}`}>
                位置 {s.slot} {s.count}/{s.need}
              </span>
            ))}
          </div>
          <div className="row" style={{ gap: 6 }}>
            {running || seqRunning ? (
              <>
                <span className="tiny dim row" style={{ gap: 6 }}>
                  <Loader2 size={13} className="spin" />
                  {seqRunning
                    ? `正在為第 ${seqIndex + 1}/${members.length} 隻產生候選配裝…`
                    : progress
                      ? progress.stage === "candidates"
                        ? `正在產生第 ${progress.member + 1}/${progress.total} 隻的候選配裝…`
                        : progress.stage === "search"
                          ? `正在聯合挑選第 ${progress.member + 1}/${progress.total} 隻…`
                          : "正在局部改良…"
                      : "運算中…"}
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={seqRunning ? cancelSeq : cancel}
                >
                  取消
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={runPrimary} disabled={members.some((m) => !m.unitId)}>
                <Wand2 size={15} />{" "}
                {optMode === "sequential"
                  ? seqPicks.some(Boolean)
                    ? "重新開始逐隻配"
                    : "開始逐隻配"
                  : teams > 1
                    ? `一鍵配 ${teams} 隊`
                    : "一鍵配一隊"}
              </button>
            )}
          </div>
        </div>
        {ignoredIncludes.length > 0 && (
          <div className="tiny" style={{ color: "var(--gold, #f2c65c)", marginTop: 6 }}>
            <AlertTriangle size={12} /> 有 {ignoredIncludes.length} 顆「包括」符文屬於隊外魔靈，這次不會使用。
          </div>
        )}
      </div>

      {optMode === "sequential" && (
        <div id="seq-panel" className="card card-pad" style={{ marginTop: 14 }}>
          <div className="row between wrap" style={{ gap: 8 }}>
            <div>
              <div className="card-title row" style={{ gap: 7 }}>
                <Wand2 size={15} className="gold" /> 逐隻配＋排除
              </div>
              <div className="tiny dim" style={{ marginTop: 3 }}>
                先配第 1 隻，從候選中選一組後自動排除它的符文，再配下一隻。就像 SWOP 的逐隻流程。
              </div>
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {seqPicks.some(Boolean) && !seqRunning && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    resetSequence();
                    startSeqAt(0, Array.from({ length: members.length }, () => null));
                  }}
                >
                  重新開始
                </button>
              )}
            </div>
          </div>

          <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
            {members.map((m, i) => {
              const v = viewOf(m.unitId);
              const pick = seqPicks[i];
              const active = i === seqIndex;
              return (
                <button
                  key={i}
                  type="button"
                  className={`chip ${active ? "gold" : pick ? "green" : "muted"}`}
                  style={{ cursor: seqRunning ? "default" : "pointer" }}
                  disabled={seqRunning}
                  onClick={() => goSeqTo(i)}
                  title={pick ? `已選：戰鬥 SPD ${pick.stats.spd}；點一下可重配這隻與後面` : "點一下從這隻開始配"}
                >
                  {i + 1}. {v ? unitLabel(v.unit) : "未選擇"}
                  {pick ? ` · SPD ${pick.stats.spd}` : active ? " · 進行中" : ""}
                </button>
              );
            })}
            {seqIndex >= members.length && <span className="chip green"><Check size={11} /> 完成</span>}
          </div>

          <div className="tiny dim" style={{ marginTop: 6 }}>
            已選 {seqPicks.filter(Boolean).length}/{members.length} 隻
            · 這次逐隻配已排除 {seqUsedRunes.size} 顆符文
            {settings.excludedRunes.length > 0 ? `（含全域排除 ${settings.excludedRunes.length} 顆）` : ""}
          </div>

          {!seqRunning && seqCandidates.length === 0 && !seqPicks.some(Boolean) && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => startSeqAt(0, Array.from({ length: members.length }, () => null))}
              >
                <Wand2 size={13} /> 開始逐隻配（第 1 隻）
              </button>
            </div>
          )}

          {seqError && (
            <div className="tiny" style={{ color: "var(--red)", marginTop: 8 }}>
              <AlertTriangle size={12} /> {seqError}
            </div>
          )}
          {seqNote && (
            <div className="tiny" style={{ color: "var(--gold, #f2c65c)", marginTop: 8 }}>
              <AlertTriangle size={12} /> {seqNote}
            </div>
          )}

          {seqRunning && (
            <div className="row tiny dim" style={{ gap: 6, marginTop: 10 }}>
              <Loader2 size={13} className="spin" /> 正在計算第 {seqIndex + 1}/{members.length} 隻的候選配裝…
            </div>
          )}

          {!seqRunning && seqCandidates.length > 0 && (
            <>
              <div className="row between wrap" style={{ gap: 8, marginTop: 12 }}>
                <div className="tiny" style={{ fontSize: 12.5 }}>
                  第 <b className="gold">{seqIndex + 1}</b>/{members.length} 隻：
                  <b style={{ margin: "0 4px" }}>
                    {seqCurrentView ? unitLabel(seqCurrentView.unit) : "魔靈"}
                  </b>
                  的候選配裝（{seqCandidates.length} 組）
                  {seqCurrent && (
                    <span className="chip muted" style={{ marginLeft: 6 }}>
                      目標：{OBJECTIVE_LABELS[seqCurrent.objectiveMode]}
                    </span>
                  )}
                </div>
                <div className="row wrap" style={{ gap: 5 }}>
                  <span className="tiny dim">候選 {seqPageStart + 1}–{Math.min(seqPageStart + RESULT_PAGE_SIZE, seqCandidates.length)} / {seqCandidates.length}</span>
                  {seqPageCount > 1 && (
                    <>
                      <button
                        type="button"
                        className="chip muted"
                        style={{ cursor: "pointer" }}
                        disabled={seqPageSafe === 0}
                        onClick={() => setSeqPage((p) => Math.max(0, p - 1))}
                        title="上一頁候選"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        className="chip muted"
                        style={{ cursor: "pointer" }}
                        disabled={seqPageSafe >= seqPageCount - 1}
                        onClick={() => setSeqPage((p) => Math.min(seqPageCount - 1, p + 1))}
                        title="下一頁候選"
                      >
                        ›
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 8 }}>
                {seqPageBuilds.map((b, i) => {
                  const rank = seqPageStart + i + 1;
                  const runes = b.runeIds
                    .map((id) => runeMap.get(id))
                    .filter((r): r is NonNullable<typeof r> => !!r);
                  const setsText = setSummary(teamSetsOf(b.runeIds, runeMap, [], false));
                  return (
                    <div key={rank} className="card" style={{ padding: 10, marginTop: i === 0 ? 0 : 8 }}>
                      <div className="row between wrap" style={{ gap: 8 }}>
                        <div className="row wrap" style={{ gap: 6, minWidth: 0 }}>
                          <span className={`chip ${rank === 1 ? "gold" : "muted"}`}>#{rank}</span>
                          <span className="chip muted">{setsText || "無套裝"}</span>
                          {b.focusFit > 0 && <span className="chip muted">焦點契合 {Math.round(b.focusFit)}%</span>}
                          <span className="chip muted">效率 {Math.round(b.eff)}%</span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => chooseSeqBuild(b)}
                        >
                          {seqIndex + 1 >= members.length ? "用這組，完成" : "用這組 → 下一隻"}
                        </button>
                      </div>
                      <div className="row wrap tiny mono" style={{ gap: 10, marginTop: 7 }}>
                        <span>目標 <b className="gold">{fmt(b.objective)}</b></span>
                        <span>SPD <b>{b.stats.spd}</b> <TickBadge spd={b.stats.spd} rta={rta} /></span>
                        <span>HP {fmt(b.stats.hp)}</span>
                        <span>ATK {fmt(b.stats.atk)}</span>
                        <span>DEF {fmt(b.stats.def)}</span>
                        <span>CR {b.stats.cr}%</span>
                        <span>CD {b.stats.cd}%</span>
                        <span>RES {b.stats.res}%</span>
                        <span>ACC {b.stats.acc}%</span>
                        <span>EHP {fmt(b.ehp)}</span>
                      </div>
                      <details style={{ marginTop: 7 }}>
                        <summary className="tiny dim" style={{ cursor: "pointer" }}>
                          符文 {runes.length}/6 · 依遊戲位置 1 → 6
                        </summary>
                        <div style={{ marginTop: 8 }}>
                          <RuneBoard
                            runes={runes}
                            renderRune={(r) => (
                              <RuneCard
                                rune={r}
                                owner={seqCurrentView ? unitLabel(seqCurrentView.unit) : undefined}
                              />
                            )}
                          />
                        </div>
                      </details>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="card card-pad" style={{ marginTop: 12, borderColor: "rgba(255,107,107,.35)" }}>
          <div className="row" style={{ gap: 8, color: "var(--red)" }}>
            <AlertTriangle size={15} />
            <span style={{ fontSize: 12.5 }}>{error}</span>
          </div>
        </div>
      )}

      {activePlan && (
        <div id="team-result" className="card card-pad team-result" style={{ marginTop: 14 }}>
          <div className="row between wrap" style={{ gap: 8 }}>
            <div>
              <div className="card-title row" style={{ gap: 7 }}>
                <Check size={15} className="gold" /> {optMode === "sequential" ? "逐隻配結果" : "配隊結果"}
              </div>
              <div className="tiny dim" style={{ marginTop: 3 }}>
                隊伍分數 <b className="gold">{Math.round(activePlan.teamScore * 10) / 10}</b> / {totalWeight}
                （{Math.round((activePlan.teamScore / Math.max(1, totalWeight)) * 100)}%）
                · 平均效率 {Math.round(activePlan.totalEff)}%
                · 用時{" "}
                {activePlan.searchMs < 1000
                  ? `${Math.max(1, Math.round(activePlan.searchMs))} ms`
                  : `${(activePlan.searchMs / 1000).toFixed(1)} s`}
                · 節點 {fmt(activePlan.nodes)}
              </div>
              {activePlan.members.some((m) => m.priority > 0) && (
                <div className="tiny dim" style={{ marginTop: 3 }}>
                  優先順序：
                  {[...activePlan.members]
                    .filter((m) => m.priority > 0)
                    .sort((a, b) => a.priority - b.priority)
                    .map((m) => `${m.priority}. ${nameOf(m.unitId, m.master)}`)
                    .join(" → ")}
                  <span className="dim">（先最大化第 1 優先，再依序最大化其他魔靈）</span>
                </div>
              )}
            </div>
            <div className="row wrap" style={{ gap: 5 }}>
              <span className="tiny dim">顯示</span>
              <button
                type="button"
                className={`chip ${resultView === "cards" ? "gold" : "muted"}`}
                style={{ cursor: "pointer" }}
                onClick={() => setResultView("cards")}
              >
                卡片
              </button>
              <button
                type="button"
                className={`chip ${resultView === "table" ? "gold" : "muted"}`}
                style={{ cursor: "pointer" }}
                onClick={() => setResultView("table")}
              >
                表格
              </button>
              {resultView === "cards" && (
                <>
                  <span className="tiny dim" style={{ marginRight: 2 }}>
                    隊伍 {altIndex + 1} / {allPlans.length}
                  </span>
                  {resultPageCount > 1 && (
                    <button
                      type="button"
                      className="chip muted"
                      style={{ cursor: "pointer" }}
                      disabled={resultPage === 0}
                      onClick={() => setAltIndex(Math.max(0, (resultPage - 1) * RESULT_PAGE_SIZE))}
                      title="上一頁隊伍"
                    >
                      ‹
                    </button>
                  )}
                  {pagePlans.map((p, i) => {
                    const idx = resultPageStart + i;
                    return (
                      <button
                        key={idx}
                        type="button"
                        className={`chip ${altIndex === idx ? "gold" : "muted"}`}
                        style={{ cursor: "pointer" }}
                        title={`隊伍分數 ${Math.round(p.teamScore * 10) / 10} / ${totalWeight}（${Math.round((p.teamScore / Math.max(1, totalWeight)) * 100)}%）`}
                        onClick={() => setAltIndex(idx)}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}
                  {resultPageCount > 1 && (
                    <button
                      type="button"
                      className="chip muted"
                      style={{ cursor: "pointer" }}
                      disabled={resultPage >= resultPageCount - 1}
                      onClick={() => setAltIndex(Math.min(allPlans.length - 1, (resultPage + 1) * RESULT_PAGE_SIZE))}
                      title="下一頁隊伍"
                    >
                      ›
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost team-collapse-toggle"
                    onClick={() =>
                      setOpenResults((prev) =>
                        prev.size > 0 ? new Set() : new Set(activePlan.members.map((m) => m.unitId)),
                      )
                    }
                  >
                    {openResults.size > 0 ? "收合全部" : "展開全部"}
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn btn-sm btn-ghost team-collapse-toggle"
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                title="回到上面的隊伍設定"
              >
                ↑ 設定
              </button>
            </div>
          </div>

          {activePlan.truncated && (
            <div className="tiny" style={{ color: "var(--gold, #f2c65c)", marginTop: 6 }}>
              <AlertTriangle size={12} /> 搜尋已達節點上限，結果可能不是最佳；可把預算改成「完整」再試。
            </div>
          )}

          {activePlan.notes.length > 0 && (
            <div className="tiny" style={{ color: "var(--gold, #f2c65c)", marginTop: 6 }}>
              <AlertTriangle size={12} /> {activePlan.notes.join(" ")}
            </div>
          )}

          {resultView === "table" && (
            <div style={{ marginTop: 12 }}>
              <div className="row wrap" style={{ gap: 6, alignItems: "center" }}>
                <span className="tiny dim">篩選 {tableFilters.length}/{MAX_TABLE_FILTERS}</span>
                <select
                  className="select"
                  style={{ width: 150 }}
                  value={filterMember}
                  onChange={(e) => setFilterMember(Number(e.target.value))}
                >
                  {activePlan.members.map((m, i) => (
                    <option key={i} value={i} style={{ color: memberAccent(i).c }}>
                      {i + 1}. {nameOf(m.unitId, m.master)}
                    </option>
                  ))}
                </select>
                <select
                  className="select"
                  style={{ width: 120 }}
                  value={filterStat}
                  onChange={(e) => setFilterStat(e.target.value as TableStatKey)}
                >
                  {TABLE_STATS.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
                <input
                  className="input mono"
                  style={{ width: 82 }}
                  type="number"
                  placeholder="下限"
                  value={filterMin}
                  onChange={(e) => setFilterMin(e.target.value)}
                />
                <input
                  className="input mono"
                  style={{ width: 82 }}
                  type="number"
                  placeholder="上限"
                  value={filterMax}
                  onChange={(e) => setFilterMax(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={addTableFilter}
                  disabled={tableFilters.length >= MAX_TABLE_FILTERS}
                  title={tableFilters.length >= MAX_TABLE_FILTERS ? `最多 ${MAX_TABLE_FILTERS} 個篩選條件` : "加入篩選條件"}
                >
                  加入篩選
                </button>
                <span className="tiny dim" style={{ marginLeft: 8 }}>排序</span>
                <select
                  className="select"
                  style={{ width: 190 }}
                  value={tableSort.member == null ? "score" : `${tableSort.member}:${tableSort.stat}`}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "score") {
                      setTableSort({ member: null, stat: "score", dir: "desc" });
                      return;
                    }
                    const [mi, stat] = v.split(":");
                    setTableSort({ member: Number(mi), stat: stat as TableStatKey, dir: "desc" });
                  }}
                >
                  <option value="score">組合分數</option>
                  {activePlan.members.flatMap((m, mi) =>
                    TABLE_STATS.map((s) => (
                      <option key={`${mi}:${s.key}`} value={`${mi}:${s.key}`} style={{ color: memberAccent(mi).c }}>
                        {mi + 1}. {nameOf(m.unitId, m.master)} · {s.label}
                      </option>
                    )),
                  )}
                </select>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => setTableSort((prev) => ({ ...prev, dir: prev.dir === "asc" ? "desc" : "asc" }))}
                  title="切換排序方向"
                >
                  {tableSort.dir === "asc" ? "↑ 低到高" : "↓ 高到低"}
                </button>
                {tableFilters.length > 0 && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTableFilters([])}>
                    清除全部
                  </button>
                )}
              </div>

              {tableFilters.length > 0 && (
                <div className="row wrap" style={{ gap: 5, marginTop: 7 }}>
                  {tableFilters.map((f, i) => (
                    <span key={i} className="chip team-table-filter-chip" style={accentVars(f.member)}>
                      {activePlan.members[f.member] ? nameOf(activePlan.members[f.member].unitId, activePlan.members[f.member].master) : `第 ${f.member + 1} 隻`}
                      {" · "}
                      {TABLE_STAT_LABEL[f.stat]}
                      {f.min != null ? ` ≥ ${f.min}` : ""}
                      {f.max != null ? ` ≤ ${f.max}` : ""}
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost btn-icon"
                        style={{ marginLeft: 3, padding: 0 }}
                        onClick={() => removeTableFilter(i)}
                        title="移除這個篩選"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="row between wrap" style={{ gap: 8, marginTop: 8 }}>
                <span className="tiny dim">
                  符合 <b className="gold">{tableRows.length}</b> / {allPlans.length} 組
                  · 每頁 {TABLE_PAGE_SIZE} 組
                </span>
                <div className="row" style={{ gap: 5 }}>
                  <button
                    type="button"
                    className="chip muted"
                    style={{ cursor: "pointer" }}
                    disabled={tablePageSafe <= 0}
                    onClick={() => setTablePage((p) => Math.max(0, p - 1))}
                    title="上一頁"
                  >
                    ‹
                  </button>
                  <span className="tiny dim">第 {tablePageSafe + 1} / {tablePageCount} 頁</span>
                  <button
                    type="button"
                    className="chip muted"
                    style={{ cursor: "pointer" }}
                    disabled={tablePageSafe >= tablePageCount - 1}
                    onClick={() => setTablePage((p) => Math.min(tablePageCount - 1, p + 1))}
                    title="下一頁"
                  >
                    ›
                  </button>
                </div>
              </div>

              <div className="row wrap team-table-legend" style={{ gap: 6, marginTop: 8 }}>
                <span className="tiny dim">顏色對照</span>
                {activePlan.members.map((m, mi) => (
                  <span
                    key={mi}
                    className="team-table-legend-item"
                    style={accentVars(mi)}
                    title={`${nameOf(m.unitId, m.master)}：表格中這個顏色的欄位都屬於牠`}
                  >
                    <i />
                    {mi + 1}. {nameOf(m.unitId, m.master)}
                  </span>
                ))}
              </div>

              <div className="table-scroll" style={{ marginTop: 6 }}>
                <table className="table team-table" style={{ minWidth: 150 + activePlan.members.length * 650 }}>
                  <thead>
                    <tr>
                      <th rowSpan={2}>#</th>
                      <th
                        rowSpan={2}
                        style={{ cursor: "pointer" }}
                        onClick={() =>
                          setTableSort((prev) =>
                            prev.member == null
                              ? { ...prev, dir: prev.dir === "desc" ? "asc" : "desc" }
                              : { member: null, stat: "score", dir: "desc" },
                          )
                        }
                        title="點擊依組合分數排序"
                      >
                        分數{tableSort.member == null ? (tableSort.dir === "asc" ? " ↑" : " ↓") : ""}
                      </th>
                      {activePlan.members.map((m, mi) => (
                        <th
                          key={mi}
                          colSpan={TABLE_STATS.length}
                          className="team-table-group-head"
                          style={accentVars(mi)}
                        >
                          <span className="team-table-group-name">
                            <MonsterIcon id={m.master} size={18} />
                            <span className="team-table-group-index">{mi + 1}</span>
                            {nameOf(m.unitId, m.master)}
                          </span>
                        </th>
                      ))}
                    </tr>
                    <tr>
                      {activePlan.members.flatMap((m, mi) =>
                        TABLE_STATS.map((s, si) => {
                          const active = tableSort.member === mi && tableSort.stat === s.key;
                          return (
                            <th
                              key={`${mi}:${s.key}`}
                              className={`team-table-subhead ${si === 0 ? "team-table-group-start" : ""}`}
                              style={{ cursor: "pointer", whiteSpace: "nowrap", ...accentVars(mi) }}
                              onClick={() => toggleHeaderSort(mi, s.key)}
                              title="點擊切換排序（再點一次切換高低）"
                            >
                              {s.label}{active ? (tableSort.dir === "asc" ? " ↑" : " ↓") : ""}
                            </th>
                          );
                        }),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {tablePageRows.map(({ p, index }) => (
                      <tr
                        key={index}
                        className={altIndex === index ? "is-active" : undefined}
                        style={{ cursor: "pointer" }}
                        onClick={() => setAltIndex(index)}
                      >
                        <td className="num"><b>#{index + 1}</b></td>
                        <td className="num">
                          {Math.round(p.teamScore * 10) / 10}
                          <span className="tiny dim"> / {totalWeight}</span>
                        </td>
                        {p.members.flatMap((m, mi) =>
                          TABLE_STATS.map((s, si) => (
                            <td
                              key={`${mi}:${s.key}`}
                              className={`num team-table-cell ${si === 0 ? "team-table-group-start" : ""}`}
                              style={accentVars(mi)}
                            >
                              {tableStatText(tableStatValue(m, s.key), s.key)}
                            </td>
                          )),
                        )}
                      </tr>
                    ))}
                    {tableRows.length === 0 && (
                      <tr>
                        <td colSpan={2 + activePlan.members.length * TABLE_STATS.length} className="tiny dim" style={{ textAlign: "center", padding: 18 }}>
                          沒有符合目前篩選條件的組合，請放寬下限 / 上限或清除篩選。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="tiny dim" style={{ marginTop: 5 }}>
                點表格列可切換到該組（再按上方「卡片」看完整符文）；點欄位標題可依該數值排序，再點一次切換高低。
                每一隻魔靈的欄位都有自己的顏色與色塊邊框，滑過表格列時顏色會加深，方便追蹤數值。
              </div>
            </div>
          )}

          {resultView === "cards" && (Array.from({ length: teams }, (_, t) => {
            // 結果卡片依攻擊順序排列（配出來的速度也會依這個順序遞減）
            const teamBuilds = [...activePlan.members.slice(t * size, (t + 1) * size)].sort(
              (a, b) => a.order - b.order,
            );
            return (
              <div key={t}>
                {teams > 1 && (
                  <div className="row between wrap" style={{ gap: 8, marginTop: 16, paddingTop: 10, borderTop: "1px dashed var(--line-soft)" }}>
                    <span className="team-group-title">第 {t + 1} 隊</span>
                    <span className="tiny dim">
                      平均效率{" "}
                      {Math.round(teamBuilds.reduce((s, m) => s + m.eff, 0) / Math.max(1, teamBuilds.length))}%
                    </span>
                  </div>
                )}

                <div className="deck-speedbar" style={{ marginTop: 10 }}>
                  <div className="row between" style={{ marginBottom: 6 }}>
                    <span className="tiny dim">速度順序</span>
                    <span className="tiny dim">Speed Tick</span>
                  </div>
                  <div className="row wrap" style={{ gap: 5 }}>
                    {(planSpeedOrders[t] ?? []).map((m, i) => (
                      <span key={m.unitId} className="chip muted" title={`戰鬥 SPD ${m.stats.spd} · 面板 ${m.stats.panelSpd ?? m.stats.spd} · Tick ${m.stats.tick}`}>
                        <b className="gold">{i + 1}</b>
                        <span style={{ margin: "0 4px" }}>{nameOf(m.unitId, m.master)}</span>
                        <span className="mono">{m.stats.spd}</span>
                        <span style={{ marginLeft: 4 }}>T{m.stats.tick}</span>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="team-result-grid">
                  {teamBuilds.map((m) => {
              const runes = m.runeIds.map((id) => runeMap.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
              const v = viewOf(m.unitId);
              const artifacts = v?.artifacts ?? [];
              return (
                <div key={m.unitId} className="team-result-member">
                  <div className="row between wrap" style={{ gap: 8 }}>
                    <div className="row" style={{ gap: 8, minWidth: 0 }}>
                      <MonsterIcon id={m.master} size={44} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{nameOf(m.unitId, m.master)}</div>
                        <div className="tiny dim">
                          <span className="chip muted" style={{ marginRight: 4 }}>順序 {m.order}</span>
                          {m.priority > 0 && <span className="chip gold" style={{ marginRight: 4 }}>優先 {m.priority}</span>}
                          {TEAM_ROLE_LABELS[m.role]} · 個人最佳 {Math.round(m.norm * 100)}%
                          {m.objective === "skill" && m.skillName ? ` · ${m.skillName}` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <TickBadge spd={m.stats.spd} rta={rta} />
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost team-collapse-toggle"
                        aria-expanded={openResults.has(m.unitId)}
                        onClick={() => toggleResultOpen(m.unitId)}
                      >
                        {openResults.has(m.unitId) ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        {openResults.has(m.unitId) ? "收合" : "詳情"}
                      </button>
                    </div>
                  </div>

                  <div className={`team-result-body ${openResults.has(m.unitId) ? "open" : ""}`}>
                  <div className="team-member-body">
                    <div className="team-member-stats">
                      <StatRows
                        stats={m.stats}
                        base={v?.base}
                        className="stat-rows-flat"
                        extra={[
                          {
                            label: "EHP",
                            value: <span title="含一般召喚師技能；公會技能不計入">{fmt(m.ehp)}</span>,
                          },
                          ...(m.objective === "skill"
                            ? [{ label: "技能傷害", value: <b className="gold">{fmt(m.score)}</b> }]
                            : []),
                        ]}
                      />
                      <div className="tiny dim" style={{ marginTop: 7 }}>
                        {setSummary(m.sets) || "無套裝加成"} · 效率 {Math.round(m.eff)}%
                      </div>
                    </div>

                    <div className="team-member-runes">
                      <div className="rune-wheel-head">
                        <span className="rune-wheel-title">符文</span>
                        <span className="tiny dim">
                          {runes.length}/6 · 依遊戲位置 1 → 6
                          <span className="mobile-only"> · 左右滑動</span>
                        </span>
                      </div>
                      <RuneBoard
                        runes={runes}
                        renderRune={(r) => <RuneCard rune={r} owner={nameOf(m.unitId, m.master)} />}
                      />
                    </div>
                  </div>

                  {artifacts.length > 0 && (
                    <details className="team-member-artifacts">
                      <summary className="tiny dim">
                        目前神器 {artifacts.length}/2
                        <span className="dim"> · 一鍵配隊只配置符文，神器不計入面板數值</span>
                      </summary>
                      <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8, marginTop: 8 }}>
                        {artifacts.map((a) => <ArtifactCard key={a.id} artifact={a} owner={nameOf(m.unitId, m.master)} />)}
                      </div>
                    </details>
                  )}

                  <div className="row" style={{ gap: 6, marginTop: 8 }}>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => pinMember(m.unitId)} title="固定這隻的符文，重新配其他魔靈">
                      <Pin size={12} /> 固定這隻
                    </button>
                  </div>
                  </div>
                </div>
              );
            })}
                </div>
              </div>
            );
          }))}

          <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={equipPlan}><Shirt size={13} /> {teams > 1 ? "全部上符" : "整隊上符"}</button>
            <button type="button" className="btn btn-sm" onClick={lockPlan}><Lock size={13} /> {teams > 1 ? "鎖定全部符文" : "鎖定這隊符文"}</button>
            <button type="button" className="btn btn-sm" onClick={savePlan}><Save size={13} /> {teams > 1 ? `儲存 ${teams} 隊` : "儲存到儲存庫"}</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={copyPlan}><Copy size={13} /> 複製清單</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={runPrimary}><Gauge size={13} /> 重新配一次</button>
          </div>
          <div className="tiny dim" style={{ marginTop: 6 }}>
            上符只修改本工具的模擬資料，不會更動遊戲存檔；儲存後可在「儲存庫」或「Speed Tick → 從儲存庫載入」使用。
          </div>
        </div>
      )}

      {/* 儲存 / 管理自訂定位 */}
      {presetModal && (
        <Modal title="預設定位" onClose={() => setPresetModal(null)} width={460}>
          <div className="st-modal-sec">
            <div className="st-modal-label">把第 {presetModal.index + 1} 隻目前的設定存成定位</div>
            <div className="tiny dim" style={{ marginTop: 3, lineHeight: 1.7 }}>
              會儲存 4 件套、2 件套、2／4／6 號主屬性、下限、目標 Tick、速度條件、焦點與目標模式。
              之後在「定位」選單選一次就會全部填入。定位只保存在這台裝置的瀏覽器。
            </div>
            <label className="row" style={{ gap: 8, marginTop: 10 }}>
              <span className="tiny dim" style={{ flex: "0 0 auto" }}>名稱</span>
              <input
                className="input"
                value={presetModal.name}
                maxLength={20}
                autoFocus
                placeholder="例如：慢速打手"
                onChange={(e) => setPresetModal({ ...presetModal, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitRolePreset();
                  }
                }}
              />
            </label>
            <div className="row" style={{ gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPresetModal(null)}>取消</button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={!presetModal.name.trim()}
                onClick={submitRolePreset}
              >
                <Save size={12} /> 儲存
              </button>
            </div>
            {presetModal.name.trim() && presets.some((p) => p.name === presetModal.name.trim()) && (
              <div className="tiny" style={{ marginTop: 6, color: "var(--gold)" }}>
                已有同名定位，儲存會覆寫它目前的數值。
              </div>
            )}
          </div>

          <div className="st-modal-sec">
            <div className="row between wrap" style={{ gap: 8 }}>
              <div className="st-modal-label">我的定位</div>
              <span className="chip gold">{presets.length} 組</span>
            </div>
            {presets.length === 0 ? (
              <div className="tiny dim" style={{ marginTop: 6 }}>
                還沒有自訂定位。調整好套裝與主屬性後，在上面輸入名稱就能存起來。
              </div>
            ) : (
              <div className="col" style={{ gap: 6, marginTop: 8 }}>
                {presets.map((p) => (
                  <div key={p.id} className="row between wrap" style={{ gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 12.5 }}>{p.name}</div>
                      <div className="tiny dim">
                        {TEAM_ROLE_LABELS[p.role]}
                        {p.set4
                          ? ` · ${SET_BY_ID[p.set4]?.name ?? `#${p.set4}`} ×4`
                          : [p.set2, p.set2b, p.set2c]
                              .filter((id): id is number => !!id)
                              .map((id) => ` · ${SET_BY_ID[id]?.name ?? `#${id}`} ×2`)
                              .join("")}
                        {p.set4 && p.set2 ? ` + ${SET_BY_ID[p.set2]?.name ?? `#${p.set2}`} ×2` : ""}
                        {p.tick > 0 ? ` · Tick ${p.tick}` : ""}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 4 }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => {
                          applyRolePreset(presetModal.index, p);
                          setPresetModal(null);
                        }}
                      >
                        套用
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost btn-icon"
                        title="刪除這個定位"
                        onClick={() => {
                          removeRolePreset(p.id);
                          notify(`已刪除定位「${p.name}」`);
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* 新增自訂隊型 */}
      {teamPresetModal && (
        <Modal title="新增自訂隊型" onClose={() => setTeamPresetModal(null)} width={640}>
          <div className="st-modal-sec">
            <div className="st-modal-label">隊型名稱</div>
            <input
              className="input"
              value={teamPresetModal.name}
              maxLength={24}
              autoFocus
              placeholder="例如：公會戰 雙提條一波"
              onChange={(e) => setTeamPresetModal({ ...teamPresetModal, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitTeamPreset();
                }
              }}
            />
            <div className="st-modal-label" style={{ marginTop: 10 }}>說明（選填）</div>
            <input
              className="input"
              value={teamPresetModal.desc}
              maxLength={80}
              placeholder="例如：提條先手，打手打 S3"
              onChange={(e) => setTeamPresetModal({ ...teamPresetModal, desc: e.target.value })}
            />
            <div className="tiny dim" style={{ marginTop: 8, lineHeight: 1.7 }}>
              會儲存目前第 1 隊的 {size} 隻設定（定位稱呼、出手順序、套裝、主屬性、速度或 Tick、面板下限與目標技能）。
              隊型不綁定魔靈，套用後再選隊員；同名隊型會直接覆寫。
            </div>
          </div>

          <div className="st-modal-sec">
            <div className="row between wrap" style={{ gap: 8 }}>
              <div className="st-modal-label">隊型內容</div>
              <span className="chip gold">第 1 隊 · {size} 隻</span>
            </div>
            <div className="col" style={{ gap: 6, marginTop: 8 }}>
              {members.slice(0, size).map((m, i) => {
                const setText = m.set4
                  ? `${SET_BY_ID[m.set4]?.name ?? `#${m.set4}`} ×4${m.set2 ? ` + ${SET_BY_ID[m.set2]?.name ?? `#${m.set2}`} ×2` : ""}`
                  : [m.set2, m.set2b, m.set2c]
                      .filter((id): id is number => !!id)
                      .map((id) => `${SET_BY_ID[id]?.name ?? `#${id}`} ×2`)
                      .join(" + ") || "不限套裝";
                const speedText =
                  m.speedMode === "tick"
                    ? `Tick ${m.tick || "不限"}`
                    : m.panelExtra > 0
                      ? `面板 +${m.panelExtra} 速`
                      : "面板不限";
                const minText = (Object.keys(m.min) as StatKey[])
                  .filter((k) => (m.min[k] ?? 0) > 0)
                  .map((k) => `${MIN_LABELS[k]} ${m.min[k]}`)
                  .join(" · ");
                const skillText =
                  m.objectiveMode === "skill"
                    ? `技能傷害${m.skillSlot ? `（S${m.skillSlot}）` : ""}`
                    : OBJECTIVE_LABELS[m.objectiveMode];
                return (
                  <div key={i} className="row between wrap" style={{ gap: 8, fontSize: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <b>{i + 1}. {m.title || TEAM_ROLE_LABELS[m.role]}</b>
                      <span className="tiny dim"> · 順序 {m.order} · {TEAM_ROLE_LABELS[m.role]}</span>
                    </div>
                    <div className="tiny dim" style={{ textAlign: "right" }}>
                      {setText} · {speedText} · {skillText}{minText ? ` · 下限 ${minText}` : ""}
                    </div>
                    {m.objectiveMode === "skill" && (
                      <label className="row" style={{ gap: 4 }}>
                        <span className="tiny dim">技能</span>
                        <select
                          className="select"
                          style={{ width: 90 }}
                          value={m.skillSlot}
                          onChange={(e) => {
                            const slot = Number(e.target.value) || 0;
                            const v = m.unitId ? viewOf(m.unitId) : undefined;
                            const sk =
                              v && skillData
                                ? skillsForMonster(skillData, v.monster.id).find((s) => s.slot === slot)
                                : undefined;
                            updateMember(i, { skillSlot: slot, skillId: sk?.id ?? 0 });
                          }}
                          title="以傷害為目標時要最大化的技能（S1～S4）；換魔靈時會自動對應同一個技能欄位"
                        >
                          <option value={0}>自動</option>
                          {[1, 2, 3, 4].map((s) => <option key={s} value={s}>S{s}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="st-modal-sec">
            <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTeamPresetModal(null)}>取消</button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={!teamPresetModal.name.trim()}
                onClick={submitTeamPreset}
              >
                <Save size={12} /> 儲存隊型
              </button>
            </div>
            {teamPresetModal.name.trim() && customTemplates.some((t) => t.name === teamPresetModal.name.trim()) && (
              <div className="tiny" style={{ marginTop: 6, color: "var(--gold)" }}>
                已有同名隊型，儲存會覆寫它目前的內容。
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* 從預設隊儲存庫載入 */}
      {deckOpen && (
        <Modal title="從預設隊儲存庫載入" onClose={() => setDeckOpen(false)} width={820}>
          <div className="st-modal-sec">
            <div className="row between wrap" style={{ gap: 8 }}>
              <div>
                <div className="st-modal-label">預設隊</div>
                <div className="tiny dim">載入後會依魔靈技能自動判定速隊長、提條與打手，並排好出手順序（提條 → 打手 → 速隊長）；仍可再調整。</div>
              </div>
              <span className="chip gold">{deckFavs.length} 組</span>
            </div>
            <label className="row tiny" style={{ gap: 6, marginTop: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={pinDeckRunes} onChange={(e) => setPinDeckRunes(e.target.checked)} />
              同時固定儲存庫中的符文（預設關閉，讓引擎重新分配）
            </label>
            <label className="row tiny" style={{ gap: 6, marginTop: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={importDeckSetup} onChange={(e) => setImportDeckSetup(e.target.checked)} />
              同時帶入目前的套裝、2/4/6 主屬性與數值下限（HP／攻擊／防禦／暴率／暴傷／抵抗／命中）
            </label>
            <div className="tiny dim" style={{ marginTop: 4 }}>
              會依預設隊快照的符文回推；例如「意志＋保護＋保護」會自動帶入 3×2 套裝（保護×2＋意志×1）。下限會換算成實戰數值，確保新配裝的面板不低於目前；速度另外用面板速度／目標 Tick 設定，不會被覆寫。
            </div>
          </div>

          <div className="st-modal-sec">
            {deckFavs.length === 0 ? (
              <div className="tiny dim">
                還沒有儲存的預設隊。可以先在「一鍵配隊」跑出結果後按「儲存到儲存庫」。
              </div>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                {[...deckFavs]
                  .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
                  .map((d) => (
                    <div key={d.id} className="row between wrap" style={{ gap: 8 }}>
                      <div className="row" style={{ gap: 8, minWidth: 0 }}>
                        <div className="row" style={{ gap: 2 }}>
                          {d.units.slice(0, 5).map((u) => <MonsterIcon key={u.unitId} id={u.master} size={26} />)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>
                            {deckTypeLabel(d.type)} · 第 {d.seq} 隊
                          </div>
                          <div className="tiny dim">
                            {d.units.length} 隻 · {d.name}
                            {d.battlePower ? ` · 戰力 ${fmt(d.battlePower)}` : ""}
                          </div>
                        </div>
                      </div>
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => void loadDeck(d)}>
                        載入
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* 魔靈選擇（與 Speed Tick 相同的卡片式選單） */}
      {pickerIndex >= 0 && (
        <MonsterPickerModal
          title={`選擇第 ${pickerIndex + 1} 隻魔靈`}
          width={980}
          entries={owned.map((v) => ({
            key: String(v.unit.id),
            monster: v.monster,
            disabled: members.some((m, j) => j !== pickerIndex && m.unitId === v.unit.id),
            meta: `${v._dup ? `#${v.unit.id} · ` : ""}${v.monster.nat}★ · ${v.runes.length}/6 符文 · 戰鬥 SPD ${v.stats.spd}（面板 ${v.stats.panelSpd ?? v.stats.spd}）· T${v.stats.tick}`,
          }))}
          onPick={(e) => {
            const unitId = Number(e.key);
            const picked = viewOf(unitId);
            const prevMember = members[pickerIndex];
            const pickedSkills = picked && skillData ? skillsForMonster(skillData, picked.monster.id) : [];
            const slotSkill = prevMember?.skillSlot
              ? pickedSkills.find((s) => s.slot === prevMember.skillSlot)
              : undefined;
            updateMember(pickerIndex, {
              unitId,
              includeRunes: [],
              // 換魔靈時基礎速度會變，面板額外速度重新設定
              panelExtra: 0,
              // 自動帶入該魔靈神器上的「速度增加效果 +%」
              artifactPct: picked ? artifactSpeedBuffPct(picked.artifacts) : 0,
              // 隊型指定的技能欄位（S1～S4）換成新魔靈對應的技能
              ...(prevMember?.objectiveMode === "skill" ? { skillId: slotSkill?.id ?? 0 } : {}),
            });
            setOpenMembers(new Set([pickerIndex]));
            setPickerIndex(-1);
          }}
          onClose={() => setPickerIndex(-1)}
        />
      )}
    </>
  );
}
