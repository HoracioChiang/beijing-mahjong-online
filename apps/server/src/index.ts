import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import express, { type Application } from "express";
import cors from "cors";
import { Server } from "socket.io";
import { CreateRoomSchema, JoinRoomSchema, DiscardSchema, ReactionSchema, KongSchema, VoiceSignalSchema, type ClientToServerEvents, type ServerToClientEvents } from "@beijing-mahjong/shared";
import { RoomManager } from "./room-manager.js";
import type { GameRoom } from "./room.js";

const app: Application = express();
app.use(cors()); app.use(express.json());
app.get("/health", (_request, response) => response.status(200).json({ ok: true, service: "beijing-mahjong", time: new Date().toISOString() }));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const webDist = path.join(root, "apps/web/dist");
app.use(express.static(webDist));
app.get("*", (_request, response) => response.sendFile(path.join(webDist, "index.html")));
const httpServer = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, { cors: { origin: true, credentials: true }, transports: ["websocket", "polling"] });
const manager = new RoomManager();
const connections = new Map<string, { roomId: string; playerId: string }>();

const broadcastRoom = (room: GameRoom): void => {
  for (const player of room.players) {
    if (!player?.connected || !player.socketId) continue;
    io.to(player.socketId).emit("room:state", room.serializeForPlayer(player.playerId));
  }
};
manager.setEmitter((room) => {
  room.on("state", () => broadcastRoom(room));
  room.on("event", (payload: { type: string; data?: unknown }) => { for (const player of room.players) if (player?.socketId) io.to(player.socketId).emit("game:event", payload); });
  room.on("settlement", (payload: unknown) => { for (const player of room.players) if (player?.socketId) io.to(player.socketId).emit("game:settlement", payload); });
  room.on("disconnected", (payload: { playerId: string; nickname: string }) => { for (const player of room.players) if (player?.socketId) io.to(player.socketId).emit("player:disconnected", payload); });
  room.on("reconnected", (payload: { playerId: string; nickname: string }) => { for (const player of room.players) if (player?.socketId) io.to(player.socketId).emit("player:reconnected", payload); });
  broadcastRoom(room);
});

const fail = (socket: Parameters<typeof io.on>[1] extends (socket: infer S) => unknown ? S : never, error: unknown): void => socket.emit("error", { code: "INVALID_ACTION", message: error instanceof Error ? error.message : "操作失败" });

io.on("connection", (socket) => {
  const current = () => { const item = connections.get(socket.id); if (!item) return undefined; const room = manager.rooms.get(item.roomId); if (!room) { connections.delete(socket.id); return undefined; } try { if (room.getPlayer(item.playerId).socketId !== socket.id) { connections.delete(socket.id); return undefined; } } catch { connections.delete(socket.id); return undefined; } return item; };
  socket.on("room:create", (raw, callback) => { try { const payload = CreateRoomSchema.parse(raw); const { room, player } = manager.createRoom(payload.nickname, payload.rules, socket.id); connections.set(socket.id, { roomId: room.roomId, playerId: player.playerId }); callback?.({ ok: true, roomId: room.roomId, playerId: player.playerId, reconnectToken: player.reconnectToken }); } catch (error) { callback?.({ ok: false, message: error instanceof Error ? error.message : "创建失败" }); fail(socket, error); } });
  socket.on("room:join", (raw, callback) => { try { const payload = JoinRoomSchema.parse(raw); const { room, player } = manager.join(payload.roomId, payload.nickname, payload.identity, socket.id); connections.set(socket.id, { roomId: room.roomId, playerId: player.playerId }); socket.join(room.roomId); callback?.({ ok: true, roomId: room.roomId, playerId: player.playerId, reconnectToken: player.reconnectToken }); room.emitState(); } catch (error) { callback?.({ ok: false, message: error instanceof Error ? error.message : "加入失败" }); fail(socket, error); } });
  socket.on("room:leave", (callback) => { const item = current(); if (item) { manager.leave(item.roomId, item.playerId); connections.delete(socket.id); } callback?.({ ok: true }); socket.disconnect(true); });
  socket.on("player:ready", (ready) => { try { const item = current(); if (!item) throw new Error("请先加入房间"); manager.get(item.roomId).setReady(item.playerId, Boolean(ready)); } catch (error) { fail(socket, error); } });
  socket.on("game:start", () => { try { const item = current(); if (!item) throw new Error("请先加入房间"); manager.get(item.roomId).startGame(item.playerId); } catch (error) { fail(socket, error); } });
  socket.on("game:discard", (raw) => { try { const item = current(); if (!item) throw new Error("请先加入房间"); const payload = DiscardSchema.parse(raw); manager.get(item.roomId).discard(item.playerId, payload.tileId, payload.actionId, payload.version); } catch (error) { fail(socket, error); } });
  socket.on("game:reaction", (raw) => { try { const item = current(); if (!item) throw new Error("请先加入房间"); const payload = ReactionSchema.parse(raw); manager.get(item.roomId).reaction(item.playerId, payload); } catch (error) { fail(socket, error); } });
  socket.on("game:hu", (raw) => { try { const item = current(); if (!item) throw new Error("请先加入房间"); const payload = DiscardSchema.pick({ actionId: true, version: true }).parse(raw); manager.get(item.roomId).hu(item.playerId, payload.actionId, payload.version); } catch (error) { fail(socket, error); } });
  socket.on("game:pass", (raw) => { try { const item = current(); if (!item) throw new Error("请先加入房间"); const payload = DiscardSchema.pick({ actionId: true, version: true }).parse(raw); manager.get(item.roomId).reaction(item.playerId, { ...payload, kind: "pass" }); } catch (error) { fail(socket, error); } });
  socket.on("game:kong", (raw) => { try { const item = current(); if (!item) throw new Error("请先加入房间"); const payload = KongSchema.parse(raw); manager.get(item.roomId).kong(item.playerId, payload); } catch (error) { fail(socket, error); } });
  socket.on("game:voice-enabled", (enabled) => { try { const item = current(); if (!item) throw new Error("请先加入房间"); manager.get(item.roomId).setVoiceEnabled(item.playerId, Boolean(enabled)); } catch (error) { fail(socket, error); } });
  socket.on("voice:signal", (raw) => { try { const item = current(); if (!item) return; const payload = VoiceSignalSchema.parse(raw); const room = manager.get(item.roomId); const target = room.getPlayer(payload.toPlayerId); if (target.socketId) io.to(target.socketId).emit("voice:signal", { fromPlayerId: item.playerId, signal: payload.signal }); } catch (error) { fail(socket, error); } });
  socket.on("disconnect", () => { const item = connections.get(socket.id); if (item) { connections.delete(socket.id); manager.disconnect(item.roomId, item.playerId, socket.id); } });
});

const port = Number(process.env.PORT ?? 3000);
if (process.env.NODE_ENV !== "test") httpServer.listen(port, "0.0.0.0", () => console.log(`Beijing Mahjong listening on ${port}`));
export { app, httpServer, io, manager };
