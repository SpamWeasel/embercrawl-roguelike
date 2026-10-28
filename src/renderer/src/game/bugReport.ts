import { itemKind } from "../../../engine/items";
import type { CharacterSave } from "../../../engine/save";
import type { LogLine } from "./messages";

/**
 * A plain-text report a tester can paste into an email or message: the version, where they are
 * in their descent (the seed lets the same dungeon be rebuilt), and the last few messages.
 */
export function bugReport(
  character: CharacterSave,
  log: readonly LogLine[],
  platform: string,
): string {
  const run = character.run;
  const lines = [
    "Embercrawl bug report",
    `Version: ${__APP_VERSION__} (${platform})`,
    `When: ${new Date().toISOString()}`,
    `Character: ${character.name} (${character.id})`,
  ];
  if (run) {
    lines.push(
      `Descent: seed ${run.seed}, ${run.difficulty}, floor ${run.depth}, turn ${run.turn}, ${run.status}`,
      `Hero: level ${run.hero.level}, health ${run.hero.hp}/${run.hero.maxHp}, shield ${run.hero.shield}, gold ${run.gold}`,
      `Gear: ${itemKind(run.equipment.weapon).name}, ${itemKind(run.equipment.armor).name}`,
      `Pack: ${
        run.pack
          .filter((entry) => entry !== null)
          .map((entry) => `${itemKind(entry.item).name} x${entry.count}`)
          .join(", ") || "empty"
      }`,
      `Lantern: ${run.lantern.charge} charge${run.lantern.bright ? ", bright" : ""}`,
    );
  } else {
    lines.push("Descent: none (between descents)");
  }
  lines.push(
    "Recent messages:",
    ...(log.length > 0 ? log.map((line) => `  ${line.text}`) : ["  (none)"]),
    "",
    "What happened? (Please describe what you were doing and what went wrong.)",
    "",
  );
  return lines.join("\n");
}
