import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Gauge, Gem, Target } from "lucide-react";
import { useStore } from "../store";
import { EmptyState, fmt, setColor } from "../components/ui";
import { SET_BY_ID } from "../lib/constants";
import { STANDING_LIMIT, guildStanding, standingEff, standingPoints, summarizeStanding } from "../lib/runeStanding";
import { loadGuildData, type GuildData } from "../lib/guild";
import type { Rune } from "../lib/types";

/**
 * 符文定位：把 SWGT 那張「10 條線 × 400 個點」的圖，改成三個可以直接講出口的數字。
 *
 *  - 精練度：背包 Top N 的平均效率（100 = 每條副屬都滿值）
 *  - 對公會：已裝備符文的平均效率，對比公會成員（名次 / 標準差）
 *  - 門檻件數：Top N 裡有幾顆達到 90 / 85 / 80 / 75
 *
 * 可以只看單一套裝（迅速 / 暴走 / 意志…），也可以切換取樣顆數。
 */
const LIMITS = [100, 400, 1000] as const;

/** 常駐在畫面上的三個主要套裝：迅速 / 暴走 / 意志 */
const PINNED_SETS = [3, 13, 15];

export default function RuneStandingPage() {
  const account = useStore((s) => s.account);
  const [guild, setGuild] = useState<GuildData | null>(null);
  const [setId, setSetId] = useState(0);
  const [limit, setLimit] = useState<number>(STANDING_LIMIT);

  useEffect(() => {
    let alive = true;
    void loadGuildData().then((d) => {
      if (alive) setGuild(d);
    });
    return () => {
      alive = false;
    };
  }, []);

  const setOptions = useMemo(() => {
    const counts = new Map<number, number>();
    for (const r of account?.runes ?? []) {
      if (r.grade !== 6) continue;
      counts.set(r.set, (counts.get(r.set) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([id, count]) => ({ id, count, name: SET_BY_ID[id]?.name ?? `套裝 ${id}` }))
      .sort((a, b) => b.count - a.count);
  }, [account]);

  const setName = setId > 0 ? (SET_BY_ID[setId]?.name ?? `套裝 ${setId}`) : "全部套裝";

  const setCount = useMemo(() => new Map(setOptions.map((o) => [o.id, o.count])), [setOptions]);
  const otherSets = useMemo(() => setOptions.filter((o) => !PINNED_SETS.includes(o.id)), [setOptions]);

  const standing = useMemo(
    () => summarizeStanding(standingPoints(account?.runes ?? [], limit, setId)),
    [account, limit, setId],
  );

  // 各套裝的精練度排行（每個套裝各自取 Top N，門檻才不會被套裝數量影響）
  const overall = useMemo(
    () => summarizeStanding(standingPoints(account?.runes ?? [], limit, 0)),
    [account, limit],
  );
  const setTable = useMemo(() => {
    return setOptions
      .map((o) => {
        const s = summarizeStanding(standingPoints(account?.runes ?? [], limit, o.id));
        return {
          id: o.id,
          name: o.name,
          total: o.count,
          sample: s.count,
          refine: s.refinement,
          top: s.top,
          hi: s.thresholds.find((t) => t.t === 85)?.count ?? 0,
        };
      })
      .sort((a, b) => b.refine - a.refine);
  }, [account, limit, setOptions]);

  // 公會成員：同一顆符文可能同時裝在測試隊與據點防守，先用 id 去重
  const members = useMemo(() => {
    if (!guild) return [];
    return guild.members
      .filter((m) => !(account?.wizardId && m.wizardId === account.wizardId))
      .map((m) => {
        const seen = new Set<number>();
        const runes: Rune[] = [];
        for (const deck of m.decks) {
          for (const unit of deck.units) {
            for (const rune of unit.runes) {
              if (seen.has(rune.id)) continue;
              if (setId > 0 && rune.set !== setId) continue;
              seen.add(rune.id);
              runes.push(rune);
            }
          }
        }
        return { name: m.name, runes };
      });
  }, [guild, account?.wizardId, setId]);

  const ownEquipped = useMemo(
    () => (account ? account.runes.filter((r) => r.occupied > 0 && (setId <= 0 || r.set === setId)) : []),
    [account, setId],
  );
  const ownEquippedValue = useMemo(
    () => (ownEquipped.length > 0 ? ownEquipped.reduce((s, r) => s + standingEff(r), 0) / ownEquipped.length : null),
    [ownEquipped],
  );
  const vsGuild = useMemo(
    () => (ownEquippedValue == null ? null : guildStanding(members, ownEquippedValue)),
    [members, ownEquippedValue],
  );

  if (!account) {
    return <EmptyState icon={<Target size={40} />} title="尚未匯入存檔" desc="回到匯入頁上傳 JSON 後即可看到符文定位。" />;
  }

  const refine = Math.min(100, standing.refinement);
  const source = setId > 0 ? `${setName} · 已裝備` : "已裝備";

  return (
    <>
      <div className="row between" style={{ gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <div className="tabs" role="tablist" aria-label="套裝">
            <button className={`tab ${setId === 0 ? "active" : ""}`} onClick={() => setSetId(0)}>
              全部
            </button>
            {PINNED_SETS.map((id) => {
              const count = setCount.get(id) ?? 0;
              return (
                <button
                  key={id}
                  className={`tab ${setId === id ? "active" : ""}`}
                  onClick={() => setSetId(id)}
                  disabled={count === 0}
                  style={count === 0 ? { opacity: 0.4, cursor: "default" } : undefined}
                >
                  {SET_BY_ID[id]?.name ?? `套裝 ${id}`}
                  <span className="dim" style={{ marginLeft: 4, fontSize: 10.5 }}>
                    {fmt(count)}
                  </span>
                </button>
              );
            })}
          </div>
          <select
            className="select"
            style={{ maxWidth: 170 }}
            value={otherSets.some((o) => o.id === setId) ? setId : 0}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v > 0) setSetId(v);
            }}
            title="其他套裝"
          >
            <option value={0}>其他套裝…</option>
            {otherSets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}（{fmt(o.count)}）
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="tiny dim">取樣</span>
          <div className="seg" role="radiogroup" aria-label="取樣顆數">
            {LIMITS.map((n) => (
              <label key={n} className={`seg-item ${limit === n ? "on" : ""}`}>
                <input
                  type="radio"
                  name="standing-limit"
                  checked={limit === n}
                  onChange={() => setLimit(n)}
                />
                Top {fmt(n)}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="grid g3">
        <Tile
          icon={<Gem size={16} />}
          k="精練度"
          v={`${standing.refinement.toFixed(1)}%`}
          sub={`${setName} · Top ${fmt(standing.count)} 平均效率`}
        />
        <Tile
          icon={<Target size={16} />}
          k="對比公會"
          v={vsGuild ? `${vsGuild.delta >= 0 ? "+" : ""}${vsGuild.delta.toFixed(1)}` : "—"}
          sub={vsGuild ? `${source} · 第 ${vsGuild.rank} / ${fmt(vsGuild.members.length)} 名` : guild ? "此套裝沒有可比較的資料" : "未匯入公會資料"}
        />
        <Tile
          icon={<Gauge size={16} />}
          k="≥85% 件數"
          v={fmt(standing.thresholds.find((t) => t.t === 85)?.count ?? 0)}
          sub={`${setName} · Top ${fmt(standing.count)} 之中`}
        />
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">我在公會哪裡？</div>
              <div className="card-sub">{setName}的已裝備符文平均效率；每一點是一位成員</div>
            </div>
            <span className="chip gold">{vsGuild ? `${vsGuild.members.length} 位成員` : "沒有資料"}</span>
          </div>
          <div className="card-pad">
            {!guild ? (
              <div className="hint">
                還沒有公會資料。到「公會」頁匯入 SWEX 的 FullLogger 或公會 JSON，就會用成員已裝備的符文做比較。
                <div style={{ marginTop: 10 }}>
                  <a className="btn btn-sm" href="#/guild">
                    前往公會頁 <ArrowUpRight size={12} />
                  </a>
                </div>
              </div>
            ) : !vsGuild ? (
              <div className="hint">
                {ownEquippedValue == null
                  ? `你在${setName}沒有已裝備的符文，所以無法比較。`
                  : `公會匯入的資料裡沒有成員裝備${setName}的符文。`}
              </div>
            ) : (
              <>
                <Scale members={vsGuild.members} avg={vsGuild.avg} you={ownEquippedValue ?? vsGuild.avg} />
                <div className="row between" style={{ marginTop: 18, fontSize: 12.5 }}>
                  <span className="dim">你 {ownEquippedValue?.toFixed(1)}%</span>
                  <span className="dim">公會平均 {vsGuild.avg.toFixed(1)}%</span>
                  <span className="dim">最高 {vsGuild.max.toFixed(1)}%</span>
                </div>
                <div className="kv" style={{ marginTop: 8 }}>
                  <span className="k">與平均差距</span>
                  <span className="v" style={{ color: vsGuild.delta >= 0 ? "var(--green)" : "var(--red)" }}>
                    {vsGuild.delta >= 0 ? "+" : ""}
                    {vsGuild.delta.toFixed(1)} 點（{vsGuild.z >= 0 ? "+" : ""}
                    {vsGuild.z.toFixed(2)} SD）
                  </span>
                </div>
                <div className="kv">
                  <span className="k">贏過成員</span>
                  <span className="v">{vsGuild.percentile.toFixed(0)}%</span>
                </div>
                <div className="kv">
                  <span className="k">公會標準差</span>
                  <span className="v">{vsGuild.sd.toFixed(2)}</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">我的符文精練到幾成？</div>
              <div className="card-sub">{setName} · Top {fmt(standing.count)} 的平均效率 ÷ 100</div>
            </div>
            <span className="chip green">Top {fmt(standing.count)}</span>
          </div>
          <div className="card-pad">
            <div className="row" style={{ alignItems: "baseline", gap: 8 }}>
              <div className="mono" style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-.03em" }}>
                {standing.refinement.toFixed(1)}
                <span className="dim" style={{ fontSize: 18, fontWeight: 600 }}>%</span>
              </div>
              <div className="tiny dim">還有 {(100 - refine).toFixed(1)} 點空間</div>
            </div>
            <div className="bar" style={{ height: 10, marginTop: 12 }}>
              <i style={{ width: `${refine}%`, background: "linear-gradient(90deg, var(--blue), var(--gold))" }} />
            </div>
            <div className="kv" style={{ marginTop: 12 }}>
              <span className="k">最高（#1）</span>
              <span className="v mono">{standing.top.toFixed(1)}%</span>
            </div>
            <div className="kv">
              <span className="k">中位數</span>
              <span className="v mono">{standing.median.toFixed(1)}%</span>
            </div>
            <div className="kv">
              <span className="k">{standing.count >= limit ? `第 ${fmt(standing.count)} 名` : "最低"}</span>
              <span className="v mono">{standing.floor.toFixed(1)}%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div>
            <div className="card-title">各套裝精練度比較</div>
            <div className="card-sub">每個套裝各自取 Top {fmt(limit)}，由高到低排；點一列直接切換</div>
          </div>
          <span className="chip">{fmt(setTable.length)} 個套裝</span>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>套裝</th>
                <th className="num">6★</th>
                <th>精練度</th>
                <th className="num">與整體差</th>
                <th className="num">最高</th>
                <th className="num">≥85%</th>
              </tr>
            </thead>
            <tbody>
              {setTable.map((row) => {
                const diff = row.refine - overall.refinement;
                const active = setId === row.id;
                return (
                  <tr
                    key={row.id}
                    onClick={() => setSetId(row.id)}
                    style={{ cursor: "pointer", background: active ? "rgba(242,198,92,.08)" : undefined }}
                  >
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        <span className="rune-dot" style={{ background: setColor(row.id) }} />
                        {row.name}
                      </span>
                    </td>
                    <td className="num mono">{fmt(row.total)}</td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="mono" style={{ minWidth: 46 }}>
                          {row.refine.toFixed(1)}%
                        </span>
                        <div className="bar" style={{ flex: 1, minWidth: 60 }}>
                          <i style={{ width: `${Math.min(100, row.refine)}%`, background: active ? "var(--gold)" : undefined }} />
                        </div>
                      </div>
                    </td>
                    <td className="num mono" style={{ color: diff >= 0 ? "var(--green)" : "var(--red)" }}>
                      {diff >= 0 ? "+" : ""}
                      {diff.toFixed(1)}
                    </td>
                    <td className="num mono">{row.top.toFixed(1)}%</td>
                    <td className="num mono">{fmt(row.hi)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div>
            <div className="card-title">{setName} · Top {fmt(standing.count)} 的門檻件數</div>
            <div className="card-sub">比曲線更直接：每個門檻有幾顆、佔比多少</div>
          </div>
        </div>
        <div className="card-pad">
          {standing.thresholds.map((row) => (
            <div key={row.t} style={{ marginBottom: 12 }}>
              <div className="row between" style={{ fontSize: 12.5, marginBottom: 4 }}>
                <span>
                  <b className="mono gold">≥ {row.t}%</b>
                </span>
                <span className="mono">
                  {fmt(row.count)} 件 <span className="tiny dim">· {row.pct < 10 ? row.pct.toFixed(1) : row.pct.toFixed(0)}%</span>
                </span>
              </div>
              <div className="bar">
                <i style={{ width: `${row.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div>
            <div className="card-title">怎樣讀這三個數字</div>
          </div>
        </div>
        <div className="card-pad tiny dim" style={{ lineHeight: 1.9 }}>
          <div>・精練度只看「{setName}的 6★ 符文，{standing.count >= limit ? `取效率最高的 Top ${fmt(limit)}` : `全部 ${fmt(standing.count)} 顆`}」，效率已含精煉、忽略固定體力 / 攻擊 / 防禦，100% 代表每條副屬性都達到上限。</div>
          <div>・對公會用的是「已裝備符文」的平均效率，因為公會匯入資料只有裝備中的符文；選了套裝就只比該套裝。</div>
          <div>・名次是把每位成員的平均效率排隊，你自己插入比較；同一顆符文在測試隊與據點防守重複出現只計一次。</div>
        </div>
      </div>
    </>
  );
}

/** 一維位置圖：每位成員一個點，自己的點用金色標出 */
function Scale({ members, avg, you }: { members: { name: string; value: number }[]; avg: number; you: number }) {
  const values = members.map((m) => m.value);
  const lo = Math.min(...values, you) - 0.6;
  const hi = Math.max(...values, you) + 0.6;
  const span = Math.max(0.1, hi - lo);
  const pos = (v: number) => ((v - lo) / span) * 100;

  return (
    <div style={{ position: "relative", height: 72, margin: "6px 2px 0" }}>
      <div className="bar" style={{ position: "absolute", left: 0, right: 0, top: 34, height: 8 }} />
      {members.map((m, i) => (
        <span
          key={`${m.name}-${i}`}
          title={`${m.name} ${m.value.toFixed(1)}%`}
          style={{
            position: "absolute",
            top: 34,
            left: `${pos(m.value)}%`,
            width: 7,
            height: 7,
            marginTop: 0.5,
            marginLeft: -3.5,
            borderRadius: 999,
            background: "var(--muted-2)",
            opacity: 0.75,
          }}
        />
      ))}
      <div style={{ position: "absolute", top: 28, left: `${pos(avg)}%`, width: 1, height: 20, background: "var(--muted)" }} />
      <span
        className="tiny dim"
        style={{ position: "absolute", top: 50, left: `${pos(avg)}%`, transform: "translateX(-50%)", whiteSpace: "nowrap" }}
      >
        平均 {avg.toFixed(1)}
      </span>
      <div style={{ position: "absolute", top: 26, left: `${pos(you)}%`, transform: "translateX(-50%)", textAlign: "center" }}>
        <span
          style={{
            display: "block",
            width: 13,
            height: 13,
            borderRadius: 999,
            background: "var(--gold)",
            border: "2px solid var(--bg)",
            boxShadow: "0 0 0 4px rgba(242,198,92,.18)",
            margin: "0 auto",
          }}
        />
        <span
          className="tiny"
          style={{
            position: "absolute",
            bottom: 19,
            left: "50%",
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
            color: "var(--gold)",
            fontWeight: 700,
          }}
        >
          你
        </span>
      </div>
    </div>
  );
}

function Tile({ icon, k, v, sub }: { icon: React.ReactNode; k: string; v: string; sub?: string }) {
  return (
    <div className="card card-pad">
      <div className="row" style={{ gap: 7, color: "var(--muted)" }}>
        <span style={{ color: "var(--gold)" }}>{icon}</span>
        <span className="tiny" style={{ fontWeight: 600, letterSpacing: ".04em" }}>
          {k}
        </span>
      </div>
      <div className="mono" style={{ fontSize: 26, fontWeight: 800, marginTop: 6, letterSpacing: "-.02em" }}>
        {v}
      </div>
      {sub && (
        <div className="tiny dim" style={{ marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}
