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

describe("sound settings", () => {
  it("default to sound on, at comfortable levels, for a settings file from before sound", () => {
    const old = parseSettings({ uiScale: 1.15, motion: "system", minimap: "large" });
    expect(old.uiScale).toBe(1.15);
    expect(old.muted).toBe(false);
    expect(old.muteInBackground).toBe(true);
    expect(old.masterVolume).toBe(DEFAULT_SETTINGS.masterVolume);
    expect(old.keys.mute).toEqual(["KeyN"]);
  });

  it("keep volumes between 0 and 100, whole numbers only", () => {
    expect(parseSettings({ effectsVolume: 35 }).effectsVolume).toBe(35);
    for (const bad of [-1, 101, 12.5, "50", null]) {
      expect(parseSettings({ effectsVolume: bad }).effectsVolume).toBe(
        DEFAULT_SETTINGS.effectsVolume,
      );
    }
  });

  it("give every key to one action only by default", () => {
    const all = KEY_ACTIONS.flatMap((action) => DEFAULT_KEYS[action]);
    expect(new Set(all).size).toBe(all.length);
  });
});
