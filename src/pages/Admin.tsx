import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, RefreshCw, Search, ShieldCheck, Trash2, UserCheck, UserX } from "lucide-react";
import { fmt } from "../components/ui";
import { useStore } from "../store";
import { useAuth } from "../lib/auth";

interface AdminUser {
  id: number;
  email: string;
  name: string | null;
  role: string;
  status: string;
  created_at: number;
  last_login_at: number | null;
  uploads: number;
}

interface AdminUpload {
  id: number;
  user_id: number;
  email: string;
  file_name: string;
  size: number;
  wizard: string | null;
  monster_count: number | null;
  rune_count: number | null;
  created_at: number;
}

const when = (seconds: number | null) => (seconds ? new Date(seconds * 1000).toLocaleString("zh-TW") : "—");

function sizeText(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  const res = await fetch(path, { credentials: "same-origin", ...init, headers });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

export default function AdminPage() {
  const notify = useStore((s) => s.notify);
  const user = useAuth((s) => s.user);
  const [tab, setTab] = useState<"users" | "uploads">("users");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [uploads, setUploads] = useState<AdminUpload[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [totalUploads, setTotalUploads] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadUsers = useCallback(async (query: string) => {
    const data = await adminFetch<{ users: AdminUser[]; total: number }>(
      `/api/admin/users?limit=100&q=${encodeURIComponent(query)}`,
    );
    setUsers(data.users);
    setTotalUsers(data.total);
  }, []);

  const loadUploads = useCallback(async () => {
    const data = await adminFetch<{ uploads: AdminUpload[]; total: number; totalBytes: number }>(
      "/api/admin/uploads?limit=100",
    );
    setUploads(data.uploads);
    setTotalUploads(data.total);
    setTotalBytes(data.totalBytes);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === "users") await loadUsers(q);
      else await loadUploads();
    } catch (err) {
      setError(err instanceof Error ? err.message : "讀取失敗");
    } finally {
      setLoading(false);
    }
  }, [tab, q, loadUsers, loadUploads]);

  useEffect(() => {
    if (!user?.isAdmin) return;
    void refresh();
  }, [refresh, user?.id, user?.isAdmin]);

  if (!user?.isAdmin) {
    return (
      <div className="card card-pad" style={{ maxWidth: 420, margin: "40px auto", textAlign: "center" }}>
        <div className="card-title">需要管理員權限</div>
        <div className="tiny dim" style={{ marginTop: 6 }}>請用管理員帳號登入後再開啟這個頁面。</div>
      </div>
    );
  }

  const patchUser = async (id: number, body: { status?: string; role?: string }) => {
    try {
      await adminFetch(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      notify("已更新會員");
      await loadUsers(q);
    } catch (err) {
      notify(err instanceof Error ? err.message : "更新失敗", "err");
    }
  };

  const removeUpload = async (item: AdminUpload) => {
    if (!confirm(`確定要刪除「${item.file_name}」？刪除後無法復原。`)) return;
    try {
      const res = await fetch(`/api/admin/uploads/${item.id}`, { method: "DELETE", credentials: "same-origin" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      notify("已刪除存檔");
      await loadUploads();
    } catch (err) {
      notify(err instanceof Error ? err.message : "刪除失敗", "err");
    }
  };

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 14 }}>
        <div>
          <div className="card-title row" style={{ gap: 7 }}>
            <ShieldCheck size={15} className="gold" /> 管理後台
          </div>
          <div className="card-sub">會員、上傳紀錄與容量；只有 admin 角色能看到這個頁面。</div>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => void refresh()} disabled={loading}>
          {loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} 重新整理
        </button>
      </div>

      <div className="grid g3">
        <div className="card card-pad">
          <div className="tiny dim">會員數</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 800 }}>{fmt(totalUsers)}</div>
        </div>
        <div className="card card-pad">
          <div className="tiny dim">存檔數</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 800 }}>{fmt(totalUploads)}</div>
        </div>
        <div className="card card-pad">
          <div className="tiny dim">R2 已用容量</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 800 }}>{sizeText(totalBytes)}</div>
          <div className="tiny dim">免費額度 10 GB／月</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div className="tabs">
            <button type="button" className={`tab ${tab === "users" ? "active" : ""}`} onClick={() => setTab("users")}>
              會員
            </button>
            <button type="button" className={`tab ${tab === "uploads" ? "active" : ""}`} onClick={() => setTab("uploads")}>
              上傳紀錄
            </button>
          </div>
          {tab === "users" && (
            <div className="row" style={{ gap: 6 }}>
              <div className="row" style={{ gap: 6, alignItems: "center" }}>
                <Search size={13} className="dim" />
                <input
                  className="input"
                  style={{ width: 220 }}
                  placeholder="搜尋 Email 或名稱"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="card-pad tiny" style={{ color: "var(--red)" }}>{error}</div>
        )}

        {tab === "users" ? (
          <div className="scroll-y" style={{ maxHeight: 620 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>名稱</th>
                  <th>角色</th>
                  <th>狀態</th>
                  <th className="num">存檔</th>
                  <th>註冊</th>
                  <th>最後登入</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 600 }}>{u.email}</td>
                    <td className="dim">{u.name || "—"}</td>
                    <td>
                      <span className={`chip ${u.role === "admin" ? "gold" : "muted"}`}>{u.role === "admin" ? "管理員" : "會員"}</span>
                    </td>
                    <td>
                      <span className={`chip ${u.status === "active" ? "green" : "red"}`}>{u.status === "active" ? "正常" : "已停用"}</span>
                    </td>
                    <td className="num mono">{u.uploads}</td>
                    <td className="tiny dim">{when(u.created_at)}</td>
                    <td className="tiny dim">{when(u.last_login_at)}</td>
                    <td className="num">
                      <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost btn-icon"
                          title={u.role === "admin" ? "取消管理員" : "設為管理員"}
                          onClick={() => void patchUser(u.id, { role: u.role === "admin" ? "user" : "admin" })}
                        >
                          <ShieldCheck size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost btn-icon"
                          title={u.status === "active" ? "停用帳號" : "啟用帳號"}
                          onClick={() => void patchUser(u.id, { status: u.status === "active" ? "disabled" : "active" })}
                        >
                          {u.status === "active" ? <UserX size={13} /> : <UserCheck size={13} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && !loading && (
                  <tr><td colSpan={8} className="tiny dim" style={{ textAlign: "center", padding: 18 }}>沒有資料</td></tr>
                )}
              </tbody>
            </table>
            {totalUsers > users.length && (
              <div className="tiny dim" style={{ padding: "8px 12px" }}>只顯示前 {users.length} 筆（共 {totalUsers} 筆）</div>
            )}
          </div>
        ) : (
          <div className="scroll-y" style={{ maxHeight: 620 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>會員</th>
                  <th>檔名</th>
                  <th className="num">大小</th>
                  <th className="num">魔靈</th>
                  <th className="num">符文</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {uploads.map((up) => (
                  <tr key={up.id}>
                    <td className="tiny dim">{when(up.created_at)}</td>
                    <td>{up.email}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{up.file_name}</td>
                    <td className="num mono">{sizeText(up.size)}</td>
                    <td className="num mono">{up.monster_count ?? "—"}</td>
                    <td className="num mono">{up.rune_count ?? "—"}</td>
                    <td className="num">
                      <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                        <a
                          className="btn btn-sm btn-ghost btn-icon"
                          href={`/api/admin/uploads/${up.id}/download`}
                          title="下載原始 JSON"
                        >
                          <Download size={13} />
                        </a>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost btn-icon"
                          title="刪除"
                          onClick={() => void removeUpload(up)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {uploads.length === 0 && !loading && (
                  <tr><td colSpan={7} className="tiny dim" style={{ textAlign: "center", padding: 18 }}>還沒有上傳紀錄</td></tr>
                )}
              </tbody>
            </table>
            {totalUploads > uploads.length && (
              <div className="tiny dim" style={{ padding: "8px 12px" }}>只顯示前 {uploads.length} 筆（共 {totalUploads} 筆）</div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
