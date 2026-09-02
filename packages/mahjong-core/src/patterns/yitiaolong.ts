import { hasAllRanks } from "./helpers.js";
import { fullWinningTypes, oneSuit } from "./context.js";
import { matchPattern, type PatternContext, type PatternMatch } from "./types.js";

export const evaluateYitiaolong = (context: PatternContext, decomposition?: import("../types.js").WinningDecomposition): PatternMatch | null => {
  const types = fullWinningTypes(context, decomposition);
  const suit = oneSuit(types);
  return matchPattern(context, "YITIAOLONG", "一条龙", Boolean(suit && hasAllRanks(types, suit)), 2);
};
