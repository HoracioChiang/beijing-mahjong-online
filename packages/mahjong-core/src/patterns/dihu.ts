import { matchPattern, type PatternContext, type PatternMatch } from "./types.js";

export const evaluateDihu = (context: PatternContext): PatternMatch | null => matchPattern(context, "DIHU", "地胡", Boolean(context.isDiHu), 20);
