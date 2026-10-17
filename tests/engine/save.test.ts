import { describe, expect, it } from "vitest";
import { applyAction } from "../../src/engine/run";
import {
  type CharacterSave,
  newCharacter,
  normalizeCharacterName,
  parseCharacterSave,
  SAVE_VERSION,
  SaveFormatError,
  summarizeCharacter,
  updateCharacter,
} from "../../src/engine/save";

const ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";
const NOW = "2026-10-17T12:00:00.000Z";

function sample(): CharacterSave {
  return newCharacter({ id: ID, name: "  Ash   Walker ", now: NOW, seed: 1234 });
}

/** A save as it would come back from disk: plain JSON with no shared references. */
function throughJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("character saves", () => {
  it("survive a round trip through a file", () => {
    const save = sample();
    expect(parseCharacterSave(throughJson(save))).toEqual(save);
  });

  it("tidy the name and start a first descent", () => {
    const save = sample();
    expect(save.name).toBe("Ash Walker");
    expect(save.run?.depth).toBe(1);
    expect(save.record).toEqual({ descents: 1, deepestFloor: 1 });
  });

  it("record the deepest floor reached", () => {
    const save = sample();
    const run = save.run;
    if (!run) throw new Error("Expected a run.");
    const deeper = { ...run, depth: 3, floors: run.floors.map((f) => ({ ...f, depth: 3 })) };
    const updated = updateCharacter(save, deeper, {
      now: "2026-10-17T13:00:00.000Z",
      playTimeMs: 5000,
    });
    expect(updated.record.deepestFloor).toBe(3);
    expect(updated.playTimeMs).toBe(5000);
    expect(updateCharacter(updated, run, { now: NOW, playTimeMs: 6000 }).record.deepestFloor).toBe(
      3,
    );
  });

  it("summarize without the floors", () => {
    expect(summarizeCharacter(sample())).toEqual({
      id: ID,
      name: "Ash Walker",
      depth: 1,
      deepestFloor: 1,
      playTimeMs: 0,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("stay valid after play", () => {
    const save = sample();
    const run = save.run;
    if (!run) throw new Error("Expected a run.");
    const played = updateCharacter(save, applyAction(run, { type: "wait" }).run, {
      now: NOW,
      playTimeMs: 10,
    });
    expect(parseCharacterSave(throughJson(played))).toEqual(played);
  });
});

describe("parseCharacterSave", () => {
  const broken = (change: (save: Record<string, unknown>) => void) => {
    const data = throughJson(sample()) as Record<string, unknown>;
    change(data);
    return () => parseCharacterSave(data);
  };

  it("rejects files that aren't Embercrawl characters", () => {
    expect(() => parseCharacterSave(null)).toThrow(SaveFormatError);
    expect(() => parseCharacterSave({ format: "something-else" })).toThrow(/not an Embercrawl/);
  });

  it("explains that a newer game version is needed", () => {
    expect(broken((s) => (s.version = SAVE_VERSION + 1))).toThrow(/newer version/);
  });

  it("rejects damaged floors", () => {
    expect(
      broken((s) => {
        const run = s.run as { floors: Array<{ tiles: number[] }> };
        run.floors[0]?.tiles.pop();
      }),
    ).toThrow(/damaged/);
  });

  it("rejects a hero standing inside a wall", () => {
    expect(
      broken((s) => {
        const run = s.run as { hero: { x: number; y: number } };
        run.hero = { ...run.hero, x: 0, y: 0 };
      }),
    ).toThrow(/open tile/);
  });

  it("rejects ids that could be used as file paths", () => {
    expect(broken((s) => (s.id = "../../evil"))).toThrow(SaveFormatError);
  });
});

describe("normalizeCharacterName", () => {
  it("accepts tidy names and rejects unusable ones", () => {
    expect(normalizeCharacterName("  Ember\tKnight  ")).toBe("Ember Knight");
    expect(() => normalizeCharacterName("   ")).toThrow(SaveFormatError);
    expect(() => normalizeCharacterName("x".repeat(25))).toThrow(SaveFormatError);
  });
});
