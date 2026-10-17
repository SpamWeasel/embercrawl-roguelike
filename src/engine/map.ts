import { DIRECTION_VECTORS, type Direction, type Point, step } from "./geometry";

export const MAP_WIDTH = 32;
export const MAP_HEIGHT = 16;
export const MAP_SIZE = MAP_WIDTH * MAP_HEIGHT;
export const FLOOR_COUNT = 30;

/** Tile kinds, stored as small numbers to keep save files compact. */
export const Tile = {
  Wall: 0,
  Floor: 1,
  StairsDown: 2,
  StairsUp: 3,
} as const;
export type TileKind = (typeof Tile)[keyof typeof Tile];

export function inBounds(p: Point): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < MAP_WIDTH && p.y < MAP_HEIGHT;
}

/** Position in the flat, row-major tile arrays. */
export function indexOf(p: Point): number {
  return p.y * MAP_WIDTH + p.x;
}

export function pointOf(index: number): Point {
  return { x: index % MAP_WIDTH, y: Math.floor(index / MAP_WIDTH) };
}

/** The tile at a position; anything outside the map counts as wall. */
export function tileAt(tiles: readonly TileKind[], p: Point): TileKind {
  return inBounds(p) ? (tiles[indexOf(p)] ?? Tile.Wall) : Tile.Wall;
}

export function isWalkable(kind: TileKind): boolean {
  return kind !== Tile.Wall;
}

/**
 * Whether one step in `direction` is allowed: the target must be walkable, and a diagonal step may
 * not squeeze between two walls that touch at a corner. Passing a single wall corner is fine.
 * The same rule applies to the hero and to monsters.
 */
export function canStep(tiles: readonly TileKind[], from: Point, direction: Direction): boolean {
  if (!isWalkable(tileAt(tiles, step(from, direction)))) return false;
  const { x, y } = DIRECTION_VECTORS[direction];
  if (x === 0 || y === 0) return true;
  const sideA = tileAt(tiles, { x: from.x + x, y: from.y });
  const sideB = tileAt(tiles, { x: from.x, y: from.y + y });
  return isWalkable(sideA) || isWalkable(sideB);
}
