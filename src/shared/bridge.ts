/**
 * The contract between the game window and the desktop shell. The game window can only reach the
 * PC through these calls; it has no direct access to files or Node.js.
 */
import type { CharacterSave, CharacterSummary } from "../engine/save";
import type { Settings } from "./settings";

/** IPC channel names shared by the main process and the preload script. */
export const IPC = {
  getAppInfo: "app:get-info",
  rendererReady: "renderer:ready",
  listCharacters: "saves:list",
  loadCharacter: "saves:load",
  createCharacter: "saves:create",
  writeCharacter: "saves:write",
  renameCharacter: "saves:rename",
  deleteCharacter: "saves:delete",
  exportCharacter: "saves:export",
  importCharacter: "saves:import",
  resolveImport: "saves:resolve-import",
  listBackups: "saves:backups",
  restoreBackup: "saves:restore",
  openSavesFolder: "saves:open-folder",
  loadSettings: "settings:load",
  saveSettings: "settings:save",
  toggleFullscreen: "window:toggle-fullscreen",
} as const;

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  platform: string;
  arch: string;
}

/**
 * Screens the smoke test can open: the title (alone, or with Settings or the newest character's
 * records open), or the game (alone, or with the pack or the merchant's panel open).
 */
export type Scene = "title" | "settings" | "records" | "game" | "pack" | "shop";

/** Sent once a screen has drawn its first frame. */
export interface ReadyDetails {
  /** Which PixiJS renderer started: "webgl", "webgpu" or "canvas". */
  renderer: string;
  scene: Scene;
  /** How many sound effects were ready (the game screens report it). */
  sounds?: number;
}

/** One entry in the character list. Damaged files are listed so the player knows they exist. */
export type CharacterListing =
  | { readonly status: "ok"; readonly summary: CharacterSummary }
  | {
      readonly status: "damaged";
      readonly id: string;
      readonly problem: string;
      /** Backups that might restore it. */
      readonly backups: number;
    };

/** One backup of a character, newest first in a list. */
export type BackupListing =
  | { readonly name: string; readonly status: "ok"; readonly summary: CharacterSummary }
  | { readonly name: string; readonly status: "damaged"; readonly problem: string };

export type ExportResult =
  | { readonly status: "cancelled" }
  | { readonly status: "saved"; readonly path: string };

/**
 * Importing asks for a file; if a character with the same id is already here, the player chooses
 * whether to replace it or keep both (`resolveImport` with the token).
 */
export type ImportResult =
  | { readonly status: "cancelled" }
  | { readonly status: "imported"; readonly summary: CharacterSummary }
  | {
      readonly status: "conflict";
      readonly token: string;
      readonly incoming: CharacterSummary;
      readonly existing: CharacterSummary;
    };

/** What this kind of storage can do (the browser preview can't keep backups or open folders). */
export interface SaveFeatures {
  readonly recycleBin: boolean;
  readonly backups: boolean;
  readonly folder: boolean;
}

export interface SaveBridge {
  list(): Promise<CharacterListing[]>;
  load(id: string): Promise<CharacterSave>;
  /** Creates, saves and returns a new character with a fresh descent. */
  create(name: string): Promise<CharacterSave>;
  /** Resolves once this save, or a newer one for the same character, is safely on disk. */
  write(save: CharacterSave): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  /** Moves the character to the Recycle Bin (the browser preview deletes it outright). */
  remove(id: string): Promise<void>;
  /** Asks where to save, then writes the character to a single `.embercrawl` file. */
  exportCharacter(id: string): Promise<ExportResult>;
  /** Asks for a `.embercrawl` file and imports it (see ImportResult). */
  importCharacter(): Promise<ImportResult>;
  resolveImport(token: string, choice: "replace" | "copy" | "cancel"): Promise<void>;
  backups(id: string): Promise<BackupListing[]>;
  restore(id: string, backup: string): Promise<void>;
  /** Opens the saves folder in File Explorer. */
  openFolder(): Promise<void>;
  readonly features: SaveFeatures;
}

export interface SettingsBridge {
  load(): Promise<Settings>;
  /** Saves and applies the settings (the interface size takes effect at once); resolves to what was stored. */
  save(settings: Settings): Promise<Settings>;
}

export interface EmbercrawlBridge {
  getAppInfo(): Promise<AppInfo>;
  signalReady(details: ReadyDetails): void;
  /** Switches the game window in or out of fullscreen; resolves to the new state. */
  toggleFullscreen(): Promise<boolean>;
  saves: SaveBridge;
  settings: SettingsBridge;
}
