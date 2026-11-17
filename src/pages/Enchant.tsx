import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Search } from "lucide-react";
import { MONSTER_MAP, useStore } from "../store";
import { SET_BY_ID } from "../lib/constants";
import { describeRuneTag, matchesRuneTag } from "../lib/runeTags";
import { EmptyState, RuneCard, statSuffix } from "../components/ui";
import {
  ENCHANT_SORTS,
  analyzeEnchant,
  sortEnchantTargets,
  type EnchantOwner,
  type EnchantSort,
  type EnchantTarget,
} from "../lib/enchant";
import type { RuneTagRule } from "../lib/types";

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

function EnchantCard({
  t,
  setName,
  locked,
  excluded,
  currentTags,
  onToggleLock,
  onToggleExclude,
}: {
  t: EnchantTarget;
  /** 需要使用的寶石套裝名稱（含遠古標記） */
  setName: string;
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

export default function EnchantPage() {
  const account = useStore((s) => s.account);
  const lockedRunes = useStore((s) => s.settings.lockedRunes);
  const excludedRunes = useStore((s) => s.settings.excludedRunes);
  const runeTags = useStore((s) => s.settings.runeTags);
  const toggleRuneFlag = useStore((s) => s.toggleRuneFlag);
  const lockedSet = useMemo(() => new Set(lockedRunes), [lockedRunes]);
  const excludedSet = useMemo(() => new Set(excludedRunes), [excludedRunes]);

  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [onlyEquipped, setOnlyEquipped] = useState(false);
  const [onlySix, setOnlySix] = useState(false);
  const [onlyReady, setOnlyReady] = useState(true);
  const [assumeGrind, setAssumeGrind] = useState(true);
  const [setId, setSetId] = useState(0);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<EnchantSort>("eff-desc");
  const [take, setTake] = useState(40);

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

  /** 寶石只能用同套裝；遠古符文要用遠古寶石 */
  const gemNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of all) {
      const setName = SET_BY_ID[t.rune.set]?.name ?? "";
      map.set(String(t.rune.id), t.rune.ancient ? `遠古 ${setName}` : setName);
    }
    return map;
  }, [all]);

  const base = useMemo(
    () =>
      all.filter((t) => {
        if (onlyReady && t.rune.level < 12) return false;
        if (onlyEquipped && !t.owner) return false;
        if (onlySix && t.rune.grade !== 6) return false;
        if (setId && t.rune.set !== setId) return false;
        return true;
      }),
    [all, onlyReady, onlyEquipped, onlySix, setId],
  );

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of base) for (const id of t.ruleIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  }, [base]);

  const candidates = useMemo(() => {
    if (tagFilter.length === 0) return base;
    return base.filter((t) => t.ruleIds.some((id) => tagFilter.includes(id)));
  }, [base, tagFilter]);

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

  useEffect(() => {
    setTake(40);
  }, [tagFilter, onlyEquipped, onlySix, onlyReady, setId, q, sort]);

  const summary = useMemo(() => {
    const six = base.filter((t) => t.rune.grade === 6).length;
    const rules = new Set(base.flatMap((t) => t.ruleIds));
    const gain = base.length
      ? base.reduce((s, t) => s + (t.bestEff - t.effNow), 0) / base.length
      : 0;
    const best = base.reduce((m, t) => Math.max(m, t.bestEff), 0);
    return { six, rules: rules.size, gain, best };
  }, [base]);

  if (!account) {
    return (
      <EmptyState
        icon={<FlaskConical size={40} />}
        title="尚未匯入存檔"
        desc="匯入 JSON 後，就能找出精魔（寶石變換）後符合自行分類的符文。"
      />
    );
  }

  if (activeTags.length === 0) {
    return (
      <div className="card card-pad">
        <div className="card-title row" style={{ gap: 7 }}>
          <FlaskConical size={15} className="gold" /> 精魔建議
        </div>
        <div className="tiny dim" style={{ marginTop: 6, lineHeight: 1.7 }}>
          還沒有啟用中的自行分類。精魔建議會依「符文 → 自行分類」的規則，找出只差一條副屬性就能符合分類的符文。
          請先到符文頁建立或啟用分類（例如：輔助符 = 速度、體力%、防禦%、效果抵抗）。
        </div>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          style={{ marginTop: 10 }}
          onClick={() => { window.location.hash = "#/runes"; }}
        >
          前往符文頁設定自行分類
        </button>
      </div>
    );
  }

  const shown = filtered.slice(0, take);

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 12 }}>
        <div>
          <div className="card-title row" style={{ gap: 7 }}>
            <FlaskConical size={15} className="gold" /> 精魔建議
          </div>
          <div className="card-sub">
            找出「換掉一條副屬性後，就會符合自行分類」的符文；只列出目前不符合、而且只差一條屬性的符文。
            數值以 6★ 傳說寶石＋精煉上限估算，實際會依寶石與磨石等級、骰值較低；效率不設上限，超過 100% 會照實顯示。
          </div>
        </div>
        <span className="chip gold">精魔候選 {base.length} 顆</span>
      </div>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Tile k="精魔候選" v={String(base.length)} sub="一次寶石就能符合分類" />
        <Tile k="可符合分類" v={String(summary.rules)} sub={`啟用中 ${activeTags.length} 個分類`} />
        <Tile k="6★ 符文" v={String(summary.six)} sub="其餘為 5★ 以下" />
        <Tile
          k="平均效率變化"
          v={fmtGain(summary.gain) + "%"}
          sub={summary.best > 0 ? `最高精魔後 ${Math.round(summary.best)}%` : "目前沒有候選"}
        />
      </div>

      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="tiny dim" title="在「符文 → 自行分類」設定的分類；只顯示啟用中的分類">
            自行分類
          </span>
          <button
            type="button"
            className={`chip ${tagFilter.length === 0 ? "gold" : "muted"}`}
            style={{ cursor: "pointer" }}
            onClick={() => setTagFilter([])}
          >
            全部 · {base.length}
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
          <div className="row" style={{ gap: 6 }}>
            <span className="tiny dim">排列</span>
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
          </div>
        </div>

        <div className="row wrap" style={{ gap: 14, marginTop: 10, alignItems: "center" }}>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }} title="遊戲規定符文要 +12 以上才能使用精魔寶石">
            <input type="checkbox" checked={onlyReady} onChange={(e) => setOnlyReady(e.target.checked)} /> 只看 +12 以上（可精魔）
          </label>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }} title="精魔後通常會再用磨石把新副屬性補高；關閉則只計算寶石本身數值">
            <input type="checkbox" checked={assumeGrind} onChange={(e) => setAssumeGrind(e.target.checked)} /> 假設精魔後精煉滿
          </label>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={onlyEquipped} onChange={(e) => setOnlyEquipped(e.target.checked)} /> 只看已裝備
          </label>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={onlySix} onChange={(e) => setOnlySix(e.target.checked)} /> 只看 6★
          </label>
          <span className="tiny dim">顯示 {filtered.length} / {base.length} 顆</span>
          {(onlyEquipped || onlySix || !onlyReady || setId || q || tagFilter.length > 0) && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setOnlyEquipped(false);
                setOnlySix(false);
                setOnlyReady(true);
                setSetId(0);
                setQ("");
                setTagFilter([]);
              }}
            >
              清除篩選
            </button>
          )}
        </div>
      </div>

      <details className="card card-pad grind-guide" style={{ marginBottom: 14 }}>
        <summary className="card-title" style={{ cursor: "pointer" }}>精魔規則與使用建議</summary>
        <ol>
          <li><b>精魔是「換屬性」，不是加數值。</b>寶石會把一條副屬性整個換成另一條，原本的強化（+3 / +6 / +9 / +12）與精煉都會消失，換完要重新精煉。</li>
          <li><b>只能換一條。</b>每顆符文只能選一條副屬性精魔；之後再用寶石也只能換同一條，不能改別條。</li>
          <li><b>不能重複。</b>新屬性不能和主屬性、其他副屬性、固有屬性重複；也不能換成符文已經有的屬性。</li>
          <li><b>需要 +12。</b>符文至少要 +12 才能使用精魔寶石，所以此頁預設只列 +12 以上的符文。</li>
          <li><b>寶石要同套裝。</b>一般寶石只能用在同一套裝的符文；遠古符文要用遠古寶石；無形寶石則不限套裝。</li>
          <li><b>數值怎麼看。</b>此頁用 6★ 傳說寶石＋傳說磨石上限估算：體攻防% 13＋10、速度 10＋5、固定體力 580＋550、固定攻防 40＋30；暴率 9、暴傷 10、抵抗／命中 11（這四條不能精煉，所以只有寶石數值）。實際會依寶石與磨石等級、骰值而較低。因此門檻若高於上述合計上限（例如抵抗要 20），單靠一顆寶石＋精煉也補不到。</li>
          <li><b>先看分類。</b>選一個自行分類（例如輔助符），頁面只會列出精魔後能符合它的符文，再用效率或符文分數排序，挑你真正會用的那幾顆。</li>
        </ol>
      </details>

      {filtered.length === 0 ? (
        <div className="empty card" style={{ padding: "40px 16px" }}>
          <FlaskConical size={34} style={{ opacity: .3, marginBottom: 8 }} />
          <div style={{ fontWeight: 600, color: "var(--text)" }}>沒有符合條件的精魔候選</div>
          <div className="tiny dim" style={{ marginTop: 4, lineHeight: 1.7 }}>
            目前沒有「只差一條副屬性」就能符合所選分類的符文。可能是分類門檻高於寶石＋精煉上限
            （例如抵抗要 20，但抵抗不能精煉、6★ 傳說寶石最多 11）、符文已經符合，或篩選條件太窄；
            可以取消「只看 +12 以上 / 只看 6★ / 只看已裝備」或換一個分類試試。
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
      )}
    </>
  );
}
