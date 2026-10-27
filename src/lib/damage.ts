/** 技能傷害估算（以 SWARFARM 技能倍率公式 + 配裝面板代入） */
import type { Artifact, Stats } from "./types";
import { artifactDamageBonus } from "./artifacts";

export interface Skill {
  id: number;
  n: string;
  slot: number;
  hits: number;
  aoe: boolean;
  passive: boolean;
  cool: number;
  max: number;
  /** 人類可讀倍率公式，例如 3.6*{ATK} */
  f: string;
  raw: string;
  sc: string[];
  /** 滿技時「Damage +x%」的總和 */
  up: number;
  /** SWARFARM 特殊效果 id（23 = 炸彈、38 = 無視防禦） */
  e: number[];
  d: string;
}

export interface SkillData {
  source: string;
  fetchedAt: string;
  monsters: Record<string, number[]>;
  skills: Record<string, Skill>;
}

export type CritMode = "crit" | "normal" | "average";

export interface DamageOptions {
  crit: CritMode;
  skillUps: boolean;
  enemyDef: number;
  enemyMaxHp: number;
  /** 0~100 */
  enemyHpPct: number;
  enemySpd: number;
  /** 0~100 */
  selfHpPct: number;
  atkBuff: number;
  leadAtk: number;
  defBreak: boolean;
  brand: boolean;
  ignoreDef: boolean;
  aliveEnemies: number;
  alliesAlive: number;
  /** 是否計入公會建築（公會攻擊/暴傷旗幟） */
  useGuild: boolean;
  /** 敵方屬性 1–5；0 = 未指定（神器「對某屬性傷害」不計入） */
  enemyEl: number;
  /** 是否計入神器的直接傷害加成（技能暴傷 / 屬性傷害） */
  useArtifacts: boolean;
}

export interface DamageResult {
  total: number;
  perHit: number;
  hits: number;
  /** 防禦減傷係數 0~1 */
  mitigation: number;
  /** 未計防禦減傷的總傷害（含暴擊/技能升級/烙印） */
  rawTotal: number;
  /** 未支援的公式變數 */
  unsupported: string[];
  /** 是否為炸彈（不暴擊、無視防禦） */
  bomb: boolean;
  /** 神器套用的暴傷 / 屬性傷害加成 */
  artifact?: { cd: number; dmg: number; applied: string[] };
}

let skillPromise: Promise<SkillData> | null = null;

/** 技能資料只在需要時載入一次（public/data/skills.json） */
export function loadSkillData(): Promise<SkillData> {
  if (!skillPromise) {
    const url = `${import.meta.env.BASE_URL}data/skills.json`;
    skillPromise = fetch(url, { cache: "force-cache" })
      .then((res) => {
        if (!res.ok) throw new Error(`技能資料載入失敗（${res.status}）`);
        return res.json() as Promise<SkillData>;
      })
      .catch((err) => {
        skillPromise = null;
        throw err;
      });
  }
  return skillPromise;
}

/** 某隻魔靈可選的傷害技能（被動、沒有倍率公式的技能先排除） */
export function skillsForMonster(data: SkillData | null, monsterId: number): Skill[] {
  if (!data || !monsterId) return [];
  const ids = data.monsters[String(monsterId)] ?? [];
  return ids
    .map((id) => data.skills[String(id)])
    .filter((s): s is Skill => !!s && !s.passive && !!s.f.trim())
    .sort((a, b) => a.slot - b.slot || a.id - b.id);
}

/** 預設技能：優先選最後一格（S3）有傷害字樣的技能，否則選最後一招 */
export function defaultSkill(skills: Skill[]): Skill | undefined {
  if (skills.length === 0) return undefined;
  const damaging = skills.filter((s) => /damage|attack|inflict/i.test(s.d) || /\{ATK\}|\{DEF\}|\{MAX HP\}/.test(s.f));
  const pool = damaging.length > 0 ? damaging : skills;
  return [...pool].sort((a, b) => b.slot - a.slot)[0];
}

/** 把 {TOKEN} 換成數值，再用遞迴下降解析 + - * / 與括號 */
function evalFormula(formula: string, vars: Record<string, number>): { value: number; unsupported: string[] } {
  const unsupported: string[] = [];
  const expr = formula
    .replace(/\(Fixed\)/gi, "")
    .replace(/\{([^}]+)\}/g, (_, rawToken: string) => {
      const token = rawToken.trim();
      const v = vars[token];
      if (v === undefined) {
        unsupported.push(token);
        return "(0)";
      }
      return `(${v})`;
    });
  const tokens = expr.match(/\d+(?:\.\d+)?|[()+\-*/]/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];

  const parseFactor = (): number => {
    const t = peek();
    if (t === undefined) return 0;
    if (t === "-") {
      next();
      return -parseFactor();
    }
    if (t === "+") {
      next();
      return parseFactor();
    }
    if (t === "(") {
      next();
      const v = parseExpr();
      if (peek() === ")") next();
      return v;
    }
    const n = Number(t);
    next();
    return Number.isFinite(n) ? n : 0;
  };

  const parseTerm = (): number => {
    let v = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = next();
      const rhs = parseFactor();
      v = op === "*" ? v * rhs : rhs === 0 ? 0 : v / rhs;
    }
    return v;
  };

  const parseExpr = (): number => {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const rhs = parseTerm();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  };

  const value = parseExpr();
  return { value: Number.isFinite(value) ? value : 0, unsupported };
}

/** 依面板與選項估算一招技能的傷害 */
export function computeSkillDamage(
  stats: Stats,
  skill: Skill,
  opts: DamageOptions,
  artifacts?: Artifact[],
): DamageResult {
  const artifact = opts.useArtifacts !== false
    ? artifactDamageBonus(artifacts, skill, opts.enemyEl)
    : { cd: 0, dmg: 0, applied: [] };
  const atk = stats.atk * (1 + (opts.atkBuff + opts.leadAtk) / 100);
  const hp = stats.hp;
  const selfHpPct = Math.max(0, Math.min(100, opts.selfHpPct));
  const enemyHpPct = Math.max(0, Math.min(100, opts.enemyHpPct));
  const vars: Record<string, number> = {
    ATK: atk,
    HP: hp,
    "MAX HP": hp,
    DEF: stats.def,
    SPD: stats.spd,
    ATTACK_SPEED: stats.spd,
    "Target MAX HP": Math.max(1, opts.enemyMaxHp),
    "Target Current HP %": enemyHpPct / 100,
    "Current HP %": selfHpPct / 100,
    "Current HP": (hp * selfHpPct) / 100,
    "Missing HP": (hp * (100 - selfHpPct)) / 100,
    "Attacker's Level": 40,
    "Target SPD": Math.max(1, opts.enemySpd),
    "Alive Enemies": Math.max(1, opts.aliveEnemies),
    "Surviving Allies": Math.max(1, opts.alliesAlive),
    "Living Ally %": Math.max(1, opts.alliesAlive) / 4,
    "Alive Allies %": Math.max(1, opts.alliesAlive) / 4,
    "Relative SPD": 0,
    "Life Share": 0,
    "Life Share (AOE)": 0,
  };

  const parsed = evalFormula(skill.f, vars);
  const bomb = skill.e.includes(23);
  const ignoreDef = opts.ignoreDef || bomb;
  const hits = Math.max(1, skill.hits || 1);
  // SWOP 的「滿技」是與暴擊係數相加，而非相乘：DMG = 基礎 × (品牌 × 暴擊 + 滿技%)
  const skillUpFrac = opts.skillUps ? Math.max(0, skill.up) / 100 : 0;
  let critFactor = 1;
  if (!bomb) {
    const cd = Math.max(0, stats.cd) + artifact.cd;
    if (opts.crit === "crit") critFactor = 1 + cd / 100;
    else if (opts.crit === "average") {
      critFactor = 1 + (Math.max(0, Math.min(100, stats.cr)) / 100) * (cd / 100);
    }
  }
  const brandMul = opts.brand ? 1.25 : 1;
  const effectiveDef = Math.max(0, opts.enemyDef) * (opts.defBreak ? 0.3 : 1);
  // 無視防禦時仍會套用 1140 的基礎係數：1000 / 1140 ≈ 0.8772（與 SWOP 一致）
  const mitigation = ignoreDef ? 1000 / 1140 : 1000 / (1140 + 3.5 * effectiveDef);

  const preMitigation = Math.max(0, parsed.value);
  const rawPerHit = preMitigation * (brandMul * critFactor + skillUpFrac) * (1 + artifact.dmg / 100);
  // SWOP 使用 Math.floor
  const perHit = Math.floor(rawPerHit * mitigation);
  return {
    total: perHit * hits,
    perHit,
    hits,
    mitigation,
    rawTotal: Math.floor(rawPerHit * hits),
    unsupported: parsed.unsupported,
    bomb,
    artifact,
  };
}

/** 給 UI 顯示用的公式（把 Token 換成中文） */
export function skillFormulaText(skill: Skill): string {
  return skill.f
    .replace(/\{ATK\}/g, "攻擊")
    .replace(/\{MAX HP\}/g, "體力")
    .replace(/\{DEF\}/g, "防禦")
    .replace(/\{SPD\}/g, "速度")
    .replace(/\{Target MAX HP\}/g, "敵方最大體力")
    .replace(/\{Target Current HP %\}/g, "敵方目前體力%")
    .replace(/\{Current HP %\}/g, "自身目前體力%")
    .replace(/\{Current HP\}/g, "自身目前體力")
    .replace(/\{Missing HP\}/g, "自身失去體力")
    .replace(/\{Attacker's Level\}/g, "等級")
    .replace(/\{Target SPD\}/g, "敵方速度")
    .replace(/\{Relative SPD\}/g, "相對速度")
    .replace(/\{Alive Enemies\}/g, "存活敵人")
    .replace(/\{Surviving Allies\}/g, "存活隊友")
    .replace(/\{Living Ally %\}/g, "隊友存活比例")
    .replace(/\{Alive Allies %\}/g, "隊友存活比例")
    .replace(/\(Fixed\)/gi, "");
}
