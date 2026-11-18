import { useEffect, useMemo, useState } from "react";
import { Hammer, Search } from "lucide-react";
import { MONSTER_MAP, useStore } from "../store";
import { SET_BY_ID } from "../lib/constants";
import { matchesRuneTag } from "../lib/runeTags";
import type { RuneTagRule } from "../lib/types";
import { EmptyState, NumberInput, RuneCard } from "../components/ui";
import {
  GRIND_ACCEPT_LEVELS,
  GRIND_GRADE_LABEL,
  GRIND_PROFILES,
  GRIND_SORTS,
  analyzeGrind,
  grindStatLabel,
  grindStatSuffix,
  maxScoreWithStock,
  planMaterials,
  planScore,
  planWithStock,
  sortGrindTargets,
  stoneGain,
  type GrindAccept,
  type GrindOwner,
  type GrindProfile,
  type GrindSort,
  type GrindTarget,
} from "../lib/grind";
import type { Grindstone } from "../lib/types";
import { buildRuneUseCounts, COMMON_SORTS, type CommonSort, type RuneUseCount } from "../lib/usage";

const SLOTS = [1, 2, 3, 4, 5, 6];

const STAT_FILTERS = [
  { value: 0, label: "全部副屬性" },
  { value: 8, label: "速度" },
  { value: 2, label: "體力%" },
  { value: 4, label: "攻擊力%" },
  { value: 6, label: "防禦力%" },
  { value: -1, label: "固定值（HP / ATK / DEF）" },
];

function Tile({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="stat-tile">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {sub && <div className="u" style={{ marginLeft: 0 }}>{sub}</div>}
    </div>
  );
}

function TargetCard({
  t,
  accept,
  showAccept,
  showScore,
  targetScore,
  stock,
  useCount,
  locked,
  excluded,
  tags,
  onToggleLock,
  onToggleExclude,
}: {
  t: GrindTarget;
  accept: GrindAccept;
  showAccept: boolean;
  showScore: boolean;
  targetScore: number;
  /** 有提供時，精煉計畫會依持有素材的上限計算 */
  stock?: Grindstone[];
  /** 「常用符文」方向：這顆符文在預設隊 / RTA 的使用次數 */
  useCount?: RuneUseCount;
  locked: boolean;
  excluded: boolean;
  /** 這顆符文符合的自行分類名稱 */
  tags?: string[];
  onToggleLock: () => void;
  onToggleExclude: () => void;
}) {
  const gain = t.effAfter - t.effNow;
  const plan = showScore
    ? stock
      ? planWithStock(t, targetScore, stock).plan
      : planScore(t, targetScore)
    : [];
  const materials = showScore && stock ? planMaterials(t.rune, plan, stock) : null;
  const stockMax = stock ? maxScoreWithStock(t, stock) : null;
  const planGain = plan.reduce((s, x) => s + x.gain, 0);
  const extra = t.reasons.filter(
    (r) => !r.startsWith("裝備於") && r !== "未裝備" && !r.endsWith("符文") && !r.startsWith("效率"),
  );
  return (
    <RuneCard
      rune={t.rune}
      owner={t.owner ?? undefined}
      locked={locked}
      excluded={excluded}
      tags={tags}
      onToggleLock={onToggleLock}
      onToggleExclude={onToggleExclude}
    >
      <div className="row wrap" style={{ gap: 6 }}>
        {useCount && (
          <span
            className="chip gold"
            title={`預設隊 / 防守隊使用 ${useCount.deck} 次，RTA 使用 ${useCount.rta} 次（匯出當下的快照）`}
          >
            常用 {useCount.total} 次
            <span className="dim"> · 預設隊 {useCount.deck} / RTA {useCount.rta}</span>
          </span>
        )}
        {showScore ? (
          <span
            className="chip gold"
            title={stock ? "用目前持有的磨石等級精滿後能達到的遊戲分數" : "全部可精煉屬性精煉到上限後的分數"}
          >
            {stock ? `持有素材精滿 ${stockMax} 分` : `可達 ${t.maxGameScore}`}
          </span>
        ) : (
          <span className={`chip ${t.tier === "high" ? "gold" : "muted"}`}>
            {t.tier === "high" ? "優先" : t.tier === "mid" ? "可考慮" : "暫緩"} {t.score}
          </span>
        )}
        <span className="chip muted" title="目前符文效率">效率 {Math.round(t.effNow)}%</span>
      </div>

      {showAccept && (
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="chip gold" title="速度副屬性（含精煉）＋ 速度 prefix">
            速度 {t.speed}
          </span>
          <span className="chip gold" title={`接受程度 ${accept} 分；低於 ${accept} 分表示還未達標`}>
            精煉分 {t.acceptScore != null && t.acceptScore >= 8 ? t.acceptScore : "<8"} / {accept}
          </span>
          {t.subScores.map((s) => (
            <span
              key={s.t}
              className={`chip ${s.score >= accept ? "muted" : "gold"}`}
              title={`目標 ${s.gem}+${s.grind} = ${s.target}${s.grindable ? "" : "（只能用寶石，不能用磨石）"}`}
            >
              {s.label} {s.current} / {s.target}
              {s.suffix}
              <span className="dim"> · {s.score >= 8 ? s.score : "<8"}</span>
            </span>
          ))}
        </div>
      )}

      {showScore && (
        <>
          <div className="tiny" style={{ lineHeight: 1.7 }}>
            <span className="gold">遊戲分數 {t.gameScore}</span>
            <span className="dim"> · {stock ? `持有素材精滿 ${stockMax} 分（傳說上限 ${t.maxGameScore} 分）` : `精煉後最高 ${t.maxGameScore} 分`}</span>
            {t.gameScore >= targetScore ? (
              <span className="dim"> · 已達 {targetScore} 分</span>
            ) : (
              <span className="dim"> · 還差 {targetScore - t.gameScore} 分</span>
            )}
          </div>
          <div
            className="tiny"
            style={{ color: plan.length ? "var(--gold)" : "var(--muted)", lineHeight: 1.65 }}
          >
            {plan.length === 0
              ? `目前分數已達 ${targetScore} 分，不需要再精煉。`
              : `達標精煉（+${planGain.toFixed(1)} 分 → 約 ${Math.round(t.gameScore + planGain)} 分）：${plan
                  .map(
                    (s) =>
                      `${s.label} ${s.base + s.from}→${s.base + s.to}${s.suffix}（精煉 ${
                        s.from > 0 ? `+${s.from}→+${s.to}` : `+${s.to}`
                      }，+${s.gain.toFixed(1)} 分，${s.grade}石）`,
                  )
                  .join(" · ")}`}
          </div>
          {materials && materials.rows.length > 0 && (
            <div className="tiny" style={{ color: "var(--gold)", lineHeight: 1.6 }}>
              素材：
              {materials.rows
                .map((row) => {
                  const stone = row.stone;
                  if (!stone) return `${row.label} 缺少素材`;
                  const setName = stone.immemorial
                    ? "無形"
                    : SET_BY_ID[stone.set]?.name ?? `套裝 ${stone.set}`;
                  return `${setName} ${row.label} ${GRIND_GRADE_LABEL[stone.grade] ?? "?"}（精煉到 +${row.need}${grindStatSuffix(row.t)}，持 ${stone.amount}）`;
                })
                .join(" · ")}
            </div>
          )}
        </>
      )}

      <div className="grind-opts">
        {t.options.slice(0, 4).map((o) => (
          <div key={o.t} className={`grind-opt ${o.t === t.best.t ? "best" : ""}`}>
            <div className="row between">
              <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{o.label}</span>
              <span className="mono tiny" style={{ whiteSpace: "nowrap" }}>
                +{o.current + o.grind}
                {o.suffix}
              </span>
            </div>
            <div className="tiny dim" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {o.grind > 0 ? `精煉 +${o.grind}/${o.maxGrind}` : "尚未精煉"} · 可再 +{o.headroom}
              {o.suffix}
            </div>
          </div>
        ))}
      </div>

      {!showScore && (
        <>
          <div className="tiny" style={{ color: "var(--gold)", lineHeight: 1.6 }}>
            建議：用傳說{t.best.label}石，最多再 +{t.best.headroom}
            {t.best.suffix}
            {t.best.grind > 0 ? `（目前精煉 +${t.best.grind}）` : "（尚未精煉）"}
          </div>
          <div className="tiny dim">
            磨石可再加：{stoneGain(t.best, t.rune.ancient).filter((s) => s.gain > 0).map((s) => `${s.label} +${s.gain}`).join(" · ")}
            {gain > 0.4 && ` ；精煉此條後效率 ${Math.round(t.effAfter)}%（+${gain.toFixed(1)}%）`}
          </div>
        </>
      )}
      {extra.length > 0 && <div className="tiny dim">{extra.join(" · ")}</div>}
    </RuneCard>
  );
}

export default function GrindPage() {
  const account = useStore((s) => s.account);
  const lockedRunes = useStore((s) => s.settings.lockedRunes);
  const excludedRunes = useStore((s) => s.settings.excludedRunes);
  const runeTags = useStore((s) => s.settings.runeTags);
  const toggleRuneFlag = useStore((s) => s.toggleRuneFlag);
  const lockedSet = useMemo(() => new Set(lockedRunes), [lockedRunes]);
  const excludedSet = useMemo(() => new Set(excludedRunes), [excludedRunes]);
  const [profile, setProfile] = useState<GrindProfile>("speed");
  const [accept, setAccept] = useState<GrindAccept>(10);
  const [targetScore, setTargetScore] = useState(250);
  const [useStock, setUseStock] = useState(false);
  const [onlyEquipped, setOnlyEquipped] = useState(false);
  const [onlySix, setOnlySix] = useState(false);
  const [onlyHigh, setOnlyHigh] = useState(false);
  const [setId, setSetId] = useState(0);
  const [slots, setSlots] = useState<number[]>([]);
  const [stat, setStat] = useState(0);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<GrindSort>("default");
  const [commonSort, setCommonSort] = useState<CommonSort>("uses-desc");
  const [minUses, setMinUses] = useState(1);
  const [maxUses, setMaxUses] = useState(0);
  const [q, setQ] = useState("");
  const [take, setTake] = useState(40);

  const toggleSlot = (n: number) =>
    setSlots((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n].sort((a, b) => a - b)));

  /** 預設隊 / 防守隊與 RTA 的符文使用次數（常用符文方向用） */
  const useCounts = useMemo(() => buildRuneUseCounts(account), [account]);

  const stock = useMemo(() => account?.grindstones ?? [], [account]);
  const hasStockData = Array.isArray(account?.grindstones);
  const stockTotal = useMemo(() => stock.reduce((sum, g) => sum + g.amount, 0), [stock]);
  /** 只有在分數模式且存檔有精煉石資料時，才啟用素材篩選 */
  const stockOn = profile === "score" && useStock && hasStockData;

  useEffect(() => {
    setTake(40);
  }, [profile, accept, targetScore, useStock, onlyEquipped, onlySix, onlyHigh, setId, slots, stat, sort, commonSort, minUses, maxUses, q, tagFilter]);

  const owners = useMemo(() => {
    const map = new Map<number, GrindOwner>();
    if (!account) return map;
    for (const u of account.units) {
      const name = MONSTER_MAP.get(u.master)?.name ?? `#${u.master}`;
      for (const rid of u.runes) if (!map.has(rid)) map.set(rid, { name, unitId: u.id });
    }
    return map;
  }, [account]);

  const all = useMemo(() => {
    if (!account) return [];
    const onlyStat = stat === 0 ? null : stat === -1 ? [1, 3, 5] : stat;
    if (profile === "common") {
      // 常用符文：只保留預設隊 / RTA 用過、且使用次數在設定範圍內的符文
      const usesOf = (id: number) => useCounts.get(id)?.total ?? 0;
      const tie = (a: GrindTarget, b: GrindTarget) =>
        usesOf(b.rune.id) - usesOf(a.rune.id) ||
        (useCounts.get(b.rune.id)?.deck ?? 0) - (useCounts.get(a.rune.id)?.deck ?? 0) ||
        b.rune.grade - a.rune.grade ||
        b.rawScore - a.rawScore;
      return analyzeGrind(account.runes, { profile: "support", owners, stat: onlyStat, accept, targetScore })
        .filter((t) => {
          const n = usesOf(t.rune.id);
          return n >= minUses && (maxUses <= 0 || n <= maxUses);
        })
        .sort((a, b) => {
          if (commonSort === "uses-asc") return usesOf(a.rune.id) - usesOf(b.rune.id) || b.rawScore - a.rawScore;
          if (commonSort === "now-asc") return a.gameScore - b.gameScore || tie(a, b);
          if (commonSort === "now-desc") return b.gameScore - a.gameScore || tie(a, b);
          if (commonSort === "target-desc") return b.maxGameScore - a.maxGameScore || tie(a, b);
          if (commonSort === "target-asc") return a.maxGameScore - b.maxGameScore || tie(a, b);
          return tie(a, b);
        });
    }
    return analyzeGrind(account.runes, { profile, owners, stat: onlyStat, accept, targetScore });
  }, [account, profile, owners, stat, accept, targetScore, useCounts, commonSort, minUses, maxUses]);

  /** 勾選「計算持有精煉石素材」時，只留下真的能用手上磨石推到目標分數的符文 */
  const candidates = useMemo(() => {
    if (!stockOn) return all;
    return all.filter((t) => planWithStock(t, targetScore, stock).reachable);
  }, [all, stockOn, targetScore, stock]);

  const sets = useMemo(() => {
    const ids = new Set(account?.runes.map((r) => r.set) ?? []);
    return [...ids]
      .map((id) => ({ id, name: SET_BY_ID[id]?.name ?? `套裝 ${id}` }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-TW"));
  }, [account]);

  /** 啟用中的自行分類（精煉建議頁只用啟用中的規則篩選） */
  const activeTags = useMemo(() => runeTags.filter((r) => r.enabled), [runeTags]);

  /** 每顆精煉候選符合的自行分類 */
  const tagHits = useMemo(() => {
    const map = new Map<number, RuneTagRule[]>();
    if (activeTags.length === 0) return map;
    for (const t of candidates) {
      const hit = activeTags.filter((rule) => matchesRuneTag(rule, t.rune));
      if (hit.length > 0) map.set(t.rune.id, hit);
    }
    return map;
  }, [candidates, activeTags]);

  /** 每個自行分類在目前候選中有幾顆 */
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const list of tagHits.values()) {
      for (const rule of list) counts.set(rule.id, (counts.get(rule.id) ?? 0) + 1);
    }
    return counts;
  }, [tagHits]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = candidates.filter((t) => {
      if (onlyEquipped && !t.owner) return false;
      if (onlySix && t.rune.grade !== 6) return false;
      if (onlyHigh && t.tier !== "high") return false;
      if (setId && t.rune.set !== setId) return false;
      if (slots.length > 0 && !slots.includes(t.rune.slot)) return false;
      if (tagFilter.length > 0) {
        const hit = tagHits.get(t.rune.id);
        if (!hit || !hit.some((rule) => tagFilter.includes(rule.id))) return false;
      }
      if (!term) return true;
      return (
        (t.owner ?? "").toLowerCase().includes(term) ||
        (SET_BY_ID[t.rune.set]?.name ?? "").includes(term) ||
        grindStatLabel(t.best.t).includes(term)
      );
    });
    // 常用符文已依使用次數 / 分數排好，不再被一般排序覆蓋
    return profile === "common" ? list : sortGrindTargets(list, sort);
  }, [candidates, onlyEquipped, onlySix, onlyHigh, setId, slots, sort, q, tagFilter, tagHits]);

  const summary = useMemo(() => {
    const high = candidates.filter((t) => t.tier === "high").length;
    const speed = candidates.filter((t) => t.best.t === 8).length;
    const speed6 = candidates.filter((t) => t.best.t === 8 && t.rune.grade === 6).length;
    const avgGain = candidates.length ? candidates.reduce((s, t) => s + Math.max(0, t.effAfter - t.effNow), 0) / candidates.length : 0;
    const bySet = new Map<number, { count: number; spd: number }>();
    for (const t of candidates) {
      const cur = bySet.get(t.rune.set) ?? { count: 0, spd: 0 };
      cur.count += 1;
      if (t.best.t === 8) cur.spd += 1;
      bySet.set(t.rune.set, cur);
    }
    const topSets = [...bySet.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8)
      .map(([id, v]) => ({ id, name: SET_BY_ID[id]?.name ?? `套裝 ${id}`, ...v }));
    const meet = candidates.filter((t) => t.gameScore >= targetScore).length;
    const maxScore = candidates.reduce((m, t) => Math.max(m, t.gameScore), 0);
    const avgScore = candidates.length ? candidates.reduce((s, t) => s + t.gameScore, 0) / candidates.length : 0;
    return { high, speed, speed6, avgGain, topSets, meet, maxScore, avgScore };
  }, [candidates, targetScore]);

  if (!account) {
    return <EmptyState icon={<Hammer size={40} />} title="尚未匯入存檔" desc="匯入 JSON 後即可分析每顆符文的精煉順序。" />;
  }

  const shown = filtered.slice(0, take);
  const commonDeck = profile === "common" ? candidates.filter((t) => (useCounts.get(t.rune.id)?.deck ?? 0) > 0).length : 0;
  const commonRta = profile === "common" ? candidates.filter((t) => (useCounts.get(t.rune.id)?.rta ?? 0) > 0).length : 0;
  const commonUses = profile === "common"
    ? candidates.reduce((s, t) => s + (useCounts.get(t.rune.id)?.total ?? 0), 0)
    : 0;

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 12 }}>
        <div>
          <div className="card-title row" style={{ gap: 7 }}>
            <Hammer size={15} className="gold" /> 精煉建議
          </div>
          <div className="card-sub">
            {profile === "common"
              ? "列出預設隊 / 防守隊與 RTA 常用到的符文；可自訂順序（使用次數 / 目前分數 / 目標分數）與使用次數上下限。同一顆符文可同時在一般與 RTA 使用。"
              : "依符文素質、套裝、裝備對象與目前精煉值排序；只考慮可用磨石精煉的屬性（速度、體力／攻擊／防禦與固定值）。"}
          </div>
        </div>
        <span className="chip gold">
          {profile === "speed"
            ? `未達 ${accept} 分 ${candidates.length} 顆`
            : profile === "score"
              ? `${stockOn ? "素材足夠" : "可達"} ${targetScore} 分 ${candidates.length} 顆`
              : profile === "common"
                ? `常用 ${candidates.length} 顆`
                : `可精煉 ${candidates.length} 顆`}
        </span>
      </div>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        {profile === "common" ? (
          <>
            <Tile k="常用符文" v={String(candidates.length)} sub="預設隊 / RTA 用過" />
            <Tile k="預設隊使用" v={String(commonDeck)} sub="含防守隊" />
            <Tile k="RTA 使用" v={String(commonRta)} sub="世界競技場獨立配裝" />
            <Tile k="總使用次數" v={String(commonUses)} sub="最常用排最前面" />
          </>
        ) : profile === "score" ? (
          <>
            <Tile
              k={`${stockOn ? "素材足夠" : "可達"} ${targetScore} 分`}
              v={String(candidates.length)}
              sub={stockOn ? "已計入持有磨石" : "精煉後可達標"}
            />
            <Tile k="已達標" v={String(summary.meet)} sub="目前分數已足夠" />
            <Tile k="最高目前分數" v={String(summary.maxScore)} sub="此清單最高" />
            <Tile k="平均目前分數" v={summary.avgScore.toFixed(0)} sub="此清單平均" />
          </>
        ) : (
          <>
            <Tile
              k={profile === "speed" ? `未達 ${accept} 分` : "可精煉符文"}
              v={String(candidates.length)}
              sub={profile === "speed" ? "依速度由高到低" : "還有提升空間"}
            />
            <Tile k="高優先" v={String(summary.high)} sub="建議先處理" />
            <Tile k="速度候選" v={String(summary.speed)} sub={`其中 6★ ${summary.speed6} 顆`} />
            <Tile k="平均效率提升" v={`+${summary.avgGain.toFixed(1)}%`} sub="全部都精煉到上限" />
          </>
        )}
      </div>

      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          {GRIND_PROFILES.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`chip ${profile === p.key ? "gold" : "muted"}`}
              style={{ cursor: "pointer" }}
              onClick={() => setProfile(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="tiny dim" style={{ marginTop: 7 }}>
          {profile === "speed"
            ? `速度優先：只列出未達接受程度（${accept} 分）的符文，依符文速度（速度副屬性＋精煉）由高到低排序。`
            : profile === "score"
              ? `分數：只列出精煉後能達到 ${targetScore} 分以上的符文；預設先列未達標的，再依目前遊戲分數由高到低。可用「排列」切換成目前分數高→低或低→高。`
              : GRIND_PROFILES.find((p) => p.key === profile)?.desc}
        </div>

        {profile === "score" && (
          <>
            <div className="row wrap" style={{ gap: 8, marginTop: 10, alignItems: "center" }}>
              <span className="tiny dim">目標分數</span>
              <NumberInput
                className="input mono"
                style={{ width: 90 }}
                min={0}
                max={400}
                step={5}
                value={targetScore}
                onChange={setTargetScore}
              />
              <span className="tiny dim">
                只列出精煉後能達到 {targetScore} 分以上的符文；卡片會顯示要精煉哪幾條、各加到多少
              </span>
            </div>
            <div className="row wrap" style={{ gap: 8, marginTop: 8, alignItems: "center" }}>
              <label
                className="row tiny"
                style={{ gap: 6, cursor: hasStockData ? "pointer" : "not-allowed", opacity: hasStockData ? 1 : 0.55 }}
                title="用存檔中的磨石最大值估算，只留下真的能把分數推到達標的符文"
              >
                <input
                  type="checkbox"
                  checked={useStock && hasStockData}
                  disabled={!hasStockData}
                  onChange={(e) => setUseStock(e.target.checked)}
                />
                只列出持有精煉石素材的符文
              </label>
              <span className="tiny dim">
                {hasStockData
                  ? `持有 ${stock.length} 種磨石（共 ${stockTotal} 個），以磨石最大值估算；素材數量不會跨符文扣除`
                  : "此存檔沒有精煉石素材資料，請重新匯入一次 JSON"}
              </span>
            </div>
          </>
        )}

        {profile === "common" && (
          <div className="row wrap" style={{ gap: 8, marginTop: 10, alignItems: "center" }}>
            <span className="tiny dim">順序</span>
            <select
              className="select"
              style={{ width: 165 }}
              value={commonSort}
              onChange={(e) => setCommonSort(e.target.value as CommonSort)}
              title={COMMON_SORTS.find((s) => s.key === commonSort)?.desc}
            >
              {COMMON_SORTS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
            <span className="tiny dim">使用次數</span>
            <NumberInput className="input mono" style={{ width: 68 }} min={1} max={999} step={1} value={minUses} onChange={setMinUses} />
            <span className="tiny dim">～</span>
            <NumberInput className="input mono" style={{ width: 68 }} min={0} max={999} step={1} value={maxUses} onChange={setMaxUses} />
            <span className="tiny dim">次（上限 0 = 不限）</span>
          </div>
        )}

        {profile === "speed" && (
          <div className="row wrap" style={{ gap: 6, marginTop: 10, alignItems: "center" }}>
            <span className="tiny dim">接受程度</span>
            {GRIND_ACCEPT_LEVELS.map((a) => (
              <button
                key={a.value}
                type="button"
                className={`chip ${accept === a.value ? "gold" : "muted"}`}
                style={{ cursor: "pointer" }}
                onClick={() => setAccept(a.value)}
                title={a.hint}
              >
                {a.label}
              </button>
            ))}
            <span className="tiny dim">{GRIND_ACCEPT_LEVELS.find((a) => a.value === accept)?.hint}</span>
          </div>
        )}

        <div className="row filter-row" style={{ gap: 8, marginTop: 12 }}>
          <div style={{ position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: "var(--muted-2)" }} />
            <input
              className="input"
              style={{ width: 220, paddingLeft: 28 }}
              placeholder="搜尋擁有者 / 套裝 / 屬性"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select className="select" style={{ width: 150 }} value={setId} onChange={(e) => setSetId(Number(e.target.value))}>
            <option value={0}>全部套裝</option>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select className="select" style={{ width: 170 }} value={stat} onChange={(e) => setStat(Number(e.target.value))}>
            {STAT_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <div className="row" style={{ gap: 6 }}>
            <span className="tiny dim">排列</span>
            <select
              className="select"
              style={{ width: 155 }}
              value={sort}
              onChange={(e) => setSort(e.target.value as GrindSort)}
              title={GRIND_SORTS.find((s) => s.key === sort)?.desc}
            >
              {GRIND_SORTS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="row wrap" style={{ gap: 6, marginTop: 10, alignItems: "center" }}>
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
              title={`位置 ${n}（可多選）`}
              onClick={() => toggleSlot(n)}
            >
              {n}
            </button>
          ))}
        </div>

        {activeTags.length > 0 && (
          <div className="row wrap" style={{ gap: 6, marginTop: 10, alignItems: "center" }}>
            <span className="tiny dim" title="在「符文 → 自行分類」設定的分類，符合條件的符文會自動掛上">
              自行分類
            </span>
            {activeTags.map((rule) => {
              const on = tagFilter.includes(rule.id);
              return (
                <button
                  key={rule.id}
                  type="button"
                  className={`chip ${on ? "gold" : "muted"}`}
                  style={{ cursor: "pointer" }}
                  aria-pressed={on}
                  onClick={() =>
                    setTagFilter((prev) => (prev.includes(rule.id) ? prev.filter((x) => x !== rule.id) : [...prev, rule.id]))
                  }
                  title={`${rule.name}：目前候選中有 ${tagCounts.get(rule.id) ?? 0} 顆`}
                >
                  {rule.name} · {tagCounts.get(rule.id) ?? 0}
                </button>
              );
            })}
            {tagFilter.length > 0 && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTagFilter([])}>
                清除分類
              </button>
            )}
          </div>
        )}

        <div className="row wrap" style={{ gap: 14, marginTop: 10 }}>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={onlyEquipped} onChange={(e) => setOnlyEquipped(e.target.checked)} /> 只看已裝備
          </label>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={onlySix} onChange={(e) => setOnlySix(e.target.checked)} /> 只看 6★
          </label>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={onlyHigh} onChange={(e) => setOnlyHigh(e.target.checked)} /> 只看高優先
          </label>
          <span className="tiny dim">顯示 {filtered.length} / {candidates.length} 顆</span>
          {(onlyEquipped || onlySix || onlyHigh || setId || slots.length > 0 || stat !== 0 || q || useStock || tagFilter.length > 0 || commonSort !== "uses-desc" || minUses !== 1 || maxUses !== 0) && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setOnlyEquipped(false);
                setOnlySix(false);
                setOnlyHigh(false);
                setSetId(0);
                setSlots([]);
                setStat(0);
                setQ("");
                setUseStock(false);
                setTagFilter([]);
                setCommonSort("uses-desc");
                setMinUses(1);
                setMaxUses(0);
              }}
            >
              清除篩選
            </button>
          )}
        </div>
      </div>

      {summary.topSets.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 14 }}>
          <div className="row between wrap" style={{ gap: 8 }}>
            <div>
              <div className="card-title">依套裝分配</div>
              <div className="tiny dim" style={{ marginTop: 2 }}>磨石只能用同套裝的符文，先從數量最多的套裝開始整理</div>
            </div>
          </div>
          <div className="row wrap" style={{ gap: 6, marginTop: 9 }}>
            {summary.topSets.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`chip ${setId === s.id ? "gold" : "muted"}`}
                style={{ cursor: "pointer" }}
                onClick={() => setSetId(setId === s.id ? 0 : s.id)}
                title={`${s.count} 顆可精煉${s.spd ? `，其中 ${s.spd} 顆以速度為主` : ""}`}
              >
                {s.name} · {s.count}
                {s.spd > 0 && <span className="dim"> · 速 {s.spd}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <details className="card card-pad grind-guide" style={{ marginBottom: 14 }}>
        <summary className="card-title" style={{ cursor: "pointer" }}>精煉策略與資源分配建議</summary>
        <ol>
          <li><b>先看速度。</b>速度磨石最稀有，只留給 6★、套裝正確、而且你確定會長期使用的符文；不要為了湊效率浪費在 5★ 以下。</li>
          <li><b>再補百分比。</b>體力% / 防禦% 給坦與輔助，攻擊% 給輸出；固定值（+HP / +ATK / +DEF）只有在該符文其他副屬性很完美時才補。</li>
          <li><b>依套裝集中處理。</b>磨石只能用在同套裝符文，先挑數量最多的套裝（例如迅速、暴走）一次整理，避免東一顆西一顆；也可用「位置 1–6」多選，只看特定位置的符文。</li>
          <li><b>石頭等級這樣分：</b>傳說石留給「速度還差 4–5」或關鍵百分比；英雄石用在次要但會上場的符文；稀有／魔法石只用來補滿過渡裝。</li>
          <li><b>不要精煉準備換掉的符文。</b>先確認符文已 +15、套裝與主屬正確，再投入資源；4★ 以下基本上不值得。不確定哪些還在用的話，切到「常用符文」方向，它會列出預設隊 / 防守隊與 RTA 用到的符文；順序可選使用次數、目前分數或目標分數的高低，也能設使用次數下限／上限（上限 0 = 不限）；次數是匯出當下的快照。</li>
          <li><b>可以重複嘗試。</b>同一條副屬性再精煉會覆蓋上一次的加成，不會疊加；接近上限時再用高一級的石頭追求滿值，已經用高階石精煉過的就不要再用低階石覆蓋。</li>
          <li>暴擊率、暴擊傷害、效果命中、效果抵抗<b>不能用磨石</b>，需要用寶石轉換，這個頁面不會把它們列入精煉候選。</li>
          <li><b>分數怎麼看：</b>推薦分 = 屬性權重 × 可提升幅度，再依符文星級、效率、是否已裝備與套裝契合度調整。分數高不代表一定要精煉，還是要看該顆符文是不是你長期會用的。</li>
          <li><b>速度優先的接受程度：</b>體攻防% 以「寶石 13 + 精煉 10」為 10 分，速度以「寶石 10 + 精煉 5」為 10 分，爆率／爆傷以寶石 13 為 10 分；每降一分，寶石與精煉各減 1。選 9 分（體攻防% 12+9、速度 9+4）就只會列出未達該分數的符文，並依符文速度由高到低排序。</li>
          <li><b>分數模式：</b>使用遊戲內的符文分數（副屬性＋固有屬性，含精煉；不含主屬性與套裝）。輸入目標分數後，只會列出「把所有可精煉屬性精煉到傳說上限後」能達到該分數的符文，並依每點數值的分數效益（速度／爆率 3.33、暴傷 2.86、體攻防% 2.5、固定值較低）排出最少要精煉哪幾條、各加到多少。</li>
          <li><b>持有精煉石素材：</b>勾選後會讀取存檔中的磨石（含遠古、無形），只留下「用你實際持有的磨石最大值」真的能推到達標分數的符文；卡片會列出會用到的套裝、屬性、等級與持有數量。素材數量不會跨符文扣除，實際使用時仍要留意庫存。</li>
        </ol>
      </details>

      {filtered.length === 0 ? (
        <div className="empty card" style={{ padding: "40px 16px" }}>
          <Hammer size={34} style={{ opacity: .3, marginBottom: 8 }} />
          <div style={{ fontWeight: 600, color: "var(--text)" }}>沒有符合條件的精煉候選</div>
          <div className="tiny dim" style={{ marginTop: 4 }}>
            {profile === "speed"
              ? `目前沒有未達 ${accept} 分的符文，或篩選條件太窄。可調低接受程度或放寬篩選。`
              : profile === "score"
                ? stockOn
                  ? `目前沒有符文能用持有的磨石達到 ${targetScore} 分。可取消「持有精煉石素材」、降低目標分數，或放寬篩選。`
                  : `目前沒有符文能在精煉後達到 ${targetScore} 分，或篩選條件太窄。可降低目標分數或放寬篩選。`
                : "試著放寬套裝 / 屬性篩選，或取消「只看已裝備 / 只看 6★ / 只看高優先」。"}
          </div>
        </div>
      ) : (
        <>
          <div className="grind-list">
            {shown.map((t) => (
              <TargetCard
                key={t.rune.id}
                t={t}
                accept={accept}
                showAccept={profile === "speed"}
                showScore={profile === "score"}
                targetScore={targetScore}
                stock={stockOn ? stock : undefined}
                useCount={profile === "common" ? useCounts.get(t.rune.id) : undefined}
                locked={lockedSet.has(t.rune.id)}
                excluded={excludedSet.has(t.rune.id)}
                tags={tagHits.get(t.rune.id)?.map((rule) => rule.name)}
                onToggleLock={() => toggleRuneFlag("locked", t.rune.id)}
                onToggleExclude={() => toggleRuneFlag("excluded", t.rune.id)}
              />
            ))}
          </div>
          {filtered.length > shown.length && (
            <div className="row" style={{ justifyContent: "center", marginTop: 14 }}>
              <button type="button" className="btn" onClick={() => setTake((n) => n + 40)}>
                顯示更多（還有 {filtered.length - shown.length} 顆）
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
