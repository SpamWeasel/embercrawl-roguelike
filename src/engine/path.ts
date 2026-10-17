import { DIRECTIONS, type Direction, type Point, samePoint, step } from "./geometry";
import { canStep, indexOf, MAP_SIZE, type TileKind } from "./map";

/** Straight steps are tried before diagonal ones, which keeps routes looking natural. */
const SEARCH_ORDER: readonly Direction[] = ["n", "e", "s", "w", "ne", "se", "sw", "nw"];

/** Optional extra limit on which tiles a route may enter (for example, only explored ones). */
export type PassableTest = (index: number) => boolean;

/**
 * Steps needed to reach every tile from `from`, following the normal movement rules.
 * Unreachable tiles are -1.
 */
export function stepDistances(
  tiles: readonly TileKind[],
  from: Point,
  passable: PassableTest = () => true,
): number[] {
  const distances = new Array<number>(MAP_SIZE).fill(-1);
  distances[indexOf(from)] = 0;
  const queue: Point[] = [from];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head] as Point;
    const distance = distances[indexOf(current)] as number;
    for (const direction of DIRECTIONS) {
      if (!canStep(tiles, current, direction)) continue;
      const next = step(current, direction);
      const index = indexOf(next);
      if (distances[index] !== -1 || !passable(index)) continue;
      distances[index] = distance + 1;
      queue.push(next);
    }
  }
  return distances;
}

/** The shortest list of steps from `from` to `to`, or null when there is no route. */
export function findPath(
  tiles: readonly TileKind[],
  from: Point,
  to: Point,
  passable: PassableTest = () => true,
): Direction[] | null {
  if (samePoint(from, to)) return [];
  if (!passable(indexOf(to))) return null;
  const cameFrom = new Map<number, { previous: Point; direction: Direction }>();
  const seen = new Set<number>([indexOf(from)]);
  const queue: Point[] = [from];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head] as Point;
    for (const direction of SEARCH_ORDER) {
      if (!canStep(tiles, current, direction)) continue;
      const next = step(current, direction);
      const index = indexOf(next);
      if (seen.has(index) || !passable(index)) continue;
      seen.add(index);
      cameFrom.set(index, { previous: current, direction });
      if (samePoint(next, to)) return traceBack(cameFrom, from, to);
      queue.push(next);
    }
  }
  return null;
}

function traceBack(
  cameFrom: ReadonlyMap<number, { previous: Point; direction: Direction }>,
  from: Point,
  to: Point,
): Direction[] {
  const route: Direction[] = [];
  let current = to;
  while (!samePoint(current, from)) {
    const link = cameFrom.get(indexOf(current));
    if (!link) throw new Error("Route reconstruction failed.");
    route.push(link.direction);
    current = link.previous;
  }
  return route.reverse();
}
