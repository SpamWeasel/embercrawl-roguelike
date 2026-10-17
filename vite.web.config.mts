// The game window on its own in a normal browser, without starting Electron (`pnpm dev:web`).
// Saves fall back to the browser's storage there.
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { RENDERER_PORT, RENDERER_ROOT, rendererPlugins } from "./vite.renderer";

export default defineConfig({
  root: resolve(import.meta.dirname, RENDERER_ROOT),
  plugins: rendererPlugins(),
  server: { port: RENDERER_PORT, strictPort: true },
});
