import { create } from "zustand";
import { api, ApiError, type ApiConfig, type ApiUser } from "./api";
import { deriveVerifier } from "./password";

interface AuthState {
  /** 已經向後端問過一次登入狀態 */
  ready: boolean;
  user: ApiUser | null;
  config: ApiConfig | null;
  error: string | null;
  init: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const OFFLINE_CONFIG: ApiConfig = { forceLogin: false, uploads: false };

export const useAuth = create<AuthState>((set) => ({
  ready: false,
  user: null,
  config: null,
  error: null,

  init: async () => {
    try {
      const config = await api.config();
      let user: ApiUser | null = null;
      try {
        user = (await api.me()).user;
      } catch (err) {
        if (!(err instanceof ApiError) || (err.status !== 401 && err.status !== 403)) throw err;
      }
      set({ config, user, ready: true, error: null });
    } catch (err) {
      // 後端還沒部署或離線：仍然讓本機功能可用
      set({
        ready: true,
        config: OFFLINE_CONFIG,
        error: err instanceof Error ? err.message : "無法連線到登入服務",
      });
    }
  },

  signIn: async (email, password) => {
    const verifier = await deriveVerifier(email, password);
    const { user } = await api.login(email, verifier);
    set({ user, error: null });
  },

  register: async (email, name, password) => {
    const verifier = await deriveVerifier(email, password);
    const { user } = await api.register(email, name, verifier);
    set({ user, error: null });
  },

  signOut: async () => {
    try {
      await api.logout();
    } catch {
      /* 即使後端失敗也讓前端登出 */
    }
    set({ user: null });
  },
}));
