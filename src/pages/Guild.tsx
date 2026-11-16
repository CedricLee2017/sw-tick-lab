/** 公會：匯入隊友的公會資料，比較成員的符文與神器 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, RefreshCw, Search, Trash2, Upload, Users } from "lucide-react";
import { MONSTER_MAP, useStore } from "../store";
import { ELEMENTS, SET_BY_ID } from "../lib/constants";
import {
  clearGuildData,
  compareGroups,
  guildMemberSummaries,
  guildUnitRows,
  guildUnitStats,
  loadGuildData,
  parseGuildData,
  readGuildLogFile,
  readGuildLogText,
  saveGuildData,
  type GuildBlock,
  type GuildDeck,
  type GuildMember,
  type GuildUnit,
} from "../lib/guild";
import { artifactSubText } from "../lib/artifacts";
import { effectiveSetCounts, setSummary } from "../lib/stats";
import { ArtifactCard, EmptyState, Modal, MonsterIcon, MonsterPanel, RuneBoard, RuneCard, TickBadge, fmt } from "../components/ui";

const SOURCE_LABEL: Record<string, string> = { test: "公會測試隊伍", siege: "據點戰防守" };

function monsterName(master: number): string {
  return MONSTER_MAP.get(master)?.name ?? `#${master}`;
}

function setText(unit: GuildUnit): string {
  if (unit.runes.length === 0) return "無符文";
  const counts = unit.runes.reduce((m, r) => ({ ...m, [r.set]: (m[r.set] ?? 0) + 1 }), {} as Record<number, number>);
  return setSummary(effectiveSetCounts(counts));
}

function artifactText(unit: GuildUnit): string {
  const list = unit.artifacts.flatMap((a) => a.subs.map(artifactSubText));
  if (list.length <= 3) return list.join(" · ");
  return `${list.slice(0, 3).join(" · ")} +${list.length - 3}`;
}

function artifactFullText(unit: GuildUnit): string {
  return unit.artifacts.flatMap((a) => a.subs.map(artifactSubText)).join(" · ");
}

/** 魔靈卡（成員 / 比較表共用） */
function UnitTile({ unit, onClick }: { unit: GuildUnit; onClick: () => void }) {
  const stats = guildUnitStats(unit);
  return (
    <button
      type="button"
      className="rta-row"
      style={{ padding: "6px 8px", gap: 8 }}
      onClick={onClick}
      title="查看符文與神器"
    >
      <MonsterIcon id={unit.master} size={34} />
      <span className="rta-main">
        <span className="row" style={{ gap: 6 }}>
          <b style={{ fontSize: 12.5 }}>{monsterName(unit.master)}</b>
          <span className="tiny dim">{unit.stars}★</span>
        </span>
        <span className="tiny dim" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {setText(unit)}
        </span>
      </span>
      <span className="row" style={{ gap: 4 }}>
        {stats && <b className="mono gold" style={{ fontSize: 13 }}>{stats.spd}</b>}
        {stats && <TickBadge spd={stats.spd} rta />}
      </span>
    </button>
  );
}

/** 單隻魔靈的符文 / 神器明細 */
function UnitDetail({ unit, owner, onBack }: { unit: GuildUnit; owner: string; onBack?: () => void }) {
  const monster = MONSTER_MAP.get(unit.master);
  const stats = guildUnitStats(unit);
  if (!monster || !stats) return <div className="empty tiny">找不到這隻魔靈的資料</div>;
  return (
    <>
      <div className="row between wrap" style={{ gap: 8, marginBottom: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          {onBack && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>
              <ArrowLeft size={12} /> 返回
            </button>
          )}
          <div className="card-title" style={{ marginBottom: 0 }}>
            {monsterName(unit.master)} <span className="dim tiny">{owner} · {SOURCE_LABEL[unit.source]} #{unit.deckId}</span>
          </div>
        </div>
        <TickBadge spd={stats.spd} rta />
      </div>
      <MonsterPanel
        monster={monster}
        base={{ hp: monster.hp, atk: monster.atk, def: monster.def, spd: monster.spd, cr: monster.cr, cd: monster.cd, res: monster.res, acc: monster.acc }}
        stats={stats}
        stars={unit.stars}
        level={unit.level}
        artifacts={unit.artifacts}
        name={owner}
      />
      <div className="row between" style={{ margin: "14px 0 6px" }}>
        <div className="card-title">符文</div>
        <span className="tiny dim">{unit.runes.length}/6 · {setText(unit)}</span>
      </div>
      {unit.runes.length === 0 ? (
        <div className="empty tiny">沒有符文資料</div>
      ) : (
        <RuneBoard runes={unit.runes} renderRune={(r) => <RuneCard rune={r} owner={owner} />} />
      )}
      <div className="row between" style={{ margin: "14px 0 6px" }}>
        <div className="card-title">神器</div>
        <span className="tiny dim">{unit.artifacts.length} / 2</span>
      </div>
      {unit.artifacts.length === 0 ? (
        <div className="empty tiny">沒有神器資料</div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }}>
          {unit.artifacts.map((a) => <ArtifactCard key={a.id} artifact={a} owner={owner} />)}
        </div>
      )}
    </>
  );
}

export default function GuildPage() {
  const account = useStore((s) => s.account);
  const notify = useStore((s) => s.notify);
  const [data, setData] = useState<ReturnType<typeof parseGuildData>["data"] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ name: string; pct: number; found: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const [tab, setTab] = useState<"members" | "compare">("members");
  const [q, setQ] = useState("");
  const [memberOpen, setMemberOpen] = useState<GuildMember | null>(null);
  const [memberUnit, setMemberUnit] = useState<GuildUnit | null>(null);
  const [compareMaster, setCompareMaster] = useState(0);
  const [compareUnit, setCompareUnit] = useState<GuildUnit | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadGuildData().then((d) => {
      if (d) setData(d);
    });
  }, []);

  const rows = useMemo(() => guildUnitRows(data), [data]);
  const summaries = useMemo(() => guildMemberSummaries(data, rows), [data, rows]);
  const groups = useMemo(() => compareGroups(rows), [rows]);
  const group = groups.find((g) => g.master === compareMaster) ?? groups[0];

  const totals = useMemo(() => {
    const decks = data?.members.reduce((n, m) => n + m.decks.length, 0) ?? 0;
    const artifacts = rows.reduce((n, r) => n + r.unit.artifacts.length, 0);
    const avgEff = rows.length ? rows.reduce((n, r) => n + r.eff, 0) / rows.length : 0;
    return { members: data?.members.length ?? 0, decks, units: rows.length, artifacts, avgEff };
  }, [data, rows]);

  const importFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      // .txt / .log 直接當 SWEX FullLogger 串流解析；其他檔案先試 JSON，內容像 log 也吃得下
      const texts: { name: string; text: string }[] = [];
      const blocks: GuildBlock[] = [];
      for (const file of [...files]) {
        if (/\.(txt|log)$/i.test(file.name)) {
          const res = await readGuildLogFile(file, (read, total, found) => {
            setProgress({ name: file.name, pct: total ? Math.min(100, Math.round((read / total) * 100)) : 0, found });
          });
          blocks.push(...res.blocks);
        } else {
          const text = await file.text();
          if (text.includes("API Command:")) blocks.push(...readGuildLogText(text).blocks);
          else texts.push({ name: file.name, text });
        }
      }
      const parsed = parseGuildData(texts, Date.now(), blocks);
      setWarnings(parsed.warnings);
      if (parsed.data.members.length > 0) {
        await saveGuildData(parsed.data);
        setData(parsed.data);
        setCompareMaster(0);
        notify(`已匯入 ${parsed.data.members.length} 位成員的公會資料`);
      } else {
        notify("沒有解析到公會資料", "err");
      }
    } catch {
      notify("讀取檔案失敗", "err");
    } finally {
      setBusy(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const clear = async () => {
    if (!confirm("要清除已匯入的公會資料嗎？（只影響這台裝置）")) return;
    await clearGuildData();
    setData(null);
    setWarnings([]);
    setMemberOpen(null);
    setMemberUnit(null);
    setCompareUnit(null);
  };

  const filteredSummaries = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return summaries;
    return summaries.filter((s) => s.member.name.toLowerCase().includes(term) || String(s.member.wizardId).includes(term));
  }, [summaries, q]);

  const memberSummary = memberOpen ? summaries.find((s) => s.member.wizardId === memberOpen.wizardId) : null;

  if (!data || data.members.length === 0) {
    return (
      <>
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-head">
            <div>
              <div className="card-title">
                公會 <span className="dim tiny" style={{ fontWeight: 400 }}>匯入隊友的符文與神器資料</span>
              </div>
              <div className="card-sub">
                匯入 SWEX FullLogger 的「公會測試隊伍」或「據點戰隊友防守」資料，就能比較公會成員的符文與神器。
              </div>
            </div>
          </div>
          <div className="card-pad col" style={{ gap: 10 }}>
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
              style={{ cursor: "pointer", padding: "28px 18px" }}
            >
              <div className="dz-icon"><Upload size={26} /></div>
              <div style={{ fontWeight: 700 }}>
                {busy
                  ? progress
                    ? `讀取 ${progress.name}… ${progress.pct}%（找到 ${progress.found} 筆公會資料）`
                    : "解析中…"
                  : "拖放 full_log.txt（或 guild.json / 公會 JSON）到這裡"}
              </div>
              <div className="tiny dim">可以直接選 SWEX 的 full_log.txt，會邊讀邊挑出公會資料；也可以多選拆分後的 JSON</div>
              <input ref={inputRef} type="file" accept=".json,.txt,.log,application/json,text/plain" multiple hidden onChange={(e) => void importFiles(e.target.files)} />
            </div>
            {warnings.length > 0 && (
              <div className="col" style={{ gap: 4 }}>
                {warnings.map((w, i) => (
                  <div key={i} className="tiny" style={{ color: "var(--gold)" }}>⚠ {w}</div>
                ))}
              </div>
            )}
            <div className="tiny dim" style={{ lineHeight: 1.8 }}>
              資料怎麼來：用 SWEX 匯出 <span className="mono">full_log.txt</span>（FullLogger）直接拖進來，或在遊戲裡開一下「公會測試隊伍 / 據點戰隊友防守」讓 SWEX 記錄到{" "}
              <span className="mono">GetGuildTestDeckDetail</span> / <span className="mono">GetGuildSiegeDefenseDeckListAlly</span>。
              也可以先跑 <span className="mono">npm run data:guild -- --log "…\full_log.txt"</span> 產生 guild.json 再匯入。
              只有這兩種 API 含完整符文 / 神器；敵方防守只有魔靈資訊。資料只存在這台裝置的瀏覽器。
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 12 }}>
        <div>
          <div className="card-title row" style={{ gap: 7 }}>
            <Users size={15} className="gold" /> 公會
            {account?.guild && <span className="dim tiny">{account.guild}</span>}
          </div>
          <div className="card-sub">
            {totals.members} 位成員 · {totals.decks} 支隊伍 · {totals.units} 隻魔靈 · 資料 {new Date(data.importedAt).toLocaleString("zh-TW")}
          </div>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => inputRef.current?.click()} disabled={busy}>
            <RefreshCw size={12} /> {busy ? "解析中…" : "重新匯入"}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void clear()}>
            <Trash2 size={12} /> 清除
          </button>
          <input ref={inputRef} type="file" accept=".json,.txt,.log,application/json,text/plain" multiple hidden onChange={(e) => void importFiles(e.target.files)} />
        </div>
      </div>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="stat-tile">
          <div className="k">成員</div>
          <div className="v">{summaries.length}<span className="u">位</span></div>
          <div className="tiny dim">有隊伍資料 {summaries.filter((s) => s.units > 0).length} 位</div>
        </div>
        <div className="stat-tile"><div className="k">魔靈</div><div className="v">{totals.units}<span className="u">隻</span></div><div className="tiny dim">{totals.decks} 支隊伍</div></div>
        <div className="stat-tile"><div className="k">神器</div><div className="v">{totals.artifacts}<span className="u">件</span></div></div>
        <div className="stat-tile"><div className="k">平均符文效率</div><div className="v">{totals.avgEff.toFixed(1)}<span className="u">%</span></div></div>
      </div>

      {warnings.length > 0 && (
        <div className="card card-pad col" style={{ gap: 4, marginBottom: 12 }}>
          {warnings.map((w, i) => (
            <div key={i} className="tiny" style={{ color: "var(--gold)" }}>⚠ {w}</div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div className="tabs">
            <button type="button" className={`tab ${tab === "members" ? "active" : ""}`} onClick={() => setTab("members")}>
              成員一覽
            </button>
            <button type="button" className={`tab ${tab === "compare" ? "active" : ""}`} onClick={() => setTab("compare")}>
              同魔靈比較
            </button>
          </div>
          {tab === "members" ? (
            <div style={{ position: "relative" }}>
              <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: "var(--muted-2)" }} />
              <input className="input" style={{ width: 210, paddingLeft: 28 }} placeholder="搜尋成員…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          ) : (
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="tiny dim">選魔靈</span>
              <select
                className="select"
                style={{ width: 220 }}
                value={group?.master ?? 0}
                onChange={(e) => setCompareMaster(Number(e.target.value))}
              >
                {groups.map((g) => (
                  <option key={g.master} value={g.master}>
                    {monsterName(g.master)}（{new Set(g.rows.map((r) => r.member.wizardId)).size} 人）
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {tab === "members" ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>成員</th>
                  <th className="num">隊伍</th>
                  <th className="num">魔靈</th>
                  <th className="num">神器</th>
                  <th className="num">最快速度</th>
                  <th className="num">平均效率</th>
                  <th>最後登入</th>
                </tr>
              </thead>
              <tbody>
                {filteredSummaries.map((s) => {
                  const hasDecks = s.decks > 0;
                  const r = s.member.roster;
                  return (
                    <tr
                      key={s.member.wizardId}
                      style={{ cursor: hasDecks ? "pointer" : "default", opacity: hasDecks ? 1 : 0.72 }}
                      onClick={() => {
                        if (!hasDecks) return;
                        setMemberOpen(s.member);
                        setMemberUnit(null);
                      }}
                      title={hasDecks ? "查看隊伍與符文" : "只有公會名單資料，沒有隊伍（符文）資料"}
                    >
                      <td>
                        <b>{s.member.name}</b>
                        {account?.wizardId === s.member.wizardId && <span className="chip gold" style={{ marginLeft: 6 }}>你</span>}
                        {r?.grade === 1 && <span className="chip muted" style={{ marginLeft: 6 }}>會長</span>}
                        <div className="tiny dim mono">
                          #{s.member.wizardId}
                          {r?.level ? ` · Lv.${r.level}` : ""}
                        </div>
                      </td>
                      <td className="num">{s.decks || "—"}</td>
                      <td className="num">{s.units || "—"}</td>
                      <td className="num">{s.artifacts || "—"}</td>
                      <td className="num">{s.fastest || "—"}</td>
                      <td className="num">{s.units ? `${s.avgEff.toFixed(1)}%` : "—"}</td>
                      <td className="tiny dim">
                        {r?.lastLogin ? new Date(r.lastLogin * 1000).toLocaleDateString("zh-TW") : "—"}
                      </td>
                    </tr>
                  );
                })}
                {filteredSummaries.length === 0 && (
                  <tr><td colSpan={7} className="tiny dim">沒有符合的成員</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ) : groups.length === 0 ? (
          <div className="empty" style={{ padding: "26px 16px" }}>
            目前沒有「兩位以上成員都有」的魔靈可以比較；多匯入幾位成員的隊伍資料就會出現。
          </div>
        ) : group ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>成員</th>
                  <th>套裝</th>
                  <th className="num">速度</th>
                  <th className="num">HP</th>
                  <th className="num">DEF</th>
                  <th className="num">暴率</th>
                  <th className="num">暴傷</th>
                  <th className="num">抵抗</th>
                  <th className="num">命中</th>
                  <th>神器</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...group.rows]
                  .sort((a, b) => (b.stats?.spd ?? 0) - (a.stats?.spd ?? 0))
                  .map((row) => (
                    <tr key={row.unit.key}>
                      <td>
                        <b>{row.member.name}</b>
                        {account?.wizardId === row.member.wizardId && <span className="chip gold" style={{ marginLeft: 6 }}>你</span>}
                        <div className="tiny dim">{SOURCE_LABEL[row.unit.source]} #{row.unit.deckId}</div>
                      </td>
                      <td>{setText(row.unit)}</td>
                      <td className="num gold"><b>{row.stats?.spd ?? "—"}</b></td>
                      <td className="num">{row.stats ? fmt(row.stats.hp) : "—"}</td>
                      <td className="num">{row.stats ? fmt(row.stats.def) : "—"}</td>
                      <td className="num">{row.stats ? `${row.stats.cr}%` : "—"}</td>
                      <td className="num">{row.stats ? `${row.stats.cd}%` : "—"}</td>
                      <td className="num">{row.stats ? `${row.stats.res}%` : "—"}</td>
                      <td className="num">{row.stats ? `${row.stats.acc}%` : "—"}</td>
                      <td className="tiny" style={{ maxWidth: 260 }}>
                        <span
                          style={{ display: "inline-block", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          title={artifactFullText(row.unit) || "沒有神器"}
                        >
                          {row.unit.artifacts.length === 0 ? "—" : artifactText(row.unit)}
                        </span>
                      </td>
                      <td>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCompareUnit(row.unit)}>
                          符文
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {memberOpen && memberSummary && (
        <Modal
          title={memberUnit ? `${monsterName(memberUnit.master)} · ${memberOpen.name}` : `${memberOpen.name} · 公會資料`}
          onClose={() => {
            setMemberOpen(null);
            setMemberUnit(null);
          }}
          width={880}
        >
          {memberUnit ? (
            <UnitDetail unit={memberUnit} owner={memberOpen.name} onBack={() => setMemberUnit(null)} />
          ) : (
            <div className="col" style={{ gap: 14 }}>
              {memberOpen.decks.map((deck: GuildDeck) => (
                <div key={`${deck.source}:${deck.id}`}>
                  <div className="row between wrap" style={{ gap: 8, marginBottom: 6 }}>
                    <div className="card-title" style={{ marginBottom: 0 }}>
                      {SOURCE_LABEL[deck.source]} <span className="dim tiny">#{deck.id}</span>
                    </div>
                    <span className="tiny dim">{deck.desc ?? ""}</span>
                  </div>
                  <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
                    {deck.units
                      .slice()
                      .sort((a, b) => (guildUnitStats(b)?.spd ?? 0) - (guildUnitStats(a)?.spd ?? 0))
                      .map((unit) => (
                        <UnitTile key={unit.key} unit={unit} onClick={() => setMemberUnit(unit)} />
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {compareUnit && (
        <Modal
          title={`${monsterName(compareUnit.master)} · 符文與神器`}
          onClose={() => setCompareUnit(null)}
          width={880}
        >
          <UnitDetail
            unit={compareUnit}
            owner={summaries.find((s) => s.member.wizardId === compareUnit.wizardId)?.member.name ?? `#${compareUnit.wizardId}`}
          />
        </Modal>
      )}
    </>
  );
}
