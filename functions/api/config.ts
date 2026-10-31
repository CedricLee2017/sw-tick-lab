import type { Env } from "../../server/env";
import { json } from "../../server/http";

/** 前端啟動時讀取的公開設定（不含任何密鑰） */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  return json({
    googleClientId: env.GOOGLE_CLIENT_ID ?? "",
    forceLogin: true,
    uploads: false,
  });
};
