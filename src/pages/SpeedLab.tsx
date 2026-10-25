import { useMemo, useState } from "react";
import { ArrowRight, Gauge, ListOrdered, Plus, Trash2, Wand2, Users, Info } from "lucide-react";
import { useStore } from "../store";
import { useSummary } from "../lib/accountStats";
import { MonsterPicker, MonsterIcon, NumberField, TickBadge, fmt } from "../components/ui";
import { speedForTick, tickOf } from "../lib/stats";
import { simulateOrder } from "../lib/optimizer";
import { ELEMENTS } from "../lib/constants";

const TICK_PRESETS = [3, 4, 5, 6, 7, 8, 9, 10];

export default function SpeedPage() {
  const account = useStore((s) => s.account);
  const bonus = useStore((s) => s.settings.bonus);
  const patchBonus = useStore((s) => s.patchBonus);
  const rta = useStore((s) => s.settings.rta);
  const setRta = useStore((s) => s.setRta);
  const summary = useSummary();

  const [tab, setTab] = useState<"calc" | "order" | "list">("calc");
  const [monsterId, setMonsterId] = useState(0);
  const [baseSpd, setBaseSpd] = useState(100);
  const [tick, setTick] = useState(5);
  const [swift, setSwift] = useState(false);

  const view = useMemo(() => summary?.views.find((v) => v.monster.id === monsterId), [summary, monsterId]);

  const effectiveBase = view ? view.base.spd : baseSpd;
  const pct = bonus.towerSpd + bonus.leadSpd + bonus.buffSpd;
  const extra = Math.ceil((effectiveBase * pct) / 100) + (swift ? Math.ceil((effectiveBase * 25) / 100) : 0);
  const targetSpeed = speedForTick(tick, rta);
  const needRune = targetSpeed - effectiveBase - extra;

  const ladder = useMemo(() => {
    const rows = [];
    for (let t = 1; t <= 15; t++) {
      const sp = speedForTick(t, rta);
      const need = sp - effectiveBase - extra;
      rows.push({ tick: t, speed: sp, need, ok: need <= 0 });
    }
    return rows;
  }, [effectiveBase, extra, rta]);

  const goOptimizer = () => {
    sessionStorage.setItem("swtick:draft", JSON.stringify({ monsterId, tick, swift }));
    window.location.hash = "#/optimizer";
  };

  return (
    <>
      <div className="row between wrap" style={{ marginBottom: 16, gap: 10 }}>
        <div className="tabs">
          <button className={`tab ${tab === "calc" ? "active" : ""}`} onClick={() => setTab("calc")}><Gauge size={13} /> Tick 反推</button>
          <button className={`tab ${tab === "order" ? "active" : ""}`} onClick={() => setTab("order")}><ListOrdered size={13} /> 出手順序</button>
          <button className={`tab ${tab === "list" ? "active" : ""}`} onClick={() => setTab("list")}><Users size={13} /> 我的速度表</button>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className={`btn btn-sm ${rta ? "btn-primary" : "btn-ghost"}`} onClick={() => setRta(!rta)} title="RTA 攻速條填充較慢">
            RTA Tick {rta ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {tab === "calc" && (
        <>
          <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, .9fr)", gap: 16 }}>
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">目標 Tick → 符文速度需求</div>
                  <div className="card-sub">公式：每 Tick 攻速條 +速度 × 0.07%（RTA 0.015%）</div>
                </div>
              </div>
              <div className="card-pad col" style={{ gap: 14 }}>
                <div className="field">
                  <label>魔靈（可選，選了會自動帶入基礎速度）</label>
                  <MonsterPicker
                    value={monsterId}
                    onChange={(id) => {
                      setMonsterId(id);
                      const v = summary?.views.find((x) => x.monster.id === id);
                      if (v) setBaseSpd(v.base.spd);
                    }}
                  />
                </div>

                <div className="grid g2">
                  <NumberField
                    label={view ? `基礎速度（${view.monster.name}）` : "基礎速度"}
                    value={effectiveBase}
                    min={1}
                    max={300}
                    onChange={(v) => { setMonsterId(0); setBaseSpd(v); }}
                  />
                  <NumberField label="目標 Tick" value={tick} min={1} max={30} onChange={setTick} />
                </div>

                <div className="row wrap" style={{ gap: 6 }}>
                  {TICK_PRESETS.map((t) => (
                    <button key={t} className={`btn btn-sm ${tick === t ? "btn-primary" : "btn-ghost"}`} onClick={() => setTick(t)}>
                      T{t}
                    </button>
                  ))}
                </div>

                <div className="divider" />

                <div className="grid g3">
                  <NumberField label="速度圖騰 %" value={bonus.towerSpd} min={0} max={20} step={0.5} onChange={(v) => patchBonus({ towerSpd: v })} />
                  <NumberField label="速度隊長技 %" value={bonus.leadSpd} min={0} max={50} onChange={(v) => patchBonus({ leadSpd: v })} />
                  <NumberField label="速度 Buff %" value={bonus.buffSpd} min={0} max={50} step={5} onChange={(v) => patchBonus({ buffSpd: v })} />
                </div>

                <label className="row" style={{ gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={swift} onChange={(e) => setSwift(e.target.checked)} />
                  <span className="tiny">計入迅速套裝 +25%（4 件）</span>
                </label>

                <div className="row wrap" style={{ gap: 6 }}>
                  <span className="chip muted">隊長技快速設定</span>
                  {[0, 19, 24, 28, 30, 33].map((v) => (
                    <button key={v} className={`btn btn-sm ${bonus.leadSpd === v ? "btn-primary" : "btn-ghost"}`} onClick={() => patchBonus({ leadSpd: v })}>
                      +{v}%
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div className="card-title">計算結果</div>
                <span className="chip gold">Tick {tick}</span>
              </div>
              <div className="card-pad col" style={{ gap: 14 }}>
                <div style={{ textAlign: "center", padding: "8px 0 2px" }}>
                  <div className="tiny dim">需要的符文速度（六顆符文速度總和）</div>
                  <div className="mono" style={{ fontSize: 52, fontWeight: 800, lineHeight: 1.1, color: needRune <= 0 ? "var(--green)" : "var(--gold)", letterSpacing: "-.03em" }}>
                    {needRune <= 0 ? 0 : needRune}
                  </div>
                  <div className="tiny muted">
                    {needRune <= 0 ? "目前的基礎加成已足夠，不需要符文速度" : "包含主屬性、副屬性與磨石的速度總和"}
                  </div>
                </div>

                <div className="card" style={{ padding: 12 }}>
                  <div className="kv"><span className="k">目標總速度</span><span className="v mono">{targetSpeed}</span></div>
                  <div className="kv"><span className="k">基礎速度</span><span className="v mono">{effectiveBase}</span></div>
                  <div className="kv"><span className="k">建築 + 隊長 + Buff（{pct}%）</span><span className="v mono green">+{Math.ceil((effectiveBase * pct) / 100)}</span></div>
                  <div className="kv"><span className="k">迅速套裝 +25%</span><span className="v mono green">+{swift ? Math.ceil((effectiveBase * 25) / 100) : 0}</span></div>
                  <div className="kv"><span className="k">目前裝備速度</span><span className="v mono">{view ? view.stats.spd : "—"}</span></div>
                </div>

                {view && (
                  <div className="alert ok tiny">
                    {view.monster.name} 目前 {view.stats.spd} 速 = Tick {view.stats.tick}
                    {view.stats.tick > tick ? `，距離 Tick ${tick} 還差 ${targetSpeed - view.stats.spd} 速` : `，已達到 Tick ${tick}`}
                  </div>
                )}

                <button className="btn btn-primary" onClick={goOptimizer}>
                  <Wand2 size={15} /> 用這個目標去配符 <ArrowRight size={14} />
                </button>
                <div className="row tiny dim" style={{ gap: 6 }}>
                  <Info size={13} /> 公式與 SWOP / 社群 Tick 表一致：286 速 = Tick 5。
                </div>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-head">
              <div>
                <div className="card-title">Tick 門檻一覽（基礎速度 {effectiveBase}）</div>
                <div className="card-sub">其他條件固定為目前設定：圖騰 {bonus.towerSpd}% · 隊長 {bonus.leadSpd}% · Buff {bonus.buffSpd}%{swift ? " · 迅速 25%" : ""}</div>
              </div>
            </div>
            <div className="card-pad">
              <div className="tick-row">
                {ladder.map((r) => (
                  <button
                    key={r.tick}
                    className={`tick-cell ${r.tick === tick ? "hit" : ""}`}
                    onClick={() => setTick(r.tick)}
                    style={{ textAlign: "left", cursor: "pointer" }}
                  >
                    <span className="t">TICK {r.tick}</span>
                    <span className="s" style={{ color: r.ok ? "var(--green)" : "var(--text)" }}>
                      {r.need <= 0 ? "已達成" : `+${r.need}`}
                    </span>
                    <span className="tiny dim mono">總速 {r.speed}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "order" && <OrderTab />}

      {tab === "list" && <ListTab />}
    </>
  );
}

function OrderTab() {
  const summary = useSummary();
  const rta = useStore((s) => s.settings.rta);
  const [units, setUnits] = useState<{ id: string; name: string; spd: number }[]>([
    { id: "a", name: "我的魔靈", spd: 286 },
    { id: "b", name: "對手 1", spd: 270 },
    { id: "c", name: "對手 2", spd: 240 },
  ]);
  const [turns, setTurns] = useState(8);
  const order = useMemo(() => simulateOrder(units, turns, rta), [units, turns, rta]);

  const addFromBox = (id: number) => {
    const v = summary?.views.find((x) => x.monster.id === id);
    if (!v) return;
    setUnits((u) => [...u.slice(0, 5), { id: `u${Date.now()}`, name: `${v.monster.name}（我方）`, spd: v.stats.spd }]);
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}>
      <div className="card">
        <div className="card-head">
          <div className="card-title">加入比較單位</div>
          <span className="chip muted">{units.length}/6</span>
        </div>
        <div className="card-pad col" style={{ gap: 10 }}>
          {units.map((u, i) => (
            <div className="row" key={u.id} style={{ gap: 8 }}>
              <span className="mono" style={{ width: 18, color: "var(--muted-2)" }}>{i + 1}</span>
              <input className="input" value={u.name} onChange={(e) => setUnits((arr) => arr.map((x) => (x.id === u.id ? { ...x, name: e.target.value } : x)))} />
              <input
                className="input mono"
                type="number"
                style={{ width: 86 }}
                value={u.spd}
                onChange={(e) => setUnits((arr) => arr.map((x) => (x.id === u.id ? { ...x, spd: Number(e.target.value) } : x)))}
              />
              <TickBadge spd={u.spd} rta={rta} />
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setUnits((arr) => arr.filter((x) => x.id !== u.id))}><Trash2 size={13} /></button>
            </div>
          ))}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-sm" onClick={() => setUnits((u) => [...u, { id: `x${Date.now()}`, name: "新單位", spd: 200 }])} disabled={units.length >= 6}>
              <Plus size={13} /> 新增
            </button>
            <div style={{ width: 220 }}>
              <MonsterPicker value={0} onChange={addFromBox} placeholder="從我的魔靈加入…" />
            </div>
            <NumberField label="" value={turns} onChange={setTurns} min={2} max={20} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">出手順序模擬</div>
          <span className="chip muted">前 {turns} 次行動</span>
        </div>
        <div className="scroll-y" style={{ maxHeight: 460 }}>
          <table className="table">
            <thead><tr><th>#</th><th>單位</th><th className="num">速度</th><th className="num">發生 Tick</th><th className="num">該單位第幾動</th></tr></thead>
            <tbody>
              {order.map((o, i) => {
                const u = units.find((x) => x.id === o.id);
                return (
                  <tr key={i}>
                    <td className="mono dim">{i + 1}</td>
                    <td>{u?.name ?? "?"}</td>
                    <td className="num mono">{u?.spd ?? "—"}</td>
                    <td className="num"><span className="tick-badge">T{o.tick}</span></td>
                    <td className="num mono dim">{o.turn}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ListTab() {
  const summary = useSummary();
  const rta = useStore((s) => s.settings.rta);
  const [maxTick, setMaxTick] = useState(0);
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    let arr = summary?.views ?? [];
    if (maxTick > 0) arr = arr.filter((v) => v.stats.tick <= maxTick);
    if (q.trim()) arr = arr.filter((v) => v.monster.name.toLowerCase().includes(q.trim().toLowerCase()));
    return [...arr].sort((a, b) => b.stats.spd - a.stats.spd).slice(0, 300);
  }, [summary, maxTick, q]);

  if (!summary) return <div className="empty">尚未匯入存檔</div>;

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">全部魔靈速度</div>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" style={{ width: 180 }} placeholder="搜尋魔靈…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="tabs">
            <button className={`tab ${maxTick === 0 ? "active" : ""}`} onClick={() => setMaxTick(0)}>全部</button>
            {[5, 6, 7].map((t) => (
              <button key={t} className={`tab ${maxTick === t ? "active" : ""}`} onClick={() => setMaxTick(t)}>≤ T{t}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="scroll-y" style={{ maxHeight: 620 }}>
        <table className="table">
          <thead>
            <tr><th>魔靈</th><th className="num">速度</th><th className="num">Tick</th><th className="num">下一 Tick 還差</th><th className="num">體力</th><th className="num">防禦</th><th>套裝</th></tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const nextNeed = speedForTick(Math.max(1, v.stats.tick - 1), rta) - v.stats.spd;
              return (
                <tr key={v.unit.id}>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <MonsterIcon id={v.monster.id} size={28} />
                      <div>
                        <div style={{ fontWeight: 600 }}>{v.monster.name}</div>
                        <div className="tiny dim">{ELEMENTS[v.monster.el as 1].name} · {v.monster.nat}★ · {v.unit.stars}★{v.unit.level}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num mono gold" style={{ fontWeight: 700 }}>{v.stats.spd}</td>
                  <td className="num"><TickBadge spd={v.stats.spd} rta={rta} /></td>
                  <td className="num mono tiny" style={{ color: nextNeed > 0 ? "var(--muted)" : "var(--green)" }}>
                    {v.stats.tick <= 1 ? "—" : `+${nextNeed}`}
                  </td>
                  <td className="num mono">{fmt(v.stats.hp)}</td>
                  <td className="num mono">{fmt(v.stats.def)}</td>
                  <td className="tiny dim">{v.runes.map((r) => r.set).filter((x, i, a) => a.indexOf(x) === i).length} 種</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
