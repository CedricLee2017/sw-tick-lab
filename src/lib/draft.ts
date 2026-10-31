/**
 * 頁面之間的「帶入配符」草稿傳遞。
 *
 * 配符頁現在只會在第一次開啟時掛載（之後切頁只隱藏），
 * 所以除了寫入 sessionStorage，還要發事件讓已開啟的配符頁立即套用。
 */
const DRAFT_KEY = "swtick:draft";
const DRAFT_EVENT = "swtick:draft";

export interface OptimizerDraft {
  monsterId?: number;
  tick?: number;
  swift?: number | boolean;
  includeRunes?: number[];
  mode?: "tick" | "speed";
  speed?: number;
}

/** 寫入草稿並通知配符頁（尚未開啟時下次掛載會讀到） */
export function sendOptimizerDraft(draft: OptimizerDraft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* 忽略儲存失敗 */
  }
  window.dispatchEvent(new CustomEvent(DRAFT_EVENT));
}

/** 取出並清掉草稿（只會被套用一次） */
export function takeOptimizerDraft(): OptimizerDraft | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* 忽略 */
  }
  try {
    return JSON.parse(raw) as OptimizerDraft;
  } catch {
    return null;
  }
}

/** 訂閱草稿事件，回傳取消訂閱函式 */
export function onOptimizerDraft(fn: () => void): () => void {
  window.addEventListener(DRAFT_EVENT, fn);
  return () => window.removeEventListener(DRAFT_EVENT, fn);
}
