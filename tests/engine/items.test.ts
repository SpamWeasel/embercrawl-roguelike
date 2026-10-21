import { describe, expect, it } from "vitest";
import { creatureKind } from "../../src/engine/creatures";
import { generateFloor } from "../../src/engine/generate";
import { chebyshevDistance, type Point, samePoint, step } from "../../src/engine/geometry";
import {
  ARMORS,
  CACHE,
  GOLD,
  ITEM_IDS,
  type ItemId,
  isItemId,
  isSupply,
  itemKind,
  STARTING_ARMOR,
  STARTING_WEAPON,
  SUPPLIES,
  WEAPONS,
} from "../../src/engine/items";
import { FLOOR_COUNT, indexOf, MAP_SIZE, Tile, tileAt } from "../../src/engine/map";
import { emptyPack, packAdd, packCount, packRemoveOne } from "../../src/engine/pack";
import { stepDistances } from "../../src/engine/path";
import {
  GEAR_FIRST_FLOOR,
  goldPileCount,
  hasCache,
  PACK_SLOTS,
  recoverySupply,
  STACK_LIMIT,
  supplyCount,
  supplyWeight,
  TRAP_CLEARANCE,
  TRAP_SPOT_RANGE,
  trapCount,
  WAYSTONE_CLEARANCE,
  WAYSTONE_MIN_JUMP,
} from "../../src/engine/rules";
import {
  type ActionResult,
  applyAction,
  attackPower,
  availableInteraction,
  creatureHitRange,
  currentFloor,
  defensePower,
  type GameEvent,
  heroHitRange,
  newRun,
  type RunState,
  walkRoute,
} from "../../src/engine/run";
import { arena, creature, loot, packOf, trap } from "./helpers";

const ROOM = [
  "##########", //
  "#........#",
  "#........#",
  "#........#",
  "##########",
];

const HALL = [
  "######################", //
  "#....................#",
  "#....................#",
  "#....................#",
  "#....................#",
  "######################",
];

function events<T extends GameEvent["type"]>(result: ActionResult, type: T) {
  return result.events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function floorOf(run: RunState) {
  return currentFloor(run);
}

const at = (run: RunState): Point => ({ x: run.hero.x, y: run.hero.y });

describe("the item catalog", () => {
  it("gives every item a unique id, and starts the hero with a knife and a coat", () => {
    expect(new Set(ITEM_IDS).size).toBe(ITEM_IDS.length);
    expect(ITEM_IDS).not.toContain(CACHE);
    expect(itemKind(STARTING_WEAPON)).toMatchObject({ category: "weapon", starter: true });
    expect(itemKind(STARTING_ARMOR)).toMatchObject({ category: "armor", starter: true });
    expect(isItemId("salve")).toBe(true);
    expect(isItemId("excalibur")).toBe(false);
  });

  it("makes each later weapon and armor stronger than the one before", () => {
    for (const list of [WEAPONS, ARMORS]) {
      for (let i = 1; i < list.length; i++) {
        const [previous, next] = [list[i - 1], list[i]];
        expect(next?.power).toBeGreaterThan(previous?.power ?? 0);
        expect(next?.tier).toBeGreaterThan(previous?.tier ?? 0);
      }
    }
  });

  it("lets every supply turn up somewhere in the descent", () => {
    for (const supply of SUPPLIES) {
      const floors = Array.from({ length: FLOOR_COUNT }, (_, i) => i + 1);
      expect(floors.some((depth) => supplyWeight(supply.id, depth) > 0)).toBe(true);
    }
  });
});

describe("the pack", () => {
  it("stacks identical items up to the limit, then starts a new slot", () => {
    let pack = emptyPack();
    for (let i = 0; i < STACK_LIMIT + 1; i++) pack = packAdd(pack, "salve") ?? pack;
    expect(pack[0]).toEqual({ item: "salve", count: STACK_LIMIT });
    expect(pack[1]).toEqual({ item: "salve", count: 1 });
    expect(packCount(pack, "salve")).toBe(STACK_LIMIT + 1);
  });

  it("refuses an item when every slot is taken, and frees a slot when its stack runs out", () => {
    const full = packOf(
      ...Array.from({ length: PACK_SLOTS }, () => ["salve", STACK_LIMIT] as [ItemId, number]),
    );
    expect(packAdd(full, "salve")).toBeNull();
    expect(packAdd(full, "waystone")).toBeNull();
    const lighter = packRemoveOne(packOf(["waystone", 1]), 0);
    expect(lighter[0]).toBeNull();
    expect(packAdd(lighter, "ember-shard", 3)?.[3]).toEqual({ item: "ember-shard", count: 1 });
  });
});

describe("floor contents", () => {
  const seeds = [1, 2, 3, 42, 777];

  it("places items and traps only on open floor that nothing else is using", () => {
    for (const seed of seeds) {
      for (let depth = 1; depth <= FLOOR_COUNT; depth++) {
        const floor = generateFloor(seed, depth);
        const used = new Set<number>();
        const reserved = [floor.entrance, floor.downStairs, floor.camp].filter(
          (p): p is Point => p !== null,
        );
        for (const thing of [...floor.items, ...floor.traps]) {
          expect(tileAt(floor.tiles, thing)).toBe(Tile.Floor);
          expect(used.has(indexOf(thing))).toBe(false);
          used.add(indexOf(thing));
          expect(reserved.some((r) => samePoint(r, thing))).toBe(false);
          expect(floor.monsters.some((m) => samePoint(m, thing))).toBe(false);
        }
      }
    }
  });

  it("holds the supplies, cache and gear the rules call for", () => {
    for (const seed of seeds) {
      for (let depth = 1; depth <= FLOOR_COUNT; depth++) {
        const floor = generateFloor(seed, depth);
        const expected =
          supplyCount(depth) +
          (recoverySupply(depth) ? 1 : 0) +
          (hasCache(depth) ? 1 : 0) +
          (depth >= GEAR_FIRST_FLOOR ? 1 : 0) +
          (depth === 1 ? 1 : 0);
        const items = floor.items.filter((i) => i.item !== GOLD);
        expect(items).toHaveLength(expected);
        expect(floor.items.filter((i) => i.item === GOLD)).toHaveLength(goldPileCount(depth));
        expect(floor.items.filter((i) => i.item === CACHE)).toHaveLength(hasCache(depth) ? 1 : 0);
        const gear = items.filter(
          (i) => i.item !== CACHE && itemKind(i.item as ItemId).category !== "supply",
        );
        expect(gear).toHaveLength(depth >= GEAR_FIRST_FLOOR ? 1 : 0);
        for (const piece of gear) {
          const kind = itemKind(piece.item as ItemId);
          expect("starter" in kind).toBe(false);
          if (kind.category !== "supply") expect(kind.tier).toBeLessThanOrEqual(depth + 3);
        }
        expect(floor.traps).toHaveLength(trapCount(depth));
      }
    }
  });

  it("leaves a salve beside the entrance on floor 1, which has no traps", () => {
    for (const seed of seeds) {
      const floor = generateFloor(seed, 1);
      expect(
        floor.items.some((i) => i.item === "salve" && chebyshevDistance(i, floor.entrance) === 1),
      ).toBe(true);
      expect(floor.traps).toEqual([]);
    }
  });

  it("hides traps away from the entrance", () => {
    for (const seed of seeds) {
      for (let depth = 2; depth <= FLOOR_COUNT; depth++) {
        const floor = generateFloor(seed, depth);
        const distances = stepDistances(floor.tiles, floor.entrance);
        for (const t of floor.traps) {
          expect(t.found).toBe(false);
          expect(distances[indexOf(t)]).toBeGreaterThan(TRAP_CLEARANCE);
        }
      }
    }
  });

  it("favors weapons on even floors and armor on odd ones", () => {
    let weaponsOnEven = 0;
    let armorOnOdd = 0;
    let even = 0;
    let odd = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (let depth = GEAR_FIRST_FLOOR; depth <= FLOOR_COUNT; depth++) {
        const gear = generateFloor(seed, depth).items.find(
          (i) => i.item !== CACHE && i.item !== GOLD && !isSupply(itemKind(i.item)),
        );
        const category = gear ? itemKind(gear.item as ItemId).category : null;
        if (depth % 2 === 0) {
          even++;
          if (category === "weapon") weaponsOnEven++;
        } else {
          odd++;
          if (category === "armor") armorOnOdd++;
        }
      }
    }
    expect(weaponsOnEven / even).toBeGreaterThan(0.7);
    expect(armorOnOdd / odd).toBeGreaterThan(0.7);
  });
});

describe("picking things up", () => {
  it("collects an item by stepping onto it", () => {
    const run = arena(ROOM, { hero: { x: 1, y: 2 }, items: [loot("salve", { x: 2, y: 2 })] });
    const result = applyAction(run, { type: "move", direction: "e" });
    expect(events(result, "picked-up")).toMatchObject([{ item: "salve", fromCache: false }]);
    expect(result.run.pack[0]).toEqual({ item: "salve", count: 1 });
    expect(floorOf(result.run).items).toEqual([]);
    expect(availableInteraction(result.run)).toBeNull();
  });

  it("stacks a find onto what the pack already holds", () => {
    const run = arena(ROOM, {
      hero: { x: 1, y: 2 },
      items: [loot("salve", { x: 2, y: 2 })],
      pack: packOf(["waystone", 1], ["salve", 2]),
    });
    const result = applyAction(run, { type: "move", direction: "e" });
    expect(result.run.pack[1]).toEqual({ item: "salve", count: 3 });
  });

  it("leaves an item where it lies when the pack is full, until there's room", () => {
    const full = Array.from(
      { length: PACK_SLOTS },
      () => ["waystone", STACK_LIMIT] as [ItemId, number],
    );
    const run = arena(ROOM, {
      hero: { x: 1, y: 2 },
      items: [loot("salve", { x: 2, y: 2 })],
      pack: packOf(...full),
    });
    const stepped = applyAction(run, { type: "move", direction: "e" });
    expect(stepped.tookTurn).toBe(true);
    expect(events(stepped, "pack-full")).toEqual([{ type: "pack-full", item: "salve" }]);
    expect(floorOf(stepped.run).items).toHaveLength(1);
    expect(availableInteraction(stepped.run)).toEqual({ kind: "pick-up", item: "salve" });

    // Still full: picking up does nothing and takes no turn. With a slot free, it works.
    expect(applyAction(stepped.run, { type: "pick-up" }).tookTurn).toBe(false);
    const roomy = {
      ...stepped.run,
      pack: stepped.run.pack.map((entry, slot) => (slot === 4 ? null : entry)),
    };
    const picked = applyAction(roomy, { type: "pick-up" });
    expect(picked.tookTurn).toBe(true);
    expect(picked.run.pack[4]).toEqual({ item: "salve", count: 1 });
  });

  it("says so when there's nothing to pick up", () => {
    const result = applyAction(arena(ROOM, { hero: { x: 1, y: 2 } }), { type: "pick-up" });
    expect(result.tookTurn).toBe(false);
    expect(result.events).toEqual([{ type: "nothing-here" }]);
  });

  it("opens a cache into a supply, the same one however it's reached", () => {
    const cache = loot(CACHE, { x: 3, y: 2 }, "1-i9");
    const run = arena(ROOM, { hero: { x: 1, y: 2 }, items: [cache], seed: 5 });
    const first = applyAction(applyAction(run, { type: "move", direction: "e" }).run, {
      type: "move",
      direction: "e",
    });
    const waited = applyAction(applyAction(run, { type: "wait" }).run, {
      type: "move",
      direction: "e",
    });
    const second = applyAction(waited.run, { type: "move", direction: "e" });
    const [opened] = events(first, "picked-up");
    expect(opened?.fromCache).toBe(true);
    expect(isSupply(itemKind(opened?.item ?? "salve"))).toBe(true);
    expect(events(second, "picked-up")[0]?.item).toBe(opened?.item);
  });
});

describe("supplies", () => {
  it("heal with salve, up to the missing health, using a turn and one salve", () => {
    const run = arena(ROOM, { hero: { x: 1, y: 2, hp: 20 }, pack: packOf(["salve", 2]) });
    const result = applyAction(run, { type: "use-item", slot: 0 });
    expect(result.tookTurn).toBe(true);
    expect(result.run.hero.hp).toBe(30);
    expect(events(result, "used")).toEqual([{ type: "used", item: "salve", amount: 10 }]);
    expect(result.run.pack[0]).toEqual({ item: "salve", count: 1 });
  });

  it("aren't wasted: no salve at full health, no shard on a full lantern", () => {
    const run = arena(ROOM, {
      hero: { x: 1, y: 2 },
      pack: packOf(["salve", 1], ["ember-shard", 1]),
    });
    const salve = applyAction(run, { type: "use-item", slot: 0 });
    expect(salve.tookTurn).toBe(false);
    expect(salve.events).toEqual([{ type: "item-unneeded", item: "salve", reason: "full-health" }]);
    const shard = applyAction(run, { type: "use-item", slot: 1 });
    expect(shard.events).toMatchObject([{ type: "item-unneeded", reason: "full-charge" }]);
    expect(shard.run.pack).toBe(run.pack);
  });

  it("refill the lantern, raise a shield, and strengthen the hero", () => {
    const run = arena(ROOM, {
      hero: { x: 1, y: 2, shield: 2 },
      lantern: { charge: 80 },
      pack: packOf(["ember-shard", 1], ["ward-sigil", 1], ["vigor-draught", 1]),
    });
    const shard = applyAction(run, { type: "use-item", slot: 0 });
    expect(shard.run.lantern.charge).toBe(100);
    expect(events(shard, "used")[0]?.amount).toBe(20);
    expect(applyAction(run, { type: "use-item", slot: 1 }).run.hero.shield).toBe(14);
    const vigor = applyAction(run, { type: "use-item", slot: 2 }).run.hero;
    expect(vigor).toMatchObject({ hp: 36, maxHp: 36 });
  });

  it("burn every creature in view nearby with a flare, but not those behind walls or far off", () => {
    const map = [
      "################", //
      "#........#.....#",
      "#........#.....#",
      "#........#.....#",
      "################",
    ];
    const near = creature("iron-husk", { x: 5, y: 2 }, { hp: 50, maxHp: 50 });
    const far = creature("iron-husk", { x: 2, y: 2 }, { hp: 50, maxHp: 50 });
    const hidden = creature("iron-husk", { x: 10, y: 2 }, { hp: 50, maxHp: 50 });
    const weak = creature("cinder-mite", { x: 8, y: 1 }, { hp: 5 });
    const run = arena(map, {
      hero: { x: 7, y: 2 },
      monsters: [near, far, hidden, weak],
      pack: packOf(["flare-flask", 1]),
    });
    const result = applyAction(run, { type: "use-item", slot: 0 });
    expect(events(result, "used")[0]?.amount).toBe(2);
    const hp = new Map(floorOf(result.run).monsters.map((m) => [m.id, m.hp]));
    expect(hp.get(near.id)).toBe(34);
    expect(hp.get(far.id)).toBe(50);
    expect(hp.get(hidden.id)).toBe(50);
    expect(hp.has(weak.id)).toBe(false);
    expect(events(result, "monster-hurt").map((e) => e.id)).toEqual([near.id, weak.id]);
    expect(result.run.hero.xp).toBe(creatureKind("cinder-mite").xp);

    const empty = arena(ROOM, { hero: { x: 1, y: 2 }, pack: packOf(["flare-flask", 1]) });
    expect(applyAction(empty, { type: "use-item", slot: 0 }).events).toMatchObject([
      { type: "item-unneeded", reason: "no-targets" },
    ]);
  });

  it("show the whole floor and every trap with a survey lens", () => {
    const traps = [trap("ember-vent", { x: 6, y: 1 }, 5), trap("gloom-rune", { x: 7, y: 3 }, 30)];
    const run = arena(ROOM, { hero: { x: 1, y: 2 }, traps, pack: packOf(["survey-lens", 1]) });
    const result = applyAction(run, { type: "use-item", slot: 0 });
    expect(floorOf(result.run).explored.every(Boolean)).toBe(true);
    expect(floorOf(result.run).traps.every((t) => t.found)).toBe(true);
    expect(events(result, "trap-found")).toHaveLength(2);
    expect(events(result, "used")[0]?.amount).toBe(2);
  });

  it("carry the hero somewhere quiet with a waystone", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const mite = creature("cinder-mite", { x: 4, y: 2 });
      const run = arena(HALL, {
        hero: { x: 2, y: 2 },
        monsters: [mite],
        items: [loot("salve", { x: 12, y: 2 })],
        traps: [trap("ember-vent", { x: 14, y: 2 }, 5)],
        pack: packOf(["waystone", 1]),
        seed,
      });
      const stone = applyAction(run, { type: "use-item", slot: 0 });
      const [jump] = events(stone, "teleported");
      if (!jump) throw new Error("Expected a teleport.");
      const landing = jump.to;
      expect(at(stone.run)).toEqual(landing);
      expect(chebyshevDistance(landing, jump.from)).toBeGreaterThanOrEqual(WAYSTONE_MIN_JUMP);
      expect(chebyshevDistance(landing, mite)).toBeGreaterThanOrEqual(WAYSTONE_CLEARANCE);
      expect(samePoint(landing, { x: 12, y: 2 })).toBe(false);
      expect(samePoint(landing, { x: 14, y: 2 })).toBe(false);
      expect(stone.run.pack[0]).toBeNull();
    }
  });

  it("do nothing from an empty slot", () => {
    const run = arena(ROOM, { hero: { x: 1, y: 2 } });
    expect(applyAction(run, { type: "use-item", slot: 3 }).tookTurn).toBe(false);
    expect(applyAction(run, { type: "drop-item", slot: 3 }).tookTurn).toBe(false);
  });
});

describe("weapons and armor", () => {
  it("swap places with what's worn, changing attack power", () => {
    const run = arena(ROOM, {
      hero: { x: 1, y: 2 },
      pack: packOf(["waystone", 1], ["iron-cleaver", 1]),
    });
    expect(attackPower(run)).toBe(5);
    expect(heroHitRange(run)).toEqual([5, 7]);
    const result = applyAction(run, { type: "use-item", slot: 1 });
    expect(result.tookTurn).toBe(true);
    expect(result.run.equipment.weapon).toBe("iron-cleaver");
    expect(result.run.pack[1]).toEqual({ item: STARTING_WEAPON, count: 1 });
    expect(events(result, "equipped")).toEqual([
      { type: "equipped", item: "iron-cleaver", slot: "weapon", previous: STARTING_WEAPON },
    ]);
    expect(attackPower(result.run)).toBe(7);
  });

  it("let armor soften every creature blow, never below 1", () => {
    const brute = creature("cinder-mite", { x: 2, y: 2 }, { attack: 6, alert: true, ready: true });
    const coat = arena(ROOM, { hero: { x: 1, y: 2 }, monsters: [brute] });
    const plate = arena(ROOM, {
      hero: { x: 1, y: 2 },
      monsters: [brute],
      equipment: { armor: "obsidian-plate" },
    });
    expect(defensePower(coat)).toBe(1);
    expect(creatureHitRange(brute, coat)).toEqual([5, 6]);
    expect(creatureHitRange(brute, plate)).toEqual([1, 1]);
    const [blow] = events(applyAction(plate, { type: "wait" }), "monster-struck");
    expect(blow?.damage).toBe(1);
  });

  it("refuse to swap when the old piece has nowhere to go, or it's already worn", () => {
    const pack = packOf(
      ["iron-cleaver", 2],
      ...Array.from({ length: PACK_SLOTS - 1 }, () => ["salve", 1] as [ItemId, number]),
    );
    const run = arena(ROOM, { hero: { x: 1, y: 2 }, pack });
    const result = applyAction(run, { type: "use-item", slot: 0 });
    expect(result.tookTurn).toBe(false);
    expect(result.events).toEqual([{ type: "pack-full", item: STARTING_WEAPON }]);

    const same = arena(ROOM, { hero: { x: 1, y: 2 }, pack: packOf([STARTING_ARMOR, 1]) });
    expect(applyAction(same, { type: "use-item", slot: 0 }).events).toEqual([
      { type: "already-equipped", item: STARTING_ARMOR },
    ]);
  });
});

describe("dropping", () => {
  it("sets one item down underfoot, where it can be picked up again", () => {
    const run = arena(ROOM, { hero: { x: 1, y: 2 }, pack: packOf(["salve", 2]) });
    const dropped = applyAction(run, { type: "drop-item", slot: 0 });
    expect(dropped.tookTurn).toBe(true);
    expect(dropped.run.pack[0]).toEqual({ item: "salve", count: 1 });
    expect(floorOf(dropped.run).items).toMatchObject([{ item: "salve", x: 1, y: 2 }]);
    expect(availableInteraction(dropped.run)).toEqual({ kind: "pick-up", item: "salve" });
    expect(applyAction(dropped.run, { type: "pick-up" }).run.pack[0]).toEqual({
      item: "salve",
      count: 2,
    });
  });

  it("won't drop onto stairs or on top of another item", () => {
    const stairs = arena(["#####", "#.>.#", "#####"], {
      hero: { x: 2, y: 1 },
      pack: packOf(["salve", 1]),
    });
    expect(applyAction(stairs, { type: "drop-item", slot: 0 }).events).toEqual([
      { type: "cannot-drop" },
    ]);
    const taken = arena(ROOM, {
      hero: { x: 1, y: 2 },
      items: [loot("waystone", { x: 1, y: 2 })],
      pack: packOf(["salve", 1]),
    });
    expect(applyAction(taken, { type: "drop-item", slot: 0 }).tookTurn).toBe(false);
  });
});

describe("traps", () => {
  it("burn through armor with an ember vent, though a shield takes the heat first", () => {
    const run = arena(ROOM, {
      hero: { x: 1, y: 2, shield: 3 },
      equipment: { armor: "obsidian-plate" },
      traps: [trap("ember-vent", { x: 2, y: 2 }, 7)],
    });
    const result = applyAction(run, { type: "move", direction: "e" });
    expect(result.run.hero).toMatchObject({ hp: 26, shield: 0 });
    expect(events(result, "trap-sprung")).toMatchObject([
      { kind: "ember-vent", damage: 7, absorbed: 3 },
    ]);
    expect(floorOf(result.run).traps).toEqual([]);
  });

  it("can end a descent", () => {
    const run = arena(ROOM, {
      hero: { x: 1, y: 2, hp: 4 },
      traps: [trap("ember-vent", { x: 2, y: 2 }, 9)],
    });
    const result = applyAction(run, { type: "move", direction: "e" });
    expect(result.run.status).toBe("dead");
    expect(result.run.killedBy).toBe("ember-vent");
    expect(events(result, "died")).toEqual([{ type: "died", by: "ember-vent" }]);
  });

  it("wake creatures in earshot with an alarm glyph", () => {
    // Too far to see the hero (perception is 7), but close enough to hear the alarm.
    const near = creature("cinder-mite", { x: 10, y: 1 });
    const far = creature("cinder-mite", { x: 20, y: 4 });
    const run = arena(HALL, {
      hero: { x: 1, y: 2 },
      monsters: [near, far],
      traps: [trap("alarm-glyph", { x: 2, y: 2 }, 8)],
    });
    const result = applyAction(run, { type: "move", direction: "e" });
    expect(events(result, "trap-sprung")[0]?.woke).toBe(1);
    expect(events(result, "monster-noticed").map((e) => e.id)).toContain(near.id);
    const after = new Map(floorOf(result.run).monsters.map((m) => [m.id, m]));
    expect(after.get(near.id)?.alert).toBe(true);
    expect(after.get(far.id)?.alert).toBe(false);
  });

  it("drain the lantern and put out bright light with a gloom rune", () => {
    const run = arena(ROOM, {
      hero: { x: 1, y: 2 },
      lantern: { charge: 50, bright: true },
      traps: [trap("gloom-rune", { x: 2, y: 2 }, 30, true)],
    });
    const result = applyAction(run, { type: "move", direction: "e" });
    expect(result.run.lantern).toEqual({ charge: 20, bright: false });
    expect(events(result, "lantern")).toEqual([
      { type: "lantern", bright: false, reason: "doused" },
    ]);
  });

  it("stay hidden in dim light, and show up within reach of bright light", () => {
    const close = trap("ember-vent", { x: 1 + TRAP_SPOT_RANGE, y: 2 }, 5);
    const distant = trap("ember-vent", { x: 2 + TRAP_SPOT_RANGE, y: 3 }, 5);
    const dim = arena(ROOM, { hero: { x: 1, y: 2 }, traps: [close, distant] });
    expect(floorOf(applyAction(dim, { type: "wait" }).run).traps.some((t) => t.found)).toBe(false);

    const bright = arena(ROOM, {
      hero: { x: 1, y: 2 },
      traps: [close, distant],
      lantern: { bright: true },
    });
    const result = applyAction(bright, { type: "wait" });
    expect(events(result, "trap-found").map((e) => e.id)).toEqual([close.id]);
    const found = new Map(floorOf(result.run).traps.map((t) => [t.id, t.found]));
    expect(found.get(close.id)).toBe(true);
    expect(found.get(distant.id)).toBe(false);
  });

  it("never go off under creatures", () => {
    const mite = creature("cinder-mite", { x: 4, y: 1 }, { alert: true, lastSeen: { x: 1, y: 1 } });
    const run = arena(["#######", "#.....#", "#######"], {
      hero: { x: 1, y: 1 },
      monsters: [mite],
      traps: [trap("ember-vent", { x: 3, y: 1 }, 5)],
    });
    const result = applyAction(run, { type: "wait" });
    expect(floorOf(result.run).monsters[0]).toMatchObject({ x: 3, y: 1 });
    expect(floorOf(result.run).traps).toHaveLength(1);
  });

  it("are walked around by click-to-walk once found, unless one is the destination", () => {
    const corridor = arena(["#######", "#.....#", "#.....#", "#######"], {
      hero: { x: 1, y: 1 },
      traps: [trap("ember-vent", { x: 3, y: 1 }, 5, true)],
    });
    const floor = { ...floorOf(corridor), explored: new Array<boolean>(MAP_SIZE).fill(true) };
    const route = walkRoute(floor, corridor.hero, { x: 5, y: 1 }) ?? [];
    let p: Point = corridor.hero;
    for (const direction of route) {
      p = step(p, direction);
      expect(samePoint(p, { x: 3, y: 1 })).toBe(false);
    }
    expect(p).toEqual({ x: 5, y: 1 });
    expect(walkRoute(floor, corridor.hero, { x: 3, y: 1 })).not.toBeNull();
  });
});

describe("a fresh descent", () => {
  it("begins with the starting gear and an empty pack", () => {
    const run = newRun(77);
    expect(run.equipment).toEqual({ weapon: STARTING_WEAPON, armor: STARTING_ARMOR });
    expect(run.pack).toHaveLength(PACK_SLOTS);
    expect(run.pack.every((slot) => slot === null)).toBe(true);
  });
});
