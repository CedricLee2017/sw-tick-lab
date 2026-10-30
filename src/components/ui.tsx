import { useEffect, useState, type ReactNode } from "react";
import { X, Lock, Unlock, Ban, Droplet, Flame, Wind, Sun, Moon } from "lucide-react";
import { ELEMENTS, SET_BY_ID, STAT_TYPES, type StatKey } from "../lib/constants";
import { monsterOf } from "../store";
import type { Artifact, Monster, Rune, Stats } from "../lib/types";
import type { BaseStats } from "../lib/stats";
import { artifactKindText, artifactMainText, artifactSubText, artifactSubsText, artifactTypeText, ARTIFACT_RANKS } from "../lib/artifacts";
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

/** 屬性圖示（與遊戲面板的屬性徽章對應） */
const EL_ICON = { 1: Droplet, 2: Flame, 3: Wind, 4: Sun, 5: Moon } as const;

/**
 * 魔靈資料面板：仿遊戲內魔靈資訊畫面。
 * 體力／攻擊力／防禦力／攻擊速度顯示「基礎（白）＋加成（綠）」，
 * 暴擊率／暴傷／抵抗／命中顯示總值。
 */
export function MonsterPanel({
  monster,
  base,
  stats,
  stars = 6,
  level = 40,
  artifacts = [],
  compact = false,
  badge,
}: {
  monster: Monster;
  /** 星級 / 等級換算後的基礎值；省略時只顯示總值 */
  base?: BaseStats;
  stats: Stats;
  stars?: number;
  level?: number;
  /** 已裝備神器（魔礦），顯示在「魔礦效果」內 */
  artifacts?: Artifact[];
  compact?: boolean;
  /** 標題右側的額外資訊（例如 Tick 徽章） */
  badge?: ReactNode;
}) {
  const rows: { label: string; base?: number; value: number; percent?: boolean }[] = [
    { label: "體力", base: base?.hp, value: stats.hp },
    { label: "攻擊力", base: base?.atk, value: stats.atk },
    { label: "防禦力", base: base?.def, value: stats.def },
    { label: "攻擊速度", base: base?.spd, value: stats.spd },
    { label: "暴擊率", value: stats.cr, percent: true },
    { label: "暴擊傷害", value: stats.cd, percent: true },
    { label: "效果抵抗", value: stats.res, percent: true },
    { label: "效果命中", value: stats.acc, percent: true },
  ];
  const num = (v: number) => Math.round(v * 10) / 10;
  const Icon = EL_ICON[monster.el as 1 | 2 | 3 | 4 | 5] ?? Droplet;
  const starCount = Math.max(0, Math.min(6, Math.round(stars)));

  return (
    <div className={`mon-panel ${compact ? "compact" : ""}`}>
      <div className="mon-panel-head">
        <div className="mon-portrait">
          <MonsterIcon id={monster.id} size={compact ? 58 : 78} className="mon-portrait-img" />
          <span className={`mon-el-badge el-${monster.el}`} title={ELEMENTS[monster.el as 1]?.name}>
            <Icon size={compact ? 11 : 13} strokeWidth={2.6} />
          </span>
        </div>
        <div className="mon-panel-id">
          <div className="mon-title">
            <Icon size={compact ? 12 : 14} className={`el-${monster.el}`} strokeWidth={2.6} />
            <span className="mon-lv">Lv.{level}</span>
            <span className="mon-name">{monster.name}</span>
            {badge && <span className="mon-badge">{badge}</span>}
          </div>
          <div className="mon-stars" title={`${starCount} 星`}>{"★".repeat(starCount)}</div>
          <details className="mon-art">
            <summary>
              <span className="mon-art-caret">▾</span>
              <span>魔礦效果</span>
              <span className="mon-art-count">{artifacts.length}/2</span>
            </summary>
            {artifacts.length === 0 ? (
              <div className="mon-art-body tiny dim">沒有裝備神器</div>
            ) : (
              <div className="mon-art-body">
                {artifacts.map((a) => (
                  <div key={a.id} className="mon-art-item">
                    <div className="mon-art-name">{artifactKindText(a)} · {artifactMainText(a)}</div>
                    <div className="mon-art-sub">{artifactSubsText(a) || "—"}</div>
                  </div>
                ))}
              </div>
            )}
          </details>
        </div>
      </div>

      <div className="mon-panel-stats">
        {rows.map((r) => {
          const diff = r.base == null ? 0 : r.value - r.base;
          return (
            <div key={r.label} className="mon-row">
              <span className="k">{r.label}</span>
              <span className="v">
                {r.percent ? (
                  <span className="base">{num(r.value)}%</span>
                ) : r.base == null ? (
                  <span className="base">{fmt(r.value)}</span>
                ) : (
                  <>
                    <span className="base">{fmt(r.base)}</span>
                    {diff > 0 && <span className="add">+{fmt(diff)}</span>}
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
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
  detail,
  locked = false,
  excluded = false,
  onToggleLock,
  onToggleExclude,
}: {
  rune: Rune;
  owner?: string;
  onClick?: () => void;
  selected?: boolean;
  compact?: boolean;
  /** 完整資訊卡：副屬性、固有屬性、符文 ID、原裝備者、效率 */
  detail?: boolean;
  /** 應用程式內的鎖定（不可被其他角色配符使用） */
  locked?: boolean;
  /** 配符時排除 */
  excluded?: boolean;
  onToggleLock?: () => void;
  onToggleExclude?: () => void;
}) {
  const set = SET_BY_ID[rune.set];
  const gradeClass = rune.grade >= 5 ? "legendary" : rune.grade === 4 ? "hero" : rune.grade === 3 ? "rare" : "";
  const stars = ["", "★", "★★", "★★★", "★★★★", "★★★★★", "★★★★★★"][rune.grade] ?? "";
  const showSubs = !compact || detail;
  const eff = Math.round(rune.eff);
  return (
    <div
      className={`rune ${gradeClass} ${detail ? "detail" : ""} ${excluded ? "excluded" : ""} ${locked ? "locked" : ""}`}
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
          <span className="rune-pos" title={`符文位置 ${rune.slot}`}>{rune.slot}</span>
          {rune.ancient && <span className="rune-tag">遠古</span>}
          {rune.locked && <span className="rune-tag muted" title="遊戲內已鎖定">鎖</span>}
          {locked && <span className="rune-tag gold" title="本機鎖定：不可被其他魔靈配符使用">本機鎖</span>}
          {excluded && <span className="rune-tag red" title="已排除：不會進入配符">排除</span>}
        </div>
        <div className="rune-actions">
          {onToggleLock && (
            <button
              type="button"
              className={`rune-flag ${locked ? "on" : ""}`}
              title={locked ? "解除應用程式鎖定" : "鎖定符文（不可被其他魔靈配符使用）"}
              onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
            >
              {locked ? <Unlock size={11} /> : <Lock size={11} />}
            </button>
          )}
          {onToggleExclude && (
            <button
              type="button"
              className={`rune-flag ${excluded ? "off" : ""}`}
              title={excluded ? "取消排除" : "排除此符文（不進入配符）"}
              onClick={(e) => { e.stopPropagation(); onToggleExclude(); }}
            >
              <Ban size={11} />
            </button>
          )}
          <span className="rune-slot">+{rune.level}</span>
        </div>
      </div>
      <div className="rune-main">{statText(rune.main.t, rune.main.v)}</div>
      {rune.prefix?.t > 0 && (
        <div className="rune-sub rune-prefix">
          <span>
            {statLabel(rune.prefix.t)}
            <span className="dim" style={{ fontSize: 9.5 }}> 固有</span>
          </span>
          <span><b>+{rune.prefix.v}{statSuffix(rune.prefix.t)}</b></span>
        </div>
      )}
      {showSubs &&
        rune.subs.map((s, i) => (
          <div className="rune-sub" key={i}>
            <span>
              {statLabel(s.t)}
              {s.gem > 0 && <span className="gem" title="寶石（變換）"> ◆</span>}
            </span>
            <span>
              <b>+{s.v + s.g}{statSuffix(s.t)}</b>
              {s.g > 0 && (
                <span className="g" title={`實際數值已含精煉 +${s.g}${statSuffix(s.t)}`}>
                  {" "}(含精煉 +{s.g})
                </span>
              )}
            </span>
          </div>
        ))}
      <div className="rune-sub" style={{ marginTop: 2 }}>
        <span className="dim tiny">{stars} +{rune.level}</span>
        {!detail && <span className="dim tiny">{owner ? owner : "未裝備"}</span>}
      </div>
      {detail && (
        <div className="rune-meta">
          <div className="rune-meta-row"><span>符文 ID</span><b className="mono">{rune.id}</b></div>
          <div className="rune-meta-row"><span>原裝備</span><b title={owner || "未裝備"}>{owner || "未裝備"}</b></div>
          <div className="rune-meta-row"><span>效率</span><b className="gold">{eff}%</b></div>
          <div className="bar" style={{ height: 4 }}><i style={{ width: `${Math.min(100, Math.max(0, eff))}%` }} /></div>
        </div>
      )}
    </div>
  );
}

/** 符文位置的座標：1 號在上方，之後順時針 2…6（與遊戲符文盤一致） */
function slotPoint(slot: number, radius: number) {
  const angle = ((90 - (slot - 1) * 60) * Math.PI) / 180;
  return { x: 100 + radius * Math.cos(angle), y: 100 - radius * Math.sin(angle) };
}

/**
 * 六芒星符文盤：六個號碼代表 1～6 號符文位置，裝了符文的號碼會以套裝顏色標示。
 * 點號碼會回呼 onPick，讓旁邊的符文卡以同樣號碼對應。
 */
export function RuneStar({
  runes,
  activeSlot,
  onPick,
}: {
  runes: Rune[];
  activeSlot?: number | null;
  onPick?: (slot: number) => void;
}) {
  const bySlot = new Map(runes.map((r) => [r.slot, r]));
  const tri = (slots: number[]) =>
    slots.map((s) => { const p = slotPoint(s, 62); return `${p.x},${p.y}`; }).join(" ");
  return (
    <svg viewBox="0 0 200 200" className="rune-star" role="img" aria-label="符文位置 1 到 6">
      <defs>
        <radialGradient id="rs-bg" cx="50%" cy="42%" r="62%">
          <stop offset="0%" stopColor="#2a1d0c" />
          <stop offset="100%" stopColor="#0d0a06" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="94" fill="url(#rs-bg)" stroke="rgba(214,169,86,.32)" strokeWidth="1.4" />
      <circle cx="100" cy="100" r="80" fill="none" stroke="rgba(214,169,86,.16)" strokeDasharray="2 6" />
      <polygon points={tri([1, 3, 5])} fill="none" stroke="rgba(214,169,86,.4)" strokeWidth="1.6" strokeLinejoin="round" />
      <polygon points={tri([2, 4, 6])} fill="none" stroke="rgba(214,169,86,.4)" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="100" cy="100" r="15" fill="rgba(28,19,8,.92)" stroke="rgba(214,169,86,.45)" strokeWidth="1.2" />
      <path d="M100 92 L107 100 L100 108 L93 100 Z" fill="rgba(214,169,86,.55)" />
      {[1, 2, 3, 4, 5, 6].map((slot) => {
        const p = slotPoint(slot, 62);
        const rune = bySlot.get(slot);
        const color = rune ? setColor(rune.set) : "rgba(233,239,255,.5)";
        const on = activeSlot === slot;
        return (
          <g
            key={slot}
            className="rs-node"
            onClick={() => onPick?.(slot)}
            role={onPick ? "button" : undefined}
          >
            <title>
              {`${slot} 號位 · ${rune ? `${SET_BY_ID[rune.set]?.name ?? "套裝"} ${statText(rune.main.t, rune.main.v)}` : "未裝備"}`}
            </title>
            <circle
              cx={p.x}
              cy={p.y}
              r={on ? 17 : 15}
              fill={rune ? "rgba(20,14,6,.92)" : "rgba(14,11,6,.72)"}
              stroke={color}
              strokeWidth={on || rune ? 2 : 1.3}
              strokeOpacity={rune ? 0.85 : 0.5}
            />
            <text x={p.x} y={p.y + 4.5} textAnchor="middle" className="rs-num" fill={color}>{slot}</text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * 符文盤：左側六芒星顯示 1～6 號位置，右側依遊戲位置（上 1、順時針 2…6）排符文卡。
 * 卡片本身也會顯示號碼，兩邊號碼一致。
 */
export function RuneBoard({
  runes,
  renderRune,
  showMap = true,
  emptyHint = "未裝備",
}: {
  runes: Rune[];
  renderRune?: (rune: Rune) => ReactNode;
  /** 窄版面可關閉左側星盤，只留 3×2 的號碼位置 */
  showMap?: boolean;
  emptyHint?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const bySlot = new Map(runes.map((r) => [r.slot, r]));
  return (
    <div className={`rune-board ${showMap ? "" : "nomap"}`}>
      {showMap && (
        <div className="rune-board-map">
          <RuneStar runes={runes} activeSlot={active} onPick={(s) => setActive((a) => (a === s ? null : s))} />
          <div className="rune-board-cap">1 上 · 順時針 2 → 6</div>
        </div>
      )}
      <div className="rune-wheel-wrap">
        <div className="rune-wheel">
          {[1, 2, 3, 4, 5, 6].map((slot) => {
            const r = bySlot.get(slot);
            return (
              <div
                key={slot}
                className={`rune-wheel-cell ${active === slot ? "hl" : ""}`}
                data-slot={slot}
                style={{ gridArea: `rs${slot}` }}
              >
                {r ? (
                  renderRune ? renderRune(r) : <RuneCard rune={r} compact />
                ) : (
                  <div className="rune rune-empty">
                    <span className="rune-empty-num">{slot}</span>
                    <span className="tiny dim">{emptyHint}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const ARTIFACT_EL_COLOR: Record<number, string> = {
  1: "#7fb3ff",
  2: "#ff6b6b",
  3: "#43d98a",
  4: "#f2c65c",
  5: "#b07cff",
  98: "#e879f9",
};

/** 神器卡：屬性 / 類型、+15、主效果、副效果、擁有者 */
export function ArtifactCard({
  artifact,
  owner,
  onClick,
  detail,
}: {
  artifact: Artifact;
  owner?: string;
  onClick?: () => void;
  detail?: boolean;
}) {
  const rank = artifact.rank;
  const rankClass = rank >= 5 ? "legendary" : rank === 4 ? "hero" : rank === 3 ? "rare" : "";
  const color = artifact.type === 2 ? "#e879f9" : (ARTIFACT_EL_COLOR[artifact.attr] ?? "#8b9cc0");
  return (
    <div
      className={`rune artifact ${rankClass} ${detail ? "detail" : ""}`}
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : undefined }}
    >
      <div className="rune-top">
        <div className="rune-set">
          <span className="rune-dot" style={{ background: color }} />
          {artifactTypeText(artifact.type)}
          <span className="rune-tag">{artifactKindText(artifact)}</span>
          {artifact.locked && <span className="rune-tag muted" title="已鎖定">鎖</span>}
        </div>
        <span className="rune-slot">+{artifact.level}</span>
      </div>
      <div className="rune-main">{artifactMainText(artifact)}</div>
      {artifact.subs.map((s, i) => (
        <div className="rune-sub" key={i}>
          <span>{artifactSubText(s)}</span>
          {s.up && s.up > 0 ? <span className="g" title="此副效果被強化（+3/+6/+9/+12）的次數">強化 {s.up} 次</span> : null}
        </div>
      ))}
      <div className="rune-sub" style={{ marginTop: 2 }}>
        <span className="dim tiny">{ARTIFACT_RANKS[rank] ?? `${rank}★`} · {artifact.stars}★ 原生</span>
        {!detail && <span className="dim tiny">{owner || "未裝備"}</span>}
      </div>
      {detail && (
        <div className="rune-meta">
          <div className="rune-meta-row"><span>神器 ID</span><b className="mono">{artifact.id}</b></div>
          <div className="rune-meta-row"><span>類型</span><b>{artifactTypeText(artifact.type)} · {artifactKindText(artifact)}</b></div>
          <div className="rune-meta-row"><span>品質</span><b>{ARTIFACT_RANKS[rank] ?? "—"}</b></div>
          <div className="rune-meta-row"><span>裝備</span><b title={owner || "未裝備"}>{owner || "未裝備"}</b></div>
          <div className="rune-meta-row"><span>效果</span><b title={artifactSubsText(artifact)}>{artifact.subs.length} 條</b></div>
        </div>
      )}
    </div>
  );
}

export function setColor(id: number): string {
  const c: Record<number, string> = {
    1: "#f2c65c", 2: "#7fb3ff", 3: "#43d98a", 4: "#ff9f6b", 5: "#ff6b6b", 6: "#b07cff",
    7: "#8fd6a8", 8: "#ff7a52", 10: "#c084fc", 11: "#ef4444", 13: "#f97316", 14: "#38bdf8",
    15: "#fbbf24", 16: "#60a5fa", 17: "#f472b6", 18: "#94a3b8", 19: "#fb923c", 20: "#4ade80",
    21: "#facc15", 22: "#a78bfa", 23: "#34d399", 24: "#e879f9", 25: "#cbd5e1", 99: "#f8fafc",
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

export function EmptyState({ icon, title, desc }: { icon: ReactNode; title: string; desc?: string }) {
  return (
    <div className="empty">
      {icon}
      <div style={{ fontWeight: 600, color: "var(--text)" }}>{title}</div>
      {desc && <div className="tiny" style={{ marginTop: 4 }}>{desc}</div>}
    </div>
  );
}
