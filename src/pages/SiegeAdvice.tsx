import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle, ChevronLeft, ChevronRight, Crown, Database, Download, Plus, RefreshCw, Search, Shield,
  ScrollText, Swords, Target, Upload,
} from "lucide-react";
import { fmt, MonsterIcon } from "../components/ui";
import { MonsterPickerModal, toMonsterEntries } from "../components/MonsterPicker";
import { MONSTER_MAP, useStore } from "../store";
import {
  analyzeSiegeBattles, loadSiegeBattles, mergeSiegeDatasets, normalizeSiegeDataset, parseSiegeJson, parseSiegeReportHtml,
  recommendSiegeCounters, recommendSiegeDefenses, siegeDateValue, siegeDefenseVariants,
  siegeShortDate, siegeTeamKey,
  type SiegeDataset,
} from "../lib/siegeAdvice";

const STORAGE_KEY = "swtick:siege-battles";
const LOG_PAGE_SIZE = 40;

type TabKey = "offense" | "defense" | "log" | "data";

function SgMonsterIcon({ data, id, size = 30 }: { data: SiegeDataset; id: number; size?: number }) {
  const info = data.monsters[String(id)];
  const name = displayMonsterName(data, id);
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, borderRadius: Math.max(5, Math.round(size * 0.18)) };
  if (!info?.icon || failed) {
    if (MONSTER_MAP.has(id)) return <MonsterIcon id={id} size={size} />;
    return (
      <span className="sg-mon-icon fallback" style={{ ...style, fontSize: Math.max(8, size * 0.32) }} title={name}>
        {name.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      className="sg-mon-icon"
      style={style}
      src={info.icon}
      alt={name}
      title={name}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

function isSpeedLeader(id: number): boolean {
  return MONSTER_MAP.get(id)?.lead?.attr === "Attack Speed";
}

/** 把速度隊長移到最左邊；同時有多隻時，隊長技 % 較高的優先 */
function speedLeaderFirst(ids: number[]): number[] {
  const leader = ids
    .filter(isSpeedLeader)
    .sort((a, b) => (MONSTER_MAP.get(b)?.lead?.amount ?? 0) - (MONSTER_MAP.get(a)?.lead?.amount ?? 0))[0];
  return leader ? [leader, ...ids.filter((id) => id !== leader)] : ids;
}

function orderedTeamLabel(data: SiegeDataset, ids: number[]): string {
  return speedLeaderFirst(ids).map((id) => displayMonsterName(data, id)).join(" / ");
}

/** 優先使用 SWGT 紀錄中的名稱；紀錄沒有的自訂角色則回退到內建魔靈資料 */
function displayMonsterName(data: SiegeDataset, id: number): string {
  const datasetName = data.monsters[String(id)]?.name;
  const appName = MONSTER_MAP.get(id)?.name;
  if (datasetName && !datasetName.startsWith("#")) return datasetName;
  return appName || datasetName || `#${id}`;
}

function SgTeam({
  data,
  ids,
  size = 30,
  names = false,
  className = "",
}: {
  data: SiegeDataset;
  ids: number[];
  size?: number;
  names?: boolean;
  className?: string;
}) {
  const ordered = speedLeaderFirst(ids);
  return (
    <span className={`sg-team ${className}`.trim()}>
      {ordered.map((id) => (
        <span className="sg-mon" key={id} title={displayMonsterName(data, id)}>
          <SgMonsterIcon data={data} id={id} size={size} />
          {names && <span className="sg-mon-name">{displayMonsterName(data, id)}</span>}
        </span>
      ))}
    </span>
  );
}

function WrBadge({ wr, label }: { wr: number; label?: string }) {
  const tone = wr >= 95 ? "good" : wr >= 80 ? "mid" : "bad";
  const text = Number.isInteger(wr) ? String(wr) : wr.toFixed(1);
  return (
    <span className={`sg-wr ${tone}`}>
      {label ? `${label} ` : ""}{text}%
    </span>
  );
}

function StatTile({ label, value, sub, accent = false }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className="stat-tile" style={accent ? { borderColor: "rgba(242,198,92,.35)", background: "rgba(242,198,92,.06)" } : undefined}>
      <div className="k">{label}</div>
      <div className="v" style={accent ? { color: "var(--gold)" } : undefined}>{value}</div>
      {sub && <div className="u">{sub}</div>}
    </div>
  );
}

export default function SiegeAdvicePage() {
  const account = useStore((s) => s.account);
  const [dataset, setDataset] = useState<SiegeDataset | null>(null);
  const [source, setSource] = useState<"builtin" | "imported">("builtin");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("offense");
  const [selectedKey, setSelectedKey] = useState("");
  const [defenseSearch, setDefenseSearch] = useState("");
  const [defenseLimit, setDefenseLimit] = useState(60);
  const [customTeam, setCustomTeam] = useState<number[]>([0, 0, 0]);
  const [customPickerIndex, setCustomPickerIndex] = useState<number | null>(null);
  const [customOwnedOnly, setCustomOwnedOnly] = useState(false);
  const [onlySpeedLeaders, setOnlySpeedLeaders] = useState(false);
  const [logResult, setLogResult] = useState("all");
  const [logGuild, setLogGuild] = useState("");
  const [logSeason, setLogSeason] = useState("");
  const [logQuery, setLogQuery] = useState("");
  const [logPage, setLogPage] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {
      saved = null;
    }
    if (saved) {
      try {
        const imported = normalizeSiegeDataset(JSON.parse(saved));
        setDataset(imported);
        setSource("imported");
        return () => {
          alive = false;
        };
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    loadSiegeBattles()
      .then((data) => {
        if (alive) setDataset(data);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "對戰紀錄載入失敗");
      });
    return () => {
      alive = false;
    };
  }, []);

  const analysis = useMemo(() => (dataset ? analyzeSiegeBattles(dataset) : null), [dataset]);
  const defenseAdvice = useMemo(() => (analysis ? recommendSiegeDefenses(analysis) : null), [analysis]);
  const customKey = customTeam.every((id) => id > 0) ? siegeTeamKey(customTeam) : "";
  const isCustom = !!customKey && selectedKey === customKey;
  const counterAdvice = useMemo(
    () => (dataset && analysis && selectedKey
      ? recommendSiegeCounters(dataset, analysis, selectedKey, isCustom ? customTeam : undefined)
      : null),
    [dataset, analysis, selectedKey, isCustom, customTeam],
  );
  const selectedDefense = counterAdvice?.defense;

  useEffect(() => {
    if (isCustom) return;
    if (!analysis || !defenseAdvice) return;
    if (selectedKey && analysis.defenseTeams.some((d) => d.key === selectedKey)) return;
    setSelectedKey(defenseAdvice.suggestions[0]?.key ?? analysis.defenseTeams[0]?.key ?? "");
  }, [analysis, defenseAdvice, selectedKey, isCustom]);

  useEffect(() => {
    setLogSeason("");
    setLogGuild("");
    setLogResult("all");
    setLogQuery("");
    setLogPage(1);
  }, [dataset]);

  const defenseList = useMemo(() => {
    if (!analysis || !dataset) return [];
    const term = defenseSearch.trim().toLowerCase();
    return analysis.defenseTeams
      .filter((d) => {
        if (!term) return true;
        if (d.guilds.some((guild) => guild.toLowerCase().includes(term))) return true;
        return d.team.some((id) => displayMonsterName(dataset, id).toLowerCase().includes(term));
      })
      .sort((a, b) => b.losses - a.losses || b.battles - a.battles || a.wr - b.wr);
  }, [analysis, dataset, defenseSearch]);

  const defenseVisible = useMemo(() => {
    const list = defenseList.slice(0, defenseLimit);
    if (selectedKey && !list.some((d) => d.key === selectedKey)) {
      const selected = defenseList.find((d) => d.key === selectedKey);
      if (selected) list.unshift(selected);
    }
    return list;
  }, [defenseList, defenseLimit, selectedKey]);

  const ownedMasters = useMemo(() => new Set(account?.units.map((u) => u.master) ?? []), [account]);
  const customPickerEntries = useMemo(() => {
    return toMonsterEntries()
      .filter((e) => !customOwnedOnly || ownedMasters.has(e.monster.id))
      .filter((e) => !onlySpeedLeaders || e.monster.lead?.attr === "Attack Speed")
      .map((e) => ({
        ...e,
        meta: `${e.monster.nat}★ · 基礎速度 ${e.monster.spd}${e.monster.lead?.attr === "Attack Speed" ? ` · 速隊長 +${e.monster.lead.amount}%` : ""}`,
      }));
  }, [customOwnedOnly, onlySpeedLeaders, ownedMasters]);

  const pickCustom = (index: number, id: number) => {
    const next = [...customTeam];
    for (let i = 0; i < 3; i++) if (next[i] === id) next[i] = 0;
    next[index] = id;
    const ordered = speedLeaderFirst(next.filter(Boolean));
    const padded = [ordered[0] ?? 0, ordered[1] ?? 0, ordered[2] ?? 0];
    setCustomTeam(padded);
    setSelectedKey(padded.every((x) => x > 0) ? siegeTeamKey(padded) : "");
  };

  const clearCustom = () => {
    setCustomTeam([0, 0, 0]);
    if (isCustom) setSelectedKey("");
  };

  const primaryPair = useMemo(() => {
    if (!defenseAdvice) return undefined;
    return defenseAdvice.corePairs.find((p) => p.battles >= 8) ?? defenseAdvice.corePairs[0];
  }, [defenseAdvice]);
  const variants = useMemo(
    () => (dataset && primaryPair ? siegeDefenseVariants(dataset, primaryPair.ids) : []),
    [dataset, primaryPair],
  );

  const guildOptions = useMemo(
    () => (analysis ? analysis.defenseGuilds.map((g) => g.guild).filter((g) => g !== "未知公會") : []),
    [analysis],
  );

  const logBattles = useMemo(() => {
    if (!dataset) return [];
    const term = logQuery.trim().toLowerCase();
    return dataset.battles
      .filter((battle) => {
        if (logResult !== "all" && battle.result !== logResult) return false;
        if (logGuild && battle.defenseGuild !== logGuild) return false;
        if (logSeason && battle.season !== logSeason) return false;
        if (!term) return true;
        const haystack = [
          battle.defenseGuild,
          battle.attacker,
          ...battle.counter.map((id) => displayMonsterName(dataset, id)),
          ...battle.defense.map((id) => displayMonsterName(dataset, id)),
        ].join(" ").toLowerCase();
        return haystack.includes(term);
      })
      .sort((a, b) => siegeDateValue(b.date) - siegeDateValue(a.date));
  }, [dataset, logResult, logGuild, logSeason, logQuery]);

  const logPages = Math.max(1, Math.ceil(logBattles.length / LOG_PAGE_SIZE));
  const logPageSafe = Math.min(logPage, logPages);
  const logRows = logBattles.slice((logPageSafe - 1) * LOG_PAGE_SIZE, logPageSafe * LOG_PAGE_SIZE);

  const resetLogFilters = () => {
    setLogResult("all");
    setLogGuild("");
    setLogSeason("");
    setLogQuery("");
    setLogPage(1);
  };

  const openDefense = (key: string) => {
    setCustomTeam([0, 0, 0]);
    setSelectedKey(key);
    setTab("offense");
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    try {
      const text = await file.text();
      const next = /\.json$/i.test(file.name) ? parseSiegeJson(text) : parseSiegeReportHtml(text);
      const merged = dataset ? mergeSiegeDatasets(dataset, next) : next;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      } catch {
        /* 瀏覽器空間不足時仍可使用本次匯入的資料 */
      }
      setDataset(merged);
      setSource("imported");
      setSelectedKey("");
      setCustomTeam([0, 0, 0]);
      setTab("offense");
    } catch (err) {
      setError(err instanceof Error ? err.message : "匯入失敗，請確認檔案格式。");
    }
  };

  const resetBuiltin = () => {
    localStorage.removeItem(STORAGE_KEY);
    setSource("builtin");
    setSelectedKey("");
    setCustomTeam([0, 0, 0]);
    setError("");
    loadSiegeBattles()
      .then(setDataset)
      .catch((err) => setError(err instanceof Error ? err.message : "內建資料載入失敗"));
  };

  const downloadJson = () => {
    if (!dataset) return;
    const blob = new Blob([JSON.stringify(dataset)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `siege-battles-${dataset.player || "data"}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  };

  if (!dataset) {
    return (
      <div className="card card-pad">
        <div className="row" style={{ gap: 8 }}>
          <RefreshCw size={15} className="dim" />
          <span className="tiny dim">{error || "對戰紀錄載入中…"}</span>
        </div>
      </div>
    );
  }
  if (!analysis || !defenseAdvice) {
    return <div className="empty">資料解析中…</div>;
  }

  const overall = analysis.overall;
  const tabButtons: { key: TabKey; label: string; icon: ReactNode }[] = [
    { key: "offense", label: "進攻建議", icon: <Swords size={14} /> },
    { key: "defense", label: "防守建議", icon: <Shield size={14} /> },
    { key: "log", label: `對戰記錄 ${dataset.battles.length}`, icon: <ScrollText size={14} /> },
    { key: "data", label: "資料", icon: <Database size={14} /> },
  ];

  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 12 }}>
        <div className="row between wrap" style={{ gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div className="row wrap" style={{ gap: 6 }}>
              <span className="chip gold"><Target size={12} /> {dataset.player}</span>
              <span className="chip">{dataset.guild || "未知公會"}</span>
              {dataset.season && <span className="chip muted">{dataset.season}</span>}
              <span className="chip muted">{source === "imported" ? "已匯入資料" : "內建快照"}</span>
            </div>
            <div className="tiny dim" style={{ marginTop: 5 }}>
              {dataset.source} · {dataset.dateMin} ~ {dataset.dateMax} · 收集於 {new Date(dataset.collectedAt).toLocaleString("zh-TW")}
            </div>
          </div>
          <div className="row wrap" style={{ gap: 7 }}>
            <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
              <Upload size={13} /> 匯入更新
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={downloadJson}>
              <Download size={13} /> 下載 JSON
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.html,.htm,application/json,text/html"
              hidden
              onChange={(e) => {
                void handleImport(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        <div className="sg-summary">
          <StatTile label="Nosna44 勝率" value={`${overall.wr}%`} sub={`${overall.wins} 勝 / ${overall.losses} 敗`} accent />
          <StatTile label="對戰場次" value={fmt(overall.battles)} sub={`${overall.counterTeams} 種進攻隊 · ${analysis.seasons.length} 季`} />
          <StatTile label="防守隊" value={fmt(overall.defenseTeams)} sub={`${overall.guilds} 個對手公會`} />
          <StatTile label="讓 Nosna44 失手" value={overall.losses} sub="可作為防守靈感" />
        </div>
      </div>

      {error && (
        <div className="card card-pad" style={{ marginBottom: 12, borderColor: "rgba(255,107,107,.3)", color: "var(--red)" }}>
          <div className="row" style={{ gap: 7 }}><AlertTriangle size={15} /> {error}</div>
        </div>
      )}

      <div className="row between wrap" style={{ gap: 8, marginBottom: 12 }}>
        <div className="tabs">
          {tabButtons.map((t) => (
            <button key={t.key} type="button" className={`tab ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
              <span className="row" style={{ gap: 5 }}>{t.icon}{t.label}</span>
            </button>
          ))}
        </div>
        {source === "imported" && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={resetBuiltin}>
            <RefreshCw size={12} /> 用回內建快照
          </button>
        )}
      </div>

      {tab === "offense" && (
        <div className="sg-offense-grid">
          <div className="card sg-picker">
            <div className="card-head">
              <div>
                <div className="card-title">選擇防守隊</div>
                <div className="card-sub">點選想分析的防守隊，右側會推薦進攻隊</div>
              </div>
              <span className="chip muted">{defenseVisible.length} / {defenseList.length}</span>
            </div>
            <div className="card-pad" style={{ paddingTop: 10 }}>
              <div style={{ position: "relative" }}>
                <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: "var(--muted-2)" }} />
                <input
                  className="input"
                  style={{ paddingLeft: 28 }}
                  placeholder="搜尋防守怪物 / 公會…"
                  value={defenseSearch}
                  onChange={(e) => { setDefenseSearch(e.target.value); setDefenseLimit(60); }}
                />
              </div>

              <div className="sg-custom-team">
                <div className="row between wrap" style={{ gap: 6 }}>
                  <span className="tiny dim">自訂防守隊（速隊長自動排最左）</span>
                  <div className="row" style={{ gap: 8 }}>
                    <label className="row tiny" style={{ gap: 4, cursor: "pointer" }}>
                      <input type="checkbox" checked={onlySpeedLeaders} onChange={(e) => setOnlySpeedLeaders(e.target.checked)} />
                      只看速隊長
                    </label>
                    <label className="row tiny" style={{ gap: 4, cursor: "pointer" }}>
                      <input type="checkbox" checked={customOwnedOnly} onChange={(e) => setCustomOwnedOnly(e.target.checked)} />
                      只顯示我的魔靈
                    </label>
                  </div>
                </div>
                <div className="sg-custom-slots">
                  {[0, 1, 2].map((index) => {
                    const id = customTeam[index];
                    return (
                      <button
                        key={index}
                        type="button"
                        className={`sg-slot ${id ? "filled" : ""}`}
                        title={id ? displayMonsterName(dataset, id) : `選擇第 ${index + 1} 隻魔靈`}
                        onClick={() => setCustomPickerIndex(index)}
                      >
                        {id ? (
                          <>
                            <SgMonsterIcon data={dataset} id={id} size={30} />
                            <span className="sg-slot-name">{displayMonsterName(dataset, id)}</span>
                            {isSpeedLeader(id) && <span className="sg-slot-lead">速</span>}
                          </>
                        ) : (
                          <>
                            <Plus size={15} className="dim" />
                            <span>第 {index + 1} 隻</span>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="row between wrap" style={{ gap: 6, marginTop: 6 }}>
                  <span className="tiny dim">
                    {customKey ? (isCustom ? "已套用自訂隊" : "選滿 3 隻後自動分析") : "選滿 3 隻後自動分析"}
                  </span>
                  <div className="row" style={{ gap: 5 }}>
                    {customKey && !isCustom && (
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => setSelectedKey(customKey)}>
                        分析這隊
                      </button>
                    )}
                    {customTeam.some((id) => id > 0) && (
                      <button type="button" className="btn btn-sm btn-ghost" onClick={clearCustom}>清除</button>
                    )}
                  </div>
                </div>
              </div>

              <div className="sg-defense-list">
                {defenseVisible.map((defense) => (
                  <button
                    key={defense.key}
                    type="button"
                    className={`sg-defense-card ${selectedKey === defense.key ? "on" : ""}`}
                    title={orderedTeamLabel(dataset, defense.team)}
                    onClick={() => { setCustomTeam([0, 0, 0]); setSelectedKey(defense.key); }}
                  >
                    <div className="row between wrap" style={{ gap: 5 }}>
                      <SgTeam data={dataset} ids={defense.team} size={25} />
                      <WrBadge wr={defense.wr} />
                    </div>
                    <div className="sg-defense-meta">
                      <span>{defense.battles} 場</span>
                      <span>{defense.losses} 敗</span>
                      {defense.guilds.slice(0, 2).map((guild) => <span key={guild}>{guild}</span>)}
                    </div>
                  </button>
                ))}
                {defenseList.length === 0 && <div className="tiny dim">找不到符合的防守隊。</div>}
              </div>
              {defenseList.length > defenseVisible.length && (
                <button type="button" className="btn btn-sm btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => setDefenseLimit((v) => v + 60)}>
                  顯示更多（還有 {defenseList.length - defenseVisible.length} 種）
                </button>
              )}
            </div>
          </div>

          <div style={{ minWidth: 0 }}>
            {selectedDefense && counterAdvice ? (
              <>
                <div className="card card-pad">
                  <div className="row between wrap" style={{ gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="card-title" style={{ fontSize: 15 }}>{orderedTeamLabel(dataset, selectedDefense.team)}</div>
                      <div className="tiny dim" style={{ marginTop: 3 }}>
                        {selectedDefense.battles > 0
                          ? `Nosna44 對這隊 ${selectedDefense.battles} 場，${selectedDefense.wins} 勝 ${selectedDefense.losses} 敗（${selectedDefense.wr}%）`
                          : "自訂防守隊：紀錄中沒有完全相同的隊伍，以下用相似防守隊推薦"}
                      </div>
                    </div>
                    {selectedDefense.battles > 0 && <WrBadge wr={selectedDefense.wr} />}
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <SgTeam data={dataset} ids={selectedDefense.team} size={44} names />
                  </div>
                </div>

                <div className="card card-pad" style={{ marginTop: 10 }}>
                  <div className="row between wrap" style={{ gap: 8 }}>
                    <div className="card-title">推薦進攻隊</div>
                    <span className="tiny dim">直接對戰優先，其次為共用 2 隻的相似防守隊</span>
                  </div>
                  <div className="sg-advice-list">
                    {counterAdvice.recommendations.map((candidate, index) => (
                      <div className="sg-advice-row" key={candidate.key}>
                        <span className="sg-rank">{index + 1}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <SgTeam data={dataset} ids={candidate.team} size={30} names />
                          <div className="tiny dim" style={{ marginTop: 3 }}>{candidate.reason}</div>
                        </div>
                        <div className="sg-advice-side">
                          <WrBadge wr={candidate.wr} />
                          <span className={`chip ${candidate.source === "exact" ? "green" : "muted"}`} style={{ padding: "0 6px", fontSize: 9.5 }}>
                            {candidate.source === "exact" ? "直接對戰" : "相似防守"}
                          </span>
                        </div>
                      </div>
                    ))}
                    {counterAdvice.recommendations.length === 0 && counterAdvice.fallbackTeams.length === 0 && (
                      <div className="empty" style={{ padding: "18px 8px" }}>沒有直接或相似防守隊的對戰紀錄。</div>
                    )}
                  </div>

                  {counterAdvice.recommendations.length < 3 && counterAdvice.fallbackTeams.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div className="row between wrap" style={{ gap: 6 }}>
                        <span className="tiny dim">沒有直接 / 足夠相似紀錄時的參考進攻隊</span>
                        <span className="chip muted">依對位勝率</span>
                      </div>
                      <div className="sg-advice-list" style={{ marginTop: 6 }}>
                        {counterAdvice.fallbackTeams.slice(0, 4).map((candidate) => (
                          <div className="sg-advice-row" key={candidate.key}>
                            <span className="sg-rank ref">參</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <SgTeam data={dataset} ids={candidate.team} size={30} names />
                              <div className="tiny dim" style={{ marginTop: 3 }}>{candidate.reason}</div>
                            </div>
                            <div className="sg-advice-side">
                              <WrBadge wr={candidate.wr} />
                              <span className="chip muted" style={{ padding: "0 6px", fontSize: 9.5 }}>參考</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {counterAdvice.fallbackMonsters.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div className="tiny dim">沒有足夠紀錄時，可參考這些進攻核心：</div>
                      <div className="row wrap" style={{ gap: 5, marginTop: 5 }}>
                        {counterAdvice.fallbackMonsters.map((monster) => (
                          <span key={monster.id} className="chip">
                            {displayMonsterName(dataset, monster.id)} {monster.battles} 場 · {monster.wr}%
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {counterAdvice.exactPairs.length > 0 && (
                  <div className="card" style={{ marginTop: 10 }}>
                    <div className="card-head">
                      <div className="card-title">直接對戰紀錄</div>
                      <span className="tiny dim">{counterAdvice.exactPairs.length} 種進攻隊</span>
                    </div>
                    <div className="table-scroll">
                      <table className="table">
                        <thead>
                          <tr><th>Nosna44 進攻隊</th><th className="num">戰績</th><th className="num">勝率</th><th>最後對戰</th></tr>
                        </thead>
                        <tbody>
                          {counterAdvice.exactPairs.map((pair) => (
                            <tr key={pair.key}>
                              <td><SgTeam data={dataset} ids={pair.counter} size={24} names /></td>
                              <td className="num">{pair.wins}/{pair.battles}</td>
                              <td className="num"><WrBadge wr={pair.wr} /></td>
                              <td className="tiny dim">{siegeShortDate(pair.lastDate)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {counterAdvice.similarDefenses.length > 0 && (
                  <div className="card" style={{ marginTop: 10 }}>
                    <div className="card-head">
                      <div className="card-title">相似防守隊</div>
                      <span className="tiny dim">與目前防守隊共用 2 隻怪物</span>
                    </div>
                    <div className="card-pad row wrap" style={{ gap: 6 }}>
                      {counterAdvice.similarDefenses.map((defense) => (
                        <button key={defense.key} type="button" className="sg-variant" onClick={() => setSelectedKey(defense.key)}>
                          <SgTeam data={dataset} ids={defense.team} size={22} />
                          <WrBadge wr={defense.wr} />
                          <span className="tiny dim">{defense.battles} 場</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="empty">請從左側選擇一個防守隊。</div>
            )}
          </div>
        </div>
      )}

      {tab === "defense" && (
        <div className="grid" style={{ gap: 12 }}>
          {primaryPair && (
            <div className="card card-pad sg-callout">
              <div className="row between wrap" style={{ gap: 8 }}>
                <div>
                  <div className="row" style={{ gap: 7 }}>
                    <Crown size={16} style={{ color: "var(--gold)" }} />
                    <div className="card-title">新建議：防守核心</div>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 15, fontWeight: 800 }}>{orderedTeamLabel(dataset, primaryPair.ids)}</div>
                  <div className="tiny dim" style={{ marginTop: 4 }}>
                    這個雙人組合共 {primaryPair.battles} 場，Nosna44 只贏 {primaryPair.wins} 場（{primaryPair.wr}%），失手 {primaryPair.losses} 次。
                  </div>
                </div>
                <WrBadge wr={primaryPair.wr} />
              </div>
              <div className="sg-variant-row">
                {variants.slice(0, 6).map((variant) => (
                  <button
                    key={variant.monsterId}
                    type="button"
                    className="sg-variant"
                    onClick={() => openDefense(siegeTeamKey(variant.team))}
                    title="用這隊的資料分析進攻"
                  >
                    <SgTeam data={dataset} ids={variant.team} size={24} />
                    <WrBadge wr={variant.wr} />
                    <span className="tiny dim">{variant.battles} 場</span>
                  </button>
                ))}
              </div>
              <div className="tiny dim" style={{ marginTop: 7 }}>
                第三隻可優先考慮樣本較多的 {variants.slice(0, 3).map((v) => displayMonsterName(dataset, v.monsterId)).join("、")}；按一下可直接分析該變體的進攻方式。
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">讓 Nosna44 失手的防守隊</div>
                <div className="card-sub">
                  共 {overall.losses} 場敗仗、{defenseAdvice.losingDefenses.length} 種防守隊；這裡只列失手次數最多的前 8 種
                </div>
              </div>
              <span className="chip red">{overall.losses} 敗</span>
            </div>
            <div className="card-pad sg-loss-list">
              {defenseAdvice.losingDefenses.slice(0, 8).map((defense) => {
                const lostCounters = analysis.pairs
                  .filter((p) => p.defenseKey === defense.key && p.losses > 0)
                  .sort((a, b) => b.losses - a.losses || b.battles - a.battles);
                return (
                  <div className="sg-loss-card" key={defense.key}>
                    <div className="row between wrap" style={{ gap: 6 }}>
                      <SgTeam data={dataset} ids={defense.team} size={28} names />
                      <div className="row" style={{ gap: 5 }}>
                        <WrBadge wr={defense.wr} />
                        <span className="tiny dim">{defense.battles} 場 / {defense.losses} 敗</span>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => openDefense(defense.key)}>
                          分析這隊
                        </button>
                      </div>
                    </div>
                    <div className="tiny dim" style={{ marginTop: 4 }}>
                      讓 Nosna44 失手的進攻隊{defense.guilds.length ? `（${defense.guilds.slice(0, 2).join(" / ")}）` : ""}：
                    </div>
                    <div className="row wrap" style={{ gap: 5, marginTop: 4 }}>
                      {lostCounters.slice(0, 4).map((counter) => (
                        <span className="chip red" key={counter.key} title={orderedTeamLabel(dataset, counter.counter)}>
                          <SgTeam data={dataset} ids={counter.counter} size={18} />
                          {counter.losses} 敗 / {counter.battles} 場
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div className="card-title">高難度防守隊與破解方式</div>
              <span className="tiny dim">Nosna44 勝率越低越難打</span>
            </div>
            <div className="card-pad" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {defenseAdvice.suggestions.map((suggestion) => (
                <div className="sg-loss-card" style={{ borderColor: "var(--line-soft)", background: "rgba(11,17,32,.35)" }} key={suggestion.key}>
                  <div className="row between wrap" style={{ gap: 6 }}>
                    <SgTeam data={dataset} ids={suggestion.team} size={28} names />
                    <div className="row" style={{ gap: 5 }}>
                      <WrBadge wr={suggestion.wr} />
                      <span className="tiny dim">{suggestion.battles} 場 / {suggestion.losses} 敗</span>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => openDefense(suggestion.key)}>分析</button>
                    </div>
                  </div>
                  <div className="tiny dim" style={{ marginTop: 4 }}>{suggestion.reason}；被這些隊打敗：</div>
                  <div className="row wrap" style={{ gap: 5, marginTop: 4 }}>
                    {suggestion.counters.filter((c) => c.wins > 0).slice(0, 4).map((counter) => (
                      <span className="chip" key={counter.key} title={orderedTeamLabel(dataset, counter.counter)}>
                        <SgTeam data={dataset} ids={counter.counter} size={18} />
                        {counter.wins}/{counter.battles}（{counter.wr}%）
                      </span>
                    ))}
                    {suggestion.counters.every((c) => c.wins === 0) && <span className="tiny dim">樣本中沒有打贏這隊的進攻隊</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid split-2" style={{ gap: 12 }}>
            <div className="card">
              <div className="card-head"><div className="card-title">防守核心怪物</div><span className="tiny dim">出現 ≥20 場</span></div>
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>怪物</th><th className="num">對戰</th><th className="num">Nosna44 勝率</th><th className="num">失手</th></tr></thead>
                  <tbody>
                    {defenseAdvice.coreMonsters.map((monster) => (
                      <tr key={monster.id}>
                        <td><span className="row" style={{ gap: 5 }}><SgMonsterIcon data={dataset} id={monster.id} size={24} />{displayMonsterName(dataset, monster.id)}</span></td>
                        <td className="num">{monster.battles}</td>
                        <td className="num"><WrBadge wr={monster.wr} /></td>
                        <td className="num">{monster.losses}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="card-head"><div className="card-title">防守雙人核心</div><span className="tiny dim">出現 ≥15 場；依失手次數 × 樣本數排序</span></div>
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>組合</th><th className="num">對戰</th><th className="num">Nosna44 勝率</th><th className="num">失手</th></tr></thead>
                  <tbody>
                    {defenseAdvice.corePairs.map((pair) => (
                      <tr key={pair.key}>
                        <td><span className="row" style={{ gap: 5 }}><SgMonsterIcon data={dataset} id={pair.ids[0]} size={22} /><SgMonsterIcon data={dataset} id={pair.ids[1]} size={22} />{displayMonsterName(dataset, pair.ids[0])} + {displayMonsterName(dataset, pair.ids[1])}</span></td>
                        <td className="num">{pair.battles}</td>
                        <td className="num"><WrBadge wr={pair.wr} /></td>
                        <td className="num">{pair.losses}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">值得參考的對手公會</div><span className="tiny dim">至少 5 場；依 Nosna44 勝率由低到高</span></div>
            <div className="table-scroll">
              <table className="table">
                <thead><tr><th>公會</th><th className="num">對戰</th><th className="num">Nosna44 勝率</th><th className="num">失手</th></tr></thead>
                <tbody>
                  {defenseAdvice.guilds.map((guild) => (
                    <tr key={guild.guild}>
                      <td>{guild.guild}</td>
                      <td className="num">{guild.battles}</td>
                      <td className="num"><WrBadge wr={guild.wr} /></td>
                      <td className="num">{guild.losses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "log" && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-head">
              <div>
                <div className="card-title">賽季統計</div>
                <div className="card-sub">點擊賽季可直接篩選下方對戰記錄</div>
              </div>
              <span className="chip muted">{analysis.seasons.length} 季</span>
            </div>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr><th>賽季</th><th className="num">對戰</th><th className="num">勝</th><th className="num">敗</th><th className="num">勝率</th></tr>
                </thead>
                <tbody>
                  {analysis.seasons.map((season) => (
                    <tr
                      key={season.season}
                      style={{ cursor: "pointer", background: logSeason === season.season ? "rgba(242,198,92,.07)" : undefined }}
                      onClick={() => { setLogSeason(season.season); setLogPage(1); }}
                    >
                      <td>
                        <b>{season.season}</b>
                        {logSeason === season.season && <span className="chip gold" style={{ marginLeft: 6, padding: "0 6px", fontSize: 9.5 }}>已篩選</span>}
                      </td>
                      <td className="num">{season.battles}</td>
                      <td className="num">{season.wins}</td>
                      <td className="num">{season.losses}</td>
                      <td className="num"><WrBadge wr={season.wr} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
          <div className="card-head">
            <div className="card-title">對戰記錄</div>
            <span className="tiny dim">共 {logBattles.length} / {dataset.battles.length} 場</span>
          </div>
          <div className="card-pad" style={{ paddingTop: 10 }}>
            <div className="row wrap" style={{ gap: 7 }}>
              <select className="select" style={{ width: 120 }} value={logSeason} onChange={(e) => { setLogSeason(e.target.value); setLogPage(1); }}>
                <option value="">全部賽季</option>
                {analysis.seasons.map((season) => <option key={season.season} value={season.season}>{season.season}</option>)}
              </select>
              <select className="select" style={{ width: 130 }} value={logResult} onChange={(e) => { setLogResult(e.target.value); setLogPage(1); }}>
                <option value="all">全部結果</option>
                <option value="Victory">Victory</option>
                <option value="Defeat">Defeat</option>
              </select>
              <select className="select" style={{ width: 190 }} value={logGuild} onChange={(e) => { setLogGuild(e.target.value); setLogPage(1); }}>
                <option value="">全部對手公會</option>
                {guildOptions.map((guild) => <option key={guild} value={guild}>{guild}</option>)}
              </select>
              <div style={{ position: "relative", flex: "1 1 220px", minWidth: 180 }}>
                <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: "var(--muted-2)" }} />
                <input
                  className="input"
                  style={{ paddingLeft: 28 }}
                  placeholder="搜尋怪物 / 公會…"
                  value={logQuery}
                  onChange={(e) => { setLogQuery(e.target.value); setLogPage(1); }}
                />
              </div>
              <button type="button" className="btn btn-sm btn-ghost" onClick={resetLogFilters}>清除</button>
            </div>
          </div>

          <div className="table-scroll">
            <table className="table sg-log-table">
              <thead>
                <tr><th>賽季</th><th>日期</th><th>結果</th><th>對手公會</th><th>Nosna44 進攻隊</th><th>防守隊</th><th /></tr>
              </thead>
              <tbody>
                {logRows.map((battle) => (
                  <tr key={battle.battleId}>
                    <td className="mono tiny">{battle.season || "—"}</td>
                    <td className="tiny mono">{siegeShortDate(battle.date)}</td>
                    <td><span className={`sg-result ${battle.result === "Victory" ? "good" : "bad"}`}>{battle.result}</span></td>
                    <td className="tiny">{battle.defenseGuild || "—"}</td>
                    <td><SgTeam data={dataset} ids={battle.counter} size={24} names /></td>
                    <td><SgTeam data={dataset} ids={battle.defense} size={24} names /></td>
                    <td><button type="button" className="btn btn-sm btn-ghost" onClick={() => openDefense(siegeTeamKey(battle.defense))}>分析</button></td>
                  </tr>
                ))}
                {logRows.length === 0 && <tr><td colSpan={7}><div className="empty" style={{ padding: "24px 8px" }}>沒有符合條件的對戰。</div></td></tr>}
              </tbody>
            </table>
          </div>

          {logPages > 1 && (
            <div className="sg-pager">
              <span className="tiny dim">第 {logPageSafe} / {logPages} 頁</span>
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="btn btn-sm btn-ghost" disabled={logPageSafe <= 1} onClick={() => setLogPage(logPageSafe - 1)}>
                  <ChevronLeft size={14} /> 上一頁
                </button>
                <button type="button" className="btn btn-sm btn-ghost" disabled={logPageSafe >= logPages} onClick={() => setLogPage(logPageSafe + 1)}>
                  下一頁 <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
        </>
      )}

      {tab === "data" && (
        <div className="grid split-2" style={{ gap: 12 }}>
          <div className="card card-pad">
            <div className="card-title">資料來源</div>
            <div className="kv"><span className="k">分析對象</span><b>{dataset.player}</b></div>
            <div className="kv"><span className="k">公會</span><b>{dataset.guild || "—"}</b></div>
            <div className="kv"><span className="k">賽季</span><b>{dataset.season || "—"}</b></div>
            <div className="kv"><span className="k">賽季清單</span><b>{dataset.seasons?.length ? dataset.seasons.join(" · ") : "—"}</b></div>
            <div className="kv"><span className="k">來源</span><b>{dataset.source}</b></div>
            <div className="kv"><span className="k">日期範圍</span><b>{dataset.dateMin} ~ {dataset.dateMax}</b></div>
            <div className="kv"><span className="k">收集時間</span><b>{new Date(dataset.collectedAt).toLocaleString("zh-TW")}</b></div>
            <div className="kv"><span className="k">對戰數 / 怪物數</span><b>{dataset.battles.length} / {Object.keys(dataset.monsters).length}</b></div>
            {dataset.reportUrl && (
              <div className="tiny dim" style={{ marginTop: 8, wordBreak: "break-all" }}>
                原始報告：<a href={dataset.reportUrl} target="_blank" rel="noreferrer">{dataset.reportUrl}</a>
              </div>
            )}
            <div className="row wrap" style={{ gap: 7, marginTop: 12 }}>
              <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}><Upload size={13} /> 匯入 HTML / JSON</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={downloadJson}><Download size={13} /> 下載目前資料</button>
              {source === "imported" && <button type="button" className="btn btn-sm btn-ghost" onClick={resetBuiltin}><RefreshCw size={12} /> 用回內建快照</button>}
            </div>
          </div>

          <div className="card card-pad">
            <div className="card-title">更新方式</div>
            <ol className="tiny" style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.9, color: "var(--muted)" }}>
              <li>SWGT → 3MDC → Battle Logs。</li>
              <li>Player 選 <b>Nosna44</b>，Season 選要收集的賽季（例如 <b>Season 22 - Complete</b>），Battle Type 選 <b>Siege</b>，Max 選 <b>1,000</b>。</li>
              <li>按 Run Report，將報告頁另存成 HTML（Ctrl + S），或使用此頁下載的 JSON。</li>
              <li>回到這裡按「匯入更新」，選擇 HTML 或 JSON；同一位玩家的資料會以 battleId 合併，重複匯入不會產生重複紀錄。</li>
            </ol>
            <div className="tiny dim" style={{ marginTop: 10 }}>
              內建快照已包含 <b>Season 13–22</b>（2023/07–2026/10）；要補新賽季時，重複以上步驟並匯入即可。匯入資料只會存在這台裝置的瀏覽器。
            </div>
          </div>
        </div>
      )}
      {customPickerIndex !== null && (
        <MonsterPickerModal
          title={`選擇第 ${customPickerIndex + 1} 隻魔靈`}
          width={980}
          entries={customPickerEntries}
          onPick={(entry) => {
            pickCustom(customPickerIndex, entry.monster.id);
            setCustomPickerIndex(null);
          }}
          onClose={() => setCustomPickerIndex(null)}
          footerLeft="速度隊長會自動排到最左邊"
          emptyText="找不到符合條件的魔靈"
        />
      )}
    </>
  );
}
