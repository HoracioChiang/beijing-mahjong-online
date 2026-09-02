import { matchPattern, type PatternContext, type PatternMatch } from "./types.js";

export const evaluateZimo = (context: PatternContext): PatternMatch | null => matchPattern(context, "ZIMO", "自摸", Boolean(context.isSelfDraw), 1);
