import { randomInt } from "node:crypto";
import { GameRoom } from "./room.js";
import { BeijingDefaultRules, type RuleConfig } from "@beijing-mahjong/mahjong-core";

export class RoomManager {
  readonly rooms = new Map<string, GameRoom>();
  private cleanupTimers = new Map<string, NodeJS.Timeout>();
  private wiredRooms = new Set<string>();
  private emitRoom?: (room: GameRoom) => void;

  setEmitter(emitRoom: (room: GameRoom) => void): void { this.emitRoom = emitRoom; }
  private wire(room: GameRoom): void { if (this.wiredRooms.has(room.roomId)) return; this.wiredRooms.add(room.roomId); this.emitRoom?.(room); }
  createRoom(nickname: string, rules?: Partial<RuleConfig>, socketId?: string): { room: GameRoom; player: ReturnType<GameRoom["addPlayer"]> } {
    let roomId = "";
    do roomId = String(randomInt(100000, 1000000)); while (this.rooms.has(roomId));
    const room = new GameRoom(roomId, "pending", { ...BeijingDefaultRules, ...rules, enableVoiceChat: process.env.ENABLE_VOICE_CHAT !== "false" && (rules?.enableVoiceChat ?? BeijingDefaultRules.enableVoiceChat), floorRule: { ...BeijingDefaultRules.floorRule, ...(rules?.floorRule ?? {}) }, scoring: { ...BeijingDefaultRules.scoring, ...(rules?.scoring ?? {}) } });
    const player = room.addPlayer(nickname, undefined, socketId);
    room.hostPlayerId = player.playerId;
    this.rooms.set(roomId, room);
    this.wire(room);
    return { room, player };
  }
  get(roomId: string): GameRoom { const room = this.rooms.get(roomId); if (!room) throw new Error("房间不存在或已关闭"); return room; }
  join(roomId: string, nickname: string, identity?: { playerId: string; reconnectToken: string }, socketId?: string): { room: GameRoom; player: ReturnType<GameRoom["addPlayer"]> } {
    const room = this.get(roomId); const player = room.addPlayer(nickname, identity, socketId); const timer = this.cleanupTimers.get(roomId); if (timer) { clearTimeout(timer); this.cleanupTimers.delete(roomId); } this.wire(room); return { room, player };
  }
  disconnect(roomId: string, playerId: string, socketId?: string): void { const room = this.rooms.get(roomId); if (!room) return; room.disconnect(playerId, socketId); if (room.activeCount() === 0 && !this.cleanupTimers.has(roomId)) { const timer = setTimeout(() => this.destroy(roomId), 5 * 60 * 1000); this.cleanupTimers.set(roomId, timer); } }
  leave(roomId: string, playerId: string): void { const room = this.rooms.get(roomId); if (!room) return; room.removePlayer(playerId); if (room.playerCount() === 0) this.destroy(roomId); else if (room.activeCount() === 0 && !this.cleanupTimers.has(roomId)) { const timer = setTimeout(() => this.destroy(roomId), 5 * 60 * 1000); this.cleanupTimers.set(roomId, timer); } }
  destroy(roomId: string): void { const room = this.rooms.get(roomId); if (!room) return; const timer = this.cleanupTimers.get(roomId); if (timer) clearTimeout(timer); this.cleanupTimers.delete(roomId); this.wiredRooms.delete(roomId); room.destroy(); this.rooms.delete(roomId); }
}
