import { matchPattern, type PatternContext, type PatternMatch } from "./types.js";

export const evaluateQianggang = (context: PatternContext): PatternMatch | null => matchPattern(context, "QIANGGANG", "抢杠胡", Boolean(context.isQiangGang), 2);
