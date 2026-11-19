import { useEffect, useMemo, useState } from "react";
import { Ban, FlaskConical, Search, X } from "lucide-react";
import { MONSTER_MAP, useStore } from "../store";
import { SET_BY_ID, STAT_TYPES } from "../lib/constants";
import { describeRuneTag, matchesRuneTag } from "../lib/runeTags";
import { EmptyState, NumberInput, RuneCard, statSuffix } from "../components/ui";
import {
  ENCHANT_MAIN_STATS,
  ENCHANT_SCORE_SORTS,
  ENCHANT_SORTS,
  analyzeEnchant,
  analyzeEnchantScore,
  enchantStatLabel,
  filterEnchantByStock,
  filterEnchantScoreByStock,
  heldMaterialsLabel,
  sortEnchantScoreTargets,
  sortEnchantTargets,
  type EnchantOwner,
  type EnchantScoreSort,
  type EnchantScoreTarget,
  type EnchantSort,
  type EnchantStock,
  type EnchantTarget,
} from "../lib/enchant";
import type { Rune, RuneTagRule } from "../lib/types";
import { buildRuneUseCounts, COMMON_SORTS, type CommonSort, type RuneUseCount } from "../lib/usage";

function Tile({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="stat-tile">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {sub && <div className="u" style={{ marginLeft: 0 }}>{sub}</div>}
    </div>
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const fmtGain = (n: number) => `${n >= 0 ? "+" : ""}${round1(n)}`;
const SLOTS = [1, 2, 3, 4, 5, 6];

const excludeRuneLabel = (r: Rune) =>
  `#${r.slot} ${SET_BY_ID[r.set]?.name ?? `套裝${r.set}`} · ${STAT_TYPES[r.main.t]?.label ?? "?"} +${r.main.v}`;

type EnchantMode = "tag" | "score" | "common";

function EnchantCard({
  t,
  setName,
  heldMaterials,
  locked,
  excluded,
  currentTags,
  onToggleLock,
  onToggleExclude,
}: {
  t: EnchantTarget;
  /** 需要使用的寶石套裝名稱（含遠古標記） */
  setName: string;
  /** 勾選持有素材時，最好的精魔方式所需的持有寶石＋磨石（空字串表示未勾選） */
  heldMaterials: string;
  locked: boolean;
  excluded: boolean;
  /** 這顆符文目前已經符合的分類（精魔前） */
  currentTags: string[];
  onToggleLock: () => void;
  onToggleExclude: () => void;
}) {
  const delta = t.bestEff - t.effNow;
  return (
    <RuneCard
      rune={t.rune}
      owner={t.owner?.name}
      locked={locked}
      excluded={excluded}
      tags={currentTags}
      onToggleLock={onToggleLock}
      onToggleExclude={onToggleExclude}
    >
      <div className="row wrap" style={{ gap: 6 }}>
        <span
          className={`chip ${delta >= 0 ? "gold" : "muted"}`}
          title="以 6★ 傳說寶石＋精煉上限估算，精魔後效率（含精煉；可超過 100%）"
        >
          精魔後效率 {Math.round(t.bestEff)}%
          <span className="dim"> ({fmtGain(delta)})</span>
        </span>
        <span className="chip muted" title="目前符文效率（含精煉）">目前 {Math.round(t.effNow)}%</span>
        <span className="chip muted" title="遊戲分數：副屬性＋固有屬性，含精煉；不含主屬性與套裝">
          分數 {t.scoreNow} → {t.options[0]?.scoreAfter ?? t.scoreNow}
        </span>
        {heldMaterials && (
          <span className="chip green" title="目前持有、可用於這顆符文的精魔石與精煉石素材">
            {heldMaterials}
          </span>
        )}
      </div>

      <div className="grind-opts">
        {t.options.slice(0, 4).map((o) => (
          <div
            key={`${o.fromIndex}:${o.toT}`}
            className={`grind-opt ${o === t.options[0] ? "best" : ""}`}
            title={
              `把「${o.fromLabel} +${o.fromValue}${statSuffix(o.fromT)}」換成「${o.toLabel} +${o.toValue}${statSuffix(o.toT)}」` +
              `（寶石 +${o.toGem}${o.toGrind > 0 ? `、精煉 +${o.toGrind}` : ""}），` +
              `精魔後效率 ${Math.round(o.effAfter)}%、分數 ${o.scoreAfter}`
            }
          >
            <div className="row between" style={{ gap: 6 }}>
              <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                {o.fromLabel} {o.fromValue}{statSuffix(o.fromT)}
                <span className="dim"> → </span>
                <span className="gold">
                  {o.toLabel} +{o.toValue}{statSuffix(o.toT)}
                </span>
              </span>
              <span className="mono tiny" style={{ whiteSpace: "nowrap" }}>
                {Math.round(o.effAfter)}%
              </span>
            </div>
            <div className="tiny dim" style={{ lineHeight: 1.55 }}>
              符合 {o.rules.map((r) => r.name).join(" / ")}
              <br />
              需要{setName} {o.toLabel}寶石 +{o.toGem}{statSuffix(o.toT)}
              {o.toGrind > 0 ? `，再精煉 +${o.toGrind}` : ""}（合計 {o.toValue}）
              ≥ 門檻 {o.need}{statSuffix(o.toT)}
              {o.alreadyGem && <span className="gold"> · 這條已經是寶石轉出來的，遊戲只允許再轉同一條</span>}
            </div>
          </div>
        ))}
      </div>

      {t.options.length > 4 && (
        <div className="tiny dim">還有 {t.options.length - 4} 種精魔方式（目前先顯示精魔後效率最高的 4 種）。</div>
      )}

      <div className="tiny dim" style={{ lineHeight: 1.6 }}>
        精魔後可符合：
        {[...new Map(t.options.flatMap((o) => o.rules.map((r) => [r.id, r]))).values()]
          .map((r) => r.name)
          .join(" / ")}
      </div>
    </RuneCard>
  );
}

/** 分數模式的卡片：精魔＋精煉到上限後的分數 */
function EnchantScoreCard({
  t,
  setName,
  heldMaterials,
  stockOn,
  useCount,
  targetScore,
  locked,
  excluded,
  currentTags,
  onToggleLock,
  onToggleExclude,
}: {
  t: EnchantScoreTarget;
  setName: string;
  /** 勾選持有素材時，最好的精魔方式所需的持有寶石＋磨石（空字串表示未勾選） */
  heldMaterials: string;
  /** 分數是否已改用持有素材等級計算 */
  stockOn: boolean;
  /** 「常用符文」方向：這顆符文在預設隊 / RTA 的使用次數 */
  useCount?: RuneUseCount;
  targetScore: number;
  locked: boolean;
  excluded: boolean;
  currentTags: string[];
  onToggleLock: () => void;
  onToggleExclude: () => void;
}) {
  const remain = Math.max(0, targetScore - t.scoreNow);
  const maxLabel = stockOn ? `持有素材精滿 ${t.maxScore}` : `MAX ${t.maxScore}`;
  return (
    <RuneCard
      rune={t.rune}
      owner={t.owner?.name}
      locked={locked}
      excluded={excluded}
      tags={currentTags}
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
        <span
          className="chip gold"
          title={
            stockOn
              ? "用持有的寶石等級精魔一次，其他副屬性用持有的磨石等級精滿後能達到的遊戲分數"
              : "精魔一次（6★ 傳說寶石上限）＋其他可精煉副屬性都拉到上限後的遊戲分數"
          }
        >
          {maxLabel} 分
        </span>
        <span className="chip muted" title="目前遊戲分數（含目前精煉）">目前 {t.scoreNow}</span>
        {t.gain > 0 && (
          <span className="chip muted" title={`${maxLabel} − 目前分數`}>
            +{t.gain}
          </span>
        )}
        {t.scoreNow >= targetScore ? (
          <span className="chip green">已達 {targetScore}</span>
        ) : t.maxNow >= targetScore ? (
          <span className="chip green" title="不用精魔，把現有可精煉副屬性拉到上限就達標">
            精煉即可達標（{t.maxNow} 分）
          </span>
        ) : (
          <span className="chip gold">還差 {remain} 分</span>
        )}
        {heldMaterials && (
          <span className="chip green" title="目前持有、可用於這顆符文的精魔石與精煉石素材">
            {heldMaterials}
          </span>
        )}
      </div>

      {t.best ? (
        <div className="grind-opts">
          {t.options.slice(0, 3).map((o) => (
            <div
              key={`${o.fromIndex}:${o.toT}`}
              className={`grind-opt ${o === t.best ? "best" : ""}`}
              title={
                `把「${o.fromLabel} +${o.fromValue}${statSuffix(o.fromT)}」換成「${o.toLabel} +${o.toValue}${statSuffix(o.toT)}」` +
                `（寶石 +${o.toGem}${o.toGrind > 0 ? `、精煉 +${o.toGrind}` : ""}），` +
                `精魔後效率 ${Math.round(o.effAfter)}%`
              }
            >
              <div className="row between" style={{ gap: 6 }}>
                <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                  {o.fromLabel} {o.fromValue}{statSuffix(o.fromT)}
                  <span className="dim"> → </span>
                  <span className="gold">
                    {o.toLabel} +{o.toValue}{statSuffix(o.toT)}
                  </span>
                </span>
                <span className="mono tiny" style={{ whiteSpace: "nowrap" }}>
                  {o.scoreAfter} 分
                </span>
              </div>
              <div className="tiny dim" style={{ lineHeight: 1.55 }}>
                需要{setName} {o.toLabel}寶石 +{o.toGem}{statSuffix(o.toT)}
                {o.toGrind > 0 ? `，再精煉 +${o.toGrind}` : ""}（合計 {o.toValue}）
                <br />
                精魔後效率 {Math.round(o.effAfter)}%
                {o.alreadyGem && <span className="gold"> · 這條已經是寶石轉出來的，遊戲只允許再轉同一條</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="tiny dim" style={{ lineHeight: 1.6 }}>
          不需要精魔：{stockOn ? "用持有磨石把可精煉的副屬性精滿" : "把可精煉的副屬性拉到上限"}就有 {t.maxNow} 分。
        </div>
      )}

      {t.best && t.best.grindPlan.length > 0 && (
        <div className="tiny" style={{ color: "var(--gold)", lineHeight: 1.65 }}>
          {stockOn ? "其他副屬性用持有磨石精滿：" : "其他副屬性精煉到上限："}
          {t.best.grindPlan
            .map((g) => `${g.label} ${g.from}→${g.to}${statSuffix(g.t)}`)
            .join(" · ")}
        </div>
      )}

      <div className="tiny dim" style={{ lineHeight: 1.6 }}>
        {t.options.length > 3 && <>另外還有 {t.options.length - 3} 種精魔方式（依分數排序）。</>}
        {useCount
          ? `此符文在預設隊 / 防守隊使用 ${useCount.deck} 次、RTA 使用 ${useCount.rta} 次（合計 ${useCount.total} 次，匯出當下的快照）；精魔＋精煉後最高 ${t.maxScore} 分。`
          : t.scoreNow >= targetScore
            ? `目前 ${t.scoreNow} 分 → ${maxLabel} 分（已達目標 ${targetScore}）。`
            : t.maxScore >= targetScore
              ? `目前 ${t.scoreNow} 分 → ${maxLabel} 分（目標 ${targetScore}，精魔＋精煉後可達標）。`
              : `目前 ${t.scoreNow} 分 → ${maxLabel} 分（目標 ${targetScore}，還差 ${remain} 分）。`}
      </div>
    </RuneCard>
  );
}

export default function EnchantPage() {
  const account = useStore((s) => s.account);
  const lockedRunes = useStore((s) => s.settings.lockedRunes);
  const excludedRunes = useStore((s) => s.settings.excludedRunes);
  const runeTags = useStore((s) => s.settings.runeTags);
  const toggleRuneFlag = useStore((s) => s.toggleRuneFlag);
  const lockedSet = useMemo(() => new Set(lockedRunes), [lockedRunes]);
  const excludedSet = useMemo(() => new Set(excludedRunes), [excludedRunes]);

  const [mode, setMode] = useState<EnchantMode>("tag");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [onlyEquipped, setOnlyEquipped] = useState(false);
  const [onlySix, setOnlySix] = useState(false);
  const [onlyReady, setOnlyReady] = useState(true);
  const [assumeGrind, setAssumeGrind] = useState(true);
  const [setId, setSetId] = useState(0);
  const [slots, setSlots] = useState<number[]>([]);
  const [mainStat, setMainStat] = useState(0);
  const [onlyHaveStock, setOnlyHaveStock] = useState(false);
  const [excludedSets, setExcludedSets] = useState<number[]>([]);
  const [excludedRuneIds, setExcludedRuneIds] = useState<number[]>([]);
  const [excludeQ, setExcludeQ] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<EnchantSort>("eff-desc");
  const [scoreSort, setScoreSort] = useState<EnchantScoreSort>("max-desc");
  const [commonSort, setCommonSort] = useState<CommonSort>("uses-desc");
  const [minUses, setMinUses] = useState(1);
  const [maxUses, setMaxUses] = useState(0);
  const [targetScore, setTargetScore] = useState(250);
  const [onlyUnmet, setOnlyUnmet] = useState(true);
  const [take, setTake] = useState(40);

  const toggleSlot = (n: number) =>
    setSlots((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n].sort((a, b) => a - b)));

  /** 持有的精魔石（寶石）＋精煉石（磨石）；舊存檔缺少任一欄位時不能啟用素材篩選 */
  const stock = useMemo<EnchantStock>(
    () => ({ gems: account?.gems ?? [], grindstones: account?.grindstones ?? [] }),
    [account],
  );
  const hasStockData = Array.isArray(account?.gems) && Array.isArray(account?.grindstones);
  const gemTotal = useMemo(() => stock.gems.reduce((sum, g) => sum + g.amount, 0), [stock]);
  const grindTotal = useMemo(() => stock.grindstones.reduce((sum, g) => sum + g.amount, 0), [stock]);
  const stockOn = onlyHaveStock && hasStockData;

  /** 預設隊 / 防守隊與 RTA 的符文使用次數（常用符文方向用） */
  const useCounts = useMemo(() => buildRuneUseCounts(account), [account]);

  const activeTags = useMemo(() => runeTags.filter((r) => r.enabled), [runeTags]);

  const owners = useMemo(() => {
    const map = new Map<number, EnchantOwner>();
    if (!account) return map;
    for (const u of account.units) {
      const name = MONSTER_MAP.get(u.master)?.name ?? `#${u.master}`;
      for (const rid of u.runes) if (!map.has(rid)) map.set(rid, { name, unitId: u.id });
    }
    return map;
  }, [account]);

  const all = useMemo(() => {
    if (!account) return [];
    return analyzeEnchant(account.runes, activeTags, owners, { includeGrind: assumeGrind });
  }, [account, activeTags, owners, assumeGrind]);

  /** 分數模式：不管自行分類，枚舉所有合法精魔方式後能達到的最高分數 */
  const scoreAll = useMemo(() => {
    if (!account) return [];
    return analyzeEnchantScore(account.runes, owners);
  }, [account, owners]);

  /** 常用符文：只保留預設隊 / RTA 用過且次數在範圍內的，依設定排序 */
  const commonAll = useMemo(() => {
    const usesOf = (id: number) => useCounts.get(id)?.total ?? 0;
    const tie = (a: EnchantScoreTarget, b: EnchantScoreTarget) =>
      usesOf(b.rune.id) - usesOf(a.rune.id) ||
      (useCounts.get(b.rune.id)?.deck ?? 0) - (useCounts.get(a.rune.id)?.deck ?? 0) ||
      b.maxScore - a.maxScore;
    return scoreAll
      .filter((t) => {
        const n = usesOf(t.rune.id);
        return n >= minUses && (maxUses <= 0 || n <= maxUses);
      })
      .sort((a, b) => {
        if (commonSort === "uses-asc") return usesOf(a.rune.id) - usesOf(b.rune.id) || b.maxScore - a.maxScore;
        if (commonSort === "now-asc") return a.scoreNow - b.scoreNow || tie(a, b);
        if (commonSort === "now-desc") return b.scoreNow - a.scoreNow || tie(a, b);
        if (commonSort === "target-desc") return b.maxScore - a.maxScore || tie(a, b);
        if (commonSort === "target-asc") return a.maxScore - b.maxScore || tie(a, b);
        return tie(a, b);
      });
  }, [scoreAll, useCounts, commonSort, minUses, maxUses]);

  /** 每顆候選目前符合的分類（顯示在卡片上，避免和精魔後的分類混淆） */
  const currentTagsOf = useMemo(() => {
    const map = new Map<number, RuneTagRule[]>();
    if (activeTags.length === 0) return map;
    for (const t of all) {
      const hit = activeTags.filter((rule) => matchesRuneTag(rule, t.rune));
      if (hit.length > 0) map.set(t.rune.id, hit);
    }
    return map;
  }, [all, activeTags]);

  const sets = useMemo(() => {
    const ids = new Set(account?.runes.map((r) => r.set) ?? []);
    return [...ids]
      .map((id) => ({ id, name: SET_BY_ID[id]?.name ?? `套裝 ${id}` }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-TW"));
  }, [account]);

  /** 主屬性篩選：只列出這份存檔實際出現過的主屬性 */
  const mainStats = useMemo(() => {
    const present = new Set(account?.runes.map((r) => r.main.t) ?? []);
    return ENCHANT_MAIN_STATS.filter((t) => present.has(t)).map((t) => ({ t, label: enchantStatLabel(t) }));
  }, [account]);

  /** 排除篩選只影響本頁清單，不會改到全域的符文限制 */
  const excludedSetSet = useMemo(() => new Set(excludedSets), [excludedSets]);
  const excludedRuneSet = useMemo(() => new Set(excludedRuneIds), [excludedRuneIds]);
  const runeMap = useMemo(() => new Map((account?.runes ?? []).map((r) => [r.id, r])), [account]);
  const excludeMatches = useMemo(() => {
    const term = excludeQ.trim().toLowerCase();
    if (!term) return [];
    return (account?.runes ?? [])
      .filter((r) =>
        `${r.id} ${SET_BY_ID[r.set]?.name ?? ""} ${STAT_TYPES[r.main.t]?.label ?? ""} ${owners.get(r.id)?.name ?? ""}`
          .toLowerCase()
          .includes(term),
      )
      .slice(0, 8);
  }, [account, excludeQ, owners]);

  /** 寶石只能用同套裝；遠古符文要用遠古寶石 */
  const gemNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of all) {
      const setName = SET_BY_ID[t.rune.set]?.name ?? "";
      map.set(String(t.rune.id), t.rune.ancient ? `遠古 ${setName}` : setName);
    }
    for (const t of scoreAll) {
      const key = String(t.rune.id);
      if (map.has(key)) continue;
      const setName = SET_BY_ID[t.rune.set]?.name ?? "";
      map.set(key, t.rune.ancient ? `遠古 ${setName}` : setName);
    }
    return map;
  }, [all, scoreAll]);

  const base = useMemo(
    () =>
      all.filter((t) => {
        if (onlyReady && t.rune.level < 12) return false;
        if (onlyEquipped && !t.owner) return false;
        if (onlySix && t.rune.grade !== 6) return false;
        if (setId && t.rune.set !== setId) return false;
        if (slots.length > 0 && !slots.includes(t.rune.slot)) return false;
        if (mainStat && t.rune.main.t !== mainStat) return false;
        if (excludedSetSet.has(t.rune.set) || excludedRuneSet.has(t.rune.id)) return false;
        return true;
      }),
    [all, onlyReady, onlyEquipped, onlySix, setId, slots, mainStat, excludedSetSet, excludedRuneSet],
  );

  /** 勾選「持有精煉石和精魔石素材」時，只留下素材齊全的候選 */
  const gemReady = useMemo(() => {
    if (!stockOn) return base;
    return base.map((t) => filterEnchantByStock(t, stock)).filter((t): t is EnchantTarget => t !== null);
  }, [base, stockOn, stock]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of gemReady) for (const id of t.ruleIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  }, [gemReady]);

  const candidates = useMemo(() => {
    if (tagFilter.length === 0) return gemReady;
    return gemReady.filter((t) => t.ruleIds.some((id) => tagFilter.includes(id)));
  }, [gemReady, tagFilter]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = candidates.filter((t) => {
      if (!term) return true;
      return (
        (t.owner?.name ?? "").toLowerCase().includes(term) ||
        (SET_BY_ID[t.rune.set]?.name ?? "").toLowerCase().includes(term) ||
        t.options.some(
          (o) => o.fromLabel.toLowerCase().includes(term) || o.toLabel.toLowerCase().includes(term),
        )
      );
    });
    return sortEnchantTargets(list, sort);
  }, [candidates, q, sort]);

  /** 分數模式：先套用結構篩選（+12 / 已裝備 / 6★ / 套裝 / 主屬 / 搜尋），再依目標分數過濾 */
  const scoreFiltered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return scoreAll.filter((t) => {
      if (onlyReady && t.rune.level < 12) return false;
      if (onlyEquipped && !t.owner) return false;
      if (onlySix && t.rune.grade !== 6) return false;
      if (setId && t.rune.set !== setId) return false;
      if (slots.length > 0 && !slots.includes(t.rune.slot)) return false;
      if (mainStat && t.rune.main.t !== mainStat) return false;
      if (excludedSetSet.has(t.rune.set) || excludedRuneSet.has(t.rune.id)) return false;
      if (!term) return true;
      return (
        (t.owner?.name ?? "").toLowerCase().includes(term) ||
        (SET_BY_ID[t.rune.set]?.name ?? "").toLowerCase().includes(term) ||
        t.options.some(
          (o) => o.fromLabel.toLowerCase().includes(term) || o.toLabel.toLowerCase().includes(term),
        )
      );
    });
  }, [scoreAll, onlyReady, onlyEquipped, onlySix, setId, slots, mainStat, q, excludedSetSet, excludedRuneSet]);

  /** 常用符文沿用上面所有的基本篩選，只換成常用符文的來源（排序由「排列」控制） */
  const commonFiltered = useMemo(
    () => commonAll.filter((t) => scoreFiltered.some((s) => s.rune.id === t.rune.id)),
    [commonAll, scoreFiltered],
  );

  /** 勾選「持有精煉石和精魔石素材」時，分數模式也只留下素材齊全的候選 */
  const scoreGemReady = useMemo(() => {
    if (!stockOn) return scoreFiltered;
    return scoreFiltered
      .map((t) => filterEnchantScoreByStock(t, stock))
      .filter((t): t is EnchantScoreTarget => t !== null);
  }, [scoreFiltered, stockOn, stock]);

  const scoreReach = useMemo(
    () => scoreGemReady.filter((t) => t.maxScore >= targetScore),
    [scoreGemReady, targetScore],
  );

  const scoreList = useMemo(() => {
    const list = onlyUnmet ? scoreReach.filter((t) => t.scoreNow < targetScore) : scoreReach;
    return sortEnchantScoreTargets(list, scoreSort);
  }, [scoreReach, onlyUnmet, scoreSort]);

  useEffect(() => {
    setTake(40);
  }, [mode, tagFilter, onlyEquipped, onlySix, onlyReady, assumeGrind, setId, slots, mainStat, onlyHaveStock, excludedSets, excludedRuneIds, q, sort, scoreSort, commonSort, minUses, maxUses, targetScore, onlyUnmet]);

  const summary = useMemo(() => {
    const six = gemReady.filter((t) => t.rune.grade === 6).length;
    const rules = new Set(gemReady.flatMap((t) => t.ruleIds));
    const gain = gemReady.length
      ? gemReady.reduce((s, t) => s + (t.bestEff - t.effNow), 0) / gemReady.length
      : 0;
    const best = gemReady.reduce((m, t) => Math.max(m, t.bestEff), 0);
    return { six, rules: rules.size, gain, best };
  }, [gemReady]);

  const scoreSummary = useMemo(() => {
    const met = scoreReach.filter((t) => t.scoreNow >= targetScore).length;
    const grindOnly = scoreReach.filter((t) => t.scoreNow < targetScore && t.maxNow >= targetScore).length;
    const best = scoreList.reduce((m, t) => Math.max(m, t.maxScore), 0);
    return { reach: scoreReach.length, met, grindOnly, best };
  }, [scoreReach, targetScore, scoreList]);

  if (!account) {
    return (
      <EmptyState
        icon={<FlaskConical size={40} />}
        title="尚未匯入存檔"
        desc="匯入 JSON 後，就能找出精魔（寶石變換）後符合自行分類、或能達到指定分數的符文。"
      />
    );
  }

  if (mode === "tag" && activeTags.length === 0) {
    return (
      <div className="card card-pad">
        <div className="card-title row" style={{ gap: 7 }}>
          <FlaskConical size={15} className="gold" /> 精魔建議
        </div>
        <div className="tiny dim" style={{ marginTop: 6, lineHeight: 1.7 }}>
          還沒有啟用中的自行分類。精魔建議會依「符文 → 自行分類」的規則，找出只差一條副屬性就能符合分類的符文。
          請先到符文頁建立或啟用分類（例如：輔助符 = 速度、體力%、防禦%、效果抵抗）；
          或切換到「依分數」找出達標的符文，或切到「常用符文」看預設隊 / RTA 常用的符文。
        </div>
        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => { window.location.hash = "#/runes"; }}
          >
            前往符文頁設定自行分類
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setMode("score")}
          >
            改用分數標準
          </button>
        </div>
      </div>
    );
  }

  const shown = filtered.slice(0, take);
  const scoreShown = scoreList.slice(0, take);
  const commonShown = commonFiltered.slice(0, take);
  const commonDeck = mode === "common" ? commonFiltered.filter((t) => (useCounts.get(t.rune.id)?.deck ?? 0) > 0).length : 0;
  const commonRta = mode === "common" ? commonFiltered.filter((t) => (useCounts.get(t.rune.id)?.rta ?? 0) > 0).length : 0;
  const commonUses = mode === "common"
    ? commonFiltered.reduce((s, t) => s + (useCounts.get(t.rune.id)?.total ?? 0), 0)
    : 0;

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 12 }}>
        <div>
          <div className="card-title row" style={{ gap: 7 }}>
            <FlaskConical size={15} className="gold" /> 精魔建議
          </div>
          <div className="card-sub">
            {mode === "tag"
              ? "找出「換掉一條副屬性後，就會符合自行分類」的符文；只列出目前不符合、而且只差一條屬性的符文。"
              : mode === "common"
                ? "列出預設隊 / 防守隊與 RTA 常用到的符文；可用「排列」自訂使用次數 / 目前分數 / 目標分數，並設定使用次數上下限，卡片仍顯示精魔建議。"
                : "不需要自行分類：直接算出「精魔一次＋精煉到上限」後能達到目標分數的符文。"}
            數值以 6★ 傳說寶石＋精煉上限估算，實際會依寶石與磨石等級、骰值較低；效率不設上限，超過 100% 會照實顯示。
          </div>
        </div>
        <span className="chip gold">
          {mode === "tag"
            ? `精魔候選 ${gemReady.length} 顆`
            : mode === "common"
              ? `常用 ${commonFiltered.length} 顆`
              : `可達 ${targetScore} 分 ${scoreReach.length} 顆`}
        </span>
      </div>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        {mode === "common" ? (
          <>
            <Tile k="常用符文" v={String(commonFiltered.length)} sub="預設隊 / RTA 用過" />
            <Tile k="預設隊使用" v={String(commonDeck)} sub="含防守隊" />
            <Tile k="RTA 使用" v={String(commonRta)} sub="世界競技場獨立配裝" />
            <Tile k="總使用次數" v={String(commonUses)} sub="最常用排最前面" />
          </>
        ) : mode === "tag" ? (
          <>
            <Tile k="精魔候選" v={String(gemReady.length)} sub="一次寶石就能符合分類" />
            <Tile k="可符合分類" v={String(summary.rules)} sub={`啟用中 ${activeTags.length} 個分類`} />
            <Tile k="6★ 符文" v={String(summary.six)} sub="其餘為 5★ 以下" />
            <Tile
              k="平均效率變化"
              v={fmtGain(summary.gain) + "%"}
              sub={summary.best > 0 ? `最高精魔後 ${Math.round(summary.best)}%` : "目前沒有候選"}
            />
          </>
        ) : (
          <>
            <Tile k={`可達 ${targetScore} 分`} v={String(scoreSummary.reach)} sub="精魔＋精煉到上限" />
            <Tile k="已達標" v={String(scoreSummary.met)} sub="目前分數就足夠" />
            <Tile k="精煉即可達標" v={String(scoreSummary.grindOnly)} sub="不用精魔" />
            <Tile
              k={stockOn ? "最高持有素材分數" : "最高 MAX"}
              v={scoreSummary.best > 0 ? String(scoreSummary.best) : "—"}
              sub={scoreSummary.best > 0 ? "此清單最高分" : "目前沒有候選"}
            />
          </>
        )}
      </div>

      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          <button
            type="button"
            className={`chip ${mode === "tag" ? "gold" : "muted"}`}
            style={{ cursor: "pointer" }}
            onClick={() => setMode("tag")}
          >
            依分類
          </button>
          <button
            type="button"
            className={`chip ${mode === "score" ? "gold" : "muted"}`}
            style={{ cursor: "pointer" }}
            onClick={() => setMode("score")}
          >
            依分數
          </button>
          <button
            type="button"
            className={`chip ${mode === "common" ? "gold" : "muted"}`}
            style={{ cursor: "pointer" }}
            onClick={() => setMode("common")}
          >
            常用符文
          </button>
          <span className="tiny dim" style={{ alignSelf: "center" }}>
            {mode === "tag"
              ? "找出精魔後能符合自行分類的符文"
              : mode === "common"
                ? "列出預設隊 / RTA 常用符文，可用「排列」自訂排序方式與使用次數範圍"
                : "以遊戲分數為標準，找精魔＋精煉後能達標的符文"}
          </span>
        </div>

        {mode === "score" && (
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
            <label className="row tiny" style={{ gap: 6, cursor: "pointer" }} title="只看目前分數還沒到目標的符文">
              <input type="checkbox" checked={onlyUnmet} onChange={(e) => setOnlyUnmet(e.target.checked)} />
              只看還沒達標
            </label>
            <span className="tiny dim">
              只列出「精魔一次＋其他可精煉副屬性拉到上限」可達 {targetScore} 分以上的符文
            </span>
          </div>
        )}

        {mode === "common" && (
          <div className="row wrap" style={{ gap: 8, marginTop: 10, alignItems: "center" }}>
            <span className="tiny dim">使用次數</span>
            <NumberInput className="input mono" style={{ width: 68 }} min={1} max={999} step={1} value={minUses} onChange={setMinUses} />
            <span className="tiny dim">～</span>
            <NumberInput className="input mono" style={{ width: 68 }} min={0} max={999} step={1} value={maxUses} onChange={setMaxUses} />
            <span className="tiny dim">次（上限 0 = 不限）</span>
          </div>
        )}

        {mode === "tag" && (
          <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
            <span className="tiny dim" title="在「符文 → 自行分類」設定的分類；只顯示啟用中的分類">
              自行分類
            </span>
            <button
              type="button"
              className={`chip ${tagFilter.length === 0 ? "gold" : "muted"}`}
              style={{ cursor: "pointer" }}
              onClick={() => setTagFilter([])}
            >
              全部 · {gemReady.length}
            </button>
            {activeTags.map((rule) => {
              const on = tagFilter.includes(rule.id);
              const count = tagCounts.get(rule.id) ?? 0;
              return (
                <button
                  key={rule.id}
                  type="button"
                  className={`chip ${on ? "gold" : "muted"}`}
                  style={{ cursor: "pointer" }}
                  aria-pressed={on}
                  title={`${describeRuneTag(rule)}；精魔後可符合 ${count} 顆`}
                  onClick={() =>
                    setTagFilter((prev) => (prev.includes(rule.id) ? prev.filter((x) => x !== rule.id) : [...prev, rule.id]))
                  }
                >
                  {rule.name} · {count}
                </button>
              );
            })}
          </div>
        )}

        <div className="row filter-row" style={{ gap: 8, marginTop: 12 }}>
          <div style={{ position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: "var(--muted-2)" }} />
            <input
              className="input"
              style={{ width: 230, paddingLeft: 28 }}
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
          <select
            className="select"
            style={{ width: 120 }}
            value={mainStat}
            onChange={(e) => setMainStat(Number(e.target.value))}
            title="依符文主屬性篩選（例如只看 2 號速度或 4 號暴傷）"
          >
            <option value={0}>全部主屬</option>
            {mainStats.map((s) => (
              <option key={s.t} value={s.t}>{s.label}</option>
            ))}
          </select>
          <div className="row" style={{ gap: 6 }}>
            <span className="tiny dim">排列</span>
            {mode === "tag" ? (
              <select
                className="select"
                style={{ width: 165 }}
                value={sort}
                onChange={(e) => setSort(e.target.value as EnchantSort)}
                title={ENCHANT_SORTS.find((s) => s.key === sort)?.desc}
              >
                {ENCHANT_SORTS.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            ) : mode === "common" ? (
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
            ) : (
              <select
                className="select"
                style={{ width: 175 }}
                value={scoreSort}
                onChange={(e) => setScoreSort(e.target.value as EnchantScoreSort)}
                title={ENCHANT_SCORE_SORTS.find((s) => s.key === scoreSort)?.desc}
              >
                {ENCHANT_SCORE_SORTS.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            )}
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

        <div className="row wrap" style={{ gap: 14, marginTop: 10, alignItems: "center" }}>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }} title="遊戲規定符文要 +12 以上才能使用精魔寶石">
            <input type="checkbox" checked={onlyReady} onChange={(e) => setOnlyReady(e.target.checked)} /> 只看 +12 以上（可精魔）
          </label>
          {mode === "tag" && (
            <label className="row tiny" style={{ gap: 6, cursor: "pointer" }} title="精魔後通常會再用磨石把新副屬性補高；關閉則只計算寶石本身數值">
              <input type="checkbox" checked={assumeGrind} onChange={(e) => setAssumeGrind(e.target.checked)} /> 假設精魔後精煉滿
            </label>
          )}
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={onlyEquipped} onChange={(e) => setOnlyEquipped(e.target.checked)} /> 只看已裝備
          </label>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={onlySix} onChange={(e) => setOnlySix(e.target.checked)} /> 只看 6★
          </label>
          <label
            className="row tiny"
            style={{ gap: 6, cursor: hasStockData ? "pointer" : "not-allowed", opacity: hasStockData ? 1 : 0.55 }}
            title="只列出「換成你手上真的有的寶石，而且精煉也用你持有的磨石」就能精魔的符文（同套裝 / 無形 / 遠古規則）"
          >
            <input
              type="checkbox"
              checked={stockOn}
              disabled={!hasStockData}
              onChange={(e) => setOnlyHaveStock(e.target.checked)}
            />
            只列出持有精煉石和精魔石素材的符文
          </label>
          <span className="tiny dim">
            {hasStockData
              ? `持有 ${stock.grindstones.length} 種磨石（共 ${grindTotal} 個）· ${stock.gems.length} 種寶石（共 ${gemTotal} 個）`
              : "此存檔沒有精煉石／精魔石素材資料，請重新匯入一次 JSON"}
          </span>
          <span className="tiny dim">
            {mode === "tag"
              ? `顯示 ${filtered.length} / ${gemReady.length} 顆`
              : mode === "common"
                ? `顯示 ${commonFiltered.length} / ${commonAll.length} 顆`
                : `顯示 ${scoreList.length} / ${scoreGemReady.length} 顆`}
          </span>
          {(onlyEquipped || onlySix || !onlyReady || setId || slots.length > 0 || mainStat || onlyHaveStock || excludedSets.length > 0 || excludedRuneIds.length > 0 || q || tagFilter.length > 0 || commonSort !== "uses-desc" || minUses !== 1 || maxUses !== 0 || (!onlyUnmet && mode === "score")) && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setOnlyEquipped(false);
                setOnlySix(false);
                setOnlyReady(true);
                setSetId(0);
                setSlots([]);
                setMainStat(0);
                setOnlyHaveStock(false);
                setExcludedSets([]);
                setExcludedRuneIds([]);
                setExcludeQ("");
                setQ("");
                setTagFilter([]);
                setOnlyUnmet(true);
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

      {(excludedSets.length > 0 || excludedRuneIds.length > 0) && (
        <div className="row wrap tiny" style={{ gap: 8, margin: "0 0 12px", alignItems: "center" }}>
          <Ban size={13} className="gold" />
          <span className="dim">
            已排除 {excludedSets.length} 個套裝、{excludedRuneIds.length} 顆符文（只影響這頁的精魔建議清單）
          </span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setExcludedSets([]); setExcludedRuneIds([]); }}>
            清除排除
          </button>
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="row between wrap" style={{ gap: 8 }}>
          <div className="card-title row" style={{ gap: 7 }}>
            <Ban size={15} className="gold" /> 排除符文 / 排除套裝
          </div>
          <span className="tiny dim">點一下加入或移除；只影響這頁的清單，不會改到全域的符文限制</span>
        </div>
        <div className="row wrap" style={{ gap: 6, marginTop: 10, alignItems: "center" }}>
          <span className="tiny dim">排除套裝</span>
          {sets.map((s) => {
            const on = excludedSetSet.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                className={`chip ${on ? "gold" : "muted"}`}
                style={{ cursor: "pointer" }}
                aria-pressed={on}
                title={on ? `取消排除 ${s.name}` : `排除 ${s.name} 的符文`}
                onClick={() =>
                  setExcludedSets((prev) => (prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]))
                }
              >
                {on ? "− " : ""}{s.name}
              </button>
            );
          })}
        </div>
        <div className="row wrap" style={{ gap: 8, marginTop: 10, alignItems: "flex-start" }}>
          <span className="tiny dim" style={{ alignSelf: "center" }}>排除符文</span>
          <div style={{ position: "relative", minWidth: 230 }}>
            <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: "var(--muted-2)" }} />
            <input
              className="input"
              style={{ width: "100%", paddingLeft: 28 }}
              placeholder="搜尋符文 ID / 套裝 / 主屬 / 擁有者"
              value={excludeQ}
              onChange={(e) => setExcludeQ(e.target.value)}
            />
            {excludeQ.trim() && (
              <div className="rune-search-pop">
                {excludeMatches.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setExcludedRuneIds((prev) => (prev.includes(r.id) ? prev : [...prev, r.id]));
                      setExcludeQ("");
                    }}
                  >
                    <span>{excludeRuneLabel(r)}</span>
                    <span className="tiny dim">{owners.get(r.id)?.name ?? "未裝備"} · ID {r.id}</span>
                  </button>
                ))}
                {excludeMatches.length === 0 && <div className="empty tiny" style={{ padding: 12 }}>找不到符文</div>}
              </div>
            )}
          </div>
          {excludedRuneIds.length > 0 && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setExcludedRuneIds([])}>
              <X size={12} /> 清除排除符文
            </button>
          )}
          {excludedRunes.length > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              title="把全域「符文限制」排除的符文加入這頁的排除清單"
              onClick={() => setExcludedRuneIds((prev) => [...new Set([...prev, ...excludedRunes])])}
            >
              <Ban size={12} /> 加入全域排除（{excludedRunes.length}）
            </button>
          )}
        </div>
        {excludedRuneIds.length > 0 && (
          <div className="rune-chip-list" style={{ marginTop: 8 }}>
            {excludedRuneIds.map((id) => {
              const r = runeMap.get(id);
              return (
                <span key={id} className="rune-chip">
                  {r ? excludeRuneLabel(r) : `符文 ${id}`}
                  <span className="dim tiny">{r ? owners.get(id)?.name ?? "未裝備" : ""}</span>
                  <button type="button" title="移除" onClick={() => setExcludedRuneIds((prev) => prev.filter((x) => x !== id))}>
                    <X size={10} />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      <details className="card card-pad grind-guide" style={{ marginBottom: 14 }}>
        <summary className="card-title" style={{ cursor: "pointer" }}>精魔規則與使用建議</summary>
        <ol>
          <li><b>精魔是「換屬性」，不是加數值。</b>寶石會把一條副屬性整個換成另一條，原本的強化（+3 / +6 / +9 / +12）與精煉都會消失，換完要重新精煉。</li>
          <li><b>只能換一條。</b>每顆符文只能選一條副屬性精魔；之後再用寶石也只能換同一條，不能改別條。</li>
          <li><b>不能重複。</b>新屬性不能和主屬性、其他副屬性、固有屬性重複；也不能換成符文已經有的屬性。</li>
          <li><b>位置限制。</b>1 號位不可能出現防禦力／防禦力%，3 號位不可能出現攻擊力／攻擊力%（掉落時就不會給，精魔也轉不出來），所以這頁不會建議把這些屬性轉到那兩個位置；2 / 4 / 5 / 6 號位沒有這類限制。</li>
          <li><b>需要 +12。</b>符文至少要 +12 才能使用精魔寶石，所以此頁預設只列 +12 以上的符文。</li>
          <li><b>寶石要同套裝。</b>一般寶石只能用在同一套裝的符文；遠古符文要用遠古寶石；無形寶石則不限套裝。精煉也一樣要同套裝磨石（遠古符文用遠古磨石）。</li>
          <li><b>數值怎麼看。</b>此頁用 6★ 傳說寶石＋傳說磨石上限估算：體攻防% 13＋10、速度 10＋5、固定體力 580＋550、固定攻防 40＋30；暴率 9、暴傷 10、抵抗／命中 11（這四條不能精煉，所以只有寶石數值）。實際會依寶石與磨石等級、骰值而較低；上方可關閉「假設精魔後精煉滿」，只看寶石本身。因此門檻若高於上述合計上限（例如抵抗要 20），單靠一顆寶石＋精煉也補不到。</li>
          <li><b>先看分類。</b>選一個自行分類（例如輔助符），頁面只會列出精魔後能符合它的符文，再用效率或符文分數排序，挑你真正會用的那幾顆。</li>
          <li><b>依分數。</b>不需要自行分類，直接用遊戲分數（副屬性＋固有屬性，含精煉；不含主屬性與套裝）當標準。輸入目標分數（例如 250）後，頁面會枚舉所有合法精魔方式，只列出「精魔一次＋其他可精煉副屬性都拉到上限」能達到該分數的符文，並列出要換哪一條、換成什麼、還要不要再精煉。MAX 是最理想值：只看分數高低，不管換出來的屬性你會不會用（例如把抵抗換成體力% 只為了墊分），實際也會依寶石與磨石等級、骰值而較低。</li>
          <li><b>已達標與精煉即可達標。</b>「已達標」代表目前分數就夠；「精煉即可達標」代表不用精魔，只要把現有可精煉副屬性拉滿就到目標。想看這兩類可以取消「只看還沒達標」。</li>
          <li><b>持有精煉石和精魔石素材。</b>勾選後只列出「換成你手上真的有的寶石」、而且「精魔後要用來精煉的磨石也真的持有」的符文；素材要比照套裝（遠古符文用遠古素材、無形素材不限套裝）且屬性正確。暴率 / 暴傷 / 抵抗 / 命中不能精煉，不需要磨石；在「依分類」關閉「假設精魔後精煉滿」時也不需要磨石。<b>分數會改以持有素材的等級計算</b>：卡片顯示「持有素材精滿 X 分」，而不是 6★ 傳說上限的 MAX；是否達標也用這個分數判斷。卡片會列出用到的素材、等級、可加數值與持有數量。舊存檔若沒有素材資料，請重新匯入一次 JSON；素材數量不會跨符文扣除。</li>
          <li><b>主屬 / 位置篩選。</b>可依符文主屬性（例如 2 號速度、4 號暴傷、6 號體力%）縮小清單；下拉只列出這份存檔實際擁有的主屬性。位置 1–6 可多選，和套裝、主屬、持有素材等條件一起生效。</li>
          <li><b>排除符文 / 排除套裝。</b>在「排除符文 / 排除套裝」卡片點套裝即可排除整套，或搜尋符文 ID / 套裝 / 主屬 / 擁有者加入單顆排除；兩者可疊加，也和上面的套裝、主屬、持有素材等條件一起生效。這些排除只影響精魔建議這一頁，不會改到全域「符文限制」的排除清單（卡片上的「排除」標記仍來自全域設定）。</li>
          <li><b>常用符文。</b>切到這個方向會列出預設隊 / 防守隊與 RTA 配裝用到的符文；「排列」可選使用次數、目前分數或目標分數的高低，也能設使用次數下限／上限（上限 0 = 不限）。卡片會顯示「常用 N 次」與預設隊 / RTA 的細項。次數是匯出當下的快照，同一顆符文可同時在一般與 RTA 使用；仍可搭配上面的套裝、主屬、搜尋與排除篩選。</li>
        </ol>
      </details>

      {mode === "tag" ? (
        filtered.length === 0 ? (
          <div className="empty card" style={{ padding: "40px 16px" }}>
            <FlaskConical size={34} style={{ opacity: .3, marginBottom: 8 }} />
            <div style={{ fontWeight: 600, color: "var(--text)" }}>沒有符合條件的精魔候選</div>
            <div className="tiny dim" style={{ marginTop: 4, lineHeight: 1.7 }}>
              目前沒有「只差一條副屬性」就能符合所選分類的符文。可能是分類門檻高於寶石＋精煉上限
              （例如抵抗要 20，但抵抗不能精煉、6★ 傳說寶石最多 11）、符文已經符合，或篩選條件太窄；
              可以取消「只看 +12 以上 / 只看 6★ / 只看已裝備 / 只列出持有精煉石和精魔石素材」、改回全部主屬，或換一個分類試試。
            </div>
          </div>
        ) : (
          <>
            <div className="grind-list">
              {shown.map((t) => (
                <EnchantCard
                  key={t.rune.id}
                  t={t}
                  setName={gemNames.get(String(t.rune.id)) ?? ""}
                  heldMaterials={stockOn && t.options[0] ? heldMaterialsLabel(t.rune, t.options[0].toT, t.options[0].toGrind, stock) : ""}
                  locked={lockedSet.has(t.rune.id)}
                  excluded={excludedSet.has(t.rune.id)}
                  currentTags={(currentTagsOf.get(t.rune.id) ?? []).map((r) => r.name)}
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
        )
      ) : mode === "common" ? (
        commonFiltered.length === 0 ? (
          <div className="empty card" style={{ padding: "40px 16px" }}>
            <FlaskConical size={34} style={{ opacity: .3, marginBottom: 8 }} />
            <div style={{ fontWeight: 600, color: "var(--text)" }}>找不到常用的符文</div>
            <div className="tiny dim" style={{ marginTop: 4, lineHeight: 1.7 }}>
              這份存檔沒有預設隊 / 防守隊或 RTA 的配裝快照；請先在遊戲裡存好隊伍再重新匯出 JSON，或放寬上面的篩選條件。
            </div>
          </div>
        ) : (
          <>
            <div className="grind-list">
              {commonShown.map((t) => (
                <EnchantScoreCard
                  key={t.rune.id}
                  t={t}
                  setName={gemNames.get(String(t.rune.id)) ?? ""}
                  heldMaterials=""
                  stockOn={false}
                  useCount={useCounts.get(t.rune.id)}
                  targetScore={targetScore}
                  locked={lockedSet.has(t.rune.id)}
                  excluded={excludedSet.has(t.rune.id)}
                  currentTags={activeTags.filter((rule) => matchesRuneTag(rule, t.rune)).map((r) => r.name)}
                  onToggleLock={() => toggleRuneFlag("locked", t.rune.id)}
                  onToggleExclude={() => toggleRuneFlag("excluded", t.rune.id)}
                />
              ))}
            </div>
            {commonFiltered.length > commonShown.length && (
              <div className="row" style={{ justifyContent: "center", marginTop: 14 }}>
                <button type="button" className="btn" onClick={() => setTake((n) => n + 40)}>
                  顯示更多（還有 {commonFiltered.length - commonShown.length} 顆）
                </button>
              </div>
            )}
          </>
        )
      ) : scoreList.length === 0 ? (
        <div className="empty card" style={{ padding: "40px 16px" }}>
          <FlaskConical size={34} style={{ opacity: .3, marginBottom: 8 }} />
          <div style={{ fontWeight: 600, color: "var(--text)" }}>沒有符文能在精魔＋精煉後達到 {targetScore} 分</div>
          <div className="tiny dim" style={{ marginTop: 4, lineHeight: 1.7 }}>
            可以降低目標分數、取消「只看 +12 以上 / 只看 6★ / 只看已裝備 / 只列出持有精煉石和精魔石素材」、改回全部主屬，
            或取消「只看還沒達標」看看已經達標的符文。MAX 是以 6★ 傳說寶石＋精煉上限估算的理想值。
          </div>
        </div>
      ) : (
        <>
          <div className="grind-list">
            {scoreShown.map((t) => (
              <EnchantScoreCard
                key={t.rune.id}
                t={t}
                setName={gemNames.get(String(t.rune.id)) ?? ""}
                heldMaterials={stockOn && t.best ? heldMaterialsLabel(t.rune, t.best.toT, t.best.toGrind, stock) : ""}
                stockOn={stockOn}
                targetScore={targetScore}
                locked={lockedSet.has(t.rune.id)}
                excluded={excludedSet.has(t.rune.id)}
                currentTags={activeTags.filter((rule) => matchesRuneTag(rule, t.rune)).map((r) => r.name)}
                onToggleLock={() => toggleRuneFlag("locked", t.rune.id)}
                onToggleExclude={() => toggleRuneFlag("excluded", t.rune.id)}
              />
            ))}
          </div>
          {scoreList.length > scoreShown.length && (
            <div className="row" style={{ justifyContent: "center", marginTop: 14 }}>
              <button type="button" className="btn" onClick={() => setTake((n) => n + 40)}>
                顯示更多（還有 {scoreList.length - scoreShown.length} 顆）
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
