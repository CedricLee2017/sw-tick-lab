/** 測試用進入點：把純邏輯模組打包成 Node 可執行的 ESM */
export * from "../src/lib/optimizer";
export * from "../src/lib/stats";
export * from "../src/lib/damage";
export * from "../src/lib/artifacts";
export * from "../src/lib/stage2";
export * from "../src/lib/rta";
export * from "../src/lib/adCalculator";
export * from "../src/lib/deckSpeed";
export * from "../src/lib/speedTick";
export * from "../src/lib/teamSpeed";
export * from "../src/lib/teamOptimizer";
export * from "../src/lib/teamTemplates";
export * from "../src/lib/teamRoles";
export {
  GRIND_PROFILES,
  GRIND_ACCEPT_LEVELS,
  GRIND_MAX,
  ANCIENT_GRIND_MAX,
  GRIND_STONE_MAX,
  GRIND_GRADE_LABEL,
  grindMax,
  grindStoneMax,
  grindGradeFor,
  grindStatLabel,
  grindStatSuffix,
  acceptTarget,
  subScore,
  analyzeRune,
  analyzeGrind,
  planScore,
  stoneGain,
  grindCapsFromStock,
  matchingGrindstones,
  planMaterials,
  planWithStock,
  maxScoreWithStock,
} from "../src/lib/grind";
export * from "../src/lib/deckSetup";
export * from "../src/lib/librarySync";
export * from "../src/lib/siege";
export * from "../src/lib/bestiary";
export { parseAccountJSON, exportAccount } from "../src/lib/parse";
export { default as MONSTERS } from "../src/data/monsters.json";
