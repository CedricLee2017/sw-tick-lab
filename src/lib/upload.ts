/**
 * 把匯入的存檔原文送到 Worker，由 Worker 串流寫入 Cloudflare R2。
 * 呼叫端不需要等待（背景執行），成功與失敗都只用 toast 提示。
 */
export async function uploadSave(
  text: string,
  fileName: string,
  meta: { wizard?: string; monsters?: number; runes?: number },
): Promise<{ ok: true; key: string; name: string }> {
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
  const data = (await res.json().catch(() => ({}))) as { error?: string; key?: string; name?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return { ok: true, key: data.key ?? "", name: data.name ?? fileName };
}
