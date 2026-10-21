import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateFloor } from "../../src/engine/generate";
import { GOLD, type ItemId, isSupply, itemKind } from "../../src/engine/items";
import { FLOOR_COUNT } from "../../src/engine/map";
import {
  gearPrice,
  goldPileRange,
  guardianHoard,
  hasMerchant,
  killGold,
  PACK_SLOTS,
  priceAt,
  SHOP_SUPPLY_OFFERS,
  STACK_LIMIT,
  sellPrice,
} from "../../src/engine/rules";
import {
  type ActionResult,
  applyAction,
  availableInteraction,
  currentFloor,
  type GameEvent,
} from "../../src/engine/run";
import {
  newCharacter,
  parseCharacterSave,
  SAVE_VERSION,
  summarizeCharacter,
  updateCharacter,
} from "../../src/engine/save";
import { arena, creature, loot, packOf } from "./helpers";

const ROOM = [
  "##########", //
  "#........#",
  "#........#",
  "#........#",
  "##########",
];

function events<T extends GameEvent["type"]>(result: ActionResult, type: T) {
  return result.events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

const fullPack = () =>
  packOf(
    ...Array.from({ length: PACK_SLOTS }, () => ["waystone", STACK_LIMIT] as [ItemId, number]),
  );

describe("gold", () => {
  it("lies in piles on every floor, sized for the depth", () => {
    for (const seed of [1, 2, 3]) {
      for (let depth = 1; depth <= FLOOR_COUNT; depth++) {
        const [low, high] = goldPileRange(depth);
        for (const pile of generateFloor(seed, depth).items.filter((i) => i.item === GOLD)) {
          expect(pile.amount).toBeGreaterThanOrEqual(low);
          expect(pile.amount).toBeLessThanOrEqual(high);
        }
      }
    }
  });

  it("goes straight into the purse, even with a full pack", () => {
    const run = arena(ROOM, {
      hero: { x: 1, y: 2 },
      items: [{ ...loot(GOLD, { x: 2, y: 2 }), amount: 17 }],
      pack: fullPack(),
      gold: 5,
    });
    const result = applyAction(run, { type: "move", direction: "e" });
    expect(result.run.gold).toBe(22);
    expect(events(result, "gold-found")).toMatchObject([{ amount: 17 }]);
    expect(currentFloor(result.run).items).toEqual([]);
  });

  it("drops from every creature slain, a fixed amount for each", () => {
    const mite = creature("cinder-mite", { x: 2, y: 2 }, { hp: 1 });
    const run = arena(ROOM, { hero: { x: 1, y: 2 }, monsters: [mite] });
    const first = applyAction(run, { type: "move", direction: "e" });
    const again = applyAction(applyAction(run, { type: "wait" }).run, {
      type: "move",
      direction: "e",
    });
    const [death] = events(first, "monster-died");
    expect(death?.gold).toBeGreaterThanOrEqual(killGold(1, 0));
    expect(death?.gold).toBeLessThanOrEqual(killGold(1, 3));
    expect(first.run.gold).toBe(death?.gold);
    expect(events(again, "monster-died")[0]?.gold).toBe(death?.gold);
  });
});

describe("merchants", () => {
  it("keep a stall on every third floor, stocked with supplies and gear", () => {
    for (let depth = 1; depth <= FLOOR_COUNT; depth++) {
      const floor = generateFloor(7, depth);
      expect(floor.merchant !== null).toBe(hasMerchant(depth));
      if (!floor.merchant) {
        expect(floor.stock).toEqual([]);
        continue;
      }
      const supplies = floor.stock.filter((o) => isSupply(itemKind(o.item)));
      expect(supplies).toHaveLength(SHOP_SUPPLY_OFFERS);
      expect(floor.stock.map((o) => itemKind(o.item).category).sort()).toContain("weapon");
      expect(floor.stock.map((o) => itemKind(o.item).category)).toContain("armor");
      for (const offer of floor.stock) {
        const kind = itemKind(offer.item);
        const base = isSupply(kind) ? kind.price : gearPrice(kind.tier);
        expect(offer.price).toBe(priceAt(base, depth));
        expect(offer.count).toBeGreaterThan(0);
      }
    }
  });

  const stall = (gold: number, overrides: Parameters<typeof arena>[1] = { hero: { x: 2, y: 2 } }) =>
    arena(ROOM, {
      merchant: { x: 2, y: 2 },
      stock: [
        { item: "salve", price: 30, count: 1 },
        { item: "iron-cleaver", price: 100, count: 1 },
      ],
      gold,
      ...overrides,
      hero: { x: 2, y: 2 },
    });

  it("sell for gold, one at a time, until sold out", () => {
    const run = stall(50);
    expect(availableInteraction(run)).toEqual({ kind: "trade" });
    const bought = applyAction(run, { type: "buy", offer: 0 });
    expect(bought.tookTurn).toBe(true);
    expect(bought.run.gold).toBe(20);
    expect(bought.run.pack[0]).toEqual({ item: "salve", count: 1 });
    expect(currentFloor(bought.run).stock[0]?.count).toBe(0);
    expect(applyAction(bought.run, { type: "buy", offer: 0 }).events).toEqual([
      { type: "sold-out", item: "salve" },
    ]);
  });

  it("won't sell what the hero can't afford or can't carry", () => {
    expect(applyAction(stall(50), { type: "buy", offer: 1 }).events).toEqual([
      { type: "cannot-afford", item: "iron-cleaver", price: 100 },
    ]);
    const full = stall(500, { hero: { x: 2, y: 2 }, pack: fullPack() });
    expect(applyAction(full, { type: "buy", offer: 0 }).tookTurn).toBe(false);
  });

  it("buy items back for a share of their price", () => {
    const run = stall(0, { hero: { x: 2, y: 2 }, pack: packOf(["iron-cleaver", 1]) });
    const sold = applyAction(run, { type: "sell", slot: 0 });
    expect(sold.run.gold).toBe(sellPrice("iron-cleaver"));
    expect(sold.run.pack[0]).toBeNull();
  });

  it("only trade at their stall", () => {
    const away = arena(ROOM, {
      hero: { x: 5, y: 2 },
      merchant: { x: 2, y: 2 },
      stock: [{ item: "salve", price: 1, count: 1 }],
      gold: 10,
    });
    expect(applyAction(away, { type: "buy", offer: 0 }).events).toEqual([{ type: "no-merchant" }]);
  });

  it("keep creatures off the stall, so trading is safe", () => {
    const mite = creature("cinder-mite", { x: 3, y: 2 }, { alert: true, ready: true });
    const run = stall(0, { hero: { x: 2, y: 2 }, monsters: [mite] });
    const result = applyAction(run, { type: "wait" });
    expect(events(result, "monster-struck")).toEqual([]);
    expect(currentFloor(result.run).monsters[0]).not.toMatchObject({ x: 2, y: 2 });
  });
});

describe("guardians", () => {
  const LAIR = ["#######", "#..>..#", "#.....#", "#######"];

  it("keep the stairs down sealed while they live", () => {
    const sexton = creature("chain-sexton", { x: 5, y: 2 });
    const run = arena(LAIR, { hero: { x: 3, y: 1 }, monsters: [sexton] });
    expect(availableInteraction(run)).toMatchObject({ kind: "descend", sealedBy: "chain-sexton" });
    const tried = applyAction(run, { type: "use-stairs" });
    expect(tried.tookTurn).toBe(false);
    expect(tried.events).toEqual([{ type: "stairs-sealed", by: "chain-sexton" }]);
  });

  it("leave a hoard of gold and gear when slain, and unseal the stairs", () => {
    const sexton = creature("chain-sexton", { x: 4, y: 1 }, { hp: 1 });
    const run = arena(LAIR, { hero: { x: 3, y: 1 }, monsters: [sexton] });
    const slain = applyAction(run, { type: "move", direction: "e" });
    const [hoard] = events(slain, "hoard");
    const [death] = events(slain, "monster-died");
    if (!hoard || !death) throw new Error("Expected a hoard.");
    expect(hoard.gold).toBe(guardianHoard(1));
    expect(slain.run.gold).toBe(hoard.gold + death.gold);
    expect(isSupply(itemKind(hoard.item))).toBe(false);
    expect(currentFloor(slain.run).items).toMatchObject([{ item: hoard.item, ...hoard.at }]);
    expect(availableInteraction(slain.run)).toMatchObject({ kind: "descend", sealedBy: null });
  });
});

describe("the Beacon", () => {
  it("stands on the final floor only, which has no stairs down", () => {
    for (const seed of [1, 2, 3, 4]) {
      const last = generateFloor(seed, FLOOR_COUNT);
      expect(last.beacon).not.toBeNull();
      expect(last.downStairs).toBeNull();
      expect(generateFloor(seed, FLOOR_COUNT - 1).beacon).toBeNull();
    }
  });

  it("can't be rekindled while the Warden lives, and wins the descent once it has fallen", () => {
    const warden = creature("beacon-warden", { x: 7, y: 3 });
    const guarded = arena(ROOM, {
      hero: { x: 2, y: 2 },
      beacon: { x: 2, y: 2 },
      monsters: [warden],
    });
    expect(availableInteraction(guarded)).toEqual({
      kind: "rekindle",
      smotheredBy: "beacon-warden",
    });
    expect(applyAction(guarded, { type: "rekindle" }).events).toEqual([
      { type: "beacon-smothered", by: "beacon-warden" },
    ]);

    const clear = arena(ROOM, { hero: { x: 2, y: 2 }, beacon: { x: 2, y: 2 } });
    const won = applyAction(clear, { type: "rekindle" });
    expect(won.run.status).toBe("won");
    expect(events(won, "rekindled")).toHaveLength(1);
    expect(applyAction(won.run, { type: "wait" }).tookTurn).toBe(false);
  });

  it("counts a victory once in the character's record", () => {
    const character = newCharacter({
      id: "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b",
      name: "Victor",
      now: "2026-10-21T12:00:00.000Z",
      seed: 5,
    });
    const run = character.run;
    if (!run) throw new Error("Expected a run.");
    const won = { ...run, status: "won" as const };
    const after = updateCharacter(character, won, {
      now: "2026-10-21T13:00:00.000Z",
      playTimeMs: 1,
    });
    expect(after.record.wins).toBe(1);
    expect(
      updateCharacter(after, won, { now: "2026-10-21T13:00:00.000Z", playTimeMs: 2 }).record.wins,
    ).toBe(1);
    expect(summarizeCharacter(after)).toMatchObject({ status: "won", wins: 1 });
    expect(parseCharacterSave(JSON.parse(JSON.stringify(after)))).toEqual(after);
  });
});

describe("version-3 saves", () => {
  // A real version-3 save, written by the milestone-4 engine before gold existed: a badly hurt,
  // level-2 hero on floor 2 wearing a Padded Jerkin, with supplies and the old coat in the pack.
  const v3 = JSON.parse(
    readFileSync(fileURLToPath(new URL("../fixtures/character-v3.json", import.meta.url)), "utf8"),
  );

  it("upgrade, keeping the hero, gear, pack and creatures, with an empty purse", () => {
    expect(v3.version).toBe(3);
    const save = parseCharacterSave(v3);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.run?.hero).toEqual(v3.run.hero);
    expect(save.run?.equipment).toEqual(v3.run.equipment);
    expect(save.run?.pack).toEqual(v3.run.pack);
    expect(save.run?.gold).toBe(0);
    expect(save.run?.floors.map((f) => f.monsters)).toEqual(
      v3.run.floors.map((f: { monsters: unknown }) => f.monsters),
    );
    expect(save.record).toEqual({ ...v3.record, wins: 0 });
  });

  it("give visited floors the gold they were made with, never on top of something", () => {
    const save = parseCharacterSave(v3);
    const run = save.run;
    if (!run) throw new Error("Expected a run.");
    for (const floor of run.floors) {
      const original = generateFloor(run.seed, floor.depth);
      const before = v3.run.floors.find((f: { depth: number }) => f.depth === floor.depth);
      expect(floor.items.slice(0, before.items.length)).toEqual(before.items);
      const gold = floor.items.slice(before.items.length);
      expect(gold.every((item) => item.item === GOLD)).toBe(true);
      expect(gold.length).toBeLessThanOrEqual(original.items.filter((i) => i.item === GOLD).length);
      expect(floor.merchant).toEqual(original.merchant);
      expect(floor.beacon).toEqual(original.beacon);
    }
    const played = applyAction(run, { type: "wait" });
    expect(played.tookTurn).toBe(true);
  });
});
