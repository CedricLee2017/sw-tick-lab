import { useEffect, useMemo, useState } from "react";
import { Plus, RotateCcw, Save as SaveIcon, Timer, Trash2, Upload } from "lucide-react";
import { MONSTER_MAP } from "../store";
import { MonsterPicker, NumberField } from "../components/ui";
import {
  AB_RATES,
  LEAD_PRESETS,
  TOTEM_PRESETS,
  activeSpeed,
  calcUnitSpeeds,
  simulateAdvanced,
  tickBrackets,
  tickFor,
  type AbBoost,
  type ExtraSpeed,
  type SpeedModifier,
  type TickCalcUnit,
} from "../lib/speedTick";

const STORAGE_KEY = "swtick:speedcalc";
const SAVES_KEY = "swtick:speedcalc:saves";

type Tab = "monsters" | "advanced" | "order" | "tickview" | "saves";

interface CalcState {
  rate: number;
  totem: number;
  lead: number;
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

const TABS: { key: Tab; label: string }[] = [
  { key: "monsters", label: "Monsters" },
  { key: "advanced", label: "Advanced" },
  { key: "order", label: "Turn Order" },
  { key: "tickview", label: "Tick View" },
  { key: "saves", label: "Saves" },
];

let seq = 1;
const uid = (p = "u") => `${p}_${Date.now()}_${seq++}`;

function defaultUnits(): TickCalcUnit[] {
  return [
    { id: uid(), name: "藍隊 1", monsterId: 0, baseSpd: 100, runeSpd: 100, swift: true, buff: false, artifactPct: 0, team: "blue", priority: 1 },
    { id: uid(), name: "紅隊 1", monsterId: 0, baseSpd: 100, runeSpd: 0, swift: false, buff: false, artifactPct: 0, team: "red", priority: 2 },
  ];
}

function emptyState(): CalcState {
  return { rate: 7, totem: 15, lead: 0, units: defaultUnits(), boosts: [], mods: [], adds: [] };
}

function loadState(): CalcState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const v = JSON.parse(raw) as Partial<CalcState>;
    return {
      rate: v.rate ?? 7,
      totem: v.totem ?? 15,
      lead: v.lead ?? 0,
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

const TEAM = {
  blue: { color: "#8ab4ff", bg: "rgba(110,168,255,.16)", border: "1px solid rgba(110,168,255,.45)" },
  red: { color: "#ff9a9a", bg: "rgba(255,122,122,.16)", border: "1px solid rgba(255,122,122,.45)" },
} as const;

export default function SpeedTickPage() {
  const [init] = useState<CalcState>(loadState);
  const [rate, setRate] = useState(init.rate);
  const [totem, setTotem] = useState(init.totem);
  const [lead, setLead] = useState(init.lead);
  const [units, setUnits] = useState<TickCalcUnit[]>(init.units);
  const [boosts, setBoosts] = useState<AbBoost[]>(init.boosts);
  const [mods, setMods] = useState<SpeedModifier[]>(init.mods);
  const [adds, setAdds] = useState<ExtraSpeed[]>(init.adds);
  const [tab, setTab] = useState<Tab>("monsters");
  const [saves, setSaves] = useState<SavedCalc[]>(loadSaves);
  const [saveName, setSaveName] = useState("");
  const [saveNote, setSaveNote] = useState("");

  useEffect(() => {
    const state: CalcState = { rate, totem, lead, units, boosts, mods, adds };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* 忽略儲存失敗 */
    }
  }, [rate, totem, lead, units, boosts, mods, adds]);

  useEffect(() => {
    try {
      localStorage.setItem(SAVES_KEY, JSON.stringify(saves));
    } catch {
      /* 忽略儲存失敗 */
    }
  }, [saves]);

  const update = (id: string, patch: Partial<TickCalcUnit>) =>
    setUnits((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));

  const addUnit = () =>
    setUnits((prev) => [
      ...prev,
      {
        id: uid(),
        name: `魔靈 ${prev.length + 1}`,
        monsterId: 0,
        baseSpd: 100,
        runeSpd: 0,
        swift: false,
        buff: false,
        artifactPct: 0,
        team: "blue",
        priority: prev.length + 1,
      },
    ]);

  const removeUnit = (id: string) => {
    setUnits((prev) => prev.filter((u) => u.id !== id));
    setBoosts((prev) => prev.filter((x) => x.unitId !== id));
    setMods((prev) => prev.filter((x) => x.unitId !== id));
    setAdds((prev) => prev.filter((x) => x.unitId !== id));
  };

  const resetAll = () => {
    const s = emptyState();
    setRate(s.rate);
    setTotem(s.totem);
    setLead(s.lead);
    setUnits(s.units);
    setBoosts([]);
    setMods([]);
    setAdds([]);
  };

  const rows = useMemo(
    () =>
      units.map((u, i) => {
        const v = calcUnitSpeeds(u, { totem, lead });
        const spd = u.buff ? v.buffed : v.normal;
        return { u, v, spd, tick: tickFor(spd, rate), name: u.name || `魔靈 ${i + 1}` };
      }),
    [units, totem, lead, rate],
  );

  const simUnits = useMemo(
    () =>
      units.map((u, i) => ({
        id: u.id,
        name: u.name || `魔靈 ${i + 1}`,
        spd: activeSpeed(u, { totem, lead }),
        team: u.team,
        priority: u.priority ?? i + 1,
      })),
    [units, totem, lead],
  );

  const { events, frames } = useMemo(
    () => simulateAdvanced(simUnits, rate, { boosts, mods, adds }, 40, 20),
    [simUnits, rate, boosts, mods, adds],
  );

  const brackets = useMemo(() => tickBrackets(rate, 12), [rate]);
  const activeRate = AB_RATES.find((r) => r.rate === rate);

  const saveCurrent = () => {
    const name = saveName.trim() || `設定 ${new Date().toLocaleString("zh-TW")}`;
    const entry: SavedCalc = {
      id: uid("s"),
      name,
      note: saveNote.trim() || undefined,
      createdAt: Date.now(),
      rate,
      totem,
      lead,
      units,
      boosts,
      mods,
      adds,
    };
    setSaves((prev) => [entry, ...prev].slice(0, 40));
    setSaveName("");
    setSaveNote("");
  };

  const loadSave = (s: SavedCalc) => {
    setRate(s.rate);
    setTotem(s.totem);
    setLead(s.lead);
    setUnits(s.units);
    setBoosts(s.boosts);
    setMods(s.mods);
    setAdds(s.adds);
    setTab("monsters");
  };

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 14 }}>
        <div>
          <div className="card-title row" style={{ gap: 7 }}>
            <Timer size={15} className="gold" /> Speed Tick Bracket 計算器
          </div>
          <div className="card-sub">
            Monsters、Advanced（拉條 / 速度增減 / 額外速度）、Turn Order、Tick View 與 Saves（不需匯入存檔）
          </div>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={resetAll}>
          <RotateCcw size={13} /> 清除全部
        </button>
      </div>

      <div className="card card-pad" style={{ marginBottom: 12 }}>
        <div className="row between wrap" style={{ gap: 8 }}>
          <div>
            <div className="card-title">攻擊條與加成</div>
            <div className="card-sub">{activeRate?.note ?? ""}</div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            {AB_RATES.map((r) => (
              <button
                key={r.rate}
                type="button"
                className={`btn btn-sm ${rate === r.rate ? "btn-primary" : ""}`}
                onClick={() => setRate(r.rate)}
              >
                {r.label} · 每 Tick {r.short}
              </button>
            ))}
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 12 }}>
          <NumberField label="天空圖騰 %" value={totem} min={0} max={15} step={0.5} onChange={setTotem} suffix="%" />
          <NumberField label="速度隊長技 %" value={lead} min={0} max={50} onChange={setLead} suffix="%" />
          <div className="field">
            <label>圖騰快速設定</label>
            <div className="row wrap" style={{ gap: 5 }}>
              {TOTEM_PRESETS.map((v) => (
                <button key={v} type="button" className={`btn btn-sm ${totem === v ? "btn-primary" : ""}`} onClick={() => setTotem(v)}>{v}%</button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>隊長技快速設定</label>
            <div className="row wrap" style={{ gap: 5 }}>
              {LEAD_PRESETS.map((v) => (
                <button key={v} type="button" className={`btn btn-sm ${lead === v ? "btn-primary" : ""}`} onClick={() => setLead(v)}>{v}%</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`tab ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "monsters" && (
        <div className="card card-pad">
          <div className="row between wrap" style={{ gap: 8, marginBottom: 10 }}>
            <div>
              <div className="card-title">Monsters</div>
              <div className="card-sub">最多 12 隻；選魔靈會自動帶入基礎速度，也可以手動輸入</div>
            </div>
            <button className="btn btn-sm btn-primary" onClick={addUnit} disabled={units.length >= 12}>
              <Plus size={13} /> 新增魔靈
            </button>
          </div>

          {units.length === 0 ? (
            <div className="empty" style={{ padding: "26px 10px" }}>
              <Timer size={30} style={{ opacity: .3, marginBottom: 8 }} />
              <div className="tiny dim">還沒有魔靈，按「新增魔靈」開始</div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ minWidth: 940 }}>
                <thead>
                  <tr>
                    <th>隊伍</th>
                    <th>魔靈</th>
                    <th>迅速</th>
                    <th className="num">符文速度</th>
                    <th className="num">神器 Buff</th>
                    <th className="num">速度</th>
                    <th className="num">Tick</th>
                    <th className="num">一般 / Buff / 降速</th>
                    <th className="num">順位</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ u, v, spd, tick }) => (
                    <tr key={u.id}>
                      <td>
                        <button
                          type="button"
                          className="chip"
                          style={{ ...TEAM[u.team], cursor: "pointer" }}
                          onClick={() => update(u.id, { team: u.team === "blue" ? "red" : "blue" })}
                        >
                          {u.team === "blue" ? "藍隊" : "紅隊"}
                        </button>
                      </td>
                      <td style={{ minWidth: 230 }}>
                        <MonsterPicker
                          value={u.monsterId}
                          onChange={(id) => {
                            const m = MONSTER_MAP.get(id);
                            update(u.id, { monsterId: id, name: m?.name ?? u.name, baseSpd: m?.spd ?? u.baseSpd });
                          }}
                          placeholder="選魔靈（帶入速度）"
                        />
                        <div className="row" style={{ gap: 6, marginTop: 6 }}>
                          <span className="tiny dim">基礎</span>
                          <input
                            className="input mono"
                            style={{ width: 70, padding: "4px 8px" }}
                            type="number"
                            value={u.baseSpd}
                            onChange={(e) => update(u.id, { baseSpd: Number(e.target.value) || 0 })}
                          />
                          <button
                            type="button"
                            className={`btn btn-sm ${u.buff ? "btn-primary" : ""}`}
                            onClick={() => update(u.id, { buff: !u.buff })}
                            title="速度 Buff：基礎速度 +30%"
                          >
                            速度Buff
                          </button>
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`btn btn-sm ${u.swift ? "btn-primary" : ""}`}
                          onClick={() => update(u.id, { swift: !u.swift })}
                          title="迅速套裝：基礎速度 +25%"
                        >
                          {u.swift ? "迅速" : "—"}
                        </button>
                      </td>
                      <td className="num">
                        <input
                          className="input mono"
                          style={{ width: 70, padding: "4px 8px", textAlign: "right" }}
                          type="number"
                          value={u.runeSpd}
                          onChange={(e) => update(u.id, { runeSpd: Number(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="num">
                        <input
                          className="input mono"
                          style={{ width: 62, padding: "4px 8px", textAlign: "right" }}
                          type="number"
                          value={u.artifactPct}
                          onChange={(e) => update(u.id, { artifactPct: Number(e.target.value) || 0 })}
                        />
                        <span className="tiny dim"> %</span>
                      </td>
                      <td className="num mono" style={{ fontSize: 18, fontWeight: 800, color: "var(--gold, #f2c65c)" }}>{spd}</td>
                      <td className="num"><span className="tick-badge">T{Number.isFinite(tick) ? tick : "—"}</span></td>
                      <td className="num tiny dim">{v.normal} / {v.buffed} / {v.debuffed}</td>
                      <td className="num">
                        <input
                          className="input mono"
                          style={{ width: 46, padding: "4px 6px", textAlign: "right" }}
                          type="number"
                          value={u.priority}
                          onChange={(e) => update(u.id, { priority: Number(e.target.value) || 1 })}
                        />
                      </td>
                      <td className="num">
                        <button type="button" className="btn btn-sm btn-ghost btn-icon" title="刪除" onClick={() => removeUnit(u.id)}>
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="tiny dim" style={{ marginTop: 10, lineHeight: 1.6 }}>
            速度 = 基礎速度 + ceil(基礎速度 ×（圖騰 + 隊長技）%) + 迅速 + 符文速度。速度 Buff 為基礎速度 +30%，神器「速度 Buff +%」會再放大這個效果。同速度時比「順位」。
          </div>
        </div>
      )}

      {tab === "advanced" && (
        <div className="col" style={{ gap: 12 }}>
          <div className="card card-pad">
            <div className="row between wrap" style={{ gap: 8, marginBottom: 8 }}>
              <div className="card-title">Tick 一覽</div>
              <span className="tiny dim">前 {frames.length} 個 Tick · 綠／紅底代表該 Tick 出手</span>
            </div>
            {units.length === 0 ? (
              <div className="tiny dim">沒有魔靈</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table" style={{ minWidth: 120 + units.length * 88 }}>
                  <thead>
                    <tr>
                      <th>Tick</th>
                      {units.map((u) => (
                        <th key={u.id} className="num" style={{ color: TEAM[u.team].color }}>{u.name || "—"}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {frames.map((f) => (
                      <tr key={f.tick}>
                        <td className="num mono">{f.tick}</td>
                        {f.cells.map((c) => (
                          <td
                            key={c.unitId}
                            className="num mono"
                            style={{
                              color: c.acted ? TEAM[units.find((u) => u.id === c.unitId)?.team ?? "blue"].color : undefined,
                              background: c.acted ? TEAM[units.find((u) => u.id === c.unitId)?.team ?? "blue"].bg : undefined,
                              fontWeight: c.acted ? 800 : 400,
                            }}
                          >
                            {Math.round(c.ab)}%
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card card-pad">
            <div className="row between wrap" style={{ gap: 8, marginBottom: 8 }}>
              <div>
                <div className="card-title">拉條（攻擊條增加）</div>
                <div className="card-sub">在指定 Tick 一次增加攻擊條；拉條角通常要選自己出手後的下一 Tick</div>
              </div>
              <button
                className="btn btn-sm"
                disabled={!units.length}
                onClick={() => setBoosts((prev) => [...prev, { id: uid("b"), unitId: units[0].id, tick: 1, pct: 30 }])}
              >
                <Plus size={12} /> 新增
              </button>
            </div>
            {boosts.length === 0 ? <div className="tiny dim">尚無拉條設定</div> : (
              <div className="col" style={{ gap: 6 }}>
                {boosts.map((b) => (
                  <div key={b.id} className="row wrap" style={{ gap: 6 }}>
                    <select className="select" style={{ width: 150 }} value={b.unitId} onChange={(e) => setBoosts((prev) => prev.map((x) => x.id === b.id ? { ...x, unitId: e.target.value } : x))}>
                      {units.map((u) => <option key={u.id} value={u.id}>{u.name || "—"}</option>)}
                    </select>
                    <span className="tiny dim">在 Tick</span>
                    <input className="input mono" style={{ width: 64, padding: "6px 8px" }} type="number" value={b.tick} onChange={(e) => setBoosts((prev) => prev.map((x) => x.id === b.id ? { ...x, tick: Number(e.target.value) || 1 } : x))} />
                    <span className="tiny dim">增加攻擊條</span>
                    <input className="input mono" style={{ width: 64, padding: "6px 8px" }} type="number" value={b.pct} onChange={(e) => setBoosts((prev) => prev.map((x) => x.id === b.id ? { ...x, pct: Number(e.target.value) || 0 } : x))} />
                    <span className="tiny dim">%</span>
                    <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setBoosts((prev) => prev.filter((x) => x.id !== b.id))}><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card card-pad">
            <div className="row between wrap" style={{ gap: 8, marginBottom: 8 }}>
              <div>
                <div className="card-title">速度增減</div>
                <div className="card-sub">從指定 Tick 起改變速度（例如 +30% 速度 Buff、-30% 降速）</div>
              </div>
              <button
                className="btn btn-sm"
                disabled={!units.length}
                onClick={() => setMods((prev) => [...prev, { id: uid("m"), unitId: units[0].id, tick: 1, pct: 30 }])}
              >
                <Plus size={12} /> 新增
              </button>
            </div>
            {mods.length === 0 ? <div className="tiny dim">尚無速度增減設定</div> : (
              <div className="col" style={{ gap: 6 }}>
                {mods.map((m) => (
                  <div key={m.id} className="row wrap" style={{ gap: 6 }}>
                    <select className="select" style={{ width: 150 }} value={m.unitId} onChange={(e) => setMods((prev) => prev.map((x) => x.id === m.id ? { ...x, unitId: e.target.value } : x))}>
                      {units.map((u) => <option key={u.id} value={u.id}>{u.name || "—"}</option>)}
                    </select>
                    <span className="tiny dim">從 Tick</span>
                    <input className="input mono" style={{ width: 64, padding: "6px 8px" }} type="number" value={m.tick} onChange={(e) => setMods((prev) => prev.map((x) => x.id === m.id ? { ...x, tick: Number(e.target.value) || 1 } : x))} />
                    <span className="tiny dim">速度</span>
                    <input className="input mono" style={{ width: 70, padding: "6px 8px" }} type="number" value={m.pct} onChange={(e) => setMods((prev) => prev.map((x) => x.id === m.id ? { ...x, pct: Number(e.target.value) || 0 } : x))} />
                    <span className="tiny dim">%</span>
                    <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setMods((prev) => prev.filter((x) => x.id !== m.id))}><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card card-pad">
            <div className="row between wrap" style={{ gap: 8, marginBottom: 8 }}>
              <div>
                <div className="card-title">額外速度</div>
                <div className="card-sub">從指定 Tick 起加上固定速度或 %（例如被動、神器效果）</div>
              </div>
              <button
                className="btn btn-sm"
                disabled={!units.length}
                onClick={() => setAdds((prev) => [...prev, { id: uid("a"), unitId: units[0].id, tick: 1, value: 20, mode: "flat" }])}
              >
                <Plus size={12} /> 新增
              </button>
            </div>
            {adds.length === 0 ? <div className="tiny dim">尚無額外速度設定</div> : (
              <div className="col" style={{ gap: 6 }}>
                {adds.map((a) => (
                  <div key={a.id} className="row wrap" style={{ gap: 6 }}>
                    <select className="select" style={{ width: 150 }} value={a.unitId} onChange={(e) => setAdds((prev) => prev.map((x) => x.id === a.id ? { ...x, unitId: e.target.value } : x))}>
                      {units.map((u) => <option key={u.id} value={u.id}>{u.name || "—"}</option>)}
                    </select>
                    <span className="tiny dim">從 Tick</span>
                    <input className="input mono" style={{ width: 64, padding: "6px 8px" }} type="number" value={a.tick} onChange={(e) => setAdds((prev) => prev.map((x) => x.id === a.id ? { ...x, tick: Number(e.target.value) || 1 } : x))} />
                    <input className="input mono" style={{ width: 70, padding: "6px 8px" }} type="number" value={a.value} onChange={(e) => setAdds((prev) => prev.map((x) => x.id === a.id ? { ...x, value: Number(e.target.value) || 0 } : x))} />
                    <select className="select" style={{ width: 80 }} value={a.mode} onChange={(e) => setAdds((prev) => prev.map((x) => x.id === a.id ? { ...x, mode: e.target.value as "flat" | "pct" } : x))}>
                      <option value="flat">固定</option>
                      <option value="pct">%</option>
                    </select>
                    <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setAdds((prev) => prev.filter((x) => x.id !== a.id))}><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "order" && (
        <div className="card card-pad">
          <div className="row between" style={{ gap: 8, marginBottom: 8 }}>
            <div className="card-title">Turn Order</div>
            <span className="tiny dim">前 {events.length} 次出手 · 每 Tick {activeRate?.short ?? ""}</span>
          </div>
          {events.length === 0 ? (
            <div className="tiny dim">沒有可模擬的魔靈</div>
          ) : (
            <div className="col" style={{ gap: 4 }}>
              {events.map((e) => (
                <div key={`${e.turn}-${e.id}`} className="row" style={{ gap: 8 }}>
                  <span className="tiny dim mono" style={{ width: 26, textAlign: "right" }}>{e.turn}</span>
                  <span className="chip gold">T{e.tick}</span>
                  <span className="chip" style={TEAM[e.team]}>{e.name}</span>
                  <span className="mono" style={{ fontWeight: 700 }}>{e.spd}</span>
                  <span className="tiny dim">剩餘攻擊條 {e.ab}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "tickview" && (
        <div className="card card-pad">
          <div className="row between" style={{ gap: 8, marginBottom: 8 }}>
            <div className="card-title">Tick View</div>
            <span className="tiny dim">每個 Tick 的攻擊條與出手</span>
          </div>
          <div className="col" style={{ gap: 7 }}>
            {frames.map((f) => (
              <div key={f.tick} className="row wrap" style={{ gap: 5 }}>
                <span className="chip gold">T{f.tick}</span>
                {[...f.cells]
                  .sort((a, b) => b.ab - a.ab)
                  .map((c) => {
                    const u = units.find((x) => x.id === c.unitId);
                    const team = u?.team ?? "blue";
                    return (
                      <span
                        key={c.unitId}
                        className="chip"
                        style={{ ...TEAM[team], opacity: c.acted ? 1 : .62, fontWeight: c.acted ? 800 : 500 }}
                        title={c.acted ? "這個 Tick 出手" : "尚未出手"}
                      >
                        {u?.name || "—"} {Math.round(c.ab)}%
                      </span>
                    );
                  })}
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

      <div className="card card-pad" style={{ marginTop: 12 }}>
        <div className="row between wrap" style={{ gap: 8, marginBottom: 8 }}>
          <div className="card-title">Tick 速度門檻</div>
          <span className="tiny dim">每 Tick 攻擊條 {activeRate?.short ?? ""} · 最低速度</span>
        </div>
        <div className="tick-row">
          {brackets.map((b) => {
            const hit = rows.some((r) => r.tick === b.tick);
            return (
              <div key={b.tick} className={`tick-cell ${hit ? "hit" : ""}`} title={`${b.minSpeed}${Number.isFinite(b.maxSpeed) ? `–${b.maxSpeed}` : " 以上"} 速度`}>
                <div className="t">{`T${b.tick}`}</div>
                <div className="s">{b.minSpeed}</div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
