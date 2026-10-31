/**
 * 把匯入的存檔原文送到 Worker，再由 Worker 串流上傳到服務擁有者的 Google Drive。
 * 呼叫端不需要等待（背景執行），成功與失敗都只用 toast 提示。
 */
export async function uploadSave(
  text: string,
  fileName: string,
  meta: { wizard?: string; monsters?: number; runes?: number },
): Promise<{ ok: true; fileId: string; name: string }> {
  const body = new Blob([text], { type: "application/json" });
  const res = await fetch("/api/uploads", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-sw-file-name": encodeURIComponent(fileName),
      "x-sw-wizard": encodeURIComponent(meta.wizard ?? ""),
      "x-sw-monsters": String(meta.monsters ?? 0),
      "x-sw-runes": String(meta.runes ?? 0),
    },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; fileId?: string; name?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return { ok: true, fileId: data.fileId ?? "", name: data.name ?? fileName };
}
