import { createContext, useContext, type ReactNode } from "react";
import type { ArtifactRank, RankIndex, RuneRank } from "../lib/rankings";

/**
 * 排名索引的 Context。
 *
 * `buildRankIndex` 需要掃過整份存檔，所以只在 App 載入存檔時算一次，
 * 任何顯示符文的卡片（ui.tsx 的 RuneCard / ArtifactCard）都可以直接取值，
 * 不必逐個頁面把排名傳下去。
 */
const RankContext = createContext<RankIndex | null>(null);

export function RankProvider({ value, children }: { value: RankIndex | null; children: ReactNode }) {
  return <RankContext.Provider value={value}>{children}</RankContext.Provider>;
}

/** 整份排名索引（沒有提供時回傳 null，卡片就不顯示排名） */
export function useRankIndex(): RankIndex | null {
  return useContext(RankContext);
}

export function useRuneRank(id: number): RuneRank | undefined {
  return useContext(RankContext)?.runes.get(id);
}

export function useArtifactRank(id: number): ArtifactRank | undefined {
  return useContext(RankContext)?.artifacts.get(id);
}
