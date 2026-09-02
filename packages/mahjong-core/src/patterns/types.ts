import type { ScoreContext, WinningDecomposition } from "../types.js";

export interface PatternMatch {
  key: string;
  label: string;
  multiplier: number;
}

/** Context passed to one independent Beijing pattern evaluator. */
export interface PatternContext extends ScoreContext {
  scoring: Readonly<Record<string, number>>;
}

export type PatternEvaluator = (context: PatternContext, decomposition?: WinningDecomposition) => PatternMatch | null;

export const matchPattern = (context: PatternContext, key: string, label: string, condition: boolean, fallback: number): PatternMatch | null => {
  if (!condition) return null;
  return { key, label, multiplier: context.scoring[key] ?? fallback };
};
