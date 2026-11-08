import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Ban, Castle, Clock, Download, Info, Map as MapIcon, RotateCcw, StickyNote, Target, Trophy, Upload, X,
} from "lucide-react";
import { useStore } from "../store";
import { Modal, NumberInput } from "../components/ui";
import {
  SIEGE_MAP_VERSION, SIEGE_TARGET_SCORE, SIEGE_TEMPLATE_BY_ID, SIEGE_TEMPLATES,
  analyzeSiege, createSiegeState, defaultSiegeTower, exportSiegeJSON, formatSiegeDuration,
  importSiegeJSON, loadSiegeState, saveSiegeState, siegeTowerName,
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

export default function SiegeSimulatorPage() {
  const notify = useStore((s) => s.notify);
  const [tab, setTab] = useState<"map" | "faq">("map");
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
    setState((prev) => ({
      ...prev,
      towers: prev.towers.map((t) => (t.id === editing ? { ...t, ...draft, memo: draft.memo.slice(0, 100) } : t)),
    }));
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
                      ].filter(Boolean).join(" ")}
                      style={{ left: tpl.x, top: tpl.y, "--tower": GUILD_COLOR[tower.color] } as CSSProperties}
                      onClick={() => openTower(tower)}
                      aria-label={`${name}，${GUILD_TEXT[tower.color]}${tower.prohibit ? "，禁止" : tower.pingNumber ? `，目標 T${tower.pingNumber}` : ""}`}
                    >
                      <span className="siege-tower-face">
                        {tower.isHQ ? <Castle size={19} /> : <span className="siege-tower-id">{tower.slot}</span>}
                      </span>

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

      {tab === "faq" && (
        <div className="grid split-2">
          <div className="card card-pad col" style={{ gap: 14 }}>
            <div className="card-title row" style={{ gap: 8 }}><MapIcon size={15} /> 怎麼用</div>
            <ol className="siege-faq-list">
              <li>點地圖上的塔，設定它目前是哪一隊的；自己公會是藍隊或紅隊都可以，兩邊比分都能直接編輯。</li>
              <li>需要的話加上目標樣式（T1–T5）、禁止標記、備註與基地剩餘 HP。</li>
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
                    onClick={() => patchDraft({ color })}
                  >
                    <span className="siege-guild-dot" style={{ background: GUILD_COLOR[color] }} />
                    {GUILD_TEXT[color]}
                  </button>
                ))}
              </div>
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
