import { matchPattern, type PatternContext, type PatternMatch } from "./types.js";

export const evaluateTianhu = (context: PatternContext): PatternMatch | null => matchPattern(context, "TIANHU", "天胡", Boolean(context.isTianHu), 20);
