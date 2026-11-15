import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, Info, ListOrdered, Search, Sparkles } from "lucide-react";
import { MONSTER_MAP, monsterLabel, unitLabel, useStore } from "../store";
import { ArtifactCard, MonsterIcon, NumberInput, RuneCard, StatGrid, fmt } from "../components/ui";
import { MonsterDetailModal } from "../components/MonsterDetail";
import { SET_BY_ID } from "../lib/constants";
import { allSkillsForMonster, loadSkillData, type SkillData } from "../lib/damage";
import {
  FOCUS_LABEL,
  WB_ALLOCATION_LABEL,
  WB_ARCH_LABEL,
  WB_MAIN_LABEL,
  WB_MODE_LABEL,
  WB_TIER_LABEL,
  buildWorldBossPlan,
  type WbAllocation,
  type WbMainStat,
  type WbMode,
  type WbMonsterPlan,
} from "../lib/worldBossAdvice";

type SortKey = "runeScore" | "priority" | "focus" | "skill";

/** 遊戲內「魔靈分類」的顯示名稱：有自訂名稱就用，否則用預設分類編號 */
function categoryLabel(names: Record<number, string> | undefined, category: number): string {
  const custom = names?.[category]?.trim();
  if (custom) return `分類 ${category}「${custom}」`;
  return `分類 ${category}`;
}

/** 符文盤排列：6 1 2 / 5 4 3 */
const RUNE_BOARD_ORDER = [6, 1, 2, 5, 4, 3] as const;

/** 把 2/4/6 實際主屬性變成「2/4 體力% · 6 防禦力%」 */
function mainPlanText(plan: WbMonsterPlan): string {
  const groups = new Map<WbMainStat, number[]>();
  for (const slot of [2, 4, 6]) {
    const stat = plan.mainPlan[slot];
    const slots = groups.get(stat) ?? [];
    slots.push(slot);
    groups.set(stat, slots);
  }
  if (groups.size === 1) {
    const [stat] = [...groups.keys()];
    return `${WB_MAIN_LABEL[stat]}%`;
  }
  return [...groups.entries()]
    .map(([stat, slots]) => `${slots.join("/")} ${WB_MAIN_LABEL[stat]}%`)
    .join(" · ");
}

function PlanCard({
  plan,
  runeOwner,
  artifactOwner,
  targetMode,
}: {
  plan: WbMonsterPlan;
  runeOwner: Map<number, string>;
  artifactOwner: Map<number, string>;
  /** 設定了目標平均：未安排的魔靈會保留空位 */
  targetMode?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const runesBySlot = new Map(plan.runes.map((rune) => [rune.slot, rune]));

  return (
    <>
      <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="row between wrap" style={{ gap: 10, alignItems: "flex-start" }}>
          <div className="row" style={{ gap: 10, minWidth: 0 }}>
            <MonsterIcon id={plan.unit.master} size={46} />
            <div style={{ minWidth: 0 }}>
              <div className="row wrap" style={{ gap: 6, fontWeight: 800 }}>
                <span>{monsterLabel(plan.unit.master)}</span>
                <span className="rune-tag muted">{plan.monster.nat}★原生</span>
                {plan.tier === 1 && <span className="rune-tag">二覺</span>}
              </div>
              <div className="tiny dim">
                {WB_TIER_LABEL[plan.tier] ?? "其他"} · {WB_ARCH_LABEL[plan.monster.arch ?? ""] ?? plan.monster.arch ?? "?"} ·{" "}
                {plan.skillReq !== undefined
                  ? `技能需求 +${plan.skillReq}${plan.skillUps !== undefined ? ` · 目前 +${plan.skillUps}` : ""}`
                  : plan.skillUps === undefined
                    ? "技能資料未提供"
                    : `技能 +${plan.skillUps}`}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setOpen(true)}
            title="查看完整面板（三圍、符文、神器）"
          >
            完整面板
          </button>
        </div>

        <div className="row wrap" style={{ gap: 5 }}>
          <span className="chip gold" title="主要堆疊的面板屬性">
            {FOCUS_LABEL[plan.focus]} {fmt(plan.focusValue)}
          </span>
          {plan.previousScore !== undefined ? (
            <span
              className={`chip ${plan.runeScoreTotal > plan.previousScore ? "gold" : "muted"}`}
              title="只補空位：保留現有符文，補上／換上未裝備的符文後的 ◆ 總和"
            >
              ◆ {fmt(plan.previousScore)} → {fmt(plan.runeScoreTotal)}
              {plan.runeScoreTotal > plan.previousScore &&
                `（+${fmt(plan.runeScoreTotal - plan.previousScore)}）`}
            </span>
          ) : (
            <span className="chip" title="6 顆符文的遊戲分數（◆）總和">
              ◆ 總分 {fmt(plan.runeScoreTotal)}
            </span>
          )}
          {plan.addedRunes && plan.addedRunes.length > 0 && (() => {
            const swapped = plan.removedRunes?.length ?? 0;
            const filled = plan.addedRunes.length - swapped;
            return (
              <>
                {filled > 0 && (
                  <span className="chip muted" title="這次補上原本空位的符文">
                    補上 {filled} 顆
                  </span>
                )}
                {swapped > 0 && (
                  <span className="chip muted" title="這次換掉較弱的符文">
                    換上 {swapped} 顆
                  </span>
                )}
              </>
            );
          })()}
          <span
            className="chip muted"
            title={`2/4/6 位實際主屬性（依魔靈類型${plan.monster.arch === "Support" ? `與基本體力 ${fmt(plan.base.hp)}／防禦 ${fmt(plan.base.def)}` : ""}決定；4 號位可用爆傷／爆率）`}
          >
            2/4/6：{mainPlanText(plan)}
          </span>
          {plan.setLayout === "2+2+2" && (
            <span className="chip gold" title="三組 2 件套">2+2+2</span>
          )}
          {plan.setLayout === "4+2" && (
            <span className="chip gold" title="四件套 + 二件套">4+2</span>
          )}
          {plan.setLayout === "混搭" && (
            <span className="chip muted" title="未能完整湊成 2+2+2 或 4+2">混搭</span>
          )}
          {plan.sets.map((s) => (
            <span key={s.set} className="chip muted" title="每 2 件觸發一次套裝效果">
              {SET_BY_ID[s.set]?.name ?? `套裝${s.set}`} ×{s.count}
            </span>
          ))}
        </div>

        <StatGrid stats={plan.stats} compact />

        <div className="row between wrap tiny dim" style={{ gap: 6 }}>
          <span>符文 {plan.runes.length}/6 · 神器 {plan.artifacts.length}/2</span>
          <span>速度不計；爆率／爆傷主要用於 4 號位及少量分數</span>
        </div>

        <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
          {RUNE_BOARD_ORDER.map((slot) => {
            const rune = runesBySlot.get(slot);
            if (!rune) {
              return (
                <div
                  key={`empty-${slot}`}
                  className="rune"
                  style={{ minHeight: 120, alignItems: "center", justifyContent: "center", opacity: 0.55 }}
                >
                  <span className="rune-slot">位置 {slot}</span>
                  <span className="tiny dim">
                    {targetMode ? "未安排符文" : "沒有可用符文"}
                  </span>
                </div>
              );
            }
            const owner = runeOwner.get(rune.id);
            const isNew = plan.addedRunes?.some((r) => r.id === rune.id);
            const replaced = (plan.removedRunes?.length ?? 0) > 0;
            return (
              <RuneCard key={rune.id} rune={rune} owner={owner ? `現在：${owner}` : "現在：未裝備"}>
                {isNew && (
                  <span className="rune-tag gold">{replaced ? "換上" : "新增（補空位）"}</span>
                )}
              </RuneCard>
            );
          })}
        </div>

        {plan.artifacts.length > 0 ? (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
            {plan.artifacts.map((art) => {
              const owner = artifactOwner.get(art.id);
              return <ArtifactCard key={art.id} artifact={art} owner={owner ? `現在：${owner}` : "現在：未裝備"} />;
            })}
          </div>
        ) : (
          <div className="tiny dim">沒有符合屬性 / 類型的神器</div>
        )}
      </div>

      {open && (
        <MonsterDetailModal
          title={`${monsterLabel(plan.unit.master)} · 世界王建議`}
          monster={plan.monster}
          base={plan.base}
          stats={plan.stats}
          stars={plan.unit.stars}
          level={plan.unit.level}
          runes={plan.runes}
          artifacts={plan.artifacts}
          ownerName={unitLabel(plan.unit)}
          note="數值依世界王建議配裝計算；速度、暴擊率、暴擊傷害不計入配符評分。"
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export default function WorldBossAdvicePage() {
  const account = useStore((s) => s.account);
  const bonus = useStore((s) => s.settings.bonus);
  const excludedRunes = useStore((s) => s.settings.excludedRunes);
  const [count, setCount] = useState(60);
  const [minRuneTotal, setMinRuneTotal] = useState(0);
  const [allocation, setAllocation] = useState<WbAllocation>("balanced");
  const [mode, setMode] = useState<WbMode>("rebuild");
  const [category, setCategory] = useState(0);
  /** 只補空位模式：目標平均符文總分（0 = 不設定） */
  const [targetAvg, setTargetAvg] = useState(0);
  /** 只補空位時：只列出需要補符文的魔靈 */
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [freeOnly, setFreeOnly] = useState(false);
  const [arch, setArch] = useState("");
  const [sort, setSort] = useState<SortKey>("runeScore");
  const [q, setQ] = useState("");
  const [skillData, setSkillData] = useState<SkillData | null>(null);

  useEffect(() => {
    let alive = true;
    loadSkillData()
      .then((data) => { if (alive) setSkillData(data); })
      .catch(() => { /* 沒有技能資料時沿用存檔中的目前已升級次數 */ });
    return () => { alive = false; };
  }, []);

  /** 技能升滿所需次數：各技能 (max - 1) 的總和，例如水猴 12 */
  const skillReqOf = useCallback(
    (master: number) => {
      if (!skillData) return undefined;
      const skills = allSkillsForMonster(skillData, master);
      if (!skills.length) return undefined;
      return skills.reduce((sum, skill) => sum + Math.max(0, (skill.max || 1) - 1), 0);
    },
    [skillData],
  );

  /** 帳號內實際用到的魔靈分類（含數量），給分類選單用 */
  const categoryOptions = useMemo(() => {
    const counts = new Map<number, number>();
    for (const u of account?.units ?? []) {
      if (u.category === undefined) continue;
      counts.set(u.category, (counts.get(u.category) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0] - b[0]);
  }, [account]);

  const plan = useMemo(
    () =>
      account
        ? buildWorldBossPlan(account, {
            count,
            // 指定分類時以分類為準（你在遊戲內親手挑的魔靈），否則預設只看水系
            waterOnly: category === 0,
            category,
            mode,
            targetAvg: mode === "topup" ? targetAvg : 0,
            excludedRunes,
            freeOnly,
            bonus,
            allocation,
            skillReqOf,
            monsterOf: (id) => MONSTER_MAP.get(id),
          })
        : [],
    [account, count, category, mode, targetAvg, excludedRunes, freeOnly, bonus, allocation, skillReqOf],
  );

  /** 最低符文總和只影響下方清單，不會改動平衡配符的結果 */
  const qualified = useMemo(
    () => (minRuneTotal > 0 ? plan.filter((p) => p.runeScoreTotal >= minRuneTotal) : plan),
    [plan, minRuneTotal],
  );

  const runeOwner = useMemo(() => {
    const m = new Map<number, string>();
    for (const u of account?.units ?? []) for (const rid of u.runes) m.set(rid, unitLabel(u));
    return m;
  }, [account]);

  const artifactOwner = useMemo(() => {
    const m = new Map<number, string>();
    for (const u of account?.units ?? []) for (const aid of u.artifacts) m.set(aid, unitLabel(u));
    return m;
  }, [account]);

  const waterCount = useMemo(
    () => (account?.units ?? []).filter((u) => MONSTER_MAP.get(u.master)?.el === 1).length,
    [account],
  );
  const categoryCount = useMemo(
    () => (category > 0 ? (account?.units ?? []).filter((u) => u.category === category).length : 0),
    [account, category],
  );
  const hasSkillData = useMemo(
    () => (account?.units ?? []).some((u) => u.skillUps !== undefined),
    [account],
  );
  const hasCategoryData = useMemo(
    () => (account?.units ?? []).some((u) => u.category !== undefined),
    [account],
  );

  const arches = useMemo(() => {
    const set = new Set<string>();
    for (const p of qualified) if (p.monster.arch) set.add(p.monster.arch);
    return [...set].sort();
  }, [qualified]);

  /** 只補空位模式：有補到／換到符文的魔靈數量 */
  const changedCount = useMemo(
    () => plan.filter((p) => (p.addedRunes?.length ?? 0) > 0).length,
    [plan],
  );

  /** 目標平均的結果：是否達標、要改幾隻、補了幾顆、換了幾顆 */
  const targetResult = useMemo(() => {
    if (mode !== "topup" || targetAvg <= 0 || plan.length === 0) return null;
    const scoreOf = (p: (typeof plan)[number]) => p.runeScoreTotal;
    const total = plan.reduce((n, p) => n + scoreOf(p), 0);
    const before = plan.reduce((n, p) => n + (p.previousScore ?? 0), 0);
    const need = targetAvg * plan.length;
    const added = plan.reduce((n, p) => n + (p.addedRunes?.length ?? 0), 0);
    const removed = plan.reduce((n, p) => n + (p.removedRunes?.length ?? 0), 0);
    return {
      total,
      before,
      need,
      avg: total / plan.length,
      beforeAvg: before / plan.length,
      achieved: total >= need,
      changed: plan.filter((p) => (p.addedRunes?.length ?? 0) > 0).length,
      added,
      removed,
    };
  }, [plan, mode, targetAvg]);

  const shown = useMemo(() => {
    let arr = qualified;
    if (mode === "topup" && onlyChanged) arr = arr.filter((p) => (p.addedRunes?.length ?? 0) > 0);
    if (arch) arr = arr.filter((p) => p.monster.arch === arch);
    if (q) {
      const text = q.toLowerCase();
      arr = arr.filter((p) =>
        [monsterLabel(p.unit.master), unitLabel(p.unit), WB_ARCH_LABEL[p.monster.arch ?? ""] ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(text),
      );
    }
    if (sort === "focus") arr = [...arr].sort((a, b) => b.focusValue - a.focusValue);
    if (sort === "runeScore") arr = [...arr].sort((a, b) => b.runeScoreTotal - a.runeScoreTotal);
    if (sort === "skill") {
      arr = [...arr].sort(
        (a, b) =>
          (b.skillReq ?? b.skillUps ?? 0) - (a.skillReq ?? a.skillUps ?? 0) ||
          b.runeScoreTotal - a.runeScoreTotal,
      );
    }
    return arr;
  }, [qualified, mode, onlyChanged, arch, q, sort]);

  /** 升技需求分析：目前選到的魔靈，依升滿所需次數由高到低 */
  const skillRows = useMemo(
    () =>
      [...plan].sort(
        (a, b) =>
          (b.skillReq ?? b.skillUps ?? 0) - (a.skillReq ?? a.skillUps ?? 0) ||
          (b.skillUps ?? 0) - (a.skillUps ?? 0),
      ),
    [plan],
  );
  const skillSummary = useMemo(() => {
    const req = skillRows.reduce((n, p) => n + (p.skillReq ?? p.skillUps ?? 0), 0);
    const ups = skillRows.reduce((n, p) => n + (p.skillUps ?? 0), 0);
    const left = skillRows.reduce((n, p) => {
      const need = p.skillReq ?? 0;
      return n + Math.max(0, need - (p.skillUps ?? 0));
    }, 0);
    return { req, ups, left, maxed: skillRows.filter((p) => p.skillReq !== undefined && (p.skillUps ?? 0) >= p.skillReq).length };
  }, [skillRows]);

  const totalStats = useMemo(() => {
    if (qualified.length === 0) return null;
    const totals = qualified.map((p) => p.runeScoreTotal);
    const min = Math.min(...totals);
    const max = Math.max(...totals);
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
    return { min, max, avg };
  }, [qualified]);

  if (!account) {
    return <div className="empty"><Crown size={40} /><div>尚未載入存檔</div></div>;
  }

  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="row between wrap" style={{ gap: 10 }}>
          <div>
            <div className="card-title row" style={{ gap: 8 }}>
              <Crown size={16} className="gold" /> 世界王 {count} 隻
              {category > 0 ? `（${categoryLabel(account?.categoryNames, category)}）` : "水系"}配裝建議
            </div>
            <div className="card-sub">
              依「原五 &gt; 二覺 &gt; 原四，再比技能升滿所需次數（例如水猴 12）」挑選
              {category > 0 ? "你在遊戲內標記的分類" : "水屬性"}魔靈。
              套裝優先 2+2+2；如果 3 組 2 件套的分數較低，會改用 4+2（例如暴走 4 + 意志 2）。
              2/6 位主屬性：攻擊型攻擊%、體力型體力%、防禦型防禦%，支援型依基本體力／防禦力混搭；
              4 號位可用爆傷或爆率（爆率會盡量控制在 100% 以下）。
              符文分配可切換「平均」或「集中」；配符方式可切換「重新配符」或「只補空位」。
            </div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            {category > 0 ? (
              <span className="chip muted" title="遊戲內「魔靈分類」的數量">
                {categoryLabel(account?.categoryNames, category)} {fmt(categoryCount)} 隻
              </span>
            ) : (
              <span className="chip muted">水系魔靈 {fmt(waterCount)}</span>
            )}
            <span className="chip gold">已選 {plan.length} 隻</span>
            <span className="chip muted">配符：{WB_MODE_LABEL[mode]}</span>
            <span className="chip muted">分配：{WB_ALLOCATION_LABEL[allocation]}</span>
            {mode === "topup" && (
              <span
                className="chip"
                title={
                  targetAvg > 0
                    ? "目標平均模式：補空位＋必要時換符文後的總加分"
                    : "只補空位：保留每隻現有符文，只用未裝備的符文補滿 6 顆"
                }
              >
                加分 +{fmt(plan.reduce((n, p) => n + (p.runeScoreTotal - (p.previousScore ?? 0)), 0))}
              </span>
            )}
            {minRuneTotal > 0 && (
              <span
                className="chip"
                title={`只顯示 6 顆符文遊戲分數（◆）總和 ≥ ${fmt(minRuneTotal)} 的魔靈`}
              >
                最低總和 {fmt(minRuneTotal)}：{qualified.length} 隻
              </span>
            )}
            {totalStats && (
              <span className="chip muted" title={`${minRuneTotal > 0 ? "符合最低符文總和的" : ""}${qualified.length} 隻魔靈每隻 6 顆符文的 ◆ 總分範圍`}>
                符文總分 {fmt(totalStats.min)}–{fmt(totalStats.max)}（平均 {fmt(Math.round(totalStats.avg))}）
              </span>
            )}
          </div>
        </div>
        <div className="tiny dim" style={{ marginTop: 6 }}>
          <Info size={11} /> 這裡只是建議清單，不會改動你的存檔；同一顆符文 / 神器最多只會出現一次。
          {mode === "topup"
            ? targetAvg > 0
              ? ` 目標平均 ${fmt(targetAvg)}：先補空位，未達標才把較弱的符文換成更好的未裝備符文；由單隻可加分最多的魔靈開始，達到目標就停。換符文以 ◆ 分數為主，可能會拆散原本的套裝。`
              : " 只補空位：保留每隻現有符文，只用目前未裝備的符文補滿空位，不會拆掉任何魔靈身上的配裝。"
            : allocation === "concentrated"
              ? " 集中分配：前面的魔靈會先拿最好的符文（依原五 > 二覺 > 原四，同級比技能升滿所需次數），後面的魔靈使用剩餘符文。"
              : ` 符文以「總分最低的魔靈優先拿下一組」平衡分配，令 ${plan.length} 隻的 ◆ 總分盡量接近。`}
          {minRuneTotal > 0 &&
            ` 最低符文總和 ${fmt(minRuneTotal)} 分只篩選下方清單（符合 ${qualified.length} 隻，隱藏 ${plan.length - qualified.length} 隻），配符仍以全部 ${plan.length} 隻分配。`}
          每隻魔靈都可以按「完整面板」查看三圍、6 顆符文與 2 件神器的完整資料。
        </div>
        {!hasSkillData && (
          <div className="chip red" style={{ marginTop: 8 }}>
            此存檔沒有技能等級資料：技能升級次數會當作 0，建議到「匯入」重新上傳 SWEX JSON。
          </div>
        )}
        {!hasCategoryData && (
          <div className="chip red" style={{ marginTop: 8 }}>
            此存檔沒有魔靈分類資料（SWOP 舊格式可能沒有）：請用 SWEX 重新匯出 / 匯入，才能按分類挑選。
          </div>
        )}
      </div>

      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <div style={{ width: 110 }}>
            <div className="tiny dim">挑選數量</div>
            <NumberInput className="input mono" min={1} max={200} value={count} onChange={setCount} />
          </div>
          <div style={{ minWidth: 210 }}>
            <div className="tiny dim">魔靈分類（優先挑選）</div>
            <select
              className="select"
              style={{ marginTop: 6 }}
              value={category}
              onChange={(e) => setCategory(Number(e.target.value))}
              title="只挑選這個分類的魔靈；分類來自遊戲內「魔靈分類」"
            >
              <option value={0}>不限（水系全部）</option>
              {categoryOptions.map(([cat, n]) => (
                <option key={cat} value={cat}>
                  {categoryLabel(account?.categoryNames, cat)}（{n} 隻）
                </option>
              ))}
            </select>
          </div>
          <div style={{ alignSelf: "flex-end" }}>
            <div className="tiny dim" style={{ marginBottom: 6 }}>配符方式</div>
            <div className="row" style={{ gap: 6 }}>
              {(["rebuild", "topup"] as WbMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`chip ${mode === m ? "gold" : "muted"}`}
                  style={{ cursor: "pointer" }}
                  onClick={() => setMode(m)}
                  title={
                    m === "rebuild"
                      ? "重新配 6 顆符文（候選包含其他魔靈身上的符文）"
                      : "只補空位：保留現有符文，只用未裝備的符文補滿 6 顆"
                  }
                >
                  {WB_MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
          <div style={{ alignSelf: "flex-end" }}>
            <div className="tiny dim" style={{ marginBottom: 6 }}>符文分配</div>
            <div className="row" style={{ gap: 6 }}>
              {(["balanced", "concentrated"] as WbAllocation[]).map((alloc) => (
                <button
                  key={alloc}
                  type="button"
                  className={`chip ${allocation === alloc ? "gold" : "muted"}`}
                  style={{ cursor: "pointer" }}
                  onClick={() => setAllocation(alloc)}
                  title={
                    alloc === "balanced"
                      ? "符文總分盡量平均分配給所有魔靈"
                      : "依角色優先順序，把最高分符文先集中給前面的魔靈"
                  }
                >
                  {WB_ALLOCATION_LABEL[alloc]}
                </button>
              ))}
            </div>
          </div>
          <div style={{ width: 150 }} title="只顯示 6 顆符文遊戲分數（◆）總和 ≥ 此值的魔靈；0 = 不限制">
            <div className="tiny dim">最低符文總和</div>
            <NumberInput
              className="input mono"
              min={0}
              max={2000}
              step={10}
              value={minRuneTotal}
              onChange={setMinRuneTotal}
            />
          </div>
          <label
            className="row tiny"
            style={{ gap: 6, cursor: mode === "topup" ? "not-allowed" : "pointer", paddingTop: 18, opacity: mode === "topup" ? 0.5 : 1 }}
            title={mode === "topup" ? "只補空位模式本身只會使用未裝備的符文" : "只從未裝備的符文挑選"}
          >
            <input
              type="checkbox"
              checked={freeOnly || mode === "topup"}
              disabled={mode === "topup"}
              onChange={(e) => setFreeOnly(e.target.checked)}
            />
            只用未裝備符文（避免拆現有配裝）
          </label>
          <select className="select" style={{ width: 130, marginTop: 18 }} value={arch} onChange={(e) => setArch(e.target.value)}>
            <option value="">全部類型</option>
            {arches.map((a) => (
              <option key={a} value={a}>{WB_ARCH_LABEL[a] ?? a}</option>
            ))}
          </select>
          <select className="select" style={{ width: 190, marginTop: 18 }} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="runeScore">符文分數總和（高→低）</option>
            <option value="priority">依挑選優先級</option>
            <option value="focus">依主屬性面板</option>
            <option value="skill">升技需求（高→低）</option>
          </select>
          <div style={{ position: "relative", marginTop: 18 }}>
            <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: "var(--muted-2)" }} />
            <input
              className="input"
              style={{ width: 190, paddingLeft: 28 }}
              placeholder="搜尋魔靈 / 類型"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <span className="tiny dim" style={{ alignSelf: "end", paddingBottom: 8 }}>
            <ListOrdered size={12} /> 顯示 {shown.length} / {qualified.length} 隻
            {minRuneTotal > 0 && `（最低總和 ${fmt(minRuneTotal)}）`}
          </span>
        </div>

        {mode === "topup" && (
          <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <div className="row wrap" style={{ gap: 10, alignItems: "flex-end" }}>
              <div style={{ width: 170 }}>
                <div
                  className="tiny dim"
                  title="每隻魔靈 6 顆符文的 ◆ 總分平均；0 = 不設定"
                >
                  目標平均符文總分（選填）
                </div>
                <NumberInput
                  className="input mono"
                  min={0}
                  max={3000}
                  step={10}
                  value={targetAvg}
                  onChange={setTargetAvg}
                />
              </div>
              {targetResult ? (
                <>
                  <span
                    className={`chip ${targetResult.achieved ? "gold" : "red"}`}
                    title={
                      targetResult.achieved
                        ? "目前可用的未裝備符文足以達到這個平均"
                        : "未裝備符文不足：以下是補空位＋換符文後能達到的最高平均"
                    }
                  >
                    {targetResult.achieved
                      ? targetResult.changed > 0
                        ? `可達成：最少改動 ${targetResult.changed} 隻`
                        : "已達標：不需要改動"
                      : `無法達成：最高平均 ${fmt(Math.round(targetResult.avg))}`}
                  </span>
                  <span className="chip muted" title="目前 60 隻的 ◆ 平均">
                    目前平均 {fmt(Math.round(targetResult.beforeAvg))}
                  </span>
                  <span className="chip muted" title="套用建議後 60 隻的 ◆ 平均">
                    最終平均 {fmt(Math.round(targetResult.avg))}
                  </span>
                  {targetResult.achieved && (
                    <span className="chip muted" title="補空位與換符文各用了幾顆未裝備符文">
                      補 {fmt(Math.max(0, targetResult.added - targetResult.removed))} 顆
                      {targetResult.removed > 0 && ` · 換 ${fmt(targetResult.removed)} 顆`}
                    </span>
                  )}
                  {!targetResult.achieved && (
                    <span className="chip muted">
                      還差 {fmt(Math.round(targetResult.need - targetResult.total))} 分
                    </span>
                  )}
                  <span className="tiny dim" style={{ paddingBottom: 8, flex: "1 1 240px" }}>
                    由「單隻可加分最多」的魔靈開始處理，達到目標就停，所以是最少的改動隻數。
                  </span>
                </>
              ) : (
                <span className="tiny dim" style={{ paddingBottom: 8 }}>
                  輸入目標平均後，會計算能否用這 {plan.length} 隻達成，以及最少需要改動幾隻魔靈。
                </span>
              )}
            </div>

            <div className="row wrap" style={{ gap: 8, marginTop: 10, alignItems: "center" }}>
              <span className="tiny dim">清單顯示</span>
              <button
                type="button"
                className={`chip ${!onlyChanged ? "gold" : "muted"}`}
                style={{ cursor: "pointer" }}
                onClick={() => setOnlyChanged(false)}
                title="顯示全部選到的魔靈"
              >
                全部 {plan.length} 隻
              </button>
              <button
                type="button"
                className={`chip ${onlyChanged ? "gold" : "muted"}`}
                style={{ cursor: "pointer" }}
                onClick={() => setOnlyChanged(true)}
                title="只顯示這次有補到或換到符文（也就是需要改動）的魔靈"
              >
                需要改動 {changedCount} 隻
              </button>
              <span className="tiny dim">
                只補空位模式：已經有 6 顆符文的魔靈不會有改動，可切到「需要改動」只看要動的魔靈。
              </span>
            </div>
          </div>
        )}
      </div>

      <details className="card card-pad" style={{ marginBottom: 14 }}>
        <summary className="card-title row" style={{ gap: 8, cursor: "pointer" }}>
          <Sparkles size={15} className="gold" /> 升技需求分析（目前選到的 {skillRows.length} 隻，高→低）
        </summary>
        <div className="row wrap" style={{ gap: 6, margin: "10px 0 8px" }}>
          <span className="chip muted" title="各技能 (max - 1) 的總和">
            合計需要 +{fmt(skillSummary.req)}
          </span>
          <span className="chip muted">目前已升 +{fmt(skillSummary.ups)}</span>
          <span className="chip gold">還差 +{fmt(skillSummary.left)}</span>
          <span className="chip muted">
            已滿技 {fmt(skillSummary.maxed)} / {skillRows.length} 隻
          </span>
        </div>
        <div className="tiny dim" style={{ marginBottom: 8 }}>
          <Info size={11} /> 「升滿需要」＝每招技能 max - 1 的總和，也就是升滿技總共要吃幾隻惡魔怪；
          「目前」是存檔中已升的次數。同級魔靈會先挑升技需求高的，因為升滿後的世界王傷害提升最多。
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>魔靈</th>
                <th className="num" title="每招技能 max - 1 的總和（= 升滿技需要的惡魔怪數量）">升滿需要</th>
                <th className="num">目前</th>
                <th className="num">還差</th>
                <th>類型</th>
                <th className="num">◆ 總分</th>
                <th>升技進度</th>
              </tr>
            </thead>
            <tbody>
              {skillRows.map((p, i) => {
                const need = p.skillReq ?? p.skillUps ?? 0;
                const ups = p.skillUps ?? 0;
                const left = Math.max(0, need - ups);
                return (
                  <tr key={p.unit.id}>
                    <td className="dim mono">{i + 1}</td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <MonsterIcon id={p.unit.master} size={24} />
                        <span>{monsterLabel(p.unit.master)}</span>
                        <span className="rune-tag muted">{p.monster.nat}★</span>
                      </div>
                    </td>
                    <td className="num mono">{need > 0 ? `+${need}` : "—"}</td>
                    <td className="num mono">+{ups}</td>
                    <td className={`num mono ${left > 0 ? "gold" : "dim"}`}>{left > 0 ? `+${left}` : "滿"}</td>
                    <td className="dim">{WB_ARCH_LABEL[p.monster.arch ?? ""] ?? p.monster.arch ?? "?"}</td>
                    <td className="num mono">{fmt(p.runeScoreTotal)}</td>
                    <td>
                      <div className="bar" style={{ width: 90 }}>
                        <i style={{ width: `${need > 0 ? Math.min(100, (ups / need) * 100) : 100}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(680px, 1fr))", gap: 12 }}>
        {shown.map((p) => (
          <PlanCard
            key={p.unit.id}
            plan={p}
            runeOwner={runeOwner}
            artifactOwner={artifactOwner}
            targetMode={mode === "topup" && targetAvg > 0}
          />
        ))}
      </div>
      {shown.length === 0 && (
        <div className="empty">
          沒有符合條件的魔靈
          {mode === "topup" && onlyChanged && changedCount === 0 && (
            <div className="tiny dim" style={{ marginTop: 6 }}>
              目前沒有需要改動的魔靈（已達標或都已經有 6 顆符文）。
            </div>
          )}
          {category > 0 && (
            <div className="tiny dim" style={{ marginTop: 6 }}>
              {categoryLabel(account.categoryNames, category)} 目前沒有魔靈，請在遊戲內把魔靈加入這個分類，
              或改選其他分類。
            </div>
          )}
          {minRuneTotal > 0 && (
            <div className="tiny dim" style={{ marginTop: 6 }}>
              目前最低符文總和為 {fmt(minRuneTotal)} 分，可調低數值或設為 0 取消限制。
            </div>
          )}
        </div>
      )}
    </>
  );
}
