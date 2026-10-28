import { creatureKind } from "../../../engine/creatures";
import {
  CACHE,
  type GearKind,
  itemKind,
  type SupplyId,
  type SupplyKind,
} from "../../../engine/items";
import { indexOf } from "../../../engine/map";
import {
  type ActionResult,
  currentFloor,
  type GameEvent,
  type UnneededReason,
  visibleTiles,
} from "../../../engine/run";
import { lootName, trapName, withArticle } from "./itemText";

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
  const spoils = new Map(of("monster-died").map((e) => [e.id, e.gold]));
  const attacked = new Set(of("attacked").map((e) => e.target));
  // A Survey Lens reveals traps all at once; its own line says how many.
  const surveyed = of("used").some((e) => e.item === "survey-lens");

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
            ? {
                text: `You slay the ${nameOf(event.kind)}${spoils.get(event.target) ? ` (+${spoils.get(event.target)} gold)` : ""}.`,
                tone: "combat",
              }
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
        else if (event.reason === "doused")
          lines.push({ text: "The bright light gutters out.", tone: "danger" });
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
      case "picked-up": {
        const name = lootName(event.item);
        lines.push({
          text: event.fromCache
            ? `You break open a cache and find ${withArticle(name)}.`
            : `You pick up ${withArticle(name)}.`,
          tone: "good",
        });
        break;
      }
      case "gold-found":
        lines.push({ text: `You gather ${event.amount} gold.`, tone: "good" });
        break;
      case "hoard":
        lines.push({
          text: `The ${nameOf(event.kind)} leaves a hoard: ${event.gold} gold and ${withArticle(lootName(event.item))}.`,
          tone: "good",
        });
        break;
      case "bought":
        lines.push({
          text: `You buy ${withArticle(lootName(event.item))} for ${event.price} gold.`,
          tone: "good",
        });
        break;
      case "sold":
        lines.push({
          text: `You sell the ${lootName(event.item)} for ${event.price} gold.`,
          tone: "info",
        });
        break;
      case "cannot-afford":
        lines.push({
          text: `The ${lootName(event.item)} costs ${event.price} gold; you can't afford it.`,
          tone: "info",
        });
        break;
      case "sold-out":
        lines.push({ text: `The merchant has no more of those.`, tone: "info" });
        break;
      case "no-merchant":
        lines.push({ text: "There's no one here to trade with.", tone: "info" });
        break;
      case "stairs-sealed":
        lines.push({
          text: `The way down is sealed while the ${nameOf(event.by)} lives.`,
          tone: "danger",
        });
        break;
      case "beacon-smothered":
        lines.push({
          text: `The ${nameOf(event.by)} smothers the Beacon. Defeat it first.`,
          tone: "danger",
        });
        break;
      case "rekindled":
        lines.push({ text: "You rekindle the Beacon. Light floods the deep!", tone: "good" });
        break;
      case "pack-full":
        lines.push({
          text:
            event.item === CACHE
              ? "Your pack is full; the cache stays shut."
              : `Your pack is full; the ${lootName(event.item)} stays where it is.`,
          tone: "info",
        });
        break;
      case "nothing-here":
        lines.push({ text: "There's nothing here to pick up.", tone: "info" });
        break;
      case "used":
        lines.push({ text: describeUse(event.item, event.amount), tone: "good" });
        break;
      case "item-unneeded":
        lines.push({ text: UNNEEDED[event.reason], tone: "info" });
        break;
      case "equipped": {
        const kind = itemKind(event.item) as GearKind;
        const change = kind.power - (itemKind(event.previous) as GearKind).power;
        const stat = kind.category === "weapon" ? "attack" : "defense";
        const verb = kind.category === "weapon" ? "You ready the" : "You put on the";
        lines.push({
          text: `${verb} ${kind.name} (${change >= 0 ? "+" : ""}${change} ${stat}).`,
          tone: change >= 0 ? "good" : "info",
        });
        break;
      }
      case "already-equipped":
        lines.push({ text: `You already have the ${lootName(event.item)} on.`, tone: "info" });
        break;
      case "dropped":
        lines.push({ text: `You set down the ${lootName(event.item)}.`, tone: "info" });
        break;
      case "cannot-drop":
        lines.push({ text: "There's no room to set anything down here.", tone: "info" });
        break;
      case "trap-found":
        if (!surveyed) {
          lines.push({
            text: `Your light shows ${withArticle(trapName(event.kind))}!`,
            tone: "danger",
          });
        }
        break;
      case "trap-sprung":
        lines.push({ text: describeTrap(event), tone: "danger" });
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

const UNNEEDED: Readonly<Record<UnneededReason, string>> = {
  "full-health": "You're already at full health.",
  "full-charge": "Your lantern is already full.",
  "no-targets": "There are no creatures in reach.",
};

function describeUse(item: SupplyId, amount: number): string {
  const kind = itemKind(item) as SupplyKind;
  const name = kind.name;
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  switch (kind.effect.kind) {
    case "heal":
      return `You use ${withArticle(name)} (+${amount} health).`;
    case "charge":
      return `The ${name} feeds your lantern (+${amount} charge).`;
    case "shield":
      return `The ${name} wraps you in a ward (+${amount} shield).`;
    case "vigor":
      return `You drink the ${name} (+${amount} max health).`;
    case "flare":
      return `The ${name} bursts over ${plural(amount, "creature")}.`;
    case "survey":
      return amount > 0
        ? `The ${name} shows the whole floor, and ${plural(amount, "hidden trap")}.`
        : `The ${name} shows the whole floor.`;
    case "waystone":
      return `The ${name} carries you somewhere quiet.`;
  }
}

function describeTrap(event: Extract<GameEvent, { type: "trap-sprung" }>): string {
  const trap = withArticle(trapName(event.kind)).replace(/^a/, "A");
  switch (event.kind) {
    case "ember-vent": {
      const shield = event.absorbed > 0 ? ` (your shield takes ${event.absorbed})` : "";
      return `${trap} erupts beneath you for ${event.damage}${shield}!`;
    }
    case "alarm-glyph":
      return event.woke > 0
        ? `${trap} shrieks, waking ${event.woke} creature${event.woke === 1 ? "" : "s"}!`
        : `${trap} shrieks into the dark!`;
    case "gloom-rune":
      return `${trap} drinks ${event.drained} charge from your lantern.`;
    case "spike-trap": {
      const shield = event.absorbed > 0 ? ` (your shield takes ${event.absorbed})` : "";
      return `${trap} springs, stabbing you for ${event.damage}${shield}!`;
    }
  }
}
