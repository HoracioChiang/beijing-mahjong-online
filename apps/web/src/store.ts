import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ClientStatePayload, ServerToClientEvents } from "@beijing-mahjong/shared";
import type { RuleConfig } from "@beijing-mahjong/mahjong-core";

export interface Identity { playerId: string; reconnectToken: string; roomId: string; nickname: string; }
const IDENTITY_KEY = "beijing-mahjong.identity";
const readIdentity = (): Identity | null => { try { const raw = localStorage.getItem(IDENTITY_KEY); if (raw) return JSON.parse(raw) as Identity; const playerId = localStorage.getItem("playerId"); const reconnectToken = localStorage.getItem("reconnectToken"); const roomId = localStorage.getItem("roomId"); const nickname = localStorage.getItem("nickname"); return playerId && reconnectToken && roomId && nickname ? { playerId, reconnectToken, roomId, nickname } : null; } catch { return null; } };
const saveIdentity = (identity: Identity): void => { localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity)); localStorage.setItem("playerId", identity.playerId); localStorage.setItem("reconnectToken", identity.reconnectToken); localStorage.setItem("roomId", identity.roomId); localStorage.setItem("nickname", identity.nickname); };
const clearIdentity = (): void => { localStorage.removeItem(IDENTITY_KEY); for (const key of ["playerId", "reconnectToken", "roomId", "nickname"]) localStorage.removeItem(key); };

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const socket: ClientSocket = io(import.meta.env.VITE_SERVER_URL || window.location.origin, { autoConnect: true, transports: ["websocket", "polling"] });

interface Store {
  socket: ClientSocket;
  identity: Identity | null;
  state: ClientStatePayload | null;
  connected: boolean;
  error: string | null;
  event: { type: string; data?: unknown } | null;
  settlement: any | null;
  voiceError: string | null;
  setVoiceError: (voiceError: string | null) => void;
  connectToRoom: (roomId: string, nickname: string) => void;
  createRoom: (nickname: string, rules?: Partial<RuleConfig>) => void;
  leaveRoom: () => void;
  toggleReady: () => void;
  startGame: () => void;
  addBot: (nickname?: string) => void;
  removeBot: (playerId: string) => void;
  addBotsAndStart: () => void;
  rollDice: () => void;
  discard: (tileId: string) => void;
  reaction: (kind: "hu" | "peng" | "chi" | "kong" | "pass", tileTypes?: number[]) => void;
  hu: () => void;
  kong: (tileType: number, kongKind: "concealed" | "added") => void;
  setVoiceEnabled: (enabled: boolean) => void;
  clearError: () => void;
}

export const useGameStore = create<Store>((set, get) => {
  socket.on("connect", () => { set({ connected: true }); const identity = get().identity; if (identity) get().connectToRoom(identity.roomId, identity.nickname); });
  socket.on("disconnect", () => set({ connected: false }));
  socket.on("room:state", (state) => set({ state, settlement: state.room.round?.settlement ?? null, error: null }));
  socket.on("game:event", (event) => set({ event }));
  socket.on("game:settlement", (settlement) => set({ settlement }));
  socket.on("error", (error) => set({ error: error.message }));
  socket.on("player:disconnected", ({ nickname }) => set({ event: { type: "player-disconnected", data: nickname } }));
  socket.on("player:reconnected", ({ nickname }) => set({ event: { type: "player-reconnected", data: nickname } }));
  const adoptIdentity = (response: unknown, roomId: string, nickname: string): void => { const result = response as { ok?: boolean; message?: string; playerId?: string; reconnectToken?: string; roomId?: string }; if (!result.ok || !result.playerId || !result.reconnectToken) { set({ error: result.message ?? "房间操作失败" }); return; } const identity = { playerId: result.playerId, reconnectToken: result.reconnectToken, roomId: result.roomId ?? roomId, nickname }; saveIdentity(identity); set({ identity, error: null }); };
  return {
    socket, identity: readIdentity(), state: null, connected: socket.connected, error: null, event: null, settlement: null, voiceError: null,
    setVoiceError: (voiceError) => set({ voiceError }),
    connectToRoom: (roomId, nickname) => { const identity = get().identity; socket.emit("room:join", { roomId, nickname, identity: identity?.roomId === roomId ? { playerId: identity.playerId, reconnectToken: identity.reconnectToken } : undefined }, (response) => adoptIdentity(response, roomId, nickname)); },
    createRoom: (nickname, rules) => socket.emit("room:create", { nickname, rules }, (response) => adoptIdentity(response, "", nickname)),
    leaveRoom: () => { socket.emit("room:leave", () => { clearIdentity(); set({ identity: null, state: null, settlement: null }); }); },
    toggleReady: () => { const self = get().state?.self; if (self) socket.emit("player:ready", !self.ready); },
    startGame: () => socket.emit("game:start"),
    addBot: (nickname) => socket.emit("room:add-bot", nickname ? { nickname } : {}),
    removeBot: (playerId) => socket.emit("room:remove-bot", { playerId }),
    addBotsAndStart: () => socket.emit("game:add-bots-start"),
    rollDice: () => { const round = get().state?.room.round; if (round) socket.emit("game:rollDice", { actionId: crypto.randomUUID(), version: round.version }); },
    discard: (tileId) => { const round = get().state?.room.round; if (round) socket.emit("game:discard", { tileId, actionId: crypto.randomUUID(), version: round.version }); },
    reaction: (kind, tileTypes) => { const round = get().state?.room.round; if (round) socket.emit("game:reaction", { kind, tileTypes, actionId: crypto.randomUUID(), version: round.version }); },
    hu: () => { const round = get().state?.room.round; if (round) socket.emit("game:hu", { actionId: crypto.randomUUID(), version: round.version }); },
    kong: (tileType, kongKind) => { const round = get().state?.room.round; if (round) socket.emit("game:kong", { tileType, kongKind, actionId: crypto.randomUUID(), version: round.version }); },
    setVoiceEnabled: (enabled) => socket.emit("game:voice-enabled", enabled),
    clearError: () => set({ error: null })
  };
});

export { IDENTITY_KEY, clearIdentity };
