import { hasAllRanks } from "./helpers.js";
import { fullWinningTypes, oneSuit } from "./context.js";
import { matchPattern, type PatternContext, type PatternMatch } from "./types.js";

export const evaluateBenhunlong = (context: PatternContext, decomposition?: import("../types.js").WinningDecomposition): PatternMatch | null => {
  const types = fullWinningTypes(context, decomposition);
  const suit = oneSuit(types);
  return matchPattern(context, "BENHUNLONG", "本混龙", Boolean(context.winning.jokerCount > 0 && suit && hasAllRanks(types, suit)), 4);
};
