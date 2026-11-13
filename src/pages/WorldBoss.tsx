import { useEffect, useMemo, useState } from "react";
import { Calculator, Crown, Info, Swords, Target, Wand2 } from "lucide-react";
import { MONSTER_MAP, monsterLabel, useStore } from "../store";
import { MonsterPickerField } from "../components/MonsterPicker";
import { MonsterIcon, NumberField, fmt } from "../components/ui";
import { baseStats, statsForRunes } from "../lib/stats";
import {
  computeSkillDamage,
  loadSkillData,
  skillsForMonster,
  type DamageOptions,
  type Skill,
  type SkillData,
} from "../lib/damage";
import type { Artifact, Unit } from "../lib/types";
import { DEFAULT_WB_GRADES, damageToNextGrade, gradeForDamage, type WorldBossGrade } from "../lib/worldBoss";

type Slot = { unitId: number; skillId: number; hits: number };
type Battle = { slots: [Slot, Slot, Slot] };

const emptySlot = (): Slot => ({ unitId: 0, skillId: 0, hits: 1 });
const emptyBattle = (): Battle => ({ slots: [emptySlot(), emptySlot(), emptySlot()] });

const DEFAULT_OPTS: DamageOptions = {
  crit: "average",
  skillUps: true,
  enemyDef: 1200,
  enemyMaxHp: 100000000,
  enemyHpPct: 100,
  enemySpd: 100,
  selfHpPct: 100,
  atkBuff: 0,
  leadAtk: 0,
  defBreak: true,
  brand: true,
  ignoreDef: false,
  aliveEnemies: 1,
  alliesAlive: 3,
  useGuild: false,
  enemyEl: 0,
  useArtifacts: true,
};

export default function WorldBossPage() {
  const account = useStore((s) => s.account);
  const runeMap = useStore((s) => s.runeMap);
  const bonus = useStore((s) => s.settings.bonus);
  const rta = useStore((s) => s.settings.rta);

  const [skillData, setSkillData] = useState<SkillData | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [opts, setOpts] = useState<DamageOptions>(DEFAULT_OPTS);
  const [battles, setBattles] = useState<Battle[]>([emptyBattle(), emptyBattle(), emptyBattle()]);
  const [grades, setGrades] = useState<WorldBossGrade[]>(DEFAULT_WB_GRADES);

  useEffect(() => {
    let alive = true;
    loadSkillData()
      .then((d) => { if (alive) setSkillData(d); })
      .catch((e: unknown) => { if (alive) setSkillError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, []);

  const unitsById = useMemo(() => {
    const m = new Map<number, Unit>();
    for (const u of account?.units ?? []) m.set(u.id, u);
    return m;
  }, [account]);

  const artifactMap = useMemo(() => {
    const m = new Map<number, Artifact>();
    for (const a of account?.artifacts ?? []) m.set(a.id, a);
    return m;
  }, [account]);

  const owned = useMemo(() => {
    return (account?.units ?? []).map((u) => ({
      key: String(u.id),
      monster: (MONSTER_MAP.get(u.master) as any) ?? ({ id: u.master, name: monsterLabel(u.master), el: 0, nat: 1 } as any),
      meta: `${u.stars}★ Lv.${u.level}`,
    }));
  }, [account]);

  const setSlot = (bi: number, si: number, patch: Partial<Slot>) => {
    setBattles((prev) => prev.map((b, i) => {
      if (i !== bi) return b;
      const slots = [...b.slots] as [Slot, Slot, Slot];
      slots[si] = { ...slots[si], ...patch };
      return { ...b, slots };
    }));
  };

  const calcSlot = (slot: Slot) => {
    if (!slot.unitId) return null;
    const unit = unitsById.get(slot.unitId);
    if (!unit) return null;
    const mdef = MONSTER_MAP.get(unit.master) as any;
    const runes = unit.runes.map((id) => runeMap.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
    const arts = unit.artifacts.map((id) => artifactMap.get(id)).filter((a): a is Artifact => !!a);
    const base = mdef
      ? baseStats(mdef, unit.stars, unit.level)
      : { hp: 10000, atk: 800, def: 600, spd: 100, cr: 15, cd: 50, res: 15, acc: 0 };
    const st = statsForRunes(base as any, runes, bonus, rta, true, arts);
    const skills = skillsForMonster(skillData, unit.master);
    const skill: Skill | undefined = skills.find((s) => s.id === slot.skillId) ?? skills[0];
    if (!skill) return { stats: st, damage: 0, perHit: 0, hits: 0, skill: null as Skill | null };
    const dmg = computeSkillDamage(st, { ...skill, hits: Math.max(1, slot.hits || skill.hits || 1) }, opts, arts);
    return { stats: st, damage: dmg.total, perHit: dmg.perHit, hits: dmg.hits, skill };
  };

  const battleTotals = useMemo(() => {
    return battles.map((b) => b.slots.reduce((sum, s) => sum + (calcSlot(s)?.damage ?? 0), 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battles, skillData, runeMap, bonus, rta, opts, unitsById, artifactMap]);

  const total = battleTotals.reduce((a, b) => a + b, 0);
  const grade = gradeForDamage(total, grades);
  const next = damageToNextGrade(total, grades);

  const patchGrade = (i: number, min: number) => {
    setGrades((prev) => prev.map((g, idx) => idx === i ? { ...g, min: Math.max(0, Math.round(min)) } : g));
  };

  if (!account) {
    return <div className="empty"><Crown size={40} /><div>尚未載入存檔</div></div>;
  }

  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="row between wrap" style={{ gap: 10 }}>
          <div>
            <div className="card-title row" style={{ gap: 8 }}><Crown size={16} className="gold" /> 世界王傷害 / 分數計算</div>
            <div className="card-sub">
              以你目前的魔靈、符文與神器估算每場傷害，並加總 3 場來推估評級與配裝方向。
              {skillError ? `（技能資料載入失敗：${skillError}）` : ""}
            </div>
          </div>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <span className="chip" style={{ borderColor: grade.color, color: grade.color, fontWeight: 800 }}>{grade.grade}</span>
            <span className="mono gold" style={{ fontSize: 22, fontWeight: 800 }}>{fmt(total)}</span>
            <span className="tiny dim">總傷害</span>
          </div>
        </div>
        {next.next ? (
          <div className="tiny dim" style={{ marginTop: 6 }}>
            距離 {next.next.grade} 還差 <b className="gold">{fmt(next.need)}</b>（目標 {fmt(next.next.min)}）
          </div>
        ) : (
          <div className="tiny" style={{ marginTop: 6, color: "var(--green)" }}>已達最高評級門檻設定</div>
        )}
      </div>

      <div className="grid split-2" style={{ alignItems: "start" }}>
        <div className="col" style={{ gap: 14 }}>
          {battles.map((battle, bi) => (
            <div key={bi} className="card card-pad">
              <div className="row between" style={{ gap: 8, marginBottom: 10 }}>
                <div className="card-title row" style={{ gap: 7 }}><Swords size={14} /> 第 {bi + 1} 場</div>
                <span className="chip gold">{fmt(battleTotals[bi])}</span>
              </div>
              <div className="col" style={{ gap: 10 }}>
                {battle.slots.map((slot, si) => {
                  const res = calcSlot(slot);
                  const unit = slot.unitId ? unitsById.get(slot.unitId) : undefined;
                  const skills = unit ? skillsForMonster(skillData, unit.master) : [];
                  return (
                    <div key={si} className="card" style={{ padding: 10 }}>
                      <div className="row between wrap" style={{ gap: 8 }}>
                        <div className="row" style={{ gap: 8, minWidth: 0, flex: 1 }}>
                          {unit ? <MonsterIcon id={unit.master} size={34} /> : <div style={{ width: 34, height: 34, borderRadius: 8, background: "var(--line-soft)" }} />}
                          <div style={{ minWidth: 180, flex: 1 }}>
                            <MonsterPickerField
                              value={slot.unitId}
                              entries={owned as any}
                              label={(e: any) => e ? <>{monsterLabel(e.monster.id)} · {e.meta}</> : "選擇魔靈"}
                              onChange={(id) => setSlot(bi, si, { unitId: id, skillId: 0 })}
                            />
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div className="mono gold" style={{ fontWeight: 800 }}>{fmt(res?.damage ?? 0)}</div>
                          <div className="tiny dim">預估傷害</div>
                        </div>
                      </div>
                      {unit && (
                        <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
                          <div className="field" style={{ minWidth: 220, flex: 1 }}>
                            <label>技能</label>
                            <select className="select" value={slot.skillId || (skills[0]?.id ?? 0)} onChange={(e) => setSlot(bi, si, { skillId: Number(e.target.value) })}>
                              {skills.length === 0 && <option value={0}>無可用技能資料</option>}
                              {skills.map((sk) => <option key={sk.id} value={sk.id}>S{sk.slot} · {sk.n}{sk.hits > 1 ? ` (${sk.hits}段)` : ""}</option>)}
                            </select>
                          </div>
                          <NumberField label="段數 / 次數" value={slot.hits} min={1} max={99} onChange={(v) => setSlot(bi, si, { hits: Math.max(1, Math.round(v)) })} />
                          {res?.stats && (
                            <div className="tiny dim" style={{ alignSelf: "end", paddingBottom: 6 }}>
                              ATK {fmt(res.stats.atk)} · CD {res.stats.cd}% · CR {res.stats.cr}%
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="card card-pad">
            <div className="card-title row" style={{ gap: 7 }}><Calculator size={14} /> 傷害條件</div>
            <div className="grid g2" style={{ marginTop: 10 }}>
              <NumberField label="敵方防禦" value={opts.enemyDef} min={0} max={10000} step={50} onChange={(v) => setOpts((o) => ({ ...o, enemyDef: v }))} />
              <NumberField label="攻擊 Buff %" value={opts.atkBuff} min={0} max={200} step={10} onChange={(v) => setOpts((o) => ({ ...o, atkBuff: v }))} />
              <NumberField label="隊長攻擊 %" value={opts.leadAtk} min={0} max={100} step={1} onChange={(v) => setOpts((o) => ({ ...o, leadAtk: v }))} />
            </div>
            <div className="row wrap" style={{ gap: 12, marginTop: 10 }}>
              <label className="row tiny" style={{ gap: 6 }}><input type="checkbox" checked={opts.defBreak} onChange={(e) => setOpts((o) => ({ ...o, defBreak: e.target.checked }))} /> 破防</label>
              <label className="row tiny" style={{ gap: 6 }}><input type="checkbox" checked={opts.brand} onChange={(e) => setOpts((o) => ({ ...o, brand: e.target.checked }))} /> 烙印</label>
              <label className="row tiny" style={{ gap: 6 }}><input type="checkbox" checked={opts.skillUps} onChange={(e) => setOpts((o) => ({ ...o, skillUps: e.target.checked }))} /> 滿技能</label>
              <label className="row tiny" style={{ gap: 6 }}><input type="checkbox" checked={opts.useGuild} onChange={(e) => setOpts((o) => ({ ...o, useGuild: e.target.checked }))} /> 公會技能</label>
              <label className="row tiny" style={{ gap: 6 }}><input type="checkbox" checked={opts.useArtifacts} onChange={(e) => setOpts((o) => ({ ...o, useArtifacts: e.target.checked }))} /> 神器</label>
            </div>
            <div className="field" style={{ marginTop: 10, maxWidth: 220 }}>
              <label>暴擊模式</label>
              <select className="select" value={opts.crit} onChange={(e) => setOpts((o) => ({ ...o, crit: e.target.value as any }))}>
                <option value="average">平均</option>
                <option value="crit">必暴</option>
                <option value="normal">不暴</option>
              </select>
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: 14 }}>
          <div className="card card-pad">
            <div className="card-title row" style={{ gap: 7 }}><Target size={14} /> 評級門檻（可調整）</div>
            <div className="tiny dim" style={{ marginTop: 4 }}>世界王評級依總傷害而定，實際門檻可能隨版本/環境不同，請依你的目標調整。</div>
            <div className="col" style={{ gap: 6, marginTop: 10 }}>
              {grades.map((g, i) => (
                <div key={g.grade} className="row between" style={{ gap: 8 }}>
                  <span style={{ fontWeight: 700, color: g.color, width: 42 }}>{g.grade}</span>
                  <input className="input mono" type="number" value={g.min} onChange={(e) => patchGrade(i, Number(e.target.value))} />
                </div>
              ))}
            </div>
          </div>

          <div className="card card-pad">
            <div className="card-title row" style={{ gap: 7 }}><Wand2 size={14} /> 如何配符達到最高分數</div>
            <div className="tiny" style={{ lineHeight: 1.8, color: "var(--text)" }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>傷害估算與配裝（本頁可計算）</div>
              <ol style={{ margin: "0 0 10px", paddingLeft: 18 }}>
                <li>為每一場選出 3 隻主要輸出魔靈，並設定在世界王中實際使用的技能與段數/次數。</li>
                <li>到「一鍵配符」為單隻魔靈尋找更高傷害配置：優先確保 CR 接近 100%、CD 盡量高，再堆攻擊與技能係數屬性。</li>
                <li>常見增傷優先級：破防覆蓋、攻擊 Buff/隊長技、烙印/增傷、暴擊率 100%、暴擊傷害、攻擊力。</li>
                <li>神器優先選增加該技能傷害/屬性傷害/暴傷與追傷的詞條；本頁會計入目前已裝備神器效果。</li>
                <li>調整配裝後回本頁重算 3 場加總，比較不同方案的總傷害與評級。</li>
              </ol>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>長期穩定拿高分／好獎勵（社群常見策略）</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li><b>擴大可用魔靈池</b>：目標能組出 3 場可上場的隊伍（甚至更多備用），不要只集中在少數幾隻。</li>
                <li><b>盡量讓參戰魔靈都有符文</b>：有符文通常比沒符文貢獻更高；可先用可用的 4★/5★/6★ 符文補滿，再逐步汰換升級。</li>
                <li><b>穩定評級優先</b>：例如 3 場都拿到 D 以上，通常比一場高分、另兩場很低更能穩定獲得獎勵（依你目前門檻目標調整）。</li>
                <li><b>持續升級符文與魔靈</b>：逐步把常用/參戰魔靈的符文強化、替換更好副屬性與星等，長期分數會穩定提升。</li>
              </ul>
            </div>
            <div className="tiny dim" style={{ marginTop: 8, lineHeight: 1.7 }}>
              <Info size={12} /> 本頁傷害為基於技能倍率與面板的估算，用於比較配裝；實際世界王分數還受出手次數、Boss 機制、被動觸發與隨機波動影響，請以實戰微調。
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
