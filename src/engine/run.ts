import { type Floor, generateFloor } from "./generate";
import { DIRECTION_VECTORS, type Direction, type Point, step } from "./geometry";
import { canStep, FLOOR_COUNT, indexOf, SIGHT_RADIUS, Tile, tileAt } from "./map";
import { computeVisible } from "./sight";

export interface Hero extends Point {
  /** Which way the sprite faces; changes only on moves with a sideways part. */
  readonly facing: "left" | "right";
}

/** One descent: everything needed to resume exactly where the player left off. */
export interface RunState {
  readonly seed: number;
  readonly turn: number;
  readonly depth: number;
  /** Floors visited so far, one per depth. Unvisited floors are generated on first arrival. */
  readonly floors: readonly Floor[];
  readonly hero: Hero;
}

export type Action =
  | { readonly type: "move"; readonly direction: Direction }
  | { readonly type: "wait" }
  | { readonly type: "use-stairs" };

/** What happened during an action, for the renderer and the message log. */
export type GameEvent =
  | {
      readonly type: "moved";
      readonly from: Point;
      readonly to: Point;
      readonly direction: Direction;
    }
  | { readonly type: "blocked"; readonly direction: Direction }
  | { readonly type: "waited" }
  | { readonly type: "changed-floor"; readonly from: number; readonly to: number }
  | { readonly type: "no-stairs" };

export interface ActionResult {
  readonly run: RunState;
  readonly events: readonly GameEvent[];
  /** False when nothing happened (walking into a wall, using stairs that aren't there). */
  readonly tookTurn: boolean;
}

/** What the hero can do on the current tile, for the on-screen prompt. */
export type Interaction = { readonly kind: "descend" | "ascend"; readonly toDepth: number };

export function newRun(seed: number): RunState {
  const floor = generateFloor(seed, 1);
  const hero: Hero = { ...floor.entrance, facing: "right" };
  return { seed, turn: 0, depth: 1, floors: [reveal(floor, hero)], hero };
}

export function currentFloor(run: RunState): Floor {
  const floor = run.floors.find((f) => f.depth === run.depth);
  if (!floor) throw new Error(`Floor ${run.depth} is missing from this run.`);
  return floor;
}

/** Tiles the hero can see right now. */
export function visibleTiles(run: RunState): Set<number> {
  return computeVisible(currentFloor(run).tiles, run.hero, SIGHT_RADIUS);
}

export function availableInteraction(run: RunState): Interaction | null {
  const kind = tileAt(currentFloor(run).tiles, run.hero);
  if (kind === Tile.StairsDown && run.depth < FLOOR_COUNT)
    return { kind: "descend", toDepth: run.depth + 1 };
  if (kind === Tile.StairsUp && run.depth > 1) return { kind: "ascend", toDepth: run.depth - 1 };
  return null;
}

/** Applies one player action. The input run is never modified. */
export function applyAction(run: RunState, action: Action): ActionResult {
  switch (action.type) {
    case "move":
      return move(run, action.direction);
    case "wait":
      return { run: { ...run, turn: run.turn + 1 }, events: [{ type: "waited" }], tookTurn: true };
    case "use-stairs":
      return takeStairs(run);
  }
}

function move(run: RunState, direction: Direction): ActionResult {
  const floor = currentFloor(run);
  if (!canStep(floor.tiles, run.hero, direction)) {
    return { run, events: [{ type: "blocked", direction }], tookTurn: false };
  }
  const to = step(run.hero, direction);
  const dx = DIRECTION_VECTORS[direction].x;
  const facing = dx > 0 ? "right" : dx < 0 ? "left" : run.hero.facing;
  const hero: Hero = { ...to, facing };
  const moved: RunState = {
    ...run,
    turn: run.turn + 1,
    hero,
    floors: replaceFloor(run.floors, reveal(floor, hero)),
  };
  return {
    run: moved,
    events: [{ type: "moved", from: { x: run.hero.x, y: run.hero.y }, to, direction }],
    tookTurn: true,
  };
}

function takeStairs(run: RunState): ActionResult {
  const interaction = availableInteraction(run);
  if (!interaction) return { run, events: [{ type: "no-stairs" }], tookTurn: false };

  const toDepth = interaction.toDepth;
  const existing = run.floors.find((f) => f.depth === toDepth);
  const target = existing ?? generateFloor(run.seed, toDepth);
  // Going down lands on the next floor's up stairs; going up lands on the previous floor's down stairs.
  const arrival = interaction.kind === "descend" ? target.entrance : target.downStairs;
  if (!arrival) throw new Error(`Floor ${toDepth} has no stairs to arrive on.`);

  const hero: Hero = { ...arrival, facing: run.hero.facing };
  const revealed = reveal(target, hero);
  const floors = existing ? replaceFloor(run.floors, revealed) : [...run.floors, revealed];
  return {
    run: { ...run, turn: run.turn + 1, depth: toDepth, hero, floors },
    events: [{ type: "changed-floor", from: run.depth, to: toDepth }],
    tookTurn: true,
  };
}

function replaceFloor(floors: readonly Floor[], floor: Floor): Floor[] {
  return floors.map((f) => (f.depth === floor.depth ? floor : f));
}

/** Marks what the hero can see from `at` as explored. Returns the same floor if nothing is new. */
function reveal(floor: Floor, at: Point): Floor {
  const visible = computeVisible(floor.tiles, at, SIGHT_RADIUS);
  let changed = false;
  const explored = floor.explored.slice();
  for (const index of visible) {
    if (!explored[index]) {
      explored[index] = true;
      changed = true;
    }
  }
  return changed ? { ...floor, explored } : floor;
}

/** Whether the hero has seen this tile on the current floor; used to limit click-to-walk routes. */
export function isExplored(run: RunState, p: Point): boolean {
  return currentFloor(run).explored[indexOf(p)] === true;
}
