import { tileSuit, TileType } from "../tile.js";
import type { Meld, WinningDecomposition, WinningResult } from "../types.js";

export const usedTypes = (winning: WinningResult, decomposition?: WinningDecomposition): TileType[] => {
  const selected = decomposition ?? winning.possibleDecompositions[0];
  if (!selected) return [];
  return [...selected.melds.flatMap((meld) => meld.tileTypes), ...selected.pair.tileTypes];
};

export const isAllOneSuit = (types: readonly TileType[]): boolean => {
  const suited = types.filter((type) => tileSuit(type) !== "honors");
  return suited.length === types.length && new Set(suited.map((type) => tileSuit(type))).size === 1;
};

export const hasAllRanks = (types: readonly TileType[], suit: "characters" | "circles" | "bamboos"): boolean => {
  const base = suit === "characters" ? 0 : suit === "circles" ? 9 : 18;
  return Array.from({ length: 9 }, (_, index) => base + index).every((type) => types.includes(type as TileType));
};

export const hasOpenHand = (melds: readonly Meld[]): boolean => melds.some((meld) => meld.kind === "chi" || meld.kind === "peng" || meld.kind === "ming-kong" || meld.kind === "add-kong");
