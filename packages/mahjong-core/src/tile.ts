export const TILE_TYPE_COUNT = 34;
export const COPIES_PER_TILE = 4;

export type TileType = number & { readonly __tileType: unique symbol };
export type Suit = "characters" | "circles" | "bamboos" | "honors";

export interface Tile {
  tileId: string;
  type: TileType;
}

export const tileType = (value: number): TileType => {
  if (!Number.isInteger(value) || value < 0 || value >= TILE_TYPE_COUNT) {
    throw new RangeError(`Invalid TileType: ${value}`);
  }
  return value as TileType;
};

export const tileSuit = (type: TileType): Suit => {
  if (type < 9) return "characters";
  if (type < 18) return "circles";
  if (type < 27) return "bamboos";
  return "honors";
};

export const tileRank = (type: TileType): number | null => tileSuit(type) === "honors" ? null : (type % 9) + 1;

export const tileNotation = (type: TileType): string => {
  if (type < 9) return `${type + 1}m`;
  if (type < 18) return `${type - 8}p`;
  if (type < 27) return `${type - 17}s`;
  return ["东", "南", "西", "北", "中", "发", "白"][type - 27] ?? "牌";
};

export const tileLabel = (type: TileType): string => {
  if (type < 9) return `${type + 1}万`;
  if (type < 18) return `${type - 8}筒`;
  if (type < 27) return `${type - 17}条`;
  return ["东", "南", "西", "北", "中", "发", "白"][type - 27] ?? "牌";
};

export const tileCounts = (tiles: readonly TileType[]): number[] => {
  const counts = Array<number>(TILE_TYPE_COUNT).fill(0);
  for (const type of tiles) counts[type] = counts[type]! + 1;
  return counts;
};

export const typeCounts = (tiles: readonly Tile[]): number[] => tileCounts(tiles.map((tile) => tile.type));

export const nextJokerType = (indicator: TileType): TileType => {
  if (indicator < 9) return tileType(indicator === 8 ? 0 : indicator + 1);
  if (indicator < 18) return tileType(indicator === 17 ? 9 : indicator + 1);
  if (indicator < 27) return tileType(indicator === 26 ? 18 : indicator + 1);
  if (indicator < 31) return tileType(indicator === 30 ? 27 : indicator + 1);
  return tileType(indicator === 33 ? 31 : indicator + 1);
};

export const createTile = (type: TileType, copy: number): Tile => ({ tileId: `${tileNotation(type)}-${copy}`, type });

export const isJoker = (type: TileType, jokerType: TileType | null): boolean => jokerType !== null && type === jokerType;
