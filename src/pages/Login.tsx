import { useState, type FormEvent } from "react";
import { Eye, EyeOff, ShieldCheck, TriangleAlert } from "lucide-react";
import { useAuth } from "../lib/auth";

type Mode = "login" | "register";

/** Email + 密碼表單：登入頁與側邊欄的登入彈窗共用 */
export function LoginForm() {
  const { error, signIn, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const problem = message ?? error;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setMessage("Email 格式不正確");
      return;
    }
    if (password.length < 8) {
      setMessage("密碼至少需要 8 個字元");
      return;
    }
    if (mode === "register" && password !== confirm) {
      setMessage("兩次輸入的密碼不一致");
      return;
    }

    setBusy(true);
    try {
      if (mode === "login") await signIn(email.trim(), password);
      else await register(email.trim(), name.trim(), password);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "操作失敗，請再試一次");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-form">
      <div className="tabs" style={{ width: "100%", justifyContent: "center", marginBottom: 4 }}>
        <button type="button" className={`tab ${mode === "login" ? "active" : ""}`} onClick={() => { setMode("login"); setMessage(null); }}>
          登入
        </button>
        <button type="button" className={`tab ${mode === "register" ? "active" : ""}`} onClick={() => { setMode("register"); setMessage(null); }}>
          註冊
        </button>
      </div>

      <form onSubmit={(e) => void submit(e)} style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
        {mode === "register" && (
          <label className="login-field">
            <span>名稱（選填）</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="你的暱稱" maxLength={40} autoComplete="nickname" />
          </label>
        )}

        <label className="login-field">
          <span>Email</span>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </label>

        <label className="login-field">
          <span>密碼</span>
          <div className="login-pw">
            <input
              className="input"
              type={reveal ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? "至少 8 個字元" : "你的密碼"}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              required
              minLength={8}
            />
            <button type="button" className="rune-flag" title={reveal ? "隱藏密碼" : "顯示密碼"} onClick={() => setReveal((v) => !v)}>
              {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </label>

        {mode === "register" && (
          <label className="login-field">
            <span>確認密碼</span>
            <input
              className="input"
              type={reveal ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="再輸入一次"
              autoComplete="new-password"
              required
              minLength={8}
            />
          </label>
        )}

        <button type="submit" className="btn btn-primary" disabled={busy} style={{ marginTop: 4 }}>
          {busy ? "處理中…" : mode === "login" ? "登入" : "建立帳號"}
        </button>
      </form>

      {problem && (
        <div className="login-error">
          <TriangleAlert size={13} /> <span>{problem}</span>
        </div>
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
