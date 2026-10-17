import type { ItemId, Pack, PackEntry } from "./items";
import { PACK_SLOTS, STACK_LIMIT } from "./rules";

export function emptyPack(): Pack {
  return new Array<PackEntry | null>(PACK_SLOTS).fill(null);
}

/**
 * The pack with one more `item`: on top of an existing stack with room, else in `preferredSlot` if
 * it is empty, else in the first empty slot. Null when there's no room.
 */
export function packAdd(pack: Pack, item: ItemId, preferredSlot?: number): Pack | null {
  const stack = pack.findIndex((entry) => entry?.item === item && entry.count < STACK_LIMIT);
  const slot =
    stack >= 0
      ? stack
      : preferredSlot !== undefined && pack[preferredSlot] === null
        ? preferredSlot
        : pack.indexOf(null);
  if (slot < 0) return null;
  const next = pack.slice();
  const entry = next[slot];
  next[slot] = { item, count: (entry?.count ?? 0) + 1 };
  return next;
}

/** The pack with one item taken from `slot` (which empties when its stack runs out). */
export function packRemoveOne(pack: Pack, slot: number): Pack {
  const entry = pack[slot];
  if (!entry) return pack;
  const next = pack.slice();
  next[slot] = entry.count > 1 ? { item: entry.item, count: entry.count - 1 } : null;
  return next;
}

export function packHasRoom(pack: Pack, item: ItemId): boolean {
  return packAdd(pack, item) !== null;
}

/** How many of `item` the pack holds across all slots. */
export function packCount(pack: Pack, item: ItemId): number {
  return pack.reduce((sum, entry) => sum + (entry?.item === item ? entry.count : 0), 0);
}
