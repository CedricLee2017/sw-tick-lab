import { useMemo, useState } from "react";
import { Heart, Shield, Sparkles, Swords } from "lucide-react";
import type { Artifact } from "../lib/types";
import { ARTIFACT_MAIN } from "../lib/artifacts";

interface EffectDef {
  /** 神器效果 id */
  t: number;
  label: string;
  /** 數值本身是「減少」，顯示時加上負號 */
  negative?: boolean;
  /** 小數位（追加傷害的體力 % 需要 1 位） */
  decimals?: number;
  /** 屬性 id（水火風光暗），表頭用屬性色顯示 */
  el?: number;
}

interface TableDef {
  key: string;
  title: string;
  effects: EffectDef[];
}

/** 參考 SWGT「Top 10 Artifact Sub-Properties」的效果分組 */
const TABLES: TableDef[] = [
  {
    key: "taken",
    title: "受到屬性傷害減少",
    effects: [
      { t: 306, label: "水", negative: true, el: 1 },
      { t: 305, label: "火", negative: true, el: 2 },
      { t: 307, label: "風", negative: true, el: 3 },
      { t: 308, label: "光", negative: true, el: 4 },
      { t: 309, label: "暗", negative: true, el: 5 },
    ],
  },
  {
    key: "dealt",
    title: "對屬性傷害增加",
    effects: [
      { t: 301, label: "水", el: 1 },
      { t: 300, label: "火", el: 2 },
      { t: 302, label: "風", el: 3 },
      { t: 303, label: "光", el: 4 },
      { t: 304, label: "暗", el: 5 },
    ],
  },
  {
    key: "crit",
    title: "暴擊傷害條件",
    effects: [
      { t: 222, label: "敵方體力越高" },
      { t: 223, label: "敵方體力越低" },
      { t: 224, label: "自身回合單體" },
    ],
  },
  {
    key: "additional",
    title: "追加傷害",
    effects: [
      { t: 218, label: "體力", decimals: 1 },
      { t: 219, label: "攻擊" },
      { t: 220, label: "防禦" },
      { t: 221, label: "速度" },
    ],
  },
  {
    key: "increase",
    title: "增加效果",
    effects: [
      { t: 226, label: "攻防" },
      { t: 204, label: "攻擊" },
      { t: 205, label: "防禦" },
      { t: 206, label: "速度" },
    ],
  },
  {
    key: "lost-hp",
    title: "依損失體力比例增加",
    effects: [
      { t: 200, label: "攻擊" },
      { t: 201, label: "防禦" },
      { t: 202, label: "速度" },
    ],
  },
  {
    key: "revive",
    title: "復活與反擊",
    effects: [
      { t: 216, label: "復活體力" },
      { t: 217, label: "復活攻擊條" },
      { t: 208, label: "反擊傷害" },
      { t: 209, label: "協同攻擊" },
      { t: 225, label: "反擊／協同" },
    ],
  },
  {
    key: "other",
    title: "其他效果",
    effects: [
      { t: 210, label: "炸彈傷害" },
      { t: 215, label: "吸血" },
      { t: 214, label: "受到暴傷", negative: true },
    ],
  },
];

type ArtifactGroup = "attr" | "type";

interface ArtifactTab {
  key: string;
  label: string;
  group: ArtifactGroup;
  /** 分組代表色：屬性神器用屬性色，類型神器統一用青綠色 */
  color: string;
  match: (a: Artifact) => boolean;
}

/** 類型神器統一色，和五種屬性色明顯區隔 */
const TYPE_COLOR = "#2dd4bf";

const ATTR_TABS: ArtifactTab[] = [
  { key: "water", label: "水", group: "attr", color: "var(--water)", match: (a) => a.type === 1 && a.attr === 1 },
  { key: "fire", label: "火", group: "attr", color: "var(--fire)", match: (a) => a.type === 1 && a.attr === 2 },
  { key: "wind", label: "風", group: "attr", color: "var(--wind)", match: (a) => a.type === 1 && a.attr === 3 },
  { key: "light", label: "光", group: "attr", color: "var(--light)", match: (a) => a.type === 1 && a.attr === 4 },
  { key: "dark", label: "暗", group: "attr", color: "var(--dark)", match: (a) => a.type === 1 && a.attr === 5 },
];

const TYPE_TABS: ArtifactTab[] = [
  { key: "attack", label: "攻擊", group: "type", color: TYPE_COLOR, match: (a) => a.type === 2 && a.style === 1 },
  { key: "defense", label: "防禦", group: "type", color: TYPE_COLOR, match: (a) => a.type === 2 && a.style === 2 },
  { key: "hp", label: "體力", group: "type", color: TYPE_COLOR, match: (a) => a.type === 2 && a.style === 3 },
  { key: "support", label: "支援", group: "type", color: TYPE_COLOR, match: (a) => a.type === 2 && a.style === 4 },
  { key: "special", label: "無形", group: "type", color: TYPE_COLOR, match: (a) => a.attr === 98 || (a.type === 2 && a.style === 98) },
];

const TABS: ArtifactTab[] = [...ATTR_TABS, ...TYPE_TABS];

/** 神器主屬性圖示：盾 = 防禦、雙劍 = 攻擊、心 = 體力（SWGT 風格） */
function MainIcon({ t }: { t: number }) {
  const meta = ARTIFACT_MAIN[t];
  if (!meta) return null;
  const Icon = meta.key === "hp" ? Heart : meta.key === "atk" ? Swords : Shield;
  const color = meta.key === "hp" ? "#ff6b8a" : meta.key === "atk" ? "#f2c65c" : "#6ea8ff";
  return <Icon size={12} strokeWidth={2.2} style={{ color, flex: "none" }} aria-label={meta.label} />;
}

interface TopValue {
  v: number;
  art: Artifact;
}

/** 每件神器只取該效果的最高數值，再排出前 10 名 */
function topValues(artifacts: Artifact[], effect: number): TopValue[] {
  const values: TopValue[] = [];
  for (const a of artifacts) {
    let best = 0;
    for (const s of a.subs) if (s.t === effect && s.v > best) best = s.v;
    if (best > 0) values.push({ v: best, art: a });
  }
  return values.sort((a, b) => b.v - a.v).slice(0, 10);
}

function formatValue(v: number, def: EffectDef): string {
  const sign = def.negative ? "-" : "+";
  const text = def.decimals ? v.toFixed(1) : String(Math.round(v));
  return `${sign}${text}%`;
}

export function ArtifactTopTables({ artifacts }: { artifacts: Artifact[] }) {
  const [tab, setTab] = useState(TABS[0].key);
  const active = TABS.find((t) => t.key === tab) ?? TABS[0];
  const rows = useMemo(() => artifacts.filter(active.match), [artifacts, active]);

  const tabButton = (t: ArtifactTab) => {
    const on = tab === t.key;
    return (
      <button
        key={t.key}
        type="button"
        className="chip"
        title={`${t.group === "attr" ? "屬性神器" : "類型神器"}：${t.label}`}
        style={{
          cursor: "pointer",
          color: on ? "#0b1120" : t.color,
          background: on ? t.color : "transparent",
          borderColor: on ? t.color : "var(--line-soft)",
          fontWeight: on ? 700 : 500,
        }}
        onClick={() => setTab(t.key)}
      >
        {t.label}
      </button>
    );
  };

  const tables = useMemo(
    () =>
      TABLES.map((table) => ({
        ...table,
        columns: table.effects.map((effect) => topValues(rows, effect.t)),
      })),
    [rows],
  );

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <div style={{ minWidth: 0 }}>
          <div className="card-title">
            <Sparkles size={13} className="gold" style={{ verticalAlign: -2, marginRight: 4 }} />
            神器 Top 10 副效果
            <span className="dim tiny" style={{ fontWeight: 400 }}>本組 {rows.length} 件</span>
          </div>
          <div className="card-sub">
            參考 SWGT Artifact 統計：屬性神器（水／火／風／光／暗，用屬性色）與類型神器（攻擊／防禦／體力／支援／無形，青色）以顏色區分，列出每個效果最高的 10 件；數值前的圖示是該件神器的主屬性（盾＝防禦、雙劍＝攻擊、心＝體力），數值已含強化。
          </div>
        </div>
        <div className="row wrap" style={{ gap: 5, justifyContent: "flex-end", alignItems: "center" }}>
          <div className="row" style={{ gap: 5, alignItems: "center", flexWrap: "nowrap" }}>
            <span className="tiny dim">屬性神器</span>
            {ATTR_TABS.map(tabButton)}
          </div>
          <span className="divider-v" />
          <div className="row" style={{ gap: 5, alignItems: "center", flexWrap: "nowrap" }}>
            <span className="tiny dim">類型神器</span>
            {TYPE_TABS.map(tabButton)}
          </div>
        </div>
      </div>

      <div
        className="card-pad"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 14 }}
      >
        {rows.length === 0 ? (
          <div className="empty tiny" style={{ gridColumn: "1 / -1" }}>這個分組沒有神器資料</div>
        ) : (
          tables.map((table) => (
            <div key={table.key} style={{ minWidth: 0 }}>
              <div className="tiny dim" style={{ fontWeight: 700, marginBottom: 4, letterSpacing: ".02em" }}>
                {table.title}
              </div>
              <div className="scroll-y">
                <table className="table swgt-artifact-table">
                  <thead>
                    <tr>
                      <th className="num" style={{ width: 42 }}>#</th>
                      {table.effects.map((e) => (
                        <th key={e.t} className="num">
                          {e.el ? <span className={`el-${e.el}`}>{e.label}</span> : e.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 10 }).map((_, i) => (
                      <tr key={i}>
                        <td className="num mono dim">{i + 1}</td>
                        {table.columns.map((values, ci) => {
                          const cell = values[i] as TopValue | undefined;
                          return (
                            <td key={table.effects[ci].t} className="num mono">
                              {!cell ? (
                                <span className="dim">—</span>
                              ) : (
                                <span
                                  style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}
                                  title={`主屬性：${ARTIFACT_MAIN[cell.art.main.t]?.label ?? "?"}`}
                                >
                                  <MainIcon t={cell.art.main.t} />
                                  {formatValue(cell.v, table.effects[ci])}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
