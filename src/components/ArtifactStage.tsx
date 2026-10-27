import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2, Play, Plus, Sparkles, X } from "lucide-react";
import { useStore, monsterLabel } from "../store";
import { ArtifactCard, RuneCard, TickBadge, fmt, setColor } from "./ui";
import { ELEMENTS } from "../lib/constants";
import { ARTIFACT_EFFECT_MAX, artifactAutoLabels, artifactEffectLabel } from "../lib/artifacts";
import type { DamageOptions, Skill } from "../lib/damage";
import type { Build } from "../lib/optimizer";
import { runStage2, type Stage2Focus, type Stage2Mode, type Stage2Output } from "../lib/stage2";
import { setSummary, type BaseStats } from "../lib/stats";
import type { Artifact, BonusConfig, Monster } from "../lib/types";

const MAIN_OPTIONS = [
  { value: 0, label: "不限" },
  { value: 100, label: "體力（固定）" },
  { value: 101, label: "攻擊（固定）" },
  { value: 102, label: "防禦（固定）" },
];

const EFFECT_IDS = Object.keys(ARTIFACT_EFFECT_MAX).map(Number).sort((a, b) => a - b);
const MAX_FOCUS = 5;

const defaultFocus = (): Stage2Focus => ({ effect: 219, min: 0, max: ARTIFACT_EFFECT_MAX[219], weight: 10 });

export function ArtifactStage({
  stageKey,
  base,
  builds,
  bonus,
  rta,
  monster,
  artifacts,
  skill,
  dmgOpts,
  autoRunKey = 0,
  sourceLabel = "目前裝備符文",
}: {
  /** 換魔靈、換排序、換技能或重新配符時要清空第二階段結果 */
  stageKey: string;
  base: BaseStats;
  builds: Build[];
  bonus: BonusConfig;
  rta: boolean;
  monster: Monster;
  artifacts: Artifact[];
  skill?: Skill;
  dmgOpts: DamageOptions;
  /** 數字變動時自動執行一次（用於點擊收藏配裝後立即計算） */
  autoRunKey?: number;
  /** 符文來源說明（目前裝備 / 收藏配裝） */
  sourceLabel?: string;
}) {
  const account = useStore((s) => s.account);
  const [mode, setMode] = useState<Stage2Mode>("skill");
  const [main1, setMain1] = useState(0);
  const [main2, setMain2] = useState(0);
  const [enemyEl, setEnemyEl] = useState(0);
  const [focus1, setFocus1] = useState<Stage2Focus[]>([]);
  const [focus2, setFocus2] = useState<Stage2Focus[]>([]);
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

  // 換魔靈 / 排序 / 技能或重算配符時清空結果
  useEffect(() => {
    setOut(null);
    setOpenPair(-1);
    setOpenRunes(-1);
    setError(null);
  }, [stageKey]);

  const run = () => {
    if (!skill) {
      setError("請先在上方傷害面板選擇一招技能。");
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
            skill,
            mode,
            main1,
            main2,
            focus1,
            focus2,
            dmgOpts: { ...dmgOpts, enemyEl, useArtifacts: true },
            perType: 5,
          }),
        );
        setOpenPair(0);
      } catch (err) {
        setError(`配神器運算失敗：${String((err as Error)?.message ?? err)}`);
      } finally {
        setRunning(false);
      }
    }, 30);
  };

  // 從收藏配裝點選後，自動執行一次
  const autoRef = useRef(0);
  useEffect(() => {
    if (!autoRunKey || autoRef.current === autoRunKey) return;
    if (!skill || builds.length === 0) return;
    autoRef.current = autoRunKey;
    const t = window.setTimeout(() => run(), 60);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunKey, skill?.id, builds.length]);

  const shown = out?.pairs.slice(0, 10) ?? [];
  const scoreLabel = mode === "skill" ? "招式傷害" : "追傷";
  const auto = artifactAutoLabels(monster);

  return (
    <div className="card card-pad artifact-stage">
      <div className="row between wrap" style={{ gap: 10 }}>
        <div>
          <div className="card-title row" style={{ gap: 7 }}>
            <Sparkles size={14} className="gold" /> 神器最佳化
          </div>
          <div className="card-sub">
            {builds.length === 1
              ? `使用${sourceLabel}（固定），不重新配符；每類神器取前 5 件（屬性 5 + 類型 5，含其他魔靈裝備中的神器），共 25 對`
              : `取目前排序前 ${fmt(builds.length)} 組符文；每類神器取前 5 件（屬性 5 + 類型 5，含其他魔靈裝備中的神器），共 25 對`}
          </div>
          <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            <span className="chip muted" title="依魔靈屬性自動決定，另包含無形屬性神器">
              屬性神器：{auto.attribute}（含無形）
            </span>
            <span className="chip muted" title="依魔靈類型自動決定，另包含無形類型神器">
              類型神器：{auto.archetype}（含無形）
            </span>
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
              ? "依單一招式的傷害排序；追傷另計顯示"
              : "依單一招式的追傷排序；招式傷害另計顯示"}
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

      <div className="field" style={{ marginTop: 10 }}>
        <label>計算技能（沿用上方傷害面板）</label>
        {skill ? (
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="chip gold">S{skill.slot} · {skill.n}</span>
            <span className="tiny dim">{skill.hits} 段{skill.aoe ? " · 群體" : ""}</span>
            <span className="tiny dim">· 追傷會 × {skill.hits} 段</span>
          </div>
        ) : (
          <div className="alert warn" style={{ padding: "7px 9px", fontSize: 11.5 }}>請先在上方傷害面板選擇一招技能。</div>
        )}
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

      <div className="grid g2" style={{ marginTop: 10 }}>
        <FocusEditor title="屬性神器 Focus" value={focus1} onChange={setFocus1} />
        <FocusEditor title="類型神器 Focus" value={focus2} onChange={setFocus2} />
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        Focus 是硬性 Min / Max 篩選：每條選定效果都要符合才會進入候選。有設定 Focus 時，先依契合度（數值 ÷ 該效果上限 × 權重）排序，同分再比傷害 / 追傷。
      </div>

      <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
        <button className="btn btn-primary" onClick={run} disabled={running || builds.length === 0 || !skill}>
          {running ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
          {running ? "運算中…" : "開始配神器"}
        </button>
        <span className="tiny dim" style={{ alignSelf: "center" }}>
          神器主屬性固定值、技能暴傷、屬性傷害與追傷都會計入
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
              屬性 {out.type1.length} 件 · 類型 {out.type2.length} 件 · {out.builds === 1 ? `使用${sourceLabel}` : `運算 ${out.builds} 組符文`} · {out.ms} ms
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
                      <span className="chip gold">{scoreLabel} {fmt(Math.round(p.score))}</span>
                      <span className="chip muted">合計 {fmt(Math.round(p.total))}</span>
                      <TickBadge spd={p.stats.spd} rta={rta} />
                      <span className="tiny dim">{setSummary(BuildSets(p))}</span>
                      {(p.focus[0] > 0 || p.focus[1] > 0) && (
                        <span className="chip muted" title="Focus 契合度（數值 ÷ 效果上限 × 權重）">
                          Focus {Math.round(p.focus[0])}% / {Math.round(p.focus[1])}%
                        </span>
                      )}
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
                            <th className="num">段數</th>
                            <th className="num">招式傷害</th>
                            <th className="num">追傷</th>
                            <th className="num">合計</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>S{skill?.slot} · {skill?.n}</td>
                            <td className="num">{p.hits}</td>
                            <td className="num">{fmt(p.base)}</td>
                            <td className="num green">{fmt(p.ad)}</td>
                            <td className="num"><b>{fmt(p.total)}</b></td>
                          </tr>
                        </tbody>
                      </table>
                      <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
                        <button className="btn btn-sm" onClick={() => setOpenRunes(runesOpen ? -1 : i)}>
                          {runesOpen ? "收起符文" : "查看這組符文"}
                        </button>
                        <span className="tiny dim" style={{ alignSelf: "center" }}>
                          招式傷害 {fmt(Math.round(p.base))} · 追傷 {fmt(Math.round(p.ad))} · 合計 {fmt(Math.round(p.total))}
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

function FocusEditor({
  title,
  value,
  onChange,
}: {
  title: string;
  value: Stage2Focus[];
  onChange: (v: Stage2Focus[]) => void;
}) {
  const update = (i: number, patch: Partial<Stage2Focus>) => {
    onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  };
  const add = () => {
    if (value.length >= MAX_FOCUS) return;
    onChange([...value, defaultFocus()]);
  };
  return (
    <div className="focus-panel">
      <div className="row between" style={{ gap: 8 }}>
        <span className="focus-title">{title}</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={add} disabled={value.length >= MAX_FOCUS}>
          <Plus size={12} /> 新增效果
        </button>
      </div>
      {value.length === 0 ? (
        <div className="tiny dim" style={{ padding: "4px 0" }}>未設定 Focus：此類神器只依主屬性與傷害 / 追傷排序。</div>
      ) : (
        <div className="col" style={{ gap: 5, marginTop: 5 }}>
          {value.map((f, i) => {
            const max = ARTIFACT_EFFECT_MAX[f.effect] ?? 100;
            const step = f.effect === 218 ? 0.1 : 1;
            return (
              <div className="artifact-focus-row" key={i}>
                <select
                  className="select"
                  value={f.effect}
                  onChange={(e) => {
                    const effect = Number(e.target.value);
                    update(i, { effect, max: ARTIFACT_EFFECT_MAX[effect] ?? 100 });
                  }}
                >
                  {EFFECT_IDS.map((id) => <option key={id} value={id}>{artifactEffectLabel(id)}</option>)}
                </select>
                <div className="artifact-focus-range">
                  <span className="tiny dim">Min</span>
                  <input className="input mono" type="number" min={0} max={max} step={step} value={f.min} onChange={(e) => update(i, { min: Number(e.target.value) || 0 })} />
                  <span className="tiny dim">Max</span>
                  <input className="input mono" type="number" min={0} max={max} step={step} value={f.max} onChange={(e) => update(i, { max: Number(e.target.value) || 0 })} />
                </div>
                <select className="select" style={{ width: 78 }} value={f.weight} onChange={(e) => update(i, { weight: Number(e.target.value) })}>
                  {Array.from({ length: 10 }, (_, n) => n + 1).map((n) => <option key={n} value={n}>權重 {n}</option>)}
                </select>
                <button type="button" className="btn btn-sm btn-ghost btn-icon" title="移除" onClick={() => onChange(value.filter((_, j) => j !== i))}>
                  <X size={13} />
                </button>
              </div>
            );
          })}
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
