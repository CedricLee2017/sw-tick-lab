/**
 * 會員功能方案。
 *
 * - basic：只開放基本分析（匯入、總覽、魔靈、符文、神器、圖鑑、設定）。
 * - full：全部功能；管理員一律視為 full。
 *
 * 前端依這份清單隱藏未開放的頁面；真正的資料隔離仍由後端的 user_id
 * 查詢與管理員權限負責。
 */

export type Tier = "basic" | "full";

/** 基本方案可使用的頁面（與 App.tsx 的 RouteKey 對應） */
export const BASIC_FEATURES = [
  "import",
  "overview",
  "bestiary",
  "monsters",
  "runes",
  "artifacts",
  "settings",
] as const;

/** 後台頁面永遠只給管理員 */
export function canUseFeature(
  tier: string | undefined,
  feature: string,
  isAdmin = false,
): boolean {
  if (feature === "admin") return isAdmin;
  if (isAdmin || tier === "full") return true;
  return (BASIC_FEATURES as readonly string[]).includes(feature);
}

export function tierLabel(tier: string | undefined, isAdmin = false): string {
  if (isAdmin) return "管理員";
  return tier === "full" ? "完整" : "基本";
}
