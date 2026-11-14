import { useMemo, useState } from "react";
import { Crown, Info, ListOrdered, Search, Sparkles } from "lucide-react";
import { MONSTER_MAP, monsterLabel, unitLabel, useStore } from "../store";
import { MonsterIcon, NumberInput, fmt, statSuffix, statText } from "../components/ui";
import { SET_BY_ID, STAT_TYPES } from "../lib/constants";
import { artifactMainText, artifactSubText } from "../lib/artifacts";
import {
  FOCUS_LABEL,
  WB_ARCH_LABEL,
  WB_TIER_LABEL,
  buildWorldBossPlan,
  type WbFocus,
  type WbMonsterPlan,
} from "../lib/worldBossAdvice";
import type { Rune } from "../lib/types";

type SortKey = "priority" | "focus";

/** 只顯示與這隻魔靈主屬性相關的副屬（速度 / 暴擊 / 暴傷不列） */
function focusSubs(rune: Rune, focus: WbFocus): string {
  const parts = rune.subs
    .filter((s) => STAT_TYPES[s.t]?.key === focus)
    .map((s) => `${STAT_TYPES[s.t].label} +${s.v + s.g}${statSuffix(s.t)}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function StatBox({ label, value, active }: { label: string; value: number; active: boolean }) {
  return (
    <div style={{ minWidth: 62, textAlign: "right" }}>
      <div className="tiny dim">{label}</div>
      <div className="mono" style={{ fontWeight: 800, color: active ? "var(--gold)" : undefined }}>
        {fmt(value)}
      </div>
    </div>
  );
}

function PlanCard({ plan, runeOwner }: { plan: WbMonsterPlan; runeOwner: Map<number, string> }) {
  const pairReady = plan.runes.length === 6 && plan.sets.every((s) => s.count % 2 === 0);
  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <div className="row between" style={{ gap: 10, alignItems: "flex-start" }}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <MonsterIcon id={plan.unit.master} size={40} />
          <div style={{ minWidth: 0 }}>
            <div className="row wrap" style={{ gap: 6, fontWeight: 800 }}>
              <span>{monsterLabel(plan.unit.master)}</span>
              <span className="rune-tag muted">{plan.monster.nat}★原生</span>
              {plan.tier === 1 && <span className="rune-tag">二覺</span>}
            </div>
            <div className="tiny dim">
              {WB_TIER_LABEL[plan.tier] ?? "其他"} · {WB_ARCH_LABEL[plan.monster.arch ?? ""] ?? plan.monster.arch ?? "?"} ·{" "}
              {plan.skillUps === undefined ? "技能資料未提供" : `技能 +${plan.skillUps}`}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 9 }}>
          <StatBox label="HP" value={plan.stats.hp} active={plan.focus === "hp"} />
          <StatBox label="攻擊" value={plan.stats.atk} active={plan.focus === "atk"} />
          <StatBox label="防禦" value={plan.stats.def} active={plan.focus === "def"} />
        </div>
      </div>

      <div className="row wrap" style={{ gap: 5 }}>
        <span className="chip gold" title="主要堆疊的面板屬性">
          {FOCUS_LABEL[plan.focus]} {fmt(plan.focusValue)}
        </span>
        {pairReady && <span className="chip gold" title="6 顆符文剛好是三組 2 件套">2+2+2</span>}
        {plan.sets.map((s) => (
          <span key={s.set} className="chip muted" title="每 2 件觸發一次套裝效果">
            {SET_BY_ID[s.set]?.name ?? `套裝${s.set}`} ×{s.count}
          </span>
        ))}
      </div>

      <div className="col" style={{ gap: 3 }}>
        {plan.runes.map((rune) => {
          const owner = runeOwner.get(rune.id);
          return (
            <div key={rune.id} className="row between" style={{ gap: 8, fontSize: 11.5 }}>
              <span style={{ minWidth: 0 }}>
                <b className="gold">{rune.slot}</b>{" "}
                <span className="dim">{SET_BY_ID[rune.set]?.name ?? `套裝${rune.set}`}</span>{" "}
                {statText(rune.main.t, rune.main.v)}
              </span>
              <span
                className="tiny dim"
                style={{ textAlign: "right" }}
                title={rune.subs.map((s) => statText(s.t, s.v + s.g)).join(" · ")}
              >
                {focusSubs(rune, plan.focus)}
                {owner ? ` · 現在：${owner}` : ""}
              </span>
            </div>
          );
        })}
        {plan.runes.length === 0 && <div className="tiny dim">找不到可用符文</div>}
      </div>

      <div className="col" style={{ gap: 3 }}>
        {plan.artifacts.map((art) => (
          <div key={art.id} className="row between" style={{ gap: 8, fontSize: 11.5 }}>
            <span>
              <Sparkles size={11} /> {artifactMainText(art)}
            </span>
            <span className="tiny dim" title={art.subs.map(artifactSubText).join(" · ")}>
              {art.subs.slice(0, 2).map(artifactSubText).join(" · ") || "—"}
            </span>
          </div>
        ))}
        {plan.artifacts.length === 0 && <div className="tiny dim">沒有符合屬性 / 類型的神器</div>}
      </div>
    </div>
  );
}

export default function WorldBossAdvicePage() {
  const account = useStore((s) => s.account);
  const bonus = useStore((s) => s.settings.bonus);
  const excludedRunes = useStore((s) => s.settings.excludedRunes);
  const [count, setCount] = useState(60);
  const [freeOnly, setFreeOnly] = useState(false);
  const [arch, setArch] = useState("");
  const [sort, setSort] = useState<SortKey>("priority");
  const [q, setQ] = useState("");

  const plan = useMemo(
    () =>
      account
        ? buildWorldBossPlan(account, {
            count,
            waterOnly: true,
            excludedRunes,
            freeOnly,
            bonus,
            monsterOf: (id) => MONSTER_MAP.get(id),
          })
        : [],
    [account, count, excludedRunes, freeOnly, bonus],
  );

  const runeOwner = useMemo(() => {
    const m = new Map<number, string>();
    for (const u of account?.units ?? []) for (const rid of u.runes) m.set(rid, unitLabel(u));
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
    for (const p of plan) if (p.monster.arch) set.add(p.monster.arch);
    return [...set].sort();
  }, [plan]);

  const shown = useMemo(() => {
    let arr = plan;
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
    return arr;
  }, [plan, arch, q, sort]);

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
              依「原五 &gt; 二覺 &gt; 原四，再比技能升級次數」挑選水屬性魔靈，並自動配成 2+2+2 套裝。
              面板以魔靈類型決定：體力型堆體力、攻擊型堆攻擊、防禦型堆防禦；速度、暴擊率、暴擊傷害不計。
            </div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="chip muted">水系魔靈 {fmt(waterCount)}</span>
            <span className="chip gold">已選 {plan.length} 隻</span>
          </div>
        </div>
        <div className="tiny dim" style={{ marginTop: 6 }}>
          <Info size={11} /> 這裡只是建議清單，不會改動你的存檔；同一顆符文 / 神器最多只會出現一次，高等級魔靈會先拿最好的符文。
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
          <select className="select" style={{ width: 150, marginTop: 18 }} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
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
            <ListOrdered size={12} /> 顯示 {shown.length} / {plan.length} 隻
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(430px, 1fr))", gap: 12 }}>
        {shown.map((p) => (
          <PlanCard key={p.unit.id} plan={p} runeOwner={runeOwner} />
        ))}
      </div>
      {shown.length === 0 && <div className="empty">沒有符合條件的魔靈</div>}
    </>
  );
}
