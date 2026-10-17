import type { Point } from "./geometry";

/**
 * Everything the hero can find: supplies (used up), weapons and armor (equipped), and the traps
 * hidden in the floors. Names follow the owner's Emberdepths items (so their art keeps its names);
 * descriptions are Embercrawl's own. Numbers here are a starting point that milestone 5's balance
 * bot tunes; how often each appears lives in rules.ts.
 */

/** What a supply does when used. */
export type SupplyEffect =
  | { readonly kind: "heal"; readonly amount: number }
  | { readonly kind: "charge"; readonly amount: number }
  | { readonly kind: "shield"; readonly amount: number }
  /** Raises maximum health (and current health by the same amount) for the rest of the descent. */
  | { readonly kind: "vigor"; readonly amount: number }
  /** Carries the hero to a quiet spot on the floor, away from creatures. */
  | { readonly kind: "waystone" }
  /** Reveals the floor's layout and every trap on it. */
  | { readonly kind: "survey" }
  /** Hits every creature in view within `radius` tiles (diagonals count as one). */
  | { readonly kind: "flare"; readonly damage: number; readonly radius: number };

export interface SupplyKind {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: "supply";
  readonly effect: SupplyEffect;
  /** Placeholder color until it has art (0xRRGGBB). */
  readonly color: number;
}

export interface GearKind {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: "weapon" | "armor";
  /** Attack bonus for weapons, defense for armor. */
  readonly power: number;
  /** The floor where it starts turning up. */
  readonly tier: number;
  /** What every descent begins with; never found on the floor. */
  readonly starter?: true;
  readonly color: number;
}

export type ItemKind = SupplyKind | GearKind;

export const SUPPLIES = [
  {
    id: "salve",
    name: "Salve",
    description: "A tin of bitter, ember-warm paste. Smoothed over a wound, it knits it closed.",
    category: "supply",
    effect: { kind: "heal", amount: 16 },
    color: 0xe0b86a,
  },
  {
    id: "deep-salve",
    name: "Deep Salve",
    description:
      "Salve worked with crushed starstone, dark as old honey. It closes wounds that would fell anyone else.",
    category: "supply",
    effect: { kind: "heal", amount: 40 },
    color: 0xc0702a,
  },
  {
    id: "ember-shard",
    name: "Ember Shard",
    description:
      "A splinter of the fallen star, still faintly hot. Fed to the lantern, it burns a long while.",
    category: "supply",
    effect: { kind: "charge", amount: 40 },
    color: 0xff8a3d,
  },
  {
    id: "ward-sigil",
    name: "Ward Sigil",
    description:
      "A brass disc etched with the astronomers' warding marks. Snap it, and a shimmering guard wraps around you.",
    category: "supply",
    effect: { kind: "shield", amount: 12 },
    color: 0x8fc8ff,
  },
  {
    id: "waystone",
    name: "Waystone",
    description:
      "A smooth grey stone that remembers every place it has rested. Grip it, and it carries you somewhere quiet on this floor.",
    category: "supply",
    effect: { kind: "waystone" },
    color: 0xa7b0c4,
  },
  {
    id: "survey-lens",
    name: "Survey Lens",
    description:
      "A surveyor's lens ground from clear quartz. Held to the eye, it shows the whole floor, hidden traps and all.",
    category: "supply",
    effect: { kind: "survey" },
    color: 0x9fe6ff,
  },
  {
    id: "flare-flask",
    name: "Flare Flask",
    description:
      "A stoppered flask of star-fire. Dashed on the floor, it bursts over every creature you can see close by.",
    category: "supply",
    effect: { kind: "flare", damage: 16, radius: 3 },
    color: 0xff5a2a,
  },
  {
    id: "vigor-draught",
    name: "Vigor Draught",
    description:
      "A thick red tonic the keepers brewed for the long climb. It hardens you for the rest of the descent.",
    category: "supply",
    effect: { kind: "vigor", amount: 6 },
    color: 0xd8324a,
  },
] as const satisfies readonly SupplyKind[];

export const WEAPONS = [
  {
    id: "weathered-knife",
    name: "Weathered Knife",
    description: "The keeper's old knife, pitted with rust but still keen.",
    category: "weapon",
    power: 3,
    tier: 1,
    starter: true,
    color: 0xb08a6a,
  },
  {
    id: "iron-cleaver",
    name: "Iron Cleaver",
    description: "A heavy cleaver from the observatory's kitchens. Crude, and very effective.",
    category: "weapon",
    power: 5,
    tier: 2,
    color: 0x9aa0a8,
  },
  {
    id: "glass-spear",
    name: "Glass Spear",
    description: "A spear tipped with volcanic glass. It bites deep and seldom dulls.",
    category: "weapon",
    power: 7,
    tier: 4,
    color: 0x6ad0d8,
  },
  {
    id: "surveyors-pick",
    name: "Surveyor's Pick",
    description: "A rock pick from the deep surveys, weighted for splitting stone, and shells.",
    category: "weapon",
    power: 9,
    tier: 7,
    color: 0xc89a5a,
  },
  {
    id: "rime-sabre",
    name: "Rime Sabre",
    description: "A curved blade that never warms. Frost creeps along it even down here.",
    category: "weapon",
    power: 11,
    tier: 10,
    color: 0xb8e4ff,
  },
  {
    id: "gearbreaker-maul",
    name: "Gearbreaker Maul",
    description: "A maul made for wrecking jammed clockwork. It does the same to anything else.",
    category: "weapon",
    power: 13,
    tier: 13,
    color: 0xc8a050,
  },
  {
    id: "prism-glaive",
    name: "Prism Glaive",
    description: "A long glaive whose crystal edge splits lantern light into colors.",
    category: "weapon",
    power: 15,
    tier: 16,
    color: 0xe0a8ff,
  },
  {
    id: "starsteel-halberd",
    name: "Starsteel Halberd",
    description: "Forged from the fallen star's own metal. It hums faintly when swung.",
    category: "weapon",
    power: 17,
    tier: 19,
    color: 0xd8e0f0,
  },
  {
    id: "null-edge",
    name: "Null Edge",
    description: "A blade of something darker than the dark. Light bends away from its edge.",
    category: "weapon",
    power: 19,
    tier: 22,
    color: 0x6a5a9a,
  },
  {
    id: "beacon-blade",
    name: "Beacon Blade",
    description: "Tempered in the Beacon's flame when it was new. A little of that fire stayed.",
    category: "weapon",
    power: 22,
    tier: 26,
    color: 0xffd45a,
  },
] as const satisfies readonly GearKind[];

export const ARMORS = [
  {
    id: "travelers-coat",
    name: "Traveler's Coat",
    description: "A thick waxed coat, patched at the elbows. Better than nothing.",
    category: "armor",
    power: 1,
    tier: 1,
    starter: true,
    color: 0x8a6a4a,
  },
  {
    id: "padded-jerkin",
    name: "Padded Jerkin",
    description: "Layers of quilted canvas that soak up a surprising amount of punishment.",
    category: "armor",
    power: 2,
    tier: 2,
    color: 0xa08a6a,
  },
  {
    id: "ring-mail",
    name: "Ring Mail",
    description: "Iron rings riveted onto leather. It jingles, but it holds.",
    category: "armor",
    power: 3,
    tier: 4,
    color: 0x9aa0a8,
  },
  {
    id: "scale-hauberk",
    name: "Scale Hauberk",
    description: "Overlapping bronze scales on a long coat, cut for the survey crews.",
    category: "armor",
    power: 5,
    tier: 7,
    color: 0xc0904a,
  },
  {
    id: "obsidian-plate",
    name: "Obsidian Plate",
    description: "Plates of black volcanic glass bound in iron. Heavy, sharp-edged and very hard.",
    category: "armor",
    power: 7,
    tier: 10,
    color: 0x4a4a5a,
  },
  {
    id: "orrery-brigandine",
    name: "Orrery Brigandine",
    description: "Brass plates riveted in rings like a star chart, made for the observatory guard.",
    category: "armor",
    power: 9,
    tier: 14,
    color: 0xd0a040,
  },
  {
    id: "starwoven-mail",
    name: "Starwoven Mail",
    description: "Mail drawn from star-metal wire, light as cloth and twice as strong as iron.",
    category: "armor",
    power: 11,
    tier: 18,
    color: 0xc8d8ff,
  },
  {
    id: "void-carapace",
    name: "Void Carapace",
    description: "The shed shell of something that lived far below. Blows seem to sink into it.",
    category: "armor",
    power: 13,
    tier: 22,
    color: 0x5a4a8a,
  },
  {
    id: "beacon-aegis",
    name: "Beacon Aegis",
    description: "Armor of the Beacon's first keepers, still warm with its light.",
    category: "armor",
    power: 15,
    tier: 26,
    color: 0xffc04a,
  },
] as const satisfies readonly GearKind[];

export type SupplyId = (typeof SUPPLIES)[number]["id"];
export type WeaponId = (typeof WEAPONS)[number]["id"];
export type ArmorId = (typeof ARMORS)[number]["id"];
export type GearId = WeaponId | ArmorId;
export type ItemId = SupplyId | GearId;

export const STARTING_WEAPON: WeaponId = "weathered-knife";
export const STARTING_ARMOR: ArmorId = "travelers-coat";

export const SUPPLY_IDS: readonly SupplyId[] = SUPPLIES.map((s) => s.id);
export const WEAPON_IDS: readonly WeaponId[] = WEAPONS.map((w) => w.id);
export const ARMOR_IDS: readonly ArmorId[] = ARMORS.map((a) => a.id);
export const ITEM_IDS: readonly ItemId[] = [...SUPPLY_IDS, ...WEAPON_IDS, ...ARMOR_IDS];

const KINDS = new Map<string, ItemKind>(
  [...SUPPLIES, ...WEAPONS, ...ARMORS].map((kind) => [kind.id, kind]),
);

export function itemKind(id: ItemId): ItemKind {
  const kind = KINDS.get(id);
  if (!kind) throw new Error(`Unknown item: ${id}`);
  return kind;
}

export function isItemId(value: string): value is ItemId {
  return KINDS.has(value);
}

export function isSupply(kind: ItemKind): kind is SupplyKind {
  return kind.category === "supply";
}

/**
 * A supply cache: a sealed crate that opens into one supply when the hero reaches it. What's
 * inside is fixed for each cache, but only seen once it's opened.
 */
export const CACHE = "cache" as const;
export type LootId = ItemId | typeof CACHE;

/** Something lying on a floor, waiting to be picked up. */
export interface FloorItem extends Point {
  /** Unique within the run, e.g. "4-i2" (floor 4, second item placed). */
  readonly id: string;
  readonly item: LootId;
}

/** A stack of identical items in one pack slot. */
export interface PackEntry {
  readonly item: ItemId;
  readonly count: number;
}

/** The hero's pack: a fixed row of slots, so each item keeps its number key. Empty slots are null. */
export type Pack = readonly (PackEntry | null)[];

export interface Equipment {
  readonly weapon: WeaponId;
  readonly armor: ArmorId;
}

export interface TrapKindInfo {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** The first floor it can appear on. */
  readonly firstFloor: number;
  readonly color: number;
}

/**
 * Traps hide in the floor until bright lantern light (or a Survey Lens) shows them. Each springs
 * once, then is spent. Creatures know where they are and never set them off.
 */
export const TRAPS = [
  {
    id: "ember-vent",
    name: "Ember Vent",
    description:
      "A crack in the floor that spits fire when stepped on. Armor doesn't help against it; a shield does.",
    firstFloor: 2,
    color: 0xff6a2a,
  },
  {
    id: "alarm-glyph",
    name: "Alarm Glyph",
    description:
      "A rune that shrieks when trodden on, waking every creature nearby and telling them where you are.",
    firstFloor: 3,
    color: 0xff4a6a,
  },
  {
    id: "gloom-rune",
    name: "Gloom Rune",
    description: "A rune that drinks light. Step on it and it drains your lantern dry, or nearly.",
    firstFloor: 5,
    color: 0x7a6aff,
  },
] as const satisfies readonly TrapKindInfo[];

export type TrapKind = (typeof TRAPS)[number]["id"];
export const TRAP_IDS: readonly TrapKind[] = TRAPS.map((t) => t.id);

export function trapKind(id: TrapKind): TrapKindInfo {
  const kind = TRAPS.find((t) => t.id === id);
  if (!kind) throw new Error(`Unknown trap: ${id}`);
  return kind;
}

export interface Trap extends Point {
  readonly id: string;
  readonly kind: TrapKind;
  /**
   * Strength, fixed when the floor is made: damage for an Ember Vent, lantern charge drained by a
   * Gloom Rune, and how far (in tiles) an Alarm Glyph's shriek carries.
   */
  readonly power: number;
  /** The hero has seen it, so it is drawn and walked around. */
  readonly found: boolean;
}
