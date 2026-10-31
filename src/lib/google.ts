/** 動態載入 Google Identity Services（GSI）腳本 */

interface GsiWindow extends Window {
  google?: {
    accounts?: {
      id?: {
        initialize: (options: Record<string, unknown>) => void;
        renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        disableAutoSelect?: () => void;
        cancel?: () => void;
      };
    };
  };
}

let loader: Promise<void> | null = null;

export function loadGoogleScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const w = window as GsiWindow;
  if (w.google?.accounts?.id) return Promise.resolve();
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    const script = existing ?? document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("無法載入 Google 登入元件，請檢查網路後重新整理")));
    if (!existing) document.head.appendChild(script);
  });
  return loader;
}
