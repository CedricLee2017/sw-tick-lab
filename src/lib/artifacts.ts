/** 神器（Artifact）：主效果、副效果對照與傷害加成 */
import { ELEMENTS } from "./constants";
import type { Skill } from "./damage";
import type { Artifact, ArtifactSub, Monster } from "./types";

/** 主效果 id → 屬性。神器的 +15 數值直接存在 pri_effect[1] */
export const ARTIFACT_MAIN: Record<number, { key: "hp" | "atk" | "def"; label: string }> = {
  100: { key: "hp", label: "體力" },
  101: { key: "atk", label: "攻擊力" },
  102: { key: "def", label: "防禦力" },
};

export const ARTIFACT_ARCHETYPES: Record<number, string> = {
  1: "攻擊型",
  2: "防禦型",
  3: "體力型",
  4: "支援型",
  98: "特殊",
};

export const ARTIFACT_RANKS: Record<number, string> = {
  1: "普通",
  2: "魔法",
  3: "稀有",
  4: "英雄",
  5: "傳說",
};

/** 神器副效果 id → 中文說明。對照來源：SWEX mapping.js（artifact.effectTypes.sub） */
export const ARTIFACT_EFFECTS: Record<number, { text: (v: number) => string; kind: "dmg" | "def" | "util" | "stat" }> = {
  200: { kind: "stat", text: (v) => `攻擊力依損失體力比例增加，最多 +${v}%` },
  201: { kind: "stat", text: (v) => `防禦力依損失體力比例增加，最多 +${v}%` },
  202: { kind: "stat", text: (v) => `速度依損失體力比例增加，最多 +${v}%` },
  203: { kind: "stat", text: (v) => `無法行動效果中速度 +${v}%` },
  204: { kind: "stat", text: (v) => `攻擊力增加效果 +${v}%` },
  205: { kind: "stat", text: (v) => `防禦力增加效果 +${v}%` },
  206: { kind: "stat", text: (v) => `速度增加效果 +${v}%` },
  207: { kind: "stat", text: (v) => `暴擊率增加效果 +${v}%` },
  208: { kind: "dmg", text: (v) => `反擊傷害 +${v}%` },
  209: { kind: "dmg", text: (v) => `協同攻擊傷害 +${v}%` },
  210: { kind: "dmg", text: (v) => `炸彈傷害 +${v}%` },
  211: { kind: "dmg", text: (v) => `反射傷害 +${v}%` },
  212: { kind: "dmg", text: (v) => `強擊傷害 +${v}%` },
  213: { kind: "def", text: (v) => `無法行動效果中受到傷害 -${v}%` },
  214: { kind: "def", text: (v) => `受到暴擊傷害 -${v}%` },
  215: { kind: "util", text: (v) => `吸血 +${v}%` },
  216: { kind: "util", text: (v) => `復活時體力 +${v}%` },
  217: { kind: "util", text: (v) => `復活時攻擊條 +${v}%` },
  218: { kind: "dmg", text: (v) => `追加傷害（自身體力 ${v}%）` },
  219: { kind: "dmg", text: (v) => `追加傷害（自身攻擊 ${v}%）` },
  220: { kind: "dmg", text: (v) => `追加傷害（自身防禦 ${v}%）` },
  221: { kind: "dmg", text: (v) => `追加傷害（自身速度 ${v}%）` },
  222: { kind: "dmg", text: (v) => `敵方體力越高，暴擊傷害最多 +${v}%` },
  223: { kind: "dmg", text: (v) => `敵方體力越低，暴擊傷害最多 +${v}%` },
  224: { kind: "dmg", text: (v) => `自身回合單體技能暴擊傷害 +${v}%` },
  225: { kind: "dmg", text: (v) => `反擊／協同攻擊傷害 +${v}%` },
  226: { kind: "stat", text: (v) => `攻擊力／防禦力增加效果 +${v}%` },
  300: { kind: "dmg", text: (v) => `對火屬性傷害 +${v}%` },
  301: { kind: "dmg", text: (v) => `對水屬性傷害 +${v}%` },
  302: { kind: "dmg", text: (v) => `對風屬性傷害 +${v}%` },
  303: { kind: "dmg", text: (v) => `對光屬性傷害 +${v}%` },
  304: { kind: "dmg", text: (v) => `對暗屬性傷害 +${v}%` },
  305: { kind: "def", text: (v) => `受到火屬性傷害 -${v}%` },
  306: { kind: "def", text: (v) => `受到水屬性傷害 -${v}%` },
  307: { kind: "def", text: (v) => `受到風屬性傷害 -${v}%` },
  308: { kind: "def", text: (v) => `受到光屬性傷害 -${v}%` },
  309: { kind: "def", text: (v) => `受到暗屬性傷害 -${v}%` },
  400: { kind: "dmg", text: (v) => `技能 1 暴擊傷害 +${v}%` },
  401: { kind: "dmg", text: (v) => `技能 2 暴擊傷害 +${v}%` },
  402: { kind: "dmg", text: (v) => `技能 3 暴擊傷害 +${v}%` },
  403: { kind: "dmg", text: (v) => `技能 4 暴擊傷害 +${v}%` },
  404: { kind: "util", text: (v) => `技能 1 恢復量 +${v}%` },
  405: { kind: "util", text: (v) => `技能 2 恢復量 +${v}%` },
  406: { kind: "util", text: (v) => `技能 3 恢復量 +${v}%` },
  407: { kind: "util", text: (v) => `技能 1 效果命中 +${v}%` },
  408: { kind: "util", text: (v) => `技能 2 效果命中 +${v}%` },
  409: { kind: "util", text: (v) => `技能 3 效果命中 +${v}%` },
  410: { kind: "dmg", text: (v) => `技能 3／4 暴擊傷害 +${v}%` },
  411: { kind: "dmg", text: (v) => `首次攻擊暴擊傷害 +${v}%` },
};

/** 300–304 對應的敵方屬性 id（火水風光暗） */
export const ARTIFACT_ELEMENT_TARGET: Record<number, number> = {
  300: 2,
  301: 1,
  302: 3,
  303: 4,
  304: 5,
};

const round2 = (v: number) => Math.round(v * 100) / 100;

/** 主效果文字，例如「體力 +1,500」 */
export function artifactMainText(art: Artifact): string {
  const meta = ARTIFACT_MAIN[art.main.t];
  if (!meta) return `主效果 #${art.main.t}`;
  return `${meta.label} +${art.main.v.toLocaleString("en-US")}`;
}

/** 副效果文字；未知 id 仍顯示數值，避免資料被吞掉 */
export function artifactSubText(sub: ArtifactSub): string {
  const def = ARTIFACT_EFFECTS[sub.t];
  const v = round2(sub.v);
  if (!def) return `效果 #${sub.t} ${v}`;
  return def.text(v);
}

export function artifactSubsText(art: Artifact): string {
  return art.subs.map(artifactSubText).join(" · ");
}

/** 屬性 / 類型神器的副標題 */
export function artifactKindText(art: Artifact): string {
  if (art.type === 2) return ARTIFACT_ARCHETYPES[art.style] ?? "類型神器";
  if (art.attr === 98) return "特殊屬性";
  return `${ELEMENTS[art.attr as 1 | 2 | 3 | 4 | 5]?.name ?? "?"}屬性`;
}

export function artifactTypeText(type: number): string {
  return type === 2 ? "類型神器" : "屬性神器";
}

/** 神器提供的固定面板加成（主效果只有固定體力 / 攻擊 / 防禦） */
export function artifactFlat(artifacts: Artifact[] | undefined): { hp: number; atk: number; def: number } {
  const out = { hp: 0, atk: 0, def: 0 };
  for (const art of artifacts ?? []) {
    const meta = ARTIFACT_MAIN[art.main.t];
    if (!meta) continue;
    out[meta.key] += art.main.v;
  }
  return out;
}

export interface ArtifactDamageBonus {
  /** 追加到暴擊傷害的百分比（技能專屬暴傷） */
  cd: number;
  /** 最終傷害乘算的百分比（屬性傷害） */
  dmg: number;
  /** 追傷係數（小數，例如 0.04 = 4%） */
  add: { hp: number; atk: number; def: number; spd: number };
  /** 實際套用的效果文字 */
  applied: string[];
}

/** 兩件神器的追傷係數總和 */
export function artifactAddCoefficients(artifacts: Artifact[] | undefined): ArtifactDamageBonus["add"] {
  const add = { hp: 0, atk: 0, def: 0, spd: 0 };
  for (const art of artifacts ?? []) {
    for (const sub of art.subs) {
      const v = sub.v / 100;
      if (sub.t === 218) add.hp += v;
      else if (sub.t === 219) add.atk += v;
      else if (sub.t === 220) add.def += v;
      else if (sub.t === 221) add.spd += v;
    }
  }
  return add;
}

/**
 * 追傷（Additional Damage）：每段固定追加，依三圍（+速度）計算。
 * 遊戲會對每個屬性分別無條件捨去後再加總。
 */
export function artifactAdditionalDamage(
  stats: { hp: number; atk: number; def: number; spd: number },
  artifacts: Artifact[] | undefined,
): number {
  const c = artifactAddCoefficients(artifacts);
  return (
    Math.floor(stats.hp * c.hp) +
    Math.floor(stats.atk * c.atk) +
    Math.floor(stats.def * c.def) +
    Math.floor(stats.spd * c.spd)
  );
}

/** 神器是否適用於這隻魔靈（屬性神器看屬性、類型神器看魔靈類型） */
export function artifactEligible(art: Artifact, monster: Pick<Monster, "el" | "arch">): boolean {
  if (art.type === 2) {
    const style = ARTIFACT_ARCH_STYLE[monster.arch ?? ""] ?? 0;
    return art.style === 98 || art.style === style;
  }
  return art.attr === 98 || art.attr === monster.el;
}

export const ARTIFACT_ARCH_STYLE: Record<string, number> = {
  Attack: 1,
  Defense: 2,
  HP: 3,
  Support: 4,
  Material: 5,
};

/**
 * 神器對「這一招、這個敵人屬性」可直接計算的傷害加成。
 * 只計入規則明確的效果：
 *  - 技能 1–4 暴擊傷害（400–403）、技能 3/4 暴傷（410）、單體技能暴傷（224）
 *  - 對指定屬性傷害（300–304，需在傷害面板指定敵方屬性）
 *  - 追傷 218–221（另外由 artifactAdditionalDamage 計算實際數值）
 * 其餘條件式效果（反擊、依敵方體力變動的暴傷…）僅在介面顯示。
 */
export function artifactDamageBonus(artifacts: Artifact[] | undefined, skill: Skill, enemyEl = 0): ArtifactDamageBonus {
  const out: ArtifactDamageBonus = { cd: 0, dmg: 0, add: { hp: 0, atk: 0, def: 0, spd: 0 }, applied: [] };
  const bomb = skill.e.includes(23);
  for (const art of artifacts ?? []) {
    for (const sub of art.subs) {
      const v = round2(sub.v);
      if (!Number.isFinite(v) || v === 0) continue;
      if (sub.t >= 218 && sub.t <= 221) {
        if (sub.t === 218) out.add.hp += v / 100;
        else if (sub.t === 219) out.add.atk += v / 100;
        else if (sub.t === 220) out.add.def += v / 100;
        else out.add.spd += v / 100;
        out.applied.push(artifactSubText(sub));
        continue;
      }
      const skillCd =
        !bomb &&
        ((sub.t >= 400 && sub.t <= 403 && skill.slot === sub.t - 399) ||
          (sub.t === 410 && (skill.slot === 3 || skill.slot === 4)) ||
          (sub.t === 224 && !skill.aoe));
      if (skillCd) {
        out.cd += v;
        out.applied.push(artifactSubText(sub));
        continue;
      }
      if (enemyEl > 0 && ARTIFACT_ELEMENT_TARGET[sub.t] === enemyEl) {
        out.dmg += v;
        out.applied.push(artifactSubText(sub));
      }
    }
  }
  return out;
}
