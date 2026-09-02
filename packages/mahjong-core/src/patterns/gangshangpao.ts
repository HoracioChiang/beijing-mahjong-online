import { matchPattern, type PatternContext, type PatternMatch } from "./types.js";

export const evaluateGangshangpao = (context: PatternContext): PatternMatch | null => matchPattern(context, "GANGSHANGPAO", "杠上炮", Boolean(context.isGangShangPao), 4);
