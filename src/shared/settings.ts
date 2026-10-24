/**
 * Player settings, kept per PC (not per character): interface size, motion, the map's size and
 * key bindings. The desktop app stores them in `settings.json` beside the saves; the browser
 * preview keeps them in browser storage. Both check them with `parseSettings`.
 */
import { z } from "zod";

/** Actions that can be bound to keys. Escape (menu), the number row (items) and F11 are fixed. */
export const KEY_ACTIONS = [
  "move-n",
  "move-s",
  "move-w",
  "move-e",
  "move-nw",
  "move-ne",
  "move-sw",
  "move-se",
  "wait",
  "interact",
  "lantern",
  "pulse",
  "pack",
  "map",
  "help",
] as const;
export type KeyAction = (typeof KEY_ACTIONS)[number];

/** How many keys one action can have. */
export const KEYS_PER_ACTION = 3;

/** Physical key codes (KeyboardEvent.code), so WASD stays put on any keyboard layout. */
export const DEFAULT_KEYS: Readonly<Record<KeyAction, readonly string[]>> = {
  "move-n": ["KeyW", "ArrowUp", "Numpad8"],
  "move-s": ["KeyS", "ArrowDown", "Numpad2"],
  "move-w": ["KeyA", "ArrowLeft", "Numpad4"],
  "move-e": ["KeyD", "ArrowRight", "Numpad6"],
  "move-nw": ["KeyQ", "Numpad7"],
  "move-ne": ["KeyE", "Numpad9"],
  "move-sw": ["KeyZ", "Numpad1"],
  "move-se": ["KeyC", "Numpad3"],
  wait: ["Space", "Numpad5", "Period"],
  interact: ["Enter", "NumpadEnter"],
  lantern: ["KeyL"],
  pulse: ["KeyF"],
  pack: ["KeyI", "Tab"],
  map: ["KeyM"],
  help: ["KeyH"],
};

/** Keys that can't be bound, because they're fixed or belong to Windows. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  "Escape",
  "F11",
  "MetaLeft",
  "MetaRight",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "Digit8",
  "Digit9",
  "Digit0",
]);

/** Interface sizes offered (1 = normal). */
export const UI_SCALES = [0.9, 1, 1.15, 1.3] as const;
export type UiScale = (typeof UI_SCALES)[number];

export interface Settings {
  readonly uiScale: UiScale;
  /** "system" follows Windows' animation setting; "reduced" always uses calmer animation. */
  readonly motion: "system" | "reduced";
  readonly minimap: "small" | "large" | "hidden";
  readonly keys: Readonly<Record<KeyAction, readonly string[]>>;
}

export const DEFAULT_SETTINGS: Settings = {
  uiScale: 1,
  motion: "system",
  minimap: "small",
  keys: DEFAULT_KEYS,
};

const KeyList = z.array(z.string().regex(/^[A-Za-z0-9]{1,24}$/)).max(KEYS_PER_ACTION);

const SettingsSchema = z.object({
  uiScale: z.union(
    UI_SCALES.map((scale) => z.literal(scale)) as [
      z.ZodLiteral<UiScale>,
      ...z.ZodLiteral<UiScale>[],
    ],
  ),
  motion: z.enum(["system", "reduced"]),
  minimap: z.enum(["small", "large", "hidden"]),
  keys: z.partialRecord(z.enum(KEY_ACTIONS), KeyList),
});

/**
 * Settings from a file or another process, made valid: anything missing or wrong falls back to
 * its default (settings never stop the game from starting).
 */
export function parseSettings(data: unknown): Settings {
  const input = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const pick = <K extends keyof Settings>(key: K): Settings[K] => {
    const result = SettingsSchema.shape[key].safeParse(input[key]);
    return result.success ? (result.data as Settings[K]) : DEFAULT_SETTINGS[key];
  };
  const keys = pick("keys") as Partial<Record<KeyAction, readonly string[]>>;
  return {
    uiScale: pick("uiScale"),
    motion: pick("motion"),
    minimap: pick("minimap"),
    // Any action missing from a file (for example one added in a later version) gets its default.
    keys: Object.fromEntries(
      KEY_ACTIONS.map((action) => [
        action,
        (keys[action] ?? DEFAULT_KEYS[action]).filter((code) => !RESERVED_KEYS.has(code)),
      ]),
    ) as unknown as Record<KeyAction, readonly string[]>,
  };
}

/**
 * The bindings with `code` given to `action` (as its `index`-th key). A key does one thing only,
 * so it's taken from any other action that had it.
 */
export function bindKey(
  keys: Settings["keys"],
  action: KeyAction,
  index: number,
  code: string,
): Settings["keys"] {
  if (RESERVED_KEYS.has(code)) return keys;
  const next = Object.fromEntries(
    KEY_ACTIONS.map((a) => [a, keys[a].filter((c) => c !== code)]),
  ) as Record<KeyAction, string[]>;
  const list = [...next[action]];
  list.splice(Math.min(index, list.length), index < list.length ? 1 : 0, code);
  next[action] = list.slice(0, KEYS_PER_ACTION);
  return next;
}

/** The bindings with the `index`-th key of `action` removed. */
export function unbindKey(
  keys: Settings["keys"],
  action: KeyAction,
  index: number,
): Settings["keys"] {
  return { ...keys, [action]: keys[action].filter((_, i) => i !== index) };
}

/** A key code as a player would read it: "W", "Up", "Num 8", "Space". */
export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) {
    const rest = code.slice(6);
    return rest === "Enter" ? "Num Enter" : `Num ${rest}`;
  }
  if (code.startsWith("Arrow")) return code.slice(5);
  const names: Record<string, string> = {
    Space: "Space",
    Period: ".",
    Comma: ",",
    Slash: "/",
    Semicolon: ";",
    Quote: "'",
    BracketLeft: "[",
    BracketRight: "]",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    Backslash: "\\",
    ShiftLeft: "Left Shift",
    ShiftRight: "Right Shift",
    ControlLeft: "Left Ctrl",
    ControlRight: "Right Ctrl",
    AltLeft: "Left Alt",
    AltRight: "Right Alt",
  };
  return names[code] ?? code;
}
