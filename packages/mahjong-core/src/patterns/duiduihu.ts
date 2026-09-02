import { matchPattern, type PatternContext, type PatternMatch } from "./types.js";
import { isTripletMeld } from "./context.js";

export const evaluateDuiduihu = (context: PatternContext, decomposition?: import("../types.js").WinningDecomposition): PatternMatch | null => {
  if (context.winning.type !== "STANDARD" || !decomposition) return null;
  const triplets = decomposition.melds.filter((meld) => meld.kind === "triplet").length + context.openMelds.filter((meld) => isTripletMeld(meld.kind)).length;
  return matchPattern(context, "DUIDUIHU", "对对胡", triplets === 4, 2);
};
