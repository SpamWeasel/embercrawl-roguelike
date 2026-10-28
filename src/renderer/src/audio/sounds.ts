/**
 * The game's sound effects: their ids, what each is for, and the pure helpers that decide how one
 * plays (where it sits left to right, how loud, how high a creature's voice is). Nothing here
 * touches Web Audio, so it can be tested anywhere.
 *
 * Every sound is synthesized in code (`synth.ts`), so the game needs no recordings. Like the art,
 * a sound can be replaced by dropping a file named after its id into `assets/sounds/`
 * (`hit.ogg`, or `hit-1.ogg`, `hit-2.ogg` … for variations played at random).
 */
import { CREATURES, type CreatureId } from "../../../engine/creatures";
import type { Point } from "../../../engine/geometry";

/** Which volume slider a sound follows. */
export type SoundGroup = "effects" | "interface" | "ambience";

interface SoundInfo {
  readonly group: SoundGroup;
  /** What it's for, in the settings' sound list and the development guide. */
  readonly description: string;
}

export const SOUNDS = {
  step: { group: "effects", description: "The hero's footstep" },
  "heavy-step": { group: "effects", description: "A heavy creature's footfall" },
  bump: { group: "effects", description: "Walking into a wall" },
  swing: { group: "effects", description: "The hero swings a weapon" },
  hit: { group: "effects", description: "A blow lands on a creature" },
  "hero-hurt": { group: "effects", description: "The hero is struck" },
  armor: { group: "effects", description: "Armor or a ward soaks up some of a blow" },
  bolt: { group: "effects", description: "A creature's ranged attack" },
  "creature-notice": { group: "effects", description: "A creature notices the hero" },
  "creature-ready": { group: "effects", description: "A creature readies a strike (red marker)" },
  "creature-die": { group: "effects", description: "A creature falls" },
  "guardian-die": { group: "effects", description: "A guardian falls" },
  death: { group: "effects", description: "The hero falls" },
  "level-up": { group: "effects", description: "A new level" },
  stairs: { group: "effects", description: "Going down the stairs" },
  "lantern-bright": { group: "effects", description: "The lantern flares bright" },
  "lantern-dim": { group: "effects", description: "The lantern dims" },
  pulse: { group: "effects", description: "A lantern pulse" },
  rest: { group: "effects", description: "Resting at a camp" },
  denied: { group: "effects", description: "Something can't be done (no charge, pack full …)" },
  pickup: { group: "effects", description: "Picking up an item" },
  "cache-open": { group: "effects", description: "Breaking open a supply cache" },
  coins: { group: "effects", description: "Gold picked up, spent or earned" },
  hoard: { group: "effects", description: "A guardian's hoard spills out" },
  "equip-weapon": { group: "effects", description: "Wielding a weapon" },
  "equip-armor": { group: "effects", description: "Putting on armor" },
  drop: { group: "effects", description: "Dropping an item" },
  heal: { group: "effects", description: "A salve heals" },
  vigor: { group: "effects", description: "A vigor draught" },
  charge: { group: "effects", description: "An ember shard recharges the lantern" },
  shield: { group: "effects", description: "A ward sigil" },
  flare: { group: "effects", description: "A flare flask bursts" },
  survey: { group: "effects", description: "A survey lens maps the floor" },
  waystone: { group: "effects", description: "A waystone carries the hero away" },
  "trap-found": { group: "effects", description: "A hidden trap is spotted" },
  "trap-ember-vent": { group: "effects", description: "An ember vent erupts" },
  "trap-alarm-glyph": { group: "effects", description: "An alarm glyph rings" },
  "trap-gloom-rune": { group: "effects", description: "A gloom rune drains the light" },
  "trap-spike-trap": { group: "effects", description: "A spike trap springs" },
  sealed: { group: "effects", description: "Stairs or Beacon held shut by a guardian" },
  rekindle: { group: "effects", description: "The Beacon is rekindled" },
  "ui-click": { group: "interface", description: "Pressing a button" },
  "ui-open": { group: "interface", description: "Opening a panel or menu" },
  "ui-close": { group: "interface", description: "Closing a panel or menu" },
  achievement: { group: "interface", description: "An achievement is earned" },
  ambience: { group: "ambience", description: "The deep's background air (loops)" },
  drip: { group: "ambience", description: "Water dripping somewhere nearby" },
  rumble: { group: "ambience", description: "Distant shifting stone, deeper down" },
} as const satisfies Record<string, SoundInfo>;

export type SoundId = keyof typeof SOUNDS;
export const SOUND_IDS = Object.keys(SOUNDS) as SoundId[];

export function isSoundId(name: string): name is SoundId {
  return Object.hasOwn(SOUNDS, name);
}

/**
 * The sound a file in `assets/sounds/` replaces: `hit.ogg` and `hit-2.wav` are both `hit`.
 * Returns null for names that match no sound.
 */
export function soundForFile(path: string): SoundId | null {
  const name = (path.split(/[\\/]/).pop() ?? "").replace(/\.(ogg|mp3|wav)$/i, "");
  if (isSoundId(name)) return name;
  const variant = /^(.+)-\d+$/.exec(name);
  return variant?.[1] && isSoundId(variant[1]) ? variant[1] : null;
}

/** A slider position (0–100) as a gain; squared, so the slider feels even to the ear. */
export function volumeGain(percent: number): number {
  const clamped = Math.min(100, Math.max(0, percent)) / 100;
  return clamped * clamped;
}

/** How a sound at `at` is heard by a hero standing at `listener`. */
export interface Placement {
  /** −1 (left) to 1 (right). */
  readonly pan: number;
  /** 0 to 1. */
  readonly gain: number;
}

/** Sounds come from where they happen: off to one side, and softer further away. */
export function placeSound(at: Point, listener: Point): Placement {
  const dx = at.x - listener.x;
  const dy = at.y - listener.y;
  const distance = Math.hypot(dx, dy);
  const pan = Math.max(-1, Math.min(1, dx / 8)) * 0.65;
  const gain = Math.max(0.35, Math.min(1, 1 / (1 + Math.max(0, distance - 1.5) * 0.11)));
  return { pan, gain };
}

const GUARDIANS: ReadonlySet<CreatureId> = new Set([
  "chain-sexton",
  "orrery-knight",
  "beacon-warden",
]);

export function isGuardian(kind: CreatureId): boolean {
  return GUARDIANS.has(kind);
}

/**
 * How high a creature's sounds play (1 = as made): small, quick creatures squeak, slow ones and
 * guardians rumble. Each kind gets its own slight offset so two kinds rarely sound the same.
 */
export function creatureVoice(kind: CreatureId): number {
  const creature = CREATURES.find((c) => c.id === kind);
  if (!creature) return 1;
  if (isGuardian(kind)) return 0.62;
  const base = { swift: 1.28, erratic: 1.12, chase: 1, ranged: 1.06, slow: 0.78 }[
    creature.behavior
  ];
  let hash = 0;
  for (const char of kind) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return base * (0.94 + (hash % 13) / 100);
}

/** Creatures heavy enough that their footsteps are heard. */
export function hasHeavyStep(kind: CreatureId): boolean {
  const creature = CREATURES.find((c) => c.id === kind);
  return creature?.behavior === "slow";
}

/** How the background air sounds on a floor: lower and more restless further down. */
export interface AmbienceMood {
  /** Playback speed of the air loop (lower sounds deeper). */
  readonly rate: number;
  /** Low-pass cutoff of the air, in hertz. */
  readonly cutoff: number;
  /** Seconds between drips, on average (0 = none). */
  readonly dripEvery: number;
  /** Seconds between distant rumbles, on average (0 = none). */
  readonly rumbleEvery: number;
}

export function ambienceMood(depth: number): AmbienceMood {
  if (depth >= 30) return { rate: 0.7, cutoff: 520, dripEvery: 0, rumbleEvery: 9 };
  const t = Math.min(1, Math.max(0, (depth - 1) / 28));
  return {
    rate: 1 - t * 0.22,
    cutoff: Math.round(900 - t * 380),
    dripEvery: Math.round(7 + t * 10),
    rumbleEvery: depth >= 8 ? Math.round(34 - t * 16) : 0,
  };
}

/** A small seeded random generator (mulberry32), so recipes render the same every time. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function hashText(text: string): number {
  let hash = 2_166_136_261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16_777_619) >>> 0;
  return hash;
}
