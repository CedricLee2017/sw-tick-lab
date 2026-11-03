import { useMemo, useState } from "react";
import { Plus, Search, Users } from "lucide-react";
import { MONSTER_MAP, useStore } from "../store";
import { useSummary } from "../lib/accountStats";
import { ELEMENTS } from "../lib/constants";
import { Modal, MonsterIcon, TickBadge, fmt, setColor } from "../components/ui";
import { MonsterPickerModal, toMonsterEntries } from "../components/MonsterPicker";
import { MonsterDetailModal } from "../components/MonsterDetail";
import { sendOptimizerDraft } from "../lib/draft";

export default function MonstersPage() {
  const summary = useSummary();
  const rta = useStore((s) => s.settings.rta);
  const [q, setQ] = useState("");
  const [el, setEl] = useState(0);
  const [onlyBuilt, setOnlyBuilt] = useState(false);
  const [sort, setSort] = useState<"spd" | "hp" | "name" | "tick">("spd");
  const [open, setOpen] = useState<number | null>(null);
  const addCustomUnit = useStore((s) => s.addCustomUnit);
  const removeCustomUnit = useStore((s) => s.removeCustomUnit);
  /** 新增自訂魔靈：先選魔靈，再設定星級 / 等級 */
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState<{ id: number; stars: number; level: number } | null>(null);

  const views = useMemo(() => {
    if (!summary) return [];
    let arr = summary.views;
    if (q.trim()) arr = arr.filter((v) => v.monster.name.toLowerCase().includes(q.trim().toLowerCase()));
    if (el) arr = arr.filter((v) => v.monster.el === el);
    if (onlyBuilt) arr = arr.filter((v) => v.runes.length > 0);
    arr = [...arr].sort((a, b) => {
      if (sort === "spd" || sort === "tick") return (b.stats.panelSpd ?? b.stats.spd) - (a.stats.panelSpd ?? a.stats.spd);
      if (sort === "hp") return b.stats.hp - a.stats.hp;
      return a.monster.name.localeCompare(b.monster.name);
    });
    return arr;
  }, [summary, q, el, onlyBuilt, sort]);

  /** 新增魔靈清單：標示目前帳號已擁有幾隻，方便避開重複 */
  const addEntries = useMemo(() => {
    const owned = new Map<number, number>();
    for (const v of summary?.views ?? []) owned.set(v.monster.id, (owned.get(v.monster.id) ?? 0) + 1);
    return toMonsterEntries().map((e) => {
      const n = owned.get(e.monster.id) ?? 0;
      return { ...e, meta: n > 0 ? `已擁有 ${n} 隻` : "尚未擁有" };
    });
  }, [summary]);

  if (!summary) return <div className="empty"><Users size={40} /><div>尚未匯入存檔</div></div>;

  const current = open !== null ? views.find((v) => v.unit.id === open) : undefined;
  const customCount = summary.views.filter((v) => v.unit.custom).length;

  const confirmAdd = () => {
    if (!draft) return;
    const id = addCustomUnit(draft.id, draft.stars, draft.level);
    if (id !== null) {
      setDraft(null);
      setOpen(id);
    }
  };

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 14 }}>
        <div className="row filter-row" style={{ gap: 8 }}>
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
        <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
          <span className="dim tiny">
            共 {views.length} 隻{customCount > 0 ? ` · 自訂 ${customCount}` : ""}
          </span>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setAddOpen(true)}>
            <Plus size={14} /> 新增魔靈
          </button>
        </div>
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
                <div className="tiny dim">
                  {v.unit.custom && <span className="chip gold" style={{ padding: "0 5px", fontSize: 9, marginRight: 4 }}>自訂</span>}
                  {ELEMENTS[v.monster.el as 1].name} · {v.monster.nat}★ · {v.unit.stars}★{v.unit.level}
                </div>
              </div>
              <TickBadge spd={v.stats.spd} rta={rta} />
            </div>
            <div className="row between" style={{ marginTop: 9 }}>
              <span className="mono gold" style={{ fontWeight: 800, fontSize: 15 }} title="遊戲面板速度（不含建築 / 隊長 / 強化）">{v.stats.panelSpd ?? v.stats.spd}</span>
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
        <MonsterDetailModal
          monster={current.monster}
          base={current.base}
          stats={current.stats}
          stars={current.unit.stars}
          level={current.unit.level}
          runes={current.runes}
          artifacts={current.artifacts}
          badge={<TickBadge spd={current.stats.spd} rta={rta} />}
          custom={current.unit.custom}
          onRemoveCustom={() => {
            if (window.confirm(`確定要移除自訂魔靈「${current.monster.name}」嗎？已裝備的符文會回到未裝備狀態。`)) {
              removeCustomUnit(current.unit.id);
              setOpen(null);
            }
          }}
          onOptimize={() => {
            sendOptimizerDraft({ monsterId: current.monster.id });
            window.location.hash = "#/optimizer";
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}

      {addOpen && (
        <MonsterPickerModal
          title="新增魔靈（自訂）"
          entries={addEntries}
          onPick={(e) => {
            setAddOpen(false);
            setDraft({ id: e.monster.id, stars: 6, level: 40 });
          }}
          onClose={() => setAddOpen(false)}
          footerLeft="先選一隻魔靈，再設定星級與等級"
          emptyText="找不到符合條件的魔靈"
        />
      )}

      {draft && (() => {
        const m = MONSTER_MAP.get(draft.id);
        if (!m) return null;
        return (
          <Modal title="新增自訂魔靈" onClose={() => setDraft(null)} width={460}>
            <div className="row" style={{ gap: 12 }}>
              <MonsterIcon id={m.id} size={64} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{m.name}</div>
                <div className="tiny dim" style={{ marginTop: 3 }}>
                  {ELEMENTS[m.el as 1]?.name} · {m.nat}★ 原生 · 基礎速度 {m.spd}
                </div>
              </div>
            </div>

            <div className="grid split-2" style={{ gap: 10, marginTop: 16 }}>
              <div className="field">
                <label>星級</label>
                <select className="select" value={draft.stars} onChange={(e) => setDraft({ ...draft, stars: Number(e.target.value) })}>
                  {[6, 5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}★</option>)}
                </select>
              </div>
              <div className="field">
                <label>等級</label>
                <input
                  className="input mono"
                  type="number"
                  min={1}
                  max={40}
                  value={draft.level}
                  onChange={(e) => setDraft({ ...draft, level: Math.max(1, Math.min(40, Number(e.target.value) || 1)) })}
                />
              </div>
            </div>

            <div className="tiny dim" style={{ marginTop: 12, lineHeight: 1.7 }}>
              新增後會出現在魔靈圖鑑，可以當成配符、一鍵配隊的目標。這是本機虛擬資料，不會影響原始存檔。
            </div>

            <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button type="button" className="btn" onClick={() => setDraft(null)}>取消</button>
              <button type="button" className="btn btn-primary" onClick={confirmAdd}>
                <Plus size={14} /> 新增
              </button>
            </div>
          </Modal>
        );
      })()}
    </>
  );
}
