/**
 * 一鍵配隊的「接速」計算。
 *
 * 這裡只處理頁面上的即時試算，不會改變配符引擎的搜尋條件：
 * - 面板速度與目標 Tick 二選一（預設面板速度）。
 * - 面板速度：使用者輸入的是「基礎速度以外的額外速度」，總速度 = 基礎 + 額外。
 * - 速度強化：實戰速度 × (1 + 30% × 神器放大)，視為第一個出手的成員之後才生效。
 * - 提條：前一隻出手時帶來的攻擊條 %，會降低下一隻要湊到的攻擊條。
 * - 接速最低速度：以前一隻實際出手的 Tick 為基準，下一隻要在下一個 Tick 出手，
 *   回推「未 Buff 的面板速度」需要多少。第一隻視為起手，沒有接速下限。
 *
 * 公式（ratePct 為每 Tick 攻擊條 %，一般 7、RTA 1.5）：
 *   effectiveTicks(n) = n + buff% × max(0, n − buffStartTick)
 *   panelSpeed × ratePct/100 × effectiveTicks(targetTick) + boostPct >= 100
 *   requiredPanel = (100 − boostPct) / (ratePct/100) / effectiveTicks(targetTick)
 * 最高速度（再快就會提早一個 Tick 出手）：
 *   maxPanel = (100 − boostPct) / (ratePct/100) / effectiveTicks(targetTick − 1) − 1
 */

export const SPEED_BUFF_BASE_PCT = 30;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const finite = (v: number | undefined | null, fallback = 0) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/** 速度強化提供的 Buff %；神器「速度增加效果 +%」會再放大 Buff */
export function speedBuffPct(active: boolean, artifactPct = 0): number {
  if (!active) return 0;
  return SPEED_BUFF_BASE_PCT * (1 + Math.max(0, finite(artifactPct)) / 100);
}

/** 面板總速度；額外速度未設定（0）時回傳 null */
export function panelSpeed(baseSpd: number, extra: number): number | null {
  const base = Math.max(0, finite(baseSpd));
  const add = Math.max(0, finite(extra));
  return add > 0 ? base + add : null;
}

/** 由目標面板總速度換算成「基礎速度以外的額外速度」 */
export function panelExtraFor(baseSpd: number, totalSpd: number): number {
  return Math.max(0, Math.round(finite(totalSpd) - Math.max(0, finite(baseSpd))));
}

/**
 * 依 Buff 起始 Tick 計算第 n 個 Tick 的等效攻擊條進度（未乘上每 Tick %）。
 * 起始 Tick 之前的 Tick 不受速度強化影響；之後每 Tick 多 buff%。
 * 例如 buffStart=5、buff=30%、n=6 → 6 + 0.3 × 1 = 6.3 個 Tick 的進度。
 */
function weightedTicks(n: number, buffPct: number, buffStartTick: number): number {
  const buff = Math.max(0, finite(buffPct)) / 100;
  const start = Math.max(0, Math.floor(finite(buffStartTick)));
  const buffedTicks = Math.max(0, n - start);
  return n + buff * buffedTicks;
}

/** 已知實戰速度、提條 %、Buff 起始 Tick，第一次出手的 Tick */
export function tickForSpeed(o: {
  speed: number;
  ratePct: number;
  boostPct?: number;
  /** 速度強化 %（0 = 沒有 Buff） */
  buffPct?: number;
  /** 速度強化從第幾個 Tick 開始生效（0 = 一開始就有） */
  buffStartTick?: number;
}): number {
  const { speed, ratePct } = o;
  if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(ratePct) || ratePct <= 0) {
    return Infinity;
  }
  const boost = clamp(finite(o.boostPct), 0, 100);
  const buff = Math.max(0, finite(o.buffPct));
  const start = Math.max(0, Math.floor(finite(o.buffStartTick)));
  for (let n = 1; n <= 200; n++) {
    if (speed * (ratePct / 100) * weightedTicks(n, buff, start) + boost >= 100 - 1e-9) {
      return n;
    }
  }
  return Infinity;
}

/**
 * 已知實戰速度、提條 %，第一次出手的 Tick（速度強化視為一開始就有）。
 * 保留給舊呼叫端與單元測試；需要指定 Buff 起始 Tick 請用 tickForSpeed。
 */
export function tickWithBoost(speed: number, ratePct: number, boostPct = 0): number {
  return tickForSpeed({ speed, ratePct, boostPct });
}

/** 要在指定 Tick 出手所需的最低「未 Buff」面板速度 */
export function followSpeedRequirement(o: {
  targetTick: number;
  ratePct: number;
  /** 這隻魔靈會收到的提條 % */
  boostPct?: number;
  /** 速度強化後的 Buff %（請用 speedBuffPct 計算） */
  buffPct?: number;
  /** 速度強化從第幾個 Tick 開始生效（0 = 一開始就有） */
  buffStartTick?: number;
}): number {
  const { targetTick, ratePct } = o;
  if (!Number.isFinite(targetTick) || targetTick <= 0 || !Number.isFinite(ratePct) || ratePct <= 0) {
    return Infinity;
  }
  const boost = clamp(finite(o.boostPct), 0, 100);
  const buff = Math.max(0, finite(o.buffPct));
  const weight = weightedTicks(targetTick, buff, finite(o.buffStartTick));
  if (weight <= 0) return Infinity;
  const need = (100 - boost) / (ratePct / 100) / weight;
  if (need <= 0) return 1;
  return Math.max(1, Math.ceil(need - 1e-9));
}

/**
 * 要在指定 Tick 出手、又不會提早一個 Tick 出手的最高「未 Buff」面板速度。
 * 超過這個速度就會在前一個 Tick 就滿攻擊條（接速會變成別人先動）。
 * Tick 1 沒有「更早」可言，回傳 Infinity。
 */
export function followSpeedCeiling(o: {
  targetTick: number;
  ratePct: number;
  boostPct?: number;
  buffPct?: number;
  buffStartTick?: number;
}): number {
  const { targetTick, ratePct } = o;
  if (!Number.isFinite(targetTick) || targetTick <= 1 || !Number.isFinite(ratePct) || ratePct <= 0) {
    return Infinity;
  }
  const boost = clamp(finite(o.boostPct), 0, 100);
  const buff = Math.max(0, finite(o.buffPct));
  const weight = weightedTicks(targetTick - 1, buff, finite(o.buffStartTick));
  if (weight <= 0) return Infinity;
  const need = (100 - boost) / (ratePct / 100) / weight;
  if (need <= 0) return 0;
  return Math.max(0, Math.ceil(need - 1e-9) - 1);
}

export type SpeedMode = "panel" | "tick";

export interface FollowMemberInput {
  /** 攻擊順序；1 = 最先，數字相同時依隊伍順序 */
  order: number;
  baseSpd: number;
  /** 速度條件：面板速度或目標 Tick（預設 panel；只採用其中一個） */
  mode?: SpeedMode;
  /** 面板額外速度；0 / 未設定 = 不指定 */
  panelExtra?: number;
  /** 目標 Tick；0 = 不指定 */
  tick?: number;
  /** 這隻魔靈會收到的提條 % */
  boostPct?: number;
  /** 是否有速度強化 */
  speedBuff?: boolean;
  /** 神器「速度增加效果 +%」 */
  artifactPct?: number;
  /** 沒有面板速度 / 目標 Tick 時，用目前裝備的速度當起手基準 */
  currentSpd?: number;
}

export interface FollowMemberResult<T extends FollowMemberInput = FollowMemberInput> {
  member: T;
  /** 在原始 members 陣列中的索引 */
  index: number;
  /** 攻擊順序（0 = 第一隻） */
  position: number;
  /** 前一隻的實際出手 Tick；第一隻為 null */
  anchorTick: number | null;
  /** 這隻預計要出手的 Tick */
  targetTick: number | null;
  /** 依面板額外速度算出的總速度；未設定為 null */
  panelSpd: number | null;
  /** 面板速度（含速度強化）第一次出手的 Tick */
  panelTick: number | null;
  /** 目前裝備速度（未 Buff 面板速度）；沒有目前速度時為 null */
  currentSpd: number | null;
  /** 目前裝備速度（含速度強化 / 提條）第一次出手的 Tick */
  currentTick: number | null;
  /** 下一隻接速時要對齊的 Tick */
  effectiveTick: number | null;
  boostPct: number;
  buffPct: number;
  /** 未 Buff 面板速度的最低要求；無法計算時為 Infinity */
  minSpeed: number;
  /** 要停在目標 Tick 的最高面板速度；超過就會提早出手，無法計算時為 Infinity */
  maxSpeed: number;
  /** 目前面板 / 裝備速度是否達到最低要求；沒有速度參考時為 null */
  met: boolean | null;
}

/**
 * 依攻擊順序排出「接速」結果。
 *
 * 第一隻視為起手，只決定自己的出手 Tick，沒有接速下限；
 * 之後每一隻都要求在前一隻出手後的下一個 Tick 出手。
 * 速度強化視為第一個出手的成員之後才生效（提條角通常在最前面）。
 * 面板速度與目標 Tick 是二選一：面板模式只看面板速度，Tick 模式只看目標 Tick。
 * 回傳陣列與輸入順序相同，方便頁面用索引對應。
 */
export function computeFollowPlan<T extends FollowMemberInput>(
  members: T[],
  ratePct: number,
): FollowMemberResult<T>[] {
  const indexed = members.map((member, index) => ({ member, index }));
  const ordered = [...indexed].sort((a, b) => {
    const oa = Math.max(1, Math.floor(finite(a.member.order, 1)));
    const ob = Math.max(1, Math.floor(finite(b.member.order, 1)));
    return oa - ob || a.index - b.index;
  });

  const out: FollowMemberResult<T>[] = new Array(members.length);
  let prevTick: number | null = null;
  /** 速度強化從第一個實際出手的成員之後開始生效（提條角通常在最前面） */
  let buffStartTick: number | null = null;

  ordered.forEach(({ member, index }, position) => {
    const mode: SpeedMode = member.mode ?? "panel";
    const boostPct = clamp(finite(member.boostPct), 0, 100);
    const buffPct = speedBuffPct(!!member.speedBuff, member.artifactPct);
    const buffStart = buffStartTick ?? 0;
    const panelSpd = mode === "panel" ? panelSpeed(member.baseSpd, member.panelExtra ?? 0) : null;
    const panelTick =
      panelSpd != null
        ? tickForSpeed({ speed: panelSpd, ratePct, boostPct, buffPct, buffStartTick: buffStart })
        : null;

    const current = Math.max(0, finite(member.currentSpd));
    const currentTick =
      current > 0
        ? tickForSpeed({ speed: current, ratePct, boostPct, buffPct, buffStartTick: buffStart })
        : null;

    // 這一隻自己指定的出手 Tick（只有 Tick 模式才算數）
    const tickValue = mode === "tick" && finite(member.tick) > 0 ? Math.round(finite(member.tick)) : null;

    const anchorTick = prevTick;
    // 第一隻沒有前一隻，因此沒有接速下限
    const targetTick = anchorTick != null ? anchorTick + 1 : null;
    const minSpeed =
      targetTick != null
        ? followSpeedRequirement({ targetTick, ratePct, boostPct, buffPct, buffStartTick: buffStart })
        : Infinity;
    const maxSpeed =
      targetTick != null
        ? followSpeedCeiling({ targetTick, ratePct, boostPct, buffPct, buffStartTick: buffStart })
        : Infinity;

    // 實際用來串下一隻的 Tick：面板 / 目標 Tick 優先，其次目前裝備速度
    const effectiveTick =
      (mode === "panel" ? panelTick : tickValue) ?? (anchorTick != null ? targetTick : currentTick);
    const shownSpd = panelSpd ?? (current > 0 ? current : null);
    const met =
      targetTick != null && shownSpd != null && Number.isFinite(minSpeed)
        ? shownSpd >= minSpeed
        : null;

    out[index] = {
      member,
      index,
      position,
      anchorTick,
      targetTick,
      panelSpd,
      panelTick,
      currentSpd: current > 0 ? current : null,
      currentTick: Number.isFinite(currentTick) ? currentTick : null,
      effectiveTick,
      boostPct,
      buffPct,
      minSpeed,
      maxSpeed,
      met,
    };

    if (buffStartTick == null && Number.isFinite(effectiveTick)) buffStartTick = effectiveTick;
    prevTick = Number.isFinite(effectiveTick) ? effectiveTick : null;
  });

  return out;
}
