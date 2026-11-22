/** 神器「受到屬性傷害減少」的統計與分組比較 */
import { ELEMENTS } from "./constants";
import type { Artifact } from "./types";

/** 受到 X 屬性傷害減少（305–309）對應的元素 id（1 水 / 2 火 / 3 風 / 4 光 / 5 暗） */
export const ARTIFACT_REDUCTION_ELEMENT: Record<number, number> = {
  305: 2, // 火
  306: 1, // 水
  307: 3, // 風
  308: 4, // 光
  309: 5, // 暗
};

/** 顯示順序：火、水、風、光、暗（與遊戲內一致） */
export const REDUCTION_ELEMENT_ORDER = [2, 1, 3, 4, 5];

export function reductionElementName(el: number): string {
  return ELEMENTS[el as 1 | 2 | 3 | 4 | 5]?.name ?? `屬性 ${el}`;
}

export interface ArtifactReduction {
  /** 元素 id → 減傷百分比（同一件神器同一元素取最大值） */
  values: Partial<Record<number, number>>;
  /** 有減傷的元素 id（依火水風光暗排序） */
  elements: number[];
  /** 減傷數值合計 */
  total: number;
  /** 減傷條數 */
  count: number;
}

/** 單件神器的屬性減傷（只計 305–309；其餘效果不算） */
export function artifactReduction(art: Artifact): ArtifactReduction {
  const values: Partial<Record<number, number>> = {};
  for (const sub of art.subs) {
    const el = ARTIFACT_REDUCTION_ELEMENT[sub.t];
    if (!el || !(sub.v > 0)) continue;
    values[el] = Math.max(values[el] ?? 0, sub.v);
  }
  const elements = REDUCTION_ELEMENT_ORDER.filter((el) => (values[el] ?? 0) > 0);
  const total = elements.reduce((sum, el) => sum + (values[el] ?? 0), 0);
  return { values, elements, total, count: elements.length };
}

/**
 * 這件神器的屬性減傷合計，但只計「剛好 count 種」的情況。
 * 例如 count = 2 時，只有 3 種或 4 種屬性減傷的神器會回傳 null，
 * 不會被算進「任二種」的篩選。
 */
export function artifactReductionSum(art: Artifact, count: number): number | null {
  if (count <= 0) return null;
  const r = artifactReduction(art);
  if (r.count !== count) return null;
  return r.total;
}

/** 分組用的鍵：元素組合（例如火水風 = "1-2-3"，順序不影響） */
export function reductionComboKey(elements: number[]): string {
  return [...elements].sort((a, b) => a - b).join("-");
}

/** 元素組合的顯示名稱（火水風 / 火光暗…） */
export function reductionComboLabel(elements: number[]): string {
  return REDUCTION_ELEMENT_ORDER.filter((el) => elements.includes(el))
    .map(reductionElementName)
    .join("");
}

export type ReductionVerdict = "best" | "close" | "weak" | "sell" | "equipped";

/**
 * 同一組（相同元素組合）內的比較結果：
 *  - best：這組最高（或並列最高）
 *  - close：合計有最高值的 85% 以上
 *  - weak：65% ~ 85%
 *  - sell：低於 65%，優先賣掉
 *  - equipped：目前裝備中（先看是否真的需要）
 */
export function reductionVerdict(r: ArtifactReduction, bestTotal: number, equipped: boolean): ReductionVerdict {
  if (equipped) return "equipped";
  if (r.total >= bestTotal - 1e-9) return "best";
  const ratio = bestTotal > 0 ? r.total / bestTotal : 1;
  if (ratio >= 0.85) return "close";
  if (ratio >= 0.65) return "weak";
  return "sell";
}

export const REDUCTION_VERDICT_TEXT: Record<ReductionVerdict, string> = {
  best: "這組最佳",
  close: "接近最佳",
  weak: "偏弱",
  sell: "優先賣出",
  equipped: "裝備中",
};
