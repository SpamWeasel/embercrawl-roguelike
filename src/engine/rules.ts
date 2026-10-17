/**
 * Every number that shapes combat and progression, in one place. Milestone 5's balance bot tunes
 * these; change them here rather than scattering constants through the rules.
 */
import type { CreatureKind } from "./creatures";

/** The hero. */
export const HERO_START_HP = 30;
/** Defense before armor exists (milestone 4); stands in for the starting coat. */
export const HERO_BASE_DEFENSE = 1;
/** Attack bonus of the starting blade until weapons exist (milestone 4). */
export const STARTER_WEAPON_POWER = 3;
export const LEVEL_HP_GAIN = 5;
export const LEVEL_HEAL = 10;

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
/** Softens creature strikes while there are no healing items (milestone 4). */
const CREATURE_ATTACK_FACTOR = 0.9;

export function heroAttackPower(level: number): number {
  return 2 + Math.floor(level / 2) + STARTER_WEAPON_POWER;
}

export function heroDefense(): number {
  return HERO_BASE_DEFENSE;
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
