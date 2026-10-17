/**
 * The contract between the game window and the desktop shell. The game window can only reach the
 * PC through these calls; it has no direct access to files or Node.js.
 */

/** IPC channel names shared by the main process and the preload script. */
export const IPC = {
  getAppInfo: "app:get-info",
  rendererReady: "renderer:ready",
} as const;

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  platform: string;
  arch: string;
}

/** Sent once the game window has drawn its first frame. */
export interface ReadyDetails {
  /** Which PixiJS renderer started: "webgl", "webgpu" or "canvas". */
  renderer: string;
}

export interface EmbercrawlBridge {
  getAppInfo(): Promise<AppInfo>;
  signalReady(details: ReadyDetails): void;
}
