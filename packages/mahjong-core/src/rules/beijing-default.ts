import type { RuleConfig } from "../types.js";

export const BeijingDefaultRules: RuleConfig = {
  basePoints: 1,
  actionTimeoutSeconds: 30,
  reactionTimeoutSeconds: 10,
  showTingHint: true,
  fourJokerAutoHu: false,
  threeJokerSelfDrawOnly: true,
  keepTailStacks: 7,
  multiHuPolicy: "NEAREST_ONLY",
  payoutMode: "discarder_covers_all",
  floorRule: { enabled: true, multiplier: 2, stackMode: "NEXT_ROUND_ONLY", resetPolicy: "RESET_ON_WIN" },
  scoring: {
    SU: 2, MENQING: 2, DUIDUIHU: 2, DADIAO: 2, QIDUI: 2, LUXURY_QIDUI: 4, DOUBLE_LUXURY_QIDUI: 8,
    TRIPLE_LUXURY_QIDUI: 16, QINGYISE: 4, YITIAOLONG: 2, BENHUNLONG: 4, ZHUOWUKUI: 2,
    HAIDI: 2, GANGSHANGKAIHUA: 4, GANGSHANGPAO: 4, QIANGGANG: 2, TIANHU: 20, DIHU: 20, HUN_GANG: 20,
    ZHUANG: 2, DIANPAO: 1
  },
  enableVoiceChat: true,
  autoStart: false
};

export const cloneRules = (source: RuleConfig = BeijingDefaultRules): RuleConfig => ({
  ...source,
  floorRule: { ...source.floorRule },
  scoring: { ...source.scoring }
});
