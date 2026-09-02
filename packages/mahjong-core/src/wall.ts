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

export type WallLayer = "BOTTOM" | "TOP";

export interface WallStack {
  stackIndex: number;
  bottomTile: Tile | null;
  topTile: Tile | null;
}

export interface WallSide {
  sideIndex: number;
  seat: 0 | 1 | 2 | 3;
  stacks: WallStack[];
}

export interface WallPosition {
  sideIndex: number;
  stackIndex: number;
  layer: WallLayer;
}

export interface WallBreakInfo {
  dice1: number;
  dice2: number;
  total: number;
  targetSeat: 0 | 1 | 2 | 3;
  countedStacks: number[];
  breakStackIndex: number;
  firstDrawTileId: string | null;
  firstDrawPosition: WallPosition | null;
}

export interface WallCursor {
  positions: WallPosition[];
  index: number;
}

export interface MahjongWall {
  sides: [WallSide, WallSide, WallSide, WallSide];
  breakInfo: WallBreakInfo | null;
  liveCursor: WallCursor;
  deadCursor: WallCursor;
  livePositions: WallPosition[];
  deadPositions: WallPosition[];
  indicatorPosition: WallPosition | null;
}

export interface DrawnWallTile {
  tile: Tile;
  position: WallPosition;
}

const clonePosition = (position: WallPosition): WallPosition => ({ ...position });

const readPosition = (wall: MahjongWall, position: WallPosition): Tile | null => {
  const stack = wall.sides[position.sideIndex]?.stacks[position.stackIndex];
  if (!stack) return null;
  return position.layer === "TOP" ? stack.topTile : stack.bottomTile;
};

const takePosition = (wall: MahjongWall, position: WallPosition): Tile | null => {
  const stack = wall.sides[position.sideIndex]?.stacks[position.stackIndex];
  if (!stack) return null;
  const tile = position.layer === "TOP" ? stack.topTile : stack.bottomTile;
  if (position.layer === "TOP") stack.topTile = null;
  else stack.bottomTile = null;
  return tile;
};

const positionsFromBreak = (targetSide: number, breakStackIndex: number): WallPosition[] => {
  const positions: WallPosition[] = [];
  for (let sideOffset = 0; sideOffset < 4; sideOffset += 1) {
    const sideIndex = (targetSide + sideOffset) % 4;
    for (let stackOffset = 0; stackOffset < 17; stackOffset += 1) {
      const stackIndex = (breakStackIndex + stackOffset) % 17;
      // The top layer is taken first, then the bottom layer of the same stack.
      positions.push({ sideIndex, stackIndex, layer: "TOP" });
      positions.push({ sideIndex, stackIndex, layer: "BOTTOM" });
    }
  }
  return positions;
};

/** Create the real four-sided 17-stack wall. All 136 entities live in a side/stack. */
export const createMahjongWall = (random: RandomSource = cryptoRandom): MahjongWall => {
  const shuffled = createWall(random);
  const sides = [0, 1, 2, 3].map((sideIndex) => ({
    sideIndex,
    seat: sideIndex as 0 | 1 | 2 | 3,
    stacks: Array.from({ length: 17 }, (_, stackIndex) => ({
      stackIndex,
      bottomTile: shuffled[(sideIndex * 17 + stackIndex) * 2] ?? null,
      topTile: shuffled[(sideIndex * 17 + stackIndex) * 2 + 1] ?? null
    }))
  })) as [WallSide, WallSide, WallSide, WallSide];
  return {
    sides,
    breakInfo: null,
    liveCursor: { positions: [], index: 0 },
    deadCursor: { positions: [], index: 0 },
    livePositions: [],
    deadPositions: [],
    indicatorPosition: null
  };
};

/** Apply Beijing's dealer-relative break and split the last seven stacks into the dead wall. */
export const breakMahjongWall = (wall: MahjongWall, dealerSeat: number, dice1: number, dice2: number, keepTailStacks = 7): WallBreakInfo => {
  if (![0, 1, 2, 3].includes(dealerSeat)) throw new RangeError("Invalid dealer seat");
  if (!Number.isInteger(dice1) || dice1 < 1 || dice1 > 6 || !Number.isInteger(dice2) || dice2 < 1 || dice2 > 6) throw new RangeError("Invalid dice");
  const total = dice1 + dice2;
  const targetSeat = ((dealerSeat + (total - 1) % 4) % 4) as 0 | 1 | 2 | 3;
  const breakStackIndex = total % 17;
  const allPositions = positionsFromBreak(targetSeat, breakStackIndex);
  const deadCount = Math.max(1, Math.min(14, keepTailStacks * 2));
  wall.livePositions = allPositions.slice(0, allPositions.length - deadCount).map(clonePosition);
  wall.deadPositions = allPositions.slice(-deadCount).map(clonePosition);
  wall.liveCursor = { positions: wall.livePositions, index: 0 };
  wall.deadCursor = { positions: wall.deadPositions, index: 0 };
  const firstDrawPosition = wall.livePositions[0] ? clonePosition(wall.livePositions[0]) : null;
  const info: WallBreakInfo = {
    dice1,
    dice2,
    total,
    targetSeat,
    countedStacks: Array.from({ length: total }, (_, index) => (breakStackIndex - total + index + 17) % 17),
    breakStackIndex,
    firstDrawTileId: firstDrawPosition ? readPosition(wall, firstDrawPosition)?.tileId ?? null : null,
    firstDrawPosition
  };
  wall.breakInfo = info;
  return info;
};

export const drawNextTile = (wall: MahjongWall): DrawnWallTile | null => {
  const position = wall.liveCursor.positions[wall.liveCursor.index];
  if (!position) return null;
  wall.liveCursor.index += 1;
  const tile = takePosition(wall, position);
  if (!tile) throw new Error("Wall cursor points to an empty tile");
  return { tile, position: clonePosition(position) };
};

export const drawReplacementTile = (wall: MahjongWall): DrawnWallTile | null => {
  const position = wall.deadCursor.positions[wall.deadCursor.index];
  if (!position) return null;
  wall.deadCursor.index += 1;
  const tile = takePosition(wall, position);
  if (!tile) throw new Error("Dead wall cursor points to an empty tile");
  return { tile, position: clonePosition(position) };
};

export const remainingWallTiles = (wall: MahjongWall, source: "LIVE" | "DEAD"): Tile[] => {
  const cursor = source === "LIVE" ? wall.liveCursor : wall.deadCursor;
  return cursor.positions.slice(cursor.index).map((position) => readPosition(wall, position)).filter((tile): tile is Tile => Boolean(tile));
};

export const revealJokerIndicator = (wall: MahjongWall): DrawnWallTile | null => {
  const drawn = drawReplacementTile(wall);
  if (drawn) wall.indicatorPosition = clonePosition(drawn.position);
  return drawn;
};

export const wallRemaining = (wall: MahjongWall): number => wall.livePositions.length - wall.liveCursor.index;
export const deadWallRemaining = (wall: MahjongWall): number => wall.deadPositions.length - wall.deadCursor.index;

export interface PublicWallStack {
  stackIndex: number;
  bottomPresent: boolean;
  topPresent: boolean;
}

export interface PublicWallSide {
  sideIndex: number;
  seat: number;
  stacks: PublicWallStack[];
}

export const serializeWall = (wall: MahjongWall): { sides: PublicWallSide[]; liveRemaining: number; deadRemaining: number; indicatorPosition: WallPosition | null } => ({
  sides: wall.sides.map((side) => ({ sideIndex: side.sideIndex, seat: side.seat, stacks: side.stacks.map((stack) => ({ stackIndex: stack.stackIndex, bottomPresent: Boolean(stack.bottomTile), topPresent: Boolean(stack.topTile) })) })),
  liveRemaining: wallRemaining(wall),
  deadRemaining: deadWallRemaining(wall),
  indicatorPosition: wall.indicatorPosition ? clonePosition(wall.indicatorPosition) : null
});
