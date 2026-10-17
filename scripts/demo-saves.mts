// Creates demo characters already standing on chosen floors, for looking at deep floors without
// playing down to them. Each floor gets its own folder, usable as the app's user-data folder.
//
// Usage: pnpm exec tsx scripts/demo-saves.mts <output folder> <floor> [floor...]
//   SEED=123 pnpm exec tsx scripts/demo-saves.mts .demo 1 4 30
// Then launch with EMBERCRAWL_USER_DATA=<output folder>\floor-<n> (see CLAUDE.md).
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { FLOOR_COUNT } from "../src/engine/map";
import { findPath } from "../src/engine/path";
import { applyAction, currentFloor, type RunState } from "../src/engine/run";
import { newCharacter, updateCharacter } from "../src/engine/save";
import { SaveStore } from "../src/main/save-store";

const [outDir, ...floorArgs] = process.argv.slice(2);
const floors = floorArgs.map(Number);
if (
  !outDir ||
  floors.length === 0 ||
  floors.some((f) => !Number.isInteger(f) || f < 1 || f > FLOOR_COUNT)
) {
  console.error(
    `Usage: tsx scripts/demo-saves.mts <output folder> <floor 1-${FLOOR_COUNT}> [floor...]`,
  );
  process.exit(1);
}
const seed = Number(process.env.SEED ?? 20261017);

/** Walks to each floor's down stairs and takes them, using the normal game rules. */
function descendTo(start: RunState, depth: number): RunState {
  let run = start;
  while (run.depth < depth) {
    const floor = currentFloor(run);
    if (!floor.downStairs) throw new Error(`Floor ${run.depth} has no way down.`);
    const route = findPath(floor.tiles, run.hero, floor.downStairs);
    if (!route) throw new Error(`No route to the stairs on floor ${run.depth}.`);
    for (const direction of route) run = applyAction(run, { type: "move", direction }).run;
    run = applyAction(run, { type: "use-stairs" }).run;
  }
  return run;
}

for (const depth of floors) {
  const now = new Date().toISOString();
  const fresh = newCharacter({ id: randomUUID(), name: `Floor ${depth} demo`, now, seed });
  if (!fresh.run) throw new Error("New characters start with a descent.");
  const save = updateCharacter(fresh, descendTo(fresh.run, depth), { now, playTimeMs: 0 });
  const folder = resolve(outDir, `floor-${depth}`);
  await new SaveStore(join(folder, "Saves")).write(save);
  console.log(`Floor ${depth}: ${folder}`);
}
