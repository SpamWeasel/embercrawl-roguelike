import { describe, expect, it } from "vitest";
import {
  bindKey,
  DEFAULT_KEYS,
  DEFAULT_SETTINGS,
  KEY_ACTIONS,
  keyLabel,
  parseSettings,
  unbindKey,
} from "../../src/shared/settings";

describe("settings", () => {
  it("fall back to defaults for anything missing or wrong", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    const mixed = parseSettings({ uiScale: 7, motion: "reduced", keys: { wait: ["KeyX"] } });
    expect(mixed.uiScale).toBe(1);
    expect(mixed.motion).toBe("reduced");
    expect(mixed.keys.wait).toEqual(["KeyX"]);
    expect(mixed.keys["move-n"]).toEqual(DEFAULT_KEYS["move-n"]);
  });

  it("never bind the fixed keys", () => {
    expect(parseSettings({ keys: { wait: ["Escape", "Digit1", "KeyX"] } }).keys.wait).toEqual([
      "KeyX",
    ]);
    expect(bindKey(DEFAULT_KEYS, "wait", 0, "Escape")).toBe(DEFAULT_KEYS);
  });

  it("move a key from one action to another, so each key does one thing", () => {
    const keys = bindKey(DEFAULT_KEYS, "pulse", 0, "KeyW");
    expect(keys.pulse).toEqual(["KeyW"]);
    expect(keys["move-n"]).toEqual(["ArrowUp", "Numpad8"]);
    const all = KEY_ACTIONS.flatMap((a) => keys[a]);
    expect(new Set(all).size).toBe(all.length);
    expect(unbindKey(keys, "pulse", 0).pulse).toEqual([]);
  });

  it("add a key when there's room, up to three", () => {
    expect(bindKey(DEFAULT_KEYS, "lantern", 1, "KeyB").lantern).toEqual(["KeyL", "KeyB"]);
  });

  it("name keys plainly", () => {
    expect(keyLabel("KeyW")).toBe("W");
    expect(keyLabel("ArrowUp")).toBe("Up");
    expect(keyLabel("Numpad8")).toBe("Num 8");
    expect(keyLabel("Space")).toBe("Space");
  });
});
