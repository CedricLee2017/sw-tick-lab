import { useEffect, useMemo, useState } from "react";
import { Plus, RotateCcw, Timer, Trash2 } from "lucide-react";
import { MONSTER_MAP } from "../store";
import { MonsterPicker, NumberField } from "../components/ui";
import {
  AB_RATES,
  LEAD_PRESETS,
  TOTEM_PRESETS,
  activeSpeed,
  calcUnitSpeeds,
  simulateTickOrder,
  tickBrackets,
  tickFor,
  type TickCalcUnit,
} from "../lib/speedTick";

const STORAGE_KEY = "swtick:speedcalc";

interface Saved {
  rate: number;
  totem: number;
  lead: number;
  units: TickCalcUnit[];
}

let seq = 1;
const uid = () => `u_${Date.now()}_${seq++}`;

function defaultUnits(): TickCalcUnit[] {
  return [
    { id: uid(), name: "藍隊 1", monsterId: 0, baseSpd: 100, runeSpd: 100, swift: true, buff: false, artifactPct: 0, team: "blue", priority: 1 },
    { id: uid(), name: "紅隊 1", monsterId: 0, baseSpd: 100, runeSpd: 0, swift: false, buff: false, artifactPct: 0, team: "red", priority: 2 },
  ];
}

function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

const TEAM_STYLE = {
  blue: { color: "#8ab4ff", border: "1px solid rgba(110,168,255,.5)", background: "rgba(110,168,255,.12)" },
  red: { color: "#ff9a9a", border: "1px solid rgba(255,122,122,.5)", background: "rgba(255,122,122,.12)" },
} as const;

export default function SpeedTickPage() {
  const [saved] = useState<Saved | null>(loadSaved);
  const [rate, setRate] = useState(saved?.rate ?? 7);
  const [totem, setTotem] = useState(saved?.totem ?? 15);
  const [lead, setLead] = useState(saved?.lead ?? 0);
  const [units, setUnits] = useState<TickCalcUnit[]>(saved?.units ?? defaultUnits());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ rate, totem, lead, units }));
    } catch {
      /* 忽略儲存失敗 */
    }
  }, [rate, totem, lead, units]);

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

  const rows = useMemo(
    () =>
      units.map((u, i) => {
        const v = calcUnitSpeeds(u, { totem, lead });
        const spd = u.buff ? v.buffed : v.normal;
        return { u, v, spd, tick: tickFor(spd, rate), name: u.name || `魔靈 ${i + 1}` };
      }),
    [units, totem, lead, rate],
  );

  const order = useMemo(
    () =>
      simulateTickOrder(
        units.map((u, i) => ({
          id: u.id,
          name: u.name || `魔靈 ${i + 1}`,
          spd: activeSpeed(u, { totem, lead }),
          team: u.team,
          priority: u.priority ?? i + 1,
        })),
        rate,
        24,
      ),
    [units, totem, lead, rate],
  );

  const brackets = useMemo(() => tickBrackets(rate, 12), [rate]);
  const activeRate = AB_RATES.find((r) => r.rate === rate);

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 14 }}>
        <div>
          <div className="card-title row" style={{ gap: 7 }}>
            <Timer size={15} className="gold" /> Speed Tick 計算器
          </div>
          <div className="card-sub">
            輸入速度與加成，算出需要幾個 Tick 出手、完整出手順序與各 Tick 的速度門檻（不需匯入存檔）
          </div>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={() => { setRate(7); setTotem(15); setLead(0); setUnits(defaultUnits()); }}>
          <RotateCcw size={13} /> 清除全部
        </button>
      </div>

      <div className="card card-pad" style={{ marginBottom: 14 }}>
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

      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="row between wrap" style={{ gap: 8, marginBottom: 10 }}>
          <div>
            <div className="card-title">魔靈</div>
            <div className="card-sub">最多可加入 12 隻；選魔靈會自動帶入基礎速度，也可以直接手動輸入</div>
          </div>
          <button className="btn btn-sm btn-primary" onClick={addUnit} disabled={units.length >= 12}>
            <Plus size={13} /> 新增魔靈
          </button>
        </div>

        {units.length === 0 ? (
          <div className="empty" style={{ padding: "30px 10px" }}>
            <Timer size={32} style={{ opacity: .3, marginBottom: 8 }} />
            <div className="tiny dim">還沒有魔靈，按「新增魔靈」開始</div>
          </div>
        ) : (
          <div className="col" style={{ gap: 8 }}>
            {rows.map(({ u, v, spd, tick }, i) => (
              <div key={u.id} className="st-row">
                <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
                  <button
                    type="button"
                    className="chip"
                    style={{ ...TEAM_STYLE[u.team], cursor: "pointer" }}
                    title="切換藍隊 / 紅隊"
                    onClick={() => update(u.id, { team: u.team === "blue" ? "red" : "blue" })}
                  >
                    {u.team === "blue" ? "藍隊" : "紅隊"}
                  </button>
                  <div style={{ width: 240, minWidth: 170 }}>
                    <MonsterPicker
                      value={u.monsterId}
                      onChange={(id) => {
                        const m = MONSTER_MAP.get(id);
                        update(u.id, { monsterId: id, name: m?.name ?? u.name, baseSpd: m?.spd ?? u.baseSpd });
                      }}
                      placeholder="選魔靈（帶入速度）"
                    />
                  </div>
                  <span className="tiny dim">速度</span>
                  <span className="mono" style={{ fontSize: 19, fontWeight: 800, color: "var(--gold, #f2c65c)" }}>{spd}</span>
                  <span className="tick-badge" title={`第 ${tick} 個 Tick 出手`}>T{Number.isFinite(tick) ? tick : "—"}</span>
                  <span className="tiny dim">第 {u.priority} 順位</span>
                  <div className="row" style={{ gap: 4, marginLeft: "auto" }}>
                    <button type="button" className="btn btn-sm btn-ghost btn-icon" title="刪除" onClick={() => setUnits((prev) => prev.filter((x) => x.id !== u.id))}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginTop: 8 }}>
                  <NumberField label="基礎速度" value={u.baseSpd} min={0} onChange={(v) => update(u.id, { baseSpd: v })} />
                  <NumberField label="符文速度 +" value={u.runeSpd} min={0} onChange={(v) => update(u.id, { runeSpd: v })} />
                  <NumberField label="神器 Buff +%" value={u.artifactPct} min={0} max={100} onChange={(v) => update(u.id, { artifactPct: v })} suffix="%" />
                  <NumberField label="出手順位" value={u.priority} min={1} max={99} onChange={(v) => update(u.id, { priority: v })} hint="同速度時比這個" />
                  <div className="field">
                    <label>套裝 / Buff</label>
                    <div className="row" style={{ gap: 6 }}>
                      <button
                        type="button"
                        className={`btn btn-sm ${u.swift ? "btn-primary" : ""}`}
                        onClick={() => update(u.id, { swift: !u.swift })}
                        title="迅速套裝：基礎速度 +25%"
                      >
                        迅速
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${u.buff ? "btn-primary" : ""}`}
                        onClick={() => update(u.id, { buff: !u.buff })}
                        title="速度 Buff：基礎速度 +30%"
                      >
                        速度Buff
                      </button>
                    </div>
                  </div>
                </div>

                <div className="row wrap tiny dim" style={{ gap: 10, marginTop: 6 }}>
                  <span>一般 {v.normal}</span>
                  <span>Buff {v.buffed}</span>
                  <span>降速 {v.debuffed}</span>
                  <span>第 {i + 1} 隻</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        <div className="card card-pad">
          <div className="card-title" style={{ marginBottom: 8 }}>速度與 Tick</div>
          {rows.length === 0 ? (
            <div className="tiny dim">沒有魔靈</div>
          ) : (
            <div className="col" style={{ gap: 6 }}>
              {[...rows]
                .sort((a, b) => a.tick - b.tick || b.spd - a.spd)
                .map(({ u, spd, tick, name }) => (
                  <div key={u.id} className="row between" style={{ gap: 8 }}>
                    <span className="row" style={{ gap: 6, minWidth: 0 }}>
                      <span className="chip" style={{ ...TEAM_STYLE[u.team], flex: "0 0 auto" }}>{u.team === "blue" ? "藍" : "紅"}</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                    </span>
                    <span className="row" style={{ gap: 6 }}>
                      <span className="mono">{spd}</span>
                      <span className="tick-badge">T{Number.isFinite(tick) ? tick : "—"}</span>
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>

        <div className="card card-pad">
          <div className="row between" style={{ gap: 8, marginBottom: 8 }}>
            <div className="card-title">出手順序</div>
            <span className="tiny dim">前 {order.length} 次 · 每 Tick {activeRate?.short ?? ""}</span>
          </div>
          {order.length === 0 ? (
            <div className="tiny dim">沒有可模擬的魔靈</div>
          ) : (
            <div className="row wrap" style={{ gap: 5 }}>
              {order.map((e) => (
                <span key={`${e.turn}-${e.id}`} className="chip" style={{ ...TEAM_STYLE[e.team] }} title={`第 ${e.turn} 次出手 · Tick ${e.tick} · 剩餘攻擊條 ${e.ab}%`}>
                  <b>{e.turn}</b>
                  <span style={{ margin: "0 3px" }}>T{e.tick}</span>
                  <span style={{ marginRight: 4 }}>{e.name}</span>
                  <span className="mono">{e.spd}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: 14 }}>
        <div className="row between wrap" style={{ gap: 8, marginBottom: 8 }}>
          <div className="card-title">Tick 速度門檻</div>
          <span className="tiny dim">每 Tick 攻擊條 {activeRate?.short ?? ""} · 要達到該 Tick 所需的最低速度</span>
        </div>
        <div className="tick-row">
          {brackets.map((b) => {
            const hit = rows.some((r) => r.tick === b.tick);
            return (
              <div key={b.tick} className={`tick-cell ${hit ? "hit" : ""}`} title={`${b.minSpeed}${Number.isFinite(b.maxSpeed) ? `–${b.maxSpeed}` : " 以上"} 速度`}>
                <div className="t">T{b.tick}</div>
                <div className="s">{b.minSpeed}</div>
              </div>
            );
          })}
        </div>
        <div className="tiny dim" style={{ marginTop: 8, lineHeight: 1.6 }}>
          速度落在「T4 門檻 ~ T3 門檻 - 1」之間，就是第 4 個 Tick 出手。左邊數字是該 Tick 的最低速度，滑過去看完整區間。
        </div>
      </div>
    </>
  );
}
