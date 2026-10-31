import type { Env } from "../../server/env";
import { json } from "../../server/http";

/** 前端啟動時讀取的公開設定（不含任何密鑰） */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  // 用 D1 的 settings 表當開關：驗證登入流程後把 force_login 改成 1 就生效，不必重新部署
  let forceLogin = false;
  try {
    const row = await env.DB.prepare("SELECT v FROM settings WHERE k = 'force_login'").first<{ v: string }>();
    forceLogin = row?.v === "1";
  } catch {
    /* 資料庫還沒準備好時維持可用 */
  }

  return json({
    forceLogin,
    uploads: Boolean(env.SAVES),
  });
};
