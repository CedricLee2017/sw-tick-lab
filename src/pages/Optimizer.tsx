import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowRight, Copy, Loader2, Save, Sparkles, Wand2, Gauge, ChevronDown, Plus, Target, X,
} from "lucide-react";
import { useStore, monsterLabel } from "../store";
import { useSummary } from "../lib/accountStats";
import { MonsterPicker, MonsterIcon, NumberField, RuneCard, StatGrid, TickBadge, Modal, fmt, setColor, statLabel, statSuffix, statText } from "../components/ui";
import { DamagePanel } from "../components/DamagePanel";
import {
  computeSkillDamage, defaultSkill, loadSkillData, skillsForMonster,
  type DamageOptions, type DamageResult, type Skill, type SkillData,
} from "../lib/damage";
import { RUNE_SETS, SET_BY_ID, type StatKey } from "../lib/constants";
import {
  FOCUS_LIMIT, FOCUS_OPTIONS, OBJECTIVE_LABEL, normalizeFocus,
  type Build, type Objective, type OptRequest, type OptResult, maxSpeedBound, scoreOf, speedNeededForTick,
} from "../lib/optimizer";
import { baseStats, setSummary, tickOf } from "../lib/stats";
import type { FocusEntry, Monster, Rune } from "../lib/types";

const FOUR_SETS = RUNE_SETS.filter((s) => s.pieces === 4);
const TWO_SETS = RUNE_SETS.filter((s) => s.pieces === 2 && s.id !== 25 && s.id !== 99);

const focusLabel = (key: StatKey) => FOCUS_OPTIONS.find((o) => o.key === key)?.label ?? key;

/** 結果排序欄位（對應 SWOP 的排序方式） */
type SortKey =
  | "recommended" | "spd" | "hp" | "def" | "atk" | "ehp"
  | "cr" | "cd" | "res" | "acc" | "eff" | "focus" | "dmg";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "recommended", label: "推薦排序" },
  { key: "spd", label: "速度" },
  { key: "hp", label: "體力" },
  { key: "def", label: "防禦" },
  { key: "atk", label: "攻擊" },
  { key: "ehp", label: "有效體力 EHP" },
  { key: "cr", label: "暴擊率" },
  { key: "cd", label: "暴擊傷害" },
  { key: "res", label: "效果抵抗" },
  { key: "acc", label: "效果命中" },
  { key: "eff", label: "符文效率" },
  { key: "focus", label: "焦點契合" },
];

/** 2/4/6 號位可選主屬性（type id 對應 SWEX；固定值與 % 分開選） */
const MAIN_OPTIONS: Record<number, { v: number; label: string }[]> = {
  2: [
    { v: 0, label: "不限（全部納入）" }, { v: 8, label: "速度" },
    { v: 1, label: "固定體力" }, { v: 2, label: "體力%" },
    { v: 3, label: "固定攻擊" }, { v: 4, label: "攻擊%" },
    { v: 5, label: "固定防禦" }, { v: 6, label: "防禦%" },
  ],
  4: [
    { v: 0, label: "不限（全部納入）" }, { v: 9, label: "暴擊率" }, { v: 10, label: "暴擊傷害" },
    { v: 1, label: "固定體力" }, { v: 2, label: "體力%" },
    { v: 3, label: "固定攻擊" }, { v: 4, label: "攻擊%" },
    { v: 5, label: "固定防禦" }, { v: 6, label: "防禦%" },
  ],
  6: [
    { v: 0, label: "不限（全部納入）" },
    { v: 1, label: "固定體力" }, { v: 2, label: "體力%" },
    { v: 3, label: "固定攻擊" }, { v: 4, label: "攻擊%" },
    { v: 5, label: "固定防禦" }, { v: 6, label: "防禦%" },
    { v: 12, label: "效果命中" }, { v: 11, label: "效果抵抗" },
  ],
};

export default function OptimizerPage() {
  const account = useStore((s) => s.account);
  const runeMap = useStore((s) => s.runeMap);
  const settings = useStore((s) => s.settings);
  const bonus = settings.bonus;
  const patchBonus = useStore((s) => s.patchBonus);
  const setFocus = useStore((s) => s.setFocus);
  const focus = settings.focus ?? [];
  const summary = useSummary();
  const rta = settings.rta;
  const saveLoadout = useStore((s) => s.saveLoadout);
  const notify = useStore((s) => s.notify);

  const [monsterId, setMonsterId] = useState(0);
  const [setGroups, setSetGroups] = useState<{ set: number; pieces: number }[]>([
    { set: 0, pieces: 4 },
    { set: 0, pieces: 2 },
  ]);
  const [intangible, setIntangible] = useState(false);
  const [mode, setMode] = useState<"tick" | "speed">("tick");
  const [tick, setTick] = useState(5);
  const [speedTarget, setSpeedTarget] = useState(250);
  const [limits, setLimits] = useState<Partial<Record<StatKey, number>>>({});
  const [objective, setObjective] = useState<Objective>("score");
  const [allowEquipped, setAllowEquipped] = useState(true);
  const [pool, setPool] = useState(settings.pool);
  const [limit, setLimit] = useState(15);
  const [mains, setMains] = useState<Partial<Record<number, number>>>({});
  const [relaxSub, setRelaxSub] = useState(false);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OptResult | null>(null);
  const [openIdx, setOpenIdx] = useState(-1);
  const [planIdx, setPlanIdx] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("recommended");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const [skillData, setSkillData] = useState<SkillData | null>(null);
  const [skillLoading, setSkillLoading] = useState(true);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [dmgOn, setDmgOn] = useState(true);
  const [dmgSkillId, setDmgSkillId] = useState(0);
  const [dmgOpts, setDmgOpts] = useState<DamageOptions>({
    crit: "crit",
    skillUps: true,
    enemyDef: 800,
    enemyMaxHp: 30000,
    enemyHpPct: 100,
    enemySpd: 100,
    selfHpPct: 100,
    atkBuff: 50,
    leadAtk: 0,
    defBreak: false,
    brand: false,
    ignoreDef: false,
    aliveEnemies: 1,
    alliesAlive: 4,
  });
  const patchDmg = (patch: Partial<DamageOptions>) => setDmgOpts((o) => ({ ...o, ...patch }));

  const updateGroup = (i: number, patch: Partial<{ set: number; pieces: number }>) =>
    setSetGroups((gs) =>
      gs.map((g, j) => {
        if (j !== i) return g;
        const next = { ...g, ...patch };
        // 切換件數時，原本的套裝可能不屬於新的件數類別，直接重置
        if (patch.pieces !== undefined && patch.pieces !== g.pieces) next.set = 0;
        // 只允許一個 4 件套
        if (next.pieces === 4 && gs.some((x, k) => k !== i && x.set > 0 && x.pieces >= 4)) {
          next.pieces = 2;
        }
        return next;
      }),
    );
  const removeGroup = (i: number) => setSetGroups((gs) => gs.filter((_, j) => j !== i));
  const addGroup = () => setSetGroups((gs) => (gs.length < 3 ? [...gs, { set: 0, pieces: 2 }] : gs));

  const workerRef = useRef<Worker | null>(null);
  const runId = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    let worker: Worker;
    try {
      worker = new Worker(new URL("../lib/optimizer.worker.ts", import.meta.url), { type: "module" });
    } catch {
      setError("瀏覽器無法啟動配符運算模組，請重新整理頁面或改用 Chrome / Edge。");
      return;
    }
    worker.onerror = (e) => {
      console.error("optimizer worker error", e);
      clearTimer();
      setRunning(false);
      setError("配符運算模組載入失敗（可能是網站剛更新，舊頁面找不到新檔案）。請重新整理頁面再試一次。");
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
    worker.onmessageerror = () => {
      clearTimer();
      setRunning(false);
      setError("配符運算資料傳輸失敗，請重新整理頁面再試一次。");
    };
    workerRef.current = worker;
    return () => {
      clearTimer();
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, []);

  // 換魔靈時，先前的配符結果不屬於新魔靈，直接清空避免誤讀
  useEffect(() => {
    setResult(null);
    setOpenIdx(-1);
    setPlanIdx(-1);
  }, [monsterId]);

  // 從速度實驗室帶入
  useEffect(() => {
    const raw = sessionStorage.getItem("swtick:draft");
    if (!raw) return;
    try {
      const d = JSON.parse(raw) as { monsterId?: number; tick?: number };
      if (d.monsterId) setMonsterId(d.monsterId);
      if (d.tick) { setTick(d.tick); setMode("tick"); }
      sessionStorage.removeItem("swtick:draft");
    } catch { /* ignore */ }
  }, []);

  const boxMonster = useMemo(() => (monsterId ? summary?.views.find((v) => v.monster.id === monsterId) : undefined), [monsterId, summary]);
  const anyMonster: Monster | undefined = boxMonster?.monster;

  /** 只列出帳號內實際擁有的魔靈（同一隻多份只顯示一次） */
  const ownedMonsters = useMemo(() => {
    if (!summary) return [] as Monster[];
    const seen = new Set<number>();
    const out: Monster[] = [];
    for (const v of summary.views) {
      if (seen.has(v.monster.id)) continue;
      seen.add(v.monster.id);
      out.push(v.monster);
    }
    return out;
  }, [summary]);

  // 換帳號或草稿留有已不存在的魔靈時，避免用泛用基礎值計算
  useEffect(() => {
    if (!monsterId || !summary) return;
    if (!summary.views.some((v) => v.monster.id === monsterId)) setMonsterId(0);
  }, [monsterId, summary]);

  const base = useMemo(() => {
    if (boxMonster) return boxMonster.base;
    if (anyMonster) return baseStats(anyMonster, 6, 40);
    return baseStats({ hp: 10000, atk: 700, def: 700, spd: 100, cr: 15, cd: 50, res: 15, acc: 0 } as Monster, 6, 40);
  }, [boxMonster, anyMonster]);

  const tickNeed = useMemo(() => speedNeededForTick(tick, base.spd, bonus, rta), [tick, base.spd, bonus, rta]);
  const targetSpeed = mode === "tick" ? tickNeed.target : speedTarget;

  const required = useMemo(
    () => setGroups.filter((g) => g.set > 0).map((g) => ({ set: g.set, count: g.pieces })),
    [setGroups],
  );
  const totalPieces = required.reduce((s, r) => s + r.count, 0);
  const hasFour = setGroups.some((g) => g.set > 0 && g.pieces >= 4);
  const hasTwo = setGroups.some((g) => g.set > 0 && g.pieces < 4);
  const setConfigValid = totalPieces <= 6;

  // 破套只在「4 件套 + 2 件套」同時存在時有意義
  useEffect(() => {
    if (relaxSub && !(hasFour && hasTwo)) setRelaxSub(false);
  }, [hasFour, hasTwo, relaxSub]);

  const bound = useMemo(
    () =>
      maxSpeedBound({
        base,
        runes: account?.runes ?? [],
        required,
        bonus,
        rta,
        allowEquipped,
        targetUnit: boxMonster?.unit.id ?? 0,
        mainFilters: mains,
        relaxSub,
        intangible,
      }),
    [base, account, required, bonus, rta, allowEquipped, boxMonster, mains, relaxSub, intangible],
  );

  /** 嚴格 4+2 不可能時，破套模式的速度上界（只用來判斷是否值得自動再試） */
  const relaxBound = useMemo(
    () =>
      hasFour && hasTwo && !relaxSub
        ? maxSpeedBound({
            base,
            runes: account?.runes ?? [],
            required,
            bonus,
            rta,
            allowEquipped,
            targetUnit: boxMonster?.unit.id ?? 0,
            mainFilters: mains,
            relaxSub: true,
            intangible,
          })
        : null,
    [base, account, required, bonus, rta, allowEquipped, boxMonster, mains, hasFour, hasTwo, relaxSub, intangible],
  );

  const run = (opts: { relaxOverride?: boolean; auto?: boolean } = {}) => {
    const relax = opts.relaxOverride ?? relaxSub;
    if (!account) return;
    if (!monsterId) return notify("請先選擇魔靈", "err");
    if (!setConfigValid) return notify("套裝件數合計超過 6，請調整套裝", "err");
    if (!workerRef.current) return notify("配符運算模組未就緒，請重新整理頁面再試", "err");
    const canRelax = hasFour && hasTwo && !relax;
    const maxSpeed = Math.max(bound.speed, canRelax && relaxBound ? relaxBound.speed : 0);
    if (!opts.auto && targetSpeed > 0 && maxSpeed < targetSpeed) {
      return notify(
        `目前符文即使全選最高速也只有約 ${maxSpeed} 速（Tick ${tickOf(maxSpeed, rta)}），無法達到 ${targetSpeed} 速。請降低 Tick、放寬套裝或主屬性。`,
        "err",
      );
    }
    // 嚴格 4+2 不夠快，但破套可以達標 → 自動改用破套
    if (!opts.auto && canRelax && relaxBound && bound.speed < targetSpeed && relaxBound.speed >= targetSpeed) {
      notify("嚴格 4+2 速度不足，已自動改用破套模式");
      setRelaxSub(true);
      run({ relaxOverride: true, auto: true });
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    const min: Partial<Record<StatKey, number>> = { ...limits };
    if (targetSpeed > 0) min.spd = targetSpeed;
    for (const k of Object.keys(min) as StatKey[]) if (!min[k] || min[k]! <= 0) delete min[k];

    const req: OptRequest = {
      base,
      runes: account.runes,
      required,
      min,
      max: {},
      objective,
      bonus: { ...bonus, grind: true },
      limit,
      pool,
      allowEquipped,
      targetUnit: boxMonster?.unit.id ?? 0,
      rta,
      maxNodes: 4_000_000,
      mainFilters: mains,
      relaxSub: relax,
      intangible,
      focus: normalizeFocus(focus),
    };
    const id = ++runId.current;
    const t0 = performance.now();
    const w = workerRef.current;
    const onMsg = (e: MessageEvent<{ id: number; res?: OptResult; error?: string }>) => {
      if (e.data.id !== id) return;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      w.removeEventListener("message", onMsg);
      setRunning(false);
      if (e.data.error) setError(e.data.error);
      else if (e.data.res) {
        setResult({ ...e.data.res, ms: Math.round(performance.now() - t0) });
        setOpenIdx(0);
        if (e.data.res.builds.length === 0) {
          if (hasFour && hasTwo && !relax && !opts.auto) {
            notify("嚴格套裝沒有結果，已自動改用破套模式再算一次");
            setRelaxSub(true);
            run({ relaxOverride: true, auto: true });
            return;
          }
          notify("找不到符合條件的配裝，試著放寬條件或增加候選符文", "err");
        }
      }
    };
    w.addEventListener("message", onMsg);
    timerRef.current = window.setTimeout(() => {
      w.removeEventListener("message", onMsg);
      setRunning(false);
      setError("配符運算超過 30 秒，已停止。請降低候選符文數、減少條件，或重新整理頁面再試。");
    }, 30_000);
    try {
      w.postMessage({ id, req });
    } catch (err) {
      w.removeEventListener("message", onMsg);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      setRunning(false);
      setError(`無法啟動配符運算：${String(err)}`);
    }
  };

  // 顯示目前裝備
  const currentStats = boxMonster?.stats;

  // 技能資料只載入一次
  useEffect(() => {
    let alive = true;
    loadSkillData()
      .then((data) => {
        if (!alive) return;
        setSkillData(data);
        setSkillLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setSkillError(String(err?.message ?? err));
        setSkillLoading(false);
      });
    return () => { alive = false; };
  }, []);

  const monsterSkills = useMemo(() => skillsForMonster(skillData, monsterId), [skillData, monsterId]);
  const dmgSkill = useMemo(
    () => monsterSkills.find((s) => s.id === dmgSkillId) ?? defaultSkill(monsterSkills),
    [monsterSkills, dmgSkillId],
  );

  // 換魔靈時自動選一招（優先最後一格）
  useEffect(() => {
    if (monsterSkills.length === 0) {
      if (dmgSkillId !== 0) setDmgSkillId(0);
      return;
    }
    if (!monsterSkills.some((s) => s.id === dmgSkillId)) {
      setDmgSkillId(defaultSkill(monsterSkills)?.id ?? monsterSkills[0].id);
    }
  }, [monsterSkills, dmgSkillId]);

  // 有無視防禦效果的技能預設勾選
  useEffect(() => {
    if (dmgSkill) patchDmg({ ignoreDef: dmgSkill.e.includes(38) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dmgSkill?.id]);

  const damageByBuild = useMemo(() => {
    const map = new Map<Build, DamageResult>();
    if (!result || !dmgOn || !dmgSkill) return map;
    for (const b of result.builds) map.set(b, computeSkillDamage(b.stats, dmgSkill, dmgOpts));
    return map;
  }, [result, dmgOn, dmgSkill, dmgOpts]);

  const sortOptions = useMemo(() => {
    if (!dmgOn || !dmgSkill) return SORT_OPTIONS;
    return [
      SORT_OPTIONS[0],
      { key: "dmg" as SortKey, label: `傷害（${dmgSkill.n}）` },
      ...SORT_OPTIONS.slice(1),
    ];
  }, [dmgOn, dmgSkill]);

  useEffect(() => {
    if (sortKey === "dmg" && (!dmgOn || !dmgSkill)) setSortKey("recommended");
  }, [sortKey, dmgOn, dmgSkill]);

  /** 依使用者選定的數值重新排序（不影響配符運算結果） */
  const sortedBuilds = useMemo<Build[]>(() => {
    if (!result) return [];
    if (sortKey === "recommended") return result.builds;
    const valueOf = (b: Build) => {
      if (sortKey === "eff") return b.eff;
      if (sortKey === "focus") return b.focusFit ?? 0;
      if (sortKey === "dmg") return damageByBuild.get(b)?.total ?? 0;
      return b.stats[sortKey];
    };
    return result.builds
      .map((b, i) => ({ b, i, v: valueOf(b) }))
      .sort((a, z) => {
        const d = z.v - a.v;
        return (sortDir === "desc" ? d : -d) || a.i - z.i;
      })
      .map((x) => x.b);
  }, [result, sortKey, sortDir, damageByBuild]);

  // 換排序時把展開的卡片與配符清單歸零，避免指到別組
  useEffect(() => {
    if (!result) return;
    setOpenIdx(0);
    setPlanIdx(-1);
  }, [sortKey, sortDir, result]);

  // 焦點被清空時，排序欄位不要停在已不存在的選項
  useEffect(() => {
    if (sortKey === "focus" && focus.length === 0) setSortKey("recommended");
  }, [focus.length, sortKey]);

  return (
    <>
      <div className="grid optimizer-grid">
        {/* ── 條件 ── */}
        <div className="card optimizer-side">
          <div className="card-head">
            <div className="card-title">配符條件</div>
            <span className="chip gold"><Sparkles size={11} /> Tick 優先</span>
          </div>
          <div className="card-pad col" style={{ gap: 13 }}>
            <div className="field">
              <label>魔靈</label>
              <MonsterPicker
                value={monsterId}
                onChange={setMonsterId}
                options={account ? ownedMonsters : undefined}
                placeholder={account ? "搜尋帳號內的魔靈…" : "搜尋魔靈（英文名）…"}
              />
              {anyMonster && (
                <div className="row tiny dim" style={{ gap: 6, marginTop: 2 }}>
                  <span>基礎速度 {base.spd}</span>
                  <span>·</span>
                  <span>體力 {fmt(base.hp)}</span>
                  {currentStats && <><span>·</span><span className="green">目前 {currentStats.spd} 速 T{currentStats.tick}</span></>}
                </div>
              )}
            </div>

            <div className="field">
              <label>套裝組合（件數合計 ≤ 6）</label>
              <div className="col" style={{ gap: 6 }}>
                {setGroups.map((g, i) => (
                  <div className="set-group-row" key={i}>
                    <select className="select" style={{ width: 82, flex: "0 0 82px" }} value={g.pieces} onChange={(e) => updateGroup(i, { pieces: Number(e.target.value) })}>
                      <option value={4}>4 件</option>
                      <option value={2}>2 件</option>
                    </select>
                    <select className="select" value={g.set} onChange={(e) => updateGroup(i, { set: Number(e.target.value) })}>
                      <option value={0}>不限</option>
                      {(g.pieces >= 4 ? FOUR_SETS : TWO_SETS).map((s) => (
                        <option key={s.id} value={s.id}>{s.name} {s.en}</option>
                      ))}
                    </select>
                    {setGroups.length > 1 && (
                      <button type="button" className="btn btn-sm btn-ghost btn-icon" title="移除" onClick={() => removeGroup(i)}>
                        <X size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {setGroups.length < 3 && totalPieces <= 4 && (
                <button type="button" className="btn btn-sm btn-ghost" style={{ width: "100%" }} onClick={addGroup}>
                  <Plus size={13} /> 新增 2 件套（3×2 件套）
                </button>
              )}
              {!setConfigValid && (
                <div className="tiny red">套裝件數合計 {totalPieces} 超過 6，請減少套裝。</div>
              )}
              {required.length > 0 && (
                <label className="row tiny" style={{ gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={intangible} onChange={(e) => setIntangible(e.target.checked)} />
                  允許 1 顆無形符文補足套裝
                </label>
              )}
              {hasFour && hasTwo && (
                <label className="row tiny" style={{ gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={relaxSub} onChange={(e) => setRelaxSub(e.target.checked)} />
                  允許破套：2 件套只作優先，不強制剛好 2 件
                </label>
              )}
            </div>

            <div className="field">
              <div className="row between">
                <label>主屬性（可選）</label>
                {Object.keys(mains).length > 0 && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    style={{ padding: "1px 7px", fontSize: 10.5 }}
                    onClick={() => setMains({})}
                  >
                    清除篩選
                  </button>
                )}
              </div>
              <div className="grid g3" style={{ gap: 6 }}>
                {[2, 4, 6].map((slot) => (
                  <select
                    key={slot}
                    className="select"
                    value={mains[slot] ?? 0}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setMains((m) => {
                        const next = { ...m };
                        if (v) next[slot] = v; else delete next[slot];
                        return next;
                      });
                    }}
                  >
                    {MAIN_OPTIONS[slot].map((o) => (
                      <option key={o.v} value={o.v}>#{slot} {o.label}</option>
                    ))}
                  </select>
                ))}
              </div>
              <div className="tiny dim" style={{ lineHeight: 1.5 }}>
                固定值主屬性（例：防禦力 +160）請選「固定…」；選「不限」會納入全部。
              </div>
            </div>

            <div className="divider" />

            <div className="tabs" style={{ width: "100%" }}>
              <button className={`tab ${mode === "tick" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setMode("tick")}><Gauge size={12} /> Tick 目標</button>
              <button className={`tab ${mode === "speed" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setMode("speed")}>面板速度</button>
            </div>

            {mode === "tick" ? (
              <>
                <NumberField label="目標 Tick" value={tick} min={1} max={30} onChange={setTick} />
                <div className="row wrap" style={{ gap: 5 }}>
                  {[4, 5, 6, 7, 8, 9].map((t) => (
                    <button key={t} className={`btn btn-sm ${tick === t ? "btn-primary" : "btn-ghost"}`} onClick={() => setTick(t)}>T{t}</button>
                  ))}
                </div>
                <div className="card" style={{ padding: 10, background: "rgba(242,198,92,.05)", borderColor: "rgba(242,198,92,.22)" }}>
                  <div className="kv"><span className="k">目標總速度</span><span className="v mono gold">{tickNeed.target}</span></div>
                  <div className="kv"><span className="k">建築+隊長+Buff</span><span className="v mono">+{Math.ceil((base.spd * (bonus.towerSpd + bonus.leadSpd + bonus.buffSpd)) / 100)}</span></div>
                  <div className="kv"><span className="k">符文至少需要</span><span className="v mono gold">{tickNeed.runeSpeed} 速</span></div>
                  <div className="kv">
                    <span className="k">目前符文上限</span>
                    <span className={`v mono ${bound.speed < tickNeed.target ? "red" : "green"}`}>
                      {bound.speed} 速 · T{bound.tick}
                    </span>
                  </div>
                </div>
                {bound.speed < tickNeed.target && (
                  <div className="alert warn" style={{ padding: "8px 10px", fontSize: 11.5 }}>
                    <div>
                      以目前符文與套裝，最高約 {bound.speed} 速，無法達到 Tick {tick}（{tickNeed.target} 速）。
                      {relaxBound && relaxBound.speed >= tickNeed.target && " 但開啟破套後可達標。"}
                      {bound.missingSlots.length > 0 && ` 位置 ${bound.missingSlots.join("、")} 沒有可用符文。`}
                    </div>
                    <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => setTick(bound.tick)}>
                        改用 Tick {bound.tick}
                      </button>
                      {relaxBound && relaxBound.speed >= tickNeed.target && (
                        <button className="btn btn-sm btn-primary" onClick={() => setRelaxSub(true)}>
                          開啟破套（可達 {relaxBound.speed} 速）
                        </button>
                      )}
                      {required.length > 0 && (
                        <button className="btn btn-sm btn-ghost" onClick={() => setSetGroups([{ set: 0, pieces: 4 }, { set: 0, pieces: 2 }])}>
                          清除套裝限制
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <NumberField
                label="最低面板速度"
                value={speedTarget}
                min={0}
                max={500}
                onChange={setSpeedTarget}
                hint={`目前符文上限 ${bound.speed} 速（Tick ${bound.tick}）`}
              />
            )}

            <div className="grid g2">
              <NumberField label="速度圖騰 %" value={bonus.towerSpd} onChange={(v) => patchBonus({ towerSpd: v })} min={0} max={20} step={0.5} />
              <NumberField label="隊長技 %" value={bonus.leadSpd} onChange={(v) => patchBonus({ leadSpd: v })} min={0} max={50} />
            </div>
            <NumberField label="速度 Buff %（一般 30）" value={bonus.buffSpd} onChange={(v) => patchBonus({ buffSpd: v })} min={0} max={50} step={5} />

            <div className="divider" />
            <div className="tiny dim">其他面板下限（0 = 不限）</div>
            <div className="grid g2">
              <NumberField label="體力 HP" value={limits.hp ?? 0} onChange={(v) => setLimits((l) => ({ ...l, hp: v }))} step={500} />
              <NumberField label="防禦 DEF" value={limits.def ?? 0} onChange={(v) => setLimits((l) => ({ ...l, def: v }))} step={50} />
              <NumberField label="攻擊 ATK" value={limits.atk ?? 0} onChange={(v) => setLimits((l) => ({ ...l, atk: v }))} step={50} />
              <NumberField label="效果命中 ACC %" value={limits.acc ?? 0} onChange={(v) => setLimits((l) => ({ ...l, acc: v }))} max={100} />
              <NumberField label="效果抵抗 RES %" value={limits.res ?? 0} onChange={(v) => setLimits((l) => ({ ...l, res: v }))} max={100} />
              <NumberField label="暴擊率 CR %" value={limits.cr ?? 0} onChange={(v) => setLimits((l) => ({ ...l, cr: v }))} max={100} />
            </div>

            <div className="field">
              <label>排序目標</label>
              <select className="select" value={objective} onChange={(e) => setObjective(e.target.value as Objective)}>
                {Object.entries(OBJECTIVE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>

            <FocusEditor value={focus} onChange={setFocus} pool={pool} onPoolChange={setPool} />

            <details>
              <summary className="tiny dim" style={{ cursor: "pointer" }}>進階選項</summary>
              <div className="col" style={{ gap: 10, marginTop: 10 }}>
                <label className="row tiny" style={{ gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={allowEquipped} onChange={(e) => setAllowEquipped(e.target.checked)} />
                  允許使用已裝備在其它魔靈的符文
                </label>
                <NumberField label="顯示結果數" value={limit} min={5} max={50} onChange={setLimit} />
                <div className="row tiny dim" style={{ gap: 6 }}>
                  <AlertTriangle size={12} /> 條件越多、候選越多，運算時間越長。
                </div>
              </div>
            </details>

            <div className="optimizer-actions">
              <button className="btn btn-primary" onClick={() => run()} disabled={running || !account || !setConfigValid} style={{ padding: "11px 14px" }}>
                {running ? <><Loader2 size={15} className="spin" /> 運算中…</> : <><Wand2 size={15} /> 開始配符</>}
              </button>
            </div>
          </div>
        </div>

        {/* ── 結果 ── */}
        <div className="col" style={{ gap: 14 }}>
          {!account && <div className="alert warn">請先匯入存檔。</div>}
          {error && (
            <div className="alert err">
              <div>{error}</div>
              <button className="btn btn-sm btn-ghost" style={{ marginTop: 8 }} onClick={() => location.reload()}>
                重新載入頁面
              </button>
            </div>
          )}

          {monsterId > 0 && (
            <DamagePanel
              skills={monsterSkills}
              skill={dmgSkill}
              onSkillChange={setDmgSkillId}
              enabled={dmgOn}
              onEnabledChange={setDmgOn}
              opts={dmgOpts}
              onOptsChange={patchDmg}
              loading={skillLoading}
              error={skillError}
            />
          )}

          {result && (
            <div className="card card-pad">
              <div className="row between wrap" style={{ gap: 10 }}>
                <div>
                  <div className="card-title">找到 {result.builds.length} 組配裝</div>
                  <div className="card-sub">
                    候選 {fmt(result.candidates)} 顆 · 檢查節點 {fmt(result.nodes)} · {result.ms} ms
                    {result.truncated && <span className="red"> · 已達節點上限，結果可能不是最佳</span>}
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {required.length > 0 && required.map((r) => (
                    <span key={r.set} className="chip" style={{ borderColor: setColor(r.set) + "55", color: setColor(r.set) }}>
                      {SET_BY_ID[r.set]?.name} ×{r.count}{relaxSub && r.count < 4 ? "（優先）" : ""}
                    </span>
                  ))}
                  {focus.map((f) => (
                    <span key={f.key} className="chip muted" title="焦點屬性：數值越高越優先進入候選池">
                      <Target size={10} /> {focusLabel(f.key)} ×{f.weight}
                    </span>
                  ))}
                  <span className="chip gold">≥ {targetSpeed} 速</span>
                </div>
              </div>
              <div className="sort-bar">
                <span className="tiny dim">排序</span>
                <select
                  className="select"
                  value={sortKey}
                  onChange={(e) => {
                    setSortKey(e.target.value as SortKey);
                    setSortDir("desc");
                  }}
                >
                  {sortOptions.filter((o) => o.key !== "focus" || focus.length > 0).map((o) => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
                {sortKey !== "recommended" && (
                  <>
                    <div className="tabs">
                      <button type="button" className={`tab ${sortDir === "desc" ? "active" : ""}`} onClick={() => setSortDir("desc")}>
                        高 → 低
                      </button>
                      <button type="button" className={`tab ${sortDir === "asc" ? "active" : ""}`} onClick={() => setSortDir("asc")}>
                        低 → 高
                      </button>
                    </div>
                    <span className="tiny dim">只改變顯示順序，不會重新計算</span>
                  </>
                )}
              </div>
              {result.builds.length === 0 && (
                <div className="alert warn" style={{ marginTop: 10 }}>
                  <div>找不到符合條件的配裝。</div>
                  <div className="tiny" style={{ marginTop: 4 }}>
                    目前符文上限約 {bound.speed} 速（Tick {bound.tick}）；候選 {fmt(result.candidates)} 顆。
                    可嘗試：降低 Tick、把套裝改成「不限」、放寬主屬性/其他下限，或把候選符文數調高。
                  </div>
                </div>
              )}
            </div>
          )}

          {result && sortedBuilds.map((b, i) => (
            <BuildCard
              key={b.runes.map((r) => r?.id ?? 0).join("-") || i}
              index={i}
              build={b}
              rta={rta}
              runeMap={runeMap}
              focus={focus}
              damage={damageByBuild.get(b)}
              damageSkill={dmgSkill}
              ownerOf={(rid) => {
                const u = account?.units.find((x) => x.runes.includes(rid));
                return u ? monsterLabel(u.master) : "";
              }}
              open={openIdx === i}
              onToggle={() => setOpenIdx(openIdx === i ? -1 : i)}
              onSave={() => {
                saveLoadout({
                  name: `${anyMonster?.name ?? "魔靈"} · Tick ${b.stats.tick}`,
                  monsterId,
                  runeIds: b.runes.filter(Boolean).map((r) => r!.id),
                  stats: b.stats,
                });
              }}
              onPlan={() => setPlanIdx(i)}
            />
          ))}

          {!result && !running && (
            <div className="card empty" style={{ padding: "60px 20px" }}>
              <Wand2 size={40} style={{ opacity: .3, marginBottom: 10 }} />
              <div style={{ fontWeight: 600, color: "var(--text)" }}>設定條件後按「開始配符」</div>
              <div className="tiny" style={{ marginTop: 4 }}>
                例：選一隻基礎速度 100 的魔靈 → Tick 5 → 圖騰 15% + 隊長 28% → 系統會算出符文需 143 速
              </div>
            </div>
          )}

          {running && (
            <div className="card empty" style={{ padding: "60px 20px" }}>
              <Loader2 size={34} className="spin" style={{ color: "var(--gold)", marginBottom: 12 }} />
              <div style={{ fontWeight: 600 }}>正在搜尋最佳組合…</div>
              <div className="tiny dim" style={{ marginTop: 4 }}>候選數約 {fmt(pool * 6)} 顆，通常需要 1–3 秒</div>
            </div>
          )}
        </div>
      </div>

      {planIdx >= 0 && planIdx < sortedBuilds.length && (
        <PlanModal
          build={sortedBuilds[planIdx]}
          monsterName={anyMonster?.name ?? "魔靈"}
          ownerOf={(rid) => {
            const u = account?.units.find((x) => x.runes.includes(rid));
            return u ? monsterLabel(u.master) : "";
          }}
          onClose={() => setPlanIdx(-1)}
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spin { animation: spin 1s linear infinite; }`}</style>
    </>
  );
}

function BuildCard({
  build,
  index,
  rta,
  open,
  onToggle,
  onSave,
  onPlan,
  ownerOf,
  runeMap,
  focus,
  damage,
  damageSkill,
}: {
  build: Build;
  index: number;
  rta: boolean;
  open: boolean;
  onToggle: () => void;
  onSave: () => void;
  onPlan: () => void;
  ownerOf: (runeId: number) => string;
  runeMap: Map<number, Rune>;
  focus: FocusEntry[];
  damage?: DamageResult;
  damageSkill?: Skill;
}) {
  const s = build.stats;
  const mainSets = Object.entries(build.sets).sort((a, b) => b[1] - a[1]);
  return (
    <div className="card">
      <div className="card-pad" style={{ cursor: "pointer" }} onClick={onToggle}>
        <div className="build-row">
          <div className={`build-rank ${index === 0 ? "top" : ""}`}>{index + 1}</div>
          <div style={{ minWidth: 0 }}>
            <div className="row wrap" style={{ gap: 6, marginBottom: 5 }}>
              <TickBadge spd={s.spd} rta={rta} />
              <span className="mono gold" style={{ fontWeight: 800 }}>{s.spd} 速</span>
              {mainSets.map(([id, c]) => (
                <span key={id} className="chip" style={{ padding: "1px 7px", fontSize: 10.5, borderColor: setColor(Number(id)) + "55", color: setColor(Number(id)) }}>
                  {SET_BY_ID[Number(id)]?.name}×{c}
                </span>
              ))}
              <span className="dim tiny">效率 {build.eff.toFixed(1)}%</span>
              {focus.length > 0 && build.focusFit !== undefined && (
                <span className="chip muted" style={{ padding: "1px 7px", fontSize: 10.5 }} title="焦點屬性契合度">
                  <Target size={10} /> 焦點 {Math.round(build.focusFit)}%
                </span>
              )}
              {damage && damageSkill && (
                <span className="chip gold" style={{ padding: "1px 7px", fontSize: 10.5 }} title={`S${damageSkill.slot} ${damageSkill.n} · ${damage.hits} 段 · 每段 ${fmt(damage.perHit)}`}>
                  傷害 {fmt(damage.total)}
                </span>
              )}
            </div>
            <div className="row wrap tiny" style={{ gap: 12, color: "var(--muted)" }}>
              <span>HP <b className="mono" style={{ color: "var(--text)" }}>{fmt(s.hp)}</b></span>
              <span>DEF <b className="mono" style={{ color: "var(--text)" }}>{fmt(s.def)}</b></span>
              <span>ATK <b className="mono" style={{ color: "var(--text)" }}>{fmt(s.atk)}</b></span>
              <span>ACC <b className="mono" style={{ color: "var(--text)" }}>{s.acc}%</b></span>
              <span>RES <b className="mono" style={{ color: "var(--text)" }}>{s.res}%</b></span>
              <span>CR <b className="mono" style={{ color: "var(--text)" }}>{s.cr}%</b></span>
              <span>CD <b className="mono" style={{ color: "var(--text)" }}>{s.cd}%</b></span>
              <span>EHP <b className="mono" style={{ color: "var(--text)" }}>{fmt(s.ehp)}</b></span>
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); onSave(); }}><Save size={13} /> 儲存</button>
            <ChevronDown size={16} className="dim" style={{ transform: open ? "rotate(180deg)" : undefined, transition: ".15s" }} />
          </div>
        </div>
      </div>

      {open && (
        <div style={{ borderTop: "1px solid var(--line-soft)", padding: 14 }}>
          <div className="grid g2" style={{ gap: 12, marginBottom: 12 }}>
            <StatGrid stats={s} compact />
            <div className="col" style={{ gap: 6 }}>
              <div className="kv"><span className="k">EHP（有效體力）</span><span className="v mono">{fmt(s.ehp)}</span></div>
              <div className="kv"><span className="k">套裝</span><span className="v">{setSummary(build.sets)}</span></div>
              <div className="kv"><span className="k">綜合評分</span><span className="v mono">{scoreOf(s, build.eff, "score").toFixed(1)}</span></div>
              {damage && damageSkill && (
                <>
                  <div className="kv">
                    <span className="k">技能傷害 · S{damageSkill.slot} {damageSkill.n}</span>
                    <span className="v mono gold">{fmt(damage.total)}</span>
                  </div>
                  <div className="kv">
                    <span className="k">每段 × 段數</span>
                    <span className="v mono">{fmt(damage.perHit)} × {damage.hits}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="rune-wheel-head">
            <span className="rune-wheel-title">符文盤</span>
            <span className="tiny dim">依遊戲位置排列：1 上 → 順時針 2…6</span>
          </div>
          <div className="rune-wheel-wrap">
            <div className="rune-wheel">
              {[1, 2, 3, 4, 5, 6].map((slot) => {
                const r = build.runes[slot - 1] ?? null;
                return (
                  <div className="rune-wheel-cell" data-slot={slot} style={{ gridArea: `rs${slot}` }} key={slot}>
                    {r ? (
                      <RuneCard rune={r} detail owner={ownerOf(r.id) || undefined} />
                    ) : (
                      <div className="rune rune-empty">
                        <div className="rune-top">
                          <span className="rune-set dim">未裝備</span>
                          <span className="rune-slot">#{slot}</span>
                        </div>
                        <div className="tiny dim">這個位置沒有符文</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <button className="btn btn-sm" onClick={onPlan}><ArrowRight size={13} /> 配符清單 / 換符計畫</button>
            <button className="btn btn-sm btn-ghost" onClick={onSave}><Save size={13} /> 儲存為配裝</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PlanModal({
  build,
  monsterName,
  ownerOf,
  onClose,
}: {
  build: Build;
  monsterName: string;
  ownerOf: (runeId: number) => string;
  onClose: () => void;
}) {
  const notify = useStore((s) => s.notify);
  const text = [
    `【${monsterName}】配符清單`,
    `速度 ${build.stats.spd}（Tick ${build.stats.tick}）｜HP ${fmt(build.stats.hp)}｜DEF ${fmt(build.stats.def)}｜ATK ${fmt(build.stats.atk)}｜ACC ${build.stats.acc}%｜CR ${build.stats.cr}%｜CD ${build.stats.cd}%｜EHP ${fmt(build.stats.ehp)}`,
    `套裝：${Object.entries(build.sets).map(([id, c]) => `${SET_BY_ID[Number(id)]?.name}×${c}`).join(" ")}｜平均效率 ${build.eff.toFixed(1)}%`,
    ...build.runes.filter(Boolean).map((r) => {
      const rn = r!;
      const owner = ownerOf(rn.id);
      const subs = rn.subs
        .map((s) => `${statLabel(s.t)}+${s.v + s.g}${statSuffix(s.t)}${s.g > 0 ? `(含精煉+${s.g})` : ""}`)
        .join("、");
      const prefix = rn.prefix?.t ? `｜固有 ${statText(rn.prefix.t, rn.prefix.v)}` : "";
      return [
        `#${rn.slot} ${SET_BY_ID[rn.set]?.name ?? `套裝${rn.set}`} +${rn.level}`,
        `主屬 ${rn.main.t ? statText(rn.main.t, rn.main.v) : "—"}${prefix}`,
        `副屬 ${subs || "—"}`,
        `ID ${rn.id}`,
        `原裝備 ${owner || "未裝備"}`,
        `效率 ${rn.eff.toFixed(0)}%`,
      ].join("｜");
    }),
  ].join("\n");

  return (
    <Modal title={`配符清單 · ${monsterName}`} onClose={onClose} width={780}>
      <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.8, background: "rgba(11,17,32,.6)", padding: 14, borderRadius: 10, border: "1px solid var(--line-soft)" }}>{text}</pre>
      <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button
          className="btn"
          onClick={() => { void navigator.clipboard.writeText(text).then(() => notify("已複製配符清單")); }}
        >
          <Copy size={14} /> 複製
        </button>
        <button className="btn btn-primary" onClick={onClose}>完成</button>
      </div>
    </Modal>
  );
}

/** FOCUS 區塊：最多 5 組屬性 + 比重（對應 SWOP 的 FOCUS / SEARCH DEPTH） */
function FocusEditor({
  value,
  onChange,
  pool,
  onPoolChange,
}: {
  value: FocusEntry[];
  onChange: (v: FocusEntry[]) => void;
  pool: number;
  onPoolChange: (v: number) => void;
}) {
  const used = new Set(value.map((f) => f.key));
  const total = value.reduce((s, f) => s + f.weight, 0);

  const add = () => {
    const next = FOCUS_OPTIONS.find((o) => !used.has(o.key));
    if (!next) return;
    onChange([...value, { key: next.key, weight: 6 }]);
  };

  return (
    <div className="focus-panel">
      <div className="row between" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 6 }}>
          <Target size={13} className="gold" />
          <span className="focus-title">焦點屬性 FOCUS</span>
          <span className="tiny dim">{value.length}/{FOCUS_LIMIT}</span>
        </div>
        {value.length > 0 && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange([])}>清除</button>
        )}
      </div>
      <div className="hint" style={{ lineHeight: 1.5 }}>
        最多 5 組。比重越高，該屬性數值高的符文越優先進入候選池（1 = 輕微、10 = 最優先）。
      </div>
      {value.length === 0 && (
        <div className="tiny dim" style={{ lineHeight: 1.5 }}>
          例：焦點 HP ×8 → 先抽出具高體力副屬性的符文，再從中挑出符合 Tick 的組合。
        </div>
      )}
      {value.map((f, i) => (
        <div className="focus-row" key={f.key}>
          <select
            className="select"
            value={f.key}
            onChange={(e) =>
              onChange(value.map((x, j) => (j === i ? { ...x, key: e.target.value as StatKey } : x)))
            }
          >
            {FOCUS_OPTIONS.map((o) => (
              <option key={o.key} value={o.key} disabled={o.key !== f.key && used.has(o.key)}>{o.label}</option>
            ))}
          </select>
          <input
            className="input mono"
            type="number"
            min={1}
            max={10}
            value={f.weight}
            title="比重 1~10"
            onChange={(e) => {
              const w = Math.max(1, Math.min(10, Math.round(Number(e.target.value) || 1)));
              onChange(value.map((x, j) => (j === i ? { ...x, weight: w } : x)));
            }}
          />
          <button
            type="button"
            className="btn btn-sm btn-ghost btn-icon"
            title="移除"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      {value.length < FOCUS_LIMIT && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={add} style={{ width: "100%" }}>
          <Plus size={13} /> 新增焦點屬性
        </button>
      )}
      {value.length > 0 && (
        <div className="row between tiny dim">
          <span>比重合計 {total}</span>
          <span>數值愈高 → 愈優先被抽入</span>
        </div>
      )}
      <div className="focus-depth">
        <div className="row between">
          <span className="tiny dim">搜尋深度（每個位置候選符文）</span>
          <b className="mono" style={{ fontSize: 11.5 }}>{pool}</b>
        </div>
        <input
          type="range"
          min={8}
          max={40}
          value={pool}
          onChange={(e) => onPoolChange(Number(e.target.value))}
          style={{ width: "100%" }}
        />
        <div className="tiny dim">越大越準，但計算越久</div>
      </div>
    </div>
  );
}
