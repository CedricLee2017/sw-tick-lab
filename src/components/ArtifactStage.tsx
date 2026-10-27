import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, Play, Sparkles } from "lucide-react";
import { useStore, monsterLabel } from "../store";
import { ArtifactCard, RuneCard, TickBadge, fmt, setColor } from "./ui";
import { ELEMENTS } from "../lib/constants";
import { defaultSkill, type DamageOptions, type Skill } from "../lib/damage";
import type { Build } from "../lib/optimizer";
import { runStage2, type Stage2Mode, type Stage2Output } from "../lib/stage2";
import { setSummary, type BaseStats } from "../lib/stats";
import type { Artifact, BonusConfig, Monster } from "../lib/types";

const MAIN_OPTIONS = [
  { value: 0, label: "不限" },
  { value: 100, label: "體力（固定）" },
  { value: 101, label: "攻擊（固定）" },
  { value: 102, label: "防禦（固定）" },
];

const MAX_SKILLS = 5;

export function ArtifactStage({
  stageKey,
  base,
  builds,
  bonus,
  rta,
  monster,
  artifacts,
  skills,
  dmgOpts,
}: {
  /** 換魔靈、換排序或重新配符時要清空第二階段結果 */
  stageKey: string;
  base: BaseStats;
  builds: Build[];
  bonus: BonusConfig;
  rta: boolean;
  monster: Monster;
  artifacts: Artifact[];
  skills: Skill[];
  dmgOpts: DamageOptions;
}) {
  const account = useStore((s) => s.account);
  const [mode, setMode] = useState<Stage2Mode>("skill");
  const [main1, setMain1] = useState(0);
  const [main2, setMain2] = useState(0);
  const [enemyEl, setEnemyEl] = useState(0);
  const [selected, setSelected] = useState<{ id: number; weight: number }[]>([]);
  const [out, setOut] = useState<Stage2Output | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openPair, setOpenPair] = useState(-1);
  const [openRunes, setOpenRunes] = useState(-1);

  const runeOwner = useMemo(() => {
    const m = new Map<number, string>();
    if (!account) return m;
    for (const u of account.units) for (const rid of u.runes) m.set(rid, monsterLabel(u.master));
    return m;
  }, [account]);

  const artifactOwner = useMemo(() => {
    const m = new Map<number, string>();
    if (!account) return m;
    for (const u of account.units) for (const aid of u.artifacts) m.set(aid, monsterLabel(u.master));
    return m;
  }, [account]);

  // 換魔靈時，預設選最後一招；換排序 / 重算配符時清空結果
  useEffect(() => {
    setOut(null);
    setOpenPair(-1);
    setOpenRunes(-1);
    setError(null);
  }, [stageKey]);

  useEffect(() => {
    setSelected((prev) => {
      const valid = prev.filter((x) => skills.some((s) => s.id === x.id));
      if (valid.length > 0) return valid;
      const d = defaultSkill(skills) ?? skills[0];
      return d ? [{ id: d.id, weight: 10 }] : [];
    });
  }, [skills]);

  const toggleSkill = (id: number) => {
    setSelected((prev) => {
      if (prev.some((x) => x.id === id)) return prev.filter((x) => x.id !== id);
      if (prev.length >= MAX_SKILLS) return prev;
      return [...prev, { id, weight: 10 }];
    });
  };

  const setWeight = (id: number, weight: number) => {
    setSelected((prev) => prev.map((x) => (x.id === id ? { ...x, weight } : x)));
  };

  const run = () => {
    if (selected.length === 0) {
      setError("請至少選擇 1 招技能。");
      return;
    }
    const skillInputs = selected
      .map((x) => ({ skill: skills.find((s) => s.id === x.id), weight: x.weight }))
      .filter((x): x is { skill: Skill; weight: number } => !!x.skill && x.weight > 0);
    if (skillInputs.length === 0) {
      setError("技能比重必須大於 0。");
      return;
    }
    setRunning(true);
    setError(null);
    setOut(null);
    setOpenPair(-1);
    setOpenRunes(-1);
    // 讓「運算中」先畫出來，再做同步計算（25 對 × 前 500 組）
    window.setTimeout(() => {
      try {
        setOut(
          runStage2({
            base,
            builds,
            bonus,
            rta,
            monster,
            artifacts,
            skills: skillInputs,
            mode,
            main1,
            main2,
            dmgOpts: { ...dmgOpts, enemyEl, useArtifacts: true },
            perType: 5,
          }),
        );
        setOpenPair(0);
      } catch (err) {
        setError(`第二階段運算失敗：${String((err as Error)?.message ?? err)}`);
      } finally {
        setRunning(false);
      }
    }, 30);
  };

  const shown = out?.pairs.slice(0, 10) ?? [];

  return (
    <div className="card card-pad artifact-stage">
      <div className="row between wrap" style={{ gap: 10 }}>
        <div>
          <div className="card-title row" style={{ gap: 7 }}>
            <Sparkles size={14} className="gold" /> 第二階段：神器最佳化
          </div>
          <div className="card-sub">
            取目前排序前 {fmt(builds.length)} 組符文；每類神器取前 5 件（屬性 5 + 類型 5，含其他魔靈裝備中的神器），共 25 對
          </div>
        </div>
        <span className="chip gold">符文不變 · 只換神器</span>
      </div>

      <div className="grid g2" style={{ marginTop: 12 }}>
        <div className="field">
          <label>模式（兩個獨立分數）</label>
          <div className="tabs" style={{ width: "100%" }}>
            {([
              ["skill", "招式傷害"],
              ["add", "追傷"],
            ] as const).map(([v, label]) => (
              <button key={v} type="button" className={`tab ${mode === v ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setMode(v)}>
                {label}
              </button>
            ))}
          </div>
          <span className="hint">
            {mode === "skill"
              ? "依 5 招技能的加權「招式傷害」排序（追傷另計顯示）"
              : "依 5 招技能的加權「追傷」排序（招式傷害另計顯示）"}
          </span>
        </div>
        <div className="field">
          <label>敵方屬性（屬性神器「對屬性傷害」）</label>
          <select className="select" value={enemyEl} onChange={(e) => setEnemyEl(Number(e.target.value))}>
            <option value={0}>未指定（不計屬性傷害加成）</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{ELEMENTS[n as 1].name}屬性</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: 10 }}>
        <div className="field">
          <label>屬性神器主屬性</label>
          <select className="select" value={main1} onChange={(e) => setMain1(Number(e.target.value))}>
            {MAIN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>類型神器主屬性</label>
          <select className="select" value={main2} onChange={(e) => setMain2(Number(e.target.value))}>
            {MAIN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <div className="field" style={{ marginTop: 10 }}>
        <div className="row between">
          <label>技能（最多 {MAX_SKILLS} 招，權重 1–10）</label>
          <span className="tiny dim">已選 {selected.length}/{MAX_SKILLS}</span>
        </div>
        <div className="col artifact-skill-list">
          {skills.map((s) => {
            const cur = selected.find((x) => x.id === s.id);
            const full = selected.length >= MAX_SKILLS && !cur;
            return (
              <div key={s.id} className={`artifact-skill-row ${cur ? "on" : ""}`}>
                <label className="row" style={{ gap: 7, flex: 1, cursor: full ? "not-allowed" : "pointer", opacity: full ? .45 : 1 }}>
                  <input type="checkbox" checked={!!cur} disabled={full} onChange={() => toggleSkill(s.id)} />
                  <span style={{ minWidth: 0 }}>
                    <b>S{s.slot}</b> · {s.n}
                    <span className="dim tiny">（{s.hits} 段{s.aoe ? " · 群體" : ""}）</span>
                  </span>
                </label>
                {cur && (
                  <select className="select" style={{ width: 78 }} value={cur.weight} onChange={(e) => setWeight(s.id, Number(e.target.value))}>
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>權重 {n}</option>)}
                  </select>
                )}
              </div>
            );
          })}
          {skills.length === 0 && <div className="empty tiny">這隻魔靈沒有可計算的技能</div>}
        </div>
      </div>

      <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
        <button className="btn btn-primary" onClick={run} disabled={running || builds.length === 0 || selected.length === 0}>
          {running ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
          {running ? "運算中…" : "開始第二階段"}
        </button>
        <span className="tiny dim" style={{ alignSelf: "center" }}>
          每個模式分開排序；神器主屬性固定值、技能暴傷、屬性傷害與追傷都會計入
        </span>
      </div>
      {error && <div className="alert err" style={{ marginTop: 10 }}>{error}</div>}

      {out && (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--line-soft)", paddingTop: 12 }}>
          <div className="row between wrap" style={{ gap: 8 }}>
            <div className="card-title">
              最佳神器組合 <span className="dim tiny" style={{ fontWeight: 400 }}>前 10 對 / 共 {out.pairs.length} 對</span>
            </div>
            <span className="tiny dim">
              屬性 {out.type1.length} 件 · 類型 {out.type2.length} 件 · 運算 {out.builds} 組符文 · {out.ms} ms
            </span>
          </div>
          {out.warnings.map((w) => <div key={w} className="alert warn" style={{ marginTop: 8, padding: "7px 9px", fontSize: 11.5 }}>{w}</div>)}

          <div className="col" style={{ gap: 10, marginTop: 10 }}>
            {shown.map((p, i) => {
              const open = openPair === i;
              const runesOpen = openRunes === i;
              return (
                <div key={`${p.artifacts[0].id}-${p.artifacts[1].id}`} className="stage2-pair">
                  <div className="row between wrap" style={{ gap: 8, cursor: "pointer" }} onClick={() => setOpenPair(open ? -1 : i)}>
                    <div className="row" style={{ gap: 8, minWidth: 0 }}>
                      <span className={`build-rank ${i === 0 ? "top" : ""}`}>{i + 1}</span>
                      <span className="chip gold">
                        {mode === "skill" ? "加權招式傷害" : "加權追傷"} {fmt(Math.round(p.score))}
                      </span>
                      <span className="chip muted">加權總傷害 {fmt(Math.round(p.total))}</span>
                      <TickBadge spd={p.stats.spd} rta={rta} />
                      <span className="tiny dim">{setSummary(BuildSets(p))}</span>
                    </div>
                    <ChevronDown size={16} className="dim" style={{ transform: open ? "rotate(180deg)" : undefined, transition: ".15s" }} />
                  </div>

                  <div className="grid g2" style={{ gap: 8, marginTop: 8 }}>
                    {p.artifacts.map((a) => <ArtifactCard key={a.id} artifact={a} owner={artifactOwner.get(a.id)} />)}
                  </div>

                  <div className="row wrap tiny" style={{ gap: 12, marginTop: 8, color: "var(--muted)" }}>
                    <span>HP <b className="mono" style={{ color: "var(--text)" }}>{fmt(p.stats.hp)}</b></span>
                    <span>ATK <b className="mono" style={{ color: "var(--text)" }}>{fmt(p.stats.atk)}</b></span>
                    <span>DEF <b className="mono" style={{ color: "var(--text)" }}>{fmt(p.stats.def)}</b></span>
                    <span>SPD <b className="mono" style={{ color: "var(--text)" }}>{p.stats.spd}</b></span>
                    <span>EHP <b className="mono" style={{ color: "var(--text)" }}>{fmt(p.stats.ehp)}</b></span>
                    <span className="dim">裝備符文：{p.build.runes.filter(Boolean).length}/6</span>
                  </div>

                  {open && (
                    <div style={{ marginTop: 10 }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>技能</th>
                            <th className="num">權重</th>
                            <th className="num">段數</th>
                            <th className="num">招式傷害</th>
                            <th className="num">追傷</th>
                            <th className="num">合計</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.lines.map((l) => (
                            <tr key={l.skill.id}>
                              <td>S{l.skill.slot} · {l.skill.n}</td>
                              <td className="num">{l.weight}</td>
                              <td className="num">{l.skill.hits}</td>
                              <td className="num">{fmt(l.base)}</td>
                              <td className="num green">{fmt(l.ad)}</td>
                              <td className="num"><b>{fmt(l.total)}</b></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
                        <button className="btn btn-sm" onClick={() => setOpenRunes(runesOpen ? -1 : i)}>
                          {runesOpen ? "收起符文" : "查看這組符文"}
                        </button>
                        <span className="tiny dim" style={{ alignSelf: "center" }}>
                          加權招式 {fmt(Math.round(p.base))} · 加權追傷 {fmt(Math.round(p.ad))} · 加權合計 {fmt(Math.round(p.total))}
                        </span>
                      </div>
                      {runesOpen && (
                        <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, marginTop: 8 }}>
                          {[1, 2, 3, 4, 5, 6].map((slot) => {
                            const r = p.build.runes[slot - 1];
                            return r ? (
                              <RuneCard key={slot} rune={r} compact owner={runeOwner.get(r.id)} />
                            ) : (
                              <div key={slot} className="rune rune-empty"><span className="tiny dim">位置 {slot} 無符文</span></div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** 第二階段最佳配置的套裝件數 */
function BuildSets(p: { build: Build }): Record<number, number> {
  const sets: Record<number, number> = {};
  for (const r of p.build.runes) if (r) sets[r.set] = (sets[r.set] ?? 0) + 1;
  return sets;
}
