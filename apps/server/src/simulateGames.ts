import { analyzeHu, BeijingDefaultRules, calculateScore, canMingKong, canPeng, chiCombinations, createWall, nextJokerType, seededRandom, type Meld, type Tile, type TileType } from "@beijing-mahjong/mahjong-core";

type SimPlayer = { id: string; seat: number; hand: Tile[]; melds: Meld[]; discards: Tile[]; opened: boolean };
type SimState = { wall: Tile[]; dead: Tile[]; indicator: Tile; joker: TileType; players: SimPlayer[]; phase: "DRAW" | "REACTION" | "SETTLEMENT" | "DRAW_ROUND"; currentSeat: number; log: string[] };
const makeId = (seed: number, suffix: string) => `sim-${seed}-${suffix}`;
const take = (player: SimPlayer, type: TileType, amount: number): Tile[] => { const found = player.hand.filter((tile) => tile.type === type).slice(0, amount); if (found.length !== amount) throw new Error(`not enough type=${type}`); player.hand = player.hand.filter((tile) => !found.includes(tile)); return found; };
const removeClaimedDiscard = (player: SimPlayer, tile: Tile): void => { const index = player.discards.findIndex((candidate) => candidate.tileId === tile.tileId); if (index < 0) throw new Error(`claimed tile ${tile.tileId} was not in discard`); player.discards.splice(index, 1); };

const assertInvariants = (state: SimState, seed: number): void => {
  const all = [...state.wall, ...state.dead, state.indicator, ...state.players.flatMap((player) => [...player.hand, ...player.discards, ...player.melds.flatMap((meld) => meld.tiles)])];
  if (all.length !== 136) throw new Error(`seed=${seed} tile total=${all.length}`);
  const ids = new Set(all.map((tile) => tile.tileId)); if (ids.size !== 136) throw new Error(`seed=${seed} duplicate entity`);
  for (let type = 0; type < 34; type += 1) { const count = all.filter((tile) => tile.type === type).length; if (count !== 4) throw new Error(`seed=${seed} type=${type} count=${count}`); }
  if (!["DRAW", "REACTION", "SETTLEMENT", "DRAW_ROUND"].includes(state.phase)) throw new Error(`seed=${seed} invalid phase`);
};

const settle = (state: SimState, winner: SimPlayer, winningType: TileType, selfDraw: boolean, discarder?: SimPlayer): void => {
  const winning = analyzeHu({ concealed: winner.hand.map((tile) => tile.type), openMelds: winner.melds, jokerType: state.joker, winningTileType: winningType, isSelfDraw: selfDraw });
  if (!winning.isHu) throw new Error("simulation selected an illegal hu");
  const players = state.players.map((player) => ({ playerId: player.id, nickname: player.id, seat: player.seat, isDealer: player.seat === 0 }));
  const score = calculateScore({ winnerId: winner.id, winnerName: winner.id, allPlayers: players, winnerSeat: winner.seat, dealerSeat: 0, concealed: winner.hand.map((tile) => tile.type), openMelds: winner.melds, winning, jokerType: state.joker, winningTileType: winningType, isSelfDraw: selfDraw, discarderId: discarder?.id }, BeijingDefaultRules);
  if (Object.values(score.deltas).reduce((a, b) => a + b, 0) !== 0) throw new Error("simulation non-zero settlement");
  state.phase = "SETTLEMENT";
};

const simulateGame = (seed: number): void => {
  const random = seededRandom(seed); const wall = createWall(random); const dealt = wall.splice(0, 53); const indicator = wall.shift(); if (!indicator) throw new Error("no indicator"); const dead = wall.splice(wall.length - 14, 14);
  const players: SimPlayer[] = Array.from({ length: 4 }, (_, seat) => ({ id: makeId(seed, `p${seat}`), seat, hand: [], melds: [], discards: [], opened: false })); let cursor = 0; players[0]!.hand = dealt.slice(cursor, cursor + 14); cursor += 14; for (let seat = 1; seat < 4; seat += 1) { players[seat]!.hand = dealt.slice(cursor, cursor + 13); cursor += 13; }
  const state: SimState = { wall, dead, indicator, joker: nextJokerType(indicator.type), players, phase: "DRAW", currentSeat: 0, log: [] }; assertInvariants(state, seed);
  for (let turn = 0; turn < 400; turn += 1) {
    const current = state.players[state.currentSeat]!; current.hand.sort((a, b) => a.type - b.type); const canWin = analyzeHu({ concealed: current.hand.map((tile) => tile.type), openMelds: current.melds, jokerType: state.joker, isSelfDraw: true }).isHu;
    if (canWin) { settle(state, current, current.hand[current.hand.length - 1]!.type, true); return; }
    const discard = current.hand.find((tile) => tile.type !== state.joker) ?? current.hand[0]; if (!discard) throw new Error("empty hand before discard"); current.hand = current.hand.filter((tile) => tile.tileId !== discard.tileId); current.discards.push(discard); state.log.push(`s${current.seat}:discard:${discard.tileId}`); state.phase = "REACTION"; assertInvariants(state, seed);
    const others = [1, 2, 3].map((offset) => state.players[(current.seat + offset) % 4]!); const ron = others.find((player) => !player.opened && analyzeHu({ concealed: [...player.hand.map((tile) => tile.type), discard.type], openMelds: player.melds, jokerType: state.joker, winningTileType: discard.type, isSelfDraw: false }).isHu);
    if (ron) { removeClaimedDiscard(current, discard); ron.hand.push(discard); settle(state, ron, discard.type, false, current); return; }
    const possible = others.filter((player) => canMingKong(player.hand.map((tile) => tile.type), discard.type, state.joker) || canPeng(player.hand.map((tile) => tile.type), discard.type, state.joker) || player.seat === (current.seat + 1) % 4 && chiCombinations(player.hand.map((tile) => tile.type), discard.type, state.joker).length > 0);
    const claimant = possible.length && random() < 0.16 ? possible[Math.floor(random() * possible.length)] : undefined;
    if (claimant) {
      if (canMingKong(claimant.hand.map((tile) => tile.type), discard.type, state.joker) && random() < 0.2) { const taken = take(claimant, discard.type, 3); removeClaimedDiscard(current, discard); claimant.melds.push({ id: makeId(seed, `meld-${turn}`), kind: "ming-kong", tiles: [...taken, discard], claimedTileType: discard.type, fromSeat: current.seat }); claimant.opened = true; const replacement = state.dead.pop(); if (!replacement) { state.phase = "DRAW_ROUND"; return; } claimant.hand.push(replacement); state.currentSeat = claimant.seat; state.phase = "DRAW"; assertInvariants(state, seed); continue; }
      if (canPeng(claimant.hand.map((tile) => tile.type), discard.type, state.joker)) { const taken = take(claimant, discard.type, 2); removeClaimedDiscard(current, discard); claimant.melds.push({ id: makeId(seed, `meld-${turn}`), kind: "peng", tiles: [...taken, discard], claimedTileType: discard.type, fromSeat: current.seat }); claimant.opened = true; const forcedDiscard = claimant.hand.find((tile) => tile.type !== state.joker) ?? claimant.hand[0]; if (forcedDiscard) { claimant.hand = claimant.hand.filter((tile) => tile.tileId !== forcedDiscard.tileId); claimant.discards.push(forcedDiscard); } state.currentSeat = claimant.seat; state.phase = "DRAW"; assertInvariants(state, seed); continue; }
      const chi = chiCombinations(claimant.hand.map((tile) => tile.type), discard.type, state.joker)[0]; if (chi) { const needed = chi.tileTypes.filter((type) => type !== discard.type).map((type) => take(claimant, type, 1)[0]!); removeClaimedDiscard(current, discard); claimant.melds.push({ id: makeId(seed, `meld-${turn}`), kind: "chi", tiles: [...needed, discard], claimedTileType: discard.type, fromSeat: current.seat }); claimant.opened = true; const forcedDiscard = claimant.hand.find((tile) => tile.type !== state.joker) ?? claimant.hand[0]; if (forcedDiscard) { claimant.hand = claimant.hand.filter((tile) => tile.tileId !== forcedDiscard.tileId); claimant.discards.push(forcedDiscard); } state.currentSeat = claimant.seat; state.phase = "DRAW"; assertInvariants(state, seed); continue; }
    }
    state.currentSeat = (current.seat + 1) % 4; const next = state.players[state.currentSeat]!; const drawn = state.wall.shift(); if (!drawn) { state.phase = "DRAW_ROUND"; return; } next.hand.push(drawn); state.phase = "DRAW"; assertInvariants(state, seed);
  }
  throw new Error(`seed=${seed} deadlock after 400 turns log=${state.log.slice(-20).join(",")}`);
};

const games = Number(process.env.SIMULATION_GAMES ?? 10_000);
try { for (let seed = 1; seed <= games; seed += 1) simulateGame(seed); console.log(`simulation ok: ${games} deterministic games; seed range 1..${games}`); } catch (error) { console.error(error); process.exitCode = 1; }
