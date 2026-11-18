import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  Check,
  Gauge,
  RotateCcw,
  Swords,
  Wand2,
} from "lucide-react";
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
const DUEL_KEY = "swtick:follow-speed-duel";

type Mode = "team" | "duel";

/** 進攻防守（3v3）：只比較雙方跑最快的那一隻 */
interface DuelState {
  defId: number;
  defLead: number;
  defExtra: number;
  atkId: number;
  atkLead: number;
  atkExtra: number;
}

const EMPTY_DUEL: DuelState = {
  defId: 0,
  defLead: 0,
  defExtra: 0,
  atkId: 0,
  atkLead: 0,
  atkExtra: 0,
};

function loadDuel(): DuelState {
  try {
    const raw = localStorage.getItem(DUEL_KEY);
    if (!raw) return { ...EMPTY_DUEL };
    const p = JSON.parse(raw) as Partial<DuelState>;
    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
    return {
      defId: num(p.defId),
      defLead: num(p.defLead),
      defExtra: num(p.defExtra),
      atkId: num(p.atkId),
      atkLead: num(p.atkLead),
      atkExtra: num(p.atkExtra),
    };
  } catch {
    return { ...EMPTY_DUEL };
  }
}

interface SavedState {
  size: Size;
  rows: Row[];
  leadPct: number;
  rta: boolean;
  oppSpd: number;
  mode: Mode;
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
      mode: parsed.mode === "duel" ? "duel" : "team",
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
  const [mode, setMode] = useState<Mode>(initial?.mode ?? "team");
  const [size, setSize] = useState<Size>(initial?.size ?? 4);
  const [rows, setRows] = useState<Row[]>(() => initial?.rows ?? emptyRows());
  const [leadPct, setLeadPct] = useState(initial?.leadPct ?? 0);
  const [rta, setRta] = useState(initial?.rta ?? false);
  const [oppSpd, setOppSpd] = useState(initial?.oppSpd ?? 0);
  const [duel, setDuel] = useState<DuelState>(loadDuel);

  // 和其他計算頁一樣，設定留在這台裝置，切去別頁再回來不會不見。
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ size, rows, leadPct, rta, oppSpd, mode }));
    } catch {
      /* 瀏覽器儲存空間不足時忽略 */
    }
  }, [size, rows, leadPct, rta, oppSpd, mode]);

  useEffect(() => {
    try {
      localStorage.setItem(DUEL_KEY, JSON.stringify(duel));
    } catch {
      /* 瀏覽器儲存空間不足時忽略 */
    }
  }, [duel]);

  const rate = rta ? 1.5 : 7;
  const members = rows.slice(0, size);

  /** 進攻防守模式固定用一般 7% */
  const duelRate = 7;

  const patch = (index: number, next: Partial<Row>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...next } : row)));
  };

  const patchDuel = (next: Partial<DuelState>) => setDuel((prev) => ({ ...prev, ...next }));

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

    // 起手要壓過所有後排所需的面板速度（只有明確按下順序修正時才會用到）
    const openerNeed = openerNotFastest.reduce(
      (max, i) => Math.max(max, (results[i]?.panel ?? 0) + 1),
      0,
    );

    return { results, safeExtra, openerPanel, openerTick, opponentSpeed, openerNotFastest, openerNeed };
  }, [members, leadPct, rate, oppSpd]);

  const { results, safeExtra, openerPanel, opponentSpeed, openerNotFastest, openerNeed } = computed;

  /**
   * 進攻防守（3v3）：只有一隻防守、一隻進攻，比的是「誰先滿攻擊條」。
   * 面板 = 基礎 + ceil(基礎 × 隊長技%) + 額外；同速時進攻方先手（與接速頁一致）。
   */
  const duelCalc = useMemo(() => {
    const dBase = baseSpeedOf(duel.defId);
    const dLead = leadBonus(dBase, duel.defLead);
    const dPanel = duel.defId ? dBase + dLead + Math.max(0, duel.defExtra) : 0;

    const aBase = baseSpeedOf(duel.atkId);
    const aLead = leadBonus(aBase, duel.atkLead);
    const aPanel = duel.atkId ? aBase + aLead + Math.max(0, duel.atkExtra) : 0;

    const ready = dPanel > 0 && aBase > 0;
    const needExtra = ready ? Math.max(0, dPanel - aBase - aLead) : null;
    const diff = ready ? aPanel - dPanel : null;
    // 你目前的速度可以壓過多少「防守方額外速度」（含平手，因為同速進攻先手）
    const maxDefExtra = aPanel > 0 && dBase > 0 ? Math.max(0, aPanel - dBase - dLead) : null;

    const dTick = dPanel > 0 ? tickForSpeed({ speed: dPanel, ratePct: duelRate }) : null;
    const aTick = aPanel > 0 ? tickForSpeed({ speed: aPanel, ratePct: duelRate }) : null;

    // 少 1 速時通常還是在同一個 Tick 滿條，只是變成後手，這點要寫出來。
    const almostExtra = needExtra != null ? Math.max(0, needExtra - 1) : null;
    const almostPanel = almostExtra != null && aBase > 0 ? aBase + aLead + almostExtra : 0;
    const almostTick =
      almostPanel > 0 && almostPanel < dPanel ? tickForSpeed({ speed: almostPanel, ratePct: duelRate }) : null;

    return {
      dBase,
      dLead,
      dPanel,
      aBase,
      aLead,
      aPanel,
      ready,
      needExtra,
      diff,
      maxDefExtra,
      dTick,
      aTick,
      almostExtra,
      almostPanel,
      almostTick,
    };
  }, [duel, duelRate]);

  const afterDuelChange = (next: Partial<DuelState>, msg: string) => {
    setDuel((prev) => ({ ...prev, ...next }));
    notify(msg, "ok");
  };

  /** 直接套用每隻後排的接速最低要求（可升可降）；起手沒有下限，維持原值。 */
  const applyFloor = () => {
    const next = rows.map((row, i) => {
      if (i >= size || !row.monsterId || i === 0) return row;
      const floor = results[i]?.minExtra;
      if (typeof floor !== "number" || !Number.isFinite(floor) || floor === row.extra) return row;
      return { ...row, extra: floor };
    });
    const changed = next.reduce((count, row, i) => count + (row !== rows[i] ? 1 : 0), 0);
    if (changed > 0) setRows(next);
    notify(
      changed > 0
        ? `已把 ${changed} 隻設為最低接速要求（起手維持原值）`
        : "目前數值已是最低接速要求",
      changed > 0 ? "ok" : "err",
    );
  };

  /** 保留目前輸入的速度，只把前面不足的成員往上推，確保攻擊順序。 */
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

  /** 以起手為準，把後排降到起手以下；不會低於該隻自己的接速下限。 */
  const applyLowerFollowers = () => {
    if (!(openerPanel > 0)) {
      notify("請先選擇起手，才能用起手速度校正後排", "err");
      return;
    }
    const next = rows.map((row, i) => {
      if (i >= size || !row.monsterId || i === 0) return row;
      const r = results[i];
      if (!r) return row;
      // 起手 404 → 順序 2 最高 403、順序 3 最高 402、順序 4 最高 401
      const cap = openerPanel - i;
      const floor = typeof r.minSpeed === "number" && Number.isFinite(r.minSpeed) ? r.minSpeed : 0;
      const extra = Math.max(0, Math.max(cap, floor) - r.base - r.leadFlat);
      return extra < row.extra ? { ...row, extra } : row;
    });
    const changed = next.reduce((count, row, i) => count + (row !== rows[i] ? 1 : 0), 0);
    if (changed > 0) setRows(next);
    // 有些後排的接速下限本身就高於起手，降到下限還是會超車，這裡要講清楚。
    const stillTooFast: number[] = [];
    next.forEach((row, i) => {
      if (i === 0 || i >= size || !row.monsterId) return;
      const base = baseSpeedOf(row.monsterId);
      if (base + leadBonus(base, leadPct) + Math.max(0, row.extra) >= openerPanel) stillTooFast.push(i);
    });
    if (stillTooFast.length > 0) {
      notify(
        `已調整 ${changed} 隻；第 ${stillTooFast.map((i) => i + 1).join("、")} 隻的接速下限高於起手，無法再降`,
        "err",
      );
      return;
    }
    notify(
      changed > 0 ? `已把 ${changed} 隻後排降到起手速度以下` : "後排速度都已經低於起手",
      changed > 0 ? "ok" : "err",
    );
  };

  const reset = () => {
    if (mode === "duel") {
      setDuel({ ...EMPTY_DUEL });
      notify("已清空進攻防守速度");
      return;
    }
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
      if (need != null && need > members[0].extra) return { text: `起手需再 +${need - members[0].extra}`, cls: "gold" };
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
            {mode === "team" ? <Gauge size={15} className="gold" /> : <Swords size={15} className="gold" />}
            {mode === "team" ? "接速最低速度" : "進攻防守速度（3v3）"}
          </div>
          <div className="card-sub">
            {mode === "team"
              ? "選魔靈後只輸入額外速度；系統用基礎速度、提條、速度強化與隊長技算出每隻的接速需求，不顯示 Tick。"
              : "輸入防守方與進攻方的基礎速度、速度隊長技與額外速度，直接算出進攻方要跑贏所需的額外速度。"}
          </div>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={reset}>
          <RotateCcw size={13} /> 重設
        </button>
      </div>

      <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
        <button
          type="button"
          className={`chip ${mode === "team" ? "gold" : "muted"}`}
          style={{ cursor: "pointer" }}
          onClick={() => setMode("team")}
        >
          隊伍接速
        </button>
        <button
          type="button"
          className={`chip ${mode === "duel" ? "gold" : "muted"}`}
          style={{ cursor: "pointer" }}
          onClick={() => setMode("duel")}
        >
          進攻防守（3v3）
        </button>
        <span className="tiny dim" style={{ alignSelf: "center" }}>
          {mode === "team" ? "一隊 3～5 隻的接速需求" : "兩隻比速度，算跑贏防守所需的最低速度"}
        </span>
      </div>

      {mode === "duel" && (
        <>
          <div
            className="grid"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}
          >
            <div className="card card-pad" style={{ borderColor: "rgba(255,107,107,.3)" }}>
              <div className="row between wrap" style={{ gap: 6 }}>
                <span className="chip red">防守方</span>
                <span className="tiny dim">填 3 隻裡跑最快的那隻</span>
              </div>
              <div style={{ marginTop: 10 }}>
                <MonsterPickerField
                  value={duel.defId}
                  options={MONSTERS}
                  onChange={(id) => patchDuel({ defId: id })}
                  title="防守方跑最快的魔靈"
                  placeholder="選擇防守方魔靈"
                />
              </div>
              <div className="grid g2" style={{ gap: 8, marginTop: 10 }}>
                <label className="col" style={{ gap: 3 }}>
                  <span className="tiny dim">基礎速度</span>
                  <div className="input mono" style={{ opacity: 0.75 }}>
                    {duelCalc.dBase || "—"}
                  </div>
                </label>
                <label className="col" style={{ gap: 3 }}>
                  <span className="tiny dim">速度隊長技 %</span>
                  <NumberInput
                    className="input mono"
                    min={0}
                    max={50}
                    value={duel.defLead}
                    onChange={(v) => patchDuel({ defLead: Math.max(0, Math.min(50, v)) })}
                    title="以防守方自己的基礎速度計算，加成向上取整"
                  />
                </label>
                <label className="col" style={{ gap: 3 }}>
                  <span className="tiny dim">額外速度</span>
                  <NumberInput
                    className="input mono"
                    min={0}
                    max={600}
                    value={duel.defExtra}
                    onChange={(v) => patchDuel({ defExtra: Math.max(0, v) })}
                    title="符文與其他來源的額外速度，例如對方 +238"
                  />
                </label>
                <label className="col" style={{ gap: 3 }}>
                  <span className="tiny dim">面板速度</span>
                  <div className="input mono" style={{ fontWeight: 700 }}>
                    {duelCalc.dPanel || "—"}
                  </div>
                </label>
              </div>
              <div className="tiny dim" style={{ marginTop: 8 }}>
                {duelCalc.dBase > 0
                  ? `${duelCalc.dBase} + ${duelCalc.dLead}（${duel.defLead}% 向上取整） + ${duel.defExtra} = ${duelCalc.dPanel}`
                  : "選好魔靈後自動帶入基礎速度"}
                {duelCalc.dTick != null && Number.isFinite(duelCalc.dTick) ? ` · T${duelCalc.dTick} 滿條` : ""}
              </div>
            </div>

            <div className="card card-pad" style={{ borderColor: "rgba(110,231,183,.3)" }}>
              <div className="row between wrap" style={{ gap: 6 }}>
                <span className="chip green">進攻方（我方）</span>
                <span className="tiny dim">隊長技以這隻的基礎速度計算</span>
              </div>
              <div style={{ marginTop: 10 }}>
                <MonsterPickerField
                  value={duel.atkId}
                  options={MONSTERS}
                  onChange={(id) => patchDuel({ atkId: id })}
                  title="我方要跑贏的那隻（通常是提條角）"
                  placeholder="選擇進攻方魔靈"
                />
              </div>
              <div className="grid g2" style={{ gap: 8, marginTop: 10 }}>
                <label className="col" style={{ gap: 3 }}>
                  <span className="tiny dim">基礎速度</span>
                  <div className="input mono" style={{ opacity: 0.75 }}>
                    {duelCalc.aBase || "—"}
                  </div>
                </label>
                <label className="col" style={{ gap: 3 }}>
                  <span className="tiny dim">速度隊長技 %</span>
                  <NumberInput
                    className="input mono"
                    min={0}
                    max={50}
                    value={duel.atkLead}
                    onChange={(v) => patchDuel({ atkLead: Math.max(0, Math.min(50, v)) })}
                    title="我方隊長技；就算隊長是別隻，只要全隊生效就填這裡"
                  />
                </label>
                <label className="col" style={{ gap: 3 }}>
                  <span className="tiny dim">額外速度</span>
                  <NumberInput
                    className="input mono"
                    min={0}
                    max={600}
                    value={duel.atkExtra}
                    onChange={(v) => patchDuel({ atkExtra: Math.max(0, v) })}
                    title="你目前能配出的額外速度"
                  />
                </label>
                <label className="col" style={{ gap: 3 }}>
                  <span className="tiny dim">面板速度</span>
                  <div className="input mono" style={{ fontWeight: 700 }}>
                    {duelCalc.aPanel || "—"}
                  </div>
                </label>
              </div>
              <div className="tiny dim" style={{ marginTop: 8 }}>
                {duelCalc.aBase > 0
                  ? `${duelCalc.aBase} + ${duelCalc.aLead}（${duel.atkLead}% 向上取整） + ${duel.atkExtra} = ${duelCalc.aPanel}`
                  : "選好魔靈後自動帶入基礎速度"}
                {duelCalc.aTick != null && Number.isFinite(duelCalc.aTick) ? ` · T${duelCalc.aTick} 滿條` : ""}
              </div>
            </div>
          </div>

          <div className="card card-pad" style={{ marginTop: 14 }}>
            <div className="row between wrap" style={{ gap: 10 }}>
              <div>
                <div className="card-title">進攻需要額外速度</div>
                <div className="card-sub">同速時進攻方先手，所以打平就算跑贏</div>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!duelCalc.ready || duelCalc.needExtra == null}
                onClick={() => {
                  const need = duelCalc.needExtra;
                  if (need == null) return;
                  afterDuelChange(
                    { atkExtra: need },
                    `已把進攻方額外速度設為 ${need}（面板 ${duelCalc.dPanel}）`,
                  );
                }}
                title="直接把進攻方的額外速度填成最低需求"
              >
                <Wand2 size={13} /> 套用 {duelCalc.needExtra ?? "—"}
              </button>
            </div>

            <div
              className="row wrap"
              style={{ gap: 26, marginTop: 14, alignItems: "flex-end" }}
            >
              <div>
                <div className="tiny dim">需要額外速度</div>
                <div className="mono" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.15 }}>
                  {duelCalc.needExtra != null ? `+${duelCalc.needExtra}` : "—"}
                </div>
                <div className="tiny dim">需求面板 {duelCalc.dPanel || "—"}</div>
              </div>
              <div>
                <div className="tiny dim">你目前</div>
                <div
                  className="mono"
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    lineHeight: 1.3,
                    color:
                      duelCalc.diff == null
                        ? undefined
                        : duelCalc.diff >= 0
                          ? "var(--green)"
                          : "var(--red)",
                  }}
                >
                  +{duel.atkExtra}
                </div>
                <div className="tiny dim">進攻面板 {duelCalc.aPanel || "—"}</div>
              </div>
              <div style={{ paddingBottom: 2 }}>
                <span
                  className={`chip ${
                    duelCalc.diff == null ? "muted" : duelCalc.diff > 0 ? "green" : duelCalc.diff === 0 ? "gold" : "red"
                  }`}
                >
                  {duelCalc.diff == null
                    ? "尚未選擇"
                    : duelCalc.diff > 0
                      ? `跑贏 ${duelCalc.diff} 速`
                      : duelCalc.diff === 0
                        ? "同速 · 進攻先手"
                        : `還差 ${-duelCalc.diff} 速`}
                </span>
              </div>
            </div>

            {duelCalc.almostTick != null && duelCalc.almostExtra != null && (
              <div className="tiny dim" style={{ marginTop: 8 }}>
                只到 +{duelCalc.almostExtra}（面板 {duelCalc.almostPanel}）時仍會在 T
                {duelCalc.almostTick} 滿條，但會變成後手；同速要絕對保險就再多 +1。
              </div>
            )}

            {duelCalc.maxDefExtra != null && (
              <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
                <span className="chip muted">反推</span>
                <span className="tiny">
                  以你目前 +{duel.atkExtra}（面板 {duelCalc.aPanel}），能跑贏「額外 ≤{" "}
                  <b className="mono gold">{duelCalc.maxDefExtra}</b>」的防守（含平手）。
                </span>
              </div>
            )}

            <div className="table-scroll" style={{ marginTop: 14 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th></th>
                    <th>魔靈</th>
                    <th className="num">基礎</th>
                    <th className="num">隊長技</th>
                    <th className="num">額外</th>
                    <th className="num">面板</th>
                    <th className="num">出手 Tick</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <span className="chip red">防守</span>
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {monsterOf(duel.defId)?.name ?? <span className="dim">尚未選擇</span>}
                    </td>
                    <td className="num mono">{duelCalc.dBase || "—"}</td>
                    <td className="num mono">
                      {duel.defLead > 0 ? `${duelCalc.dLead}（${duel.defLead}%）` : "—"}
                    </td>
                    <td className="num mono">{duel.defId ? duel.defExtra : "—"}</td>
                    <td className="num mono">{duelCalc.dPanel || "—"}</td>
                    <td className="num mono">
                      {duelCalc.dTick != null && Number.isFinite(duelCalc.dTick) ? `T${duelCalc.dTick}` : "—"}
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span className="chip green">進攻</span>
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {monsterOf(duel.atkId)?.name ?? <span className="dim">尚未選擇</span>}
                    </td>
                    <td className="num mono">{duelCalc.aBase || "—"}</td>
                    <td className="num mono">
                      {duel.atkLead > 0 ? `${duelCalc.aLead}（${duel.atkLead}%）` : "—"}
                    </td>
                    <td className="num mono">{duel.atkId ? duel.atkExtra : "—"}</td>
                    <td className="num mono">{duelCalc.aPanel || "—"}</td>
                    <td className="num mono">
                      {duelCalc.aTick != null && Number.isFinite(duelCalc.aTick) ? `T${duelCalc.aTick}` : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div
              className="card-pad tiny dim"
              style={{ borderTop: "1px solid var(--line-soft)", lineHeight: 1.8, marginTop: 4 }}
            >
              <div>
                ※ 面板速度＝基礎＋ceil(基礎 × 隊長技%)＋額外；例：Fiona 106、28% → 106 + 30 + 238 = 374。
              </div>
              <div>※ 3v3 只要贏防守方「跑最快」的那隻；隊長技角不是最快時，請填真正最快的那隻。</div>
              <div>※ 同速時進攻方先手，所以「需要額外」是打平即可；要絕對保險（或對手有額外加成）再多 +1～2。</div>
              <div>※ Tick 以一般 7% 計算；實際滿條後攻擊條會溢出，所以差 1 速常常還是同一個 Tick，只是變成後手。</div>
            </div>
          </div>
        </>
      )}

      {mode === "team" && (
        <>
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
          <div className="row wrap" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={applyFloor}
              disabled={selectedCount === 0}
              title="直接把每隻後排設成自己的接速最低額外（原本比較快的也會降下來）；起手沒有下限，維持原值"
            >
              <Wand2 size={13} /> 計算最低接速要求
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={applySafe}
              disabled={selectedCount === 0}
              title="保留目前輸入，把前面不足的成員往上推，確保第 2 隻比第 3 隻快、第 3 隻比第 4 隻快"
            >
              <ArrowUpNarrowWide size={13} /> 維持攻擊順序
            </button>
          </div>
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
                <th className="num" title="以目前輸入的面板速度為底，只補足不足的成員；按「維持攻擊順序」才會套用">順序安全最低額外</th>
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
          <div>
            ※「計算最低接速要求」會把每隻後排的額外速度直接設成自己的接速最低額外（比下限高的也會被降下來），起手沒有下限所以維持原值；要讓起手真的先出手，請按「維持攻擊順序」或上方衝突提示的動作。
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
              第 {openerNotFastest.map((i) => i + 1).join("、")} 隻的面板速度不低於起手，會比起手先出手：
              {openerNotFastest
                .map((i) => {
                  const name = monsterOf(members[i].monsterId)?.name ?? `第 ${i + 1} 隻`;
                  const panel = results[i]?.panel ?? 0;
                  return `${name} ${panel}（+${panel - openerPanel}）`;
                })
                .join("、")}
              ；起手 {monsterOf(members[0].monsterId)?.name ?? "第 1 隻"} {openerPanel}。
              接速下限本身都達標，要不要為此改速度由你決定。
            </span>
          </div>
          <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
            <button type="button" className="btn btn-sm" onClick={applySafe}>
              <ArrowUpNarrowWide size={13} /> 起手補到 {openerNeed}（+{Math.max(0, openerNeed - openerPanel)}）
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={applyLowerFollowers}>
              <ArrowDownNarrowWide size={13} /> 後排降到起手以下
            </button>
            <span className="tiny dim">降後排只會動到高於起手的那幾隻，且不會低於各自的接速下限。</span>
          </div>
        </div>
      )}
        </>
      )}
    </>
  );
}
