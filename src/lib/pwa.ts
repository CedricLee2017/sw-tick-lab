/** PWA 安裝提示與 Service Worker 註冊。 */

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

export interface PwaState {
  /** 已經用獨立視窗（主畫面 App）開啟 */
  installed: boolean;
  /** 瀏覽器已提供原生安裝提示 */
  canPrompt: boolean;
  /** iOS / iPadOS 沒有 beforeinstallprompt，需要顯示手動步驟 */
  ios: boolean;
}

type Listener = () => void;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
/** appinstalled 後目前分頁仍是瀏覽器模式，另外記住已安裝避免按鈕又出現。 */
let installedEvent = false;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const displayMode = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return displayMode || iosStandalone;
}

export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ 的 Safari 會把自己偽裝成 Mac，用觸控點數辨識。
  const iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return iOS || iPadOS;
}

export function pwaState(): PwaState {
  return { installed: installedEvent || isStandalone(), canPrompt: deferredPrompt !== null, ios: isIosDevice() };
}

export function subscribePwa(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

if (typeof window !== "undefined") {
  // 必須在元件掛載前就攔截，否則會錯過瀏覽器只觸發一次的安裝提示。
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installedEvent = true;
    deferredPrompt = null;
    emit();
  });
  window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", emit);
}

/** 呼叫瀏覽器原生的安裝提示；沒有可用提示時回傳 unavailable。 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) return "unavailable";
  const event = deferredPrompt;
  deferredPrompt = null;
  emit();
  await event.prompt();
  const choice = await event.userChoice;
  if (choice.outcome === "accepted") {
    installedEvent = true;
    emit();
  }
  return choice.outcome;
}

/** 只在 production 註冊，避免開發時 HMR 被舊快取影響。 */
export function registerPwa(): void {
  if (!import.meta.env.PROD || typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    const swUrl = new URL(`${import.meta.env.BASE_URL}sw.js`, window.location.href);
    // 版本放在 query string：每次建置都會更新 SW 與快取名稱。
    swUrl.searchParams.set("v", __BUILD_TIME__.replace(/[^0-9]/g, ""));
    navigator.serviceWorker.register(swUrl.href).catch((err) => {
      console.warn("Service Worker 註冊失敗", err);
    });
  });
}
