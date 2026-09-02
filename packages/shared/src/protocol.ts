import { z } from "zod";
import type { GamePhase, Meld, RuleConfig, Tile, TileType } from "@beijing-mahjong/mahjong-core";

export const IdentitySchema = z.object({
  playerId: z.string().min(8).max(80),
  reconnectToken: z.string().min(16).max(200)
});

export const RuleConfigSchema = z.object({
  basePoints: z.number().int().positive(),
  actionTimeoutSeconds: z.number().int().min(5).max(180),
  reactionTimeoutSeconds: z.number().int().min(3).max(60),
  showTingHint: z.boolean(),
  fourJokerAutoHu: z.boolean(),
  threeJokerSelfDrawOnly: z.boolean(),
  keepTailStacks: z.number().int().min(1).max(14),
  multiHuPolicy: z.enum(["NEAREST_ONLY", "ALLOW_MULTI_HU", "BEIJING_SPECIAL"]),
  payoutMode: z.enum(["discarder_covers_all", "all_three_pay_discarder_double"]),
  floorRule: z.object({ enabled: z.boolean(), multiplier: z.number().int().min(1).max(10), stackMode: z.enum(["NEXT_ROUND_ONLY", "ACCUMULATE"]), resetPolicy: z.enum(["RESET_ON_WIN", "NEVER_RESET"]) }),
  scoring: z.record(z.number().int().positive()),
  enableVoiceChat: z.boolean(),
  autoStart: z.boolean()
});

export const CreateRoomSchema = z.object({ nickname: z.string().trim().min(1).max(20), rules: RuleConfigSchema.partial().optional() });
export const JoinRoomSchema = z.object({ roomId: z.string().regex(/^\d{6}$/), nickname: z.string().trim().min(1).max(20), identity: IdentitySchema.optional() });
export const IdentityPayloadSchema = IdentitySchema.extend({ roomId: z.string().regex(/^\d{6}$/), nickname: z.string().trim().min(1).max(20) });

export const ActionIdSchema = z.object({ actionId: z.string().min(8).max(100), version: z.number().int().nonnegative() });
export const DiscardSchema = ActionIdSchema.extend({ tileId: z.string().min(3).max(30) });
export const ReactionSchema = ActionIdSchema.extend({ kind: z.enum(["hu", "peng", "chi", "kong", "pass"]), tileTypes: z.array(z.number().int().min(0).max(33)).max(3).optional(), kongKind: z.enum(["concealed", "added"]).optional() });
export const KongSchema = ActionIdSchema.extend({ tileType: z.number().int().min(0).max(33), kongKind: z.enum(["concealed", "added"]) });
export const VoiceSignalSchema = z.object({ toPlayerId: z.string(), signal: z.unknown() });

export type CreateRoomPayload = z.infer<typeof CreateRoomSchema>;
export type JoinRoomPayload = z.infer<typeof JoinRoomSchema>;
export type DiscardPayload = z.infer<typeof DiscardSchema>;
export type ReactionPayload = z.infer<typeof ReactionSchema>;
export type KongPayload = z.infer<typeof KongSchema>;

export interface PublicPlayerState {
  playerId: string;
  nickname: string;
  seat: number;
  connected: boolean;
  ready: boolean;
  hand?: Tile[];
  handCount: number;
  melds: Meld[];
  discards: Tile[];
  score: number;
  wins: number;
  roundsPlayed: number;
  discardCount: number;
  isDealer: boolean;
  isTurn: boolean;
  hasOpenedHand: boolean;
  isAutopilot: boolean;
  voiceEnabled: boolean;
}

export interface PublicReactionWindow {
  discard: Tile;
  discarderSeat: number;
  eligiblePlayerIds: string[];
  deadline: number;
}

export interface PublicRoundState {
  handNumber: number;
  dealerSeat: number;
  phase: GamePhase;
  currentSeat: number;
  remainingTiles: number;
  jokerIndicator: Tile | null;
  jokerType: TileType | null;
  lastAction: Record<string, unknown> | null;
  reactionWindow: PublicReactionWindow | null;
  settlement: unknown | null;
  version: number;
  floorMultiplier: number;
}

export interface PublicRoomState {
  roomId: string;
  hostPlayerId: string;
  players: PublicPlayerState[];
  round: PublicRoundState | null;
  rules: RuleConfig;
  history: Array<Record<string, unknown>>;
}

export interface ClientStatePayload { room: PublicRoomState; self: PublicPlayerState | null; legalActions: Array<Record<string, unknown>>; ting: Array<Record<string, unknown>>; }

export type ServerToClientEvents = {
  "room:state": (payload: ClientStatePayload) => void;
  "game:event": (payload: { type: string; data?: unknown }) => void;
  "game:settlement": (payload: unknown) => void;
  "player:disconnected": (payload: { playerId: string; nickname: string }) => void;
  "player:reconnected": (payload: { playerId: string; nickname: string }) => void;
  error: (payload: { code: string; message: string }) => void;
  "voice:signal": (payload: { fromPlayerId: string; signal: unknown }) => void;
};

export type ClientToServerEvents = {
  "room:create": (payload: CreateRoomPayload, callback?: (payload: unknown) => void) => void;
  "room:join": (payload: JoinRoomPayload, callback?: (payload: unknown) => void) => void;
  "room:leave": (callback?: (payload: unknown) => void) => void;
  "player:ready": (ready: boolean) => void;
  "game:start": () => void;
  "game:discard": (payload: DiscardPayload) => void;
  "game:reaction": (payload: ReactionPayload) => void;
  "game:hu": (payload: z.infer<typeof ActionIdSchema>) => void;
  "game:pass": (payload: z.infer<typeof ActionIdSchema>) => void;
  "game:kong": (payload: KongPayload) => void;
  "game:voice-enabled": (enabled: boolean) => void;
  "voice:signal": (payload: z.infer<typeof VoiceSignalSchema>) => void;
};
