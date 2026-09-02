import { matchPattern, type PatternContext, type PatternMatch } from "./types.js";

export const evaluateGangshangkaihua = (context: PatternContext): PatternMatch | null => matchPattern(context, "GANGSHANGKAIHUA", "杠上开花", Boolean(context.isGangShangKaiHua), 4);
