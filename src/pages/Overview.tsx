import { useState } from "react";
import { Activity, ArrowUpRight, Gem, Sparkles, Star, Users } from "lucide-react";
import { useStore } from "../store";
import { useSummary, type TopEffKey } from "../lib/accountStats";
import { ELEMENTS, SET_BY_ID } from "../lib/constants";
import { fmt, setColor, statText } from "../components/ui";
import { EmptyState } from "../components/ui";
import { MaxLevelMonsters } from "../components/MaxLevelMonsters";
import { ArtifactTopTables } from "../components/ArtifactTopTables";

export default function OverviewPage() {
  const account = useStore((s) => s.account);
  const summary = useSummary();
  const [effTab, setEffTab] = useState<TopEffKey>("all");

  if (!account || !summary) {
    return <EmptyState icon={<Activity size={40} />} title="尚未匯入存檔" desc="回到匯入頁上傳 JSON 後即可看到分析。" />;
  }

  const equipped = account.runes.filter((r) => r.occupied > 0).length;  const topSets = Object.entries(summary.sets)
    .map(([id, c]) => ({ id: Number(id), c }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 8);
  const effTabs: { key: TopEffKey; label: string }[] = [
    { key: "all", label: "全部" },
    { key: "violent", label: "暴走" },
    { key: "will", label: "意志" },
    { key: "swift", label: "迅速" },
  ];
  const effRows = summary.topEff[effTab];

  return (
    <>
      <div className="grid g4">
        <Tile icon={<Users size={16} />} k="魔靈" v={fmt(account.units.length)} sub={`六星 ${summary.sixStar} 隻`} />
        <Tile icon={<Gem size={16} />} k="符文" v={fmt(account.runes.length)} sub={`已裝備 ${fmt(equipped)} 顆`} />
        <Tile
          icon={<Sparkles size={16} />}
          k="神器"
          v={fmt(account.artifacts.length)}
          sub={`已裝備 ${fmt(account.artifacts.filter((a) => a.occupied > 0).length)} 件`}
        />
        <Tile icon={<Star size={16} />} k="平均符文效率" v={`${summary.avgEff.toFixed(1)}%`} sub="以同星級副屬上限計算" />
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">高速符文數量</div>
              <div className="card-sub">速度＝速度副屬性（含精煉）＋速度固有屬性；達到門檻即計入</div>
            </div>
            <a className="tiny" href="#/runes">符文倉庫 <ArrowUpRight size={11} /></a>
          </div>
          <div className="card-pad" style={{ paddingTop: 4 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>速度門檻</th>
                  <th className="num">全部</th>
                  {[13, 15, 3].map((id) => (
                    <th key={id} className="num">
                      <span className="row" style={{ gap: 5, justifyContent: "flex-end" }}>
                        <span className="rune-dot" style={{ background: setColor(id) }} />
                        {SET_BY_ID[id]?.name}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.speedCounts.map((row) => (
                  <tr key={row.threshold}>
                    <td className="mono gold" style={{ fontWeight: 700 }}>≥ {row.threshold}</td>
                    <td className="num mono" style={{ fontWeight: 700 }}>{fmt(row.all)}</td>
                    {[13, 15, 3].map((id) => (
                      <td key={id} className="num mono">{fmt(row.sets[id] ?? 0)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">屬性與星數</div>
            <span className="chip muted">魔靈盒</span>
          </div>
          <div className="card-pad col" style={{ gap: 14 }}>
            <div>
              <div className="tiny dim" style={{ marginBottom: 7 }}>屬性分佈</div>
              <div style={{ display: "flex", height: 12, borderRadius: 8, overflow: "hidden", background: "rgba(34,48,82,.6)" }}>
                {[1, 2, 3, 4, 5].map((el) => {
                  const c = summary.byEl[el] ?? 0;
                  if (!c) return null;
                  return <div key={el} style={{ width: `${(c / account.units.length) * 100}%`, background: `var(--${["", "water", "fire", "wind", "light", "dark"][el]})` }} title={`${ELEMENTS[el as 1].name} ${c}`} />;
                })}
              </div>
              <div className="row wrap" style={{ marginTop: 8, gap: 10 }}>
                {[1, 2, 3, 4, 5].map((el) => (
                  <span key={el} className={`tiny el-${el}`}>
                    {ELEMENTS[el as 1 | 2 | 3 | 4 | 5].name} {summary.byEl[el] ?? 0}
                  </span>
                ))}
              </div>
            </div>

            <div className="divider" />

            <div>
              <div className="tiny dim" style={{ marginBottom: 7 }}>原生星數</div>
              <div className="row wrap" style={{ gap: 7 }}>
                {[5, 4, 3, 2, 1].map((n) => (
                  <span key={n} className={`chip ${n === 5 ? "gold" : "muted"}`}>
                    {n}★ {summary.byNat[n] ?? 0}
                  </span>
                ))}
              </div>
            </div>

            <div className="divider" />

            <div>
              <div className="tiny dim" style={{ marginBottom: 7 }}>符文品質</div>
              {[6, 5, 4, 3].map((g) => {
                const c = summary.grades[g] ?? 0;
                const w = account.runes.length ? (c / account.runes.length) * 100 : 0;
                return (
                  <div key={g} className="row" style={{ gap: 8, marginBottom: 5 }}>
                    <span className="tiny mono" style={{ width: 54, color: "var(--muted)" }}>{g}★</span>
                    <div className="bar" style={{ flex: 1 }}><i style={{ width: `${w}%`, background: g >= 5 ? "linear-gradient(90deg,#f6d27a,#c9962f)" : "linear-gradient(90deg,#58a6ff,#2f5aa8)" }} /></div>
                    <span className="tiny mono dim" style={{ width: 42, textAlign: "right" }}>{c}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div className="card-title">符文套裝分佈</div>
          <a className="tiny" href="#/runes">符文倉庫 <ArrowUpRight size={11} /></a>
        </div>
        <div className="card-pad col" style={{ gap: 9 }}>
          {topSets.map((s) => {
            const def = SET_BY_ID[s.id];
            const w = (s.c / Math.max(1, account.runes.length)) * 100;
            return (
              <div key={s.id}>
                <div className="row between" style={{ marginBottom: 4 }}>
                  <span className="tiny" style={{ fontWeight: 600 }}>
                    <span className="rune-dot" style={{ background: setColor(s.id), display: "inline-block", marginRight: 6 }} />
                    {def?.name ?? `套裝 ${s.id}`}
                    <span className="dim" style={{ marginLeft: 5 }}>{def?.en}</span>
                  </span>
                  <span className="tiny mono dim">{s.c} 顆</span>
                </div>
                <div className="bar"><i style={{ width: `${w}%`, background: `linear-gradient(90deg, ${setColor(s.id)}, rgba(255,255,255,.05))` }} /></div>
              </div>
            );
          })}
        </div>
      </div>

      <MaxLevelMonsters views={summary.maxLevel6} />
      <ArtifactTopTables artifacts={account.artifacts} />

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div>
            <div className="card-title">最高效率符文 Top 100</div>
            <div className="card-sub">只計 6★ 符文；效率含精煉，分子與分母都不計固定體力 / 攻擊 / 防禦</div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            {effTabs.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`chip ${effTab === t.key ? "gold" : "muted"}`}
                onClick={() => setEffTab(t.key)}
                style={{ cursor: "pointer" }}
              >
                {t.key !== "all" && <span className="rune-dot" style={{ background: setColor(t.key === "violent" ? 13 : t.key === "will" ? 15 : 3), display: "inline-block", marginRight: 5 }} />}
                {t.label} {summary.topEff[t.key].length}
              </button>
            ))}
          </div>
        </div>
        <div className="scroll-y" style={{ maxHeight: 480 }}>
          <table className="table">
            <thead>
              <tr>
                <th className="num" style={{ width: 52 }}>#</th>
                <th>套裝</th>
                <th className="num">位置</th>
                <th>主屬性</th>
                <th className="num">速度</th>
                <th className="num">效率</th>
              </tr>
            </thead>
            <tbody>
              {effRows.map((e, i) => (
                <tr key={e.rune.id}>
                  <td className="num mono dim">{i + 1}</td>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <span className="rune-dot" style={{ background: setColor(e.rune.set) }} />
                      {SET_BY_ID[e.rune.set]?.name ?? `套裝 ${e.rune.set}`}
                      <span className="tiny dim">{e.rune.grade}★ +{e.rune.level}</span>
                    </span>
                  </td>
                  <td className="num mono">{e.rune.slot}</td>
                  <td className="tiny mono">{statText(e.rune.main.t, e.rune.main.v)}</td>
                  <td className="num mono gold" style={{ fontWeight: 700 }}>{e.spd}</td>
                  <td className="num mono" style={{ fontWeight: 700 }}>{e.eff.toFixed(1)}%</td>
                </tr>
              ))}
              {effRows.length === 0 && (
                <tr><td colSpan={6} className="dim tiny" style={{ textAlign: "center", padding: 20 }}>沒有符合條件的 6★ 符文</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div>
            <div className="card-title">最高分符文 Top 100</div>
            <div className="card-sub">依遊戲符文分數排序（含精煉）；不限制星級，5★ 神符也會列入</div>
          </div>
          <span className="chip muted">{summary.topScore.length} 顆</span>
        </div>
        <div className="scroll-y" style={{ maxHeight: 480 }}>
          <table className="table">
            <thead>
              <tr>
                <th className="num" style={{ width: 52 }}>#</th>
                <th>套裝</th>
                <th className="num">位置</th>
                <th>主屬性</th>
                <th className="num">速度</th>
                <th className="num">評分</th>
              </tr>
            </thead>
            <tbody>
              {summary.topScore.map((e, i) => (
                <tr key={e.rune.id}>
                  <td className="num mono dim">{i + 1}</td>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <span className="rune-dot" style={{ background: setColor(e.rune.set) }} />
                      {SET_BY_ID[e.rune.set]?.name ?? `套裝 ${e.rune.set}`}
                      <span className="tiny dim">{e.rune.grade}★ +{e.rune.level}</span>
                    </span>
                  </td>
                  <td className="num mono">{e.rune.slot}</td>
                  <td className="tiny mono">{statText(e.rune.main.t, e.rune.main.v)}</td>
                  <td className="num mono gold" style={{ fontWeight: 700 }}>{e.spd}</td>
                  <td className="num mono" style={{ fontWeight: 700 }}>{e.score}</td>
                </tr>
              ))}
              {summary.topScore.length === 0 && (
                <tr><td colSpan={6} className="dim tiny" style={{ textAlign: "center", padding: 20 }}>沒有符文資料</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><div className="card-title">帳號資料</div></div>
        <div className="card-pad grid g3">
          <div className="kv"><span className="k">檔案</span><span className="v">{account.fileName}</span></div>
          <div className="kv"><span className="k">匯入時間</span><span className="v">{new Date(account.importedAt).toLocaleString("zh-TW")}</span></div>
          <div className="kv"><span className="k">建築資料</span><span className="v">{account.buildings.length} 項</span></div>
          <div className="kv"><span className="k">速度圖騰</span><span className="v">{(() => { const b = account.buildings.find((x) => x.id === 7); return b ? `${[1,2,2.5,3,4,5,5.5,6,7,8,8.5,9,10,11,11.5,12,13,14,14.5,15][b.level - 1]}%` : "未偵測"; })()}</span></div>
          <div className="kv"><span className="k">已裝備符文</span><span className="v">{equipped}</span></div>
          <div className="kv"><span className="k">符文總效率值</span><span className="v">{fmt(Math.round(account.runes.reduce((s, r) => s + r.eff, 0)))}</span></div>
        </div>
      </div>
    </>
  );
}

function Tile({ icon, k, v, sub }: { icon: React.ReactNode; k: string; v: string; sub?: string }) {
  return (
    <div className="card card-pad">
      <div className="row" style={{ gap: 7, color: "var(--muted)" }}>
        <span style={{ color: "var(--gold)" }}>{icon}</span>
        <span className="tiny" style={{ fontWeight: 600, letterSpacing: ".04em" }}>{k}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6, letterSpacing: "-.02em" }} className="mono">{v}</div>
      {sub && <div className="tiny dim" style={{ marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
