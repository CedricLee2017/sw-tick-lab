export interface ApiUser {
  id: number;
  email: string;
  name: string | null;
  picture: string | null;
  role: string;
  isAdmin: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface ApiConfig {
  forceLogin: boolean;
  /** Google Drive 備份是否已設定完成 */
  uploads: boolean;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(path, { credentials: "same-origin", ...init, headers });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  config: () => request<ApiConfig>("/api/config"),
  me: () => request<{ user: ApiUser }>("/api/auth/me"),
  login: (email: string, verifier: string) =>
    request<{ user: ApiUser }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, verifier }) }),
  register: (email: string, name: string, verifier: string) =>
    request<{ user: ApiUser }>("/api/auth/register", { method: "POST", body: JSON.stringify({ email, name, verifier }) }),
  changePassword: (current: string, next: string) =>
    request<{ ok: true }>("/api/auth/password", { method: "POST", body: JSON.stringify({ current, next }) }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
};
