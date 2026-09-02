import { matchPattern, type PatternContext, type PatternMatch } from "./types.js";

export const evaluateLuxuryQidui = (context: PatternContext): PatternMatch | null => {
  const key = context.winning.type === "LUXURY_QI_DUI" ? "LUXURY_QIDUI" : context.winning.type === "DOUBLE_LUXURY_QI_DUI" ? "DOUBLE_LUXURY_QIDUI" : context.winning.type === "TRIPLE_LUXURY_QI_DUI" ? "TRIPLE_LUXURY_QIDUI" : null;
  const label = key === "LUXURY_QIDUI" ? "豪华七小对" : key === "DOUBLE_LUXURY_QIDUI" ? "双豪华七小对" : "三豪华七小对";
  return key ? matchPattern(context, key, label, true, key === "LUXURY_QIDUI" ? 4 : key === "DOUBLE_LUXURY_QIDUI" ? 8 : 16) : null;
};
