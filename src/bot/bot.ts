/**
 * The balance bot: a fixed, fairly simple player used to measure how hard the game is. It knows
 * only what a player would (explored tiles, creatures in view), plays by the normal rules through
 * `applyAction`, and never dodges telegraphed strikes, so a careful human should do better.
 *
 * Its choices, in order of priority each turn:
 * 1. Heal when health is low; drink vigor draughts; refill a low lantern.
 * 2. Fight anything adjacent: pulse or flare when surrounded, otherwise hit the weakest.
 * 3. Equip upgrades from the pack.
 * 4. Close in on creatures it can see that have noticed it.
 * 5. Rest at the camp when hurt; trade at a merchant when it can afford something useful.
 * 6. Pick up gold and items it has seen.
 * 7. On the last floor, rekindle the Beacon once the Warden has fallen.
 * 8. Explore until nothing is left to see, then take the stairs down.
 */
import { creatureKind, type Monster } from "../engine/creatures";
import type { Floor } from "../engine/generate";
import {
  chebyshevDistance,
  DIRECTIONS,
  type Direction,
  directionFromDelta,
  type Point,
} from "../engine/geometry";
import {
  CACHE,
  type GearKind,
  GOLD,
  type ItemId,
  isSupply,
  itemKind,
  type SupplyKind,
} from "../engine/items";
import {
  canStep,
  FLOOR_COUNT,
  inBounds,
  indexOf,
  isWalkable,
  MAP_SIZE,
  pointOf,
  tileAt,
} from "../engine/map";
import { packHasRoom } from "../engine/pack";
import { findPath, stepDistances } from "../engine/path";
import { PULSE_COST } from "../engine/rules";
import {
  type Action,
  type ActionResult,
  applyAction,
  availableInteraction,
  currentFloor,
  type RunState,
  visibleTiles,
  walkRoute,
} from "../engine/run";

/** Health share at which the bot drinks a healing supply. */
const HEAL_AT = 0.45;
/** Health share below which the bot goes to rest at an unused camp. */
const REST_BELOW = 0.65;
/** Healing supplies the bot tries to keep when shopping. */
const HEALS_WANTED = 4;
/** After this many turns on one floor, the bot stops exploring and heads down. */
const FLOOR_TURN_LIMIT = 1200;
/** Turns spent on three or fewer tiles that count as being stuck. */
const STUCK_WINDOW = 60;
/** A whole run is abandoned (counted as a loss) after this many turns. */
const RUN_TURN_LIMIT = 30000;

export interface BotOutcome {
  readonly seed: number;
  readonly result: "won" | "died" | "stalled";
  readonly depth: number;
  readonly turns: number;
  readonly level: number;
  readonly gold: number;
  readonly kills: number;
  readonly killedBy: string | null;
}

/** Plays one whole descent with this seed and reports how it ended. */
export function playRun(
  seed: number,
  start: RunState,
  /** Called after every turn, for debugging the bot. */
  onTurn?: (run: RunState, action: Action, result: ActionResult) => void,
): BotOutcome {
  let run = start;
  let floorTurns = 0;
  let depth = run.depth;
  let idle = 0;
  let hurry = false;
  const recent: number[] = [];
  while (run.status === "active" && run.turn < RUN_TURN_LIMIT) {
    if (run.depth !== depth) {
      depth = run.depth;
      floorTurns = 0;
      hurry = false;
    }
    // Pacing over the same few tiles for a long while: stop exploring this floor and head down.
    recent.push(indexOf(run.hero));
    if (recent.length > STUCK_WINDOW) recent.shift();
    if (recent.length === STUCK_WINDOW && new Set(recent).size <= 3) hurry = true;
    const action = chooseAction(run, hurry || floorTurns >= FLOOR_TURN_LIMIT);
    let result = applyAction(run, action);
    onTurn?.(run, action, result);
    if (!result.tookTurn) {
      // Whatever it tried didn't work (blocked, unaffordable...): wait a turn instead.
      result = applyAction(run, { type: "wait" });
      idle++;
    } else idle = 0;
    if (idle > 50) break;
    run = result.run;
    floorTurns++;
  }
  return {
    seed,
    result: run.status === "won" ? "won" : run.status === "dead" ? "died" : "stalled",
    depth: run.depth,
    turns: run.turn,
    level: run.hero.level,
    gold: run.gold,
    kills: run.kills,
    killedBy: run.killedBy,
  };
}

let lastReason = "";

/** Why the bot chose its last action, for debugging (e.g. "heal", "explore", "wander"). */
export function lastDecision(): string {
  return lastReason;
}

function why(reason: string, action: Action): Action {
  lastReason = reason;
  return action;
}

/** The bot's next action. `hurry` skips exploring and heads for the stairs. */
export function chooseAction(run: RunState, hurry = false): Action {
  const floor = currentFloor(run);
  const hero = run.hero;
  const visible = visibleTiles(run);
  const seen = floor.monsters.filter((m) => visible.has(indexOf(m)));
  const adjacent = seen.filter((m) => {
    const direction = directionFromDelta(m.x - hero.x, m.y - hero.y);
    return chebyshevDistance(m, hero) === 1 && direction && canStep(floor.tiles, hero, direction);
  });

  // 1. Look after health and light.
  const heal = healingSlot(run);
  if (hero.hp <= hero.maxHp * HEAL_AT && heal !== null)
    return why("heal", { type: "use-item", slot: heal });
  const vigor = slotOf(run, (kind) => kind.effect.kind === "vigor");
  if (vigor !== null) return why("vigor", { type: "use-item", slot: vigor });
  const shard = slotOf(run, (kind) => kind.effect.kind === "charge");
  if (shard !== null && run.lantern.charge <= 50)
    return why("charge", { type: "use-item", slot: shard });

  // 2. Fight.
  if (adjacent.length > 0) {
    const flare = slotOf(run, (kind) => kind.effect.kind === "flare");
    const inFlare = seen.filter((m) => chebyshevDistance(m, hero) <= 3).length;
    if (flare !== null && inFlare >= 2) return why("flare", { type: "use-item", slot: flare });
    if ((adjacent.length >= 2 || adjacent.some((m) => m.ready)) && run.lantern.charge >= PULSE_COST)
      return why("pulse", { type: "pulse" });
    const sigil = slotOf(run, (kind) => kind.effect.kind === "shield");
    if (sigil !== null && hero.hp < hero.maxHp * 0.6 && hero.shield === 0)
      return why("ward", { type: "use-item", slot: sigil });
    const target = [...adjacent].sort((a, b) => a.hp - b.hp)[0] as Monster;
    return why("fight", moveToward(run, target) ?? { type: "wait" });
  }

  // 3. Wear the best gear carried.
  const upgrade = upgradeSlot(run);
  if (upgrade !== null) return why("equip", { type: "use-item", slot: upgrade });

  // 4. Close in on creatures that have noticed us.
  const hunters = seen
    .filter((m) => m.alert)
    .sort((a, b) => distanceTo(run, a) - distanceTo(run, b));
  const nearest = hunters[0];
  if (nearest && distanceTo(run, nearest) <= 8) {
    const step = moveToward(run, nearest);
    if (step) return why("hunt", step);
  }

  const interaction = availableInteraction(run);

  // 5. Rest, and trade.
  if (
    floor.camp &&
    !floor.campUsed &&
    hero.hp < hero.maxHp * REST_BELOW &&
    isKnown(floor, floor.camp)
  ) {
    if (interaction?.kind === "rest") return why("rest", { type: "rest" });
    const step = walkTo(run, floor.camp);
    if (step) return why("to-camp", step);
  }
  if (floor.merchant && isKnown(floor, floor.merchant)) {
    const trade = tradeAction(run);
    if (trade) {
      if (interaction?.kind === "trade") return why("trade", trade);
      const step = walkTo(run, floor.merchant);
      if (step) return why("to-merchant", step);
    }
  }

  // 6. Gold and items.
  if (!hurry) {
    // Nearest by walking distance (straight-line distance can make two targets trade places).
    const distances = walkDistances(run);
    const loot = floor.items
      .filter(
        (item) =>
          isKnown(floor, item) && wanted(run, item.item) && (distances[indexOf(item)] ?? -1) > 0,
      )
      .sort((a, b) => (distances[indexOf(a)] ?? 0) - (distances[indexOf(b)] ?? 0));
    for (const item of loot) {
      const step = walkTo(run, item);
      if (step) return why("loot", step);
    }
  }

  // 7. The Beacon.
  if (
    floor.beacon &&
    isKnown(floor, floor.beacon) &&
    interaction?.kind === "rekindle" &&
    !interaction.smotheredBy
  )
    return why("rekindle", { type: "rekindle" });

  // 8. Explore, then descend (or hunt the guardian keeping the stairs shut).
  if (!hurry) {
    const frontier = nearestFrontier(run);
    if (frontier) {
      const step = walkTo(run, frontier);
      if (step) return why("explore", step);
    }
  }
  const guardian = floor.monsters.find((m) => creatureKind(m.kind).guardian === true);
  if (guardian) {
    const step = moveToward(run, guardian, true);
    if (step) return why("guardian", step);
  }
  if (floor.beacon && isKnown(floor, floor.beacon))
    return why("beacon", walkTo(run, floor.beacon) ?? { type: "rekindle" });
  if (floor.downStairs && run.depth < FLOOR_COUNT && isKnown(floor, floor.downStairs)) {
    if (interaction?.kind === "descend") return why("descend", { type: "use-stairs" });
    const step = walkTo(run, floor.downStairs);
    if (step) return why("to-stairs", step);
  }
  // Nothing reachable over known ground: wander toward anything unexplored.
  return why("wander", wander(run));
}

function isKnown(floor: Floor, p: Point): boolean {
  return floor.explored[indexOf(p)] === true;
}

function distanceTo(run: RunState, p: Point): number {
  return chebyshevDistance(run.hero, p);
}

/** One step along click-to-walk's route (explored ground, around creatures and known traps). */
function walkTo(run: RunState, target: Point): Action | null {
  const floor = currentFloor(run);
  // When creatures block the only way, fight through them (stepping into one attacks it).
  const route = walkRoute(floor, run.hero, target) ?? fightThrough(floor, run.hero, target);
  const direction = route?.[0];
  return direction ? { type: "move", direction } : null;
}

/** A route over explored ground that may pass through creatures, still avoiding known traps. */
function fightThrough(floor: Floor, from: Point, to: Point): Direction[] | null {
  const traps = new Set(floor.traps.filter((t) => t.found).map((t) => indexOf(t)));
  const goal = indexOf(to);
  return findPath(
    floor.tiles,
    from,
    to,
    (i) => floor.explored[i] === true && (!traps.has(i) || i === goal),
  );
}

/** A step toward a creature, attacking it when adjacent. `anywhere` allows unexplored ground. */
function moveToward(
  run: RunState,
  monster: Monster,
  anywhere = false,
  throughOthers = false,
): Action | null {
  const floor = currentFloor(run);
  const others = new Set(
    throughOthers ? [] : floor.monsters.filter((m) => m !== monster).map((m) => indexOf(m)),
  );
  const traps = new Set(floor.traps.filter((t) => t.found).map((t) => indexOf(t)));
  const distances = stepDistances(
    floor.tiles,
    monster,
    (i) =>
      !others.has(i) &&
      !traps.has(i) &&
      (anywhere || floor.explored[i] === true || i === indexOf(run.hero)),
  );
  let best: Action | null = null;
  let bestDistance = distances[indexOf(run.hero)] ?? -1;
  // Other creatures in the way: go through them instead.
  if (bestDistance < 0) return throughOthers ? null : moveToward(run, monster, anywhere, true);
  for (const direction of DIRECTIONS) {
    if (!canStep(floor.tiles, run.hero, direction)) continue;
    const to = { x: run.hero.x + dx(direction), y: run.hero.y + dy(direction) };
    const distance = distances[indexOf(to)] ?? -1;
    if (distance >= 0 && distance < bestDistance) {
      bestDistance = distance;
      best = { type: "move", direction };
    }
  }
  return best;
}

function dx(direction: string): number {
  return direction.includes("e") ? 1 : direction.includes("w") ? -1 : 0;
}

function dy(direction: string): number {
  return direction.includes("s") ? 1 : direction.startsWith("n") ? -1 : 0;
}

/** Steps to every tile along click-to-walk routes: explored ground, around creatures and known traps. */
function walkDistances(run: RunState, throughCreatures = false): number[] {
  const floor = currentFloor(run);
  const avoid = new Set([
    ...(throughCreatures ? [] : floor.monsters.map((m) => indexOf(m))),
    ...floor.traps.filter((t) => t.found).map((t) => indexOf(t)),
  ]);
  return stepDistances(floor.tiles, run.hero, (i) => floor.explored[i] === true && !avoid.has(i));
}

/** The nearest explored open tile that borders unexplored ground. */
function nearestFrontier(run: RunState, throughCreatures = false): Point | null {
  const floor = currentFloor(run);
  const distances = walkDistances(run, throughCreatures);
  let best: Point | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < MAP_SIZE; index++) {
    const distance = distances[index] ?? -1;
    if (distance <= 0 || distance >= bestDistance) continue;
    const p = pointOf(index);
    if (!isWalkable(tileAt(floor.tiles, p)) || !bordersUnknown(floor, p)) continue;
    best = p;
    bestDistance = distance;
  }
  // Nothing reachable around the creatures: look past them (walking there will fight through).
  return best ?? (throughCreatures ? null : nearestFrontier(run, true));
}

function bordersUnknown(floor: Floor, p: Point): boolean {
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      const q = { x: p.x + x, y: p.y + y };
      if (inBounds(q) && !floor.explored[indexOf(q)]) return true;
    }
  }
  return false;
}

/** A step in any open direction that leads somewhere new, or a wait. */
function wander(run: RunState): Action {
  const floor = currentFloor(run);
  for (const direction of DIRECTIONS) {
    if (canStep(floor.tiles, run.hero, direction)) return { type: "move", direction };
  }
  return { type: "wait" };
}

/** Whether the bot wants an item lying on the floor (and has room for it). */
function wanted(run: RunState, item: ItemId | typeof CACHE | typeof GOLD): boolean {
  if (item === GOLD) return true;
  if (item === CACHE) return run.pack.includes(null);
  const kind = itemKind(item);
  if (!isSupply(kind) && kind.power <= wornPower(run, kind)) return false;
  return packHasRoom(run.pack, item);
}

function wornPower(run: RunState, kind: GearKind): number {
  const worn = itemKind(kind.category === "weapon" ? run.equipment.weapon : run.equipment.armor);
  return (worn as GearKind).power;
}

/** A pack slot holding a supply that matches. */
function slotOf(run: RunState, test: (kind: SupplyKind) => boolean): number | null {
  const slot = run.pack.findIndex((entry) => {
    if (!entry) return false;
    const kind = itemKind(entry.item);
    return isSupply(kind) && test(kind);
  });
  return slot >= 0 ? slot : null;
}

/** The healing supply that wastes least: the smallest one that covers the missing health. */
function healingSlot(run: RunState): number | null {
  const missing = run.hero.maxHp - run.hero.hp;
  let best: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  run.pack.forEach((entry, slot) => {
    if (!entry) return;
    const kind = itemKind(entry.item);
    if (!isSupply(kind) || kind.effect.kind !== "heal") return;
    const amount = kind.effect.amount;
    const score = amount >= missing ? amount - missing : (missing - amount) * 3;
    if (score < bestScore) {
      bestScore = score;
      best = slot;
    }
  });
  return best;
}

/** A carried weapon or armor stronger than what's worn. */
function upgradeSlot(run: RunState): number | null {
  const slot = run.pack.findIndex((entry) => {
    if (!entry) return false;
    const kind = itemKind(entry.item);
    return !isSupply(kind) && kind.power > wornPower(run, kind);
  });
  return slot >= 0 ? slot : null;
}

function healCount(run: RunState): number {
  return run.pack.reduce((sum, entry) => {
    if (!entry) return sum;
    const kind = itemKind(entry.item);
    return sum + (isSupply(kind) && kind.effect.kind === "heal" ? entry.count : 0);
  }, 0);
}

/**
 * What to do at the merchant: sell gear that's no better than what's worn, buy a gear upgrade,
 * then healing until there's enough. Null when there's nothing worth doing.
 */
function tradeAction(run: RunState): Action | null {
  const floor = currentFloor(run);
  const sell = run.pack.findIndex((entry) => {
    if (!entry) return false;
    const kind = itemKind(entry.item);
    return !isSupply(kind) && kind.power <= wornPower(run, kind);
  });
  if (sell >= 0) return { type: "sell", slot: sell };
  const affordable = (i: number) => {
    const offer = floor.stock[i];
    return (
      offer !== undefined &&
      offer.count > 0 &&
      offer.price <= run.gold &&
      packHasRoom(run.pack, offer.item)
    );
  };
  for (let i = 0; i < floor.stock.length; i++) {
    const offer = floor.stock[i];
    if (!offer || !affordable(i)) continue;
    const kind = itemKind(offer.item);
    if (!isSupply(kind) && kind.power > wornPower(run, kind)) return { type: "buy", offer: i };
  }
  if (healCount(run) < HEALS_WANTED) {
    for (let i = 0; i < floor.stock.length; i++) {
      const offer = floor.stock[i];
      if (!offer || !affordable(i)) continue;
      const kind = itemKind(offer.item);
      if (isSupply(kind) && kind.effect.kind === "heal") return { type: "buy", offer: i };
    }
  }
  return null;
}
