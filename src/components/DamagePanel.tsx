import { Loader2, Swords } from "lucide-react";
import { NumberField } from "./ui";
import { skillFormulaText, type DamageOptions, type Skill } from "../lib/damage";

export function DamagePanel({
  skills,
  skill,
  onSkillChange,
  enabled,
  onEnabledChange,
  opts,
  onOptsChange,
  loading,
  error,
}: {
  skills: Skill[];
  skill: Skill | undefined;
  onSkillChange: (id: number) => void;
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  opts: DamageOptions;
  onOptsChange: (patch: Partial<DamageOptions>) => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="card card-pad dmg-panel">
      <div className="row between wrap" style={{ gap: 10 }}>
        <div>
          <div className="card-title row" style={{ gap: 7 }}>
            <Swords size={14} className="gold" /> 傷害計算
          </div>
          <div className="card-sub">把每組配裝的面板代入技能倍率，結果可用「傷害」排序</div>
        </div>
        <label className="row tiny" style={{ gap: 7, cursor: "pointer" }}>
          <input type="checkbox" checked={enabled} onChange={(e) => onEnabledChange(e.target.checked)} />
          啟用
        </label>
      </div>

      {loading && (
        <div className="row tiny dim" style={{ gap: 7, marginTop: 10 }}>
          <Loader2 size={13} className="spin" /> 正在載入技能資料…
        </div>
      )}
      {error && <div className="alert err" style={{ marginTop: 10 }}>{error}</div>}
      {!loading && !error && skills.length === 0 && (
        <div className="tiny dim" style={{ marginTop: 10 }}>
          查不到這隻魔靈的可計算技能（被動或沒有傷害倍率的技能不會列出）。
        </div>
      )}

      {enabled && skill && (
        <div className="col" style={{ gap: 10, marginTop: 12 }}>
          <div className="grid g2">
            <div className="field">
              <label>技能</label>
              <select className="select" value={skill.id} onChange={(e) => onSkillChange(Number(e.target.value))}>
                {skills.map((s) => (
                  <option key={s.id} value={s.id}>
                    S{s.slot} · {s.n}{s.hits > 1 ? `（${s.hits} 段）` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>暴擊</label>
              <div className="tabs" style={{ width: "100%" }}>
                {([
                  ["crit", "暴擊"],
                  ["normal", "普通"],
                  ["average", "平均"],
                ] as const).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    className={`tab ${opts.crit === v ? "active" : ""}`}
                    style={{ flex: 1 }}
                    onClick={() => onOptsChange({ crit: v })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid g3">
            <NumberField label="敵人防禦" value={opts.enemyDef} min={0} max={5000} step={50} onChange={(v) => onOptsChange({ enemyDef: v })} />
            <NumberField label="敵人最大體力" value={opts.enemyMaxHp} min={1} max={500000} step={1000} onChange={(v) => onOptsChange({ enemyMaxHp: v })} />
            <NumberField label="敵人目前體力 %" value={opts.enemyHpPct} min={0} max={100} onChange={(v) => onOptsChange({ enemyHpPct: Math.min(100, Math.max(0, v)) })} />
          </div>
          <div className="grid g4">
            <NumberField label="敵人速度" value={opts.enemySpd} min={1} max={500} onChange={(v) => onOptsChange({ enemySpd: v })} />
            <NumberField label="自身目前 HP %" value={opts.selfHpPct} min={0} max={100} onChange={(v) => onOptsChange({ selfHpPct: Math.min(100, Math.max(0, v)) })} />
            <NumberField label="ATK Buff %" value={opts.atkBuff} min={0} max={100} step={5} onChange={(v) => onOptsChange({ atkBuff: v })} hint="一般 50%" />
            <NumberField label="隊長 ATK %" value={opts.leadAtk} min={0} max={50} onChange={(v) => onOptsChange({ leadAtk: v })} />
          </div>

          <div className="row wrap dmg-checks" style={{ gap: 12 }}>
            <label className="row tiny" style={{ gap: 6, cursor: skill.up > 0 ? "pointer" : "default", opacity: skill.up > 0 ? 1 : .5 }}>
              <input type="checkbox" disabled={skill.up <= 0} checked={opts.skillUps && skill.up > 0} onChange={(e) => onOptsChange({ skillUps: e.target.checked })} />
              滿技傷害 +{skill.up}%
            </label>
            <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={opts.ignoreDef} onChange={(e) => onOptsChange({ ignoreDef: e.target.checked })} />
              無視防禦
            </label>
            <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={opts.defBreak} onChange={(e) => onOptsChange({ defBreak: e.target.checked })} />
              破防 -70%
            </label>
            <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={opts.brand} onChange={(e) => onOptsChange({ brand: e.target.checked })} />
              烙印 +25%
            </label>
            <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={opts.useGuild} onChange={(e) => onOptsChange({ useGuild: e.target.checked })} />
              公會技能（傷害 / EHP）
            </label>
          </div>

          <div className="dmg-formula">
            <div className="row between wrap" style={{ gap: 6 }}>
              <span className="tiny dim">公式</span>
              <span className="mono tiny" style={{ color: "#cfdcf7" }}>{skillFormulaText(skill)}</span>
            </div>
            {/\{Relative SPD\}|\{Life Share\}|\{Life Share \(AOE\)\}|\{Surviving Allies\}|\{Alive Enemies\}|\{Living Ally %\}|\{Alive Allies %\}/.test(skill.f) && (
              <div className="alert warn" style={{ padding: "7px 9px", fontSize: 11 }}>
                此技能含有需依實戰情況（相對速度、生命分享、存活人數）計算的條件，數值僅為粗略估算。
              </div>
            )}
            <div className="tiny dim" style={{ lineHeight: 1.6 }}>
              {skill.hits > 1 ? `每段傷害 × ${skill.hits} 段；` : ""}
              {skill.aoe ? "群體技能，以下為單一目標傷害；" : ""}
              一般召喚師技能（Battle，含競技場圖騰 / 屬性塔）一律計入傷害與 EHP，但不會加進面板數值；公會技能（Guild）預設不計入，可用上方「公會技能」勾選加入。
              防禦減傷以 1000 / (1140 + 3.5 × 敵人防禦) 計算（無視防禦時為 1000 / 1140 ≈ 0.877）；滿技與暴擊為相加，未計屬性克制、神器、暴擊抵抗與部分特殊被動，數值為估算。
              {skill.e.includes(23) && " 炸彈技能：無視防禦、不會暴擊。"}
              {skill.e.includes(38) && " 此技能帶有無視防禦效果，已預設勾選。"}
              技能資料來源：SWARFARM。
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
