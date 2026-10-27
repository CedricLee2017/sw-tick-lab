import { Activity, ArrowUpRight, Gauge, Gem, Sparkles, Star, Users } from "lucide-react";
import { useStore } from "../store";
import { useSummary } from "../lib/accountStats";
import { ELEMENTS, SET_BY_ID } from "../lib/constants";
import { MonsterIcon, TickBadge, fmt, setColor } from "../components/ui";
import { speedForTick } from "../lib/stats";
import { EmptyState } from "../components/ui";

export default function OverviewPage() {
  const account = useStore((s) => s.account);
  const runeMap = useStore((s) => s.runeMap);
  const summary = useSummary();
  const rta = useStore((s) => s.settings.rta);

  if (!account || !summary) {
    return <EmptyState icon={<Activity size={40} />} title="尚未匯入存檔" desc="回到匯入頁上傳 JSON 後即可看到分析。" />;
  }

  const maxBucket = Math.max(1, ...summary.tickBuckets.map((b) => b.count));
  const top = summary.topSpeed;
  const fastest = top[0];
  const equipped = account.runes.filter((r) => r.occupied > 0).length;
  const topSets = Object.entries(summary.sets)
    .map(([id, c]) => ({ id: Number(id), c }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 8);

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
        <Tile
          icon={<Gauge size={16} />}
          k="最快魔靈"
          v={fastest ? `${fastest.stats.spd}` : "—"}
          sub={fastest ? `${fastest.monster.name} · Tick ${fastest.stats.tick}` : ""}
        />
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">速度 Tick 分佈</div>
              <div className="card-sub">每隻魔靈在自己目前符文下的出手 Tick（{rta ? "RTA" : "一般"}）</div>
            </div>
            <span className="chip muted">T1–T20</span>
          </div>
          <div className="card-pad">
            {summary.tickBuckets.length === 0 ? (
              <div className="dim tiny">沒有資料</div>
            ) : (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 170 }}>
                {summary.tickBuckets.map((b) => (
                  <div key={b.tick} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <div className="tiny mono" style={{ color: "var(--muted)" }}>{b.count}</div>
                    <div
                      title={`Tick ${b.tick}（${speedForTick(b.tick, rta)} 速以上）`}
                      style={{
                        width: "100%",
                        height: Math.max(4, (b.count / maxBucket) * 120),
                        borderRadius: 6,
                        background: b.tick <= 6 ? "linear-gradient(180deg, #f6d27a, #c9962f)" : "linear-gradient(180deg, #58a6ff, #2f5aa8)",
                        opacity: b.tick <= 6 ? 1 : 0.75,
                      }}
                    />
                    <div className="tiny dim mono">T{b.tick}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="row wrap tiny dim" style={{ marginTop: 12, gap: 10 }}>
              <span>Tick 5 = {speedForTick(5, rta)} 速</span>
              <span>·</span>
              <span>Tick 6 = {speedForTick(6, rta)} 速</span>
              <span>·</span>
              <span>Tick 7 = {speedForTick(7, rta)} 速</span>
            </div>
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

      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head">
            <div className="card-title">速度排行</div>
            <a className="tiny" href="#/speed">前往速度實驗室 <ArrowUpRight size={11} /></a>
          </div>
          <div className="scroll-y" style={{ maxHeight: 420 }}>
            <table className="table">
              <thead>
                <tr><th>魔靈</th><th className="num">速度</th><th className="num">Tick</th><th className="num">體力</th><th className="num">符文</th></tr>
              </thead>
              <tbody>
                {top.map((v) => (
                  <tr key={v.unit.id}>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <MonsterIcon id={v.monster.id} size={30} />
                        <div>
                          <div style={{ fontWeight: 600 }}>{v.monster.name}</div>
                          <div className="tiny dim">{ELEMENTS[v.monster.el as 1].name} · {v.monster.nat}★</div>
                        </div>
                      </div>
                    </td>
                    <td className="num mono gold" style={{ fontWeight: 700 }}>{v.stats.spd}</td>
                    <td className="num"><TickBadge spd={v.stats.spd} rta={rta} /></td>
                    <td className="num mono">{fmt(v.stats.hp)}</td>
                    <td className="num mono dim">{v.runes.length}/6</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
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
