# Embercrawl development guide

How every mechanism in Embercrawl works, where it lives in the code, and how to change it safely.
Written for version 0.9.0 (milestone 6, the beta). `docs/PLAN.md` says *what* we're building and why; this
guide says *how it works now*. Update both when a mechanic changes.

## Contents

1. [How to use this guide](#1-how-to-use-this-guide)
2. [The big picture](#2-the-big-picture)
3. [Turns, randomness and determinism](#3-turns-randomness-and-determinism)
4. [Floor generation](#4-floor-generation)
5. [The hero: health, levels and combat](#5-the-hero-health-levels-and-combat)
6. [The lantern and sight](#6-the-lantern-and-sight)
7. [Creatures](#7-creatures)
8. [Camps](#8-camps)
9. [Items, the pack, gold and merchants](#9-items-the-pack-gold-and-merchants)
10. [Traps](#10-traps)
11. [Guardians, the Beacon, death and records](#11-guardians-the-beacon-death-and-records)
12. [Saves](#12-saves)
13. [Presentation: palettes, animation and art](#13-presentation-palettes-animation-and-art)
14. [Controls](#14-controls)
15. [Tuning cookbook](#15-tuning-cookbook)
16. [Testing and tools](#16-testing-and-tools)
17. [How the game was built](#17-how-the-game-was-built)
18. [Not built yet](#18-not-built-yet)

---

## 1. How to use this guide

- **To change a number** (how hard creatures hit, how much a salve heals): find it in the tables
  below, open the file named next to it, change it, then run `pnpm check`. Most numbers live in
  `src/engine/rules.ts`; creature stats in `src/engine/creatures.ts`; item stats in
  `src/engine/items.ts`.
- **To add something** (a creature, item, trap or palette): follow the recipe in
  [section 15](#15-tuning-cookbook).
- **To understand why a rule works the way it does**, read its section; design reasons are noted
  where they matter.

Terms used throughout:

| Term | Meaning |
|---|---|
| Tile | One square of the map. Each floor is 32 × 16 tiles. |
| Chebyshev distance | "King's move" distance: diagonals count as 1. Used for reach, movement and area effects. |
| Euclidean distance | Straight-line distance. Used only for how far light reaches, so the lit area looks round. |
| Turn | One player action that "takes time". Creatures act after each one. |
| Run / descent | One attempt from floor 1 downward. A character can have many over its life. |
| Engine | `src/engine`: the pure rules. It never draws anything. |
| View | `src/renderer/src/render/dungeon/DungeonView.ts`: draws and animates what the engine decided. |

---

## 2. The big picture

```text
 keyboard / mouse
       │  an Action, e.g. { type: "move", direction: "ne" }
       ▼
 useCharacterSession.act()  ──►  engine applyAction(run, action)
                                     │ returns { run (new state), events (what happened), tookTurn }
             ┌───────────────────────┼─────────────────────────────┐
             ▼                       ▼                             ▼
 DungeonView.handleEvents     React HUD re-renders          save written to disk
 (animates the events)        (meters, log, pack)           (every turn)
```

Three ideas hold the whole game together:

1. **The engine is pure.** `src/engine` takes the current state and an action and returns a new
   state plus a list of *events*. It has no graphics, no clock and no `Math.random()`. That makes
   every rule testable and every game reproducible: same seed + same actions = same game.
2. **Rules resolve instantly; animation catches up.** When you press a key the whole turn
   (your move, every creature's reaction) is already decided. The view then plays the events as
   short animations. If you press keys quickly, animations speed up to catch up instead of making
   you wait (`StepQueue` in `render/dungeon/motion.ts`).
3. **State is immutable.** `applyAction` never modifies the run it is given; it builds a new one.
   Tests freeze the old state to prove it.

Where the important code lives:

| Area | File |
|---|---|
| All balance numbers and formulas | `src/engine/rules.ts` |
| Turn logic, actions, events, combat, items, traps | `src/engine/run.ts` |
| Floor generation | `src/engine/generate.ts` |
| Creature roster | `src/engine/creatures.ts` |
| Item and trap catalog | `src/engine/items.ts` |
| Pack (inventory) helpers | `src/engine/pack.ts` |
| Map, tiles, diagonal rule | `src/engine/map.ts` |
| Sight and line of sight | `src/engine/sight.ts` |
| Pathfinding | `src/engine/path.ts` |
| Seeded random numbers | `src/engine/rng.ts` |
| Save format and upgrades | `src/engine/save.ts` |
| Message log wording | `src/renderer/src/game/messages.ts` |
| Tooltip and item wording | `src/renderer/src/game/itemText.ts` |
| The balance bot | `src/bot/bot.ts` (run with `scripts/balance.mts`) |
| Keys | `src/renderer/src/input/useGameKeys.ts` |
| Walking speed and key repeat | `src/renderer/src/game/timing.ts` |

---

## 3. Turns, randomness and determinism

### What happens in one turn (`applyAction` in `run.ts`)

1. **The hero acts.** Move, attack (moving into a creature), wait, rest, toggle the lantern,
   pulse, pick up, use or equip an item, drop an item, buy, sell, or rekindle the Beacon.
   - If the action couldn't happen (walking into a wall, a wasted salve, nothing to pick up), the
     game returns the *same* state with `tookTurn: false`. No time passes; creatures don't act.
   - After a step onto a new tile: a hidden or known **trap** there springs, then any **item**
     there is picked up (gold goes straight into the purse).
2. **The lantern burns.** The turn counter goes up by one; bright light costs 1 charge.
3. **Creatures act**, nearest first (see [section 7](#7-creatures)).
4. **The hero looks around** (`look` in `run.ts`): newly visible tiles become explored, bright
   light reveals nearby traps, and creature kinds seen for the first time join the bestiary.

**Stairs are special:** using stairs takes a turn but creatures don't act, and the hero arrives on
the matching stairs of the next floor (floors are generated the first time you reach them and kept
afterwards).

### Two kinds of randomness

| Stream | Made from | Used for | Stored? |
|---|---|---|---|
| **Floor stream** | `Rng.derive(seed, "floor", depth)` | Layout, stairs, camp, creatures, items, traps | No: regenerated from the seed |
| **Gameplay stream** | `Rng.derive(seed, "play")`, then carried in `run.rng` | Hit rolls, erratic steps, Waystone landing | Yes, in the save |
| Cache contents | `Rng.derive(seed, "cache", cacheId)` | What a supply cache holds | No: fixed per cache |
| Spoils | `Rng.derive(seed, "spoils", creatureId)` | Gold a creature drops | No: fixed per creature |
| Hoards | `Rng.derive(seed, "hoard", guardianId)` | The gear a guardian leaves | No: fixed per guardian |
| Palettes | `Rng.derive(seed, "palette", group)` | Which colors a group of floors uses | No |

Because each floor has its own stream, a floor comes out identical no matter when you reach it.
Cosmetic effects (sparks, motes, flicker) use `Math.random()` in the renderer; they never affect
the game.

> **Ordering rule:** inside a floor's generation, things are drawn in a fixed order: layout,
> stairs, camp, creatures, items, traps, gold piles, the merchant (and stock), the Beacon. New content must always be drawn *after* existing
> content, or every existing seed's floors would change.

---

## 4. Floor generation

File: `src/engine/generate.ts`. Constants at the top of the file; counts in `rules.ts`.

### Layout

1. The 32 × 16 map is split into a **4 × 2 grid of 8 × 8 cells**.
2. 0–2 random cells become single-tile **junctions**; the rest get a **room** 3–6 wide and 3–5 tall,
   kept one tile inside its cell so rooms never merge.
3. Cells are connected by a **random spanning tree** (everything is reachable), plus each unused
   neighbor link has a **30% chance** (`EXTRA_LINK_CHANCE`) of an extra corridor, creating loops.
4. Corridors are **L-shaped** between random points in the two areas.

### Placement

| Thing | Rule |
|---|---|
| Entrance | A random room tile. On floors 2+ it holds the up stairs. |
| Down stairs | A room tile at least **70%** of the farthest walking distance from the entrance (`STAIRS_FAR_SHARE`). None on floor 30. |
| Camp | A room tile between **30% and 70%** of the farthest walking distance (`CAMP_DISTANCE_SHARE`). |
| Creatures | On plain floor more than **6 steps** from the entrance (`SPAWN_CLEARANCE`). See [section 7](#7-creatures). |
| Items | On plain floor not used by anything else, spread apart where possible. See [section 9](#9-items-the-pack-gold-and-merchants). |
| Traps | On plain floor more than **3 steps** from the entrance (`TRAP_CLEARANCE`). See [section 10](#10-traps). |
| Gold piles | On free plain floor. See [section 9](#9-items-the-pack-gold-and-merchants). |
| Merchant | Floors 3, 6, … 27: a free room tile between **25% and 80%** of the farthest walking distance (`MERCHANT_DISTANCE_SHARE`). |
| Beacon | Floor 30 only: a free room tile at least **70%** of the farthest walking distance. |

Items, gold, traps, creatures, the camp, the merchant, the Beacon and stairs never share a starting tile.

---

## 5. The hero: health, levels and combat

Numbers: `src/engine/rules.ts`.

### Health and levels

| Setting | Value | Constant |
|---|---|---|
| Starting health | 30 | `HERO_START_HP` |
| Max health per level | +5 | `LEVEL_HP_GAIN` |
| Healing on level-up | +10 (capped at max) | `LEVEL_HEAL` |
| XP to go from level L to L+1 | 20 + 22(L−1) + 3(L−1)² | `xpToNextLevel` |

XP needed: level 1→2: 20, 2→3: 45, 3→4: 76, 4→5: 113, 5→6: 156. XP is spent when you level, and
each creature gives its catalog XP regardless of floor. There is no passive healing.

### Your blows

```text
attack power = 2 + floor(level ÷ 2) + weapon power
one blow     = attack power + random 0–2            (HERO_HIT_SPREAD)
```

Level 1 with the Weathered Knife (+3): attack 5, blows of 5–7.

### Creature blows

```text
one blow = max(1, creature attack + random 0–1 − your defense)     (CREATURE_HIT_SPREAD)
defense  = armor power
```

A shield (from a Ward Sigil or a pulse) absorbs damage before health and stacks. Armor matters a
lot at low numbers: cutting a 3-damage blow to 2 removes a third of the damage.

### Telegraphed strikes

A creature that gets in reach first **readies** (a red marker appears), and **strikes on its next
turn** only if you're still in reach. Stepping out of reach makes it lose the strike. This is the
core of tactical play: you always get one turn of warning.

---

## 6. The lantern and sight

| Setting | Value | Constant |
|---|---|---|
| Dim sight radius | 4 | `DIM_SIGHT` |
| Bright sight radius | 6 | `BRIGHT_SIGHT` |
| Max charge | 100 | `LANTERN_MAX` |
| Bright cost | 1 charge per turn (including stairs) | `BRIGHT_COST` |
| Pulse cost | 20 charge | `PULSE_COST` |
| Pulse reach | 2 tiles (Chebyshev), clear line of sight needed | `PULSE_RADIUS` |
| Pulse damage | attack power + 4 to each creature in reach | `PULSE_BONUS_DAMAGE` |
| Pulse shield | +4 | `PULSE_SHIELD` |
| Traps shown by bright light | within 2 tiles | `TRAP_SPOT_RANGE` |

When charge hits 0, bright light switches off by itself. Charge comes back only from camps and
Ember Shards.

**Sight** (`sight.ts`): a tile is visible if it's within the radius (round, Euclidean, using
radius + 0.5) and the line to it is clear. **Line of sight is symmetric**: it's checked in both
directions, so if you can see a creature, it can see you. A diagonal line squeezing between two
walls that touch at a corner is blocked, matching the movement rule.

**Explored vs visible:** tiles you've ever seen are *explored* (drawn in a cool, dim tint and
remembered when you return); tiles in view *now* are *visible* (lit by the lantern). Click-to-walk
only routes over explored tiles.

---

## 7. Creatures

File: `src/engine/creatures.ts` (stats), behavior in `creaturesAct` in `run.ts`.

### How many and which

```text
regular creatures per floor = min(17, 7 + floor(0.35 × floor number))     (creatureCount)
```

A floor draws from creatures whose first floor is within the last **10 floors**
(`CREATURE_LIFESPAN`). Those introduced in the last **3 floors** are **3× as likely**
(`NEW_CREATURE_WINDOW`). Guardian floors (10, 20, 30) add their guardian far from the entrance
(at least 80% of the farthest distance).

### Scaling with depth (`scaledStats` in `rules.ts`)

```text
steps   = floor − creature's first floor
health  = round(base health × (1 + 0.105 × steps) × variance)  variance 0.90–1.15 (guardians 1.0)
attack  = round((base attack + floor(steps ÷ 3)) × (1.02 + 0 × floor))
```

The three numbers are the balance bot's main dials (see [section 16](#16-testing-and-tools)):
`CREATURE_HP_PER_FLOOR` (0.105), `CREATURE_ATTACK_BASE` (1.02) and `CREATURE_ATTACK_PER_FLOOR`
(0, an unused dial that makes attack grow with depth). Attack is a coarse dial: because attacks
are rounded, a change of 0.01 can push many creatures up a whole point at once (1.02 gave the bot
51% wins, 1.03 only 17%). Health is the finer dial.

### Behaviors

| Behavior | What it does |
|---|---|
| Chase | Closes in by the shortest route. |
| Slow | Acts only on even turns. |
| Ranged | Can strike from up to **4 tiles** (`RANGED_REACH`) along a row, column or diagonal with a clear line. |
| Erratic | Each step has a **50%** chance to go in a random open direction. |
| Swift | Takes **two steps** a turn while closing in. |

### What each creature does on its turn

1. **Perceive:** it notices you if you're within **7 tiles** (`PERCEPTION_RANGE`) and in clear
   view. Once alert, it remembers where it last saw you.
2. **Strike or ready:** if you're in reach, it strikes if it was readied, otherwise it readies.
   Nobody can strike you while you stand on a camp.
3. **Move:** otherwise it steps toward you (or toward where it last saw you), never onto the camp.
   If it reaches that spot without finding you, it gives up and goes back to idling.

Creatures move with real pathfinding, diagonals included, and follow the same corner rule as you.
They never set off traps.

### Roster (base stats, before depth scaling)

The last few creatures' attacks were lowered in milestone 5 (Star Eater 19→18, Cinder Oracle
19→16, Ruin Colossus 25→21, Null Shade 23→20): they jumped far above the best armor and made
floors 26–30 a wall that ended almost every run.

| Creature | Floor | Health | Attack | XP | Behavior |
|---|---:|---:|---:|---:|---|
| Cinder Mite | 1 | 9 | 4 | 6 | Chase |
| Dust Skitter | 1 | 8 | 4 | 5 | Erratic |
| Moss Jaw | 2 | 15 | 6 | 11 | Slow |
| Shardling | 3 | 11 | 6 | 13 | Chase |
| Gloom Moth | 4 | 12 | 5 | 15 | Ranged |
| Bog Lurcher | 5 | 22 | 7 | 17 | Erratic |
| Coil Stalker | 6 | 22 | 8 | 20 | Chase |
| Lantern Leech | 7 | 17 | 8 | 21 | Swift |
| Iron Husk | 8 | 33 | 10 | 27 | Slow |
| Ash Weaver | 9 | 24 | 9 | 29 | Ranged |
| **Chain Sexton** (guardian) | 10 | 72 | 12 | 90 | Slow |
| Rime Crawler | 11 | 30 | 10 | 32 | Chase |
| Hollow Cantor | 12 | 26 | 10 | 34 | Ranged |
| Gear Hound | 13 | 28 | 11 | 36 | Swift |
| Salt Wraith | 14 | 33 | 13 | 38 | Erratic |
| Basalt Brute | 15 | 54 | 17 | 46 | Slow |
| Prism Eye | 17 | 35 | 14 | 48 | Ranged |
| Thorn Matron | 18 | 48 | 16 | 50 | Chase |
| **Orrery Knight** (guardian) | 20 | 150 | 21 | 180 | Slow |
| Void Tick | 21 | 40 | 17 | 52 | Swift |
| Star Eater | 22 | 58 | 18 | 58 | Chase |
| Cinder Oracle | 24 | 46 | 16 | 62 | Ranged |
| Ruin Colossus | 25 | 88 | 21 | 72 | Slow |
| Null Shade | 27 | 54 | 20 | 74 | Erratic |
| **Beacon Warden** (guardian) | 30 | 260 | 28 | 320 | Slow |

---

## 8. Camps

One per floor. Creatures can't step onto a camp or strike someone standing on it, forever. Resting
there (Enter) works **once per floor** and restores:

```text
health = min(missing health, ceil(max health × 0.75))     (CAMP_HEAL_SHARE)
charge = min(missing charge, 30)                          (CAMP_CHARGE)
```

---

## 9. Items, the pack, gold and merchants

Catalog: `src/engine/items.ts`. How often things appear: `rules.ts`. Use, equip, drop and pick-up
logic: `run.ts`.

### Supplies

| Supply | Effect | Appears |
|---|---|---|
| Salve | Heals up to 16 | Every floor |
| Deep Salve | Heals up to 40 | Floor 10+ |
| Ember Shard | +40 lantern charge | Every floor |
| Ward Sigil | +12 shield (stacks) | Every floor |
| Vigor Draught | +6 max health and +6 health | Floor 7+ |
| Waystone | Teleports you to a random open tile at least 5 tiles from every creature and 4 from where you stood (never onto an item, trap or camp) | Every floor |
| Survey Lens | Marks the whole floor explored and reveals every trap | Every floor |
| Flare Flask | 16 damage to every creature in view within 3 tiles | Floor 5+ |

A supply that would be wasted is refused and **no turn passes**: a heal at full health, a shard
with a full lantern, or a flare with nothing in reach.

**Random supply weights** (`supplyWeight`): relative chances, so a weight of 4 is twice as likely
as 2.

| Supply | Floors 1–9 | 10–19 | 20–30 |
|---|---:|---:|---:|
| Salve | 4 | 3 | 2 |
| Deep Salve | 0 | 3 | 4 |
| Ember Shard | 3 | 2 | 2 |
| Ward Sigil | 1.5 (floors 1–2), 2.5 after | 2.5 | 2.5 |
| Waystone | 1 | 1 | 1 |
| Survey Lens | 1 | 1 | 1 |
| Flare Flask | 2 from floor 5 | 2 | 2 |
| Vigor Draught | 0.6 from floor 7 | 0.6 | 0.6 |

### What each floor holds

| Contents | Rule | Function |
|---|---|---|
| Random supplies | 1 + (1 on odd floors) + (1 from floor 15) + (1 from floor 22) | `supplyCount` |
| Guaranteed healing | A Salve on floors 4–9; a Deep Salve on floors 10–30 | `recoverySupply` |
| Supply cache | Odd floors, and every floor from 15 | `hasCache` |
| Gear | One piece on every floor from 2 | `GEAR_FIRST_FLOOR` |
| Welcome salve | Floor 1 only, beside the entrance | `placeItems` |

A **supply cache** opens into one supply, chosen with the same weights as random supplies. Its
contents are fixed when the run starts (they don't depend on when you open it) and are never shown
before opening.

### Weapons and armor

| Weapon | Attack | From floor | | Armor | Defense | From floor |
|---|---:|---:|---|---|---:|---:|
| Weathered Knife (start) | +3 | — | | Traveler's Coat (start) | 1 | — |
| Iron Cleaver | +5 | 2 | | Padded Jerkin | 2 | 2 |
| Glass Spear | +7 | 4 | | Ring Mail | 3 | 4 |
| Surveyor's Pick | +9 | 7 | | Scale Hauberk | 5 | 7 |
| Rime Sabre | +11 | 10 | | Obsidian Plate | 7 | 10 |
| Gearbreaker Maul | +13 | 13 | | Orrery Brigandine | 9 | 14 |
| Prism Glaive | +15 | 16 | | Starwoven Mail | 11 | 18 |
| Starsteel Halberd | +17 | 19 | | Void Carapace | 13 | 22 |
| Null Edge | +19 | 22 | | Beacon Aegis | 15 | 26 |
| Beacon Blade | +22 | 26 | | | | |

**Which gear a floor gets** (`pickGear`, `gearWeight`):

- Even floors give a weapon 80% of the time, odd floors armor 80% (`GEAR_SLOT_BIAS`).
- Eligible pieces: those whose "from floor" is between 8 floors back and 1 floor ahead
  (3 ahead on guardian floors 10, 20, 30).
- Weights: from the last 3 floors (or this one) **3**; older **1**; from the future **0.6**.
- Finding gear doesn't equip it. It may not be an upgrade, so check the comparison.

### The pack

| Setting | Value | Constant |
|---|---|---|
| Slots | 10 | `PACK_SLOTS` |
| Stack size | 9 identical items | `STACK_LIMIT` |

- Walking onto an item picks it up automatically. If the pack is full, the item stays and the
  Enter prompt offers to pick it up later.
- Slots are fixed positions, so each item keeps its number key. A new item stacks onto a matching
  stack with room, otherwise goes in the first empty slot.
- **Equipping** swaps: the old piece goes into the slot the new one came from. Refused if there's
  nowhere to put the old piece.
- **Dropping** puts one item on your tile; not on stairs, the camp, or a tile that already has an
  item.
- Using, equipping and dropping each take a turn, so creatures get to respond.

### Gold

| Source | Amount | Function |
|---|---|---|
| Gold piles per floor | 3 + floor(floor ÷ 6) | `goldPileCount` |
| Coins in a pile | (3 + floor) to (8 + 2 × floor) | `goldPileRange` |
| Each creature slain | 1 + random 0–3 + floor(floor ÷ 3), fixed per creature | `killGold` |
| A guardian's hoard | 40 + 8 × floor, plus a piece of gear from 3 floors ahead | `guardianHoard`, `GUARDIAN_GEAR_LEAD` |

Gold goes straight into the purse (`run.gold`), never the pack, so a full pack never blocks it.

### Merchants

- A merchant keeps a **stall on floors 3, 6, 9 … 27** (`hasMerchant`). The stall is **warded**
  like a camp: creatures can't step on it or strike someone standing there.
- **Stock**, fixed when the floor is made: 4 different supplies, 1–3 of each (chosen with the
  floor's supply weights), plus one weapon and one armor from **2 floors ahead**
  (`SHOP_SUPPLY_OFFERS`, `SHOP_SUPPLY_STOCK`, `SHOP_GEAR_LEAD`).
- **Prices:** an item's base price rises **8% per floor** (`priceAt`). Supplies have their own
  base price in `items.ts` (Salve 25, Deep Salve 60, Ember Shard 30, Ward Sigil 35, Waystone 40,
  Survey Lens 30, Flare Flask 45, Vigor Draught 110); weapons and armor cost
  **50 + 30 × the floor they start appearing on** (`gearPrice`).
- **Selling:** merchants pay **40%** of an item's base price (`SELL_SHARE`, `sellPrice`), with no
  depth rise. Worn gear can't be sold; swap it into the pack first.
- Buying needs the gold and room in the pack. Each buy or sale takes a turn (safe on the stall).
- Stand on the stall and press Enter to open the merchant's panel (`ShopPanel.tsx`).

---

## 10. Traps

Catalog: `TRAPS` in `items.ts`. Counts and strength: `rules.ts`. Effects: `springTrap` in `run.ts`.

| Trap | From floor | Weight | Strength (`trapPower`) | Effect |
|---|---:|---:|---|---|
| Ember Vent | 2 | 3 | 3–5 + floor(floor ÷ 2) damage | Burns. **Armor doesn't reduce it**; a shield absorbs it. Can kill. |
| Alarm Glyph | 3 | 1.5 | 8 tiles | Wakes every creature within 8 tiles (through walls) and tells them where you are. |
| Gloom Rune | 5 | 1.5 | 25 + floor number charge | Drains the lantern and switches off bright light. |

```text
traps per floor = 0 on floor 1, otherwise min(5, 1 + floor(floor number ÷ 7))     (trapCount)
```

- Traps are **hidden** until found. **Bright light** finds those within 2 tiles in view; dim light
  finds none. A **Survey Lens** reveals all of them. This is an Embercrawl design choice (not from
  Emberdepths) to make the lantern matter while exploring.
- Each trap springs **once** when you step on it, then is gone.
- Found traps are drawn on the floor, explained by tooltips, and avoided by click-to-walk (unless
  you click the trap itself). Walking onto a found trap with the keyboard still springs it.
- Creatures never set traps off.
- **The UI must never reveal a hidden trap** (only `knownTrapAt` is used for display).

---

## 11. Guardians, the Beacon, death and records

### Guardians and the Beacon

- Floors 10 and 20 each have a **guardian** (Chain Sexton, Orrery Knight). While it lives, the
  **stairs down are sealed** (`livingGuardian`, the `sealedBy` field of the stairs prompt).
- A slain guardian leaves a **hoard**: gold (see [section 9](#9-items-the-pack-gold-and-merchants))
  and a piece of gear from 3 floors ahead, dropped where it fell (or the nearest free tile).
- Floor 30 has no stairs down. Its far end holds **the Beacon**, guarded by the **Beacon Warden**.
  Once the Warden has fallen, standing on the Beacon and pressing Enter **rekindles** it: the
  descent is won (`status: "won"`), the victory screen appears, and the character's record counts
  the win.

### Death and records

- Health 0 ends the descent (`status: "dead"`, with `killedBy` naming the creature or trap). The
  death screen appears after a short pause so the fall animation plays.
- **The character survives.** Each character keeps a record across descents: descents started,
  deepest floor, deaths, wins and the bestiary (every creature kind ever seen). "Begin a new descent"
  starts a fresh run from floor 1 with a new seed and the starting gear.
- Multiple characters, each in its own save file, are listed on the title screen. The first one
  ("Wanderer") is created automatically.

### Run history and achievements

Files: `src/engine/achievements.ts` (the list), `src/engine/save.ts` (`updateCharacter`),
`src/renderer/src/screens/Records.tsx` (the Records screen).

- Each descent keeps **tallies** in `run.stats`: gold spent, rests, traps found and sprung,
  supplies used, turns with the lantern bright, and guardians defeated.
- When a descent ends (death or victory), the record gains a **history entry**: date, result,
  seed, floor, level, turns, kills, gold and what killed the hero. The newest 50 are kept
  (`HISTORY_LIMIT`).
- **Achievements** are checked after every turn. Each one is a test of the run and the bestiary;
  once earned it stays earned, with the date. A notice appears at the top of the screen and in the
  message log. There are 18:

| Achievement | Earned by |
|---|---|
| First Blood | Slay a creature |
| Hundred Fallen | Slay 100 creatures in one descent |
| Into the Deep / Far Below / The Bottom | Reach floor 10 / 20 / 30 |
| Bell Unrung / Clockwork Stilled | Defeat the Chain Sexton (floor 10) / the Orrery Knight (floor 20) |
| Keeper of the Beacon | Rekindle the Beacon |
| No Rest for the Bold | Rekindle the Beacon without resting at a camp |
| By Dim Light | Reach floor 10 without turning the lantern bright |
| Seasoned / Veteran | Reach level 10 / 20 |
| Keen Eyes | Find 10 hidden traps in one descent |
| Good Customer | Spend 500 gold at merchants in one descent |
| Full Purse | Carry 1,000 gold |
| Well Provisioned | Fill every pack slot |
| Star-Forged | Wield the Beacon Blade or wear the Beacon Aegis |
| Naturalist | See every kind of creature |

To add one: add an entry to `ACHIEVEMENTS` with a test in `tests/engine/records.test.ts`. Its id
is stored in saves, so never rename or reuse an id. If it needs a new tally, add the field to
`RunStats` (a save-format change: see below).

The **Records** screen (title screen: Manage > Records; in the game: Esc > Records) shows the
totals, every achievement (earned ones lit, with the date) and the history table.

---

## 12. Saves

File: `src/engine/save.ts` (format), `src/main/save-store.ts` (writing files).

- One JSON file per character: `%APPDATA%\Embercrawl\Saves\<id>.embercrawl` (development builds
  use `Embercrawl Dev`). The browser preview uses `localStorage`.
- Saved **after every turn**. Writes are atomic (write a temporary file, then rename), so a crash
  can't leave half a file.
- Every file is checked with a schema (zod) when loaded; a damaged file is listed as damaged
  rather than crashing the game.
- A save stores the run's state, including every visited floor, but **not** catalog data: an
  item is stored by id, so changing a salve's healing changes it in existing saves too.

**Format versions** (`SAVE_VERSION`, now 5):

| Version | Milestone | Added | Upgrade from the previous version |
|---|---|---|---|
| 1 | 1 | Exploration | — |
| 2 | 3 | Combat, creatures, lantern, camps, bestiary | Full health, level 1, full lantern; visited floors stay empty of creatures |
| 3 | 4 | Items, pack, gear, traps | Starting gear and empty pack; visited floors get the items and traps they were generated with |
| 4 | 5 | Gold, merchants, sealed stairs, the Beacon, victory, wins | Empty purse, no wins yet; visited floors get their gold piles (never on a tile already holding something), merchant, stock and Beacon |
| 5 | 6 | Per-descent tallies, run history, achievements | Fresh tallies, empty history, no achievements yet |

### Managing characters (desktop app)

Files: `src/main/save-store.ts` (files), `src/main/index.ts` (dialogs, checks),
`src/renderer/src/screens/title/CharacterDialog.tsx` (the Manage window).

- **Rename** and **Delete** from Manage on the title screen. Deleting moves the save file and its
  backups to the **Recycle Bin**, so a mistake can be undone from there.
- **Backups:** a copy of the save is taken each time a character is opened and every 10 minutes
  of play (`BACKUP_INTERVAL_MS`), in `Saves\Backups\<id>\`. The newest 5 are kept
  (`BACKUP_LIMIT`). Manage > Backups restores one (the current file is backed up first). A
  damaged save shows **Restore** when it has backups.
- **Export** writes the character to a `.embercrawl` file anywhere; **Import** reads one (checked
  and upgraded like any save). Importing a character that already exists asks: keep both (the
  copy gets a new id and " (copy)"), replace, or cancel.
- **Open saves folder** opens `%APPDATA%\Embercrawl\Saves` in Explorer.
- The browser preview can export and import (download and file picker) but has no backups,
  Recycle Bin or folder; `saves.features` tells the UI what is available.

### Settings

Files: `src/shared/settings.ts` (what a setting can be, default keys), `src/main/settings-store.ts`
(the file), `src/renderer/src/settings/SettingsContext.tsx` (in the UI),
`src/renderer/src/screens/SettingsScreen.tsx` (the screen).

- Stored in `settings.json` in the user-data folder (`%APPDATA%\Embercrawl`), separate from
  saves; the browser preview uses the `localStorage` key `embercrawl:settings`.
- **Interface size** (90%, 100%, 115%, 130%): the window's zoom, set by the main process.
- **Motion:** follow Windows, or always reduced (no bob, shake or particles).
- **Map:** the minimap's starting size (small, large, hidden).
- **Fullscreen** toggle, and **Controls**: up to 3 keys per action. Esc, F11, the Windows key
  and 1–0 (pack slots) are fixed. A key given to one action is taken from any other.
- A damaged or partly invalid file falls back to the default for each bad setting, never an
  error.

**Changing the save format** (required whenever `RunState`, `Floor` or the record changes shape):

1. *Before* changing the engine, capture a genuine save with the current code into
   `tests/fixtures/character-v<N>.json`.
2. Bump `SAVE_VERSION` and add an entry to `UPGRADES` that turns version N into N+1.
3. Update the schema at the bottom of `save.ts`.
4. Add tests that load the fixture and check the upgrade.

Changing a number (healing, damage, weights) does **not** need a format change.

---

## 13. Presentation: palettes, animation and art

### Floor palettes (`render/dungeon/palettes.ts`)

- Floors 1–3: **Ember Slate** (the original look).
- Each later group of three floors (4–6, 7–9, …) picks one of seven palettes at random from the
  run's seed, never the same as the group before (older ones may return): Mossgrown, Rimefrost,
  Amethyst Hollow, Rustworks, Sunken Sandstone, Verdigris Vault and Ashen Halls.
- Floor 30: **Molten Heart**, used nowhere else.
- The palette's name is the region shown beside the floor number.

### Timing (`game/timing.ts`)

| Setting | Value |
|---|---|
| One step's glide | 115 ms (50 ms with reduced motion) |
| Held key: first repeat | after 220 ms |
| Held key: repeat interval | 120 ms |
| Click-to-walk pace | 115 ms per step |
| Two keys counted as one diagonal | pressed within 45 ms |

### How events become animation (`DungeonView.handleEvents`)

Each engine event triggers an effect: steps glide; attacks lunge, flash and pop damage numbers;
creature strikes are delayed until after your step lands; ranged shots fly; deaths dissolve;
pickups lift away with the item's name; the flare and pulse send out shockwave rings; the survey
lens reveals the floor as a ripple; traps burst with fire, alarm rings or gloom. Floor changes fade
through black with a "Floor N · Region" banner. Everything respects the system's *reduce motion*
setting.

### The minimap (`screens/game/Minimap.tsx`)

The floor as explored so far, in the top right corner, drawn in the floor's own colors (brighter
where the lantern reaches now), with markers: the hero (white), stairs down (orange) and up
(blue), the camp, the merchant (green), the Beacon (pale gold), items and gold seen, found traps
(violet) and creatures in view (red). Three sizes: small (5 pixels a tile), large (9) and hidden;
**M** cycles them, the buttons on the map do the same, and the choice is remembered on the PC.
Clicking the map walks there. It hides while the pack or the merchant's panel is open.

### Art

Drop a transparent PNG (ideally 128 × 128) named after the thing's id, and it replaces the drawn
placeholder automatically:

| Kind | Folder | Ids in |
|---|---|---|
| Creatures | `src/renderer/src/assets/sprites/creatures/<id>.png` | `creatures.ts` |
| Items | `src/renderer/src/assets/sprites/items/<id>.png` (cache: `cache.png`) | `items.ts` |
| Traps | `src/renderer/src/assets/sprites/traps/<id>.png` | `items.ts` (`TRAPS`) |

The hero and stairs are `hero.png`, `stairs-down.png` and `stairs-up.png` in `assets/sprites/`.
The merchant's stall and the Beacon are `merchant.png`, `beacon.png` and `beacon-lit.png` there
too; gold piles are `items/gold.png`.

---

## 14. Controls

| Action | Keys / mouse |
|---|---|
| Move | WASD or arrows; two at once for diagonals; Q E Z C; number pad 1–9 |
| Attack | Move into a creature |
| Wait | Space, `.` or number pad 5 |
| Stairs, rest, trade, rekindle, pick up | Enter (or click the tile you stand on) |
| Lantern bright/dim | L |
| Pulse | F |
| Use or equip pack slot | 1–9, 0 (or click the slot) |
| Open the pack | I or Tab |
| In the pack | Arrows/WASD select, Enter use, X drop, Esc/I/Tab close |
| At a merchant | Up/down or W/S select, Enter buy or sell, Esc close |
| Map: small, large, hidden | M (or the buttons on the map) |
| How to play | H (or from the menu and title screen) |
| Walk somewhere | Click an explored tile (any key stops the walk; danger stops it too) |
| Menu | Esc |
| Fullscreen | F11 or Alt+Enter |

Every key above except Esc, F11, Alt+Enter and 1–0 can be changed in Settings > Controls; the
table shows the defaults.

The pause menu (Esc) also has Settings, Records, **Copy a bug report** (copies the version, seed,
floor, hero, gear and recent messages for pasting into a message) and the game's version.

Key handling: `input/useGameKeys.ts` (dungeon, reading the bindings from Settings), `screens/game/InventoryPanel.tsx` (pack) and
`screens/game/ShopPanel.tsx` (merchant).

---

## 15. Tuning cookbook

Always finish with `pnpm check` (types, lint, tests). Some tests pin exact numbers; if a test fails
because you *meant* to change that number, update the test's expected value.

### Change a balance number

Edit `rules.ts` (formulas, counts, weights), `creatures.ts` (creature stats) or `items.ts` (item
power and effect amounts). No save change needed.

Things to keep in mind:
- Small numbers matter: creatures with 2–3 damage feel very different from 3–4.
- More creatures also means more XP, so the hero levels faster.
- Check hits-to-kill: the creature tooltip in the game shows "N blows to fell" for your current
  gear, which is a quick way to see the effect of a change.

### Add a creature

1. Add an entry to `CREATURES` in `creatures.ts` (id, name, description, stats, first floor,
   behavior, placeholder color). Keep the list ordered by first floor.
2. Optionally add `assets/sprites/creatures/<id>.png`.
3. Note: adding a creature changes which creatures appear on floors (the spawn pool), but not the
   floor layouts.

### Add a supply

1. Add an entry to `SUPPLIES` in `items.ts`. If its effect is new, add a kind to `SupplyEffect`
   and handle it in `consumeSupply` (`run.ts`), `effectLine` and `supplyOutlook` (`itemText.ts`),
   `describeUse` (`messages.ts`) and `supplyUsed` (`DungeonView.ts`). TypeScript will point at
   every `switch` that's missing the new kind.
2. Give it a weight in `supplyWeight` (`rules.ts`).
3. Add a test in `tests/engine/items.test.ts`.

### Add a weapon or armor

Add an entry to `WEAPONS` or `ARMORS` in `items.ts` (power, `tier` = first floor), keeping each
list in order of strength (a test checks this). It enters the gear pool automatically.

### Add a trap

Add it to `TRAPS` in `items.ts`, give it a strength in `trapPower` and a weight in `trapWeight`
(`rules.ts`), handle its effect in `springTrap` (`run.ts`), describe it in `trapEffect`
(`itemText.ts`) and `describeTrap` (`messages.ts`), and give it a visual in `trapSprung`
(`DungeonView.ts`) and a placeholder in `drawTrap` (`render/itemArt.ts`).

### Add a palette

Add it to `REGULAR_PALETTES` in `palettes.ts`. This changes which palette each run gets for
existing seeds (purely visual).

### Make the game easier or harder overall

Measure first: run `pnpm balance` (see [section 16](#16-testing-and-tools)) before and after.
Good levers, roughly from gentlest to strongest: `CREATURE_HP_PER_FLOOR` (the finest dial);
healing amounts and recovery supplies; camp healing; gold and prices (the bot relies on buying
gear upgrades: steeper prices cut its wins from 26% to 8%); creature count; starting health and
level gains; gear power; `CREATURE_ATTACK_BASE` (coarse: see section 7).

---

## 16. Testing and tools

| Command | What it does |
|---|---|
| `pnpm check` | Type checks, lint and all tests |
| `pnpm smoke` | Builds and launches the real app six times (title, settings, records, game, game with the pack open, game with the merchant's panel open); fails on any error; screenshots in `.smoke/` |
| `pnpm balance 200 1` | The balance bot plays 200 whole descents (seeds 1–200) and reports the win rate, where runs end and what kills them |
| `pnpm dev:web` | Runs the game in a browser at http://localhost:5173 (saves in the browser) |
| `pnpm dev` | Runs the desktop app with hot reload |
| `pnpm dist` | Builds into `release/<version>/`, for x64 and ARM64 each: `Embercrawl-<version>-<arch>.zip` (unzip and run `Embercrawl.exe`, no install), `Embercrawl-<version>-portable-<arch>.exe` (one file, no install, unpacks itself on each launch so it starts a little slower) and `Embercrawl-Setup-<version>-<arch>.exe` (installer). All keep saves in `%APPDATA%\Embercrawl`. |
| `pnpm exec tsx scripts/demo-saves.mts .demo --showcase 4 14` | Makes demo characters already on chosen floors (see `CLAUDE.md` to launch them); `--merchant` stands one at a merchant with gold, `--won` makes a won floor 30 |

Test files (`tests/`):

| File | Covers |
|---|---|
| `engine/rng.test.ts` | Random numbers (golden values: changing them changes every dungeon) |
| `engine/generate.test.ts` | Floor layout, stairs, camps, creatures |
| `engine/sight.test.ts`, `path.test.ts`, `movement.test.ts` | Vision, pathfinding, diagonal rule |
| `engine/creatures.test.ts` | The creature roster and depth scaling |
| `engine/run.test.ts` | Moving, waiting, stairs |
| `engine/combat.test.ts` | Attacks, creature behaviors, lantern, pulse, camps, death |
| `engine/items.test.ts` | Catalog, pack, floor contents, supplies, gear, dropping, traps |
| `engine/descent.test.ts` | Gold, merchants, guardians sealing the stairs, the Beacon, victory, the version-3 upgrade |
| `engine/bot.test.ts` | The balance bot finishes whole descents without getting stuck |
| `engine/save.test.ts` | Save format, upgrades from real version-1 and version-2 saves |
| `engine/records.test.ts` | Achievements, tallies, run history, the version-4 upgrade |
| `engine/fuzz.test.ts` | Thousands of random actions, checking the rules never break |
| `main/save-store.test.ts` | Writing save files safely, rename, delete, backups and restore, export and import |
| `main/settings.test.ts` | Reading and writing settings, key bindings |
| `renderer/palettes.test.ts`, `motion.test.ts` | Palettes and animation helpers |

### The balance bot (`src/bot/bot.ts`, `scripts/balance.mts`)

The plan's target is that **a fixed, simple bot wins 25–35% of runs**, measured on seeds kept
apart from tuning. The bot sees only what a player would (explored tiles, creatures in view) and
plays through the normal rules. Each turn, in order, it:

1. heals when at 45% health or less, drinks vigor draughts, and refills a lantern at 50 or less;
2. fights anything adjacent (a flare if 2+ are near, a pulse if surrounded or about to be struck,
   a ward sigil when hurt), otherwise hits the weakest;
3. equips better gear from the pack;
4. closes in on creatures that have noticed it;
5. rests at the camp below 65% health, and trades at a merchant (sells outgrown gear, buys gear
   upgrades, then healing until it carries 4);
6. picks up gold and items it has seen;
7. on floor 30, rekindles the Beacon once the Warden has fallen;
8. explores the whole floor, fights any guardian sealing the stairs, then goes down.

It never dodges telegraphed strikes, so a careful player should do better than it. When
creatures block the only way, it fights through them; if it paces over the same few tiles for 60
turns, it stops exploring that floor and heads down.

`pnpm balance [runs] [first seed]` plays descents on all but one CPU core (about 40 seconds for
200 on the owner's PC). **Tuning seeds** are 1–300; **check seeds** start at 100001. Milestone 5's
result (version 0.5.0): **30.7%** wins on 300 tuning seeds and **33.0%** on 300 check seeds.
Losses cluster at the two guardians (floors 6–10 and 16–20) and the finale (26–30), with few on
floors 1–5. Winners reach level 22 in about 4,600 turns.

---

## 17. How the game was built

Embercrawl is a clean-room rewrite of the owner's earlier Replit game, *Emberdepths*: the old
project was used only to understand how things behaved, never as code to copy. It keeps
Emberdepths' setting (a buried observatory and its failing Beacon), creature and item names (so
the owner's art fits), and its rules as a starting point, then improves on them.

| Milestone | Commit | Version | What it added |
|---|---|---|---|
| 0 | `1de471b` | — | Repository, Electron + PixiJS + React skeleton, tests, installers |
| 1 | `f96c4c3` | 0.1.0 | Floor generation, 8-way movement and the corner rule, fog, stairs, keyboard and mouse, palettes every three floors, multiple characters, saves |
| 2 | `1c2c152` | 0.2.0 | Feel pass: gliding steps, camera, lantern lighting, particles, input queuing, fullscreen, crisp scaling |
| 3 | `e098733` | 0.3.0 | Combat, 25 creatures with five behaviors, telegraphed strikes, leveling, lantern pulse, camps, death and new descents, story card |
| 4 | `773d2b9` | 0.4.0 | Items, the pack, weapons and armor, caches, traps, tooltips and comparisons |
| — | `28725ae` | 0.4.0 | No-install builds: a zip and a portable exe alongside the installer |
| 5 | `86bdb60` | 0.5.0 | Gold, merchants, guardians sealing the stairs, the Beacon and victory, the balance bot and tuning, the minimap, how-to-play, the version on the title screen |
| 6 | `cb4e061` | 0.9.0 | Beta: character management (rename, delete to the Recycle Bin, export/import, backups and restore), settings and key remapping, run history and achievements, bug reports, tester notes |

Key decisions along the way (details in `docs/PLAN.md`):

- **Desktop only (Windows), no accounts:** saves live on the PC, one file per character, so they
  can be backed up and moved.
- **Electron rather than a game engine:** the game stays a web page in a desktop window, so it can
  be tested in a browser and needs no new language.
- **8-way movement** for hero and creatures, with one corner rule shared by movement and sight.
- **Pure, seeded engine** separated from drawing, so every rule is tested and games reproduce.
- **Telegraphed creature strikes**, so diagonal movement doesn't make fights unfair.
- **Bright light reveals traps** (milestone 4), tying exploring to the lantern.
- **Guardians seal the stairs** (milestone 5), so floors 10 and 20 are real checkpoints.
- **Balance by measurement** (milestone 5): numbers are tuned with the bot, not by feel.

---

## 18. Not built yet

From the plan's later milestones:

- **Milestone 7:** sound effects. Music afterwards, if at all (undecided).
- **Milestone 8:** art pass, gamepad support, opening a `.embercrawl` file by double-clicking it.
- **Milestone 9:** release (signed builds, store page, updates).
