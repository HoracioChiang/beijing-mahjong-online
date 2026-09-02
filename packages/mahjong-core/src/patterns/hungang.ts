import { matchPattern, type PatternContext, type PatternMatch } from "./types.js";

export const evaluateHungang = (context: PatternContext): PatternMatch | null => matchPattern(context, "HUN_GANG", "混杠", Boolean(context.isHunGang), 20);
