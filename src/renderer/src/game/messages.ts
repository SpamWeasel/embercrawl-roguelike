import { creatureKind } from "../../../engine/creatures";
import { indexOf } from "../../../engine/map";
import { type ActionResult, currentFloor, type GameEvent, visibleTiles } from "../../../engine/run";

export type Tone = "info" | "combat" | "danger" | "good";

export interface LogLine {
  readonly text: string;
  readonly tone: Tone;
}

const nameOf = (kind: Parameters<typeof creatureKind>[0]) => creatureKind(kind).name;

/**
 * Short lines for the message log describing what just happened. Creatures the hero can't see
 * aren't mentioned, and several creatures noticing at once are summed up in one line.
 */
export function describeResult(result: ActionResult): LogLine[] {
  const floor = currentFloor(result.run);
  const visible = visibleTiles(result.run);
  const inView = (id: string) => {
    const monster = floor.monsters.find((m) => m.id === id);
    return monster !== undefined && visible.has(indexOf(monster));
  };
  const of = <T extends GameEvent["type"]>(type: T) =>
    result.events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

  const lines: LogLine[] = [];
  const killed = new Set(of("monster-died").map((e) => e.id));
  const attacked = new Set(of("attacked").map((e) => e.target));

  const noticed = of("monster-noticed").filter((e) => inView(e.id));
  const [first] = noticed;
  if (noticed.length === 1 && first)
    lines.push({ text: `A ${nameOf(first.kind)} notices you.`, tone: "danger" });
  else if (noticed.length > 1)
    lines.push({ text: `${noticed.length} creatures notice you.`, tone: "danger" });

  for (const event of result.events) {
    switch (event.type) {
      case "attacked":
        lines.push(
          killed.has(event.target)
            ? { text: `You slay the ${nameOf(event.kind)}.`, tone: "combat" }
            : { text: `You hit the ${nameOf(event.kind)} for ${event.damage}.`, tone: "combat" },
        );
        break;
      case "monster-died":
        if (!attacked.has(event.id))
          lines.push({ text: `The ${nameOf(event.kind)} is destroyed.`, tone: "combat" });
        break;
      case "monster-readied":
        if (inView(event.id))
          lines.push({ text: `The ${nameOf(event.kind)} is about to strike!`, tone: "danger" });
        break;
      case "monster-struck": {
        const how = event.ranged ? "strikes you from afar" : "hits you";
        const shield = event.absorbed > 0 ? ` (your shield takes ${event.absorbed})` : "";
        lines.push({
          text: `The ${nameOf(event.kind)} ${how} for ${event.damage}${shield}.`,
          tone: "danger",
        });
        break;
      }
      case "leveled-up":
        lines.push({ text: `You reach level ${event.level}!`, tone: "good" });
        break;
      case "spotted":
        lines.push({ text: `New in your bestiary: ${nameOf(event.kind)}.`, tone: "good" });
        break;
      case "lantern":
        if (event.reason === "empty")
          lines.push({ text: "Your lantern sputters and dims.", tone: "danger" });
        else
          lines.push({
            text: event.bright ? "Your lantern blazes brighter." : "You shade your lantern.",
            tone: "info",
          });
        break;
      case "pulsed":
        lines.push({
          text:
            event.hits > 0
              ? `Your lantern pulses, striking ${event.hits}.`
              : "Your lantern pulses.",
          tone: "combat",
        });
        break;
      case "not-enough-charge":
        lines.push({ text: `Not enough lantern charge (${event.needed} needed).`, tone: "info" });
        break;
      case "rested":
        lines.push({
          text: `You rest by the fire (+${event.healed} health, +${event.charge} charge).`,
          tone: "good",
        });
        break;
      case "camp-spent":
        lines.push({ text: "This camp's fire has burned out.", tone: "info" });
        break;
      case "no-stairs":
        lines.push({ text: "There's nothing here to use.", tone: "info" });
        break;
      case "died":
        lines.push({ text: "You have fallen.", tone: "danger" });
        break;
      default:
        break;
    }
  }
  return lines;
}
