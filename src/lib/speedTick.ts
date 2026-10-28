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
  /** 速度隊長技 %；null / 未設定 = 使用隊伍設定 */
  leadOverride?: number | null;
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

export interface SpeedBlocks {
  /** 未計入圖騰 / 隊長技的總速度（基礎 + 迅速 + 符文） */
  total: number;
  /** 計入圖騰與隊長技後的速度 */
  normal: number;
  /** 速度 Buff（+30%，神器可放大） */
  buffed: number;
  /** 降速（-30%） */
  debuffed: number;
}

/** SWGT 風格的三段速度：降速 / 一般 / Buff */
export function calcSpeedBlocks(u: TickCalcUnit, s: Pick<TickCalcSettings, "totem" | "lead">): SpeedBlocks {
  const pct = (s.totem ?? 0) + (s.lead ?? 0);
  const swift = u.swift ? Math.ceil((u.baseSpd * 25) / 100) : 0;
  const total = Math.ceil(u.baseSpd + u.runeSpd);
  const normal = u.baseSpd + Math.ceil((u.baseSpd * pct) / 100) + swift + u.runeSpd;
  const buffPct = 30 * (1 + (u.artifactPct ?? 0) / 100);
  return {
    total,
    normal,
    buffed: Math.ceil(normal * (1 + buffPct / 100)),
    debuffed: Math.ceil(normal * 0.7),
  };
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

/** 拉條：在指定 Tick 為某隻魔靈增加攻擊條 % */
export interface AbBoost {
  id: string;
  unitId: string;
  tick: number;
  pct: number;
}

/** 速度增減：從指定 Tick 起，速度 ±% */
export interface SpeedModifier {
  id: string;
  unitId: string;
  tick: number;
  pct: number;
}

/** 額外速度：從指定 Tick 起，固定值或 % 加成 */
export interface ExtraSpeed {
  id: string;
  unitId: string;
  tick: number;
  value: number;
  mode: "flat" | "pct";
}

export interface FrameCell {
  unitId: string;
  /** 該 Tick 開始時的攻擊條 %（含拉條） */
  ab: number;
  /** 這個 Tick 是否有出手 */
  acted: boolean;
}

export interface TickFrame {
  tick: number;
  cells: FrameCell[];
}

export interface AdvancedResult {
  events: TurnEvent[];
  frames: TickFrame[];
}

/** 模擬出手順序；同一 Tick 內攻擊條高者先，同攻擊條時比 priority */
export function simulateTickOrder(
  units: { id: string; name: string; spd: number; team: "blue" | "red"; priority: number }[],
  ratePct: number,
  maxTurns = 24,
): TurnEvent[] {
  return simulateAdvanced(units, ratePct, {}, maxTurns, 500).events;
}

/**
 * 進階模擬：拉條、速度增減、額外速度。
 * `mods` / `adds` 從指定 Tick 起持續生效，`boosts` 只在指定 Tick 生效一次。
 */
export function simulateAdvanced(
  units: { id: string; name: string; spd: number; team: "blue" | "red"; priority: number }[],
  ratePct: number,
  opts: { boosts?: AbBoost[]; mods?: SpeedModifier[]; adds?: ExtraSpeed[] } = {},
  maxTurns = 40,
  maxTicks = 20,
): AdvancedResult {
  const { boosts = [], mods = [], adds = [] } = opts;
  const ab = new Map<string, number>(units.map((u) => [u.id, 0]));
  const events: TurnEvent[] = [];
  const frames: TickFrame[] = [];
  if (!units.length || ratePct <= 0) return { events, frames };

  const speedAt = (u: { id: string; spd: number }, tick: number) => {
    const modPct = mods.filter((m) => m.unitId === u.id && m.tick <= tick).reduce((s, m) => s + m.pct, 0);
    let spd = u.spd * (1 + modPct / 100);
    for (const a of adds) {
      if (a.unitId !== u.id || a.tick > tick) continue;
      spd += a.mode === "flat" ? a.value : (u.spd * a.value) / 100;
    }
    return Math.max(0, spd);
  };

  let tick = 0;
  while (tick < 500 && events.length < maxTurns) {
    tick++;
    for (const u of units) ab.set(u.id, (ab.get(u.id) ?? 0) + speedAt(u, tick) * (ratePct / 100));
    for (const b of boosts) {
      if (b.tick !== tick) continue;
      if (ab.has(b.unitId)) ab.set(b.unitId, (ab.get(b.unitId) ?? 0) + b.pct);
    }

    const cells: FrameCell[] = units.map((u) => ({ unitId: u.id, ab: ab.get(u.id) ?? 0, acted: false }));

    let guard = 0;
    while (guard++ < 60) {
      const ready = units.filter((u) => (ab.get(u.id) ?? 0) >= 100 - 1e-9);
      if (!ready.length) break;
      ready.sort(
        (a, b) =>
          (ab.get(b.id) ?? 0) - (ab.get(a.id) ?? 0) ||
          a.priority - b.priority ||
          (a.team === b.team ? 0 : a.team === "blue" ? -1 : 1) ||
          a.name.localeCompare(b.name),
      );
      const u = ready[0];
      const left = (ab.get(u.id) ?? 0) - 100;
      ab.set(u.id, left);
      const cell = cells.find((c) => c.unitId === u.id);
      if (cell) cell.acted = true;
      events.push({
        turn: events.length + 1,
        tick,
        id: u.id,
        name: u.name,
        team: u.team,
        spd: Math.round(speedAt(u, tick) * 10) / 10,
        ab: Math.round(left * 10) / 10,
      });
      if (events.length >= maxTurns) break;
    }

    if (frames.length < maxTicks) {
      frames.push({
        tick,
        cells: cells.map((c) => ({ ...c, ab: Math.round(c.ab * 10) / 10 })),
      });
    }
  }
  return { events, frames };
}
