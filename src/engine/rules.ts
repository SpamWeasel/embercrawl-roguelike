/**
 * Every number that shapes combat and progression, in one place. Milestone 5's balance bot tunes
 * these; change them here rather than scattering constants through the rules.
 */
import type { CreatureKind } from "./creatures";
import type { SupplyId, TrapKind } from "./items";

/** The hero. */
export const HERO_START_HP = 30;
export const LEVEL_HP_GAIN = 5;
export const LEVEL_HEAL = 10;
/** The hero's blows add 0 to this much damage. */
export const HERO_HIT_SPREAD = 2;
/** Creatures' blows add 0 to this much damage. */
export const CREATURE_HIT_SPREAD = 1;

/** The pack: this many slots, each holding a stack of up to this many identical items. */
export const PACK_SLOTS = 10;
export const STACK_LIMIT = 9;

/** The lantern. */
export const DIM_SIGHT = 4;
export const BRIGHT_SIGHT = 6;
export const LANTERN_MAX = 100;
/** Bright light burns this much charge per turn. */
export const BRIGHT_COST = 1;
export const PULSE_COST = 20;
/** Pulses reach this many tiles (diagonals count as one). */
export const PULSE_RADIUS = 2;
export const PULSE_BONUS_DAMAGE = 4;
export const PULSE_SHIELD = 4;

/** Camps: rest once per floor. */
export const CAMP_HEAL_SHARE = 0.75;
export const CAMP_CHARGE = 30;

/** Creatures. */
export const PERCEPTION_RANGE = 7;
export const RANGED_REACH = 4;
/** Creatures appear at least this many steps from where the hero enters a floor. */
export const SPAWN_CLEARANCE = 6;
/** Creatures introduced this recently are three times as common as older ones. */
export const NEW_CREATURE_WINDOW = 3;
/** Creatures stop appearing this many floors after their first floor. */
export const CREATURE_LIFESPAN = 10;
/** Softens creature strikes a little; milestone 5's balance bot decides whether it stays. */
const CREATURE_ATTACK_FACTOR = 0.9;

/** Traps. */
/** Bright light shows hidden traps this close (diagonals count as one). Dim light shows none. */
export const TRAP_SPOT_RANGE = 2;
/** Traps are never placed this close to where the hero enters a floor (in steps). */
export const TRAP_CLEARANCE = 3;
/** Supplies. */
/** A Waystone lands at least this far from every creature, if the floor has such a spot... */
export const WAYSTONE_CLEARANCE = 5;
/** ...and at least this far from where the hero stood. */
export const WAYSTONE_MIN_JUMP = 4;

/** The hero's attack power (before the 0–2 extra each blow adds). */
export function heroAttackPower(level: number, weaponPower: number): number {
  return 2 + Math.floor(level / 2) + weaponPower;
}

/** Each creature blow is reduced by this much, to no less than 1 damage. */
export function heroDefense(armorPower: number): number {
  return armorPower;
}

/** Damage from one creature blow. `extra` is the random 0–CREATURE_HIT_SPREAD part. */
export function creatureHit(attack: number, defense: number, extra: number): number {
  return Math.max(1, attack + extra - defense);
}

/** Experience needed to go from `level` to the next level. */
export function xpToNextLevel(level: number): number {
  const n = level - 1;
  return 20 + 22 * n + 3 * n * n;
}

/** How many regular creatures a floor holds (guardians are extra). */
export function creatureCount(depth: number): number {
  return Math.min(17, 7 + Math.floor(0.35 * depth));
}

/**
 * A creature's health and attack on a floor. They grow the deeper below their first floor they
 * appear; `roll` (0..1) varies regular creatures' health by -10% to +15%.
 */
export function scaledStats(
  kind: CreatureKind,
  depth: number,
  roll: number,
): { hp: number; attack: number } {
  const steps = Math.max(0, depth - kind.firstFloor);
  const variance = kind.guardian ? 1 : 0.9 + roll * 0.25;
  return {
    hp: Math.max(1, Math.round(kind.hp * (1 + 0.08 * steps) * variance)),
    attack: Math.max(1, Math.round((kind.attack + Math.floor(steps / 3)) * CREATURE_ATTACK_FACTOR)),
  };
}

/** What each floor holds. */

/** Supplies scattered at random on a floor (more on odd floors, and more deep down). */
export function supplyCount(depth: number): number {
  return 1 + (depth % 2) + (depth >= 15 ? 1 : 0) + (depth >= 22 ? 1 : 0);
}

/** How likely each supply is on a floor, relative to the others. Zero means it can't appear. */
export function supplyWeight(id: SupplyId, depth: number): number {
  switch (id) {
    case "salve":
      return depth < 10 ? 4 : depth < 20 ? 3 : 2;
    case "deep-salve":
      return depth < 10 ? 0 : depth < 20 ? 3 : 4;
    case "ember-shard":
      return depth < 10 ? 3 : 2;
    case "ward-sigil":
      return depth <= 2 ? 1.5 : 2.5;
    case "waystone":
    case "survey-lens":
      return 1;
    case "flare-flask":
      return depth >= 5 ? 2 : 0;
    case "vigor-draught":
      return depth >= 7 ? 0.6 : 0;
  }
}

/** A healing supply every floor gets on top of the random ones, so recovery never runs dry. */
export function recoverySupply(depth: number): SupplyId | null {
  if (depth >= 10) return "deep-salve";
  return depth >= 4 ? "salve" : null;
}

/** Odd floors, and every floor from 15 down, hold a supply cache. */
export function hasCache(depth: number): boolean {
  return depth % 2 === 1 || depth >= 15;
}

/** Weapons and armor: one piece per floor from floor 2. */
export const GEAR_FIRST_FLOOR = 2;
/** Even floors favor weapons and odd floors armor, by this much. */
export const GEAR_SLOT_BIAS = 0.8;

/**
 * How likely a piece of gear of `tier` is on a floor. Gear from the last eight floors can appear,
 * favoring the newest; gear a floor ahead (three on guardian floors) occasionally turns up early.
 */
export function gearWeight(tier: number, depth: number, guardianFloor: boolean): number {
  const reach = guardianFloor ? 3 : 1;
  if (tier > depth + reach || tier < depth - 8) return 0;
  if (tier > depth) return 0.6;
  return tier >= depth - 3 ? 3 : 1;
}

/** Hidden traps on a floor: none on the first. */
export function trapCount(depth: number): number {
  return depth === 1 ? 0 : Math.min(5, 1 + Math.floor(depth / 7));
}

/** How likely each kind of trap is, relative to the others (once past its first floor). */
export function trapWeight(kind: TrapKind): number {
  return kind === "ember-vent" ? 3 : 1.5;
}

/** A trap's strength (see Trap.power). `roll` is a random 0–2. */
export function trapPower(kind: TrapKind, depth: number, roll: number): number {
  switch (kind) {
    case "ember-vent":
      return 3 + roll + Math.floor(depth / 2);
    case "gloom-rune":
      return 25 + depth;
    case "alarm-glyph":
      return 8;
  }
}
