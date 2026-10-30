import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Check, Copy, Gauge, Layers, Loader2, Lock, Pin, Save, Search,
  Shirt, Users, Wand2, Zap,
} from "lucide-react";
import { monsterLabel, useStore, type DeckFav } from "../store";
import { useSummary, type UnitView } from "../lib/accountStats";
import { MonsterIcon, Modal, RuneCard, TickBadge, fmt } from "../components/ui";
import { MonsterPickerModal, sortMonsterEntries } from "../components/MonsterPicker";
import { RUNE_SETS, SET_BY_ID, type StatKey } from "../lib/constants";
import { setSummary, speedForTick } from "../lib/stats";
import {
  DECK_CONTEXT_LABEL, deckContext, type DeckContext,
} from "../lib/deckSpeed";
import { deckTypeLabel } from "../lib/deckTypes";
import { artifactSpeedBuffPct } from "../lib/artifacts";
import { loadSkillData, skillsForMonster, type DamageOptions, type Skill, type SkillData } from "../lib/damage";
import { autoAssignRoles, roleSetup, type RoleUnit } from "../lib/teamRoles";
import { computeFollowPlan, leadBonus, mirrorTimeline, panelExtraFor } from "../lib/teamSpeed";
import {
  TEAM_ROLE_LABELS, roleObjective, runeSupply,
  type TeamMemberSpec, type TeamPlan, type TeamProgress, type TeamRequest, type TeamRole,
} from "../lib/teamOptimizer";
import { TEAM_TEMPLATES, teamTemplateOf, templateMembers, type TeamMemberTemplate } from "../lib/teamTemplates";
import type { FocusEntry } from "../lib/types";

/** 每隻魔靈的搜尋目標 */
type ObjectiveMode = "role" | "skill" | "spd" | "dps" | "tank" | "support" | "score";

const OBJECTIVE_LABELS: Record<ObjectiveMode, string> = {
  role: "依角色",
  skill: "技能傷害",
  spd: "速度",
  dps: "傷害期望",
  tank: "坦度 EHP",
  support: "綜合",
  score: "符文評分",
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
  title: string;
  weight: number;
  /** 優先順序：1 = 最優先；0 = 不指定（依權重） */
  priority: number;
  /** 搜尋目標：依角色 / 技能傷害 / 速度 / 傷害 / 坦度 / 綜合 / 評分 */
  objectiveMode: ObjectiveMode;
  /** 技能傷害目標的技能 id；0 = 自動選最後一招（通常是 S3） */
  skillId: number;
  /** 4 件套；0 = 不指定 */
  set4: number;
  /** 2 件套；0 = 不指定 */
  set2: number;
  mains: Partial<Record<number, number>>;
  min: Partial<Record<StatKey, number>>;
  /** 目標 Tick；0 = 不限（只在「目標 Tick」模式生效） */
  tick: number;
  /** 速度條件：面板速度或目標 Tick（二選一，預設面板速度） */
  speedMode: "panel" | "tick";
  /** 面板額外速度（基礎速度以外）；0 = 不指定，面板速度會覆寫目標 Tick */
  panelExtra: number;
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
  return {
    unitId,
    role: t.role,
    title: t.title,
    weight: t.weight,
    priority: 0,
    objectiveMode: "role",
    skillId: 0,
    set4: t.sets.find((s) => s.count >= 4)?.set ?? 0,
    set2: t.sets.find((s) => s.count < 4)?.set ?? 0,
    mains: { ...t.mains },
    min: { ...t.min },
    tick: t.tick,
    // 面板速度與目標 Tick 二選一，預設面板速度（模板的 Tick 保留在欄位裡，切換後即可使用）
    speedMode: "panel",
    panelExtra: 0,
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

export default function TeamOptimizerPage() {
  const account = useStore((s) => s.account);
  const runeMap = useStore((s) => s.runeMap);
  const settings = useStore((s) => s.settings);
  const summary = useSummary();
  const notify = useStore((s) => s.notify);
  const saveDeckFav = useStore((s) => s.saveDeckFav);
  const deckFavs = useStore((s) => s.deckFavs);
  const equipTeam = useStore((s) => s.equipTeam);
  const setRuneFlag = useStore((s) => s.setRuneFlag);

  const bonus = settings.bonus;
  const rta = settings.rta;

  const [templateId, setTemplateId] = useState("guild-speed");
  const [size, setSize] = useState<Size>(3);
  const [content, setContent] = useState<DeckContext>("guild");
  const [members, setMembers] = useState<MemberDraft[]>(initialMembers);
  /** 全隊速度隊長技 %（0 = 沒有）；每隻可在卡片上個別覆寫 */
  const [leadPct, setLeadPct] = useState(0);
  const [budgetKey, setBudgetKey] = useState<BudgetKey>("standard");

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<TeamProgress | null>(null);
  const [plan, setPlan] = useState<TeamPlan | null>(null);
  const [altIndex, setAltIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pickerIndex, setPickerIndex] = useState(-1);
  const [deckOpen, setDeckOpen] = useState(false);
  const [pinDeckRunes, setPinDeckRunes] = useState(false);
  /** 鏡像對手（防守提條角）速度；0 = 自動使用起手速度 */
  const [oppSpd, setOppSpd] = useState(0);

  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);
  /** 技能資料（判斷提條技能用）；載入後快取，之後切換隊型不必再等 */
  const skillRef = useRef<SkillData | null>(null);
  /** 技能下拉選單用（與 skillRef 同步） */
  const [skillData, setSkillData] = useState<SkillData | null>(null);

  const template = teamTemplateOf(templateId);
  const budget = BUDGETS[budgetKey];

  // 換帳號時清掉舊結果與已不存在的魔靈（上符只會改 account，不會改 importedAt）
  const importedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (account && importedAtRef.current !== account.importedAt) {
      importedAtRef.current = account.importedAt;
      setPlan(null);
      setError(null);
    }
    setMembers((prev) => {
      if (!summary) return prev;
      const ids = new Set(summary.views.map((v) => v.unit.id));
      return prev.map((m) => (m.unitId && !ids.has(m.unitId) ? { ...m, unitId: 0, includeRunes: [], panelExtra: 0 } : m));
    });
  }, [account, summary]);

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
  }, []);

  const viewOf = (unitId: number): UnitView | undefined =>
    summary?.views.find((v) => v.unit.id === unitId);

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
        title: setup.title,
        weight: setup.weight,
        set4: setup.set4,
        set2: setup.set2,
        mains: { ...setup.mains },
        min: { ...setup.min },
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
        return `${TEAM_ROLE_LABELS[m.role]} ${v ? monsterLabel(v.monster.id) : "？"}`;
      })
      .join("、");

  const applyTemplate = async (id: string, nextSize?: Size) => {
    const t = teamTemplateOf(id);
    const s = nextSize ?? t.size;
    const slots = templateMembers(t, s);
    const drafts = slots.map((tm, i) => {
      const d = draftFromTemplate(tm, members[i]?.unitId ?? 0);
      // 神器速度增加效果是跟著魔靈走的，換隊型時保留已自動帶入的數值
      if (members[i]?.unitId && members[i].unitId === d.unitId) d.artifactPct = members[i].artifactPct;
      return d;
    });
    const skills = await ensureSkills();
    const auto = withAutoRoles(drafts, t.content, slots.map((tm) => tm.role), skills);

    setTemplateId(id);
    setSize(s);
    setContent(t.content);
    if (auto) {
      setMembers(auto.members);
      setLeadPct(auto.leadPct);
      notify(
        `已依技能安排角色：${roleSummary(auto.members)}${auto.leadPct > 0 ? `（速度隊長技 +${auto.leadPct}%）` : ""}`,
      );
    } else {
      setMembers(drafts);
    }
    setPlan(null);
    setError(null);
  };

  const changeSize = (s: Size) => {
    setSize(s);
    setMembers((prev) => {
      const next = prev.slice(0, s).map((m) => ({ ...m }));
      const t = teamTemplateOf(templateId);
      const defaults = templateMembers(t, s);
      while (next.length < s) next.push(draftFromTemplate(defaults[next.length]));
      return next;
    });
    setPlan(null);
    setError(null);
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

    const t = teamTemplateOf(templateId);
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

    setSize(nextSize);
    setContent(ctx);
    if (auto) {
      setMembers(auto.members);
      setLeadPct(auto.leadPct);
    } else {
      setMembers(next);
    }
    setPlan(null);
    setError(null);
    setDeckOpen(false);
    const roleText = auto
      ? `；自動角色：${roleSummary(auto.members)}${auto.leadPct > 0 ? `（速度隊長技 +${auto.leadPct}%）` : ""}`
      : "";
    notify(
      `已載入${deckTypeLabel(d.type)}第 ${d.seq} 隊（${matched} 隻${d.units.length > 5 ? "，超過 5 隻只取前 5 隻" : ""}${matched < deckUnits.length ? `，${deckUnits.length - matched} 隻不在目前帳號` : ""}）${roleText}`,
      matched < deckUnits.length ? "err" : "ok",
    );
  };

  /** 把某一隻的面板速度設成即時算出的接速下限 */
  const applyFollowFloor = (index: number) => {
    const r = followPlan[index];
    const m = members[index];
    const v = m ? viewOf(m.unitId) : undefined;
    if (!r || !v || !Number.isFinite(r.minSpeed)) return;
    updateMember(index, {
      panelExtra: panelExtraFor(v.base.spd, r.minSpeed, r.leadPct),
      speedMode: "panel",
    });
    notify(`已將 ${monsterLabel(v.monster.id)} 的面板速度設為接速下限 ${r.minSpeed}`);
  };

  /** 一次把整隊的面板速度設成接速下限 */
  const applyAllFollow = () => {
    let count = 0;
    const next = members.map((m, i) => {
      const r = followPlan[i];
      const v = viewOf(m.unitId);
      if (!r || !v || !Number.isFinite(r.minSpeed)) return m;
      count++;
      const panelExtra = panelExtraFor(v.base.spd, r.minSpeed, r.leadPct);
      return m.panelExtra === panelExtra && m.speedMode === "panel" ? m : { ...m, panelExtra, speedMode: "panel" as const };
    });
    setMembers(next);
    setPlan(null);
    notify(
      count > 0 ? `已套用 ${count} 隻的接速下限` : "目前沒有可套用的接速下限",
      count > 0 ? "ok" : "err",
    );
  };

  const updateMember = (i: number, patch: Partial<MemberDraft>) => {
    setMembers((prev) => prev.map((m, j) => (j === i ? { ...m, ...patch } : m)));
    setPlan(null);
  };

  /** 把這一隻提供的提條 % 與速度強化帶入後面出手的成員（來源自己不套用） */
  const propagateBoost = (index: number) => {
    const src = members[index];
    if (!src) return;
    const later = members.map((m, j) => j !== index && m.order > src.order);
    const count = later.filter(Boolean).length;
    if (count === 0) return notify("後面沒有其他出手成員", "err");
    setMembers((prev) =>
      prev.map((m, j) => {
        if (j === index) return { ...m, boostPct: 0, speedBuff: false };
        return later[j] ? { ...m, boostPct: src.boostPct, speedBuff: src.speedBuff } : m;
      }),
    );
    setPlan(null);
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
        return { ...m, min };
      }),
    );
    setPlan(null);
  };

  /** 每隻實際套用的速度隊長技 %（卡片留空 = 跟隨全隊數值） */
  const leadPctOf = (m: MemberDraft) => Math.max(0, m.leadPct ?? leadPct);

  const selected = members.filter((m) => m.unitId > 0);
  const teamIds = selected.map((m) => m.unitId);

  /** 即時接速試算：依攻擊順序串接，並以鏡像對手在該 Tick 的攻擊條當門檻 */
  const followPlan = useMemo(() => {
    const rate = rta ? 1.5 : 7;
    return computeFollowPlan(
      members.map((m, index) => {
        const v = viewOf(m.unitId);
        return {
          index,
          order: m.order,
          mode: m.speedMode === "tick" ? "tick" : "panel",
          baseSpd: v?.base.spd ?? 0,
          panelExtra: m.panelExtra,
          tick: m.tick,
          boostPct: m.boostPct,
          speedBuff: m.speedBuff,
          artifactPct: m.artifactPct,
          leadPct: leadPctOf(m),
          currentSpd: v?.stats.spd ?? 0,
        };
      }),
      rate,
      { opponentSpeed: oppSpd },
    );
  }, [members, summary, rta, oppSpd, leadPct]);

  /** 鏡像對戰的實際出手順序：只顯示到「對手第一次出手」為止，最多一個循環 */
  const mirrorSteps = useMemo(() => {
    const all = mirrorTimeline(followPlan, rta ? 1.5 : 7, 16);
    const firstOpp = all.findIndex((s) => s.team === "opponent");
    return firstOpp >= 0 ? all.slice(0, firstOpp + 1) : all.slice(0, 6);
  }, [followPlan, rta]);

  const openerFollow = followPlan.find((r) => r.position === 0);
  const autoOppSpd = openerFollow?.panelSpd ?? openerFollow?.currentSpd ?? 0;

  /** 最後一隻接速成員預計出手的 Tick */
  const lastFollowTick = useMemo(() => {
    const ticks = followPlan
      .filter((r) => r.position > 0 && r.targetTick != null)
      .map((r) => r.targetTick as number);
    return ticks.length ? Math.max(...ticks) : null;
  }, [followPlan]);

  /** 鏡像檢查結論：有沒有接速成員在目標 Tick 輸給對手 */
  const mirrorVerdict = useMemo(() => {
    const failing = followPlan.filter((r) => r.position > 0 && r.met === false);
    const firstOpp = mirrorSteps.find((s) => s.team === "opponent") ?? null;
    if (!followPlan.some((r) => r.position > 0)) {
      return { status: "idle" as const, firstOpp: null, failing };
    }
    if (failing.length) return { status: "cut" as const, firstOpp, failing };
    if (firstOpp && lastFollowTick != null && firstOpp.tick <= lastFollowTick) {
      return { status: "cut" as const, firstOpp, failing };
    }
    return { status: "safe" as const, firstOpp, failing };
  }, [followPlan, mirrorSteps, lastFollowTick]);

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

  /** 把草案轉成引擎需求 */
  const buildRequest = (): TeamRequest | null => {
    if (!account || !summary) return null;
    const specs: TeamMemberSpec[] = [];
    for (const m of members) {
      const v = viewOf(m.unitId);
      if (!v) return null;
      const sets: { set: number; count: number }[] = [];
      if (m.set4) sets.push({ set: m.set4, count: 4 });
      if (m.set2 && m.set2 !== m.set4) sets.push({ set: m.set2, count: 2 });

      const min: Partial<Record<StatKey, number>> = { ...m.min };
      // 面板速度 / 目標 Tick 二選一；面板輸入的是「基礎速度與隊長技以外的額外速度」
      const panelSpd =
        m.speedMode !== "tick" && m.panelExtra > 0
          ? v.base.spd + leadBonus(v.base.spd, leadPctOf(m)) + m.panelExtra
          : 0;
      if (panelSpd > 0) min.spd = panelSpd;
      else if (m.speedMode === "tick" && m.tick > 0) min.spd = speedForTick(m.tick, rta);
      else delete min.spd;

      const bySlot = new Map<number, number>();
      for (const id of [...m.includeRunes, ...(globalIncludes.get(m.unitId) ?? [])]) {
        const r = runeMap.get(id);
        if (!r || bySlot.has(r.slot)) continue;
        bySlot.set(r.slot, id);
      }

      // 技能傷害目標：優先使用指定技能，否則自動選最後一招（通常是 S3）
      const skills = skillData ? skillsForMonster(skillData, v.monster.id) : [];
      const skill =
        m.objectiveMode === "skill"
          ? (skills.find((s) => s.id === m.skillId) ?? defaultAttackSkill(skills))
          : undefined;

      specs.push({
        unitId: m.unitId,
        master: v.monster.id,
        label: monsterLabel(v.monster.id),
        base: v.base,
        role: m.role,
        weight: m.weight,
        priority: m.priority,
        sets,
        mains: m.mains,
        min,
        focus: m.focus,
        includeRunes: [...bySlot.values()],
        leadSpd: leadPctOf(m),
        objective: skill
          ? "skill"
          : m.objectiveMode === "role"
            ? roleObjective(m.role)
            : m.objectiveMode,
        skillObjective: skill ? { skill, opts: TEAM_DAMAGE_OPTS } : undefined,
      });
    }
    return {
      members: specs,
      runes: account.runes,
      bonus: { ...bonus, leadSpd: 0 },
      rta,
      pool: budget.pool,
      topK: budget.topK,
      beamWidth: budget.beam,
      allowEquipped: true,
      relaxSub: false,
      intangible: false,
      excludeRunes: settings.excludedRunes,
      lockedRunes: settings.lockedRunes,
      maxNodesPerSearch: budget.nodes,
      diversify: true,
      alternatives: 4,
    };
  };

  const run = () => {
    if (!account) return notify("請先匯入存檔", "err");
    if (members.length !== size) return notify("隊伍人數不一致，請重新選擇", "err");
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
      setError("配隊運算超過 90 秒，已停止。請把搜尋預算改成「快速」、放寬條件，或減少隊伍人數。");
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
  const planSpeedOrder = useMemo(
    () => (activePlan ? [...activePlan.members].sort((a, b) => b.stats.spd - a.stats.spd) : []),
    [activePlan],
  );

  const pinMember = (unitId: number) => {
    const b = activePlan?.members.find((m) => m.unitId === unitId);
    if (!b) return;
    setMembers((prev) => prev.map((m) => (m.unitId === unitId ? { ...m, includeRunes: b.runeIds } : m)));
    setPlan(null);
    setAltIndex(0);
    notify(`已固定 ${monsterLabel(b.master)} 的 6 顆符文，按「一鍵配隊」會重新配其他魔靈`);
  };

  const unpinMember = (unitId: number) => {
    setMembers((prev) => prev.map((m) => (m.unitId === unitId ? { ...m, includeRunes: [] } : m)));
    setPlan(null);
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
    saveDeckFav({
      name: `一鍵配隊 · ${activePlan.members.map((m) => monsterLabel(m.master)).join(" / ")}`,
      type: 0,
      seq: 1,
      units: activePlan.members.map((m) => {
        const u = account?.units.find((x) => x.id === m.unitId);
        return { unitId: m.unitId, master: m.master, runeIds: m.runeIds, artifactIds: u?.artifacts ?? [] };
      }),
    });
  };

  const copyPlan = () => {
    if (!activePlan) return;
    const lines = activePlan.members.map((m) => {
      const sets = setSummary(m.sets);
      return `${monsterLabel(m.master)}  SPD ${m.stats.spd} (T${m.stats.tick})  HP ${fmt(m.stats.hp)}  DEF ${fmt(m.stats.def)}  EHP ${fmt(m.ehp)}  ${sets}  符文 ${m.runeIds.join(", ")}`;
    });
    void navigator.clipboard?.writeText(lines.join("\n"));
    notify("已複製整隊配裝清單");
  };

  if (!account) {
    return <div className="empty"><Users size={40} /><div>尚未匯入存檔</div></div>;
  }

  const totalWeight = members.reduce((s, m) => s + Math.max(1, m.weight), 0);
  const orderedFollow = [...followPlan].sort((a, b) => a.position - b.position);

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 14 }}>
        <div>
          <div className="card-title row" style={{ gap: 7 }}>
            <Zap size={15} className="gold" /> 一鍵配隊
          </div>
          <div className="card-sub">
            先選 3～5 隻魔靈，再一次配好整隊符文；同一顆符文不會重複分配給兩隻魔靈。載入預設隊或切換隊型時，會依技能自動安排角色與出手順序。
          </div>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          <button type="button" className="btn btn-sm" onClick={() => setDeckOpen(true)}>
            <Layers size={13} /> 從儲存庫載入
          </button>
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
            <div className="tiny dim" style={{ marginTop: 3, maxWidth: 620 }}>{template.desc}</div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            {([3, 4, 5] as Size[]).map((n) => (
              <button key={n} type="button" className={`chip ${size === n ? "gold" : "muted"}`} style={{ cursor: "pointer" }} onClick={() => changeSize(n)}>
                {n} 隻
              </button>
            ))}
          </div>
        </div>

        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          <select className="select" style={{ minWidth: 300 }} value={templateId} onChange={(e) => void applyTemplate(e.target.value)}>
            {TEAM_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="select" style={{ width: 180 }} value={content} onChange={(e) => { setContent(e.target.value as DeckContext); setPlan(null); }}>
            {(["arena", "guild", "dungeon"] as DeckContext[]).map((c) => <option key={c} value={c}>{DECK_CONTEXT_LABEL[c]}</option>)}
          </select>
          <label className="row" style={{ gap: 6 }}>
            <span className="tiny dim">速度隊長技 %</span>
            <input
              className="input mono"
              style={{ width: 84 }}
              type="number"
              min={0}
              max={50}
              value={leadPct}
              onChange={(e) => {
                setLeadPct(Math.max(0, Math.min(50, Number(e.target.value) || 0)));
                setPlan(null);
              }}
              title="全隊速度隊長技加成，以每隻的基礎速度計算；0 = 沒有隊長技"
            />
          </label>
          <select className="select" style={{ width: 170 }} value={budgetKey} onChange={(e) => setBudgetKey(e.target.value as BudgetKey)}>
            {(Object.keys(BUDGETS) as BudgetKey[]).map((k) => <option key={k} value={k}>預算：{BUDGETS[k].label}（{BUDGETS[k].hint}）</option>)}
          </select>
        </div>

        <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
          <span className="tiny" style={{ color: "var(--gold, #f2c65c)" }}>
            {leadPct > 0
              ? `速度隊長技：每隻基礎速度 +${leadPct}%（可在成員卡片個別調整，留空 = 跟隨全隊）`
              : "速度隊長技：0%（可在成員卡片輸入個別數值，例如只有部分屬性／內容吃得到）"}
          </span>
          {rta && <span className="tiny dim">RTA 模式：Tick 以 1.5% 計算，且不含一般建築</span>}
        </div>
      </div>

      {/* 隊伍成員 */}
      <div className="team-member-grid">
        {members.map((m, i) => {
          const v = viewOf(m.unitId);
          const pinned = m.includeRunes.length > 0;
          const laterCount = members.filter((x, j) => j !== i && x.order > m.order).length;
          const skills = skillData && v ? skillsForMonster(skillData, v.monster.id) : [];
          const effSkill = skills.find((s) => s.id === m.skillId) ?? defaultAttackSkill(skills);
          return (
            <div key={i} className={`card card-pad team-member ${pinned ? "pinned" : ""}`}>
              <div className="row between" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 8, minWidth: 0 }}>
                  <MonsterIcon id={v?.monster.id ?? 0} size={38} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {v ? monsterLabel(v.monster.id) : "尚未選擇"}
                    </div>
                    <div className="tiny dim">{m.title}</div>
                  </div>
                </div>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPickerIndex(i)}>
                  <Search size={12} /> {v ? "更換" : "選擇"}
                </button>
              </div>

              {v && (
                <div className="row wrap tiny dim" style={{ gap: 6, marginTop: 6 }}>
                  <span>目前 SPD <b className="gold">{v.stats.spd}</b></span>
                  <span>基礎 {v.base.spd}</span>
                  {m.speedMode !== "tick" && m.panelExtra > 0 && (
                    <span>
                      面板{" "}
                      <b className="gold">
                        {v.base.spd + leadBonus(v.base.spd, leadPctOf(m)) + m.panelExtra}
                      </b>
                      {leadPctOf(m) > 0 && (
                        <span className="dim">
                          （{v.base.spd} + 隊長 {leadBonus(v.base.spd, leadPctOf(m))} + 額外{" "}
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
                  {leadPctOf(m) > 0 && <span className="chip gold">隊長 +{leadPctOf(m)}%</span>}
                  {pinned && <span className="chip green"><Pin size={10} /> 已固定</span>}
                </div>
              )}

              <div className="team-fields">
                <label>
                  <span>角色</span>
                  <select className="select" value={m.role} onChange={(e) => updateMember(i, { role: e.target.value as TeamRole, title: TEAM_ROLE_LABELS[e.target.value as TeamRole] })}>
                    {(Object.keys(TEAM_ROLE_LABELS) as TeamRole[]).map((r) => <option key={r} value={r}>{TEAM_ROLE_LABELS[r]}</option>)}
                  </select>
                </label>
                <label>
                  <span>權重</span>
                  <input className="input mono" type="number" min={1} max={10} value={m.weight} onChange={(e) => updateMember(i, { weight: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} />
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
                    title="技能傷害：以選定技能的傷害當作搜尋目標（例如 Kaito S3 吃攻擊與速度）"
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
                      onChange={(e) => updateMember(i, { skillId: Number(e.target.value) || 0 })}
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
                          ? `基礎速度 ${v.base.spd} + 隊長技 ${leadBonus(v.base.spd, leadPctOf(m))} + 額外速度；例如要 391 就輸入 ${Math.max(0, 391 - v.base.spd - leadBonus(v.base.spd, leadPctOf(m)))}`
                          : "輸入基礎速度與隊長技以外的額外速度"
                      }
                    />
                  </label>
                ) : (
                  <label>
                    <span>目標 Tick</span>
                    <input className="input mono" type="number" min={0} max={20} value={m.tick} onChange={(e) => updateMember(i, { tick: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })} title="0 = 不限；此模式不採用面板速度" />
                  </label>
                )}
                <label>
                  <span>攻擊順序</span>
                  <input className="input mono" type="number" min={1} max={10} value={m.order} onChange={(e) => updateMember(i, { order: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} title="1 = 最先出手；接速以鏡像對手的攻擊條為門檻" />
                </label>
                <label>
                  <span>提條 %</span>
                  <input className="input mono" type="number" min={0} max={100} value={m.boostPct} onChange={(e) => updateMember(i, { boostPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} title="這隻魔靈會收到的攻擊條 %（例如 風格 S3 全隊 +30）" />
                </label>
                <label>
                  <span>隊長技 %</span>
                  <input
                    className="input mono"
                    type="number"
                    min={0}
                    max={50}
                    value={m.leadPct ?? ""}
                    placeholder={`全隊 ${leadPct}`}
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
                  <input
                    className="input mono"
                    type="number"
                    min={0}
                    max={100}
                    value={m.artifactPct}
                    onChange={(e) => updateMember(i, { artifactPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                    title="神器「速度增加效果 +%」（效果 206）；只有啟用速度強化時才會放大 Buff"
                  />
                </label>
                <label>
                  <span>抵抗下限</span>
                  <input className="input mono" type="number" min={0} max={100} value={m.min.res ?? 0} onChange={(e) => patchMin(i, "res", Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
                </label>
                <label>
                  <span>暴率下限</span>
                  <input className="input mono" type="number" min={0} max={100} value={m.min.cr ?? 0} onChange={(e) => patchMin(i, "cr", Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
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
                <div className="team-fields">
                  <label>
                    <span>4 件套</span>
                    <select className="select" value={m.set4} onChange={(e) => {
                      const set4 = Number(e.target.value);
                      updateMember(i, { set4, ...(set4 === m.set2 ? { set2: 0 } : {}) });
                    }}>
                      <option value={0}>不指定</option>
                      {FOUR_SETS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </label>
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
                <div className="tiny dim" style={{ marginTop: 4 }}>
                  焦點：{m.focus.length ? m.focus.map((f) => `${f.key} ${f.weight}`).join(" / ") : "無"}
                  {pinned && <> · 已固定 {m.includeRunes.length} 顆符文</>}
                </div>
              </details>

              {pinned && (
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => unpinMember(m.unitId)}>
                    <Pin size={12} /> 解除固定
                  </button>
                </div>
              )}
            </div>
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
            <div className="tiny dim" style={{ marginTop: 3, maxWidth: 780 }}>
              提條角先出手後，對手的防守提條角仍會繼續累積攻擊條（可以溢出 100%）。只要接速成員在輪到它的 Tick 攻擊條高過對手，就不會被插隊；攻擊條相同時進攻方先動。預設對手＝和你起手同速的鏡像防守。提條與速度強化都在起手之後才生效。
            </div>
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
                placeholder={autoOppSpd ? String(autoOppSpd) : "同起手"}
                onChange={(e) => setOppSpd(Math.max(0, Number(e.target.value) || 0))}
                title="0 / 留空 = 使用起手提條角的同速鏡像"
              />
            </label>
            <span className="chip muted">每 Tick {rta ? "1.5%" : "7%"}</span>
            <button type="button" className="btn btn-sm" onClick={applyAllFollow}>
              <Gauge size={12} /> 全部套用接速
            </button>
          </div>
        </div>

        {mirrorSteps.length > 0 && (
          <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
            <span className="tiny dim">鏡像預測：</span>
            {mirrorSteps.map((s, i) => {
              const v = viewOf(members[s.index]?.unitId ?? 0);
              const name = v ? monsterLabel(v.monster.id) : `#${s.index + 1}`;
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
            {mirrorVerdict.status === "safe" && <span className="chip green">✓ 對手插不進來</span>}
            {mirrorVerdict.status === "cut" &&
              (mirrorVerdict.failing.length > 0 ? (
                <span className="chip red">
                  ✗{" "}
                  {mirrorVerdict.failing
                    .map((f) => {
                      const v = viewOf(members[f.index]?.unitId ?? 0);
                      return `${v ? monsterLabel(v.monster.id) : `#${f.index + 1}`}（T${f.targetTick}）`;
                    })
                    .join("、")}{" "}
                  會被插隊
                </span>
              ) : (
                <span className="chip red">✗ 對手會在 T{mirrorVerdict.firstOpp?.tick} 插隊</span>
              ))}
          </div>
        )}

        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(235px, 1fr))", gap: 8, marginTop: 10 }}>
          {orderedFollow.map((r) => {
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
                  {v ? monsterLabel(v.monster.id) : "尚未選擇"}
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
            {running ? (
              <>
                <span className="tiny dim row" style={{ gap: 6 }}>
                  <Loader2 size={13} className="spin" />
                  {progress
                    ? progress.stage === "candidates"
                      ? `正在產生第 ${progress.member + 1}/${progress.total} 隻的候選配裝…`
                      : progress.stage === "search"
                        ? `正在聯合挑選第 ${progress.member + 1}/${progress.total} 隻…`
                        : "正在局部改良…"
                    : "運算中…"}
                </span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={cancel}>取消</button>
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={run} disabled={members.some((m) => !m.unitId)}>
                <Wand2 size={15} /> 一鍵配一隊
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

      {error && (
        <div className="card card-pad" style={{ marginTop: 12, borderColor: "rgba(255,107,107,.35)" }}>
          <div className="row" style={{ gap: 8, color: "var(--red)" }}>
            <AlertTriangle size={15} />
            <span style={{ fontSize: 12.5 }}>{error}</span>
          </div>
        </div>
      )}

      {activePlan && (
        <div className="card card-pad team-result" style={{ marginTop: 14 }}>
          <div className="row between wrap" style={{ gap: 8 }}>
            <div>
              <div className="card-title row" style={{ gap: 7 }}>
                <Check size={15} className="gold" /> 配隊結果
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
                    .map((m) => `${m.priority}. ${monsterLabel(m.master)}`)
                    .join(" → ")}
                  <span className="dim">（先最大化第 1 優先，再依序最大化其他魔靈）</span>
                </div>
              )}
            </div>
            <div className="row wrap" style={{ gap: 5 }}>
              {[plan, ...(plan?.alternatives ?? [])].map((p, idx) => (
                <button key={idx} type="button" className={`chip ${altIndex === idx ? "gold" : "muted"}`} style={{ cursor: "pointer" }} onClick={() => setAltIndex(idx)}>
                  隊伍 {idx + 1}
                </button>
              ))}
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

          <div className="deck-speedbar" style={{ marginTop: 10 }}>
            <div className="row between" style={{ marginBottom: 6 }}>
              <span className="tiny dim">速度順序</span>
              <span className="tiny dim">Speed Tick</span>
            </div>
            <div className="row wrap" style={{ gap: 5 }}>
              {planSpeedOrder.map((m, i) => (
                <span key={m.unitId} className="chip muted" title={`SPD ${m.stats.spd} · Tick ${m.stats.tick}`}>
                  <b className="gold">{i + 1}</b>
                  <span style={{ margin: "0 4px" }}>{monsterLabel(m.master)}</span>
                  <span className="mono">{m.stats.spd}</span>
                  <span style={{ marginLeft: 4 }}>T{m.stats.tick}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="team-result-grid">
            {activePlan.members.map((m) => {
              const runes = m.runeIds.map((id) => runeMap.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
              return (
                <div key={m.unitId} className="team-result-member">
                  <div className="row between" style={{ gap: 8 }}>
                    <div className="row" style={{ gap: 8, minWidth: 0 }}>
                      <MonsterIcon id={m.master} size={40} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 12.5 }}>{monsterLabel(m.master)}</div>
                        <div className="tiny dim">
                          {m.priority > 0 && <span className="chip gold" style={{ marginRight: 4 }}>優先 {m.priority}</span>}
                          {TEAM_ROLE_LABELS[m.role]} · 個人最佳 {Math.round(m.norm * 100)}%
                          {m.objective === "skill" && m.skillName ? ` · ${m.skillName}` : ""}
                        </div>
                      </div>
                    </div>
                    <TickBadge spd={m.stats.spd} rta={rta} />
                  </div>
                  <div className="row wrap tiny" style={{ gap: 6, marginTop: 7 }}>
                    <span>SPD <b className="gold">{m.stats.spd}</b></span>
                    <span>HP {fmt(m.stats.hp)}</span>
                    <span>DEF {fmt(m.stats.def)}</span>
                    <span>ATK {fmt(m.stats.atk)}</span>
                    <span>CR {m.stats.cr}%</span>
                    <span>CD {m.stats.cd}%</span>
                    <span>RES {m.stats.res}%</span>
                    <span>ACC {m.stats.acc}%</span>
                    <span>EHP {fmt(m.ehp)}</span>
                    {m.objective === "skill" && (
                      <span>技能傷害 <b className="gold">{fmt(m.score)}</b></span>
                    )}
                  </div>
                  <div className="tiny dim" style={{ marginTop: 4 }}>{setSummary(m.sets) || "無套裝加成"}</div>
                  <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6, marginTop: 7 }}>
                    {runes.map((r) => <RuneCard key={r.id} rune={r} compact owner={monsterLabel(m.master)} />)}
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: 8 }}>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => pinMember(m.unitId)} title="固定這隻的符文，重新配其他魔靈">
                      <Pin size={12} /> 固定這隻
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={equipPlan}><Shirt size={13} /> 整隊上符</button>
            <button type="button" className="btn btn-sm" onClick={lockPlan}><Lock size={13} /> 鎖定這隊符文</button>
            <button type="button" className="btn btn-sm" onClick={savePlan}><Save size={13} /> 儲存到儲存庫</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={copyPlan}><Copy size={13} /> 複製清單</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={run}><Gauge size={13} /> 重新計算</button>
          </div>
          <div className="tiny dim" style={{ marginTop: 6 }}>
            上符只修改本工具的模擬資料，不會更動遊戲存檔；儲存後可在「儲存庫」或「Speed Tick → 從儲存庫載入」使用。
          </div>
        </div>
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
          </div>

          <div className="st-modal-sec">
            {deckFavs.length === 0 ? (
              <div className="tiny dim">
                還沒有儲存的預設隊。可以先在「一鍵配隊」跑出結果後按「儲存到儲存庫」。
              </div>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                {[...deckFavs]
                  .sort((a, b) => b.createdAt - a.createdAt)
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
            meta: `${v._dup ? `#${v.unit.id} · ` : ""}${v.monster.nat}★ · ${v.runes.length}/6 符文 · SPD ${v.stats.spd} · T${v.stats.tick}`,
          }))}
          onPick={(e) => {
            const unitId = Number(e.key);
            const picked = viewOf(unitId);
            updateMember(pickerIndex, {
              unitId,
              includeRunes: [],
              // 換魔靈時基礎速度會變，面板額外速度重新設定
              panelExtra: 0,
              // 自動帶入該魔靈神器上的「速度增加效果 +%」
              artifactPct: picked ? artifactSpeedBuffPct(picked.artifacts) : 0,
            });
            setPickerIndex(-1);
          }}
          onClose={() => setPickerIndex(-1)}
        />
      )}
    </>
  );
}
