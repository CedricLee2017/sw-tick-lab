import { useMemo, useState } from "react";
import { ArrowLeft, Sparkles } from "lucide-react";
import { MONSTER_MAP, useStore } from "../store";
import { ArtifactStage } from "../components/ArtifactStage";
import { loadArtifactHandoff } from "../lib/artifactHandoff";
import { statsForRunes } from "../lib/stats";
import type { Build } from "../lib/optimizer";
import type { Rune } from "../lib/types";

export default function ArtifactOptimizerPage() {
  const account = useStore((s) => s.account);
  const runeMap = useStore((s) => s.runeMap);
  const [handoff, setHandoff] = useState(() => loadArtifactHandoff());

  const monster = handoff ? MONSTER_MAP.get(handoff.monsterId) : undefined;

  const builds = useMemo(() => {
    if (!handoff) return [] as Build[];
    const out: Build[] = [];
    for (const ids of handoff.builds) {
      const runes = ids.map((id) => (id ? runeMap.get(id) ?? null : null));
      const picked = runes.filter((r): r is Rune => !!r);
      out.push({
        runes,
        stats: statsForRunes(handoff.base, picked, handoff.bonus, handoff.rta, true),
        score: 0,
        eff: 0,
        sets: {},
      });
    }
    return out;
  }, [handoff, runeMap]);

  const missing = useMemo(() => {
    if (!handoff) return 0;
    let n = 0;
    for (const ids of handoff.builds) for (const id of ids) if (id && !runeMap.has(id)) n++;
    return n;
  }, [handoff, runeMap]);

  if (!account) return <div className="empty"><Sparkles size={40} /><div>尚未匯入存檔</div></div>;

  if (!handoff || !monster) {
    return (
      <div className="empty" style={{ padding: "60px 20px" }}>
        <Sparkles size={42} style={{ opacity: .35, marginBottom: 10 }} />
        <div style={{ fontWeight: 600, color: "var(--text)" }}>尚無配符資料</div>
        <div className="tiny" style={{ marginTop: 6, maxWidth: 460, textAlign: "center" }}>
          請先到「配符」頁設定條件並開始配符；選好排序後按「前往配神器」，
          系統會把目前排序前 500 組符文帶到這裡計算神器。
        </div>
        <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => { window.location.hash = "#/optimizer"; }}>
          <ArrowLeft size={13} /> 前往配符
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="row between wrap" style={{ gap: 10 }}>
          <div>
            <div className="card-title row" style={{ gap: 7 }}>
              <Sparkles size={14} className="gold" /> 配神器 · 第二階段
            </div>
            <div className="card-sub">
              來源：{monster.name} · 第一階段共 {handoff.total.toLocaleString("zh-TW")} 組，取目前排序前 {handoff.builds.length} 組 ·
              排序：{handoff.sortLabel}
            </div>
            <div className="tiny dim" style={{ marginTop: 4 }}>
              建立時間 {new Date(handoff.createdAt).toLocaleString("zh-TW")}
              {handoff.skill ? ` · 技能 S${handoff.skill.slot} ${handoff.skill.n}` : " · 尚未選擇技能"}
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm" onClick={() => { window.location.hash = "#/optimizer"; }}>
              <ArrowLeft size={13} /> 回配符調整
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => { setHandoff(loadArtifactHandoff()); }}>
              重新讀取
            </button>
          </div>
        </div>
        {missing > 0 && (
          <div className="alert warn" style={{ marginTop: 10 }}>
            有 {missing} 個符文 ID 不在目前存檔中（可能已重新匯入別的帳號）。請回配符頁重新執行一次。
          </div>
        )}
      </div>

      <ArtifactStage
        stageKey={`${handoff.createdAt}:${handoff.monsterId}:${handoff.builds.length}`}
        base={handoff.base}
        builds={builds}
        bonus={handoff.bonus}
        rta={handoff.rta}
        monster={monster}
        artifacts={account.artifacts}
        skill={handoff.skill ?? undefined}
        dmgOpts={handoff.dmgOpts}
      />
    </>
  );
}
