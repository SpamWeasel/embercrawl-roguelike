import type { EmbercrawlBridge } from "../../shared/bridge";

declare global {
  interface Window {
    /** Present in the desktop app; undefined when the game window runs in a plain browser. */
    embercrawl?: EmbercrawlBridge;
  }
}
