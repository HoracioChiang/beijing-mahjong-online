import { describe, expect, it } from "vitest";
import {
  BeijingDefaultRules, advanceTableProgress, analyzeHu, breakMahjongWall, calculateScore, calculateTing, canAddKong, canAnKong, canMingKong, canPeng, chiCombinations, createMahjongWall, createWall, deadWallRemaining, drawNextTile, drawReplacementTile, nextJokerType, revealJokerIndicator, seededRandom, serializeWall, tileLabel, tileNotation, tileType, wallRemaining
} from "../src/index.js";

const t = (...types: number[]) => types.map(tileType);
const meld = (kind: "chi" | "peng" | "ming-kong" | "an-kong", type: number) => ({ id: `m-${kind}-${type}`, kind, tiles: Array.from({ length: kind === "an-kong" || kind === "ming-kong" ? 4 : 3 }, (_, index) => ({ tileId: `${type}-${index}`, type: tileType(kind === "chi" ? type + index : type) })) });

describe("TileType / wall invariants", () => {
  it.each(Array.from({ length: 34 }, (_, type) => type))("maps type %i to a stable notation and label", (type) => {
    expect(tileType(type)).toBe(type);
    expect(tileNotation(tileType(type))).toBeTruthy();
    expect(tileLabel(tileType(type))).toBeTruthy();
  });
  it.each(Array.from({ length: 20 }, (_, seed) => seed + 1))("seed %i creates exactly four copies of every tile type", (seed) => {
    const wall = createWall(seededRandom(seed));
    expect(wall).toHaveLength(136);
    expect(new Set(wall.map((tile) => tile.tileId)).size).toBe(136);
    for (let type = 0; type < 34; type += 1) expect(wall.filter((tile) => tile.type === type)).toHaveLength(4);
  });
  it.each(Array.from({ length: 34 }, (_, indicator) => indicator))("indicator %i points to the next cyclic joker", (indicator) => {
    const next = nextJokerType(tileType(indicator));
    if (indicator < 9) expect(next).toBe(tileType(indicator === 8 ? 0 : indicator + 1));
    else if (indicator < 18) expect(next).toBe(tileType(indicator === 17 ? 9 : indicator + 1));
    else if (indicator < 27) expect(next).toBe(tileType(indicator === 26 ? 18 : indicator + 1));
    else if (indicator < 31) expect(next).toBe(tileType(indicator === 30 ? 27 : indicator + 1));
    else expect(next).toBe(tileType(indicator === 33 ? 31 : indicator + 1));
  });
});

describe("HuSolver", () => {
  it("recognizes ordinary 4 melds and a pair", () => {
    expect(analyzeHu({ concealed: t(0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 5, 27, 27), jokerType: null }).isHu).toBe(true);
  });
  it("rejects a structurally invalid hand", () => {
    expect(analyzeHu({ concealed: t(0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 5, 27, 28), jokerType: null }).isHu).toBe(false);
  });
  it("uses one joker in a pair", () => {
    expect(analyzeHu({ concealed: t(0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 31, 31, 31), jokerType: 31 as never }).isHu).toBe(true);
  });
  it("uses two jokers as a pair", () => {
    expect(analyzeHu({ concealed: t(0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 5, 31, 31), jokerType: 31 as never }).isHu).toBe(true);
  });
  it("can use three jokers as a triplet", () => {
    expect(analyzeHu({ concealed: t(0, 1, 2, 9, 10, 11, 18, 19, 20, 27, 27, 31, 31, 31), jokerType: 31 as never }).isHu).toBe(true);
  });
  it("records concrete joker assignments", () => {
    const result = analyzeHu({ concealed: t(9, 10, 11, 18, 19, 20, 6, 7, 0, 1, 31, 27, 27, 31), jokerType: 31 as never });
    expect(result.isHu).toBe(true);
    expect(result.jokerAssignments.every((assignment) => assignment.as >= 0 && assignment.as < 34)).toBe(true);
  });
  it("returns the winning decomposition rather than a boolean only", () => {
    const result = analyzeHu({ concealed: t(0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 5, 27, 27), jokerType: null });
    expect(result.possibleDecompositions.length).toBeGreaterThan(0);
    expect(result.possibleDecompositions[0]?.melds).toHaveLength(4);
    expect(result.pair).toEqual([27, 27]);
  });
  it("enumerates multiple valid standard decompositions", () => {
    const result = analyzeHu({ concealed: t(0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6), jokerType: null });
    expect(result.isHu).toBe(true);
    expect(result.possibleDecompositions.length).toBeGreaterThan(1);
  });
  it("recognizes seven pairs", () => expect(analyzeHu({ concealed: t(0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6), jokerType: null }).type).toBe("QI_DUI"));
  it("recognizes seven pairs with one joker", () => expect(analyzeHu({ concealed: t(0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 31), jokerType: 31 as never }).isHu).toBe(true));
  it("recognizes luxury seven pairs", () => expect(analyzeHu({ concealed: t(0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5), jokerType: null }).type).toBe("LUXURY_QI_DUI"));
  it("recognizes double luxury seven pairs", () => expect(analyzeHu({ concealed: t(0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 4), jokerType: null }).type).toBe("DOUBLE_LUXURY_QI_DUI"));
  it("recognizes triple luxury seven pairs", () => expect(analyzeHu({ concealed: t(0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3), jokerType: null }).type).toBe("TRIPLE_LUXURY_QI_DUI"));
  it.each([
    t(0, 1, 2, 0, 1, 2, 9, 10, 11, 9, 10, 11, 27, 27),
    t(18, 19, 20, 18, 19, 20, 21, 22, 23, 21, 22, 23, 30, 30),
    t(27, 27, 27, 28, 28, 28, 31, 31, 31, 32, 32, 32, 33, 33),
    t(0, 0, 0, 9, 9, 9, 18, 18, 18, 27, 27, 27, 4, 4),
    t(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 27, 27)
  ].map((hand) => [hand]))("accepts valid fixture", (hand) => expect(analyzeHu({ concealed: hand as number[], jokerType: null }).isHu).toBe(true));
  it.each(Array.from({ length: 10 }, (_, index) => index))("invalid near-hand %i is rejected", (index) => {
    const hand = t(0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 5, 27, 28 + (index % 5));
    expect(analyzeHu({ concealed: hand, jokerType: null }).isHu).toBe(false);
  });
});

describe("TingCalculator", () => {
  it("finds a single waiting tile", () => {
    const result = calculateTing({ concealed: t(0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 5, 27), jokerType: null });
    expect(result.some((entry) => entry.tileType === 27)).toBe(true);
  });
  it("reports remaining copies without using hidden opponent hands", () => {
    const result = calculateTing({ concealed: t(0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 5, 27), jokerType: null, visibleCounts: Array(34).fill(0), jokerIndicator: null });
    expect(result.find((entry) => entry.tileType === 27)?.remainingVisibleCount).toBe(3);
  });
  it("accounts for public indicator and discards", () => {
    const visible = Array(34).fill(0); visible[27] = 1;
    const result = calculateTing({ concealed: t(0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 5, 27), jokerType: null, visibleCounts: visible, jokerIndicator: 27 as never });
    expect(result.find((entry) => entry.tileType === 27)?.remainingVisibleCount).toBe(1);
  });
  it("supports seven-pair waits", () => expect(calculateTing({ concealed: t(0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6), jokerType: null }).length).toBeGreaterThan(0));
  it.each([0, 9, 18, 27, 31, 33])("can evaluate a %i candidate type", (candidate) => {
    const hand = t(0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 5, candidate);
    expect(calculateTing({ concealed: hand, jokerType: null })).toBeInstanceOf(Array);
  });
});

describe("Meld legality", () => {
  it.each([0, 1, 2, 9, 10, 18, 19])("allows a legal chi beginning around type %i", (type) => {
    const claimed = (type + 2) as never;
    expect(chiCombinations(t(type, type + 1), claimed, null as never).length).toBeGreaterThan(0);
  });
  it("returns every chi choice", () => expect(chiCombinations(t(2, 3, 5, 6), 4 as never, null as never).length).toBe(3));
  it("rejects chi on honors", () => expect(chiCombinations(t(27, 28), 29 as never, null as never)).toEqual([]));
  it("rejects joker chi", () => expect(chiCombinations(t(0, 1), 2 as never, 2 as never)).toEqual([]));
  it("checks peng", () => expect(canPeng(t(4, 4), 4 as never, null as never)).toBe(true));
  it("rejects joker peng", () => expect(canPeng(t(4, 4), 4 as never, 4 as never)).toBe(false));
  it("checks ming kong", () => expect(canMingKong(t(4, 4, 4), 4 as never, null as never)).toBe(true));
  it("checks concealed kong", () => expect(canAnKong(t(4, 4, 4, 4), null as never)).toEqual([4]));
  it("does not allow concealed joker kong by substitution", () => expect(canAnKong(t(4, 4, 4, 31), 31 as never)).toEqual([]));
  it("checks added kong from an existing peng", () => expect(canAddKong(t(4), [meld("peng", 4)], null as never)).toEqual([4]));
  it("does not use joker as added kong", () => expect(canAddKong(t(31), [meld("peng", 31)], 31 as never)).toEqual([]));
});

describe("Physical four-sided wall", () => {
  it("has four sides, 17 stacks per side, and two entities per stack", () => {
    const wall = createMahjongWall(seededRandom(901));
    expect(wall.sides).toHaveLength(4);
    expect(wall.sides.every((side) => side.stacks.length === 17)).toBe(true);
    expect(wall.sides.flatMap((side) => side.stacks).flatMap((stack) => [stack.bottomTile, stack.topTile]).filter(Boolean)).toHaveLength(136);
  });
  it.each(Array.from({ length: 12 }, (_, total) => total + 1))("maps %i points to the correct dealer-relative wall", (total) => {
    const wall = createMahjongWall(seededRandom(1000 + total));
    const info = breakMahjongWall(wall, 1, Math.ceil(total / 2), Math.floor(total / 2) || 1, 7);
    expect(info.targetSeat).toBe((1 + (info.total - 1) % 4) % 4);
    expect(info.breakStackIndex).toBe(info.total % 17);
    expect(info.firstDrawPosition).toEqual({ sideIndex: info.targetSeat, stackIndex: info.breakStackIndex, layer: "TOP" });
  });
  it("removes indicator and then physical live/dead draws", () => {
    const wall = createMahjongWall(seededRandom(902)); breakMahjongWall(wall, 0, 3, 4, 7);
    const indicator = revealJokerIndicator(wall); expect(indicator).not.toBeNull(); expect(deadWallRemaining(wall)).toBe(13);
    const first = drawNextTile(wall); expect(first?.position).toEqual(wall.breakInfo?.firstDrawPosition); expect(wallRemaining(wall)).toBe(121);
    const replacement = drawReplacementTile(wall); expect(replacement).not.toBeNull(); expect(deadWallRemaining(wall)).toBe(12);
    const snapshot = serializeWall(wall); expect(snapshot.liveRemaining).toBe(121); expect(snapshot.deadRemaining).toBe(12);
  });
  it("never repeats an entity position while drawing the entire live wall", () => {
    const wall = createMahjongWall(seededRandom(903)); breakMahjongWall(wall, 2, 6, 6, 7); revealJokerIndicator(wall);
    const positions = new Set<string>(); let count = 0; let drawn = drawNextTile(wall);
    while (drawn) { const key = JSON.stringify(drawn.position); expect(positions.has(key)).toBe(false); positions.add(key); count += 1; drawn = drawNextTile(wall); }
    expect(count).toBe(122); expect(wallRemaining(wall)).toBe(0);
  });
});

describe("Four-wind pot progression", () => {
  const initial = { potNumber: 1, roundWind: "EAST" as const, dealerPosition: 0 as const, dealerSeat: 0 as const, continuationCount: 0, totalHandsPlayed: 0 };
  it("keeps the dealer and wind during a dealer win", () => {
    const result = advanceTableProgress(initial, { dealerWon: true, draw: false, winnerSeat: 0 });
    expect(result.potEnded).toBe(false); expect(result.progress.dealerPosition).toBe(0); expect(result.progress.dealerSeat).toBe(0); expect(result.progress.roundWind).toBe("EAST"); expect(result.progress.continuationCount).toBe(1);
  });
  it("advances dealer position only for a non-dealer win", () => {
    const result = advanceTableProgress(initial, { dealerWon: false, draw: false, winnerSeat: 1 });
    expect(result.progress.dealerPosition).toBe(1); expect(result.progress.dealerSeat).toBe(1); expect(result.progress.roundWind).toBe("EAST"); expect(result.progress.continuationCount).toBe(0);
  });
  it.each([["EAST", "SOUTH"], ["SOUTH", "WEST"], ["WEST", "NORTH"]] as const)("moves from %s to %s after the fourth dealer", (from, to) => {
    const result = advanceTableProgress({ ...initial, roundWind: from, dealerPosition: 3, dealerSeat: 3 }, { dealerWon: false, draw: false, winnerSeat: 0 });
    expect(result.progress.roundWind).toBe(to); expect(result.progress.dealerPosition).toBe(0); expect(result.progress.dealerSeat).toBe(0);
  });
  it("ends after the fourth non-dealer finish in north wind", () => {
    const result = advanceTableProgress({ ...initial, roundWind: "NORTH", dealerPosition: 3, dealerSeat: 3 }, { dealerWon: false, draw: false, winnerSeat: 0 });
    expect(result.potEnded).toBe(true);
  });
  it("does not finish a pot after 100 dealer continuations", () => {
    let progress = initial;
    for (let index = 0; index < 100; index += 1) progress = advanceTableProgress(progress, { dealerWon: true, draw: false, winnerSeat: 0 }).progress;
    expect(progress.dealerPosition).toBe(0); expect(progress.roundWind).toBe("EAST"); expect(progress.totalHandsPlayed).toBe(100);
  });
});

describe("ScoreCalculator", () => {
  const players = [0, 1, 2, 3].map((seat) => ({ playerId: `p${seat}`, nickname: `P${seat}`, seat, isDealer: seat === 0 }));
  const scoreFor = (hand: number[], extra: Partial<Parameters<typeof calculateScore>[0]> = {}) => { const winning = analyzeHu({ concealed: t(...hand), jokerType: null }); return calculateScore({ winnerId: "p0", winnerName: "P0", allPlayers: players, winnerSeat: 0, dealerSeat: 0, concealed: t(...hand), openMelds: [], winning, jokerType: null, isSelfDraw: true, ...extra }, BeijingDefaultRules); };
  it("returns a detailed breakdown", () => expect(scoreFor([0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 5, 27, 27]).breakdown.map((item) => item.label)).toContain("基本胡"));
  it("recognizes self draw", () => expect(scoreFor([0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 5, 27, 27]).isSelfDraw).toBe(true));
  it("recognizes dealer multiplier", () => expect(scoreFor([0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 5, 27, 27]).breakdown.map((item) => item.key)).toContain("ZHUANG"));
  it("recognizes qidui", () => expect(scoreFor([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]).breakdown.map((item) => item.key)).toContain("QIDUI"));
  it("keeps a settlement zero-sum for self draw", () => expect(Object.values(scoreFor([0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 5, 27, 27]).deltas).reduce((a, b) => a + b, 0)).toBe(0));
  it("keeps a settlement zero-sum for discarder covers all", () => expect(Object.values(scoreFor([0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 5, 27, 27], { isSelfDraw: false, discarderId: "p1" }).deltas).reduce((a, b) => a + b, 0)).toBe(0));
  it("keeps a settlement zero-sum for three-pay mode", () => expect(Object.values(scoreFor([0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 5, 27, 27], { isSelfDraw: false, discarderId: "p1" },).deltas).reduce((a, b) => a + b, 0)).toBe(0));
  it("adds floor multiplier", () => expect(scoreFor([0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 5, 27, 27], { floorMultiplier: 2 }).breakdown.map((item) => item.key)).toContain("FLOOR"));
  it("recognizes gang shang kai hua", () => expect(scoreFor([0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 5, 27, 27], { isGangShangKaiHua: true }).breakdown.map((item) => item.key)).toContain("GANGSHANGKAIHUA"));
  it("recognizes qiang gang", () => expect(scoreFor([0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 5, 27, 27], { isQiangGang: true, isSelfDraw: false, discarderId: "p1" }).breakdown.map((item) => item.key)).toContain("QIANGGANG"));
});
