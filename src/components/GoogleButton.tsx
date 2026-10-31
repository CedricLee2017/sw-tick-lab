import { useEffect, useRef, useState } from "react";
import { loadGoogleScript } from "../lib/google";

/**
 * Google 官方「使用 Google 帳號登入」按鈕。
 * 登入成功會回傳 Google ID token（credential），由後端驗證後換成我們的 session。
 */
export function GoogleSignInButton({
  clientId,
  onCredential,
  onError,
}: {
  clientId: string;
  onCredential: (credential: string) => void;
  onError?: (message: string) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onCredential, onError });
  callbacks.current = { onCredential, onError };
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    let alive = true;

    void (async () => {
      try {
        await loadGoogleScript();
        if (!alive) return;
        const gsi = (window as unknown as { google?: { accounts?: { id?: GoogleAccountsId } } }).google?.accounts?.id;
        if (!gsi) throw new Error("Google 登入元件沒有載入");

        gsi.initialize({
          client_id: clientId,
          ux_mode: "popup",
          auto_select: false,
          cancel_on_tap_outside: true,
          callback: (res: { credential?: string }) => {
            if (res?.credential) callbacks.current.onCredential(res.credential);
            else callbacks.current.onError?.("Google 沒有回傳登入憑證，請再試一次");
          },
        });

        if (holder.current) {
          holder.current.innerHTML = "";
          gsi.renderButton(holder.current, {
            type: "standard",
            theme: "filled_black",
            size: "large",
            text: "signin_with",
            shape: "pill",
            logo_alignment: "center",
            locale: "zh-TW",
            width: 300,
          });
        }
      } catch (err) {
        if (!alive) return;
        const message = err instanceof Error ? err.message : "Google 登入載入失敗";
        setFailed(message);
        callbacks.current.onError?.(message);
      }
    })();

    return () => {
      alive = false;
    };
  }, [clientId]);

  if (!clientId) {
    return <div className="gsi-fallback">登入服務尚未設定（缺少 Google Client ID）</div>;
  }

  return (
    <>
      <div ref={holder} className="gsi-slot" />
      {failed && <div className="gsi-fallback">{failed}</div>}
    </>
  );
}

interface GoogleAccountsId {
  initialize: (options: Record<string, unknown>) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
}
