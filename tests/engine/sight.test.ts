import { describe, expect, it } from "vitest";
import { indexOf } from "../../src/engine/map";
import { computeVisible, hasLineOfSight } from "../../src/engine/sight";
import { mapFrom } from "./helpers";

const at = (x: number, y: number) => indexOf({ x, y });

describe("computeVisible", () => {
  it("shows a whole small room, including its walls", () => {
    const room = mapFrom([
      "#####", //
      "#...#",
      "#...#",
      "#####",
    ]);
    const visible = computeVisible(room, { x: 2, y: 1 }, 5);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 5; x++) expect(visible.has(at(x, y))).toBe(true);
  });

  it("does not see past a wall", () => {
    const split = mapFrom([
      "#######", //
      "#..#..#",
      "#######",
    ]);
    const visible = computeVisible(split, { x: 1, y: 1 }, 6);
    expect(visible.has(at(2, 1))).toBe(true);
    expect(visible.has(at(3, 1))).toBe(true); // the wall itself is seen
    expect(visible.has(at(4, 1))).toBe(false);
    expect(visible.has(at(5, 1))).toBe(false);
  });

  it("respects the sight radius", () => {
    const corridor = mapFrom(["#".repeat(20), `#${".".repeat(18)}#`, "#".repeat(20)]);
    const visible = computeVisible(corridor, { x: 1, y: 1 }, 5);
    expect(visible.has(at(6, 1))).toBe(true);
    expect(visible.has(at(7, 1))).toBe(false);
  });

  it("sees a doorway in the far corner of a room", () => {
    // Found in play: a single grid line from the hero clips the wall beside the doorway.
    const room = mapFrom([
      "#.######", //
      "#......#",
      "#......#",
      "#......#",
      "########",
    ]);
    const hero = { x: 5, y: 2 };
    const doorway = { x: 1, y: 0 };
    expect(hasLineOfSight(room, hero, doorway)).toBe(true);
    expect(computeVisible(room, hero, 5).has(at(doorway.x, doorway.y))).toBe(true);
  });

  it("is symmetric: if one tile sees another, the other sees it back", () => {
    const pillars = mapFrom([
      "##########", //
      "#........#",
      "#.#..#.#.#",
      "#....#...#",
      "#.##.....#",
      "##########",
    ]);
    const open: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 10; x++) if (pillars[at(x, y)] !== 0) open.push({ x, y });
    }
    for (const a of open) {
      for (const b of open)
        expect(hasLineOfSight(pillars, a, b)).toBe(hasLineOfSight(pillars, b, a));
    }
  });

  it("cannot see through a diagonal gap between two walls", () => {
    const seam = mapFrom([
      "#####", //
      "#.###",
      "##..#",
      "##..#",
      "#####",
    ]);
    expect(hasLineOfSight(seam, { x: 1, y: 1 }, { x: 2, y: 2 })).toBe(false);
    const visible = computeVisible(seam, { x: 1, y: 1 }, 5);
    expect(visible.has(at(2, 2))).toBe(false);
    expect(visible.has(at(3, 3))).toBe(false);
  });
});
