import type { ReactionPayload } from "@beijing-mahjong/shared";

export interface ResolverCandidate {
  playerId: string;
  seat: number;
  response?: ReactionPayload;
}

export interface ResolverWindow {
  discarderSeat: number;
  candidates: ResolverCandidate[];
  multiHuPolicy: "NEAREST_ONLY" | "ALLOW_MULTI_HU" | "BEIJING_SPECIAL";
}

export interface ResolverResult {
  hu: ResolverCandidate[];
  selected?: ResolverCandidate;
}

/** Pure reaction ordering. State mutation stays inside GameRoom after this returns. */
export class ActionResolver {
  static priority(kind: ReactionPayload["kind"]): number {
    if (kind === "hu") return 3;
    if (kind === "kong" || kind === "peng") return 2;
    if (kind === "chi") return 1;
    return 0;
  }

  static distance(discarderSeat: number, seat: number): number { return (seat - discarderSeat + 4) % 4; }

  static resolve(window: ResolverWindow): ResolverResult {
    const active = window.candidates.filter((candidate) => candidate.response && candidate.response.kind !== "pass");
    const hu = active.filter((candidate) => candidate.response?.kind === "hu").sort((a, b) => this.distance(window.discarderSeat, a.seat) - this.distance(window.discarderSeat, b.seat));
    if (hu.length) return { hu: window.multiHuPolicy === "ALLOW_MULTI_HU" ? hu : hu.slice(0, 1), selected: hu[0] };
    const selected = active.sort((a, b) => this.priority(b.response!.kind) - this.priority(a.response!.kind) || this.distance(window.discarderSeat, a.seat) - this.distance(window.discarderSeat, b.seat))[0];
    return { hu: [], selected };
  }
}
