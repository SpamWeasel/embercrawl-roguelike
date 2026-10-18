# Embercrawl

An original turn-based roguelike for Windows PCs.

## Requirements

Node.js 24, pnpm 12 and Git. ImageMagick is needed only for art and icon scripts.

## Getting started

```powershell
pnpm install
node node_modules/electron/install.js
pnpm dev
```

`pnpm check` runs the type checks, linter and tests. `pnpm dist` builds installers into
`release/`. See `docs/PLAN.md` for the design and roadmap, `docs/DEVELOPMENT_GUIDE.md` for how
every mechanic works and how to tune it, and `CLAUDE.md` for project rules and all commands.
