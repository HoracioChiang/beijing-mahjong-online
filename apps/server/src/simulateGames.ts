import {
  advanceTableProgress,
  analyzeHu,
  BeijingDefaultRules,
  breakMahjongWall,
  calculateScore,
  canMingKong,
  canPeng,
  chiCombinations,
  createMahjongWall,
  deadWallRemaining,
  drawNextTile,
  drawReplacementTile,
  nextJokerType,
  revealJokerIndicator,
  seededRandom,
  type Meld,
  type MahjongWall,
  type TableProgress,
  type Tile,
  type TileType
} from "@beijing-mahjong/mahjong-core";

type SimPlayer = { id: string; seat: number; hand: Tile[]; melds: Meld[]; discards: Tile[]; opened: boolean };
type SimState = { wall: MahjongWall; indicator: Tile; joker: TileType; players: SimPlayer[]; phase: "DRAW" | "REACTION" | "SETTLEMENT" | "DRAW_ROUND"; currentSeat: number; log: string[]; invariantStep: number };
const makeId = (seed: number, suffix: string) => `sim-${seed}-${suffix}`;
const nextDie = (random: () => number) => Math.floor(random() * 6) + 1;
const physicalWallTiles = (wall: MahjongWall): Tile[] => wall.sides.flatMap((side) => side.stacks.flatMap((stack) => [stack.bottomTile, stack.topTile])).filter((tile): tile is Tile => Boolean(tile));
const take = (player: SimPlayer, type: TileType, amount: number): Tile[] => { const found = player.hand.filter((tile) => tile.type === type).slice(0, amount); if (found.length !== amount) throw new Error(`not enough type=${type}`); player.hand = player.hand.filter((tile) => !found.includes(tile)); return found; };
const removeDiscarded = (player: SimPlayer, tile: Tile): void => { const index = player.discards.findIndex((candidate) => candidate.tileId === tile.tileId); if (index < 0) throw new Error(`claimed tile ${tile.tileId} was not in discard`); player.discards.splice(index, 1); };

const assertInvariants = (state: SimState, seed: number): void => {
  state.invariantStep += 1;
  const playerTileCount = state.players.reduce((sum, player) => sum + player.hand.length + player.discards.length + player.melds.reduce((n, meld) => n + meld.tiles.length, 0), 0);
  if (playerTileCount + deadWallRemaining(state.wall) + state.wall.liveCursor.positions.length - state.wall.liveCursor.index + 1 !== 136) throw new Error(`seed=${seed} tile total`);
  // Full entity/type scans are deliberately periodic; the O(1) conservation check runs every state transition.
  if (state.invariantStep % 16 !== 0 && state.phase !== "SETTLEMENT" && state.phase !== "DRAW_ROUND") return;
  const all = [...physicalWallTiles(state.wall), state.indicator, ...state.players.flatMap((player) => [...player.hand, ...player.discards, ...player.melds.flatMap((meld) => meld.tiles)])];
  const ids = new Set(all.map((tile) => tile.tileId)); if (all.length !== 136 || ids.size !== 136) throw new Error(`seed=${seed} duplicate entity`);
  for (let type = 0; type < 34; type += 1) { const count = all.filter((tile) => tile.type === type).length; if (count !== 4) throw new Error(`seed=${seed} type=${type} count=${count}`); }
  if (!["DRAW", "REACTION", "SETTLEMENT", "DRAW_ROUND"].includes(state.phase)) throw new Error(`seed=${seed} invalid phase`);
  for (const player of state.players) if (player.hand.length > 14 || player.hand.length < 0) throw new Error(`seed=${seed} invalid hand count`);
};

const settle = (state: SimState, winner: SimPlayer, winningType: TileType, selfDraw: boolean, discarder?: SimPlayer): void => {
  const winning = analyzeHu({ concealed: winner.hand.map((tile) => tile.type), openMelds: winner.melds, jokerType: state.joker, winningTileType: winningType, isSelfDraw: selfDraw });
  if (!winning.isHu) throw new Error("simulation selected an illegal hu");
  const players = state.players.map((player) => ({ playerId: player.id, nickname: player.id, seat: player.seat, isDealer: player.seat === 0 }));
  const score = calculateScore({ winnerId: winner.id, winnerName: winner.id, allPlayers: players, winnerSeat: winner.seat, dealerSeat: 0, concealed: winner.hand.map((tile) => tile.type), openMelds: winner.melds, winning, jokerType: state.joker, winningTileType: winningType, isSelfDraw: selfDraw, discarderId: discarder?.id }, BeijingDefaultRules);
  if (Object.values(score.deltas).reduce((a, b) => a + b, 0) !== 0) throw new Error("simulation non-zero settlement"); state.phase = "SETTLEMENT";
};

const deal = (state: SimState, seed: number): void => {
  const players = state.players; const draw = (player: SimPlayer, count: number) => { for (let index = 0; index < count; index += 1) { const item = drawNextTile(state.wall); if (!item) throw new Error(`seed=${seed} deal exhausted`); player.hand.push(item.tile); } };
  for (let batch = 0; batch < 3; batch += 1) for (let offset = 0; offset < 4; offset += 1) draw(players[offset]!, 4);
  for (const player of players) draw(player, 1); draw(players[0]!, 1); for (const player of players) player.hand.sort((a, b) => a.type - b.type); assertInvariants(state, seed);
};

export const simulateGame = (seed: number): void => {
  const random = seededRandom(seed); const wall = createMahjongWall(random); const d1 = nextDie(random); const d2 = nextDie(random); breakMahjongWall(wall, 0, d1, d2, 7); const indicator = revealJokerIndicator(wall)?.tile; if (!indicator) throw new Error(`seed=${seed} no indicator`);
  const players: SimPlayer[] = Array.from({ length: 4 }, (_, seat) => ({ id: makeId(seed, `p${seat}`), seat, hand: [], melds: [], discards: [], opened: false })); const state: SimState = { wall, indicator, joker: nextJokerType(indicator.type), players, phase: "DRAW", currentSeat: 0, log: [], invariantStep: 0 }; deal(state, seed);
  for (let turn = 0; turn < 400; turn += 1) {
    const current = state.players[state.currentSeat]!; current.hand.sort((a, b) => a.type - b.type);
    if (analyzeHu({ concealed: current.hand.map((tile) => tile.type), openMelds: current.melds, jokerType: state.joker, isSelfDraw: true }).isHu) { settle(state, current, current.hand[current.hand.length - 1]!.type, true); assertInvariants(state, seed); return; }
    const discard = current.hand.find((tile) => tile.type !== state.joker); if (!discard) { state.phase = "DRAW_ROUND"; assertInvariants(state, seed); return; } current.hand = current.hand.filter((tile) => tile.tileId !== discard.tileId); current.discards.push(discard); state.log.push(`s${current.seat}:discard:${discard.tileId}`); state.phase = "REACTION"; assertInvariants(state, seed);
    const others = [1, 2, 3].map((offset) => state.players[(current.seat + offset) % 4]!); const ron = others.find((player) => !player.opened && analyzeHu({ concealed: [...player.hand.map((tile) => tile.type), discard.type], openMelds: player.melds, jokerType: state.joker, winningTileType: discard.type, isSelfDraw: false }).isHu);
    if (ron) { removeDiscarded(current, discard); ron.hand.push(discard); settle(state, ron, discard.type, false, current); assertInvariants(state, seed); return; }
    const possible = others.filter((player) => canMingKong(player.hand.map((tile) => tile.type), discard.type, state.joker) || canPeng(player.hand.map((tile) => tile.type), discard.type, state.joker) || (player.seat === (current.seat + 1) % 4 && chiCombinations(player.hand.map((tile) => tile.type), discard.type, state.joker).length > 0));
    const claimant = possible.length && random() < 0.16 ? possible[0] : undefined;
    if (claimant) {
      if (canMingKong(claimant.hand.map((tile) => tile.type), discard.type, state.joker) && random() < 0.2) { const taken = take(claimant, discard.type, 3); removeDiscarded(current, discard); claimant.melds.push({ id: makeId(seed, `meld-${turn}`), kind: "ming-kong", tiles: [...taken, discard], claimedTileType: discard.type, fromSeat: current.seat }); claimant.opened = true; const replacement = drawReplacementTile(state.wall); if (!replacement) { state.phase = "DRAW_ROUND"; return; } claimant.hand.push(replacement.tile); state.currentSeat = claimant.seat; state.phase = "DRAW"; assertInvariants(state, seed); continue; }
      if (canPeng(claimant.hand.map((tile) => tile.type), discard.type, state.joker)) { const taken = take(claimant, discard.type, 2); removeDiscarded(current, discard); claimant.melds.push({ id: makeId(seed, `meld-${turn}`), kind: "peng", tiles: [...taken, discard], claimedTileType: discard.type, fromSeat: current.seat }); claimant.opened = true; const forced = claimant.hand.find((tile) => tile.type !== state.joker); if (forced) { claimant.hand = claimant.hand.filter((tile) => tile.tileId !== forced.tileId); claimant.discards.push(forced); } state.currentSeat = claimant.seat; state.phase = "DRAW"; assertInvariants(state, seed); continue; }
      const chi = chiCombinations(claimant.hand.map((tile) => tile.type), discard.type, state.joker)[0]; if (chi) { const needed = chi.tileTypes.filter((type) => type !== discard.type).map((type) => take(claimant, type, 1)[0]!); removeDiscarded(current, discard); claimant.melds.push({ id: makeId(seed, `meld-${turn}`), kind: "chi", tiles: [...needed, discard], claimedTileType: discard.type, fromSeat: current.seat }); claimant.opened = true; const forced = claimant.hand.find((tile) => tile.type !== state.joker); if (forced) { claimant.hand = claimant.hand.filter((tile) => tile.tileId !== forced.tileId); claimant.discards.push(forced); } state.currentSeat = claimant.seat; state.phase = "DRAW"; assertInvariants(state, seed); continue; }
    }
    state.currentSeat = (current.seat + 1) % 4; const next = state.players[state.currentSeat]!; const drawn = drawNextTile(state.wall); if (!drawn) { state.phase = "DRAW_ROUND"; assertInvariants(state, seed); return; } next.hand.push(drawn.tile); state.phase = "DRAW"; assertInvariants(state, seed);
  }
  throw new Error(`seed=${seed} deadlock after 400 turns log=${state.log.slice(-20).join(",")}`);
};

export const simulatePots = (potCount: number, seed = 50_000): void => {
  for (let pot = 0; pot < potCount; pot += 1) {
    let progress: TableProgress = { potNumber: pot + 1, roundWind: "EAST", dealerPosition: 0, dealerSeat: 0, continuationCount: 0, totalHandsPlayed: 0 };
    for (let hand = 0; hand < 100; hand += 1) {
      // A deterministic non-dealer result exercises every seat without relying on lucky cards.
      simulateGame(seed + pot * 1000 + hand);
      const result = advanceTableProgress(progress, { dealerWon: false, draw: false, winnerSeat: (progress.dealerSeat + 1) % 4 }); progress = result.progress; if (result.potEnded) break;
    }
    if (progress.roundWind !== "NORTH" || progress.dealerPosition !== 3 || progress.totalHandsPlayed < 16) throw new Error(`pot ${pot + 1} did not traverse four winds`);
  }
};

const games = Number(process.env.SIMULATION_GAMES ?? 10_000); const pots = Number(process.env.SIMULATION_POTS ?? 0);
try { for (let seed = 1; seed <= games; seed += 1) simulateGame(seed); if (pots > 0) simulatePots(pots); console.log(`simulation ok: ${games} deterministic games${pots > 0 ? ` + ${pots} complete pot progressions` : ""}; seed range 1..${games}`); } catch (error) { console.error(error); process.exitCode = 1; }
