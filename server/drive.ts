import type { Env } from "./env";

/**
 * Google Drive 上傳（業主授權）。
 * - 只用 `drive.file` 範圍：Worker 只看得到自己建立的檔案
 * - access token 快取在 isolate 內，過期前 60 秒重新換
 * - 檔案用 resumable upload 串流上傳，不把整包 JSON 讀進記憶體
 */
let tokenCache: { token: string; exp: number } | null = null;

export function driveConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN);
}

async function accessToken(env: Env): Promise<string> {
  const now = Date.now() / 1000;
  if (tokenCache && tokenCache.exp > now + 60) return tokenCache.token;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      refresh_token: env.GOOGLE_REFRESH_TOKEN ?? "",
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) throw new Error(`drive token failed: ${data.error ?? res.status}`);

  tokenCache = { token: data.access_token, exp: now + (data.expires_in ?? 3600) };
  return data.access_token;
}

async function folderId(env: Env): Promise<string> {
  const row = await env.DB.prepare("SELECT v FROM settings WHERE k = 'drive_folder_id'").first<{ v: string }>();
  if (row?.v) return row.v;

  const token = await accessToken(env);
  const name = env.DRIVE_FOLDER_NAME || "SWTickLab 存檔";
  const res = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }),
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok || !data.id) throw new Error(`drive folder failed: ${data.error?.message ?? res.status}`);

  await env.DB.prepare(
    "INSERT INTO settings (k, v) VALUES ('drive_folder_id', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
  )
    .bind(data.id)
    .run();
  return data.id;
}

export interface UploadInput {
  name: string;
  size: number;
  body: ReadableStream<Uint8Array> | null;
  contentType?: string;
}

/** 建立 resumable session 後把 body 串流給 Google，回傳 Drive 檔案資訊 */
export async function uploadToDrive(env: Env, input: UploadInput): Promise<{ id: string; name: string }> {
  const token = await accessToken(env);
  const parent = await folderId(env);

  const init = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": input.contentType ?? "application/json",
      "x-upload-content-length": String(input.size),
    },
    body: JSON.stringify({ name: input.name, parents: [parent], mimeType: input.contentType ?? "application/json" }),
  });
  if (!init.ok) {
    const detail = await init.text().catch(() => "");
    throw new Error(`drive init failed: ${init.status} ${detail.slice(0, 160)}`);
  }
  const location = init.headers.get("location");
  if (!location) throw new Error("drive init missing location");

  const put = await fetch(location, {
    method: "PUT",
    headers: {
      "content-type": input.contentType ?? "application/json",
      "content-length": String(input.size),
    },
    body: input.body,
  });
  if (!put.ok) {
    const detail = await put.text().catch(() => "");
    throw new Error(`drive upload failed: ${put.status} ${detail.slice(0, 160)}`);
  }

  const file = (await put.json()) as { id?: string; name?: string };
  if (!file.id) throw new Error("drive upload missing id");
  return { id: file.id, name: file.name ?? input.name };
}

/** 後台刪除時使用 */
export async function deleteDriveFile(env: Env, id: string): Promise<void> {
  const token = await accessToken(env);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`drive delete failed: ${res.status}`);
}
