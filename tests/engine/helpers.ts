import { type CreatureId, creatureKind, type Monster } from "../../src/engine/creatures";
import type { Floor } from "../../src/engine/generate";
import type { Point } from "../../src/engine/geometry";
import {
  type Equipment,
  type FloorItem,
  type ItemId,
  type LootId,
  type PackEntry,
  type ShopOffer,
  STARTING_ARMOR,
  STARTING_WEAPON,
  type Trap,
  type TrapKind,
} from "../../src/engine/items";
import { MAP_HEIGHT, MAP_SIZE, MAP_WIDTH, Tile, type TileKind } from "../../src/engine/map";
import { emptyPack } from "../../src/engine/pack";
import { Rng } from "../../src/engine/rng";
import { emptyStats, type Hero, type Lantern, type RunState } from "../../src/engine/run";

const SYMBOLS: Readonly<Record<string, TileKind>> = {
  "#": Tile.Wall,
  ".": Tile.Floor,
  ">": Tile.StairsDown,
  "<": Tile.StairsUp,
};

/**
 * Builds a full-size tile array from a small text picture placed at the top-left corner.
 * `#` wall, `.` floor, `>` down stairs, `<` up stairs; everything outside the picture is wall.
 */
export function mapFrom(rows: readonly string[]): TileKind[] {
  const tiles = new Array<TileKind>(MAP_SIZE).fill(Tile.Wall);
  rows.forEach((row, y) => {
    if (y >= MAP_HEIGHT || row.length > MAP_WIDTH) throw new Error("Test map is too large.");
    [...row].forEach((symbol, x) => {
      const kind = SYMBOLS[symbol];
      if (kind === undefined) throw new Error(`Unknown map symbol "${symbol}".`);
      tiles[y * MAP_WIDTH + x] = kind;
    });
  });
  return tiles;
}

/** Recursively freezes test data so any accidental mutation by the engine throws. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** The run with the current floor's creatures removed, for tests about moving rather than fighting. */
export function withoutCreatures(run: RunState): RunState {
  return {
    ...run,
    floors: run.floors.map((f) => (f.depth === run.depth ? { ...f, monsters: [] } : f)),
  };
}

/** The run with the current floor's creatures, items and traps removed: just the layout. */
export function emptyFloor(run: RunState): RunState {
  return {
    ...run,
    floors: run.floors.map((f) =>
      f.depth === run.depth ? { ...f, monsters: [], items: [], traps: [] } : f,
    ),
  };
}

let nextCreature = 1;

/** A creature for an arena, with its catalog stats unless overridden. */
export function creature(kind: CreatureId, at: Point, overrides: Partial<Monster> = {}): Monster {
  const base = creatureKind(kind);
  return {
    id: `t-${nextCreature++}`,
    kind,
    x: at.x,
    y: at.y,
    hp: base.hp,
    maxHp: base.hp,
    attack: base.attack,
    alert: false,
    lastSeen: null,
    ready: false,
    facing: "left",
    ...overrides,
  };
}

export interface ArenaOptions {
  readonly hero: Point & Partial<Hero>;
  readonly monsters?: readonly Monster[];
  readonly camp?: Point | null;
  readonly lantern?: Partial<Lantern>;
  readonly items?: readonly FloorItem[];
  readonly traps?: readonly Trap[];
  /** Pack contents by slot; the rest of the pack is empty. */
  readonly pack?: readonly (PackEntry | null)[];
  readonly equipment?: Partial<Equipment>;
  readonly gold?: number;
  readonly merchant?: Point | null;
  readonly stock?: readonly ShopOffer[];
  readonly beacon?: Point | null;
  readonly turn?: number;
  readonly seed?: number;
}

/** An item lying on an arena floor. */
export function loot(item: LootId, at: Point, id = `t-i${nextCreature++}`): FloorItem {
  return { id, item, x: at.x, y: at.y };
}

/** A trap for an arena floor, hidden unless `found`. */
export function trap(kind: TrapKind, at: Point, power: number, found = false): Trap {
  return { id: `t-t${nextCreature++}`, kind, x: at.x, y: at.y, power, found };
}

/** A pack holding these entries in its first slots. */
export function packOf(...entries: Array<[ItemId, number] | null>): (PackEntry | null)[] {
  const pack = emptyPack().slice();
  entries.forEach((entry, slot) => {
    pack[slot] = entry ? { item: entry[0], count: entry[1] } : null;
  });
  return pack;
}

/** A one-floor run on a hand-drawn map, for testing rules in isolation. */
export function arena(rows: readonly string[], options: ArenaOptions): RunState {
  const { hero, monsters = [], camp = null, lantern = {}, turn = 0, seed = 1 } = options;
  const { items = [], traps = [], pack = emptyPack(), equipment = {} } = options;
  const { gold = 0, merchant = null, stock = [], beacon = null } = options;
  const tiles = mapFrom(rows);
  const stairsIndex = tiles.indexOf(Tile.StairsDown);
  const floor: Floor = {
    depth: 1,
    tiles,
    explored: new Array<boolean>(MAP_SIZE).fill(false),
    upStairs: null,
    downStairs:
      stairsIndex >= 0
        ? { x: stairsIndex % MAP_WIDTH, y: Math.floor(stairsIndex / MAP_WIDTH) }
        : null,
    entrance: { x: hero.x, y: hero.y },
    camp,
    campUsed: false,
    monsters,
    items,
    traps,
    merchant,
    stock,
    beacon,
  };
  return {
    seed,
    turn,
    depth: 1,
    floors: [floor],
    hero: { facing: "right", hp: 30, maxHp: 30, level: 1, xp: 0, shield: 0, ...hero },
    lantern: { charge: 100, bright: false, ...lantern },
    equipment: { weapon: STARTING_WEAPON, armor: STARTING_ARMOR, ...equipment },
    pack: emptyPack().map((_, slot) => pack[slot] ?? null),
    gold,
    stats: emptyStats(),
    rng: Rng.fromSeed(seed).state(),
    kills: 0,
    discovered: [],
    status: "active",
    killedBy: null,
  };
}
