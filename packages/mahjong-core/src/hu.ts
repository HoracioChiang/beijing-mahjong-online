import { tileCounts, tileSuit, tileType, TileType } from "./tile.js";
import type { HuContext, Meld, WinningDecomposition, WinningMeld, WinningResult } from "./types.js";

const clone = (counts: number[]) => counts.slice();
const keyFor = (counts: number[], jokers: number, groups: number, pair: boolean) => `${counts.join("")}|${jokers}|${groups}|${pair ? 1 : 0}`;

type SearchState = { counts: number[]; jokers: number; groups: number; pair: boolean; melds: WinningMeld[]; pairMeld?: WinningMeld; jokerAssignments: WinningResult["jokerAssignments"] };

const addAssignments = (state: SearchState, indexes: number[], as: TileType, use: "pair" | "triplet" | "sequence") => indexes.map((jokerIndex) => ({ jokerIndex, as, use }));

const standardDecompositions = (input: number[], jokerCount: number, groupsNeeded: number, maxResults = 128): WinningDecomposition[] => {
  const results: WinningDecomposition[] = [];
  const visited = new Set<string>();
  const search = (state: SearchState): void => {
    if (results.length >= maxResults) return;
    const stateKey = keyFor(state.counts, state.jokers, state.groups, state.pair) + `:${state.melds.map((m) => `${m.kind}${m.tileTypes.join("")}`).join("/")}`;
    if (visited.has(stateKey)) return;
    visited.add(stateKey);
    const first = state.counts.findIndex((count) => count > 0);
    if (first === -1) {
      if (state.groups === 0 && state.pair && state.jokers === 0 && state.pairMeld) {
        results.push({ melds: state.melds, pair: state.pairMeld });
        return;
      }
      if (!state.pair && state.jokers >= 2) {
        const pairMeld: WinningMeld = { kind: "pair", tileTypes: [tileType(0), tileType(0)], jokerIndexes: [0, 1], jokerAssignments: [{ jokerIndex: 0, as: tileType(0) }, { jokerIndex: 1, as: tileType(0) }] };
        search({ ...state, jokers: state.jokers - 2, pair: true, pairMeld });
      }
      if (state.groups > 0 && state.jokers >= 3) {
        const jokerIndexes = Array.from({ length: 3 }, (_, index) => jokerCount - state.jokers + index);
        const meld: WinningMeld = { kind: "triplet", tileTypes: [tileType(0), tileType(0), tileType(0)], jokerIndexes, jokerAssignments: jokerIndexes.map((jokerIndex) => ({ jokerIndex, as: tileType(0) })) };
        search({ ...state, jokers: state.jokers - 3, groups: state.groups - 1, melds: [...state.melds, meld] });
      }
      return;
    }
    const type = tileType(first);
    const jokerStart = jokerCount - state.jokers;
    if (!state.pair) {
      const take = Math.min(2, state.counts[first]!);
      const missing = 2 - take;
      if (missing <= state.jokers) {
        const counts = clone(state.counts); counts[first] = counts[first]! - take;
        const jokerIndexes = Array.from({ length: missing }, (_, index) => jokerStart + index);
        search({ ...state, counts, jokers: state.jokers - missing, pair: true, pairMeld: { kind: "pair", tileTypes: [type, type], jokerIndexes, jokerAssignments: jokerIndexes.map((jokerIndex) => ({ jokerIndex, as: type })) } });
      }
    }
    if (state.groups > 0) {
      const take = Math.min(3, state.counts[first]!);
      const missing = 3 - take;
      if (missing <= state.jokers) {
        const counts = clone(state.counts); counts[first] = counts[first]! - take;
        const jokerIndexes = Array.from({ length: missing }, (_, index) => jokerStart + index);
        search({ ...state, counts, jokers: state.jokers - missing, groups: state.groups - 1, melds: [...state.melds, { kind: "triplet", tileTypes: [type, type, type], jokerIndexes, jokerAssignments: jokerIndexes.map((jokerIndex) => ({ jokerIndex, as: type })) }] });
      }
      if (tileSuit(type) !== "honors") {
        const rank = first % 9;
        for (const startRank of [rank - 2, rank - 1, rank]) {
          if (startRank < 0 || startRank > 6) continue;
          const sequenceTypes = [tileType(first - rank + startRank), tileType(first - rank + startRank + 1), tileType(first - rank + startRank + 2)];
          const needed = new Map<number, number>();
          for (const sequenceType of sequenceTypes) needed.set(sequenceType, (needed.get(sequenceType) ?? 0) + 1);
          let missing = 0;
          for (const [sequenceType, required] of needed) missing += Math.max(0, required - state.counts[sequenceType]!);
          if (missing > state.jokers) continue;
          const counts = clone(state.counts);
          const missingTypes: TileType[] = [];
          for (const sequenceType of sequenceTypes) {
            if (counts[sequenceType]! > 0) counts[sequenceType]! -= 1;
            else missingTypes.push(sequenceType);
          }
          const jokerIndexes = missingTypes.map((_, index) => jokerStart + index);
          search({ ...state, counts, jokers: state.jokers - missing, groups: state.groups - 1, melds: [...state.melds, { kind: "sequence", tileTypes: sequenceTypes, jokerIndexes, jokerAssignments: missingTypes.map((as, index) => ({ jokerIndex: jokerIndexes[index]!, as })) }] });
        }
      }
    }
  };
  search({ counts: input.slice(), jokers: jokerCount, groups: groupsNeeded, pair: false, melds: [], jokerAssignments: [] });
  return results;
};

const luxurySevenPairs = (counts: number[], jokers: number): { type: WinningResult["type"]; assignments: WinningResult["jokerAssignments"] } | null => {
  const pairUnits = counts.reduce((sum, count) => sum + Math.floor(count / 2), 0);
  const singles = counts.reduce((sum, count) => sum + (count % 2), 0);
  if (singles > jokers) return null;
  const rest = jokers - singles;
  if (pairUnits + singles + Math.floor(rest / 2) !== 7) return null;
  const quads = counts.filter((count) => count === 4).length;
  const type = quads >= 3 ? "TRIPLE_LUXURY_QI_DUI" : quads === 2 ? "DOUBLE_LUXURY_QI_DUI" : quads === 1 ? "LUXURY_QI_DUI" : "QI_DUI";
  const assignments: WinningResult["jokerAssignments"] = [];
  let index = 0;
  for (let type = 0; type < counts.length; type += 1) if (counts[type]! % 2 === 1) assignments.push({ jokerIndex: index++, as: tileType(type), use: "pair" });
  while (index < jokers) assignments.push({ jokerIndex: index++, as: tileType(0), use: "pair" });
  return { type, assignments };
};

export const analyzeHu = (context: HuContext): WinningResult => {
  const openMelds = context.openMelds ?? [];
  const counts = tileCounts(context.concealed);
  const jokerCount = context.jokerType === null ? 0 : counts[context.jokerType]!;
  if (context.jokerType !== null) counts[context.jokerType] = 0;
  const total = context.concealed.length + openMelds.length * 3;
  const empty: WinningResult = { isHu: false, melds: [...openMelds], possibleDecompositions: [], jokerAssignments: [], jokerCount };
  if (total !== 14) return empty;
  const groupsNeeded = 4 - openMelds.length;
  if (groupsNeeded < 0) return empty;
  const decompositions = standardDecompositions(counts, jokerCount, groupsNeeded);
  if ((context.allowSevenPairs ?? true) && openMelds.length === 0) {
    const sevenPairs = luxurySevenPairs(counts, jokerCount);
    if (sevenPairs) return { ...empty, isHu: true, type: sevenPairs.type, jokerAssignments: sevenPairs.assignments, possibleDecompositions: decompositions };
  }
  if (decompositions.length === 0) return empty;
  const best = decompositions[0]!;
  return {
    ...empty,
    isHu: true,
    type: "STANDARD",
    melds: [...openMelds],
    pair: best.pair.tileTypes,
    jokerAssignments: [...best.melds, best.pair].flatMap((meld) => (meld.jokerAssignments ?? meld.jokerIndexes.map((jokerIndex) => ({ jokerIndex, as: meld.tileTypes[0]! }))).map(({ jokerIndex, as }) => ({ jokerIndex, as, use: meld.kind === "pair" ? "pair" : meld.kind === "triplet" ? "triplet" : "sequence" }))),
    possibleDecompositions: decompositions
  };
};

export const canHu = (context: HuContext): boolean => analyzeHu(context).isHu;
