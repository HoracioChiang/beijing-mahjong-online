import { createTile, Tile, tileType, TileType } from "./tile.js";

export type RandomSource = () => number;

export const cryptoRandom: RandomSource = () => {
  const nodeCrypto = globalThis.crypto;
  if (nodeCrypto?.getRandomValues) {
    const bytes = new Uint32Array(1);
    nodeCrypto.getRandomValues(bytes);
    return (bytes[0] ?? 0) / 0x1_0000_0000;
  }
  throw new Error("A cryptographic random source is unavailable; refusing non-secure shuffle");
};

export const seededRandom = (seed: number): RandomSource => {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
};

export const createWall = (random: RandomSource = cryptoRandom): Tile[] => {
  const wall: Tile[] = [];
  for (let type = 0; type < 34; type += 1) {
    for (let copy = 0; copy < 4; copy += 1) wall.push(createTile(tileType(type), copy));
  }
  for (let index = wall.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [wall[index], wall[target]] = [wall[target]!, wall[index]!];
  }
  return wall;
};

export const createTileSetCounts = (tiles: readonly Tile[]): number[] => {
  const counts = Array<number>(34).fill(0);
  for (const tile of tiles) counts[tile.type] = counts[tile.type]! + 1;
  return counts;
};
