/** 符文自行分類（標籤）：用套裝＋副屬性門檻把符文分組 */
import { SET_BY_ID, STAT_TYPES } from "./constants";
import type { Rune, RuneTagRule } from "./types";

/** 符文上某個屬性的實際數值：副屬性＋固有屬性，含精煉（不計主屬性與套裝） */
export function runeStatValue(rune: Rune, t: number): number {
  let v = 0;
  for (const s of rune.subs) if (s.t === t) v += s.v + (s.g ?? 0);
  if (rune.prefix?.t === t) v += rune.prefix.v;
  return v;
}

/** 規則需要的屬性條件數（至少 1 條；沒有條件時回傳 0） */
export function tagRequiredMatches(rule: RuneTagRule): number {
  if (rule.stats.length === 0) return 0;
  return Math.min(rule.stats.length, Math.max(1, Math.round(rule.minMatch || rule.stats.length)));
}

/** 這顆符文是否符合規則（套裝 + 屬性門檻）；停用的規則一律不符合 */
export function matchesRuneTag(rule: RuneTagRule, rune: Rune): boolean {
  if (!rule.enabled) return false;
  if (rule.sets.length > 0 && !rule.sets.includes(rune.set)) return false;
  if (rule.stats.length === 0) return rule.sets.length > 0;
  const need = tagRequiredMatches(rule);
  let hit = 0;
  for (const s of rule.stats) {
    if (runeStatValue(rune, s.t) >= s.min) hit++;
    if (hit >= need) return true;
  }
  return false;
}

/** 回傳這顆符文符合的所有規則（依 rules 順序） */
export function runeTagsOf(rules: RuneTagRule[], rune: Rune): RuneTagRule[] {
  return rules.filter((rule) => matchesRuneTag(rule, rune));
}

/** 規則的簡短說明，例如「猛攻 / 激怒 / 刀刃 · 攻擊力% ≥ 20 · 暴擊率 ≥ 15（任 2 條）」 */
export function describeRuneTag(rule: RuneTagRule): string {
  const sets = rule.sets.map((id) => SET_BY_ID[id]?.name ?? `套裝 ${id}`).join(" / ");
  const stats = rule.stats
    .map((s) => `${STAT_TYPES[s.t]?.label ?? `屬性 ${s.t}`} ≥ ${s.min}`)
    .join(" · ");
  const need = tagRequiredMatches(rule);
  const matchNote =
    rule.stats.length > 1 && need < rule.stats.length ? `（${need === 1 ? "任一" : `任 ${need}`} 條）` : "";
  const parts = [sets || "不限套裝", stats ? `${stats}${matchNote}` : "只看套裝"];
  if (!rule.enabled) parts.push("已停用");
  return parts.join(" · ");
}

/** 預設的兩個自行分類（第一次載入時帶入，之後可在符文頁自行修改） */
export const DEFAULT_RUNE_TAGS: RuneTagRule[] = [
  {
    id: "tag-max-dps",
    name: "極限輸出符",
    // 猛攻（8）/ 激怒＝憤怒（5）/ 刀刃（4）
    sets: [8, 5, 4],
    stats: [
      { t: 4, min: 20 }, // 攻擊力%
      { t: 9, min: 15 }, // 暴擊率
      { t: 10, min: 20 }, // 暴擊傷害
    ],
    minMatch: 2,
    enabled: true,
  },
  {
    id: "tag-bruiser-speed",
    name: "坦速符",
    sets: [],
    stats: [
      { t: 2, min: 20 }, // 體力%
      { t: 6, min: 20 }, // 防禦力%
      { t: 11, min: 20 }, // 效果抵抗
      { t: 8, min: 15 }, // 速度
    ],
    minMatch: 3,
    enabled: true,
  },
];

/** 新增規則時使用的空白範本 */
export function newRuneTag(): RuneTagRule {
  return {
    id: `tag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: "",
    sets: [],
    stats: [{ t: 8, min: 15 }],
    minMatch: 1,
    enabled: true,
  };
}
