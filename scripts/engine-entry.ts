/** 測試用進入點：把純邏輯模組打包成 Node 可執行的 ESM */
export * from "../src/lib/optimizer";
export * from "../src/lib/stats";
export * from "../src/lib/damage";
export * from "../src/lib/artifacts";
export * from "../src/lib/stage2";
export * from "../src/lib/rta";
export * from "../src/lib/adCalculator";
export * from "../src/lib/deckSpeed";
export { parseAccountJSON, exportAccount } from "../src/lib/parse";
export { default as MONSTERS } from "../src/data/monsters.json";
