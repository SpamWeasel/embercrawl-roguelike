import { describe, expect, it } from "vitest";
import { creatureKind } from "../../src/engine/creatures";
import type { Direction } from "../../src/engine/geometry";
import {
  CAMP_CHARGE,
  heroAttackPower,
  PULSE_BONUS_DAMAGE,
  PULSE_COST,
  PULSE_SHIELD,
  xpToNextLevel,
} from "../../src/engine/rules";
import {
  type Action,
  type ActionResult,
  applyAction,
  availableInteraction,
  currentFloor,
  type GameEvent,
  type RunState,
  visibleTiles,
} from "../../src/engine/run";
import { arena, creature } from "./helpers";

const ROOM = [
  "#########", //
  "#.......#",
  "#.......#",
  "#.......#",
  "#.......#",
  "#.......#",
  "#########",
];

const wait: Action = { type: "wait" };
const move = (direction: Direction): Action => ({ type: "move", direction });
const monsters = (run: RunState) => currentFloor(run).monsters;
const events = (result: ActionResult, type: GameEvent["type"]) =>
  result.events.filter((e) => e.type === type);

/** Plays several actions, returning every result. */
function play(run: RunState, actions: readonly Action[]): ActionResult[] {
  const results: ActionResult[] = [];
  let current = run;
  for (const action of actions) {
    const result = applyAction(current, action);
    results.push(result);
    current = result.run;
  }
  return results;
}

describe("attacking", () => {
  it("moving into a creature attacks it instead of moving", () => {
    const run = arena(ROOM, {
      hero: { x: 2, y: 2 },
      monsters: [creature("iron-husk", { x: 3, y: 2 })],
    });
    const result = applyAction(run, move("e"));
    expect(result.tookTurn).toBe(true);
    expect(result.run.hero).toMatchObject({ x: 2, y: 2 });
    const [hit] = events(result, "attacked");
    if (hit?.type !== "attacked") throw new Error("Expected an attack.");
    const power = heroAttackPower(1);
    expect(hit.damage).toBeGreaterThanOrEqual(power);
    expect(hit.damage).toBeLessThanOrEqual(power + 2);
    expect(monsters(result.run)[0]?.hp).toBe(creatureKind("iron-husk").hp - hit.damage);
  });

  it("kills award experience and are counted", () => {
    const run = arena(ROOM, {
      hero: { x: 2, y: 2 },
      monsters: [creature("cinder-mite", { x: 3, y: 3 }, { hp: 1 })],
    });
    const result = applyAction(run, move("se"));
    expect(events(result, "monster-died")).toHaveLength(1);
    expect(monsters(result.run)).toHaveLength(0);
    expect(result.run.kills).toBe(1);
    expect(result.run.hero.xp).toBe(creatureKind("cinder-mite").xp);
  });

  it("levelling up raises maximum health and heals a little", () => {
    const run = arena(ROOM, {
      hero: { x: 2, y: 2, xp: xpToNextLevel(1) - 1, hp: 20 },
      monsters: [creature("cinder-mite", { x: 3, y: 2 }, { hp: 1 })],
    });
    const result = applyAction(run, move("e"));
    expect(events(result, "leveled-up")).toEqual([{ type: "leveled-up", level: 2 }]);
    expect(result.run.hero).toMatchObject({ level: 2, maxHp: 35, hp: 30 });
    expect(result.run.hero.xp).toBe(creatureKind("cinder-mite").xp - 1);
  });

  it("can't attack diagonally through a gap between two walls", () => {
    const seam = ["#####", "#.###", "##..#", "#####"];
    const run = arena(seam, {
      hero: { x: 1, y: 1 },
      monsters: [creature("cinder-mite", { x: 2, y: 2 })],
    });
    const result = applyAction(run, move("se"));
    expect(result.tookTurn).toBe(false);
    expect(events(result, "blocked")).toHaveLength(1);
  });
});

describe("creature turns", () => {
  it("warn for a turn before striking", () => {
    const mite = creature("cinder-mite", { x: 3, y: 2 }, { alert: true });
    const [first, second] = play(arena(ROOM, { hero: { x: 2, y: 2 }, monsters: [mite] }), [
      wait,
      wait,
    ]);
    if (!first || !second) throw new Error("Expected two turns.");
    expect(events(first, "monster-readied")).toHaveLength(1);
    expect(first.run.hero.hp).toBe(30);
    const [strike] = events(second, "monster-struck");
    if (strike?.type !== "monster-struck") throw new Error("Expected a strike.");
    expect(strike.ranged).toBe(false);
    expect(second.run.hero.hp).toBe(30 - strike.damage);
    expect(strike.damage).toBeGreaterThanOrEqual(1);
  });

  it("miss their strike if the hero steps away after the warning", () => {
    const mite = creature("cinder-mite", { x: 3, y: 2 }, { alert: true });
    const [readied, dodged] = play(arena(ROOM, { hero: { x: 2, y: 2 }, monsters: [mite] }), [
      wait,
      move("w"),
    ]);
    expect(events(readied as ActionResult, "monster-readied")).toHaveLength(1);
    expect(events(dodged as ActionResult, "monster-struck")).toHaveLength(0);
    expect(dodged?.run.hero.hp).toBe(30);
  });

  it("find their way around walls", () => {
    const wall = ["#########", "#.......#", "#.#####.#", "#.......#", "#########"];
    const hunter = creature(
      "cinder-mite",
      { x: 4, y: 1 },
      { alert: true, lastSeen: { x: 4, y: 3 } },
    );
    const run = arena(wall, { hero: { x: 4, y: 3 }, monsters: [hunter] });
    const results = play(run, [wait, wait, wait, wait, wait, wait]);
    const readiedOn = results.findIndex((r) => events(r, "monster-readied").length > 0);
    expect(readiedOn).toBeGreaterThanOrEqual(0);
    expect(readiedOn).toBeLessThanOrEqual(5);
  });

  it("notice the hero only within range and with a clear view", () => {
    const corridor = [`#${"#".repeat(14)}#`, `#${".".repeat(14)}#`, `#${"#".repeat(14)}#`];
    const far = applyAction(
      arena(corridor, {
        hero: { x: 1, y: 1 },
        monsters: [creature("cinder-mite", { x: 9, y: 1 })],
      }),
      wait,
    );
    expect(events(far, "monster-noticed")).toHaveLength(0);
    const near = applyAction(
      arena(corridor, {
        hero: { x: 1, y: 1 },
        monsters: [creature("cinder-mite", { x: 6, y: 1 })],
      }),
      wait,
    );
    expect(events(near, "monster-noticed")).toHaveLength(1);
    const walled = ["#######", "#..#..#", "#######"];
    const hidden = applyAction(
      arena(walled, { hero: { x: 1, y: 1 }, monsters: [creature("cinder-mite", { x: 5, y: 1 })] }),
      wait,
    );
    expect(events(hidden, "monster-noticed")).toHaveLength(0);
  });

  it("slow creatures act only on even turns", () => {
    const jaw = creature("moss-jaw", { x: 5, y: 2 }, { alert: true });
    const [odd, even] = play(arena(ROOM, { hero: { x: 1, y: 2 }, monsters: [jaw] }), [wait, wait]);
    expect(events(odd as ActionResult, "monster-moved")).toHaveLength(0);
    expect(events(even as ActionResult, "monster-moved")).toHaveLength(1);
  });

  it("swift creatures take two steps while closing in", () => {
    const leech = creature("lantern-leech", { x: 7, y: 2 }, { alert: true });
    const result = applyAction(arena(ROOM, { hero: { x: 1, y: 2 }, monsters: [leech] }), wait);
    expect(events(result, "monster-moved")).toHaveLength(2);
    expect(monsters(result.run)[0]).toMatchObject({ x: 5, y: 2 });
  });

  it("ranged creatures strike along diagonals, but not from off-line positions", () => {
    const moth = creature("gloom-moth", { x: 4, y: 4 }, { alert: true });
    const [readied, shot] = play(arena(ROOM, { hero: { x: 1, y: 1 }, monsters: [moth] }), [
      wait,
      wait,
    ]);
    expect(events(readied as ActionResult, "monster-readied")).toHaveLength(1);
    const [strike] = events(shot as ActionResult, "monster-struck");
    expect(strike).toMatchObject({ type: "monster-struck", ranged: true });

    const offLine = creature("gloom-moth", { x: 3, y: 2 }, { alert: true });
    const moved = applyAction(arena(ROOM, { hero: { x: 1, y: 1 }, monsters: [offLine] }), wait);
    expect(events(moved, "monster-moved")).toHaveLength(1);
  });

  it("erratic creatures sometimes lurch at random instead of closing in", () => {
    let wandered = 0;
    let closed = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const skitter = creature("dust-skitter", { x: 7, y: 3 }, { alert: true });
      const result = applyAction(
        arena(ROOM, { hero: { x: 1, y: 3 }, monsters: [skitter], seed }),
        wait,
      );
      const after = monsters(result.run)[0];
      if (after && after.x === 6) closed++;
      else wandered++;
    }
    expect(wandered).toBeGreaterThan(5);
    expect(closed).toBeGreaterThan(5);
  });

  it("never stack on each other or on the hero", () => {
    const pack = [
      creature("cinder-mite", { x: 5, y: 2 }, { alert: true }),
      creature("cinder-mite", { x: 6, y: 2 }, { alert: true }),
      creature("cinder-mite", { x: 7, y: 2 }, { alert: true }),
    ];
    let run = arena(ROOM, { hero: { x: 1, y: 2, hp: 999, maxHp: 999 }, monsters: pack });
    for (let i = 0; i < 8; i++) {
      run = applyAction(run, wait).run;
      const spots = monsters(run).map((m) => `${m.x},${m.y}`);
      expect(new Set(spots).size).toBe(spots.length);
      expect(spots).not.toContain(`${run.hero.x},${run.hero.y}`);
    }
  });
});

describe("camps", () => {
  it("keep creatures out and stop their strikes", () => {
    const camp = { x: 2, y: 2 };
    const mite = creature("cinder-mite", { x: 3, y: 2 }, { alert: true, ready: true });
    const results = play(arena(ROOM, { hero: camp, camp, monsters: [mite] }), [
      wait,
      wait,
      wait,
      wait,
    ]);
    for (const result of results) {
      expect(events(result, "monster-struck")).toHaveLength(0);
      expect(monsters(result.run).some((m) => m.x === camp.x && m.y === camp.y)).toBe(false);
    }
  });

  it("can be rested at once per floor", () => {
    const camp = { x: 2, y: 2 };
    const run = arena(ROOM, { hero: { ...camp, hp: 10 }, camp, lantern: { charge: 50 } });
    expect(availableInteraction(run)).toEqual({ kind: "rest" });
    const rested = applyAction(run, { type: "rest" });
    expect(rested.run.hero.hp).toBe(30);
    expect(rested.run.lantern.charge).toBe(50 + CAMP_CHARGE);
    expect(availableInteraction(rested.run)).toBeNull();
    const again = applyAction(rested.run, { type: "rest" });
    expect(again.tookTurn).toBe(false);
    expect(events(again, "camp-spent")).toHaveLength(1);
  });
});

describe("the lantern", () => {
  it("shows more in bright light, at a cost each turn", () => {
    const big = [
      "#".repeat(20),
      ...Array.from({ length: 12 }, () => `#${".".repeat(18)}#`),
      "#".repeat(20),
    ];
    const dim = arena(big, { hero: { x: 9, y: 6 } });
    const bright = applyAction(dim, { type: "toggle-light" });
    expect(bright.tookTurn).toBe(true);
    expect(bright.run.lantern).toEqual({ charge: 99, bright: true });
    expect(visibleTiles(bright.run).size).toBeGreaterThan(visibleTiles(dim).size);
    expect(applyAction(bright.run, wait).run.lantern.charge).toBe(98);
  });

  it("dims by itself when the charge runs out", () => {
    const run = arena(ROOM, { hero: { x: 2, y: 2 }, lantern: { charge: 1, bright: true } });
    const result = applyAction(run, wait);
    expect(result.run.lantern).toEqual({ charge: 0, bright: false });
    expect(events(result, "lantern")).toEqual([
      { type: "lantern", bright: false, reason: "empty" },
    ]);
    const relight = applyAction(result.run, { type: "toggle-light" });
    expect(relight.tookTurn).toBe(false);
    expect(events(relight, "not-enough-charge")).toHaveLength(1);
  });

  it("pulses hit nearby creatures in view and raise a shield", () => {
    const room = ["#########", "#.......#", "#...#...#", "#.......#", "#########"];
    const near = creature("iron-husk", { x: 3, y: 1 });
    const behindWall = creature("iron-husk", { x: 5, y: 2 }, { hp: 99, maxHp: 99 });
    const tooFar = creature("iron-husk", { x: 7, y: 3 });
    const run = arena(room, { hero: { x: 3, y: 2 }, monsters: [near, behindWall, tooFar] });
    const result = applyAction(run, { type: "pulse" });
    expect(result.run.lantern.charge).toBe(100 - PULSE_COST);
    expect(result.run.hero.shield).toBe(PULSE_SHIELD);
    expect(events(result, "pulsed")).toEqual([{ type: "pulsed", at: { x: 3, y: 2 }, hits: 1 }]);
    const after = new Map(monsters(result.run).map((m) => [m.id, m.hp]));
    expect(after.get(near.id)).toBe(near.hp - (heroAttackPower(1) + PULSE_BONUS_DAMAGE));
    expect(after.get(behindWall.id)).toBe(99);
    expect(after.get(tooFar.id)).toBe(tooFar.hp);
  });

  it("needs enough charge to pulse", () => {
    const result = applyAction(
      arena(ROOM, { hero: { x: 2, y: 2 }, lantern: { charge: PULSE_COST - 1 } }),
      { type: "pulse" },
    );
    expect(result.tookTurn).toBe(false);
    expect(events(result, "not-enough-charge")).toEqual([
      { type: "not-enough-charge", needed: PULSE_COST },
    ]);
  });
});

describe("shields and death", () => {
  it("shields absorb blows before health", () => {
    const mite = creature("cinder-mite", { x: 3, y: 2 }, { alert: true, ready: true });
    const result = applyAction(
      arena(ROOM, { hero: { x: 2, y: 2, shield: 10 }, monsters: [mite] }),
      wait,
    );
    const [strike] = events(result, "monster-struck");
    if (strike?.type !== "monster-struck") throw new Error("Expected a strike.");
    expect(strike.absorbed).toBe(strike.damage);
    expect(result.run.hero).toMatchObject({ hp: 30, shield: 10 - strike.damage });
  });

  it("ends the descent when health reaches zero, and nothing happens afterwards", () => {
    const mite = creature("cinder-mite", { x: 3, y: 2 }, { alert: true, ready: true });
    const result = applyAction(
      arena(ROOM, { hero: { x: 2, y: 2, hp: 1 }, monsters: [mite] }),
      wait,
    );
    expect(result.run.status).toBe("dead");
    expect(result.run.killedBy).toBe("cinder-mite");
    expect(events(result, "died")).toEqual([{ type: "died", by: "cinder-mite" }]);
    const after = applyAction(result.run, move("w"));
    expect(after.tookTurn).toBe(false);
    expect(after.run).toBe(result.run);
  });
});

describe("turn order", () => {
  it("creatures don't act while the hero takes the stairs", () => {
    const stairs = ["#####", "#.>.#", "#####"];
    const mite = creature("cinder-mite", { x: 3, y: 1 }, { alert: true, ready: true });
    const result = applyAction(arena(stairs, { hero: { x: 2, y: 1 }, monsters: [mite] }), {
      type: "use-stairs",
    });
    expect(result.run.depth).toBe(2);
    expect(events(result, "monster-struck")).toHaveLength(0);
  });

  it("the same actions always give the same outcome", () => {
    const setup = () =>
      arena(ROOM, {
        hero: { x: 1, y: 1 },
        monsters: [
          creature("dust-skitter", { x: 6, y: 4 }, { id: "a", alert: true }),
          creature("cinder-mite", { x: 7, y: 1 }, { id: "b", alert: true }),
        ],
        seed: 77,
      });
    const actions = [
      wait,
      move("e"),
      wait,
      move("s"),
      { type: "pulse" } as Action,
      wait,
      move("e"),
    ];
    expect(play(setup(), actions)).toEqual(play(setup(), actions));
  });

  it("records creature kinds the first time they are seen", () => {
    const result = applyAction(
      arena(ROOM, { hero: { x: 1, y: 1 }, monsters: [creature("shardling", { x: 3, y: 3 })] }),
      wait,
    );
    expect(events(result, "spotted")).toEqual([{ type: "spotted", kind: "shardling" }]);
    expect(result.run.discovered).toEqual(["shardling"]);
    expect(events(applyAction(result.run, wait), "spotted")).toHaveLength(0);
  });
});
