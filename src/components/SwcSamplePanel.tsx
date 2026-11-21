/** RTA Deck → SWC sample：SWC2026 Special Battle 支援魔靈（唯讀） */
import { useMemo, useState } from "react";
import { Search, Swords } from "lucide-react";
import { ELEMENTS } from "../lib/constants";
import {
  SWC_SAMPLE_COLLECTED_AT,
  SWC_SAMPLE_SOURCE,
  SWC_SAMPLE_UNITS,
  swcUnitName,
  type SwcSampleUnit,
} from "../lib/swcSample";
import { ArtifactCard, Modal, MonsterIcon, MonsterPanel, RuneBoard, RuneCard, TickBadge } from "./ui";

export function SwcSamplePanel() {
  const [q, setQ] = useState("");
  const [el, setEl] = useState(0);
  const [detail, setDetail] = useState<SwcSampleUnit | null>(null);

  const units = useMemo(() => {
    const term = q.trim().toLowerCase();
    return SWC_SAMPLE_UNITS.filter((unit) => {
      if (el && unit.monster?.el !== el) return false;
      if (!term) return true;
      return swcUnitName(unit).toLowerCase().includes(term) || String(unit.master).includes(term);
    });
  }, [q, el]);

  const summary = useMemo(() => {
    const withStats = SWC_SAMPLE_UNITS.filter((unit) => unit.stats);
    const avgSpd = withStats.length
      ? withStats.reduce((sum, unit) => sum + (unit.stats?.spd ?? 0), 0) / withStats.length
      : 0;
    const avgHp = withStats.length
      ? withStats.reduce((sum, unit) => sum + (unit.stats?.hp ?? 0), 0) / withStats.length
      : 0;
    const fastest = withStats.reduce<SwcSampleUnit | null>(
      (best, unit) => (!best || (unit.stats?.spd ?? 0) > (best.stats?.spd ?? 0) ? unit : best),
      null,
    );
    return { avgSpd, avgHp, fastest };
  }, []);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card">
        <div className="card-head">
          <div style={{ minWidth: 0 }}>
            <div className="card-title">
              <Swords size={14} className="gold" style={{ verticalAlign: -2, marginRight: 5 }} />
              SWC sample
              <span className="dim tiny" style={{ fontWeight: 400, marginLeft: 6 }}>
                {SWC_SAMPLE_UNITS.length} 隻支援魔靈
              </span>
            </div>
            <div className="card-sub">
              SWC2026 Special Battle 的支援魔靈，包含活動預先配好的符文、神器與遺物。
              這裡是唯讀資料，不會改寫你的帳號或 RTA 配裝。
            </div>
            <div className="tiny dim" style={{ marginTop: 4 }}>
              來源：{SWC_SAMPLE_SOURCE}
              {SWC_SAMPLE_COLLECTED_AT ? ` · 擷取 ${new Date(SWC_SAMPLE_COLLECTED_AT).toLocaleString("zh-TW")}` : ""}
            </div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            <div style={{ position: "relative" }}>
              <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: "var(--muted-2)" }} />
              <input
                className="input"
                style={{ width: 190, paddingLeft: 28 }}
                placeholder="搜尋魔靈…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <select className="select" style={{ width: 120 }} value={el} onChange={(e) => setEl(Number(e.target.value))}>
              <option value={0}>全部屬性</option>
              {Object.entries(ELEMENTS).map(([id, element]) => (
                <option key={id} value={id}>{element.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="card-pad col" style={{ gap: 12 }}>
          <div className="grid g4">
            <div className="stat-tile">
              <div className="k">支援魔靈</div>
              <div className="v">{SWC_SAMPLE_UNITS.length}<span className="u">隻</span></div>
              <div className="tiny dim">全部都有 6 顆符文 + 2 件神器</div>
            </div>
            <div className="stat-tile">
              <div className="k">平均速度</div>
              <div className="v">{summary.avgSpd.toFixed(1)}</div>
              <div className="tiny dim">只計符文 / 套裝 / 神器</div>
            </div>
            <div className="stat-tile">
              <div className="k">平均 HP</div>
              <div className="v">{Math.round(summary.avgHp).toLocaleString("en-US")}</div>
              <div className="tiny dim">只計支援魔靈的面板</div>
            </div>
            <div className="stat-tile">
              <div className="k">最快</div>
              <div className="v" style={{ fontSize: 16 }}>{summary.fastest ? swcUnitName(summary.fastest) : "—"}</div>
              <div className="tiny dim">{summary.fastest?.stats ? `${summary.fastest.stats.spd} 速` : ""}</div>
            </div>
          </div>

          {units.length === 0 ? (
            <div className="empty" style={{ padding: "26px 16px" }}>沒有符合條件的支援魔靈。</div>
          ) : (
            <div className="swc-sample-grid">
              {units.map((unit) => (
                <button
                  key={unit.id}
                  type="button"
                  className="swc-sample-card"
                  onClick={() => setDetail(unit)}
                  title={`${swcUnitName(unit)} · 點擊查看符文與神器`}
                >
                  <MonsterIcon id={unit.master} size={46} />
                  <span className="swc-sample-name">{swcUnitName(unit)}</span>
                  <span className="tiny dim">
                    {ELEMENTS[(unit.monster?.el ?? 0) as 1]?.name ?? "?"} · {unit.stars}★
                  </span>
                  <span className="row" style={{ gap: 4, alignItems: "baseline" }}>
                    <b className="gold mono">{unit.stats?.spd ?? "—"}</b>
                    <span className="tiny dim">速</span>
                    {unit.stats && <TickBadge spd={unit.stats.spd} rta />}
                  </span>
                  <span className="tiny dim swc-sample-set">{unit.setText}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {detail && (
        <Modal title={`SWC sample · ${swcUnitName(detail)}`} onClose={() => setDetail(null)} width={760}>
          <div className="col" style={{ gap: 12 }}>
            <div className="row between wrap" style={{ gap: 8 }}>
              <div>
                <div className="card-title" style={{ marginBottom: 2 }}>{swcUnitName(detail)}</div>
                <div className="tiny dim">
                  {ELEMENTS[(detail.monster?.el ?? 0) as 1]?.name ?? "?"} · {detail.stars}★ Lv.{detail.level}
                  {detail.stats ? ` · ${detail.stats.spd} 速` : ""}
                </div>
              </div>
              {detail.stats && <TickBadge spd={detail.stats.spd} rta />}
            </div>

            {detail.monster && detail.stats && detail.base ? (
              <MonsterPanel
                monster={detail.monster}
                base={detail.base}
                stats={detail.stats}
                stars={detail.stars}
                level={detail.level}
                artifacts={detail.artifacts}
                name="SWC sample"
              />
            ) : (
              <div className="empty tiny" style={{ padding: "14px" }}>
                這隻新魔靈的基礎資料尚未收錄，但仍可查看活動配好的符文與神器。
              </div>
            )}

            <div className="row between" style={{ marginTop: 4 }}>
              <div className="card-title">符文</div>
              <span className="tiny dim">{detail.setText}</span>
            </div>
            {detail.bonusText && (
              <div className="tiny" style={{ color: "var(--muted)", lineHeight: 1.7 }}>
                符文合計：{detail.bonusText}
              </div>
            )}
            <RuneBoard runes={detail.runes} renderRune={(rune) => <RuneCard rune={rune} owner="SWC sample" />} />
            <div className="tiny dim">
              官方支援資料只提供部分符文欄位（部分 slot 的主屬性 / 副屬性為 0）；上方「符文合計」是活動提供的彙總數值。
            </div>

            <div className="row between" style={{ marginTop: 4 }}>
              <div className="card-title">神器</div>
              <span className="tiny dim">{detail.artifacts.length} / 2</span>
            </div>
            {detail.artifacts.length === 0 ? (
              <div className="empty tiny">沒有神器資料</div>
            ) : (
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }}>
                {detail.artifacts.map((artifact) => (
                  <ArtifactCard key={artifact.id} artifact={artifact} owner="SWC sample" />
                ))}
              </div>
            )}

            {detail.relics.length > 0 && (
              <div className="tiny dim">
                活動另有 {detail.relics.length} 件遺物；目前專案尚未建模遺物，因此面板數值未計入。
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
