import { describe, expect, it } from "vitest";
import { ActionResolver } from "../src/action-resolver.js";
import { GameRoom } from "../src/room.js";
import { RoomManager } from "../src/room-manager.js";
import { SimpleBotStrategy } from "../src/bot-strategy.js";
import { vi } from "vitest";
import { BeijingDefaultRules } from "@beijing-mahjong/mahjong-core";

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
    while (created.room.round?.phase === "DETERMINING_DEALER") {
      for (const player of players) if (created.room.needsDealerRoll(player.playerId)) created.room.rollDice(player.playerId);
    }
    if (created.room.round?.phase === "ROLLING_FOR_WALL") created.room.rollDice(created.room.getPlayerBySeat(created.room.round.dealerSeat).playerId);
    return { room: created.room, players };
  };
  it("partitions deal, indicator, live wall and dead wall to 136 entities", () => {
    const { room, players } = readyRoom();
    const round = room.round!;
    const total = players.reduce((sum, player) => sum + player.hand.length + player.melds.reduce((n, meld) => n + meld.tiles.length, 0) + player.discards.length, 0) + round.liveWall.length + round.deadWall.length + 1;
    expect(total).toBe(136);
    expect(round.deadWall).toHaveLength(13);
    expect(round.liveWall).toHaveLength(69);
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

describe("server-controlled bots and dice", () => {
  it.each([1, 2, 3])("starts with %i human player(s) and fills the table with bots", (humanCount) => {
    const manager = new RoomManager(); const first = manager.createRoom("Human-1");
    for (let index = 1; index < humanCount; index += 1) manager.join(first.room.roomId, `Human-${index + 1}`);
    while (first.room.playerCount() < 4) first.room.addBot();
    for (const player of first.room.players) if (player) player.ready = true;
    first.room.startGame(first.player.playerId);
    while (first.room.round?.phase === "DETERMINING_DEALER") for (const player of first.room.players) if (player && first.room.needsDealerRoll(player.playerId)) first.room.rollDice(player.playerId);
    if (first.room.round?.phase === "ROLLING_FOR_WALL") first.room.rollDice(first.room.getPlayerBySeat(first.room.round.dealerSeat).playerId);
    expect(first.room.round?.phase).toBe("WAITING_FOR_DISCARD");
    expect(first.room.players.filter((player) => player?.playerType === "BOT")).toHaveLength(4 - humanCount);
    first.room.destroy();
  });
  it("keeps bot input on the same authoritative APIs and never discards a joker", () => {
    const strategy = new SimpleBotStrategy();
    const joker = { tileId: "joker-0", type: 31 as never }; const ordinary = { tileId: "ordinary-0", type: 0 as never };
    const tileId = strategy.chooseDiscard({ hand: [joker, ordinary], melds: [] }, { jokerType: 31 as never, legalActions: [{ kind: "discard" }] });
    expect(tileId).toBe(ordinary.tileId);
    expect(strategy.chooseReaction({ hand: [], melds: [] }, { jokerType: null, legalActions: [{ kind: "pass" }] }).kind).toBe("pass");
    expect(strategy.chooseReaction({ hand: [], melds: [] }, { jokerType: null, legalActions: [{ kind: "hu" }, { kind: "pass" }] }).kind).toBe("hu");
  });
  it("records server-generated dealer rolls and reroll rounds", () => {
    const manager = new RoomManager(); const created = manager.createRoom("A"); const players = [created.player];
    for (const nickname of ["B", "C", "D"]) players.push(manager.join(created.room.roomId, nickname).player);
    for (const player of players) player.ready = true; created.room.startGame(created.player.playerId);
    while (created.room.round?.phase === "DETERMINING_DEALER") for (const player of players) if (created.room.needsDealerRoll(player.playerId)) created.room.rollDice(player.playerId);
    expect(created.room.dealerDetermination?.rolls.every((roll) => roll.dice1 >= 1 && roll.dice1 <= 6 && roll.dice2 >= 1 && roll.dice2 <= 6)).toBe(true);
    expect(created.room.dealerDetermination?.finalOrder).toHaveLength(4); expect(new Set(created.room.dealerDetermination?.finalOrder).size).toBe(4);
    created.room.destroy();
  });
  it("publishes wall position changes without exposing physical wall tiles", () => {
    const manager = new RoomManager(); const created = manager.createRoom("A"); const players = [created.player]; for (const nickname of ["B", "C", "D"]) players.push(manager.join(created.room.roomId, nickname).player); for (const player of players) player.ready = true; created.room.startGame(created.player.playerId); while (created.room.round?.phase === "DETERMINING_DEALER") for (const player of players) if (created.room.needsDealerRoll(player.playerId)) created.room.rollDice(player.playerId); if (created.room.round?.phase === "ROLLING_FOR_WALL") created.room.rollDice(created.room.getPlayerBySeat(created.room.round.dealerSeat).playerId);
    const room = created.room; const before = room.serializeForPlayer(players[0]!.playerId); const current = room.getPlayerBySeat(room.round!.currentSeat); const tile = current.hand.find((candidate) => candidate.type !== room.round!.jokerType)!;
    room.discard(current.playerId, tile.tileId, "position-action-12345678", room.round!.version);
    for (const playerId of room.round?.reactionWindow?.eligible.keys() ?? []) room.reaction(playerId, { actionId: `pass-${playerId}-12345678`, version: room.round!.version, kind: "pass" });
    const after = room.serializeForPlayer(players[0]!.playerId); expect(["discard", "draw"].includes(String(after.room.round?.lastAction?.type))).toBe(true); expect(JSON.stringify(after)).not.toContain("firstDrawTileId\":\"9");
    expect(before.room.round?.wall?.liveRemaining).toBe(69); expect(after.room.round?.wall?.liveRemaining).toBe(68);
    room.destroy();
  });
  it("lets the server drive a bot through the wall-roll and first-turn APIs", () => {
    const manager = new RoomManager(); const created = manager.createRoom("Human"); while (created.room.playerCount() < 4) created.room.addBot(); for (const player of created.room.players) if (player) player.ready = true;
    created.room.startGame(created.player.playerId);
    while (created.room.round?.phase === "DETERMINING_DEALER") for (const player of created.room.players) if (player && created.room.needsDealerRoll(player.playerId)) created.room.botRollDealerDice(player.playerId);
    if (created.room.round?.phase === "ROLLING_FOR_WALL") created.room.botRollWallDice(created.room.getPlayerBySeat(created.room.round.dealerSeat).playerId);
    const dealer = created.room.getPlayerBySeat(created.room.round!.dealerSeat); expect(dealer.hand).toHaveLength(14); expect(created.room.legalActions(dealer.playerId).some((action) => action.kind === "discard")).toBe(true); created.room.destroy();
  });
  it("does not keep bot timers alive after a room is destroyed", () => {
    vi.useFakeTimers(); const manager = new RoomManager(); const created = manager.createRoom("Human"); created.room.addBot(); created.room.destroy(); vi.advanceTimersByTime(5_000); expect(created.room.round?.phase).toBe("WAITING_FOR_PLAYERS"); vi.useRealTimers();
  });
  it("can drive one complete mixed human/bot hand without a deadlock", () => {
    const manager = new RoomManager(); const created = manager.createRoom("Human"); while (created.room.playerCount() < 4) created.room.addBot(); for (const player of created.room.players) if (player) player.ready = true; created.room.startGame(created.player.playerId);
    while (created.room.round?.phase === "DETERMINING_DEALER") for (const player of created.room.players) if (player && created.room.needsDealerRoll(player.playerId)) created.room.botRollDealerDice(player.playerId);
    if (created.room.round?.phase === "ROLLING_FOR_WALL") created.room.botRollWallDice(created.room.getPlayerBySeat(created.room.round.dealerSeat).playerId);
    const strategy = new SimpleBotStrategy();
    for (let step = 0; step < 250 && !["SETTLEMENT", "POT_SETTLEMENT"].includes(created.room.round?.phase ?? ""); step += 1) {
      const round = created.room.round!;
      if (round.phase === "WAITING_FOR_REACTIONS") {
        for (const playerId of [...(round.reactionWindow?.eligible.keys() ?? [])]) created.room.reaction(playerId, { actionId: `pass-${step}-${playerId}`, version: created.room.round!.version, kind: "pass" });
        continue;
      }
      if (round.phase !== "WAITING_FOR_DISCARD") break;
      const player = created.room.getPlayerBySeat(round.currentSeat);
      if (player.playerType === "BOT") created.room.botTakeTurn(player.playerId, strategy);
      else { const tile = player.hand.find((candidate) => candidate.type !== round.jokerType); if (!tile) break; created.room.discard(player.playerId, tile.tileId, `human-${step}-12345678`, round.version); }
    }
    expect(["SETTLEMENT", "POT_SETTLEMENT"].includes(created.room.round?.phase ?? "")).toBe(true); created.room.destroy();
  });
  it("honors floor stack mode instead of silently accumulating every draw", () => {
    const manager = new RoomManager(); const created = manager.createRoom("A", { floorRule: { ...BeijingDefaultRules.floorRule, stackMode: "NEXT_ROUND_ONLY" } }); const players = [created.player];
    for (const nickname of ["B", "C", "D"]) players.push(manager.join(created.room.roomId, nickname).player);
    for (const player of players) player.ready = true; created.room.startGame(created.player.playerId);
    while (created.room.round?.phase === "DETERMINING_DEALER") for (const player of players) if (created.room.needsDealerRoll(player.playerId)) created.room.rollDice(player.playerId);
    if (created.room.round?.phase === "ROLLING_FOR_WALL") created.room.rollDice(created.room.getPlayerBySeat(created.room.round.dealerSeat).playerId);
    const finishDraw = (created.room as unknown as { finishDrawRound: () => void }).finishDrawRound.bind(created.room);
    finishDraw(); expect(created.room.round?.phase).toBe("SETTLEMENT");
    for (const player of players) player.ready = true; created.room.startGame(created.player.playerId); expect(created.room.round?.floorMultiplier).toBe(2);
    finishDraw(); for (const player of players) player.ready = true; created.room.startGame(created.player.playerId); expect(created.room.round?.floorMultiplier).toBe(2); created.room.destroy();
  });
  it("requires settlement readiness before starting the next hand and lets bots be ready automatically", () => {
    const manager = new RoomManager(); const created = manager.createRoom("Human"); while (created.room.playerCount() < 4) created.room.addBot();
    for (const player of created.room.players) if (player) player.ready = true; created.room.startGame(created.player.playerId);
    while (created.room.round?.phase === "DETERMINING_DEALER") for (const player of created.room.players) if (player && created.room.needsDealerRoll(player.playerId)) created.room.botRollDealerDice(player.playerId);
    if (created.room.round?.phase === "ROLLING_FOR_WALL") created.room.botRollWallDice(created.room.getPlayerBySeat(created.room.round.dealerSeat).playerId);
    const finishDraw = (created.room as unknown as { finishDrawRound: () => void }).finishDrawRound.bind(created.room);
    finishDraw(); expect(created.room.round?.phase).toBe("SETTLEMENT"); expect(created.room.players.slice(1).every((player) => player?.ready)).toBe(true);
    expect(() => created.room.startGame(created.player.playerId)).toThrow("需要四位玩家全部准备");
    created.room.setReady(created.player.playerId, true); expect(created.room.round?.phase).toBe("ROLLING_FOR_WALL"); created.room.destroy();
  });
});
