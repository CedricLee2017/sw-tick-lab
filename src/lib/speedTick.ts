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
  /** 符文 + 套裝的總速度（= 遊戲內 Total Speed − 基礎速度，含迅速加成） */
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

/** Tick 表的欄數（與 SWGT 相同：0 ~ 70） */
export const SPEED_TICK_COLUMNS = 70;

/** 迅速套裝：基礎速度 +25% */
export const SWIFT_SET_BONUS_PCT = 25;

/** 迅速套裝提供的固定速度（= ceil(基礎速度 × 25%)，與 SWGT 相同） */
export function swiftSetBonus(baseSpd: number): number {
  return Math.ceil((baseSpd * SWIFT_SET_BONUS_PCT) / 100);
}

/**
 * SWGT 的攻擊速度公式（不含 Buff / 速度增減）。
 *
 * 額外速度 % 在 SWGT 是加進「天空圖騰 + 速度隊長」的同一個桶（乘基礎速度），
 * 固定額外速度則是加進符文速度，所以兩者都放在這裡算。
 */
export function attackSpeedWith(o: {
  baseSpd: number;
  runeSpd: number;
  swift?: boolean;
  /** 天空圖騰 + 速度隊長 % */
  bonusPct?: number;
  /** 額外速度 %（會加進上面的桶） */
  extraPct?: number;
  /** 額外固定速度 */
  extraFlat?: number;
}): number {
  const bonus = (o.bonusPct ?? 0) + (o.extraPct ?? 0);
  const swift = o.swift ? SWIFT_SET_BONUS_PCT / 100 : 0;
  const swiftBonus = o.swift ? swiftSetBonus(o.baseSpd) : 0;
  return Math.ceil((1 + bonus / 100 + swift) * o.baseSpd + (o.runeSpd + (o.extraFlat ?? 0) - swiftBonus));
}

/** 單隻魔靈在目前圖騰 / 隊長技下的速度 */
export function calcUnitSpeeds(u: TickCalcUnit, s: Pick<TickCalcSettings, "totem" | "lead">) {
  const b = calcSpeedBlocks(u, s);
  return { normal: b.normal, buffed: b.buffed, debuffed: b.debuffed };
}

/** 這隻魔靈實際用於計算 Tick 的速度 */
export function activeSpeed(u: TickCalcUnit, s: Pick<TickCalcSettings, "totem" | "lead">): number {
  const v = calcUnitSpeeds(u, s);
  return u.buff ? v.buffed : v.normal;
}

export interface SpeedBlocks {
  /** 未計入圖騰 / 隊長技的總速度（基礎 + 符文，符文含迅速加成） */
  total: number;
  /** 計入圖騰與隊長技後的速度 */
  normal: number;
  /** 速度 Buff（+30%，神器可放大） */
  buffed: number;
  /** 降速（-30%） */
  debuffed: number;
}

/**
 * SWGT 風格的三段速度：降速 / 一般 / Buff。
 *
 * 公式與 SWGT 完全一致：
 *   final = ceil((1 + 天空圖騰% + 速度隊長% + 迅速0.25) × 基礎速度 + (符文速度 − 迅速加成))
 * 其中 `runeSpd` 是「符文 + 套裝」的總和（= 遊戲內 Total Speed − 基礎速度），
 * 所以迅速加成要先扣掉、再用倍率加回來，才不會重複計算。
 */
export function calcSpeedBlocks(u: TickCalcUnit, s: Pick<TickCalcSettings, "totem" | "lead">): SpeedBlocks {
  const total = Math.ceil(u.baseSpd + u.runeSpd);
  const normal = attackSpeedWith({
    baseSpd: u.baseSpd,
    runeSpd: u.runeSpd,
    swift: u.swift,
    bonusPct: (s.totem ?? 0) + (s.lead ?? 0),
  });
  // 速度 Buff：最終速度 +30%；神器「速度增加效果」會再放大 Buff 的效果
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
  /** 出手當下的攻擊條 %（出手後會歸 0） */
  ab: number;
}

/** 拉條：在指定 Tick 為某隻魔靈增加攻擊條 % */
export interface AbBoost {
  id: string;
  unitId: string;
  tick: number;
  pct: number;
}

/** 速度增減：只在指定 Tick 生效（與 SWGT 的每格設定相同） */
export interface SpeedModifier {
  id: string;
  unitId: string;
  tick: number;
  pct: number;
}

/** 額外速度：只在指定 Tick 生效，固定值或 % 加成 */
export interface ExtraSpeed {
  id: string;
  unitId: string;
  tick: number;
  value: number;
  mode: "flat" | "pct";
}

export interface FrameCell {
  unitId: string;
  /** 該 Tick 累積到的攻擊條 %（出手前，含拉條） */
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

/**
 * 模擬用的魔靈。
 *
 * `spd` 是「目前速度」（已含圖騰、隊長、迅速，以及 Buff）。
 * 若同時提供 `baseSpd` / `runeSpd` / `bonusPct`，額外速度 % 會照 SWGT 的語意
 * 加進圖騰／隊長桶（乘基礎速度），而不是乘最終速度。
 */
export interface SimUnit {
  id: string;
  name: string;
  team: "blue" | "red";
  priority: number;
  /** 目前速度（已含圖騰 / 隊長 / 迅速 / Buff） */
  spd: number;
  baseSpd?: number;
  runeSpd?: number;
  swift?: boolean;
  /** 神器「速度增加效果 +%」 */
  artifactPct?: number;
  /** 天空圖騰 + 速度隊長 %（額外速度 % 會加在這裡） */
  bonusPct?: number;
  /** 速度 Buff 的 %（0 = 沒有 Buff；一般為 30 × 神器放大） */
  buffPct?: number;
}

/** 模擬出手順序；同一 Tick 內攻擊條高者先，同攻擊條時比 priority */
export function simulateTickOrder(units: SimUnit[], ratePct: number, maxTurns = 24): TurnEvent[] {
  return simulateAdvanced(units, ratePct, {}, maxTurns, 500).events;
}

/**
 * 進階模擬：拉條、速度增減、額外速度。
 *
 * 語意與 SWGT 相同：
 * - 三種修飾器都只在「指定的那一個 Tick」生效（範圍請用 UI 的範圍套用）
 * - 速度增減：`spd × (1 + pct%)`，正向增減會被神器「速度增加效果」放大
 *   （`floor(pct × (1 + 神器%) × 100) / 100`，與 SWGT 相同）
 * - 額外速度 %：加進圖騰／隊長桶（乘基礎速度）；固定值：加進符文速度
 *
 * 出手規則也與 SWGT 相同：
 * - 每個 Tick 只有「攻擊條最高且 ≥ 100」的那一隻出手
 * - 出手後攻擊條歸 0，超出的部分不保留
 */
export function simulateAdvanced(
  units: SimUnit[],
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

  const speedAt = (u: SimUnit, tick: number) => {
    const modPct = mods.filter((m) => m.unitId === u.id && m.tick === tick).reduce((s, m) => s + m.pct, 0);
    const mine = adds.filter((a) => a.unitId === u.id && a.tick === tick);
    const extraPct = mine.filter((a) => a.mode === "pct").reduce((s, a) => s + a.value, 0);
    const extraFlat = mine.filter((a) => a.mode === "flat").reduce((s, a) => s + a.value, 0);

    const known = u.baseSpd != null && u.runeSpd != null;
    let spd = known
      ? attackSpeedWith({
          baseSpd: u.baseSpd as number,
          runeSpd: u.runeSpd as number,
          swift: u.swift,
          bonusPct: (u.bonusPct ?? 0) + extraPct,
          extraFlat,
        })
      : u.spd * (1 + extraPct / 100) + extraFlat;
    if (known && u.buffPct) spd = Math.ceil(spd * (1 + u.buffPct / 100));

    // 速度增減：正向的部分會被神器放大，負向不吃神器
    let mod = modPct / 100;
    const artifact = (u.artifactPct ?? 0) / 100;
    if (mod > 0 && artifact > 0) mod = Math.floor(mod * (1 + artifact) * 100) / 100;
    return Math.max(0, spd * (1 + mod));
  };

  let tick = 0;
  while (tick < 500 && events.length < maxTurns) {
    tick++;
    for (const u of units) {
      const gain = speedAt(u, tick) * (ratePct / 100);
      let boost = 0;
      for (const b of boosts) if (b.tick === tick && b.unitId === u.id) boost += b.pct;
      // 與 SWGT 相同：攻擊條 + 拉條 < 0 時視為 0 再加這一 Tick 的累積
      const base = (ab.get(u.id) ?? 0) + boost;
      ab.set(u.id, base < 0 ? gain : base + gain);
    }

    // 這一格顯示「出手前」累積的攻擊條（與 SWGT 的 Tick 表一致）
    const cells: FrameCell[] = units.map((u) => ({ unitId: u.id, ab: ab.get(u.id) ?? 0, acted: false }));

    // 一個 Tick 只有一隻出手：攻擊條最高者；同值時比 Priority，再比藍隊優先
    let actor: SimUnit | null = null;
    for (const u of units) {
      const v = ab.get(u.id) ?? 0;
      if (v < 100 - 1e-9) continue;
      if (!actor) {
        actor = u;
        continue;
      }
      const av = ab.get(actor.id) ?? 0;
      if (v > av + 1e-9) {
        actor = u;
      } else if (Math.abs(v - av) <= 1e-9) {
        if (u.priority < actor.priority) actor = u;
        else if (u.priority === actor.priority) {
          if (u.team !== actor.team && u.team === "blue") actor = u;
          else if (u.team === actor.team && u.name.localeCompare(actor.name) < 0) actor = u;
        }
      }
    }

    if (actor) {
      const value = ab.get(actor.id) ?? 0;
      const cell = cells.find((c) => c.unitId === actor!.id);
      if (cell) cell.acted = true;
      events.push({
        turn: events.length + 1,
        tick,
        id: actor.id,
        name: actor.name,
        team: actor.team,
        spd: Math.round(speedAt(actor, tick) * 10) / 10,
        ab: value,
      });
      ab.set(actor.id, 0);
    }

    if (frames.length < maxTicks) {
      frames.push({ tick, cells: cells.map((c) => ({ ...c })) });
    }
  }
  return { events, frames };
}
