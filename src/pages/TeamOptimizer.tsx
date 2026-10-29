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
  DECK_CONTEXT_LABEL, SPD_AREA_LABEL, deckContext, spdLeaderApplies, spdLeaderSkill, type DeckContext,
} from "../lib/deckSpeed";
import { deckTypeLabel } from "../lib/deckTypes";
import { artifactSpeedBuffPct } from "../lib/artifacts";
import { computeFollowPlan, panelExtraFor } from "../lib/teamSpeed";
import {
  TEAM_ROLE_LABELS, roleObjective, runeSupply,
  type TeamMemberSpec, type TeamPlan, type TeamProgress, type TeamRequest, type TeamRole,
} from "../lib/teamOptimizer";
import { TEAM_TEMPLATES, teamTemplateOf, templateMembers, type TeamMemberTemplate } from "../lib/teamTemplates";
import type { FocusEntry } from "../lib/types";

/** 每隻魔靈在頁面上的設定（尚未轉成引擎需求） */
interface MemberDraft {
  unitId: number;
  role: TeamRole;
  title: string;
  weight: number;
  /** 4 件套；0 = 不指定 */
  set4: number;
  /** 2 件套；0 = 不指定 */
  set2: number;
  mains: Partial<Record<number, number>>;
  min: Partial<Record<StatKey, number>>;
  /** 目標 Tick；0 = 不限 */
  tick: number;
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
    set4: t.sets.find((s) => s.count >= 4)?.set ?? 0,
    set2: t.sets.find((s) => s.count < 4)?.set ?? 0,
    mains: { ...t.mains },
    min: { ...t.min },
    tick: t.tick,
    panelExtra: 0,
    order: t.order ?? 1,
    boostPct: t.boostPct ?? 0,
    speedBuff: t.speedBuff ?? false,
    artifactPct: t.artifactPct ?? 0,
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
  const [leaderUnitId, setLeaderUnitId] = useState(0);
  const [budgetKey, setBudgetKey] = useState<BudgetKey>("standard");

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<TeamProgress | null>(null);
  const [plan, setPlan] = useState<TeamPlan | null>(null);
  const [altIndex, setAltIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pickerIndex, setPickerIndex] = useState(-1);
  const [deckOpen, setDeckOpen] = useState(false);
  const [pinDeckRunes, setPinDeckRunes] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);

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

  // 隊長一定要在隊伍裡
  useEffect(() => {
    const ids = members.map((m) => m.unitId).filter((id) => id > 0);
    if (!ids.includes(leaderUnitId)) setLeaderUnitId(ids[0] ?? 0);
  }, [members, leaderUnitId]);

  useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const viewOf = (unitId: number): UnitView | undefined =>
    summary?.views.find((v) => v.unit.id === unitId);

  const applyTemplate = (id: string, nextSize?: Size) => {
    const t = teamTemplateOf(id);
    const s = nextSize ?? t.size;
    setTemplateId(id);
    setSize(s);
    setContent(t.content);
    setMembers((prev) =>
      templateMembers(t, s).map((tm, i) => {
        const d = draftFromTemplate(tm, prev[i]?.unitId ?? 0);
        // 神器速度增加效果是跟著魔靈走的，換隊型時保留已自動帶入的數值
        if (prev[i]?.unitId && prev[i].unitId === d.unitId) d.artifactPct = prev[i].artifactPct;
        return d;
      }),
    );
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

  /** 從預設隊儲存庫載入整隊（可選擇固定當時的符文） */
  const loadDeck = (d: DeckFav) => {
    if (!summary) return;
    if (d.units.length === 0) return notify("這組預設隊沒有隊員", "err");

    const deckUnits = d.units.slice(0, 5);
    const nextSize = Math.min(5, Math.max(3, deckUnits.length)) as Size;
    const byUnit = new Map(summary.views.map((v) => [v.unit.id, v]));
    const byMaster = new Map<number, UnitView>();
    for (const v of summary.views) if (!byMaster.has(v.monster.id)) byMaster.set(v.monster.id, v);

    const t = teamTemplateOf(templateId);
    let matched = 0;
    const next = templateMembers(t, nextSize).map((tm, i) => {
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

    setSize(nextSize);
    // 類型 0 是工具自己的自訂配隊，沒有內容資訊，保留目前選擇
    setContent(d.type === 0 ? content : deckContext(d.type));
    setMembers(next);
    setLeaderUnitId(next.find((m) => m.unitId > 0)?.unitId ?? 0);
    setPlan(null);
    setError(null);
    setDeckOpen(false);
    notify(
      `已載入${deckTypeLabel(d.type)}第 ${d.seq} 隊（${matched} 隻${d.units.length > 5 ? "，超過 5 隻只取前 5 隻" : ""}${matched < deckUnits.length ? `，${deckUnits.length - matched} 隻不在目前帳號` : ""}）`,
      matched < deckUnits.length ? "err" : "ok",
    );
  };

  /** 把某一隻的面板速度設成即時算出的接速下限 */
  const applyFollowFloor = (index: number) => {
    const r = followPlan[index];
    const m = members[index];
    const v = m ? viewOf(m.unitId) : undefined;
    if (!r || !v || !Number.isFinite(r.minSpeed)) return;
    updateMember(index, { panelExtra: panelExtraFor(v.base.spd, r.minSpeed) });
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
      const panelExtra = panelExtraFor(v.base.spd, r.minSpeed);
      return m.panelExtra === panelExtra ? m : { ...m, panelExtra };
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

  const selected = members.filter((m) => m.unitId > 0);
  const teamIds = selected.map((m) => m.unitId);

  /** 即時接速試算：依攻擊順序串接每一隻的出手 Tick */
  const followPlan = useMemo(() => {
    const rate = rta ? 1.5 : 7;
    return computeFollowPlan(
      members.map((m, index) => {
        const v = viewOf(m.unitId);
        return {
          index,
          order: m.order,
          baseSpd: v?.base.spd ?? 0,
          panelExtra: m.panelExtra,
          tick: m.tick,
          boostPct: m.boostPct,
          speedBuff: m.speedBuff,
          artifactPct: m.artifactPct,
          currentSpd: v?.stats.spd ?? 0,
        };
      }),
      rate,
    );
  }, [members, summary, rta]);

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

  const leaderView = viewOf(leaderUnitId);
  const leaderSkill = leaderView ? spdLeaderSkill(leaderView.monster.id) : null;
  const leadPctFor = (v: UnitView | undefined) => {
    if (!v || !leaderSkill) return 0;
    return spdLeaderApplies(leaderSkill, v.monster.el, content) ? leaderSkill.p : 0;
  };

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
      // 面板速度優先於目標 Tick：使用者輸入的是「基礎速度以外的額外速度」
      const panelSpd = m.panelExtra > 0 ? v.base.spd + m.panelExtra : 0;
      if (panelSpd > 0) min.spd = panelSpd;
      else if (m.tick > 0) min.spd = speedForTick(m.tick, rta);
      else delete min.spd;

      const bySlot = new Map<number, number>();
      for (const id of [...m.includeRunes, ...(globalIncludes.get(m.unitId) ?? [])]) {
        const r = runeMap.get(id);
        if (!r || bySlot.has(r.slot)) continue;
        bySlot.set(r.slot, id);
      }

      specs.push({
        unitId: m.unitId,
        master: v.monster.id,
        label: monsterLabel(v.monster.id),
        base: v.base,
        role: m.role,
        weight: m.weight,
        sets,
        mains: m.mains,
        min,
        focus: m.focus,
        includeRunes: [...bySlot.values()],
        leadSpd: leadPctFor(v),
        objective: roleObjective(m.role),
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
            先選 3～5 隻魔靈，再一次配好整隊符文；同一顆符文不會重複分配給兩隻魔靈。
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
          <select className="select" style={{ minWidth: 300 }} value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
            {TEAM_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="select" style={{ width: 180 }} value={content} onChange={(e) => { setContent(e.target.value as DeckContext); setPlan(null); }}>
            {(["arena", "guild", "dungeon"] as DeckContext[]).map((c) => <option key={c} value={c}>{DECK_CONTEXT_LABEL[c]}</option>)}
          </select>
          <select className="select" style={{ width: 170 }} value={leaderUnitId} onChange={(e) => { setLeaderUnitId(Number(e.target.value)); setPlan(null); }}>
            <option value={0}>隊長：未選擇</option>
            {members.filter((m) => m.unitId > 0).map((m) => {
              const v = viewOf(m.unitId);
              return <option key={m.unitId} value={m.unitId}>隊長：{v ? monsterLabel(v.monster.id) : `#${m.unitId}`}</option>;
            })}
          </select>
          <select className="select" style={{ width: 170 }} value={budgetKey} onChange={(e) => setBudgetKey(e.target.value as BudgetKey)}>
            {(Object.keys(BUDGETS) as BudgetKey[]).map((k) => <option key={k} value={k}>預算：{BUDGETS[k].label}（{BUDGETS[k].hint}）</option>)}
          </select>
        </div>

        <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
          <span className="tiny" style={{ color: "var(--gold, #f2c65c)" }}>
            {leaderView
              ? leaderSkill
                ? `隊長技：${monsterLabel(leaderView.monster.id)} 速度 +${leaderSkill.p}%（${SPD_AREA_LABEL[leaderSkill.a] ?? "全內容"}）`
                : "此魔靈沒有速度隊長技；V1 只計入速度隊長技，其餘隊長技不套用"
              : "尚未選擇隊長"}
          </span>
          {rta && <span className="tiny dim">RTA 模式：Tick 以 1.5% 計算，且不含一般建築</span>}
        </div>
      </div>

      {/* 隊伍成員 */}
      <div className="team-member-grid">
        {members.map((m, i) => {
          const v = viewOf(m.unitId);
          const pinned = m.includeRunes.length > 0;
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
                  <span>T{v.stats.tick}</span>
                  <span>{v.runes.length}/6 符文</span>
                  {m.unitId === leaderUnitId && <span className="chip gold">隊長</span>}
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
                  <span>目標 Tick</span>
                  <input className="input mono" type="number" min={0} max={20} value={m.tick} onChange={(e) => updateMember(i, { tick: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })} title="0 = 不限；有填面板速度時以面板速度為準" />
                </label>
                <label>
                  <span>面板速度（額外）</span>
                  <input
                    className="input mono"
                    type="number"
                    min={0}
                    value={m.panelExtra || ""}
                    placeholder={v ? `基礎 ${v.base.spd}` : "基礎 ?"}
                    onChange={(e) => updateMember(i, { panelExtra: Math.max(0, Number(e.target.value) || 0) })}
                    title={v ? `基礎速度 ${v.base.spd}；例如要 211 就輸入 ${Math.max(0, 211 - v.base.spd)}` : "輸入基礎速度以外的額外速度"}
                  />
                </label>
                <label>
                  <span>攻擊順序</span>
                  <input className="input mono" type="number" min={1} max={10} value={m.order} onChange={(e) => updateMember(i, { order: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} title="1 = 最先出手；接速以下一個 Tick 為目標" />
                </label>
                <label>
                  <span>提條 %</span>
                  <input className="input mono" type="number" min={0} max={100} value={m.boostPct} onChange={(e) => updateMember(i, { boostPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} title="這隻魔靈會收到的攻擊條 %（例如 風格 S3 全隊 +30）" />
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
      <div className="card card-pad" style={{ marginTop: 12 }}>
        <div className="row between wrap" style={{ gap: 8 }}>
          <div>
            <div className="card-title row" style={{ gap: 7 }}>
              <Gauge size={14} className="gold" /> 接速最低要求
            </div>
            <div className="tiny dim" style={{ marginTop: 3, maxWidth: 760 }}>
              依攻擊順序串接：後一隻要在前一隻出手後的下一個 Tick 出手。已扣除提條，並在啟用速度強化時除以 Buff 倍率（神器「速度增加效果」會再放大 Buff）。
            </div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="chip muted">每 Tick {rta ? "1.5%" : "7%"}</span>
            <button type="button" className="btn btn-sm" onClick={applyAllFollow}>
              <Gauge size={12} /> 全部套用接速
            </button>
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(235px, 1fr))", gap: 8, marginTop: 10 }}>
          {orderedFollow.map((r) => {
            const v = viewOf(members[r.index]?.unitId ?? 0);
            const shownTick = r.panelSpd != null ? r.panelTick : r.currentTick;
            const exactTick = shownTick != null && r.targetTick != null && shownTick === r.targetTick;
            const hasSpeed = r.panelSpd != null || r.currentSpd != null;
            const statusClass = !hasSpeed ? "muted" : exactTick ? "green" : "red";
            return (
              <div key={r.index} className="team-result-member" style={{ padding: 9 }}>
                <div className="row between" style={{ gap: 6 }}>
                  <span className="chip gold">順序 {r.position + 1}</span>
                  <span className="tiny dim">{r.anchorTick != null ? `接 T${r.anchorTick}` : "起手"}</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 12.5, marginTop: 6 }}>
                  {v ? monsterLabel(v.monster.id) : "尚未選擇"}
                </div>
                <div className="row wrap tiny dim" style={{ gap: 6, marginTop: 4 }}>
                  <span>目標 T{r.targetTick ?? "—"}</span>
                  <span>提條 {r.boostPct}%</span>
                  {r.buffPct > 0 && <span className="gold">強化 +{Math.round(r.buffPct * 10) / 10}%</span>}
                </div>
                <div className="row between" style={{ gap: 6, marginTop: 6 }}>
                  <span className="tiny dim">
                    最低 <b className="gold mono">{Number.isFinite(r.minSpeed) ? r.minSpeed : "—"}</b>
                  </span>
                  <span className={`chip ${statusClass}`} title={shownTick != null ? `實際出手 T${shownTick}` : ""}>
                    {r.panelSpd != null ? `面板 ${r.panelSpd}` : r.currentSpd != null ? `目前 ${r.currentSpd}` : "未選"}
                    {shownTick != null ? ` · T${shownTick} ${exactTick ? "✓" : "✗"}` : ""}
                  </span>
                </div>
                <div className="row between" style={{ gap: 6, marginTop: 6 }}>
                  <span className="tiny dim">
                    {r.panelTick != null ? `面板出手 T${r.panelTick}` : r.currentTick != null ? `目前出手 T${r.currentTick}` : "面板速度未設定"}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={!v || !Number.isFinite(r.minSpeed)}
                    onClick={() => applyFollowFloor(r.index)}
                  >
                    套用下限
                  </button>
                </div>
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
                        <div className="tiny dim">{TEAM_ROLE_LABELS[m.role]} · 個人最佳 {Math.round(m.norm * 100)}%</div>
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
                <div className="tiny dim">載入後會依目前隊型的角色順序帶入，仍可再調整攻擊順序、提條與速度強化。</div>
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
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => loadDeck(d)}>
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
