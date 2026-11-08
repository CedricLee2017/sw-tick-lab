import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Ban, Castle, Clock, Download, Info, Map as MapIcon, RotateCcw, StickyNote, Target, Trophy, Upload, X, Sword, Sprout, Flame,
} from "lucide-react";
import { useStore } from "../store";
import { Modal, NumberField, NumberInput } from "../components/ui";
import {
  SIEGE_MAP_VERSION, SIEGE_TARGET_SCORE, SIEGE_TEMPLATE_BY_ID, SIEGE_TEMPLATES,
  analyzeSiege, createSiegeState, defaultSiegeTower, exportSiegeJSON, formatSiegeDuration,
  importSiegeJSON, loadSiegeState, otherSiegeGuild, saveSiegeState, setTowerSwords, siegeSwordOwner, siegeTowerName,
  type SiegeAnalysis, type SiegeGuild, type SiegeState, type SiegeTower,
} from "../lib/siege";

const GUILD_TEXT: Record<SiegeGuild, string> = { Blue: "藍隊", Red: "紅隊" };
const GUILD_LABEL: Record<SiegeGuild, string> = { Blue: "藍隊", Red: "紅隊" };
const GUILD_COLOR: Record<SiegeGuild, string> = { Blue: "#3b82f6", Red: "#ef4444" };

interface TowerDraft {
  color: SiegeGuild;
  pingNumber: number;
  prohibit: boolean;
  memo: string;
  hpPercentage: number;
  swords: number;
}

function analysisLine(a: SiegeAnalysis, color: SiegeGuild): string {
  const g = a[color];
  return `${g.connectedTowers} 座連線 · ${g.increment} 分/分`;
}

function GuildCard({
  color, analysis, state, onChange,
}: {
  color: SiegeGuild;
  analysis: SiegeAnalysis;
  state: SiegeState;
  onChange: (value: number) => void;
}) {
  const g = analysis[color];
  const score = color === "Blue" ? state.stats.guildMatchScore : state.stats.oppGuild1MatchScore;
  const reached = score >= SIEGE_TARGET_SCORE;
  const time = reached ? "已達標" : formatSiegeDuration(g.secondsToWin);
  const progress = Math.max(0, Math.min(1, score / SIEGE_TARGET_SCORE));

  return (
    <div className={`card siege-guild-card siege-guild-${color.toLowerCase()}`}>
      <div className="siege-guild-head">
        <span className="siege-guild-dot" style={{ background: GUILD_COLOR[color] }} />
        <div style={{ minWidth: 0 }}>
          <div className="card-title">{GUILD_LABEL[color]}</div>
          <div className="card-sub">先到 {SIEGE_TARGET_SCORE.toLocaleString("en-US")} 分獲勝</div>
        </div>
        <span className={`chip ${color === "Blue" ? "" : "red"}`} style={{ marginLeft: "auto" }}>
          {g.increment} 分/分
        </span>
      </div>

      <div className="siege-guild-score">
        <NumberInput
          className="input mono siege-score-input"
          value={score}
          min={0}
          max={SIEGE_TARGET_SCORE}
          step={100}
          fallback={0}
          onChange={onChange}
        />
        <span className="siege-score-suffix">分</span>
      </div>

      <div className="siege-progress" title={`${score.toLocaleString("en-US")} / ${SIEGE_TARGET_SCORE.toLocaleString("en-US")}`}>
        <i style={{ width: `${progress * 100}%`, background: GUILD_COLOR[color] }} />
      </div>

      <div className="siege-guild-stats">
        <div className="siege-stat">
          <div className="k"><Trophy size={11} /> 連線塔</div>
          <div className="v">{g.connectedTowers} <span>/ {Math.max(g.towerTotal, g.connectedTowers)}</span></div>
        </div>
        <div className="siege-stat">
          <div className="k"><Clock size={11} /> 預估勝利</div>
          <div className="v">{time}</div>
        </div>
        <div className="siege-stat">
          <div className="k"><Target size={11} /> 每分鐘</div>
          <div className="v">+{g.increment}</div>
        </div>
      </div>
    </div>
  );
}

function SwordBoard({ towers, onPick }: { towers: SiegeTower[]; onPick: (tower: SiegeTower) => void }) {
  const sides = (["Blue", "Red"] as const).map((color) => {
    const attacked = towers.filter((t) => t.color !== color && t.swords > 0);
    return {
      color,
      seeds: attacked.filter((t) => t.swords === 1),
      building: attacked.filter((t) => t.swords >= 2 && t.swords <= 3),
      ready: attacked.filter((t) => t.swords >= 4),
    };
  });

  return (
    <div className="card card-pad siege-sword-board">
      <div className="row between wrap" style={{ gap: 12 }}>
        <div>
          <div className="card-title row" style={{ gap: 7 }}><Sword size={15} /> 劍數看板</div>
          <div className="card-sub">1 劍＝種、4 劍＝可爆、5 劍儲存後會自動爆塔</div>
        </div>
        <span className="chip muted">點晶片可直接編輯該塔</span>
      </div>

      <div className="siege-sword-grid">
        {sides.map(({ color, seeds, building, ready }) => (
          <div key={color} className="siege-sword-side" data-guild={color}>
            <div className="row between">
              <span className="row" style={{ gap: 7 }}>
                <span className="siege-guild-dot" style={{ background: GUILD_COLOR[color] }} />
                <b>{GUILD_TEXT[color]}的進攻</b>
              </span>
              <span className="mono tiny">{seeds.length} 種 · {ready.length} 可爆</span>
            </div>
            <div className="siege-sword-list">
              {seeds.map((t) => (
                <button key={t.id} type="button" className="siege-sword-chip is-seed" onClick={() => onPick(t)} title={`${siegeTowerName(t)} · 1/5`}>
                  {siegeTowerName(t)} <b>種</b>
                </button>
              ))}
              {ready.map((t) => (
                <button key={t.id} type="button" className="siege-sword-chip is-ready" onClick={() => onPick(t)} title={`${siegeTowerName(t)} · ${t.swords}/5`}>
                  {siegeTowerName(t)} <b>{t.swords}/5</b>
                </button>
              ))}
              {building.length > 0 && (
                <span className="siege-sword-building">
                  推進中：{building.map((t) => `${siegeTowerName(t)} ${t.swords}/5`).join("、")}
                </span>
              )}
              {seeds.length + building.length + ready.length === 0 && <span className="dim tiny">還沒有插劍</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SwordCalculator() {
  const [ourWins, setOurWins] = useState(0);
  const [theirWins, setTheirWins] = useState(0);
  const [ourCost, setOurCost] = useState(5);
  const [theirCost, setTheirCost] = useState(5);

  const oc = Math.max(1, Math.round(ourCost));
  const tc = Math.max(1, Math.round(theirCost));
  const ourConv = Math.floor(ourWins / oc);
  const theirConv = Math.floor(theirWins / tc);
  const ourNext = oc - (ourWins % oc);
  const theirNext = tc - (theirWins % tc);
  const first = ourNext === theirNext ? "同時" : ourNext < theirNext ? "我方" : "對方";
  const ourPer20 = Math.floor(20 / oc);
  const theirPer20 = Math.floor(20 / tc);

  return (
    <div className="card card-pad siege-calc">
      <div className="card-title row" style={{ gap: 7 }}><Flame size={15} /> 5 劍匯率試算</div>
      <div className="card-sub">從 12/12 開始的理論值；實際還要看目前塔數與連線</div>

      <div className="grid g2" style={{ marginTop: 12 }}>
        <NumberField label="我方勝場（劍）" value={ourWins} min={0} max={999} onChange={setOurWins} />
        <NumberField label="對方勝場（劍）" value={theirWins} min={0} max={999} onChange={setTheirWins} />
        <NumberField label="我方每塔成本（劍）" value={ourCost} min={1} max={10} onChange={setOurCost} />
        <NumberField label="對方每塔成本（劍）" value={theirCost} min={1} max={10} onChange={setTheirCost} />
      </div>

      <div className="siege-calc-result">
        <div><span>我方轉換</span><b>{ourConv} 次</b><span className="dim">再 {ourNext} 劍下一次</span></div>
        <div><span>對方轉換</span><b>{theirConv} 次</b><span className="dim">再 {theirNext} 劍下一次</span></div>
        <div><span>下一個變現</span><b>{first}</b><span className="dim">先變現者 → 13/11（+20）</span></div>
        <div><span>每 20 劍可換</span><b>我 {ourPer20} / 對 {theirPer20} 塔</b><span className="dim">差 {ourPer20 - theirPer20} 塔</span></div>
      </div>
    </div>
  );
}

export default function SiegeSimulatorPage() {
  const notify = useStore((s) => s.notify);
  const [tab, setTab] = useState<"map" | "tactics" | "faq">("map");
  const [state, setState] = useState<SiegeState>(() => loadSiegeState());
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<TowerDraft | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const analysis = useMemo(() => analyzeSiege(state.towers, state.stats), [state]);

  useEffect(() => {
    saveSiegeState(state);
  }, [state]);

  const towerById = useMemo(() => new Map(state.towers.map((t) => [t.id, t])), [state.towers]);

  const openTower = (tower: SiegeTower) => {
    setEditing(tower.id);
    setDraft({
      color: tower.color,
      pingNumber: tower.pingNumber,
      prohibit: tower.prohibit,
      memo: tower.memo,
      hpPercentage: tower.hpPercentage,
      swords: tower.swords,
    });
  };

  const closeEditor = () => {
    setEditing(null);
    setDraft(null);
  };

  const patchDraft = (patch: Partial<TowerDraft>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const saveTower = () => {
    if (editing == null || !draft) return;
    const current = towerById.get(editing);
    if (!current) return;
    const captured = draft.swords >= 5;
    const merged: SiegeTower = {
      ...current,
      ...draft,
      memo: draft.memo.slice(0, 100),
    };
    const applied = setTowerSwords(merged, draft.swords);
    setState((prev) => ({
      ...prev,
      towers: prev.towers.map((t) => (t.id === editing ? applied : t)),
    }));
    if (captured) {
      const winner = otherSiegeGuild(draft.color);
      notify(`已爆塔：${siegeTowerName(current)} → ${GUILD_TEXT[winner]}`);
    }
    closeEditor();
  };

  const resetTower = () => {
    if (editing == null) return;
    const base = defaultSiegeTower(editing);
    if (!base) return;
    setDraft({
      color: base.color,
      pingNumber: base.pingNumber,
      prohibit: base.prohibit,
      memo: base.memo,
      hpPercentage: base.hpPercentage,
      swords: 0,
    });
  };

  const setScore = (color: SiegeGuild, value: number) => {
    setState((prev) => ({
      ...prev,
      stats: {
        ...prev.stats,
        [color === "Blue" ? "guildMatchScore" : "oppGuild1MatchScore"]: Math.max(0, Math.min(SIEGE_TARGET_SCORE, value)),
      },
    }));
  };

  const resetAll = () => {
    if (!window.confirm("要清除所有塔的顏色、目標、備註與血量，並把比分歸零嗎？")) return;
    setState(createSiegeState());
    notify("已重設據點戰模擬器");
  };

  const exportFile = () => {
    const blob = new Blob([exportSiegeJSON(state)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `SWGT_siegeTournamentSimulator_${Date.now()}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("已匯出模擬器存檔");
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const result = importSiegeJSON(text);
    if (!result.ok || !result.state) {
      notify(result.error ?? "匯入失敗");
      return;
    }
    setState(result.state);
    notify(result.warning ?? "已匯入模擬器存檔");
  };

  const editingTower = editing == null ? undefined : towerById.get(editing);
  const selectedId = editingTower?.id ?? null;
  const totalIncrement = analysis.Blue.increment + analysis.Red.increment;

  return (
    <>
      <div className="row between wrap" style={{ marginBottom: 16, gap: 10 }}>
        <div className="tabs">
          <button className={`tab ${tab === "map" ? "active" : ""}`} onClick={() => setTab("map")}>
            <MapIcon size={13} /> 地圖
          </button>
          <button className={`tab ${tab === "tactics" ? "active" : ""}`} onClick={() => setTab("tactics")}>
            <Sword size={13} /> 戰術
          </button>
          <button className={`tab ${tab === "faq" ? "active" : ""}`} onClick={() => setTab("faq")}>
            <Info size={13} /> 說明
          </button>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="chip muted">地圖版本 {SIEGE_MAP_VERSION}</span>
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
            <Upload size={13} /> 匯入
          </button>
          <button className="btn btn-sm" onClick={exportFile}>
            <Download size={13} /> 匯出
          </button>
          <button className="btn btn-sm btn-ghost" onClick={resetAll}>
            <RotateCcw size={13} /> 全部重設
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              void importFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {tab === "map" && (
        <>
          <div className="grid g2" style={{ marginBottom: 16 }}>
            <GuildCard color="Blue" analysis={analysis} state={state} onChange={(v) => setScore("Blue", v)} />
            <GuildCard color="Red" analysis={analysis} state={state} onChange={(v) => setScore("Red", v)} />
          </div>

          <div className="card siege-map-card">
            <div className="card-head wrap">
              <div>
                <div className="card-title">據點戰地圖</div>
                <div className="card-sub">點一下塔就能改公會、目標樣式、備註與剩餘血量；比分與連線會立即更新</div>
              </div>
              <div className="siege-legend">
                <span><i className="lg lg-blue" /> 藍隊</span>
                <span><i className="lg lg-red" /> 紅隊</span>
                <span><i className="lg lg-target" /> 目標 T1–T5</span>
                <span><i className="lg lg-ban" /> 禁止</span>
                <span><i className="lg lg-seed" /> 種（1 劍）</span>
                <span><i className="lg lg-ready" /> 可爆（4 劍）</span>
                <span><i className="lg lg-cut" /> 未連線</span>
              </div>
            </div>

            <div className="siege-map-scroll">
              <div className="siege-map" style={{ width: 900, height: 552 }}>
                <div className="siege-zone siege-zone-blue">藍隊領域</div>
                <div className="siege-zone siege-zone-red">紅隊領域</div>

                <svg className="siege-lines" width={900} height={552} viewBox="0 0 900 552" aria-hidden="true">
                  {SIEGE_TEMPLATES.map((a) =>
                    a.connections
                      .filter((id) => id > a.id)
                      .map((id) => {
                        const b = SIEGE_TEMPLATE_BY_ID.get(id);
                        const ta = towerById.get(a.id);
                        const tb = b ? towerById.get(id) : undefined;
                        if (!b || !ta || !tb) return null;
                        const same = ta.color === tb.color;
                        const selected = selectedId === ta.id || selectedId === tb.id;
                        const stroke = selected
                          ? "rgba(242,198,92,.9)"
                          : same
                            ? (ta.color === "Blue" ? "rgba(59,130,246,.5)" : "rgba(239,68,68,.5)")
                            : "rgba(139,156,192,.22)";
                        return (
                          <line
                            key={`${a.id}-${id}`}
                            x1={a.x + 25}
                            y1={a.y + 25}
                            x2={b.x + 25}
                            y2={b.y + 25}
                            stroke={stroke}
                            strokeWidth={selected ? 3 : 2}
                            strokeLinecap="round"
                          />
                        );
                      }),
                  )}
                </svg>

                {state.towers.map((tower) => {
                  const tpl = SIEGE_TEMPLATE_BY_ID.get(tower.id)!;
                  const connected = tower.isHQ || analysis.connected[tower.id] === true;
                  const selected = selectedId === tower.id;
                  const g = analysis[tower.color];
                  const name = siegeTowerName(tower);
                  return (
                    <button
                      key={tower.id}
                      type="button"
                      className={[
                        "siege-tower",
                        tower.shape === "Shield" ? "is-shield" : "is-circle",
                        tower.isHQ ? "is-hq" : "",
                        connected ? "" : "is-cut",
                        selected ? "is-selected" : "",
                        tower.swords === 1 ? "has-seed" : "",
                        tower.swords >= 4 ? "is-ready" : "",
                      ].filter(Boolean).join(" ")}
                      style={{ left: tpl.x, top: tpl.y, "--tower": GUILD_COLOR[tower.color] } as CSSProperties}
                      onClick={() => openTower(tower)}
                      aria-label={`${name}，${GUILD_TEXT[tower.color]}${tower.prohibit ? "，禁止" : tower.pingNumber ? `，目標 T${tower.pingNumber}` : ""}${tower.swords > 0 ? `，劍數 ${tower.swords}/5` : ""}`}
                    >
                      <span className="siege-tower-face">
                        {tower.isHQ ? <Castle size={19} /> : <span className="siege-tower-id">{tower.slot}</span>}
                      </span>

                      {tower.swords > 0 && (
                        <span className={`siege-pips ${tower.swords >= 4 ? "ready" : tower.swords === 1 ? "seed" : ""}`} aria-hidden="true">
                          {[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < tower.swords ? "on" : ""} />)}
                        </span>
                      )}
                      {tower.swords === 1 && <span className="siege-tag siege-tag-seed">種</span>}
                      {tower.swords >= 4 && <span className="siege-tag siege-tag-ready">{tower.swords}/5</span>}

                      {tower.pingNumber > 0 && <span className="siege-badge siege-badge-ping">T{tower.pingNumber}</span>}
                      {tower.prohibit && (
                        <span className="siege-badge siege-badge-ban">
                          <Ban size={10} />
                        </span>
                      )}
                      {tower.memo && (
                        <span className="siege-note" aria-hidden="true">
                          <StickyNote size={9} />
                        </span>
                      )}
                      {!tower.isHQ && tower.showProgressBar && (
                        <span className="siege-hp">
                          <i style={{ width: `${tower.hpPercentage}%`, background: GUILD_COLOR[tower.color] }} />
                        </span>
                      )}

                      <span className={`siege-tip${tpl.y < 210 ? " tip-below" : ""}`}>
                        <b>{name}</b>
                        <span>#{tower.id} · {GUILD_TEXT[tower.color]} · {g.increment} 分/分</span>
                        {!connected && <span className="warn">未連線到{g.color === "Blue" ? "藍隊" : "紅隊"}本營</span>}
                        {tower.prohibit && <span>禁止攻擊</span>}
                        {!tower.prohibit && tower.pingNumber > 0 && <span>目標 T{tower.pingNumber}</span>}
                        {!tower.isHQ && <span>HP {tower.hpPercentage}% · 剩餘防守 {tower.defenseCount}</span>}
                        {tower.swords > 0 && (
                          <span>劍數 {tower.swords}/5（{GUILD_TEXT[siegeSwordOwner(tower)]} 攻擊）</span>
                        )}
                        {tower.memo && <em>{tower.memo}</em>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="siege-map-foot">
              <span><Trophy size={12} /> 雙方合計 {totalIncrement} 分/分</span>
              <span className="dim">手機可左右滑動地圖；設定會自動保存在這台裝置。</span>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <SwordBoard towers={state.towers} onPick={openTower} />
          </div>

          <div className="card card-pad" style={{ marginTop: 16 }}>
            <div className="row between wrap" style={{ gap: 12 }}>
              <div>
                <div className="card-title">連線摘要</div>
                <div className="card-sub">只有從本營沿著同色塔走得到的塔才會計分</div>
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="chip">{GUILD_TEXT.Blue}：{analysisLine(analysis, "Blue")}</span>
                <span className="chip red">{GUILD_TEXT.Red}：{analysisLine(analysis, "Red")}</span>
              </div>
            </div>
            <div className="siege-summary-grid">
              {(["Blue", "Red"] as const).map((color) => {
                const g = analysis[color];
                return (
                  <div key={color} className="siege-summary-box" data-guild={color}>
                    <div className="row between">
                      <span className="row" style={{ gap: 7 }}>
                        <span className="siege-guild-dot" style={{ background: GUILD_COLOR[color] }} />
                        <b>{GUILD_TEXT[color]}</b>
                      </span>
                      <span className="mono">{g.connectedTowers}/{Math.max(g.towerTotal, g.connectedTowers)} 連線</span>
                    </div>
                    <div className="siege-route">
                      {g.connectedIds.map((id) => (
                        <span key={id} className="siege-route-node" title={siegeTowerName(towerById.get(id)!)}>
                          {towerById.get(id)?.isHQ ? "HQ" : towerById.get(id)?.slot}
                        </span>
                      ))}
                      {g.connectedIds.length === 0 && <span className="dim tiny">沒有連到本營</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {tab === "tactics" && (
        <>
          <div style={{ marginBottom: 16 }}>
            <SwordBoard towers={state.towers} onPick={openTower} />
          </div>

          <div className="card siege-tactic-hero">
            <div className="card-head">
              <div>
                <div className="card-title row" style={{ gap: 7 }}><Sword size={15} /> 核心：5 劍 → 第 13 座塔</div>
                <div className="card-sub">12/12 時雙方 24 分/分；一次「沒有被回應的 5 劍」變現，就是 13/11 → 46/22。</div>
              </div>
              <span className="chip gold">+24 分/分</span>
            </div>
            <div className="card-pad siege-tactic-nums">
              <div><span>12 / 12</span><b>24 vs 24</b><em>13h 53m</em></div>
              <div><span>淨 +1 塔</span><b>46 vs 22</b><em>7h 14m vs 15h 09m</em></div>
              <div><span>淨 +2 塔</span><b>48 vs 20</b><em>緩衝：要被搶 2 次才會掉 +20</em></div>
            </div>
          </div>

          <div className="grid split-2" style={{ marginTop: 16 }}>
            <div className="card card-pad col" style={{ gap: 14 }}>
              <div className="card-title row" style={{ gap: 8 }}><Flame size={15} /> 5 劍匯率戰</div>
              <ol className="siege-faq-list">
                <li><b>KPI 是每塔成本</b>：我方勝場 ÷ 拿到的塔數。你的成本 &lt; 5、對方 &gt; 5，塔差自然出現。</li>
                <li><b>5 劍要集中變現</b>：同時打三座 2/5 等於沒有優勢；選一座最脆的塔，先打到 5 劍。</li>
                <li><b>防守抬價</b>：讓對方每座花超過 5 劍。一座守到 7 劍才掉，你在匯率上賺 2 劍。</li>
                <li><b>看轉換次數差</b>：不是看總劍數。5 劍＝1 次轉換，塔差移動 2 座。</li>
                <li><b>領先買緩衝</b>：13 座時任何一座掉都會掉 +20；要補到 14 座才安全。</li>
              </ol>
            </div>

            <div className="card card-pad col" style={{ gap: 14 }}>
              <div className="card-title row" style={{ gap: 8 }}><Sprout size={15} /> 種劍（1 劍期權）</div>
              <ul className="siege-faq-list">
                <li><b>1 劍＝期權</b>：先付 1 劍，保留之後補 4 劍爆塔的權利；總成本仍是 5。</li>
                <li><b>橋塔優先</b>：藍打紅 <b>38</b>、紅打藍 <b>12</b>；在上面種 1 劍等於放一個隨時可觸發的 +20。</li>
                <li><b>2–3 個種就夠</b>：太多會把 5 劍拆散，tempo 會落後。</li>
                <li><b>威脅值 = 種的數量 × 手上能立即投入的劍</b>；沒有劍的種只是裝飾。</li>
                <li><b>1 劍種、4 劍爆</b>：對方主力壓哪座，就爆另一座；對方分散，就爆橋塔。</li>
              </ul>
            </div>

            <div className="card card-pad col" style={{ gap: 12 }}>
              <div className="card-title row" style={{ gap: 8 }}><Target size={15} /> 什麼時候種、什麼時候推</div>
              <div className="table-scroll">
                <table className="table siege-tactic-table">
                  <thead><tr><th>情況</th><th>建議</th></tr></thead>
                  <tbody>
                    <tr><td>勝率較高、劍數有盈餘</td><td>種 2–3 座，橋塔優先</td></tr>
                    <tr><td>對方喜歡中途斷你</td><td>種，避免 4/5 被斷</td></tr>
                    <tr><td>你落後、需要 tempo</td><td>少種，集中推一座先變現</td></tr>
                    <tr><td>你已經 4/5</td><td>直接爆，不要再種</td></tr>
                    <tr><td>對方 4/5 橋塔</td><td>先阻止或對爆，不要只顧種</td></tr>
                    <tr><td>塔連不回自己本營</td><td>不要種，爆了也不加分</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card card-pad col" style={{ gap: 12 }}>
              <div className="card-title row" style={{ gap: 8 }}><Ban size={15} /> 反制對方的種劍</div>
              <ul className="siege-faq-list">
                <li>種下的劍不能移除，只能讓「補 4 劍」變貴：把最強防守壓在已被種的橋塔。</li>
                <li>不要每座 1/5 都重守；排序是 <b>價值 × 離 5 劍的距離</b>。1/5 的低價塔可以放，4/5 的橋塔一定要守。</li>
                <li>對方種你的橋，你也種他的橋，形成互相威懾；誰的勝率高，誰的種劍更便宜。</li>
                <li>對方種很多但手上沒劍時，不用怕；那只是裝飾。真正要守的是「有種 + 有 4 劍預備隊」的那一波。</li>
              </ul>
            </div>

            <div className="card card-pad col" style={{ gap: 12 }}>
              <div className="card-title row" style={{ gap: 8 }}><MapIcon size={15} /> 地圖關鍵點</div>
              <div className="table-scroll">
                <table className="table siege-tactic-table">
                  <thead><tr><th>類別</th><th>藍方（盾）</th><th>紅方（圓）</th></tr></thead>
                  <tbody>
                    <tr><td>本營</td><td>0</td><td>26</td></tr>
                    <tr><td>三道門</td><td>1、2、3</td><td>27、28、29</td></tr>
                    <tr><td>橋塔</td><td>4、5、9、10、12</td><td>30、31、35、36、38</td></tr>
                    <tr><td>最快首殺</td><td>紅 38</td><td>藍 12</td></tr>
                    <tr><td>二塔切斷</td><td>8+10</td><td>34+36</td></tr>
                    <tr><td>切斷後</td><td>掉 8、10、11、12</td><td>掉 34、36、37、38</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card card-pad col" style={{ gap: 12 }}>
              <div className="card-title row" style={{ gap: 8 }}><Trophy size={15} /> 標記建議</div>
              <div className="siege-faq-kv">
                <span><b>T1</b> 對方橋塔（藍打 38、紅打 12）——全會集火。</span>
                <span><b>T2</b> 第二座橋／緩衝塔。</span>
                <span><b>T3</b> 切斷組合（8+10、34+36）。</span>
                <span><b>T4</b> 低 HP 尾刀。</span>
                <span><b>T5</b> 佯攻／牽制。</span>
                <span><b>P（禁止）</b> 陷阱塔、留給特定人，或打了也連不回來的塔。</span>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <SwordCalculator />
          </div>
        </>
      )}

      {tab === "faq" && (
        <div className="grid split-2">
          <div className="card card-pad col" style={{ gap: 14 }}>
            <div className="card-title row" style={{ gap: 8 }}><MapIcon size={15} /> 怎麼用</div>
            <ol className="siege-faq-list">
              <li>點地圖上的塔，設定它目前是哪一隊的；自己公會是藍隊或紅隊都可以，兩邊比分都能直接編輯。</li>
              <li>需要的話加上目標樣式（T1–T5）、禁止標記、備註與基地剩餘 HP。</li>
              <li>每座塔可記錄 0–5 劍的進攻進度：1 劍＝種、4 劍＝可爆、5 劍儲存會自動爆塔。</li>
              <li>上方輸入目前雙方比分，系統會依連線塔數計算每分鐘得分與預估勝利時間。</li>
              <li>「匯出」會產生與 SWGT 模擬器相同格式的 JSON，可以備份或分享；「匯入」兩邊的檔案都接受。</li>
            </ol>
            <div className="divider" />
            <div className="card-title row" style={{ gap: 8 }}><Trophy size={15} /> 計分規則</div>
            <ul className="siege-faq-list">
              <li>每分鐘得分 = 連到本營的塔數 × 2。</li>
              <li>連線塔數 ≥ 13 時再 +20 分/分（一般地圖有 12 座一般塔，因此單一公會上限為 24 分/分）。</li>
              <li>連線判定只看「同顏色」的塔：從本營出發，遇到敵方塔就無法繼續通過。</li>
              <li>先到 20,000 分獲勝；每分鐘得分為 0，或預估時間超過約 10.4 天時顯示 ∞。</li>
            </ul>
          </div>

          <div className="card card-pad col" style={{ gap: 14 }}>
            <div className="card-title row" style={{ gap: 8 }}><Target size={15} /> 樣式與備註</div>
            <div className="siege-faq-kv">
              <span><b>T1–T5</b> 目標順位，只是戰術標記，不影響計分。</span>
              <span><b>禁止（⊘）</b> 標記這座塔暫時不要打，也不影響計分。</span>
              <span><b>剩餘 HP</b> 顯示在塔下方的血條；防守數預設 5 隊。</span>
              <span><b>劍數</b> 由該塔的敵方持有：1 劍＝種、4 劍＝可爆；5 劍儲存時直接變色。</span>
              <span><b>未連線</b> 塔會變暗，表示目前無法從本營沿同色路徑到達。</span>
            </div>
            <div className="divider" />
            <div className="card-title row" style={{ gap: 8 }}><Info size={15} /> 資料與版本</div>
            <div className="tiny dim col" style={{ gap: 6 }}>
              <span>目前套用 {SIEGE_MAP_VERSION} 的據點戰錦標賽地圖拓撲；匯入舊版本檔案時會以目前地圖重新套用連線。</span>
              <span>地圖與計分規則參考 SWGT 的 Siege Tournament Simulator；本工具只在本機瀏覽器運算與保存。</span>
            </div>
            <button className="btn btn-sm btn-ghost" style={{ alignSelf: "flex-start" }} onClick={resetAll}>
              <RotateCcw size={13} /> 回到預設地圖
            </button>
          </div>
        </div>
      )}

      {editingTower && draft && (
        <Modal title={`${siegeTowerName(editingTower)} · #${editingTower.id}`} onClose={closeEditor} width={440}>
          <div className="col" style={{ gap: 16 }}>
            <div className="field">
              <label>公會</label>
              <div className="siege-pick">
                {(["Blue", "Red"] as const).map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`siege-pick-btn ${draft.color === color ? "on" : ""}`}
                    style={{ "--pick": GUILD_COLOR[color] } as CSSProperties}
                    onClick={() => patchDraft({ color, swords: 0 })}
                  >
                    <span className="siege-guild-dot" style={{ background: GUILD_COLOR[color] }} />
                    {GUILD_TEXT[color]}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>{`攻擊進度（${GUILD_TEXT[otherSiegeGuild(draft.color)]}的劍數）`}</label>
              <div className="siege-pick">
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`siege-pick-btn ${draft.swords === n ? "on" : ""} ${n === 5 ? "danger" : ""}`}
                    onClick={() => patchDraft({ swords: n })}
                  >
                    {n === 0 ? "0" : n === 1 ? "1 · 種" : n === 5 ? "5 · 爆塔" : `${n}/5`}
                  </button>
                ))}
              </div>
              <span className="hint">
                {draft.swords === 5
                  ? `儲存後會直接爆塔：${GUILD_TEXT[draft.color]} → ${GUILD_TEXT[otherSiegeGuild(draft.color)]}`
                  : draft.swords >= 4
                    ? `再 ${5 - draft.swords} 劍就能爆塔`
                    : "1 劍＝種；先插一劍，之後再補 4 劍爆塔"}
              </span>
            </div>

            <div className="field">
              <label>樣式</label>
              <div className="siege-pick wrap">
                <button
                  type="button"
                  className={`siege-pick-btn ${!draft.prohibit && draft.pingNumber === 0 ? "on" : ""}`}
                  onClick={() => patchDraft({ prohibit: false, pingNumber: 0 })}
                >
                  無
                </button>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`siege-pick-btn ${!draft.prohibit && draft.pingNumber === n ? "on" : ""}`}
                    onClick={() => patchDraft({ prohibit: false, pingNumber: n })}
                  >
                    <Target size={11} /> T{n}
                  </button>
                ))}
                <button
                  type="button"
                  className={`siege-pick-btn danger ${draft.prohibit ? "on" : ""}`}
                  onClick={() => patchDraft({ prohibit: true, pingNumber: 0 })}
                >
                  <Ban size={11} /> 禁止
                </button>
              </div>
            </div>

            <div className="field">
              <label>備註（最多 100 字）</label>
              <input
                className="input"
                value={draft.memo}
                maxLength={100}
                placeholder="例如：主力要打這座、先留給誰…"
                onChange={(e) => patchDraft({ memo: e.target.value })}
              />
            </div>

            {!editingTower.isHQ && (
              <div className="field">
                <label>基地剩餘 HP</label>
                <div className="siege-pick">
                  {[20, 40, 60, 80, 100].map((hp) => (
                    <button
                      key={hp}
                      type="button"
                      className={`siege-pick-btn ${draft.hpPercentage === hp ? "on" : ""}`}
                      onClick={() => patchDraft({ hpPercentage: hp })}
                    >
                      {hp}%
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="row between wrap" style={{ gap: 10, borderTop: "1px solid var(--line-soft)", paddingTop: 14 }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={resetTower}>
                <RotateCcw size={12} /> 重設此塔
              </button>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btn-sm btn-ghost" onClick={closeEditor}>
                  <X size={13} /> 取消
                </button>
                <button type="button" className="btn btn-sm btn-primary" onClick={saveTower}>
                  儲存
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
