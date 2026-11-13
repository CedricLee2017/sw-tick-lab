import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Gauge, RotateCcw, Wand2 } from "lucide-react";
import { MonsterPickerField } from "../components/MonsterPicker";
import { NumberInput } from "../components/ui";
import { MONSTERS, monsterOf, useStore } from "../store";
import { followFloor, leadBonus, orderSafeFloorSpeeds, tickForSpeed } from "../lib/teamSpeed";

type Size = 3 | 4 | 5;

interface Row {
  monsterId: number;
  /** 面板額外速度（符文 / 其他） */
  extra: number;
  /** 這隻提供給後面隊友的提條 %（自己不吃自己的） */
  boost: number;
  /** 這隻有沒有速度強化 +30% */
  speedBuff: boolean;
}

const EMPTY_ROW: Row = { monsterId: 0, extra: 0, boost: 0, speedBuff: false };

const emptyRows = () => Array.from({ length: 5 }, () => ({ ...EMPTY_ROW }));

const STORAGE_KEY = "swtick:follow-speed";

interface SavedState {
  size: Size;
  rows: Row[];
  leadPct: number;
  rta: boolean;
  oppSpd: number;
}

function loadSaved(): SavedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedState>;
    const rows = Array.isArray(parsed.rows)
      ? Array.from({ length: 5 }, (_, i) => ({ ...EMPTY_ROW, ...(parsed.rows?.[i] ?? {}) }))
      : emptyRows();
    return {
      size: parsed.size === 3 || parsed.size === 5 ? parsed.size : 4,
      rows,
      leadPct: Number(parsed.leadPct) || 0,
      rta: Boolean(parsed.rta),
      oppSpd: Number(parsed.oppSpd) || 0,
    };
  } catch {
    return null;
  }
}

const baseSpeedOf = (monsterId: number) => monsterOf(monsterId)?.spd ?? 0;

/**
 * 接速最低速度（簡單版）：
 * 選 3～5 隻魔靈、只輸入額外速度，系統用魔靈基礎速度算每隻的接速需求。
 * 不顯示 Tick；同一隊可以有多隻提條，後面的成員會把前面所有提條加總。
 */
export default function FollowSpeedPage() {
  const notify = useStore((s) => s.notify);
  const [initial] = useState(loadSaved);
  const [size, setSize] = useState<Size>(initial?.size ?? 4);
  const [rows, setRows] = useState<Row[]>(() => initial?.rows ?? emptyRows());
  const [leadPct, setLeadPct] = useState(initial?.leadPct ?? 0);
  const [rta, setRta] = useState(initial?.rta ?? false);
  const [oppSpd, setOppSpd] = useState(initial?.oppSpd ?? 0);

  // 和其他計算頁一樣，設定留在這台裝置，切去別頁再回來不會不見。
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ size, rows, leadPct, rta, oppSpd }));
    } catch {
      /* 瀏覽器儲存空間不足時忽略 */
    }
  }, [size, rows, leadPct, rta, oppSpd]);

  const rate = rta ? 1.5 : 7;
  const members = rows.slice(0, size);

  const patch = (index: number, next: Partial<Row>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...next } : row)));
  };

  const computed = useMemo(() => {
    const baseOf = (row: Row) => baseSpeedOf(row.monsterId);
    const leadOf = (row: Row) => leadBonus(baseOf(row), leadPct);
    const panelOf = (row: Row) => (row.monsterId ? baseOf(row) + leadOf(row) + Math.max(0, row.extra) : 0);

    const opener = members[0];
    const openerPanel = opener ? panelOf(opener) : 0;
    const openerTick = openerPanel > 0 ? tickForSpeed({ speed: openerPanel, ratePct: rate }) : null;
    const opponentSpeed = oppSpd > 0 ? oppSpd : openerPanel;

    const results = members.map((row, i) => {
      const base = baseOf(row);
      const leadFlat = leadOf(row);
      const panel = panelOf(row);
      if (!row.monsterId) {
        return { base, leadFlat, panel, boostIn: 0, minSpeed: null, minExtra: null, met: null };
      }
      if (i === 0) {
        return { base, leadFlat, panel, boostIn: 0, minSpeed: null, minExtra: null, met: null };
      }
      // 後面成員收到的是前面所有提條角的總和；自己的提條不幫助自己。
      const boostIn = members.slice(0, i).reduce((sum, prev) => sum + Math.max(0, prev.boost || 0), 0);
      if (openerTick == null || opponentSpeed <= 0) {
        return { base, leadFlat, panel, boostIn, minSpeed: null, minExtra: null, met: null };
      }
      const floor = followFloor({
        baseSpd: base,
        extra: row.extra,
        leadPct,
        targetTick: openerTick + i,
        ratePct: rate,
        opponentSpeed,
        boostPct: boostIn,
        speedBuff: row.speedBuff,
        buffStartTick: openerTick,
      });
      return { base, leadFlat, panel, boostIn, minSpeed: floor.minSpeed, minExtra: floor.minExtra, met: floor.met };
    });

    // 順序安全：後面的接速下限較高時，把前面出手的成員一起往上推。
    // 只納入已選魔靈；第 1 隻還沒選時不做順序推算。
    const hasOpener = Boolean(members[0]?.monsterId);
    const safeSpeeds = hasOpener
      ? orderSafeFloorSpeeds(
          results
            .map((r, i) => ({ r, i }))
            .filter(({ i }) => members[i]?.monsterId)
            .map(({ r, i }) => ({
              index: i,
              order: i + 1,
              floor: i === 0 || r.minSpeed == null || !Number.isFinite(r.minSpeed) ? null : r.minSpeed,
              // 以目前輸入的面板速度為底：後面已經調高時，前面要跟著更高才不會被超車。
              current: r.panel > 0 ? r.panel : null,
            })),
          true,
        )
      : new Map<number, number>();

    const safeExtra = results.map((r, i) => {
      const target = safeSpeeds.get(i);
      return target == null ? null : Math.max(0, target - r.base - r.leadFlat);
    });

    const openerNotFastest = openerPanel > 0
      ? members
          .map((row, i) => ({ row, i }))
          .filter(({ row, i }) => i > 0 && row.monsterId && results[i].panel > 0 && results[i].panel >= openerPanel)
          .map(({ i }) => i)
      : [];

    return { results, safeExtra, openerPanel, openerTick, opponentSpeed, openerNotFastest };
  }, [members, leadPct, rate, oppSpd]);

  const { results, safeExtra, openerPanel, opponentSpeed, openerNotFastest } = computed;

  const applySafe = () => {
    const next = rows.map((row, i) => {
      if (i >= size || !row.monsterId) return row;
      const target = safeExtra[i];
      if (target == null || target <= row.extra) return row;
      return { ...row, extra: target };
    });
    const changed = next.reduce((count, row, i) => count + (row !== rows[i] ? 1 : 0), 0);
    if (changed > 0) setRows(next);
    notify(
      changed > 0
        ? `已補足 ${changed} 隻的順序安全最低速度`
        : "目前額外速度都已達到順序安全最低值",
      changed > 0 ? "ok" : "err",
    );
  };

  const reset = () => {
    setRows(emptyRows());
    setLeadPct(0);
    setOppSpd(0);
    setRta(false);
    setSize(4);
    notify("已清空接速計算");
  };

  const statusOf = (index: number) => {
    const r = results[index];
    if (!r || !members[index]?.monsterId) return { text: "未選魔靈", cls: "muted" };
    if (index === 0) {
      const need = safeExtra[0];
      if (need != null && need > members[0].extra) return { text: `提條角需再 +${need - members[0].extra}`, cls: "gold" };
      return { text: "起手", cls: "green" };
    }
    if (r.minExtra == null || !Number.isFinite(r.minExtra)) return { text: "無法計算", cls: "muted" };
    if (members[index].extra < r.minExtra) return { text: `接速不足 ${r.minExtra - members[index].extra}`, cls: "red" };
    const safe = safeExtra[index];
    if (safe != null && members[index].extra < safe) return { text: `順序不足 ${safe - members[index].extra}`, cls: "gold" };
    return { text: "足夠", cls: "green" };
  };

  const selectedCount = members.filter((r) => r.monsterId).length;

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 14 }}>
        <div>
          <div className="card-title row" style={{ gap: 7 }}>
            <Gauge size={15} className="gold" /> 接速最低速度
          </div>
          <div className="card-sub">
            選魔靈後只輸入額外速度；系統用基礎速度、提條、速度強化與隊長技算出每隻的接速需求，不顯示 Tick。
          </div>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={reset}>
          <RotateCcw size={13} /> 重設
        </button>
      </div>

      <div className="card card-pad">
        <div className="row between wrap" style={{ gap: 10 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="tiny dim">隊伍</span>
            {([3, 4, 5] as Size[]).map((n) => (
              <button
                key={n}
                type="button"
                className={`chip ${size === n ? "gold" : "muted"}`}
                style={{ cursor: "pointer" }}
                onClick={() => setSize(n)}
              >
                {n} 隻
              </button>
            ))}
            <span className="chip muted">已選 {selectedCount} 隻</span>
          </div>
          <div className="row wrap" style={{ gap: 12 }}>
            <label className="row" style={{ gap: 6 }}>
              <span className="tiny dim">速度隊長技 %</span>
              <NumberInput
                className="input mono"
                style={{ width: 78 }}
                min={0}
                max={50}
                value={leadPct}
                onChange={(v) => setLeadPct(Math.max(0, Math.min(50, v)))}
                title="全隊共用；以每隻自己的基礎速度計算"
              />
            </label>
            <div className="row" style={{ gap: 4 }}>
              <span className="tiny dim">內容</span>
              <button
                type="button"
                className={`chip ${rta ? "muted" : "gold"}`}
                style={{ cursor: "pointer" }}
                onClick={() => setRta(false)}
              >
                一般 7%
              </button>
              <button
                type="button"
                className={`chip ${rta ? "gold" : "muted"}`}
                style={{ cursor: "pointer" }}
                onClick={() => setRta(true)}
              >
                RTA 1.5%
              </button>
            </div>
            <label className="row" style={{ gap: 6 }}>
              <span className="tiny dim">鏡像對手速度</span>
              <NumberInput
                className="input mono"
                style={{ width: 90 }}
                min={0}
                value={oppSpd}
                onChange={(v) => setOppSpd(Math.max(0, v))}
                title="0 = 和起手同速"
              />
            </label>
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginTop: 14 }}>
          {members.map((row, i) => {
            const base = baseSpeedOf(row.monsterId);
            const leadFlat = leadBonus(base, leadPct);
            const panel = results[i]?.panel ?? 0;
            const boostIn = results[i]?.boostIn ?? 0;
            return (
              <div key={i} className="card card-pad" style={{ padding: 12 }}>
                <div className="row between" style={{ gap: 6 }}>
                  <span className={`chip ${i === 0 ? "gold" : "muted"}`}>
                    順序 {i + 1}
                    {i === 0 ? " · 起手" : ""}
                  </span>
                  {i > 0 && <span className="tiny dim">收到提條 {boostIn}%</span>}
                </div>

                <div style={{ marginTop: 8 }}>
                  <MonsterPickerField
                    value={row.monsterId}
                    options={MONSTERS}
                    onChange={(id) => patch(i, { monsterId: id })}
                    title={`選擇第 ${i + 1} 隻魔靈`}
                    placeholder="選擇魔靈"
                  />
                </div>

                <div className="grid g2" style={{ gap: 8, marginTop: 9 }}>
                  <label className="col" style={{ gap: 3 }}>
                    <span className="tiny dim">基礎速度</span>
                    <div className="input mono" style={{ opacity: 0.75 }}>{base || "—"}</div>
                  </label>
                  <label className="col" style={{ gap: 3 }}>
                    <span className="tiny dim">額外速度</span>
                    <NumberInput
                      className="input mono"
                      min={0}
                      max={500}
                      value={row.extra}
                      onChange={(v) => patch(i, { extra: Math.max(0, v) })}
                      title="符文與其他來源的額外速度；面板速度 = 基礎 + 隊長技 + 額外"
                    />
                  </label>
                  <label className="col" style={{ gap: 3 }}>
                    <span className="tiny dim">提條提供 %</span>
                    <NumberInput
                      className="input mono"
                      min={0}
                      max={100}
                      value={row.boost}
                      onChange={(v) => patch(i, { boost: Math.max(0, Math.min(100, v)) })}
                      title="這隻提供給後面隊友的攻擊條 %；自己不會吃到自己的提條"
                    />
                  </label>
                  <label className="col" style={{ gap: 3 }}>
                    <span className="tiny dim">吃速度強化</span>
                    <select
                      className="select"
                      value={row.speedBuff ? "on" : "off"}
                      onChange={(e) => patch(i, { speedBuff: e.target.value === "on" })}
                      title="這隻自己有沒有吃到速度強化 +30%；起手自己不會吃到自己的提條 / 強化"
                    >
                      <option value="off">無</option>
                      <option value="on">有（+30%）</option>
                    </select>
                  </label>
                </div>

                <div className="row between wrap" style={{ gap: 6, marginTop: 8 }}>
                  <span className="tiny dim">
                    面板 <b className="mono">{panel || "—"}</b>
                    {leadFlat > 0 && <span className="dim">（含隊長 {leadFlat}）</span>}
                  </span>
                  {i > 0 && row.monsterId && results[i]?.minSpeed != null && (
                    <span className={`chip ${results[i]?.met ? "green" : "red"}`}>
                      {results[i]?.met ? "達接速下限" : "未達接速下限"}
                    </span>
                  )}
                  {safeExtra[i] != null && safeExtra[i]! > row.extra && (
                    <span className="chip gold">順序需再 +{safeExtra[i]! - row.extra}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <div>
            <div className="card-title">計算結果</div>
            <div className="card-sub">起手 1 隻；後面每隻收到前面所有提條的總和</div>
          </div>
          <button type="button" className="btn btn-sm" onClick={applySafe} disabled={selectedCount === 0}>
            <Wand2 size={13} /> 補足順序安全最低
          </button>
        </div>

        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>順序</th>
                <th>魔靈</th>
                <th className="num">基礎</th>
                <th className="num">額外</th>
                <th className="num">面板</th>
                <th className="num">收到提條</th>
                <th className="num">接速最低額外</th>
                <th className="num" title="以目前輸入的面板速度為底，只補足不足的成員；不會自動調低已經比較快的成員">順序安全最低額外</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {members.map((row, i) => {
                const r = results[i];
                const m = monsterOf(row.monsterId);
                const status = statusOf(i);
                const minExtra = r?.minExtra != null && Number.isFinite(r.minExtra) ? r.minExtra : null;
                const safe = safeExtra[i];
                return (
                  <tr key={i}>
                    <td>
                      <span className={`chip ${i === 0 ? "gold" : "muted"}`}>{i + 1}</span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{m ? m.name : <span className="dim">尚未選擇</span>}</td>
                    <td className="num mono">{r?.base || "—"}</td>
                    <td className="num mono">{row.monsterId ? row.extra : "—"}</td>
                    <td className="num mono">{r?.panel || "—"}</td>
                    <td className="num mono">{i === 0 ? "—" : `${r?.boostIn ?? 0}%`}</td>
                    <td className="num mono gold">{i === 0 ? "起手" : minExtra ?? "—"}</td>
                    <td className="num mono">{i === 0 ? (safe ?? "—") : safe ?? "—"}</td>
                    <td>
                      <span className={`chip ${status.cls}`}>
                        {status.cls === "green" && <Check size={11} />}
                        {status.text}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card-pad tiny dim" style={{ borderTop: "1px solid var(--line-soft)", lineHeight: 1.8 }}>
          <div>
            ※ 接速最低額外＝不被「和起手同速的鏡像對手」插隊所需的額外速度；面板速度＝基礎＋隊長技＋額外。
          </div>
          <div>
            ※ 順序安全最低額外＝以目前輸入的面板速度為底，把前面不足的成員往上推，確保第 2 隻比第 3 隻快、第 3 隻比第 4 隻快；不會自動調低已經比較快的成員。
          </div>
          <div>※ 速度強化假設從起手後生效，每隻自己勾選是否吃到；提條角自己不會吃到自己的提條。鏡像對手速度 0＝和起手同速。</div>
          <div>※ 目前起手：{openerPanel > 0 ? `面板 ${openerPanel}` : "尚未選擇"}；對手速度：{opponentSpeed > 0 ? opponentSpeed : "—"}。</div>
        </div>
      </div>

      {openerNotFastest.length > 0 && (
        <div className="card card-pad" style={{ marginTop: 12, borderColor: "rgba(255,107,107,.35)" }}>
          <div className="row" style={{ gap: 8, color: "var(--red)" }}>
            <AlertTriangle size={15} />
            <span style={{ fontSize: 12.5 }}>
              第 {openerNotFastest.map((i) => i + 1).join("、")} 隻的面板速度不低於提條角，會比提條角先出手，接速前提不成立。
              請提高提條角的速度，或降低這幾隻的額外速度。
            </span>
          </div>
        </div>
      )}
    </>
  );
}
