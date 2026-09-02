import { BeijingDefaultRules } from "../rules/beijing-default.js";
import type { ScoreContext, WinningDecomposition } from "../types.js";
import { evaluateBenhunlong } from "./benhunlong.js";
import { evaluateDadia } from "./dadiao.js";
import { evaluateDihu } from "./dihu.js";
import { evaluateDuiduihu } from "./duiduihu.js";
import { evaluateGangshangkaihua } from "./gangshangkaihua.js";
import { evaluateGangshangpao } from "./gangshangpao.js";
import { evaluateHaidi } from "./haidi.js";
import { evaluateHungang } from "./hungang.js";
import { evaluateLuxuryQidui } from "./luxury-qidui.js";
import { evaluateMenqing } from "./menqing.js";
import { evaluateQianggang } from "./qianggang.js";
import { evaluateQidui } from "./qidui.js";
import { evaluateQingyise } from "./qingyise.js";
import { evaluateSu } from "./su.js";
import { evaluateTianhu } from "./tianhu.js";
import { evaluateYitiaolong } from "./yitiaolong.js";
import { evaluateZhuowukui } from "./zhuowukui.js";
import { evaluateZimo } from "./zimo.js";
import { evaluateZhuang } from "./zhuang.js";
import type { PatternContext, PatternEvaluator, PatternMatch } from "./types.js";

/** Compatibility entry point for the initial baseline. */
export const evaluateBasicPatterns = (context: ScoreContext, decomposition?: WinningDecomposition): PatternMatch[] => {
  const scoring = (context as ScoreContext & { __scoring?: Readonly<Record<string, number>> }).__scoring ?? BeijingDefaultRules.scoring;
  return evaluatePatterns({ ...context, scoring }, decomposition);
};

/** The Beijing rule set is composed from small, independently testable evaluators. */
export const BEIJING_PATTERN_EVALUATORS: readonly PatternEvaluator[] = [
  evaluateQidui,
  evaluateLuxuryQidui,
  evaluateDuiduihu,
  evaluateDadia,
  evaluateMenqing,
  evaluateSu,
  evaluateQingyise,
  evaluateYitiaolong,
  evaluateBenhunlong,
  evaluateZhuowukui,
  evaluateGangshangkaihua,
  evaluateGangshangpao,
  evaluateQianggang,
  evaluateHaidi,
  evaluateTianhu,
  evaluateDihu,
  evaluateHungang,
  evaluateZhuang,
  evaluateZimo
];

export const evaluatePatterns = (context: PatternContext, decomposition?: WinningDecomposition): PatternMatch[] =>
  BEIJING_PATTERN_EVALUATORS.map((evaluate) => evaluate(context, decomposition)).filter((match): match is PatternMatch => Boolean(match));
