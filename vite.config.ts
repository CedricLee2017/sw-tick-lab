import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const now = new Date();
const pad = (n: number) => String(n).padStart(2, "0");
const buildTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

export default defineConfig({
  base: "./",
  plugins: [react()],
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
