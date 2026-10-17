import { type CreatureId, creatureKind, type Monster } from "../../src/engine/creatures";
import type { Floor } from "../../src/engine/generate";
import type { Point } from "../../src/engine/geometry";
import { MAP_HEIGHT, MAP_SIZE, MAP_WIDTH, Tile, type TileKind } from "../../src/engine/map";
import { Rng } from "../../src/engine/rng";
import type { Hero, Lantern, RunState } from "../../src/engine/run";

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
  readonly turn?: number;
  readonly seed?: number;
}

/** A one-floor run on a hand-drawn map, for testing combat rules in isolation. */
export function arena(rows: readonly string[], options: ArenaOptions): RunState {
  const { hero, monsters = [], camp = null, lantern = {}, turn = 0, seed = 1 } = options;
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
  };
  return {
    seed,
    turn,
    depth: 1,
    floors: [floor],
    hero: { facing: "right", hp: 30, maxHp: 30, level: 1, xp: 0, shield: 0, ...hero },
    lantern: { charge: 100, bright: false, ...lantern },
    rng: Rng.fromSeed(seed).state(),
    kills: 0,
    discovered: [],
    status: "active",
    killedBy: null,
  };
}
