import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CharacterSave, newCharacter, SaveFormatError } from "../../src/engine/save";
import { SAVE_EXTENSION, SaveStore } from "../../src/main/save-store";

const IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

function character(id: string, name: string, updatedAt: string): CharacterSave {
  return { ...newCharacter({ id, name, now: "2026-10-01T00:00:00.000Z", seed: 7 }), updatedAt };
}

describe("SaveStore", () => {
  let directory: string;
  let store: SaveStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "embercrawl-saves-"));
    store = new SaveStore(join(directory, "Saves"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("writes and loads a character, leaving no temporary files", async () => {
    const save = character(IDS[0] as string, "Cinder", "2026-10-02T00:00:00.000Z");
    await store.write(save);
    expect(await store.load(save.id)).toEqual(save);
    expect(await readdir(store.directory)).toEqual([`${save.id}${SAVE_EXTENSION}`]);
  });

  it("lists characters newest first and flags damaged files", async () => {
    await store.write(character(IDS[0] as string, "Older", "2026-10-02T00:00:00.000Z"));
    await store.write(character(IDS[1] as string, "Newer", "2026-10-03T00:00:00.000Z"));
    await writeFile(join(store.directory, `${IDS[2]}${SAVE_EXTENSION}`), "{ not json", "utf8");
    await writeFile(join(store.directory, "notes.txt"), "ignored", "utf8");

    const listings = await store.list();
    expect(listings.map((l) => (l.status === "ok" ? l.summary.name : l.status))).toEqual([
      "Newer",
      "Older",
      "damaged",
    ]);
    const damaged = listings[2];
    expect(damaged?.status === "damaged" && damaged.id).toBe(IDS[2]);
  });

  it("returns an empty list when there are no saves yet", async () => {
    expect(await store.list()).toEqual([]);
  });

  it("keeps only the newest of many rapid saves", async () => {
    const base = character(IDS[0] as string, "Swift", "2026-10-02T00:00:00.000Z");
    const writes = Array.from({ length: 25 }, (_, i) => store.write({ ...base, playTimeMs: i }));
    await Promise.all(writes);
    expect((await store.load(base.id)).playTimeMs).toBe(24);
  });

  it("finishes queued writes before flush resolves", async () => {
    const base = character(IDS[0] as string, "Patient", "2026-10-02T00:00:00.000Z");
    void store.write({ ...base, playTimeMs: 1 });
    void store.write({ ...base, playTimeMs: 2 });
    await store.flush();
    expect((await store.load(base.id)).playTimeMs).toBe(2);
  });

  it("refuses ids that could escape the saves folder", async () => {
    await expect(store.load("../../secrets")).rejects.toThrow(SaveFormatError);
  });

  it("refuses to write data that isn't a valid character", () => {
    expect(() => store.write({ format: "embercrawl-character", version: 1 })).toThrow(
      SaveFormatError,
    );
  });
});
