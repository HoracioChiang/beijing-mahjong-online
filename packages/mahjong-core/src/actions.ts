import { tileSuit, TileType } from "./tile.js";
import type { Meld } from "./types.js";

export interface ChiCombination { tileTypes: [TileType, TileType, TileType]; }

export const chiCombinations = (hand: readonly TileType[], claimed: TileType, jokerType: TileType | null): ChiCombination[] => {
  if (tileSuit(claimed) === "honors" || claimed === jokerType) return [];
  const counts = hand.reduce((map, type) => map.set(type, (map.get(type) ?? 0) + 1), new Map<TileType, number>());
  const rank = claimed % 9;
  const combinations: ChiCombination[] = [];
  for (const start of [rank - 2, rank - 1, rank]) {
    if (start < 0 || start > 6) continue;
    const types = [start + Math.floor(claimed / 9) * 9, start + 1 + Math.floor(claimed / 9) * 9, start + 2 + Math.floor(claimed / 9) * 9].map((value) => value as TileType) as [TileType, TileType, TileType];
    const needed = types.filter((type) => type !== claimed);
    if (needed.every((type) => (counts.get(type) ?? 0) > 0)) combinations.push({ tileTypes: types });
  }
  return combinations;
};

export const canPeng = (hand: readonly TileType[], claimed: TileType, jokerType: TileType | null): boolean => claimed !== jokerType && hand.filter((type) => type === claimed).length >= 2;
export const canMingKong = (hand: readonly TileType[], claimed: TileType, jokerType: TileType | null): boolean => claimed !== jokerType && hand.filter((type) => type === claimed).length >= 3;
export const canAnKong = (hand: readonly TileType[], jokerType: TileType | null): TileType[] => Array.from(new Set(hand.filter((type) => type !== jokerType))).filter((type) => hand.filter((candidate) => candidate === type).length === 4);
export const canAddKong = (hand: readonly TileType[], melds: readonly Meld[], jokerType: TileType | null): TileType[] => melds.filter((meld) => meld.kind === "peng").map((meld) => meld.tiles[0]?.type).filter((type): type is TileType => type !== undefined && type !== jokerType && hand.includes(type));
