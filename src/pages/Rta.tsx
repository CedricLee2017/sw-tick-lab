import { useMemo, useState } from "react";
import { Search, Swords, Trophy } from "lucide-react";
import { MONSTER_MAP, useStore } from "../store";
import { ELEMENTS } from "../lib/constants";
import { rtaView, type RtaView } from "../lib/rta";
import { setSummary } from "../lib/stats";
import type { Monster } from "../lib/types";
import { ArtifactCard, Modal, MonsterIcon, RuneCard, StatGrid, TickBadge, fmt } from "../components/ui";

type RtaRow = RtaView & { monster: Monster };

export default function RtaPage() {
  const account = useStore((s) => s.account);
  const grind = useStore((s) => s.settings.bonus.grind);
  const [leaderOn, setLeaderOn] = useState(false);
  const [leaderPct, setLeaderPct] = useState(24);
  const [q, setQ] = useState("");
  const [el, setEl] = useState(0);
  const [onlyRta, setOnlyRta] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const favorites = account?.rta?.favorites ?? [];
  const views = useMemo(() => {
    if (!account) return [] as RtaRow[];
    const pct = leaderOn ? Math.max(0, Math.min(50, leaderPct)) : 0;
    return favorites
      .map((id): RtaRow | null => {
        const unit = account.units.find((u) => u.id === id);
        const monster = unit ? MONSTER_MAP.get(unit.master) : undefined;
        if (!unit || !monster) return null;
        return { ...rtaView(account, unit, monster, pct, grind), monster };
      })
      .filter((v): v is RtaRow => !!v)
      .sort((a, b) => b.stats.spd - a.stats.spd || b.stats.ehp - a.stats.ehp);
  }, [account, favorites, leaderOn, leaderPct, grind]);

  const shown = useMemo(() => {
    let arr = views;
    if (el) arr = arr.filter((v) => v.monster.el === el);
    if (onlyRta) arr = arr.filter((v) => v.runes.length > 0 || v.artifacts.length > 0);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      arr = arr.filter((v) => v.monster.name.toLowerCase().includes(s));
    }
    return arr;
  }, [views, el, onlyRta, q]);

  const current = open !== null ? views.find((v) => v.unit.id === open) : undefined;

  if (!account) return <div className="empty"><Swords size={40} /><div>尚未匯入存檔</div></div>;

  if (!account.rta || account.rta.favorites.length === 0) {
    return (
      <div className="empty" style={{ padding: "60px 20px" }}>
        <Trophy size={42} style={{ opacity: .35, marginBottom: 10 }} />
        <div style={{ fontWeight: 600, color: "var(--text)" }}>這份存檔沒有 RTA 最愛資料</div>
        <div className="tiny" style={{ marginTop: 6 }}>
          請確認匯出的 JSON 包含 <span className="mono">favorite_unit_list</span> 與{" "}
          <span className="mono">world_arena_rune_equip_list</span>；若為舊版快取，重新匯入即可。
        </div>
      </div>
    );
  }

  const fastest = views[0];
  const withRta = views.filter((v) => v.runes.length > 0 || v.artifacts.length > 0).length;
  const leaderBonus = leaderOn && fastest ? Math.ceil((fastest.base.spd * Math.max(0, Math.min(50, leaderPct))) / 100) : 0;

  return (
    <>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="stat-tile">
          <div className="k">最愛魔靈</div>
          <div className="v">{views.length}<span className="u">隻</span></div>
        </div>
        <div className="stat-tile">
          <div className="k">已有 RTA 配裝</div>
          <div className="v">{withRta}<span className="u">/ {views.length}</span></div>
        </div>
        <div className="stat-tile">
          <div className="k">目前最快</div>
          <div className="v" style={{ fontSize: 18 }}>{fastest ? fastest.monster.name : "—"}</div>
          <div className="tiny dim">{fastest ? `${fastest.stats.spd} 速 · RTA Tick ${fastest.stats.tick}` : "尚無資料"}</div>
        </div>
        <div className="stat-tile">
          <div className="k">RTA Tick 基準</div>
          <div className="v">1.5<span className="u">% / Tick</span></div>
          <div className="tiny dim">與一般競技場的 7% 不同</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">
            RTA 最愛魔靈速度排行 <span className="dim tiny" style={{ fontWeight: 400 }}>依 RTA 獨立配裝計算</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div className="tabs">
              <button type="button" className={`tab ${!leaderOn ? "active" : ""}`} onClick={() => setLeaderOn(false)}>
                無速度隊長
              </button>
              <button type="button" className={`tab ${leaderOn ? "active" : ""}`} onClick={() => setLeaderOn(true)}>
                有速度隊長
              </button>
            </div>
            {leaderOn && (
              <div style={{ position: "relative" }}>
                <input
                  className="input mono"
                  type="number"
                  min={0}
                  max={50}
                  step={1}
                  value={leaderPct}
                  onChange={(e) => setLeaderPct(Number(e.target.value) || 0)}
                  style={{ width: 96, paddingRight: 22 }}
                  title="速度隊長技 %"
                />
                <span style={{ position: "absolute", right: 8, top: 9, fontSize: 11, color: "var(--muted-2)" }}>%</span>
              </div>
            )}
          </div>
        </div>

        <div className="card-pad row wrap" style={{ gap: 12, borderBottom: "1px solid var(--line-soft)" }}>
          <div style={{ position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: "var(--muted-2)" }} />
            <input className="input" style={{ width: 190, paddingLeft: 28 }} placeholder="搜尋最愛魔靈…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="select" style={{ width: 110 }} value={el} onChange={(e) => setEl(Number(e.target.value))}>
            <option value={0}>全屬性</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{ELEMENTS[n as 1].name}屬性</option>)}
          </select>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={onlyRta} onChange={(e) => setOnlyRta(e.target.checked)} /> 只看有 RTA 配裝
          </label>
          <span className="tiny dim">
            {leaderOn ? `速度隊長 +${Math.max(0, Math.min(50, leaderPct))}%` : "未計速度隊長"}
            {leaderOn && fastest ? `（最快魔靈基礎速度 +${leaderBonus}）` : ""}
          </span>
          <span className="dim tiny" style={{ marginLeft: "auto" }}>顯示 {shown.length} / {views.length}</span>
        </div>

        <div className="card-pad col" style={{ gap: 6 }}>
          {shown.map((v, i) => {
            const sets = v.runes.reduce((m, r) => ({ ...m, [r.set]: (m[r.set] ?? 0) + 1 }), {} as Record<number, number>);
            const lb = leaderOn ? Math.ceil((v.base.spd * Math.max(0, Math.min(50, leaderPct))) / 100) : 0;
            return (
              <button
                key={v.unit.id}
                className="rta-row"
                onClick={() => setOpen(v.unit.id)}
                style={{ animationDelay: `${Math.min(i, 20) * 8}ms` }}
              >
                <span className={`build-rank ${i === 0 ? "top" : ""}`}>{i + 1}</span>
                <MonsterIcon id={v.monster.id} size={44} />
                <span className="rta-main">
                  <span className="row" style={{ gap: 6 }}>
                    <b style={{ fontSize: 13.5 }}>{v.monster.name}</b>
                    <span className={`el-${v.monster.el}`} style={{ fontSize: 11 }}>{ELEMENTS[v.monster.el as 1]?.name}</span>
                    <span className="tiny dim">{v.monster.nat}★ · {v.unit.stars}★Lv.{v.unit.level}</span>
                  </span>
                  <span className="tiny dim">
                    {Object.entries(sets).length > 0 ? setSummary(sets) : "尚未配置 RTA 符文"}
                    {" · "}{v.runes.length}/6 符文{v.artifacts.length > 0 ? ` · ${v.artifacts.length} 神器` : ""}
                  </span>
                </span>
                <span className="rta-stats tiny">
                  <span>HP <b className="mono">{fmt(v.stats.hp)}</b></span>
                  <span>ATK <b className="mono">{fmt(v.stats.atk)}</b></span>
                  <span>DEF <b className="mono">{fmt(v.stats.def)}</b></span>
                  <span>EHP <b className="mono">{fmt(v.stats.ehp)}</b></span>
                </span>
                <span className="rta-speed">
                  <b className="mono gold">{v.stats.spd}</b>
                  <span className="tiny dim">速</span>
                  <TickBadge spd={v.stats.spd} rta />
                  {leaderOn && <span className="tiny green">+{lb}</span>}
                </span>
              </button>
            );
          })}
          {shown.length === 0 && <div className="empty" style={{ padding: "40px 20px" }}>沒有符合條件的最愛魔靈</div>}
        </div>
      </div>

      {current && (
        <Modal title={`${current.monster.name} · RTA 配裝`} onClose={() => setOpen(null)} width={860}>
          <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
            <MonsterIcon id={current.monster.id} size={72} />
            <div style={{ flex: 1 }}>
              <div className="row wrap" style={{ gap: 8, marginBottom: 4 }}>
                <span className={`chip el-${current.monster.el}`} style={{ borderColor: "transparent", background: "rgba(255,255,255,.04)" }}>
                  {ELEMENTS[current.monster.el as 1].name}屬性
                </span>
                <span className="chip gold">{current.monster.nat}★ 原生</span>
                <span className="chip muted">{current.unit.stars}★ Lv.{current.unit.level}</span>
                <TickBadge spd={current.stats.spd} rta />
                <span className="chip muted">RTA 獨立配裝</span>
              </div>
              <StatGrid stats={current.stats} />
            </div>
          </div>

          <div className="row between" style={{ marginTop: 18, marginBottom: 8 }}>
            <div className="card-title">RTA 符文</div>
            <span className="tiny dim">
              {current.runes.length}/6 · {current.runes.length > 0 ? setSummary(current.runes.reduce((m, r) => ({ ...m, [r.set]: (m[r.set] ?? 0) + 1 }), {} as Record<number, number>)) : "未配置"}
            </span>
          </div>
          {current.runes.length === 0 ? (
            <div className="empty tiny">這隻魔靈目前沒有 RTA 符文配置</div>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
              {[1, 2, 3, 4, 5, 6].map((slot) => {
                const r = current.runes.find((x) => x.slot === slot);
                return r ? <RuneCard key={slot} rune={r} compact owner={current.monster.name} /> : (
                  <div key={slot} className="rune" style={{ opacity: .35, alignItems: "center", justifyContent: "center", minHeight: 80 }}>
                    <span className="tiny dim">位置 {slot}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="row between" style={{ marginTop: 18, marginBottom: 8 }}>
            <div className="card-title">RTA 神器</div>
            <span className="tiny dim">{current.artifacts.length} / 2</span>
          </div>
          {current.artifacts.length === 0 ? (
            <div className="empty tiny">這隻魔靈目前沒有 RTA 神器配置</div>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
              {current.artifacts.map((a) => <ArtifactCard key={a.id} artifact={a} owner={current.monster.name} />)}
            </div>
          )}

          <div className="tiny dim" style={{ marginTop: 12, lineHeight: 1.6 }}>
            RTA 配裝來自存檔的 <span className="mono">world_arena_rune_equip_list</span> /{" "}
            <span className="mono">world_arena_artifact_equip_list</span>，與一般配裝完全獨立；同一顆符文可以同時出現在兩邊。
            {leaderOn ? ` 目前速度已加入速度隊長 +${Math.max(0, Math.min(50, leaderPct))}%。` : " 目前未計速度隊長。"}
          </div>
        </Modal>
      )}
    </>
  );
}
