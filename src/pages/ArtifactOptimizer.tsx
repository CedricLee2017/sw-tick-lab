import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { MONSTER_MAP, monsterLabel, useStore, type Loadout } from "../store";
import { ArtifactStage } from "../components/ArtifactStage";
import { DamagePanel } from "../components/DamagePanel";
import { ArtifactCard, MonsterIcon, MonsterPanel, TickBadge } from "../components/ui";
import { MonsterPickerField } from "../components/MonsterPicker";
import { defaultSkill, loadSkillData, skillsForMonster, type DamageOptions, type SkillData } from "../lib/damage";
import { baseStats, statsForRunes } from "../lib/stats";
import type { Build } from "../lib/optimizer";
import type { Artifact, Rune } from "../lib/types";

export default function ArtifactOptimizerPage() {
  const account = useStore((s) => s.account);
  const settings = useStore((s) => s.settings);
  const loadouts = useStore((s) => s.loadouts);
  const notify = useStore((s) => s.notify);
  const runeMap = useStore((s) => s.runeMap);
  const [unitId, setUnitId] = useState(0);
  const [saved, setSaved] = useState<Loadout | null>(null);
  const [autoRunKey, setAutoRunKey] = useState(0);
  const [skillData, setSkillData] = useState<SkillData | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [skillLoading, setSkillLoading] = useState(true);
  const [skillId, setSkillId] = useState(0);
  const [dmgOpts, setDmgOpts] = useState<DamageOptions>(() => ({
    crit: "crit",
    skillUps: true,
    enemyDef: 800,
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
    useGuild: settings.bonus.useGuild,
    enemyEl: 0,
    useArtifacts: false,
  }));
  const patchDmg = (patch: Partial<DamageOptions>) => setDmgOpts((o) => ({ ...o, ...patch }));

  useEffect(() => {
    let alive = true;
    loadSkillData()
      .then((d) => { if (alive) { setSkillData(d); setSkillLoading(false); } })
      .catch((err) => { if (alive) { setSkillError(String(err?.message ?? err)); setSkillLoading(false); } });
    return () => { alive = false; };
  }, []);

  const units = useMemo(() => {
    if (!account) return [];
    return account.units
      .map((u) => ({ u, m: MONSTER_MAP.get(u.master) }))
      .filter((x) => !!x.m);
  }, [account]);

  const picked = units.find((x) => x.u.id === unitId) ?? null;
  const monster = picked?.m;
  const unit = picked?.u;

  const monsterSkills = useMemo(
    () => (skillData && monster ? skillsForMonster(skillData, monster.id) : []),
    [skillData, monster],
  );
  const dmgSkill = useMemo(
    () => monsterSkills.find((s) => s.id === skillId) ?? defaultSkill(monsterSkills),
    [monsterSkills, skillId],
  );

  useEffect(() => {
    if (monsterSkills.length === 0) { setSkillId(0); return; }
    if (!monsterSkills.some((s) => s.id === skillId)) setSkillId(defaultSkill(monsterSkills)?.id ?? 0);
  }, [monsterSkills, skillId]);

  const artifactMap = useMemo(() => new Map((account?.artifacts ?? []).map((a) => [a.id, a])), [account]);

  /** 有選收藏配裝時用收藏的符文；否則用魔靈目前裝備 */
  const sourceRunes = useMemo(() => {
    if (!unit) return [] as Rune[];
    const ids = saved ? saved.runeIds : unit.runes;
    return ids.map((id) => runeMap.get(id)).filter((r): r is Rune => !!r);
  }, [unit, saved, runeMap]);

  const build = useMemo<Build | null>(() => {
    if (!account || !unit || !monster) return null;
    const base = baseStats(monster, unit.stars, unit.level);
    return {
      runes: sourceRunes,
      stats: statsForRunes(base, sourceRunes, settings.bonus, settings.rta, true),
      score: 0,
      eff: 0,
      sets: {},
    };
  }, [account, unit, monster, sourceRunes, settings.bonus, settings.rta]);

  const currentArtifacts = useMemo(
    () => (unit?.artifacts ?? []).map((id) => artifactMap.get(id)).filter((a): a is Artifact => !!a),
    [unit, artifactMap],
  );

  const currentStats = useMemo(() => {
    if (!account || !unit || !monster) return null;
    const base = baseStats(monster, unit.stars, unit.level);
    return statsForRunes(base, sourceRunes, settings.bonus, settings.rta, true, currentArtifacts);
  }, [account, unit, monster, sourceRunes, currentArtifacts, settings.bonus, settings.rta]);

  const missingSaved = useMemo(
    () => (saved ? saved.runeIds.filter((id) => !runeMap.has(id)).length : 0),
    [saved, runeMap],
  );

  const pickUnit = (id: number) => {
    setUnitId(id);
    setSaved(null);
    setSkillId(0);
  };

  const applySaved = (l: Loadout) => {
    const target = units.find((x) => x.u.id === l.unitId) ?? units.find((x) => x.m!.id === l.monsterId);
    if (!target) return notify("找不到這組收藏對應的魔靈", "err");
    setUnitId(target.u.id);
    setSaved(l);
    setSkillId(0);
    setAutoRunKey((k) => k + 1);
    notify(`已選擇收藏配裝「${l.name}」，開始計算神器`);
  };

  if (!account) return <div className="empty"><Sparkles size={40} /><div>尚未匯入存檔</div></div>;

  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="row between wrap" style={{ gap: 12 }}>
          <div>
            <div className="card-title row" style={{ gap: 7 }}>
              <Sparkles size={14} className="gold" /> 配神器 · 使用目前魔靈與裝備符文
            </div>
            <div className="card-sub">
              不重新配符：直接以目前魔靈的裝備符文（或已儲存的符文組合）為固定基礎，替換並比較最佳神器組合。
            </div>
          </div>
          <div style={{ minWidth: 280, flex: "0 1 400px" }}>
            <label className="tiny dim">魔靈</label>
            <div className="row" style={{ gap: 6 }}>
              <div style={{ flex: 1 }}>
                <MonsterPickerField
                  value={unitId}
                  entries={units.map(({ u, m }) => ({
                    key: String(u.id),
                    monster: m!,
                    meta: `${u.stars}★Lv.${u.level} · ${u.runes.length}/6 符文`,
                  }))}
                  label={(e) => (e ? <>{e.monster.name} · {e.meta}</> : "選擇魔靈…")}
                  onChange={pickUnit}
                />
              </div>
              {unitId > 0 && (
                <button type="button" className="btn btn-ghost btn-sm btn-icon" title="清除" onClick={() => pickUnit(0)}>
                  <X size={13} />
                </button>
              )}
            </div>
            {picked && (
              <div className="tiny dim" style={{ marginTop: 4 }}>
                目前：{monster!.name} · {unit!.stars}★Lv.{unit!.level}
              </div>
            )}
          </div>
        </div>

        {picked && monster && unit ? (
          <div style={{ marginTop: 12 }}>
            {currentStats && (
              <MonsterPanel
                monster={monster}
                base={baseStats(monster, unit.stars, unit.level)}
                stats={currentStats}
                stars={unit.stars}
                level={unit.level}
                artifacts={currentArtifacts}
                badge={<TickBadge spd={currentStats.spd} rta={settings.rta} />}
              />
            )}
            <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
              <span className="chip muted">{sourceRunes.length}/6 符文</span>
              <span className="chip muted">目前神器 {currentArtifacts.length}/2</span>
              {saved && <span className="chip gold" title={saved.name}>使用收藏：{saved.name}</span>}
            </div>
            {saved && (
              <div className="row wrap" style={{ gap: 6, marginTop: 7 }}>
                <span className="tiny dim">符文來源：已儲存的配裝（不變動目前裝備）</span>
                <button className="btn btn-sm btn-ghost" style={{ padding: "1px 7px", fontSize: 10.5 }} onClick={() => setSaved(null)}>
                  改用目前裝備
                </button>
                {missingSaved > 0 && <span className="tiny red">缺少 {missingSaved} 顆符文</span>}
              </div>
            )}
          </div>
        ) : (
          <div className="empty tiny" style={{ marginTop: 12 }}>輸入或選擇一隻魔靈，系統會讀取牠目前裝備的符文與神器。</div>
        )}

        {picked && currentArtifacts.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="tiny dim" style={{ marginBottom: 5 }}>目前裝備神器（會被配神器結果替換）</div>
            <div className="grid g2" style={{ gap: 8 }}>
              {currentArtifacts.map((a) => <ArtifactCard key={a.id} artifact={a} owner={monster?.name} />)}
            </div>
          </div>
        )}
      </div>

      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="row between wrap" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 7 }}>
            <span className="focus-title">已儲存的魔靈符文組合</span>
            <span className="tiny dim">點一下即可選擇該魔靈與符文，並立即計算神器</span>
          </div>
          <a className="tiny" href="#/builds">管理儲存庫 →</a>
        </div>
        {loadouts.length === 0 ? (
          <div className="tiny dim" style={{ marginTop: 7 }}>
            尚無收藏。到配符結果按「儲存為配裝」，就會出現在這裡。
          </div>
        ) : (
          <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
            {loadouts.slice(0, 16).map((l) => (
              <button
                key={l.id}
                type="button"
                className={`saved-build-card ${saved?.id === l.id ? "on" : ""}`}
                onClick={() => applySaved(l)}
                title={`${l.name} · ${l.stats.spd} 速`}
              >
                <MonsterIcon id={l.monsterId} size={30} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 11.5, fontWeight: 700 }}>{monsterLabel(l.monsterId)}</span>
                  <span className="tiny dim">T{l.stats.tick} · {l.stats.spd} 速 · {l.runeIds.length}/6</span>
                </span>
              </button>
            ))}
            {loadouts.length > 16 && <span className="tiny dim" style={{ alignSelf: "center" }}>+{loadouts.length - 16}</span>}
          </div>
        )}
      </div>

      {picked && (
        <div style={{ marginBottom: 14 }}>
          <DamagePanel
            skills={monsterSkills}
            skill={dmgSkill}
            onSkillChange={setSkillId}
            enabled
            onEnabledChange={() => {}}
            showEnable={false}
            opts={dmgOpts}
            onOptsChange={patchDmg}
            loading={skillLoading}
            error={skillError}
          />
        </div>
      )}

      {picked && build && (
        <ArtifactStage
          stageKey={`${unitId}:${saved?.id ?? "current"}:${dmgSkill?.id ?? 0}:${sourceRunes.map((r) => r.id).join("-")}`}
          base={baseStats(monster!, unit!.stars, unit!.level)}
          builds={[build]}
          bonus={{ ...settings.bonus, useGuild: dmgOpts.useGuild, grind: true }}
          rta={settings.rta}
          monster={monster!}
          artifacts={account.artifacts}
          skill={dmgSkill}
          dmgOpts={dmgOpts}
          autoRunKey={autoRunKey}
          sourceLabel={saved ? `收藏配裝「${saved.name}」` : "目前裝備符文"}
        />
      )}
    </>
  );
}
