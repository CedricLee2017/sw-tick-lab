import { useMemo, useState } from "react";
import { Search, Star } from "lucide-react";
import { unitLabel, useStore } from "../store";
import { ELEMENTS } from "../lib/constants";
import type { UnitView } from "../lib/accountStats";
import { MonsterDetailModal } from "./MonsterDetail";
import { MonsterIcon, TickBadge } from "./ui";

/** SWGT Monster Collection 的分區：原五 / 原四 / 原三 / 原二 / 二覺 */
const GROUPS = [
  { key: "nat5", label: "NAT 5", sub: "原五", color: "#f2c65c" },
  { key: "nat4", label: "NAT 4", sub: "原四", color: "#c084fc" },
  { key: "nat3", label: "NAT 3", sub: "原三", color: "#60a5fa" },
  { key: "nat2", label: "NAT 2", sub: "原二", color: "#4ade80" },
  { key: "a2", label: "SECOND AWAKENED", sub: "二覺", color: "#22d3ee" },
] as const;

type GroupKey = (typeof GROUPS)[number]["key"];

function groupOf(view: UnitView): GroupKey {
  const m = view.monster;
  if (m.a2 === 1) return "a2";
  if (m.nat === 5) return "nat5";
  if (m.nat === 4) return "nat4";
  if (m.nat === 3) return "nat3";
  return "nat2";
}

type FilterKey = "all" | "built" | "empty" | "noskill";

const EL_COLORS: Record<number, string> = {
  1: "var(--water)",
  2: "var(--fire)",
  3: "var(--wind)",
  4: "var(--light)",
  5: "var(--dark)",
};

const FILTERS: { key: FilterKey; label: string; title: string }[] = [
  { key: "all", label: "全部", title: "顯示全部 6★ 滿等魔靈" },
  { key: "built", label: "已配符", title: "只顯示身上有符文的魔靈" },
  { key: "empty", label: "未配符", title: "只顯示身上沒有符文的魔靈" },
  { key: "noskill", label: "未升技", title: "只顯示技能升級次數為 0 的魔靈" },
];

export function MaxLevelMonsters({ views }: { views: UnitView[] }) {
  const rta = useStore((s) => s.settings.rta);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [els, setEls] = useState<Set<number>>(() => new Set());
  const [detail, setDetail] = useState<UnitView | null>(null);

  const toggleEl = (el: number) => {
    setEls((prev) => {
      const next = new Set(prev);
      if (next.has(el)) next.delete(el);
      else next.add(el);
      return next;
    });
  };

  const elCounts = useMemo(() => {
    const c: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const v of views) c[v.monster.el] = (c[v.monster.el] ?? 0) + 1;
    return c;
  }, [views]);

  const groups = useMemo(() => {
    const key = q.trim().toLowerCase();
    const filtered = views.filter((v) => {
      if (els.size > 0 && !els.has(v.monster.el)) return false;
      if (filter === "built" && v.runes.length === 0) return false;
      if (filter === "empty" && v.runes.length > 0) return false;
      if (filter === "noskill" && (v.unit.skillUps ?? 0) > 0) return false;
      if (!key) return true;
      const text = [unitLabel(v.unit), v.monster.name, ELEMENTS[v.monster.el as 1]?.name ?? ""]
        .join(" ")
        .toLowerCase();
      return text.includes(key);
    });
    return GROUPS.map((g) => ({
      ...g,
      rows: filtered.filter((v) => groupOf(v) === g.key),
    }));
  }, [views, q, els, filter]);

  const shown = groups.reduce((sum, g) => sum + g.rows.length, 0);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <div style={{ minWidth: 0 }}>
          <div className="card-title">
            <Star size={13} className="gold" style={{ verticalAlign: -2, marginRight: 4 }} />
            6★ 滿等魔靈 <span className="dim tiny" style={{ fontWeight: 400 }}>{shown} / {views.length} 隻</span>
          </div>
          <div className="card-sub">
            依 SWGT Monster Collection 分區：NAT 5 / NAT 4 / NAT 3 / NAT 2 / SECOND AWAKENED；全部都是 6★ Lv40，點圖示看完整面板。
            屬性可多選（符合任一個）：只選水就只出水屬性，選風＋光就只出風與光屬性。
          </div>
        </div>
        <div className="row wrap" style={{ gap: 6, justifyContent: "flex-end" }}>
          <div style={{ position: "relative" }}>
            <Search size={12} style={{ position: "absolute", left: 8, top: 9, color: "var(--muted-2)" }} />
            <input
              className="input"
              style={{ width: 168, paddingLeft: 26, paddingTop: 5, paddingBottom: 5, fontSize: 11.5 }}
              placeholder="搜尋魔靈…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <span className="divider-v" />
          <span className="tiny dim" style={{ alignSelf: "center" }}>屬性</span>
          {[1, 2, 3, 4, 5].map((el) => {
            const on = els.has(el);
            const dim = els.size > 0 && !on;
            return (
              <button
                key={el}
                type="button"
                className="chip"
                style={{
                  cursor: "pointer",
                  padding: "5px 10px",
                  color: dim ? "var(--muted-2)" : EL_COLORS[el],
                  background: on ? "rgba(255, 255, 255, .06)" : "transparent",
                  borderColor: on ? EL_COLORS[el] : "var(--line-soft)",
                  boxShadow: on ? `inset 0 0 0 1px ${EL_COLORS[el]}` : "none",
                  fontWeight: on ? 700 : 500,
                }}
                onClick={() => toggleEl(el)}
                title={`${ELEMENTS[el as 1].name}屬性 · 點擊${on ? "取消" : "加入"}篩選（可多選）`}
              >
                {on ? "✓ " : ""}{ELEMENTS[el as 1].name} · {elCounts[el] ?? 0}
              </button>
            );
          })}
          {els.size > 0 && (
            <button
              type="button"
              className="chip muted"
              style={{ cursor: "pointer", padding: "5px 10px" }}
              onClick={() => setEls(new Set())}
              title="清除屬性篩選，顯示全部屬性"
            >
              清除 · 全屬性 {views.length}
            </button>
          )}
          {els.size > 1 && (
            <span className="tiny dim">符合任一個</span>
          )}
          <span className="divider-v" />
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`chip ${filter === f.key ? "gold" : "muted"}`}
              style={{ cursor: "pointer" }}
              onClick={() => setFilter(f.key)}
              title={f.title}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card-pad col" style={{ gap: 16 }}>
        {groups.map((g) => (
          <div key={g.key}>
            <div className="row between wrap" style={{ gap: 8, marginBottom: 6 }}>
              <div className="row" style={{ gap: 7, alignItems: "baseline" }}>
                <span className="max-monsters-title" style={{ color: g.color }}>
                  {g.label}
                </span>
                <span className="tiny dim">{g.sub} · {g.rows.length} 隻</span>
              </div>
              <span className="max-monsters-hr" />
            </div>
            {g.rows.length === 0 ? (
              <div className="tiny dim" style={{ padding: "4px 0" }}>沒有符合條件的魔靈</div>
            ) : (
              <div className="max-monsters-grid">
                {g.rows.map((v) => (
                  <button
                    key={v.unit.id}
                    type="button"
                    className="max-monster-tile"
                    title={`${unitLabel(v.unit)} · ${ELEMENTS[v.monster.el as 1]?.name ?? "?"} · ${v.monster.nat}★ 原生 · ${v.unit.stars}★ Lv${v.unit.level} · 符文 ${v.runes.length}/6 · 神器 ${v.artifacts.length}/2${v.unit.skillUps != null ? ` · 升技 ${v.unit.skillUps}` : ""}`}
                    onClick={() => setDetail(v)}
                  >
                    <MonsterIcon id={v.monster.id} size={36} />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {detail && (
        <MonsterDetailModal
          monster={detail.monster}
          base={detail.base}
          stats={detail.stats}
          stars={detail.unit.stars}
          level={detail.unit.level}
          runes={detail.runes}
          artifacts={detail.artifacts}
          badge={<TickBadge spd={detail.stats.spd} rta={rta} />}
          unitName={unitLabel(detail.unit)}
          note={`6★ 滿等魔靈 · ${ELEMENTS[detail.monster.el as 1]?.name ?? "?"}屬性 · ${detail.monster.nat}★ 原生${detail.monster.a2 ? " · 二覺" : ""}`}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
