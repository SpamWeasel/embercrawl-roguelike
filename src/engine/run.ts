import { type CreatureId, creatureKind, type Monster } from "./creatures";
import { type Floor, generateFloor, pickGear, pickSupply } from "./generate";
import {
  chebyshevDistance,
  DIRECTION_VECTORS,
  DIRECTIONS,
  type Direction,
  directionFromDelta,
  type Point,
  samePoint,
  step,
} from "./geometry";
import {
  type ArmorId,
  CACHE,
  type Equipment,
  type FloorItem,
  type GearId,
  type GearKind,
  GOLD,
  type ItemId,
  isSupply,
  itemKind,
  type LootId,
  type Pack,
  type ShopOffer,
  STARTING_ARMOR,
  STARTING_WEAPON,
  type SupplyId,
  type SupplyKind,
  type Trap,
  type TrapKind,
  type WeaponId,
} from "./items";
import { canStep, FLOOR_COUNT, inBounds, indexOf, MAP_SIZE, pointOf, Tile, tileAt } from "./map";
import { emptyPack, packAdd, packRemoveOne } from "./pack";
import { findPath, stepDistances } from "./path";
import { Rng, type RngState } from "./rng";
import {
  BRIGHT_COST,
  BRIGHT_SIGHT,
  CAMP_CHARGE,
  CAMP_HEAL_SHARE,
  CREATURE_HIT_SPREAD,
  creatureHit,
  DIM_SIGHT,
  GUARDIAN_GEAR_LEAD,
  guardianHoard,
  HERO_HIT_SPREAD,
  HERO_START_HP,
  heroAttackPower,
  heroDefense,
  killGold,
  LANTERN_MAX,
  LEVEL_HEAL,
  LEVEL_HP_GAIN,
  PERCEPTION_RANGE,
  PULSE_BONUS_DAMAGE,
  PULSE_COST,
  PULSE_RADIUS,
  PULSE_SHIELD,
  RANGED_REACH,
  sellPrice,
  TRAP_SPOT_RANGE,
  WAYSTONE_CLEARANCE,
  WAYSTONE_MIN_JUMP,
  xpToNextLevel,
} from "./rules";
import { computeVisible, hasLineOfSight } from "./sight";

export interface Hero extends Point {
  /** Which way the sprite faces; changes only on moves with a sideways part. */
  readonly facing: "left" | "right";
  readonly hp: number;
  readonly maxHp: number;
  readonly level: number;
  /** Experience toward the next level. */
  readonly xp: number;
  /** Absorbs damage before health. */
  readonly shield: number;
}

export interface Lantern {
  readonly charge: number;
  readonly bright: boolean;
}

/** What ended a descent: a creature, or a trap. */
export type Cause = CreatureId | TrapKind;

/** One descent: everything needed to resume exactly where the player left off. */
export interface RunState {
  readonly seed: number;
  readonly turn: number;
  readonly depth: number;
  /** Floors visited so far, one per depth. Unvisited floors are generated on first arrival. */
  readonly floors: readonly Floor[];
  readonly hero: Hero;
  readonly lantern: Lantern;
  readonly equipment: Equipment;
  readonly pack: Pack;
  readonly gold: number;
  /** The gameplay random stream (combat rolls, erratic steps), separate from floor generation. */
  readonly rng: RngState;
  readonly kills: number;
  /** Creature kinds seen during this descent. */
  readonly discovered: readonly CreatureId[];
  /** "won": the Beacon has been rekindled; the descent is over. */
  readonly status: "active" | "dead" | "won";
  readonly killedBy: Cause | null;
}

export type Action =
  | { readonly type: "move"; readonly direction: Direction }
  | { readonly type: "wait" }
  | { readonly type: "use-stairs" }
  | { readonly type: "rest" }
  | { readonly type: "toggle-light" }
  | { readonly type: "pulse" }
  /** Picks up what lies underfoot (stepping onto an item does this automatically). */
  | { readonly type: "pick-up" }
  /** Uses the supply, or equips the weapon or armor, in a pack slot. */
  | { readonly type: "use-item"; readonly slot: number }
  /** Sets one item from a pack slot down where the hero stands. */
  | { readonly type: "drop-item"; readonly slot: number }
  /** Buys one of an offer from the merchant the hero stands at. */
  | { readonly type: "buy"; readonly offer: number }
  /** Sells one item from a pack slot to the merchant the hero stands at. */
  | { readonly type: "sell"; readonly slot: number }
  /** Rekindles the Beacon the hero stands at, once its Warden has fallen. */
  | { readonly type: "rekindle" };

/** Why a supply wasn't used (it would have been wasted). */
export type UnneededReason = "full-health" | "full-charge" | "no-targets";

/** What happened during an action, for animation and the message log. */
export type GameEvent =
  | {
      readonly type: "moved";
      readonly from: Point;
      readonly to: Point;
      readonly direction: Direction;
    }
  | { readonly type: "blocked"; readonly direction: Direction }
  | { readonly type: "waited" }
  | { readonly type: "changed-floor"; readonly from: number; readonly to: number }
  | { readonly type: "no-stairs" }
  | {
      readonly type: "attacked";
      readonly target: string;
      readonly kind: CreatureId;
      readonly at: Point;
      readonly direction: Direction;
      readonly damage: number;
    }
  /** Damage from an area effect (a pulse or a flare); blows are reported by "attacked". */
  | {
      readonly type: "monster-hurt";
      readonly id: string;
      readonly kind: CreatureId;
      readonly at: Point;
      readonly damage: number;
    }
  | {
      readonly type: "monster-moved";
      readonly id: string;
      readonly from: Point;
      readonly to: Point;
    }
  | { readonly type: "monster-noticed"; readonly id: string; readonly kind: CreatureId }
  | { readonly type: "monster-readied"; readonly id: string; readonly kind: CreatureId }
  | {
      readonly type: "monster-struck";
      readonly id: string;
      readonly kind: CreatureId;
      readonly from: Point;
      readonly ranged: boolean;
      readonly damage: number;
      readonly absorbed: number;
    }
  | {
      readonly type: "monster-died";
      readonly id: string;
      readonly kind: CreatureId;
      readonly at: Point;
      readonly xp: number;
      /** Coins it dropped, added straight to the hero's purse. */
      readonly gold: number;
    }
  /** A guardian's hoard: extra gold, and a piece of gear left where it fell (or close by). */
  | {
      readonly type: "hoard";
      readonly kind: CreatureId;
      readonly gold: number;
      readonly loot: string;
      readonly item: GearId;
      readonly at: Point;
    }
  | {
      readonly type: "gold-found";
      readonly loot: string;
      readonly amount: number;
      readonly at: Point;
    }
  | {
      readonly type: "bought";
      readonly item: ItemId;
      readonly price: number;
      /** Index of the offer, so its count can be animated. */
      readonly offer: number;
    }
  | { readonly type: "sold"; readonly item: ItemId; readonly price: number }
  | { readonly type: "cannot-afford"; readonly item: ItemId; readonly price: number }
  | { readonly type: "sold-out"; readonly item: ItemId }
  | { readonly type: "no-merchant" }
  /** The stairs down won't open while this floor's guardian lives. */
  | { readonly type: "stairs-sealed"; readonly by: CreatureId }
  /** The Beacon can't be rekindled while its Warden lives. */
  | { readonly type: "beacon-smothered"; readonly by: CreatureId }
  | { readonly type: "rekindled"; readonly at: Point }
  | { readonly type: "leveled-up"; readonly level: number }
  | { readonly type: "spotted"; readonly kind: CreatureId }
  | {
      readonly type: "lantern";
      readonly bright: boolean;
      readonly reason: "toggled" | "empty" | "doused";
    }
  | { readonly type: "pulsed"; readonly at: Point; readonly hits: number }
  | { readonly type: "not-enough-charge"; readonly needed: number }
  | { readonly type: "rested"; readonly healed: number; readonly charge: number }
  | { readonly type: "camp-spent" }
  | {
      readonly type: "picked-up";
      /** The floor item's id, so its sprite can be animated away. */
      readonly loot: string;
      readonly item: ItemId;
      readonly at: Point;
      readonly fromCache: boolean;
    }
  | { readonly type: "pack-full"; readonly item: LootId }
  | { readonly type: "nothing-here" }
  | {
      readonly type: "used";
      readonly item: SupplyId;
      /**
       * What it achieved: health healed, charge restored, shield gained, maximum health gained,
       * creatures hit (flare) or traps revealed (survey). Zero for a Waystone.
       */
      readonly amount: number;
    }
  | { readonly type: "item-unneeded"; readonly item: SupplyId; readonly reason: UnneededReason }
  | { readonly type: "teleported"; readonly from: Point; readonly to: Point }
  | {
      readonly type: "equipped";
      readonly item: GearId;
      readonly slot: "weapon" | "armor";
      readonly previous: GearId;
    }
  | { readonly type: "already-equipped"; readonly item: GearId }
  | { readonly type: "dropped"; readonly loot: string; readonly item: ItemId; readonly at: Point }
  | { readonly type: "cannot-drop" }
  | {
      readonly type: "trap-found";
      readonly id: string;
      readonly kind: TrapKind;
      readonly at: Point;
    }
  | {
      readonly type: "trap-sprung";
      readonly id: string;
      readonly kind: TrapKind;
      readonly at: Point;
      readonly damage: number;
      readonly absorbed: number;
      readonly drained: number;
      /** Creatures the alarm woke. */
      readonly woke: number;
    }
  | { readonly type: "died"; readonly by: Cause };

export interface ActionResult {
  readonly run: RunState;
  readonly events: readonly GameEvent[];
  /** False when nothing happened (walking into a wall, using stairs that aren't there). */
  readonly tookTurn: boolean;
}

/** What the hero can do on the current tile, for the on-screen prompt. */
export type Interaction =
  | {
      readonly kind: "descend" | "ascend";
      readonly toDepth: number;
      /** The guardian keeping the way down shut, if it still lives. */
      readonly sealedBy: CreatureId | null;
    }
  | { readonly kind: "rest" }
  | { readonly kind: "trade" }
  | { readonly kind: "rekindle"; readonly smotheredBy: CreatureId | null }
  | { readonly kind: "pick-up"; readonly item: LootId };

export function newRun(seed: number): RunState {
  const floor = generateFloor(seed, 1);
  const hero: Hero = {
    ...floor.entrance,
    facing: "right",
    hp: HERO_START_HP,
    maxHp: HERO_START_HP,
    level: 1,
    xp: 0,
    shield: 0,
  };
  const lantern: Lantern = { charge: LANTERN_MAX, bright: false };
  const seen = look(floor, hero, lantern, [], []);
  return {
    seed,
    turn: 0,
    depth: 1,
    floors: [seen.floor],
    hero,
    lantern,
    equipment: { weapon: STARTING_WEAPON, armor: STARTING_ARMOR },
    pack: emptyPack(),
    gold: 0,
    rng: Rng.derive(seed, "play").state(),
    kills: 0,
    discovered: seen.discovered,
    status: "active",
    killedBy: null,
  };
}

export function currentFloor(run: RunState): Floor {
  const floor = run.floors.find((f) => f.depth === run.depth);
  if (!floor) throw new Error(`Floor ${run.depth} is missing from this run.`);
  return floor;
}

export function sightRadius(lantern: Lantern): number {
  return lantern.bright ? BRIGHT_SIGHT : DIM_SIGHT;
}

/** Tiles the hero can see right now. */
export function visibleTiles(run: RunState): Set<number> {
  return computeVisible(currentFloor(run).tiles, run.hero, sightRadius(run.lantern));
}

/** The hero's attack power with their weapon (each blow adds 0–HERO_HIT_SPREAD). */
export function attackPower(run: Pick<RunState, "hero" | "equipment">): number {
  return heroAttackPower(run.hero.level, gearPower(run.equipment.weapon));
}

/** How much the hero's armor takes off each creature blow. */
export function defensePower(run: Pick<RunState, "equipment">): number {
  return heroDefense(gearPower(run.equipment.armor));
}

/** The least and most one of the hero's blows deals. */
export function heroHitRange(run: Pick<RunState, "hero" | "equipment">): [number, number] {
  const power = attackPower(run);
  return [power, power + HERO_HIT_SPREAD];
}

/** The least and most one blow from this creature deals to the hero, after armor. */
export function creatureHitRange(
  monster: Pick<Monster, "attack">,
  run: Pick<RunState, "equipment">,
): [number, number] {
  const defense = defensePower(run);
  return [
    creatureHit(monster.attack, defense, 0),
    creatureHit(monster.attack, defense, CREATURE_HIT_SPREAD),
  ];
}

function gearPower(id: GearId): number {
  return (itemKind(id) as GearKind).power;
}

export function availableInteraction(run: RunState): Interaction | null {
  const floor = currentFloor(run);
  const kind = tileAt(floor.tiles, run.hero);
  if (kind === Tile.StairsDown && run.depth < FLOOR_COUNT) {
    const guardian = livingGuardian(floor);
    return { kind: "descend", toDepth: run.depth + 1, sealedBy: guardian?.kind ?? null };
  }
  if (kind === Tile.StairsUp && run.depth > 1)
    return { kind: "ascend", toDepth: run.depth - 1, sealedBy: null };
  if (floor.camp && samePoint(floor.camp, run.hero) && !floor.campUsed) return { kind: "rest" };
  if (floor.merchant && samePoint(floor.merchant, run.hero)) return { kind: "trade" };
  if (floor.beacon && samePoint(floor.beacon, run.hero))
    return { kind: "rekindle", smotheredBy: livingGuardian(floor)?.kind ?? null };
  const loot = floor.items.find((item) => samePoint(item, run.hero));
  if (loot) return { kind: "pick-up", item: loot.item };
  return null;
}

/** Whether the hero is standing on this floor's camp, where creatures can't reach them. */
export function onCamp(run: RunState): boolean {
  const camp = currentFloor(run).camp;
  return camp !== null && samePoint(camp, run.hero);
}

/** Whether the hero is standing at this floor's merchant, and can trade. */
export function atMerchant(run: RunState): boolean {
  const merchant = currentFloor(run).merchant;
  return merchant !== null && samePoint(merchant, run.hero);
}

/** A floor's guardian, while it lives. */
export function livingGuardian(floor: Floor): Monster | undefined {
  return floor.monsters.find((m) => m.hp > 0 && creatureKind(m.kind).guardian === true);
}

/** Camps and merchants' stalls: creatures can't step there or strike someone standing there. */
function isWarded(floor: Floor, p: Point): boolean {
  return (
    (floor.camp !== null && samePoint(floor.camp, p)) ||
    (floor.merchant !== null && samePoint(floor.merchant, p))
  );
}

/** Applies one player action, then lets creatures respond. The input run is never modified. */
export function applyAction(run: RunState, action: Action): ActionResult {
  if (run.status !== "active") return { run, events: [], tookTurn: false };
  if (action.type === "use-stairs") return takeStairs(run);

  const turn = new Turn(run);
  const acted = turn.heroActs(action);
  if (!acted) return { run, events: turn.events, tookTurn: false };
  turn.burnLantern();
  turn.creaturesAct();
  return { run: turn.finish(), events: turn.events, tookTurn: true };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Working state for one action, applied to copies and frozen into a new run at the end. */
class Turn {
  readonly events: GameEvent[] = [];
  private readonly rng: Rng;
  private readonly floor: Floor;
  private readonly hero: Mutable<Hero>;
  private readonly lantern: Mutable<Lantern>;
  private readonly equipment: Mutable<Equipment>;
  private pack: Pack;
  private monsters: Mutable<Monster>[];
  private items: readonly FloorItem[];
  private traps: readonly Trap[];
  private explored: readonly boolean[];
  private campUsed: boolean;
  private stock: readonly ShopOffer[];
  private gold: number;
  private turnNumber: number;
  private kills: number;
  private status: RunState["status"];
  private killedBy: Cause | null;

  constructor(private readonly run: RunState) {
    this.rng = Rng.fromState(run.rng);
    this.floor = currentFloor(run);
    this.hero = { ...run.hero };
    this.lantern = { ...run.lantern };
    this.equipment = { ...run.equipment };
    this.pack = run.pack;
    this.monsters = this.floor.monsters.map((m) => ({ ...m }));
    this.items = this.floor.items;
    this.traps = this.floor.traps;
    this.explored = this.floor.explored;
    this.campUsed = this.floor.campUsed;
    this.stock = this.floor.stock;
    this.gold = run.gold;
    this.turnNumber = run.turn;
    this.kills = run.kills;
    this.status = run.status;
    this.killedBy = run.killedBy;
  }

  /** Returns false when the action didn't happen (so no turn passes). */
  heroActs(action: Exclude<Action, { type: "use-stairs" }>): boolean {
    switch (action.type) {
      case "move":
        return this.heroMoves(action.direction);
      case "wait":
        this.events.push({ type: "waited" });
        return true;
      case "rest":
        return this.rest();
      case "toggle-light":
        return this.toggleLight();
      case "pulse":
        return this.pulse();
      case "pick-up":
        return this.pickUp(false);
      case "use-item":
        return this.handleItem(action.slot);
      case "drop-item":
        return this.dropItem(action.slot);
      case "buy":
        return this.buy(action.offer);
      case "sell":
        return this.sell(action.slot);
      case "rekindle":
        return this.rekindle();
    }
  }

  private atStall(): boolean {
    const merchant = this.floor.merchant;
    if (merchant && samePoint(merchant, this.hero)) return true;
    this.events.push({ type: "no-merchant" });
    return false;
  }

  /** Buys one of an offer: it needs the gold and room in the pack. */
  private buy(index: number): boolean {
    if (!this.atStall()) return false;
    const offer = this.stock[index];
    if (!offer) return false;
    if (offer.count === 0) {
      this.events.push({ type: "sold-out", item: offer.item });
      return false;
    }
    if (this.gold < offer.price) {
      this.events.push({ type: "cannot-afford", item: offer.item, price: offer.price });
      return false;
    }
    const pack = packAdd(this.pack, offer.item);
    if (!pack) {
      this.events.push({ type: "pack-full", item: offer.item });
      return false;
    }
    this.pack = pack;
    this.gold -= offer.price;
    this.stock = this.stock.map((o, i) => (i === index ? { ...o, count: o.count - 1 } : o));
    this.events.push({ type: "bought", item: offer.item, price: offer.price, offer: index });
    return true;
  }

  /** Sells one item from a pack slot for a share of its base price. */
  private sell(slot: number): boolean {
    if (!this.atStall()) return false;
    const entry = this.pack[slot];
    if (!entry) return false;
    const price = sellPrice(entry.item);
    this.pack = packRemoveOne(this.pack, slot);
    this.gold += price;
    this.events.push({ type: "sold", item: entry.item, price });
    return true;
  }

  /** Rekindles the Beacon, winning the descent, once its Warden has fallen. */
  private rekindle(): boolean {
    const beacon = this.floor.beacon;
    if (!beacon || !samePoint(beacon, this.hero)) return false;
    const warden = this.monsters.find((m) => m.hp > 0 && creatureKind(m.kind).guardian === true);
    if (warden) {
      this.events.push({ type: "beacon-smothered", by: warden.kind });
      return false;
    }
    this.status = "won";
    this.events.push({ type: "rekindled", at: { x: beacon.x, y: beacon.y } });
    return true;
  }

  private attackPower(): number {
    return heroAttackPower(this.hero.level, gearPower(this.equipment.weapon));
  }

  private heroMoves(direction: Direction): boolean {
    const tiles = this.floor.tiles;
    if (!canStep(tiles, this.hero, direction)) {
      this.events.push({ type: "blocked", direction });
      return false;
    }
    const to = step(this.hero, direction);
    const dx = DIRECTION_VECTORS[direction].x;
    if (dx !== 0) this.hero.facing = dx > 0 ? "right" : "left";
    const target = this.monsterAt(to);
    if (target) {
      // Moving into a creature attacks it.
      const damage = this.attackPower() + this.rng.int(0, HERO_HIT_SPREAD);
      this.events.push({
        type: "attacked",
        target: target.id,
        kind: target.kind,
        at: { x: to.x, y: to.y },
        direction,
        damage,
      });
      this.damageMonster(target, damage);
      return true;
    }
    this.events.push({ type: "moved", from: { x: this.hero.x, y: this.hero.y }, to, direction });
    this.hero.x = to.x;
    this.hero.y = to.y;
    this.springTrap();
    if (this.status === "active") this.pickUp(true);
    return true;
  }

  private rest(): boolean {
    const camp = this.floor.camp;
    if (!camp || !samePoint(camp, this.hero)) return false;
    if (this.campUsed) {
      this.events.push({ type: "camp-spent" });
      return false;
    }
    const healed = Math.min(
      this.hero.maxHp - this.hero.hp,
      Math.ceil(this.hero.maxHp * CAMP_HEAL_SHARE),
    );
    const charge = Math.min(LANTERN_MAX - this.lantern.charge, CAMP_CHARGE);
    this.hero.hp += healed;
    this.lantern.charge += charge;
    this.campUsed = true;
    this.events.push({ type: "rested", healed, charge });
    return true;
  }

  private toggleLight(): boolean {
    if (!this.lantern.bright && this.lantern.charge < BRIGHT_COST) {
      this.events.push({ type: "not-enough-charge", needed: BRIGHT_COST });
      return false;
    }
    this.lantern.bright = !this.lantern.bright;
    this.events.push({ type: "lantern", bright: this.lantern.bright, reason: "toggled" });
    return true;
  }

  private pulse(): boolean {
    if (this.lantern.charge < PULSE_COST) {
      this.events.push({ type: "not-enough-charge", needed: PULSE_COST });
      return false;
    }
    this.lantern.charge -= PULSE_COST;
    this.hero.shield += PULSE_SHIELD;
    const damage = this.attackPower() + PULSE_BONUS_DAMAGE;
    const targets = this.monsters.filter(
      (m) =>
        m.hp > 0 &&
        chebyshevDistance(m, this.hero) <= PULSE_RADIUS &&
        hasLineOfSight(this.floor.tiles, this.hero, m),
    );
    this.events.push({
      type: "pulsed",
      at: { x: this.hero.x, y: this.hero.y },
      hits: targets.length,
    });
    for (const target of targets) this.damageMonster(target, damage, true);
    return true;
  }

  /** Picks up the item underfoot. `auto` is for stepping onto it, which stays quiet if there's none. */
  private pickUp(auto: boolean): boolean {
    const loot = this.items.find((item) => samePoint(item, this.hero));
    if (!loot) {
      if (!auto) this.events.push({ type: "nothing-here" });
      return false;
    }
    if (loot.item === GOLD) {
      // Coins go straight into the purse, never the pack.
      const amount = loot.amount ?? 0;
      this.gold += amount;
      this.items = this.items.filter((i) => i !== loot);
      this.events.push({ type: "gold-found", loot: loot.id, amount, at: { x: loot.x, y: loot.y } });
      return true;
    }
    const fromCache = loot.item === CACHE;
    const item =
      loot.item === CACHE ? cacheContents(this.run.seed, this.run.depth, loot) : loot.item;
    const pack = packAdd(this.pack, item);
    if (!pack) {
      this.events.push({ type: "pack-full", item: loot.item });
      return false;
    }
    this.pack = pack;
    this.items = this.items.filter((i) => i !== loot);
    this.events.push({
      type: "picked-up",
      loot: loot.id,
      item,
      at: { x: loot.x, y: loot.y },
      fromCache,
    });
    return true;
  }

  private handleItem(slot: number): boolean {
    const entry = this.pack[slot];
    if (!entry) return false;
    const kind = itemKind(entry.item);
    return isSupply(kind) ? this.consumeSupply(slot, kind) : this.equip(slot, kind);
  }

  private consumeSupply(slot: number, kind: SupplyKind): boolean {
    const item = kind.id as SupplyId;
    const effect = kind.effect;
    const hero = this.hero;
    const used = (amount: number) => {
      this.pack = packRemoveOne(this.pack, slot);
      this.events.push({ type: "used", item, amount });
      return true;
    };
    switch (effect.kind) {
      case "heal": {
        const missing = hero.maxHp - hero.hp;
        if (missing === 0) return this.unneeded(item, "full-health");
        const healed = Math.min(missing, effect.amount);
        hero.hp += healed;
        return used(healed);
      }
      case "charge": {
        const missing = LANTERN_MAX - this.lantern.charge;
        if (missing === 0) return this.unneeded(item, "full-charge");
        const charged = Math.min(missing, effect.amount);
        this.lantern.charge += charged;
        return used(charged);
      }
      case "shield":
        hero.shield += effect.amount;
        return used(effect.amount);
      case "vigor":
        hero.maxHp += effect.amount;
        hero.hp += effect.amount;
        return used(effect.amount);
      case "flare": {
        const visible = computeVisible(this.floor.tiles, hero, sightRadius(this.lantern));
        const targets = this.monsters.filter(
          (m) => m.hp > 0 && chebyshevDistance(m, hero) <= effect.radius && visible.has(indexOf(m)),
        );
        if (targets.length === 0) return this.unneeded(item, "no-targets");
        used(targets.length);
        for (const target of targets) this.damageMonster(target, effect.damage, true);
        return true;
      }
      case "survey": {
        const hidden = this.traps.filter((t) => !t.found);
        used(hidden.length);
        this.explored = new Array<boolean>(MAP_SIZE).fill(true);
        this.traps = this.traps.map((t) => (t.found ? t : { ...t, found: true }));
        for (const trap of hidden) {
          this.events.push({
            type: "trap-found",
            id: trap.id,
            kind: trap.kind,
            at: { x: trap.x, y: trap.y },
          });
        }
        return true;
      }
      case "waystone": {
        const from = { x: hero.x, y: hero.y };
        const to = this.waystoneLanding();
        used(0);
        hero.x = to.x;
        hero.y = to.y;
        this.events.push({ type: "teleported", from, to });
        return true;
      }
    }
  }

  private unneeded(item: SupplyId, reason: UnneededReason): false {
    this.events.push({ type: "item-unneeded", item, reason });
    return false;
  }

  /**
   * A random open tile well away from every creature and from where the hero stands, never on an
   * item, a trap, the camp, the merchant or the Beacon. Failing that, the open tile farthest from
   * any creature.
   */
  private waystoneLanding(): Point {
    const tiles = this.floor.tiles;
    const beacon = this.floor.beacon;
    const living = this.monsters.filter((m) => m.hp > 0);
    const candidates: Point[] = [];
    for (let index = 0; index < MAP_SIZE; index++) {
      if (tiles[index] !== Tile.Floor) continue;
      const p = pointOf(index);
      if (chebyshevDistance(p, this.hero) < WAYSTONE_MIN_JUMP) continue;
      if (isWarded(this.floor, p) || (beacon && samePoint(beacon, p))) continue;
      if (this.items.some((i) => samePoint(i, p)) || this.traps.some((t) => samePoint(t, p)))
        continue;
      if (living.some((m) => samePoint(m, p))) continue;
      candidates.push(p);
    }
    if (candidates.length === 0) return { x: this.hero.x, y: this.hero.y };
    const nearest = (p: Point) =>
      Math.min(Number.POSITIVE_INFINITY, ...living.map((m) => chebyshevDistance(m, p)));
    const safe = candidates.filter((p) => nearest(p) >= WAYSTONE_CLEARANCE);
    if (safe.length > 0) return this.rng.pick(safe);
    return candidates.reduce((best, p) => (nearest(p) > nearest(best) ? p : best));
  }

  /** Swaps the gear in `slot` with what's worn; the old piece goes into the pack. */
  private equip(slot: number, kind: GearKind): boolean {
    const item = kind.id as GearId;
    const previous = this.equipment[kind.category];
    if (item === previous) {
      this.events.push({ type: "already-equipped", item });
      return false;
    }
    const pack = packAdd(packRemoveOne(this.pack, slot), previous, slot);
    if (!pack) {
      this.events.push({ type: "pack-full", item: previous });
      return false;
    }
    this.pack = pack;
    if (kind.category === "weapon") this.equipment.weapon = item as WeaponId;
    else this.equipment.armor = item as ArmorId;
    this.events.push({ type: "equipped", item, slot: kind.category, previous });
    return true;
  }

  private dropItem(slot: number): boolean {
    const entry = this.pack[slot];
    if (!entry) return false;
    const beacon = this.floor.beacon;
    const blocked =
      tileAt(this.floor.tiles, this.hero) !== Tile.Floor ||
      isWarded(this.floor, this.hero) ||
      (beacon !== null && samePoint(beacon, this.hero)) ||
      this.items.some((i) => samePoint(i, this.hero));
    if (blocked) {
      this.events.push({ type: "cannot-drop" });
      return false;
    }
    this.pack = packRemoveOne(this.pack, slot);
    // Turn numbers only grow, so this id is never reused on the floor.
    const loot: FloorItem = {
      id: `${this.run.depth}-d${this.turnNumber}`,
      item: entry.item,
      x: this.hero.x,
      y: this.hero.y,
    };
    this.items = [...this.items, loot];
    this.events.push({
      type: "dropped",
      loot: loot.id,
      item: entry.item,
      at: { x: loot.x, y: loot.y },
    });
    return true;
  }

  /** Sets off a trap where the hero now stands, if there is one. */
  private springTrap(): void {
    const trap = this.traps.find((t) => samePoint(t, this.hero));
    if (!trap) return;
    this.traps = this.traps.filter((t) => t !== trap);
    const hero = this.hero;
    let damage = 0;
    let absorbed = 0;
    let drained = 0;
    const woken: Mutable<Monster>[] = [];
    switch (trap.kind) {
      case "ember-vent":
        // Fire finds the gaps in armor, so only a shield helps.
        damage = trap.power;
        absorbed = Math.min(hero.shield, damage);
        hero.shield -= absorbed;
        hero.hp = Math.max(0, hero.hp - (damage - absorbed));
        break;
      case "gloom-rune":
        drained = Math.min(this.lantern.charge, trap.power);
        this.lantern.charge -= drained;
        break;
      case "alarm-glyph":
        for (const monster of this.monsters) {
          if (monster.hp <= 0 || chebyshevDistance(monster, hero) > trap.power) continue;
          if (!monster.alert) woken.push(monster);
          monster.alert = true;
          monster.lastSeen = { x: hero.x, y: hero.y };
        }
        break;
    }
    this.events.push({
      type: "trap-sprung",
      id: trap.id,
      kind: trap.kind,
      at: { x: trap.x, y: trap.y },
      damage,
      absorbed,
      drained,
      woke: woken.length,
    });
    for (const monster of woken) {
      this.events.push({ type: "monster-noticed", id: monster.id, kind: monster.kind });
    }
    if (trap.kind === "gloom-rune" && this.lantern.bright) {
      this.lantern.bright = false;
      this.events.push({ type: "lantern", bright: false, reason: "doused" });
    }
    if (hero.hp === 0) {
      this.status = "dead";
      this.killedBy = trap.kind;
      this.events.push({ type: "died", by: trap.kind });
    }
  }

  burnLantern(): void {
    this.turnNumber += 1;
    if (!this.lantern.bright) return;
    this.lantern.charge = Math.max(0, this.lantern.charge - BRIGHT_COST);
    if (this.lantern.charge === 0) {
      this.lantern.bright = false;
      this.events.push({ type: "lantern", bright: false, reason: "empty" });
    }
  }

  /** `area` reports the damage separately, for hits that aren't the hero's own blows. */
  private damageMonster(monster: Mutable<Monster>, damage: number, area = false): void {
    if (area) {
      this.events.push({
        type: "monster-hurt",
        id: monster.id,
        kind: monster.kind,
        at: { x: monster.x, y: monster.y },
        damage,
      });
    }
    monster.hp -= damage;
    monster.alert = true;
    monster.lastSeen = { x: this.hero.x, y: this.hero.y };
    if (monster.hp > 0) return;
    const kind = creatureKind(monster.kind);
    const depth = this.run.depth;
    // Spoils are fixed per creature, so they never disturb the gameplay stream.
    const gold = killGold(depth, Rng.derive(this.run.seed, "spoils", monster.id).int(0, 3));
    this.kills += 1;
    this.gold += gold;
    this.events.push({
      type: "monster-died",
      id: monster.id,
      kind: monster.kind,
      at: { x: monster.x, y: monster.y },
      xp: kind.xp,
      gold,
    });
    this.monsters = this.monsters.filter((m) => m !== monster);
    if (kind.guardian) this.leaveHoard(monster);
    this.gainXp(kind.xp);
  }

  /** A fallen guardian's hoard: gold for the purse and a piece of gear from deeper down. */
  private leaveHoard(guardian: Monster): void {
    const depth = this.run.depth;
    const gold = guardianHoard(depth);
    const item = pickGear(
      Rng.derive(this.run.seed, "hoard", guardian.id),
      depth + GUARDIAN_GEAR_LEAD,
    );
    const at = this.freeTileNear(guardian);
    const loot: FloorItem = { id: `${depth}-h`, item, x: at.x, y: at.y };
    this.gold += gold;
    this.items = [...this.items, loot];
    this.events.push({ type: "hoard", kind: guardian.kind, gold, loot: loot.id, item, at });
  }

  /** The nearest open floor tile to `p` with nothing on it (items, traps, wards, the Beacon). */
  private freeTileNear(p: Point): Point {
    const beacon = this.floor.beacon;
    for (let reach = 0; reach <= 6; reach++) {
      for (let y = p.y - reach; y <= p.y + reach; y++) {
        for (let x = p.x - reach; x <= p.x + reach; x++) {
          const q = { x, y };
          if (chebyshevDistance(q, p) !== reach || !inBounds(q)) continue;
          if (tileAt(this.floor.tiles, q) !== Tile.Floor || isWarded(this.floor, q)) continue;
          if (beacon && samePoint(beacon, q)) continue;
          if (this.items.some((i) => samePoint(i, q)) || this.traps.some((t) => samePoint(t, q)))
            continue;
          return q;
        }
      }
    }
    return { x: p.x, y: p.y };
  }

  private gainXp(xp: number): void {
    this.hero.xp += xp;
    while (this.hero.xp >= xpToNextLevel(this.hero.level)) {
      this.hero.xp -= xpToNextLevel(this.hero.level);
      this.hero.level += 1;
      this.hero.maxHp += LEVEL_HP_GAIN;
      this.hero.hp = Math.min(this.hero.maxHp, this.hero.hp + LEVEL_HEAL);
      this.events.push({ type: "leveled-up", level: this.hero.level });
    }
  }

  /** Each creature perceives, then strikes, readies a strike, or moves. Nearest act first. */
  creaturesAct(): void {
    const tiles = this.floor.tiles;
    const offCamp = (index: number) => !isWarded(this.floor, pointOf(index));
    const towardHero = stepDistances(tiles, this.hero, offCamp);
    const order = [...this.monsters].sort(
      (a, b) => chebyshevDistance(a, this.hero) - chebyshevDistance(b, this.hero),
    );

    for (const monster of order) {
      if (this.status !== "active") return;
      const kind = creatureKind(monster.kind);
      if (kind.behavior === "slow" && this.turnNumber % 2 === 1) continue;

      const sees =
        chebyshevDistance(monster, this.hero) <= PERCEPTION_RANGE &&
        hasLineOfSight(tiles, monster, this.hero);
      if (sees) {
        if (!monster.alert)
          this.events.push({ type: "monster-noticed", id: monster.id, kind: monster.kind });
        monster.alert = true;
        monster.lastSeen = { x: this.hero.x, y: this.hero.y };
      }
      if (!monster.alert) continue;

      if (this.canStrike(monster)) {
        if (monster.ready) this.strike(monster);
        else this.ready(monster);
        continue;
      }
      monster.ready = false;

      const target = sees ? null : monster.lastSeen;
      const distances = target ? stepDistances(tiles, target, offCamp) : towardHero;
      const strides = kind.behavior === "swift" ? 2 : 1;
      for (let stride = 0; stride < strides; stride++) {
        const erratic = kind.behavior === "erratic" && this.rng.chance(0.5);
        if (!this.stepMonster(monster, distances, erratic)) break;
        if (this.canStrike(monster)) {
          this.ready(monster);
          break;
        }
      }

      // Reached the last place it saw the hero without finding them: it gives up the hunt.
      if (!sees && monster.lastSeen && samePoint(monster, monster.lastSeen)) {
        monster.alert = false;
        monster.lastSeen = null;
      }
    }
  }

  private ready(monster: Mutable<Monster>): void {
    monster.ready = true;
    this.events.push({ type: "monster-readied", id: monster.id, kind: monster.kind });
  }

  /** Adjacent (no squeezing past corners), or for ranged creatures, a clear straight or diagonal line. */
  private canStrike(monster: Monster): boolean {
    if (isWarded(this.floor, this.hero)) return false;
    const distance = chebyshevDistance(monster, this.hero);
    const direction = directionFromDelta(this.hero.x - monster.x, this.hero.y - monster.y);
    if (!direction) return false;
    if (distance === 1) return canStep(this.floor.tiles, monster, direction);
    if (creatureKind(monster.kind).behavior !== "ranged" || distance > RANGED_REACH) return false;
    const dx = Math.abs(this.hero.x - monster.x);
    const dy = Math.abs(this.hero.y - monster.y);
    const inLine = dx === 0 || dy === 0 || dx === dy;
    return inLine && hasLineOfSight(this.floor.tiles, monster, this.hero);
  }

  private strike(monster: Mutable<Monster>): void {
    const defense = heroDefense(gearPower(this.equipment.armor));
    const damage = creatureHit(monster.attack, defense, this.rng.int(0, CREATURE_HIT_SPREAD));
    const absorbed = Math.min(this.hero.shield, damage);
    this.hero.shield -= absorbed;
    this.hero.hp = Math.max(0, this.hero.hp - (damage - absorbed));
    this.faceToward(monster, this.hero);
    this.events.push({
      type: "monster-struck",
      id: monster.id,
      kind: monster.kind,
      from: { x: monster.x, y: monster.y },
      ranged: chebyshevDistance(monster, this.hero) > 1,
      damage,
      absorbed,
    });
    if (this.hero.hp === 0) {
      this.status = "dead";
      this.killedBy = monster.kind;
      this.events.push({ type: "died", by: monster.kind });
    }
  }

  /** One step closer along `distances`, or (when erratic) a random open step. */
  private stepMonster(
    monster: Mutable<Monster>,
    distances: readonly number[],
    erratic: boolean,
  ): boolean {
    const here = distances[indexOf(monster)] ?? -1;
    const options = DIRECTIONS.filter((direction) => {
      if (!canStep(this.floor.tiles, monster, direction)) return false;
      const to = step(monster, direction);
      if (isWarded(this.floor, to)) return false;
      return !samePoint(to, this.hero) && !this.monsterAt(to);
    });
    if (options.length === 0) return false;

    let choice: Direction | undefined;
    if (erratic) {
      choice = this.rng.pick(options);
    } else {
      // Shortest route first; among equals, whichever ends up physically closest to the hero.
      let best = here < 0 ? Number.POSITIVE_INFINITY : here;
      let bestReach = Number.POSITIVE_INFINITY;
      for (const direction of options) {
        const to = step(monster, direction);
        const distance = distances[indexOf(to)] ?? -1;
        if (distance < 0) continue;
        const reach = Math.hypot(to.x - this.hero.x, to.y - this.hero.y);
        if (distance < best || (distance === best && choice !== undefined && reach < bestReach)) {
          best = distance;
          bestReach = reach;
          choice = direction;
        }
      }
    }
    if (!choice) return false;
    const from = { x: monster.x, y: monster.y };
    const to = step(monster, choice);
    monster.x = to.x;
    monster.y = to.y;
    this.faceToward(monster, this.hero);
    this.events.push({ type: "monster-moved", id: monster.id, from, to });
    return true;
  }

  private faceToward(monster: Mutable<Monster>, target: Point): void {
    if (target.x !== monster.x) monster.facing = target.x > monster.x ? "right" : "left";
  }

  private monsterAt(point: Point): Mutable<Monster> | undefined {
    return this.monsters.find((m) => m.hp > 0 && samePoint(m, point));
  }

  finish(): RunState {
    const hero: Hero = { ...this.hero };
    const seen = look(
      {
        ...this.floor,
        monsters: this.monsters,
        campUsed: this.campUsed,
        items: this.items,
        traps: this.traps,
        explored: this.explored,
        stock: this.stock,
      },
      hero,
      this.lantern,
      this.run.discovered,
      this.events,
    );
    return {
      ...this.run,
      turn: this.turnNumber,
      hero,
      lantern: { ...this.lantern },
      equipment: { ...this.equipment },
      pack: this.pack,
      gold: this.gold,
      floors: replaceFloor(this.run.floors, seen.floor),
      rng: this.rng.state(),
      kills: this.kills,
      discovered: seen.discovered,
      status: this.status,
      killedBy: this.killedBy,
    };
  }
}

/** What a supply cache holds: fixed per cache, so opening it later never changes the find. */
function cacheContents(seed: number, depth: number, cache: FloorItem): SupplyId {
  return pickSupply(Rng.derive(seed, "cache", cache.id), depth);
}

/** Taking the stairs: creatures don't get a turn, and the arrival floor is generated if new. */
function takeStairs(run: RunState): ActionResult {
  const interaction = availableInteraction(run);
  if (!interaction || (interaction.kind !== "descend" && interaction.kind !== "ascend")) {
    return { run, events: [{ type: "no-stairs" }], tookTurn: false };
  }
  if (interaction.sealedBy) {
    return { run, events: [{ type: "stairs-sealed", by: interaction.sealedBy }], tookTurn: false };
  }

  const toDepth = interaction.toDepth;
  const existing = run.floors.find((f) => f.depth === toDepth);
  const target = existing ?? generateFloor(run.seed, toDepth);
  // Going down lands on the next floor's up stairs; going up lands on the previous floor's down stairs.
  const arrival = interaction.kind === "descend" ? target.entrance : target.downStairs;
  if (!arrival) throw new Error(`Floor ${toDepth} has no stairs to arrive on.`);

  const events: GameEvent[] = [{ type: "changed-floor", from: run.depth, to: toDepth }];
  const hero: Hero = { ...run.hero, x: arrival.x, y: arrival.y };
  let lantern = run.lantern;
  if (lantern.bright) {
    const charge = Math.max(0, lantern.charge - BRIGHT_COST);
    lantern = { charge, bright: charge > 0 };
    if (charge === 0) events.push({ type: "lantern", bright: false, reason: "empty" });
  }
  const seen = look(target, hero, lantern, run.discovered, events);
  const floors = existing ? replaceFloor(run.floors, seen.floor) : [...run.floors, seen.floor];
  return {
    run: {
      ...run,
      turn: run.turn + 1,
      depth: toDepth,
      hero,
      lantern,
      floors,
      discovered: seen.discovered,
    },
    events,
    tookTurn: true,
  };
}

function replaceFloor(floors: readonly Floor[], floor: Floor): Floor[] {
  return floors.map((f) => (f.depth === floor.depth ? floor : f));
}

/**
 * What the hero takes in after an action: tiles now in view become explored, bright light shows
 * nearby traps, and creature kinds seen for the first time join `known`. Reports finds in `events`.
 * Returns the same floor object if nothing changed.
 */
function look(
  floor: Floor,
  hero: Point,
  lantern: Lantern,
  known: readonly CreatureId[],
  events: GameEvent[],
): { floor: Floor; discovered: CreatureId[] } {
  const visible = computeVisible(floor.tiles, hero, sightRadius(lantern));
  let seen = floor;

  if ([...visible].some((index) => !floor.explored[index])) {
    const explored = floor.explored.slice();
    for (const index of visible) explored[index] = true;
    seen = { ...seen, explored };
  }

  if (lantern.bright) {
    const spotted = floor.traps.filter(
      (t) => !t.found && chebyshevDistance(t, hero) <= TRAP_SPOT_RANGE && visible.has(indexOf(t)),
    );
    if (spotted.length > 0) {
      seen = {
        ...seen,
        traps: floor.traps.map((t) => (spotted.includes(t) ? { ...t, found: true } : t)),
      };
      for (const trap of spotted) {
        events.push({
          type: "trap-found",
          id: trap.id,
          kind: trap.kind,
          at: { x: trap.x, y: trap.y },
        });
      }
    }
  }

  const discovered = [...known];
  for (const monster of floor.monsters) {
    if (visible.has(indexOf(monster)) && !discovered.includes(monster.kind)) {
      discovered.push(monster.kind);
      events.push({ type: "spotted", kind: monster.kind });
    }
  }
  return { floor: seen, discovered };
}

/** Whether the hero has seen this tile on the current floor; used to limit click-to-walk routes. */
export function isExplored(run: RunState, p: Point): boolean {
  return currentFloor(run).explored[indexOf(p)] === true;
}

/** The creature standing on a tile of the current floor, if any. */
export function monsterAt(run: RunState, p: Point): Monster | undefined {
  return currentFloor(run).monsters.find((m) => samePoint(m, p));
}

/** The item lying on a tile of the current floor, if any. */
export function itemAt(run: RunState, p: Point): FloorItem | undefined {
  return currentFloor(run).items.find((item) => samePoint(item, p));
}

/** A trap the hero has found on a tile of the current floor. Hidden traps stay hidden. */
export function knownTrapAt(run: RunState, p: Point): Trap | undefined {
  return currentFloor(run).traps.find((t) => t.found && samePoint(t, p));
}

/**
 * The route a click-to-walk takes: over explored ground, around creatures and known traps (unless
 * one of them is the destination).
 */
export function walkRoute(floor: Floor, from: Point, to: Point): Direction[] | null {
  const goal = indexOf(to);
  const avoid = new Set([
    ...floor.monsters.map((m) => indexOf(m)),
    ...floor.traps.filter((t) => t.found).map((t) => indexOf(t)),
  ]);
  return findPath(
    floor.tiles,
    from,
    to,
    (index) => floor.explored[index] === true && (!avoid.has(index) || index === goal),
  );
}
