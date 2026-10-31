import { useState } from "react";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { useAuth } from "../lib/auth";
import { GoogleSignInButton } from "../components/GoogleButton";

/** 登入表單：登入頁與側邊欄的登入彈窗共用 */
export function LoginForm() {
  const { config, error, init, signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleCredential = async (credential: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await signIn(credential);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "登入失敗，請再試一次");
    } finally {
      setBusy(false);
    }
  };

  const problem = message ?? error;

  return (
    <div className="login-form">
      <GoogleSignInButton
        clientId={config?.googleClientId ?? ""}
        onCredential={(credential) => void handleCredential(credential)}
        onError={setMessage}
      />
      {busy && <div className="tiny dim">正在登入…</div>}
      {problem && (
        <div className="login-error">
          <TriangleAlert size={13} /> <span>{problem}</span>
        </div>
      )}
      {config && !config.googleClientId && (
        <button className="btn btn-sm" onClick={() => void init()}>
          重新連線
        </button>
      )}
      <div className="tiny dim login-note">
        <ShieldCheck size={12} /> 登入後，你匯入的存檔會自動備份到服務的 Google Drive；解析與計算仍在你的瀏覽器完成。
      </div>
    </div>
  );
}

/** 強制登入時顯示的整頁登入畫面 */
export default function LoginPage() {
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="brand-mark login-mark">T</div>
        <h1>SW Tick Lab</h1>
        <div className="login-sub">魔靈召喚 · 符文配裝與 Speed Tick</div>
        <LoginForm />
      </div>
    </div>
  );
}
