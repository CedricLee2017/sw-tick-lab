/**
 * 魔靈圖示代理（GET /api/icon/<檔名>）
 *
 * 前端「一鍵生圖」要把圖示畫進 canvas；SWARFARM 的靜態圖示沒有 CORS 標頭，
 * 直接載入會污染 canvas 導致無法輸出 PNG，所以由本站同源代理並快取。
 */
const UPSTREAM = "https://swarfarm.com/static/herders/images/monsters/";
const NAME_RE = /^[A-Za-z0-9_.-]+\.(png|jpe?g|webp)$/;

export const onRequest: PagesFunction = async ({ params }) => {
  const raw = params.path;
  const name = Array.isArray(raw) ? raw.join("/") : raw ?? "";
  if (!NAME_RE.test(name)) return new Response("Bad request", { status: 400 });

  const upstream = await fetch(`${UPSTREAM}${name}`, {
    cf: { cacheEverything: true, cacheTtl: 604800 },
  });
  if (!upstream.ok) return new Response("Not found", { status: 404 });

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "image/png",
      "Cache-Control": "public, max-age=604800, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
};
