# Embercrawl

An original turn-based roguelike for Windows PCs: Electron + PixiJS (dungeon) + React (UI). The
approved plan, decisions and milestones are in `docs/PLAN.md`; read it before larger changes and
update it when a decision changes.

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
  step and adds a test that loads the previous format.
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
| `pnpm smoke` | Builds, then launches the title and game screens with throwaway saves; screenshots and reports in `.smoke/`; fails on console errors |
| `node scripts/smoke.mjs <path\to\Embercrawl.exe>` | Same check against a packaged build |
| `pnpm exec tsx scripts/demo-saves.mts <folder> <floor>...` | Demo characters already on chosen floors, one user-data folder per floor |
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
  `EMBERCRAWL_USER_DATA=<folder>\floor-<n>`, `EMBERCRAWL_SMOKE_SCENE=game` and
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
- After file changes, a long-running Vite dev server can serve stale modules on Windows; restart it
  if behavior doesn't match the code.

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

- `src/engine` — game rules (pure, seeded): map, generation, sight, paths, run state, save format
- `src/main` — Electron main process: window, save store (`save-store.ts`), smoke-test mode
- `src/preload` — exposes `window.embercrawl`
- `src/shared` — types shared across processes (`bridge.ts`)
- `src/renderer/src` — React UI: `screens/`, `game/` (session, autosave, click-to-walk, timing),
  `input/` (keyboard), `saves/` (desktop or browser storage), `render/` (PixiJS), `assets/sprites/`
  (the owner's art)
- `src/renderer/src/render/dungeon` — `DungeonView` (scene, frame loop, camera, light, transitions),
  `HeroRig` (hero animation), `particles`, `textures`, `palettes`, and the pure, tested helpers
  `motion` (step queue, easing), `camera` (offsets, crisp scale) and `lighting` (falloff, flicker)
- `tests/` — Vitest; `scripts/` — tooling; `build/` — installer resources; `docs/` — plan
