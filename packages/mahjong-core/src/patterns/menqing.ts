import { hasOpenHand } from "./helpers.js";
import { matchPattern, type PatternContext, type PatternMatch } from "./types.js";

export const evaluateMenqing = (context: PatternContext): PatternMatch | null =>
  matchPattern(context, "MENQING", "门清", !hasOpenHand(context.openMelds), 2);
