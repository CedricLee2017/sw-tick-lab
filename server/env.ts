/// <reference types="@cloudflare/workers-types" />

export interface Env {
  /** D1：會員、上傳紀錄 */
  DB: D1Database;
  /** Google OAuth 用戶端 ID（公開） */
  GOOGLE_CLIENT_ID: string;
  /** 簽發 session cookie 的密鑰（Worker secret） */
  SESSION_SECRET: string;
  /** 管理員 Google Email，逗號分隔 */
  ADMIN_EMAILS?: string;
  /** P1：業主授權的 Google Drive 上傳 */
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  DRIVE_FOLDER_NAME?: string;
}

export const SESSION_TTL = 60 * 60 * 24 * 30;
