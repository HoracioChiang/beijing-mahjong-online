import type { Meld, MeldKind } from "./types.js";
export type { Meld, MeldKind } from "./types.js";
export { canAddKong, canAnKong, canMingKong, canPeng, chiCombinations } from "./actions.js";
export const meldTileTypes = (meld: Meld): number[] => meld.tiles.map((tile) => tile.type);
export const isOpenMeld = (kind: MeldKind): boolean => kind === "chi" || kind === "peng" || kind === "ming-kong" || kind === "add-kong";
