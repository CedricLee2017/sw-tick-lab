/** 神器減傷統計：依「受到屬性傷害減少」的元素組合分組比較，找出可以賣掉的低數值神器 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Search, Shield, Sparkles } from "lucide-react";
import { unitLabel, useStore } from "../store";
import { ArtifactCard, Modal, fmt } from "../components/ui";
import { ARTIFACT_RANKS, artifactKindText, artifactMainText, artifactSubText, artifactTypeText } from "../lib/artifacts";
import {
  ARTIFACT_REDUCTION_ELEMENT,
  REDUCTION_ELEMENT_ORDER,
  REDUCTION_VERDICT_TEXT,
  artifactReduction,
  reductionComboKey,
  reductionComboLabel,
  reductionElementName,
  reductionVerdict,
  type ArtifactReduction,
  type ReductionVerdict,
} from "../lib/artifactReduction";
import type { Artifact } from "../lib/types";

interface ReductionRow {
  art: Artifact;
  red: ArtifactReduction;
  owner?: string;
  equipped: boolean;
}

interface ReductionGroup {
  key: string;
  elements: number[];
  label: string;
  rows: ReductionRow[];
  best: number;
  avg: number;
}

function Tile({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="stat-tile">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {sub && <div className="u" style={{ marginLeft: 0 }}>{sub}</div>}
    </div>
  );
}

const VERDICT_CLASS: Record<ReductionVerdict, string> = {
  best: "green",
  close: "muted",
  weak: "gold",
  sell: "red",
  equipped: "muted",
};

export default function ArtifactReductionPage() {
  const account = useStore((s) => s.account);
  const [q, setQ] = useState("");
  const [minCount, setMinCount] = useState(2);
  const [comboSize, setComboSize] = useState(0);
  const [sort, setSort] = useState<"count" | "avg" | "best">("count");
  /** null = 預設只展開第一組 */
  const [openKeys, setOpenKeys] = useState<Set<string> | null>(null);
  const [detail, setDetail] = useState<Artifact | null>(null);

  const owner = useMemo(() => {
    const m = new Map<number, string>();
    if (!account) return m;
    for (const u of account.units) for (const aid of u.artifacts) m.set(aid, unitLabel(u));
    return m;
  }, [account]);

  /** 所有有屬性減傷的神器 */
  const rows = useMemo<ReductionRow[]>(() => {
    if (!account) return [];
    const out: ReductionRow[] = [];
    for (const art of account.artifacts) {
      const red = artifactReduction(art);
      if (red.count === 0) continue;
      out.push({ art, red, owner: owner.get(art.id), equipped: art.occupied > 0 });
    }
    return out;
  }, [account, owner]);

  /** 依元素組合分組，並算好每組的最佳 / 平均 */
  const groups = useMemo<ReductionGroup[]>(() => {
    const map = new Map<string, ReductionGroup>();
    for (const row of rows) {
      const key = reductionComboKey(row.red.elements);
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          elements: row.red.elements,
          label: reductionComboLabel(row.red.elements),
          rows: [],
          best: 0,
          avg: 0,
        };
        map.set(key, g);
      }
      g.rows.push(row);
    }
    const out = [...map.values()];
    for (const g of out) {
      g.rows.sort((a, b) => b.red.total - a.red.total || b.art.rank - a.art.rank || a.art.id - b.art.id);
      g.best = g.rows[0]?.red.total ?? 0;
      const sum = g.rows.reduce((s, x) => s + x.red.total, 0);
      g.avg = g.rows.length ? sum / g.rows.length : 0;
    }
    return out;
  }, [rows]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const out = groups
      .filter((g) => g.rows.length >= minCount)
      .filter((g) => (comboSize === 0 ? true : comboSize >= 4 ? g.elements.length >= 4 : g.elements.length === comboSize))
      .map((g) => {
        if (!term) return g;
        const keep = g.rows.filter((row) => {
          const text = [
            String(row.art.id),
            row.art.rank ? ARTIFACT_RANKS[row.art.rank] ?? "" : "",
            artifactMainText(row.art),
            artifactKindText(row.art),
            row.owner ?? "",
            g.label,
            row.red.elements.map(reductionElementName).join(""),
          ].join(" ").toLowerCase();
          return text.includes(term);
        });
        return { ...g, rows: keep };
      })
      .filter((g) => g.rows.length > 0);
    out.sort((a, b) => {
      if (sort === "avg") return b.avg - a.avg || b.rows.length - a.rows.length;
      if (sort === "best") return b.best - a.best || b.rows.length - a.rows.length;
      return b.rows.length - a.rows.length || b.best - a.best;
    });
    return out;
  }, [groups, minCount, comboSize, q, sort]);

  const elementStats = useMemo(() => {
    return REDUCTION_ELEMENT_ORDER.map((el) => {
      const hit = rows.filter((row) => (row.red.values[el] ?? 0) > 0);
      const values = hit.map((row) => row.red.values[el] ?? 0);
      const sum = values.reduce((s, v) => s + v, 0);
      return {
        el,
        name: reductionElementName(el),
        count: hit.length,
        equipped: hit.filter((row) => row.equipped).length,
        avg: hit.length ? sum / hit.length : 0,
        max: values.length ? Math.max(...values) : 0,
        sum,
      };
    });
  }, [rows]);

  const totals = useMemo(() => {
    const count = rows.length;
    const entries = rows.reduce((s, row) => s + row.red.count, 0);
    const threeUp = rows.filter((row) => row.red.count >= 3).length;
    const sum = rows.reduce((s, row) => s + row.red.total, 0);
    return {
      count,
      entries,
      threeUp,
      avg: count ? sum / count : 0,
      total: account?.artifacts.length ?? 0,
    };
  }, [rows, account]);

  /** 同一組合內低於最高值 65%、且未裝備（可以直接賣）的件數 */
  const sellCount = useMemo(() => {
    let n = 0;
    for (const g of groups) {
      for (const row of g.rows) {
        if (!row.equipped && g.best > 0 && row.red.total < g.best * 0.65) n++;
      }
    }
    return n;
  }, [groups]);

  if (!account) return <div className="empty"><Sparkles size={40} /><div>尚未匯入存檔</div></div>;

  const open = openKeys ?? new Set(filtered.slice(0, 1).map((g) => g.key));
  const allOpen = filtered.length > 0 && filtered.every((g) => open.has(g.key));
  const toggleGroup = (key: string) => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpenKeys(next);
  };

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 12 }}>
        <div>
          <div className="card-title row" style={{ gap: 7 }}>
            <Shield size={15} className="gold" /> 神器減傷統計
          </div>
          <div className="card-sub">
            只看「受到屬性傷害減少」（火 / 水 / 風 / 光 / 暗）。相同元素組合的神器會排在一起比較，數值明顯偏低的會標成可賣。
          </div>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="chip gold">
            有減傷 {fmt(totals.count)} / {fmt(totals.total)} 件
          </span>
          {sellCount > 0 && (
            <span className="chip red" title="同組合內合計低於最高值 65%、且目前未裝備（可以直接賣）">
              優先賣出 {fmt(sellCount)} 件
            </span>
          )}
        </div>
      </div>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Tile k="有屬性減傷" v={String(totals.count)} sub={`共 ${fmt(totals.total)} 件神器`} />
        <Tile k="三屬以上" v={String(totals.threeUp)} sub="三條以上減傷" />
        <Tile k="減傷條目" v={String(totals.entries)} sub="305–309 效果總數" />
        <Tile k="平均減傷合計" v={totals.avg.toFixed(1)} sub="每件神器合計" />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div>
            <div className="card-title">各屬性覆蓋情形</div>
            <div className="card-sub">同一件神器同一屬性的減傷取最大值；只在有該屬性減傷的神器上計算平均</div>
          </div>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>屬性</th>
                <th className="num">神器件數</th>
                <th className="num">裝備中</th>
                <th className="num">平均</th>
                <th className="num">最高</th>
                <th className="num">總和</th>
              </tr>
            </thead>
            <tbody>
              {elementStats.map((s) => (
                <tr key={s.el}>
                  <td>{s.name}屬性</td>
                  <td className="num">{fmt(s.count)}</td>
                  <td className="num">{fmt(s.equipped)}</td>
                  <td className="num">{s.count ? s.avg.toFixed(1) : "—"}</td>
                  <td className="num">{s.count ? s.max : "—"}</td>
                  <td className="num">{s.count ? s.sum : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="row filter-row" style={{ gap: 8 }}>
          <div style={{ position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: "var(--muted-2)" }} />
            <input
              className="input"
              style={{ width: 220, paddingLeft: 28 }}
              placeholder="搜尋神器 ID / 主效果 / 擁有者"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select
            className="select"
            style={{ width: 150 }}
            value={comboSize}
            onChange={(e) => setComboSize(Number(e.target.value))}
            title="依神器上「有幾個屬性」的減傷組合分組"
          >
            <option value={0}>全部組合</option>
            <option value={2}>只看兩屬組合</option>
            <option value={3}>只看三屬組合</option>
            <option value={4}>只看四屬以上</option>
          </select>
          <select
            className="select"
            style={{ width: 150 }}
            value={minCount}
            onChange={(e) => setMinCount(Number(e.target.value))}
            title="只列出同組合有 N 件以上的組；數量多才需要比較與淘汰"
          >
            <option value={1}>每組 1 件以上</option>
            <option value={2}>每組 2 件以上</option>
            <option value={3}>每組 3 件以上</option>
            <option value={4}>每組 4 件以上</option>
          </select>
          <select className="select" style={{ width: 132 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="count">組內件數排序</option>
            <option value="avg">平均合計排序</option>
            <option value="best">最高合計排序</option>
          </select>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setOpenKeys(allOpen ? new Set() : new Set(filtered.map((g) => g.key)))}
          >
            {allOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {allOpen ? "全部收合" : "全部展開"}
          </button>
          <span className="tiny dim" style={{ marginLeft: "auto" }}>
            {filtered.length} 組 · {filtered.reduce((s, g) => s + g.rows.length, 0)} 件
          </span>
        </div>
        <div className="tiny dim" style={{ marginTop: 7 }}>
          判定：同組合計最高 =「這組最佳」；85% 以上「接近最佳」；65–85%「偏弱」；低於 65%「優先賣出」。
          裝備中的神器不列入買賣建議，只標示「裝備中」。
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty card" style={{ padding: "40px 16px" }}>
          <Shield size={34} style={{ opacity: 0.3, marginBottom: 8 }} />
          <div style={{ fontWeight: 600, color: "var(--text)" }}>沒有符合條件的減傷神器</div>
          <div className="tiny dim" style={{ marginTop: 4 }}>
            可能是沒有屬性減傷神器，或「每組 2 件以上」的條件太嚴；可放寬組合大小或件數。
          </div>
        </div>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          {filtered.map((g) => {
            const isOpen = open.has(g.key);
            return (
              <div className="card" key={g.key}>
                <button
                  type="button"
                  className="card-head"
                  style={{ width: "100%", background: "transparent", border: 0, cursor: "pointer", textAlign: "left" }}
                  onClick={() => toggleGroup(g.key)}
                  aria-expanded={isOpen}
                >
                  <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
                    <span className="chip gold" title={`元素組合：${g.label}`}>
                      {g.label}減傷
                    </span>
                    <span className="chip muted">{g.rows.length} 件</span>
                    <span className="tiny dim">
                      平均合計 {g.avg.toFixed(1)} · 最高 {g.best} · 最低{" "}
                      {g.rows[g.rows.length - 1]?.red.total ?? 0}
                    </span>
                  </div>
                  <span className="tiny dim row" style={{ gap: 4 }}>
                    {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    {isOpen ? "收合" : "展開比較"}
                  </span>
                </button>
                {isOpen && (
                  <div className="table-scroll">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>神器</th>
                          <th>品質</th>
                          <th>主效果</th>
                          {g.elements.map((el) => (
                            <th key={el} className="num">{reductionElementName(el)}</th>
                          ))}
                          <th className="num">合計</th>
                          <th className="num" title="與這組最高的差距">差距</th>
                          <th>建議</th>
                          <th>擁有者</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((row) => {
                          const verdict = reductionVerdict(row.red, g.best, row.equipped);
                          const diff = g.best - row.red.total;
                          return (
                            <tr
                              key={row.art.id}
                              onClick={() => setDetail(row.art)}
                              style={{ cursor: "pointer" }}
                              title="點擊查看神器詳細資料"
                            >
                              <td className="mono">#{row.art.id}</td>
                              <td>{ARTIFACT_RANKS[row.art.rank] ?? `品質 ${row.art.rank}`}</td>
                              <td>{artifactMainText(row.art)}</td>
                              {g.elements.map((el) => (
                                <td key={el} className="num">{row.red.values[el] ?? "—"}</td>
                              ))}
                              <td className="num gold"><b>{row.red.total}</b></td>
                              <td className="num">{diff > 0 ? `-${diff}` : "—"}</td>
                              <td>
                                <span className={`chip ${VERDICT_CLASS[verdict]}`}>{REDUCTION_VERDICT_TEXT[verdict]}</span>
                              </td>
                              <td>{row.owner ?? "未裝備"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {detail && (
        <Modal title={`神器 #${detail.id}`} onClose={() => setDetail(null)} width={560}>
          <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <ArtifactCard artifact={detail} owner={owner.get(detail.id)} detail />
            </div>
            <div style={{ flex: 1.2 }}>
              <div className="kv"><span className="k">類型</span><span className="v">{artifactTypeText(detail.type)}</span></div>
              <div className="kv"><span className="k">適用</span><span className="v">{artifactKindText(detail)}</span></div>
              <div className="kv"><span className="k">主效果</span><span className="v gold">{artifactMainText(detail)}</span></div>
              <div className="kv"><span className="k">減傷合計</span><span className="v gold">{artifactReduction(detail).total}</span></div>
              <div className="kv"><span className="k">擁有者</span><span className="v">{owner.get(detail.id) ?? "未裝備"}</span></div>
              <div className="kv"><span className="k">遊戲鎖定</span><span className="v">{detail.locked ? "是" : "否"}</span></div>
              <div style={{ marginTop: 10 }}>
                {detail.subs.map((s, i) => {
                  const el = ARTIFACT_REDUCTION_ELEMENT[s.t];
                  return (
                    <div key={i} className="kv">
                      <span className="k">
                        副效果 {i + 1}
                        {el ? <span className="dim tiny"> · 減傷</span> : null}
                      </span>
                      <span className="v" style={{ textAlign: "right" }}>
                        {artifactSubText(s)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
