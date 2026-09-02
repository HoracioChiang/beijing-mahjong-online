import { matchPattern, type PatternContext, type PatternMatch } from "./types.js";

export const evaluateQidui = (context: PatternContext): PatternMatch | null =>
  matchPattern(context, "QIDUI", "七小对", context.winning.type === "QI_DUI", 2);
