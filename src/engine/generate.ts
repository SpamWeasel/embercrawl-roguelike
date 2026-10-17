import type { Point } from "./geometry";
import { FLOOR_COUNT, indexOf, MAP_SIZE, Tile, type TileKind } from "./map";
import { stepDistances } from "./path";
import { Rng } from "./rng";

export interface Floor {
  readonly depth: number;
  readonly tiles: readonly TileKind[];
  /** Tiles the hero has seen at least once on this floor. */
  readonly explored: readonly boolean[];
  /** Null on floor 1, which has no way up. */
  readonly upStairs: Point | null;
  /** Null on the final floor. */
  readonly downStairs: Point | null;
  /** Where the hero appears when arriving from above: the start tile on floor 1, else the up stairs. */
  readonly entrance: Point;
}

/** The map is a 4 × 2 grid of 8 × 8 cells; each holds a room or a corridor junction. */
const CELL_COLUMNS = 4;
const CELL_ROWS = 2;
const CELL_SIZE = 8;
/** Extra connections beyond the minimum, so some floors have loops to circle through. */
const EXTRA_LINK_CHANCE = 0.3;
/** Down stairs are chosen among room tiles at least this share of the farthest walking distance away. */
const STAIRS_FAR_SHARE = 0.7;

interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Junctions are single corridor crossings, not rooms; stairs never go there. */
  junction: boolean;
}

/**
 * Builds floor `depth` of the run with this seed. Each floor uses its own random stream, so it comes
 * out the same no matter when, or in what order, floors are first visited.
 */
export function generateFloor(seed: number, depth: number): Floor {
  if (!Number.isInteger(depth) || depth < 1 || depth > FLOOR_COUNT) {
    throw new RangeError(`Floor depth must be 1-${FLOOR_COUNT}, got ${depth}.`);
  }
  const rng = Rng.derive(seed, "floor", depth);
  const tiles = new Array<TileKind>(MAP_SIZE).fill(Tile.Wall);

  const areas = layoutAreas(rng);
  for (const area of areas) carveRect(tiles, area.x, area.y, area.width, area.height);
  for (const [a, b] of chooseLinks(rng)) {
    carveCorridor(
      tiles,
      rng,
      randomPointIn(rng, areas[a] as Area),
      randomPointIn(rng, areas[b] as Area),
    );
  }

  const roomTiles = areas.filter((area) => !area.junction).flatMap(pointsIn);
  const entrance = rng.pick(roomTiles);
  const upStairs = depth > 1 ? entrance : null;
  const downStairs = depth < FLOOR_COUNT ? pickFarTile(tiles, rng, entrance, roomTiles) : null;
  if (upStairs) tiles[indexOf(upStairs)] = Tile.StairsUp;
  if (downStairs) tiles[indexOf(downStairs)] = Tile.StairsDown;

  return {
    depth,
    tiles,
    explored: new Array<boolean>(MAP_SIZE).fill(false),
    upStairs,
    downStairs,
    entrance,
  };
}

function layoutAreas(rng: Rng): Area[] {
  const cellCount = CELL_COLUMNS * CELL_ROWS;
  const junctionCount = rng.int(0, 2);
  const junctionCells = new Set(rng.shuffle([...Array(cellCount).keys()]).slice(0, junctionCount));
  const areas: Area[] = [];
  for (let row = 0; row < CELL_ROWS; row++) {
    for (let column = 0; column < CELL_COLUMNS; column++) {
      const cellX = column * CELL_SIZE;
      const cellY = row * CELL_SIZE;
      if (junctionCells.has(areas.length)) {
        areas.push({
          x: cellX + rng.int(2, 5),
          y: cellY + rng.int(2, 5),
          width: 1,
          height: 1,
          junction: true,
        });
        continue;
      }
      // Rooms keep a one-tile wall margin inside their cell, so cells never merge into one blob.
      const width = rng.int(3, 6);
      const height = rng.int(3, 5);
      areas.push({
        x: cellX + 1 + rng.int(0, CELL_SIZE - 2 - width),
        y: cellY + 1 + rng.int(0, CELL_SIZE - 2 - height),
        width,
        height,
        junction: false,
      });
    }
  }
  return areas;
}

/** Links between neighboring cells: a random spanning tree (everything connected) plus a few extras. */
function chooseLinks(rng: Rng): Array<readonly [number, number]> {
  const neighbors: Array<readonly [number, number]> = [];
  for (let row = 0; row < CELL_ROWS; row++) {
    for (let column = 0; column < CELL_COLUMNS; column++) {
      const cell = row * CELL_COLUMNS + column;
      if (column + 1 < CELL_COLUMNS) neighbors.push([cell, cell + 1]);
      if (row + 1 < CELL_ROWS) neighbors.push([cell, cell + CELL_COLUMNS]);
    }
  }

  const connected = new Set<number>([rng.int(0, CELL_COLUMNS * CELL_ROWS - 1)]);
  const links: Array<readonly [number, number]> = [];
  const unused = new Set(neighbors);
  while (connected.size < CELL_COLUMNS * CELL_ROWS) {
    const frontier = [...unused].filter(([a, b]) => connected.has(a) !== connected.has(b));
    const link = rng.pick(frontier);
    links.push(link);
    unused.delete(link);
    connected.add(link[0]);
    connected.add(link[1]);
  }
  for (const link of unused) if (rng.chance(EXTRA_LINK_CHANCE)) links.push(link);
  return links;
}

function carveRect(tiles: TileKind[], x: number, y: number, width: number, height: number): void {
  for (let ty = y; ty < y + height; ty++) {
    for (let tx = x; tx < x + width; tx++) tiles[indexOf({ x: tx, y: ty })] = Tile.Floor;
  }
}

/** An L-shaped corridor; which leg comes first is random. */
function carveCorridor(tiles: TileKind[], rng: Rng, from: Point, to: Point): void {
  const corner = rng.chance(0.5) ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  carveLine(tiles, from, corner);
  carveLine(tiles, corner, to);
}

function carveLine(tiles: TileKind[], from: Point, to: Point): void {
  const sx = Math.sign(to.x - from.x);
  const sy = Math.sign(to.y - from.y);
  let x = from.x;
  let y = from.y;
  tiles[indexOf({ x, y })] = Tile.Floor;
  while (x !== to.x || y !== to.y) {
    x += sx;
    y += sy;
    tiles[indexOf({ x, y })] = Tile.Floor;
  }
}

function pointsIn(area: Area): Point[] {
  const points: Point[] = [];
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) points.push({ x, y });
  }
  return points;
}

function randomPointIn(rng: Rng, area: Area): Point {
  return { x: area.x + rng.int(0, area.width - 1), y: area.y + rng.int(0, area.height - 1) };
}

/** A room tile far from `start` by walking distance, but not always the single farthest one. */
function pickFarTile(
  tiles: readonly TileKind[],
  rng: Rng,
  start: Point,
  candidates: readonly Point[],
): Point {
  const distances = stepDistances(tiles, start);
  const reachable = candidates.filter((p) => (distances[indexOf(p)] ?? -1) > 0);
  const farthest = Math.max(...reachable.map((p) => distances[indexOf(p)] as number));
  const far = reachable.filter(
    (p) => (distances[indexOf(p)] as number) >= farthest * STAIRS_FAR_SHARE,
  );
  return rng.pick(far);
}
