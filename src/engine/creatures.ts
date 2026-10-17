import type { Point } from "./geometry";

/** A creature living on a floor. */
export interface Monster extends Point {
  /** Unique within the run, e.g. "4-2" (floor 4, second creature placed). */
  readonly id: string;
  readonly kind: CreatureId;
  readonly hp: number;
  readonly maxHp: number;
  readonly attack: number;
  /** Has noticed the hero, and hunts toward where it last saw them. */
  readonly alert: boolean;
  readonly lastSeen: Point | null;
  /** Will strike on its next turn if the hero is still in reach. Shown to the player as a warning. */
  readonly ready: boolean;
  readonly facing: "left" | "right";
}

/**
 * The creatures of the buried observatory. Names and behaviors follow the owner's Emberdepths
 * roster (so existing and planned art keeps its names); descriptions and rules are Embercrawl's own.
 * Base stats are a starting point; milestone 5's balance bot tunes them.
 */

/**
 * - chase: closes in by the shortest route.
 * - slow: acts only on even turns.
 * - ranged: strikes from up to four tiles away along a row, column or diagonal with a clear view.
 * - erratic: lurches about at random half the time until it can strike.
 * - swift: takes two steps per turn while closing in.
 */
export type Behavior = "chase" | "slow" | "ranged" | "erratic" | "swift";

export interface CreatureKind {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly hp: number;
  readonly attack: number;
  readonly xp: number;
  /** The first floor it can appear on. Guardians appear only on this floor. */
  readonly firstFloor: number;
  readonly behavior: Behavior;
  readonly guardian?: true;
  /** Placeholder color until it has art (0xRRGGBB). */
  readonly color: number;
}

export const CREATURES = [
  {
    id: "cinder-mite",
    name: "Cinder Mite",
    description:
      "A coal-backed beetle no bigger than a fist. It skitters straight for anything warm.",
    hp: 9,
    attack: 4,
    xp: 6,
    firstFloor: 1,
    behavior: "chase",
    color: 0xff7a3d,
  },
  {
    id: "dust-skitter",
    name: "Dust Skitter",
    description: "A tangle of grit and twitching legs that never moves in a straight line.",
    hp: 8,
    attack: 4,
    xp: 5,
    firstFloor: 1,
    behavior: "erratic",
    color: 0xb8a58a,
  },
  {
    id: "moss-jaw",
    name: "Moss Jaw",
    description: "A lump of wet moss around a mouth of stone teeth. Sluggish, but it bites hard.",
    hp: 15,
    attack: 6,
    xp: 11,
    firstFloor: 2,
    behavior: "slow",
    color: 0x6f9a4a,
  },
  {
    id: "shardling",
    name: "Shardling",
    description: "Broken lens-glass that walks on its own splinters, chiming softly as it hunts.",
    hp: 11,
    attack: 6,
    xp: 13,
    firstFloor: 3,
    behavior: "chase",
    color: 0x9fd4e8,
  },
  {
    id: "gloom-moth",
    name: "Gloom Moth",
    description: "Its wings shed a stinging soot it can fling down any open line.",
    hp: 12,
    attack: 5,
    xp: 15,
    firstFloor: 4,
    behavior: "ranged",
    color: 0x7a6a9a,
  },
  {
    id: "bog-lurcher",
    name: "Bog Lurcher",
    description: "A dripping heap that staggers wherever the floor feels softest.",
    hp: 22,
    attack: 7,
    xp: 17,
    firstFloor: 5,
    behavior: "erratic",
    color: 0x4f6b4a,
  },
  {
    id: "coil-stalker",
    name: "Coil Stalker",
    description: "Loops of segmented body that unwind through narrow halls without a sound.",
    hp: 22,
    attack: 8,
    xp: 20,
    firstFloor: 6,
    behavior: "chase",
    color: 0x8a5a3a,
  },
  {
    id: "lantern-leech",
    name: "Lantern Leech",
    description: "A pale, ribbed crawler drawn to flame. It closes two strides at a time.",
    hp: 17,
    attack: 8,
    xp: 21,
    firstFloor: 7,
    behavior: "swift",
    color: 0xe8d8b0,
  },
  {
    id: "iron-husk",
    name: "Iron Husk",
    description: "An empty suit of observatory armor, still marching on one trapped ember.",
    hp: 33,
    attack: 10,
    xp: 27,
    firstFloor: 8,
    behavior: "slow",
    color: 0x8a8f9c,
  },
  {
    id: "ash-weaver",
    name: "Ash Weaver",
    description: "It spins threads of burning ash and casts them along clear sightlines.",
    hp: 24,
    attack: 9,
    xp: 29,
    firstFloor: 9,
    behavior: "ranged",
    color: 0xc86a3a,
  },
  {
    id: "chain-sexton",
    name: "Chain Sexton",
    description: "Warden of the upper vaults. It swings a ring of rusted keys like a flail.",
    hp: 72,
    attack: 12,
    xp: 90,
    firstFloor: 10,
    behavior: "slow",
    guardian: true,
    color: 0xa07850,
  },
  {
    id: "rime-crawler",
    name: "Rime Crawler",
    description: "Frost-furred and many-legged, it climbs up out of the flooded cisterns.",
    hp: 30,
    attack: 10,
    xp: 32,
    firstFloor: 11,
    behavior: "chase",
    color: 0xbfe6ff,
  },
  {
    id: "hollow-cantor",
    name: "Hollow Cantor",
    description: "An empty robe that hums a single note, sharp enough to cut down a corridor.",
    hp: 26,
    attack: 10,
    xp: 34,
    firstFloor: 12,
    behavior: "ranged",
    color: 0xd0c4e8,
  },
  {
    id: "gear-hound",
    name: "Gear Hound",
    description: "Springs, teeth and a wound-up appetite. It doubles its stride on the scent.",
    hp: 28,
    attack: 11,
    xp: 36,
    firstFloor: 13,
    behavior: "swift",
    color: 0xb08a4a,
  },
  {
    id: "salt-wraith",
    name: "Salt Wraith",
    description: "A drifting crust of brine in the shape of a memory. It never holds a course.",
    hp: 33,
    attack: 13,
    xp: 38,
    firstFloor: 14,
    behavior: "erratic",
    color: 0xe8e2d0,
  },
  {
    id: "basalt-brute",
    name: "Basalt Brute",
    description: "A quarry laborer of fused black stone. Slow to turn, ruinous when it connects.",
    hp: 54,
    attack: 17,
    xp: 46,
    firstFloor: 15,
    behavior: "slow",
    color: 0x4a4a52,
  },
  {
    id: "prism-eye",
    name: "Prism Eye",
    description: "A floating lens that bends lantern light into a cutting beam.",
    hp: 35,
    attack: 14,
    xp: 48,
    firstFloor: 17,
    behavior: "ranged",
    color: 0x8ae8e0,
  },
  {
    id: "thorn-matron",
    name: "Thorn Matron",
    description: "Bark-armored keeper of the sunken conservatory, trailing hooked vines.",
    hp: 48,
    attack: 16,
    xp: 50,
    firstFloor: 18,
    behavior: "chase",
    color: 0x5a7a3a,
  },
  {
    id: "orrery-knight",
    name: "Orrery Knight",
    description: "A brass sentinel geared to the turning spheres, sworn to hold the lower stair.",
    hp: 150,
    attack: 21,
    xp: 180,
    firstFloor: 20,
    behavior: "slow",
    guardian: true,
    color: 0xd4a84a,
  },
  {
    id: "void-tick",
    name: "Void Tick",
    description: "A glossy black parasite that crosses two tiles in a blink and latches on.",
    hp: 40,
    attack: 17,
    xp: 52,
    firstFloor: 21,
    behavior: "swift",
    color: 0x3a2e52,
  },
  {
    id: "star-eater",
    name: "Star Eater",
    description: "Long, starved and eyeless, it devours fallen light and whoever carries it.",
    hp: 58,
    attack: 19,
    xp: 58,
    firstFloor: 22,
    behavior: "chase",
    color: 0x4a4a8a,
  },
  {
    id: "cinder-oracle",
    name: "Cinder Oracle",
    description: "A seer wrapped in live coals who hurls embers down every open line.",
    hp: 46,
    attack: 19,
    xp: 62,
    firstFloor: 24,
    behavior: "ranged",
    color: 0xff5a2a,
  },
  {
    id: "ruin-colossus",
    name: "Ruin Colossus",
    description: "Rubble given a body by the Beacon's last pulses. The floor shakes as it walks.",
    hp: 88,
    attack: 25,
    xp: 72,
    firstFloor: 25,
    behavior: "slow",
    color: 0x7a6a5a,
  },
  {
    id: "null-shade",
    name: "Null Shade",
    description: "A gap in the dark the shape of a person. It flickers from place to place.",
    hp: 54,
    attack: 23,
    xp: 74,
    firstFloor: 27,
    behavior: "erratic",
    color: 0x2a2a3a,
  },
  {
    id: "beacon-warden",
    name: "Beacon Warden",
    description: "The last guardian of the guttering Beacon. Slow, vast and endlessly patient.",
    hp: 260,
    attack: 28,
    xp: 320,
    firstFloor: 30,
    behavior: "slow",
    guardian: true,
    color: 0xffb84a,
  },
] as const satisfies readonly CreatureKind[];

export type CreatureId = (typeof CREATURES)[number]["id"];

export const CREATURE_IDS: readonly CreatureId[] = CREATURES.map((c) => c.id);

const BY_ID = new Map<string, CreatureKind>(CREATURES.map((c) => [c.id, c]));

export function creatureKind(id: CreatureId): CreatureKind {
  const kind = BY_ID.get(id);
  if (!kind) throw new Error(`Unknown creature "${id}".`);
  return kind;
}

export function isCreatureId(value: string): value is CreatureId {
  return BY_ID.has(value);
}
