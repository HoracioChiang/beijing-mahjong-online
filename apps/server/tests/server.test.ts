import { describe, expect, it } from "vitest";
import { ActionResolver } from "../src/action-resolver.js";
import { GameRoom } from "../src/room.js";
import { RoomManager } from "../src/room-manager.js";

const payload = (kind: "hu" | "kong" | "peng" | "chi" | "pass") => ({ actionId: `action-${kind}-12345678`, version: 1, kind });

describe("ActionResolver", () => {
  it("always resolves HU before gang/peng/chi", () => {
    const result = ActionResolver.resolve({ discarderSeat: 0, multiHuPolicy: "NEAREST_ONLY", candidates: [
      { playerId: "chi", seat: 1, response: payload("chi") },
      { playerId: "peng", seat: 2, response: payload("peng") },
      { playerId: "hu", seat: 3, response: payload("hu") }
    ] });
    expect(result.selected?.playerId).toBe("hu");
  });
  it("resolves gang/peng before chi", () => {
    const result = ActionResolver.resolve({ discarderSeat: 0, multiHuPolicy: "NEAREST_ONLY", candidates: [
      { playerId: "chi", seat: 1, response: payload("chi") },
      { playerId: "peng", seat: 2, response: payload("peng") }
    ] });
    expect(result.selected?.playerId).toBe("peng");
  });
  it("uses nearest clockwise seat for equal priority", () => {
    const result = ActionResolver.resolve({ discarderSeat: 0, multiHuPolicy: "NEAREST_ONLY", candidates: [
      { playerId: "far", seat: 3, response: payload("hu") },
      { playerId: "near", seat: 1, response: payload("hu") }
    ] });
    expect(result.hu.map((candidate) => candidate.playerId)).toEqual(["near"]);
  });
  it("can retain multiple hu responses when configured", () => {
    const result = ActionResolver.resolve({ discarderSeat: 0, multiHuPolicy: "ALLOW_MULTI_HU", candidates: [
      { playerId: "far", seat: 3, response: payload("hu") },
      { playerId: "near", seat: 1, response: payload("hu") }
    ] });
    expect(result.hu.map((candidate) => candidate.playerId)).toEqual(["near", "far"]);
  });
  it("returns no action after everyone passes", () => {
    const result = ActionResolver.resolve({ discarderSeat: 0, multiHuPolicy: "NEAREST_ONLY", candidates: [
      { playerId: "one", seat: 1, response: payload("pass") },
      { playerId: "two", seat: 2, response: payload("pass") }
    ] });
    expect(result.selected).toBeUndefined();
  });
});

describe("authoritative GameRoom state", () => {
  const readyRoom = () => {
    const manager = new RoomManager();
    const created = manager.createRoom("A");
    const players = [created.player];
    for (const nickname of ["B", "C", "D"]) players.push(manager.join(created.room.roomId, nickname).player);
    for (const player of players) created.room.setReady(player.playerId, true);
    created.room.startGame(created.player.playerId);
    return { room: created.room, players };
  };
  it("partitions deal, indicator, live wall and dead wall to 136 entities", () => {
    const { room, players } = readyRoom();
    const round = room.round!;
    const total = players.reduce((sum, player) => sum + player.hand.length + player.melds.reduce((n, meld) => n + meld.tiles.length, 0) + player.discards.length, 0) + round.liveWall.length + round.deadWall.length + 1;
    expect(total).toBe(136);
    expect(round.deadWall).toHaveLength(14);
    expect(round.liveWall).toHaveLength(68);
  });
  it("never includes another player's concealed tile in serialized JSON", () => {
    const { room, players } = readyRoom();
    const mine = room.serializeForPlayer(players[0]!.playerId);
    const serialized = JSON.stringify(mine);
    for (const other of players.slice(1)) for (const tile of other.hand) expect(serialized).not.toContain(tile.tileId);
    expect(mine.self?.hand?.map((tile) => tile.tileId)).toEqual(players[0]!.hand.map((tile) => tile.tileId));
    expect(mine.room.players.find((player) => player.playerId === players[1]!.playerId)?.hand).toBeUndefined();
  });
  it("exposes only legal current-turn actions", () => {
    const { room, players } = readyRoom();
    const current = players.find((player) => player.seat === room.round!.currentSeat)!;
    const other = players.find((player) => player.playerId !== current.playerId)!;
    expect(room.legalActions(current.playerId).map((action) => action.kind)).toContain("discard");
    expect(room.legalActions(other.playerId)).toEqual([]);
  });
  it("keeps seat and hand on token reconnect", () => {
    const { room, players } = readyRoom();
    const original = players[1]!;
    const handIds = original.hand.map((tile) => tile.tileId);
    room.disconnect(original.playerId);
    const rejoined = room.reconnect(original.playerId, original.reconnectToken, "new-socket");
    expect(rejoined.seat).toBe(original.seat);
    expect(rejoined.hand.map((tile) => tile.tileId)).toEqual(handIds);
  });
  it("ignores a late disconnect from an old socket after refresh", () => {
    const { room, players } = readyRoom();
    const original = players[1]!;
    room.disconnect(original.playerId, "old-socket");
    room.reconnect(original.playerId, original.reconnectToken, "new-socket");
    room.disconnect(original.playerId, "old-socket");
    expect(original.connected).toBe(true);
    expect(original.socketId).toBe("new-socket");
  });
  it("rejects stale state versions before mutating a hand", () => {
    const { room, players } = readyRoom();
    const current = players.find((player) => player.seat === room.round!.currentSeat)!;
    const tile = current.hand.find((candidate) => candidate.type !== room.round!.jokerType)!;
    expect(() => room.discard(current.playerId, tile.tileId, "stale-action-12345678", room.round!.version - 1)).toThrow("状态已更新");
    expect(current.hand.some((candidate) => candidate.tileId === tile.tileId)).toBe(true);
  });
  it("rejects an attempt to discard the joker on the server", () => {
    const { room, players } = readyRoom();
    const current = players.find((player) => player.seat === room.round!.currentSeat)!;
    const joker = current.hand.find((candidate) => candidate.type === room.round!.jokerType);
    if (joker) expect(() => room.discard(current.playerId, joker.tileId, "joker-action-12345678", room.round!.version)).toThrow("混儿");
  });
});
