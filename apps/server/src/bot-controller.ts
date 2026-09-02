import type { GameRoom } from "./room.js";
import { SimpleBotStrategy, type BotStrategy } from "./bot-strategy.js";

/** Schedules server-side bot input. Every callback enters GameRoom's normal authoritative API. */
export class BotController {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly scheduled = new Set<string>();
  readonly strategy: BotStrategy;

  constructor(strategy: BotStrategy = new SimpleBotStrategy()) { this.strategy = strategy; }

  schedule(room: GameRoom): void {
    const round = room.round;
    if (!round) return;
    if (round.phase === "DETERMINING_DEALER") {
      for (const bot of room.getBotPlayers()) if (room.needsDealerRoll(bot.playerId)) this.once(room, `dealer:${round.version}:${bot.playerId}`, 700, () => room.botRollDealerDice(bot.playerId));
    }
    if (round.phase === "ROLLING_FOR_WALL" && room.isWallRollPending()) {
      const dealer = room.getPlayerBySeat(room.tableProgress?.dealerSeat ?? round.dealerSeat);
      if (dealer.playerType === "BOT") this.once(room, `wall:${round.version}:${dealer.playerId}`, 800, () => room.botRollWallDice(dealer.playerId));
    }
    if (round.phase === "WAITING_FOR_DISCARD") {
      const player = room.getPlayerBySeat(round.currentSeat);
      if (player.playerType === "BOT") this.once(room, `discard:${round.version}:${player.playerId}`, 900, () => room.botTakeTurn(player.playerId, this.strategy));
    }
    if (round.phase === "WAITING_FOR_REACTIONS" && round.reactionWindow) {
      for (const bot of room.getBotPlayers()) if (room.legalActions(bot.playerId).length) this.once(room, `reaction:${round.version}:${bot.playerId}`, 650, () => room.botTakeReaction(bot.playerId, this.strategy));
    }
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.scheduled.clear();
  }

  private once(room: GameRoom, key: string, delay: number, action: () => void): void {
    if (this.scheduled.has(key)) return;
    this.scheduled.add(key);
    const timer = setTimeout(() => {
      this.scheduled.delete(key);
      this.timers.delete(key);
      try { action(); } catch (error) { room.reportBotError(error); }
    }, delay);
    this.timers.set(key, timer);
  }
}
