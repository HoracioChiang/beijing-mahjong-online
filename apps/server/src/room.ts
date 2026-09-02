import { randomBytes, randomInt } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  analyzeHu, BeijingDefaultRules, calculateScore, calculateTing, canAddKong, canAnKong, canMingKong, canPeng, chiCombinations, cloneRules, createWall, isJoker, nextJokerType, tileCounts, tileType, type Meld, type RuleConfig, type Tile, type TileType
} from "@beijing-mahjong/mahjong-core";
import type { ClientStatePayload, PublicPlayerState, PublicRoomState, PublicRoundState, ReactionPayload } from "@beijing-mahjong/shared";
import { ActionResolver } from "./action-resolver.js";

export interface InternalPlayer {
  playerId: string;
  nickname: string;
  reconnectToken: string;
  socketId?: string;
  seat: number;
  connected: boolean;
  ready: boolean;
  hand: Tile[];
  melds: Meld[];
  discards: Tile[];
  score: number;
  wins: number;
  roundsPlayed: number;
  discardCount: number;
  hasOpenedHand: boolean;
  hasChi: boolean;
  hasPeng: boolean;
  hasMingGang: boolean;
  isAutopilot: boolean;
  voiceEnabled: boolean;
  lastSeenAt: number;
}

interface ReactionEntry { playerId: string; legal: Array<Record<string, unknown>>; response?: ReactionPayload; }
interface ReactionWindow {
  discard: Tile;
  discarderSeat: number;
  eligible: Map<string, ReactionEntry>;
  deadline: number;
  source: "discard" | "added-kong";
  kongActorId?: string;
  actionId: string;
}

interface RoundRuntime {
  handNumber: number;
  dealerSeat: number;
  phase: PublicRoundState["phase"];
  currentSeat: number;
  liveWall: Tile[];
  deadWall: Tile[];
  jokerIndicator: Tile;
  jokerType: TileType;
  lastAction: Record<string, unknown> | null;
  reactionWindow: ReactionWindow | null;
  settlement: unknown | null;
  version: number;
  lastDrawWasReplacement: boolean;
  floorMultiplier: number;
}

export interface RoomEvents {
  state: (room: GameRoom) => void;
  event: (type: string, data?: unknown) => void;
}

const id = (prefix: string) => `${prefix}_${randomBytes(12).toString("hex")}`;
const cloneTile = (tile: Tile): Tile => ({ ...tile });
const seatDistance = (from: number, to: number) => (to - from + 4) % 4;

export class GameRoom extends EventEmitter {
  readonly roomId: string;
  hostPlayerId: string;
  readonly players: Array<InternalPlayer | null> = [null, null, null, null];
  readonly history: Array<Record<string, unknown>> = [];
  readonly rules: RuleConfig;
  round: RoundRuntime | null = null;
  private timer: NodeJS.Timeout | undefined;
  private destroyed = false;
  private nextFloorMultiplier = 1;

  constructor(roomId: string, hostPlayerId: string, rules: RuleConfig = BeijingDefaultRules) {
    super();
    this.roomId = roomId;
    this.hostPlayerId = hostPlayerId;
    this.rules = cloneRules(rules);
  }

  addPlayer(nickname: string, identity?: { playerId: string; reconnectToken: string }, socketId?: string): InternalPlayer {
    if (this.round && this.round.phase !== "WAITING_FOR_PLAYERS" && this.round.phase !== "READY" && !identity) throw new Error("本局已经开始，不能加入新玩家");
    const normalized = nickname.trim().slice(0, 20);
    if (!normalized) throw new Error("昵称不能为空");
    const existing = identity ? this.players.find((player) => player?.playerId === identity.playerId && player.reconnectToken === identity.reconnectToken) : this.players.find((player) => player?.nickname === normalized && !player.connected);
    if (existing) {
      existing.socketId = socketId;
      existing.connected = true;
      existing.lastSeenAt = Date.now();
      existing.nickname = normalized;
      existing.isAutopilot = false;
      this.emit("reconnected", { playerId: existing.playerId, nickname: existing.nickname });
      this.emitState();
      return existing;
    }
    const seat = this.players.findIndex((player) => player === null);
    if (seat < 0) throw new Error("房间已满");
    if (this.round && this.round.phase !== "WAITING_FOR_PLAYERS" && this.round.phase !== "READY") throw new Error("游戏已经开始，不能加入新玩家");
    const player: InternalPlayer = { playerId: identity?.playerId ?? id("player"), nickname: normalized, reconnectToken: identity?.reconnectToken ?? randomBytes(24).toString("base64url"), socketId, seat, connected: true, ready: false, hand: [], melds: [], discards: [], score: 0, wins: 0, roundsPlayed: 0, discardCount: 0, hasOpenedHand: false, hasChi: false, hasPeng: false, hasMingGang: false, isAutopilot: false, voiceEnabled: false, lastSeenAt: Date.now() };
    this.players[seat] = player;
    if (!this.round) this.round = { handNumber: 0, dealerSeat: -1, phase: "WAITING_FOR_PLAYERS", currentSeat: 0, liveWall: [], deadWall: [], jokerIndicator: player.hand[0] ?? ({ tileId: "none", type: tileType(0) }), jokerType: tileType(0), lastAction: null, reactionWindow: null, settlement: null, version: 0, lastDrawWasReplacement: false, floorMultiplier: 1 };
    this.emitState();
    return player;
  }

  getPlayer(playerId: string): InternalPlayer {
    const player = this.players.find((candidate) => candidate?.playerId === playerId);
    if (!player) throw new Error("玩家不在房间内");
    return player;
  }

  getPlayerBySocket(socketId: string): InternalPlayer | undefined { return this.players.find((player): player is InternalPlayer => Boolean(player?.socketId === socketId && player.connected)); }
  playerCount(): number { return this.players.filter(Boolean).length; }
  activeCount(): number { return this.players.filter((player) => player?.connected).length; }

  setReady(playerId: string, ready: boolean): void {
    const player = this.getPlayer(playerId);
    if (this.round && !["WAITING_FOR_PLAYERS", "READY", "SETTLEMENT", "NEXT_ROUND"].includes(this.round.phase)) throw new Error("本局进行中不能修改准备状态");
    player.ready = ready;
    this.emitState();
    if (ready && (this.rules.autoStart || this.round?.phase === "SETTLEMENT" || this.round?.phase === "NEXT_ROUND") && this.playerCount() === 4 && this.players.every((candidate) => candidate?.ready)) this.startGame(this.hostPlayerId);
  }

  startGame(requesterId: string): void {
    if (requesterId !== this.hostPlayerId) throw new Error("只有房主可以开始");
    if (this.playerCount() !== 4 || !this.players.every((player) => player?.ready)) throw new Error("需要四位玩家全部准备");
    if (this.round && !["WAITING_FOR_PLAYERS", "READY", "SETTLEMENT", "NEXT_ROUND"].includes(this.round.phase)) throw new Error("牌局正在进行");
    if (!this.round || this.round.dealerSeat < 0) {
      this.beginRound(randomInt(0, 4));
    } else {
      const previousWinner = this.round.settlement as { winnerId?: string } | null;
      const winner = previousWinner?.winnerId ? this.players.find((player) => player?.playerId === previousWinner.winnerId) : null;
      const wasDraw = this.round.lastAction?.type === "draw-round";
      const dealer = wasDraw || winner?.seat === this.round.dealerSeat ? this.round.dealerSeat : (this.round.dealerSeat + 1) % 4;
      this.beginRound(dealer);
    }
  }

  private beginRound(dealerSeat: number): void {
    this.clearTimer();
    const wall = createWall();
    const dealt = wall.splice(0, 53);
    this.players.forEach((player) => { if (player) { player.hand = []; player.melds = []; player.discards = []; player.roundsPlayed += 1; player.hasOpenedHand = false; player.hasChi = false; player.hasPeng = false; player.hasMingGang = false; player.isAutopilot = false; player.ready = false; } });
    const dealer = this.players[dealerSeat];
    if (!dealer) throw new Error("庄家座位无玩家");
    let cursor = 0;
    dealer.hand = dealt.slice(cursor, cursor + 14); cursor += 14;
    for (let seat = 1; seat < 4; seat += 1) {
      const player = this.players[(dealerSeat + seat) % 4];
      if (player) { player.hand = dealt.slice(cursor, cursor + 13); cursor += 13; }
    }
    for (const player of this.players) player?.hand.sort((a, b) => a.type - b.type || a.tileId.localeCompare(b.tileId));
    const indicator = wall.shift();
    if (!indicator) throw new Error("牌墙不足");
    const reserve = this.rules.keepTailStacks * 2;
    const deadWall = wall.splice(Math.max(0, wall.length - reserve), reserve);
    const currentHandNumber = (this.round?.handNumber ?? 0) + 1;
    this.round = { handNumber: currentHandNumber, dealerSeat, phase: "DEALING", currentSeat: dealerSeat, liveWall: wall, deadWall, jokerIndicator: indicator, jokerType: nextJokerType(indicator.type), lastAction: { type: "deal", handNumber: currentHandNumber }, reactionWindow: null, settlement: null, version: (this.round?.version ?? 0) + 1, lastDrawWasReplacement: false, floorMultiplier: this.nextFloorMultiplier };
    this.nextFloorMultiplier = 1;
    this.emit("event", { type: "ROUND_STARTED", data: { handNumber: currentHandNumber, dealerSeat } });
    this.emit("event", { type: "DEAL_ANIMATION", data: { handNumber: currentHandNumber, dealerSeat, jokerIndicator: indicator, jokerType: this.round.jokerType } });
    this.emit("event", { type: "deal", data: { handNumber: currentHandNumber, dealerSeat, jokerIndicator: indicator, jokerType: this.round.jokerType } });
    this.round.phase = "WAITING_FOR_DISCARD";
    this.round.lastAction = { type: "deal-complete", handNumber: currentHandNumber };
    this.round.version += 1;
    this.startActionTimer();
    this.emitState();
  }

  discard(playerId: string, tileId: string, actionId: string, version: number): void {
    const round = this.requireRound();
    this.assertVersion(version);
    if (round.phase !== "WAITING_FOR_DISCARD") throw new Error("当前不是出牌阶段");
    const player = this.getPlayer(playerId);
    if (player.seat !== round.currentSeat) throw new Error("还没轮到你");
    const tileIndex = player.hand.findIndex((tile) => tile.tileId === tileId);
    if (tileIndex < 0) throw new Error("这张牌不在你的手里");
    const tile = player.hand[tileIndex]!;
    if (isJoker(tile.type, round.jokerType)) throw new Error("默认规则不允许主动打出混儿");
    player.hand.splice(tileIndex, 1);
    player.discards.push(tile);
    player.isAutopilot = false;
    round.lastAction = { type: "discard", playerId, tile, actionId };
    round.version += 1;
    this.clearTimer();
    this.openReactionWindow(tile, player.seat, actionId);
  }

  reaction(playerId: string, payload: ReactionPayload): void {
    const round = this.requireRound();
    this.assertVersion(payload.version);
    if (round.phase !== "WAITING_FOR_REACTIONS" || !round.reactionWindow) throw new Error("当前没有响应窗口");
    const entry = round.reactionWindow.eligible.get(playerId);
    if (!entry) throw new Error("你不能响应这张牌");
    if (entry.response) return;
    this.assertReactionLegal(playerId, entry, payload);
    entry.response = payload;
    this.emit("event", { type: "reaction-received", data: { playerId, kind: payload.kind } });
    if ([...round.reactionWindow.eligible.values()].every((candidate) => candidate.response)) this.resolveReactionWindow();
    else this.emitState();
  }

  kong(playerId: string, payload: { tileType: number; kongKind: "concealed" | "added"; actionId: string; version: number }): void {
    const round = this.requireRound();
    this.assertVersion(payload.version);
    if (round.phase !== "WAITING_FOR_DISCARD" || round.currentSeat !== this.getPlayer(playerId).seat) throw new Error("当前不能杠");
    const player = this.getPlayer(playerId);
    const type = tileType(payload.tileType);
    const legal = payload.kongKind === "concealed" ? canAnKong(player.hand.map((tile) => tile.type), round.jokerType).includes(type) : canAddKong(player.hand.map((tile) => tile.type), player.melds, round.jokerType).includes(type);
    if (!legal) throw new Error("非法杠牌");
    this.clearTimer();
    if (payload.kongKind === "added") {
      const candidate = player.hand.find((tile) => tile.type === type);
      if (!candidate) throw new Error("补杠牌不在手里");
      const eligible = new Map<string, ReactionEntry>();
      for (const opponent of this.players) {
        if (!opponent || opponent.playerId === playerId) continue;
        const canRon = this.canRon(opponent, type);
        if (canRon) eligible.set(opponent.playerId, { playerId: opponent.playerId, legal: [{ kind: "hu" }, { kind: "pass" }] });
      }
      if (eligible.size) {
        round.phase = "WAITING_FOR_REACTIONS";
        round.reactionWindow = { discard: candidate, discarderSeat: player.seat, eligible, deadline: Date.now() + this.rules.reactionTimeoutSeconds * 1000, source: "added-kong", kongActorId: playerId, actionId: payload.actionId };
        round.version += 1;
        this.startReactionTimer();
        this.emitState();
        return;
      }
    }
    this.applyKong(player, type, payload.kongKind, undefined);
  }

  private applyKong(player: InternalPlayer, type: TileType, kongKind: "concealed" | "added" | "ming", claimed?: Tile): void {
    const round = this.requireRound();
    if (kongKind === "added") {
      const tileIndex = player.hand.findIndex((tile) => tile.type === type);
      if (tileIndex < 0) throw new Error("补杠牌不在手里");
      const added = player.hand.splice(tileIndex, 1)[0]!;
      const meld = player.melds.find((candidate) => candidate.kind === "peng" && candidate.tiles[0]?.type === type);
      if (!meld) throw new Error("找不到可补杠的碰");
      meld.kind = "add-kong"; meld.tiles.push(added);
    } else {
      const need = kongKind === "ming" ? 3 : 4;
      const taken: Tile[] = [];
      for (const tile of player.hand) if (tile.type === type && taken.length < need) taken.push(tile);
      if (taken.length !== need) throw new Error("杠牌数量不足");
      player.hand = player.hand.filter((tile) => !taken.includes(tile));
      if (claimed) taken.push(claimed);
      player.melds.push({ id: id("meld"), kind: kongKind === "ming" ? "ming-kong" : "an-kong", tiles: taken, claimedTileType: claimed?.type, fromSeat: claimed ? round.reactionWindow?.discarderSeat : undefined });
      if (kongKind === "ming") { player.hasOpenedHand = true; player.hasMingGang = true; }
    }
    round.lastAction = { type: "kong", playerId: player.playerId, kongType: kongKind, tileType: type };
    round.phase = "DRAWING_KONG_REPLACEMENT";
    round.reactionWindow = null;
    round.version += 1;
    this.emit("event", { type: "kong", data: { playerId: player.playerId, kongType: kongKind, tileType: type } });
    this.drawReplacement(player);
  }

  private drawReplacement(player: InternalPlayer): void {
    const round = this.requireRound();
    const tile = round.deadWall.pop();
    if (!tile) return this.finishDrawRound();
    player.hand.push(tile); player.hand.sort((a, b) => a.type - b.type || a.tileId.localeCompare(b.tileId));
    round.currentSeat = player.seat; round.lastDrawWasReplacement = true; round.phase = "WAITING_FOR_DISCARD"; round.lastAction = { type: "kong-replacement-draw", playerId: player.playerId, tileId: tile.tileId }; round.version += 1;
    this.emit("event", { type: "draw", data: { playerId: player.playerId, replacement: true } });
    this.startActionTimer(); this.emitState();
  }

  private openReactionWindow(tile: Tile, discarderSeat: number, actionId: string): void {
    const round = this.requireRound();
    const eligible = new Map<string, ReactionEntry>();
    for (const candidate of this.players) {
      if (!candidate || candidate.seat === discarderSeat) continue;
      const legal: Array<Record<string, unknown>> = [];
      if (this.canRon(candidate, tile.type)) legal.push({ kind: "hu" });
      if (canMingKong(candidate.hand.map((entry) => entry.type), tile.type, round.jokerType)) legal.push({ kind: "kong", kongKind: "ming" });
      if (canPeng(candidate.hand.map((entry) => entry.type), tile.type, round.jokerType)) legal.push({ kind: "peng" });
      if (seatDistance(discarderSeat, candidate.seat) === 1) {
        for (const combination of chiCombinations(candidate.hand.map((entry) => entry.type), tile.type, round.jokerType)) legal.push({ kind: "chi", tileTypes: combination.tileTypes });
      }
      if (legal.length) { legal.push({ kind: "pass" }); eligible.set(candidate.playerId, { playerId: candidate.playerId, legal }); }
    }
    if (eligible.size === 0) return this.advanceToNextPlayer(discarderSeat);
    round.phase = "WAITING_FOR_REACTIONS";
    round.reactionWindow = { discard: tile, discarderSeat, eligible, deadline: Date.now() + this.rules.reactionTimeoutSeconds * 1000, source: "discard", actionId };
    round.version += 1;
    this.emit("event", { type: "reaction-window", data: { discard: tile, deadline: round.reactionWindow.deadline } });
    this.startReactionTimer(); this.emitState();
  }

  private assertReactionLegal(playerId: string, entry: ReactionEntry, payload: ReactionPayload): void {
    const isSame = (candidate: Record<string, unknown>) => candidate.kind === payload.kind && (payload.kind !== "chi" || JSON.stringify(candidate.tileTypes) === JSON.stringify(payload.tileTypes));
    if (!entry.legal.some(isSame)) throw new Error("服务器判定该动作不合法");
    if (payload.kind === "chi") {
      const round = this.requireRound();
      const player = this.getPlayer(playerId);
      if (!payload.tileTypes || payload.tileTypes.length !== 3 || !chiCombinations(player.hand.map((tile) => tile.type), round.reactionWindow!.discard.type, round.jokerType).some((combination) => JSON.stringify(combination.tileTypes) === JSON.stringify(payload.tileTypes))) throw new Error("非法吃牌组合");
    }
  }

  private resolveReactionWindow(): void {
    const round = this.requireRound();
    const window = round.reactionWindow;
    if (!window) return;
    this.clearTimer();
    const resolved = ActionResolver.resolve({ discarderSeat: window.discarderSeat, multiHuPolicy: this.rules.multiHuPolicy, candidates: [...window.eligible.values()].map((entry) => ({ playerId: entry.playerId, seat: this.getPlayer(entry.playerId).seat, response: entry.response })) });
    if (resolved.hu.length && window.source === "discard") {
      const nearest = resolved.hu[0];
      if (nearest) return this.finishWin(this.getPlayer(nearest.playerId), false, window.discard, this.getPlayerBySeat(window.discarderSeat), false, false);
    }
    if (resolved.hu.length && window.source === "added-kong") {
      const winner = resolved.hu[0];
      if (winner) return this.finishWin(this.getPlayer(winner.playerId), false, window.discard, this.getPlayer(window.kongActorId!), false, true);
    }
    if (window.source === "added-kong") {
      const actor = this.getPlayer(window.kongActorId!);
      this.applyKong(actor, window.discard.type, "added");
      return;
    }
    const selectedEntry = resolved.selected ? window.eligible.get(resolved.selected.playerId) : undefined;
    if (!selectedEntry || !selectedEntry.response) return this.advanceToNextPlayer(window.discarderSeat);
    const selected = selectedEntry.response; const player = this.getPlayer(selectedEntry.playerId); const type = window.discard.type;
    if (selected.kind === "peng") {
      round.phase = "RESOLVING_PENG";
      const taken = this.takeTilesByType(player, type, 2); taken.push(window.discard); this.removeDiscardedTile(this.getPlayerBySeat(window.discarderSeat), window.discard); player.melds.push({ id: id("meld"), kind: "peng", tiles: taken, claimedTileType: type, fromSeat: window.discarderSeat }); player.hasOpenedHand = true; player.hasPeng = true; round.currentSeat = player.seat; round.phase = "WAITING_FOR_DISCARD"; round.reactionWindow = null; round.lastAction = { type: "peng", playerId: player.playerId, tile: window.discard }; round.version += 1; this.emit("event", { type: "peng", data: { playerId: player.playerId } }); this.startActionTimer(); this.emitState(); return;
    }
    if (selected.kind === "kong") { round.phase = "RESOLVING_KONG"; this.removeDiscardedTile(this.getPlayerBySeat(window.discarderSeat), window.discard); this.applyKong(player, type, "ming", window.discard); return; }
    if (selected.kind === "chi") {
      round.phase = "RESOLVING_CHI";
      const selectedTypes = selected.tileTypes as TileType[]; const needed = selectedTypes.filter((candidate) => candidate !== type); const taken: Tile[] = []; for (const neededType of needed) { const found = player.hand.find((tile) => tile.type === neededType && !taken.includes(tile)); if (!found) throw new Error("吃牌状态已变化"); taken.push(found); } taken.push(window.discard); this.removeDiscardedTile(this.getPlayerBySeat(window.discarderSeat), window.discard); player.hand = player.hand.filter((tile) => !taken.includes(tile)); player.melds.push({ id: id("meld"), kind: "chi", tiles: taken, claimedTileType: type, fromSeat: window.discarderSeat }); player.hasOpenedHand = true; player.hasChi = true; round.currentSeat = player.seat; round.phase = "WAITING_FOR_DISCARD"; round.reactionWindow = null; round.lastAction = { type: "chi", playerId: player.playerId, tileTypes: selectedTypes }; round.version += 1; this.emit("event", { type: "chi", data: { playerId: player.playerId, tileTypes: selectedTypes } }); this.startActionTimer(); this.emitState(); return;
    }
  }

  private takeTilesByType(player: InternalPlayer, type: TileType, amount: number): Tile[] { const taken = player.hand.filter((tile) => tile.type === type).slice(0, amount); if (taken.length !== amount) throw new Error("手牌数量不足"); player.hand = player.hand.filter((tile) => !taken.includes(tile)); return taken; }
  private removeDiscardedTile(player: InternalPlayer, tile: Tile): void { const index = player.discards.findIndex((candidate) => candidate.tileId === tile.tileId); if (index >= 0) player.discards.splice(index, 1); }

  private advanceToNextPlayer(fromSeat: number): void { const round = this.requireRound(); const nextSeat = (fromSeat + 1) % 4; round.currentSeat = nextSeat; round.reactionWindow = null; this.drawForPlayer(this.getPlayerBySeat(nextSeat)); }

  private drawForPlayer(player: InternalPlayer): void {
    const round = this.requireRound();
    if (round.liveWall.length === 0) return this.finishDrawRound();
    const tile = round.liveWall.shift()!; player.hand.push(tile); player.hand.sort((a, b) => a.type - b.type || a.tileId.localeCompare(b.tileId)); round.phase = "WAITING_FOR_DISCARD"; round.lastDrawWasReplacement = false; round.lastAction = { type: "draw", playerId: player.playerId, tileId: tile.tileId }; round.version += 1; this.emit("event", { type: "draw", data: { playerId: player.playerId, replacement: false } }); this.startActionTimer(); this.emitState();
  }

  hu(playerId: string, actionId: string, version: number): void {
    const round = this.requireRound(); this.assertVersion(version); const player = this.getPlayer(playerId); if (round.phase !== "WAITING_FOR_DISCARD" || round.currentSeat !== player.seat) throw new Error("当前不能自摸");
    if (!this.canTsumo(player)) throw new Error("服务器判定不能胡");
    this.finishWin(player, true, undefined, undefined, round.lastDrawWasReplacement, false, actionId);
  }

  private finishWin(winner: InternalPlayer, isSelfDraw: boolean, winningTile: Tile | undefined, discarder: InternalPlayer | undefined, gangShang: boolean, qiangGang: boolean, actionId?: string): void {
    const round = this.requireRound(); this.clearTimer();
    if (!isSelfDraw && winningTile) {
      if (qiangGang && discarder) {
        const index = discarder.hand.findIndex((tile) => tile.tileId === winningTile.tileId); if (index >= 0) discarder.hand.splice(index, 1);
      } else if (discarder) this.removeDiscardedTile(discarder, winningTile);
      if (!winner.hand.some((tile) => tile.tileId === winningTile.tileId)) winner.hand.push(winningTile);
      winner.hand.sort((a, b) => a.type - b.type || a.tileId.localeCompare(b.tileId));
    }
    const concealed = winner.hand.map((tile) => tile.type);
    const winning = analyzeHu({ concealed, openMelds: winner.melds, jokerType: round.jokerType, winningTileType: winningTile?.type, isSelfDraw });
    if (!winning.isHu) throw new Error("服务器重新验算后不能胡");
    const allPlayers = this.players.filter((player): player is InternalPlayer => Boolean(player)).map((player) => ({ playerId: player.playerId, nickname: player.nickname, seat: player.seat, isDealer: player.seat === round.dealerSeat }));
    const score = calculateScore({ winnerId: winner.playerId, winnerName: winner.nickname, allPlayers, winnerSeat: winner.seat, dealerSeat: round.dealerSeat, concealed, openMelds: winner.melds, winning, jokerType: round.jokerType, winningTileType: winningTile?.type, isSelfDraw, discarderId: discarder?.playerId, isGangShangKaiHua: gangShang && isSelfDraw, isGangShangPao: Boolean(round.lastAction?.type === "discard" && round.lastDrawWasReplacement && !isSelfDraw), isQiangGang: qiangGang, isHaidi: round.liveWall.length === 0, isHunGang: Boolean(round.jokerType && winner.melds.some((meld) => meld.tiles.every((tile) => tile.type === round.jokerType))), isDiao: winner.melds.length === 4 && winner.hand.length === 2, isTianHu: round.handNumber === 1 && round.lastAction?.type === "deal-complete" && winner.seat === round.dealerSeat, isDiHu: round.handNumber === 1 && !isSelfDraw && this.history.length === 0 && winner.seat !== round.dealerSeat, floorMultiplier: round.floorMultiplier }, this.rules);
    for (const player of this.players) if (player) player.score += score.deltas[player.playerId] ?? 0;
    if (discarder) discarder.discardCount += 1;
    winner.wins += 1;
    round.phase = "SETTLEMENT"; round.reactionWindow = null; round.settlement = { winnerId: winner.playerId, winnerName: winner.nickname, winning, score, players: this.players.filter((player): player is InternalPlayer => Boolean(player)).map((player) => ({ playerId: player.playerId, nickname: player.nickname, score: player.score })), method: isSelfDraw ? "自摸" : "点炮", discarderId: discarder?.playerId ?? null }; round.lastAction = { type: "win", playerId: winner.playerId, actionId }; round.version += 1;
    this.history.push({ handNumber: round.handNumber, dealer: this.getPlayerBySeat(round.dealerSeat).nickname, winner: winner.nickname, winType: isSelfDraw ? "自摸" : "点炮", discarder: discarder?.nickname ?? null, patterns: score.breakdown, scoreChanges: score.deltas, timestamp: new Date().toISOString() });
    if (this.rules.floorRule.resetPolicy === "RESET_ON_WIN") this.nextFloorMultiplier = 1;
    this.emit("event", { type: "win", data: round.settlement }); this.emit("settlement", round.settlement); this.emitState();
  }

  private finishDrawRound(): void { const round = this.requireRound(); this.clearTimer(); round.phase = "SETTLEMENT"; round.lastAction = { type: "draw-round" }; round.settlement = { winnerId: null, winnerName: null, method: "荒庄", score: { deltas: Object.fromEntries(this.players.filter(Boolean).map((player) => [player!.playerId, 0])), breakdown: [] } }; round.version += 1; if (this.rules.floorRule.enabled) this.nextFloorMultiplier = round.floorMultiplier * this.rules.floorRule.multiplier; this.history.push({ handNumber: round.handNumber, dealer: this.getPlayerBySeat(round.dealerSeat).nickname, winner: null, winType: "荒庄", scoreChanges: {}, timestamp: new Date().toISOString() }); this.emit("event", { type: "draw-round" }); this.emit("settlement", round.settlement); this.emitState(); }

  private canRon(player: InternalPlayer, winningTileType: TileType): boolean { const round = this.requireRound(); if (player.hasOpenedHand || (this.rules.threeJokerSelfDrawOnly && player.hand.filter((tile) => tile.type === round.jokerType).length >= 3)) return false; return analyzeHu({ concealed: [...player.hand.map((tile) => tile.type), winningTileType], openMelds: player.melds, jokerType: round.jokerType, winningTileType, isSelfDraw: false }).isHu; }
  private canTsumo(player: InternalPlayer): boolean { const round = this.requireRound(); const result = analyzeHu({ concealed: player.hand.map((tile) => tile.type), openMelds: player.melds, jokerType: round.jokerType, isSelfDraw: true }); return result.isHu && !(this.rules.threeJokerSelfDrawOnly && player.hand.filter((tile) => tile.type === round.jokerType).length >= 4 && !this.rules.fourJokerAutoHu); }
  private getPlayerBySeat(seat: number): InternalPlayer { const player = this.players[seat]; if (!player) throw new Error("座位无玩家"); return player; }
  private requireRound(): RoundRuntime { if (!this.round) throw new Error("牌局尚未开始"); return this.round; }
  private assertVersion(version: number): void { const round = this.requireRound(); if (version !== round.version) throw new Error("牌局状态已更新，请刷新操作"); }

  private startActionTimer(): void { this.clearTimer(); this.timer = setTimeout(() => { try { const round = this.requireRound(); const player = this.getPlayerBySeat(round.currentSeat); player.isAutopilot = true; const canHu = this.canTsumo(player); if (canHu) this.hu(player.playerId, id("timeout"), round.version); else { const candidate = [...player.hand].reverse().find((tile) => !isJoker(tile.type, round.jokerType)) ?? player.hand[player.hand.length - 1]; if (candidate) this.discard(player.playerId, candidate.tileId, id("timeout"), round.version); } } catch (error) { this.emit("event", { type: "timeout-error", data: { message: error instanceof Error ? error.message : "timeout" } }); } }, this.rules.actionTimeoutSeconds * 1000); }
  private startReactionTimer(): void { this.clearTimer(); this.timer = setTimeout(() => { try { const round = this.requireRound(); if (!round.reactionWindow) return; for (const entry of round.reactionWindow.eligible.values()) if (!entry.response) entry.response = { actionId: id("timeout"), version: round.version, kind: "pass" }; this.resolveReactionWindow(); } catch (error) { this.emit("event", { type: "timeout-error", data: { message: error instanceof Error ? error.message : "timeout" } }); } }, this.rules.reactionTimeoutSeconds * 1000); }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }

  disconnect(playerId: string, socketId?: string): void { const player = this.getPlayer(playerId); if (socketId && player.socketId !== socketId) return; player.connected = false; player.socketId = undefined; player.lastSeenAt = Date.now(); player.isAutopilot = true; this.emit("disconnected", { playerId, nickname: player.nickname }); this.emitState(); }
  reconnect(playerId: string, reconnectToken: string, socketId: string): InternalPlayer { const player = this.getPlayer(playerId); if (player.reconnectToken !== reconnectToken) throw new Error("重连凭证无效"); player.connected = true; player.socketId = socketId; player.isAutopilot = false; player.lastSeenAt = Date.now(); this.emit("reconnected", { playerId, nickname: player.nickname }); this.emitState(); return player; }
  removePlayer(playerId: string): void { const index = this.players.findIndex((player) => player?.playerId === playerId); if (index >= 0) this.players[index] = null; this.emitState(); }
  setVoiceEnabled(playerId: string, enabled: boolean): void { if (!this.rules.enableVoiceChat && enabled) throw new Error("房主已关闭语音"); this.getPlayer(playerId).voiceEnabled = enabled; this.emitState(); }

  serializeForPlayer(playerId: string): ClientStatePayload {
    const self = this.players.find((player) => player?.playerId === playerId) ?? null;
    const round = this.round;
    const reveal = round?.phase === "SETTLEMENT" || round?.phase === "ROUND_END";
    const players: PublicPlayerState[] = this.players.filter((player): player is InternalPlayer => Boolean(player)).sort((a, b) => a.seat - b.seat).map((player) => ({ playerId: player.playerId, nickname: player.nickname, seat: player.seat, connected: player.connected, ready: player.ready, hand: (player.playerId === playerId || reveal) ? player.hand.map(cloneTile) : undefined, handCount: player.hand.length, melds: player.melds.map((meld) => ({ ...meld, tiles: meld.tiles.map(cloneTile) })), discards: player.discards.map(cloneTile), score: player.score, wins: player.wins, roundsPlayed: player.roundsPlayed, discardCount: player.discardCount, isDealer: round?.dealerSeat === player.seat, isTurn: round?.currentSeat === player.seat && ["WAITING_FOR_DISCARD", "WAITING_FOR_REACTIONS"].includes(round.phase), hasOpenedHand: player.hasOpenedHand, isAutopilot: player.isAutopilot, voiceEnabled: player.voiceEnabled }));
    const publicRound: PublicRoundState | null = round ? { handNumber: round.handNumber, dealerSeat: round.dealerSeat, phase: round.phase, currentSeat: round.currentSeat, remainingTiles: round.liveWall.length, jokerIndicator: cloneTile(round.jokerIndicator), jokerType: round.jokerType, lastAction: round.lastAction, reactionWindow: round.reactionWindow ? { discard: cloneTile(round.reactionWindow.discard), discarderSeat: round.reactionWindow.discarderSeat, eligiblePlayerIds: [...round.reactionWindow.eligible.keys()], deadline: round.reactionWindow.deadline } : null, settlement: round.settlement, version: round.version, floorMultiplier: round.floorMultiplier } : null;
    const publicRoom: PublicRoomState = { roomId: this.roomId, hostPlayerId: this.hostPlayerId, players, round: publicRound, rules: this.rules, history: this.history.slice(-50) };
    return { room: publicRoom, self: players.find((player) => player.playerId === playerId) ?? null, legalActions: this.legalActions(playerId), ting: this.tingFor(playerId) };
  }

  legalActions(playerId: string): Array<Record<string, unknown>> {
    const round = this.round; const player = this.players.find((candidate) => candidate?.playerId === playerId); if (!round || !player) return [];
    if (round.phase === "WAITING_FOR_DISCARD" && round.currentSeat === player.seat) {
      const actions: Array<Record<string, unknown>> = [{ kind: "discard" }];
      if (this.canTsumo(player)) actions.push({ kind: "hu" });
      for (const type of canAnKong(player.hand.map((tile) => tile.type), round.jokerType)) actions.push({ kind: "kong", kongKind: "concealed", tileType: type });
      for (const type of canAddKong(player.hand.map((tile) => tile.type), player.melds, round.jokerType)) actions.push({ kind: "kong", kongKind: "added", tileType: type });
      return actions;
    }
    const entry = round.reactionWindow?.eligible.get(playerId); if (!entry || entry.response) return [];
    return entry.legal;
  }

  private tingFor(playerId: string): Array<Record<string, unknown>> { const round = this.round; const player = this.players.find((candidate) => candidate?.playerId === playerId); if (!round || !player || !this.rules.showTingHint || player.hand.length % 3 !== 1) return []; const visible = tileCounts(this.players.flatMap((candidate) => candidate ? [...candidate.discards.map((tile) => tile.type), ...(candidate.playerId === playerId ? [] : candidate.melds.flatMap((meld) => meld.tiles.map((tile) => tile.type)))] : [])); return calculateTing({ concealed: player.hand.map((tile) => tile.type), openMelds: player.melds, jokerType: round.jokerType, visibleCounts: visible, jokerIndicator: round.jokerIndicator.type }).map((result) => ({ ...result, tileType: result.tileType })); }

  emitState(): void { if (!this.destroyed) this.emit("state", this); }
  destroy(): void { this.destroyed = true; this.clearTimer(); this.removeAllListeners(); }
}
