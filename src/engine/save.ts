import { z } from "zod";
import { CREATURE_IDS, type CreatureId } from "./creatures";
import { FLOOR_COUNT, isWalkable, MAP_HEIGHT, MAP_SIZE, MAP_WIDTH, tileAt } from "./map";
import { Rng } from "./rng";
import { HERO_START_HP, LANTERN_MAX } from "./rules";
import { newRun, type RunState } from "./run";

/**
 * One character per save file. The file is self-contained, so it can be copied to another PC.
 *
 * Changing this format: bump SAVE_VERSION, add an upgrade step to UPGRADES that turns the previous
 * version into the new one, and add a test that loads a file in the previous format.
 *
 * Version history:
 * 1. Exploration only (milestone 1).
 * 2. Creatures, combat, the lantern, camps and the bestiary (milestone 3).
 */
export const SAVE_FORMAT = "embercrawl-character";
export const SAVE_VERSION = 2;
export const CHARACTER_NAME_MAX = 24;

export interface CharacterRecord {
  /** Descents started, including the current one. */
  readonly descents: number;
  readonly deepestFloor: number;
  readonly deaths: number;
  /** Every creature kind this character has ever seen (their bestiary). */
  readonly discovered: readonly CreatureId[];
}

export interface CharacterSave {
  readonly format: typeof SAVE_FORMAT;
  readonly version: typeof SAVE_VERSION;
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly playTimeMs: number;
  /** The current descent (possibly just ended in death), or null between descents. */
  readonly run: RunState | null;
  readonly record: CharacterRecord;
}

/** Shown in the character list without loading every floor. */
export interface CharacterSummary {
  readonly id: string;
  readonly name: string;
  readonly depth: number | null;
  readonly level: number | null;
  /** "active": mid-descent. "dead": the last descent ended in death. "none": between descents. */
  readonly status: "active" | "dead" | "none";
  readonly deepestFloor: number;
  readonly playTimeMs: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class SaveFormatError extends Error {
  override name = "SaveFormatError";
}

export const CHARACTER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Trims and tidies a typed name; throws SaveFormatError if it can't be used. */
export function normalizeCharacterName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length === 0) throw new SaveFormatError("A character needs a name.");
  if (name.length > CHARACTER_NAME_MAX) {
    throw new SaveFormatError(`Names can be at most ${CHARACTER_NAME_MAX} characters.`);
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point.
  if (/[\u0000-\u001f\u007f]/.test(name))
    throw new SaveFormatError("Names can't contain control characters.");
  return name;
}

export interface NewCharacterOptions {
  readonly id: string;
  readonly name: string;
  /** ISO timestamp; passed in because the engine never reads the clock. */
  readonly now: string;
  readonly seed: number;
}

export function newCharacter({ id, name, now, seed }: NewCharacterOptions): CharacterSave {
  const run = newRun(seed);
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    id,
    name: normalizeCharacterName(name),
    createdAt: now,
    updatedAt: now,
    playTimeMs: 0,
    run,
    record: { descents: 1, deepestFloor: 1, deaths: 0, discovered: [...run.discovered] },
  };
}

/** Starts a fresh descent (after a death, or between descents). The character keeps its records. */
export function beginDescent(save: CharacterSave, seed: number, now: string): CharacterSave {
  const run = newRun(seed);
  return {
    ...save,
    run,
    updatedAt: now,
    record: {
      ...save.record,
      descents: save.record.descents + 1,
      discovered: mergeDiscovered(save.record.discovered, run.discovered),
    },
  };
}

/** The character after an action: new run state, timestamps, play time and records. */
export function updateCharacter(
  save: CharacterSave,
  run: RunState | null,
  { now, playTimeMs }: { readonly now: string; readonly playTimeMs: number },
): CharacterSave {
  const justDied = run?.status === "dead" && save.run?.status === "active";
  return {
    ...save,
    run,
    updatedAt: now,
    playTimeMs,
    record: {
      ...save.record,
      deepestFloor: Math.max(save.record.deepestFloor, run?.depth ?? 0),
      deaths: save.record.deaths + (justDied ? 1 : 0),
      discovered: mergeDiscovered(save.record.discovered, run?.discovered ?? []),
    },
  };
}

function mergeDiscovered(
  known: readonly CreatureId[],
  seen: readonly CreatureId[],
): readonly CreatureId[] {
  const added = seen.filter((kind) => !known.includes(kind));
  return added.length === 0 ? known : [...known, ...added];
}

export function summarizeCharacter(save: CharacterSave): CharacterSummary {
  return {
    id: save.id,
    name: save.name,
    depth: save.run?.depth ?? null,
    level: save.run?.hero.level ?? null,
    status: save.run?.status ?? "none",
    deepestFloor: save.record.deepestFloor,
    playTimeMs: save.playTimeMs,
    createdAt: save.createdAt,
    updatedAt: save.updatedAt,
  };
}

/**
 * Checks data read from a file (or another process) and returns a valid, current-version save.
 * Throws SaveFormatError with a readable message otherwise.
 */
export function parseCharacterSave(data: unknown): CharacterSave {
  if (!isRecord(data) || data.format !== SAVE_FORMAT) {
    throw new SaveFormatError("This is not an Embercrawl character file.");
  }
  if (typeof data.version !== "number" || !Number.isInteger(data.version) || data.version < 1) {
    throw new SaveFormatError("This character file has no valid version number.");
  }
  if (data.version > SAVE_VERSION) {
    throw new SaveFormatError(
      "This character was saved by a newer version of Embercrawl. Update the game to load it.",
    );
  }
  const result = CharacterSchema.safeParse(upgradeToCurrent(data));
  if (!result.success) {
    throw new SaveFormatError(`This character file is damaged.\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** Upgrade steps, keyed by the version they upgrade from. */
const UPGRADES: Readonly<
  Record<number, (save: Record<string, unknown>) => Record<string, unknown>>
> = {
  /**
   * 1 → 2: adds combat. The hero starts at full health on level 1 with a full lantern. Floors
   * already explored stay empty of creatures and have no camp; floors visited later get both.
   */
  1: (save) => {
    const record = isRecord(save.record) ? save.record : {};
    return {
      ...save,
      run: isRecord(save.run) ? upgradeRunFrom1(save.run) : null,
      record: { ...record, deaths: 0, discovered: [] },
    };
  },
};

function upgradeRunFrom1(run: Record<string, unknown>): Record<string, unknown> {
  const seed = Number.isInteger(run.seed) ? (run.seed as number) : 0;
  const floors = Array.isArray(run.floors) ? run.floors : [];
  return {
    ...run,
    hero: {
      ...(isRecord(run.hero) ? run.hero : {}),
      hp: HERO_START_HP,
      maxHp: HERO_START_HP,
      level: 1,
      xp: 0,
      shield: 0,
    },
    lantern: { charge: LANTERN_MAX, bright: false },
    rng: Rng.derive(seed, "play").state(),
    kills: 0,
    discovered: [],
    status: "active",
    killedBy: null,
    floors: floors.map((floor) =>
      isRecord(floor) ? { ...floor, camp: null, campUsed: false, monsters: [] } : floor,
    ),
  };
}

function upgradeToCurrent(data: Record<string, unknown>): Record<string, unknown> {
  let current = data;
  for (let version = data.version as number; version < SAVE_VERSION; version++) {
    const upgrade = UPGRADES[version];
    if (!upgrade) throw new SaveFormatError(`No upgrade exists from save version ${version}.`);
    current = { ...upgrade(current), version: version + 1 };
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const Count = z.number().int().min(0);

const PointSchema = z.object({
  x: z
    .number()
    .int()
    .min(0)
    .max(MAP_WIDTH - 1),
  y: z
    .number()
    .int()
    .min(0)
    .max(MAP_HEIGHT - 1),
});

const FacingSchema = z.enum(["left", "right"]);

const CreatureIdSchema = z.enum(CREATURE_IDS as unknown as [CreatureId, ...CreatureId[]]);

const TileSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

const MonsterSchema = PointSchema.extend({
  id: z.string().min(1).max(16),
  kind: CreatureIdSchema,
  hp: z.number().int().min(1),
  maxHp: z.number().int().min(1),
  attack: z.number().int().min(1),
  alert: z.boolean(),
  lastSeen: PointSchema.nullable(),
  ready: z.boolean(),
  facing: FacingSchema,
});

const FloorSchema = z.object({
  depth: z.number().int().min(1).max(FLOOR_COUNT),
  tiles: z.array(TileSchema).length(MAP_SIZE),
  explored: z.array(z.boolean()).length(MAP_SIZE),
  upStairs: PointSchema.nullable(),
  downStairs: PointSchema.nullable(),
  entrance: PointSchema,
  camp: PointSchema.nullable(),
  campUsed: z.boolean(),
  monsters: z.array(MonsterSchema).max(40),
});

const HeroSchema = PointSchema.extend({
  facing: FacingSchema,
  hp: Count,
  maxHp: z.number().int().min(1),
  level: z.number().int().min(1).max(99),
  xp: Count,
  shield: Count,
});

const Uint32 = z
  .number()
  .int()
  .min(0)
  .max(2 ** 32 - 1);

const RunSchema = z
  .object({
    seed: z.number().int(),
    turn: Count,
    depth: z.number().int().min(1).max(FLOOR_COUNT),
    floors: z.array(FloorSchema).min(1).max(FLOOR_COUNT),
    hero: HeroSchema,
    lantern: z.object({ charge: Count.max(LANTERN_MAX), bright: z.boolean() }),
    rng: z.tuple([Uint32, Uint32, Uint32, Uint32]),
    kills: Count,
    discovered: z.array(CreatureIdSchema),
    status: z.enum(["active", "dead"]),
    killedBy: CreatureIdSchema.nullable(),
  })
  .refine((run) => new Set(run.floors.map((f) => f.depth)).size === run.floors.length, {
    message: "Each floor may appear only once.",
  })
  .refine(
    (run) => {
      const floor = run.floors.find((f) => f.depth === run.depth);
      return floor !== undefined && isWalkable(tileAt(floor.tiles, run.hero));
    },
    { message: "The hero must stand on an open tile of the current floor." },
  )
  .refine((run) => run.hero.hp <= run.hero.maxHp, {
    message: "The hero's health can't exceed their maximum.",
  });

const IsoTimestamp = z.iso.datetime({ offset: true });

const CharacterSchema = z.object({
  format: z.literal(SAVE_FORMAT),
  version: z.literal(SAVE_VERSION),
  id: z.string().regex(CHARACTER_ID_PATTERN),
  name: z.string().min(1).max(CHARACTER_NAME_MAX),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
  playTimeMs: Count,
  run: RunSchema.nullable(),
  record: z.object({
    descents: Count,
    deepestFloor: Count.max(FLOOR_COUNT),
    deaths: Count,
    discovered: z.array(CreatureIdSchema),
  }),
}) satisfies z.ZodType<CharacterSave>;
