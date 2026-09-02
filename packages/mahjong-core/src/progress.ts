import type { RoundWind, TableProgress } from "./types.js";

export const WINDS: readonly RoundWind[] = ["EAST", "SOUTH", "WEST", "NORTH"];

export const nextSeat = (seat: number): 0 | 1 | 2 | 3 => ((seat + 1) % 4) as 0 | 1 | 2 | 3;

export const nextWind = (wind: RoundWind): RoundWind => WINDS[(WINDS.indexOf(wind) + 1) % WINDS.length]!;

export interface HandOutcome {
  dealerWon: boolean;
  draw: boolean;
  winnerSeat?: number;
}

export interface ProgressionResult {
  progress: TableProgress;
  potEnded: boolean;
}

/** Advance one completed hand. Continuations never consume a dealer position. */
export const advanceTableProgress = (current: TableProgress, outcome: HandOutcome): ProgressionResult => {
  const progress: TableProgress = { ...current, totalHandsPlayed: current.totalHandsPlayed + 1 };
  if (outcome.draw || outcome.dealerWon) {
    progress.continuationCount += 1;
    return { progress, potEnded: false };
  }
  progress.continuationCount = 0;
  if (current.dealerPosition < 3) {
    progress.dealerPosition = (current.dealerPosition + 1) as 0 | 1 | 2 | 3;
    progress.dealerSeat = nextSeat(current.dealerSeat);
    return { progress, potEnded: false };
  }
  if (current.roundWind === "NORTH") return { progress, potEnded: true };
  progress.roundWind = nextWind(current.roundWind);
  progress.dealerPosition = 0;
  progress.dealerSeat = nextSeat(current.dealerSeat);
  return { progress, potEnded: false };
};
