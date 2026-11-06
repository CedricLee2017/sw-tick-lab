import { useEffect, useMemo, useState } from "react";
import { Hammer, Search } from "lucide-react";
import { MONSTER_MAP, useStore } from "../store";
import { SET_BY_ID } from "../lib/constants";
import { EmptyState, NumberInput, setColor } from "../components/ui";
import {
  GRIND_ACCEPT_LEVELS,
  GRIND_PROFILES,
  analyzeGrind,
  grindStatLabel,
  grindStatSuffix,
  planScore,
  stoneGain,
  type GrindAccept,
  type GrindOwner,
  type GrindProfile,
  type GrindTarget,
} from "../lib/grind";

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
}: {
  t: GrindTarget;
  accept: GrindAccept;
  showAccept: boolean;
  showScore: boolean;
  targetScore: number;
}) {
  const set = SET_BY_ID[t.rune.set];
  const gain = t.effAfter - t.effNow;
  const plan = showScore ? planScore(t, targetScore) : [];
  const planGain = plan.reduce((s, x) => s + x.gain, 0);
  const extra = t.reasons.filter(
    (r) => !r.startsWith("裝備於") && r !== "未裝備" && !r.endsWith("符文") && !r.startsWith("效率"),
  );
  return (
    <div className="card card-pad grind-card">
      <div className="row between wrap" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          <div className="grind-badge" style={{ borderColor: setColor(t.rune.set) }}>
            <b className="mono">{t.rune.slot}</b>
            <span>+{t.rune.level}</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>
              {set?.name ?? "?"} · {t.rune.slot} 號{" "}
              <span className="tiny dim">{"★".repeat(Math.max(1, t.rune.grade))} +{t.rune.level}</span>
            </div>
            <div className="tiny dim" style={{ marginTop: 2 }}>
              主屬 {grindStatLabel(t.rune.main.t)} +{t.rune.main.v}
              {grindStatSuffix(t.rune.main.t)} · 效率 {Math.round(t.effNow)}% · {t.owner ?? "未裝備"}
            </div>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="chip muted" title="遊戲內符文分數（副屬性＋固有屬性，含精煉）">
            ◆ {t.gameScore}
          </span>
          {showScore ? (
            <span className="chip gold" title={`全部可精煉屬性精煉到上限後的分數`}>
              可達 {t.maxGameScore}
            </span>
          ) : (
            <span className={`chip ${t.tier === "high" ? "gold" : "muted"}`}>
              {t.tier === "high" ? "優先" : t.tier === "mid" ? "可考慮" : "暫緩"} {t.score}
            </span>
          )}
        </div>
      </div>

      {showAccept && (
        <div className="row wrap" style={{ gap: 6, marginTop: 9 }}>
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
          <div className="tiny" style={{ lineHeight: 1.7, marginTop: 8 }}>
            <span className="gold">遊戲分數 {t.gameScore}</span>
            <span className="dim"> · 精煉後最高 {t.maxGameScore} 分</span>
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
            磨石可再加：{stoneGain(t.best).filter((s) => s.gain > 0).map((s) => `${s.label} +${s.gain}`).join(" · ")}
            {gain > 0.4 && ` ；精煉此條後效率 ${Math.round(t.effAfter)}%（+${gain.toFixed(1)}%）`}
          </div>
        </>
      )}
      {extra.length > 0 && <div className="tiny dim">{extra.join(" · ")}</div>}
    </div>
  );
}

export default function GrindPage() {
  const account = useStore((s) => s.account);
  const [profile, setProfile] = useState<GrindProfile>("speed");
  const [accept, setAccept] = useState<GrindAccept>(10);
  const [targetScore, setTargetScore] = useState(250);
  const [onlyEquipped, setOnlyEquipped] = useState(false);
  const [onlySix, setOnlySix] = useState(false);
  const [onlyHigh, setOnlyHigh] = useState(false);
  const [setId, setSetId] = useState(0);
  const [stat, setStat] = useState(0);
  const [q, setQ] = useState("");
  const [take, setTake] = useState(40);

  useEffect(() => {
    setTake(40);
  }, [profile, accept, targetScore, onlyEquipped, onlySix, onlyHigh, setId, stat, q]);

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
    return analyzeGrind(account.runes, { profile, owners, stat: onlyStat, accept, targetScore });
  }, [account, profile, owners, stat, accept, targetScore]);

  const sets = useMemo(() => {
    const ids = new Set(account?.runes.map((r) => r.set) ?? []);
    return [...ids]
      .map((id) => ({ id, name: SET_BY_ID[id]?.name ?? `套裝 ${id}` }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-TW"));
  }, [account]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all.filter((t) => {
      if (onlyEquipped && !t.owner) return false;
      if (onlySix && t.rune.grade !== 6) return false;
      if (onlyHigh && t.tier !== "high") return false;
      if (setId && t.rune.set !== setId) return false;
      if (!term) return true;
      return (
        (t.owner ?? "").toLowerCase().includes(term) ||
        (SET_BY_ID[t.rune.set]?.name ?? "").includes(term) ||
        grindStatLabel(t.best.t).includes(term)
      );
    });
  }, [all, onlyEquipped, onlySix, onlyHigh, setId, q]);

  const summary = useMemo(() => {
    const high = all.filter((t) => t.tier === "high").length;
    const speed = all.filter((t) => t.best.t === 8).length;
    const speed6 = all.filter((t) => t.best.t === 8 && t.rune.grade === 6).length;
    const avgGain = all.length ? all.reduce((s, t) => s + Math.max(0, t.effAfter - t.effNow), 0) / all.length : 0;
    const bySet = new Map<number, { count: number; spd: number }>();
    for (const t of all) {
      const cur = bySet.get(t.rune.set) ?? { count: 0, spd: 0 };
      cur.count += 1;
      if (t.best.t === 8) cur.spd += 1;
      bySet.set(t.rune.set, cur);
    }
    const topSets = [...bySet.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8)
      .map(([id, v]) => ({ id, name: SET_BY_ID[id]?.name ?? `套裝 ${id}`, ...v }));
    const meet = all.filter((t) => t.gameScore >= targetScore).length;
    const maxScore = all.reduce((m, t) => Math.max(m, t.gameScore), 0);
    const avgScore = all.length ? all.reduce((s, t) => s + t.gameScore, 0) / all.length : 0;
    return { high, speed, speed6, avgGain, topSets, meet, maxScore, avgScore };
  }, [all, targetScore]);

  if (!account) {
    return <EmptyState icon={<Hammer size={40} />} title="尚未匯入存檔" desc="匯入 JSON 後即可分析每顆符文的精煉順序。" />;
  }

  const shown = filtered.slice(0, take);

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 12 }}>
        <div>
          <div className="card-title row" style={{ gap: 7 }}>
            <Hammer size={15} className="gold" /> 精煉建議
          </div>
          <div className="card-sub">
            依符文素質、套裝、裝備對象與目前精煉值排序；只考慮可用磨石精煉的屬性（速度、體力／攻擊／防禦與固定值）。
          </div>
        </div>
        <span className="chip gold">
          {profile === "speed"
            ? `未達 ${accept} 分 ${all.length} 顆`
            : profile === "score"
              ? `可達 ${targetScore} 分 ${all.length} 顆`
              : `可精煉 ${all.length} 顆`}
        </span>
      </div>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        {profile === "score" ? (
          <>
            <Tile k={`可達 ${targetScore} 分`} v={String(all.length)} sub="精煉後可達標" />
            <Tile k="已達標" v={String(summary.meet)} sub="目前分數已足夠" />
            <Tile k="最高目前分數" v={String(summary.maxScore)} sub="此清單最高" />
            <Tile k="平均目前分數" v={summary.avgScore.toFixed(0)} sub="此清單平均" />
          </>
        ) : (
          <>
            <Tile
              k={profile === "speed" ? `未達 ${accept} 分` : "可精煉符文"}
              v={String(all.length)}
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
              ? `分數：只列出精煉後能達到 ${targetScore} 分以上的符文，依目前遊戲分數由高到低。`
              : GRIND_PROFILES.find((p) => p.key === profile)?.desc}
        </div>

        {profile === "score" && (
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
        </div>

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
          <span className="tiny dim">顯示 {filtered.length} / {all.length} 顆</span>
          {(onlyEquipped || onlySix || onlyHigh || setId || stat !== 0 || q) && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setOnlyEquipped(false);
                setOnlySix(false);
                setOnlyHigh(false);
                setSetId(0);
                setStat(0);
                setQ("");
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
          <li><b>依套裝集中處理。</b>磨石只能用在同套裝符文，先挑數量最多的套裝（例如迅速、暴走）一次整理，避免東一顆西一顆。</li>
          <li><b>石頭等級這樣分：</b>傳說石留給「速度還差 4–5」或關鍵百分比；英雄石用在次要但會上場的符文；稀有／魔法石只用來補滿過渡裝。</li>
          <li><b>不要精煉準備換掉的符文。</b>先確認符文已 +15、套裝與主屬正確，再投入資源；4★ 以下基本上不值得。</li>
          <li><b>可以重複嘗試。</b>同一條副屬性再精煉會覆蓋上一次的加成，不會疊加；接近上限時再用高一級的石頭追求滿值，已經用高階石精煉過的就不要再用低階石覆蓋。</li>
          <li>暴擊率、暴擊傷害、效果命中、效果抵抗<b>不能用磨石</b>，需要用寶石轉換，這個頁面不會把它們列入精煉候選。</li>
          <li><b>分數怎麼看：</b>推薦分 = 屬性權重 × 可提升幅度，再依符文星級、效率、是否已裝備與套裝契合度調整。分數高不代表一定要精煉，還是要看該顆符文是不是你長期會用的。</li>
          <li><b>速度優先的接受程度：</b>體攻防% 以「寶石 13 + 精煉 10」為 10 分，速度以「寶石 10 + 精煉 5」為 10 分，爆率／爆傷以寶石 13 為 10 分；每降一分，寶石與精煉各減 1。選 9 分（體攻防% 12+9、速度 9+4）就只會列出未達該分數的符文，並依符文速度由高到低排序。</li>
          <li><b>分數模式：</b>使用遊戲內的符文分數（副屬性＋固有屬性，含精煉；不含主屬性與套裝）。輸入目標分數後，只會列出「把所有可精煉屬性精煉到傳說上限後」能達到該分數的符文，並依每點數值的分數效益（速度 3.33／暴傷 2.86／體攻防% 2.5）排出最少要精煉哪幾條、各加到多少。</li>
          <li><b>這頁不會讀取磨石庫存。</b>建議先看「依套裝分配」整理手上同套裝的石頭，再從清單最上面開始處理；沒有對應套裝的石頭就先跳過，不要為了一顆符文浪費其他套裝的資源。</li>
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
                ? `目前沒有符文能在精煉後達到 ${targetScore} 分，或篩選條件太窄。可降低目標分數或放寬篩選。`
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
