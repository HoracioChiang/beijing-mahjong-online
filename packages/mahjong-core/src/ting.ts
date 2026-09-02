import { analyzeHu } from "./hu.js";
import { tileCounts, tileType, TileType } from "./tile.js";
import type { Meld, TingResult } from "./types.js";

export interface TingInput {
  concealed: readonly TileType[];
  openMelds?: readonly Meld[];
  jokerType: TileType | null;
  visibleCounts?: readonly number[];
  jokerIndicator?: TileType | null;
}

export const calculateTing = (input: TingInput): TingResult[] => {
  const own = tileCounts(input.concealed);
  const visible = Array.from(input.visibleCounts ?? Array<number>(34).fill(0));
  for (const meld of input.openMelds ?? []) for (const tile of meld.tiles) visible[tile.type] = (visible[tile.type] ?? 0) + 1;
  for (let type = 0; type < 34; type += 1) {
    if (input.jokerIndicator !== null && input.jokerIndicator !== undefined && input.jokerIndicator === type) visible[type] = (visible[type] ?? 0) + 1;
  }
  const result: TingResult[] = [];
  for (let type = 0; type < 34; type += 1) {
    const candidate = tileType(type);
    const hu = analyzeHu({ concealed: [...input.concealed, candidate], openMelds: input.openMelds, jokerType: input.jokerType });
    if (!hu.isHu) continue;
    const remainingVisibleCount = Math.max(0, 4 - (visible[type] ?? 0) - (own[type] ?? 0));
    result.push({ tileType: candidate, remainingVisibleCount, possibleScores: [1], huTypes: hu.type ? [hu.type] : [] });
  }
  return result;
};
