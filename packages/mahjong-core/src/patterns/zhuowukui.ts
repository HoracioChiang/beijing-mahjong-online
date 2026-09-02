import { matchPattern, type PatternContext, type PatternMatch } from "./types.js";

export const evaluateZhuowukui = (context: PatternContext): PatternMatch | null => matchPattern(context, "ZHUOWUKUI", "捉五魁", context.winningTileType === 4, 2);
