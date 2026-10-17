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
  `>` or `<` uses stairs (or click the stairs you stand on); Esc opens the menu. Gamepad left stick
  in 8 directions and key remapping arrive in milestone 6.
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
- Mouse: click to move, hover tooltips for creatures and items, gear comparisons.
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
  title screen's character list with "new character". Backups, checksums, delete, rename and
  export/import follow in milestone 6.

**Backing up and moving to another PC.**

- **Export character:** saves one self-contained `.embercrawl` file anywhere (USB drive, cloud
  folder, email).
- **Export all:** one backup file containing every character.
- **Import:** checks the file, then asks whether to replace or keep both if that character already
  exists. Double-clicking a `.embercrawl` file opens the game and offers to import it.
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
| 4 | Items and inventory (healing, gear, traps), tooltips and comparisons | Gear up |
| 5 | Full descent: 30 floors of content, guardians, shops, victory; bot re-tuned to 25–35% | Play a whole run |
| 6 | Characters, saves and settings: character select, export/import, backups, file association, key remapping, gamepad | Manage characters and move saves between PCs |
| 7 | Art and audio pass | |
| 8 | Release prep: signed installers, store page (itch.io or Steam), auto-update | Share it with players |

Each milestone ends with `pnpm check` and the smoke test passing, and a commit.

## 9. Costs

Free to build. For release: itch.io is free; Steam charges a one-time $100 per game; a Windows
code-signing certificate (yearly fee) removes the "unknown publisher" warning on installers that
aren't installed through Steam.

## Open decisions

- Operating systems beyond Windows (macOS, Linux/Steam Deck): deferred.
- Distribution (itch.io or Steam): decide at milestone 8.
