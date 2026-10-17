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
- Cosmetic-only randomness in the renderer may use `Math.random()`.
- **Saves must never break:** every save-format change bumps the format version, adds an upgrade
  step and adds a test that loads the previous format.
- **Golden RNG values** in `tests/engine/rng.test.ts` change every dungeon from every seed. Only
  update them as a deliberate, stated decision.
- **Security:** the game window reaches the PC only through `src/shared/bridge.ts` and
  `src/preload`. Keep that bridge narrow (specific operations, no generic file or IPC
  pass-through), and leave `contextIsolation` and `sandbox` on.
- Each milestone ends with `pnpm check` and `pnpm smoke` passing, then a commit.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Desktop app with hot reload |
| `pnpm dev:web` | Game window only, at http://localhost:5173 (browser-pane launch config `embercrawl-web`) |
| `pnpm check` | Typecheck (engine, node, web) + Biome lint + Vitest |
| `pnpm format` | Biome auto-format and import sorting |
| `pnpm smoke` | Builds, launches, saves `.smoke/screenshot.png` and a report; fails on console errors |
| `node scripts/smoke.mjs <path\to\Embercrawl.exe>` | Same check against a packaged build |
| `pnpm dist` | Installers in `release/<version>/` (x64 and ARM64) |
| `node scripts/make-icon.mjs [source.png]` | Rebuilds `build/icon.png` and `build/icon.ico` |

## Environment notes

- Windows 11 on ARM64, Windows PowerShell 5.1. If `node`, `pnpm`, `git` or `magick` is "not
  recognized" in a shell started before they were installed, refresh PATH:
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`
- pnpm 12 blocks dependency install scripts; decisions live under `allowBuilds` in
  `pnpm-workspace.yaml`. It also holds back package releases less than a day old.
- Electron 44 downloads its binary on first use (`node node_modules/electron/install.js`).
- Every library is a devDependency: Vite bundles all code into `out/`, so the packaged app ships no
  `node_modules`.
- `package.json` is deliberately not `"type": "module"`, so Electron's main and preload build as
  CommonJS (the sandboxed preload requires it). ESM-only tool configs therefore use `.mts`.

## Layout

- `src/engine` — game rules (pure, seeded)
- `src/main` — Electron main process (window, smoke-test mode, later save files)
- `src/preload` — exposes `window.embercrawl`
- `src/shared` — types shared across processes (`bridge.ts`)
- `src/renderer/src` — React UI; `render/` holds PixiJS scenes
- `tests/` — Vitest; `scripts/` — tooling; `build/` — installer resources; `docs/` — plan
