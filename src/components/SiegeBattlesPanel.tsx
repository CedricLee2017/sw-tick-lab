/** 公會 → 據點戰：自動上傳 / 手動匯入據點戰進攻紀錄 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  KeyRound,
  RefreshCw,
  Search,
  Swords,
  Trash2,
  Upload,
} from "lucide-react";
import { MONSTER_MAP, useStore } from "../store";
import { api, ApiError, type ApiSiegeToken } from "../lib/api";
import { useAuth } from "../lib/auth";
import { mergeSiegeBattles, siegeRankLabel, type SiegeBattle } from "../lib/siegeBattleCore";
import {
  clearLocalSiegeBattles,
  loadLocalSiegeBattles,
  parseSiegeJson,
  readSiegeLogFile,
  saveLocalSiegeBattles,
} from "../lib/siegeBattles";
import { Modal, MonsterIcon } from "./ui";

const PAGE_SIZE = 60;

function monsterName(id: number): string {
  return MONSTER_MAP.get(id)?.name ?? `#${id}`;
}

function teamKey(ids: number[]): string {
  return [...ids].sort((a, b) => a - b).join("-");
}

function dateText(time: number): string {
  if (!time) return "—";
  return new Date(time * 1000).toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function winRate(wins: number, battles: number): number {
  return battles > 0 ? Math.round((wins / battles) * 1000) / 10 : 0;
}

interface TeamStat {
  key: string;
  team: number[];
  battles: number;
  wins: number;
  losses: number;
  wr: number;
  lastTime: number;
}

function groupTeams(battles: SiegeBattle[], side: "defense" | "counter"): TeamStat[] {
  const map = new Map<string, TeamStat>();
  for (const battle of battles) {
    const team = battle[side];
    const key = teamKey(team);
    let stat = map.get(key);
    if (!stat) {
      stat = { key, team: [...team].sort((a, b) => a - b), battles: 0, wins: 0, losses: 0, wr: 0, lastTime: 0 };
      map.set(key, stat);
    }
    stat.battles++;
    if (battle.win) stat.wins++;
    stat.losses = stat.battles - stat.wins;
    stat.wr = winRate(stat.wins, stat.battles);
    stat.lastTime = Math.max(stat.lastTime, battle.time || 0);
  }
  return [...map.values()].sort((a, b) => b.battles - a.battles || b.wr - a.wr || b.lastTime - a.lastTime);
}

function TeamIcons({ ids, size = 28 }: { ids: number[]; size?: number }) {
  return (
    <span className="siege-team-icons">
      {ids.map((id) => (
        <span key={id} title={monsterName(id)}>
          <MonsterIcon id={id} size={size} />
        </span>
      ))}
    </span>
  );
}

function TeamStatCard({
  title,
  rows,
  tone,
  empty,
}: {
  title: string;
  rows: TeamStat[];
  tone: "good" | "bad";
  empty: string;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">{title}</div>
          <div className="card-sub">依場次排序；勝率以這份紀錄的進攻方角度計算。</div>
        </div>
      </div>
      <div className="card-pad col" style={{ gap: 6 }}>
        {rows.length === 0 ? (
          <div className="empty tiny">{empty}</div>
        ) : (
          rows.slice(0, 12).map((row, index) => (
            <div key={row.key} className="siege-team-row">
              <span className="siege-team-rank">{index + 1}</span>
              <TeamIcons ids={row.team} size={26} />
              <span className="siege-team-record">
                <b style={{ color: tone === "good" ? "var(--green)" : "var(--gold)" }}>{row.wr}%</b>
                <span className="tiny dim">
                  {row.wins}W / {row.losses}L · {row.battles} 場
                </span>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function SiegeBattlesPanel() {
  const account = useStore((s) => s.account);
  const notify = useStore((s) => s.notify);
  const user = useAuth((s) => s.user);

  const [scope, setScope] = useState<"mine" | "guild">("mine");
  const [remote, setRemote] = useState<SiegeBattle[]>([]);
  const [local, setLocal] = useState<SiegeBattle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ name: string; pct: number; found: number } | null>(null);
  const [drag, setDrag] = useState(false);

  const [token, setToken] = useState<ApiSiegeToken | null>(null);
  const [freshToken, setFreshToken] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [copied, setCopied] = useState("");

  const [q, setQ] = useState("");
  const [result, setResult] = useState<"all" | "win" | "loss">("all");
  const [type, setType] = useState("all");
  const [guild, setGuild] = useState("all");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<SiegeBattle | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const fetchRemote = useCallback(async () => {
    if (!user) {
      setRemote([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.siegeBattles(scope, scope === "guild" ? account?.guild ?? "" : "", 500);
      setRemote(res.battles);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "讀取雲端據點戰紀錄失敗");
    } finally {
      setLoading(false);
    }
  }, [user, scope, account?.guild]);

  useEffect(() => {
    void fetchRemote();
  }, [fetchRemote]);

  useEffect(() => {
    void loadLocalSiegeBattles().then(setLocal);
  }, []);

  useEffect(() => {
    if (!user) {
      setToken(null);
      setFreshToken("");
      return;
    }
    void api
      .siegeToken()
      .then((res) => setToken(res.token))
      .catch(() => setToken(null));
  }, [user]);

  const allBattles = useMemo(() => mergeSiegeBattles(remote, local), [remote, local]);

  const stats = useMemo(() => {
    const wins = allBattles.filter((battle) => battle.win).length;
    const losses = allBattles.length - wins;
    const counterTeams = groupTeams(allBattles, "counter");
    const defenseTeams = groupTeams(allBattles, "defense");
    const guilds = new Set(allBattles.map((battle) => battle.guildName).filter(Boolean));
    const last = allBattles.reduce((max, battle) => Math.max(max, battle.time || 0), 0);
    return { wins, losses, wr: winRate(wins, allBattles.length), counterTeams, defenseTeams, guilds: guilds.size, last };
  }, [allBattles]);

  const typeOptions = useMemo(
    () => [...new Set(allBattles.map((battle) => battle.battleType).filter(Boolean))].sort(),
    [allBattles],
  );
  const guildOptions = useMemo(
    () => [...new Set(allBattles.map((battle) => battle.oppGuildName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [allBattles],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return allBattles.filter((battle) => {
      if (result === "win" && !battle.win) return false;
      if (result === "loss" && battle.win) return false;
      if (type !== "all" && battle.battleType !== type) return false;
      if (guild !== "all" && battle.oppGuildName !== guild) return false;
      if (!term) return true;
      const haystack = [
        battle.wizardName,
        battle.oppWizardName,
        battle.guildName,
        battle.oppGuildName,
        ...battle.counter.map(monsterName),
        ...battle.defense.map(monsterName),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [allBattles, q, result, type, guild]);

  useEffect(() => {
    setPage(0);
  }, [q, result, type, guild, scope]);

  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const importFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setImporting(true);
    setError(null);
    const found: SiegeBattle[] = [];
    try {
      for (const file of [...files]) {
        if (/\.json$/i.test(file.name)) {
          const text = await file.text();
          found.push(...parseSiegeJson(text));
        } else {
          const res = await readSiegeLogFile(file, (read, total, count) => {
            setProgress({
              name: file.name,
              pct: total ? Math.min(100, Math.round((read / total) * 100)) : 0,
              found: count,
            });
          });
          found.push(...res.battles);
        }
      }
    } catch {
      notify("讀取檔案失敗", "err");
    } finally {
      setImporting(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }

    const merged = mergeSiegeBattles(found);
    if (merged.length === 0) {
      notify("沒有找到可匯入的據點戰紀錄（需要三隻防守＋勝負）", "err");
      return;
    }

    const nextLocal = mergeSiegeBattles(local, merged);
    await saveLocalSiegeBattles(nextLocal);
    setLocal(nextLocal);

    let uploaded = 0;
    if (user) {
      try {
        const res = await api.uploadSiegeBattles(merged);
        uploaded = res.inserted;
        await fetchRemote();
      } catch (err) {
        notify(`已存到本機，但雲端上傳失敗：${err instanceof ApiError ? err.message : "請稍後再試"}`, "err");
      }
    }
    notify(`已匯入 ${merged.length} 場據點戰紀錄${uploaded ? `，雲端新增 ${uploaded} 場` : ""}`);
  };

  const createToken = async () => {
    setTokenBusy(true);
    try {
      const res = await api.createSiegeToken();
      setFreshToken(res.token);
      setToken({ prefix: res.prefix, createdAt: res.createdAt, lastUsedAt: null });
      notify("已產生上傳金鑰；金鑰只會顯示這一次，請立刻複製到 SWEX 外掛設定");
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "產生金鑰失敗", "err");
    } finally {
      setTokenBusy(false);
    }
  };

  const revokeToken = async () => {
    if (!confirm("要撤銷目前的據點戰上傳金鑰嗎？SWEX 外掛會停止上傳。")) return;
    setTokenBusy(true);
    try {
      await api.revokeSiegeToken();
      setToken(null);
      setFreshToken("");
      notify("已撤銷上傳金鑰");
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "撤銷金鑰失敗", "err");
    } finally {
      setTokenBusy(false);
    }
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1600);
      notify("已複製");
    } catch {
      notify("瀏覽器無法自動複製，請手動選取文字", "err");
    }
  };

  const clearLocal = async () => {
    if (!confirm("要清除這台裝置匯入的據點戰紀錄嗎？雲端紀錄不受影響。")) return;
    await clearLocalSiegeBattles();
    setLocal([]);
    notify("已清除本機據點戰紀錄");
  };

  const pluginUrl = useMemo(() => new URL("plugins/swtick-siege.js", document.baseURI).href, []);
  const readmeUrl = useMemo(() => new URL("plugins/swtick-siege.README.txt", document.baseURI).href, []);
  const licenseUrl = useMemo(() => new URL("plugins/swtick-siege.LICENSE.txt", document.baseURI).href, []);
  const siteUrl = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card">
        <div className="card-head">
          <div style={{ minWidth: 0 }}>
            <div className="card-title">
              <Swords size={14} className="gold" style={{ verticalAlign: -2, marginRight: 5 }} />
              據點戰紀錄
              <span className="dim tiny" style={{ fontWeight: 400, marginLeft: 6 }}>
                {allBattles.length} 場
              </span>
            </div>
            <div className="card-sub">
              自動收集據點進攻 / 防守紀錄；在遊戲內查看據點防守、攻擊隊伍或戰報時就會上傳，不一定要自己打完一場。
              也可以手動匯入 SWGT 3MDC JSON 或 full_log.txt。目前顯示{scope === "guild" ? "同公會" : "我的"}紀錄。
            </div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="tabs">
              <button type="button" className={`tab ${scope === "mine" ? "active" : ""}`} onClick={() => setScope("mine")}>
                我的紀錄
              </button>
              <button type="button" className={`tab ${scope === "guild" ? "active" : ""}`} onClick={() => setScope("guild")}>
                公會紀錄
              </button>
            </span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void fetchRemote()} disabled={loading}>
              <RefreshCw size={12} className={loading ? "spin" : ""} /> 重新整理
            </button>
          </div>
        </div>

        <div className="card-pad col" style={{ gap: 12 }}>
          {error && <div className="tiny" style={{ color: "var(--red)" }}>⚠ {error}</div>}
          {!user && (
            <div className="tiny dim">
              未登入：目前只會顯示這台裝置匯入的紀錄。登入後可產生上傳金鑰，讓 SWEX 外掛自動上傳到雲端。
            </div>
          )}

          <div className="grid g4">
            <div className="stat-tile">
              <div className="k">場次</div>
              <div className="v">{allBattles.length}</div>
              <div className="tiny dim">{stats.guilds} 個對手公會</div>
            </div>
            <div className="stat-tile">
              <div className="k">勝 / 敗</div>
              <div className="v">
                <span style={{ color: "var(--green)" }}>{stats.wins}</span>
                <span className="dim" style={{ fontSize: 14 }}> / </span>
                <span style={{ color: "var(--red)" }}>{stats.losses}</span>
              </div>
              <div className="tiny dim">勝率 {stats.wr}%</div>
            </div>
            <div className="stat-tile">
              <div className="k">進攻隊</div>
              <div className="v">{stats.counterTeams.length}</div>
              <div className="tiny dim">防守隊 {stats.defenseTeams.length}</div>
            </div>
            <div className="stat-tile">
              <div className="k">最近紀錄</div>
              <div className="v" style={{ fontSize: 16 }}>{stats.last ? dateText(stats.last) : "—"}</div>
              <div className="tiny dim">{local.length} 場在本機</div>
            </div>
          </div>

          <div className="siege-upload-box">
            <div className="row between wrap" style={{ gap: 8 }}>
              <div>
                <div className="card-title" style={{ marginBottom: 2 }}>
                  <KeyRound size={13} className="gold" style={{ verticalAlign: -2, marginRight: 4 }} />
                  自動上傳（SWEX 外掛）
                </div>
                <div className="tiny dim">
                  外掛只上傳據點戰進攻紀錄，不會上傳帳號存檔或符文庫。
                </div>
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                <a className="btn btn-sm btn-ghost" href={pluginUrl} download>
                  <Download size={12} /> 下載外掛
                </a>
                <a className="btn btn-sm btn-ghost" href={readmeUrl} target="_blank" rel="noreferrer">
                  安裝說明
                </a>
                <a className="btn btn-sm btn-ghost" href={licenseUrl} target="_blank" rel="noreferrer">
                  授權 / 致謝
                </a>
              </div>
            </div>

            {user ? (
              <>
                <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
                  {token ? (
                    <span className="chip gold">
                      已建立金鑰 · {token.prefix}…
                      {token.lastUsedAt ? ` · 最後使用 ${dateText(token.lastUsedAt)}` : " · 尚未使用"}
                    </span>
                  ) : (
                    <span className="chip muted">尚未建立上傳金鑰</span>
                  )}
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => void createToken()} disabled={tokenBusy}>
                    <KeyRound size={12} /> {token ? "重新產生金鑰" : "產生上傳金鑰"}
                  </button>
                  {token && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => void revokeToken()} disabled={tokenBusy}>
                      <Trash2 size={12} /> 撤銷
                    </button>
                  )}
                </div>
                {freshToken && (
                  <div className="siege-token-row">
                    <code className="mono">{freshToken}</code>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => void copy(freshToken, "token")}>
                      {copied === "token" ? <Check size={12} /> : <Copy size={12} />}
                      {copied === "token" ? "已複製" : "複製"}
                    </button>
                  </div>
                )}
                <div className="tiny dim" style={{ marginTop: 8, lineHeight: 1.75 }}>
                  1. 下載外掛，放到 <span className="mono">SWEX Files Path/plugins/swtick-siege.js</span>，重開 SWEX 並啟用。
                  <br />
                  2. 外掛設定的網站網址填 <span className="mono">{siteUrl}</span>，貼上剛剛產生的 <span className="mono">swt_…</span> 金鑰。
                  <br />
                  3. 在遊戲內查看據點防守、攻擊隊伍或戰報，外掛會自動上傳；回到這頁按「重新整理」。
                </div>
              </>
            ) : (
              <div className="tiny dim" style={{ marginTop: 8 }}>
                登入後可在這裡產生上傳金鑰。未登入時仍可用下面的手動匯入。
              </div>
            )}
          </div>

          <div
            className={`dropzone ${drag ? "hover" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void importFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            style={{ cursor: "pointer", padding: "20px 16px" }}
          >
            <div className="dz-icon"><Upload size={22} /></div>
            <div style={{ fontWeight: 700 }}>
              {importing
                ? progress
                  ? `讀取 ${progress.name}… ${progress.pct}%（找到 ${progress.found} 場）`
                  : "解析中…"
                : "拖放 3MDC JSON / full_log.txt 到這裡"}
            </div>
            <div className="tiny dim">
              支援 SWGT 外掛存下來的 <span className="mono">3MDC-*.json</span>、單場 3MDC 物件或 SWEX full_log.txt。
              {user ? " 登入狀態下會同時上傳到雲端。" : " 未登入只存這台裝置。"}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".json,.txt,.log,application/json,text/plain"
              multiple
              hidden
              onChange={(e) => void importFiles(e.target.files)}
            />
          </div>

          <div className="row between wrap" style={{ gap: 8 }}>
            <div className="row wrap" style={{ gap: 6 }}>
              <div style={{ position: "relative" }}>
                <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: "var(--muted-2)" }} />
                <input
                  className="input"
                  style={{ width: 210, paddingLeft: 28 }}
                  placeholder="搜尋玩家 / 公會 / 魔靈…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <select className="select" style={{ width: 100 }} value={result} onChange={(e) => setResult(e.target.value as typeof result)}>
                <option value="all">全部結果</option>
                <option value="win">勝利</option>
                <option value="loss">失敗</option>
              </select>
              <select className="select" style={{ width: 130 }} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="all">全部類型</option>
                {typeOptions.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
              <select className="select" style={{ width: 160 }} value={guild} onChange={(e) => setGuild(e.target.value)}>
                <option value="all">全部對手公會</option>
                {guildOptions.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <span className="tiny dim">{filtered.length} 場符合</span>
              {local.length > 0 && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => void clearLocal()}>
                  <Trash2 size={11} /> 清除本機
                </button>
              )}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="empty" style={{ padding: "28px 16px" }}>
              還沒有據點戰紀錄。安裝外掛自動上傳，或把 3MDC JSON / full_log.txt 拖進來。
            </div>
          ) : (
            <>
              <div className="table-scroll">
                <table className="table siege-battle-table">
                  <thead>
                    <tr>
                      <th>時間</th>
                      <th>結果</th>
                      <th>進攻</th>
                      <th>對手</th>
                      <th>防守隊</th>
                      <th>進攻隊</th>
                      <th>類型 / 牌位</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((battle) => (
                      <tr key={battle.uid}>
                        <td className="tiny dim mono">{dateText(battle.time)}</td>
                        <td>
                          <span className={`chip ${battle.win ? "green" : "red"}`}>{battle.win ? "勝利" : "失敗"}</span>
                        </td>
                        <td>
                          <b>{battle.wizardName || `#${battle.wizardId}`}</b>
                          <div className="tiny dim">{battle.guildName || "—"}</div>
                        </td>
                        <td>
                          <b>{battle.oppWizardName || "—"}</b>
                          <div className="tiny dim">{battle.oppGuildName || "—"}</div>
                        </td>
                        <td><TeamIcons ids={battle.defense} size={26} /></td>
                        <td><TeamIcons ids={battle.counter} size={26} /></td>
                        <td className="tiny">
                          <div>{battle.battleType}</div>
                          <div className="dim">{siegeRankLabel(battle.rank)}</div>
                        </td>
                        <td>
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDetail(battle)}>
                            詳情
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="row between wrap" style={{ gap: 8 }}>
                <span className="tiny dim">
                  第 {page + 1} / {pageCount} 頁 · 共 {filtered.length} 場
                </span>
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="btn btn-sm btn-ghost" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                    上一頁
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>
                    下一頁
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        <TeamStatCard
          title="常用進攻隊"
          rows={stats.counterTeams}
          tone="good"
          empty="還沒有足夠的進攻隊紀錄。"
        />
        <TeamStatCard
          title="常遇到的防守隊"
          rows={stats.defenseTeams}
          tone="bad"
          empty="還沒有足夠的防守隊紀錄。"
        />
      </div>

      {detail && (
        <Modal title={`據點戰紀錄 · ${detail.wizardName || `#${detail.wizardId}`}`} onClose={() => setDetail(null)} width={640}>
          <div className="col" style={{ gap: 12 }}>
            <div className="row between wrap" style={{ gap: 8 }}>
              <span className={`chip ${detail.win ? "green" : "red"}`}>{detail.win ? "勝利" : "失敗"}</span>
              <span className="tiny dim">{dateText(detail.time)} · {detail.battleType} · {siegeRankLabel(detail.rank)}</span>
            </div>
            <div className="siege-detail-row">
              <div>
                <div className="tiny dim" style={{ marginBottom: 4 }}>進攻方</div>
                <b>{detail.wizardName || `#${detail.wizardId}`}</b>
                <div className="tiny dim">{detail.guildName || "—"}</div>
                <div style={{ marginTop: 6 }}><TeamIcons ids={detail.counter} size={34} /></div>
              </div>
              <div style={{ flex: 1, textAlign: "right" }}>
                <div className="tiny dim" style={{ marginBottom: 4 }}>防守方</div>
                <b>{detail.oppWizardName || "—"}</b>
                <div className="tiny dim">{detail.oppGuildName || "—"}</div>
                <div style={{ marginTop: 6, display: "flex", justifyContent: "flex-end" }}><TeamIcons ids={detail.defense} size={34} /></div>
              </div>
            </div>
            <div className="tiny dim">
              魔靈：{detail.counter.map(monsterName).join(" / ")} vs {detail.defense.map(monsterName).join(" / ")}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
