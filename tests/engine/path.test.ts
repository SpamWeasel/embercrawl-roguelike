import { describe, expect, it } from "vitest";
import { chebyshevDistance, type Point, samePoint, step } from "../../src/engine/geometry";
import { canStep, indexOf } from "../../src/engine/map";
import { findPath, stepDistances } from "../../src/engine/path";
import { mapFrom } from "./helpers";

const room = mapFrom([
  "##########", //
  "#........#",
  "#........#",
  "#........#",
  "#........#",
  "##########",
]);

describe("findPath", () => {
  it("finds a shortest route using diagonals", () => {
    const from = { x: 1, y: 1 };
    const to = { x: 8, y: 4 };
    const route = findPath(room, from, to);
    expect(route).not.toBeNull();
    expect(route?.length).toBe(chebyshevDistance(from, to));
  });

  it("produces a route that follows the movement rules to the target", () => {
    const maze = mapFrom([
      "#########", //
      "#...#...#",
      "#.#.#.#.#",
      "#.#...#.#",
      "#########",
    ]);
    const from = { x: 1, y: 1 };
    const to = { x: 7, y: 3 };
    const route = findPath(maze, from, to) ?? [];
    let position: Point = from;
    for (const direction of route) {
      expect(canStep(maze, position, direction)).toBe(true);
      position = step(position, direction);
    }
    expect(samePoint(position, to)).toBe(true);
  });

  it("returns null when the only gap is a diagonal squeeze", () => {
    const sealed = mapFrom([
      "#####", //
      "#.###",
      "##..#",
      "#####",
    ]);
    expect(findPath(sealed, { x: 1, y: 1 }, { x: 3, y: 2 })).toBeNull();
  });

  it("only uses tiles the passable test allows", () => {
    const explored = new Set([indexOf({ x: 1, y: 1 }), indexOf({ x: 2, y: 1 })]);
    expect(findPath(room, { x: 1, y: 1 }, { x: 2, y: 1 }, (i) => explored.has(i))).toEqual(["e"]);
    expect(findPath(room, { x: 1, y: 1 }, { x: 5, y: 1 }, (i) => explored.has(i))).toBeNull();
  });

  it("returns an empty route when already there", () => {
    expect(findPath(room, { x: 3, y: 3 }, { x: 3, y: 3 })).toEqual([]);
  });
});

describe("stepDistances", () => {
  it("counts diagonal steps as one and marks unreachable tiles -1", () => {
    const distances = stepDistances(room, { x: 1, y: 1 });
    expect(distances[indexOf({ x: 4, y: 4 })]).toBe(3);
    expect(distances[indexOf({ x: 0, y: 0 })]).toBe(-1);
  });
});
