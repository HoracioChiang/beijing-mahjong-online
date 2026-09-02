import { randomBytes, randomInt } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  advanceTableProgress,
  analyzeHu,
  BeijingDefaultRules,
  breakMahjongWall,
  calculateScore,
  calculateTing,
  canAddKong,
  canAnKong,
  canMingKong,
  canPeng,
  chiCombinations,
  cloneRules,
  createMahjongWall,
  drawNextTile,
  drawReplacementTile,
  isJoker,
  nextJokerType,
  revealJokerIndicator,
  remainingWallTiles,
  serializeWall,
  tileType,
  wallRemaining,
  type Meld,
  type MahjongWall,
  type DealerDeterminationResult,
  type RuleConfig,
  type TableProgress,
  type Tile,
  type TileType
} from "@beijing-mahjong/mahjong-core";
import type { ClientStatePayload, PublicPlayerState, PublicRoomState, PublicRoundState, ReactionPayload } from "@beijing-mahjong/shared";
import { ActionResolver } from "./action-resolver.js";
import { BotController } from "./bot-controller.js";
import type { BotStrategy } from "./bot-strategy.js";

export type PlayerType = "HUMAN" | "BOT";

export interface InternalPlayer {
  playerId: string; nickname: string; reconnectToken: string | null; socketId?: string; seat: number; playerType: PlayerType;
  connected: boolean; ready: boolean; hand: Tile[]; melds: Meld[]; discards: Tile[]; score: number; wins: number; roundsPlayed: number; discardCount: number;
  hasOpenedHand: boolean; hasChi: boolean; hasPeng: boolean; hasMingGang: boolean; isAutopilot: boolean; voiceEnabled: boolean; lastSeenAt: number;
  selfDrawWins: number; maxSingleWin: number; continuationWins: number;
}
interface ReactionEntry { playerId: string; legal: Array<Record<string, unknown>>; response?: ReactionPayload; }
interface ReactionWindow { discard: Tile; discarderSeat: number; eligible: Map<string, ReactionEntry>; deadline: number; source: "discard" | "added-kong"; kongActorId?: string; actionId: string; }
export interface DealerRuntime { result: DealerDeterminationResult; pendingPlayerIds: Set<string>; currentRerollRound: number; }
export interface RoundRuntime {
  handNumber: number; dealerSeat: number; phase: PublicRoundState["phase"]; currentSeat: number; wall: MahjongWall | null;
  jokerIndicator: Tile | null; jokerType: TileType | null; wallRoll: { dice1: number; dice2: number; total: number } | null;
  wallBreak: ReturnType<typeof breakMahjongWall> | null; lastAction: Record<string, unknown> | null; reactionWindow: ReactionWindow | null;
  settlement: unknown | null; version: number; lastDrawWasReplacement: boolean; floorMultiplier: number; dealerRuntime: DealerRuntime | null;
  outcome: { winnerSeat?: number; draw: boolean } | null;
  /** Compatibility views used by simulations/tests; the authoritative source is wall. */
  liveWall: Tile[];
  deadWall: Tile[];
}

const id = (prefix: string) => `${prefix}_${randomBytes(12).toString("hex")}`;
const serverRandom = () => randomInt(0, 0x1_0000_0000) / 0x1_0000_0000;
const cloneTile = (tile: Tile): Tile => ({ ...tile });
const seatDistance = (from: number, to: number) => (to - from + 4) % 4;
const sortHand = (hand: Tile[]) => hand.sort((a, b) => a.type - b.type || a.tileId.localeCompare(b.tileId));
const botNames = ["小北", "小京", "小胡", "小南"];

export class GameRoom extends EventEmitter {
  readonly roomId: string; hostPlayerId: string; readonly players: Array<InternalPlayer | null> = [null, null, null, null];
  readonly history: Array<Record<string, unknown>> = []; readonly rules: RuleConfig; readonly botController: BotController;
  round: RoundRuntime | null = null; tableProgress: TableProgress | null = null; dealerDetermination: DealerDeterminationResult | null = null;
  private timer: NodeJS.Timeout | undefined; private destroyed = false; private nextFloorMultiplier = 1;

  constructor(roomId: string, hostPlayerId: string, rules: RuleConfig = BeijingDefaultRules) { super(); this.roomId = roomId; this.hostPlayerId = hostPlayerId; this.rules = cloneRules(rules); this.botController = new BotController(); }

  addPlayer(nickname: string, identity?: { playerId: string; reconnectToken: string }, socketId?: string): InternalPlayer {
    const normalized = nickname.trim().slice(0, 20); if (!normalized) throw new Error("昵称不能为空");
    const existing = identity ? this.players.find((player) => player?.playerType === "HUMAN" && player.playerId === identity.playerId && player.reconnectToken === identity.reconnectToken) : this.players.find((player) => player?.playerType === "HUMAN" && player.nickname === normalized && !player.connected);
    if (existing) { existing.socketId = socketId; existing.connected = true; existing.lastSeenAt = Date.now(); existing.isAutopilot = false; existing.nickname = normalized; this.emit("reconnected", { playerId: existing.playerId, nickname: existing.nickname }); this.emitState(); return existing; }
    if (this.round && !["WAITING_FOR_PLAYERS", "READY"].includes(this.round.phase)) throw new Error("游戏已经开始，不能加入新玩家");
    const seat = this.players.findIndex((player) => player === null); if (seat < 0) throw new Error("房间已满");
    const player: InternalPlayer = { playerId: identity?.playerId ?? id("player"), nickname: normalized, reconnectToken: identity?.reconnectToken ?? randomBytes(24).toString("base64url"), socketId, seat, playerType: "HUMAN", connected: true, ready: false, hand: [], melds: [], discards: [], score: 0, wins: 0, roundsPlayed: 0, discardCount: 0, selfDrawWins: 0, maxSingleWin: 0, continuationWins: 0, hasOpenedHand: false, hasChi: false, hasPeng: false, hasMingGang: false, isAutopilot: false, voiceEnabled: false, lastSeenAt: Date.now() };
    this.players[seat] = player; if (!this.round) this.round = this.waitingRound(); this.emitState(); return player;
  }

  addBot(nickname?: string): InternalPlayer {
    if (this.round && !["WAITING_FOR_PLAYERS", "READY"].includes(this.round.phase)) throw new Error("牌局开始后不能添加机器人");
    const seat = this.players.findIndex((player) => player === null); if (seat < 0) throw new Error("房间已满");
    const used = new Set(this.players.filter(Boolean).map((player) => player!.nickname)); const name = (nickname?.trim() || botNames.find((candidate) => !used.has(candidate)) || `机器人${seat + 1}`).slice(0, 20);
    const bot: InternalPlayer = { playerId: id("bot"), nickname: name, reconnectToken: null, seat, playerType: "BOT", connected: true, ready: true, hand: [], melds: [], discards: [], score: 0, wins: 0, roundsPlayed: 0, discardCount: 0, selfDrawWins: 0, maxSingleWin: 0, continuationWins: 0, hasOpenedHand: false, hasChi: false, hasPeng: false, hasMingGang: false, isAutopilot: false, voiceEnabled: false, lastSeenAt: Date.now() };
    this.players[seat] = bot; if (!this.round) this.round = this.waitingRound(); this.emit("event", { type: "bot-added", data: { playerId: bot.playerId, nickname: bot.nickname, seat: bot.seat } }); this.emitState(); return bot;
  }

  addBotsAndStart(requesterId: string): void { this.assertHost(requesterId); while (this.playerCount() < 4) this.addBot(); for (const player of this.players) if (player) player.ready = true; this.startGame(requesterId); }
  removeBot(requesterId: string, botId: string): void { this.assertHost(requesterId); const index = this.players.findIndex((player) => player?.playerId === botId && player.playerType === "BOT"); if (index < 0) throw new Error("机器人不存在"); if (this.round && !["WAITING_FOR_PLAYERS", "READY"].includes(this.round.phase)) throw new Error("牌局开始后不能移除机器人"); this.players[index] = null; this.emitState(); }

  getPlayer(playerId: string): InternalPlayer { const player = this.players.find((candidate) => candidate?.playerId === playerId); if (!player) throw new Error("玩家不在房间内"); return player; }
  getPlayerBySeat(seat: number): InternalPlayer { const player = this.players.find((candidate) => candidate?.seat === seat); if (!player) throw new Error("座位无玩家"); return player; }
  getBotPlayers(): InternalPlayer[] { return this.players.filter((player): player is InternalPlayer => Boolean(player?.playerType === "BOT")); }
  getPlayerBySocket(socketId: string): InternalPlayer | undefined { return this.players.find((player): player is InternalPlayer => Boolean(player?.socketId === socketId && player.connected)); }
  playerCount(): number { return this.players.filter(Boolean).length; } activeCount(): number { return this.players.filter((player) => player?.connected).length; }
  humanCount(): number { return this.players.filter((player) => player?.playerType === "HUMAN").length; } activeHumanCount(): number { return this.players.filter((player) => player?.playerType === "HUMAN" && player.connected).length; }

  setReady(playerId: string, ready: boolean): void {
    const player = this.getPlayer(playerId); if (player.playerType === "BOT") return;
    if (this.round && !["WAITING_FOR_PLAYERS", "READY", "SETTLEMENT", "NEXT_ROUND"].includes(this.round.phase)) throw new Error("本局进行中不能修改准备状态");
    player.ready = ready; this.emitState(); if (ready && (this.rules.autoStart || this.round?.phase === "SETTLEMENT" || this.round?.phase === "NEXT_ROUND") && this.playerCount() === 4 && this.players.every((candidate) => candidate?.ready)) this.startGame(this.hostPlayerId);
  }

  startGame(requesterId: string): void {
    this.assertHost(requesterId); if (this.playerCount() !== 4 || !this.players.every((player) => player?.ready)) throw new Error("需要四位玩家全部准备");
    const phase = this.round?.phase ?? "WAITING_FOR_PLAYERS";
    if (["DETERMINING_DEALER", "ROLLING_FOR_WALL", "DEALING", "WAITING_FOR_DISCARD", "WAITING_FOR_REACTIONS", "RESOLVING_CHI", "RESOLVING_PENG", "RESOLVING_KONG", "DRAWING_KONG_REPLACEMENT"].includes(phase)) throw new Error("牌局正在进行");
    if (phase === "POT_SETTLEMENT") return this.startNextPot();
    if (!this.tableProgress || !this.dealerDetermination?.finalOrder.length) return this.beginDealerDetermination();
    this.beginRound(this.tableProgress.dealerSeat);
  }

  private assertHost(playerId: string): void { if (playerId !== this.hostPlayerId) throw new Error("只有房主可以执行此操作"); }
  private waitingRound(): RoundRuntime { return { handNumber: 0, dealerSeat: -1, phase: "WAITING_FOR_PLAYERS", currentSeat: 0, wall: null, jokerIndicator: null, jokerType: null, wallRoll: null, wallBreak: null, lastAction: null, reactionWindow: null, settlement: null, version: 0, lastDrawWasReplacement: false, floorMultiplier: 1, dealerRuntime: null, outcome: null, liveWall: [], deadWall: [] }; }

  private beginDealerDetermination(): void {
    this.clearTimer(); this.dealerDetermination = { rolls: [], finalOrder: [] }; const pending = new Set(this.players.filter(Boolean).map((player) => player!.playerId)); if (!this.round) this.round = this.waitingRound();
    this.round.phase = "DETERMINING_DEALER"; this.round.dealerRuntime = { result: this.dealerDetermination, pendingPlayerIds: pending, currentRerollRound: 0 }; this.round.lastAction = { type: "determining-dealer" }; this.round.version += 1;
    this.emit("event", { type: "DETERMINING_DEALER", data: { message: "开始打庄" } }); this.startDealerTimeout(); this.emitState();
  }

  rollDice(playerId: string): void { const round = this.requireRound(); if (round.phase === "DETERMINING_DEALER") return this.rollDealerDice(playerId); if (round.phase === "ROLLING_FOR_WALL") return this.rollWallDice(playerId); throw new Error("当前不能掷骰"); }
  botRollDealerDice(playerId: string): void { this.rollDealerDice(playerId); } botRollWallDice(playerId: string): void { this.rollWallDice(playerId); }
  needsDealerRoll(playerId: string): boolean { return Boolean(this.round?.phase === "DETERMINING_DEALER" && this.round.dealerRuntime?.pendingPlayerIds.has(playerId)); }
  isWallRollPending(): boolean { return Boolean(this.round?.phase === "ROLLING_FOR_WALL" && !this.round.wallRoll); }

  private rollDealerDice(playerId: string): void {
    const round = this.requireRound(); const runtime = round.dealerRuntime; if (!runtime || !runtime.pendingPlayerIds.has(playerId)) throw new Error("该玩家当前无需掷骰");
    const dice1 = randomInt(1, 7); const dice2 = randomInt(1, 7); runtime.pendingPlayerIds.delete(playerId); runtime.result.rolls.push({ playerId, dice1, dice2, total: dice1 + dice2, rerollRound: runtime.currentRerollRound });
    round.lastAction = { type: "dealer-roll", playerId, dice1, dice2, total: dice1 + dice2, rerollRound: runtime.currentRerollRound }; round.version += 1; this.emit("event", { type: "DEALER_ROLL", data: { playerId, dice1, dice2, total: dice1 + dice2, rerollRound: runtime.currentRerollRound } });
    if (!runtime.pendingPlayerIds.size) this.resolveDealerDetermination(); else this.emitState();
  }

  private resolveDealerDetermination(): void {
    const round = this.requireRound(); const runtime = round.dealerRuntime; if (!runtime) return; const latest = new Map<string, DealerDeterminationResult["rolls"][number]>();
    for (const roll of runtime.result.rolls) latest.set(roll.playerId, roll); const groups = new Map<number, string[]>(); for (const [playerId, roll] of latest) groups.set(roll.total, [...(groups.get(roll.total) ?? []), playerId]);
    const tied = [...groups.values()].filter((ids) => ids.length > 1).flat();
    if (tied.length) { runtime.currentRerollRound += 1; runtime.pendingPlayerIds = new Set(tied); round.version += 1; this.emit("event", { type: "DEALER_REROLL", data: { playerIds: tied, rerollRound: runtime.currentRerollRound } }); this.startDealerTimeout(); this.emitState(); return; }
    const finalOrder = [...latest.values()].sort((a, b) => b.total - a.total).map((roll) => roll.playerId); runtime.result.finalOrder = finalOrder; this.dealerDetermination = runtime.result; finalOrder.forEach((playerId, seat) => { this.getPlayer(playerId).seat = seat; });
    this.tableProgress = { potNumber: 1, roundWind: "EAST", dealerPosition: 0, dealerSeat: 0, continuationCount: 0, totalHandsPlayed: 0 }; round.dealerRuntime = null; round.dealerSeat = 0; round.lastAction = { type: "dealer-determined", finalOrder }; round.version += 1; this.emit("event", { type: "DEALER_DETERMINED", data: this.dealerDetermination }); this.beginRound(0);
  }

  private beginRound(dealerSeat: number): void {
    this.clearTimer(); const progress = this.tableProgress; if (!progress) throw new Error("庄家尚未确定"); const wall = createMahjongWall(serverRandom); const floorMultiplier = this.rules.floorRule.enabled ? Math.max(1, this.nextFloorMultiplier) : 1;
    for (const player of this.players) if (player) { player.hand = []; player.melds = []; player.discards = []; player.roundsPlayed += 1; player.hasOpenedHand = false; player.hasChi = false; player.hasPeng = false; player.hasMingGang = false; player.isAutopilot = false; player.ready = false; }
    const currentHandNumber = progress.totalHandsPlayed + 1;
    this.round = { handNumber: currentHandNumber, dealerSeat, phase: "ROLLING_FOR_WALL", currentSeat: dealerSeat, wall, jokerIndicator: null, jokerType: null, wallRoll: null, wallBreak: null, lastAction: { type: "round-created", handNumber: currentHandNumber }, reactionWindow: null, settlement: null, version: (this.round?.version ?? 0) + 1, lastDrawWasReplacement: false, floorMultiplier, dealerRuntime: null, outcome: null, liveWall: [], deadWall: [] };
    // A floor multiplier is a property of the next hand. Keep it only when the
    // configured rule explicitly says it should survive another hand.
    this.nextFloorMultiplier = this.rules.floorRule.resetPolicy === "NEVER_RESET" ? floorMultiplier : 1;
    this.emit("event", { type: "ROUND_STARTED", data: { handNumber: currentHandNumber, dealerSeat, progress, floorMultiplier } }); this.emitState(); this.startWallRollTimeout();
  }

  private rollWallDice(playerId: string): void {
    const round = this.requireRound(); if (round.phase !== "ROLLING_FOR_WALL" || round.wallRoll || playerId !== this.getPlayerBySeat(round.dealerSeat).playerId) throw new Error("只有当前庄家可以开牌掷骰");
    const dice1 = randomInt(1, 7); const dice2 = randomInt(1, 7); const total = dice1 + dice2; round.wallRoll = { dice1, dice2, total }; if (!round.wall) throw new Error("牌墙不存在"); round.wallBreak = breakMahjongWall(round.wall, round.dealerSeat, dice1, dice2, this.rules.keepTailStacks);
    round.liveWall = remainingWallTiles(round.wall, "LIVE"); round.deadWall = remainingWallTiles(round.wall, "DEAD"); const indicator = revealJokerIndicator(round.wall); if (!indicator) throw new Error("混坯指示牌不存在"); round.deadWall.shift(); round.jokerIndicator = indicator.tile; round.jokerType = nextJokerType(indicator.tile.type); round.lastAction = { type: "wall-roll", playerId, dice1, dice2, total, targetSeat: round.wallBreak.targetSeat, breakStackIndex: round.wallBreak.breakStackIndex }; round.version += 1;
    this.emit("event", { type: "WALL_ROLL", data: { playerId, dice1, dice2, total, wallBreak: { ...round.wallBreak, firstDrawTileId: null }, indicatorPosition: indicator.position } }); this.dealInitialHands();
  }

  private dealInitialHands(): void {
    const round = this.requireRound(); if (!round.wall || !round.jokerIndicator || round.jokerType === null) throw new Error("开牌数据不完整"); round.phase = "DEALING";
    const steps: Array<{ playerId: string; count: number; positions: Array<Record<string, number | string>> }> = [];
    const drawBatch = (player: InternalPlayer, count: number) => { const positions: Array<Record<string, number | string>> = []; for (let i = 0; i < count; i += 1) { const drawn = drawNextTile(round.wall!); if (!drawn) throw new Error("发牌时牌墙不足"); round.liveWall.shift(); player.hand.push(drawn.tile); positions.push({ fromSide: drawn.position.sideIndex, stackIndex: drawn.position.stackIndex, layer: drawn.position.layer }); } steps.push({ playerId: player.playerId, count, positions }); };
    for (let batch = 0; batch < 3; batch += 1) for (let offset = 0; offset < 4; offset += 1) drawBatch(this.getPlayerBySeat((round.dealerSeat + offset) % 4), 4);
    for (let offset = 0; offset < 4; offset += 1) drawBatch(this.getPlayerBySeat((round.dealerSeat + offset) % 4), 1); drawBatch(this.getPlayerBySeat(round.dealerSeat), 1);
    for (const player of this.players) if (player) sortHand(player.hand); round.currentSeat = round.dealerSeat; round.phase = "WAITING_FOR_DISCARD"; round.lastAction = { type: "deal-complete", handNumber: round.handNumber }; round.version += 1;
    this.emit("event", { type: "DEAL_ANIMATION", data: { handNumber: round.handNumber, dealerSeat: round.dealerSeat, jokerIndicator: round.jokerIndicator, jokerType: round.jokerType, steps } }); this.emit("event", { type: "deal", data: { handNumber: round.handNumber, dealerSeat: round.dealerSeat, jokerIndicator: round.jokerIndicator, jokerType: round.jokerType } }); this.startActionTimer(); this.emitState();
  }

  discard(playerId: string, tileId: string, actionId: string, version: number): void {
    const round = this.requireRound(); this.assertVersion(version); if (round.phase !== "WAITING_FOR_DISCARD") throw new Error("当前不是出牌阶段"); const player = this.getPlayer(playerId); if (player.seat !== round.currentSeat) throw new Error("还没轮到你"); const tileIndex = player.hand.findIndex((tile) => tile.tileId === tileId); if (tileIndex < 0) throw new Error("这张牌不在你的手里"); const tile = player.hand[tileIndex]!; if (isJoker(tile.type, round.jokerType)) throw new Error("默认规则不允许主动打出混儿"); player.hand.splice(tileIndex, 1); player.discards.push(tile); player.isAutopilot = false; round.lastAction = { type: "discard", playerId, tileType: tile.type, actionId }; round.version += 1; this.clearTimer(); this.openReactionWindow(tile, player.seat, actionId);
  }

  reaction(playerId: string, payload: ReactionPayload): void {
    const round = this.requireRound(); this.assertVersion(payload.version); if (round.phase !== "WAITING_FOR_REACTIONS" || !round.reactionWindow) throw new Error("当前没有响应窗口"); const entry = round.reactionWindow.eligible.get(playerId); if (!entry) throw new Error("你不能响应这张牌"); if (entry.response) return; this.assertReactionLegal(playerId, entry, payload); entry.response = payload; this.emit("event", { type: "reaction-received", data: { playerId, kind: payload.kind } }); if ([...round.reactionWindow.eligible.values()].every((candidate) => candidate.response)) this.resolveReactionWindow(); else this.emitState();
  }

  kong(playerId: string, payload: { tileType: number; kongKind: "concealed" | "added"; actionId: string; version: number }): void {
    const round = this.requireRound(); this.assertVersion(payload.version); const player = this.getPlayer(playerId); if (round.phase !== "WAITING_FOR_DISCARD" || round.currentSeat !== player.seat) throw new Error("当前不能杠"); const type = tileType(payload.tileType); const legal = payload.kongKind === "concealed" ? canAnKong(player.hand.map((tile) => tile.type), round.jokerType).includes(type) : canAddKong(player.hand.map((tile) => tile.type), player.melds, round.jokerType).includes(type); if (!legal) throw new Error("非法杠牌"); this.clearTimer();
    if (payload.kongKind === "added") { const candidate = player.hand.find((tile) => tile.type === type); if (!candidate) throw new Error("补杠牌不在手里"); const eligible = new Map<string, ReactionEntry>(); for (const opponent of this.players) if (opponent && opponent.playerId !== playerId && this.canRon(opponent, type)) eligible.set(opponent.playerId, { playerId: opponent.playerId, legal: [{ kind: "hu" }, { kind: "pass" }] }); if (eligible.size) { round.phase = "WAITING_FOR_REACTIONS"; round.reactionWindow = { discard: candidate, discarderSeat: player.seat, eligible, deadline: Date.now() + this.rules.reactionTimeoutSeconds * 1000, source: "added-kong", kongActorId: playerId, actionId: payload.actionId }; round.version += 1; this.startReactionTimer(); this.emitState(); return; } }
    this.applyKong(player, type, payload.kongKind, undefined);
  }

  private applyKong(player: InternalPlayer, type: TileType, kongKind: "concealed" | "added" | "ming", claimed?: Tile): void {
    const round = this.requireRound();
    if (kongKind === "added") { const tileIndex = player.hand.findIndex((tile) => tile.type === type); if (tileIndex < 0) throw new Error("补杠牌不在手里"); const added = player.hand.splice(tileIndex, 1)[0]!; const meld = player.melds.find((candidate) => candidate.kind === "peng" && candidate.tiles[0]?.type === type); if (!meld) throw new Error("找不到可补杠的碰"); meld.kind = "add-kong"; meld.tiles.push(added); }
    else { const need = kongKind === "ming" ? 3 : 4; const taken = player.hand.filter((tile) => tile.type === type).slice(0, need); if (taken.length !== need) throw new Error("杠牌数量不足"); player.hand = player.hand.filter((tile) => !taken.includes(tile)); if (claimed) taken.push(claimed); player.melds.push({ id: id("meld"), kind: kongKind === "ming" ? "ming-kong" : "an-kong", tiles: taken, claimedTileType: claimed?.type, fromSeat: claimed ? round.reactionWindow?.discarderSeat : undefined }); if (kongKind === "ming") { player.hasOpenedHand = true; player.hasMingGang = true; } }
    round.lastAction = { type: "kong", playerId: player.playerId, kongType: kongKind, tileType: type }; round.phase = "DRAWING_KONG_REPLACEMENT"; round.reactionWindow = null; round.version += 1; this.emit("event", { type: "kong", data: { playerId: player.playerId, kongType: kongKind, tileType: type } }); this.drawReplacement(player);
  }

  private drawReplacement(player: InternalPlayer): void { const round = this.requireRound(); const drawn = round.wall ? drawReplacementTile(round.wall) : null; if (!drawn) return this.finishDrawRound(); round.deadWall.shift(); player.hand.push(drawn.tile); sortHand(player.hand); round.currentSeat = player.seat; round.lastDrawWasReplacement = true; round.phase = "WAITING_FOR_DISCARD"; round.lastAction = { type: "kong-replacement-draw", playerId: player.playerId, fromSide: drawn.position.sideIndex, stackIndex: drawn.position.stackIndex, layer: drawn.position.layer }; round.version += 1; this.emit("event", { type: "DRAW", data: { playerId: player.playerId, replacement: true, fromWallPosition: drawn.position } }); this.startActionTimer(); this.emitState(); }

  private openReactionWindow(tile: Tile, discarderSeat: number, actionId: string): void {
    const round = this.requireRound(); const eligible = new Map<string, ReactionEntry>();
    for (const candidate of this.players) { if (!candidate || candidate.seat === discarderSeat) continue; const legal: Array<Record<string, unknown>> = []; if (this.canRon(candidate, tile.type)) legal.push({ kind: "hu" }); if (canMingKong(candidate.hand.map((entry) => entry.type), tile.type, round.jokerType)) legal.push({ kind: "kong", kongKind: "ming" }); if (canPeng(candidate.hand.map((entry) => entry.type), tile.type, round.jokerType)) legal.push({ kind: "peng" }); if (seatDistance(discarderSeat, candidate.seat) === 1) for (const combination of chiCombinations(candidate.hand.map((entry) => entry.type), tile.type, round.jokerType)) legal.push({ kind: "chi", tileTypes: combination.tileTypes }); if (legal.length) { legal.push({ kind: "pass" }); eligible.set(candidate.playerId, { playerId: candidate.playerId, legal }); } }
    if (!eligible.size) return this.advanceToNextPlayer(discarderSeat); round.phase = "WAITING_FOR_REACTIONS"; round.reactionWindow = { discard: tile, discarderSeat, eligible, deadline: Date.now() + this.rules.reactionTimeoutSeconds * 1000, source: "discard", actionId }; round.version += 1; this.emit("event", { type: "reaction-window", data: { discard: tile, deadline: round.reactionWindow.deadline } }); this.startReactionTimer(); this.emitState();
  }

  private assertReactionLegal(playerId: string, entry: ReactionEntry, payload: ReactionPayload): void { const matches = (candidate: Record<string, unknown>) => candidate.kind === payload.kind && (payload.kind !== "chi" || JSON.stringify(candidate.tileTypes) === JSON.stringify(payload.tileTypes)); if (!entry.legal.some(matches)) throw new Error("服务器判定该动作不合法"); if (payload.kind === "chi") { const round = this.requireRound(); const player = this.getPlayer(playerId); if (!payload.tileTypes || payload.tileTypes.length !== 3 || !chiCombinations(player.hand.map((tile) => tile.type), round.reactionWindow!.discard.type, round.jokerType).some((combination) => JSON.stringify(combination.tileTypes) === JSON.stringify(payload.tileTypes))) throw new Error("非法吃牌组合"); } }

  private resolveReactionWindow(): void {
    const round = this.requireRound(); const window = round.reactionWindow; if (!window) return; this.clearTimer(); const resolved = ActionResolver.resolve({ discarderSeat: window.discarderSeat, multiHuPolicy: this.rules.multiHuPolicy, candidates: [...window.eligible.values()].map((entry) => ({ playerId: entry.playerId, seat: this.getPlayer(entry.playerId).seat, response: entry.response })) });
    if (resolved.hu.length) { const winner = resolved.hu[0]; if (winner) return this.finishWin(this.getPlayer(winner.playerId), false, window.discard, window.source === "added-kong" ? this.getPlayer(window.kongActorId!) : this.getPlayerBySeat(window.discarderSeat), false, window.source === "added-kong"); }
    if (window.source === "added-kong") { this.applyKong(this.getPlayer(window.kongActorId!), window.discard.type, "added"); return; }
    const selectedEntry = resolved.selected ? window.eligible.get(resolved.selected.playerId) : undefined; if (!selectedEntry?.response) return this.advanceToNextPlayer(window.discarderSeat); const selected = selectedEntry.response; const player = this.getPlayer(selectedEntry.playerId); const type = window.discard.type;
    if (selected.kind === "peng") { round.phase = "RESOLVING_PENG"; const taken = this.takeTilesByType(player, type, 2); taken.push(window.discard); this.removeDiscardedTile(this.getPlayerBySeat(window.discarderSeat), window.discard); player.melds.push({ id: id("meld"), kind: "peng", tiles: taken, claimedTileType: type, fromSeat: window.discarderSeat }); player.hasOpenedHand = true; player.hasPeng = true; round.currentSeat = player.seat; round.phase = "WAITING_FOR_DISCARD"; round.reactionWindow = null; round.lastAction = { type: "peng", playerId: player.playerId, tileType: type }; round.version += 1; this.emit("event", { type: "peng", data: { playerId: player.playerId, tileType: type } }); this.startActionTimer(); this.emitState(); return; }
    if (selected.kind === "kong") { round.phase = "RESOLVING_KONG"; this.removeDiscardedTile(this.getPlayerBySeat(window.discarderSeat), window.discard); this.applyKong(player, type, "ming", window.discard); return; }
    if (selected.kind === "chi") { round.phase = "RESOLVING_CHI"; const selectedTypes = selected.tileTypes as TileType[]; const needed = selectedTypes.filter((candidate) => candidate !== type); const taken: Tile[] = []; for (const neededType of needed) { const found = player.hand.find((tile) => tile.type === neededType && !taken.includes(tile)); if (!found) throw new Error("吃牌状态已变化"); taken.push(found); } taken.push(window.discard); this.removeDiscardedTile(this.getPlayerBySeat(window.discarderSeat), window.discard); player.hand = player.hand.filter((tile) => !taken.includes(tile)); player.melds.push({ id: id("meld"), kind: "chi", tiles: taken, claimedTileType: type, fromSeat: window.discarderSeat }); player.hasOpenedHand = true; player.hasChi = true; round.currentSeat = player.seat; round.phase = "WAITING_FOR_DISCARD"; round.reactionWindow = null; round.lastAction = { type: "chi", playerId: player.playerId, tileTypes: selectedTypes }; round.version += 1; this.emit("event", { type: "chi", data: { playerId: player.playerId, tileTypes: selectedTypes } }); this.startActionTimer(); this.emitState(); }
  }

  private takeTilesByType(player: InternalPlayer, type: TileType, amount: number): Tile[] { const taken = player.hand.filter((tile) => tile.type === type).slice(0, amount); if (taken.length !== amount) throw new Error("手牌数量不足"); player.hand = player.hand.filter((tile) => !taken.includes(tile)); return taken; }
  private removeDiscardedTile(player: InternalPlayer, tile: Tile): void { const index = player.discards.findIndex((candidate) => candidate.tileId === tile.tileId); if (index >= 0) player.discards.splice(index, 1); }
  private advanceToNextPlayer(fromSeat: number): void { const round = this.requireRound(); round.currentSeat = (fromSeat + 1) % 4; round.reactionWindow = null; this.drawForPlayer(this.getPlayerBySeat(round.currentSeat)); }
  private drawForPlayer(player: InternalPlayer): void { const round = this.requireRound(); const drawn = round.wall ? drawNextTile(round.wall) : null; if (!drawn) return this.finishDrawRound(); round.liveWall.shift(); player.hand.push(drawn.tile); sortHand(player.hand); round.phase = "WAITING_FOR_DISCARD"; round.lastDrawWasReplacement = false; round.lastAction = { type: "draw", playerId: player.playerId, fromSide: drawn.position.sideIndex, stackIndex: drawn.position.stackIndex, layer: drawn.position.layer }; round.version += 1; this.emit("event", { type: "DRAW", data: { playerId: player.playerId, replacement: false, fromWallPosition: drawn.position } }); this.startActionTimer(); this.emitState(); }

  hu(playerId: string, actionId: string, version: number): void { const round = this.requireRound(); this.assertVersion(version); const player = this.getPlayer(playerId); if (round.phase !== "WAITING_FOR_DISCARD" || round.currentSeat !== player.seat) throw new Error("当前不能自摸"); if (!this.canTsumo(player)) throw new Error("服务器判定不能胡"); this.finishWin(player, true, undefined, undefined, round.lastDrawWasReplacement, false, actionId); }

  private finishWin(winner: InternalPlayer, isSelfDraw: boolean, winningTile: Tile | undefined, discarder: InternalPlayer | undefined, gangShang: boolean, qiangGang: boolean, actionId?: string): void {
    const round = this.requireRound(); this.clearTimer(); if (!isSelfDraw && winningTile) { if (qiangGang && discarder) { const index = discarder.hand.findIndex((tile) => tile.tileId === winningTile.tileId); if (index >= 0) discarder.hand.splice(index, 1); } else if (discarder) this.removeDiscardedTile(discarder, winningTile); if (!winner.hand.some((tile) => tile.tileId === winningTile.tileId)) winner.hand.push(winningTile); sortHand(winner.hand); }
    const concealed = winner.hand.map((tile) => tile.type); const winning = analyzeHu({ concealed, openMelds: winner.melds, jokerType: round.jokerType, winningTileType: winningTile?.type, isSelfDraw }); if (!winning.isHu) throw new Error("服务器重新验算后不能胡");
    const allPlayers = this.players.filter((player): player is InternalPlayer => Boolean(player)).map((player) => ({ playerId: player.playerId, nickname: player.nickname, seat: player.seat, isDealer: player.seat === round.dealerSeat }));
    const score = calculateScore({ winnerId: winner.playerId, winnerName: winner.nickname, allPlayers, winnerSeat: winner.seat, dealerSeat: round.dealerSeat, concealed, openMelds: winner.melds, winning, jokerType: round.jokerType, winningTileType: winningTile?.type, isSelfDraw, discarderId: discarder?.playerId, isGangShangKaiHua: gangShang && isSelfDraw, isGangShangPao: Boolean(round.lastAction?.type === "discard" && round.lastDrawWasReplacement && !isSelfDraw), isQiangGang: qiangGang, isHaidi: round.wall ? wallRemaining(round.wall) === 0 : false, isHunGang: Boolean(round.jokerType && winner.melds.some((meld) => meld.tiles.every((tile) => tile.type === round.jokerType))), isDiao: winner.melds.length === 4 && winner.hand.length === 2, isTianHu: round.handNumber === 1 && round.lastAction?.type === "deal-complete" && winner.seat === round.dealerSeat, isDiHu: round.handNumber === 1 && !isSelfDraw && this.history.length === 0 && winner.seat !== round.dealerSeat, floorMultiplier: round.floorMultiplier }, this.rules);
    for (const player of this.players) if (player) player.score += score.deltas[player.playerId] ?? 0; if (discarder) discarder.discardCount += 1; winner.wins += 1; if (isSelfDraw) winner.selfDrawWins += 1; winner.maxSingleWin = Math.max(winner.maxSingleWin, score.winnerPoints); if (winner.seat === round.dealerSeat) winner.continuationWins += 1;
    const progression = this.tableProgress ? advanceTableProgress(this.tableProgress, { dealerWon: winner.seat === round.dealerSeat, draw: false, winnerSeat: winner.seat }) : null; if (progression) this.tableProgress = progression.progress; round.outcome = { winnerSeat: winner.seat, draw: false }; const potEnded = Boolean(progression?.potEnded);
    round.phase = potEnded ? "POT_SETTLEMENT" : "SETTLEMENT"; round.reactionWindow = null; for (const player of this.players) if (player) player.ready = player.playerType === "BOT"; round.settlement = { winnerId: winner.playerId, winnerName: winner.nickname, winning, score, players: this.players.filter((player): player is InternalPlayer => Boolean(player)).map((player) => ({ playerId: player.playerId, nickname: player.nickname, score: player.score })), potSummary: this.potSummary(), method: isSelfDraw ? "自摸" : "点炮", discarderId: discarder?.playerId ?? null, potEnded, progress: this.tableProgress }; round.lastAction = { type: "win", playerId: winner.playerId, actionId }; round.version += 1;
    this.history.push({ handNumber: round.handNumber, potNumber: this.tableProgress?.potNumber, roundWind: this.tableProgress?.roundWind, dealer: this.getPlayerBySeat(round.dealerSeat).nickname, winner: winner.nickname, winType: isSelfDraw ? "自摸" : "点炮", discarder: discarder?.nickname ?? null, patterns: score.breakdown, scoreChanges: score.deltas, timestamp: new Date().toISOString() }); if (this.rules.floorRule.resetPolicy === "RESET_ON_WIN") this.nextFloorMultiplier = 1; else this.nextFloorMultiplier = round.floorMultiplier; this.emit("event", { type: "win", data: round.settlement }); this.emit("settlement", round.settlement); this.emitState();
  }

  private finishDrawRound(): void { const round = this.requireRound(); this.clearTimer(); const progression = this.tableProgress ? advanceTableProgress(this.tableProgress, { dealerWon: true, draw: true }) : null; if (progression) this.tableProgress = progression.progress; if (this.rules.floorRule.enabled) this.nextFloorMultiplier = this.rules.floorRule.stackMode === "ACCUMULATE" ? round.floorMultiplier * this.rules.floorRule.multiplier : this.rules.floorRule.multiplier; else this.nextFloorMultiplier = 1; const potEnded = Boolean(progression?.potEnded); round.outcome = { draw: true }; round.phase = potEnded ? "POT_SETTLEMENT" : "SETTLEMENT"; for (const player of this.players) if (player) player.ready = player.playerType === "BOT"; round.lastAction = { type: "draw-round" }; round.settlement = { winnerId: null, winnerName: null, method: "荒庄", score: { deltas: Object.fromEntries(this.players.filter(Boolean).map((player) => [player!.playerId, 0])), breakdown: [] }, potSummary: this.potSummary(), potEnded, progress: this.tableProgress }; round.version += 1; this.history.push({ handNumber: round.handNumber, potNumber: this.tableProgress?.potNumber, roundWind: this.tableProgress?.roundWind, dealer: this.getPlayerBySeat(round.dealerSeat).nickname, winner: null, winType: "荒庄", scoreChanges: {}, timestamp: new Date().toISOString() }); this.emit("event", { type: "draw-round" }); this.emit("settlement", round.settlement); this.emitState(); }
  private startNextPot(): void { if (!this.tableProgress) throw new Error("牌局进度不存在"); if (this.rules.newPotScorePolicy === "RESET") for (const player of this.players) if (player) player.score = 0; this.tableProgress = { potNumber: this.tableProgress.potNumber + 1, roundWind: "EAST", dealerPosition: 0, dealerSeat: 0, continuationCount: 0, totalHandsPlayed: 0 }; this.round = { ...this.waitingRound(), phase: "NEXT_ROUND", dealerSeat: 0, version: (this.round?.version ?? 0) + 1 }; for (const player of this.players) if (player) player.ready = true; this.beginRound(0); }

  private canRon(player: InternalPlayer, winningTileType: TileType): boolean { const round = this.requireRound(); if (player.hasOpenedHand || (this.rules.threeJokerSelfDrawOnly && round.jokerType !== null && player.hand.filter((tile) => tile.type === round.jokerType).length >= 3)) return false; return analyzeHu({ concealed: [...player.hand.map((tile) => tile.type), winningTileType], openMelds: player.melds, jokerType: round.jokerType, winningTileType, isSelfDraw: false }).isHu; }
  private canTsumo(player: InternalPlayer): boolean { const round = this.requireRound(); const result = analyzeHu({ concealed: player.hand.map((tile) => tile.type), openMelds: player.melds, jokerType: round.jokerType, isSelfDraw: true }); const jokerCount = round.jokerType === null ? 0 : player.hand.filter((tile) => tile.type === round.jokerType).length; return result.isHu && !(this.rules.threeJokerSelfDrawOnly && jokerCount >= 4 && !this.rules.fourJokerAutoHu); }

  botTakeTurn(playerId: string, strategy: BotStrategy): void { const player = this.getPlayer(playerId); const round = this.requireRound(); if (player.playerType !== "BOT" || round.phase !== "WAITING_FOR_DISCARD" || round.currentSeat !== player.seat) return; const legal = this.legalActions(playerId); if (legal.some((action) => action.kind === "hu")) return this.hu(playerId, id("bot-hu"), round.version); const kong = legal.find((action) => action.kind === "kong"); if (kong && randomInt(0, 100) < 82) return this.kong(playerId, { tileType: Number(kong.tileType), kongKind: kong.kongKind as "concealed" | "added", actionId: id("bot-kong"), version: round.version }); const tileId = strategy.chooseDiscard({ hand: player.hand, melds: player.melds }, { jokerType: round.jokerType, legalActions: legal, visibleCounts: this.visibleCounts() }); if (!tileId) return this.finishDrawRound(); this.discard(playerId, tileId, id("bot-discard"), round.version); }
  botTakeReaction(playerId: string, strategy: BotStrategy): void { const round = this.requireRound(); const player = this.getPlayer(playerId); if (player.playerType !== "BOT" || round.phase !== "WAITING_FOR_REACTIONS") return; const legal = this.legalActions(playerId); if (!legal.length) return; const selected = strategy.chooseReaction({ hand: player.hand, melds: player.melds }, { jokerType: round.jokerType, legalActions: legal, visibleCounts: this.visibleCounts() }); this.reaction(playerId, { ...selected, version: round.version, actionId: id("bot-reaction") }); }
  reportBotError(error: unknown): void { this.emit("event", { type: "bot-error", data: { message: error instanceof Error ? error.message : String(error) } }); }

  legalActions(playerId: string): Array<Record<string, unknown>> {
    const round = this.round; const player = this.players.find((candidate) => candidate?.playerId === playerId); if (!round || !player) return [];
    if (round.phase === "DETERMINING_DEALER" && round.dealerRuntime?.pendingPlayerIds.has(playerId)) return [{ kind: "roll-dice" }]; if (round.phase === "ROLLING_FOR_WALL" && player.seat === round.dealerSeat && !round.wallRoll) return [{ kind: "roll-dice" }];
    if (round.phase === "WAITING_FOR_DISCARD" && round.currentSeat === player.seat) { const actions: Array<Record<string, unknown>> = [{ kind: "discard" }]; if (this.canTsumo(player)) actions.push({ kind: "hu" }); for (const type of canAnKong(player.hand.map((tile) => tile.type), round.jokerType)) actions.push({ kind: "kong", kongKind: "concealed", tileType: type }); for (const type of canAddKong(player.hand.map((tile) => tile.type), player.melds, round.jokerType)) actions.push({ kind: "kong", kongKind: "added", tileType: type }); return actions; }
    const entry = round.reactionWindow?.eligible.get(playerId); if (!entry || entry.response) return []; return entry.legal;
  }

  private visibleCounts(): number[] { const visible = Array<number>(34).fill(0); for (const player of this.players) if (player) { for (const tile of player.discards) visible[tile.type] = visible[tile.type]! + 1; for (const meld of player.melds) for (const tile of meld.tiles) visible[tile.type] = visible[tile.type]! + 1; } const indicator = this.round?.jokerIndicator; if (indicator) visible[indicator.type] = visible[indicator.type]! + 1; return visible; }
  private potSummary(): Array<Record<string, unknown>> { return this.players.filter((player): player is InternalPlayer => Boolean(player)).map((player) => ({ playerId: player.playerId, nickname: player.nickname, totalWins: player.wins, selfDrawWins: player.selfDrawWins, discardCount: player.discardCount, maxSingleWin: player.maxSingleWin, continuationWins: player.continuationWins, winRate: player.roundsPlayed ? Math.round(player.wins / player.roundsPlayed * 100) : 0, score: player.score })); }
  private tingFor(playerId: string): Array<Record<string, unknown>> { const round = this.round; const player = this.players.find((candidate) => candidate?.playerId === playerId); if (!round || !player || !this.rules.showTingHint || player.hand.length % 3 !== 1) return []; return calculateTing({ concealed: player.hand.map((tile) => tile.type), openMelds: player.melds, jokerType: round.jokerType, visibleCounts: this.visibleCounts(), jokerIndicator: round.jokerIndicator?.type ?? null }).map((result) => ({ ...result, tileType: result.tileType })); }

  serializeForPlayer(playerId: string): ClientStatePayload {
    const self = this.players.find((player) => player?.playerId === playerId) ?? null; const round = this.round; const reveal = round?.phase === "SETTLEMENT" || round?.phase === "POT_SETTLEMENT" || round?.phase === "ROUND_END";
    const players: PublicPlayerState[] = this.players.filter((player): player is InternalPlayer => Boolean(player)).sort((a, b) => a.seat - b.seat).map((player) => ({ playerId: player.playerId, nickname: player.nickname, seat: player.seat, connected: player.connected, ready: player.ready, hand: player.playerId === playerId || reveal ? player.hand.map(cloneTile) : undefined, handCount: player.hand.length, melds: player.melds.map((meld) => ({ ...meld, tiles: meld.tiles.map(cloneTile) })), discards: player.discards.map(cloneTile), score: player.score, wins: player.wins, roundsPlayed: player.roundsPlayed, discardCount: player.discardCount, selfDrawWins: player.selfDrawWins, maxSingleWin: player.maxSingleWin, continuationWins: player.continuationWins, isDealer: round?.dealerSeat === player.seat, isTurn: round?.currentSeat === player.seat && ["WAITING_FOR_DISCARD", "WAITING_FOR_REACTIONS"].includes(round.phase), hasOpenedHand: player.hasOpenedHand, isAutopilot: player.isAutopilot, voiceEnabled: player.voiceEnabled, playerType: player.playerType }));
    const publicRound: PublicRoundState | null = round ? { handNumber: round.handNumber, dealerSeat: round.dealerSeat, phase: round.phase, currentSeat: round.currentSeat, remainingTiles: round.wall ? wallRemaining(round.wall) : 0, jokerIndicator: round.jokerIndicator ? cloneTile(round.jokerIndicator) : null, jokerType: round.jokerType, lastAction: round.lastAction, reactionWindow: round.reactionWindow ? { discard: cloneTile(round.reactionWindow.discard), discarderSeat: round.reactionWindow.discarderSeat, eligiblePlayerIds: [...round.reactionWindow.eligible.keys()], deadline: round.reactionWindow.deadline } : null, settlement: round.settlement, version: round.version, floorMultiplier: round.floorMultiplier, progress: this.tableProgress, dealerDetermination: this.dealerDetermination, wallBreak: round.wallBreak ? { ...round.wallBreak, firstDrawTileId: null } : null, wallRoll: round.wallRoll, wall: round.wall ? serializeWall(round.wall) : null } : null;
    return { room: { roomId: this.roomId, hostPlayerId: this.hostPlayerId, players, round: publicRound, rules: this.rules, history: this.history.slice(-50) }, self: players.find((player) => player.playerId === playerId) ?? null, legalActions: this.legalActions(playerId), ting: this.tingFor(playerId) };
  }

  private startActionTimer(): void { this.clearTimer(); const round = this.requireRound(); this.timer = setTimeout(() => { try { const current = this.requireRound(); const player = this.getPlayerBySeat(current.currentSeat); player.isAutopilot = true; if (this.canTsumo(player)) this.hu(player.playerId, id("timeout"), current.version); else { const candidate = [...player.hand].reverse().find((tile) => !isJoker(tile.type, current.jokerType)); if (candidate) this.discard(player.playerId, candidate.tileId, id("timeout"), current.version); else this.finishDrawRound(); } } catch (error) { this.emit("event", { type: "timeout-error", data: { message: error instanceof Error ? error.message : "timeout" } }); } }, this.rules.actionTimeoutSeconds * 1000); if (round.phase === "WAITING_FOR_DISCARD" && this.getPlayerBySeat(round.currentSeat).playerType === "BOT") this.clearTimer(); }
  private startReactionTimer(): void { this.clearTimer(); this.timer = setTimeout(() => { try { const round = this.requireRound(); if (!round.reactionWindow) return; for (const entry of round.reactionWindow.eligible.values()) if (!entry.response) entry.response = { actionId: id("timeout"), version: round.version, kind: "pass" }; this.resolveReactionWindow(); } catch (error) { this.emit("event", { type: "timeout-error", data: { message: error instanceof Error ? error.message : "timeout" } }); } }, this.rules.reactionTimeoutSeconds * 1000); }
  private startDealerTimeout(): void { this.clearTimer(); this.timer = setTimeout(() => { try { const round = this.requireRound(); for (const playerId of round.dealerRuntime?.pendingPlayerIds ?? []) if (this.getPlayer(playerId).playerType === "HUMAN") this.rollDealerDice(playerId); } catch (error) { this.reportBotError(error); } }, 10_000); }
  private startWallRollTimeout(): void { this.clearTimer(); this.timer = setTimeout(() => { try { const round = this.requireRound(); if (round.phase === "ROLLING_FOR_WALL" && !round.wallRoll) this.rollWallDice(this.getPlayerBySeat(round.dealerSeat).playerId); } catch (error) { this.reportBotError(error); } }, 10_000); }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  disconnect(playerId: string, socketId?: string): void { const player = this.getPlayer(playerId); if (player.playerType === "BOT" || (socketId && player.socketId !== socketId)) return; player.connected = false; player.socketId = undefined; player.lastSeenAt = Date.now(); player.isAutopilot = true; this.emit("disconnected", { playerId, nickname: player.nickname }); this.emitState(); }
  reconnect(playerId: string, reconnectToken: string, socketId: string): InternalPlayer { const player = this.getPlayer(playerId); if (player.playerType !== "HUMAN" || player.reconnectToken !== reconnectToken) throw new Error("重连凭证无效"); player.connected = true; player.socketId = socketId; player.isAutopilot = false; player.lastSeenAt = Date.now(); this.emit("reconnected", { playerId, nickname: player.nickname }); this.emitState(); return player; }
  removePlayer(playerId: string): void { const index = this.players.findIndex((player) => player?.playerId === playerId); if (index >= 0) { const wasHost = this.hostPlayerId === playerId; this.players[index] = null; if (wasHost) this.hostPlayerId = this.players.find((player) => player?.playerType === "HUMAN")?.playerId ?? ""; } this.emitState(); }
  setVoiceEnabled(playerId: string, enabled: boolean): void { if (!this.rules.enableVoiceChat && enabled) throw new Error("房主已关闭语音"); this.getPlayer(playerId).voiceEnabled = enabled; this.emitState(); }
  assertVersion(version: number): void { const round = this.requireRound(); if (version !== round.version) throw new Error("牌局状态已更新，请刷新操作"); }
  requireRound(): RoundRuntime { if (!this.round) throw new Error("牌局尚未开始"); return this.round; }
  emitState(): void { if (!this.destroyed) { this.emit("state", this); this.botController.schedule(this); } }
  destroy(): void { this.destroyed = true; this.clearTimer(); this.botController.clear(); this.removeAllListeners(); }
}
