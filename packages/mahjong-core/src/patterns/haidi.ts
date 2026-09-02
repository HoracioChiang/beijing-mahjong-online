import { matchPattern, type PatternContext, type PatternMatch } from "./types.js";

export const evaluateHaidi = (context: PatternContext): PatternMatch | null => matchPattern(context, "HAIDI", "海底捞月", Boolean(context.isHaidi), 2);
