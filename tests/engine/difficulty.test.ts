import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateFloor } from "../../src/engine/generate";
import { FLOOR_COUNT } from "../../src/engine/map";
import { DIFFICULTIES, DIFFICULTY_HEALTH } from "../../src/engine/rules";
import { applyAction, type GameEvent, newRun, type RunState } from "../../src/engine/run";
import {
  beginDescent,
  newCharacter,
  parseCharacterSave,
  SAVE_VERSION,
  summarizeCharacter,
  updateCharacter,
} from "../../src/engine/save";
import { arena, trap } from "./helpers";

const NOW = "2026-10-28T12:00:00.000Z";
const LATER = "2026-10-28T13:00:00.000Z";
const ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const ROOM = [
  "##########", //
  "#........#",
  "#........#",
  "#........#",
  "##########",
];

describe("difficulty", () => {
  it("changes only how much health creatures have, never the floor itself", () => {
    for (const depth of [1, 7, 10, 19, 30]) {
      const normal = generateFloor(42, depth);
      expect(generateFloor(42, depth, "normal")).toEqual(normal);
      for (const difficulty of DIFFICULTIES) {
        const floor = generateFloor(42, depth, difficulty);
        const { monsters, ...rest } = floor;
        const { monsters: normalMonsters, ...normalRest } = normal;
        expect(rest).toEqual(normalRest);
        expect(monsters.map((m) => [m.kind, m.x, m.y, m.attack])).toEqual(
          normalMonsters.map((m) => [m.kind, m.x, m.y, m.attack]),
        );
        monsters.forEach((m, i) => {
          const base = normalMonsters[i]?.maxHp ?? 0;
          if (difficulty === "easy") expect(m.maxHp).toBeLessThanOrEqual(base);
          if (difficulty === "hard") expect(m.maxHp).toBeGreaterThanOrEqual(base);
        });
      }
    }
    expect(DIFFICULTY_HEALTH.easy).toBeLessThan(1);
    expect(DIFFICULTY_HEALTH.normal).toBe(1);
    expect(DIFFICULTY_HEALTH.hard).toBeGreaterThan(1);
  });

  it("follows the descent down the stairs", () => {
    const run = newRun(9, "hard");
    expect(run.difficulty).toBe("hard");
    let stairs: RunState = run;
    for (let i = 0; i < 4000 && stairs.depth === 1; i++) {
      const floor = stairs.floors[0];
      if (!floor?.downStairs) break;
      stairs = { ...stairs, hero: { ...stairs.hero, ...floor.downStairs } };
      stairs = applyAction(stairs, { type: "use-stairs" }).run;
    }
    expect(stairs.depth).toBe(2);
    const floor2 = stairs.floors.find((f) => f.depth === 2);
    expect(floor2?.monsters).toEqual(generateFloor(9, 2, "hard").monsters);
  });

  it("belongs to the character, and can change with each new descent", () => {
    const save = newCharacter({ id: ID, name: "Tester", now: NOW, seed: 3, difficulty: "easy" });
    expect(save.difficulty).toBe("easy");
    expect(save.run?.difficulty).toBe("easy");
    expect(summarizeCharacter(save).difficulty).toBe("easy");
    const same = beginDescent(save, 4, LATER);
    expect(same.run?.difficulty).toBe("easy");
    const harder = beginDescent(save, 4, LATER, "hard");
    expect(harder.difficulty).toBe("hard");
    expect(harder.run?.difficulty).toBe("hard");
    expect(parseCharacterSave(JSON.parse(JSON.stringify(harder)))).toEqual(harder);
  });

  it("is written into the history", () => {
    const save = newCharacter({ id: ID, name: "Tester", now: NOW, seed: 3, difficulty: "hard" });
    const run = save.run as RunState;
    const fallen = updateCharacter(
      save,
      { ...run, status: "dead", killedBy: "cinder-mite" },
      { now: LATER, playTimeMs: 1 },
    );
    expect(fallen.record.history[0]?.difficulty).toBe("hard");
  });

  it("earns Hard Won only for a win on Hard", () => {
    const won = (difficulty: "normal" | "hard") => {
      const save = newCharacter({ id: ID, name: "Tester", now: NOW, seed: 3, difficulty });
      const run = save.run as RunState;
      return updateCharacter(
        save,
        { ...run, status: "won" },
        { now: LATER, playTimeMs: 1 },
      ).record.achievements.map((a) => a.id);
    };
    expect(won("hard")).toContain("hard-won");
    expect(won("normal")).toContain("keeper-of-the-beacon");
    expect(won("normal")).not.toContain("hard-won");
  });
});

describe("version-5 saves", () => {
  // A real version-5 save from the milestone-8 engine: one descent that ended on floor 26, and a
  // second one on floor 6 with 188 gold, both played by the balance bot.
  const v5 = JSON.parse(
    readFileSync(fileURLToPath(new URL("../fixtures/character-v5.json", import.meta.url)), "utf8"),
  );

  it("upgrade to Normal everywhere, keeping everything else", () => {
    expect(v5.version).toBe(5);
    const save = parseCharacterSave(v5);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.difficulty).toBe("normal");
    expect(save.run).toEqual({ ...v5.run, difficulty: "normal" });
    expect(save.record).toEqual({
      ...v5.record,
      history: v5.record.history.map((entry: object) => ({ ...entry, difficulty: "normal" })),
    });
    expect(save.record.history.length).toBeGreaterThan(0);
    expect(save.record.achievements.length).toBeGreaterThan(0);
  });

  it("carry on playing after the upgrade", () => {
    const save = parseCharacterSave(v5);
    const run = save.run as RunState;
    const next = applyAction(run, { type: "wait" });
    expect(next.run.turn).toBe(run.turn + 1);
    expect(next.run.difficulty).toBe("normal");
  });
});

describe("spike traps", () => {
  const sprung = (result: { events: readonly GameEvent[] }) =>
    result.events.filter((e) => e.type === "trap-sprung");

  it("stab like a blow, so armor turns part of them aside", () => {
    const step = (armor: "travelers-coat" | "obsidian-plate") =>
      applyAction(
        arena(ROOM, {
          hero: { x: 1, y: 2 },
          equipment: { armor },
          traps: [trap("spike-trap", { x: 2, y: 2 }, 10)],
        }),
        { type: "move", direction: "e" },
      );
    // The coat's defense is 1 and the plate's 7.
    expect(step("travelers-coat").run.hero.hp).toBe(21);
    expect(step("obsidian-plate").run.hero.hp).toBe(27);
    expect(sprung(step("obsidian-plate"))).toMatchObject([
      { kind: "spike-trap", damage: 3, absorbed: 0 },
    ]);
  });

  it("are blunted by a shield after armor", () => {
    const result = applyAction(
      arena(ROOM, {
        hero: { x: 1, y: 2, shield: 2 },
        traps: [trap("spike-trap", { x: 2, y: 2 }, 10)],
      }),
      { type: "move", direction: "e" },
    );
    expect(result.run.hero).toMatchObject({ hp: 23, shield: 0 });
    expect(sprung(result)).toMatchObject([{ damage: 9, absorbed: 2 }]);
  });

  it("only appear from floor 4", () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (let depth = 1; depth < 4; depth++) {
        expect(generateFloor(seed, depth).traps.some((t) => t.kind === "spike-trap")).toBe(false);
      }
    }
    const later = Array.from({ length: 40 }, (_, seed) =>
      Array.from({ length: FLOOR_COUNT - 3 }, (_, i) => generateFloor(seed + 1, i + 4)),
    ).flat();
    expect(later.some((floor) => floor.traps.some((t) => t.kind === "spike-trap"))).toBe(true);
  });
});
