import { useEffect, useMemo, useState } from "react";
import { Gem, Search, X } from "lucide-react";
import { useStore, monsterLabel } from "../store";
import { RUNE_SETS, SET_BY_ID, STAT_TYPES } from "../lib/constants";
import { runeScore } from "../lib/stats";
import { grindMax, grindStatSuffix } from "../lib/grind";
import { Modal, NumberInput, RuneCard, fmt, setColor, statText } from "../components/ui";
import type { Rune } from "../lib/types";

/** 主屬性 / 副屬性的篩選順序：速度、百分比、爆擊、命中抵抗、固定值 */
const STAT_OPTIONS = [8, 2, 4, 6, 9, 10, 11, 12, 1, 3, 5];
const SLOTS = [1, 2, 3, 4, 5, 6];

type AncientFilter = "all" | "only" | "exclude";
type GrindFilter = "all" | "grinded" | "none" | "headroom" | "max";

export default function RunesPage() {
  const account = useStore((s) => s.account);
  const lockedRunes = useStore((s) => s.settings.lockedRunes);
  const excludedRunes = useStore((s) => s.settings.excludedRunes);
  const toggleRuneFlag = useStore((s) => s.toggleRuneFlag);
  const lockedSet = useMemo(() => new Set(lockedRunes), [lockedRunes]);
  const excludedSet = useMemo(() => new Set(excludedRunes), [excludedRunes]);
  const [q, setQ] = useState("");
  const [setId, setSetId] = useState(0);
  const [slots, setSlots] = useState<number[]>([]);
  const [grade, setGrade] = useState(0);
  const [mainStat, setMainStat] = useState(0);
  const [subStat, setSubStat] = useState(0);
  const [subMin, setSubMin] = useState(0);
  const [prefixStat, setPrefixStat] = useState(0);
  const [ancient, setAncient] = useState<AncientFilter>("all");
  const [grindState, setGrindState] = useState<GrindFilter>("all");
  const [onlyFree, setOnlyFree] = useState(false);
  const [onlyLocked, setOnlyLocked] = useState(false);
  const [onlyExcluded, setOnlyExcluded] = useState(false);
  const [minEff, setMinEff] = useState(0);
  const [sort, setSort] = useState<"eff" | "score" | "grade" | "spd" | "slot">("eff");
  const [take, setTake] = useState(150);
  const [detail, setDetail] = useState<Rune | null>(null);

  // 換篩選條件時回到第一頁，避免停在舊的「載入更多」數量
  useEffect(() => {
    setTake(150);
  }, [q, setId, slots, grade, mainStat, subStat, subMin, prefixStat, ancient, grindState, onlyFree, onlyLocked, onlyExcluded, minEff, sort]);

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
      if (slots.length > 0 && !slots.includes(r.slot)) return false;
      if (grade && r.grade !== grade) return false;
      if (mainStat && r.main.t !== mainStat) return false;
      if (prefixStat === -1 ? !(r.prefix.t > 0) : prefixStat > 0 && r.prefix.t !== prefixStat) return false;
      if (subStat) {
        const sub = r.subs.find((s) => s.t === subStat);
        if (!sub) return false;
        if (subMin > 0 && sub.v + (sub.g ?? 0) < subMin) return false;
      }
      if (ancient === "only" && !r.ancient) return false;
      if (ancient === "exclude" && r.ancient) return false;
      if (grindState !== "all") {
        const grindable = r.subs.filter((s) => grindMax(s.t, r.ancient) > 0);
        const total = grindable.reduce((n, s) => n + (s.g ?? 0), 0);
        const headroom = grindable.some((s) => (s.g ?? 0) < grindMax(s.t, r.ancient));
        if (grindState === "grinded" && total <= 0) return false;
        if (grindState === "none" && total > 0) return false;
        if (grindState === "headroom" && !headroom) return false;
        if (grindState === "max" && (!grindable.length || headroom)) return false;
      }
      if (onlyFree && r.occupied > 0) return false;
      if (onlyLocked && !lockedSet.has(r.id)) return false;
      if (onlyExcluded && !excludedSet.has(r.id)) return false;
      if (minEff && r.eff < minEff) return false;
      if (q) {
        const text = [
          SET_BY_ID[r.set]?.name ?? "",
          SET_BY_ID[r.set]?.en ?? "",
          STAT_TYPES[r.main.t]?.label ?? "",
          STAT_TYPES[r.prefix.t]?.label ?? "",
          ...r.subs.map((s) => STAT_TYPES[s.t]?.label ?? ""),
          owner.get(r.id) ?? "",
        ].join(" ").toLowerCase();
        if (!text.includes(q.toLowerCase())) return false;
      }
      return true;
    });
    arr = arr.sort((a, b) => {
      if (sort === "eff") return b.eff - a.eff;
      if (sort === "score") return runeScore(b) - runeScore(a) || b.eff - a.eff;
      if (sort === "grade") return b.grade - a.grade || b.eff - a.eff;
      if (sort === "slot") return a.slot - b.slot || b.eff - a.eff;
      const sa = a.subs.find((s) => s.t === 8)?.v ?? 0;
      const sb = b.subs.find((s) => s.t === 8)?.v ?? 0;
      return sb - sa || b.eff - a.eff;
    });
    return arr;
  }, [account, q, setId, slots, grade, mainStat, subStat, subMin, prefixStat, ancient, grindState, onlyFree, onlyLocked, onlyExcluded, minEff, sort, owner, lockedSet, excludedSet]);

  const dirty =
    !!q || setId !== 0 || slots.length > 0 || grade !== 0 || mainStat !== 0 ||
    subStat !== 0 || subMin !== 0 || prefixStat !== 0 || ancient !== "all" ||
    grindState !== "all" || onlyFree || onlyLocked || onlyExcluded || minEff > 0;

  const clearFilters = () => {
    setQ("");
    setSetId(0);
    setSlots([]);
    setGrade(0);
    setMainStat(0);
    setSubStat(0);
    setSubMin(0);
    setPrefixStat(0);
    setAncient("all");
    setGrindState("all");
    setOnlyFree(false);
    setOnlyLocked(false);
    setOnlyExcluded(false);
    setMinEff(0);
  };

  const toggleSlot = (n: number) => {
    setSlots((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n].sort((a, b) => a - b)));
  };

  if (!account) return <div className="empty"><Gem size={40} /><div>尚未匯入存檔</div></div>;

  const shown = runes.slice(0, take);

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            符文倉庫 <span className="dim tiny" style={{ fontWeight: 400 }}>共 {fmt(runes.length)} 顆</span>
            <a className="chip gold" href="#/grind" style={{ marginLeft: 8, textDecoration: "none" }} title="依符文素質與裝備對象列出精煉順序">
              精煉建議 →
            </a>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <span className="chip muted" title="符合篩選 / 全部符文">顯示 {fmt(runes.length)} / {fmt(account.runes.length)} 顆</span>
            {dirty && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={clearFilters}>
                <X size={13} /> 清除篩選
              </button>
            )}
          </div>
        </div>

        <div className="card-pad" style={{ display: "flex", flexDirection: "column", gap: 10, borderBottom: "1px solid var(--line-soft)" }}>
          <div className="row wrap filter-row" style={{ gap: 8 }}>
            <div style={{ position: "relative" }}>
              <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: "var(--muted-2)" }} />
              <input className="input" style={{ width: 200, paddingLeft: 28 }} placeholder="搜尋套裝 / 屬性 / 擁有者" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className="select" style={{ width: 130 }} value={setId} onChange={(e) => setSetId(Number(e.target.value))}>
              <option value={0}>全部套裝</option>
              {RUNE_SETS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select className="select" style={{ width: 130 }} value={mainStat} onChange={(e) => setMainStat(Number(e.target.value))} title="依主屬性篩選">
              <option value={0}>全部主屬性</option>
              {STAT_OPTIONS.map((t) => <option key={t} value={t}>{STAT_TYPES[t]?.label}</option>)}
            </select>
            <select className="select" style={{ width: 130 }} value={subStat} onChange={(e) => { setSubStat(Number(e.target.value)); setSubMin(0); }} title="必須含有這條副屬性">
              <option value={0}>全部副屬性</option>
              {STAT_OPTIONS.map((t) => <option key={t} value={t}>{STAT_TYPES[t]?.label}</option>)}
            </select>
            {subStat > 0 && (
              <div className="row" style={{ gap: 4 }} title="副屬性的最低數值（含精煉）">
                <span className="tiny dim">≥</span>
                <NumberInput className="input mono" style={{ width: 72 }} min={0} max={3000} step={1} value={subMin} onChange={setSubMin} />
                <span className="tiny dim">{grindStatSuffix(subStat)}</span>
              </div>
            )}
            <select className="select" style={{ width: 136 }} value={prefixStat} onChange={(e) => setPrefixStat(Number(e.target.value))} title="依固有屬性篩選">
              <option value={0}>全部固有屬性</option>
              <option value={-1}>有固有屬性</option>
              {STAT_OPTIONS.map((t) => <option key={t} value={t}>{STAT_TYPES[t]?.label}</option>)}
            </select>
          </div>

          <div className="row wrap" style={{ gap: 8 }}>
            <span className="tiny dim">位置</span>
            <button
              type="button"
              className={`chip ${slots.length === 0 ? "gold" : "muted"}`}
              style={{ cursor: "pointer" }}
              aria-pressed={slots.length === 0}
              onClick={() => setSlots([])}
            >
              全部
            </button>
            {SLOTS.map((n) => (
              <button
                key={n}
                type="button"
                className={`chip ${slots.includes(n) ? "gold" : "muted"}`}
                style={{ cursor: "pointer", minWidth: 34, justifyContent: "center" }}
                aria-pressed={slots.includes(n)}
                onClick={() => toggleSlot(n)}
                title={`位置 ${n}（可多選）`}
              >
                {n}
              </button>
            ))}
            <span style={{ width: 1, height: 18, background: "var(--line-soft)", margin: "0 2px" }} />
            <select className="select" style={{ width: 100 }} value={grade} onChange={(e) => setGrade(Number(e.target.value))}>
              <option value={0}>全部星級</option>
              {[6, 5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}★</option>)}
            </select>
            <select className="select" style={{ width: 116 }} value={ancient} onChange={(e) => setAncient(e.target.value as AncientFilter)}>
              <option value="all">全部符文</option>
              <option value="only">只看遠古</option>
              <option value="exclude">排除遠古</option>
            </select>
            <select className="select" style={{ width: 132 }} value={grindState} onChange={(e) => setGrindState(e.target.value as GrindFilter)} title="依磨石精煉狀態篩選">
              <option value="all">全部精煉</option>
              <option value="grinded">已有精煉</option>
              <option value="none">尚未精煉</option>
              <option value="headroom">還能再精煉</option>
              <option value="max">已精煉到上限</option>
            </select>
            <select className="select" style={{ width: 120 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="eff">效率排序</option>
              <option value="score">遊戲分數排序</option>
              <option value="spd">速度排序</option>
              <option value="grade">星級排序</option>
              <option value="slot">位置排序</option>
            </select>
          </div>

          <div className="row wrap" style={{ gap: 14 }}>
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
          </div>
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
              <div className="kv"><span className="k">遊戲分數</span><span className="v gold">◆ {runeScore(detail)}</span></div>
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
