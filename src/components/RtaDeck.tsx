import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Crown,
  GripVertical,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Swords,
  Timer,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { accountGameKey, MONSTER_MAP, unitLabel, useStore } from "../store";
import { ELEMENTS, RUNE_SETS, SET_BY_ID, STAT_KEYS, STAT_META, type StatKey } from "../lib/constants";
import { rtaView } from "../lib/rta";
import { SPD_AREA_LABEL, spdLeaderApplies, spdLeaderSkill } from "../lib/deckSpeed";
import {
  RTA_DECK_OBJECTIVES,
  RTA_DECK_STORAGE_PREFIX,
  RTA_MAIN_OPTIONS,
  RTA_POOL_MAX,
  RTA_SLOTS_MAX,
  applyRoleDefaults,
  createDeckSlot,
  createEmptyDeck,
  deckSlotMains,
  deckSlotSets,
  loadRtaDeck,
  orderedSlots,
  removeSlotFromDeck,
  saveRtaDeck,
  type RtaDeckObjective,
  type RtaDeckResult,
  type RtaDeckSlot,
  type RtaDeckState,
} from "../lib/rtaDeck";
import {
  planRtaDeck,
  speedGapIssues,
  type RtaDeckPlanMember,
  type RtaDeckPlanOutcome,
  type RtaDeckPlanProgress,
  type RtaDeckPlanRequest,
} from "../lib/rtaDeckPlan";
import { TEAM_ROLE_LABELS, type TeamRole } from "../lib/teamOptimizer";
import { baseStats, defaultBonus, effectiveSetCounts, setSummary, statsForRunes } from "../lib/stats";
import type { Account, Artifact, Monster, Rune, Unit } from "../lib/types";
import { MonsterPickerModal, sortMonsterEntries, type MonsterEntry } from "./MonsterPicker";
import {
  ArtifactCard,
  Modal,
  MonsterIcon,
  MonsterPanel,
  NumberInput,
  RuneBoard,
  RuneCard,
  TickBadge,
  fmt,
} from "./ui";

const FOUR_SETS = RUNE_SETS.filter((s) => s.pieces === 4);
const TWO_SETS = RUNE_SETS.filter((s) => s.pieces === 2 && s.id !== 25 && s.id !== 99);
const ROLE_OPTIONS: TeamRole[] = ["speed", "booster", "dps", "tank", "support", "free"];
const OBJECTIVE_LABEL: Record<string, string> = Object.fromEntries(
  RTA_DECK_OBJECTIVES.map((o) => [o.value, o.label]),
);
const MIN_LABEL: Record<StatKey, string> = {
  hp: "體力",
  atk: "攻擊",
  def: "防禦",
  spd: "速度",
  cr: "暴率",
  cd: "暴傷",
  res: "抵抗",
  acc: "命中",
};

const BUDGETS = {
  fast: { label: "快速", pool: 8, topK: 3, nodes: 600_000 },
  standard: { label: "標準", pool: 10, topK: 5, nodes: 1_500_000 },
  full: { label: "完整", pool: 12, topK: 8, nodes: 3_000_000 },
} as const;
type BudgetKey = keyof typeof BUDGETS;

const setsOf = (runes: Rune[]) => {
  const counts: Record<number, number> = {};
  for (const r of runes) counts[r.set] = (counts[r.set] ?? 0) + 1;
  return effectiveSetCounts(counts);
};

const setLabel = (id: number) => SET_BY_ID[id]?.name ?? `套裝${id}`;

/** 2 / 4 / 6 主屬性清單（只保留實際會用到的選項，避免下拉太長） */
const mainOptionsOf = (n: 2 | 4 | 6) => RTA_MAIN_OPTIONS[n];

/** 依速度順序取出實際要配符的格子（速度串接的排前面） */
function planSlots(deck: RtaDeckState): RtaDeckSlot[] {
  return orderedSlots(deck).filter((s) => s.unitId != null);
}

/** 依速度順序的顯示用資料 */
function speedRows(deck: RtaDeckState) {
  return orderedSlots(deck).filter((s) => s.unitId != null && s.inOrder);
}

/** 戰鬥速度面板的速度來源：目前 RTA 配裝 / 上次配符結果 */
type SpeedSource = "current" | "planned";

interface BattleSpeedRow {
  unit: Unit;
  monster: Monster;
  baseSpd: number;
  /** 符文 + 套裝的附加速度 */
  addSpd: number;
  /** 基礎 + 附加（遊戲面板速度） */
  panelSpd: number;
  /** 這隻實際套用的速度隊長 %（可能因為屬性不符為 0） */
  leaderPct: number;
  /** 模擬用的速度建築 % */
  towerPct: number;
  /** 戰鬥速度（含建築與隊長，不含手動調整） */
  battleSpd: number;
  /** 加上手動調整後的戰鬥速度（面板顯示 / 排序用） */
  finalSpd: number;
  /** 手動調整值 */
  adjust: number;
  /** 這組速度是來自目前配裝、上次配符結果，或完全沒有符文 */
  source: "current" | "planned" | "none";
}

interface RtaDeckProps {
  /** 從 RTA 最愛帶入常用魔靈池 */
  favorites: number[];
}

export function RtaDeckPanel({ favorites }: RtaDeckProps) {
  const account = useStore((s) => s.account);
  const settings = useStore((s) => s.settings);
  const grind = settings.bonus.grind;
  const lockedSet = useMemo(() => new Set(settings.lockedRunes), [settings.lockedRunes]);
  const excludedSet = useMemo(() => new Set(settings.excludedRunes), [settings.excludedRunes]);
  const toggleRuneFlag = useStore((s) => s.toggleRuneFlag);
  const notify = useStore((s) => s.notify);

  const storageKey = useMemo(() => {
    const key = accountGameKey(account);
    return key ? `${RTA_DECK_STORAGE_PREFIX}${key}` : "";
  }, [account]);

  const [deck, setDeck] = useState<RtaDeckState>(() => createEmptyDeck());
  const loadedKey = useRef("");
  const skipSave = useRef(true);

  // 帳號切換時重新載入；同一個存檔的資料才不會混在一起
  useEffect(() => {
    if (!storageKey) {
      loadedKey.current = "";
      setDeck(createEmptyDeck());
      skipSave.current = true;
      return;
    }
    loadedKey.current = storageKey;
    setDeck(loadRtaDeck(storageKey));
    skipSave.current = true;
  }, [storageKey]);

  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    if (loadedKey.current) saveRtaDeck(loadedKey.current, deck);
  }, [deck]);

  const update = (fn: (prev: RtaDeckState) => RtaDeckState) => {
    setDeck((prev) => ({ ...fn(prev), updatedAt: Date.now() }));
  };

  const unitMap = useMemo(() => new Map((account?.units ?? []).map((u) => [u.id, u])), [account]);
  const runeMap = useMemo(() => new Map((account?.runes ?? []).map((r) => [r.id, r])), [account]);
  const artifactMap = useMemo(() => new Map((account?.artifacts ?? []).map((a) => [a.id, a])), [account]);

  const unitOf = (id: number | null | undefined): Unit | undefined => (id == null ? undefined : unitMap.get(id));
  const monsterOfUnit = (unit: Unit | undefined) => (unit ? MONSTER_MAP.get(unit.master) : undefined);
  const labelOf = (unit: Unit | undefined) => (unit ? unitLabel(unit) : "未選擇");

  const clampPct = (v: number) => Math.max(0, Math.min(50, Math.round(Number(v) || 0)));

  /** 指定的速度隊長（常用魔靈池的 unit id）；有指定時依隊長技的屬性 / 內容判斷誰吃得到 */
  const leaderUnit = unitOf(deck.leaderUnitId);
  const leaderMonster = monsterOfUnit(leaderUnit);
  const leaderSkill = leaderMonster ? spdLeaderSkill(leaderMonster.id) : null;
  /** 真的有對應隊長技資料、可以依屬性判斷的隊長；否則退回手動 % */
  const activeLeaderUnitId = deck.leaderUnitId && leaderMonster && leaderSkill ? deck.leaderUnitId : null;

  const leaderPctFor = (monster: Monster): number => {
    if (!deck.leaderOn) return 0;
    if (activeLeaderUnitId) {
      if (!leaderSkill) return 0;
      return spdLeaderApplies(leaderSkill, monster.el, "arena") ? leaderSkill.p : 0;
    }
    return clampPct(deck.leaderPct);
  };

  /** 計算戰鬥速度用的 RTA 基準：只有符文 / 套裝，建築與隊長另外加 */
  const rtaPanelBonus = useMemo(
    () =>
      defaultBonus({
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
        leadSpd: 0,
        buffSpd: 0,
        useGuild: false,
        useElementTower: false,
        grind,
      }),
    [grind],
  );

  /**
   * 單一魔靈的戰鬥速度（常用魔靈池的排序依據）。
   * source = planned 時用上次配符結果的符文；否則用目前 RTA 配裝。
   * 面板速度 = 基礎 + 符文 / 套裝；戰鬥速度再加速度建築與速度隊長。
   */
  const battleSpeedOfUnit = (unit: Unit, source: SpeedSource, towerPct = 0): BattleSpeedRow | null => {
    const monster = monsterOfUnit(unit);
    if (!monster) return null;
    // 同一隻魔靈可能同時在多個配裝格；取有配符結果的那一格
    const plannedSlot = deck.slots.find((s) => s.unitId === unit.id && deck.results[s.id]);
    const planned = plannedSlot ? deck.results[plannedSlot.id] : undefined;
    const current = account?.rta?.loadouts?.[unit.id];
    const usePlanned = source === "planned" && !!planned;
    const ids = usePlanned ? planned.runeIds : current?.runes ?? [];
    const runes = ids.map((id) => runeMap.get(id)).filter((r): r is Rune => !!r);
    // 神器目前沿用這隻魔靈的 RTA 神器（一鍵配符也是用同一組當種子）
    const artifacts = (current?.artifacts ?? [])
      .map((id) => artifactMap.get(id))
      .filter((a): a is Artifact => !!a);
    const base = baseStats(monster, unit.stars, unit.level);
    const panelSpd = statsForRunes(base, runes, rtaPanelBonus, true, false, artifacts).spd;
    const theTower = clampPct(towerPct);
    const leaderPct = leaderPctFor(monster);
    const battleSpd = panelSpd + Math.ceil((base.spd * (theTower + leaderPct)) / 100);
    const adjust = Math.round(deck.speedAdjust[unit.id] ?? 0);
    return {
      unit,
      monster,
      baseSpd: base.spd,
      addSpd: panelSpd - base.spd,
      panelSpd,
      leaderPct,
      towerPct: theTower,
      battleSpd,
      finalSpd: Math.max(1, battleSpd + adjust),
      adjust,
      source: usePlanned ? "planned" : runes.length > 0 ? "current" : "none",
    };
  };

  /** 配裝格目前的速度（有配符結果就用結果，否則用目前 RTA 配裝；不計建築與手動調整） */
  const rtaSpeedOf = (slot: RtaDeckSlot): BattleSpeedRow | null => {
    const unit = unitOf(slot.unitId);
    if (!unit) return null;
    return battleSpeedOfUnit(unit, deck.results[slot.id] ? "planned" : "current", 0);
  };

  /** RTA 目前配裝（點開魔靈看符文 / 神器） */
  const [detailUnitId, setDetailUnitId] = useState<number | null>(null);
  const detail = useMemo(() => {
    if (!account || detailUnitId == null) return null;
    const unit = unitMap.get(detailUnitId);
    const monster = monsterOfUnit(unit);
    if (!unit || !monster) return null;
    return { view: rtaView(account, unit, monster, leaderPctFor(monster), grind), monster, unit };
    // leaderPctFor 的結果由下面列出的狀態決定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, detailUnitId, unitMap, deck.leaderOn, deck.leaderPct, deck.leaderUnitId, deck.pool, grind]);

  /** 魔靈挑選器 */
  const [poolPicker, setPoolPicker] = useState(false);
  const [pickerSlotId, setPickerSlotId] = useState<string | null>(null);
  const [openSlots, setOpenSlots] = useState<Set<string>>(() => new Set());
  const [resultSlotId, setResultSlotId] = useState<string | null>(null);
  const [budgetKey, setBudgetKey] = useState<BudgetKey>("standard");
  const budget = BUDGETS[budgetKey];
  /** 戰鬥速度面板要顯示目前 RTA 配裝，還是上次配符結果 */
  const [speedSource, setSpeedSource] = useState<SpeedSource>("current");
  /**
   * 正在編輯哪一隻的戰鬥速度。編輯時凍結牠的排序值，
   * 避免輸入「2」的瞬間就跳到隊尾、輸入框跟著跑。
   */
  const [speedEdit, setSpeedEdit] = useState<{ unitId: number; key: number } | null>(null);

  /** 可以當速度隊長的魔靈：常用魔靈池＋配裝格（有隊長技資料的） */
  const leaderOptions = (() => {
    const ids = [...deck.pool];
    for (const slot of deck.slots) {
      if (slot.unitId != null && !ids.includes(slot.unitId)) ids.push(slot.unitId);
    }
    return ids.flatMap((unitId) => {
      const unit = unitOf(unitId);
      const monster = monsterOfUnit(unit);
      const skill = monster ? spdLeaderSkill(monster.id) : null;
      if (!unit || !monster || !skill) return [];
      return [{ unitId, label: unitLabel(unit), skill }];
    });
  })();

  const setLeaderUnit = (value: string) => {
    if (!value) {
      update((prev) => ({ ...prev, leaderOn: false, leaderUnitId: null }));
      return;
    }
    if (value === "__manual") {
      update((prev) => ({ ...prev, leaderOn: true, leaderUnitId: null }));
      return;
    }
    const unitId = Number(value);
    const unit = unitOf(unitId);
    const monster = monsterOfUnit(unit);
    const skill = monster ? spdLeaderSkill(monster.id) : null;
    if (!unit || !skill) return;
    update((prev) => ({ ...prev, leaderOn: true, leaderUnitId: unitId, leaderPct: skill.p }));
  };

  const setManualLeaderPct = (value: number) => {
    update((prev) => ({ ...prev, leaderOn: true, leaderUnitId: null, leaderPct: value }));
  };

  const allEntries = useMemo<MonsterEntry[]>(() => {
    if (!account) return [];
    return sortMonsterEntries(
      account.units
        .map((u) => ({ unit: u, monster: MONSTER_MAP.get(u.master) }))
        .filter((x): x is { unit: Unit; monster: NonNullable<ReturnType<typeof MONSTER_MAP.get>> } => !!x.monster)
        .map(({ unit, monster }) => ({
          key: String(unit.id),
          monster,
          meta: `${unit.stars}★ Lv.${unit.level} · ${unitLabel(unit)}`,
          title: `${monster.name} · ${ELEMENTS[monster.el as 1]?.name ?? ""} · ${unit.stars}★ Lv.${unit.level}`,
          disabled: deck.pool.includes(unit.id),
        })),
    );
  }, [account, deck.pool]);

  const poolEntries = useMemo<MonsterEntry[]>(() => {
    const entries: MonsterEntry[] = [];
    for (const id of deck.pool) {
      const unit = unitMap.get(id);
      const monster = monsterOfUnit(unit);
      if (!unit || !monster) continue;
      entries.push({
        key: String(unit.id),
        monster,
        meta: `${unit.stars}★ Lv.${unit.level} · ${unitLabel(unit)}`,
        title: `${unitLabel(unit)} · ${monster.name} · 基礎速度 ${monster.spd}`,
        disabled: deck.slots.some((s) => s.unitId === unit.id),
      });
    }
    return entries;
  }, [deck.pool, deck.slots, unitMap]);

  const toggleSlotOpen = (id: string) =>
    setOpenSlots((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addPoolUnit = (unitId: number) => {
    if (!unitMap.has(unitId)) return;
    update((prev) => {
      if (prev.pool.includes(unitId)) return prev;
      if (prev.pool.length >= RTA_POOL_MAX) {
        notify(`常用魔靈最多 ${RTA_POOL_MAX} 隻`, "err");
        return prev;
      }
      return { ...prev, pool: [...prev.pool, unitId] };
    });
  };

  const addFavoritePool = () => {
    const ids = favorites.filter((id) => unitMap.has(id) && !deck.pool.includes(id));
    if (ids.length === 0) return notify("RTA 最愛已經全部在常用魔靈池裡");
    update((prev) => {
      const room = RTA_POOL_MAX - prev.pool.length;
      return { ...prev, pool: [...prev.pool, ...ids.slice(0, Math.max(0, room))] };
    });
    notify(`已加入 ${Math.min(ids.length, Math.max(0, RTA_POOL_MAX - deck.pool.length))} 隻 RTA 最愛`);
  };

  const removePoolUnit = (unitId: number) => {
    update((prev) => {
      const speedAdjust = { ...prev.speedAdjust };
      delete speedAdjust[unitId];
      return {
        ...prev,
        pool: prev.pool.filter((id) => id !== unitId),
        // 從池子移除時，已設定在格子裡的同一隻也清空，避免選到池子外的魔靈
        slots: prev.slots.map((s) => (s.unitId === unitId ? { ...s, unitId: null } : s)),
        leaderUnitId: prev.leaderUnitId === unitId ? null : prev.leaderUnitId,
        speedAdjust,
      };
    });
  };

  const addSlot = (unitId: number | null = null) => {
    if (deck.slots.length >= RTA_SLOTS_MAX) {
      notify(`RTA Deck 最多 ${RTA_SLOTS_MAX} 格`, "err");
      return;
    }
    if (unitId != null && deck.slots.some((s) => s.unitId === unitId)) {
      notify("這隻魔靈已經在配裝格裡", "err");
      return;
    }
    const slot = createDeckSlot(unitId);
    update((prev) => ({
      ...prev,
      slots: [...prev.slots, slot],
      speedOrder: [...prev.speedOrder, slot.id],
      results: { ...prev.results },
    }));
    setOpenSlots((prev) => new Set(prev).add(slot.id));
  };

  const updateSlot = (id: string, patch: Partial<RtaDeckSlot>) => {
    update((prev) => ({
      ...prev,
      slots: prev.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  };

  const setSlotUnit = (id: string, unitId: number | null) => {
    if (unitId != null) {
      if (!deck.pool.includes(unitId)) return notify("請先把魔靈加入常用魔靈池", "err");
      if (deck.slots.some((s) => s.id !== id && s.unitId === unitId)) return notify("這隻魔靈已經在別的配裝格裡", "err");
    }
    updateSlot(id, { unitId });
  };

  const removeSlot = (id: string) => {
    update((prev) => removeSlotFromDeck(prev, id));
    setOpenSlots((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const setRole = (slot: RtaDeckSlot, role: TeamRole) => {
    updateSlot(slot.id, applyRoleDefaults(slot, role));
  };

  const setMain = (slot: RtaDeckSlot, n: 2 | 4 | 6, index: 0 | 1, value: number) => {
    const cur = [slot.mains[n]?.[0] ?? 0, slot.mains[n]?.[1] ?? 0];
    cur[index] = value;
    const next = [...new Set(cur.filter((v) => v > 0))].slice(0, 2);
    updateSlot(slot.id, { mains: { ...slot.mains, [n]: next } });
  };

  const setMin = (slot: RtaDeckSlot, key: StatKey, value: number) => {
    const min = { ...slot.min };
    if (value > 0) min[key] = value;
    else delete min[key];
    updateSlot(slot.id, { min });
  };

  const moveInOrder = (id: string, delta: number) => {
    update((prev) => {
      const order = [...prev.speedOrder];
      const at = order.indexOf(id);
      const to = Math.max(0, Math.min(order.length - 1, at + delta));
      if (at < 0 || at === to) return prev;
      order.splice(at, 1);
      order.splice(to, 0, id);
      return { ...prev, speedOrder: order };
    });
  };

  const orderByCurrentSpeed = () => {
    if (!account) return;
    const configured = deck.slots.filter((s) => s.unitId != null);
    const speedOf = (slot: RtaDeckSlot) => rtaSpeedOf(slot)?.battleSpd ?? 0;
    const sorted = [...configured].sort((a, b) => speedOf(b) - speedOf(a));
    const rest = deck.slots.filter((s) => s.unitId == null).map((s) => s.id);
    update((prev) => ({ ...prev, speedOrder: [...sorted.map((s) => s.id), ...rest] }));
    notify("已依目前速度重新排序");
  };

  /** 進行中的配符 */
  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RtaDeckPlanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  const configured = planSlots(deck);
  const readyMembers = configured.filter((s) => s.unitId != null);
  const speedChain = speedRows(deck);

  const runPlan = () => {
    if (!account) return notify("請先匯入存檔", "err");
    if (configured.length === 0) return notify("請先新增配裝格並選擇魔靈", "err");
    const missing = deck.slots.filter((s) => s.unitId == null);
    if (missing.length > 0) {
      // 空白格不影響配符，但提醒使用者還有格子沒選魔靈
      notify(`有 ${missing.length} 個空白格不會參與配符`);
    }
    const chainIds = new Set(speedChain.map((s) => s.id));
    const members: RtaDeckPlanMember[] = configured.map((slot) => {
      const unit = unitOf(slot.unitId);
      const monster = monsterOfUnit(unit);
      if (!unit || !monster) throw new Error("配裝格參照到不存在的魔靈");
      return {
        slotId: slot.id,
        unitId: unit.id,
        master: unit.master,
        label: unitLabel(unit),
        base: baseStats(monster, unit.stars, unit.level),
        role: slot.role,
        sets: deckSlotSets(slot),
        mains: deckSlotMains(slot),
        min: { ...slot.min },
        weight: slot.weight,
        gap: slot.gap,
        speedChain: chainIds.has(slot.id),
        // 這隻實際吃到的速度隊長 %（Element 隊長技只套用到同屬性）
        leaderPct: leaderPctFor(monster),
        objective: deck.objective,
        // 目前遊戲中的 RTA 配裝：搜尋失敗時可直接沿用（並把神器固定值計入）
        seedRunes: account.rta?.loadouts?.[unit.id]?.runes ?? [],
        seedArtifacts: (account.rta?.loadouts?.[unit.id]?.artifacts ?? [])
          .map((id) => artifactMap.get(id))
          .filter((a): a is Artifact => !!a),
      };
    });
    // 把速度串接的成員排前面，其餘接在後面且不受速度差限制
    members.sort((a, b) => Number(b.speedChain) - Number(a.speedChain));

    const req: RtaDeckPlanRequest = {
      members,
      runes: account.runes,
      // RTA 只吃符文 / 套裝 / 神器與速度隊長；建築、Buff、公會技能都不計
      bonus: {
        ...settings.bonus,
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
        buffSpd: 0,
        useGuild: false,
        useElementTower: false,
        grind: true,
      },
      leaderPct: deck.leaderOn ? Math.max(0, Math.min(50, deck.leaderPct)) : 0,
      gapMode: deck.gapMode,
      pool: budget.pool,
      topK: budget.topK,
      maxNodes: budget.nodes,
      excludeRunes: settings.excludedRunes,
      lockedRunes: settings.lockedRunes,
    };

    workerRef.current?.terminate();
    let worker: Worker;
    try {
      worker = new Worker(new URL("../lib/rtaDeck.worker.ts", import.meta.url), { type: "module" });
    } catch {
      return setError("瀏覽器無法啟動配符運算模組，請重新整理或改用 Chrome / Edge。");
    }
    workerRef.current = worker;
    const id = ++runIdRef.current;
    setRunning(true);
    setError(null);
    setProgress({ index: 0, total: members.length, slotId: "", label: "準備中…" });

    const timer = window.setTimeout(() => {
      if (workerRef.current !== worker) return;
      worker.terminate();
      workerRef.current = null;
      setRunning(false);
      setError("配符超過 3 分鐘，已停止。請改用「快速」預算、降低結果數或減少配裝格。");
    }, 180_000);

    const done = () => {
      window.clearTimeout(timer);
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };

    worker.onmessage = (e: MessageEvent<{
      id: number;
      progress?: RtaDeckPlanProgress;
      out?: RtaDeckPlanOutcome;
      error?: string;
    }>) => {
      if (e.data.id !== id) return;
      if (e.data.progress) setProgress(e.data.progress);
      if (e.data.error) {
        done();
        setRunning(false);
        setError(e.data.error);
        return;
      }
      if (!e.data.out) return;
      done();
      setRunning(false);
      if (!e.data.out.ok) {
        setError(e.data.out.error);
        return;
      }
      const results: Record<string, RtaDeckResult> = { ...deck.results };
      for (const m of e.data.out.members) {
        results[m.slotId] = {
          slotId: m.slotId,
          runeIds: m.runeIds,
          stats: m.stats,
          ehp: m.ehp,
          score: m.score,
          eff: m.eff,
          focusFit: m.focusFit,
          objective: m.objective,
          notes: m.notes,
        };
      }
      setDeck((prev) => ({ ...prev, results, updatedAt: Date.now() }));
      notify(`RTA Deck 配符完成：${e.data.out.members.length} 隻（${Math.round(e.data.out.ms / 100) / 10} 秒）`);
    };
    worker.onerror = (ev) => {
      console.error("rta deck worker error", ev);
      done();
      setRunning(false);
      setError("配符運算模組載入失敗（可能是網站剛更新）。請按 Ctrl + F5 重新整理後再試。");
    };
    worker.postMessage({ id, req });
  };

  const cancelPlan = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setRunning(false);
    setProgress(null);
  };

  if (!account) return <div className="empty">尚未匯入存檔</div>;

  const gapIssues = speedGapIssues(
    speedChain
      .map((slot) => ({
        slotId: slot.id,
        label: labelOf(unitOf(slot.unitId)),
        spd: rtaSpeedOf(slot)?.battleSpd ?? 0,
        gap: slot.gap,
      }))
      .filter((row) => row.spd > 0),
    deck.gapMode,
  );

  const detailResult = resultSlotId ? deck.results[resultSlotId] : undefined;
  const detailResultSlot = resultSlotId ? deck.slots.find((s) => s.id === resultSlotId) : undefined;
  const detailResultUnit = detailResultSlot ? unitOf(detailResultSlot.unitId) : undefined;
  const detailResultRunes = detailResult
    ? detailResult.runeIds.map((id) => runeMap.get(id)).filter((r): r is Rune => !!r)
    : [];
  const detailResultSpeed = detailResultSlot ? rtaSpeedOf(detailResultSlot)?.battleSpd ?? 0 : 0;

  // 已配好的整體水準：平均符文效率 / 平均評分 / 平均速度
  const doneRows = deck.slots
    .filter((slot) => slot.unitId != null && deck.results[slot.id])
    .map((slot) => ({ slot, result: deck.results[slot.id], unit: unitOf(slot.unitId) }));
  const avgOf = (pick: (r: RtaDeckResult) => number) =>
    doneRows.length > 0 ? doneRows.reduce((sum, row) => sum + pick(row.result), 0) / doneRows.length : 0;
  const avgEff = avgOf((r) => r.eff);
  const avgScore = avgOf((r) => r.score);
  const avgSpd =
    doneRows.length > 0
      ? doneRows.reduce((sum, row) => sum + (rtaSpeedOf(row.slot)?.battleSpd ?? 0), 0) / doneRows.length
      : 0;
  const usedRunes = new Set(doneRows.flatMap((row) => row.result.runeIds)).size;
  const ranked = [...doneRows].sort((a, b) => b.result.eff - a.result.eff);
  const bestRow = ranked[0];
  const worstRow = ranked.length > 1 ? ranked[ranked.length - 1] : undefined;

  /** 常用魔靈池的戰鬥速度：依最終戰鬥速度由快到慢排序 */
  const poolRows = deck.pool
    .flatMap((unitId) => {
      const unit = unitOf(unitId);
      const row = unit ? battleSpeedOfUnit(unit, speedSource, deck.towerSpd) : null;
      return row ? [row] : [];
    })
    .sort((a, b) => {
      // 編輯中的那一隻維持原本位置，其餘照最終速度排序
      const key = (row: BattleSpeedRow) =>
        speedEdit && speedEdit.unitId === row.unit.id ? speedEdit.key : row.finalSpd;
      return (
        key(b) - key(a) ||
        b.baseSpd - a.baseSpd ||
        labelOf(a.unit).localeCompare(labelOf(b.unit))
      );
    });
  const manualSpeedCount = poolRows.filter((row) => row.adjust !== 0).length;

  const leaderDesc =
    !deck.leaderOn
      ? "未計速度隊長"
      : activeLeaderUnitId && leaderUnit && leaderSkill
        ? `${unitLabel(leaderUnit)} · +${leaderSkill.p}% ${SPD_AREA_LABEL[leaderSkill.a] ?? ""}`
        : `手動 +${clampPct(deck.leaderPct)}%（套用到所有魔靈）`;

  const setPoolSpeed = (row: BattleSpeedRow, value: number) => {
    const delta = Math.round(value - row.battleSpd);
    // 第一次修改就凍結這隻的排序值，避免輸入「1」的瞬間跳到隊尾、輸入框跟著跑
    setSpeedEdit((prev) => prev ?? { unitId: row.unit.id, key: row.finalSpd });
    update((prev) => {
      const speedAdjust = { ...prev.speedAdjust };
      if (delta === 0) delete speedAdjust[row.unit.id];
      else speedAdjust[row.unit.id] = delta;
      return { ...prev, speedAdjust };
    });
  };

  const resetManualSpeeds = () => {
    update((prev) => ({ ...prev, speedAdjust: {} }));
    notify("已清除所有手動戰鬥速度");
  };

  /** 把常用魔靈池目前的戰鬥速度順序套用到配符用的速度串接（只取有在配裝格裡的） */
  const applyPoolOrder = () => {
    const slotByUnit = new Map(
      deck.slots.filter((s) => s.unitId != null).map((s) => [s.unitId as number, s.id]),
    );
    const ids = poolRows.flatMap((row) => {
      const id = slotByUnit.get(row.unit.id);
      return id ? [id] : [];
    });
    if (ids.length === 0) return notify("戰鬥速度順序中的魔靈都還沒加入配裝格", "err");
    const rest = deck.slots.filter((slot) => !ids.includes(slot.id)).map((slot) => slot.id);
    update((prev) => ({
      ...prev,
      speedOrder: [...ids, ...rest],
      slots: prev.slots.map((slot) => (ids.includes(slot.id) ? { ...slot, inOrder: true } : slot)),
    }));
    notify(`已依戰鬥速度套用 ${ids.length} 隻的速度順序`);
  };

  return (
    <div className="col rta-deck" style={{ gap: 14 }}>
      {/* ── 常用魔靈池 ───────────────────────────── */}
      <div className="card">
        <div className="card-head">
          <div style={{ minWidth: 0 }}>
            <div className="card-title">
              <Timer size={13} className="gold" style={{ verticalAlign: -2, marginRight: 4 }} />
              RTA Deck · 常用魔靈池 <span className="dim tiny">{deck.pool.length} / {RTA_POOL_MAX}</span>
            </div>

            <div className="rta-pool-tools row wrap">
              <span className="row tiny" style={{ gap: 5 }}>
                <Crown size={12} className="gold" />
                <span className="dim">速度隊長</span>
                <select
                  className="select"
                  style={{ width: 248 }}
                  value={!deck.leaderOn ? "" : activeLeaderUnitId ?? "__manual"}
                  onChange={(e) => setLeaderUnit(e.target.value)}
                >
                  <option value="">無速度隊長</option>
                  <option value="__manual">手動輸入 %（套用到全部）</option>
                  {leaderOptions.map((option) => {
                    const rtaOk =
                      option.skill.a === "General" ||
                      option.skill.a === "Arena" ||
                      option.skill.a === "Element";
                    const area = SPD_AREA_LABEL[option.skill.a] ?? option.skill.a;
                    const element = option.skill.a === "Element" && option.skill.e ? ` ${option.skill.e}` : "";
                    return (
                      <option key={option.unitId} value={option.unitId} disabled={!rtaOk}>
                        {option.label} · +{option.skill.p}%（{area}{element}）{rtaOk ? "" : "－RTA 不適用"}
                      </option>
                    );
                  })}
                </select>
              </span>

              {deck.leaderOn && !activeLeaderUnitId && (
                <span className="row tiny" style={{ gap: 4 }}>
                  <NumberInput
                    className="input mono"
                    min={0}
                    max={50}
                    step={1}
                    value={deck.leaderPct}
                    onChange={setManualLeaderPct}
                    style={{ width: 70 }}
                    title="手動速度隊長技 %"
                  />
                  <span className="dim">%</span>
                </span>
              )}
              {deck.leaderOn && activeLeaderUnitId && (
                <span className="chip gold" title="隊長技依屬性 / 內容自動套用">
                  {leaderDesc}
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    style={{ padding: "0 4px", fontSize: 10 }}
                    onClick={() => setLeaderUnit("__manual")}
                  >
                    改手動
                  </button>
                </span>
              )}

              <span className="row tiny" style={{ gap: 4 }}>
                <span className="dim">速度建築</span>
                <NumberInput
                  className="input mono"
                  min={0}
                  max={50}
                  step={1}
                  value={deck.towerSpd}
                  onChange={(v) => update((prev) => ({ ...prev, towerSpd: Math.max(0, Math.min(50, v)) }))}
                  style={{ width: 58 }}
                  title="速度圖騰 / 速度建築 %；RTA 實際上不計，預設 0"
                />
                <span className="dim">%</span>
              </span>

              <span className="row tiny" style={{ gap: 4 }}>
                <span className="dim">速度來源</span>
                <span className="tabs">
                  <button
                    type="button"
                    className={`tab ${speedSource === "current" ? "active" : ""}`}
                    onClick={() => setSpeedSource("current")}
                    title="使用遊戲中目前的 RTA 配裝"
                  >
                    目前配裝
                  </button>
                  <button
                    type="button"
                    className={`tab ${speedSource === "planned" ? "active" : ""}`}
                    onClick={() => setSpeedSource("planned")}
                    title="使用上次一鍵配符的結果（沒有結果的魔靈會沿用目前配裝）"
                  >
                    配符結果
                  </button>
                </span>
              </span>

              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={applyPoolOrder}
                disabled={poolRows.length === 0}
                title="把常用魔靈池的戰鬥速度順序套用到下方配符用的速度串接"
              >
                <ArrowDown size={11} /> 套用順序
              </button>
              {manualSpeedCount > 0 && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={resetManualSpeeds}>
                  <RotateCcw size={11} /> 清除手動速度（{manualSpeedCount}）
                </button>
              )}
            </div>

            <div className="card-sub">
              最多選 {RTA_POOL_MAX} 隻常用魔靈，依戰鬥速度由快到慢排序（基礎＋符文附加＋速度建築＋速度隊長）。
              下方速度可直接修改；點小圖示可看目前的 RTA 符文與神器配置，按右上角 ＋ 加入配裝格。
            </div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            {favorites.length > 0 && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={addFavoritePool} title="把 RTA 最愛加入常用魔靈池">
                <Swords size={12} /> 加入 RTA 最愛
              </button>
            )}
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setPoolPicker(true)}>
              <Search size={12} /> 選擇魔靈
            </button>
          </div>
        </div>
        <div className="card-pad">
          {poolRows.length === 0 ? (
            <div className="empty" style={{ padding: "22px 16px" }}>
              常用魔靈池是空的。可以按「加入 RTA 最愛」或「選擇魔靈」開始。
            </div>
          ) : (
            <div className="rta-deck-pool">
              {poolRows.map((row, i) => {
                const used = deck.slots.some((s) => s.unitId === row.unit.id);
                const isLeader = activeLeaderUnitId === row.unit.id;
                const noLead = deck.leaderOn && row.leaderPct === 0;
                return (
                  <div
                    key={row.unit.id}
                    className={`rta-pool-item ${used ? "used" : ""} ${isLeader ? "leader" : ""} ${noLead ? "no-lead" : ""}`}
                    title={`${unitLabel(row.unit)} · 戰鬥速度 ${row.finalSpd}（基礎 ${row.baseSpd} + 符文 ${row.addSpd} + 建築 ${row.towerPct}% + 隊長 ${row.leaderPct}%）`}
                  >
                    <button type="button" className="rta-pool-open" onClick={() => setDetailUnitId(row.unit.id)}>
                      <MonsterIcon id={row.monster.id} size={42} />
                      <span className="rta-pool-name">
                        {isLeader && <Crown size={9} className="gold" style={{ verticalAlign: -1, marginRight: 2 }} />}
                        {unitLabel(row.unit)}
                      </span>
                    </button>
                    <div className="rta-pool-spd">
                      <span className="rta-pool-rank">{i + 1}</span>
                      <NumberInput
                        className="rta-pool-spd-input mono"
                        min={1}
                        max={9999}
                        step={1}
                        value={row.finalSpd}
                        onChange={(v) => setPoolSpeed(row, v)}
                        onFocus={() => setSpeedEdit({ unitId: row.unit.id, key: row.finalSpd })}
                        onBlur={() => setSpeedEdit(null)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                        title="可直接修改戰鬥速度（手動調整會疊加在計算值上）"
                      />
                      <span className="tiny dim">速</span>
                      {row.adjust !== 0 && (
                        <button
                          type="button"
                          className="rta-pool-spd-reset"
                          title={`手動 ${row.adjust > 0 ? "+" : ""}${row.adjust}；點擊清除`}
                          onClick={() =>
                            update((prev) => {
                              const speedAdjust = { ...prev.speedAdjust };
                              delete speedAdjust[row.unit.id];
                              return { ...prev, speedAdjust };
                            })
                          }
                        >
                          <RotateCcw size={9} />
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      className="rta-pool-add"
                      title={used ? "已在配裝格" : "加入配裝格"}
                      disabled={used}
                      onClick={() => addSlot(row.unit.id)}
                    >
                      <Plus size={11} />
                    </button>
                    <button type="button" className="rta-pool-del" title="從常用魔靈池移除" onClick={() => removePoolUnit(row.unit.id)}>
                      <X size={10} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── 配符與速度順序 ───────────────────────── */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">RTA Deck · 配裝與速度順序</div>
            <div className="card-sub">
              最多 {RTA_SLOTS_MAX} 隻。速度順序與數值下限是「限制條件」，預設在符合條件下把符文評分（水準）最大化。
            </div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            <select
              className="select"
              style={{ width: 150 }}
              value={deck.objective}
              onChange={(e) => update((prev) => ({ ...prev, objective: e.target.value as RtaDeckObjective }))}
              title={RTA_DECK_OBJECTIVES.find((o) => o.value === deck.objective)?.hint}
            >
              {RTA_DECK_OBJECTIVES.map((o) => (
                <option key={o.value} value={o.value}>
                  目標：{o.label}
                </option>
              ))}
            </select>
            <select className="select" style={{ width: 130 }} value={budgetKey} onChange={(e) => setBudgetKey(e.target.value as BudgetKey)}>
              {(Object.keys(BUDGETS) as BudgetKey[]).map((k) => (
                <option key={k} value={k}>
                  預算：{BUDGETS[k].label}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-sm btn-primary" onClick={runPlan} disabled={running || readyMembers.length === 0}>
              <Wand2 size={13} /> {running ? "配符中…" : `一鍵配 ${readyMembers.length} 隻`}
            </button>
            {running && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={cancelPlan}>
                停止
              </button>
            )}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => addSlot(null)} disabled={deck.slots.length >= RTA_SLOTS_MAX}>
              <Plus size={12} /> 新增格子
            </button>
          </div>
        </div>

        <div className="card-pad col" style={{ gap: 10, borderBottom: "1px solid var(--line-soft)" }}>
          <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
            <span className="chip muted">
              <Crown size={11} /> {deck.leaderOn ? leaderDesc : "未計速度隊長"}
            </span>
            <span className="tiny dim">速度隊長與建築在「常用魔靈池」設定</span>
            <div className="tabs">
              <button
                type="button"
                className={`tab ${deck.gapMode === "at-least" ? "active" : ""}`}
                onClick={() => update((prev) => ({ ...prev, gapMode: "at-least" }))}
                title="後面的角色至少要比前一隻慢指定的速度"
              >
                至少差 N 速
              </button>
              <button
                type="button"
                className={`tab ${deck.gapMode === "exact" ? "active" : ""}`}
                onClick={() => update((prev) => ({ ...prev, gapMode: "exact" }))}
                title="後面的角色要剛好比前一隻慢指定的速度"
              >
                剛好差 N 速
              </button>
            </div>
            <span className="dim tiny" style={{ marginLeft: "auto" }}>
              已設定 {readyMembers.length} / {RTA_SLOTS_MAX} 格
            </span>
          </div>

          {running && (
            <div className="rta-deck-progress">
              <div className="row between tiny" style={{ marginBottom: 4 }}>
                <span>{progress ? `正在配：${progress.label}（${progress.index + 1} / ${progress.total}）` : "準備中…"}</span>
                <span>{progress ? Math.round(((progress.index + 1) / Math.max(1, progress.total)) * 100) : 0}%</span>
              </div>
              <div className="rta-deck-bar">
                <span style={{ width: `${progress ? Math.round(((progress.index + 1) / Math.max(1, progress.total)) * 100) : 0}%` }} />
              </div>
            </div>
          )}
          {error && (
            <div className="rta-deck-error">
              {error}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setError(null)} style={{ marginLeft: 8 }}>
                關閉
              </button>
            </div>
          )}

          {/* 整體水準：30 隻平均 */}
          {doneRows.length > 0 && (
            <div className="rta-deck-stats">
              <div className="rta-deck-stat">
                <span className="tiny dim">已配好</span>
                <b>{doneRows.length} 隻</b>
              </div>
              <div className="rta-deck-stat">
                <span className="tiny dim">平均水準（效率）</span>
                <b className="gold">{Math.round(avgEff * 10) / 10}%</b>
              </div>
              <div className="rta-deck-stat">
                <span className="tiny dim">平均面板評分</span>
                <b>{Math.round(avgScore * 10) / 10}</b>
              </div>
              <div className="rta-deck-stat">
                <span className="tiny dim">平均速度</span>
                <b>{Math.round(avgSpd * 10) / 10}</b>
              </div>
              <div className="rta-deck-stat">
                <span className="tiny dim">使用符文</span>
                <b>{usedRunes} 顆</b>
              </div>
              {gapIssues.length > 0 && (
                <div className="rta-deck-stat">
                  <span className="tiny dim">速度差符合</span>
                  <b style={{ color: gapIssues.every((g) => g.ok) ? "var(--green)" : "var(--red)" }}>
                    {gapIssues.filter((g) => g.ok).length} / {gapIssues.length}
                  </b>
                </div>
              )}
              {bestRow && (
                <div className="rta-deck-stat">
                  <span className="tiny dim">最高 / 最低</span>
                  <b className="tiny">
                    {labelOf(bestRow.unit)} {Math.round(bestRow.result.eff * 10) / 10}%
                    {worstRow && ` · ${labelOf(worstRow.unit)} ${Math.round(worstRow.result.eff * 10) / 10}%`}
                  </b>
                </div>
              )}
            </div>
          )}

          {/* 速度順序 */}
          <div className="rta-speed-box">
            <div className="row between wrap" style={{ gap: 8 }}>
              <div className="card-title" style={{ fontSize: 13 }}>
                <Timer size={13} className="gold" style={{ verticalAlign: -2, marginRight: 4 }} />
                速度順序（A 比 B 快、B 比 C 快）
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                <button type="button" className="btn btn-sm btn-ghost" onClick={orderByCurrentSpeed} title="依目前配裝 / 基礎速度由快到慢排序">
                  <RefreshCw size={11} /> 依目前速度排序
                </button>
                <span className="tiny dim">第一隻不受速度差限制；可用 ↑↓ 調整。</span>
              </div>
            </div>
            {speedChain.length === 0 ? (
              <div className="tiny dim" style={{ padding: "10px 0" }}>
                還沒有設定速度順序。把配裝格的「參與速度順序」打開，就會列在這裡。
              </div>
            ) : (
              <div className="rta-speed-list">
                {speedChain.map((slot, i) => {
                  const unit = unitOf(slot.unitId);
                  const info = rtaSpeedOf(slot);
                  const issue = gapIssues.find((x) => x.slotId === slot.id);
                  const prev = i > 0 ? rtaSpeedOf(speedChain[i - 1]) : null;
                  const actual = prev && info ? prev.battleSpd - info.battleSpd : null;
                  return (
                    <div key={slot.id} className={`rta-speed-row ${issue && !issue.ok ? "bad" : ""}`}>
                      <span className="rta-speed-pos">{i + 1}</span>
                      <GripVertical size={12} className="dim" />
                      <MonsterIcon id={monsterOfUnit(unit)?.id ?? 0} size={24} />
                      <span className="rta-speed-name">{labelOf(unit)}</span>
                      <span className="tiny dim">
                        {info ? `${info.battleSpd} 速` : "—"}
                        {info?.source === "none" && <span className="dim">（無符文）</span>}
                      </span>
                      {i > 0 ? (
                        <label className="row tiny" style={{ gap: 4 }}>
                          與前一隻差
                          <NumberInput
                            className="input mono"
                            min={0}
                            max={999}
                            step={1}
                            value={slot.gap}
                            onChange={(v) => updateSlot(slot.id, { gap: v })}
                            style={{ width: 58, padding: "3px 6px", fontSize: 11 }}
                          />
                          速
                        </label>
                      ) : (
                        <span className="tiny dim">基準（最快）</span>
                      )}
                      {actual != null && (
                        <span className={`chip ${issue?.ok ? "green" : "red"}`} title="實際速度差">
                          實際 {actual} 速
                        </span>
                      )}
                      <span className="row" style={{ gap: 2, marginLeft: "auto" }}>
                        <button type="button" className="order-step" onClick={() => moveInOrder(slot.id, -1)} disabled={i === 0} title="往前">
                          <ArrowUp size={11} />
                        </button>
                        <button type="button" className="order-step" onClick={() => moveInOrder(slot.id, 1)} disabled={i === speedChain.length - 1} title="往後">
                          <ArrowDown size={11} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          style={{ padding: "0 5px", fontSize: 10 }}
                          onClick={() => updateSlot(slot.id, { inOrder: false })}
                          title="不列入速度順序"
                        >
                          移除
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {deck.slots.some((s) => s.unitId != null && !s.inOrder) && (
              <div className="row wrap tiny dim" style={{ gap: 6, marginTop: 6 }}>
                未列入速度順序：
                {deck.slots
                  .filter((s) => s.unitId != null && !s.inOrder)
                  .map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="chip muted"
                      style={{ cursor: "pointer" }}
                      onClick={() => updateSlot(s.id, { inOrder: true })}
                      title="加入速度順序"
                    >
                      {labelOf(unitOf(s.unitId))} ＋
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* 30 個配裝格 */}
        <div className="card-pad col" style={{ gap: 8 }}>
          {deck.slots.length === 0 ? (
            <div className="empty" style={{ padding: "30px 16px" }}>
              還沒有配裝格。從上面的常用魔靈池按 ＋，或按「新增格子」開始設定。
            </div>
          ) : (
            deck.slots.map((slot, index) => {
              const unit = unitOf(slot.unitId);
              const monster = monsterOfUnit(unit);
              const result = deck.results[slot.id];
              const slotSpeed = rtaSpeedOf(slot);
              const open = openSlots.has(slot.id);
              const sets = result ? setsOf(result.runeIds.map((id) => runeMap.get(id)).filter((r): r is Rune => !!r)) : {};
              return (
                <div key={slot.id} className={`rta-deck-slot ${open ? "open" : ""}`}>
                  <div className="rta-deck-slot-head">
                    <span className="build-rank">{index + 1}</span>
                    <button type="button" className="rta-deck-unit" onClick={() => setPickerSlotId(slot.id)}>
                      {monster ? <MonsterIcon id={monster.id} size={34} /> : <span className="rta-deck-empty-icon"><Plus size={14} /></span>}
                      <span className="col" style={{ gap: 0, minWidth: 0 }}>
                        <b style={{ fontSize: 12.5 }}>{labelOf(unit)}</b>
                        <span className="tiny dim">
                          {unit && monster
                            ? `${ELEMENTS[monster.el as 1]?.name ?? ""} · ${unit.stars}★ Lv.${unit.level} · 基礎 ${monster.spd} 速`
                            : "點擊選擇魔靈"}
                        </span>
                      </span>
                    </button>

                    <span className="rta-deck-summary tiny dim">
                      {slot.set4 > 0
                        ? `${setLabel(slot.set4)} 4 + ${setLabel(slot.set2)} 2`
                        : [slot.set2, slot.set2b, slot.set2c].filter((s) => s > 0).map(setLabel).join(" + ") || "未指定套裝"}
                      {" · "}
                      主屬 {[2, 4, 6].map((n) => (deckSlotMains(slot)[n]?.map((v) => RTA_MAIN_OPTIONS[n as 2 | 4 | 6].find((o) => o.v === v)?.label ?? "?").join(" / ") ?? "不限")).join(" · ")}
                      {Object.keys(slot.min).length > 0 && ` · 下限 ${Object.entries(slot.min).map(([k, v]) => `${MIN_LABEL[k as StatKey]} ${v}`).join("、")}`}
                    </span>

                    <span className="rta-deck-speed">
                      {slotSpeed ? (
                        <>
                          <b className="mono gold">{slotSpeed.battleSpd}</b>
                          <span className="tiny dim">速</span>
                          <TickBadge spd={slotSpeed.battleSpd} rta />
                          <span className="tiny dim">
                            {result
                              ? `效率 ${Math.round(result.eff * 10) / 10}% · ${OBJECTIVE_LABEL[result.objective] ?? result.objective}`
                              : "目前 RTA 配裝"}
                          </span>
                        </>
                      ) : (
                        <span className="tiny dim">尚未配符</span>
                      )}
                    </span>

                    <span className="row" style={{ gap: 4 }}>
                      <label className="row tiny" style={{ gap: 4, cursor: "pointer" }} title="是否列入速度順序">
                        <input
                          type="checkbox"
                          checked={slot.inOrder}
                          onChange={(e) => updateSlot(slot.id, { inOrder: e.target.checked })}
                        />
                        順序
                      </label>
                      {result && (
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setResultSlotId(slot.id)}>
                          配裝
                        </button>
                      )}
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => toggleSlotOpen(slot.id)}>
                        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />} 設定
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeSlot(slot.id)} title="刪除這個配裝格">
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </div>

                  {open && (
                    <div className="rta-deck-config">
                      <div className="rta-deck-config-grid">
                        <div className="field">
                          <label>定位</label>
                          <select className="select" value={slot.role} onChange={(e) => setRole(slot, e.target.value as TeamRole)}>
                            {ROLE_OPTIONS.map((r) => (
                              <option key={r} value={r}>{TEAM_ROLE_LABELS[r]}</option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label>評分權重</label>
                          <NumberInput className="input mono" min={1} max={10} value={slot.weight} onChange={(v) => updateSlot(slot.id, { weight: v })} />
                        </div>
                        <div className="field">
                          <label>與前一隻速度差</label>
                          <div style={{ position: "relative" }}>
                            <NumberInput className="input mono" min={0} max={999} value={slot.gap} onChange={(v) => updateSlot(slot.id, { gap: v })} style={{ paddingRight: 26 }} />
                            <span style={{ position: "absolute", right: 9, top: 9, fontSize: 11, color: "var(--muted-2)" }}>速</span>
                          </div>
                        </div>
                      </div>

                      <div className="rta-deck-block">
                        <div className="tiny dim" style={{ marginBottom: 4 }}>套裝</div>
                        <div className="rta-deck-sets">
                          <select className="select" value={slot.set4} onChange={(e) => updateSlot(slot.id, { set4: Number(e.target.value) })}>
                            <option value={0}>4 件套：不指定</option>
                            {FOUR_SETS.map((s) => <option key={s.id} value={s.id}>{s.name}（4）</option>)}
                          </select>
                          {slot.set4 > 0 ? (
                            <select className="select" value={slot.set2} onChange={(e) => updateSlot(slot.id, { set2: Number(e.target.value) })}>
                              <option value={0}>2 件套：不指定</option>
                              {TWO_SETS.map((s) => <option key={s.id} value={s.id}>{s.name}（2）</option>)}
                            </select>
                          ) : (
                            <>
                              <select className="select" value={slot.set2} onChange={(e) => updateSlot(slot.id, { set2: Number(e.target.value) })}>
                                <option value={0}>2 件套 A：不指定</option>
                                {TWO_SETS.map((s) => <option key={s.id} value={s.id}>{s.name}（2）</option>)}
                              </select>
                              <select className="select" value={slot.set2b} onChange={(e) => updateSlot(slot.id, { set2b: Number(e.target.value) })}>
                                <option value={0}>2 件套 B：不指定</option>
                                {TWO_SETS.map((s) => <option key={s.id} value={s.id}>{s.name}（2）</option>)}
                              </select>
                              <select className="select" value={slot.set2c} onChange={(e) => updateSlot(slot.id, { set2c: Number(e.target.value) })}>
                                <option value={0}>2 件套 C：不指定</option>
                                {TWO_SETS.map((s) => <option key={s.id} value={s.id}>{s.name}（2）</option>)}
                              </select>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="rta-deck-block">
                        <div className="tiny dim" style={{ marginBottom: 4 }}>2 / 4 / 6 號主屬性（每個位置最多選 2 個）</div>
                        <div className="rta-main-grid">
                          {([2, 4, 6] as const).map((n) => (
                            <div key={n} className="rta-main-row">
                              <span className="rta-main-label">{n} 號</span>
                              <select className="select" value={slot.mains[n]?.[0] ?? 0} onChange={(e) => setMain(slot, n, 0, Number(e.target.value))}>
                                {mainOptionsOf(n).map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                              </select>
                              <select className="select" value={slot.mains[n]?.[1] ?? 0} onChange={(e) => setMain(slot, n, 1, Number(e.target.value))}>
                                <option value={0}>第二選擇：不限</option>
                                {mainOptionsOf(n).filter((o) => o.v !== 0).map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rta-deck-block">
                        <div className="tiny dim" style={{ marginBottom: 4 }}>面板 / 實戰數值下限（0 = 不限；速度下限會和速度順序一起檢查）</div>
                        <div className="rta-min-grid">
                          {STAT_KEYS.map((key) => (
                            <label key={key} className="rta-min-field">
                              <span>{MIN_LABEL[key]}{STAT_META[key].suffix}</span>
                              <NumberInput
                                className="input mono"
                                min={0}
                                max={key === "hp" || key === "atk" || key === "def" ? 1_000_000 : 100_000}
                                value={slot.min[key] ?? 0}
                                onChange={(v) => setMin(slot, key, v)}
                                placeholder="0"
                              />
                            </label>
                          ))}
                        </div>
                      </div>

                      {result && (
                        <div className="rta-deck-result">
                          <div className="row between wrap" style={{ gap: 6 }}>
                            <span className="tiny dim">上次配符結果</span>
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setResultSlotId(slot.id)}>
                              查看符文
                            </button>
                          </div>
                          <div className="row wrap" style={{ gap: 8 }}>
                            <span className="chip muted">速度 <b className="mono">{slotSpeed?.battleSpd ?? result.stats.spd}</b></span>
                            <span className="chip muted">HP <b className="mono">{fmt(result.stats.hp)}</b></span>
                            <span className="chip muted">ATK <b className="mono">{fmt(result.stats.atk)}</b></span>
                            <span className="chip muted">DEF <b className="mono">{fmt(result.stats.def)}</b></span>
                            <span className="chip muted">EHP <b className="mono">{fmt(result.ehp)}</b></span>
                            <span className="chip muted">套裝 {Object.keys(sets).length > 0 ? setSummary(sets) : "—"}</span>
                          </div>
                          {result.notes.length > 0 && (
                            <div className="tiny" style={{ color: "var(--gold)", marginTop: 6 }}>⚠ {result.notes.join(" ")}</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── 魔靈池挑選器 ─────────────────────────── */}
      {poolPicker && (
        <MonsterPickerModal
          title={`選擇常用魔靈（${deck.pool.length} / ${RTA_POOL_MAX}）`}
          entries={allEntries}
          multi
          pickedCount={deck.pool.length}
          footerLeft={`已選 ${deck.pool.length} / ${RTA_POOL_MAX} 隻`}
          onPick={(entry) => {
            const id = Number(entry.key);
            if (Number.isFinite(id)) addPoolUnit(id);
          }}
          onClose={() => setPoolPicker(false)}
        />
      )}

      {/* ── 格子專用挑選器（只能選常用池） ─────── */}
      {pickerSlotId && (
        <MonsterPickerModal
          title="從常用魔靈池選擇"
          entries={poolEntries}
          emptyText="常用魔靈池是空的，請先在「選擇魔靈」加入。"
          onPick={(entry) => {
            const id = Number(entry.key);
            if (Number.isFinite(id)) setSlotUnit(pickerSlotId, id);
          }}
          onClose={() => setPickerSlotId(null)}
        />
      )}

      {/* ── 目前 RTA 配裝明細 ───────────────────── */}
      {detail && (
        <Modal title={`${unitLabel(detail.unit)} · 目前 RTA 配裝`} onClose={() => setDetailUnitId(null)} width={860}>
          <MonsterPanel
            monster={detail.monster}
            base={detail.view.base}
            stats={detail.view.stats}
            stars={detail.unit.stars}
            level={detail.unit.level}
            artifacts={detail.view.artifacts}
            badge={<TickBadge spd={detail.view.stats.spd} rta />}
            name={unitLabel(detail.unit)}
          />
          <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
            <span className="chip gold">{detail.monster.nat}★ 原生</span>
            <span className="chip muted">RTA 獨立配裝</span>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={deck.slots.length >= RTA_SLOTS_MAX || deck.slots.some((s) => s.unitId === detail.unit.id)}
              onClick={() => {
                addSlot(detail.unit.id);
                setDetailUnitId(null);
              }}
            >
              <Plus size={12} /> 加入配裝格
            </button>
          </div>

          <div className="row between" style={{ marginTop: 18, marginBottom: 8 }}>
            <div className="card-title">目前 RTA 符文</div>
            <span className="tiny dim">
              {detail.view.runes.length}/6 ·{" "}
              {detail.view.runes.length > 0 ? setSummary(setsOf(detail.view.runes)) : "未配置"}
            </span>
          </div>
          {detail.view.runes.length === 0 ? (
            <div className="empty tiny">這隻魔靈目前沒有 RTA 符文配置</div>
          ) : (
            <RuneBoard
              runes={detail.view.runes}
              renderRune={(r: Rune) => (
                <RuneCard
                  rune={r}
                  owner={unitLabel(detail.unit)}
                  locked={lockedSet.has(r.id)}
                  excluded={excludedSet.has(r.id)}
                  onToggleLock={() => toggleRuneFlag("locked", r.id)}
                  onToggleExclude={() => toggleRuneFlag("excluded", r.id)}
                />
              )}
            />
          )}

          <div className="row between" style={{ marginTop: 18, marginBottom: 8 }}>
            <div className="card-title">目前 RTA 神器</div>
            <span className="tiny dim">{detail.view.artifacts.length} / 2</span>
          </div>
          {detail.view.artifacts.length === 0 ? (
            <div className="empty tiny">這隻魔靈目前沒有 RTA 神器配置</div>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
              {detail.view.artifacts.map((a: Artifact) => (
                <ArtifactCard key={a.id} artifact={a} owner={unitLabel(detail.unit)} />
              ))}
            </div>
          )}
          <div className="tiny dim" style={{ marginTop: 12, lineHeight: 1.6 }}>
            目前配置來自存檔的 <span className="mono">world_arena_rune_equip_list</span> /{" "}
            <span className="mono">world_arena_artifact_equip_list</span>。RTA Deck 的配符結果只會顯示在這一頁，不會改寫遊戲存檔。
          </div>
        </Modal>
      )}

      {/* ── 配符結果符文明細 ────────────────────── */}
      {detailResult && detailResultSlot && (
        <Modal
          title={`${labelOf(detailResultUnit)} · RTA Deck 配裝結果`}
          onClose={() => setResultSlotId(null)}
          width={860}
        >
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="chip gold">速度 <b className="mono">{detailResultSpeed || detailResult.stats.spd}</b></span>
            <span className="chip muted">HP {fmt(detailResult.stats.hp)}</span>
            <span className="chip muted">ATK {fmt(detailResult.stats.atk)}</span>
            <span className="chip muted">DEF {fmt(detailResult.stats.def)}</span>
            <span className="chip muted">EHP {fmt(detailResult.ehp)}</span>
            <span className="chip muted">效率 {Math.round(detailResult.eff * 10) / 10}%</span>
            <span className="chip muted">套裝 {setSummary(setsOf(detailResultRunes))}</span>
            {detailResult.notes.length > 0 && <span className="chip gold">⚠ {detailResult.notes[0]}</span>}
          </div>
          <div className="row between" style={{ marginTop: 18, marginBottom: 8 }}>
            <div className="card-title">符文</div>
            <span className="tiny dim">{detailResultRunes.length} / 6</span>
          </div>
          {detailResultRunes.length === 0 ? (
            <div className="empty tiny">沒有符文</div>
          ) : (
            <RuneBoard
              runes={detailResultRunes}
              renderRune={(r: Rune) => (
                <RuneCard
                  rune={r}
                  owner={labelOf(detailResultUnit)}
                  locked={lockedSet.has(r.id)}
                  excluded={excludedSet.has(r.id)}
                  onToggleLock={() => toggleRuneFlag("locked", r.id)}
                  onToggleExclude={() => toggleRuneFlag("excluded", r.id)}
                />
              )}
            />
          )}
          <div className="tiny dim" style={{ marginTop: 12, lineHeight: 1.6 }}>
            這是本頁的模擬結果，不會修改遊戲存檔或 RTA 目前配裝。若要實際換裝，請在遊戲中操作。
          </div>
        </Modal>
      )}
    </div>
  );
}
