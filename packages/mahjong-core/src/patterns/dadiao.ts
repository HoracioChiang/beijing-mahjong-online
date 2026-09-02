import { matchPattern, type PatternContext, type PatternMatch } from "./types.js";

export const evaluateDadia = (context: PatternContext): PatternMatch | null => matchPattern(context, "DADIAO", "大钓/全求人", Boolean(context.isDiao), 2);
