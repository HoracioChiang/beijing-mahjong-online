import { BeijingDefaultRules } from "./rules/beijing-default.js";
import type { RuleConfig, ScoreBreakdownItem, ScoreContext, ScoreResult } from "./types.js";
import { evaluatePatterns } from "./patterns/basic.js";

const selectedPatterns = (context: ScoreContext, rules: RuleConfig, decomposition?: import("./types.js").WinningDecomposition): ScoreBreakdownItem[] => {
  const matches = evaluatePatterns({ ...context, scoring: rules.scoring }, decomposition);
  const has = (key: string) => matches.some((pattern) => pattern.key === key);
  let filtered = matches;
  if (has("BENHUNLONG")) filtered = filtered.filter((pattern) => pattern.key !== "YITIAOLONG");
  if (has("LUXURY_QIDUI") || has("DOUBLE_LUXURY_QIDUI") || has("TRIPLE_LUXURY_QIDUI")) filtered = filtered.filter((pattern) => pattern.key !== "QIDUI");
  if (has("QINGYISE")) filtered = filtered.filter((pattern) => pattern.key !== "SU");
  return filtered;
};

export const calculateScore = (context: ScoreContext, rules: RuleConfig = BeijingDefaultRules): ScoreResult => {
  const decompositions = context.winning.type === "STANDARD" && context.winning.possibleDecompositions.length ? context.winning.possibleDecompositions : [undefined];
  let bestBreakdown: ScoreBreakdownItem[] | undefined;
  let bestMultiplier = -1;
  for (const decomposition of decompositions) {
    const candidate = [{ key: "BASE", label: "基本胡", multiplier: rules.basePoints }, ...selectedPatterns(context, rules, decomposition)];
    if (context.floorMultiplier && context.floorMultiplier > 1) candidate.push({ key: "FLOOR", label: "上楼", multiplier: context.floorMultiplier });
    const multiplier = candidate.reduce((total, item) => total * item.multiplier, 1);
    if (multiplier > bestMultiplier) { bestMultiplier = multiplier; bestBreakdown = candidate; }
  }
  const breakdown = bestBreakdown ?? [{ key: "BASE", label: "基本胡", multiplier: rules.basePoints }];
  const totalMultiplier = bestMultiplier < 0 ? rules.basePoints : bestMultiplier;
  const winnerPoints = totalMultiplier;
  const deltas: Record<string, number> = Object.fromEntries(context.allPlayers.map((player) => [player.playerId, 0]));
  const winner = context.allPlayers.find((player) => player.playerId === context.winnerId);
  if (!winner) throw new Error("Winner is not in the player list");
  const opponents = context.allPlayers.filter((player) => player.playerId !== context.winnerId);
  if (context.isSelfDraw) {
    for (const payer of opponents) {
      const payment = winnerPoints * (payer.isDealer || winner.isDealer ? 2 : 1);
      deltas[payer.playerId] = (deltas[payer.playerId] ?? 0) - payment;
      deltas[context.winnerId] = (deltas[context.winnerId] ?? 0) + payment;
    }
  } else {
    const discarder = opponents.find((player) => player.playerId === context.discarderId);
    if (!discarder) throw new Error("Discarder is required for a ron settlement");
    if (rules.payoutMode === "discarder_covers_all") {
      const payment = winnerPoints * 3 * (discarder.isDealer || winner.isDealer ? 2 : 1);
      deltas[discarder.playerId] = (deltas[discarder.playerId] ?? 0) - payment;
      deltas[context.winnerId] = (deltas[context.winnerId] ?? 0) + payment;
    } else {
      for (const payer of opponents) {
        const payment = winnerPoints * (payer.playerId === discarder.playerId ? 2 : 1);
        deltas[payer.playerId] = (deltas[payer.playerId] ?? 0) - payment;
        deltas[context.winnerId] = (deltas[context.winnerId] ?? 0) + payment;
      }
    }
  }
  const sum = Object.values(deltas).reduce((a, b) => a + b, 0);
  if (sum !== 0) throw new Error(`Settlement is not zero-sum: ${sum}`);
  return { winnerId: context.winnerId, winnerName: context.winnerName, totalMultiplier, winnerPoints, breakdown, deltas, isSelfDraw: context.isSelfDraw };
};
