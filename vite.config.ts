import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const now = new Date();
const pad = (n: number) => String(n).padStart(2, "0");
const buildTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

/**
 * 本機開發時代理魔靈圖示（等同 functions/api/icon/[[path]].ts）。
 * 一鍵生圖要把圖示畫進 canvas，必須同源才不會污染畫布。
 */
function monsterIconProxy(): Plugin {
  return {
    name: "swtick-monster-icon-proxy",
    configureServer(server) {
      server.middlewares.use("/api/icon", (req, rawRes) => {
        // Vite 內建的 http 型別在這份專案沒裝 @types/node，用最小介面避開型別相依。
        const res = rawRes as unknown as {
          statusCode: number;
          setHeader(name: string, value: string): void;
          end(chunk?: Uint8Array | string): void;
        };
        const rawUrl = (req as unknown as { url?: string }).url ?? "";
        void (async () => {
          const name = decodeURIComponent(rawUrl.replace(/^\//, "").split("?")[0]);
          if (!/^[A-Za-z0-9_.-]+\.(png|jpe?g|webp)$/.test(name)) {
            res.statusCode = 400;
            res.end("bad request");
            return;
          }
          try {
            const upstream = await fetch(`https://swarfarm.com/static/herders/images/monsters/${name}`);
            if (!upstream.ok) {
              res.statusCode = 404;
              res.end("not found");
              return;
            }
            const bytes = new Uint8Array(await upstream.arrayBuffer());
            res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "image/png");
            res.setHeader("Cache-Control", "public, max-age=604800");
            res.end(bytes);
          } catch {
            res.statusCode = 502;
            res.end("proxy error");
          }
        })();
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), monsterIconProxy()],
  define: {
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  server: {
    // 本機：npm run dev（Vite）＋ npm run dev:api（Pages Functions, 8788）
    proxy: {
      "/api": "http://127.0.0.1:8788",
    },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1600,
  },
  worker: {
    format: "es",
  },
});
