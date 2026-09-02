import {
  calculateTing,
  isJoker,
  type Meld,
  type Tile,
  type TileType
} from "@beijing-mahjong/mahjong-core";
import type { ReactionPayload } from "@beijing-mahjong/shared";

export interface BotPlayerSnapshot {
  hand: readonly Tile[];
  melds: readonly Meld[];
}

export interface BotDecisionContext {
  jokerType: TileType | null;
  legalActions: ReadonlyArray<Record<string, unknown>>;
  visibleCounts?: readonly number[];
}

export interface BotStrategy {
  chooseDiscard(player: BotPlayerSnapshot, context: BotDecisionContext): string | null;
  chooseReaction(player: BotPlayerSnapshot, context: BotDecisionContext): ReactionPayload;
  chooseAnGang(context: BotDecisionContext): TileType | null;
  chooseBuGang(context: BotDecisionContext): TileType | null;
}

const typeOf = (action: Record<string, unknown>): TileType | null => typeof action.tileType === "number" ? action.tileType as TileType : null;

/** A deterministic, intentionally modest strategy. It prefers safe shape improvements over random discards. */
export class SimpleBotStrategy implements BotStrategy {
  chooseDiscard(player: BotPlayerSnapshot, context: BotDecisionContext): string | null {
    const candidates = player.hand.filter((tile) => !isJoker(tile.type, context.jokerType));
    if (!candidates.length) return null;
    let best = candidates[0]!;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const candidate of candidates) {
      const after = player.hand.filter((tile) => tile.tileId !== candidate.tileId).map((tile) => tile.type);
      const waits = calculateTing({ concealed: after, openMelds: player.melds, jokerType: context.jokerType, visibleCounts: context.visibleCounts }).reduce((sum, ting) => sum + Math.max(1, ting.remainingVisibleCount), 0);
      const sameType = player.hand.filter((tile) => tile.tileId !== candidate.tileId && tile.type === candidate.type).length;
      const rank = candidate.type < 27 ? candidate.type % 9 : null;
      const neighbourCount = rank === null ? 0 : player.hand.filter((tile) => {
        const otherRank = tile.type < 27 && tile.type % 9;
        return tile.type < 27 && Math.abs(tile.type - candidate.type) <= 2 && otherRank !== rank;
      }).length;
      const isolatedHonor = candidate.type >= 27 && sameType === 0;
      const isolatedEdge = rank !== null && (rank === 0 || rank === 8) && sameType === 0 && neighbourCount === 0;
      const shapeScore = sameType * 18 + neighbourCount * 5 - (isolatedHonor ? 30 : 0) - (isolatedEdge ? 12 : 0);
      const score = waits * 100 + shapeScore;
      if (score > bestScore || (score === bestScore && candidate.type > best.type)) {
        best = candidate;
        bestScore = score;
      }
    }
    return best.tileId;
  }

  chooseReaction(_player: BotPlayerSnapshot, context: BotDecisionContext): ReactionPayload {
    const actions = context.legalActions;
    const hu = actions.find((action) => action.kind === "hu");
    if (hu) return { actionId: crypto.randomUUID(), version: 0, kind: "hu" };
    const kong = actions.find((action) => action.kind === "kong");
    if (kong) return { actionId: crypto.randomUUID(), version: 0, kind: "kong", kongKind: kong.kongKind as "concealed" | "added" };
    const peng = actions.find((action) => action.kind === "peng");
    if (peng) return { actionId: crypto.randomUUID(), version: 0, kind: "peng" };
    const chi = actions.find((action) => action.kind === "chi");
    if (chi) return { actionId: crypto.randomUUID(), version: 0, kind: "chi", tileTypes: chi.tileTypes as number[] };
    return { actionId: crypto.randomUUID(), version: 0, kind: "pass" };
  }

  chooseAnGang(context: BotDecisionContext): TileType | null {
    return typeOf(context.legalActions.find((action) => action.kind === "kong" && action.kongKind === "concealed") ?? {});
  }

  chooseBuGang(context: BotDecisionContext): TileType | null {
    return typeOf(context.legalActions.find((action) => action.kind === "kong" && action.kongKind === "added") ?? {});
  }
}
