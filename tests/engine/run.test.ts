import { describe, expect, it } from "vitest";
import { DIRECTIONS, type Direction, step } from "../../src/engine/geometry";
import { canStep, FLOOR_COUNT, indexOf } from "../../src/engine/map";
import { findPath } from "../../src/engine/path";
import {
  applyAction,
  availableInteraction,
  currentFloor,
  newRun,
  type RunState,
  visibleTiles,
} from "../../src/engine/run";
import { deepFreeze, emptyFloor } from "./helpers";

/** Walks the hero to a tile on the current floor by repeated move actions, with nothing else about. */
function walkTo(run: RunState, target: { x: number; y: number }): RunState {
  const route = findPath(currentFloor(run).tiles, run.hero, target);
  if (!route) throw new Error("No route in test.");
  return route.reduce(
    (state, direction) => applyAction(state, { type: "move", direction }).run,
    emptyFloor(run),
  );
}

function openDirection(run: RunState): Direction {
  const direction = DIRECTIONS.find((d) => canStep(currentFloor(run).tiles, run.hero, d));
  if (!direction) throw new Error("Hero is boxed in.");
  return direction;
}

describe("newRun", () => {
  it("starts on floor 1 at the entrance with the surroundings explored", () => {
    const run = newRun(5);
    const floor = currentFloor(run);
    expect(run.depth).toBe(1);
    expect(run.turn).toBe(0);
    expect({ x: run.hero.x, y: run.hero.y }).toEqual(floor.entrance);
    for (const index of visibleTiles(run)) expect(floor.explored[index]).toBe(true);
  });
});

describe("applyAction", () => {
  it("never changes the run it was given", () => {
    const run = deepFreeze(newRun(9));
    expect(() => applyAction(run, { type: "move", direction: openDirection(run) })).not.toThrow();
    expect(() => applyAction(run, { type: "wait" })).not.toThrow();
    expect(() => applyAction(run, { type: "use-stairs" })).not.toThrow();
  });

  it("moves the hero, spends a turn and explores what comes into view", () => {
    const run = newRun(11);
    const direction = openDirection(run);
    const result = applyAction(run, { type: "move", direction });
    expect(result.tookTurn).toBe(true);
    expect(result.run.turn).toBe(1);
    expect({ x: result.run.hero.x, y: result.run.hero.y }).toEqual(step(run.hero, direction));
    for (const index of visibleTiles(result.run)) {
      expect(currentFloor(result.run).explored[index]).toBe(true);
    }
  });

  it("does not spend a turn when walking into a wall", () => {
    const run = newRun(13);
    const blocked = DIRECTIONS.find((d) => !canStep(currentFloor(run).tiles, run.hero, d));
    if (!blocked) return; // hero happens to be in open space on every side
    const result = applyAction(run, { type: "move", direction: blocked });
    expect(result.tookTurn).toBe(false);
    expect(result.run).toBe(run);
    expect(result.events).toEqual([{ type: "blocked", direction: blocked }]);
  });

  it("turns the hero to face sideways moves only", () => {
    const run = newRun(17);
    const floor = currentFloor(run);
    const west = DIRECTIONS.filter((d) => d.includes("w")).find((d) =>
      canStep(floor.tiles, run.hero, d),
    );
    if (west)
      expect(applyAction(run, { type: "move", direction: west }).run.hero.facing).toBe("left");
    const vertical = (["n", "s"] as const).find((d) => canStep(floor.tiles, run.hero, d));
    if (vertical) {
      expect(applyAction(run, { type: "move", direction: vertical }).run.hero.facing).toBe(
        run.hero.facing,
      );
    }
  });

  it("waiting spends a turn without moving", () => {
    const run = newRun(19);
    const result = applyAction(run, { type: "wait" });
    expect(result.tookTurn).toBe(true);
    expect(result.run.turn).toBe(1);
    expect(result.run.hero).toEqual(run.hero);
  });

  it("refuses to use stairs that aren't there", () => {
    const run = newRun(23);
    expect(availableInteraction(run)).toBeNull();
    const result = applyAction(run, { type: "use-stairs" });
    expect(result.tookTurn).toBe(false);
    expect(result.events).toEqual([{ type: "no-stairs" }]);
  });
});

describe("stairs", () => {
  it("descends onto the next floor's up stairs and ascends back onto the down stairs", () => {
    let run = newRun(29);
    const firstFloor = currentFloor(run);
    const downStairs = firstFloor.downStairs;
    if (!downStairs) throw new Error("Floor 1 needs down stairs.");

    run = walkTo(run, downStairs);
    expect(availableInteraction(run)).toEqual({ kind: "descend", toDepth: 2, sealedBy: null });
    run = applyAction(run, { type: "use-stairs" }).run;
    expect(run.depth).toBe(2);
    expect({ x: run.hero.x, y: run.hero.y }).toEqual(currentFloor(run).upStairs);
    expect(availableInteraction(run)).toEqual({ kind: "ascend", toDepth: 1, sealedBy: null });

    const secondFloor = currentFloor(run);
    run = applyAction(run, { type: "use-stairs" }).run;
    expect(run.depth).toBe(1);
    expect({ x: run.hero.x, y: run.hero.y }).toEqual(downStairs);

    // Both floors are kept as they were, including what was explored.
    expect(currentFloor(run).tiles).toBe(firstFloor.tiles);
    expect(currentFloor(run).explored[indexOf(downStairs)]).toBe(true);
    run = applyAction(run, { type: "use-stairs" }).run;
    expect(currentFloor(run).tiles).toBe(secondFloor.tiles);
    expect(run.floors).toHaveLength(2);
  });

  it("reaches the final floor, which has no way further down", () => {
    let run = newRun(31);
    for (let depth = 1; depth < FLOOR_COUNT; depth++) {
      const downStairs = currentFloor(run).downStairs;
      if (!downStairs) throw new Error(`Floor ${depth} needs down stairs.`);
      run = applyAction(walkTo(run, downStairs), { type: "use-stairs" }).run;
    }
    expect(run.depth).toBe(FLOOR_COUNT);
    expect(currentFloor(run).downStairs).toBeNull();
    expect(run.floors).toHaveLength(FLOOR_COUNT);
  });
});
