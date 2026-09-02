import type { Tile, TileType } from "./tile.js";

export type MeldKind = "chi" | "peng" | "ming-kong" | "an-kong" | "add-kong";

export interface Meld {
  id: string;
  kind: MeldKind;
  tiles: Tile[];
  claimedTileType?: TileType;
  fromSeat?: number;
}

export type GamePhase =
  | "WAITING_FOR_PLAYERS"
  | "READY"
  | "DETERMINING_DEALER"
  | "ROLLING_FOR_WALL"
  | "DEALING"
  | "WAITING_FOR_DISCARD"
  | "WAITING_FOR_REACTIONS"
  | "RESOLVING_CHI"
  | "RESOLVING_PENG"
  | "RESOLVING_KONG"
  | "DRAWING_KONG_REPLACEMENT"
  | "ROUND_END"
  | "SETTLEMENT"
  | "NEXT_ROUND"
  | "POT_END"
  | "POT_SETTLEMENT";

export interface RuleConfig {
  basePoints: number;
  actionTimeoutSeconds: number;
  reactionTimeoutSeconds: number;
  showTingHint: boolean;
  fourJokerAutoHu: boolean;
  threeJokerSelfDrawOnly: boolean;
  keepTailStacks: number;
  multiHuPolicy: "NEAREST_ONLY" | "ALLOW_MULTI_HU" | "BEIJING_SPECIAL";
  payoutMode: "discarder_covers_all" | "all_three_pay_discarder_double";
  floorRule: {
    enabled: boolean;
    multiplier: number;
    stackMode: "NEXT_ROUND_ONLY" | "ACCUMULATE";
    resetPolicy: "RESET_ON_WIN" | "NEVER_RESET";
  };
  scoring: Record<string, number>;
  enableVoiceChat: boolean;
  autoStart: boolean;
  newPotScorePolicy: "RESET" | "CARRY";
}

export type RoundWind = "EAST" | "SOUTH" | "WEST" | "NORTH";

export interface TableProgress {
  potNumber: number;
  roundWind: RoundWind;
  dealerPosition: 0 | 1 | 2 | 3;
  dealerSeat: 0 | 1 | 2 | 3;
  continuationCount: number;
  totalHandsPlayed: number;
}

export interface DealerRoll {
  playerId: string;
  dice1: number;
  dice2: number;
  total: number;
  rerollRound: number;
}

export interface DealerDeterminationResult {
  rolls: DealerRoll[];
  finalOrder: string[];
}

export interface WinningMeld {
  kind: "sequence" | "triplet" | "pair";
  tileTypes: TileType[];
  jokerIndexes: number[];
  jokerAssignments?: Array<{ jokerIndex: number; as: TileType }>;
}

export interface WinningDecomposition {
  melds: WinningMeld[];
  pair: WinningMeld;
}

export type HuType = "STANDARD" | "QI_DUI" | "LUXURY_QI_DUI" | "DOUBLE_LUXURY_QI_DUI" | "TRIPLE_LUXURY_QI_DUI";

export interface WinningResult {
  isHu: boolean;
  type?: HuType;
  melds: Meld[];
  pair?: TileType[];
  jokerAssignments: Array<{ jokerIndex: number; as: TileType; use: "pair" | "triplet" | "sequence" }>;
  possibleDecompositions: WinningDecomposition[];
  jokerCount: number;
}

export interface HuContext {
  concealed: readonly TileType[];
  openMelds?: readonly Meld[];
  jokerType: TileType | null;
  winningTileType?: TileType;
  isSelfDraw?: boolean;
  allowSevenPairs?: boolean;
}

export interface TingResult {
  tileType: TileType;
  remainingVisibleCount: number;
  possibleScores: number[];
  huTypes: HuType[];
}

export interface ScoreContext {
  winnerId: string;
  winnerName: string;
  allPlayers: Array<{ playerId: string; nickname: string; seat: number; isDealer: boolean }>;
  winnerSeat: number;
  dealerSeat: number;
  concealed: readonly TileType[];
  openMelds: readonly Meld[];
  winning: WinningResult;
  jokerType: TileType | null;
  winningTileType?: TileType;
  isSelfDraw: boolean;
  discarderId?: string;
  isHaidi?: boolean;
  isGangShangKaiHua?: boolean;
  isGangShangPao?: boolean;
  isQiangGang?: boolean;
  isTianHu?: boolean;
  isDiHu?: boolean;
  isHunGang?: boolean;
  isDiao?: boolean;
  floorMultiplier?: number;
}

export interface ScoreBreakdownItem {
  key: string;
  label: string;
  multiplier: number;
}

export interface ScoreResult {
  winnerId: string;
  winnerName: string;
  totalMultiplier: number;
  winnerPoints: number;
  breakdown: ScoreBreakdownItem[];
  deltas: Record<string, number>;
  isSelfDraw: boolean;
}
