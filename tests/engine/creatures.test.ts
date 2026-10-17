import { describe, expect, it } from "vitest";
import { CREATURES, creatureKind } from "../../src/engine/creatures";
import { generateFloor } from "../../src/engine/generate";
import { samePoint } from "../../src/engine/geometry";
import { FLOOR_COUNT, indexOf, Tile, tileAt } from "../../src/engine/map";
import { stepDistances } from "../../src/engine/path";
import {
  CREATURE_LIFESPAN,
  creatureCount,
  SPAWN_CLEARANCE,
  scaledStats,
} from "../../src/engine/rules";

describe("the creature roster", () => {
  it("has 25 creatures with unique ids, using every behavior", () => {
    expect(CREATURES).toHaveLength(25);
    expect(new Set(CREATURES.map((c) => c.id)).size).toBe(25);
    expect(new Set(CREATURES.map((c) => c.behavior))).toEqual(
      new Set(["chase", "slow", "ranged", "erratic", "swift"]),
    );
  });

  it("has guardians on floors 10, 20 and 30 only", () => {
    const guardians = CREATURES.filter((c) => "guardian" in c).map((c) => c.firstFloor);
    expect(guardians).toEqual([10, 20, 30]);
  });
});

describe("creature strength", () => {
  it("grows the deeper below its first floor a creature appears", () => {
    const mite = creatureKind("cinder-mite");
    const shallow = scaledStats(mite, 1, 0.5);
    const deep = scaledStats(mite, 10, 0.5);
    expect(deep.hp).toBeGreaterThan(shallow.hp);
    expect(deep.attack).toBeGreaterThan(shallow.attack);
  });

  it("varies regular creatures' health but never a guardian's", () => {
    const mite = creatureKind("cinder-mite");
    expect(scaledStats(mite, 5, 0).hp).toBeLessThan(scaledStats(mite, 5, 0.99).hp);
    const warden = creatureKind("beacon-warden");
    expect(scaledStats(warden, 30, 0).hp).toBe(scaledStats(warden, 30, 0.99).hp);
  });
});

describe("floor population", () => {
  const SEEDS = Array.from({ length: 40 }, (_, i) => i * 104729 + 3);

  for (let depth = 1; depth <= FLOOR_COUNT; depth++) {
    it(`places floor ${depth}'s creatures and camp soundly`, () => {
      for (const seed of SEEDS) {
        const floor = generateFloor(seed, depth);
        const distances = stepDistances(floor.tiles, floor.entrance);
        const guardianHere = CREATURES.some((c) => "guardian" in c && c.firstFloor === depth);

        expect(floor.monsters.length).toBeLessThanOrEqual(
          creatureCount(depth) + (guardianHere ? 1 : 0),
        );
        expect(floor.monsters.length).toBeGreaterThan(0);
        expect(new Set(floor.monsters.map((m) => m.id)).size).toBe(floor.monsters.length);
        expect(new Set(floor.monsters.map((m) => `${m.x},${m.y}`)).size).toBe(
          floor.monsters.length,
        );

        for (const monster of floor.monsters) {
          const kind = creatureKind(monster.kind);
          expect(tileAt(floor.tiles, monster)).toBe(Tile.Floor);
          expect(distances[indexOf(monster)]).toBeGreaterThan(SPAWN_CLEARANCE);
          if (floor.camp) expect(samePoint(monster, floor.camp)).toBe(false);
          if ("guardian" in kind) {
            expect(kind.firstFloor).toBe(depth);
          } else {
            expect(kind.firstFloor).toBeLessThanOrEqual(depth);
            expect(kind.firstFloor).toBeGreaterThan(depth - CREATURE_LIFESPAN);
          }
          expect(monster.hp).toBe(monster.maxHp);
          expect(monster.alert).toBe(false);
        }
        const guardians = floor.monsters.filter((m) => "guardian" in creatureKind(m.kind));
        expect(guardians).toHaveLength(guardianHere ? 1 : 0);

        expect(floor.camp).not.toBeNull();
        if (floor.camp) {
          expect(tileAt(floor.tiles, floor.camp)).toBe(Tile.Floor);
          expect(distances[indexOf(floor.camp)]).toBeGreaterThan(0);
        }
      }
    });
  }

  it("keeps floor shapes exactly as before creatures were added", () => {
    // Layout and stairs are drawn before camps and creatures, so these match milestone 1's floors.
    const floor = generateFloor(42, 3);
    expect(floor.tiles.filter((t) => t !== Tile.Wall)).toHaveLength(
      generateFloor(42, 3).tiles.filter((t) => t !== Tile.Wall).length,
    );
    expect(floor.downStairs).toEqual(generateFloor(42, 3).downStairs);
  });
});
