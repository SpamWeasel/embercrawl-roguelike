# Embercrawl plan

Approved 2026-10-17. Update this file when a decision changes; it is the reference for what we
are building and why.

## Goal

An original, turn-based roguelike, downloaded and played on a Windows PC. It runs fully offline,
with no accounts. Priorities, in order: **graphics and animation**, then **UI and desktop feel**.

All code is new. *Emberdepths* (the earlier Replit project in `../Emberdepths-Action-Roguelike`)
is a design reference for how things behaved, never a source to copy from. The user's own art
carries over.

**Originality rule:** inspired by classic dungeon crawlers such as Sword of Fargoal, but never a
clone. No reused lore, names, maps, art, audio, text or distinctive quest structure from any game.

## 1. Gameplay starting point

Rebuild Emberdepths' rules first, so the new version can be compared against the old one, then
improve:

- 30 floors of 32×16 tiles with a following camera; guardians on floors 10, 20 and 30; a final
  objective on floor 30.
- Turns advance only on actions; attacks by moving into creatures; floors persist when revisited.
- Lantern trade-off: bright light sees further but drains charge; charge powers a pulse.
- Five creature behaviors (chase, slow, ranged, erratic, swift); consumables, weapons, armor,
  traps, camps and shops.
- **Floor palettes (built in milestone 1):** floors 1–3 use the original palette (Ember Slate).
  Each later group of three floors picks one of eight hand-designed palettes at random from the
  run's seed, never repeating the group before (older ones may return). Floor 30 always uses the
  exclusive Molten Heart palette. A run always gets the same sequence. Each palette has a region
  name shown beside the floor number. Palettes are visual only and use their own random stream.
- Achievements, bestiary and run history that survive death.
- **Balance target:** a fixed, simple bot wins 25–35% of runs on seeds kept apart from tuning.

**Lore (decided 2026-10-17):** keep Emberdepths' setting, retold in Embercrawl's own words.
Astronomers built an observatory downward, chasing a fallen star thirty floors into the earth, and
lit the Beacon at the bottom to hold back what woke there. The Beacon is guttering; the hero
descends with the keeper's lantern to rekindle it. The text lives in
`src/renderer/src/game/lore.ts`. The 25 creature names are kept from Emberdepths so the owner's
art matches; descriptions are new.

**Built in milestone 3:**
- **Combat.** Moving into a creature attacks it (damage = attack power + 0–2). Creatures strike
  back for their attack + 0–1 − defense (at least 1), shields absorbing first. XP levels the hero
  up (+5 max health, +10 health).
- **Creatures** follow their behavior (chase, slow, ranged, erratic, swift) with real
  pathfinding. They notice the hero within 7 tiles in clear view, hunt toward where they last saw
  them, and **telegraph**: a creature in reach first readies (a red marker), then strikes on its
  next turn if the hero is still in reach. Stepping away dodges it.
- **The lantern:** dim (sight 4) or bright (sight 6, 1 charge per turn); pulse costs 20 charge,
  hits creatures within 2 tiles in view for attack + 4, and adds a 4-point shield.
- **Camps** (moved up from milestone 4): one per floor, warded so creatures can't enter or strike
  there. Resting once restores 75% of max health and 30 charge.
- **Death** ends the descent. The character keeps their records (deaths, deepest floor, bestiary)
  and can begin a new descent.
- Every combat number is in `src/engine/rules.ts`, which milestone 5's balance bot will tune.

**Built in milestone 4** (Emberdepths' item rules as the starting point, in new words and code):
- **Supplies:** Salve (+16 health), Deep Salve (+40, from floor 10), Ember Shard (+40 charge),
  Ward Sigil (+12 shield), Vigor Draught (+6 max health), Waystone (to a quiet spot on the floor,
  away from creatures), Survey Lens (reveals the floor and its traps) and Flare Flask (16 damage
  to every creature in view within 3 tiles). Supplies that would be wasted (a salve at full
  health, a flare with no targets) are refused without using a turn.
- **Weapons and armor:** ten weapons (attack +3 to +22) and nine armors (defense 1 to 15), from
  the Weathered Knife and Traveler's Coat every descent starts with. One piece per floor from
  floor 2: even floors favor weapons, odd floors armor; recent tiers are most common, and
  guardian floors reach further ahead. Gear must be equipped; the old piece goes to the pack.
- **Each floor holds** random supplies (more on odd and deeper floors), a guaranteed healing
  supply from floor 4, a supply cache on odd floors and every floor from 15 (it opens into one
  supply, fixed per cache), and a salve beside the entrance on floor 1.
- **The pack:** ten numbered slots, stacks of up to nine. Walking onto an item picks it up (Enter
  picks it up later if the pack was full). Keys 1–0 use or equip a slot; I or Tab opens the pack
  beside the dungeon to inspect, use or drop. Every use, equip or drop takes a turn.
- **Traps** (none on floor 1, up to five deeper): Ember Vents burn (armor doesn't help; shields
  do), Alarm Glyphs wake creatures within 8 tiles, Gloom Runes drain the lantern and put out
  bright light. Traps stay hidden in dim light; **bright light shows those within 2 tiles**, which
  makes the lantern trade-off matter while exploring. A Survey Lens shows them all. Found traps
  are drawn, explained in tooltips and walked around by click-to-walk; creatures never set them
  off. Traps can kill.
- **Tooltips and comparisons:** hovering a creature shows its health, behavior, how hard it hits
  you after armor and how many of your blows it takes; hovering an item, found trap, camp or
  stairs explains it. Gear shows "Attack 5 → 7 (+2)", green when better and red when worse;
  supplies show what they'd do right now. Worn gear (with attack and defense) sits bottom left
  and the pack's slots bottom right, each with tooltips.
- **Visuals:** items bob and glint on the floor, take their tile's light, drop in when set down
  and lift away when picked up; caches burst open; each supply and trap has its own effect (heal
  sparkles, shield rings, the flare's fire ring, a Waystone shimmer, the Survey Lens revealing
  the floor as a spreading ripple, vent fire, alarm rings, gloom).
- Saves move to format 3, with an upgrade from format 2 tested against a genuine version-2 save.
  Upgraded characters get the starting gear, and floors they already visited get the items and
  traps they were made with.
- The owner's nine item pictures are used; the rest have drawn pixel-art placeholders until art
  arrives (drop `<item id>.png` into `assets/sprites/items/`).

**Built in milestone 5** (shops and gold added at the owner's request; Emberdepths had no shops):
- **Gold:** piles on every floor, coins from every creature slain (fixed per creature), and a
  guardian's hoard. Gold goes straight to the purse, shown in the top bar.
- **Merchants** keep a warded stall on floors 3, 6 … 27, selling four supplies and a weapon and
  armor from a little deeper, and buying items back at 40% of their price. Prices rise 8% a floor.
- **Guardians** on floors 10 and 20 seal the stairs down until they fall, then leave gold and
  gear from deeper down.
- **The ending:** floor 30 holds the Beacon at its far end. With the Beacon Warden slain, the hero
  rekindles it and the descent is won: a victory screen, and the character's record counts wins.
- **The balance bot** (`src/bot/bot.ts`, `pnpm balance`) plays whole descents with a fixed, simple
  strategy. Tuned to the target: 30.7% wins on 300 tuning seeds, 33.0% on 300 separate check
  seeds, with losses spread across the descent (most at the guardians and the finale). Tuning
  changed creature health growth (8% → 10.5% a floor), creature attack (× 0.9 → × 1.02), the
  deepest creatures' attacks (lowered), kill gold and prices.
- **Minimap**, **how to play** (title screen, menu and H), and the **version** on the title screen.
- Saves move to format 4, with an upgrade from format 3 tested against a genuine version-3 save.
- Achievements and run history moved to milestone 6.

**Built in milestone 6** (ready for testers; ends with the 0.9.0 beta):
- **Character management** on the title screen (Manage): rename, delete to the Recycle Bin,
  export to a file, import (keep both or replace when the character exists), open the saves
  folder, and rolling backups (on opening and every 10 minutes of play, newest 5 kept) with
  restore, also offered for a damaged save.
- **Settings** (title screen and the in-game menu), stored in `settings.json` beside the saves:
  interface size, motion (follow Windows or always reduced), the minimap's starting size,
  fullscreen, and **key remapping** (up to 3 keys per action).
- **Run history** (the last 50 descents) and **18 achievements**, shown on a Records screen;
  each descent tallies gold spent, rests, traps, supplies, bright-lantern turns and guardians.
- **Tester tools:** "Copy a bug report" and the version in the pause menu; `README.txt` tester
  notes beside `Embercrawl.exe`.
- Fixes: the hero now draws in front of the merchant's stall; the merchant panel's Buy/Sell
  button stays in view without scrolling; dark scroll bars.
- Saves move to format 5, with an upgrade from format 4 tested against a genuine version-4 save.
- Moved to milestone 8: gamepad, "export all", and opening a `.embercrawl` file by
  double-clicking it.

## 2. Diagonal movement

- Hero and monsters move in 8 directions. A diagonal step costs one turn, like any other.
- Attacks work diagonally (move into the creature).
- **No squeezing:** a diagonal step is blocked when both orthogonal neighbors on that side are
  walls (two walls touching at a corner). Stepping diagonally past a single wall corner is allowed.
  The same rule applies to monsters.
- Ranged creatures fire along rows, columns **and diagonals**.
- Pulses and other area effects include diagonal tiles. Sight and lantern radius are round
  (Euclidean distance); movement distance is Chebyshev (diagonals count as 1).
- Controls: WASD or arrows for straight moves; Q/E/Z/C or two keys pressed together for
  diagonals; numpad 1–9; holding keys keeps walking; click a tile to walk there over explored
  ground (paths may use diagonals; any key stops the walk); Space, `.` or numpad 5 waits; Enter,
  `>` or `<` uses stairs (or click the stairs you stand on); Esc opens the menu. Keys can be
  remapped in Settings (milestone 6); a gamepad's left stick in 8 directions arrives in milestone 8.
- Balance: diagonals remove corner-dancing escapes and strengthen swift creatures. The balance
  bot must use diagonals and the game is re-tuned to the 25–35% target.

## 3. Tech stack

| Piece | Choice | Notes |
|---|---|---|
| Desktop shell | Electron 44, packaged with electron-builder | NSIS installers for Windows x64 and ARM64 |
| Language and build | TypeScript 7, Vite 8 (via electron-vite), pnpm 12 | |
| Dungeon rendering | PixiJS 8 (WebGL) | GPU lighting, particles, smooth motion |
| Menus and HUD | React 19, Tailwind CSS 4, Motion | Ordinary HTML on top of the PixiJS canvas |
| Saves | Files in `%APPDATA%\Embercrawl` | See section 7 |
| Quality | Vitest, Biome | `pnpm check` runs everything |

Why Electron instead of a game engine such as Godot: the game stays a web page inside a desktop
window. Claude can run it in a browser to inspect and test visuals directly, and there is no new
language or editor to learn. Every PC gets the same Chromium, so rendering is consistent. Cost:
about 100 MB per installer. Tauri was rejected because it needs Rust and C++ build tools and renders
with each system's own web view.

## 4. Architecture

```text
Embercrawl.exe (Electron)
 ├─ Main process: window, single-instance lock, save files on disk
 ├─ Preload: the narrow bridge (window.embercrawl) — the only way the game reaches the PC
 └─ Game window (renderer)
      Keyboard / mouse / gamepad ──actions──► Engine (pure rules, seeded, 8-way)
                                                │ new state + list of events
                               ┌────────────────┴────────────────┐
                               ▼                                 ▼
                     React HUD, panels, menus           PixiJS animates the events
                               │
                               ▼
                 Save bridge ──► main process writes the save file
```

- **Engine** (`src/engine`): pure TypeScript. No DOM, Node, Electron, PixiJS or React, and no
  `Math.random()` or clock reads. The same seed plus the same actions always gives the same game,
  which makes tests, the balance bot and bug reproduction reliable.
- Rules resolve instantly; the renderer plays the resulting events as short animations. Input is
  queued, and animations speed up under rapid input, so controls never feel laggy.
- Content (monsters, items, floors) is data-driven: adding a monster means a data entry plus an
  image.
- In a plain browser (`pnpm dev:web`), the bridge is absent and saves fall back to browser
  storage, so the same game runs there for visual checks.

## 5. Graphics and animation (priority 1)

- Smooth gliding movement, including diagonals; sprites face their direction of travel; the camera
  eases to follow.
- Real lantern light: a soft, flickering, warm radius. Explored-but-unseen areas fade to a cool
  tint.
- Effects: hit sparks, drifting embers, footstep dust, death dissolves, screen shake, floating
  damage numbers and a pulse shockwave.
- Single-image sprites are brought to life in code: idle breathing, squash and stretch, attack
  leans and hit flashes. Frame-based animation can be added if animated art is made.
- Floor palettes with a descent transition. Crisp scaling from 720p to 4K.
- **Built in milestone 2:**
  - Steps glide (about 115 ms each). Rapid input queues up and plays faster to catch up; nothing
    is dropped and the rules never wait for animation.
  - The camera eases after the hero, and there's a light shake on wall bumps.
  - Lantern light follows the hero's drawn position with a soft warm halo masked to visible tiles
    and a gentle flicker. Tiles fade in and out of sight and fade in when first discovered.
  - The hero has a shadow, a walking hop, a landing squash, idle breathing, a turn animation and a
    wall-bump nudge.
  - Particles: footstep dust, drifting lantern motes, and an ember burst on arrival.
  - Floor changes fade through black with the hero sinking into the stairs, then a "Floor N ·
    Region" banner.
  - Pixel-perfect scaling on any DPI; F11 or Alt+Enter for fullscreen; 30 fps when idle; reduced
    motion honored.
  - Hit sparks, death dissolves, damage numbers, the pulse shockwave, attack leans and hit flashes
    arrive with combat in milestone 3.
- **Art workflow:** drop images named after their entity into `art/incoming/`. A script removes
  flat backgrounds (black, white or mixed), trims, squares and saves them; the game picks sprites up
  automatically by file name. Missing art gets a generated placeholder.

## 6. UI and desktop feel (priority 2)

- One screen: stats, minimap and log in side panels on wide screens; inventory and character
  sheets as overlays above the dungeon.
- Mouse: click to move, hover tooltips for creatures and items, gear comparisons (built in
  milestone 4).
- A minimap in the top right corner: small, large or hidden (M), clickable to walk (built in
  milestone 5, added at the owner's request).
- Keyboard-first with remappable keys; Xbox and PlayStation controller support.
- Windowed, fullscreen and borderless; any resolution and aspect ratio; UI scale setting.
- Pause menu, settings, and an automatic save on quit.
- Accessibility: text size, high contrast, reduced motion, color-blind-safe markers.

## 7. Characters and saves

**Multiple characters, one save file each.**

- A title screen lists characters with name, level, current floor, play time and last played.
  Players can create, continue, rename and delete characters. Deleting asks for confirmation and
  moves the file to the Recycle Bin, so it can be recovered.
- Each character holds its current descent (if any) and its own achievements, bestiary, statistics
  and run history.
- **Death ends the descent, not the character.** The character keeps its record and can start a
  new descent. A future option could make death final per character.

**Saving.**

- Autosaves after every turn and on quit. Writes are atomic (write a temporary file, then rename),
  so a crash or power cut cannot corrupt a save.
- The game keeps several rolling backups per character and can restore one if a file is damaged. A
  checksum detects damage (it is not anti-cheat).
- Saves live in `%APPDATA%\Embercrawl\Saves`. Documents was rejected because Windows' ransomware
  protection (Controlled Folder Access) can block games from writing there, and OneDrive can lock
  files mid-save.
- Development builds save to `%APPDATA%\Embercrawl Dev\Saves` instead, so testing never touches a
  player's real characters.
- Uninstalling never deletes saves.
- Built in milestone 1: one file per character, atomic writes, a save after every turn, and the
  title screen's character list with "new character". Built in milestone 6: backups and
  restore, delete (to the Recycle Bin), rename, export/import and the saves-folder button.

**Backing up and moving to another PC.**

- **Export character:** saves one self-contained `.embercrawl` file anywhere (USB drive, cloud
  folder, email).
- **Export all:** one backup file containing every character (milestone 8).
- **Import:** checks the file, then asks whether to replace or keep both if that character already
  exists. Double-clicking a `.embercrawl` file opens the game and offers to import it (milestone 8).
- **Open saves folder** button for manual copying.
- The format is independent of the PC and version-numbered with upgrade steps, so older saves load
  in newer versions. A save from a newer version is refused with a clear message.
- If the game is ever sold on Steam, Steam Cloud can sync the saves folder.

## 8. Milestones

| # | Milestone | Done when the player can… |
|---|---|---|
| 0 ✅ | Foundation: repository, `CLAUDE.md`, Electron + PixiJS + React skeleton, tests, x64/ARM64 installers | Install and launch Embercrawl |
| 1 ✅ | Walkable dungeon: floor generation, 8-way movement and corner rule, fog, stairs, keyboard and mouse, floor palettes every three floors, title screen with multiple characters (first one created automatically), autosave to disk | Walk floors, quit, and resume |
| 2 ✅ | **Feel pass:** smooth motion, camera, lantern lighting, particles, input queuing, fullscreen and scaling | Judge the feel early |
| 3 ✅ | Combat and creatures: behaviors adapted to 8-way, leveling, death, the lantern, camps, combat effects (sparks, damage numbers, dissolves, pulse shockwave) | Fight |
| 4 ✅ | Items and inventory (healing, gear, traps), tooltips and comparisons | Gear up |
| 5 ✅ | Full descent: 30 floors of content, guardians, shops, victory; bot re-tuned to 25–35% | Play a whole run |
| 6 ✅ | Ready for testers: character management (rename, delete, export/import, backups, saves folder), settings (key remapping, interface size, motion), run history and achievements, a bug-report button, small fixes; ends with the **0.9.0 beta** | Hand the game to testers |
| 7 | Sound effects (music afterwards, if at all: undecided) | Hear the game |
| 8 | Art pass, gamepad, file association | |
| 9 | Release prep: signed installers, store page (itch.io or Steam), auto-update | Share it with players |

Each milestone ends with `pnpm check` and the smoke test passing, and a commit.

## 9. Costs

Free to build. For release: itch.io is free; Steam charges a one-time $100 per game; a Windows
code-signing certificate (yearly fee) removes the "unknown publisher" warning on installers that
aren't installed through Steam.

## Open decisions

- Music: the owner isn't sure the game needs music right away; sound effects come first
  (decided 2026-10-24).
- Operating systems beyond Windows (macOS, Linux/Steam Deck): deferred.
- Distribution (itch.io or Steam): decide at milestone 9.
