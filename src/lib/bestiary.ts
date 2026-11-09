/** 魔靈圖鑑：全魔靈索引、技能篩選與效果分類 */
import type { Monster } from "./types";
import type { Skill, SkillData, SkillEffect } from "./damage";
import { allSkillsForMonster } from "./damage";

/** 技能篩選條件；所有欄位預設為「不限」 */
export interface SkillFilter {
  /** 技能名稱 / 說明關鍵字 */
  q: string;
  /** 0 = 全部；1–4 = 技能位置 */
  slot: number;
  kind: "all" | "active" | "passive";
  aoe: "all" | "yes" | "no";
  /** 技能效果 id；空陣列 = 不限 */
  effects: number[];
  /** any = 符合任一所選效果；all = 必須同時具備全部所選效果 */
  effectMode: "any" | "all";
  /** 倍率成長屬性，例如 ATK / MAX HP；空字串 = 不限 */
  scale: string;
  /** 段數下限；0 = 不限 */
  minHits: number;
  /** 冷卻上限；null = 不限（0 代表只看無冷卻技能） */
  maxCool: number | null;
}

export const EMPTY_SKILL_FILTER: SkillFilter = {
  q: "",
  slot: 0,
  kind: "all",
  aoe: "all",
  effects: [],
  effectMode: "any",
  scale: "",
  minHits: 0,
  maxCool: null,
};

export interface BestiaryEntry {
  monster: Monster;
  skills: Skill[];
}

export interface EffectOption {
  id: number;
  name: string;
  /** 擁有此效果的魔靈形態數量 */
  count: number;
  type: string;
}

export interface EffectGroup {
  type: string;
  label: string;
  items: EffectOption[];
}

const EFFECT_LABELS: Record<string, string> = {
  Buff: "增益效果",
  Debuff: "減益效果",
  Neutral: "其他效果",
};

const GROUP_ORDER = ["Buff", "Debuff", "Neutral"];

export function isSkillFilterActive(f: SkillFilter): boolean {
  return (
    f.q.trim().length > 0 ||
    f.slot > 0 ||
    f.kind !== "all" ||
    f.aoe !== "all" ||
    f.effects.length > 0 ||
    f.scale.length > 0 ||
    f.minHits > 0 ||
    f.maxCool !== null
  );
}

export function matchesSkill(skill: Skill, f: SkillFilter): boolean {
  const term = f.q.trim().toLowerCase();
  if (term) {
    const haystack = `${skill.n}\n${skill.d}`.toLowerCase();
    if (!haystack.includes(term)) return false;
  }
  if (f.slot && skill.slot !== f.slot) return false;
  if (f.kind === "passive" && !skill.passive) return false;
  if (f.kind === "active" && skill.passive) return false;
  if (f.aoe === "yes" && !skill.aoe) return false;
  if (f.aoe === "no" && skill.aoe) return false;
  if (f.effects.length) {
    const set = new Set(skill.e);
    const ok =
      f.effectMode === "all"
        ? f.effects.every((id) => set.has(id))
        : f.effects.some((id) => set.has(id));
    if (!ok) return false;
  }
  if (f.scale && !skill.sc.includes(f.scale)) return false;
  if (f.minHits > 0 && skill.hits < f.minHits) return false;
  if (f.maxCool !== null && skill.cool > f.maxCool) return false;
  return true;
}

/** 建立全魔靈索引（技能資料載入後只算一次） */
export function buildBestiary(data: SkillData | null, monsters: Monster[]): BestiaryEntry[] {
  return monsters.map((monster) => ({
    monster,
    skills: allSkillsForMonster(data, monster.id),
  }));
}

/** 依技能條件找出符合的技能；沒有技能條件時回傳全部技能 */
export function matchedSkills(entry: BestiaryEntry, f: SkillFilter): Skill[] {
  if (!isSkillFilterActive(f)) return entry.skills;
  return entry.skills.filter((s) => matchesSkill(s, f));
}

export function effectOf(data: SkillData | null, id: number): SkillEffect {
  return (
    data?.effects?.[String(id)] ?? {
      id,
      name: `效果 #${id}`,
      type: "Neutral",
      buff: false,
    }
  );
}

/** 圖鑑可選的技能效果，依增益 / 減益 / 其他分組並附上擁有魔靈數 */
export function effectGroups(data: SkillData | null, monsters?: Monster[]): EffectGroup[] {
  if (!data) return [];
  const allowed = monsters ? new Set(monsters.map((m) => m.id)) : null;
  const counts = new Map<number, number>();
  for (const [monsterId, ids] of Object.entries(data.monsters)) {
    if (allowed && !allowed.has(Number(monsterId))) continue;
    const seen = new Set<number>();
    for (const id of ids) {
      const skill = data.skills[String(id)];
      if (!skill) continue;
      for (const effect of skill.e) seen.add(effect);
    }
    for (const effect of seen) counts.set(effect, (counts.get(effect) ?? 0) + 1);
  }

  const groups = new Map<string, EffectOption[]>();
  for (const [id, count] of counts) {
    const effect = effectOf(data, id);
    const type = effect.type || "Neutral";
    const list = groups.get(type) ?? [];
    list.push({ id, name: effect.name, count, type });
    groups.set(type, list);
  }

  const types = [...groups.keys()].sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a);
    const bi = GROUP_ORDER.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b);
  });

  return types.map((type) => ({
    type,
    label: EFFECT_LABELS[type] ?? type,
    items: (groups.get(type) ?? []).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  }));
}

/** 技能倍率會用到的屬性（供「成長屬性」篩選） */
export function scaleOptions(data: SkillData | null): { key: string; count: number }[] {
  if (!data) return [];
  const counts = new Map<string, number>();
  for (const skill of Object.values(data.skills)) {
    for (const key of new Set(skill.sc)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const priority = ["ATK", "MAX HP", "DEF", "SPD", "Target MAX HP", "Current HP %", "Missing HP"];
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => {
      const ai = priority.indexOf(a.key);
      const bi = priority.indexOf(b.key);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || b.count - a.count;
    });
}
