import { describe, expect, it } from "vitest";
import { DIRECTIONS } from "../../src/engine/geometry";
import { indexOf, isWalkable, tileAt } from "../../src/engine/map";
import { Rng } from "../../src/engine/rng";
import { PACK_SLOTS, STACK_LIMIT } from "../../src/engine/rules";
import {
  type Action,
  applyAction,
  availableInteraction,
  currentFloor,
  newRun,
  type RunState,
} from "../../src/engine/run";
import { newCharacter, parseCharacterSave, updateCharacter } from "../../src/engine/save";

/**
 * Mostly moves, with the occasional wait, lantern use, rest, trip down the stairs, item used or
 * dropped, or pick-up.
 */
function randomAction(rng: Rng, run: RunState): Action {
  const interaction = availableInteraction(run);
  const stairs = interaction?.kind === "descend" || interaction?.kind === "ascend";
  if (stairs && rng.chance(0.6)) return { type: "use-stairs" };
  if (interaction?.kind === "rest") return { type: "rest" };
  if (interaction?.kind === "pick-up" && rng.chance(0.5)) return { type: "pick-up" };
  const roll = rng.float();
  if (roll < 0.05) return { type: "wait" };
  if (roll < 0.08) return { type: "toggle-light" };
  if (roll < 0.1) return { type: "pulse" };
  if (roll < 0.16) return { type: "use-item", slot: rng.int(0, PACK_SLOTS - 1) };
  if (roll < 0.17) return { type: "drop-item", slot: rng.int(0, PACK_SLOTS - 1) };
  // Mostly refused away from a merchant or the Beacon, which is part of what this checks.
  if (roll < 0.175) return { type: "buy", offer: rng.int(0, 5) };
  if (roll < 0.18) return { type: "sell", slot: rng.int(0, PACK_SLOTS - 1) };
  if (roll < 0.182) return { type: "rekindle" };
  return { type: "move", direction: rng.pick(DIRECTIONS) };
}

function checkInvariants(run: RunState): void {
  const floor = currentFloor(run);
  const { hero } = run;
  expect(isWalkable(tileAt(floor.tiles, hero))).toBe(true);
  expect(hero.hp).toBeGreaterThanOrEqual(0);
  expect(hero.hp).toBeLessThanOrEqual(hero.maxHp);
  expect(run.lantern.charge).toBeGreaterThanOrEqual(0);
  expect(run.lantern.charge).toBeLessThanOrEqual(100);
  expect(run.status === "dead").toBe(hero.hp === 0);
  expect(run.gold).toBeGreaterThanOrEqual(0);
  expect(run.pack).toHaveLength(PACK_SLOTS);
  for (const entry of run.pack) {
    if (entry) expect(entry.count).toBeGreaterThanOrEqual(1);
    if (entry) expect(entry.count).toBeLessThanOrEqual(STACK_LIMIT);
  }
  const loot = new Set<number>();
  for (const item of floor.items) {
    expect(isWalkable(tileAt(floor.tiles, item))).toBe(true);
    expect(loot.has(indexOf(item))).toBe(false);
    loot.add(indexOf(item));
  }
  const spots = new Set<number>([indexOf(hero)]);
  for (const monster of floor.monsters) {
    expect(monster.hp).toBeGreaterThan(0);
    expect(isWalkable(tileAt(floor.tiles, monster))).toBe(true);
    if (floor.camp) expect(indexOf(monster)).not.toBe(indexOf(floor.camp));
    expect(spots.has(indexOf(monster))).toBe(false);
    spots.add(indexOf(monster));
  }
}

describe("random play", () => {
  it("never breaks the game's rules across many seeds", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 24; seed++) {
      const rng = Rng.fromSeed(seed * 31);
      let run = newRun(seed);
      for (let step = 0; step < 500 && run.status === "active"; step++) {
        const result = applyAction(run, randomAction(rng, run));
        if (!result.tookTurn) expect(result.run).toBe(run);
        else expect(result.run.turn).toBe(run.turn + 1);
        for (const event of result.events) seen.add(event.type);
        run = result.run;
        checkInvariants(run);
      }
      // Whatever state play ended in, it saves and loads back identically.
      const character = updateCharacter(
        newCharacter({
          id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          name: "Fuzz",
          now: "2026-10-17T00:00:00.000Z",
          seed,
        }),
        run,
        { now: "2026-10-17T01:00:00.000Z", playTimeMs: 1 },
      );
      expect(parseCharacterSave(JSON.parse(JSON.stringify(character)))).toEqual(character);
    }
    // The random play really did reach the item rules. (It seldom leaves floor 1, so traps,
    // which start on floor 2, are left to their own tests.)
    for (const type of ["picked-up", "used", "dropped"]) expect(seen).toContain(type);
  });
});
