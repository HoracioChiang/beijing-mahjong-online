import { matchPattern, type PatternContext, type PatternMatch } from "./types.js";

export const evaluateZhuang = (context: PatternContext): PatternMatch | null => matchPattern(context, "ZHUANG", "庄家", context.winnerSeat === context.dealerSeat, 2);
