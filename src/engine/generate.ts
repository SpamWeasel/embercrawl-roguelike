import { CREATURES, type CreatureKind, type Monster } from "./creatures";
import { chebyshevDistance, type Point, samePoint } from "./geometry";
import {
  ARMORS,
  CACHE,
  type FloorItem,
  type GearId,
  type GearKind,
  type LootId,
  SUPPLIES,
  type SupplyId,
  TRAPS,
  type Trap,
  WEAPONS,
} from "./items";
import { FLOOR_COUNT, indexOf, MAP_SIZE, pointOf, Tile, type TileKind } from "./map";
import { stepDistances } from "./path";
import { Rng } from "./rng";
import {
  CREATURE_LIFESPAN,
  creatureCount,
  GEAR_FIRST_FLOOR,
  GEAR_SLOT_BIAS,
  gearWeight,
  hasCache,
  NEW_CREATURE_WINDOW,
  recoverySupply,
  SPAWN_CLEARANCE,
  scaledStats,
  supplyCount,
  supplyWeight,
  TRAP_CLEARANCE,
  trapCount,
  trapPower,
  trapWeight,
} from "./rules";

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
  /** A warded resting place: creatures can't enter it or strike someone on it. */
  readonly camp: Point | null;
  /** Each camp can be rested at once. */
  readonly campUsed: boolean;
  /** Living creatures on this floor. */
  readonly monsters: readonly Monster[];
  /** Supplies, gear and caches lying on the floor. At most one per tile. */
  readonly items: readonly FloorItem[];
  /** Traps not yet sprung, found or hidden. */
  readonly traps: readonly Trap[];
}

/** The camp sits between this share and the next of the farthest walking distance from the entrance. */
const CAMP_DISTANCE_SHARE = [0.3, 0.7] as const;

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

  // Everything below draws from the stream after the layout, so adding or changing it never
  // changes a floor's shape.
  const distances = stepDistances(tiles, entrance);
  const reserved: Point[] = [entrance, ...(downStairs ? [downStairs] : [])];
  const camp = pickCamp(rng, distances, roomTiles, reserved);
  if (camp) reserved.push(camp);
  const monsters = spawnCreatures(rng, depth, tiles, distances, reserved);
  const items = placeItems(rng, depth, tiles, entrance, [...reserved, ...monsters]);
  const traps = placeTraps(rng, depth, tiles, distances, [...reserved, ...monsters, ...items]);

  return {
    depth,
    tiles,
    explored: new Array<boolean>(MAP_SIZE).fill(false),
    upStairs,
    downStairs,
    entrance,
    camp,
    campUsed: false,
    monsters,
    items,
    traps,
  };
}

/** Open floor tiles (not stairs) that nothing else is using. */
function freeTiles(tiles: readonly TileKind[], taken: readonly Point[]): Point[] {
  const free: Point[] = [];
  for (let index = 0; index < tiles.length; index++) {
    if (tiles[index] !== Tile.Floor) continue;
    const point = pointOf(index);
    if (!taken.some((t) => samePoint(t, point))) free.push(point);
  }
  return free;
}

/**
 * Supplies, a cache and a piece of gear, spread around the floor. Floor 1 also leaves a salve
 * right beside the entrance, so the very first find is close at hand.
 */
function placeItems(
  rng: Rng,
  depth: number,
  tiles: readonly TileKind[],
  entrance: Point,
  taken: readonly Point[],
): FloorItem[] {
  const free = freeTiles(tiles, taken);
  const items: FloorItem[] = [];
  const put = (item: LootId, choices: readonly Point[]) => {
    if (choices.length === 0) return;
    const at = rng.pick(choices);
    free.splice(
      free.findIndex((p) => samePoint(p, at)),
      1,
    );
    items.push({ id: `${depth}-i${items.length + 1}`, item, x: at.x, y: at.y });
  };
  // Keep finds apart where there's room, so they don't clump together.
  const apart = () => {
    const spread = free.filter((p) => items.every((item) => chebyshevDistance(item, p) > 1));
    return spread.length > 0 ? spread : free;
  };

  if (depth === 1)
    put(
      "salve",
      free.filter((p) => chebyshevDistance(p, entrance) === 1),
    );
  for (let i = 0; i < supplyCount(depth); i++) put(pickSupply(rng, depth), apart());
  const recovery = recoverySupply(depth);
  if (recovery) put(recovery, apart());
  if (hasCache(depth)) put(CACHE, apart());
  if (depth >= GEAR_FIRST_FLOOR) put(pickGear(rng, depth), apart());
  return items;
}

export function pickSupply(rng: Rng, depth: number): SupplyId {
  const pool = SUPPLIES.filter((s) => supplyWeight(s.id, depth) > 0);
  return weightedPick(rng, pool, (s) => supplyWeight(s.id, depth)).id;
}

/** Even floors favor weapons and odd floors armor; recent tiers are the most common. */
function pickGear(rng: Rng, depth: number): GearId {
  const weapons: readonly GearKind[] = WEAPONS;
  const armors: readonly GearKind[] = ARMORS;
  const [favored, other] = depth % 2 === 0 ? [weapons, armors] : [armors, weapons];
  const found = (rng.chance(GEAR_SLOT_BIAS) ? favored : other).filter((g) => !g.starter);
  const guardianFloor = CREATURES.some((c) => "guardian" in c && c.firstFloor === depth);
  const pool = found.filter((g) => gearWeight(g.tier, depth, guardianFloor) > 0);
  // Every floor in the game has gear in reach; this fallback only guards against catalog changes.
  const chosen =
    pool.length > 0
      ? weightedPick(rng, pool, (g) => gearWeight(g.tier, depth, guardianFloor))
      : (found.filter((g) => g.tier <= depth).at(-1) ?? (found[0] as GearKind));
  return chosen.id as GearId;
}

/** Hidden traps anywhere on open floor, though never right by the entrance. */
function placeTraps(
  rng: Rng,
  depth: number,
  tiles: readonly TileKind[],
  distances: readonly number[],
  taken: readonly Point[],
): Trap[] {
  const free = freeTiles(tiles, taken).filter(
    (p) => (distances[indexOf(p)] ?? -1) > TRAP_CLEARANCE,
  );
  const kinds = TRAPS.filter((t) => t.firstFloor <= depth);
  const traps: Trap[] = [];
  for (let i = 0; i < trapCount(depth) && free.length > 0 && kinds.length > 0; i++) {
    const at = rng.pick(free);
    free.splice(free.indexOf(at), 1);
    const kind = weightedPick(rng, kinds, (t) => trapWeight(t.id)).id;
    traps.push({
      id: `${depth}-t${i + 1}`,
      kind,
      x: at.x,
      y: at.y,
      power: trapPower(kind, depth, rng.int(0, 2)),
      found: false,
    });
  }
  return traps;
}

/** A room tile roughly midway through the floor, so a rest comes partway down. */
function pickCamp(
  rng: Rng,
  distances: readonly number[],
  roomTiles: readonly Point[],
  reserved: readonly Point[],
): Point | null {
  const free = roomTiles.filter((p) => !reserved.some((r) => samePoint(r, p)));
  const farthest = Math.max(...free.map((p) => distances[indexOf(p)] ?? 0));
  const [low, high] = CAMP_DISTANCE_SHARE;
  const middle = free.filter((p) => {
    const share = (distances[indexOf(p)] ?? 0) / farthest;
    return share >= low && share <= high;
  });
  if (middle.length > 0) return rng.pick(middle);
  return free.length > 0 ? rng.pick(free) : null;
}

/**
 * Regular creatures are drawn from those introduced in the last ten floors, favoring the newest,
 * and placed away from the entrance. Guardian floors add their guardian far from the entrance.
 */
function spawnCreatures(
  rng: Rng,
  depth: number,
  tiles: readonly TileKind[],
  distances: readonly number[],
  reserved: readonly Point[],
): Monster[] {
  const open: Point[] = [];
  for (let index = 0; index < tiles.length; index++) {
    const point = pointOf(index);
    const kind = tiles[index] as TileKind;
    if (kind !== Tile.Floor) continue;
    if ((distances[index] ?? -1) <= SPAWN_CLEARANCE) continue;
    if (reserved.some((r) => samePoint(r, point))) continue;
    open.push(point);
  }

  const pool = CREATURES.filter(
    (c) => !("guardian" in c) && c.firstFloor <= depth && c.firstFloor > depth - CREATURE_LIFESPAN,
  );
  const weight = (c: CreatureKind) => (c.firstFloor > depth - NEW_CREATURE_WINDOW - 1 ? 3 : 1);
  const monsters: Monster[] = [];
  const place = (kind: CreatureKind, at: Point) => {
    const { hp, attack } = scaledStats(kind, depth, rng.float());
    monsters.push({
      id: `${depth}-${monsters.length + 1}`,
      kind: kind.id as Monster["kind"],
      x: at.x,
      y: at.y,
      hp,
      maxHp: hp,
      attack,
      alert: false,
      lastSeen: null,
      ready: false,
      facing: rng.chance(0.5) ? "left" : "right",
    });
  };

  const guardian = CREATURES.find((c) => "guardian" in c && c.firstFloor === depth);
  if (guardian && open.length > 0) {
    const farthest = Math.max(...open.map((p) => distances[indexOf(p)] ?? 0));
    const far = open.filter((p) => (distances[indexOf(p)] ?? 0) >= farthest * 0.8);
    const at = rng.pick(far.length > 0 ? far : open);
    open.splice(open.indexOf(at), 1);
    place(guardian, at);
  }

  for (let i = 0; i < creatureCount(depth) && open.length > 0 && pool.length > 0; i++) {
    const at = rng.pick(open);
    open.splice(open.indexOf(at), 1);
    place(weightedPick(rng, pool, weight), at);
  }
  return monsters;
}

function weightedPick<T>(rng: Rng, items: readonly T[], weight: (item: T) => number): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let roll = rng.float() * total;
  for (const item of items) {
    roll -= weight(item);
    if (roll < 0) return item;
  }
  return items[items.length - 1] as T;
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
