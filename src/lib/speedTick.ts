/** Speed Tick 計算器：攻擊條、速度 → Tick、回合順序模擬 */

export interface TickCalcSettings {
  /** 每 Tick 的攻擊條 %（一般 7、RTA 1.5、討伐 4.5） */
  rate: number;
  /** 天空圖騰 % */
  totem: number;
  /** 速度隊長技 % */
  lead: number;
}

export interface TickCalcUnit {
  id: string;
  name: string;
  /** 0 = 自行輸入 */
  monsterId: number;
  /** 基礎速度 */
  baseSpd: number;
  /** 符文提供的固定速度 */
  runeSpd: number;
  /** 迅速套裝（+25% 基礎速度） */
  swift: boolean;
  /** 速度 Buff（+30% 基礎速度） */
  buff: boolean;
  /** 神器「速度增加效果 +%」 */
  artifactPct: number;
  team: "blue" | "red";
  /** 同速度時的出手優先度，數字越小越先 */
  priority: number;
}

export const AB_RATES: { label: string; short: string; rate: number; note: string }[] = [
  { label: "一般", short: "7%", rate: 7, note: "一般戰場、競技場、公會戰、據點戰、副本" },
  { label: "RTA", short: "1.5%", rate: 1.5, note: "世界競技場（RTA）" },
  { label: "討伐", short: "4.5%", rate: 4.5, note: "公會討伐戰" },
];

export const LEAD_PRESETS = [0, 10, 15, 16, 17, 19, 20, 21, 23, 24, 28, 30, 33];
export const TOTEM_PRESETS = [0, 5, 10, 15];

/** 單隻魔靈在目前圖騰 / 隊長技下的速度 */
export function calcUnitSpeeds(u: TickCalcUnit, s: Pick<TickCalcSettings, "totem" | "lead">) {
  const pct = (s.totem ?? 0) + (s.lead ?? 0);
  const swift = u.swift ? Math.ceil((u.baseSpd * 25) / 100) : 0;
  const normal = u.baseSpd + Math.ceil((u.baseSpd * pct) / 100) + swift + u.runeSpd;
  // 速度 Buff：基礎速度 +30%；神器「速度增加效果」會再放大 Buff 的效果
  const buffPct = 30 * (1 + (u.artifactPct ?? 0) / 100);
  const buffed = normal + Math.ceil((u.baseSpd * buffPct) / 100);
  const debuffed = normal - Math.ceil((u.baseSpd * 30) / 100);
  return { normal, buffed, debuffed };
}

/** 這隻魔靈實際用於計算 Tick 的速度 */
export function activeSpeed(u: TickCalcUnit, s: Pick<TickCalcSettings, "totem" | "lead">): number {
  const v = calcUnitSpeeds(u, s);
  return u.buff ? v.buffed : v.normal;
}

/** 速度 → 需要幾個 Tick 才能第一次出手 */
export function tickFor(spd: number, ratePct: number): number {
  if (!Number.isFinite(spd) || spd <= 0 || ratePct <= 0) return Infinity;
  return Math.max(1, Math.ceil(100 / (spd * (ratePct / 100)) - 1e-9));
}

/** 要在第 tick 個 Tick 出手所需的最低速度 */
export function minSpeedForTick(tick: number, ratePct: number): number {
  if (!Number.isFinite(tick) || tick <= 0 || ratePct <= 0) return Infinity;
  return Math.ceil(100 / (tick * (ratePct / 100)) - 1e-9);
}

/** 各 Tick 的速度區間（minSpeed ~ maxSpeed） */
export function tickBrackets(ratePct: number, ticks = 12): { tick: number; minSpeed: number; maxSpeed: number }[] {
  return Array.from({ length: ticks }, (_, i) => {
    const tick = i + 1;
    const minSpeed = minSpeedForTick(tick, ratePct);
    const maxSpeed = tick === 1 ? Infinity : minSpeedForTick(tick - 1, ratePct) - 1;
    return { tick, minSpeed, maxSpeed };
  });
}

export interface TurnEvent {
  turn: number;
  tick: number;
  id: string;
  name: string;
  team: "blue" | "red";
  spd: number;
  /** 出手後剩下的攻擊條 %（溢出的部分） */
  ab: number;
}

/** 模擬出手順序；同一 Tick 內攻擊條高者先，同攻擊條時比 priority */
export function simulateTickOrder(
  units: { id: string; name: string; spd: number; team: "blue" | "red"; priority: number }[],
  ratePct: number,
  maxTurns = 24,
): TurnEvent[] {
  const state = units.map((u) => ({ ...u, ab: 0 }));
  const out: TurnEvent[] = [];
  if (!units.length || ratePct <= 0) return out;
  let tick = 0;
  while (out.length < maxTurns && tick < 500) {
    tick++;
    for (const s of state) s.ab += s.spd * (ratePct / 100);
    let guard = 0;
    while (guard++ < 60) {
      const ready = state.filter((s) => s.ab >= 100 - 1e-9);
      if (!ready.length) break;
      ready.sort(
        (a, b) =>
          b.ab - a.ab ||
          a.priority - b.priority ||
          (a.team === b.team ? 0 : a.team === "blue" ? -1 : 1) ||
          a.name.localeCompare(b.name),
      );
      const s = ready[0];
      s.ab -= 100;
      out.push({ turn: out.length + 1, tick, id: s.id, name: s.name, team: s.team, spd: s.spd, ab: Math.round(s.ab * 10) / 10 });
      if (out.length >= maxTurns) break;
    }
  }
  return out;
}
