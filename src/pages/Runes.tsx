import { useMemo, useState } from "react";
import { Gem, Search, X } from "lucide-react";
import { useStore, monsterLabel } from "../store";
import { RUNE_SETS, SET_BY_ID, STAT_TYPES } from "../lib/constants";
import { Modal, RuneCard, fmt, setColor, statText } from "../components/ui";
import type { Rune } from "../lib/types";

export default function RunesPage() {
  const account = useStore((s) => s.account);
  const lockedRunes = useStore((s) => s.settings.lockedRunes);
  const excludedRunes = useStore((s) => s.settings.excludedRunes);
  const toggleRuneFlag = useStore((s) => s.toggleRuneFlag);
  const lockedSet = useMemo(() => new Set(lockedRunes), [lockedRunes]);
  const excludedSet = useMemo(() => new Set(excludedRunes), [excludedRunes]);
  const [q, setQ] = useState("");
  const [setId, setSetId] = useState(0);
  const [slot, setSlot] = useState(0);
  const [grade, setGrade] = useState(0);
  const [onlyFree, setOnlyFree] = useState(false);
  const [onlyLocked, setOnlyLocked] = useState(false);
  const [onlyExcluded, setOnlyExcluded] = useState(false);
  const [minEff, setMinEff] = useState(0);
  const [sort, setSort] = useState<"eff" | "grade" | "spd" | "slot">("eff");
  const [take, setTake] = useState(150);
  const [detail, setDetail] = useState<Rune | null>(null);

  const owner = useMemo(() => {
    const m = new Map<number, string>();
    if (!account) return m;
    for (const u of account.units) for (const rid of u.runes) m.set(rid, monsterLabel(u.master));
    return m;
  }, [account]);

  const runes = useMemo(() => {
    if (!account) return [];
    let arr = account.runes.filter((r) => {
      if (setId && r.set !== setId) return false;
      if (slot && r.slot !== slot) return false;
      if (grade && r.grade !== grade) return false;
      if (onlyFree && r.occupied > 0) return false;
      if (onlyLocked && !lockedSet.has(r.id)) return false;
      if (onlyExcluded && !excludedSet.has(r.id)) return false;
      if (minEff && r.eff < minEff) return false;
      if (q) {
        const text = `${SET_BY_ID[r.set]?.name ?? ""} ${SET_BY_ID[r.set]?.en ?? ""} ${STAT_TYPES[r.main.t]?.label ?? ""} ${owner.get(r.id) ?? ""}`.toLowerCase();
        if (!text.includes(q.toLowerCase())) return false;
      }
      return true;
    });
    arr = arr.sort((a, b) => {
      if (sort === "eff") return b.eff - a.eff;
      if (sort === "grade") return b.grade - a.grade || b.eff - a.eff;
      if (sort === "slot") return a.slot - b.slot || b.eff - a.eff;
      const sa = a.subs.find((s) => s.t === 8)?.v ?? 0;
      const sb = b.subs.find((s) => s.t === 8)?.v ?? 0;
      return sb - sa || b.eff - a.eff;
    });
    return arr;
  }, [account, q, setId, slot, grade, onlyFree, onlyLocked, onlyExcluded, minEff, sort, owner, lockedSet, excludedSet]);

  if (!account) return <div className="empty"><Gem size={40} /><div>尚未匯入存檔</div></div>;

  const shown = runes.slice(0, take);

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div className="card-title">符文倉庫 <span className="dim tiny" style={{ fontWeight: 400 }}>共 {fmt(runes.length)} 顆</span></div>
          <div className="row" style={{ gap: 8 }}>
            <div style={{ position: "relative" }}>
              <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: "var(--muted-2)" }} />
              <input className="input" style={{ width: 190, paddingLeft: 28 }} placeholder="搜尋套裝 / 屬性 / 擁有者" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className="select" style={{ width: 130 }} value={setId} onChange={(e) => setSetId(Number(e.target.value))}>
              <option value={0}>全部套裝</option>
              {RUNE_SETS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select className="select" style={{ width: 96 }} value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
              <option value={0}>全部位置</option>
              {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>位置 {n}</option>)}
            </select>
            <select className="select" style={{ width: 96 }} value={grade} onChange={(e) => setGrade(Number(e.target.value))}>
              <option value={0}>全部星級</option>
              {[6, 5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}★</option>)}
            </select>
            <select className="select" style={{ width: 120 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="eff">效率排序</option>
              <option value="spd">速度排序</option>
              <option value="grade">星級排序</option>
              <option value="slot">位置排序</option>
            </select>
          </div>
        </div>
        <div className="card-pad row wrap" style={{ gap: 14, borderBottom: "1px solid var(--line-soft)" }}>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} /> 只看未裝備
          </label>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={onlyLocked} onChange={(e) => setOnlyLocked(e.target.checked)} /> 只看鎖定
          </label>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={onlyExcluded} onChange={(e) => setOnlyExcluded(e.target.checked)} /> 只看排除
          </label>
          <div className="row tiny" style={{ gap: 8, flex: 1, maxWidth: 320 }}>
            <span>最低效率 {minEff}%</span>
            <input type="range" min={0} max={120} step={5} value={minEff} onChange={(e) => setMinEff(Number(e.target.value))} style={{ flex: 1 }} />
          </div>
          <span className="dim tiny" style={{ marginLeft: "auto" }}>顯示 {shown.length} / {runes.length}</span>
        </div>

        <div className="card-pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 10 }}>
          {shown.map((r) => (
            <RuneCard
              key={r.id}
              rune={r}
              owner={owner.get(r.id)}
              locked={lockedSet.has(r.id)}
              excluded={excludedSet.has(r.id)}
              onToggleLock={() => toggleRuneFlag("locked", r.id)}
              onToggleExclude={() => toggleRuneFlag("excluded", r.id)}
              onClick={() => setDetail(r)}
            />
          ))}
          {runes.length === 0 && <div className="empty" style={{ gridColumn: "1/-1" }}>沒有符合條件的符文</div>}
        </div>

        {take < runes.length && (
          <div className="card-pad" style={{ display: "flex", justifyContent: "center" }}>
            <button className="btn" onClick={() => setTake((t) => t + 200)}>載入更多（剩餘 {runes.length - take}）</button>
          </div>
        )}
      </div>

      {detail && (
        <Modal title={`符文 #${detail.id}`} onClose={() => setDetail(null)} width={520}>
          <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <RuneCard
                rune={detail}
                owner={owner.get(detail.id)}
                locked={lockedSet.has(detail.id)}
                excluded={excludedSet.has(detail.id)}
                onToggleLock={() => toggleRuneFlag("locked", detail.id)}
                onToggleExclude={() => toggleRuneFlag("excluded", detail.id)}
              />
            </div>
            <div style={{ flex: 1.2 }}>
              <div className="kv"><span className="k">套裝</span><span className="v">{SET_BY_ID[detail.set]?.name}（{SET_BY_ID[detail.set]?.pieces} 件）</span></div>
              <div className="kv"><span className="k">位置</span><span className="v">#{detail.slot}</span></div>
              <div className="kv"><span className="k">星級 / 等級</span><span className="v">{detail.grade}★ +{detail.level}</span></div>
              <div className="kv"><span className="k">效率</span><span className="v gold">{detail.eff.toFixed(1)}%</span></div>
              <div className="kv"><span className="k">主屬性</span><span className="v">{statText(detail.main.t, detail.main.v)}</span></div>
              {detail.prefix.t > 0 && <div className="kv"><span className="k">固有屬性</span><span className="v">{statText(detail.prefix.t, detail.prefix.v)}</span></div>}
              <div className="kv"><span className="k">精煉（磨石）</span><span className="v">{[...detail.subs].reduce((s, x) => s + x.g, 0)}</span></div>
              <div className="kv"><span className="k">擁有者</span><span className="v">{owner.get(detail.id) ?? "未裝備"}</span></div>
              <div className="kv"><span className="k">古代符文</span><span className="v">{detail.ancient ? "是" : "否"}</span></div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
