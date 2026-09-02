import { tileSuit, type TileType } from "../tile.js";
import type { PatternContext } from "./types.js";
import type { WinningDecomposition } from "../types.js";

export const fullWinningTypes = (context: PatternContext, decomposition?: WinningDecomposition): TileType[] => {
  if (!decomposition) {
    return [...context.concealed, ...context.openMelds.flatMap((meld) => meld.tiles.map((tile) => tile.type))];
  }
  return [
    ...decomposition.melds.flatMap((meld) => meld.tileTypes),
    ...decomposition.pair.tileTypes,
    ...context.openMelds.flatMap((meld) => meld.tiles.map((tile) => tile.type))
  ];
};

export const oneSuit = (types: readonly TileType[]): "characters" | "circles" | "bamboos" | null => {
  const suits = new Set(types.map(tileSuit));
  if (suits.size !== 1 || suits.has("honors")) return null;
  return [...suits][0] as "characters" | "circles" | "bamboos";
};

export const isTripletMeld = (kind: string): boolean => kind === "triplet" || kind === "peng" || kind === "ming-kong" || kind === "an-kong" || kind === "add-kong";
