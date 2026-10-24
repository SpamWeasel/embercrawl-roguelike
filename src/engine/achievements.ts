import { CREATURE_IDS } from "./creatures";
import { PACK_SLOTS } from "./rules";
import type { RunState } from "./run";

/**
 * Milestones a character can earn, kept forever in its record. Each is checked after every turn
 * against the current descent and the character's record; once earned it stays earned.
 */
export interface Achievement {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Whether the descent so far (and the record) has earned it. */
  earned(run: RunState, seen: ReadonlySet<string>): boolean;
}

export const ACHIEVEMENTS = [
  {
    id: "first-blood",
    name: "First Blood",
    description: "Slay a creature.",
    earned: (run) => run.kills >= 1,
  },
  {
    id: "hundred-fallen",
    name: "Hundred Fallen",
    description: "Slay 100 creatures in one descent.",
    earned: (run) => run.kills >= 100,
  },
  {
    id: "into-the-deep",
    name: "Into the Deep",
    description: "Reach floor 10.",
    earned: (run) => run.depth >= 10,
  },
  {
    id: "far-below",
    name: "Far Below",
    description: "Reach floor 20.",
    earned: (run) => run.depth >= 20,
  },
  {
    id: "the-bottom",
    name: "The Bottom",
    description: "Reach floor 30.",
    earned: (run) => run.depth >= 30,
  },
  {
    id: "bell-unrung",
    name: "Bell Unrung",
    description: "Defeat the Chain Sexton, guardian of floor 10.",
    earned: (run) => run.stats.guardians.includes("chain-sexton"),
  },
  {
    id: "clockwork-stilled",
    name: "Clockwork Stilled",
    description: "Defeat the Orrery Knight, guardian of floor 20.",
    earned: (run) => run.stats.guardians.includes("orrery-knight"),
  },
  {
    id: "keeper-of-the-beacon",
    name: "Keeper of the Beacon",
    description: "Rekindle the Beacon.",
    earned: (run) => run.status === "won",
  },
  {
    id: "no-rest",
    name: "No Rest for the Bold",
    description: "Rekindle the Beacon without resting at a single camp.",
    earned: (run) => run.status === "won" && run.stats.rests === 0,
  },
  {
    id: "by-dim-light",
    name: "By Dim Light",
    description: "Reach floor 10 without ever turning the lantern bright.",
    earned: (run) => run.depth >= 10 && run.stats.brightTurns === 0,
  },
  {
    id: "seasoned",
    name: "Seasoned",
    description: "Reach level 10.",
    earned: (run) => run.hero.level >= 10,
  },
  {
    id: "veteran",
    name: "Veteran",
    description: "Reach level 20.",
    earned: (run) => run.hero.level >= 20,
  },
  {
    id: "keen-eyes",
    name: "Keen Eyes",
    description: "Find 10 hidden traps in one descent.",
    earned: (run) => run.stats.trapsFound >= 10,
  },
  {
    id: "good-customer",
    name: "Good Customer",
    description: "Spend 500 gold at merchants in one descent.",
    earned: (run) => run.stats.goldSpent >= 500,
  },
  {
    id: "full-purse",
    name: "Full Purse",
    description: "Carry 1,000 gold.",
    earned: (run) => run.gold >= 1000,
  },
  {
    id: "well-provisioned",
    name: "Well Provisioned",
    description: "Fill every slot of your pack.",
    earned: (run) => run.pack.length === PACK_SLOTS && run.pack.every((slot) => slot !== null),
  },
  {
    id: "star-forged",
    name: "Star-Forged",
    description: "Wield the Beacon Blade or wear the Beacon Aegis.",
    earned: (run) =>
      run.equipment.weapon === "beacon-blade" || run.equipment.armor === "beacon-aegis",
  },
  {
    id: "naturalist",
    name: "Naturalist",
    description: "See every kind of creature in the deep.",
    earned: (_run, seen) => CREATURE_IDS.every((id) => seen.has(id)),
  },
] as const satisfies readonly Achievement[];

export type AchievementId = (typeof ACHIEVEMENTS)[number]["id"];
export const ACHIEVEMENT_IDS: readonly AchievementId[] = ACHIEVEMENTS.map((a) => a.id);

export function achievement(id: AchievementId): Achievement {
  const found = ACHIEVEMENTS.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown achievement: ${id}`);
  return found;
}
