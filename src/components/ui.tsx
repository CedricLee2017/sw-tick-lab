import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search, X, ChevronDown } from "lucide-react";
import { ELEMENTS, SET_BY_ID, STAT_TYPES, type StatKey } from "../lib/constants";
import { MONSTERS, monsterOf } from "../store";
import type { Monster, Rune, Stats } from "../lib/types";
import { tickInfo } from "../lib/optimizer";

export const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString("en-US") : "—");
export const pct = (n: number) => `${Math.round(n * 10) / 10}%`;

export const ICON_BASE = "https://swarfarm.com/static/herders/images/monsters/";

export function MonsterIcon({ id, size = 44, className = "" }: { id: number; size?: number; className?: string }) {
  const m = monsterOf(id);
  const [err, setErr] = useState(false);
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.22) };
  if (!m || err) {
    return (
      <div
        style={style}
        className={`mon-icon ring-${m?.el ?? 1} ${className}`}
        title={m?.name}
      >
        <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontWeight: 800, color: "#8b9cc0", fontSize: size * 0.38 }}>
          {(m?.name ?? "?").slice(0, 1)}
        </div>
      </div>
    );
  }
  return (
    <img
      src={ICON_BASE + m.icon}
      alt={m.name}
      title={m.name}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setErr(true)}
      style={style}
      className={`mon-icon ring-${m.el} ${className}`}
    />
  );
}

export function ElementTag({ el }: { el: number }) {
  const e = ELEMENTS[el as 1 | 2 | 3 | 4 | 5];
  if (!e) return null;
  return <span className={`el-${el}`} style={{ fontWeight: 700, fontSize: 11.5 }}>{e.name}</span>;
}

export function TickBadge({ spd, rta = false }: { spd: number; rta?: boolean }) {
  const info = tickInfo(spd, rta);
  return (
    <span className="tick-badge" title={`${spd} 速度 → Tick ${info.tick}`}>
      T{Number.isFinite(info.tick) ? info.tick : "—"}
    </span>
  );
}

export function StatGrid({ stats, compact = false }: { stats: Stats; compact?: boolean }) {
  const items: [string, string][] = [
    ["HP", fmt(stats.hp)],
    ["攻", fmt(stats.atk)],
    ["防", fmt(stats.def)],
    ["速", fmt(stats.spd)],
    ["暴", `${stats.cr}%`],
    ["暴傷", `${stats.cd}%`],
    ["命", `${stats.acc}%`],
    ["抗", `${stats.res}%`],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: compact ? "repeat(4, 1fr)" : "repeat(4, 1fr)", gap: compact ? 6 : 8 }}>
      {items.map(([k, v]) => (
        <div key={k} style={{ background: "rgba(11,17,32,.55)", border: "1px solid var(--line-soft)", borderRadius: 8, padding: compact ? "4px 7px" : "6px 9px" }}>
          <div style={{ fontSize: 10, color: "var(--muted-2)", fontWeight: 700, letterSpacing: ".04em" }}>{k}</div>
          <div className="mono" style={{ fontWeight: 700, fontSize: compact ? 12 : 13 }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

export function statSuffix(t: number): string {
  const meta = STAT_TYPES[t];
  if (!meta) return "";
  return meta.pct || ["cr", "cd", "res", "acc"].includes(meta.key) ? "%" : "";
}

export function statLabel(t: number): string {
  return (STAT_TYPES[t]?.label ?? "?").replace(/%$/, "");
}

export function statText(t: number, v: number): string {
  const meta = STAT_TYPES[t];
  if (!meta) return `${v}`;
  return `${statLabel(t)} +${v}${statSuffix(t)}`;
}

export function RuneCard({
  rune,
  owner,
  onClick,
  selected,
  compact,
}: {
  rune: Rune;
  owner?: string;
  onClick?: () => void;
  selected?: boolean;
  compact?: boolean;
}) {
  const set = SET_BY_ID[rune.set];
  const gradeClass = rune.grade >= 5 ? "legendary" : rune.grade === 4 ? "hero" : rune.grade === 3 ? "rare" : "";
  return (
    <div
      className={`rune ${gradeClass}`}
      onClick={onClick}
      style={{
        cursor: onClick ? "pointer" : undefined,
        borderColor: selected ? "var(--gold)" : undefined,
        boxShadow: selected ? "0 0 0 2px rgba(242,198,92,.25)" : undefined,
      }}
    >
      <div className="rune-top">
        <div className="rune-set">
          <span className="rune-dot" style={{ background: setColor(rune.set) }} />
          {set?.name ?? `套裝${rune.set}`}
        </div>
        <span className="rune-slot">#{rune.slot}</span>
      </div>
      <div className="rune-main">{statText(rune.main.t, rune.main.v)}</div>
      {!compact &&
        rune.subs.map((s, i) => (
          <div className="rune-sub" key={i}>
            <span>{statLabel(s.t)}</span>
            <span>
              <b>+{s.v}{statSuffix(s.t)}</b>
              {s.g > 0 && <span className="g"> (+{s.g}{statSuffix(s.t)})</span>}
            </span>
          </div>
        ))}
      <div className="rune-sub" style={{ marginTop: 2 }}>
        <span className="dim tiny">
          {["", "★", "★★", "★★★", "★★★★", "★★★★★", "★★★★★★"][rune.grade]} +{rune.level}
        </span>
        <span className="dim tiny">{owner ? owner : "未裝備"}</span>
      </div>
    </div>
  );
}

export function setColor(id: number): string {
  const c: Record<number, string> = {
    1: "#f2c65c", 2: "#7fb3ff", 3: "#43d98a", 4: "#ff9f6b", 5: "#ff6b6b", 6: "#b07cff",
    7: "#8fd6a8", 8: "#ff7a52", 9: "#c084fc", 10: "#ef4444", 11: "#f97316", 12: "#38bdf8",
    13: "#fbbf24", 14: "#60a5fa", 15: "#f472b6", 16: "#94a3b8", 17: "#fb923c", 18: "#4ade80",
    19: "#facc15", 20: "#a78bfa", 21: "#34d399", 22: "#e879f9", 23: "#cbd5e1",
  };
  return c[id] ?? "#8b9cc0";
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div style={{ position: "relative" }}>
        <input
          className="input mono"
          type="number"
          value={Number.isFinite(value) ? value : ""}
          min={min}
          max={max}
          step={step ?? 1}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        />
        {suffix && (
          <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--muted-2)" }}>{suffix}</span>
        )}
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Modal({ title, onClose, children, width }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" style={{ width: width ? Math.min(width, 1200) : undefined }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="card-title">{title}</div>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ── 魔靈搜尋下拉 ─────────────────────────────── */
export function MonsterPicker({
  value,
  onChange,
  placeholder = "搜尋魔靈（英文名）…",
}: {
  value: number;
  onChange: (id: number) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const m = value ? monsterOf(value) : undefined;

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    let arr = MONSTERS;
    if (term) arr = arr.filter((x) => x.name.toLowerCase().includes(term));
    return arr
      .slice()
      .sort((a, b) => (b.nat - a.nat) || a.name.localeCompare(b.name))
      .slice(0, 120);
  }, [q]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className="input" style={{ display: "flex", alignItems: "center", gap: 9, textAlign: "left" }} onClick={() => setOpen((v) => !v)}>
        {m ? <MonsterIcon id={m.id} size={26} /> : <Search size={15} className="dim" />}
        <span style={{ flex: 1, color: m ? "var(--text)" : "var(--muted-2)" }}>{m ? m.name : placeholder}</span>
        <ChevronDown size={14} className="dim" />
      </button>
      {open && (
        <div
          style={{
            position: "absolute", zIndex: 60, top: "calc(100% + 6px)", left: 0, right: 0,
            background: "#0e1626", border: "1px solid var(--line)", borderRadius: 12,
            boxShadow: "0 24px 50px -20px #000", overflow: "hidden",
          }}
        >
          <div style={{ padding: 8, borderBottom: "1px solid var(--line-soft)" }}>
            <input autoFocus className="input" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="scroll-y" style={{ maxHeight: 300 }}>
            {list.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => { onChange(x.id); setOpen(false); setQ(""); }}
                style={{
                  display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "6px 10px",
                  background: x.id === value ? "rgba(242,198,92,.1)" : "transparent", border: 0, color: "var(--text)",
                  textAlign: "left", fontSize: 12.5,
                }}
              >
                <MonsterIcon id={x.id} size={26} />
                <span style={{ flex: 1 }}>{x.name}</span>
                <span className={`el-${x.el}`} style={{ fontSize: 11 }}>{ELEMENTS[x.el as 1 | 2 | 3 | 4 | 5]?.name}</span>
                <span className="dim tiny">{"★".repeat(x.nat)}</span>
              </button>
            ))}
            {list.length === 0 && <div className="empty" style={{ padding: 20 }}>找不到魔靈</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, desc }: { icon: ReactNode; title: string; desc?: string }) {
  return (
    <div className="empty">
      {icon}
      <div style={{ fontWeight: 600, color: "var(--text)" }}>{title}</div>
      {desc && <div className="tiny" style={{ marginTop: 4 }}>{desc}</div>}
    </div>
  );
}
