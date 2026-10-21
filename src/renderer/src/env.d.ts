import type { EmbercrawlBridge } from "../../shared/bridge";

declare global {
  /** The game's version from package.json, filled in at build time (see vite.renderer.ts). */
  const __APP_VERSION__: string;

  interface Window {
    /** Present in the desktop app; undefined when the game window runs in a plain browser. */
    embercrawl?: EmbercrawlBridge;
  }
}
