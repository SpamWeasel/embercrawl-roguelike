# Embercrawl

An original turn-based roguelike for Windows PCs: Electron + PixiJS (dungeon) + React (UI). The
approved plan, decisions and milestones are in `docs/PLAN.md`; read it before larger changes and
update it when a decision changes. `docs/DEVELOPMENT_GUIDE.md` explains every mechanic with its
numbers and where it lives; update it whenever a rule, number or file it mentions changes.

The owner is new to development tooling. Explain setup steps and trade-offs plainly.

## Rules

- **Originality:** never clone Sword of Fargoal or any other game (lore, names, maps, art, audio,
  text or distinctive quest structure).
- **Clean-room:** `../Emberdepths-Action-Roguelike` is the earlier Replit version. Read it only to
  understand behavior; never copy its code.
- **Pure engine:** `src/engine` has no DOM, Node, Electron, PixiJS or React, and never calls
  `Math.random()` or reads the clock. Use `Rng` from `src/engine/rng.ts`. `tsconfig.engine.json`
  enforces the API boundary. Rendering code displays results; it never contains rules.
- Cosmetic-only randomness in the renderer may use `Math.random()`. Visuals that must stay the same
  for a run (palettes) use their own `Rng.derive(seed, ...)` stream, never a gameplay stream.
- **Floor palettes (owner requirement):** floors 1–3 use the original palette; the palette changes
  at random every three floors (seeded per run, never repeating the previous group); floor 30 has
  its own palette used nowhere else. See `src/renderer/src/render/dungeon/palettes.ts` and its tests.
- **8-way movement:** a diagonal step is blocked only when both side tiles are walls; line of sight
  follows the same rule and is symmetric. Hero and monsters share these rules (`canStep`).
- **Animation never delays rules:** actions apply instantly in the engine. The session sends each
  `ActionResult` to the view (`subscribe` → `DungeonView.handleEvents`), which animates it; the
  view then receives the new state via `render`. Input is never blocked waiting for animation;
  the view's `StepQueue` speeds up to catch up. Walking pace lives in `game/timing.ts`.
- Every animation must respect `prefers-reduced-motion` (no bob, shake, particles; shorter steps).
- **Saves must never break:** every save-format change bumps the format version, adds an upgrade
  step and adds a test that loads the previous format. Capture a genuine fixture from the old
  engine *before* changing it (see `tests/fixtures/character-v1.json` and `character-v2.json`);
  fixtures are never reformatted (Biome ignores `tests/fixtures`).
- **Balance numbers** live only in `src/engine/rules.ts` (catalog stats sit in `creatures.ts` and
  `items.ts`). Floor generation draws the layout and stairs first, then the camp, creatures,
  items and traps, in that order, so adding content never changes a floor's shape or what was
  drawn before it.
- **Hidden things stay hidden:** the UI may show only traps with `found: true` (`knownTrapAt`),
  and never what a sealed cache holds. Tooltips and messages must not leak hidden state.
- **Lore:** Emberdepths' buried-observatory setting, retold in Embercrawl's own words
  (`src/renderer/src/game/lore.ts`). Creature names stay as in Emberdepths so the owner's art maps
  to them; descriptions are Embercrawl's own (`src/engine/creatures.ts`).
- **Art is picked up by file name** (transparent PNG, ideally 128×128), replacing the generated
  placeholder: `src/renderer/src/assets/sprites/creatures/<creature id>.png`,
  `.../items/<item id>.png` (the supply cache's id is `cache`) and `.../traps/<trap id>.png`.
  Ids are in `src/engine/creatures.ts` and `src/engine/items.ts`.
- **Golden RNG values** in `tests/engine/rng.test.ts` change every dungeon from every seed. Only
  update them as a deliberate, stated decision.
- **Security:** the game window reaches the PC only through `src/shared/bridge.ts` and
  `src/preload`. Keep that bridge narrow (specific operations, no generic file or IPC
  pass-through), validate everything it receives in `src/main`, and leave `contextIsolation` and
  `sandbox` on.
- Each milestone ends with `pnpm check` and `pnpm smoke` passing, then a commit and push.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Desktop app with hot reload |
| `pnpm dev:web` | Game window only in a browser, at http://localhost:5173 (no Electron; saves in browser storage) |
| `pnpm check` | Typecheck (engine, node, web) + Biome lint + Vitest |
| `pnpm format` | Biome auto-format and import sorting |
| `pnpm smoke` | Builds, then launches the title screen, the game, and the game with the pack open, with throwaway saves; screenshots and reports in `.smoke/`; fails on console errors |
| `node scripts/smoke.mjs <path\to\Embercrawl.exe>` | Same check against a packaged build |
| `pnpm exec tsx scripts/demo-saves.mts <folder> [--showcase] <floor>...` | Demo characters already on chosen floors, one user-data folder per floor; `--showcase` gathers creatures around the hero, lays out items, a cache and a found trap, and stocks the pack |
| `pnpm dist` | Installers in `release/<version>/` (x64 and ARM64) |
| `node scripts/make-icon.mjs [source.png]` | Rebuilds `build/icon.png` and `build/icon.ico` |

## Saves

- Packaged app: `%APPDATA%\Embercrawl\Saves\<id>.embercrawl`, one file per character.
- Development builds (`pnpm dev`, the unpacked `out/` build): `%APPDATA%\Embercrawl Dev\Saves`, so
  testing never touches real characters.
- `EMBERCRAWL_USER_DATA=<folder>` points the app at another user-data folder (smoke tests, demos).
- Browser preview: `localStorage` keys `embercrawl:character:<id>`.

## Testing notes

- To see a deep floor in the real app: create demo saves, then launch the built app with
  `EMBERCRAWL_USER_DATA=<folder>\floor-<n>`, `EMBERCRAWL_SMOKE_SCENE=game` (or `pack`) and
  `EMBERCRAWL_SMOKE_SCREENSHOT=<file.png>`; it writes the screenshot and quits.
- The browser pane's screenshots go stale while the Claude window isn't on screen. Use smoke
  screenshots for visuals. For behavior, drive the browser preview with dispatched key and pointer
  events and read results from `localStorage`; the engine can be imported in the page from
  `/@fs/C:/Users/phred/Desktop/Embercrawl/src/engine/index.ts`. Use a throwaway character, never
  the owner's.
- Background browser tabs throttle timers; front the tab before timing-sensitive tests.
- To check animation, reach the live `DungeonView` through the React fiber of the canvas host
  (its `DungeonCanvas` hooks hold `viewRef`) and sample `view.display`, `view.steps`,
  `view.transition` and `view.app.ticker.maxFPS` once per `requestAnimationFrame`.
- F11 and Alt+Enter are caught in the main process (`before-input-event`), so they can't be tested
  from the page.
- After file changes, a long-running Vite dev server can serve stale modules on Windows (for
  example after a "file watcher error: EBUSY" in its log, which copying images can cause); restart
  it if behavior doesn't match the code. `fetch("/src/<file>")` in the page shows what it serves.
- The pane's page may be narrower than its screenshots: dispatch pointer events in page (CSS)
  pixels, e.g. from the live view's `world.position` and `world.scale`, not screenshot pixels.

## Environment notes

- Windows 11 on ARM64, Windows PowerShell 5.1. If `node`, `pnpm`, `git` or `magick` is "not
  recognized" in a shell started before they were installed, refresh PATH:
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`
- In PowerShell 5.1, `Set-Content -Encoding utf8` writes a byte-order mark. Edit files with the
  editing tools, or `[IO.File]::WriteAllText(path, text, (New-Object System.Text.UTF8Encoding($false)))`.
- pnpm 12 blocks dependency install scripts; decisions live under `allowBuilds` in
  `pnpm-workspace.yaml`. It also holds back package releases less than a day old.
- Electron 44 downloads its binary on first use (`node node_modules/electron/install.js`).
- Every library is a devDependency: Vite bundles all code into `out/`, so the packaged app ships no
  `node_modules`.
- `package.json` is deliberately not `"type": "module"`, so Electron's main and preload build as
  CommonJS (the sandboxed preload requires it). ESM-only tool configs and scripts therefore use
  `.mts`/`.mjs`. Renderer build settings shared by both Vite configs live in `vite.renderer.ts`.

## Layout

- `src/engine` — game rules (pure, seeded): map, generation, sight, paths, `creatures` (roster),
  `items` (supplies, weapons, armor, traps), `pack` (slot helpers), `rules` (all balance
  numbers), `run` (actions, combat, items, traps, creature turns, events), save format
- `src/main` — Electron main process: window, save store (`save-store.ts`), smoke-test mode
- `src/preload` — exposes `window.embercrawl`
- `src/shared` — types shared across processes (`bridge.ts`)
- `src/renderer/src` — React UI: `screens/` (`game/` holds the HUD meters, message log, pack bar,
  pack panel, tooltips and item/creature details, and overlays), `game/` (session, autosave,
  click-to-walk, timing, message text, item and creature wording, lore), `input/` (keyboard),
  `saves/` (desktop or browser storage), `render/` (PixiJS; `itemArt` serves item and trap
  pictures to both PixiJS and React), `assets/sprites/` (the owner's art, picked up by file name)
- `src/renderer/src/render/dungeon` — `DungeonView` (scene, frame loop, camera, light, event
  timing, transitions), `HeroRig` and `CreatureRig` (animation), `LootLayer` (items and found
  traps), `creatureArt` and `lootArt` (art or placeholders), `effects` (numbers, labels, rings,
  shots), `particles`, `textures`, `palettes`, and the pure, tested helpers `motion` (step queue,
  easing), `camera` and `lighting`
- `tests/` — Vitest; `scripts/` — tooling; `build/` — installer resources; `docs/` — plan
