import { useMemo, useState } from "react";
import { Search, Users, Wand2 } from "lucide-react";
import { useStore } from "../store";
import { useSummary } from "../lib/accountStats";
import { ELEMENTS, SET_BY_ID } from "../lib/constants";
import { Modal, MonsterIcon, RuneCard, ArtifactCard, StatGrid, TickBadge, fmt, setColor } from "../components/ui";
import { setSummary } from "../lib/stats";

export default function MonstersPage() {
  const summary = useSummary();
  const rta = useStore((s) => s.settings.rta);
  const [q, setQ] = useState("");
  const [el, setEl] = useState(0);
  const [onlyBuilt, setOnlyBuilt] = useState(false);
  const [sort, setSort] = useState<"spd" | "hp" | "name" | "tick">("spd");
  const [open, setOpen] = useState<number | null>(null);

  const views = useMemo(() => {
    if (!summary) return [];
    let arr = summary.views;
    if (q.trim()) arr = arr.filter((v) => v.monster.name.toLowerCase().includes(q.trim().toLowerCase()));
    if (el) arr = arr.filter((v) => v.monster.el === el);
    if (onlyBuilt) arr = arr.filter((v) => v.runes.length > 0);
    arr = [...arr].sort((a, b) => {
      if (sort === "spd" || sort === "tick") return b.stats.spd - a.stats.spd;
      if (sort === "hp") return b.stats.hp - a.stats.hp;
      return a.monster.name.localeCompare(b.monster.name);
    });
    return arr;
  }, [summary, q, el, onlyBuilt, sort]);

  if (!summary) return <div className="empty"><Users size={40} /><div>尚未匯入存檔</div></div>;

  const current = open !== null ? views.find((v) => v.unit.id === open) : undefined;

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 14 }}>
        <div className="row" style={{ gap: 8 }}>
          <div style={{ position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: "var(--muted-2)" }} />
            <input className="input" style={{ width: 200, paddingLeft: 28 }} placeholder="搜尋魔靈…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="select" style={{ width: 110 }} value={el} onChange={(e) => setEl(Number(e.target.value))}>
            <option value={0}>全屬性</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{ELEMENTS[n as 1].name}</option>)}
          </select>
          <select className="select" style={{ width: 120 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="spd">速度排序</option>
            <option value="hp">體力排序</option>
            <option value="name">名稱排序</option>
          </select>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={onlyBuilt} onChange={(e) => setOnlyBuilt(e.target.checked)} /> 只看有配符
          </label>
        </div>
        <span className="dim tiny">共 {views.length} 隻</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(212px, 1fr))", gap: 10 }}>
        {views.slice(0, 400).map((v) => (
          <button
            key={v.unit.id}
            onClick={() => setOpen(v.unit.id)}
            className="card"
            style={{ padding: 12, textAlign: "left", color: "var(--text)", cursor: "pointer", borderColor: "var(--line-soft)" }}
          >
            <div className="row" style={{ gap: 10 }}>
              <MonsterIcon id={v.monster.id} size={46} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.monster.name}</div>
                <div className="tiny dim">{ELEMENTS[v.monster.el as 1].name} · {v.monster.nat}★ · {v.unit.stars}★{v.unit.level}</div>
              </div>
              <TickBadge spd={v.stats.spd} rta={rta} />
            </div>
            <div className="row between" style={{ marginTop: 9 }}>
              <span className="mono gold" style={{ fontWeight: 800, fontSize: 15 }}>{v.stats.spd}</span>
              <span className="tiny dim">HP {fmt(v.stats.hp)}</span>
              <span className="tiny dim">{v.runes.length}/6</span>
            </div>
            <div style={{ display: "flex", gap: 3, marginTop: 8 }}>
              {Array.from({ length: 6 }).map((_, i) => {
                const r = v.runes.find((x) => x.slot === i + 1);
                return <span key={i} style={{ flex: 1, height: 4, borderRadius: 3, background: r ? setColor(r.set) : "rgba(34,48,82,.7)" }} />;
              })}
            </div>
          </button>
        ))}
      </div>

      {current && (
        <Modal title={current.monster.name} onClose={() => setOpen(null)} width={820}>
          <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
            <MonsterIcon id={current.monster.id} size={72} />
            <div style={{ flex: 1 }}>
              <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                <span className={`chip el-${current.monster.el}`} style={{ borderColor: "transparent", background: "rgba(255,255,255,.04)" }}>
                  {ELEMENTS[current.monster.el as 1].name}屬性
                </span>
                <span className="chip gold">{current.monster.nat}★ 原生</span>
                <span className="chip muted">{current.unit.stars}★ Lv.{current.unit.level}</span>
                <TickBadge spd={current.stats.spd} rta={rta} />
              </div>
              <StatGrid stats={current.stats} />
            </div>
          </div>

          <div className="row between" style={{ marginTop: 18, marginBottom: 8 }}>
            <div className="card-title">目前配裝</div>
            <span className="tiny dim">{current.runes.length > 0 ? setSummary(Object.fromEntries(current.runes.reduce((m, r) => m.set(r.set, (m.get(r.set) ?? 0) + 1), new Map<number, number>()))) : "未裝備"}</span>
          </div>

          {current.runes.length === 0 ? (
            <div className="empty tiny">這隻魔靈目前沒有裝備符文</div>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
              {[1, 2, 3, 4, 5, 6].map((slot) => {
                const r = current.runes.find((x) => x.slot === slot);
                return r ? <RuneCard key={slot} rune={r} compact /> : (
                  <div key={slot} className="rune" style={{ opacity: .35, alignItems: "center", justifyContent: "center", minHeight: 80 }}>
                    <span className="tiny dim">位置 {slot}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="row between" style={{ marginTop: 18, marginBottom: 8 }}>
            <div className="card-title">神器</div>
            <span className="tiny dim">裝備 {current.artifacts.length} / 2</span>
          </div>
          {current.artifacts.length === 0 ? (
            <div className="empty tiny">這隻魔靈目前沒有裝備神器</div>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
              {current.artifacts.map((a) => <ArtifactCard key={a.id} artifact={a} owner={current.monster.name} />)}
            </div>
          )}

          <div className="row" style={{ marginTop: 14, gap: 8 }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                sessionStorage.setItem("swtick:draft", JSON.stringify({ monsterId: current.monster.id }));
                window.location.hash = "#/optimizer";
                setOpen(null);
              }}
            >
              <Wand2 size={13} /> 幫這隻配符
            </button>
            <span className="tiny dim">套裝加成：{Object.entries(current.runes.reduce((acc, r) => ({ ...acc, [r.set]: (acc[r.set] ?? 0) + 1 }), {} as Record<number, number>)).map(([id, c]) => `${SET_BY_ID[Number(id)]?.name}×${c}`).join(" · ") || "—"}</span>
          </div>
        </Modal>
      )}
    </>
  );
}
