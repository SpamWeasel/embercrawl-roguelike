import { describe, expect, it } from "vitest";
import { FLOOR_COUNT } from "../../src/engine/map";
import {
  FINAL_PALETTE,
  ORIGINAL_PALETTE,
  PALETTE_GROUP_SIZE,
  paletteForFloor,
  REGULAR_PALETTES,
} from "../../src/renderer/src/render/dungeon/palettes";

const SEEDS = [0, 1, 7, 42, 99, 123456, 2 ** 31, 4294967295];
const sequence = (seed: number) =>
  Array.from({ length: FLOOR_COUNT }, (_, i) => paletteForFloor(seed, i + 1).id);

describe("floor palettes", () => {
  it("open every descent with the original palette on floors 1-3", () => {
    for (const seed of SEEDS) {
      for (const depth of [1, 2, 3]) expect(paletteForFloor(seed, depth)).toBe(ORIGINAL_PALETTE);
    }
  });

  it("change at every third floor and hold for the whole group", () => {
    for (const seed of SEEDS) {
      for (let first = PALETTE_GROUP_SIZE + 1; first < FLOOR_COUNT; first += PALETTE_GROUP_SIZE) {
        const palette = paletteForFloor(seed, first);
        expect(palette, `seed ${seed}, floor ${first}`).not.toBe(paletteForFloor(seed, first - 1));
        expect(REGULAR_PALETTES).toContain(palette);
        for (
          let depth = first + 1;
          depth < Math.min(first + PALETTE_GROUP_SIZE, FLOOR_COUNT);
          depth++
        ) {
          expect(paletteForFloor(seed, depth)).toBe(palette);
        }
      }
    }
  });

  it("give the final floor its own palette, used nowhere else", () => {
    expect(REGULAR_PALETTES).not.toContain(FINAL_PALETTE);
    for (const seed of SEEDS) {
      expect(paletteForFloor(seed, FLOOR_COUNT)).toBe(FINAL_PALETTE);
      for (let depth = 1; depth < FLOOR_COUNT; depth++) {
        expect(paletteForFloor(seed, depth)).not.toBe(FINAL_PALETTE);
      }
    }
  });

  it("stay the same for a run and differ between runs", () => {
    for (const seed of SEEDS) expect(sequence(seed)).toEqual(sequence(seed));
    const distinct = new Set(
      Array.from({ length: 40 }, (_, i) => sequence(i * 9973 + 1).join(",")),
    );
    expect(distinct.size).toBeGreaterThan(30);
  });

  it("use every regular palette somewhere across many runs", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      for (let depth = PALETTE_GROUP_SIZE + 1; depth < FLOOR_COUNT; depth++) {
        seen.add(paletteForFloor(seed, depth).id);
      }
    }
    expect(seen.size).toBe(REGULAR_PALETTES.length);
  });

  it("have distinct names and ids", () => {
    const all = [...REGULAR_PALETTES, FINAL_PALETTE];
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
    expect(new Set(all.map((p) => p.name)).size).toBe(all.length);
  });
});
