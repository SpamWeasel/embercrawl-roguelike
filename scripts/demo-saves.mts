// Creates demo characters already standing on chosen floors, for looking at deep floors without
// playing down to them. Each floor gets its own folder, usable as the app's user-data folder.
//
// Usage: pnpm exec tsx scripts/demo-saves.mts <output folder> [--showcase] <floor> [floor...]
//   SEED=123 pnpm exec tsx scripts/demo-saves.mts .demo 1 4 30
// Floors passed on the way down are cleared of creatures. With --showcase, a few creatures on the
// final floor are moved next to the hero (one about to strike, one wounded) to show combat visuals.
// Then launch with EMBERCRAWL_USER_DATA=<output folder>\floor-<n> (see CLAUDE.md).
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { chebyshevDistance } from "../src/engine/geometry";
import { FLOOR_COUNT, indexOf, MAP_HEIGHT, MAP_WIDTH, Tile, tileAt } from "../src/engine/map";
import { findPath } from "../src/engine/path";
import { applyAction, currentFloor, type RunState, visibleTiles } from "../src/engine/run";
import { newCharacter, updateCharacter } from "../src/engine/save";
import { SaveStore } from "../src/main/save-store";

const args = process.argv.slice(2);
const showcase = args.includes("--showcase");
const [outDir, ...floorArgs] = args.filter((a) => a !== "--showcase");
const floors = floorArgs.map(Number);
if (
  !outDir ||
  floors.length === 0 ||
  floors.some((f) => !Number.isInteger(f) || f < 1 || f > FLOOR_COUNT)
) {
  console.error(
    `Usage: tsx scripts/demo-saves.mts <output folder> [--showcase] <floor 1-${FLOOR_COUNT}> [floor...]`,
  );
  process.exit(1);
}
const seed = Number(process.env.SEED ?? 20261017);

function clearCurrentFloor(run: RunState): RunState {
  return {
    ...run,
    floors: run.floors.map((f) => (f.depth === run.depth ? { ...f, monsters: [] } : f)),
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

/** Moves up to four creatures into view around the hero: one ready to strike, one wounded. */
function gatherCreatures(run: RunState): RunState {
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
      spots.push(p);
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
  return {
    ...run,
    floors: run.floors.map((f) => (f.depth === run.depth ? { ...f, monsters } : f)),
  };
}

for (const depth of floors) {
  const now = new Date().toISOString();
  const fresh = newCharacter({ id: randomUUID(), name: `Floor ${depth} demo`, now, seed });
  if (!fresh.run) throw new Error("New characters start with a descent.");
  let run = descendTo(fresh.run, depth);
  // One turn in, so the game skips the new-descent story card.
  if (run.turn === 0) run = applyAction(run, { type: "wait" }).run;
  if (showcase) run = gatherCreatures(run);
  const save = updateCharacter(fresh, run, { now, playTimeMs: 0 });
  const folder = resolve(outDir, `floor-${depth}`);
  await new SaveStore(join(folder, "Saves")).write(save);
  console.log(`Floor ${depth}: ${folder}`);
}
