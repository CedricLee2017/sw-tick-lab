/** 測試用進入點：把純邏輯模組打包成 Node 可執行的 ESM */
export * from "../src/lib/optimizer";
export * from "../src/lib/stats";
export { parseAccountJSON, exportAccount } from "../src/lib/parse";
export { default as MONSTERS } from "../src/data/monsters.json";
