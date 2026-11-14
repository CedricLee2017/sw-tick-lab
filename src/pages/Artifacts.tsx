import { useMemo, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { unitLabel, useStore } from "../store";
import { ArtifactCard, Modal, fmt } from "../components/ui";
import { useRankIndex } from "../components/RankProvider";
import { averageRankPercent, summarizeRanks } from "../lib/rankings";
import { buildUsageIndex, usageText } from "../lib/usage";
import { artifactMainText, artifactSubText, artifactKindText, artifactTypeText } from "../lib/artifacts";
import type { Artifact } from "../lib/types";

type SortKey = "main" | "rank" | "subrank" | "subrank-desc" | "type" | "id";
type UsageFilter = "all" | "deck" | "rta" | "any" | "none";

export default function ArtifactsPage() {
  const account = useStore((s) => s.account);
  const [q, setQ] = useState("");
  const [type, setType] = useState(0);
  const [attr, setAttr] = useState(0);
  const [onlyFree, setOnlyFree] = useState(false);
  const [usage, setUsage] = useState<UsageFilter>("all");
  const [rankMin, setRankMin] = useState(0);
  const [sort, setSort] = useState<SortKey>("main");
  const [take, setTake] = useState(150);
  const [detail, setDetail] = useState<Artifact | null>(null);
  const ranks = useRankIndex();
  const usageIndex = useMemo(() => buildUsageIndex(account), [account]);

  const usageCounts = useMemo(() => {
    let deck = 0;
    let rta = 0;
    for (const u of usageIndex.artifacts.values()) {
      if (u.deck) deck++;
      if (u.rta) rta++;
    }
    return { deck, rta };
  }, [usageIndex]);

  const owner = useMemo(() => {
    const m = new Map<number, string>();
    if (!account) return m;
    for (const u of account.units) for (const aid of u.artifacts) m.set(aid, unitLabel(u));
    return m;
  }, [account]);

  const artifacts = useMemo(() => {
    if (!account) return [];
    let arr = account.artifacts.filter((a) => {
      if (type && a.type !== type) return false;
      if (attr && a.attr !== attr) return false;
      if (onlyFree && a.occupied > 0) return false;
      if (usage !== "all") {
        const u = usageIndex.artifacts.get(a.id);
        const inDeck = !!u?.deck;
        const inRta = !!u?.rta;
        if (usage === "deck" && !inDeck) return false;
        if (usage === "rta" && !inRta) return false;
        if (usage === "any" && !inDeck && !inRta) return false;
        if (usage === "none" && (inDeck || inRta)) return false;
      }
      if (rankMin > 0) {
        // 與符文一樣：連最好的一條副效果都要在門檻之後
        const summary = summarizeRanks(ranks?.artifacts.get(a.id)?.subs);
        if (summary.count < 2 || summary.best * 100 < rankMin) return false;
      }
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
      if (sort === "subrank") {
        // 副效果排名：四條效果在同組的百分位平均，越前面（100%）越好
        const ra = averageRankPercent(ranks?.artifacts.get(a.id)?.subs);
        const rb = averageRankPercent(ranks?.artifacts.get(b.id)?.subs);
        return ra - rb || b.main.v - a.main.v;
      }
      if (sort === "subrank-desc") {
        // 差 → 好：連最好那條都排得後的先列出
        const ra = summarizeRanks(ranks?.artifacts.get(a.id)?.subs);
        const rb = summarizeRanks(ranks?.artifacts.get(b.id)?.subs);
        return rb.best - ra.best || rb.avg - ra.avg || a.main.v - b.main.v;
      }
      if (sort === "type") return a.type - b.type || a.attr - b.attr;
      if (sort === "id") return a.id - b.id;
      return b.main.v - a.main.v || b.rank - a.rank;
    });
    return arr;
  }, [account, q, type, attr, onlyFree, usage, rankMin, sort, owner, ranks, usageIndex]);

  if (!account) return <div className="empty"><Sparkles size={40} /><div>尚未匯入存檔</div></div>;

  const shown = artifacts.slice(0, take);
  const detailRank = detail ? summarizeRanks(ranks?.artifacts.get(detail.id)?.subs) : null;

  /** 一鍵找出「未在預設隊 / RTA、副效果全部排最後 20%」的神器 */
  const sellCandidates = () => {
    setQ("");
    setType(0);
    setAttr(0);
    setOnlyFree(false);
    setUsage("none");
    setRankMin(80);
    setSort("subrank-desc");
  };
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
              共 {fmt(account.artifacts.length)} 件（已裝備 {fmt(equipped)} · 預設隊 {fmt(usageCounts.deck)} · RTA {fmt(usageCounts.rta)}）
            </span>
          </div>
          <div className="row filter-row" style={{ gap: 8 }}>
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
            <select
              className="select"
              style={{ width: 150 }}
              value={usage}
              onChange={(e) => setUsage(e.target.value as UsageFilter)}
              title="存檔匯出當下：是否在遊戲內預設隊 / 防守隊、或世界競技場（RTA）配裝中使用"
            >
              <option value="all">全部使用狀況</option>
              <option value="deck">預設隊使用中</option>
              <option value="rta">RTA 使用中</option>
              <option value="any">預設隊或 RTA</option>
              <option value="none">未在預設隊 / RTA</option>
            </select>
            <select
              className="select"
              style={{ width: 162 }}
              value={rankMin}
              onChange={(e) => setRankMin(Number(e.target.value))}
              title="只留下每一條副效果都排在該組最後 N% 的神器"
            >
              <option value={0}>不限副效果排名</option>
              <option value={50}>副效果全排最後 50%</option>
              <option value={70}>副效果全排最後 30%</option>
              <option value={80}>副效果全排最後 20%</option>
              <option value={90}>副效果全排最後 10%</option>
            </select>
            <select className="select" style={{ width: 120 }} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="main">主效果排序</option>
              <option value="rank">品質排序</option>
              <option value="subrank">副效果排名（好→差）</option>
              <option value="subrank-desc">副效果排名（差→好）</option>
              <option value="type">類型排序</option>
              <option value="id">ID 排序</option>
            </select>
          </div>
        </div>
        <div className="card-pad row wrap" style={{ gap: 14, borderBottom: "1px solid var(--line-soft)" }}>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} /> 只看未裝備
          </label>
          <button
            type="button"
            className="btn btn-sm"
            onClick={sellCandidates}
            title="篩選：未在預設隊 / RTA、副效果全部排最後 20%，並由差到好排列"
          >
            可賣候選
          </button>
          <span
            className="chip muted"
            title="每條副效果後面的數字是「名次 / 同組有這條效果的數量」，1 = 最高。分組方式：屬性神器看同屬性、類型神器看同魔靈類型。"
          >
            副效果排名＝同類型同屬性
          </span>
          <span className="tiny dim">
            屬性 {[1, 2, 3, 4, 5].map((n) => `${["水", "火", "風", "光", "暗"][n - 1]} ${attrCounts.get(n) ?? 0}`).join(" · ")}
            {"　"}特殊 {attrCounts.get(98) ?? 0} · 類型 {account.artifacts.filter((a) => a.type === 2).length}
          </span>
          <span className="dim tiny" style={{ marginLeft: "auto" }}>顯示 {shown.length} / {artifacts.length}</span>
        </div>

        <div className="card-pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10 }}>
          {shown.map((a) => (
            <ArtifactCard
              key={a.id}
              artifact={a}
              owner={owner.get(a.id)}
              usage={usageIndex.artifacts.get(a.id)}
              onClick={() => setDetail(a)}
            />
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
              <ArtifactCard artifact={detail} owner={owner.get(detail.id)} usage={usageIndex.artifacts.get(detail.id)} detail />
            </div>
            <div style={{ flex: 1.2 }}>
              <div className="kv"><span className="k">類型</span><span className="v">{artifactTypeText(detail.type)}</span></div>
              <div className="kv"><span className="k">適用</span><span className="v">{artifactKindText(detail)}</span></div>
              <div className="kv"><span className="k">等級</span><span className="v">+{detail.level}</span></div>
              <div className="kv"><span className="k">主效果</span><span className="v gold">{artifactMainText(detail)}</span></div>
              <div className="kv"><span className="k">擁有者</span><span className="v">{owner.get(detail.id) ?? "未裝備"}</span></div>
              <div className="kv">
                <span className="k">使用狀況</span>
                <span className="v" title="以存檔匯出當下的預設隊 / 防守隊與 RTA 配裝判斷">{usageText(usageIndex.artifacts.get(detail.id))}</span>
              </div>
              <div className="kv">
                <span className="k">排名統計</span>
                <span className="v" title="百分位 0% = 同組第一、100% = 同組最後；只計同組有 2 件以上的副效果">
                  {detailRank && detailRank.count >= 2
                    ? `平均 ${Math.round(detailRank.avg * 100)}% · 最好 ${Math.round(detailRank.best * 100)}% · 最差 ${Math.round(detailRank.worst * 100)}%（${detailRank.count} 條）`
                    : "同組太少，無法比較"}
                </span>
              </div>
              <div className="kv"><span className="k">同組神器</span><span className="v">{ranks?.artifacts.get(detail.id)?.pool ?? "—"} 件（{artifactTypeText(detail.type)} · {artifactKindText(detail)}）</span></div>
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
