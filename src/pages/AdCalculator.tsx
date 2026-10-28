import { useMemo, useState } from "react";
import { Calculator, Flame, Search } from "lucide-react";
import { MONSTER_MAP, monsterLabel, useStore } from "../store";
import {
  addAdEffects,
  artifactAdEffects,
  artifactAdResult,
  calculateAd,
  hasAdEffect,
  type AdEffects,
  type AdStats,
} from "../lib/adCalculator";
import { baseStats, statsForRunes } from "../lib/stats";
import { artifactKindText, artifactMainText, artifactSubText } from "../lib/artifacts";
import { NumberField, fmt } from "../components/ui";
import type { Artifact } from "../lib/types";

const ZERO: AdEffects = { hp: 0, atk: 0, def: 0, spd: 0 };

export default function AdCalculatorPage() {
  const account = useStore((s) => s.account);
  const settings = useStore((s) => s.settings);
  const runeMap = useStore((s) => s.runeMap);
  const notify = useStore((s) => s.notify);
  const [unitId, setUnitId] = useState(0);
  const [stats, setStats] = useState<AdStats>({ hp: 40000, atk: 2000, def: 1000, spd: 200 });
  const [effects, setEffects] = useState<AdEffects>({ hp: 0.3, atk: 4, def: 4, spd: 40 });
  const [hits, setHits] = useState(3);
  const [q, setQ] = useState("");
  const [type, setType] = useState(0);
  const [cmp, setCmp] = useState({ mult: 4, enemyDef: 800, cd: 150, atkBuff: 50 });

  const units = useMemo(() => {
    if (!account) return [];
    return account.units
      .map((u) => ({ u, m: MONSTER_MAP.get(u.master) }))
      .filter((x) => !!x.m)
      .sort((a, b) => a.m!.name.localeCompare(b.m!.name));
  }, [account]);

  const owner = useMemo(() => {
    const m = new Map<number, string>();
    if (!account) return m;
    for (const u of account.units) for (const aid of u.artifacts) m.set(aid, monsterLabel(u.master));
    return m;
  }, [account]);

  const pickUnit = (id: number) => {
    setUnitId(id);
    const picked = units.find((x) => x.u.id === id);
    if (!picked || !account) return;
    const { u, m } = picked;
    const artifactMap = new Map(account.artifacts.map((a) => [a.id, a]));
    const arts = u.artifacts.map((aid) => artifactMap.get(aid)).filter((a): a is Artifact => !!a);
    const s = statsForRunes(baseStats(m!, u.stars, u.level), u.runes.map((rid) => runeMap.get(rid)).filter((r): r is NonNullable<typeof r> => !!r), settings.bonus, settings.rta, true, arts);
    setStats({ hp: s.hp, atk: s.atk, def: s.def, spd: s.spd });
  };

  const result = useMemo(() => calculateAd(stats, effects, hits), [stats, effects, hits]);

  const adArtifacts = useMemo(() => {
    if (!account) return [];
    const term = q.trim().toLowerCase();
    return account.artifacts
      .filter((a) => hasAdEffect(a))
      .filter((a) => !type || a.type === type)
      .filter((a) => {
        if (!term) return true;
        return `${artifactKindText(a)} ${artifactMainText(a)} ${a.subs.map(artifactSubText).join(" ")} ${owner.get(a.id) ?? ""}`.toLowerCase().includes(term);
      })
      .map((a) => ({ art: a, result: artifactAdResult(a, stats, hits), effects: artifactAdEffects(a) }))
      .sort((a, b) => b.result.perHit - a.result.perHit || b.art.rank - a.art.rank)
      .slice(0, 120);
  }, [account, q, type, stats, hits, owner]);

  const addArtifact = (a: Artifact) => {
    setEffects((e) => addAdEffects(e, artifactAdEffects(a)));
    notify(`已加入 ${artifactKindText(a)} 的追傷效果`);
  };

  const skillPerHit = useMemo(() => {
    const atk = stats.atk * (1 + cmp.atkBuff / 100);
    const crit = 1 + cmp.cd / 100;
    const mit = 1000 / (1140 + 3.5 * Math.max(0, cmp.enemyDef));
    return Math.floor(atk * cmp.mult * crit * mit);
  }, [stats.atk, cmp]);

  if (!account) return <div className="empty"><Calculator size={40} /><div>尚未匯入存檔</div></div>;

  const partRows: { key: keyof AdEffects; label: string; value: number; pct: number }[] = [
    { key: "hp", label: "體力 HP", value: stats.hp, pct: effects.hp },
    { key: "atk", label: "攻擊 ATK", value: stats.atk, pct: effects.atk },
    { key: "def", label: "防禦 DEF", value: stats.def, pct: effects.def },
    { key: "spd", label: "速度 SPD", value: stats.spd, pct: effects.spd },
  ];

  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="row between wrap" style={{ gap: 10 }}>
          <div>
            <div className="card-title row" style={{ gap: 7 }}>
              <Flame size={14} className="gold" /> 神器追傷計算器
            </div>
            <div className="card-sub">
              依三圍與段數計算追加傷害；可手動輸入，或選魔靈帶入目前面板，再從下方神器表加入效果。
            </div>
          </div>
          <div style={{ minWidth: 250, flex: "0 1 340px" }}>
            <label className="tiny dim">快速帶入魔靈目前面板</label>
            <select className="select" value={unitId} onChange={(e) => pickUnit(Number(e.target.value))}>
              <option value={0}>選擇魔靈…</option>
              {units.map(({ u, m }) => (
                <option key={u.id} value={u.id}>{m!.name} · {u.stars}★Lv.{u.level}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="grid g2" style={{ gap: 14, alignItems: "start" }}>
        <div className="card card-pad">
          <div className="card-title">面板數值</div>
          <div className="grid g2" style={{ marginTop: 10 }}>
            <NumberField label="體力 HP" value={stats.hp} min={0} step={1000} onChange={(v) => setStats((s) => ({ ...s, hp: v }))} />
            <NumberField label="攻擊 ATK" value={stats.atk} min={0} step={100} onChange={(v) => setStats((s) => ({ ...s, atk: v }))} />
            <NumberField label="防禦 DEF" value={stats.def} min={0} step={100} onChange={(v) => setStats((s) => ({ ...s, def: v }))} />
            <NumberField label="速度 SPD" value={stats.spd} min={0} step={10} onChange={(v) => setStats((s) => ({ ...s, spd: v }))} />
          </div>
          <div className="divider" />
          <div className="card-title">追傷效果（%）</div>
          <div className="grid g2" style={{ marginTop: 10 }}>
            <NumberField label="體力追傷 %" value={effects.hp} min={0} step={0.1} onChange={(v) => setEffects((e) => ({ ...e, hp: v }))} />
            <NumberField label="攻擊追傷 %" value={effects.atk} min={0} step={1} onChange={(v) => setEffects((e) => ({ ...e, atk: v }))} />
            <NumberField label="防禦追傷 %" value={effects.def} min={0} step={1} onChange={(v) => setEffects((e) => ({ ...e, def: v }))} />
            <NumberField label="速度追傷 %" value={effects.spd} min={0} step={1} onChange={(v) => setEffects((e) => ({ ...e, spd: v }))} />
          </div>
          <div className="row wrap" style={{ gap: 10, marginTop: 8 }}>
            <NumberField label="技能段數" value={hits} min={1} max={20} onChange={(v) => setHits(Math.max(1, Math.round(v)))} />
            <button className="btn btn-sm btn-ghost" style={{ alignSelf: "flex-end" }} onClick={() => setEffects(ZERO)}>
              清除效果
            </button>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            公式：每段 = floor(HP×h%) + floor(ATK×a%) + floor(DEF×d%) + floor(SPD×s%)；每個屬性分開無條件捨去。
          </div>
        </div>

        <div className="card card-pad">
          <div className="card-title">計算結果</div>
          <div className="row between wrap" style={{ gap: 10, marginTop: 10 }}>
            <div className="stat-tile" style={{ flex: 1, minWidth: 150 }}>
              <div className="k">每段追傷</div>
              <div className="v gold">{fmt(result.perHit)}</div>
            </div>
            <div className="stat-tile" style={{ flex: 1, minWidth: 150 }}>
              <div className="k">總追傷（×{result.hits} 段）</div>
              <div className="v">{fmt(result.total)}</div>
            </div>
          </div>
          <div className="grid g2" style={{ marginTop: 10 }}>
            {partRows.map((p) => (
              <div key={p.key} className="kv">
                <span className="k">{p.label} {p.pct}%</span>
                <span className="v mono gold">{fmt(result.parts[p.key])}</span>
              </div>
            ))}
          </div>
          <div className="divider" />
          <div className="card-title">與技能傷害比較（可選）</div>
          <div className="grid g2" style={{ marginTop: 8 }}>
            <NumberField label="技能倍率" value={cmp.mult} min={0} step={0.1} onChange={(v) => setCmp((c) => ({ ...c, mult: v }))} />
            <NumberField label="敵人防禦" value={cmp.enemyDef} min={0} step={50} onChange={(v) => setCmp((c) => ({ ...c, enemyDef: v }))} />
            <NumberField label="暴擊傷害 %" value={cmp.cd} min={0} step={10} onChange={(v) => setCmp((c) => ({ ...c, cd: v }))} />
            <NumberField label="攻擊強化 %" value={cmp.atkBuff} min={0} step={10} onChange={(v) => setCmp((c) => ({ ...c, atkBuff: v }))} />
          </div>
          <div className="kv"><span className="k">技能傷害 / 段（必暴估算）</span><span className="v mono">{fmt(skillPerHit)}</span></div>
          <div className="kv"><span className="k">追傷 / 段</span><span className="v mono gold">{fmt(result.perHit)}</span></div>
          <div className="kv">
            <span className="k">追傷佔技能傷害</span>
            <span className="v mono">{skillPerHit > 0 ? `${((result.perHit / skillPerHit) * 100).toFixed(1)}%` : "—"}</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <div className="card-title">神器追傷排行 <span className="dim tiny" style={{ fontWeight: 400 }}>以目前面板與 {result.hits} 段計算</span></div>
          <div className="row" style={{ gap: 8 }}>
            <div style={{ position: "relative" }}>
              <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: "var(--muted-2)" }} />
              <input className="input" style={{ width: 210, paddingLeft: 28 }} placeholder="搜尋神器 / 效果 / 擁有者" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className="select" style={{ width: 120 }} value={type} onChange={(e) => setType(Number(e.target.value))}>
              <option value={0}>全部類型</option>
              <option value={1}>屬性神器</option>
              <option value={2}>類型神器</option>
            </select>
          </div>
        </div>
        <div className="card-pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>
          {adArtifacts.map(({ art, result: r, effects: e }) => (
            <div key={art.id} className="card card-pad" style={{ padding: 11 }}>
              <div className="row between" style={{ gap: 6 }}>
                <div>
                  <div className="tiny dim">{artifactKindText(art)} · {art.main.t ? artifactMainText(art) : "—"}</div>
                  <div style={{ fontWeight: 700, fontSize: 12 }}>{owner.get(art.id) ?? "未裝備"}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="mono gold" style={{ fontWeight: 800 }}>{fmt(r.perHit)}</div>
                  <div className="tiny dim">/ 段 · 共 {fmt(r.total)}</div>
                </div>
              </div>
              <div className="tiny dim" style={{ marginTop: 5, minHeight: 32 }}>
                {e.hp > 0 && <>HP {e.hp}% </>}
                {e.atk > 0 && <>ATK {e.atk}% </>}
                {e.def > 0 && <>DEF {e.def}% </>}
                {e.spd > 0 && <>SPD {e.spd}%</>}
              </div>
              <div className="row" style={{ gap: 5, marginTop: 6 }}>
                <button className="btn btn-sm btn-ghost" onClick={() => setEffects(e)}>套用</button>
                <button className="btn btn-sm btn-ghost" onClick={() => addArtifact(art)}>加入</button>
              </div>
            </div>
          ))}
          {adArtifacts.length === 0 && <div className="empty" style={{ gridColumn: "1/-1" }}>沒有符合條件的追傷神器</div>}
        </div>
        <div className="card-pad tiny dim">
          排行只計算神器副效果的追傷，不計神器主屬性；「加入」會把該神器的四種追傷%加到目前效果。
        </div>
      </div>
    </>
  );
}
