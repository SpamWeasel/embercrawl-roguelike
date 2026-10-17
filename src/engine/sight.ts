import type { Point } from "./geometry";
import { inBounds, indexOf, isWalkable, MAP_HEIGHT, MAP_WIDTH, type TileKind, tileAt } from "./map";

/**
 * Tiles visible from `origin` within `radius` (Euclidean). Open tiles need a clear line of sight;
 * walls are shown when they have one or when they border a visible open tile, so room and corridor
 * edges never appear with gaps.
 */
export function computeVisible(
  tiles: readonly TileKind[],
  origin: Point,
  radius: number,
): Set<number> {
  const visible = new Set<number>([indexOf(origin)]);
  const limit = (radius + 0.5) ** 2;
  const nearbyWalls: Point[] = [];

  for (
    let y = Math.max(0, origin.y - radius);
    y <= Math.min(MAP_HEIGHT - 1, origin.y + radius);
    y++
  ) {
    for (
      let x = Math.max(0, origin.x - radius);
      x <= Math.min(MAP_WIDTH - 1, origin.x + radius);
      x++
    ) {
      const dx = x - origin.x;
      const dy = y - origin.y;
      if (dx * dx + dy * dy > limit) continue;
      const target = { x, y };
      if (hasLineOfSight(tiles, origin, target)) visible.add(indexOf(target));
      else if (!isWalkable(tileAt(tiles, target))) nearbyWalls.push(target);
    }
  }

  for (const wall of nearbyWalls) {
    if (bordersVisibleOpenTile(tiles, wall, visible)) visible.add(indexOf(wall));
  }
  return visible;
}

/**
 * Whether two tiles can see each other. A straight grid line can clip a wall corner going one way
 * but not the other, so both directions are tried; this also makes sight symmetric (if A sees B,
 * B sees A), which monsters will rely on.
 */
export function hasLineOfSight(tiles: readonly TileKind[], from: Point, to: Point): boolean {
  return isLineClear(tiles, from, to) || isLineClear(tiles, to, from);
}

/**
 * Walks one grid line from `from` to `to`. Every tile strictly between them must be open, and a
 * diagonal step may not slip between two walls that touch at a corner (matching the movement rule).
 */
function isLineClear(tiles: readonly TileKind[], from: Point, to: Point): boolean {
  const blocks = (x: number, y: number) => !isWalkable(tileAt(tiles, { x, y }));
  const dx = Math.abs(to.x - from.x);
  const dy = -Math.abs(to.y - from.y);
  const sx = Math.sign(to.x - from.x);
  const sy = Math.sign(to.y - from.y);
  let error = dx + dy;
  let x = from.x;
  let y = from.y;

  while (x !== to.x || y !== to.y) {
    if ((x !== from.x || y !== from.y) && blocks(x, y)) return false;
    const doubled = 2 * error;
    const moveX = doubled >= dy;
    const moveY = doubled <= dx;
    if (moveX && moveY && blocks(x + sx, y) && blocks(x, y + sy)) return false;
    if (moveX) {
      error += dy;
      x += sx;
    }
    if (moveY) {
      error += dx;
      y += sy;
    }
  }
  return true;
}

function bordersVisibleOpenTile(
  tiles: readonly TileKind[],
  wall: Point,
  visible: ReadonlySet<number>,
): boolean {
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const neighbor = { x: wall.x + ox, y: wall.y + oy };
      if (!inBounds(neighbor) || (ox === 0 && oy === 0)) continue;
      if (isWalkable(tileAt(tiles, neighbor)) && visible.has(indexOf(neighbor))) return true;
    }
  }
  return false;
}
