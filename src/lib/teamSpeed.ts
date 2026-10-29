/**
 * 一鍵配隊的「接速」計算。
 *
 * 這裡只處理頁面上的即時試算，不會改變配符引擎的搜尋條件：
 * - 面板速度：使用者輸入的是「基礎速度以外的額外速度」，總速度 = 基礎 + 額外。
 * - 速度強化：實戰速度 × (1 + 30% × 神器放大)。
 * - 提條：前一隻出手時帶來的攻擊條 %，會降低下一隻要湊到的攻擊條。
 * - 接速最低速度：以前一隻實際出手的 Tick 為基準，下一隻要在下一個 Tick 出手，
 *   回推「未 Buff 的面板速度」需要多少。
 *
 * 公式（ratePct 為每 Tick 攻擊條 %，一般 7、RTA 1.5）：
 *   buffedSpeed × ratePct/100 × targetTick + boostPct >= 100
 *   requiredPanel = (100 - boostPct) / (targetTick × ratePct/100) / (1 + buffPct/100)
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
 * 已知實戰速度、提條 %，第一次出手的 Tick。
 * 提條會直接把攻擊條加上去，所以等價於把「需要的 100%」扣掉提條。
 */
export function tickWithBoost(speed: number, ratePct: number, boostPct = 0): number {
  if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(ratePct) || ratePct <= 0) {
    return Infinity;
  }
  const need = 100 - clamp(finite(boostPct), 0, 100);
  if (need <= 0) return 1;
  return Math.max(1, Math.ceil(need / (speed * (ratePct / 100)) - 1e-9));
}

/** 要在指定 Tick 出手所需的最低「未 Buff」面板速度 */
export function followSpeedRequirement(o: {
  targetTick: number;
  ratePct: number;
  /** 這隻魔靈會收到的提條 % */
  boostPct?: number;
  /** 速度強化後的 Buff %（請用 speedBuffPct 計算） */
  buffPct?: number;
}): number {
  const { targetTick, ratePct } = o;
  if (!Number.isFinite(targetTick) || targetTick <= 0 || !Number.isFinite(ratePct) || ratePct <= 0) {
    return Infinity;
  }
  const boost = clamp(finite(o.boostPct), 0, 100);
  const buff = Math.max(0, finite(o.buffPct));
  const needBuffed = (100 - boost) / (targetTick * (ratePct / 100));
  if (needBuffed <= 0) return 1;
  return Math.max(1, Math.ceil(needBuffed / (1 + buff / 100) - 1e-9));
}

export interface FollowMemberInput {
  /** 攻擊順序；1 = 最先，數字相同時依隊伍順序 */
  order: number;
  baseSpd: number;
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
  /** 目前面板 / 裝備速度是否達到最低要求；沒有速度參考時為 null */
  met: boolean | null;
}

/**
 * 依攻擊順序排出「接速」結果。
 *
 * 第一隻以自身的面板速度 / 目標 Tick / 目前速度決定起手 Tick；
 * 之後每一隻都要求在前一隻出手後的下一個 Tick 出手。
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

  ordered.forEach(({ member, index }, position) => {
    const boostPct = clamp(finite(member.boostPct), 0, 100);
    const buffPct = speedBuffPct(!!member.speedBuff, member.artifactPct);
    const panelSpd = panelSpeed(member.baseSpd, member.panelExtra ?? 0);
    const buffedPanel = panelSpd != null ? panelSpd * (1 + buffPct / 100) : null;
    const panelTick = buffedPanel != null ? tickWithBoost(buffedPanel, ratePct, boostPct) : null;

    const current = Math.max(0, finite(member.currentSpd));
    const currentTick =
      current > 0
        ? tickWithBoost(current * (1 + buffPct / 100), ratePct, boostPct)
        : null;

    const ownTick =
      panelTick ??
      (finite(member.tick) > 0 ? Math.round(finite(member.tick)) : null) ??
      (Number.isFinite(currentTick) ? currentTick : null);

    const anchorTick = prevTick;
    const targetTick = anchorTick != null ? anchorTick + 1 : ownTick;
    const minSpeed =
      targetTick != null
        ? followSpeedRequirement({ targetTick, ratePct, boostPct, buffPct })
        : Infinity;

    const effectiveTick = panelTick ?? targetTick;
    const shownSpd = panelSpd ?? (current > 0 ? current : null);
    const met =
      shownSpd != null && Number.isFinite(minSpeed) ? shownSpd >= minSpeed : null;

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
      met,
    };

    prevTick = Number.isFinite(effectiveTick) ? effectiveTick : null;
  });

  return out;
}
