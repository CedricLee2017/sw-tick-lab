import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, RefreshCw, Search, Swords, Trophy } from "lucide-react";
import { MONSTER_MAP, unitLabel, useStore } from "../store";
import { ELEMENTS } from "../lib/constants";
import { rtaView, type RtaView } from "../lib/rta";
import { effectiveSetCounts, setSummary } from "../lib/stats";
import {
  GUARDIAN3_LABEL,
  compareBuild,
  entryToData,
  findLuckEntry,
  indexLuckDataset,
  loadLuckDataset,
  luckComboText,
  slotStatText,
  type BuildCheck,
  type LuckDataset,
  type LuckMonsterData,
} from "../lib/lucksack";
import type { Monster } from "../lib/types";
import { ArtifactCard, Modal, MonsterIcon, MonsterPanel, NumberInput, RuneBoard, RuneCard, TickBadge, fmt } from "../components/ui";

type RtaRow = RtaView & { monster: Monster };
type LuckFilter = "all" | "issue" | "set" | "main" | "art" | "none";

/** 單隻魔靈的 Lucksack 對照明細（放在配裝彈窗裡） */
function LuckDetail({
  check,
  data,
  season,
  effectCut = 0.002,
}: {
  check: BuildCheck;
  data: LuckMonsterData;
  season: number | null;
  effectCut?: number;
}) {
  const sets = [...(data.stats.rune_sets ?? [])].sort((a, b) => b.pickrate - a.pickrate).slice(0, 6);
  const slots = [...(data.stats.slot_stats ?? [])].sort((a, b) => b.pickrate - a.pickrate).slice(0, 5);
  const tone = check.insufficient ? "muted" : check.score >= 70 ? "green" : check.score >= 40 ? "gold" : "red";
  return (
    <div style={{ marginTop: 18 }}>
      <div className="row between wrap" style={{ gap: 8, marginBottom: 8 }}>
        <div className="card-title">
          Lucksack 對照{" "}
          <span className="dim tiny">
            {GUARDIAN3_LABEL}
            {season ? ` · 第 ${season} 賽季` : ""}
          </span>
        </div>
        <span className={`chip ${tone}`}>{check.insufficient ? "資料不足" : `符合度 ${check.score}%`}</span>
        <a
          className="chip muted"
          href={`https://lucksack.gg/monster/${data.monster.slug}/stats/runes?rank=16`}
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: "none" }}
          title="在 Lucksack 查看這隻魔靈的原始統計"
        >
          <ExternalLink size={11} /> Lucksack
        </a>
      </div>

      {check.insufficient && (
        <div className="tiny dim" style={{ marginBottom: 10, lineHeight: 1.7 }}>
          Lucksack 在 {GUARDIAN3_LABEL} 的樣本太少，沒有提供這隻魔靈的套裝與主屬性統計，只能比對神器效果。
        </div>
      )}

      {check.warnings.length > 0 ? (
        <div className="col" style={{ gap: 4, marginBottom: 10 }}>
          {check.warnings.map((w, i) => (
            <div key={i} className="tiny" style={{ color: "var(--gold)", lineHeight: 1.6 }}>
              ⚠ {w}
            </div>
          ))}
        </div>
      ) : (
        <div className="tiny" style={{ color: "var(--green)", marginBottom: 10 }}>
          ✓ 套裝、主屬性與神器效果都符合 Guardian 3 主流
        </div>
      )}

      {!check.insufficient && (
        <div className="row wrap" style={{ gap: 14, alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 280px", minWidth: 240 }}>
            <div className="tiny dim" style={{ marginBottom: 4 }}>熱門套裝</div>
            <table className="table">
              <thead>
                <tr><th>套裝</th><th className="num">使用率</th><th className="num">勝率</th></tr>
              </thead>
              <tbody>
                {sets.map((s, i) => {
                  const mine = check.setMatch === s;
                  return (
                    <tr key={i} style={mine ? { color: "var(--gold)" } : undefined}>
                      <td>{luckComboText(s)}{mine ? "（你）" : ""}</td>
                      <td className="num">{(s.pickrate * 100).toFixed(1)}%</td>
                      <td className="num">{(s.winrate * 100).toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ flex: "1 1 280px", minWidth: 240 }}>
            <div className="tiny dim" style={{ marginBottom: 4 }}>熱門主屬性（2 / 4 / 6）</div>
            <table className="table">
              <thead>
                <tr><th>主屬性</th><th className="num">使用率</th><th className="num">勝率</th></tr>
              </thead>
              <tbody>
                {slots.map((s, i) => {
                  const mine = check.mainMatch === s;
                  return (
                    <tr key={i} style={mine ? { color: "var(--gold)" } : undefined}>
                      <td>{slotStatText(s)}{mine ? "（你）" : ""}</td>
                      <td className="num">{(s.pickrate * 100).toFixed(1)}%</td>
                      <td className="num">{(s.winrate * 100).toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {check.artifacts.length > 0 && (
        <>
          <div className="tiny dim" style={{ margin: "12px 0 4px" }}>你的神器效果 vs Guardian 3 使用率</div>
          <table className="table">
            <thead>
              <tr><th>神器</th><th>效果</th><th className="num">使用率</th></tr>
            </thead>
            <tbody>
              {check.artifacts.map((a, i) => (
                <tr key={i}>
                  <td className="mono">#{a.artifactId}</td>
                  <td>{a.label}</td>
                  <td className="num" style={a.ok ? undefined : { color: "var(--gold)" }}>
                    {a.pickrate == null ? `未收錄（<${(effectCut * 100).toFixed(1)}%）` : `${(a.pickrate * 100).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export default function RtaPage() {
  const account = useStore((s) => s.account);
  const grind = useStore((s) => s.settings.bonus.grind);
  const lockedRunes = useStore((s) => s.settings.lockedRunes);
  const excludedRunes = useStore((s) => s.settings.excludedRunes);
  const toggleRuneFlag = useStore((s) => s.toggleRuneFlag);
  const lockedSet = useMemo(() => new Set(lockedRunes), [lockedRunes]);
  const excludedSet = useMemo(() => new Set(excludedRunes), [excludedRunes]);
  const [leaderOn, setLeaderOn] = useState(false);
  const [leaderPct, setLeaderPct] = useState(24);
  const [q, setQ] = useState("");
  const [el, setEl] = useState(0);
  const [onlyRta, setOnlyRta] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const favorites = account?.rta?.favorites ?? [];
  const views = useMemo(() => {
    if (!account) return [] as RtaRow[];
    const pct = leaderOn ? Math.max(0, Math.min(50, leaderPct)) : 0;
    return favorites
      .map((id): RtaRow | null => {
        const unit = account.units.find((u) => u.id === id);
        const monster = unit ? MONSTER_MAP.get(unit.master) : undefined;
        if (!unit || !monster) return null;
        return { ...rtaView(account, unit, monster, pct, grind), monster };
      })
      .filter((v): v is RtaRow => !!v)
      .sort((a, b) => b.stats.spd - a.stats.spd || b.stats.ehp - a.stats.ehp);
  }, [account, favorites, leaderOn, leaderPct, grind]);

  const shown = useMemo(() => {
    let arr = views;
    if (el) arr = arr.filter((v) => v.monster.el === el);
    if (onlyRta) arr = arr.filter((v) => v.runes.length > 0 || v.artifacts.length > 0);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      arr = arr.filter((v) => unitLabel(v.unit).toLowerCase().includes(s) || v.monster.name.toLowerCase().includes(s));
    }
    return arr;
  }, [views, el, onlyRta, q]);

  // ── Lucksack（Guardian 3）對照 ─────────────────────────
  const [luckDataset, setLuckDataset] = useState<LuckDataset | null>(null);
  const [luckData, setLuckData] = useState<Record<number, LuckMonsterData | null>>({});
  const [luckError, setLuckError] = useState<string | null>(null);
  const [luckLoading, setLuckLoading] = useState(false);
  const [luckFilter, setLuckFilter] = useState<LuckFilter>("all");
  const [luckReload, setLuckReload] = useState(0);
  const accountRef = useRef(account);
  accountRef.current = account;
  const favoritesKey = favorites.join(",");

  useEffect(() => {
    const acc = accountRef.current;
    const ids = acc?.rta?.favorites ?? [];
    if (!acc || ids.length === 0) return;
    let cancelled = false;
    setLuckLoading(true);
    setLuckError(null);
    void (async () => {
      try {
        // 資料由 scripts/fetch-lucksack.mjs 預先抓好，這裡只讀 static 檔
        const ds = await loadLuckDataset(luckReload > 0);
        if (cancelled) return;
        if (!ds) {
          setLuckError("找不到 Lucksack 資料檔");
          return;
        }
        setLuckDataset(ds);
        const index = indexLuckDataset(ds);
        const map: Record<number, LuckMonsterData | null> = {};
        for (const unitId of ids) {
          const unit = acc.units.find((u) => u.id === unitId);
          const monster = unit ? MONSTER_MAP.get(unit.master) : undefined;
          const entry = monster ? findLuckEntry(index, monster) : null;
          map[unitId] = entry ? entryToData(entry) : null;
        }
        setLuckData(map);
      } catch (e) {
        if (!cancelled) setLuckError((e as Error)?.message ?? String(e));
      } finally {
        if (!cancelled) setLuckLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [favoritesKey, luckReload]);

  /** 每隻魔靈的 Lucksack 比對結果（沒有資料的就是 null） */
  const checks = useMemo(() => {
    const map = new Map<number, BuildCheck | null>();
    const cut = luckDataset?.effectCut ?? 0.002;
    for (const v of views) map.set(v.unit.id, compareBuild(v.runes, v.artifacts, luckData[v.unit.id] ?? null, cut));
    return map;
  }, [views, luckData, luckDataset]);

  /** 各類問題數量（給篩選 chips 用） */
  const luckCounts = useMemo(() => {
    let issue = 0;
    let set = 0;
    let main = 0;
    let art = 0;
    let none = 0;
    for (const c of checks.values()) {
      if (!c) {
        none++;
        continue;
      }
      if (c.warnings.length > 0) issue++;
      if (!c.insufficient && !c.setOk) set++;
      if (!c.insufficient && !c.mainOk) main++;
      if (!c.artifactOk) art++;
    }
    return { issue, set, main, art, none };
  }, [checks]);

  /** 排序：有提醒的優先、其次符合度低到高、沒有資料的放最後 */
  const luckRows = useMemo(() => {
    return views
      .map((v) => ({ view: v, check: checks.get(v.unit.id) ?? null, data: luckData[v.unit.id] ?? null }))
      .sort((a, b) => {
        if (!a.check && !b.check) return 0;
        if (!a.check) return 1;
        if (!b.check) return -1;
        return b.check.warnings.length - a.check.warnings.length || a.check.score - b.check.score;
      });
  }, [views, checks, luckData]);

  const luckFiltered = useMemo(() => {
    if (luckFilter === "none") return luckRows.filter((row) => !row.check);
    return luckRows.filter((row) => {
      const c = row.check;
      if (!c) return false;
      if (luckFilter === "issue") return c.warnings.length > 0;
      if (luckFilter === "set") return !c.insufficient && !c.setOk;
      if (luckFilter === "main") return !c.insufficient && !c.mainOk;
      if (luckFilter === "art") return !c.artifactOk;
      return true;
    });
  }, [luckRows, luckFilter]);

  const current = open !== null ? views.find((v) => v.unit.id === open) : undefined;
  const currentCheck = current ? checks.get(current.unit.id) ?? null : null;

  if (!account) return <div className="empty"><Swords size={40} /><div>尚未匯入存檔</div></div>;

  if (!account.rta || account.rta.favorites.length === 0) {
    return (
      <div className="empty" style={{ padding: "60px 20px" }}>
        <Trophy size={42} style={{ opacity: .35, marginBottom: 10 }} />
        <div style={{ fontWeight: 600, color: "var(--text)" }}>這份存檔沒有 RTA 最愛資料</div>
        <div className="tiny" style={{ marginTop: 6 }}>
          請確認匯出的 JSON 包含 <span className="mono">favorite_unit_list</span> 與{" "}
          <span className="mono">world_arena_rune_equip_list</span>；若為舊版快取，重新匯入即可。
        </div>
      </div>
    );
  }

  const fastest = views[0];
  const withRta = views.filter((v) => v.runes.length > 0 || v.artifacts.length > 0).length;
  const leaderBonus = leaderOn && fastest ? Math.ceil((fastest.base.spd * Math.max(0, Math.min(50, leaderPct))) / 100) : 0;

  return (
    <>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="stat-tile">
          <div className="k">最愛魔靈</div>
          <div className="v">{views.length}<span className="u">隻</span></div>
        </div>
        <div className="stat-tile">
          <div className="k">已有 RTA 配裝</div>
          <div className="v">{withRta}<span className="u">/ {views.length}</span></div>
        </div>
        <div className="stat-tile">
          <div className="k">目前最快</div>
          <div className="v" style={{ fontSize: 18 }}>{fastest ? unitLabel(fastest.unit) : "—"}</div>
          <div className="tiny dim">{fastest ? `${fastest.stats.spd} 速 · RTA Tick ${fastest.stats.tick}` : "尚無資料"}</div>
        </div>
        <div className="stat-tile">
          <div className="k">RTA Tick 基準</div>
          <div className="v">1.5<span className="u">% / Tick</span></div>
          <div className="tiny dim">與一般競技場的 7% 不同</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div>
            <div className="card-title">
              Lucksack 對照{" "}
              <span className="dim tiny" style={{ fontWeight: 400 }}>
                {GUARDIAN3_LABEL}
                {luckDataset ? ` · 第 ${luckDataset.season} 賽季 · 資料 ${new Date(luckDataset.updatedAt).toLocaleDateString("zh-TW")}` : ""}
              </span>
            </div>
            <div className="card-sub">
              用 Lucksack 的 RTA 統計檢查常用魔靈的套裝、2/4/6 主屬性與神器效果是否符合主流；⚠ 標記的就是跟主流不同、可以優先調整的地方。
            </div>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            {luckCounts.issue > 0 && <span className="chip red">{luckCounts.issue} 隻需要注意</span>}
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setLuckReload((n) => n + 1)}
              disabled={luckLoading}
              title="重新讀取 Lucksack 資料檔（資料由 scripts/fetch-lucksack.mjs 定期更新）"
            >
              <RefreshCw size={12} /> {luckLoading ? "讀取中…" : "重新整理"}
            </button>
          </div>
        </div>

        {luckError ? (
          <div className="card-pad tiny" style={{ lineHeight: 1.8 }}>
            讀不到 Lucksack 資料（{luckError}）。請確認 <span className="mono">public/data/lucksack.json</span> 存在，
            或用 <span className="mono">npm run data:lucksack</span> 重新抓取。
          </div>
        ) : (
          <>
            <div className="card-pad row wrap" style={{ gap: 6, borderBottom: "1px solid var(--line-soft)" }}>
              {([
                ["all", `有資料 ${views.length - luckCounts.none}`],
                ["issue", `需要注意 ${luckCounts.issue}`],
                ["set", `套裝 ${luckCounts.set}`],
                ["main", `主屬 ${luckCounts.main}`],
                ["art", `神器 ${luckCounts.art}`],
                ["none", `沒資料 ${luckCounts.none}`],
              ] as [LuckFilter, string][]).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`chip ${luckFilter === key ? "gold" : "muted"}`}
                  style={{ cursor: "pointer" }}
                  aria-pressed={luckFilter === key}
                  onClick={() => setLuckFilter(key)}
                >
                  {label}
                </button>
              ))}
              <span className="tiny dim" style={{ marginLeft: "auto" }}>
                點任一列看完整比較
              </span>
            </div>

            {luckFiltered.length === 0 ? (
              <div className="empty" style={{ padding: "22px 16px" }}>
                {luckLoading ? "正在讀取 Lucksack 資料…" : luckFilter === "none" ? "全部都有資料" : "沒有符合這個篩選的魔靈"}
              </div>
            ) : luckFilter === "none" ? (
              <div className="card-pad row wrap" style={{ gap: 8 }}>
                {luckFiltered.map(({ view }) => (
                  <span key={view.unit.id} className="chip muted" title="Lucksack 在 Guardian 3 沒有這隻的統計（樣本太少或還沒收錄）">
                    {unitLabel(view.unit)}
                  </span>
                ))}
                <div className="tiny dim" style={{ flexBasis: "100%", marginTop: 4 }}>
                  這些魔靈在 Guardian 3 幾乎沒人使用，Lucksack 沒有提供套裝 / 主屬 / 神器統計，因此不列入比較。
                </div>
              </div>
            ) : (
              <div className="table-scroll luck-scroll">
                <table className="table luck-table">
                  <thead>
                    <tr>
                      <th>魔靈</th>
                      <th className="num">符合度</th>
                      <th>套裝</th>
                      <th>主屬（2/4/6）</th>
                      <th className="num">神器</th>
                      <th>提醒</th>
                    </tr>
                  </thead>
                  <tbody>
                    {luckFiltered.map(({ view, check, data }) => {
                      const c = check as BuildCheck;
                      const insufficient = c.insufficient;
                      const bad = c.warnings.length > 0;
                      return (
                        <tr key={view.unit.id} onClick={() => setOpen(view.unit.id)} style={{ cursor: "pointer" }}>
                          <td>
                            <span className="row" style={{ gap: 6, alignItems: "center" }}>
                              <MonsterIcon id={view.monster.id} size={26} />
                              <span className="col" style={{ gap: 0 }}>
                                <b style={{ fontSize: 12.5 }}>{unitLabel(view.unit)}</b>
                                <span className="tiny dim">
                                  {ELEMENTS[view.monster.el as 1]?.name} · 選用 {((data?.summary?.pick_rate ?? 0) * 100).toFixed(1)}%
                                  {data?.summary ? ` · 勝率 ${(data.summary.win_rate * 100).toFixed(1)}%` : ""}
                                </span>
                              </span>
                            </span>
                          </td>
                          <td className="num">
                            {insufficient ? (
                              <span className="chip muted">—</span>
                            ) : (
                              <span className={`chip ${c.score >= 70 ? "green" : c.score >= 40 ? "gold" : "red"}`}>
                                {c.score}%
                              </span>
                            )}
                          </td>
                          <td style={{ color: insufficient ? "var(--muted)" : c.setOk ? "var(--green)" : "var(--gold)" }}>
                            {insufficient ? "資料不足" : c.setOk ? `✓ ${c.comboLabel}` : `⚠ ${c.comboLabel}`}
                          </td>
                          <td style={{ color: insufficient ? "var(--muted)" : c.mainOk ? "var(--green)" : "var(--gold)" }}>
                            {insufficient ? "資料不足" : c.mainOk ? `✓ ${c.mainLabel}` : `⚠ ${c.mainLabel}`}
                          </td>
                          <td className="num" style={{ color: c.artifactOk ? "var(--green)" : "var(--gold)" }}>
                            {c.artifactTotal === 0 ? "—" : `${c.artifactOk ? "✓" : "⚠"} ${c.artifactGood}/${c.artifactTotal}`}
                          </td>
                          <td
                            className="tiny"
                            style={{ color: bad ? "var(--gold)" : "var(--muted)", maxWidth: 320 }}
                            title={bad ? c.warnings.join("\n") : undefined}
                          >
                            <span style={{ display: "inline-block", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {insufficient ? "樣本太少，只能比對神器" : bad ? `⚠ ${c.warnings[0]}` : "✓ 符合主流"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="card-pad tiny dim" style={{ paddingTop: 0 }}>
              {luckCounts.none > 0 && luckFilter !== "none" && (
                <span>
                  另有 <b>{luckCounts.none}</b> 隻在 Guardian 3 沒有統計（
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    style={{ padding: "0 4px", fontSize: 11 }}
                    onClick={() => setLuckFilter("none")}
                  >
                    查看
                  </button>
                  ）。{" "}
                </span>
              )}
              資料來源：lucksack.gg · {GUARDIAN3_LABEL}
              {luckDataset ? ` · 第 ${luckDataset.season} 賽季 · ${new Date(luckDataset.updatedAt).toLocaleString("zh-TW")} 更新` : ""}
              。統計兩星期更新一次，可用 <span className="mono">npm run data:lucksack</span> 重新抓取。
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">
            RTA 最愛魔靈速度排行 <span className="dim tiny" style={{ fontWeight: 400 }}>依 RTA 獨立配裝計算</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div className="tabs">
              <button type="button" className={`tab ${!leaderOn ? "active" : ""}`} onClick={() => setLeaderOn(false)}>
                無速度隊長
              </button>
              <button type="button" className={`tab ${leaderOn ? "active" : ""}`} onClick={() => setLeaderOn(true)}>
                有速度隊長
              </button>
            </div>
            {leaderOn && (
              <div style={{ position: "relative" }}>
                <NumberInput
                  className="input mono"
                  min={0}
                  max={50}
                  step={1}
                  value={leaderPct}
                  onChange={setLeaderPct}
                  style={{ width: 96, paddingRight: 22 }}
                  title="速度隊長技 %"
                />
                <span style={{ position: "absolute", right: 8, top: 9, fontSize: 11, color: "var(--muted-2)" }}>%</span>
              </div>
            )}
          </div>
        </div>

        <div className="card-pad row wrap" style={{ gap: 12, borderBottom: "1px solid var(--line-soft)" }}>
          <div style={{ position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: "var(--muted-2)" }} />
            <input className="input" style={{ width: 190, paddingLeft: 28 }} placeholder="搜尋最愛魔靈…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="select" style={{ width: 110 }} value={el} onChange={(e) => setEl(Number(e.target.value))}>
            <option value={0}>全屬性</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{ELEMENTS[n as 1].name}屬性</option>)}
          </select>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={onlyRta} onChange={(e) => setOnlyRta(e.target.checked)} /> 只看有 RTA 配裝
          </label>
          <span className="tiny dim">
            {leaderOn ? `速度隊長 +${Math.max(0, Math.min(50, leaderPct))}%` : "未計速度隊長"}
            {leaderOn && fastest ? `（最快魔靈基礎速度 +${leaderBonus}）` : ""}
          </span>
          <span className="dim tiny" style={{ marginLeft: "auto" }}>顯示 {shown.length} / {views.length}</span>
        </div>

        <div className="card-pad col" style={{ gap: 6 }}>
          {shown.map((v, i) => {
            const sets = effectiveSetCounts(
              v.runes.reduce((m, r) => ({ ...m, [r.set]: (m[r.set] ?? 0) + 1 }), {} as Record<number, number>),
            );
            const lb = leaderOn ? Math.ceil((v.base.spd * Math.max(0, Math.min(50, leaderPct))) / 100) : 0;
            return (
              <button
                key={v.unit.id}
                className="rta-row"
                onClick={() => setOpen(v.unit.id)}
                style={{ animationDelay: `${Math.min(i, 20) * 8}ms` }}
              >
                <span className={`build-rank ${i === 0 ? "top" : ""}`}>{i + 1}</span>
                <MonsterIcon id={v.monster.id} size={44} />
                <span className="rta-main">
                  <span className="row" style={{ gap: 6 }}>
                    <b style={{ fontSize: 13.5 }}>{unitLabel(v.unit)}</b>
                    <span className={`el-${v.monster.el}`} style={{ fontSize: 11 }}>{ELEMENTS[v.monster.el as 1]?.name}</span>
                    <span className="tiny dim">{v.monster.nat}★ · {v.unit.stars}★Lv.{v.unit.level}</span>
                  </span>
                  <span className="tiny dim">
                    {Object.entries(sets).length > 0 ? setSummary(sets) : "尚未配置 RTA 符文"}
                    {" · "}{v.runes.length}/6 符文{v.artifacts.length > 0 ? ` · ${v.artifacts.length} 神器` : ""}
                  </span>
                </span>
                <span className="rta-stats tiny">
                  <span>HP <b className="mono">{fmt(v.stats.hp)}</b></span>
                  <span>ATK <b className="mono">{fmt(v.stats.atk)}</b></span>
                  <span>DEF <b className="mono">{fmt(v.stats.def)}</b></span>
                  <span>EHP <b className="mono">{fmt(v.stats.ehp)}</b></span>
                </span>
                <span className="rta-speed">
                  <b className="mono gold">{v.stats.spd}</b>
                  <span className="tiny dim">速</span>
                  <TickBadge spd={v.stats.spd} rta />
                  {leaderOn && <span className="tiny green">+{lb}</span>}
                </span>
              </button>
            );
          })}
          {shown.length === 0 && <div className="empty" style={{ padding: "40px 20px" }}>沒有符合條件的最愛魔靈</div>}
        </div>
      </div>

      {current && (
        <Modal title={`${unitLabel(current.unit)} · RTA 配裝`} onClose={() => setOpen(null)} width={860}>
          <MonsterPanel
            monster={current.monster}
            base={current.base}
            stats={current.stats}
            stars={current.unit.stars}
            level={current.unit.level}
            artifacts={current.artifacts}
            badge={<TickBadge spd={current.stats.spd} rta />}
            name={unitLabel(current.unit)}
          />
          <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
            <span className="chip gold">{current.monster.nat}★ 原生</span>
            <span className="chip muted">RTA 獨立配裝</span>
          </div>

          <div className="row between" style={{ marginTop: 18, marginBottom: 8 }}>
            <div className="card-title">RTA 符文</div>
            <span className="tiny dim">
              {current.runes.length}/6 · {current.runes.length > 0 ? setSummary(effectiveSetCounts(current.runes.reduce((m, r) => ({ ...m, [r.set]: (m[r.set] ?? 0) + 1 }), {} as Record<number, number>))) : "未配置"}
            </span>
          </div>
          {current.runes.length === 0 ? (
            <div className="empty tiny">這隻魔靈目前沒有 RTA 符文配置</div>
          ) : (
            <RuneBoard
              runes={current.runes}
              renderRune={(r) => (
                <RuneCard
                  rune={r}
                  owner={unitLabel(current.unit)}
                  locked={lockedSet.has(r.id)}
                  excluded={excludedSet.has(r.id)}
                  onToggleLock={() => toggleRuneFlag("locked", r.id)}
                  onToggleExclude={() => toggleRuneFlag("excluded", r.id)}
                />
              )}
            />
          )}

          <div className="row between" style={{ marginTop: 18, marginBottom: 8 }}>
            <div className="card-title">RTA 神器</div>
            <span className="tiny dim">{current.artifacts.length} / 2</span>
          </div>
          {current.artifacts.length === 0 ? (
            <div className="empty tiny">這隻魔靈目前沒有 RTA 神器配置</div>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
              {current.artifacts.map((a) => <ArtifactCard key={a.id} artifact={a} owner={unitLabel(current.unit)} />)}
            </div>
          )}

          {currentCheck && luckData[current.unit.id] && (
            <LuckDetail
              check={currentCheck}
              data={luckData[current.unit.id] as LuckMonsterData}
              season={luckDataset?.season ?? null}
              effectCut={luckDataset?.effectCut ?? 0.002}
            />
          )}

          <div className="tiny dim" style={{ marginTop: 12, lineHeight: 1.6 }}>
            RTA 配裝來自存檔的 <span className="mono">world_arena_rune_equip_list</span> /{" "}
            <span className="mono">world_arena_artifact_equip_list</span>，與一般配裝完全獨立；同一顆符文可以同時出現在兩邊。
            {leaderOn ? ` 目前速度已加入速度隊長 +${Math.max(0, Math.min(50, leaderPct))}%。` : " 目前未計速度隊長。"}
          </div>
        </Modal>
      )}
    </>
  );
}
