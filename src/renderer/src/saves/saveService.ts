import {
  CHARACTER_NAME_MAX,
  type CharacterSave,
  newCharacter,
  normalizeCharacterName,
  parseCharacterSave,
  summarizeCharacter,
} from "../../../engine/save";
import type { CharacterListing, ImportResult, SaveBridge } from "../../../shared/bridge";
import { DEFAULT_SETTINGS, parseSettings, type Settings } from "../../../shared/settings";

/**
 * Where characters are stored: files on disk in the desktop app, or this browser's storage when
 * the game window runs in a plain browser for development.
 */
export const saveService: SaveBridge = window.embercrawl?.saves ?? createBrowserSaves();
export const savesAreLocalToBrowser = window.embercrawl === undefined;

/** Settings: a file beside the saves in the desktop app, browser storage otherwise. */
export const settingsService = window.embercrawl?.settings ?? createBrowserSettings();

const STORAGE_PREFIX = "embercrawl:character:";
const SETTINGS_KEY = "embercrawl:settings";

function createBrowserSaves(): SaveBridge {
  const read = (id: string): CharacterSave => {
    const text = localStorage.getItem(STORAGE_PREFIX + id);
    if (text === null) throw new Error("That character no longer exists.");
    return parseCharacterSave(JSON.parse(text));
  };
  const write = async (save: CharacterSave) => {
    localStorage.setItem(STORAGE_PREFIX + save.id, JSON.stringify(parseCharacterSave(save)));
  };
  const pending = new Map<string, CharacterSave>();
  const exists = (id: string) => localStorage.getItem(STORAGE_PREFIX + id) !== null;

  return {
    list: async () => {
      const listings: CharacterListing[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(STORAGE_PREFIX)) continue;
        const id = key.slice(STORAGE_PREFIX.length);
        try {
          listings.push({ status: "ok", summary: summarizeCharacter(read(id)) });
        } catch (error) {
          listings.push({ status: "damaged", id, problem: readableError(error), backups: 0 });
        }
      }
      const updated = (l: CharacterListing) => (l.status === "ok" ? l.summary.updatedAt : "");
      return listings.sort((a, b) => updated(b).localeCompare(updated(a)));
    },
    load: async (id) => read(id),
    create: async (name) => {
      const save = newCharacter({
        id: crypto.randomUUID(),
        name,
        now: new Date().toISOString(),
        seed: crypto.getRandomValues(new Uint32Array(1))[0] ?? 0,
      });
      await write(save);
      return save;
    },
    write,
    rename: async (id, name) => write({ ...read(id), name: normalizeCharacterName(name) }),
    remove: async (id) => localStorage.removeItem(STORAGE_PREFIX + id),
    exportCharacter: async (id) => {
      const save = read(id);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(
        new Blob([JSON.stringify(save)], { type: "application/json" }),
      );
      link.download = `${save.name}.embercrawl`;
      link.click();
      URL.revokeObjectURL(link.href);
      return { status: "saved", path: "your Downloads folder" };
    },
    importCharacter: async (): Promise<ImportResult> => {
      const file = await pickFile();
      if (!file) return { status: "cancelled" };
      const save = parseCharacterSave(JSON.parse(await file.text()));
      if (!exists(save.id)) {
        await write(save);
        return { status: "imported", summary: summarizeCharacter(save) };
      }
      const token = crypto.randomUUID();
      pending.set(token, save);
      return {
        status: "conflict",
        token,
        incoming: summarizeCharacter(save),
        existing: summarizeCharacter(read(save.id)),
      };
    },
    resolveImport: async (token, choice) => {
      const save = pending.get(token);
      pending.delete(token);
      if (!save || choice === "cancel") return;
      if (choice === "replace") return write(save);
      const suffix = " (copy)";
      await write({
        ...save,
        id: crypto.randomUUID(),
        name: `${save.name.slice(0, CHARACTER_NAME_MAX - suffix.length)}${suffix}`,
      });
    },
    backups: async () => [],
    restore: async () => {
      throw new Error("Backups are only kept by the desktop app.");
    },
    openFolder: async () => {
      throw new Error("The browser preview has no saves folder.");
    },
    features: { recycleBin: false, backups: false, folder: false },
  };
}

/** Asks the player for a file, resolving to null if they cancel. */
function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".embercrawl,application/json";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

function createBrowserSettings() {
  return {
    load: async (): Promise<Settings> => {
      try {
        return parseSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}"));
      } catch {
        return DEFAULT_SETTINGS;
      }
    },
    save: async (settings: Settings): Promise<Settings> => {
      const clean = parseSettings(settings);
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(clean));
      } catch {
        // Storage can be unavailable; the settings still apply for this session.
      }
      return clean;
    },
  };
}

/** Turns errors (including ones relayed from the desktop shell) into a sentence for the player. */
export function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, "");
}
