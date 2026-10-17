import { describe, expect, it } from "vitest";
import { generateFloor } from "../../src/engine/generate";
import {
  FLOOR_COUNT,
  indexOf,
  isWalkable,
  MAP_HEIGHT,
  MAP_WIDTH,
  pointOf,
  Tile,
  tileAt,
} from "../../src/engine/map";
import { stepDistances } from "../../src/engine/path";

const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7919 + 1);
const DEPTHS = [1, 2, 15, FLOOR_COUNT - 1, FLOOR_COUNT];

describe("generateFloor", () => {
  it("builds the same floor from the same seed and depth", () => {
    expect(generateFloor(42, 3)).toEqual(generateFloor(42, 3));
  });

  it("builds different floors for different depths and seeds", () => {
    expect(generateFloor(42, 3).tiles).not.toEqual(generateFloor(42, 4).tiles);
    expect(generateFloor(42, 3).tiles).not.toEqual(generateFloor(43, 3).tiles);
  });

  it("varies the layout between seeds", () => {
    const openCounts = new Set(
      SEEDS.slice(0, 50).map((seed) => generateFloor(seed, 1).tiles.filter(isWalkable).length),
    );
    expect(openCounts.size).toBeGreaterThan(15);
  });

  it("rejects depths outside the descent", () => {
    expect(() => generateFloor(1, 0)).toThrow(RangeError);
    expect(() => generateFloor(1, FLOOR_COUNT + 1)).toThrow(RangeError);
  });

  for (const depth of DEPTHS) {
    it(`keeps every floor ${depth} sound across ${SEEDS.length} seeds`, () => {
      for (const seed of SEEDS) {
        const floor = generateFloor(seed, depth);

        // Solid outer border.
        for (let x = 0; x < MAP_WIDTH; x++) {
          expect(tileAt(floor.tiles, { x, y: 0 })).toBe(Tile.Wall);
          expect(tileAt(floor.tiles, { x, y: MAP_HEIGHT - 1 })).toBe(Tile.Wall);
        }
        for (let y = 0; y < MAP_HEIGHT; y++) {
          expect(tileAt(floor.tiles, { x: 0, y })).toBe(Tile.Wall);
          expect(tileAt(floor.tiles, { x: MAP_WIDTH - 1, y })).toBe(Tile.Wall);
        }

        // Stairs exist exactly where the descent needs them.
        expect(floor.upStairs === null).toBe(depth === 1);
        expect(floor.downStairs === null).toBe(depth === FLOOR_COUNT);
        if (floor.upStairs) {
          expect(tileAt(floor.tiles, floor.upStairs)).toBe(Tile.StairsUp);
          expect(floor.entrance).toEqual(floor.upStairs);
        }
        if (floor.downStairs) expect(tileAt(floor.tiles, floor.downStairs)).toBe(Tile.StairsDown);
        expect(floor.tiles.filter((t) => t === Tile.StairsUp).length).toBe(depth > 1 ? 1 : 0);
        expect(floor.tiles.filter((t) => t === Tile.StairsDown).length).toBe(
          depth < FLOOR_COUNT ? 1 : 0,
        );

        // Every open tile can be reached from the entrance with the normal movement rules.
        const distances = stepDistances(floor.tiles, floor.entrance);
        floor.tiles.forEach((kind, index) => {
          if (isWalkable(kind)) {
            expect(
              distances[index],
              `seed ${seed} tile ${JSON.stringify(pointOf(index))}`,
            ).not.toBe(-1);
          }
        });

        // The way down is a real walk away from the way in.
        if (floor.downStairs) {
          expect(distances[indexOf(floor.downStairs)]).toBeGreaterThanOrEqual(8);
        }

        expect(floor.explored.every((seen) => seen === false)).toBe(true);
      }
    });
  }
});
