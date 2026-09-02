import { isAllOneSuit } from "./helpers.js";
import { matchPattern, type PatternContext, type PatternMatch } from "./types.js";
import { fullWinningTypes } from "./context.js";

export const evaluateSu = (context: PatternContext, decomposition?: import("../types.js").WinningDecomposition): PatternMatch | null =>
  matchPattern(context, "SU", "素", context.winning.jokerCount === 0 && isAllOneSuit(fullWinningTypes(context, decomposition)), 2);
