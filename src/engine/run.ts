import { type CreatureId, creatureKind, type Monster } from "./creatures";
import { type Floor, generateFloor } from "./generate";
import {
  chebyshevDistance,
  DIRECTION_VECTORS,
  DIRECTIONS,
  type Direction,
  directionFromDelta,
  type Point,
  samePoint,
  step,
} from "./geometry";
import { canStep, FLOOR_COUNT, indexOf, Tile, tileAt } from "./map";
import { stepDistances } from "./path";
import { Rng, type RngState } from "./rng";
import {
  BRIGHT_COST,
  BRIGHT_SIGHT,
  CAMP_CHARGE,
  CAMP_HEAL_SHARE,
  DIM_SIGHT,
  HERO_START_HP,
  heroAttackPower,
  heroDefense,
  LANTERN_MAX,
  LEVEL_HEAL,
  LEVEL_HP_GAIN,
  PERCEPTION_RANGE,
  PULSE_BONUS_DAMAGE,
  PULSE_COST,
  PULSE_RADIUS,
  PULSE_SHIELD,
  RANGED_REACH,
  xpToNextLevel,
} from "./rules";
import { computeVisible, hasLineOfSight } from "./sight";

export interface Hero extends Point {
  /** Which way the sprite faces; changes only on moves with a sideways part. */
  readonly facing: "left" | "right";
  readonly hp: number;
  readonly maxHp: number;
  readonly level: number;
  /** Experience toward the next level. */
  readonly xp: number;
  /** Absorbs damage before health. */
  readonly shield: number;
}

export interface Lantern {
  readonly charge: number;
  readonly bright: boolean;
}

/** One descent: everything needed to resume exactly where the player left off. */
export interface RunState {
  readonly seed: number;
  readonly turn: number;
  readonly depth: number;
  /** Floors visited so far, one per depth. Unvisited floors are generated on first arrival. */
  readonly floors: readonly Floor[];
  readonly hero: Hero;
  readonly lantern: Lantern;
  /** The gameplay random stream (combat rolls, erratic steps), separate from floor generation. */
  readonly rng: RngState;
  readonly kills: number;
  /** Creature kinds seen during this descent. */
  readonly discovered: readonly CreatureId[];
  readonly status: "active" | "dead";
  readonly killedBy: CreatureId | null;
}

export type Action =
  | { readonly type: "move"; readonly direction: Direction }
  | { readonly type: "wait" }
  | { readonly type: "use-stairs" }
  | { readonly type: "rest" }
  | { readonly type: "toggle-light" }
  | { readonly type: "pulse" };

/** What happened during an action, for animation and the message log. */
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
  | { readonly type: "no-stairs" }
  | {
      readonly type: "attacked";
      readonly target: string;
      readonly kind: CreatureId;
      readonly at: Point;
      readonly direction: Direction;
      readonly damage: number;
    }
  | {
      readonly type: "monster-moved";
      readonly id: string;
      readonly from: Point;
      readonly to: Point;
    }
  | { readonly type: "monster-noticed"; readonly id: string; readonly kind: CreatureId }
  | { readonly type: "monster-readied"; readonly id: string; readonly kind: CreatureId }
  | {
      readonly type: "monster-struck";
      readonly id: string;
      readonly kind: CreatureId;
      readonly from: Point;
      readonly ranged: boolean;
      readonly damage: number;
      readonly absorbed: number;
    }
  | {
      readonly type: "monster-died";
      readonly id: string;
      readonly kind: CreatureId;
      readonly at: Point;
      readonly xp: number;
    }
  | { readonly type: "leveled-up"; readonly level: number }
  | { readonly type: "spotted"; readonly kind: CreatureId }
  | { readonly type: "lantern"; readonly bright: boolean; readonly reason: "toggled" | "empty" }
  | { readonly type: "pulsed"; readonly at: Point; readonly hits: number }
  | { readonly type: "not-enough-charge"; readonly needed: number }
  | { readonly type: "rested"; readonly healed: number; readonly charge: number }
  | { readonly type: "camp-spent" }
  | { readonly type: "died"; readonly by: CreatureId };

export interface ActionResult {
  readonly run: RunState;
  readonly events: readonly GameEvent[];
  /** False when nothing happened (walking into a wall, using stairs that aren't there). */
  readonly tookTurn: boolean;
}

/** What the hero can do on the current tile, for the on-screen prompt. */
export type Interaction =
  | { readonly kind: "descend" | "ascend"; readonly toDepth: number }
  | { readonly kind: "rest" };

export function newRun(seed: number): RunState {
  const floor = generateFloor(seed, 1);
  const hero: Hero = {
    ...floor.entrance,
    facing: "right",
    hp: HERO_START_HP,
    maxHp: HERO_START_HP,
    level: 1,
    xp: 0,
    shield: 0,
  };
  const lantern: Lantern = { charge: LANTERN_MAX, bright: false };
  const revealed = reveal(floor, hero, sightRadius(lantern));
  return {
    seed,
    turn: 0,
    depth: 1,
    floors: [revealed],
    hero,
    lantern,
    rng: Rng.derive(seed, "play").state(),
    kills: 0,
    discovered: spottedKinds(revealed, hero, lantern, []),
    status: "active",
    killedBy: null,
  };
}

export function currentFloor(run: RunState): Floor {
  const floor = run.floors.find((f) => f.depth === run.depth);
  if (!floor) throw new Error(`Floor ${run.depth} is missing from this run.`);
  return floor;
}

export function sightRadius(lantern: Lantern): number {
  return lantern.bright ? BRIGHT_SIGHT : DIM_SIGHT;
}

/** Tiles the hero can see right now. */
export function visibleTiles(run: RunState): Set<number> {
  return computeVisible(currentFloor(run).tiles, run.hero, sightRadius(run.lantern));
}

export function availableInteraction(run: RunState): Interaction | null {
  const floor = currentFloor(run);
  const kind = tileAt(floor.tiles, run.hero);
  if (kind === Tile.StairsDown && run.depth < FLOOR_COUNT)
    return { kind: "descend", toDepth: run.depth + 1 };
  if (kind === Tile.StairsUp && run.depth > 1) return { kind: "ascend", toDepth: run.depth - 1 };
  if (floor.camp && samePoint(floor.camp, run.hero) && !floor.campUsed) return { kind: "rest" };
  return null;
}

/** Whether the hero is standing on this floor's camp, where creatures can't reach them. */
export function onCamp(run: RunState): boolean {
  const camp = currentFloor(run).camp;
  return camp !== null && samePoint(camp, run.hero);
}

/** Applies one player action, then lets creatures respond. The input run is never modified. */
export function applyAction(run: RunState, action: Action): ActionResult {
  if (run.status !== "active") return { run, events: [], tookTurn: false };
  if (action.type === "use-stairs") return takeStairs(run);

  const turn = new Turn(run);
  const acted = turn.heroActs(action);
  if (!acted) return { run, events: turn.events, tookTurn: false };
  turn.burnLantern();
  turn.creaturesAct();
  return { run: turn.finish(), events: turn.events, tookTurn: true };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Working state for one action, applied to copies and frozen into a new run at the end. */
class Turn {
  readonly events: GameEvent[] = [];
  private readonly rng: Rng;
  private readonly floor: Floor;
  private readonly hero: Mutable<Hero>;
  private readonly lantern: Mutable<Lantern>;
  private monsters: Mutable<Monster>[];
  private campUsed: boolean;
  private turnNumber: number;
  private kills: number;
  private status: RunState["status"];
  private killedBy: CreatureId | null;

  constructor(private readonly run: RunState) {
    this.rng = Rng.fromState(run.rng);
    this.floor = currentFloor(run);
    this.hero = { ...run.hero };
    this.lantern = { ...run.lantern };
    this.monsters = this.floor.monsters.map((m) => ({ ...m }));
    this.campUsed = this.floor.campUsed;
    this.turnNumber = run.turn;
    this.kills = run.kills;
    this.status = run.status;
    this.killedBy = run.killedBy;
  }

  /** Returns false when the action didn't happen (so no turn passes). */
  heroActs(action: Exclude<Action, { type: "use-stairs" }>): boolean {
    switch (action.type) {
      case "move":
        return this.heroMoves(action.direction);
      case "wait":
        this.events.push({ type: "waited" });
        return true;
      case "rest":
        return this.rest();
      case "toggle-light":
        return this.toggleLight();
      case "pulse":
        return this.pulse();
    }
  }

  private heroMoves(direction: Direction): boolean {
    const tiles = this.floor.tiles;
    if (!canStep(tiles, this.hero, direction)) {
      this.events.push({ type: "blocked", direction });
      return false;
    }
    const to = step(this.hero, direction);
    const dx = DIRECTION_VECTORS[direction].x;
    if (dx !== 0) this.hero.facing = dx > 0 ? "right" : "left";
    const target = this.monsterAt(to);
    if (target) {
      // Moving into a creature attacks it.
      const damage = heroAttackPower(this.hero.level) + this.rng.int(0, 2);
      this.events.push({
        type: "attacked",
        target: target.id,
        kind: target.kind,
        at: { x: to.x, y: to.y },
        direction,
        damage,
      });
      this.damageMonster(target, damage);
      return true;
    }
    this.events.push({ type: "moved", from: { x: this.hero.x, y: this.hero.y }, to, direction });
    this.hero.x = to.x;
    this.hero.y = to.y;
    return true;
  }

  private rest(): boolean {
    const camp = this.floor.camp;
    if (!camp || !samePoint(camp, this.hero)) return false;
    if (this.campUsed) {
      this.events.push({ type: "camp-spent" });
      return false;
    }
    const healed = Math.min(
      this.hero.maxHp - this.hero.hp,
      Math.ceil(this.hero.maxHp * CAMP_HEAL_SHARE),
    );
    const charge = Math.min(LANTERN_MAX - this.lantern.charge, CAMP_CHARGE);
    this.hero.hp += healed;
    this.lantern.charge += charge;
    this.campUsed = true;
    this.events.push({ type: "rested", healed, charge });
    return true;
  }

  private toggleLight(): boolean {
    if (!this.lantern.bright && this.lantern.charge < BRIGHT_COST) {
      this.events.push({ type: "not-enough-charge", needed: BRIGHT_COST });
      return false;
    }
    this.lantern.bright = !this.lantern.bright;
    this.events.push({ type: "lantern", bright: this.lantern.bright, reason: "toggled" });
    return true;
  }

  private pulse(): boolean {
    if (this.lantern.charge < PULSE_COST) {
      this.events.push({ type: "not-enough-charge", needed: PULSE_COST });
      return false;
    }
    this.lantern.charge -= PULSE_COST;
    this.hero.shield += PULSE_SHIELD;
    const damage = heroAttackPower(this.hero.level) + PULSE_BONUS_DAMAGE;
    const targets = this.monsters.filter(
      (m) =>
        m.hp > 0 &&
        chebyshevDistance(m, this.hero) <= PULSE_RADIUS &&
        hasLineOfSight(this.floor.tiles, this.hero, m),
    );
    this.events.push({
      type: "pulsed",
      at: { x: this.hero.x, y: this.hero.y },
      hits: targets.length,
    });
    for (const target of targets) this.damageMonster(target, damage);
    return true;
  }

  burnLantern(): void {
    this.turnNumber += 1;
    if (!this.lantern.bright) return;
    this.lantern.charge = Math.max(0, this.lantern.charge - BRIGHT_COST);
    if (this.lantern.charge === 0) {
      this.lantern.bright = false;
      this.events.push({ type: "lantern", bright: false, reason: "empty" });
    }
  }

  private damageMonster(monster: Mutable<Monster>, damage: number): void {
    monster.hp -= damage;
    monster.alert = true;
    monster.lastSeen = { x: this.hero.x, y: this.hero.y };
    if (monster.hp > 0) return;
    const kind = creatureKind(monster.kind);
    this.kills += 1;
    this.events.push({
      type: "monster-died",
      id: monster.id,
      kind: monster.kind,
      at: { x: monster.x, y: monster.y },
      xp: kind.xp,
    });
    this.gainXp(kind.xp);
    this.monsters = this.monsters.filter((m) => m !== monster);
  }

  private gainXp(xp: number): void {
    this.hero.xp += xp;
    while (this.hero.xp >= xpToNextLevel(this.hero.level)) {
      this.hero.xp -= xpToNextLevel(this.hero.level);
      this.hero.level += 1;
      this.hero.maxHp += LEVEL_HP_GAIN;
      this.hero.hp = Math.min(this.hero.maxHp, this.hero.hp + LEVEL_HEAL);
      this.events.push({ type: "leveled-up", level: this.hero.level });
    }
  }

  /** Each creature perceives, then strikes, readies a strike, or moves. Nearest act first. */
  creaturesAct(): void {
    const tiles = this.floor.tiles;
    const camp = this.floor.camp;
    const offCamp = (index: number) => !camp || index !== indexOf(camp);
    const towardHero = stepDistances(tiles, this.hero, offCamp);
    const order = [...this.monsters].sort(
      (a, b) => chebyshevDistance(a, this.hero) - chebyshevDistance(b, this.hero),
    );

    for (const monster of order) {
      if (this.status !== "active") return;
      const kind = creatureKind(monster.kind);
      if (kind.behavior === "slow" && this.turnNumber % 2 === 1) continue;

      const sees =
        chebyshevDistance(monster, this.hero) <= PERCEPTION_RANGE &&
        hasLineOfSight(tiles, monster, this.hero);
      if (sees) {
        if (!monster.alert)
          this.events.push({ type: "monster-noticed", id: monster.id, kind: monster.kind });
        monster.alert = true;
        monster.lastSeen = { x: this.hero.x, y: this.hero.y };
      }
      if (!monster.alert) continue;

      if (this.canStrike(monster)) {
        if (monster.ready) this.strike(monster);
        else this.ready(monster);
        continue;
      }
      monster.ready = false;

      const target = sees ? null : monster.lastSeen;
      const distances = target ? stepDistances(tiles, target, offCamp) : towardHero;
      const strides = kind.behavior === "swift" ? 2 : 1;
      for (let stride = 0; stride < strides; stride++) {
        const erratic = kind.behavior === "erratic" && this.rng.chance(0.5);
        if (!this.stepMonster(monster, distances, erratic)) break;
        if (this.canStrike(monster)) {
          this.ready(monster);
          break;
        }
      }

      // Reached the last place it saw the hero without finding them: it gives up the hunt.
      if (!sees && monster.lastSeen && samePoint(monster, monster.lastSeen)) {
        monster.alert = false;
        monster.lastSeen = null;
      }
    }
  }

  private ready(monster: Mutable<Monster>): void {
    monster.ready = true;
    this.events.push({ type: "monster-readied", id: monster.id, kind: monster.kind });
  }

  /** Adjacent (no squeezing past corners), or for ranged creatures, a clear straight or diagonal line. */
  private canStrike(monster: Monster): boolean {
    const camp = this.floor.camp;
    if (camp && samePoint(camp, this.hero)) return false;
    const distance = chebyshevDistance(monster, this.hero);
    const direction = directionFromDelta(this.hero.x - monster.x, this.hero.y - monster.y);
    if (!direction) return false;
    if (distance === 1) return canStep(this.floor.tiles, monster, direction);
    if (creatureKind(monster.kind).behavior !== "ranged" || distance > RANGED_REACH) return false;
    const dx = Math.abs(this.hero.x - monster.x);
    const dy = Math.abs(this.hero.y - monster.y);
    const inLine = dx === 0 || dy === 0 || dx === dy;
    return inLine && hasLineOfSight(this.floor.tiles, monster, this.hero);
  }

  private strike(monster: Mutable<Monster>): void {
    const damage = Math.max(1, monster.attack + this.rng.int(0, 1) - heroDefense());
    const absorbed = Math.min(this.hero.shield, damage);
    this.hero.shield -= absorbed;
    this.hero.hp = Math.max(0, this.hero.hp - (damage - absorbed));
    this.faceToward(monster, this.hero);
    this.events.push({
      type: "monster-struck",
      id: monster.id,
      kind: monster.kind,
      from: { x: monster.x, y: monster.y },
      ranged: chebyshevDistance(monster, this.hero) > 1,
      damage,
      absorbed,
    });
    if (this.hero.hp === 0) {
      this.status = "dead";
      this.killedBy = monster.kind;
      this.events.push({ type: "died", by: monster.kind });
    }
  }

  /** One step closer along `distances`, or (when erratic) a random open step. */
  private stepMonster(
    monster: Mutable<Monster>,
    distances: readonly number[],
    erratic: boolean,
  ): boolean {
    const here = distances[indexOf(monster)] ?? -1;
    const options = DIRECTIONS.filter((direction) => {
      if (!canStep(this.floor.tiles, monster, direction)) return false;
      const to = step(monster, direction);
      if (this.floor.camp && samePoint(to, this.floor.camp)) return false;
      return !samePoint(to, this.hero) && !this.monsterAt(to);
    });
    if (options.length === 0) return false;

    let choice: Direction | undefined;
    if (erratic) {
      choice = this.rng.pick(options);
    } else {
      // Shortest route first; among equals, whichever ends up physically closest to the hero.
      let best = here < 0 ? Number.POSITIVE_INFINITY : here;
      let bestReach = Number.POSITIVE_INFINITY;
      for (const direction of options) {
        const to = step(monster, direction);
        const distance = distances[indexOf(to)] ?? -1;
        if (distance < 0) continue;
        const reach = Math.hypot(to.x - this.hero.x, to.y - this.hero.y);
        if (distance < best || (distance === best && choice !== undefined && reach < bestReach)) {
          best = distance;
          bestReach = reach;
          choice = direction;
        }
      }
    }
    if (!choice) return false;
    const from = { x: monster.x, y: monster.y };
    const to = step(monster, choice);
    monster.x = to.x;
    monster.y = to.y;
    this.faceToward(monster, this.hero);
    this.events.push({ type: "monster-moved", id: monster.id, from, to });
    return true;
  }

  private faceToward(monster: Mutable<Monster>, target: Point): void {
    if (target.x !== monster.x) monster.facing = target.x > monster.x ? "right" : "left";
  }

  private monsterAt(point: Point): Mutable<Monster> | undefined {
    return this.monsters.find((m) => m.hp > 0 && samePoint(m, point));
  }

  finish(): RunState {
    const radius = sightRadius(this.lantern);
    const hero: Hero = { ...this.hero };
    const floor = reveal(
      { ...this.floor, monsters: this.monsters, campUsed: this.campUsed },
      hero,
      radius,
    );
    const discovered = spottedKinds(floor, hero, this.lantern, this.run.discovered);
    for (const kind of discovered.slice(this.run.discovered.length)) {
      this.events.push({ type: "spotted", kind });
    }
    return {
      ...this.run,
      turn: this.turnNumber,
      hero,
      lantern: { ...this.lantern },
      floors: replaceFloor(this.run.floors, floor),
      rng: this.rng.state(),
      kills: this.kills,
      discovered,
      status: this.status,
      killedBy: this.killedBy,
    };
  }
}

/** Taking the stairs: creatures don't get a turn, and the arrival floor is generated if new. */
function takeStairs(run: RunState): ActionResult {
  const interaction = availableInteraction(run);
  if (!interaction || interaction.kind === "rest") {
    return { run, events: [{ type: "no-stairs" }], tookTurn: false };
  }

  const toDepth = interaction.toDepth;
  const existing = run.floors.find((f) => f.depth === toDepth);
  const target = existing ?? generateFloor(run.seed, toDepth);
  // Going down lands on the next floor's up stairs; going up lands on the previous floor's down stairs.
  const arrival = interaction.kind === "descend" ? target.entrance : target.downStairs;
  if (!arrival) throw new Error(`Floor ${toDepth} has no stairs to arrive on.`);

  const events: GameEvent[] = [{ type: "changed-floor", from: run.depth, to: toDepth }];
  const hero: Hero = { ...run.hero, x: arrival.x, y: arrival.y };
  let lantern = run.lantern;
  if (lantern.bright) {
    const charge = Math.max(0, lantern.charge - BRIGHT_COST);
    lantern = { charge, bright: charge > 0 };
    if (charge === 0) events.push({ type: "lantern", bright: false, reason: "empty" });
  }
  const revealed = reveal(target, hero, sightRadius(lantern));
  const floors = existing ? replaceFloor(run.floors, revealed) : [...run.floors, revealed];
  const discovered = spottedKinds(revealed, hero, lantern, run.discovered);
  for (const kind of discovered.slice(run.discovered.length))
    events.push({ type: "spotted", kind });
  return {
    run: { ...run, turn: run.turn + 1, depth: toDepth, hero, lantern, floors, discovered },
    events,
    tookTurn: true,
  };
}

function replaceFloor(floors: readonly Floor[], floor: Floor): Floor[] {
  return floors.map((f) => (f.depth === floor.depth ? floor : f));
}

/** Marks what the hero can see from `at` as explored. Returns the same floor if nothing is new. */
function reveal(floor: Floor, at: Point, radius: number): Floor {
  const visible = computeVisible(floor.tiles, at, radius);
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

/** `known` plus any new creature kinds now in view, in the order first seen. */
function spottedKinds(
  floor: Floor,
  hero: Point,
  lantern: Lantern,
  known: readonly CreatureId[],
): CreatureId[] {
  const visible = computeVisible(floor.tiles, hero, sightRadius(lantern));
  const discovered = [...known];
  for (const monster of floor.monsters) {
    if (visible.has(indexOf(monster)) && !discovered.includes(monster.kind))
      discovered.push(monster.kind);
  }
  return discovered;
}

/** Whether the hero has seen this tile on the current floor; used to limit click-to-walk routes. */
export function isExplored(run: RunState, p: Point): boolean {
  return currentFloor(run).explored[indexOf(p)] === true;
}

/** The creature standing on a tile of the current floor, if any. */
export function monsterAt(run: RunState, p: Point): Monster | undefined {
  return currentFloor(run).monsters.find((m) => samePoint(m, p));
}
