import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Copy, Info, RotateCcw, Swords } from "lucide-react";
import { MONSTER_MAP, monsterLabel, useStore } from "../store";
import { baseStats, statsForRunes } from "../lib/stats";
import {
  computeSkillDamage,
  loadSkillData,
  skillFormulaText,
  skillsForMonster,
  type DamageOptions,
  type Skill,
  type SkillData,
} from "../lib/damage";
import { MonsterPickerField } from "../components/MonsterPicker";
import { MonsterIcon, NumberField, fmt } from "../components/ui";
import type { Artifact, Stats } from "../lib/types";

/** 兩套配裝只比較這些會影響傷害的面板數值 */
interface BuildInput {
  hp: number;
  atk: number;
  def: number;
  spd: number;
  cr: number;
  cd: number;
}

const DEFAULT_A: BuildInput = { hp: 25000, atk: 1600, def: 800, spd: 150, cr: 100, cd: 150 };
const DEFAULT_B: BuildInput = { hp: 34000, atk: 1600, def: 800, spd: 150, cr: 15, cd: 150 };

const DEFAULT_OPTS: DamageOptions = {
  crit: "average",
  skillUps: true,
  enemyDef: 1000,
  enemyMaxHp: 30000,
  enemyHpPct: 100,
  enemySpd: 100,
  selfHpPct: 100,
  atkBuff: 0,
  leadAtk: 0,
  defBreak: false,
  brand: false,
  ignoreDef: false,
  aliveEnemies: 1,
  alliesAlive: 4,
  useGuild: false,
  enemyEl: 0,
  useArtifacts: true,
};

interface AdEffects {
  hp: number;
  atk: number;
  def: number;
  spd: number;
}

const ZERO_AD: AdEffects = { hp: 0, atk: 0, def: 0, spd: 0 };
const DEFAULT_AD: AdEffects = { hp: 0.3, atk: 0, def: 0, spd: 0 };

function toStats(b: BuildInput): Stats {
  return {
    hp: Math.max(0, b.hp),
    atk: Math.max(0, b.atk),
    def: Math.max(0, b.def),
    spd: Math.max(0, b.spd),
    panelSpd: Math.max(0, b.spd),
    cr: Math.max(0, Math.min(100, b.cr)),
    cd: Math.max(0, b.cd),
    res: 0,
    acc: 0,
    ehp: 0,
    tick: 0,
  };
}

/** 把「神器追傷 %」轉成計算引擎使用的最小神器資料 */
function adArtifact(effects: AdEffects, attr = 1): Artifact[] {
  const subs: Artifact["subs"] = [];
  if (effects.hp > 0) subs.push({ t: 218, v: effects.hp });
  if (effects.atk > 0) subs.push({ t: 219, v: effects.atk });
  if (effects.def > 0) subs.push({ t: 220, v: effects.def });
  if (effects.spd > 0) subs.push({ t: 221, v: effects.spd });
  if (subs.length === 0) return [];
  return [{
    id: 1,
    type: 1,
    attr,
    style: 0,
    occupied: 0,
    main: { t: 100, v: 0 },
    subs,
    level: 15,
    rank: 5,
    stars: 5,
    locked: false,
  }];
}

function diffClass(diff: number): string {
  if (diff > 0) return "dmg-diff-up";
  if (diff < 0) return "dmg-diff-down";
  return "dim";
}

function signed(v: number, digits = 0): string {
  const n = digits > 0 ? v.toFixed(digits) : fmt(Math.round(v));
  return `${v > 0 ? "+" : ""}${n}`;
}

function BuildCard({
  label,
  build,
  onChange,
  baseHp,
  monsterId,
  onImport,
  onCopy,
  importDisabled,
}: {
  label: "A" | "B";
  build: BuildInput;
  onChange: (patch: Partial<BuildInput>) => void;
  baseHp: number | null;
  monsterId: number;
  onImport: () => void;
  onCopy: () => void;
  importDisabled: boolean;
}) {
  return (
    <div className="card card-pad">
      <div className="row between wrap" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          {monsterId > 0 && <MonsterIcon id={monsterId} size={32} />}
          <div>
            <div className="card-title row" style={{ gap: 7 }}>
              <span className="dmg-build-badge">{label}</span>
              配裝 {label}
            </div>
            <div className="tiny dim">只比較會影響傷害的面板數值</div>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 5 }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onImport} disabled={importDisabled}>
            帶入目前面板
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCopy} title="複製到另一套">
            <Copy size={12} /> 複製
          </button>
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: 10 }}>
        <NumberField label="體力 HP" value={build.hp} min={0} step={1000} onChange={(v) => onChange({ hp: v })} />
        <NumberField label="攻擊 ATK" value={build.atk} min={0} step={100} onChange={(v) => onChange({ atk: v })} />
        <NumberField label="防禦 DEF" value={build.def} min={0} step={100} onChange={(v) => onChange({ def: v })} />
        <NumberField label="速度 SPD" value={build.spd} min={0} step={10} onChange={(v) => onChange({ spd: v })} />
        <NumberField label="暴擊率 CR %" value={build.cr} min={0} max={100} onChange={(v) => onChange({ cr: v })} />
        <NumberField label="暴擊傷害 CD %" value={build.cd} min={0} step={10} onChange={(v) => onChange({ cd: v })} />
      </div>

      <div className="tiny dim" style={{ marginTop: 8, lineHeight: 1.6 }}>
        4 號位參考：爆率主屬 <b>+58% CR</b>；體力%主屬 <b>+63% 基礎 HP</b>
        {baseHp != null ? `（此魔靈基礎 ${fmt(baseHp)} → 約 +${fmt(Math.round(baseHp * 0.63))} HP）` : "（選擇魔靈後顯示基礎 HP）"}。
      </div>
    </div>
  );
}

export default function DamageComparePage() {
  const account = useStore((s) => s.account);
  const settings = useStore((s) => s.settings);
  const runeMap = useStore((s) => s.runeMap);
  const notify = useStore((s) => s.notify);

  const [unitId, setUnitId] = useState(0);
  const [a, setA] = useState<BuildInput>(DEFAULT_A);
  const [b, setB] = useState<BuildInput>(DEFAULT_B);
  const [effects, setEffects] = useState<AdEffects>(DEFAULT_AD);
  const [opts, setOpts] = useState<DamageOptions>(DEFAULT_OPTS);
  const [skillData, setSkillData] = useState<SkillData | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [pickedSkillIds, setPickedSkillIds] = useState<number[]>([]);

  useEffect(() => {
    let alive = true;
    loadSkillData()
      .then((d) => { if (alive) setSkillData(d); })
      .catch((err: unknown) => { if (alive) setSkillError(err instanceof Error ? err.message : "技能資料載入失敗"); });
    return () => { alive = false; };
  }, []);

  const units = useMemo(() => {
    if (!account) return [];
    return account.units
      .map((u) => ({ u, m: MONSTER_MAP.get(u.master) }))
      .filter((x): x is { u: typeof x.u; m: NonNullable<typeof x.m> } => !!x.m)
      .sort((x, y) => x.m.name.localeCompare(y.m.name));
  }, [account]);

  const picked = units.find((x) => x.u.id === unitId);
  const monster = picked?.m ?? null;
  const base = useMemo(
    () => (picked ? baseStats(picked.m, picked.u.stars, picked.u.level) : null),
    [picked],
  );

  const skills = useMemo(
    () => skillsForMonster(skillData, monster?.id ?? 0),
    [skillData, monster?.id],
  );

  // 換魔靈時預設比較 S2 / S3；沒有 S2/S3 就全選
  useEffect(() => {
    if (skills.length === 0) {
      setPickedSkillIds([]);
      return;
    }
    const defaults = skills.filter((s) => s.slot === 2 || s.slot === 3).map((s) => s.id);
    setPickedSkillIds(defaults.length > 0 ? defaults : skills.map((s) => s.id));
  }, [skills]);

  const selectedSkills = useMemo(
    () => skills.filter((s) => pickedSkillIds.includes(s.id)),
    [skills, pickedSkillIds],
  );

  const artifact = useMemo(
    () => adArtifact(effects, monster?.el ?? 1),
    [effects, monster?.el],
  );

  const rows = useMemo(() => {
    const statsA = toStats(a);
    const statsB = toStats(b);
    return selectedSkills.map((skill) => ({
      skill,
      a: computeSkillDamage(statsA, skill, opts, artifact),
      b: computeSkillDamage(statsB, skill, opts, artifact),
    }));
  }, [a, b, opts, artifact, selectedSkills]);

  const totals = useMemo(() => {
    const aTotal = rows.reduce((s, r) => s + r.a.total, 0);
    const bTotal = rows.reduce((s, r) => s + r.b.total, 0);
    return { a: aTotal, b: bTotal, diff: bTotal - aTotal };
  }, [rows]);

  const importPanel = (target: "A" | "B") => {
    if (!picked || !account) return;
    const runes = picked.u.runes
      .map((id) => runeMap.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r);
    const artifactMap = new Map(account.artifacts.map((x) => [x.id, x]));
    const artifacts = picked.u.artifacts
      .map((id) => artifactMap.get(id))
      .filter((x): x is Artifact => !!x);
    const s = statsForRunes(
      baseStats(picked.m, picked.u.stars, picked.u.level),
      runes,
      settings.bonus,
      settings.rta,
      false,
      artifacts,
    );
    const next: BuildInput = { hp: s.hp, atk: s.atk, def: s.def, spd: s.panelSpd, cr: s.cr, cd: s.cd };
    if (target === "A") setA(next);
    else setB(next);
    notify(`已帶入 ${monsterLabel(picked.m.id)} 目前面板到配裝 ${target}`);
  };

  const copyToOther = (from: "A" | "B") => {
    if (from === "A") setB({ ...a });
    else setA({ ...b });
  };

  const toggleSkill = (id: number) => {
    setPickedSkillIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  if (!account) {
    return <div className="empty"><ArrowLeftRight size={40} /><div>尚未匯入存檔</div></div>;
  }

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 14 }}>
        <div>
          <div className="card-title row" style={{ gap: 7 }}>
            <ArrowLeftRight size={15} className="gold" /> 傷害比較
          </div>
          <div className="card-sub">
            比較兩套配裝在同一技能、同一神器追傷下的傷害；可帶入目前魔靈面板，再手動調整 4 號位主屬性造成的差異。
          </div>
        </div>
        <div style={{ minWidth: 250, flex: "0 1 340px" }}>
          <label className="tiny dim">選擇魔靈（帶入目前面板與技能）</label>
          <MonsterPickerField
            value={unitId}
            entries={units.map(({ u, m }) => ({
              key: String(u.id),
              monster: m,
              meta: `${u.stars}★Lv.${u.level}`,
            }))}
            label={(e) => (e ? <>{e.monster.name} · {e.meta}</> : "選擇魔靈…")}
            onChange={(key) => setUnitId(key)}
          />
          {monster && (
            <div className="tiny dim" style={{ marginTop: 5 }}>
              基礎 HP {fmt(base?.hp ?? 0)} · 基礎 ATK {fmt(base?.atk ?? 0)} · 基礎 CR {base?.cr ?? 0}%
            </div>
          )}
        </div>
      </div>

      <div className="grid g2" style={{ gap: 14, alignItems: "start" }}>
        <BuildCard
          label="A"
          build={a}
          onChange={(patch) => setA((prev) => ({ ...prev, ...patch }))}
          baseHp={base?.hp ?? null}
          monsterId={monster?.id ?? 0}
          onImport={() => importPanel("A")}
          onCopy={() => copyToOther("A")}
          importDisabled={!picked}
        />
        <BuildCard
          label="B"
          build={b}
          onChange={(patch) => setB((prev) => ({ ...prev, ...patch }))}
          baseHp={base?.hp ?? null}
          monsterId={monster?.id ?? 0}
          onImport={() => importPanel("B")}
          onCopy={() => copyToOther("B")}
          importDisabled={!picked}
        />
      </div>

      <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => { setA({ ...DEFAULT_A }); setB({ ...DEFAULT_B }); }}
        >
          <RotateCcw size={12} /> 重設範例（百爆 25k vs 高體 34k）
        </button>
        <span className="tiny dim" style={{ alignSelf: "center" }}>
          A = 基準；差異欄位為「B − A」
        </span>
      </div>

      <div className="card card-pad" style={{ marginTop: 14 }}>
        <div className="card-title row" style={{ gap: 7 }}><Swords size={14} className="gold" /> 比較條件</div>
        <div className="tiny dim" style={{ marginTop: 3 }}>
          兩套配裝共用相同的技能、敵人與神器追傷；只比較面板差異。
        </div>

        <div className="row wrap" style={{ gap: 10, marginTop: 10 }}>
          <div className="field" style={{ minWidth: 190 }}>
            <label>暴擊模式</label>
            <div className="tabs" style={{ width: "100%" }}>
              {([
                ["average", "平均"],
                ["crit", "暴擊"],
                ["normal", "普通"],
              ] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={`tab ${opts.crit === v ? "active" : ""}`}
                  style={{ flex: 1 }}
                  onClick={() => setOpts((o) => ({ ...o, crit: v }))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <NumberField label="敵人防禦" value={opts.enemyDef} min={0} max={5000} step={50} onChange={(v) => setOpts((o) => ({ ...o, enemyDef: v }))} />
          <NumberField label="攻擊 Buff %" value={opts.atkBuff} min={0} max={100} step={10} onChange={(v) => setOpts((o) => ({ ...o, atkBuff: v }))} />
        </div>

        <div className="row wrap dmg-checks" style={{ gap: 12, marginTop: 10 }}>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={opts.skillUps} onChange={(e) => setOpts((o) => ({ ...o, skillUps: e.target.checked }))} />
            滿技傷害
          </label>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={opts.defBreak} onChange={(e) => setOpts((o) => ({ ...o, defBreak: e.target.checked }))} />
            破防 -70%
          </label>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={opts.brand} onChange={(e) => setOpts((o) => ({ ...o, brand: e.target.checked }))} />
            烙印 +25%
          </label>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={opts.ignoreDef} onChange={(e) => setOpts((o) => ({ ...o, ignoreDef: e.target.checked }))} />
            無視防禦
          </label>
          <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={opts.useGuild} onChange={(e) => setOpts((o) => ({ ...o, useGuild: e.target.checked }))} />
            公會技能
          </label>
        </div>

        <div className="divider" />
        <div className="row between wrap" style={{ gap: 8 }}>
          <div className="card-title row" style={{ gap: 7 }}><Info size={13} className="gold" /> 神器追傷（兩套共用）</div>
          <span className="tiny dim">每段追加，不受暴擊 / 防禦減傷影響</span>
        </div>
        <div className="grid g4" style={{ marginTop: 10 }}>
          <NumberField label="體力追傷 %" value={effects.hp} min={0} max={20} step={0.1} onChange={(v) => setEffects((e) => ({ ...e, hp: v }))} />
          <NumberField label="攻擊追傷 %" value={effects.atk} min={0} max={20} step={0.5} onChange={(v) => setEffects((e) => ({ ...e, atk: v }))} />
          <NumberField label="防禦追傷 %" value={effects.def} min={0} max={20} step={0.5} onChange={(v) => setEffects((e) => ({ ...e, def: v }))} />
          <NumberField label="速度追傷 %" value={effects.spd} min={0} max={100} step={1} onChange={(v) => setEffects((e) => ({ ...e, spd: v }))} />
        </div>
        <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEffects(ZERO_AD)}>清除追傷</button>
          <span className="tiny dim" style={{ alignSelf: "center" }}>範例：0.3% 體力追傷 = 每段追加 0.3% 總 HP。</span>
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: 14 }}>
        <div className="row between wrap" style={{ gap: 8 }}>
          <div>
            <div className="card-title">技能傷害比較</div>
            <div className="tiny dim" style={{ marginTop: 3 }}>
              {skillError ? skillError : skills.length === 0 ? "這隻魔靈沒有可計算的傷害技能" : "勾選要比較的技能；預設 S2 / S3"}
            </div>
          </div>
          {skills.length > 0 && (
            <div className="row wrap" style={{ gap: 5 }}>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setPickedSkillIds(skills.filter((s) => s.slot === 2 || s.slot === 3).map((s) => s.id))}
              >
                只選 S2 / S3
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setPickedSkillIds(skills.map((s) => s.id))}
              >
                全選
              </button>
            </div>
          )}
        </div>

        {skills.length > 0 && (
          <div className="row wrap" style={{ gap: 5, marginTop: 8 }}>
            {skills.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`chip ${pickedSkillIds.includes(s.id) ? "gold" : "muted"}`}
                style={{ cursor: "pointer" }}
                onClick={() => toggleSkill(s.id)}
              >
                S{s.slot} · {s.n}
              </button>
            ))}
          </div>
        )}

        {selectedSkills.length > 0 && (
          <div className="table-scroll" style={{ marginTop: 10 }}>
            <table className="table dmg-compare-table">
              <thead>
                <tr>
                  <th>技能</th>
                  <th className="num">A 每段</th>
                  <th className="num">B 每段</th>
                  <th className="num">A 總和</th>
                  <th className="num">B 總和</th>
                  <th className="num">B − A</th>
                  <th className="num">差異 %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ skill, a: ra, b: rb }) => {
                  const diff = rb.total - ra.total;
                  const pct = ra.total > 0 ? (diff / ra.total) * 100 : 0;
                  return (
                    <tr key={skill.id}>
                      <td>
                        <b>S{skill.slot} · {skill.n}</b>
                        <div className="dmg-skill-sub">{skill.hits} 段 · {skillFormulaText(skill)}</div>
                        <div className="dmg-skill-sub">追傷/段：A {fmt(ra.adPerHit)} · B {fmt(rb.adPerHit)}</div>
                      </td>
                      <td className="num">{fmt(ra.perHit)}</td>
                      <td className="num">{fmt(rb.perHit)}</td>
                      <td className="num">{fmt(ra.total)}</td>
                      <td className="num">{fmt(rb.total)}</td>
                      <td className={`num ${diffClass(diff)}`}>{signed(diff)}</td>
                      <td className={`num ${diffClass(diff)}`}>{signed(pct, 1)}%</td>
                    </tr>
                  );
                })}
                {rows.length > 1 && (
                  <tr>
                    <td>
                      <b>所選技能合計</b>
                      <div className="dmg-skill-sub">僅供參考，不代表實際技能循環</div>
                    </td>
                    <td className="num dim">—</td>
                    <td className="num dim">—</td>
                    <td className="num">{fmt(totals.a)}</td>
                    <td className="num">{fmt(totals.b)}</td>
                    <td className={`num ${diffClass(totals.diff)}`}>{signed(totals.diff)}</td>
                    <td className={`num ${diffClass(totals.diff)}`}>
                      {totals.a > 0 ? `${signed((totals.diff / totals.a) * 100, 1)}%` : "—"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="tiny dim" style={{ marginTop: 8, lineHeight: 1.7 }}>
          每段傷害已包含技能倍率、暴擊期望、滿技、防禦減傷與神器追傷；追傷為固定值，不受暴擊與防禦影響。
          未計屬性克制、暴擊抵抗與部分特殊被動；技能資料來源 SWARFARM。
        </div>
      </div>
    </>
  );
}
