import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CHARACTER_ID_PATTERN,
  CHARACTER_NAME_MAX,
  type CharacterSave,
  normalizeCharacterName,
  parseCharacterSave,
  SaveFormatError,
  summarizeCharacter,
} from "../engine/save";
import type { BackupListing, CharacterListing } from "../shared/bridge";

export const SAVE_EXTENSION = ".embercrawl";
/** Far above any real save; stops a runaway write from filling the disk. */
const MAX_SAVE_BYTES = 8 * 1024 * 1024;
/** Antivirus scanners and cloud-sync tools can briefly lock files on Windows. */
const RENAME_ATTEMPTS = 6;
/** Backups kept per character, newest first. */
export const BACKUP_LIMIT = 5;
/** While playing, a fresh backup is taken at most this often. */
export const BACKUP_INTERVAL_MS = 10 * 60 * 1000;

export interface SaveStoreOptions {
  /** Moves a file somewhere it can be recovered from (the Recycle Bin, in the desktop app). */
  readonly trash: (path: string) => Promise<void>;
  /** The time now; passed in so tests can control it. */
  readonly now?: () => Date;
}

/** A character read from an import file, waiting for the player to decide what to do with it. */
export interface ImportCandidate {
  readonly save: CharacterSave;
  /** The character already on this PC with the same id, if any. */
  readonly existing: CharacterSave | null;
}

interface WriteQueue {
  /** The newest save waiting to be written; older unwritten ones are dropped. */
  pending: CharacterSave | null;
  active: Promise<void> | null;
}

/**
 * Character save files in one folder, one `<id>.embercrawl` file per character. Plain Node.js, so
 * it can be tested without Electron.
 */
export class SaveStore {
  private readonly queues = new Map<string, WriteQueue>();
  private readonly lastBackup = new Map<string, number>();
  private readonly trash: SaveStoreOptions["trash"];
  private readonly now: () => Date;

  constructor(
    readonly directory: string,
    options: SaveStoreOptions,
  ) {
    this.trash = options.trash;
    this.now = options.now ?? (() => new Date());
  }

  /** Where a character's backups live: `Backups/<id>/` beside the saves. */
  backupDirectory(id: string): string {
    this.pathFor(id);
    return join(this.directory, "Backups", id);
  }

  async list(): Promise<CharacterListing[]> {
    await mkdir(this.directory, { recursive: true });
    const ids = (await readdir(this.directory))
      .filter((file) => file.endsWith(SAVE_EXTENSION))
      .map((file) => file.slice(0, -SAVE_EXTENSION.length))
      .filter((id) => CHARACTER_ID_PATTERN.test(id));

    const listings = await Promise.all(
      ids.map(async (id): Promise<CharacterListing> => {
        try {
          return { status: "ok", summary: summarizeCharacter(await this.load(id)) };
        } catch (error) {
          const backups = (await this.backupNames(id)).length;
          return { status: "damaged", id, problem: messageOf(error), backups };
        }
      }),
    );
    const updated = (listing: CharacterListing) =>
      listing.status === "ok" ? listing.summary.updatedAt : "";
    return listings.sort((a, b) => updated(b).localeCompare(updated(a)));
  }

  /** Loads a character to play, taking a backup of it first. */
  async open(id: string): Promise<CharacterSave> {
    const save = await this.load(id);
    await this.backup(id);
    return save;
  }

  async load(id: string): Promise<CharacterSave> {
    const text = await readFile(this.pathFor(id), "utf8");
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new SaveFormatError("This character file is damaged and could not be read.");
    }
    return parseCharacterSave(data);
  }

  /**
   * Queues a save. Writes for one character happen one at a time, and if several arrive while one
   * is being written, only the newest is written next. Resolves once this save or a newer one is
   * on disk.
   */
  write(data: unknown): Promise<void> {
    const save = parseCharacterSave(data);
    const queue = this.queues.get(save.id) ?? { pending: null, active: null };
    this.queues.set(save.id, queue);
    queue.pending = save;
    queue.active ??= this.drain(queue);
    return queue.active;
  }

  /** Waits until every queued write has finished (used before the app quits). */
  async flush(): Promise<void> {
    for (;;) {
      const active = [...this.queues.values()].flatMap((q) => (q.active ? [q.active] : []));
      if (active.length === 0) return;
      await Promise.allSettled(active);
    }
  }

  private async drain(queue: WriteQueue): Promise<void> {
    try {
      while (queue.pending) {
        const next = queue.pending;
        queue.pending = null;
        await this.persist(next);
        const last = this.lastBackup.get(next.id) ?? 0;
        if (this.now().getTime() - last >= BACKUP_INTERVAL_MS) await this.backup(next.id);
      }
    } finally {
      queue.active = null;
    }
  }

  /** Waits for a character's queued writes to reach the disk. */
  private async settle(id: string): Promise<void> {
    const active = this.queues.get(id)?.active;
    if (active) await active.catch(() => undefined);
  }

  /** Renames a character; returns the renamed save. */
  async rename(id: string, name: string): Promise<CharacterSave> {
    await this.settle(id);
    const save = { ...(await this.load(id)), name: normalizeCharacterName(name) };
    await this.write(save);
    return save;
  }

  /** Moves a character's file and its backups to the trash (the Recycle Bin), where they can be recovered. */
  async remove(id: string): Promise<void> {
    await this.settle(id);
    const path = this.pathFor(id);
    await this.trash(path);
    const backups = this.backupDirectory(id);
    if ((await this.backupNames(id)).length > 0) await this.trash(backups);
    this.queues.delete(id);
    this.lastBackup.delete(id);
  }

  /** Copies the character's file into its backups, keeping the newest BACKUP_LIMIT. */
  async backup(id: string): Promise<void> {
    const source = this.pathFor(id);
    const folder = this.backupDirectory(id);
    await mkdir(folder, { recursive: true });
    const stamp = this.now().toISOString().replace(/[:.]/g, "-");
    try {
      await copyFile(source, join(folder, `${stamp}${SAVE_EXTENSION}`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    this.lastBackup.set(id, this.now().getTime());
    const names = await this.backupNames(id);
    for (const old of names.slice(BACKUP_LIMIT)) await rm(join(folder, old), { force: true });
  }

  /** A character's backups, newest first, with what each one holds. */
  async backups(id: string): Promise<BackupListing[]> {
    const folder = this.backupDirectory(id);
    return Promise.all(
      (await this.backupNames(id)).map(async (name): Promise<BackupListing> => {
        try {
          const save = await this.read(join(folder, name));
          return { name, status: "ok", summary: summarizeCharacter(save) };
        } catch (error) {
          return { name, status: "damaged", problem: messageOf(error) };
        }
      }),
    );
  }

  /** Puts a backup back in place of the character's file. The current file is backed up first. */
  async restore(id: string, name: string): Promise<CharacterSave> {
    if (!(await this.backupNames(id)).includes(name))
      throw new SaveFormatError("That backup no longer exists.");
    const save = await this.read(join(this.backupDirectory(id), name));
    if (save.id !== id) throw new SaveFormatError("That backup belongs to a different character.");
    await this.settle(id);
    await this.backup(id);
    await this.persist(save);
    return save;
  }

  /** Writes a character to a file anywhere (for exporting), once its latest turn is saved. */
  async exportTo(id: string, path: string): Promise<void> {
    await this.settle(id);
    const save = await this.load(id);
    await writeFile(path, JSON.stringify(save), "utf8");
  }

  /** Reads a character file chosen for import; nothing is saved until `accept`. */
  async readImport(path: string): Promise<ImportCandidate> {
    const save = await this.read(path);
    let existing: CharacterSave | null = null;
    try {
      existing = await this.load(save.id);
    } catch {
      existing = null;
    }
    return { save, existing };
  }

  /**
   * Saves an imported character: "replace" overwrites the one with the same id (backed up first);
   * "copy" keeps both, giving the import `newId` and "(copy)" after its name.
   */
  async accept(
    save: CharacterSave,
    mode: "replace" | "copy",
    newId: string,
  ): Promise<CharacterSave> {
    if (mode === "replace") {
      await this.settle(save.id);
      await this.backup(save.id);
      await this.persist(save);
      return save;
    }
    const suffix = " (copy)";
    const copy = {
      ...save,
      id: newId,
      name: `${save.name.slice(0, CHARACTER_NAME_MAX - suffix.length)}${suffix}`,
    };
    this.pathFor(copy.id);
    await this.persist(parseCharacterSave(copy));
    return copy;
  }

  private async read(path: string): Promise<CharacterSave> {
    const text = await readFile(path, "utf8");
    if (Buffer.byteLength(text) > MAX_SAVE_BYTES)
      throw new SaveFormatError("This file is far too large to be a character.");
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new SaveFormatError("This file is damaged, or isn't an Embercrawl character.");
    }
    return parseCharacterSave(data);
  }

  private async backupNames(id: string): Promise<string[]> {
    try {
      return (await readdir(this.backupDirectory(id)))
        .filter((file) => file.endsWith(SAVE_EXTENSION))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  /** Writes to a temporary file, then swaps it in, so a crash can never leave half a save. */
  private async persist(save: CharacterSave): Promise<void> {
    const json = JSON.stringify(save);
    if (Buffer.byteLength(json) > MAX_SAVE_BYTES) {
      throw new Error("This save is unexpectedly large and was not written.");
    }
    await mkdir(this.directory, { recursive: true });
    const path = this.pathFor(save.id);
    const temporary = `${path}.tmp`;
    await writeFile(temporary, json, "utf8");
    try {
      await renameWithRetry(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  private pathFor(id: string): string {
    if (!CHARACTER_ID_PATTERN.test(id))
      throw new SaveFormatError("That is not a valid character id.");
    return join(this.directory, `${id}${SAVE_EXTENSION}`);
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const transient = code === "EPERM" || code === "EBUSY" || code === "EACCES";
      if (!transient || attempt >= RENAME_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * attempt));
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
