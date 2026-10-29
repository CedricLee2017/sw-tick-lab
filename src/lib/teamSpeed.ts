/**
 * 一鍵配隊的「接速」計算（鏡像防守模型）。
 *
 * 接速不是「自己人一個接一個出手」，而是「提條之後，對手沒機會插隊」。
 * 最實用的檢查方式就是鏡像：假設防守方有一隻和你同速的提條角，
 * 進攻方同速會先動（同攻擊條時進攻方優先），之後防守方那隻會留在場上
 * 繼續累積攻擊條，所以你的打手必須在「輪到它的那個 Tick」攻擊條仍然高過對手。
 *
 * 規則（與 SWGT Speed Tick Bracket Calculator 相同）：
 * - 攻擊條不會停在 100%，可以溢出；攻擊條最高者先動。
 * - 攻擊條相同時比優先度，進攻方（我方）優先。
 * - 提條與速度強化都在出手「之後」才生效（提條角在第 T Tick 出手 → 第 T+1 Tick 生效）。
 * - 面板速度與目標 Tick 二選一（預設面板速度）。
 *
 * 公式（ratePct = 每 Tick 攻擊條 %，一般 7、RTA 1.5）：
 *   面板速度 = 基礎速度 + ceil(基礎速度 × 速度隊長技%) + 額外速度（符文 / 其他）
 *   weightedTicks(n) = n + Buff% × max(0, n − 起手 Tick)
 *   我方攻擊條(n) = 面板速度 × ratePct/100 × weightedTicks(n) + 提條%
 *   對手攻擊條(n) = 鏡像對手速度 × ratePct/100 × n
 *   最低速度 = 最小的整數 S，使 我方攻擊條(目標 Tick) ≥ 對手攻擊條(目標 Tick)
 *
 * 例：風格 391（T4）提條 30%、速度強化 30%
 *   風武士要接 T5：對手攻擊條 = 391 × 7% × 5 = 136.9%，最低 289（基礎 103 + 額外 186）
 *   風忍要接 T6：對手攻擊條 = 391 × 7% × 6 = 164.2%，最低 291（基礎 107 + 額外 184）
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

/**
 * 速度隊長技帶來的固定速度：以「基礎速度 × %」計算並向上取整，
 * 與遊戲面板（先算基礎速度的百分比、再加符文速度）一致。
 */
export function leadBonus(baseSpd: number, leadPct = 0): number {
  const base = Math.max(0, finite(baseSpd));
  const pct = Math.max(0, finite(leadPct));
  return pct > 0 ? Math.ceil((base * pct) / 100) : 0;
}

/**
 * 面板總速度 = 基礎速度 + 隊長技加成 + 額外速度（符文 / 其他）。
 * 額外速度未設定（0）時回傳 null（代表「尚未指定面板速度」）。
 */
export function panelSpeed(baseSpd: number, extra: number, leadPct = 0): number | null {
  const base = Math.max(0, finite(baseSpd));
  const add = Math.max(0, finite(extra));
  return add > 0 ? base + leadBonus(base, leadPct) + add : null;
}

/** 由目標面板總速度換算成「基礎速度與隊長技以外的額外速度」 */
export function panelExtraFor(baseSpd: number, totalSpd: number, leadPct = 0): number {
  return Math.max(
    0,
    Math.round(finite(totalSpd) - Math.max(0, finite(baseSpd)) - leadBonus(baseSpd, leadPct)),
  );
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

/**
 * 提條角出手（第 buffStartTick 個 Tick）「之後」才吃到提條與速度強化時，
 * 這隻魔靈第一次出手的 Tick。起手回合以前只有原本的速度。
 */
export function tickAfterBoost(o: {
  speed: number;
  ratePct: number;
  boostPct?: number;
  buffPct?: number;
  buffStartTick: number;
}): number {
  const { speed, ratePct } = o;
  if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(ratePct) || ratePct <= 0) {
    return Infinity;
  }
  const boost = clamp(finite(o.boostPct), 0, 100);
  const buff = Math.max(0, finite(o.buffPct));
  const start = Math.max(0, Math.floor(finite(o.buffStartTick)));
  for (let n = 1; n <= 200; n++) {
    const after = n > start;
    const ab =
      speed * (ratePct / 100) * weightedTicks(n, after ? buff : 0, start) + (after ? boost : 0);
    if (ab >= 100 - 1e-9) return n;
  }
  return Infinity;
}

/** 第 tick 個 Tick 時，鏡像對手（未 Buff、未提條）累積的攻擊條 % */
export function opponentAttackBar(o: {
  tick: number;
  ratePct: number;
  opponentSpeed: number;
}): number {
  const { tick, ratePct, opponentSpeed } = o;
  if (!Number.isFinite(tick) || tick <= 0 || !Number.isFinite(ratePct) || ratePct <= 0) return 0;
  return Math.max(0, finite(opponentSpeed)) * (ratePct / 100) * tick;
}

/**
 * 要在指定 Tick「不輸給鏡像對手」所需的最低面板速度。
 * 攻擊條相同時進攻方先動，所以門檻是 ≥（不是嚴格大於）。
 */
export function followSpeedAgainstOpponent(o: {
  targetTick: number;
  ratePct: number;
  /** 鏡像對手（通常同速防守風格）的速度 */
  opponentSpeed: number;
  /** 這隻魔靈會收到的提條 % */
  boostPct?: number;
  /** 速度強化後的 Buff %（請用 speedBuffPct 計算） */
  buffPct?: number;
  /** 速度強化從第幾個 Tick 開始生效（通常是提條角出手的 Tick） */
  buffStartTick?: number;
}): number {
  const { targetTick, ratePct } = o;
  if (!Number.isFinite(targetTick) || targetTick <= 0 || !Number.isFinite(ratePct) || ratePct <= 0) {
    return Infinity;
  }
  const oppAb = opponentAttackBar({ tick: targetTick, ratePct, opponentSpeed: o.opponentSpeed });
  if (!Number.isFinite(oppAb) || oppAb <= 0) return Infinity;
  const boost = clamp(finite(o.boostPct), 0, 100);
  const buff = Math.max(0, finite(o.buffPct));
  const weight = weightedTicks(targetTick, buff, finite(o.buffStartTick));
  const perSpeed = (ratePct / 100) * weight;
  if (perSpeed <= 0) return Infinity;
  const need = (oppAb - boost) / perSpeed;
  if (need <= 1) return 1;
  return Math.max(1, Math.ceil(need - 1e-9));
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
  /** 速度隊長技 %（以這隻的基礎速度計算；0 / 未設定 = 沒有隊長技） */
  leadPct?: number;
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
  /** 這隻預計要出手的 Tick；第一隻為 null */
  targetTick: number | null;
  /** 依面板額外速度算出的總速度；未設定為 null */
  panelSpd: number | null;
  /** 這隻套用的速度隊長技 % */
  leadPct: number;
  /** 速度隊長技帶來的固定速度（基礎 × %，向上取整） */
  leadFlat: number;
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
  /** 鏡像對手（提條角）的速度 */
  opponentSpeed: number;
  /** 對手在目標 Tick 的攻擊條 % */
  opponentAb: number;
  /** 自己在目標 Tick 的攻擊條 %；沒有速度參考時為 null */
  myAb: number | null;
  /** 不輸給對手所需的最低面板速度；無法計算時為 Infinity */
  minSpeed: number;
  /** 目前面板 / 裝備速度是否達到最低要求；沒有速度參考時為 null */
  met: boolean | null;
}

export interface MirrorOptions {
  /** 鏡像對手速度；0 / 省略 = 用起手者的面板速度（同速防守風格） */
  opponentSpeed?: number;
}

export interface MirrorStep {
  tick: number;
  team: "ally" | "opponent";
  /** 對應 members 的索引（鏡像對手沿用同一索引） */
  index: number;
  /** 出手當下的攻擊條 % */
  ab: number;
}

const orderOf = (m: FollowMemberInput) => Math.max(1, Math.floor(finite(m.order, 1)));

/**
 * 依攻擊順序排出「接速」結果（鏡像防守）。
 *
 * 第一隻視為起手：只決定自己的出手 Tick，沒有接速下限。
 * 之後每一隻都要在「前一隻出手後的下一個 Tick」之前追上對手，
 * 這裡用鏡像對手（同速防守提條角）在該 Tick 的攻擊條當門檻。
 * 速度強化視為起手之後才生效（提條角通常在最前面）。
 */
export function computeFollowPlan<T extends FollowMemberInput>(
  members: T[],
  ratePct: number,
  opts: MirrorOptions = {},
): FollowMemberResult<T>[] {
  const indexed = members.map((member, index) => ({ member, index }));
  const ordered = [...indexed].sort((a, b) => orderOf(a.member) - orderOf(b.member) || a.index - b.index);
  const out: FollowMemberResult<T>[] = new Array(members.length);
  if (!ordered.length) return out;

  // 起手：只用面板速度 / 目標 Tick / 目前速度決定自己的 Tick
  const opener = ordered[0].member;
  const openerMode: SpeedMode = opener.mode ?? "panel";
  const openerLeadPct = Math.max(0, finite(opener.leadPct));
  const openerPanel =
    openerMode === "panel"
      ? panelSpeed(opener.baseSpd, opener.panelExtra ?? 0, openerLeadPct)
      : null;
  const openerCurrent = Math.max(0, finite(opener.currentSpd));
  const openerTick =
    openerMode === "tick" && finite(opener.tick) > 0
      ? Math.round(finite(opener.tick))
      : openerPanel != null
        ? tickForSpeed({ speed: openerPanel, ratePct })
        : openerCurrent > 0
          ? tickForSpeed({ speed: openerCurrent, ratePct })
          : null;
  const openerSpd = openerPanel ?? (openerCurrent > 0 ? openerCurrent : null);
  const opponentSpeed = Math.max(0, finite(opts.opponentSpeed) || openerSpd || 0);
  const buffStart = openerTick ?? 0;

  let prevTick: number | null = openerTick;

  ordered.forEach(({ member, index }, position) => {
    const mode: SpeedMode = member.mode ?? "panel";
    const boostPct = clamp(finite(member.boostPct), 0, 100);
    const buffPct = speedBuffPct(!!member.speedBuff, member.artifactPct);
    // 速度隊長技對全隊都有效（含起手），以這隻自己的基礎速度計算
    const leadPct = Math.max(0, finite(member.leadPct));
    const leadFlat = leadBonus(member.baseSpd, leadPct);
    // 起手自己不會吃到自己的提條 / 速度強化
    const start = position === 0 ? 0 : buffStart;
    const ownBuff = position === 0 ? 0 : buffPct;
    const ownBoost = position === 0 ? 0 : boostPct;
    const panelSpd =
      mode === "panel" ? panelSpeed(member.baseSpd, member.panelExtra ?? 0, leadPct) : null;
    const panelTick =
      panelSpd != null
        ? tickAfterBoost({
            speed: panelSpd,
            ratePct,
            boostPct: ownBoost,
            buffPct: ownBuff,
            buffStartTick: start,
          })
        : null;

    const current = Math.max(0, finite(member.currentSpd));
    const currentTick =
      current > 0
        ? tickAfterBoost({
            speed: current,
            ratePct,
            boostPct: ownBoost,
            buffPct: ownBuff,
            buffStartTick: start,
          })
        : null;

    // 這一隻自己指定的出手 Tick（只有 Tick 模式才算數）
    const tickValue = mode === "tick" && finite(member.tick) > 0 ? Math.round(finite(member.tick)) : null;

    // 起手沒有前一隻，因此沒有接速下限
    const anchorTick = position === 0 ? null : prevTick;
    const targetTick =
      position === 0 ? null : (tickValue ?? (anchorTick != null ? anchorTick + 1 : null));

    const mySpd = panelSpd ?? (current > 0 ? current : null);
    const opponentAb =
      targetTick != null ? opponentAttackBar({ tick: targetTick, ratePct, opponentSpeed }) : 0;
    const myAb =
      targetTick != null && mySpd != null
        ? mySpd * (ratePct / 100) * weightedTicks(targetTick, ownBuff, start) + ownBoost
        : null;
    const minSpeed =
      targetTick != null
        ? followSpeedAgainstOpponent({
            targetTick,
            ratePct,
            opponentSpeed,
            boostPct: ownBoost,
            buffPct: ownBuff,
            buffStartTick: start,
          })
        : Infinity;
    const met =
      targetTick != null && myAb != null && opponentAb > 0 ? myAb >= opponentAb - 1e-9 : null;

    // 實際用來串下一隻的 Tick：面板 / 目標 Tick 優先，其次目前裝備速度
    const effectiveTick =
      (mode === "panel" ? panelTick : tickValue) ?? targetTick ?? (Number.isFinite(currentTick) ? currentTick : null);

    out[index] = {
      member,
      index,
      position,
      anchorTick,
      targetTick,
      panelSpd,
      leadPct,
      leadFlat,
      panelTick: Number.isFinite(panelTick) ? panelTick : null,
      currentSpd: current > 0 ? current : null,
      currentTick: Number.isFinite(currentTick) ? currentTick : null,
      effectiveTick,
      boostPct: ownBoost,
      buffPct: ownBuff,
      opponentSpeed,
      opponentAb,
      myAb,
      minSpeed,
      met,
    };

    if (position > 0) {
      // 下一隻接在這隻「預計出手」的下一個 Tick（不是它最早可能滿 100% 的 Tick）
      prevTick = targetTick ?? prevTick;
    }
  });

  return out;
}

/**
 * 用「攻擊條溢出」規則模擬鏡像對戰，回傳每一 Tick 誰先出手。
 * 我方拿到提條與速度強化，鏡像對手只有相同速度（沒有提條 / Buff）。
 * 攻擊條相同時我方先出手（進攻方優先）。
 *
 * 我方成員只會在「排定的 Tick」之後才出手（起手 T、之後 T+1、T+2…），
 * 這樣模擬結果才會和每隻的接速判定一致；比排定更早滿 100% 的情况
 * 由畫面上的「最早 T」提示，不在這裡插隊。
 */
export function mirrorTimeline(
  plan: FollowMemberResult[],
  ratePct: number,
  maxTicks = 12,
): MirrorStep[] {
  const opener = plan.find((p) => p.position === 0);
  if (!opener) return [];
  const T = opener.effectiveTick ?? opener.panelTick;
  if (T == null || !Number.isFinite(T)) return [];
  const rate = ratePct / 100;
  if (!(rate > 0)) return [];

  const spdOf = (p: FollowMemberResult) => p.panelSpd ?? p.currentSpd ?? 0;
  const allies = plan.filter((p) => spdOf(p) > 0 && p.position >= 0);
  if (!allies.length) return [];

  /** 這隻最早可以在哪個 Tick 出手（排定順序） */
  const readyOf = (p: FollowMemberResult) =>
    p.position === 0 ? T : (p.targetTick ?? T + p.position);

  const bars = new Map<string, number>();
  const keyOf = (team: "ally" | "opponent", index: number) => `${team}:${index}`;
  for (const p of allies) {
    bars.set(keyOf("ally", p.index), 0);
    bars.set(keyOf("opponent", p.index), 0);
  }

  const steps: MirrorStep[] = [];
  for (let tick = 1; tick <= maxTicks; tick++) {
    for (const p of allies) {
      const base = spdOf(p) * rate;
      const buffed = p.position > 0 && tick > T ? base * (1 + p.buffPct / 100) : base;
      const boost = p.position > 0 && tick === T + 1 ? p.boostPct : 0;
      const aKey = keyOf("ally", p.index);
      bars.set(aKey, (bars.get(aKey) ?? 0) + buffed + boost);
      const oKey = keyOf("opponent", p.index);
      bars.set(oKey, (bars.get(oKey) ?? 0) + spdOf(p) * rate);
    }

    let best: { team: "ally" | "opponent"; index: number; ab: number; position: number } | null = null;
    for (const p of allies) {
      for (const team of ["ally", "opponent"] as const) {
        const ab = bars.get(keyOf(team, p.index)) ?? 0;
        if (ab < 100 - 1e-9) continue;
        if (team === "ally" && tick < readyOf(p)) continue;
        const candidate = { team, index: p.index, ab, position: p.position };
        if (!best) {
          best = candidate;
          continue;
        }
        if (ab > best.ab + 1e-9) best = candidate;
        else if (Math.abs(ab - best.ab) <= 1e-9) {
          // 攻擊條相同：我方（進攻方）優先；同隊再比攻擊順序
          if (candidate.team !== best.team) {
            if (candidate.team === "ally") best = candidate;
          } else if (p.position < best.position) best = candidate;
        }
      }
    }

    if (best) {
      bars.set(keyOf(best.team, best.index), 0);
      steps.push({ tick, team: best.team, index: best.index, ab: Math.round(best.ab * 10) / 10 });
    }
  }

  return steps;
}
