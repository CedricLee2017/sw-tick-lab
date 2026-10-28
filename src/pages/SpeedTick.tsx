import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Save as SaveIcon, Timer, Trash2, Upload, X, Copy, ArrowRight, Plus } from "lucide-react";
import { ELEMENTS } from "../lib/constants";
import { deckTypeLabel } from "../lib/deckTypes";
import { MONSTERS, MONSTER_MAP, useStore } from "../store";
import { MonsterIcon, Modal } from "../components/ui";
import type { DeckFav, Loadout } from "../store";
import {
  AB_RATES,
  LEAD_PRESETS,
  calcSpeedBlocks,
  simulateAdvanced,
  tickBrackets,
  type AbBoost,
  type ExtraSpeed,
  type SpeedModifier,
  type TickCalcUnit,
} from "../lib/speedTick";

const STORAGE_KEY = "swtick:speedcalc";
const SAVES_KEY = "swtick:speedcalc:saves";
const TICKS = Array.from({ length: 16 }, (_, i) => i);
const MAX_UNITS = 12;

type Tab = "monsters" | "advanced" | "order" | "tickview" | "saves" | "faq";
type SortBy = "added" | "spd" | "spdBuff" | "spdDebuff";

const TABS: { key: Tab; label: string }[] = [
  { key: "monsters", label: "Monsters" },
  { key: "advanced", label: "Advanced" },
  { key: "order", label: "Turn Order" },
  { key: "tickview", label: "Tick View" },
  { key: "saves", label: "Saves" },
  { key: "faq", label: "FAQ" },
];

interface CalcState {
  rate: number;
  totemBlue: number;
  leadBlue: number;
  totemRed: number;
  leadRed: number;
  sortBy: SortBy;
  units: TickCalcUnit[];
  boosts: AbBoost[];
  mods: SpeedModifier[];
  adds: ExtraSpeed[];
}

interface SavedCalc extends CalcState {
  id: string;
  name: string;
  note?: string;
  createdAt: number;
}

let seq = 1;
const uid = (p = "u") => `${p}_${Date.now()}_${seq++}`;

const TEAM = {
  blue: { color: "#8ab4ff", bg: "rgba(110,168,255,.16)", border: "1px solid rgba(110,168,255,.45)" },
  red: { color: "#ff9a9a", bg: "rgba(255,122,122,.16)", border: "1px solid rgba(255,122,122,.45)" },
} as const;

const BRACKET_COLORS: Record<number, string> = {
  11: "#c0392b", 10: "#e8a0a0", 9: "#e8c07d", 8: "#e8d67d", 7: "#7ddc7d",
  6: "#33cc33", 5: "#3a9be0", 4: "#2e6fd0", 3: "#8e7bd8",
};

function defaultUnits(): TickCalcUnit[] {
  return [];
}

function emptyState(): CalcState {
  return {
    rate: 7, totemBlue: 15, leadBlue: 0, totemRed: 15, leadRed: 0, sortBy: "added",
    units: defaultUnits(), boosts: [], mods: [], adds: [],
  };
}

function loadState(): CalcState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const v = JSON.parse(raw) as Partial<CalcState> & { totem?: number; lead?: number };
    const totem = v.totem ?? 15;
    const lead = v.lead ?? 0;
    return {
      rate: v.rate ?? 7,
      totemBlue: v.totemBlue ?? totem,
      leadBlue: v.leadBlue ?? lead,
      totemRed: v.totemRed ?? totem,
      leadRed: v.leadRed ?? lead,
      sortBy: v.sortBy ?? "added",
      units: v.units?.length ? v.units : defaultUnits(),
      boosts: v.boosts ?? [],
      mods: v.mods ?? [],
      adds: v.adds ?? [],
    };
  } catch {
    return emptyState();
  }
}

function loadSaves(): SavedCalc[] {
  try {
    const raw = localStorage.getItem(SAVES_KEY);
    return raw ? (JSON.parse(raw) as SavedCalc[]) : [];
  } catch {
    return [];
  }
}

const numOr0 = (v: string) => Number(v) || 0;
const clampTick = (v: number) => Math.max(0, Math.min(TICKS[TICKS.length - 1], Math.round(v)));

/** 元素篩選按鈕的顏色（與全域 --water / --fire … 一致） */
const EL_COLOR: Record<number, string> = {
  1: "var(--water)", 2: "var(--fire)", 3: "var(--wind)", 4: "var(--light)", 5: "var(--dark)",
};

export default function SpeedTickPage() {
  const runeMap = useStore((s) => s.runeMap);
  const loadouts = useStore((s) => s.loadouts);
  const deckFavs = useStore((s) => s.deckFavs);
  const notify = useStore((s) => s.notify);
  const [init] = useState<CalcState>(loadState);
  const [rate, setRate] = useState(init.rate);
  const [totemBlue, setTotemBlue] = useState(init.totemBlue);
  const [leadBlue, setLeadBlue] = useState(init.leadBlue);
  const [totemRed, setTotemRed] = useState(init.totemRed);
  const [leadRed, setLeadRed] = useState(init.leadRed);
  const [sortBy, setSortBy] = useState<SortBy>(init.sortBy);
  const [units, setUnits] = useState<TickCalcUnit[]>(init.units);
  const [boosts, setBoosts] = useState<AbBoost[]>(init.boosts);
  const [mods, setMods] = useState<SpeedModifier[]>(init.mods);
  const [adds, setAdds] = useState<ExtraSpeed[]>(init.adds);
  const [tab, setTab] = useState<Tab>("monsters");
  const [saves, setSaves] = useState<SavedCalc[]>(loadSaves);
  const [saveName, setSaveName] = useState("");
  const [saveNote, setSaveNote] = useState("");
  const [q, setQ] = useState("");
  const [loadOpen, setLoadOpen] = useState(false);
  // 手動新增：先開魔靈選擇視窗（可搜尋 / 依元素與胎生星級縮小範圍）
  const [pickOpen, setPickOpen] = useState(false);
  const [pickQ, setPickQ] = useState("");
  const [pickEl, setPickEl] = useState(0);
  const [pickNat, setPickNat] = useState(0);
  const [pickAwake, setPickAwake] = useState(false);
  const [pickedCount, setPickedCount] = useState(0);
  const [lastPicked, setLastPicked] = useState("");
  const [boostModal, setBoostModal] = useState<{
    team: "blue" | "red";
    from: number;
    to: number;
    mode: "increase" | "decrease" | "clear" | "fill";
    amount: number;
  } | null>(null);

  useEffect(() => {
    const state: CalcState = { rate, totemBlue, leadBlue, totemRed, leadRed, sortBy, units, boosts, mods, adds };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* 忽略儲存失敗 */
    }
  }, [rate, totemBlue, leadBlue, totemRed, leadRed, sortBy, units, boosts, mods, adds]);

  useEffect(() => {
    try {
      localStorage.setItem(SAVES_KEY, JSON.stringify(saves));
    } catch {
      /* 忽略儲存失敗 */
    }
  }, [saves]);

  const ctxOf = (u: TickCalcUnit) => ({
    totem: u.team === "blue" ? totemBlue : totemRed,
    lead: u.leadOverride ?? (u.team === "blue" ? leadBlue : leadRed),
  });

  const blocksOf = (u: TickCalcUnit) => calcSpeedBlocks(u, ctxOf(u));
  const speedOf = (u: TickCalcUnit) => {
    const b = blocksOf(u);
    return u.buff ? b.buffed : b.normal;
  };

  const ordered = useMemo(() => {
    const arr = units.map((u, i) => ({ u, i, spd: speedOf(u), b: blocksOf(u) }));
    if (sortBy === "spd") arr.sort((a, b) => b.b.normal - a.b.normal);
    if (sortBy === "spdBuff") arr.sort((a, b) => b.b.buffed - a.b.buffed);
    if (sortBy === "spdDebuff") arr.sort((a, b) => b.b.debuffed - a.b.debuffed);
    if (sortBy === "added") arr.sort((a, b) => a.i - b.i);
    return arr;
  }, [units, totemBlue, leadBlue, totemRed, leadRed, sortBy]);

  const simUnits = useMemo(
    () =>
      units.map((u, i) => ({
        id: u.id,
        name: u.name || `魔靈 ${i + 1}`,
        spd: speedOf(u),
        team: u.team,
        priority: u.priority ?? i + 1,
      })),
    [units, totemBlue, leadBlue, totemRed, leadRed],
  );

  const { events, frames } = useMemo(
    () => simulateAdvanced(simUnits, rate, { boosts, mods, adds }, 40, 16),
    [simUnits, rate, boosts, mods, adds],
  );

  const orderSim = useMemo(
    () => simulateAdvanced(simUnits, rate, { boosts, mods, adds }, 40, 500),
    [simUnits, rate, boosts, mods, adds],
  );

  const frameMap = useMemo(() => new Map(frames.map((f) => [f.tick, f])), [frames]);
  const orderFrameMap = useMemo(() => new Map(orderSim.frames.map((f) => [f.tick, f])), [orderSim]);
  const brackets = useMemo(() => tickBrackets(rate, 12), [rate]);
  const activeRate = AB_RATES.find((r) => r.rate === rate);

  /** 距離下一個 Tick 門檻還差多少速度（SWGT 的 To Next Tick） */
  const gapToNextTick = (spd: number) => {
    const above = brackets
      .filter((b) => b.tick >= 3 && b.tick <= 11)
      .map((b) => b.minSpeed)
      .filter((v) => v > spd)
      .sort((a, b) => a - b);
    return above.length ? above[0] - spd : 0;
  };

  const update = (id: string, patch: Partial<TickCalcUnit>) =>
    setUnits((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));

  const removeUnit = (id: string) => {
    setUnits((prev) => prev.filter((u) => u.id !== id));
    setBoosts((prev) => prev.filter((x) => x.unitId !== id));
    setMods((prev) => prev.filter((x) => x.unitId !== id));
    setAdds((prev) => prev.filter((x) => x.unitId !== id));
  };

  const addMonster = (id: number) => {
    const m = MONSTER_MAP.get(id);
    setUnits((prev) => {
      if (prev.length >= MAX_UNITS) return prev;
      return [
        ...prev,
        {
          id: uid(),
          name: m?.name ?? "新魔靈",
          monsterId: id,
          baseSpd: m?.spd ?? 100,
          runeSpd: 0,
          swift: false,
          buff: false,
          artifactPct: 0,
          team: "blue",
          priority: prev.length + 1,
        },
      ];
    });
    setQ("");
  };

  const openPicker = () => {
    if (units.length >= MAX_UNITS) return notify(`最多只能加入 ${MAX_UNITS} 隻魔靈`, "err");
    setPickedCount(0);
    setLastPicked("");
    setPickQ("");
    setPickEl(0);
    setPickNat(0);
    setPickAwake(false);
    setPickOpen(true);
  };

  /** 魔靈選擇視窗的清單：依元素 / 胎生星級 / 關鍵字篩選，高星級優先 */
  const pickList = useMemo(() => {
    const term = pickQ.trim().toLowerCase();
    const el = ELEMENTS[pickEl as 1 | 2 | 3 | 4 | 5];
    return MONSTERS.filter((m) => {
      if (pickEl && m.el !== pickEl) return false;
      if (pickNat && m.nat !== pickNat) return false;
      if (pickAwake && !m.awk) return false;
      if (!term) return true;
      return (
        m.name.toLowerCase().includes(term) ||
        (el?.name ?? "").includes(term) ||
        `${m.nat}★`.includes(term)
      );
    }).sort((a, b) => b.nat - a.nat || b.awk - a.awk || a.name.localeCompare(b.name));
  }, [pickQ, pickEl, pickNat, pickAwake]);

  const addBlank = () => {
    if (units.length >= MAX_UNITS) return;
    setUnits((prev) => [
      ...prev,
      {
        id: uid(), name: `魔靈 ${prev.length + 1}`, monsterId: 0, baseSpd: 100,
        runeSpd: 0, swift: false, buff: false, artifactPct: 0, team: "blue", priority: prev.length + 1,
      },
    ]);
  };

  const copyUnit = (src: TickCalcUnit) => {
    if (units.length >= MAX_UNITS) return;
    setUnits((prev) => [
      ...prev,
      { ...src, id: uid(), priority: Math.max(0, ...prev.map((x) => x.priority)) + 1 },
    ]);
  };

  /** 由符文計算固定速度與迅速套裝 */
  const makeUnit = (master: number, runeIds: number[], team: "blue" | "red"): Omit<TickCalcUnit, "id" | "priority"> => {
    const m = MONSTER_MAP.get(master);
    let runeSpd = 0;
    let swiftCount = 0;
    for (const rid of runeIds) {
      const r = runeMap.get(rid);
      if (!r) continue;
      if (r.set === 3) swiftCount++;
      if (r.main?.t === 8) runeSpd += r.main.v;
      if (r.prefix?.t === 8) runeSpd += r.prefix.v;
      for (const s of r.subs) if (s.t === 8) runeSpd += s.v + (s.g ?? 0);
    }
    return {
      name: m?.name ?? "魔靈",
      monsterId: master,
      baseSpd: m?.spd ?? 100,
      runeSpd,
      swift: swiftCount >= 4,
      buff: false,
      artifactPct: 0,
      leadOverride: null,
      team,
    };
  };

  const appendUnits = (list: Omit<TickCalcUnit, "id" | "priority">[]) => {
    const room = MAX_UNITS - units.length;
    const take = list.slice(0, Math.max(0, room));
    if (!take.length) return 0;
    setUnits((prev) => {
      const start = Math.max(0, ...prev.map((p) => p.priority));
      return [...prev, ...take.map((u, i) => ({ ...u, id: uid(), priority: start + i + 1 }))];
    });
    return take.length;
  };

  const addLoadout = (l: Loadout) => {
    const n = appendUnits([makeUnit(l.monsterId, l.runeIds, "blue")]);
    if (n === 0) notify(`最多 ${MAX_UNITS} 隻魔靈`, "err");
    else notify(`已加入 ${MONSTER_MAP.get(l.monsterId)?.name ?? "魔靈"}（攻擊方）`);
  };

  const addDeckFav = (d: DeckFav) => {
    const team: "blue" | "red" = d.type >= 100 ? "red" : "blue";
    const n = appendUnits(d.units.map((u) => makeUnit(u.master, u.runeIds, team)));
    if (n === 0) notify(`最多 ${MAX_UNITS} 隻魔靈`, "err");
    else notify(`已加入 ${n} 隻（${team === "blue" ? "攻擊方" : "防守方"}）`);
  };

  const resetAll = () => {
    const s = emptyState();
    setRate(s.rate);
    setTotemBlue(s.totemBlue);
    setLeadBlue(s.leadBlue);
    setTotemRed(s.totemRed);
    setLeadRed(s.leadRed);
    setSortBy(s.sortBy);
    setUnits(s.units);
    setBoosts([]);
    setMods([]);
    setAdds([]);
    setQ("");
  };

  const searchResults = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return MONSTERS.filter((m) => {
      const el = ELEMENTS[m.el as 1]?.name ?? "";
      return m.name.toLowerCase().includes(term) || el.includes(term) || `${m.nat}★`.includes(term);
    }).slice(0, 24);
  }, [q]);

  const saveCurrent = () => {
    const name = saveName.trim() || `設定 ${new Date().toLocaleString("zh-TW")}`;
    const entry: SavedCalc = {
      id: uid("s"), name, note: saveNote.trim() || undefined, createdAt: Date.now(),
      rate, totemBlue, leadBlue, totemRed, leadRed, sortBy, units, boosts, mods, adds,
    };
    setSaves((prev) => [entry, ...prev].slice(0, 40));
    setSaveName("");
    setSaveNote("");
  };

  const loadSave = (s: SavedCalc) => {
    setRate(s.rate);
    setTotemBlue(s.totemBlue);
    setLeadBlue(s.leadBlue);
    setTotemRed(s.totemRed);
    setLeadRed(s.leadRed);
    setSortBy(s.sortBy ?? "added");
    setUnits(s.units);
    setBoosts(s.boosts ?? []);
    setMods(s.mods ?? []);
    setAdds(s.adds ?? []);
    setTab("monsters");
  };

  const setCell = <T extends { id: string; unitId: string; tick: number }>(
    list: T[],
    setter: (v: T[]) => void,
    unitId: string,
    tick: number,
    value: string,
    make: () => T,
    apply: (item: T, v: number) => T,
  ) => {
    const found = list.find((x) => x.unitId === unitId && x.tick === tick);
    if (value === "") {
      if (found) setter(list.filter((x) => x !== found));
      return;
    }
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    if (found) setter(list.map((x) => (x === found ? apply(x, n) : x)));
    else setter([...list, apply(make(), n)]);
  };

  const modsFor = (unitId: string, tick: number) => mods.filter((m) => m.unitId === unitId && m.tick <= tick);

  /** 額外速度可以輸入「20」或「20%」 */
  const setAddCell = (unitId: string, tick: number, raw: string) => {
    const found = adds.find((a) => a.unitId === unitId && a.tick === tick);
    if (raw.trim() === "") {
      if (found) setAdds(adds.filter((a) => a !== found));
      return;
    }
    const pct = raw.includes("%");
    const n = Number(raw.replace("%", "").trim());
    if (!Number.isFinite(n)) return;
    if (found) setAdds(adds.map((a) => (a === found ? { ...a, value: n, mode: pct ? "pct" : "flat" } : a)));
    else setAdds([...adds, { id: uid("a"), unitId, tick, value: n, mode: pct ? "pct" : "flat" }]);
  };

  const openBoostModal = (team: "blue" | "red", tick: number) =>
    setBoostModal({ team, from: tick, to: tick, mode: "clear", amount: 30 });

  /** 套用拉條視窗：一次處理某隊在 Tick 範圍內的拉條 / 清除 / 補到 100% */
  const applyBoostModal = () => {
    if (!boostModal) return;
    const lo = Math.min(boostModal.from, boostModal.to);
    const hi = Math.max(boostModal.from, boostModal.to);
    const team = boostModal.team;
    const targets = units.filter((u) => u.team === team);
    const targetIds = new Set(targets.map((u) => u.id));
    let next = boosts.filter((b) => !(b.tick >= lo && b.tick <= hi && targetIds.has(b.unitId)));

    if (boostModal.mode !== "clear") {
      for (let t = lo; t <= hi; t++) {
        for (const u of targets) {
          if (boostModal.mode === "fill") {
            const cell = frameMap.get(t)?.cells.find((c) => c.unitId === u.id);
            const oldPct = boosts.find((b) => b.unitId === u.id && b.tick === t)?.pct ?? 0;
            const ab = (cell?.ab ?? 0) - oldPct;
            const add = Math.max(0, 100 - ab);
            if (add > 0.05) next.push({ id: uid("b"), unitId: u.id, tick: t, pct: Math.round(add * 100) / 100 });
          } else {
            const pct = boostModal.mode === "increase" ? boostModal.amount : -boostModal.amount;
            next.push({ id: uid("b"), unitId: u.id, tick: t, pct });
          }
        }
      }
    }
    setBoosts(next);
    setBoostModal(null);
  };

  const boostPreview = () => {
    if (!boostModal) return "";
    const lo = Math.min(boostModal.from, boostModal.to);
    const hi = Math.max(boostModal.from, boostModal.to);
    const label = boostModal.team === "blue" ? "藍隊" : "紅隊";
    if (boostModal.mode === "clear") return `將清除${label}在 Tick ${lo} - ${hi} 的攻擊條加成`;
    if (boostModal.mode === "fill") return `將把${label}在 Tick ${lo} - ${hi} 的攻擊條補到 100%`;
    return `將對${label}在 Tick ${lo} - ${hi} ${boostModal.mode === "increase" ? "增加" : "減少"} ${Math.abs(boostModal.amount)}% 攻擊條`;
  };

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 12 }}>
        <div>
          <div className="card-title row" style={{ gap: 7 }}>
            <Timer size={15} className="gold" /> Speed Tick Bracket 計算器
          </div>
          <div className="card-sub">Monsters → Advanced → Turn Order；藍隊＝攻擊方、紅隊＝防守方（參考 SWGT 的 Speed Tick Bracket Calculator）</div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm btn-primary" onClick={() => setLoadOpen(true)}>
            <Upload size={13} /> 從儲存庫載入
          </button>
          <button className="btn btn-sm" onClick={resetAll}><RotateCcw size={13} /> 清除全部</button>
        </div>
      </div>

      <div className="row wrap" style={{ gap: 10, marginBottom: 10 }}>
        <div className="st-setting">
          <div className="tiny" style={{ color: TEAM.blue.color }}>天空圖騰（藍隊・攻擊）</div>
          <select className="select" value={totemBlue} onChange={(e) => setTotemBlue(Number(e.target.value))}>
            {[0, 1, 2, 2.5, 3, 4, 5, 5.5, 6, 7, 8, 8.5, 9, 10, 11, 11.5, 12, 13, 14, 14.5, 15].map((v) => (
              <option key={v} value={v}>Spd +{v}%</option>
            ))}
          </select>
        </div>
        <div className="st-setting">
          <div className="tiny" style={{ color: TEAM.blue.color }}>速度隊長技（藍隊・攻擊）</div>
          <select className="select" value={leadBlue} onChange={(e) => setLeadBlue(Number(e.target.value))}>
            {LEAD_PRESETS.map((v) => <option key={v} value={v}>{v === 0 ? "None" : `${v}%`}</option>)}
          </select>
        </div>
        <div className="st-setting">
          <div className="tiny" style={{ color: TEAM.red.color }}>天空圖騰（紅隊・防守）</div>
          <select className="select" value={totemRed} onChange={(e) => setTotemRed(Number(e.target.value))}>
            {[0, 1, 2, 2.5, 3, 4, 5, 5.5, 6, 7, 8, 8.5, 9, 10, 11, 11.5, 12, 13, 14, 14.5, 15].map((v) => (
              <option key={v} value={v}>Spd +{v}%</option>
            ))}
          </select>
        </div>
        <div className="st-setting">
          <div className="tiny" style={{ color: TEAM.red.color }}>速度隊長技（紅隊・防守）</div>
          <select className="select" value={leadRed} onChange={(e) => setLeadRed(Number(e.target.value))}>
            {LEAD_PRESETS.map((v) => <option key={v} value={v}>{v === 0 ? "None" : `${v}%`}</option>)}
          </select>
        </div>
        <div className="st-setting">
          <div className="tiny">Attack Bar Per Tick</div>
          <select className="select" value={rate} onChange={(e) => setRate(Number(e.target.value))}>
            {AB_RATES.map((r) => <option key={r.rate} value={r.rate}>{r.rate.toFixed(1)}% - {r.label}</option>)}
          </select>
        </div>
        <div className="st-setting">
          <div className="tiny">Sort By</div>
          <select className="select" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
            <option value="added">Added</option>
            <option value="spd">Atk Spd</option>
            <option value="spdBuff">Atk Spd + Buff</option>
            <option value="spdDebuff">Atk Spd - Debuff</option>
          </select>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`tab ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === "monsters" && <span className="st-tab-count">{units.length}</span>}
          </button>
        ))}
      </div>

      {tab === "monsters" && (
        <>
          <div className="st-bracket">
            <div className="st-bracket-row">
              <span className="st-bracket-label">Ticks</span>
              {brackets.slice(2, 11).reverse().map((b) => (
                <span key={b.tick} className="st-bracket-cell" style={{ background: BRACKET_COLORS[b.tick] ?? "#555" }}>{b.tick}</span>
              ))}
            </div>
            <div className="st-bracket-row">
              <span className="st-bracket-label">Speed</span>
              {brackets.slice(2, 11).reverse().map((b) => (
                <span key={b.tick} className="st-bracket-cell" style={{ background: BRACKET_COLORS[b.tick] ?? "#555" }}>{b.minSpeed}</span>
              ))}
            </div>
          </div>

          <div className="st-search-wrap">
            <input
              className="input"
              placeholder="Name, family, or element…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              disabled={units.length >= MAX_UNITS}
            />
            <button className="btn" onClick={openPicker} disabled={units.length >= MAX_UNITS}>手動新增</button>
            {q.trim() && (
              <div className="st-search-results">
                {searchResults.length === 0 && <div className="tiny dim" style={{ padding: 10 }}>找不到魔靈</div>}
                {searchResults.map((m) => (
                  <button key={m.id} type="button" className="st-search-item" onClick={() => addMonster(m.id)}>
                    <MonsterIcon id={m.id} size={26} />
                    <span style={{ flex: 1 }}>{m.name}</span>
                    <span className={`el-${m.el}`} style={{ fontSize: 11 }}>{ELEMENTS[m.el as 1]?.name}</span>
                    <span className="dim tiny">{"★".repeat(m.nat)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="st-cards">
            {ordered.map(({ u }) => {
              const b = blocksOf(u);
              const lead = u.leadOverride ?? (u.team === "blue" ? leadBlue : leadRed);
              const monster = MONSTER_MAP.get(u.monsterId);
              return (
                <div key={u.id} className="st-card" style={{ borderColor: u.team === "blue" ? "rgba(110,168,255,.75)" : "rgba(255,122,122,.75)" }}>
                  <div className="row between" style={{ gap: 6 }}>
                    <div className="row" style={{ gap: 8, minWidth: 0 }}>
                      <MonsterIcon id={u.monsterId} size={46} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name || "—"}</div>
                        <div className="tiny dim">
                          {monster ? `${ELEMENTS[monster.el as 1]?.name} · ★${monster.nat}` : "自訂魔靈"}
                        </div>
                      </div>
                    </div>
                    <div className="row" style={{ gap: 4 }}>
                      <button
                        type="button"
                        className="chip"
                        style={{ ...TEAM[u.team], cursor: "pointer" }}
                        title="切換隊伍（藍＝攻擊方 / 紅＝防守方）"
                        onClick={() => update(u.id, { team: u.team === "blue" ? "red" : "blue" })}
                      >
                        {u.team === "blue" ? "✕" : "○"}
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost btn-icon" title="複製這隻" onClick={() => copyUnit(u)}>
                        <Copy size={12} />
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost btn-icon" title="刪除" onClick={() => removeUnit(u.id)}>
                        <X size={13} />
                      </button>
                    </div>
                  </div>

                  <div className="st-card-grid">
                    <div className="field">
                      <label>Priority</label>
                      <select className="select" value={u.priority} onChange={(e) => update(u.id, { priority: Number(e.target.value) })}>
                        {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>Team</label>
                      <div className="row" style={{ gap: 4 }}>
                        <button
                          type="button"
                          className={`btn btn-sm ${u.team === "blue" ? "btn-primary" : ""}`}
                          style={u.team === "blue" ? undefined : { color: TEAM.blue.color }}
                          title="藍隊（攻擊方）"
                          onClick={() => update(u.id, { team: "blue" })}
                        >
                          藍 攻
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm ${u.team === "red" ? "btn-primary" : ""}`}
                          style={u.team === "red" ? { background: "#b23b3b", borderColor: "#b23b3b" } : { color: TEAM.red.color }}
                          title="紅隊（防守方）"
                          onClick={() => update(u.id, { team: "red" })}
                        >
                          紅 守
                        </button>
                      </div>
                    </div>
                    <div className="field">
                      <label>Swift Set?</label>
                      <div className="row" style={{ gap: 4 }}>
                        <button
                          type="button"
                          className={`btn btn-sm ${u.swift ? "btn-primary" : ""}`}
                          onClick={() => update(u.id, { swift: true })}
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm ${!u.swift ? "btn-primary" : ""}`}
                          onClick={() => update(u.id, { swift: false })}
                        >
                          No
                        </button>
                      </div>
                    </div>
                    <div className="field">
                      <label>Base Speed</label>
                      <input
                        className="input mono"
                        type="number"
                        value={u.baseSpd}
                        onChange={(e) => update(u.id, { baseSpd: numOr0(e.target.value) })}
                      />
                    </div>
                  </div>

                  <div className="field" style={{ marginTop: 8 }}>
                    <label>Speed Lead</label>
                    <select
                      className="select"
                      value={u.leadOverride ?? ""}
                      onChange={(e) => update(u.id, { leadOverride: e.target.value === "" ? null : Number(e.target.value) })}
                    >
                      <option value="">Default ({lead}%)</option>
                      {LEAD_PRESETS.map((v) => <option key={v} value={v}>{v}%</option>)}
                    </select>
                  </div>

                  <div className="st-line">
                    <span>Spd from Runes (+)</span>
                    <input className="input mono" type="number" value={u.runeSpd} onChange={(e) => update(u.id, { runeSpd: numOr0(e.target.value) })} />
                  </div>
                  <div className="st-line">
                    <span>Artifact Spd Buff + %</span>
                    <input className="input mono" type="number" value={u.artifactPct} onChange={(e) => update(u.id, { artifactPct: numOr0(e.target.value) })} />
                  </div>
                  <div className="st-line">
                    <span>Total Speed:</span>
                    <b className="mono" style={{ fontSize: 16 }}>{b.total}</b>
                  </div>

                  <div className="st-blocks">
                    <div className="st-block" style={{ background: "rgba(255,122,122,.16)", borderColor: "rgba(255,122,122,.4)" }}>
                      <div className="row" style={{ gap: 4, justifyContent: "center" }}>
                        <b className="mono">{b.debuffed}</b>
                        <ArrowRight size={11} className="dim" />
                        <span className="mono" style={{ fontSize: 12 }}>{gapToNextTick(b.debuffed)}</span>
                      </div>
                      <small>Atk Spd −</small>
                    </div>
                    <div className="st-block" style={{ background: "rgba(242,198,92,.14)", borderColor: "rgba(242,198,92,.4)" }}>
                      <div className="row" style={{ gap: 4, justifyContent: "center" }}>
                        <b className="mono">{b.normal}</b>
                        <ArrowRight size={11} className="dim" />
                        <span className="mono" style={{ fontSize: 12 }}>{gapToNextTick(b.normal)}</span>
                      </div>
                      <small>Atk Spd</small>
                    </div>
                    <div className="st-block" style={{ background: "rgba(95,191,95,.14)", borderColor: "rgba(95,191,95,.4)" }}>
                      <div className="row" style={{ gap: 4, justifyContent: "center" }}>
                        <b className="mono">{b.buffed}</b>
                        <ArrowRight size={11} className="dim" />
                        <span className="mono" style={{ fontSize: 12 }}>{gapToNextTick(b.buffed)}</span>
                      </div>
                      <small>Atk Spd +</small>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {units.length === 0 && (
            <div className="empty" style={{ padding: "36px 16px" }}>
              <Timer size={32} style={{ opacity: .3, marginBottom: 8 }} />
              <div style={{ fontWeight: 600, color: "var(--text)" }}>還沒有加入魔靈</div>
              <div className="tiny dim" style={{ marginTop: 4 }}>可以從儲存庫的配裝或預設隊一鍵載入（最多 12 隻）</div>
              <div className="row" style={{ gap: 8, marginTop: 12, justifyContent: "center" }}>
                <button className="btn btn-primary" onClick={() => setLoadOpen(true)}>
                  <Upload size={13} /> 從儲存庫載入
                </button>
                <button className="btn" onClick={openPicker}><Plus size={13} /> 手動新增</button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "advanced" && (
        <div className="col" style={{ gap: 12 }}>
          <div className="card card-pad">
            <div className="card-title" style={{ marginBottom: 8 }}>MONSTERS</div>
            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th>Monster</th>
                    <th className="num">Base Speed</th>
                    <th>Speed Lead</th>
                    <th className="num">Spd from Runes (+)</th>
                    <th className="num">Artifact Spd Buff + %</th>
                    <th className="num">Total Speed</th>
                    <th className="num">Final Speed</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map(({ u }) => {
                    const b = blocksOf(u);
                    const lead = u.leadOverride ?? (u.team === "blue" ? leadBlue : leadRed);
                    return (
                      <tr key={u.id}>
                        <td>
                          <span className="row" style={{ gap: 6 }}>
                            <MonsterIcon id={u.monsterId} size={22} />
                            <span style={{ color: TEAM[u.team].color }}>{u.name}</span>
                          </span>
                        </td>
                        <td className="num">
                          <input className="input mono st-cell" type="number" value={u.baseSpd} onChange={(e) => update(u.id, { baseSpd: numOr0(e.target.value) })} />
                        </td>
                        <td>
                          <select
                            className="select"
                            style={{ width: 128, padding: "4px 8px" }}
                            value={u.leadOverride ?? ""}
                            onChange={(e) => update(u.id, { leadOverride: e.target.value === "" ? null : Number(e.target.value) })}
                          >
                            <option value="">Default ({lead}%)</option>
                            {LEAD_PRESETS.map((v) => <option key={v} value={v}>{v}%</option>)}
                          </select>
                        </td>
                        <td className="num">
                          <span className="row" style={{ gap: 3, justifyContent: "flex-end" }}>
                            <button className="btn btn-sm btn-ghost btn-icon" onClick={() => update(u.id, { runeSpd: Math.max(0, u.runeSpd - 1) })}>−</button>
                            <input className="input mono st-cell" type="number" value={u.runeSpd} onChange={(e) => update(u.id, { runeSpd: numOr0(e.target.value) })} />
                            <button className="btn btn-sm btn-ghost btn-icon" onClick={() => update(u.id, { runeSpd: u.runeSpd + 1 })}>+</button>
                          </span>
                        </td>
                        <td className="num">
                          <input className="input mono st-cell" type="number" value={u.artifactPct} onChange={(e) => update(u.id, { artifactPct: numOr0(e.target.value) })} />
                        </td>
                        <td className="num mono">{b.total}</td>
                        <td className="num mono" style={{ fontWeight: 700 }}>{b.normal}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card card-pad">
            <div className="row between" style={{ gap: 8, marginBottom: 6 }}>
              <div className="card-title">TICKS</div>
              <span className="tiny dim">每格為該 Tick 開始時的攻擊條 %（含拉條）</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="table st-matrix" style={{ minWidth: 120 + TICKS.length * 74 }}>
                <thead>
                  <tr>
                    <th>Monster</th>
                    {TICKS.map((t) => <th key={t} className="num">{t}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {ordered.map(({ u }) => (
                    <tr key={u.id}>
                      <td style={{ color: TEAM[u.team].color, whiteSpace: "nowrap" }}>{u.name}</td>
                      {TICKS.map((t) => {
                        const cell = t === 0 ? { ab: 0, acted: false } : frameMap.get(t)?.cells.find((c) => c.unitId === u.id);
                        const ab = cell?.ab ?? 0;
                        return (
                          <td
                            key={t}
                            className="num mono"
                            style={{ background: cell?.acted ? TEAM[u.team].bg : undefined, fontWeight: cell?.acted ? 800 : 400 }}
                          >
                            {t === 0 ? "0.000" : ab.toFixed(3)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card card-pad">
            <div className="row between" style={{ gap: 8, marginBottom: 6 }}>
              <div className="card-title">ATTACK BAR BOOST</div>
              <button className="btn btn-sm" onClick={() => setBoosts([])}>Clear</button>
            </div>
            <div className="tiny dim" style={{ marginBottom: 6 }}>在對應的魔靈 × Tick 格子輸入要增加的攻擊條 %（只在那個 Tick 生效）</div>
            <div style={{ overflowX: "auto" }}>
              <table className="table st-matrix" style={{ minWidth: 120 + TICKS.length * 74 }}>
                <thead>
                  <tr>
                    <th style={{ fontSize: 10 }}>Team</th>
                    {TICKS.map((t) => (
                      <th key={t} style={{ padding: "2px 3px" }}>
                        <div className="row" style={{ gap: 2, justifyContent: "center" }}>
                          <button
                            type="button"
                            className="st-team-btn blue"
                            title={`藍隊拉條工具（Tick ${t}）`}
                            onClick={() => openBoostModal("blue", t)}
                          >
                            藍
                          </button>
                          <button
                            type="button"
                            className="st-team-btn red"
                            title={`紅隊拉條工具（Tick ${t}）`}
                            onClick={() => openBoostModal("red", t)}
                          >
                            紅
                          </button>
                        </div>
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th>Monster</th>
                    {TICKS.map((t) => <th key={t} className="num">{t}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {ordered.map(({ u }) => (
                    <tr key={u.id}>
                      <td style={{ color: TEAM[u.team].color, whiteSpace: "nowrap" }}>{u.name}</td>
                      {TICKS.map((t) => (
                        <td key={t}>
                          <input
                            className="input mono st-cell"
                            type="number"
                            value={boosts.find((b) => b.unitId === u.id && b.tick === t)?.pct ?? ""}
                            onChange={(e) => setCell(boosts, setBoosts, u.id, t, e.target.value, () => ({ id: uid("b"), unitId: u.id, tick: t, pct: 0 }), (item, v) => ({ ...item, pct: v }))}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card card-pad">
            <div className="row between" style={{ gap: 8, marginBottom: 6 }}>
              <div className="card-title">SPEED MODIFIER</div>
              <button className="btn btn-sm" onClick={() => setMods([])}>Clear</button>
            </div>
            <div className="tiny dim" style={{ marginBottom: 6 }}>在對應格輸入速度增減 %（從該 Tick 起持續生效，例如 30 或 -30）</div>
            <div style={{ overflowX: "auto" }}>
              <table className="table st-matrix" style={{ minWidth: 120 + TICKS.length * 74 }}>
                <thead>
                  <tr>
                    <th>Monster</th>
                    {TICKS.map((t) => <th key={t} className="num">{t}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {ordered.map(({ u }) => (
                    <tr key={u.id}>
                      <td style={{ color: TEAM[u.team].color, whiteSpace: "nowrap" }}>{u.name}</td>
                      {TICKS.map((t) => (
                        <td key={t}>
                          <input
                            className="input mono st-cell"
                            type="number"
                            value={mods.find((m) => m.unitId === u.id && m.tick === t)?.pct ?? ""}
                            onChange={(e) => setCell(mods, setMods, u.id, t, e.target.value, () => ({ id: uid("m"), unitId: u.id, tick: t, pct: 0 }), (item, v) => ({ ...item, pct: v }))}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card card-pad">
            <div className="row between" style={{ gap: 8, marginBottom: 6 }}>
              <div className="card-title">ADDITIONAL SPEED</div>
              <button className="btn btn-sm" onClick={() => setAdds([])}>Clear</button>
            </div>
            <div className="tiny dim" style={{ marginBottom: 6 }}>在對應格輸入額外速度（固定值，從該 Tick 起持續生效）</div>
            <div style={{ overflowX: "auto" }}>
              <table className="table st-matrix" style={{ minWidth: 120 + TICKS.length * 74 }}>
                <thead>
                  <tr>
                    <th>Monster</th>
                    {TICKS.map((t) => <th key={t} className="num">{t}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {ordered.map(({ u }) => (
                    <tr key={u.id}>
                      <td style={{ color: TEAM[u.team].color, whiteSpace: "nowrap" }}>{u.name}</td>
                      {TICKS.map((t) => {
                        const a = adds.find((x) => x.unitId === u.id && x.tick === t);
                        return (
                          <td key={t}>
                            <input
                              className="input mono st-cell"
                              type="text"
                              value={a ? (a.mode === "pct" ? `${a.value}%` : `${a.value}`) : ""}
                              onChange={(e) => setAddCell(u.id, t, e.target.value)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "order" && (
        <div className="card card-pad">
          <div className="row between" style={{ gap: 8, marginBottom: 8 }}>
            <div className="card-title">TURN ORDER</div>
            <span className="tiny dim">前 {events.length} 次出手 · 每 Tick {activeRate?.short ?? ""}</span>
          </div>
          {events.length === 0 ? (
            <div className="tiny dim">沒有可模擬的魔靈</div>
          ) : (
            <div className="col" style={{ gap: 6 }}>
              {events.map((e) => {
                const u = units.find((x) => x.id === e.id);
                const frame = orderFrameMap.get(e.tick);
                const cell = frame?.cells.find((c) => c.unitId === e.id);
                const others = frame ? frame.cells.filter((c) => c.unitId !== e.id).map((c) => c.ab) : [];
                const next = others.length ? Math.max(...others) : 0;
                const active = modsFor(e.id, e.tick);
                const extra = adds.filter((a) => a.unitId === e.id && a.tick <= e.tick);
                return (
                  <div key={`${e.turn}-${e.id}`} className="st-order">
                    <div className="st-order-tick" style={{ background: "#2f6fb5" }}>
                      <div className="tiny">Tick</div>
                      <div style={{ fontSize: 20, fontWeight: 800 }}>{e.tick}</div>
                    </div>
                    <div className="row" style={{ gap: 8, flex: 1, minWidth: 0 }}>
                      <MonsterIcon id={u?.monsterId ?? 0} size={36} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: "#9ecbff" }}>{e.name}</div>
                        <div className="tiny dim">{u && MONSTER_MAP.get(u.monsterId) ? `★${MONSTER_MAP.get(u.monsterId)?.nat}` : "自訂"}</div>
                      </div>
                    </div>
                    <div className="tiny dim" style={{ minWidth: 130 }}>
                      {active.length === 0 && extra.length === 0
                        ? "None"
                        : [
                            ...active.map((m) => `Spd ${m.pct > 0 ? "+" : ""}${m.pct}%`),
                            ...extra.map((a) => `Spd +${a.value}`),
                          ].join(" · ")}
                    </div>
                    <div className="num" style={{ minWidth: 90, textAlign: "right" }}>
                      <div className="mono" style={{ color: "#8ab4ff", fontWeight: 800 }}>{(cell?.ab ?? 0).toFixed(3)}</div>
                      <div className="tiny dim">{cell ? (cell.ab - next).toFixed(3) : "0.000"} to next fastest</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "tickview" && (
        <div className="card card-pad">
          <div className="row between" style={{ gap: 8, marginBottom: 8 }}>
            <div className="card-title">TICK VIEW</div>
            <span className="tiny dim">每個 Tick 的攻擊條與出手</span>
          </div>
          <div className="col" style={{ gap: 6 }}>
            {frames.map((f) => (
              <div key={f.tick} className="st-tv-row">
                <div className={`st-tv-tick ${f.cells.some((c) => c.acted) ? "hit" : ""}`}>
                  <div className="tiny">Tick</div>
                  <div style={{ fontSize: 17, fontWeight: 800 }}>{f.tick}</div>
                </div>
                <div className="row wrap" style={{ gap: 8 }}>
                  {[...f.cells].sort((a, b) => b.ab - a.ab).map((c) => {
                    const u = units.find((x) => x.id === c.unitId);
                    const team = u?.team ?? "blue";
                    const pct = Math.max(0, Math.min(100, c.ab));
                    return (
                      <div key={c.unitId} className={`st-tv-mon ${c.acted ? "acted" : ""}`} style={{ opacity: c.acted ? 1 : .72 }}>
                        <MonsterIcon id={u?.monsterId ?? 0} size={38} />
                        <div className="tiny mono" style={{ color: c.acted ? TEAM[team].color : "var(--muted)" }}>{c.ab.toFixed(3)}</div>
                        <div className="st-tv-bar"><span style={{ width: `${pct}%`, background: TEAM[team].color }} /></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {frames.length === 0 && <div className="tiny dim">沒有可模擬的魔靈</div>}
          </div>
        </div>
      )}

      {tab === "saves" && (
        <div className="col" style={{ gap: 12 }}>
          <div className="card card-pad">
            <div className="card-title" style={{ marginBottom: 8 }}>儲存目前設定</div>
            <div className="row wrap" style={{ gap: 8 }}>
              <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="名稱（例如：競技場一速隊）" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
              <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="備註（選填）" value={saveNote} onChange={(e) => setSaveNote(e.target.value)} />
              <button className="btn btn-primary" onClick={saveCurrent}><SaveIcon size={13} /> 儲存</button>
            </div>
          </div>

          <div className="card card-pad">
            <div className="row between" style={{ gap: 8, marginBottom: 8 }}>
              <div className="card-title">已儲存的設定</div>
              <span className="chip gold">{saves.length} 組</span>
            </div>
            {saves.length === 0 ? (
              <div className="tiny dim">還沒有儲存的設定</div>
            ) : (
              <div className="col" style={{ gap: 6 }}>
                {saves.map((s) => (
                  <div key={s.id} className="row between wrap" style={{ gap: 8, padding: "8px 0", borderBottom: "1px solid var(--line-soft)" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{s.name}</div>
                      <div className="tiny dim">
                        {new Date(s.createdAt).toLocaleString("zh-TW")} · {s.units.length} 隻 · 每 Tick {s.rate}%{s.note ? ` · ${s.note}` : ""}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn btn-sm" onClick={() => loadSave(s)}><Upload size={12} /> 讀取</button>
                      <button className="btn btn-sm btn-ghost btn-icon" title="刪除" onClick={() => setSaves((prev) => prev.filter((x) => x.id !== s.id))}><Trash2 size={12} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {loadOpen && (
        <Modal title="從儲存庫載入" onClose={() => setLoadOpen(false)} width={780}>
          <div className="st-modal-sec">
            <div className="row between" style={{ gap: 8 }}>
              <div>
                <div className="st-modal-label">配裝儲存庫</div>
                <div className="tiny dim">單隻魔靈的符文組合；加入後預設為藍隊（攻擊方）</div>
              </div>
              <span className="chip gold">{loadouts.length} 組</span>
            </div>
            {loadouts.length === 0 ? (
              <div className="tiny dim" style={{ marginTop: 8 }}>
                儲存庫還沒有配裝。可以到「配符」結果按「儲存為配裝」，或在「預設隊」的隊伍詳情按「儲存這隻」。
              </div>
            ) : (
              <div className="col" style={{ gap: 6, marginTop: 8 }}>
                {[...loadouts]
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((l) => (
                    <div key={l.id} className="row between" style={{ gap: 8 }}>
                      <div className="row" style={{ gap: 8, minWidth: 0 }}>
                        <MonsterIcon id={l.monsterId} size={30} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>{MONSTER_MAP.get(l.monsterId)?.name ?? l.name}</div>
                          <div className="tiny dim">
                            {l.runeIds.length}/6 符文 · {l.stats?.spd ?? 0} 速 · {new Date(l.createdAt).toLocaleDateString("zh-TW")}
                          </div>
                        </div>
                      </div>
                      <button className="btn btn-sm" disabled={units.length >= MAX_UNITS} onClick={() => addLoadout(l)}>
                        加入
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div className="st-modal-sec">
            <div className="row between" style={{ gap: 8 }}>
              <div>
                <div className="st-modal-label">預設隊儲存庫</div>
                <div className="tiny dim">整隊加入；進攻隊預設藍隊（攻擊）、防守隊預設紅隊（防守）</div>
              </div>
              <span className="chip gold">{deckFavs.length} 組</span>
            </div>
            {deckFavs.length === 0 ? (
              <div className="tiny dim" style={{ marginTop: 8 }}>
                還沒有儲存的預設隊。可以到「預設隊」頁對任何一隊按「儲存整隊」。
              </div>
            ) : (
              <div className="col" style={{ gap: 6, marginTop: 8 }}>
                {[...deckFavs]
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((d) => (
                    <div key={d.id} className="row between" style={{ gap: 8 }}>
                      <div className="row" style={{ gap: 8, minWidth: 0 }}>
                        <div className="row" style={{ gap: 2 }}>
                          {d.units.map((u) => <MonsterIcon key={u.unitId} id={u.master} size={24} />)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>{deckTypeLabel(d.type)} · 第 {d.seq} 隊</div>
                          <div className="tiny dim">
                            {d.units.length} 隻 · {d.type >= 100 ? "防守方（紅隊）" : "攻擊方（藍隊）"}
                            {d.battlePower ? ` · 戰力 ${d.battlePower}` : ""}
                          </div>
                        </div>
                      </div>
                      <button className="btn btn-sm" disabled={units.length >= MAX_UNITS} onClick={() => addDeckFav(d)}>
                        加入整隊
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div className="tiny dim" style={{ lineHeight: 1.6 }}>
            加入後可回到 Monsters 調整隊伍、基礎速度或拉條；最多 12 隻，超過時只會加入剩下的名額。
          </div>
        </Modal>
      )}

      {boostModal && (
        <Modal
          title={`ATTACK BAR BOOST - ${boostModal.team === "blue" ? "藍隊" : "紅隊"}`}
          onClose={() => setBoostModal(null)}
          width={640}
        >
          <div className="st-modal-sec">
            <div className="st-modal-label">TICK RANGE</div>
            <div className="tiny dim">選擇這個調整要套用的 Tick 範圍</div>
            <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
              <span className="tiny dim">From:</span>
              <input
                className="input mono"
                type="number"
                min={0}
                max={TICKS[TICKS.length - 1]}
                value={boostModal.from}
                onChange={(e) => setBoostModal({ ...boostModal, from: clampTick(Number(e.target.value)) })}
                style={{ width: 80 }}
              />
              <span className="tiny dim">To:</span>
              <input
                className="input mono"
                type="number"
                min={0}
                max={TICKS[TICKS.length - 1]}
                value={boostModal.to}
                onChange={(e) => setBoostModal({ ...boostModal, to: clampTick(Number(e.target.value)) })}
                style={{ width: 80 }}
              />
              <button className="btn btn-sm" onClick={() => setBoostModal({ ...boostModal, to: TICKS[TICKS.length - 1] })}>Max</button>
            </div>
            <div className="tiny dim" style={{ marginTop: 6 }}>預設為你按下的 Tick，可以自行調整範圍。</div>
          </div>

          <div className="st-modal-sec">
            <div className="st-modal-label">MODIFIER TYPE</div>
            <div className="st-type-grid">
              {([
                { key: "decrease", icon: "↓", title: "Decrease", sub: "負向拉條" },
                { key: "clear", icon: "✕", title: "Clear", sub: "移除拉條" },
                { key: "increase", icon: "↑", title: "Increase", sub: "正向拉條" },
                { key: "fill", icon: "⟳", title: "Fill to 100%", sub: "自動補滿攻擊條" },
              ] as const).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`st-type ${boostModal.mode === t.key ? "on" : ""}`}
                  onClick={() => setBoostModal({ ...boostModal, mode: t.key })}
                >
                  <div className="st-type-icon">{t.icon}</div>
                  <div className="t">{t.title}</div>
                  <div className="tiny dim">{t.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {(boostModal.mode === "increase" || boostModal.mode === "decrease") && (
            <div className="st-modal-sec">
              <div className="st-modal-label">AMOUNT</div>
              <div className="tiny dim">選擇{boostModal.mode === "increase" ? "增加" : "減少"}的攻擊條 %</div>
              <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                {[10, 15, 20, 25, 30, 40, 50, 100].map((v) => (
                  <button
                    key={v}
                    className={`btn btn-sm ${boostModal.amount === v ? "btn-primary" : ""}`}
                    onClick={() => setBoostModal({ ...boostModal, amount: v })}
                  >
                    {boostModal.mode === "increase" ? "+" : "−"}{v}%
                  </button>
                ))}
                <span className="row" style={{ gap: 4 }}>
                  <span className="tiny dim">Custom:</span>
                  <input
                    className="input mono"
                    type="number"
                    min={1}
                    max={200}
                    value={boostModal.amount}
                    onChange={(e) => setBoostModal({ ...boostModal, amount: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })}
                    style={{ width: 72 }}
                  />
                  <span className="tiny dim">%</span>
                </span>
              </div>
            </div>
          )}

          <div className="st-modal-sec">
            <div className="st-modal-label">PENDING ACTION（預覽）</div>
            <div className="st-pending">{boostPreview()}</div>
          </div>

          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setBoostModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={applyBoostModal}>Set</button>
          </div>
        </Modal>
      )}

      {tab === "faq" && (
        <div className="card card-pad">
          <div className="card-title" style={{ marginBottom: 10 }}>FAQ</div>
          <div className="col" style={{ gap: 12 }}>
            {[
              ["什麼是 Tick？", "遊戲的出手順序由攻擊條決定。每經過一個 Tick，每隻魔靈會依「速度 × 每 Tick 攻擊條 %」增加攻擊條；達到 100% 就能出手，超出的部分會保留。一般為 7%、RTA 為 1.5%、討伐為 4.5%。"],
              ["速度是怎麼算的？", "最終速度 = 基礎速度 + ceil(基礎速度 ×（天空圖騰 + 速度隊長技）%) + 迅速套裝（基礎速度 +25%）+ 符文速度。速度 Buff 為最終速度再 +30%，降速為 -30%。"],
              ["Total Speed 與三段速度的差別？", "Total Speed 是「基礎速度 + 符文速度」，不含圖騰與隊長技；下面的三段速度才是實際戰鬥中降速／一般／Buff 的數值。"],
              ["三段速度後面的小數字是什麼？", "是「距離下一個 Tick 門檻還差多少速度」，也就是要再快多少才能早一個 Tick 出手。"],
              ["出手順序怎麼決定？", "同一個 Tick 內攻擊條高者先出手；攻擊條相同時比 Priority，Priority 相同再比藍隊優先。"],
              ["拉條、速度增減、額外速度何時生效？", "拉條只在指定的那一個 Tick 生效一次；速度增減與額外速度會從指定 Tick 起持續生效。拉條角通常要設定在自己出手後的下一 Tick。"],
              ["快速套用其他人的設定？", "目前可以直接把設定存到 Saves，之後讀取回來；資料只存在這台電腦的瀏覽器。"],
            ].map(([q, a]) => (
              <div key={q}>
                <div style={{ fontWeight: 700, marginBottom: 3 }}>{q}</div>
                <div className="tiny dim" style={{ lineHeight: 1.7 }}>{a}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pickOpen && (
        <Modal title="選擇魔靈" width={980} onClose={() => setPickOpen(false)}>
          <div className="mp-toolbar">
            <input
              autoFocus
              className="input"
              placeholder="搜尋魔靈名稱（英文，例如 Lushen）…"
              value={pickQ}
              onChange={(e) => setPickQ(e.target.value)}
            />
            <div className="mp-filter-row">
              <span className="mp-label">元素</span>
              <button type="button" className={`mp-chip ${pickEl === 0 ? "on" : ""}`} onClick={() => setPickEl(0)}>全部</button>
              {[1, 2, 3, 4, 5].map((el) => (
                <button
                  key={el}
                  type="button"
                  className={`mp-chip ${pickEl === el ? "on" : ""}`}
                  style={{ color: EL_COLOR[el] }}
                  onClick={() => setPickEl(el)}
                >
                  <i className="mp-dot" />
                  {ELEMENTS[el as 1].name}
                </button>
              ))}
            </div>
            <div className="mp-filter-row">
              <span className="mp-label">胎生星級</span>
              <button type="button" className={`mp-chip ${pickNat === 0 ? "on" : ""}`} onClick={() => setPickNat(0)}>全部</button>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" className={`mp-chip ${pickNat === n ? "on" : ""}`} onClick={() => setPickNat(n)}>
                  {n}★
                </button>
              ))}
              <label className="row tiny" style={{ gap: 6, marginLeft: "auto", cursor: "pointer" }}>
                <input type="checkbox" checked={pickAwake} onChange={(e) => setPickAwake(e.target.checked)} />
                只顯示已覺醒
              </label>
            </div>
          </div>

          <div className="mp-count">
            符合 {pickList.length} 隻
            {pickList.length > 0 && " · 點擊即可加入，可連續加入多隻"}
          </div>

          <div className="mp-grid">
            {pickList.map((m) => (
              <button
                key={m.id}
                type="button"
                className="mp-card"
                disabled={units.length >= MAX_UNITS}
                title={`${m.name} · ${ELEMENTS[m.el as 1].name} · ${m.nat}★ · 基礎速度 ${m.spd}`}
                onClick={() => {
                  addMonster(m.id);
                  setPickedCount((c) => c + 1);
                  setLastPicked(m.name);
                }}
              >
                <MonsterIcon id={m.id} size={48} />
                <span className="mp-name">{m.name}</span>
                <span className="mp-meta">
                  <span className={`el-${m.el}`}>{ELEMENTS[m.el as 1].name}</span> · {m.nat}★
                </span>
              </button>
            ))}
            {pickList.length === 0 && (
              <div className="empty" style={{ gridColumn: "1 / -1", padding: "32px 16px" }}>找不到符合條件的魔靈</div>
            )}
          </div>

          <div className="row between" style={{ marginTop: 12, gap: 10 }}>
            <span className="tiny dim">
              已加入 {pickedCount} 隻{lastPicked && `（最近：${lastPicked}）`} · 目前 {units.length}/{MAX_UNITS}
              {units.length >= MAX_UNITS && " · 已達上限"}
            </span>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => { addBlank(); setPickOpen(false); }}
              >
                新增空白自訂魔靈
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setPickOpen(false)}>完成</button>
            </div>
          </div>
        </Modal>
      )}

    </>
  );
}
