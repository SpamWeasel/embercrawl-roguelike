/** Grid coordinates and the eight movement directions. */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const DIRECTIONS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DIRECTION_VECTORS: Readonly<Record<Direction, Point>> = {
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
  nw: { x: -1, y: -1 },
};

export function isDiagonal(direction: Direction): boolean {
  const { x, y } = DIRECTION_VECTORS[direction];
  return x !== 0 && y !== 0;
}

/** The direction matching a delta's signs, e.g. (3, -1) → "ne". Null for (0, 0). */
export function directionFromDelta(dx: number, dy: number): Direction | null {
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  return (
    DIRECTIONS.find((d) => DIRECTION_VECTORS[d].x === sx && DIRECTION_VECTORS[d].y === sy) ?? null
  );
}

export function step(from: Point, direction: Direction): Point {
  const { x, y } = DIRECTION_VECTORS[direction];
  return { x: from.x + x, y: from.y + y };
}

/** Moves needed between two tiles when diagonal steps count as one. */
export function chebyshevDistance(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}
