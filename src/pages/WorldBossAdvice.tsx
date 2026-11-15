import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, Info, ListOrdered, Search } from "lucide-react";
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
  WB_TIER_LABEL,
  buildWorldBossPlan,
  type WbAllocation,
  type WbMainStat,
  type WbMonsterPlan,
} from "../lib/worldBossAdvice";

type SortKey = "runeScore" | "priority" | "focus";

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
}: {
  plan: WbMonsterPlan;
  runeOwner: Map<number, string>;
  artifactOwner: Map<number, string>;
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
          <span className="chip" title="6 顆符文的遊戲分數（◆）總和">
            ◆ 總分 {fmt(plan.runeScoreTotal)}
          </span>
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
                  <span className="tiny dim">沒有可用符文</span>
                </div>
              );
            }
            const owner = runeOwner.get(rune.id);
            return <RuneCard key={rune.id} rune={rune} owner={owner ? `現在：${owner}` : "現在：未裝備"} />;
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

  const plan = useMemo(
    () =>
      account
        ? buildWorldBossPlan(account, {
            count,
            waterOnly: true,
            excludedRunes,
            freeOnly,
            bonus,
            allocation,
            skillReqOf,
            monsterOf: (id) => MONSTER_MAP.get(id),
          })
        : [],
    [account, count, excludedRunes, freeOnly, bonus, allocation, skillReqOf],
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
  const hasSkillData = useMemo(
    () => (account?.units ?? []).some((u) => u.skillUps !== undefined),
    [account],
  );

  const arches = useMemo(() => {
    const set = new Set<string>();
    for (const p of qualified) if (p.monster.arch) set.add(p.monster.arch);
    return [...set].sort();
  }, [qualified]);

  const shown = useMemo(() => {
    let arr = qualified;
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
    return arr;
  }, [qualified, arch, q, sort]);

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
              <Crown size={16} className="gold" /> 世界王 {count} 隻水系配裝建議
            </div>
            <div className="card-sub">
              依「原五 &gt; 二覺 &gt; 原四，再比技能升滿所需次數（例如水猴 12）」挑選水屬性魔靈。
              套裝優先 2+2+2；如果 3 組 2 件套的分數較低，會改用 4+2（例如暴走 4 + 意志 2）。
              2/6 位主屬性：攻擊型攻擊%、體力型體力%、防禦型防禦%，支援型依基本體力／防禦力混搭；
              4 號位可用爆傷或爆率（爆率會盡量控制在 100% 以下）。
              符文分配可切換「平均」或「集中」：集中會依角色優先順序，把最高分符文先補滿前面的魔靈。
            </div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="chip muted">水系魔靈 {fmt(waterCount)}</span>
            <span className="chip gold">已選 {plan.length} 隻</span>
            <span className="chip muted">分配：{WB_ALLOCATION_LABEL[allocation]}</span>
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
          {allocation === "concentrated"
            ? ` 集中分配：前面的魔靈會先拿最好的符文（依原五 > 二覺 > 原四，同級比技能升滿所需次數），後面的魔靈使用剩餘符文。`
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
      </div>

      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <div style={{ width: 110 }}>
            <div className="tiny dim">挑選數量</div>
            <NumberInput className="input mono" min={1} max={200} value={count} onChange={setCount} />
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
          <div style={{ alignSelf: "flex-end" }}>
            <div className="tiny dim" style={{ marginBottom: 6 }}>符文分配</div>
            <div className="row" style={{ gap: 6 }}>
              {(["balanced", "concentrated"] as WbAllocation[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`chip ${allocation === mode ? "gold" : "muted"}`}
                  style={{ cursor: "pointer" }}
                  onClick={() => setAllocation(mode)}
                  title={
                    mode === "balanced"
                      ? "符文總分盡量平均分配給所有魔靈"
                      : "依角色優先順序，把最高分符文先集中給前面的魔靈"
                  }
                >
                  {WB_ALLOCATION_LABEL[mode]}
                </button>
              ))}
            </div>
          </div>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer", paddingTop: 18 }}>
            <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
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
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(680px, 1fr))", gap: 12 }}>
        {shown.map((p) => (
          <PlanCard key={p.unit.id} plan={p} runeOwner={runeOwner} artifactOwner={artifactOwner} />
        ))}
      </div>
      {shown.length === 0 && (
        <div className="empty">
          沒有符合條件的魔靈
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
