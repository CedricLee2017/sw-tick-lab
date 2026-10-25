import { useMemo, useState } from "react";
import {
  Building2, Download, Gauge, Info, RefreshCw, RotateCcw, Trash2, Zap, ShieldCheck,
} from "lucide-react";
import { useStore, monsterLabel } from "../store";
import { BUILDINGS } from "../lib/constants";
import { defaultBonus, speedForTick } from "../lib/stats";
import { exportAccount } from "../lib/parse";
import { NumberField, fmt } from "../components/ui";
import type { BonusConfig } from "../lib/types";

type NumKey =
  | "towerSpd"
  | "towerAtk"
  | "towerHp"
  | "towerDef"
  | "guildAtk"
  | "guildHp"
  | "guildDef"
  | "guildCd";

/** 建築 id → 可編輯的加成欄位 */
const BUILDING_FIELDS: { id: number; field: NumKey }[] = [
  { id: 7, field: "towerSpd" },
  { id: 9, field: "towerAtk" },
  { id: 10, field: "towerDef" },
  { id: 11, field: "towerHp" },
  { id: 17, field: "guildAtk" },
  { id: 18, field: "guildCd" },
  { id: 19, field: "guildHp" },
  { id: 20, field: "guildDef" },
];

const ELEMENT_TOWERS = [12, 13, 14, 15, 16];

function pctFor(id: number, level: number): number {
  const def = BUILDINGS[id];
  if (!def || level <= 0) return 0;
  return def.max[Math.min(def.max.length, level) - 1] ?? 0;
}

function levelFor(id: number, pct: number): number {
  const def = BUILDINGS[id];
  if (!def) return 0;
  const idx = def.max.findIndex((v) => Math.abs(v - pct) < 0.001);
  return idx >= 0 ? idx + 1 : 0;
}

export default function SettingsPage() {
  const account = useStore((s) => s.account);
  const settings = useStore((s) => s.settings);
  const bonus = settings.bonus;
  const patchBonus = useStore((s) => s.patchBonus);
  const setRta = useStore((s) => s.setRta);
  const setPool = useStore((s) => s.setPool);
  const loadouts = useStore((s) => s.loadouts);
  const removeLoadout = useStore((s) => s.removeLoadout);
  const clearAccount = useStore((s) => s.clearAccount);
  const notify = useStore((s) => s.notify);

  const [baseSpd, setBaseSpd] = useState(100);
  const [tick, setTick] = useState(5);

  const detected = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of account?.buildings ?? []) m.set(b.id, b.level);
    return m;
  }, [account]);

  const totalPct = bonus.towerSpd + bonus.leadSpd + bonus.buffSpd;
  const targetSpeed = speedForTick(tick, settings.rta);
  const runeNeed = Math.max(0, targetSpeed - baseSpd - Math.ceil((baseSpd * totalPct) / 100));

  const applyDetected = () => {
    if (!account) return notify("請先匯入存檔", "err");
    if (account.buildings.length === 0) return notify("存檔中沒有建築資料", "err");
    const patch: Partial<BonusConfig> = {};
    for (const { id, field } of BUILDING_FIELDS) {
      const level = detected.get(id) ?? 0;
      patch[field] = pctFor(id, level);
    }
    patch.useGuild = BUILDING_FIELDS.some((x) => x.id >= 17 && (detected.get(x.id) ?? 0) > 0);
    patchBonus(patch);
    notify(`已套用建築等級（速度圖騰 ${patch.towerSpd ?? 0}%）`);
  };

  const resetBonus = () => {
    patchBonus(defaultBonus());
    setRta(false);
    setPool(18);
    notify("已重置為預設值");
  };

  const download = () => {
    if (!account) return;
    const blob = new Blob([exportAccount(account)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sw-tick-lab-${(account.wizard || "account").replace(/[\\/:*?"<>|]/g, "_")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("已匯出存檔");
  };

  const resetAll = () => {
    if (!confirm("要清除已匯入的存檔與所有配裝紀錄嗎？（設定會保留）")) return;
    void clearAccount();
    for (const l of loadouts) removeLoadout(l.id);
    notify("已清除本機資料");
  };

  return (
    <>
      <div className="grid g3">
        <div className="card card-pad">
          <div className="row tiny dim" style={{ gap: 7 }}>
            <Gauge size={14} className="gold" /> 速度圖騰
          </div>
          <div className="mono" style={{ fontSize: 30, fontWeight: 800, marginTop: 4 }}>
            +{bonus.towerSpd}%
          </div>
          <div className="tiny dim">
            {detected.has(7) ? `存檔偵測：Lv.${detected.get(7)}` : "未偵測到建築資料"}
          </div>
        </div>
        <div className="card card-pad">
          <div className="row tiny dim" style={{ gap: 7 }}>
            <Zap size={14} className="gold" /> 速度加成總計
          </div>
          <div className="mono" style={{ fontSize: 30, fontWeight: 800, marginTop: 4 }}>
            +{totalPct}%
          </div>
          <div className="tiny dim">圖騰 {bonus.towerSpd}% · 隊長 {bonus.leadSpd}% · Buff {bonus.buffSpd}%</div>
        </div>
        <div className="card card-pad">
          <div className="row tiny dim" style={{ gap: 7 }}>
            <ShieldCheck size={14} className="gold" /> Tick 模式
          </div>
          <div className="mono" style={{ fontSize: 30, fontWeight: 800, marginTop: 4 }}>
            {settings.rta ? "RTA" : "一般"}
          </div>
          <div className="tiny dim">一般 Tick 5 = {speedForTick(5, false)} 速 · RTA Tick 5 = {speedForTick(5, true)} 速</div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, .85fr)", gap: 16, marginTop: 16 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">建築加成</div>
              <div className="card-sub">依帳號存檔的建築等級換算，也可以手動調整</div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm" onClick={applyDetected}><RefreshCw size={13} /> 從存檔偵測</button>
              <button className="btn btn-sm btn-ghost" onClick={resetBonus}><RotateCcw size={13} /> 重設</button>
            </div>
          </div>
          <div className="card-pad">
            <table className="table">
              <thead>
                <tr><th>建築</th><th className="num">存檔等級</th><th className="num">效果</th><th style={{ width: 130 }}>套用等級</th></tr>
              </thead>
              <tbody>
                {BUILDING_FIELDS.map(({ id, field }) => {
                  const def = BUILDINGS[id];
                  const level = detected.get(id) ?? 0;
                  return (
                    <tr key={id}>
                      <td>
                        <div className="row" style={{ gap: 7 }}>
                          <Building2 size={13} className="dim" />
                          <span style={{ fontWeight: 600 }}>{def.name}</span>
                          {id === 7 && <span className="chip gold" style={{ padding: "1px 6px", fontSize: 10 }}>關鍵</span>}
                        </div>
                      </td>
                      <td className="num mono dim">{level > 0 ? `Lv.${level}` : "—"}</td>
                      <td className="num mono gold">+{bonus[field]}%</td>
                      <td>
                        <select
                          className="select"
                          value={levelFor(id, bonus[field]) || 0}
                          onChange={(e) => patchBonus({ [field]: pctFor(id, Number(e.target.value)) })}
                        >
                          <option value={0}>自訂 / 未設定</option>
                          {def.max.map((v, i) => (
                            <option key={i} value={i + 1}>Lv.{i + 1} · +{v}%</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td>
                    <div className="row" style={{ gap: 7 }}>
                      <Building2 size={13} className="dim" />
                      <span style={{ fontWeight: 600 }}>暴擊傷害圖騰</span>
                    </div>
                  </td>
                  <td className="num mono dim">{detected.has(8) ? `Lv.${detected.get(8)}` : "—"}</td>
                  <td className="num mono dim">+{pctFor(8, detected.get(8) ?? 0)}%</td>
                  <td className="tiny dim">不在本工具計算範圍</td>
                </tr>
              </tbody>
            </table>

            <div className="divider" style={{ margin: "14px 0" }} />
            <div className="tiny dim" style={{ marginBottom: 8 }}>屬性攻擊塔（僅顯示，依魔靈屬性各自套用，暫不納入配符計算）</div>
            <div className="row wrap" style={{ gap: 6 }}>
              {ELEMENT_TOWERS.map((id) => {
                const level = detected.get(id) ?? 0;
                return (
                  <span key={id} className="chip muted">
                    {BUILDINGS[id].name.replace("屬性攻擊力", "")} Lv.{level} · +{pctFor(id, level)}%
                  </span>
                );
              })}
            </div>
            <div className="row tiny dim" style={{ gap: 6, marginTop: 12 }}>
              <Info size={13} /> 公式：基礎速度 + ceil(基礎速度 × 加成% / 100) + 迅速套裝 + 符文速度。
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <div className="card-title">隊長技與速度 Buff</div>
              <span className="chip muted">套用至所有試算</span>
            </div>
            <div className="card-pad col" style={{ gap: 12 }}>
              <NumberField label="速度隊長技 %" value={bonus.leadSpd} min={0} max={50} onChange={(v) => patchBonus({ leadSpd: v })} />
              <div className="row wrap" style={{ gap: 5 }}>
                {[0, 19, 24, 28, 30, 33].map((v) => (
                  <button key={v} className={`btn btn-sm ${bonus.leadSpd === v ? "btn-primary" : "btn-ghost"}`} onClick={() => patchBonus({ leadSpd: v })}>
                    +{v}%
                  </button>
                ))}
              </div>
              <div className="divider" />
              <NumberField label="速度 Buff %（戰鬥中）" value={bonus.buffSpd} min={0} max={50} step={5} onChange={(v) => patchBonus({ buffSpd: v })} hint="開場有速度 Buff 時才需要填入，例如 +30%" />
              <div className="row wrap" style={{ gap: 5 }}>
                {[0, 30].map((v) => (
                  <button key={v} className={`btn btn-sm ${bonus.buffSpd === v ? "btn-primary" : "btn-ghost"}`} onClick={() => patchBonus({ buffSpd: v })}>
                    {v === 0 ? "不計 Buff" : `Buff +${v}%`}
                  </button>
                ))}
              </div>
              <div className="divider" />
              <NumberField label="速度圖騰 %（可直接覆寫）" value={bonus.towerSpd} min={0} max={20} step={0.5} onChange={(v) => patchBonus({ towerSpd: v })} />
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div className="card-title">快速試算</div>
              <span className="chip gold">Tick {tick}</span>
            </div>
            <div className="card-pad col" style={{ gap: 10 }}>
              <div className="grid g2">
                <NumberField label="基礎速度" value={baseSpd} min={1} max={300} onChange={setBaseSpd} />
                <NumberField label="目標 Tick" value={tick} min={1} max={30} onChange={setTick} />
              </div>
              <div className="card" style={{ padding: 11 }}>
                <div className="kv"><span className="k">目標總速度</span><span className="v mono gold">{targetSpeed}</span></div>
                <div className="kv"><span className="k">建築 + 隊長 + Buff</span><span className="v mono">+{Math.ceil((baseSpd * totalPct) / 100)}</span></div>
                <div className="kv"><span className="k">符文需要</span><span className="v mono gold">{runeNeed} 速</span></div>
              </div>
              <div className="tiny dim">點「速度實驗室」可以用同一組設定模擬出手順序。</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head">
            <div className="card-title">進階選項</div>
            <span className="chip muted">影響配符結果</span>
          </div>
          <div className="card-pad col" style={{ gap: 14 }}>
            <label className="row between" style={{ gap: 10, cursor: "pointer" }}>
              <span>
                <span style={{ fontWeight: 600 }}>RTA Tick 模式</span>
                <span className="tiny dim" style={{ display: "block" }}>RTA 攻速條每 Tick 只增加 0.015% × 速度（一般為 0.07%）</span>
              </span>
              <input type="checkbox" checked={settings.rta} onChange={(e) => setRta(e.target.checked)} />
            </label>
            <div className="divider" />
            <label className="row between" style={{ gap: 10, cursor: "pointer" }}>
              <span>
                <span style={{ fontWeight: 600 }}>計入公會旗幟</span>
                <span className="tiny dim" style={{ display: "block" }}>公會攻擊 / 體力 / 防禦 / 暴傷旗幟</span>
              </span>
              <input type="checkbox" checked={bonus.useGuild} onChange={(e) => patchBonus({ useGuild: e.target.checked })} />
            </label>
            <div className="divider" />
            <label className="row between" style={{ gap: 10, cursor: "pointer" }}>
              <span>
                <span style={{ fontWeight: 600 }}>計入磨石</span>
                <span className="tiny dim" style={{ display: "block" }}>副屬性上的磨石數值一併計算</span>
              </span>
              <input type="checkbox" checked={bonus.grind} onChange={(e) => patchBonus({ grind: e.target.checked })} />
            </label>
            <div className="divider" />
            <div className="field">
              <label>每個位置候選符文數：{settings.pool}</label>
              <input type="range" min={8} max={40} value={settings.pool} onChange={(e) => setPool(Number(e.target.value))} />
              <span className="hint">數值越大越精準，配符時間也會增加。預設 18。</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">存檔與資料</div>
              <div className="card-sub">所有資料只儲存在這台裝置的瀏覽器</div>
            </div>
            <ShieldCheck size={15} className="green" />
          </div>
          <div className="card-pad col" style={{ gap: 12 }}>
            {account ? (
              <>
                <div className="kv"><span className="k">檔案</span><span className="v">{account.fileName}</span></div>
                <div className="kv"><span className="k">玩家</span><span className="v">{account.wizard || "—"}</span></div>
                <div className="kv"><span className="k">魔靈 / 符文</span><span className="v">{fmt(account.units.length)} / {fmt(account.runes.length)}</span></div>
                <div className="kv"><span className="k">匯入時間</span><span className="v">{new Date(account.importedAt).toLocaleString("zh-TW")}</span></div>
                <div className="row" style={{ gap: 8, marginTop: 4 }}>
                  <button className="btn btn-sm" onClick={download}><Download size={13} /> 匯出精簡存檔</button>
                  <button className="btn btn-sm btn-ghost" onClick={resetAll}><Trash2 size={13} /> 清除全部</button>
                </div>
              </>
            ) : (
              <div className="empty" style={{ padding: "26px 10px" }}>
                <div>尚未匯入存檔</div>
                <a className="btn btn-sm btn-primary" href="#/import" style={{ marginTop: 10 }}>前往匯入</a>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div className="card-title">配裝紀錄</div>
          <span className="chip muted">{loadouts.length} 筆</span>
        </div>
        {loadouts.length === 0 ? (
          <div className="empty" style={{ padding: "30px 20px" }}>
            <div className="tiny">在配符頁按「儲存」就會出現在這裡。</div>
          </div>
        ) : (
          <div className="scroll-y" style={{ maxHeight: 420 }}>
            <table className="table">
              <thead>
                <tr><th>名稱</th><th>魔靈</th><th className="num">速度</th><th className="num">Tick</th><th className="num">體力</th><th>時間</th><th /></tr>
              </thead>
              <tbody>
                {loadouts.map((l) => (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 600 }}>{l.name}</td>
                    <td className="dim">{monsterLabel(l.monsterId)}</td>
                    <td className="num mono gold">{l.stats.spd}</td>
                    <td className="num mono">T{Number.isFinite(l.stats.tick) ? l.stats.tick : "—"}</td>
                    <td className="num mono">{fmt(l.stats.hp)}</td>
                    <td className="tiny dim">{new Date(l.createdAt).toLocaleString("zh-TW")}</td>
                    <td className="num">
                      <button className="btn btn-sm btn-ghost btn-icon" onClick={() => removeLoadout(l.id)} title="刪除">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
