// Creates demo characters already standing on chosen floors, for looking at deep floors without
// playing down to them. Each floor gets its own folder, usable as the app's user-data folder.
//
// Usage: pnpm exec tsx scripts/demo-saves.mts <output folder> [options] <floor> [floor...]
//   SEED=123 pnpm exec tsx scripts/demo-saves.mts .demo 1 4 30
// Floors passed on the way down are cleared of creatures and traps. With --showcase, a few creatures on the
// final floor are moved next to the hero (one about to strike, one wounded) to show combat visuals,
// and items, a cache and a found trap are laid out nearby, with a stocked pack.
// With --merchant (floors 3, 6, ... 27), the hero stands at the merchant's stall with gold to spend
// and the floor mapped. With --won (floor 30), the Warden has fallen and the Beacon is rekindled.
// Then launch with EMBERCRAWL_USER_DATA=<output folder>\floor-<n> (see CLAUDE.md).
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chebyshevDistance } from "../src/engine/geometry";
import { ARMORS, CACHE, type ItemId, type Pack, WEAPONS } from "../src/engine/items";
import { FLOOR_COUNT, indexOf, MAP_HEIGHT, MAP_WIDTH, Tile, tileAt } from "../src/engine/map";
import { emptyPack } from "../src/engine/pack";
import { findPath } from "../src/engine/path";
import { applyAction, currentFloor, type RunState, visibleTiles } from "../src/engine/run";
import { newCharacter, updateCharacter } from "../src/engine/save";
import { SaveStore } from "../src/main/save-store";

const args = process.argv.slice(2);
const showcaseWanted = args.includes("--showcase");
const merchantWanted = args.includes("--merchant");
const wonWanted = args.includes("--won");
const [outDir, ...floorArgs] = args.filter((a) => !a.startsWith("--"));
const floors = floorArgs.map(Number);
if (
  !outDir ||
  floors.length === 0 ||
  floors.some((f) => !Number.isInteger(f) || f < 1 || f > FLOOR_COUNT)
) {
  console.error(
    `Usage: tsx scripts/demo-saves.mts <output folder> [--showcase] [--merchant] [--won] <floor 1-${FLOOR_COUNT}> [floor...]`,
  );
  process.exit(1);
}
const seed = Number(process.env.SEED ?? 20261017);

/** Clears creatures and traps from the current floor, so the walk to its stairs is safe. */
function clearCurrentFloor(run: RunState): RunState {
  return {
    ...run,
    floors: run.floors.map((f) => (f.depth === run.depth ? { ...f, monsters: [], traps: [] } : f)),
  };
}

/** Walks to each floor's down stairs and takes them, using the normal game rules. */
function descendTo(start: RunState, depth: number): RunState {
  let run = start;
  while (run.depth < depth) {
    run = clearCurrentFloor(run);
    const floor = currentFloor(run);
    if (!floor.downStairs) throw new Error(`Floor ${run.depth} has no way down.`);
    const route = findPath(floor.tiles, run.hero, floor.downStairs);
    if (!route) throw new Error(`No route to the stairs on floor ${run.depth}.`);
    for (const direction of route) run = applyAction(run, { type: "move", direction }).run;
    run = applyAction(run, { type: "use-stairs" }).run;
  }
  return run;
}

/**
 * Moves up to four creatures into view around the hero (one ready to strike, one wounded), lays out
 * items, a cache and a found trap nearby, and stocks the pack.
 */
function showcase(run: RunState): RunState {
  const floor = currentFloor(run);
  const visible = visibleTiles(run);
  const spots: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const p = { x, y };
      const distance = chebyshevDistance(p, run.hero);
      if (distance < 1 || distance > 3 || !visible.has(indexOf(p))) continue;
      if (tileAt(floor.tiles, p) !== Tile.Floor) continue;
      if (floor.camp && floor.camp.x === x && floor.camp.y === y) continue;
      const taken = [...floor.items, ...floor.traps].some((t) => t.x === x && t.y === y);
      if (!taken) spots.push(p);
    }
  }
  spots.sort((a, b) => chebyshevDistance(a, run.hero) - chebyshevDistance(b, run.hero));
  const chosen = spots.filter((_, i) => i % 3 === 0).slice(0, 4);
  const monsters = floor.monsters.map((monster, i) => {
    const spot = chosen[i];
    if (!spot) return monster;
    const near = chebyshevDistance(spot, run.hero) === 1;
    return {
      ...monster,
      ...spot,
      alert: true,
      lastSeen: { x: run.hero.x, y: run.hero.y },
      ready: near && i === 0,
      hp: i === 1 ? Math.max(1, Math.round(monster.maxHp * 0.4)) : monster.hp,
    };
  });
  // Items and a found trap on the open spots the creatures didn't take.
  const open = spots.filter((_, i) => i % 3 !== 0);
  const [gearSpot, supplySpot, cacheSpot, trapSpot] = [open[0], open[2], open[4], open[6]];
  const gear = [...WEAPONS, ...ARMORS]
    .filter((g) => !("starter" in g) && g.tier <= run.depth + 1)
    .sort((a, b) => b.tier - a.tier)[0];
  const items = [
    ...floor.items,
    ...(gearSpot && gear ? [{ id: `${run.depth}-s1`, item: gear.id, ...gearSpot }] : []),
    ...(supplySpot ? [{ id: `${run.depth}-s2`, item: "ember-shard" as const, ...supplySpot }] : []),
    ...(cacheSpot ? [{ id: `${run.depth}-s3`, item: CACHE, ...cacheSpot }] : []),
  ];
  const traps = trapSpot
    ? [
        ...floor.traps,
        { id: `${run.depth}-st`, kind: "ember-vent" as const, ...trapSpot, power: 6, found: true },
      ]
    : floor.traps;
  return {
    ...run,
    pack: packWith(
      ["salve", 3],
      ["ward-sigil", 1],
      ["flare-flask", 2],
      ["survey-lens", 1],
      ["waystone", 1],
    ),
    floors: run.floors.map((f) => (f.depth === run.depth ? { ...f, monsters, items, traps } : f)),
  };
}

/** The hero at this floor's merchant with gold to spend, and the whole floor mapped. */
function atMerchant(run: RunState): RunState {
  const floor = currentFloor(run);
  if (!floor.merchant) throw new Error(`Floor ${run.depth} has no merchant (try 3, 6, ... 27).`);
  return {
    ...run,
    hero: { ...run.hero, x: floor.merchant.x, y: floor.merchant.y },
    gold: 900,
    pack: packWith(["salve", 2], ["iron-cleaver", 1], ["ward-sigil", 1]),
    floors: run.floors.map((f) =>
      f.depth === run.depth ? { ...f, explored: f.explored.map(() => true) } : f,
    ),
  };
}

/** The final floor won: the Warden gone and the Beacon rekindled by the normal rules. */
function rekindled(run: RunState): RunState {
  const floor = currentFloor(run);
  if (!floor.beacon) throw new Error("Only floor 30 has the Beacon.");
  const ready: RunState = {
    ...run,
    hero: { ...run.hero, x: floor.beacon.x, y: floor.beacon.y },
    gold: 1234,
    floors: run.floors.map((f) => (f.depth === run.depth ? { ...f, monsters: [] } : f)),
  };
  return applyAction(ready, { type: "rekindle" }).run;
}

function packWith(...entries: Array<[ItemId, number]>): Pack {
  return emptyPack().map((_, slot) => {
    const entry = entries[slot];
    return entry ? { item: entry[0], count: entry[1] } : null;
  });
}

for (const depth of floors) {
  const now = new Date().toISOString();
  const fresh = newCharacter({ id: randomUUID(), name: `Floor ${depth} demo`, now, seed });
  if (!fresh.run) throw new Error("New characters start with a descent.");
  let run = descendTo(fresh.run, depth);
  // One turn in, so the game skips the new-descent story card.
  if (run.turn === 0) run = applyAction(run, { type: "wait" }).run;
  if (showcaseWanted) run = showcase(run);
  if (merchantWanted) run = atMerchant(run);
  if (wonWanted) run = rekindled(run);
  const save = updateCharacter(fresh, run, { now, playTimeMs: 0 });
  const folder = resolve(outDir, `floor-${depth}`);
  await new SaveStore(join(folder, "Saves"), {
    trash: (path) => rm(path, { recursive: true }),
  }).write(save);
  console.log(`Floor ${depth}: ${folder}`);
}
