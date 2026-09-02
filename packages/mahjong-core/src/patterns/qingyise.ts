import { matchPattern, type PatternContext, type PatternMatch } from "./types.js";
import { fullWinningTypes, oneSuit } from "./context.js";

export const evaluateQingyise = (context: PatternContext, decomposition?: import("../types.js").WinningDecomposition): PatternMatch | null =>
  matchPattern(context, "QINGYISE", "清一色", Boolean(oneSuit(fullWinningTypes(context, decomposition))), 4);
