import { tileSuit, TileType } from "../tile.js";
import type { ScoreContext, WinningDecomposition } from "../types.js";
import { hasAllRanks, hasOpenHand, isAllOneSuit, usedTypes } from "./helpers.js";

export interface PatternMatch { key: string; label: string; multiplier: number; }

const oneSuitFor = (types: TileType[]): "characters" | "circles" | "bamboos" | null => {
  const suits = new Set(types.map(tileSuit));
  if (suits.size !== 1 || suits.has("honors")) return null;
  return [...suits][0] as "characters" | "circles" | "bamboos";
};

export const evaluateBasicPatterns = (context: ScoreContext, decomposition?: WinningDecomposition): PatternMatch[] => {
  const rules = context;
  const allTypes = [...context.concealed, ...context.openMelds.flatMap((meld) => meld.tiles.map((tile) => tile.type)), ...(context.winning.pair ?? [])];
  const used = usedTypes(context.winning, decomposition);
  const matches: PatternMatch[] = [];
  const add = (key: string, label: string, condition: boolean, fallback = 1) => { if (condition) matches.push({ key, label, multiplier: context.winning.type ? (rules as unknown as { __scoring?: Record<string, number> }).__scoring?.[key] ?? fallback : fallback }); };
  // The score table is injected by score.ts; fallback values keep evaluators independently testable.
  const score = (key: string, fallback: number) => (context as unknown as { __scoring?: Record<string, number> }).__scoring?.[key] ?? fallback;
  if (context.winning.type === "QI_DUI") add("QIDUI", "七小对", true, 2);
  if (context.winning.type === "LUXURY_QI_DUI") add("LUXURY_QIDUI", "豪华七小对", true, 4);
  if (context.winning.type === "DOUBLE_LUXURY_QI_DUI") add("DOUBLE_LUXURY_QIDUI", "双豪华七小对", true, 8);
  if (context.winning.type === "TRIPLE_LUXURY_QI_DUI") add("TRIPLE_LUXURY_QIDUI", "三豪华七小对", true, 16);
  if (context.winning.type === "STANDARD") {
    const triplets = (decomposition?.melds.filter((meld) => meld.kind === "triplet").length ?? 0) + context.openMelds.filter((meld) => meld.kind === "peng" || meld.kind === "ming-kong" || meld.kind === "an-kong" || meld.kind === "add-kong").length;
  add("DUIDUIHU", "对对胡", triplets === 4, 2);
    add("DADIAO", "大钓/全求人", Boolean(context.isDiao), 2);
  }
  add("MENQING", "门清", !hasOpenHand(context.openMelds), 2);
  add("SU", "素", context.winning.jokerCount === 0 && isAllOneSuit(allTypes), 2);
  const oneSuit = oneSuitFor(used.length ? used : allTypes);
  add("QINGYISE", "清一色", Boolean(oneSuit), 4);
  add("YITIAOLONG", "一条龙", Boolean(oneSuit && hasAllRanks(used, oneSuit)), 2);
  add("BENHUNLONG", "本混龙", Boolean(oneSuit && context.winning.jokerCount > 0 && hasAllRanks(used, oneSuit)), 4);
  add("ZHUOWUKUI", "捉五魁", context.winningTileType === 4, 2);
  add("HAIDI", "海底捞月", Boolean(context.isHaidi), 2);
  add("GANGSHANGKAIHUA", "杠上开花", Boolean(context.isGangShangKaiHua), 4);
  add("GANGSHANGPAO", "杠上炮", Boolean(context.isGangShangPao), 4);
  add("QIANGGANG", "抢杠", Boolean(context.isQiangGang), 2);
  add("TIANHU", "天胡", Boolean(context.isTianHu), 20);
  add("DIHU", "地胡", Boolean(context.isDiHu), 20);
  add("HUN_GANG", "混杠", Boolean(context.isHunGang), 20);
  add("ZHUANG", "庄家", context.winnerSeat === context.dealerSeat, 2);
  if (context.isSelfDraw) matches.push({ key: "ZIMO", label: "自摸", multiplier: 1 });
  return matches.map((match) => ({ ...match, multiplier: match.key === "ZIMO" ? 1 : score(match.key, match.multiplier) }));
};
