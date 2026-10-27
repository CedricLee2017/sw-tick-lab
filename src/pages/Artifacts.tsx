import { useMemo, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { useStore, monsterLabel } from "../store";
import { ArtifactCard, Modal, fmt } from "../components/ui";
import { artifactMainText, artifactSubText, artifactKindText, artifactTypeText } from "../lib/artifacts";
import type { Artifact } from "../lib/types";

type SortKey = "main" | "rank" | "type" | "id";

export default function ArtifactsPage() {
  const account = useStore((s) => s.account);
  const [q, setQ] = useState("");
  const [type, setType] = useState(0);
  const [attr, setAttr] = useState(0);
  const [onlyFree, setOnlyFree] = useState(false);
  const [sort, setSort] = useState<SortKey>("main");
  const [take, setTake] = useState(150);
  const [detail, setDetail] = useState<Artifact | null>(null);

  const owner = useMemo(() => {
    const m = new Map<number, string>();
    if (!account) return m;
    for (const u of account.units) for (const aid of u.artifacts) m.set(aid, monsterLabel(u.master));
    return m;
  }, [account]);

  const artifacts = useMemo(() => {
    if (!account) return [];
    let arr = account.artifacts.filter((a) => {
      if (type && a.type !== type) return false;
      if (attr && a.attr !== attr) return false;
      if (onlyFree && a.occupied > 0) return false;
      if (q) {
        const text = [
          artifactTypeText(a.type),
          artifactKindText(a),
          artifactMainText(a),
          owner.get(a.id) ?? "",
          ...a.subs.map(artifactSubText),
        ].join(" ").toLowerCase();
        if (!text.includes(q.toLowerCase())) return false;
      }
      return true;
    });
    arr = [...arr].sort((a, b) => {
      if (sort === "rank") return b.rank - a.rank || b.main.v - a.main.v;
      if (sort === "type") return a.type - b.type || a.attr - b.attr;
      if (sort === "id") return a.id - b.id;
      return b.main.v - a.main.v || b.rank - a.rank;
    });
    return arr;
  }, [account, q, type, attr, onlyFree, sort, owner]);

  if (!account) return <div className="empty"><Sparkles size={40} /><div>尚未匯入存檔</div></div>;

  const shown = artifacts.slice(0, take);
  const equipped = account.artifacts.filter((a) => a.occupied > 0).length;
  const attrCounts = new Map<number, number>();
  for (const a of account.artifacts) {
    const key = a.type === 2 ? 100 + a.style : a.attr;
    attrCounts.set(key, (attrCounts.get(key) ?? 0) + 1);
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            神器倉庫 <span className="dim tiny" style={{ fontWeight: 400 }}>
              共 {fmt(account.artifacts.length)} 件（已裝備 {fmt(equipped)}）
            </span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div style={{ position: "relative" }}>
              <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: "var(--muted-2)" }} />
              <input className="input" style={{ width: 210, paddingLeft: 28 }} placeholder="搜尋效果 / 類型 / 擁有者" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className="select" style={{ width: 118 }} value={type} onChange={(e) => setType(Number(e.target.value))}>
              <option value={0}>全部類型</option>
              <option value={1}>屬性神器</option>
              <option value={2}>類型神器</option>
            </select>
            <select className="select" style={{ width: 118 }} value={attr} onChange={(e) => setAttr(Number(e.target.value))}>
              <option value={0}>全部屬性</option>
              <option value={1}>水屬性</option>
              <option value={2}>火屬性</option>
              <option value={3}>風屬性</option>
              <option value={4}>光屬性</option>
              <option value={5}>暗屬性</option>
              <option value={98}>特殊</option>
            </select>
            <select className="select" style={{ width: 110 }} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="main">主效果排序</option>
              <option value="rank">品質排序</option>
              <option value="type">類型排序</option>
              <option value="id">ID 排序</option>
            </select>
          </div>
        </div>
        <div className="card-pad row wrap" style={{ gap: 14, borderBottom: "1px solid var(--line-soft)" }}>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} /> 只看未裝備
          </label>
          <span className="tiny dim">
            屬性 {[1, 2, 3, 4, 5].map((n) => `${["水", "火", "風", "光", "暗"][n - 1]} ${attrCounts.get(n) ?? 0}`).join(" · ")}
            {"　"}特殊 {attrCounts.get(98) ?? 0} · 類型 {account.artifacts.filter((a) => a.type === 2).length}
          </span>
          <span className="dim tiny" style={{ marginLeft: "auto" }}>顯示 {shown.length} / {artifacts.length}</span>
        </div>

        <div className="card-pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10 }}>
          {shown.map((a) => (
            <ArtifactCard key={a.id} artifact={a} owner={owner.get(a.id)} onClick={() => setDetail(a)} />
          ))}
          {artifacts.length === 0 && <div className="empty" style={{ gridColumn: "1/-1" }}>沒有符合條件的神器</div>}
        </div>

        {take < artifacts.length && (
          <div className="card-pad" style={{ display: "flex", justifyContent: "center" }}>
            <button className="btn" onClick={() => setTake((t) => t + 200)}>載入更多（剩餘 {artifacts.length - take}）</button>
          </div>
        )}
      </div>

      {detail && (
        <Modal title={`神器 #${detail.id}`} onClose={() => setDetail(null)} width={560}>
          <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <ArtifactCard artifact={detail} owner={owner.get(detail.id)} detail />
            </div>
            <div style={{ flex: 1.2 }}>
              <div className="kv"><span className="k">類型</span><span className="v">{artifactTypeText(detail.type)}</span></div>
              <div className="kv"><span className="k">適用</span><span className="v">{artifactKindText(detail)}</span></div>
              <div className="kv"><span className="k">等級</span><span className="v">+{detail.level}</span></div>
              <div className="kv"><span className="k">主效果</span><span className="v gold">{artifactMainText(detail)}</span></div>
              <div className="kv"><span className="k">擁有者</span><span className="v">{owner.get(detail.id) ?? "未裝備"}</span></div>
              <div className="kv"><span className="k">神器 ID</span><span className="v mono">{detail.id}</span></div>
              <div style={{ marginTop: 10 }}>
                {detail.subs.map((s, i) => (
                  <div key={i} className="kv">
                    <span className="k">副效果 {i + 1}</span>
                    <span className="v" style={{ textAlign: "right" }}>{artifactSubText(s)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
