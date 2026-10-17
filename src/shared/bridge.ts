/**
 * The contract between the game window and the desktop shell. The game window can only reach the
 * PC through these calls; it has no direct access to files or Node.js.
 */
import type { CharacterSave, CharacterSummary } from "../engine/save";

/** IPC channel names shared by the main process and the preload script. */
export const IPC = {
  getAppInfo: "app:get-info",
  rendererReady: "renderer:ready",
  listCharacters: "saves:list",
  loadCharacter: "saves:load",
  createCharacter: "saves:create",
  writeCharacter: "saves:write",
  toggleFullscreen: "window:toggle-fullscreen",
} as const;

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  platform: string;
  arch: string;
}

/** Screens the smoke test can open: the title, the game, or the game with the pack open. */
export type Scene = "title" | "game" | "pack";

/** Sent once a screen has drawn its first frame. */
export interface ReadyDetails {
  /** Which PixiJS renderer started: "webgl", "webgpu" or "canvas". */
  renderer: string;
  scene: Scene;
}

/** One entry in the character list. Damaged files are listed so the player knows they exist. */
export type CharacterListing =
  | { readonly status: "ok"; readonly summary: CharacterSummary }
  | { readonly status: "damaged"; readonly id: string; readonly problem: string };

export interface SaveBridge {
  list(): Promise<CharacterListing[]>;
  load(id: string): Promise<CharacterSave>;
  /** Creates, saves and returns a new character with a fresh descent. */
  create(name: string): Promise<CharacterSave>;
  /** Resolves once this save, or a newer one for the same character, is safely on disk. */
  write(save: CharacterSave): Promise<void>;
}

export interface EmbercrawlBridge {
  getAppInfo(): Promise<AppInfo>;
  signalReady(details: ReadyDetails): void;
  /** Switches the game window in or out of fullscreen; resolves to the new state. */
  toggleFullscreen(): Promise<boolean>;
  saves: SaveBridge;
}
