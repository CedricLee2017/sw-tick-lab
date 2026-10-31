/// <reference types="@cloudflare/workers-types" />

export interface Env {
  /** D1：會員、上傳紀錄 */
  DB: D1Database;
  /** R2：存檔原文 */
  SAVES: R2Bucket;
  /** 簽發 session cookie 的密鑰（Worker secret） */
  SESSION_SECRET: string;
  /** 管理員 Email，逗號分隔 */
  ADMIN_EMAILS?: string;
}

export const SESSION_TTL = 60 * 60 * 24 * 30;
