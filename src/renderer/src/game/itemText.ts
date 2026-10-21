import { type Behavior, creatureKind, type Monster } from "../../../engine/creatures";
import { chebyshevDistance } from "../../../engine/geometry";
import {
  CACHE,
  type GearKind,
  GOLD,
  type ItemKind,
  isSupply,
  itemKind,
  type LootId,
  type SupplyKind,
  TRAP_IDS,
  type Trap,
  type TrapKind,
  trapKind,
} from "../../../engine/items";
import { indexOf } from "../../../engine/map";
import { heroAttackPower, LANTERN_MAX } from "../../../engine/rules";
import {
  attackPower,
  type Cause,
  creatureHitRange,
  currentFloor,
  defensePower,
  heroHitRange,
  type RunState,
  visibleTiles,
} from "../../../engine/run";

/** Words for items, creatures and traps shared by the message log, tooltips and the pack. */

export const CACHE_NAME = "Supply Cache";
const CACHE_DESCRIPTION =
  "A sealed crate left by the survey crews. Break it open to find one supply inside.";

export const GOLD_NAME = "Gold";
const GOLD_DESCRIPTION =
  "Coins the observatory's crews left behind. Merchants on the way down take them.";

export function lootName(id: LootId): string {
  if (id === CACHE) return CACHE_NAME;
  return id === GOLD ? GOLD_NAME : itemKind(id).name;
}

export function lootDescription(id: LootId): string {
  if (id === CACHE) return CACHE_DESCRIPTION;
  return id === GOLD ? GOLD_DESCRIPTION : itemKind(id).description;
}

/** "a Salve", "an Ember Shard". */
export function withArticle(name: string): string {
  return `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
}

export function categoryLabel(kind: ItemKind): string {
  return kind.category === "supply" ? "Supply" : kind.category === "weapon" ? "Weapon" : "Armor";
}

/** What a supply does, in one line. */
export function effectLine(kind: SupplyKind): string {
  const effect = kind.effect;
  switch (effect.kind) {
    case "heal":
      return `Restores up to ${effect.amount} health.`;
    case "charge":
      return `Restores up to ${effect.amount} lantern charge.`;
    case "shield":
      return `Adds a ${effect.amount}-point shield that takes blows before your health.`;
    case "vigor":
      return `Raises your maximum health by ${effect.amount} for this descent.`;
    case "waystone":
      return "Carries you to a quiet spot on this floor, away from creatures.";
    case "survey":
      return "Reveals this floor's layout and every hidden trap on it.";
    case "flare":
      return `Deals ${effect.damage} damage to every creature in view within ${effect.radius} tiles.`;
  }
}

export interface Outlook {
  readonly text: string;
  /** "good" when using it now helps; "muted" when it would be wasted. */
  readonly tone: "good" | "muted";
}

/** What using a supply right now would do. */
export function supplyOutlook(run: RunState, kind: SupplyKind): Outlook | null {
  const effect = kind.effect;
  const { hero, lantern } = run;
  switch (effect.kind) {
    case "heal": {
      const missing = hero.maxHp - hero.hp;
      return missing === 0
        ? { text: "You're at full health.", tone: "muted" }
        : { text: `Would restore ${Math.min(missing, effect.amount)} health now.`, tone: "good" };
    }
    case "charge": {
      const missing = LANTERN_MAX - lantern.charge;
      return missing === 0
        ? { text: "Your lantern is full.", tone: "muted" }
        : { text: `Would restore ${Math.min(missing, effect.amount)} charge now.`, tone: "good" };
    }
    case "shield":
      return { text: `Shield ${hero.shield} → ${hero.shield + effect.amount}`, tone: "good" };
    case "vigor":
      return { text: `Max health ${hero.maxHp} → ${hero.maxHp + effect.amount}`, tone: "good" };
    case "flare": {
      const visible = visibleTiles(run);
      const inReach = currentFloor(run).monsters.filter(
        (m) => chebyshevDistance(m, hero) <= effect.radius && visible.has(indexOf(m)),
      ).length;
      return inReach === 0
        ? { text: "No creatures in reach.", tone: "muted" }
        : { text: `${inReach} creature${inReach === 1 ? "" : "s"} in reach.`, tone: "good" };
    }
    case "waystone":
    case "survey":
      return null;
  }
}

export interface GearComparison {
  readonly label: "Attack" | "Defense";
  readonly current: number;
  readonly next: number;
  readonly equipped: boolean;
}

/** The hero's attack or defense now, and with this piece of gear instead. */
export function gearComparison(run: RunState, kind: GearKind): GearComparison {
  if (kind.category === "weapon") {
    return {
      label: "Attack",
      current: attackPower(run),
      next: heroAttackPower(run.hero.level, kind.power),
      equipped: run.equipment.weapon === kind.id,
    };
  }
  return {
    label: "Defense",
    current: defensePower(run),
    next: kind.power,
    equipped: run.equipment.armor === kind.id,
  };
}

export function isGearKind(kind: ItemKind): kind is GearKind {
  return !isSupply(kind);
}

export const BEHAVIOR_TEXT: Readonly<Record<Behavior, string>> = {
  chase: "Hunts you down by the shortest way.",
  slow: "Slow: acts only every other turn.",
  ranged: "Strikes from up to 4 tiles away in a straight line.",
  erratic: "Lurches about unpredictably.",
  swift: "Swift: takes two steps a turn.",
};

export interface CreatureOutlook {
  /** Damage each of its blows deals you, after armor. */
  readonly hitsYou: readonly [number, number];
  /** Damage each of your blows deals it. */
  readonly youHit: readonly [number, number];
  /** How many of your blows it takes to fell, fewest to most. */
  readonly blows: readonly [number, number];
}

export function creatureOutlook(run: RunState, monster: Monster): CreatureOutlook {
  const youHit = heroHitRange(run);
  return {
    hitsYou: creatureHitRange(monster, run),
    youHit,
    blows: [Math.ceil(monster.hp / youHit[1]), Math.ceil(monster.hp / youHit[0])],
  };
}

/** "5" or "5–7". */
export function range([low, high]: readonly [number, number]): string {
  return low === high ? String(low) : `${low}–${high}`;
}

/** What a found trap would do. */
export function trapEffect(trap: Pick<Trap, "kind" | "power">): string {
  switch (trap.kind) {
    case "ember-vent":
      return `Burns for ${trap.power}, ignoring armor.`;
    case "alarm-glyph":
      return `Wakes every creature within ${trap.power} tiles.`;
    case "gloom-rune":
      return `Drains up to ${trap.power} lantern charge.`;
  }
}

export function trapName(kind: TrapKind): string {
  return trapKind(kind).name;
}

/** What ended a descent, for the death screen: "a Cinder Mite", "an Ember Vent". */
export function causeName(cause: Cause): string {
  return withArticle(isTrapKind(cause) ? trapKind(cause).name : creatureKind(cause).name);
}

function isTrapKind(cause: Cause): cause is TrapKind {
  return (TRAP_IDS as readonly string[]).includes(cause);
}

/** "1 creature", "3 creatures". */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export const MERCHANT_TEXT =
  "A quartermaster who stayed behind when the observatory emptied, trading with anyone who comes down. Creatures leave the stall alone.";
export const BEACON_TEXT =
  "The fire the astronomers lit to hold back what woke in the deep. It gutters now. Defeat its Warden, then rekindle it.";
